"""Riconoscimento assistito locale: foto -> candidati visivi -> prodotto e parti stock.

Il ranking non legge le annotazioni del test. La revisione visiva di Codex è un passo
esplicito e separato; le sue proposte non sono una ground truth confermata dall'utente.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import html
import io
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'data/recognition'
PARTS = ROOT / 'public/images/parts'
FIELDS = ('blade', 'lockChip', 'mainBlade', 'assistBlade', 'overBlade', 'ratchet', 'bit')


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def font(size):
    for name in ('C:/Windows/Fonts/arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if Path(name).exists():
            return ImageFont.truetype(name, size)
    return ImageFont.load_default()


def visual_identity(parts):
    """Le CX hanno una lama componibile: non inventare un ID blade monolitico."""
    if parts.get('blade'):
        return parts['blade']
    if parts.get('lockChip') and parts.get('mainBlade'):
        return f"cx:{parts['lockChip']}/{parts['mainBlade']}"
    return None


def build_catalog():
    wiki = read(ROOT / 'data/products-wiki.json')
    master = read(ROOT / 'data/parts-master.json')
    variants = read(DATA / 'visual-variants.json')['variants']
    all_parts = {p['id']: p for v in master.values() if isinstance(v, list)
                 for p in v if isinstance(p, dict) and 'id' in p}
    assemblies = {b['id']: b for b in wiki['beys']}
    products = wiki['products']
    offers = []
    for b in assemblies.values():
        releases = list(b['releases'])
        # Le pagine senza Releases conservano i codici dichiarati dall'infobox.
        for maker, code in b['codes'].items():
            if code and not any(r['manufacturer'] == maker and r['code'] == code for r in releases):
                releases.append({'manufacturer': maker, 'code': code, 'variant': None,
                                 'tipo': None, 'nota': None, 'dentro': None})
        for r in releases:
            pack = next((p for p in products if p['code'] == r['code']
                         and p['manufacturer'] == r['manufacturer']
                         and any(c['titolo'] == b['id'] for c in p['contiene'])), None)
            # I -00 sono codici condivisi: il titolo resta parte dell'identità.
            key = json.dumps([b['id'], r], sort_keys=True)
            offers.append({'id': hashlib.sha256(key.encode()).hexdigest()[:20],
                           'assembly': b['id'], **r,
                           'packId': pack['id'] if pack else None,
                           'packName': (pack['names'].get('hasbro') or pack['names'].get('tt')) if pack else r.get('dentro'),
                           'source': b['page']})
    for v in variants:
        if v['assembly'] not in assemblies:
            raise ValueError(f"Prodotto non presente nel catalogo: {v['assembly']}")
        b = assemblies[v['assembly']]
        if b['parts']['blade'] != v['blade']:
            raise ValueError(f"Lama incoerente: {v['id']}")
        if not visual_identity(b['parts']):
            raise ValueError(f"Identità visiva non risolta: {v['id']}")
        for k, value in v.get('visibleParts', {}).items():
            if b['parts'].get(k) != value:
                raise ValueError(f"Componente CX incoerente: {v['id']} {k}")
        snap = DATA / f"sources/{v['id']}.json"
        if snap.exists():
            s = read(snap)
            # Le parti stock si confrontano anche con il wikitext fresco salvato.
            import re
            for field, raw in [('Ratchet', 'ratchet'), ('Bit', 'bit')]:
                m = re.search(r'^\|\s*' + field + r'\s*=([^\n]+)', s['wikitext'], re.M)
                expected = b['partsRaw'].get(field)
                if m and expected and m[1].strip() != expected:
                    raise ValueError(f"Fonte aggiornata diversa dal catalogo: {v['id']} {raw}")
    return {'schemaVersion': 1, 'sourceVersion': wiki['version'],
            'inputHashes': {f: digest(ROOT / 'data' / f) for f in ('parts-master.json', 'products-wiki.json')},
            'parts': all_parts, 'assemblies': assemblies, 'products': products,
            'offers': offers, 'variants': variants,
            'unresolved': wiki['unresolved']}


def stock_result(catalog, variant_id):
    v = next((v for v in catalog['variants'] if v['id'] == variant_id), None)
    if not v:
        raise ValueError(f'Variante sconosciuta: {variant_id}')
    b = catalog['assemblies'][v['assembly']]
    part = lambda k: catalog['parts'].get(b['parts'].get(k), {})
    bit = part('bit')
    return {'variant': v['id'], 'blade': v['blade'], 'identity': visual_identity(b['parts']), 'name': b['names']['tt'],
            'westernName': b['names'].get('hasbro') or b['names'].get('hasbroDaRedirect'),
            'stockParts': b['parts'], 'bitName': bit.get('names', {}).get('tt'),
            'bitCode': bit.get('shortName'), 'preferredCode': v['preferredCode'],
            'variantNumber': v.get('variantNumber'), 'officialUrl': v['officialUrl'],
            'source': b['page'],
            'stockAmbiguous': bool(v.get('assemblyAlternatives')),
            'alternativeStockProducts': [{'name': a, 'stockParts': catalog['assemblies'][a]['parts'],
                                          'source': catalog['assemblies'][a]['page']}
                                         for a in v.get('assemblyAlternatives', [])],
            'commercialCandidates': [o for o in catalog['offers'] if o['assembly'] == b['id']],
            'inference': 'stock_configuration', 'currentAssemblyVerified': False,
            'skuVerified': False, 'appearance': v['appearance']}


def lookup(catalog, name, color=None, maker=None):
    import re
    norm = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())
    matches = []
    for p in catalog['parts'].values():
        if p.get('category') != 'blade':
            continue
        aliases = [p['id'], *p.get('names', {}).values(),
                   *(a['value'] for a in p.get('aliases', []))]
        if norm(name) in {norm(a) for a in aliases if a}:
            matches.append(p['id'])
    candidates = []
    for b in catalog['assemblies'].values():
        # Anche i nomi composti CX e i redirect Hasbro sono chiavi di ricerca.
        aliases = [b['id'], *b['page'].get('redirects', []),
                   b['names'].get('tt'), b['names'].get('hasbro'), b['names'].get('hasbroDaRedirect')]
        aliases = [re.sub(r'\s+(?:[A-Z]{0,3})?\d+-\d+[A-Za-z]*$', '', a) for a in aliases if a]
        named_assembly = norm(name) in {norm(a) for a in aliases}
        if b['parts'].get('blade') not in matches and not named_assembly:
            continue
        offers = [o for o in catalog['offers'] if o['assembly'] == b['id']
                  and (not maker or o['manufacturer'] == maker)]
        if color:
            curated = any(v['assembly'] == b['id'] and v.get('color') == color for v in catalog['variants'])
            if not curated:
                offers = [o for o in offers if re.search(r'\b' + re.escape(color.lower()) + r'\b', (o.get('nota') or '').lower())]
        if not offers:
            continue
        candidates.append({'assembly': b['id'], 'identity': visual_identity(b['parts']), 'stockParts': b['parts'], 'offers': offers,
                           'source': b['page'], 'currentAssemblyVerified': False})
    return {'blades': matches, 'color': color, 'manufacturer': maker,
            'status': ('resolved_stock' if len(candidates) == 1 else 'ambiguous' if candidates else 'unresolved'),
            'candidates': candidates}


def crop_boxes(image, fixture):
    rw, rh = fixture['referenceSize']
    if rw <= 0 or rh <= 0:
        raise ValueError('Dimensioni di riferimento non valide')
    ids = set()
    for obj in fixture['objects']:
        if obj['id'] in ids or not obj['id'].isalnum():
            raise ValueError('ID ritaglio duplicato o non alfanumerico')
        ids.add(obj['id'])
        x1, y1, x2, y2 = obj['box']
        if not (0 <= x1 < x2 <= rw and 0 <= y1 < y2 <= rh):
            raise ValueError(f"Riquadro fuori foto: {obj['id']}")
        box = (round(x1 * image.width / rw), round(y1 * image.height / rh),
               round(x2 * image.width / rw), round(y2 * image.height / rh))
        yield obj, box, image.crop(box)


def normalize_image(image, reference=False):
    """Centra il riferimento sul suo alpha; non rimuove né inventa dettagli nella foto."""
    im = image.convert('RGBA')
    if reference:
        rgba = np.array(im)
        mask = (rgba[:, :, 3] > 30) & (rgba[:, :, :3].min(axis=2) < 238)
        yy, xx = np.where(mask)
        if len(xx):
            im = im.crop((int(xx.min()), int(yy.min()), int(xx.max()) + 1, int(yy.max()) + 1))
    rgb = Image.new('RGB', im.size, 'white')
    rgb.paste(im, mask=im.getchannel('A'))
    return np.array(ImageOps.fit(rgb, (192, 192), method=Image.Resampling.LANCZOS))


def features(image, reference=False):
    """Forma da bordi in scala di grigi; colore in un descrittore separato."""
    rgb = normalize_image(image, reference)
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    yy, xx = np.indices((192, 192))
    radius = np.sqrt((xx - 95.5) ** 2 + (yy - 95.5) ** 2) / 96
    histograms = []
    for lo, hi in ((0, .28), (.28, .59), (.59, .87)):
        mask = ((radius >= lo) & (radius < hi)).astype(np.uint8) * 255
        h = cv2.calcHist([hsv], [0, 1], mask, [24, 4], [0, 180, 0, 256]).flatten()
        histograms.append(h / (h.sum() + 1e-8))
    # Sagoma/struttura prima del colore: i descrittori primari non contengono hue.
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(6, 6)).apply(gray)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 60, 130)
    edges = cv2.GaussianBlur(edges, (7, 7), 0)
    channels = []
    for channel in (edges, gray):
        p = cv2.warpPolar(channel.astype(np.float32) / 255, (48, 72), (95.5, 95.5), 84,
                          cv2.WARP_POLAR_LINEAR + cv2.WARP_FILL_OUTLIERS)
        p = cv2.resize(p, (12, 72), interpolation=cv2.INTER_AREA)
        p = (p - p.mean()) / (p.std() + .05)
        channels.append(p[:, 4:])  # Il chip centrale non decide la forma della lama.
    return np.array(histograms), np.array(channels)


def distance(a, b):
    # Restituisce due distanze distinte, non una somma dominata dal colore.
    color = np.sqrt(np.maximum(0, 1 - np.sqrt(a[0] * b[0]).sum(axis=1))).mean()
    structure = min(np.mean((a[1] - np.roll(b[1], shift, axis=1)) ** 2)
                    for shift in range(0, 72, 2)) / 4
    return float(structure), float(color)


def references(catalog):
    refs = []
    for p in catalog['parts'].values():
        if p.get('category') != 'blade' or not p.get('image', {}).get('file'):
            continue
        path = PARTS / p['image']['file']
        if path.exists():
            refs.append({'blade': p['id'], 'file': path, 'kind': 'part', 'variant': None})
    for v in catalog['variants']:
        path = DATA / f"sources/{v['id']}.json"
        downloaded = []
        if path.exists():
            for image in read(path)['images']:
                if image.get('file') and (DATA / image['file']).exists():
                    downloaded.append(image['file'])
                    refs.append({'blade': visual_identity(catalog['assemblies'][v['assembly']]['parts']), 'file': DATA / image['file'],
                                 'kind': 'product', 'variant': v['id']})
        # Un CX resta nei candidati anche se il CDN non ha fornito la foto montata.
        # Il fallback è dichiarato come singolo componente, non come foto del prodotto.
        b = catalog['assemblies'][v['assembly']]
        if not downloaded and not b['parts'].get('blade'):
            main = catalog['parts'].get(b['parts'].get('mainBlade'), {})
            filename = main.get('image', {}).get('file')
            if filename and (PARTS / filename).exists():
                refs.append({'blade': visual_identity(b['parts']), 'file': PARTS / filename,
                             'kind': 'cx-component', 'variant': v['id']})
    for ref in refs:
        with Image.open(ref['file']) as im:
            ref['features'] = features(im, reference=True)
    return refs


def rank(crop, refs):
    f = features(crop)
    measured = [(distance(f, r['features']), i, r) for i, r in enumerate(refs)]
    # Fasce di compatibilità della forma fissate prima del test; il colore ordina
    # solo immagini nella stessa fascia. Non può promuovere una forma lontana.
    scored = sorted(measured, key=lambda x: (math.floor(x[0][0] / .04), x[0][1], x[0][0], x[1]))
    unique = {}
    for (shape, color), _, ref in scored:
        if ref['blade'] not in unique:
            unique[ref['blade']] = {'blade': ref['blade'], 'shapeDistance': round(shape, 5),
                                    'shapeBand': math.floor(shape / .04), 'colorDistance': round(color, 5),
                                    'reference': str(ref['file']), 'variantHint': ref['variant']}
    return list(unique.values())


def thumbnail(image, size=(180, 180)):
    im = image.convert('RGBA')
    im.thumbnail(size, Image.Resampling.LANCZOS)
    bg = Image.new('RGB', size, 'white')
    bg.paste(im, ((size[0] - im.width) // 2, (size[1] - im.height) // 2), im)
    return bg


def embed(image, max_size=(1400, 1400)):
    rgba = image.convert('RGBA')
    im = Image.new('RGB', rgba.size, 'white')
    im.paste(rgba, mask=rgba.getchannel('A'))
    im.thumbnail(max_size, Image.Resampling.LANCZOS)
    stream = io.BytesIO()
    im.save(stream, format='JPEG', quality=89)
    return 'data:image/jpeg;base64,' + base64.b64encode(stream.getvalue()).decode()


def make_atlas(catalog, out):
    parts = [p for p in catalog['parts'].values() if p.get('category') == 'blade' and p.get('image')]
    cell_w, cell_h = 216, 242
    atlas = Image.new('RGB', (cell_w * 7, cell_h * math.ceil(len(parts) / 7)), '#eeeeee')
    d = ImageDraw.Draw(atlas)
    for i, p in enumerate(parts):
        x, y = (i % 7) * cell_w, (i // 7) * cell_h
        path = PARTS / p['image']['file']
        if path.exists():
            with Image.open(path) as im:
                atlas.paste(thumbnail(im, (210, 210)), (x, y))
        d.text((x + 4, y + 215), p['id'], fill='black', font=font(12))
    atlas.save(out / 'atlas.jpg')
    cx = [p for p in catalog['parts'].values()
          if p.get('category') in ('lockChip', 'mainBlade', 'assistBlade', 'overBlade') and p.get('image')]
    if cx:
        atlas = Image.new('RGB', (cell_w * 7, cell_h * math.ceil(len(cx) / 7)), '#eeeeee')
        d = ImageDraw.Draw(atlas)
        for i, p in enumerate(cx):
            x, y = (i % 7) * cell_w, (i // 7) * cell_h
            path = PARTS / p['image']['file']
            if path.exists():
                with Image.open(path) as im:
                    atlas.paste(thumbnail(im, (210, 210)), (x, y))
            d.text((x + 4, y + 215), f"{p['category']}: {p['id']}", fill='black', font=font(12))
        atlas.save(out / 'atlas-cx.jpg')


def run(image_path, fixture_path, out):
    out.mkdir(parents=True, exist_ok=True)
    catalog = build_catalog()
    write(out / 'catalog.json', catalog)
    fixture = read(fixture_path)
    image = ImageOps.exif_transpose(Image.open(image_path)).convert('RGB')
    image.save(out / 'source.jpg', quality=95)
    make_atlas(catalog, out)
    refs = references(catalog)
    if not refs:
        raise ValueError('Nessuna immagine di riferimento disponibile')
    rows, metrics = [], []
    annotated = image.copy()
    draw = ImageDraw.Draw(annotated)
    comparisons = Image.new('RGB', (1100, 270 * len(fixture['objects'])), '#eeeeee')
    for i, (obj, box, crop) in enumerate(crop_boxes(image, fixture)):
        crop.save(out / f"crop-{obj['id']}.jpg", quality=95)
        candidates = rank(crop, refs)  # Nessuna review/etichetta entra in questo calcolo.
        review = obj.get('review')
        result = stock_result(catalog, review['variant']) if review else None
        expected = result['identity'] if result else None
        place = next((i + 1 for i, c in enumerate(candidates) if c['blade'] == expected), None)
        row = {'id': obj['id'], 'box': list(box), 'position': obj.get('position'),
               'candidates': candidates[:8], 'review': review, 'result': result,
               'reviewedBladeRank': place,
               'ownerConfirmed': (obj.get('ownerConfirmedIdentity') or obj.get('ownerConfirmedBlade')) == expected if expected else False}
        rows.append(row)
        if result:
            metrics.append({'id': obj['id'], 'blade': expected, 'rank': place})
        draw.rectangle(box, outline='#00ffff', width=5)
        draw.rectangle((box[0], box[1] - 2, box[0] + 58, box[1] + 42), fill='#003840')
        draw.text((box[0] + 5, box[1]), obj['id'], fill='white', font=font(32))
        comparisons.paste(thumbnail(crop, (235, 235)), (0, i * 270))
        cd = ImageDraw.Draw(comparisons)
        cd.text((5, i * 270 + 240), f"Foto {obj['id']}", fill='black', font=font(16))
        for j, c in enumerate(candidates[:4]):
            with Image.open(c['reference']) as im:
                comparisons.paste(thumbnail(im, (210, 210)), (250 + j * 212, i * 270))
            cd.text((250 + j * 212, i * 270 + 216), c['blade'], fill='black', font=font(12))
    annotated.save(out / 'annotated.jpg', quality=92)
    comparisons.save(out / 'candidates.jpg', quality=92)
    n = len(metrics)
    report = {'case': fixture['id'], 'imageSha256': digest(image_path),
              'method': 'Forma prima del colore; ranking locale automatico + revisione visiva esplicita di Codex',
              'validation': fixture.get('validation'), 'catalogVersion': catalog['sourceVersion'],
              'counts': {'products': len(catalog['products']), 'assemblies': len(catalog['assemblies']),
                         'bladeReferences': len({r['blade'] for r in refs}), 'images': len(refs)},
              'developmentBenchmark': {'provisionalLabels': sum(not r['ownerConfirmed'] for r in rows),
                                       'labels': n, 'ownerConfirmedLabels': sum(r['ownerConfirmed'] for r in rows),
                                       'top1': sum(m['rank'] == 1 for m in metrics),
                                       'top5': sum(m['rank'] is not None and m['rank'] <= 5 for m in metrics),
                                       'details': metrics, 'independentTest': False},
              'objects': rows}
    write(out / 'results.json', report)
    render(report, catalog, image, annotated, out)
    print(json.dumps({'out': str(out), 'counts': report['counts'],
                      'baselineTop1': report['developmentBenchmark']['top1'],
                      'baselineTop5': report['developmentBenchmark']['top5'],
                      'labels': n,
                      'ownerConfirmedLabels': report['developmentBenchmark']['ownerConfirmedLabels'],
                      'provisionalLabels': report['developmentBenchmark']['provisionalLabels']}, ensure_ascii=True))
    return report


def render(report, catalog, image, annotated, out):
    esc = lambda x: html.escape(str(x or ''))
    cards = []
    for row in report['objects']:
        r = row['result']
        crop = Image.open(out / f"crop-{row['id']}.jpg")
        if not r:
            cards.append(f'<article><h2>{esc(row["id"])} — da rivedere</h2><img src="{embed(crop)}"></article>')
            continue
        variant = next(v for v in catalog['variants'] if v['id'] == r['variant'])
        part = catalog['parts'][r['stockParts']['blade'] or r['stockParts']['mainBlade']]
        ref_path = PARTS / part['image']['file']
        reference_label = 'Riferimento della lama base (può avere un colore diverso)'
        if not r['stockParts']['blade']:
            reference_label = 'Riferimento della sola main blade; lock chip e assist blade sono separati'
        snapshot_path = DATA / f"sources/{r['variant']}.json"
        snapshot = read(snapshot_path) if snapshot_path.exists() else None
        if snapshot:
            downloaded = [DATA / i['file'] for i in snapshot['images'] if i.get('file')]
            if downloaded:
                ref_path = downloaded[0]
                reference_label = 'Riferimento del prodotto nella variante proposta'
        ref = Image.open(ref_path)
        offers = '<br>'.join(esc(f"{o['manufacturer'].upper()} {o['code']}"
                                + (f"-{o['variant']}" if o.get('variant') else '')
                                + (f" · {o['packName']}" if o.get('packName') else '')
                                + (f" · {o['nota']}" if o.get('nota') else '')) for o in r['commercialCandidates'])
        parts = r['stockParts']
        cx_parts = ' · '.join(f"{k}: {esc(catalog['parts'].get(parts.get(k), {}).get('names', {}).get('tt'))}"
                              for k in ('lockChip', 'mainBlade', 'assistBlade', 'overBlade') if parts.get(k))
        alternatives = ''.join(f"<p><b>Alternativa con la stessa lama:</b> {esc(a['name'])} · Ratchet {esc(a['stockParts']['ratchet'])}"
                               f" · Bit {esc(catalog['parts'].get(a['stockParts']['bit'], {}).get('names', {}).get('tt'))}.</p>"
                               for a in r['alternativeStockProducts'])
        ambiguity = '<p><b>Combinazione di vendita da distinguere tra i due prodotti.</b></p>' if r['stockAmbiguous'] else ''
        cards.append(f'''<article id="obj-{row['id']}"><h2>{esc(row['id'])} · {esc(r['name'])}</h2>
          <p>{esc(row['position'])} · Confidenza visiva: <b>{esc(row['review']['confidence'])}</b></p>
          <div class="photos"><figure><img src="{embed(crop)}"><figcaption>Ritaglio della foto</figcaption></figure>
          <figure><img src="{embed(ref)}"><figcaption>{reference_label}</figcaption></figure></div>
          <p><b>{esc(r['preferredCode'])}{('-' + esc(r['variantNumber'])) if r['variantNumber'] else ''}</b>
          · Ratchet <b>{esc(parts['ratchet'])}</b> · Bit <b>{esc(r['bitName'])} ({esc(r['bitCode'])})</b></p>
          {f'<p>{cx_parts}</p>' if cx_parts else ''}
          {alternatives}{ambiguity}
          <p>{esc(row['review']['reason'])}</p>
          <p><a href="{esc(r['source']['url'])}">Scheda prodotto wiki</a> ·
          <a href="{esc(r['officialUrl'])}">Fonte del prodotto candidato</a></p>
          <details><summary>Confezioni e uscite della stessa combinazione</summary><p>{offers}</p>
          <p>L’elenco comprende anche ricolorazioni: il codice principale sopra indica il candidato coerente con la variante proposta.
          Produttore e confezione d’origine restano da confermare.</p></details>
          <p class="small">Revisione wiki {esc(snapshot['revid'] if snapshot else r['source']['revid'])} ·
          Baseline: identità al posto {esc(row['reviewedBladeRank'])} · {'Modello confermato dall’utente.' if row['ownerConfirmed'] else 'Proposta in attesa di conferma.'}</p></article>''')
    bench = report['developmentBenchmark']
    page = f'''<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
      <title>Beyblade X · prova di riconoscimento</title><style>
      body{{font:16px/1.5 system-ui,sans-serif;background:#f2f5f7;color:#172f3a;margin:0}}main{{max-width:1180px;margin:auto;padding:24px}}
      h1{{font-size:32px}}.banner,article{{background:white;border-radius:14px;padding:22px;margin:18px 0}}
      .grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px}}.grid article{{margin:0}}
      .overview{{width:100%;max-height:900px;object-fit:contain}}.photos{{display:flex;gap:12px}}
      figure{{margin:0;width:50%}}figure img{{width:100%;height:205px;object-fit:contain;background:#f7f7f7}}
      figcaption,.small{{font-size:13px;color:#526874}}a{{color:#006a85}}summary{{cursor:pointer}}h2{{font-size:21px}}
      </style><main><h1>Dieci prodotti dalla foto</h1><div class="banner">
      <p>Ogni ritaglio è collegato a una combinazione commerciale completa. Ratchet e bit provengono dalla scheda del prodotto riconosciuto.</p>
      <p>Modelli confermati dall’utente: {bench['ownerConfirmedLabels']}/{bench['labels']}. {esc(report['validation'])} La combinazione di vendita non certifica eventuali parti cambiate dal proprietario;
      una vista superiore può lasciare indistinguibili confezioni Takara Tomy e Hasbro equivalenti.</p>
      <p>Catalogo: <b>{report['counts']['products']} prodotti / {report['counts']['assemblies']} Beyblade</b>.
      Baseline automatica: <b>{bench['top1']}/{bench['labels']}</b> identità al primo posto,
      <b>{bench['top5']}/{bench['labels']}</b> nei primi cinque. Confronto sul campione di sviluppo; non è un test su foto nuove.</p></div>
      <img class="overview" src="{embed(annotated, (1700,1700))}" alt="Foto con dieci riquadri numerati">
      <div class="grid">{''.join(cards)}</div>
      <p class="small">Fonti: Beyblade Wiki/Fandom (autori e licenza nelle pagine immagine e nei metadati salvati);
      catalogo locale delle parti; pagine ufficiali Takara Tomy. Le immagini non vengono inviate ad API LLM esterne.</p></main></html>'''
    (out / 'report.html').write_text(page, encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    idx = sub.add_parser('index', help='Deriva il database parallelo completo dai cataloghi esistenti')
    idx.add_argument('--out', type=Path, default=ROOT / 'tmp/recognition/catalog.json')
    query = sub.add_parser('lookup', help='Trova tutti i prodotti corrispondenti alla lama riconosciuta')
    query.add_argument('--part', required=True, help='ID, nome TT, Hasbro o alias della lama')
    query.add_argument('--color', help='Colore come annotato dalla wiki, per esempio orange o green')
    query.add_argument('--maker', choices=('tt', 'hasbro'))
    query.add_argument('--out', type=Path)
    test = sub.add_parser('run', help='Ritaglia, cerca candidati, risolve le review presenti e produce il report')
    test.add_argument('--image', type=Path, required=True)
    test.add_argument('--regions', type=Path, default=DATA / 'test-photo-01.json')
    test.add_argument('--out', type=Path, default=ROOT / 'tmp/recognition/test-photo-01')
    args = parser.parse_args()
    if args.command == 'index':
        c = build_catalog()
        write(args.out, c)
        print(json.dumps({k: len(c[k]) for k in ('parts', 'products', 'assemblies', 'offers', 'variants')}))
    elif args.command == 'lookup':
        result = lookup(build_catalog(), args.part, args.color, args.maker)
        if args.out:
            write(args.out, result)
        print(json.dumps(result, ensure_ascii=True, indent=2))
    else:
        run(args.image, args.regions, args.out)


if __name__ == '__main__':
    main()
