#!/usr/bin/env node
/**
 * Generate PNG and ICO icons from SVG source.
 * Run: node scripts/generate-icons.cjs
 */

const fs = require('fs');
const path = require('path');

const SVG_SOURCE = path.join(__dirname, '../resources/icon.svg');
const PNG_OUTPUT = path.join(__dirname, '../resources/icon.png');
const ICO_OUTPUT = path.join(__dirname, '../resources/icon.ico');
const SIZES = [16, 32, 48, 64, 128, 256, 512];

// Check if sharp is available
async function ensureSharp() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (err) {
    console.error('sharp not found. Please install it first:');
    console.error('  pnpm add -D sharp');
    process.exit(1);
  }
  return sharp;
}

// PNG generator using sharp
async function generatePNG() {
  const sharp = await ensureSharp();

  // Generate the largest size (512x512) for the main PNG
  await sharp(SVG_SOURCE)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(PNG_OUTPUT);

  console.log(`Generated PNG: ${PNG_OUTPUT}`);
}

// ICO generator using png-to-ico
async function generateICO() {
  const sharp = await ensureSharp();

  // Generate multiple sizes for ICO
  const sizes = [16, 32, 48, 256];
  const pngBuffers = await Promise.all(
    sizes.map(size =>
      sharp(SVG_SOURCE)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
    )
  );

  // Simple ICO header + directory + data
  const ICO_HEADER_SIZE = 6;
  const ICO_DIR_SIZE = 16;

  const bufferSize = ICO_HEADER_SIZE + (ICO_DIR_SIZE * sizes.length) +
    pngBuffers.reduce((sum, buf) => sum + buf.length, 0);
  const icoBuffer = Buffer.allocUnsafe(bufferSize);

  let offset = ICO_HEADER_SIZE + (ICO_DIR_SIZE * sizes.length);

  // Write ICO header
  icoBuffer.writeUInt16LE(0, 0); // Reserved
  icoBuffer.writeUInt16LE(1, 2); // Type: 1 = ICO
  icoBuffer.writeUInt16LE(sizes.length, 4); // Number of images

  // Write directory entries
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];
    const buf = pngBuffers[i];

    icoBuffer.writeUInt8(size === 256 ? 0 : size, ICO_HEADER_SIZE + (i * ICO_DIR_SIZE)); // Width
    icoBuffer.writeUInt8(size === 256 ? 0 : size, ICO_HEADER_SIZE + (i * ICO_DIR_SIZE) + 1); // Height
    icoBuffer.writeUInt8(0, ICO_HEADER_SIZE + (i * ICO_DIR_SIZE) + 2); // Color palette
    icoBuffer.writeUInt8(0, ICO_HEADER_SIZE + (i * ICO_DIR_SIZE) + 3); // Reserved
    icoBuffer.writeUInt16LE(1, ICO_HEADER_SIZE + (i * ICO_DIR_SIZE) + 4); // Color planes
    icoBuffer.writeUInt16LE(32, ICO_HEADER_SIZE + (i * ICO_DIR_SIZE) + 6); // Bits per pixel
    icoBuffer.writeUInt32LE(buf.length, ICO_HEADER_SIZE + (i * ICO_DIR_SIZE) + 8); // Size
    icoBuffer.writeUInt32LE(offset, ICO_HEADER_SIZE + (i * ICO_DIR_SIZE) + 12); // Offset

    offset += buf.length;
  }

  // Write image data
  offset = ICO_HEADER_SIZE + (ICO_DIR_SIZE * sizes.length);
  for (const buf of pngBuffers) {
    buf.copy(icoBuffer, offset);
    offset += buf.length;
  }

  fs.writeFileSync(ICO_OUTPUT, icoBuffer);
  console.log(`Generated ICO: ${ICO_OUTPUT}`);
}

// Main execution
async function main() {
  console.log('Generating icons from SVG...');

  if (!fs.existsSync(SVG_SOURCE)) {
    console.error(`SVG source not found: ${SVG_SOURCE}`);
    process.exit(1);
  }

  try {
    await generatePNG();
    await generateICO();
    console.log('Icon generation complete!');
  } catch (err) {
    console.error('Error generating icons:', err);
    process.exit(1);
  }
}

main();
