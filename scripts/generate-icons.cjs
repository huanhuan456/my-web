const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

async function main() {
  const directory = path.join(__dirname, "..", "icons");
  await fs.mkdir(directory, { recursive: true });
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#31745f"/><text x="256" y="266" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="198" fill="#ffffff">+1</text></svg>');
  for (const [name, size] of [["icon-192", 192], ["icon-512", 512], ["icon-maskable-512", 512], ["apple-touch-icon", 180]]) {
    await sharp(svg).resize(size, size).png().toFile(path.join(directory, `${name}.png`));
  }
  console.log("Generated 192px, 512px, maskable and Apple touch PNG icons.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
