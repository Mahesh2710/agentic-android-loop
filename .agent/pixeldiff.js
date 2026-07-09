#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('Usage: node pixeldiff.js <screenshot> <figma_export> <output_diff>');
  process.exit(1);
}

const [screenshotPath, figmaPath, outputPath] = args;

function loadPNG(filePath) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(new PNG())
      .on('parsed', function () { resolve(this); })
      .on('error', reject);
  });
}

async function diff() {
  try {
    const [img1, img2] = await Promise.all([
      loadPNG(screenshotPath),
      loadPNG(figmaPath)
    ]);

    const width  = Math.max(img1.width,  img2.width);
    const height = Math.max(img1.height, img2.height);
    const output = new PNG({ width, height });

    const mismatch = pixelmatch(
      img1.data, img2.data, output.data,
      width, height,
      { threshold: 0.1, includeAA: false }
    );

    const totalPixels  = width * height;
    const matchPercent = ((totalPixels - mismatch) / totalPixels * 100).toFixed(2);

    // Save diff image
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    output.pack().pipe(fs.createWriteStream(outputPath));

    // Output result as JSON for Claude Code to read
    const result = {
      matchPercent: parseFloat(matchPercent),
      mismatchPixels: mismatch,
      totalPixels,
      passed: parseFloat(matchPercent) >= 95,
      diffImagePath: outputPath,
      dimensions: { width, height }
    };

    console.log(JSON.stringify(result, null, 2));

    process.exit(result.passed ? 0 : 1);

  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}

diff();