// Genera public/og.png (1200x630) per Open Graph / Twitter card: sfondo scuro, badge X oro, titolo.
// Esegui: node scripts/gen-og.mjs
import sharp from 'sharp';
import { writeFileSync } from 'fs';

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#15161c"/>
      <stop offset="1" stop-color="#0b0c10"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f6c343"/>
      <stop offset="1" stop-color="#e0961d"/>
    </linearGradient>
    <linearGradient id="rail" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f6c343"/>
      <stop offset="1" stop-color="#e5484d"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="14" height="630" fill="url(#rail)"/>
  <rect x="96" y="150" width="120" height="120" rx="14" fill="url(#gold)"/>
  <text x="156" y="248" text-anchor="middle" font-family="Impact, 'Arial Black', Arial, sans-serif" font-size="96" font-style="italic" fill="#1a1204">X</text>
  <text x="248" y="222" font-family="Impact, 'Arial Black', Arial, sans-serif" font-size="82" fill="#f5f5f7" letter-spacing="1">BEYBLADE X</text>
  <text x="248" y="312" font-family="Impact, 'Arial Black', Arial, sans-serif" font-size="82" fill="url(#gold)" letter-spacing="1">COMBO FINDER</text>
  <text x="96" y="400" font-family="Arial, Helvetica, sans-serif" font-size="34" fill="#c9c9d1">Tournament-proven combos ranked by real results.</text>
  <text x="96" y="450" font-family="Arial, Helvetica, sans-serif" font-size="34" fill="#c9c9d1">Search by part, sort by top cuts or wins.</text>
  <text x="96" y="548" font-family="'Courier New', monospace" font-size="26" fill="#8a8a94" letter-spacing="3">BEYBLADEXCOMBOS.COM</text>
</svg>`;

const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
writeFileSync('public/og.png', png);
console.log('public/og.png', png.length, 'byte');
