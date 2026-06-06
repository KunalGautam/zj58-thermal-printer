const assert = require('assert');
const EscPosEncoder = require('./encoder');
const { processImage } = require('./processor');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');


// Helper to check byte prefix match
function hasBytesAt(buffer, offset, bytes) {
  for (let i = 0; i < bytes.length; i++) {
    if (buffer[offset + i] !== bytes[i]) return false;
  }
  return true;
}

console.log('=== Running ESC/POS Encoder Tests ===');

try {
  // Test 1: Initialization and Alignment
  const enc1 = new EscPosEncoder();
  enc1.init().align('center');
  const buf1 = enc1.getBuffer();
  // ESC @ is [0x1B, 0x40]
  // ESC a 1 is [0x1B, 0x61, 0x01]
  assert.deepStrictEqual(buf1.slice(0, 2), Buffer.from([0x1B, 0x40]));
  assert.deepStrictEqual(buf1.slice(2, 5), Buffer.from([0x1B, 0x61, 0x01]));
  console.log('✔ Test 1 passed: Init & Align bytes match.');

  // Test 2: Formatting switches
  const enc2 = new EscPosEncoder();
  enc2.bold(true).underline(true).inverse(true).fontSize('double-size');
  const buf2 = enc2.getBuffer();
  // Bold: [0x1B, 0x45, 0x01]
  // Underline: [0x1B, 0x2D, 0x01]
  // Inverse: [0x1D, 0x42, 0x01]
  // Size (double-size / 2x2): [0x1D, 0x21, 0x11]
  assert.deepStrictEqual(buf2.slice(0, 3), Buffer.from([0x1B, 0x45, 0x01]));
  assert.deepStrictEqual(buf2.slice(3, 6), Buffer.from([0x1B, 0x2D, 0x01]));
  assert.deepStrictEqual(buf2.slice(6, 9), Buffer.from([0x1D, 0x42, 0x01]));
  assert.deepStrictEqual(buf2.slice(9, 12), Buffer.from([0x1D, 0x21, 0x11]));
  console.log('✔ Test 2 passed: Text formatting bytes match.');

  // Test 3: Barcodes
  const enc3 = new EscPosEncoder();
  enc3.barcode('12345678', 'CODE128', { width: 3, height: 75, hri: 'below' });
  const buf3 = enc3.getBuffer();
  // Width: [0x1D, 0x77, 0x03]
  // Height: [0x1D, 0x68, 0x4B] (75 is 0x4B)
  // HRI below: [0x1D, 0x48, 0x02]
  // Barcode start: [0x1D, 0x6B, 73, length]
  assert.deepStrictEqual(buf3.slice(0, 3), Buffer.from([0x1D, 0x77, 0x03]));
  assert.deepStrictEqual(buf3.slice(3, 6), Buffer.from([0x1D, 0x68, 75]));
  assert.deepStrictEqual(buf3.slice(6, 9), Buffer.from([0x1D, 0x48, 0x02]));
  assert.deepStrictEqual(buf3.slice(9, 11), Buffer.from([0x1D, 0x6B]));
  assert.strictEqual(buf3[11], 73); // CODE128 System B byte
  console.log('✔ Test 3 passed: Barcode configuration bytes match.');

  // Test 4: QR Codes
  const enc4 = new EscPosEncoder();
  enc4.qrCode('http://test', { size: 5, ecc: 'Q' });
  const buf4 = enc4.getBuffer();
  // Set Model: [0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 50, 0]
  // Set Size: [0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 5]
  // Set ECC (Q = 50): [0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 50]
  assert.deepStrictEqual(buf4.slice(0, 9), Buffer.from([0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 50, 0]));
  assert.deepStrictEqual(buf4.slice(9, 17), Buffer.from([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 5]));
  assert.deepStrictEqual(buf4.slice(17, 25), Buffer.from([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 50]));
  console.log('✔ Test 4 passed: QR Code configuration bytes match.');

  // Test 5: Composite Text
  const enc5 = new EscPosEncoder();
  enc5.init()
    .align('center').bold(true).text('Title\n')
    .align('left').bold(false).text('Body\n');
  const buf5 = enc5.getBuffer();
  const bufStr5 = buf5.toString('ascii');
  assert(bufStr5.includes('Title'));
  assert(bufStr5.includes('Body'));
  console.log('✔ Test 5 passed: Composite text compilation matches expected segments.');

} catch (err) {
  console.error('✖ ESC/POS Encoder tests failed:', err);
  process.exit(1);
}

console.log('\n=== Running Image Processing Dither Tests ===');

(async () => {
  try {
    const Jimp = require('jimp');
    const image = await new Promise((resolve) => {
      new Jimp(10, 10, 0xFFFFFFFF, (err, img) => {
        // Draw a simple dark rectangle inside
        for (let x = 2; x < 8; x++) {
          for (let y = 2; y < 8; y++) {
            img.setPixelColor(0x222222FF, x, y); // dark gray
          }
        }
        resolve(img);
      });
    });

    const pngBuffer = await image.getBufferAsync(Jimp.MIME_PNG);

    const testAlgorithms = ['threshold', 'bayer', 'halftone', 'floyd-steinberg', 'atkinson'];

    for (const alg of testAlgorithms) {
      const result = await processImage(pngBuffer, {
        brightness: 10,
        contrast: 20,
        dither: alg
      });

      assert.strictEqual(result.width, 384); // Auto-resized to printer width
      assert.strictEqual(result.bytesPerRow, 48); // 384 / 8
      assert(result.buffer.length > 0);
      assert(result.monoBase64.startsWith('data:image/png;base64,'));
      console.log(`✔ Dither Algorithm "${alg}" processed successfully.`);
    }

    console.log('\n=== Running Image-based QR/Barcode Command Verification Tests ===');

    // Test 6: Image-based QR Code generation
    const qrWidth = 160;
    const qrPngBuffer = await QRCode.toBuffer('http://test', {
      type: 'png',
      margin: 1,
      width: qrWidth,
      errorCorrectionLevel: 'M'
    });
    const qrProcessed = await processImage(qrPngBuffer, {
      brightness: 0,
      contrast: 0,
      dither: 'threshold'
    });
    const enc6 = new EscPosEncoder();
    enc6.init().image(qrProcessed.buffer, qrProcessed.width, qrProcessed.height);
    const buf6 = enc6.getBuffer();
    // Ensure command buffer has init [0x1B, 0x40] followed by image command [0x1D, 0x76, 0x30, 0x00]
    assert.deepStrictEqual(buf6.slice(0, 2), Buffer.from([0x1B, 0x40]));
    assert.deepStrictEqual(buf6.slice(2, 6), Buffer.from([0x1D, 0x76, 0x30, 0x00]));
    console.log('✔ Test 6 passed: Image-based QR Code outputs GS v 0 command.');

    // Test 7: Image-based Barcode generation
    const barcodePngBuffer = await bwipjs.toBuffer({
      bcid: 'code128',
      text: '12345678',
      scale: 2,
      height: 10,
      includetext: true,
      textxalign: 'center',
    });
    const bcProcessed = await processImage(barcodePngBuffer, {
      brightness: 0,
      contrast: 0,
      dither: 'threshold'
    });
    const enc7 = new EscPosEncoder();
    enc7.init().image(bcProcessed.buffer, bcProcessed.width, bcProcessed.height);
    const buf7 = enc7.getBuffer();
    assert.deepStrictEqual(buf7.slice(0, 2), Buffer.from([0x1B, 0x40]));
    assert.deepStrictEqual(buf7.slice(2, 6), Buffer.from([0x1D, 0x76, 0x30, 0x00]));
    console.log('✔ Test 7 passed: Image-based Barcode outputs GS v 0 command.');

    console.log('\n=== All Automated Verification Tests Passed Successfully! ===');
    process.exit(0);

  } catch (err) {
    console.error('✖ Image Dither tests failed:', err);
    process.exit(1);
  }
})();
