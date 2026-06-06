const Jimp = require('jimp');

/**
 * Process an image buffer: resize, adjust brightness/contrast, apply dithering,
 * and format into packed 1bpp ESC/POS bytes.
 * 
 * @param {Buffer} imageBuffer - Image file buffer
 * @param {Object} options - { brightness, contrast, dither }
 * @returns {Promise<Object>} - { width, height, bytesPerRow, buffer, monoBase64 }
 */
async function processImage(imageBuffer, options = {}) {
  const brightness = options.brightness !== undefined ? Number(options.brightness) : 0; // -255 to 255
  const contrast = options.contrast !== undefined ? Number(options.contrast) : 0; // -100 to 100
  const dither = options.dither || 'floyd-steinberg';

  const image = await Jimp.read(imageBuffer);
  
  // ZJ-58 standard width is 384 pixels
  const targetWidth = 384;
  image.resize(targetWidth, Jimp.AUTO);
  
  const width = image.bitmap.width;
  const height = image.bitmap.height;
  
  // 1. Create a 2D float array of grayscale values with contrast/brightness applied
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = image.bitmap.data[idx];
      const g = image.bitmap.data[idx + 1];
      const b = image.bitmap.data[idx + 2];
      
      // Calculate luminance (ITU-R BT.601 standard)
      let gray = 0.299 * r + 0.587 * g + 0.114 * b;
      
      // Apply contrast
      if (contrast !== 0) {
        // contrast range is -100 to 100. Normalize to factor
        const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
        gray = factor * (gray - 128) + 128;
      }
      
      // Apply brightness
      gray += brightness;
      
      // Clamp to 0..255
      data[y * width + x] = Math.max(0, Math.min(255, gray));
    }
  }

  // 2. Perform selected Dithering Algorithm (yielding binary values: 1 = black, 0 = white)
  const binaryImage = new Uint8Array(width * height);

  if (dither === 'threshold') {
    for (let i = 0; i < data.length; i++) {
      binaryImage[i] = data[i] < 128 ? 1 : 0;
    }
  } else if (dither === 'bayer') {
    // 8x8 Bayer Ordered Dithering Matrix
    const bayer8x8 = [
      [ 0, 48, 12, 60,  3, 51, 15, 63],
      [32, 16, 44, 28, 35, 19, 47, 31],
      [ 8, 56,  4, 52, 11, 59,  7, 55],
      [40, 24, 36, 20, 43, 27, 39, 23],
      [ 2, 50, 14, 62,  1, 49, 13, 61],
      [34, 18, 46, 30, 33, 17, 45, 29],
      [10, 58,  6, 54,  9, 57,  5, 53],
      [42, 26, 38, 22, 41, 25, 37, 21]
    ];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Normalize 0..63 matrix values to 0..255
        const thresholdVal = ((bayer8x8[y % 8][x % 8] + 0.5) / 64) * 255;
        binaryImage[y * width + x] = data[y * width + x] < thresholdVal ? 1 : 0;
      }
    }
  } else if (dither === 'halftone') {
    // 4x4 Clustered Dot Halftone screening matrix
    const halftone4x4 = [
      [200,  80, 100, 220],
      [ 60,  10,  30, 140],
      [120,  40, 250, 180],
      [240, 160, 170, 130]
    ];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const thresholdVal = halftone4x4[y % 4][x % 4];
        binaryImage[y * width + x] = data[y * width + x] < thresholdVal ? 1 : 0;
      }
    }
  } else if (dither === 'floyd-steinberg') {
    // Floyd-Steinberg error diffusion
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const oldVal = data[y * width + x];
        const newVal = oldVal < 128 ? 0 : 255;
        binaryImage[y * width + x] = newVal === 0 ? 1 : 0;
        const err = oldVal - newVal;

        if (x + 1 < width) data[y * width + (x + 1)] += err * 7/16;
        if (y + 1 < height) {
          if (x - 1 >= 0) data[(y + 1) * width + (x - 1)] += err * 3/16;
          data[(y + 1) * width + x] += err * 5/16;
          if (x + 1 < width) data[(y + 1) * width + (x + 1)] += err * 1/16;
        }
      }
    }
  } else if (dither === 'atkinson') {
    // Atkinson error diffusion (preserves detail, keeps image lighter)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const oldVal = data[y * width + x];
        const newVal = oldVal < 128 ? 0 : 255;
        binaryImage[y * width + x] = newVal === 0 ? 1 : 0;
        const err = oldVal - newVal;
        const diffusedErr = err / 8; // Diffuse 1/8 to each neighbor

        if (x + 1 < width) data[y * width + (x + 1)] += diffusedErr;
        if (x + 2 < width) data[y * width + (x + 2)] += diffusedErr;
        if (y + 1 < height) {
          if (x - 1 >= 0) data[(y + 1) * width + (x - 1)] += diffusedErr;
          data[(y + 1) * width + x] += diffusedErr;
          if (x + 1 < width) data[(y + 1) * width + (x + 1)] += diffusedErr;
        }
        if (y + 2 < height) {
          data[(y + 2) * width + x] += diffusedErr;
        }
      }
    }
  }

  // 3. Pack 1bpp binary image (8 horizontal pixels per byte, MSB-first)
  const bytesPerRow = Math.ceil(width / 8);
  const buffer = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bitIdx = x % 8;
      const byteIdx = y * bytesPerRow + Math.floor(x / 8);
      if (binaryImage[y * width + x] === 1) {
        buffer[byteIdx] |= (1 << (7 - bitIdx));
      }
    }
  }

  // Generate base64 monochrome version for frontend display/verification
  const monoBase64 = await createMonoBase64(binaryImage, width, height);

  return {
    width,
    height,
    bytesPerRow,
    buffer,
    monoBase64
  };
}

/**
 * Encodes monochrome binary image array back to a PNG base64 string for previewing.
 */
async function createMonoBase64(binaryImage, width, height) {
  const image = await new Promise((resolve, reject) => {
    new Jimp(width, height, 0xFFFFFFFF, (err, img) => {
      if (err) reject(err);
      else resolve(img);
    });
  });
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (binaryImage[y * width + x] === 1) {
        // Draw black pixel: RGBA 0x000000FF
        image.setPixelColor(0x000000FF, x, y);
      }
    }
  }
  
  const buffer = await image.getBufferAsync(Jimp.MIME_PNG);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

module.exports = { processImage };
