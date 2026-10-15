import unittest
from unittest.mock import patch
from PIL import Image

from recognize import build_catalog, crop_boxes, lookup, stock_result


class ProductRecognitionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = build_catalog()

    def test_scorpio_stock_anchored_to_official_product(self):
        r = stock_result(self.catalog, 'scorpio-spear-orange')
        self.assertEqual(r['name'], 'ScorpioSpear 0-70Z')
        self.assertEqual((r['stockParts']['ratchet'], r['stockParts']['bit']), ('0-70', 'zap'))
        self.assertEqual(r['bitCode'], 'Z')
        self.assertFalse(r['currentAssemblyVerified'])
        self.assertFalse(r['skuVerified'])

    def test_same_blade_different_stock_stays_ambiguous(self):
        r = lookup(self.catalog, 'Wizard Rod')
        stocks = {(c['stockParts']['ratchet'], c['stockParts']['bit']) for c in r['candidates']}
        self.assertIn(('5-70', 'disk-ball'), stocks)
        self.assertIn(('1-60', 'rush'), stocks)
        self.assertEqual(r['status'], 'ambiguous')

    def test_color_selects_product_not_first_release(self):
        r = lookup(self.catalog, 'Wand Wizard', 'green')
        self.assertEqual(r['status'], 'resolved_stock')
        self.assertEqual(r['candidates'][0]['stockParts']['bit'], 'rush')

    def test_hasbro_alias_and_package(self):
        r = lookup(self.catalog, 'Spear Scorpio', 'orange', 'hasbro')
        self.assertEqual(r['status'], 'resolved_stock')
        self.assertTrue(all(o['manufacturer'] == 'hasbro' and o['code'] == 'G2758'
                            for o in r['candidates'][0]['offers']))

    def test_unknown_name_or_color_does_not_invent_product(self):
        self.assertEqual(lookup(self.catalog, 'Non esiste')['status'], 'unresolved')
        self.assertEqual(lookup(self.catalog, 'Scorpio Spear', 'invisible')['status'], 'unresolved')
        with self.assertRaises(ValueError):
            stock_result(self.catalog, 'non-esiste')

    def test_shared_bx00_code_does_not_merge_assemblies(self):
        r = stock_result(self.catalog, 'driger-slash-white')
        self.assertEqual(r['stockParts']['ratchet'], '4-80')
        self.assertTrue(all(o['assembly'] == 'DrigerSlash 4-80P' for o in r['commercialCandidates']))

    def test_ghost_green_does_not_imply_wyvern_or_same_bit_for_hasbro(self):
        r = lookup(self.catalog, 'Ghost Circle', 'green')
        self.assertEqual(r['status'], 'ambiguous')
        combinations = {(c['stockParts']['ratchet'], c['stockParts']['bit']) for c in r['candidates']}
        self.assertIn(('4-60', 'hexa'), combinations)
        self.assertIn(('4-60', 'low-rush'), combinations)
        result = stock_result(self.catalog, 'ghost-circle-green')
        self.assertEqual(result['blade'], 'ghost-circle')
        self.assertTrue(result['stockAmbiguous'])

    def test_boxes_scale_and_reject_truncation(self):
        f = {'referenceSize': [100, 100], 'objects': [{'id': '01', 'box': [10, 20, 50, 60]}]}
        _, box, crop = next(crop_boxes(Image.new('RGB', (200, 200)), f))
        self.assertEqual(box, (20, 40, 100, 120))
        self.assertEqual(crop.size, (80, 80))
        f['objects'][0]['box'] = [10, 20, 110, 60]
        with self.assertRaises(ValueError):
            list(crop_boxes(Image.new('RGB', (200, 200)), f))

    def test_rhino_reaper_is_cx_product_with_stock_components(self):
        r = lookup(self.catalog, 'Rhino Reaper', 'blue')
        self.assertEqual(r['status'], 'resolved_stock')
        parts = r['candidates'][0]['stockParts']
        self.assertIsNone(parts['blade'])
        self.assertEqual((parts['lockChip'], parts['mainBlade'], parts['assistBlade']), ('rhino', 'reaper', 'charge'))
        self.assertEqual((parts['ratchet'], parts['bit']), ('4-55', 'dot'))
        self.assertEqual(r['candidates'][0]['identity'], 'cx:rhino/reaper')
        western = lookup(self.catalog, 'Reaper Rhino')
        self.assertEqual(western['candidates'][0]['assembly'], 'RhinoReaper C4-55D')

    def test_known_products_resolve_without_network(self):
        with patch('socket.socket', side_effect=AssertionError('Rete disabilitata')):
            catalog = build_catalog()
            for variant in catalog['variants']:
                self.assertTrue(stock_result(catalog, variant['id'])['name'])
            self.assertEqual(lookup(catalog, 'Rhino Reaper')['status'], 'resolved_stock')


if __name__ == '__main__':
    unittest.main()
