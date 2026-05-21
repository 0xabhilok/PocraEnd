const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'assets');

// SVG matching the uploaded icon: dark bg, rounded square, glowing teal "P."
const svg = (size) => {
  const r = Math.round(size * 0.16); // corner radius
  const fontSize = Math.round(size * 0.55);
  const dotSize = Math.round(size * 0.12);
  const pX = Math.round(size * 0.28);
  const dotX = Math.round(size * 0.64);
  const textY = Math.round(size * 0.68);

  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#1a2230"/>
      <stop offset="100%" stop-color="#0a0a0b"/>
    </radialGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="${Math.round(size * 0.025)}" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <linearGradient id="textGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00e5c4"/>
      <stop offset="100%" stop-color="#00ff88"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#bg)"/>
  <text
    x="${pX}" y="${textY}"
    font-size="${fontSize}"
    font-family="Arial,Helvetica,sans-serif"
    font-weight="bold"
    fill="url(#textGrad)"
    filter="url(#glow)"
  >P</text>
  <circle
    cx="${dotX}" cy="${textY - Math.round(size * 0.05)}"
    r="${dotSize / 2}"
    fill="url(#textGrad)"
    filter="url(#glow)"
  />
</svg>`;
};

async function main() {
  // Generate PNG at 512x512
  const png512 = await sharp(Buffer.from(svg(512))).png().toBuffer();
  fs.writeFileSync(path.join(OUT, 'icon.png'), png512);
  console.log('✓ assets/icon.png (512x512)');

  // Write a 256x256 PNG as temp input for png-to-ico (needs file path)
  const png256 = await sharp(Buffer.from(svg(256))).png().toBuffer();
  const tmp256 = path.join(OUT, '_tmp256.png');
  fs.writeFileSync(tmp256, png256);

  // png-to-ico v3 is ESM-only — load it with a dynamic import.
  const pngToIco = await import('png-to-ico');
  const icoBuffer = await pngToIco.default(tmp256);
  fs.writeFileSync(path.join(OUT, 'icon.ico'), icoBuffer);
  fs.unlinkSync(tmp256);
  console.log('✓ assets/icon.ico (multi-size)');

  // Also save 256 PNG for Chrome extension
  fs.writeFileSync(path.join(OUT, 'icon-256.png'), png256);
  console.log('✓ assets/icon-256.png');
}

main().catch(console.error);
