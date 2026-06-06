/**
 * Helper class to compile formatted instructions into raw ESC/POS byte commands
 */
class EscPosEncoder {
  constructor() {
    this.buffer = [];
  }

  /**
   * Append raw bytes, arrays, or ASCII string to the buffer
   */
  write(bytes) {
    if (Buffer.isBuffer(bytes)) {
      this.buffer.push(bytes);
    } else if (Array.isArray(bytes)) {
      this.buffer.push(Buffer.from(bytes));
    } else if (typeof bytes === 'string') {
      this.buffer.push(Buffer.from(bytes, 'ascii'));
    }
    return this;
  }

  /**
   * Initialize printer (clears buffers, sets defaults)
   */
  init() {
    return this.write([0x1B, 0x40]);
  }

  /**
   * Align text/graphics: 'left', 'center', 'right'
   */
  align(type) {
    let val = 0; // Left
    if (type === 'center' || type === 'ct') val = 1;
    if (type === 'right' || type === 'rt') val = 2;
    return this.write([0x1B, 0x61, val]);
  }

  /**
   * Toggle bold font
   */
  bold(enable) {
    return this.write([0x1B, 0x45, enable ? 1 : 0]);
  }

  /**
   * Toggle underline (1-dot thin line)
   */
  underline(enable) {
    return this.write([0x1B, 0x2D, enable ? 1 : 0]);
  }

  /**
   * Toggle inverse (white-on-black) print mode
   */
  inverse(enable) {
    return this.write([0x1D, 0x42, enable ? 1 : 0]);
  }

  /**
   * Toggle emphasized strike-through print
   */
  emphasized(enable) {
    return this.write([0x1B, 0x47, enable ? 1 : 0]);
  }

  /**
   * Set font sizes (double width, height, double size, etc.)
   */
  fontSize(size) {
    let byteVal = 0x00; // Normal Font Size
    if (size === 'double-width') {
      byteVal = 0x10;
    } else if (size === 'double-height') {
      byteVal = 0x01;
    } else if (size === 'double-size' || size === 'large' || size === '2x') {
      byteVal = 0x11;
    } else if (size === '3x') {
      byteVal = 0x22;
    } else if (size === '4x') {
      byteVal = 0x33;
    }
    return this.write([0x1D, 0x21, byteVal]);
  }

  /**
   * Set custom line spacing in printer dots
   * ZJ-58 standard: ESC 3 n sets spacing to n/180 inch
   * Pass undefined to revert to default 30 dots (ESC 2)
   */
  lineSpacing(dots) {
    if (dots === undefined) {
      return this.write([0x1B, 0x32]);
    } else {
      return this.write([0x1B, 0x33, Math.min(255, Math.max(0, dots))]);
    }
  }

  /**
   * Feeds the paper by n lines
   */
  feed(lines = 1) {
    return this.write([0x1B, 0x64, Math.min(255, Math.max(0, lines))]);
  }

  /**
   * Feed and cut command (requires automatic cutter support; feeds 4 lines and cuts)
   */
  cut() {
    return this.write([0x1D, 0x56, 66, 0]);
  }

  /**
   * Prints plain text
   */
  text(str) {
    return this.write(str);
  }

  /**
   * Word wrap helper that fits lines dynamically based on font size width scale
   */
  wrappedText(str, size = 'normal') {
    let maxChars = 32; // Font A max columns on ZJ-58 (384px wide)
    if (size === 'double-width' || size === 'double-size' || size === 'large' || size === '2x') {
      maxChars = 16;
    } else if (size === '3x') {
      maxChars = 10;
    } else if (size === '4x') {
      maxChars = 8;
    }

    const paragraphs = str.split('\n');
    const wrappedParagraphs = paragraphs.map(para => {
      if (!para.trim()) return '';
      const words = para.split(' ');
      const lines = [];
      let currentLine = '';

      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        
        if (word.length > maxChars) {
          if (currentLine) {
            lines.push(currentLine);
            currentLine = '';
          }
          let remaining = word;
          while (remaining.length > maxChars) {
            lines.push(remaining.substring(0, maxChars));
            remaining = remaining.substring(maxChars);
          }
          currentLine = remaining;
          continue;
        }

        const testLine = currentLine ? currentLine + ' ' + word : word;
        if (testLine.length <= maxChars) {
          currentLine = testLine;
        } else {
          lines.push(currentLine);
          currentLine = word;
        }
      }
      if (currentLine) {
        lines.push(currentLine);
      }
      return lines.join('\n');
    });

    return this.write(wrappedParagraphs.join('\n') + '\n');
  }

  /**
   * Generate ESC/POS commands for QR Code (Model 2)
   */
  qrCode(data, options = {}) {
    const size = options.size || 4; // 1 to 16 module size
    const ecc = options.ecc || 'M'; // L, M, Q, H
    
    const eccMap = { 'L': 48, 'M': 49, 'Q': 50, 'H': 51 };
    const eccByte = eccMap[ecc.toUpperCase()] || 49;
    
    const dataBuffer = Buffer.from(data, 'utf-8');
    const storeLength = dataBuffer.length + 3;
    const pL = storeLength & 0xFF;
    const pH = (storeLength >> 8) & 0xFF;

    // fn 65: Select QR Code Model (Model 2 = value 50)
    this.write([0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 50, 0]);
    // fn 67: Set module size (3..16 dots)
    this.write([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, size]);
    // fn 69: Set error correction level (L=48, M=49, Q=50, H=51)
    this.write([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, eccByte]);
    // fn 80: Store data in symbol storage area
    this.write([0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 48]);
    this.write(dataBuffer);
    // fn 81: Print symbol data in symbol storage area
    this.write([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 48]);
    
    return this;
  }

  /**
   * Generate ESC/POS commands for Barcodes (System B)
   */
  barcode(data, type = 'CODE128', options = {}) {
    const width = options.width || 3; // 2 to 6 dots width
    const height = options.height || 80; // 1 to 255 dots height
    const hri = options.hri || 'below'; // 'none', 'above', 'below', 'both'
    
    const hriMap = { 'none': 0, 'above': 1, 'below': 2, 'both': 3 };
    const hriByte = hriMap[hri] !== undefined ? hriMap[hri] : 2;

    const typeMap = {
      'UPCA': 65, 'UPC-A': 65,
      'UPCE': 66, 'UPC-E': 66,
      'EAN13': 67, 'EAN-13': 67,
      'EAN8': 68, 'EAN-8': 68,
      'CODE39': 69, 'CODE-39': 69,
      'ITF': 70,
      'CODABAR': 71,
      'CODE93': 72,
      'CODE128': 73, 'CODE-128': 73
    };

    const typeByte = typeMap[type.toUpperCase()] || 73;

    // Set barcode width (GS w n)
    this.write([0x1D, 0x77, width]);
    // Set barcode height (GS h n)
    this.write([0x1D, 0x68, height]);
    // Set HRI characters position (GS H n)
    this.write([0x1D, 0x48, hriByte]);

    let dataBuffer;
    if (typeByte === 73) {
      // CODE128: Prepend Code Set indicator {B (Hex: 0x7B, 0x42) if not already explicitly set
      if (!data.startsWith('{A') && !data.startsWith('{B') && !data.startsWith('{C')) {
        dataBuffer = Buffer.concat([Buffer.from([0x7B, 0x42]), Buffer.from(data, 'ascii')]);
      } else {
        dataBuffer = Buffer.from(data, 'ascii');
      }
    } else {
      dataBuffer = Buffer.from(data, 'ascii');
    }

    // System B Command: GS k m n d1...dn
    this.write([0x1D, 0x6B, typeByte, dataBuffer.length]);
    this.write(dataBuffer);

    return this;
  }

  /**
   * Generate ESC/POS commands to print a 1bpp raster bit-image (GS v 0)
   */
  image(packedBuffer, width, height) {
    const bytesPerRow = Math.ceil(width / 8);
    const xL = bytesPerRow & 0xFF;
    const xH = (bytesPerRow >> 8) & 0xFF;
    const yL = height & 0xFF;
    const yH = (height >> 8) & 0xFF;

    // GS v 0 m xL xH yL yH d1...dk
    // m = 0: Normal mode
    this.write([0x1D, 0x76, 0x30, 0, xL, xH, yL, yH]);
    this.write(packedBuffer);
    
    return this;
  }

  /**
   * Return the compiled Buffer of ESC/POS commands
   */
  getBuffer() {
    return Buffer.concat(this.buffer);
  }
}

module.exports = EscPosEncoder;
