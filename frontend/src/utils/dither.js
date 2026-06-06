/**
 * Frontend image processing and dithering algorithms.
 * These operate directly on HTML5 Canvas ImageData for real-time previewing.
 */

export function adjustBrightnessContrast(pixels, width, height, brightness, contrast) {
  const data = new Float32Array(width * height);
  const factor = (contrast !== 0)
    ? (259 * (contrast + 255)) / (255 * (259 - contrast))
    : 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];

      // Greyscale conversion (luminance)
      let gray = 0.299 * r + 0.587 * g + 0.114 * b;

      // Apply contrast
      if (contrast !== 0) {
        gray = factor * (gray - 128) + 128;
      }

      // Apply brightness
      gray += brightness;

      // Clamp and store
      data[y * width + x] = Math.max(0, Math.min(255, gray));
    }
  }
  return data;
}

export function applyDither(data, width, height, method) {
  const output = new Uint8Array(width * height); // 1 = black, 0 = white

  if (method === 'threshold') {
    for (let i = 0; i < data.length; i++) {
      output[i] = data[i] < 128 ? 1 : 0;
    }
  } else if (method === 'bayer') {
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
        const threshold = ((bayer8x8[y % 8][x % 8] + 0.5) / 64) * 255;
        output[y * width + x] = data[y * width + x] < threshold ? 1 : 0;
      }
    }
  } else if (method === 'halftone') {
    const halftone4x4 = [
      [200,  80, 100, 220],
      [ 60,  10,  30, 140],
      [120,  40, 250, 180],
      [240, 160, 170, 130]
    ];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const threshold = halftone4x4[y % 4][x % 4];
        output[y * width + x] = data[y * width + x] < threshold ? 1 : 0;
      }
    }
  } else if (method === 'floyd-steinberg') {
    // Copy working data
    const tempData = new Float32Array(data);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const oldVal = tempData[y * width + x];
        const newVal = oldVal < 128 ? 0 : 255;
        output[y * width + x] = newVal === 0 ? 1 : 0;
        const err = oldVal - newVal;

        if (x + 1 < width) tempData[y * width + (x + 1)] += err * 7/16;
        if (y + 1 < height) {
          if (x - 1 >= 0) tempData[(y + 1) * width + (x - 1)] += err * 3/16;
          tempData[(y + 1) * width + x] += err * 5/16;
          if (x + 1 < width) tempData[(y + 1) * width + (x + 1)] += err * 1/16;
        }
      }
    }
  } else if (method === 'atkinson') {
    const tempData = new Float32Array(data);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const oldVal = tempData[y * width + x];
        const newVal = oldVal < 128 ? 0 : 255;
        output[y * width + x] = newVal === 0 ? 1 : 0;
        const err = oldVal - newVal;
        const diffusedErr = err / 8;

        if (x + 1 < width) tempData[y * width + (x + 1)] += diffusedErr;
        if (x + 2 < width) tempData[y * width + (x + 2)] += diffusedErr;
        if (y + 1 < height) {
          if (x - 1 >= 0) tempData[(y + 1) * width + (x - 1)] += diffusedErr;
          tempData[(y + 1) * width + x] += diffusedErr;
          if (x + 1 < width) tempData[(y + 1) * width + (x + 1)] += diffusedErr;
        }
        if (y + 2 < height) {
          tempData[(y + 2) * width + x] += diffusedErr;
        }
      }
    }
  }

  return output;
}

/**
 * Helper to process source canvas and draw the monochrome dithered result on target canvas.
 */
export function ditherCanvas(srcCanvas, destCanvas, brightness, contrast, method) {
  const srcCtx = srcCanvas.getContext('2d');
  const destCtx = destCanvas.getContext('2d');

  const width = srcCanvas.width;
  const height = srcCanvas.height;

  destCanvas.width = width;
  destCanvas.height = height;

  const srcImgData = srcCtx.getImageData(0, 0, width, height);
  const adjustedData = adjustBrightnessContrast(srcImgData.data, width, height, brightness, contrast);
  const ditheredData = applyDither(adjustedData, width, height, method);

  const destImgData = destCtx.createImageData(width, height);
  for (let i = 0; i < ditheredData.length; i++) {
    const idx = i * 4;
    const isBlack = ditheredData[i] === 1;
    const color = isBlack ? 0 : 255; // 0 = black, 255 = white

    destImgData.data[idx] = color;     // R
    destImgData.data[idx + 1] = color; // G
    destImgData.data[idx + 2] = color; // B
    destImgData.data[idx + 3] = 255;   // A
  }

  destCtx.putImageData(destImgData, 0, 0);
}
