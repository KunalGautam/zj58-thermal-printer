const usb = require('usb');
const fs = require('fs');
const path = require('path');

function wrapText(text, max) {
  if (!text) return [];
  const words = text.split(' ');
  const lines = [];
  let current = '';
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word.length > max) {
      if (current) lines.push(current);
      lines.push(word.substring(0, max));
      current = word.substring(max);
      continue;
    }
    const test = current ? current + ' ' + word : word;
    if (test.length <= max) {
      current = test;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function padString(str, width, align) {
  const trimmed = (str || '').trim().substring(0, width - 4);
  const remaining = width - 4 - trimmed.length;
  if (align === 'center') {
    const left = Math.floor(remaining / 2);
    const right = remaining - left;
    return ' '.repeat(left + 2) + trimmed + ' '.repeat(right + 2);
  } else if (align === 'right') {
    return ' '.repeat(remaining + 2) + trimmed + ' '.repeat(2);
  } else {
    return ' '.repeat(2) + trimmed + ' '.repeat(remaining + 2);
  }
}

function parseEscPos(buffer) {
  const items = [];
  let i = 0;
  
  let currentAlign = 'left';
  let currentBold = false;
  let currentUnderline = false;
  let currentInverse = false;
  let currentSize = 'normal';
  let currentImageStrip = null; // Tracks ESC * strip accumulation for image rendering
  let textAccumulator = '';
  
  const flushText = () => {
    if (textAccumulator) {
      items.push({
        type: 'text',
        text: textAccumulator,
        align: currentAlign,
        bold: currentBold,
        underline: currentUnderline,
        inverse: currentInverse,
        fontSize: currentSize
      });
      textAccumulator = '';
    }
  };
  
  while (i < buffer.length) {
    const b = buffer[i];
    
    // ESC @ (Init)
    if (b === 0x1B && buffer[i+1] === 0x40) {
      flushText();
      currentAlign = 'left';
      currentBold = false;
      currentUnderline = false;
      currentInverse = false;
      currentSize = 'normal';
      i += 2;
      continue;
    }
    
    // ESC a (Align)
    if (b === 0x1B && buffer[i+1] === 0x61) {
      flushText();
      const val = buffer[i+2];
      if (val === 1) currentAlign = 'center';
      else if (val === 2) currentAlign = 'right';
      else currentAlign = 'left';
      i += 3;
      continue;
    }
    
    // ESC E (Bold)
    if (b === 0x1B && buffer[i+1] === 0x45) {
      flushText();
      currentBold = buffer[i+2] === 1;
      i += 3;
      continue;
    }
    
    // ESC - (Underline)
    if (b === 0x1B && buffer[i+1] === 0x2D) {
      flushText();
      currentUnderline = buffer[i+2] === 1;
      i += 3;
      continue;
    }
    
    // GS B (Inverse)
    if (b === 0x1D && buffer[i+1] === 0x42) {
      flushText();
      currentInverse = buffer[i+2] === 1;
      i += 3;
      continue;
    }
    
    // GS ! (FontSize)
    if (b === 0x1D && buffer[i+1] === 0x21) {
      flushText();
      const val = buffer[i+2];
      if (val === 0x10) currentSize = 'double-width';
      else if (val === 0x01) currentSize = 'double-height';
      else if (val === 0x11) currentSize = 'double-size';
      else if (val === 0x22) currentSize = '3x';
      else if (val === 0x33) currentSize = '4x';
      else currentSize = 'normal';
      i += 3;
      continue;
    }
    
    // GS w, h, H (Barcode configuration)
    if (b === 0x1D && buffer[i+1] === 0x77) { i += 3; continue; }
    if (b === 0x1D && buffer[i+1] === 0x68) { i += 3; continue; }
    if (b === 0x1D && buffer[i+1] === 0x48) { i += 3; continue; }
    
    // GS k (Barcode System B)
    if (b === 0x1D && buffer[i+1] === 0x6B) {
      flushText();
      const typeByte = buffer[i+2];
      const len = buffer[i+3];
      const dataStart = i + 4;
      let barcodeData = '';
      for (let j = 0; j < len; j++) {
        barcodeData += String.fromCharCode(buffer[dataStart + j]);
      }
      
      if (barcodeData.startsWith('{B')) {
        barcodeData = barcodeData.substring(2);
      }
      
      items.push({
        type: 'barcode',
        text: barcodeData,
        align: currentAlign
      });
      i += 4 + len;
      continue;
    }
    
    // GS ( k (QR Code)
    if (b === 0x1D && buffer[i+1] === 0x28 && buffer[i+2] === 0x6B) {
      flushText();
      const pL = buffer[i+3];
      const pH = buffer[i+4];
      const len = pL + (pH << 8);
      const cn = buffer[i+5];
      const fn = buffer[i+6];
      
      if (fn === 0x50) { // fn 80 Store data
        const m = buffer[i+7];
        const dataStart = i + 8;
        const qrDataLen = len - 3;
        let qrData = '';
        for (let j = 0; j < qrDataLen; j++) {
          qrData += String.fromCharCode(buffer[dataStart + j]);
        }
        items.push({
          type: 'qr',
          text: qrData,
          align: currentAlign
        });
      }
      i += 5 + len;
      continue;
    }
    
    // ESC * m nL nH (Bit-image line mode)
    if (b === 0x1B && i + 4 < buffer.length && buffer[i+1] === 0x2A) {
      flushText();
      const m = buffer[i+2];
      const nL = buffer[i+3];
      const nH = buffer[i+4];
      const numDots = nL + (nH << 8);
      // Mode 0,1: 1 byte per column (8 dots high)
      // Mode 32,33: 3 bytes per column (24 dots high)
      const bytesPerCol = (m === 32 || m === 33) ? 3 : 1;
      const dataBytes = numDots * bytesPerCol;
      const dotsHigh = (m === 32 || m === 33) ? 24 : 8;

      // Track running image dimensions across consecutive strips
      if (!currentImageStrip) {
        currentImageStrip = { width: numDots, height: 0 };
      }
      currentImageStrip.height += dotsHigh;

      i += 5 + dataBytes;
      continue;
    }

    // GS v 0 m xL xH yL yH (Raster bit image mode)
    if (b === 0x1D && buffer[i+1] === 0x76 && buffer[i+2] === 0x30) {
      flushText();
      const mode = buffer[i+3];
      const xL = buffer[i+4];
      const xH = buffer[i+5];
      const yL = buffer[i+6];
      const yH = buffer[i+7];
      const bytesPerRow = xL + (xH << 8);
      const height = yL + (yH << 8);
      const dataBytes = bytesPerRow * height;
      
      items.push({
        type: 'image',
        width: bytesPerRow * 8,
        height: height,
        align: currentAlign
      });
      
      i += 8 + dataBytes;
      continue;
    }

    // LF (Line Feed) — if we're in an image strip sequence, skip it
    if (b === 0x0A) {
      if (currentImageStrip) {
        // LF between image strips, just advance
        i++;
        continue;
      }
      textAccumulator += '\n';
      i++;
      continue;
    }

    // ESC 3, ESC 2 (Line spacing) — also flush any accumulated image
    if (b === 0x1B && buffer[i+1] === 0x33) {
      if (currentImageStrip) {
        // ESC 3 before image sets strip spacing; don't flush yet
      }
      i += 3; continue;
    }
    if (b === 0x1B && buffer[i+1] === 0x32) {
      // ESC 2 (reset line spacing) signals end of image strip sequence
      if (currentImageStrip) {
        items.push({
          type: 'image',
          width: currentImageStrip.width,
          height: currentImageStrip.height,
          align: currentAlign
        });
        currentImageStrip = null;
      }
      i += 2; continue;
    }

    // ESC d (Feed)
    if (b === 0x1B && buffer[i+1] === 0x64) {
      // Flush any in-progress image before the feed
      if (currentImageStrip) {
        items.push({
          type: 'image',
          width: currentImageStrip.width,
          height: currentImageStrip.height,
          align: currentAlign
        });
        currentImageStrip = null;
      }
      flushText();
      items.push({ type: 'feed', lines: buffer[i+2] });
      i += 3;
      continue;
    }

    // Regular character
    textAccumulator += String.fromCharCode(b);
    i++;
  }

  // Flush any remaining image at end-of-buffer
  if (currentImageStrip) {
    items.push({
      type: 'image',
      width: currentImageStrip.width,
      height: currentImageStrip.height,
      align: currentAlign
    });
    currentImageStrip = null;
  }

  flushText();
  return items;
}

function renderReceiptToAscii(items) {
  const width = 38;
  const border = '+' + '-'.repeat(width) + '+';
  let lines = [];
  lines.push('');
  lines.push('               --- SIMULATED RECEIPT ---');
  lines.push(border);
  
  items.forEach((item) => {
    if (item.type === 'text') {
      const textVal = item.text || '';
      const paragraphs = textVal.split('\n');
      
      paragraphs.forEach((p) => {
        let maxChars = width - 4;
        if (item.fontSize === 'double-width' || item.fontSize === 'double-size' || item.fontSize === '2x') {
          maxChars = Math.floor(maxChars / 2);
        } else if (item.fontSize === '3x') {
          maxChars = Math.floor(maxChars / 3);
        } else if (item.fontSize === '4x') {
          maxChars = Math.floor(maxChars / 4);
        }
        
        const wrapped = wrapText(p, maxChars);
        wrapped.forEach((line) => {
          let content = line;
          let paddingLeft = 2;
          let paddingRight = 2;
          const remainingSpace = width - 4 - content.length;
          
          if (item.align === 'center') {
            paddingLeft = 2 + Math.floor(remainingSpace / 2);
            paddingRight = width - paddingLeft - content.length;
          } else if (item.align === 'right') {
            paddingLeft = 2 + remainingSpace;
            paddingRight = 2;
          } else {
            paddingLeft = 2;
            paddingRight = 2 + remainingSpace;
          }
          
          let formattedLine = ' '.repeat(paddingLeft) + content + ' '.repeat(paddingRight);
          if (item.inverse) {
            formattedLine = ' '.repeat(paddingLeft) + '[' + content + ']' + ' '.repeat(paddingRight - 2);
          }
          lines.push('|' + formattedLine + '|');
        });
      });
    } else if (item.type === 'qr') {
      lines.push('|' + ' '.repeat(width) + '|');
      lines.push('|' + padString('[  QR CODE GRAPHIC  ]', width, 'center') + '|');
      lines.push('|' + padString(item.text, width, 'center') + '|');
      lines.push('|' + padString('  ■■■■■■■  ■ ■ ■  ■■■■■■■  ', width, 'center') + '|');
      lines.push('|' + padString('  ■     ■  ■■  ■  ■     ■  ', width, 'center') + '|');
      lines.push('|' + padString('  ■ ■■■ ■  ■ ■■   ■ ■■■ ■  ', width, 'center') + '|');
      lines.push('|' + padString('  ■■■■■■■  ■   ■  ■■■■■■■  ', width, 'center') + '|');
      lines.push('|' + padString('           ■■ ■■           ', width, 'center') + '|');
      lines.push('|' + padString('  ■■■  ■■ ■  ■■■  ■■ ■  ■  ', width, 'center') + '|');
      lines.push('|' + padString('  ■■■■■ ■■   ■ ■   ■■■■■■  ', width, 'center') + '|');
      lines.push('|' + padString('  ■■■■■■  ■■■■■■ ■■■■■■■  ', width, 'center') + '|');
      lines.push('|' + ' '.repeat(width) + '|');
    } else if (item.type === 'barcode') {
      lines.push('|' + ' '.repeat(width) + '|');
      lines.push('|' + padString('[  BARCODE GRAPHIC  ]', width, 'center') + '|');
      lines.push('|' + padString('  |||| | |||| || | || |||| |  ', width, 'center') + '|');
      lines.push('|' + padString('  |||| | |||| || | || |||| |  ', width, 'center') + '|');
      lines.push('|' + padString(item.text, width, 'center') + '|');
      lines.push('|' + ' '.repeat(width) + '|');
    } else if (item.type === 'image') {
      lines.push('|' + ' '.repeat(width) + '|');
      lines.push('|' + padString('[  DITHERED IMAGE  ]', width, 'center') + '|');
      lines.push('|' + padString(`(${item.width}x${item.height} pixels)`, width, 'center') + '|');
      lines.push('|' + padString('  ░░░▒▒▒▓▓▓███▓▓▓▒▒▒░░░  ', width, 'center') + '|');
      lines.push('|' + ' '.repeat(width) + '|');
    } else if (item.type === 'feed') {
      for (let f = 0; f < Math.min(item.lines, 2); f++) {
        lines.push('|' + ' '.repeat(width) + '|');
      }
    }
  });
  
  lines.push(border);
  lines.push('\n');
  return lines.join('\n');
}

/**
 * Scans the system USB buses for thermal printers.
 * Looks for standard USB Printer class devices (Class 7) or known ZJ-58 Vendor/Product IDs.
 */
function getPrintersList() {
  const list = usb.getDeviceList();
  const devices = [];
  
  for (const dev of list) {
    const desc = dev.deviceDescriptor;
    const vid = desc.idVendor;
    const pid = desc.idProduct;
    
    let isPrinterClass = false;
    
    // Attempt to read interface descriptors to check for class 7 (printer)
    try {
      dev.open();
      for (const iface of dev.interfaces) {
        if (iface.descriptor.bInterfaceClass === 7) {
          isPrinterClass = true;
          break;
        }
      }
      dev.close();
    } catch (err) {
      // Device might be busy, permission restricted, etc.
    }

    // Common USB thermal printer Vendor / Product ID pairings
    const isKnownThermalModel = 
      (vid === 0x0416 && pid === 0x5011) || // Zijiang ZJ-58
      (vid === 0x0483 && pid === 0x5740) || // STM32 Virtual COM / Printer
      (vid === 0x5859 && pid === 0x6041) || // GP-5890XIII
      (vid === 0x1a86 && pid === 0x7584) || // CH340 chip USB-to-Parallel/Printer
      (vid === 0x04b8 && pid === 0x0202);   // Epson TM-T20

    if (isPrinterClass || isKnownThermalModel) {
      const vidHex = '0x' + vid.toString(16).padStart(4, '0');
      const pidHex = '0x' + pid.toString(16).padStart(4, '0');
      devices.push({
        vendorId: vid,
        productId: pid,
        vendorIdHex: vidHex,
        productIdHex: pidHex,
        name: isKnownThermalModel
          ? `ZJ-58 / ESC-POS Printer (${vidHex}:${pidHex})`
          : `USB Printer Class Device (${vidHex}:${pidHex})`,
        isPrinterClass
      });
    }
  }

  // Always append simulation mode printer
  devices.push({
    vendorId: 0,
    productId: 0,
    vendorIdHex: '0x0000',
    productIdHex: '0x0000',
    name: 'Virtual Mock Printer (Simulation Mode)',
    isPrinterClass: false
  });

  return devices;
}

class UsbPrinterDriver {
  constructor() {
    this.device = null;
    this.iface = null;
    this.outEndpoint = null;
    this.isConnected = false;
    this.isMock = false;
    this.mockLogs = [];
    this.currentPrinterInfo = null;
  }

  /**
   * Open connection to the selected USB printer or enter simulation mode
   */
  async connect(vendorId, productId) {
    if (this.isConnected) {
      await this.disconnect();
    }

    // Connect to Virtual Mock Printer
    if (vendorId === 0 && productId === 0) {
      this.isMock = true;
      this.isConnected = true;
      this.currentPrinterInfo = {
        name: 'Virtual Mock Printer (Simulation Mode)',
        vendorId: 0,
        productId: 0,
        vendorIdHex: '0x0000',
        productIdHex: '0x0000'
      };
      this._addMockLog('Connected to Virtual Mock Printer');
      console.log('[Driver] Connected to Virtual Mock Printer');
      return { success: true, isMock: true };
    }

    let dev = null;
    let printerIface = null;

    try {
      dev = usb.findByIds(vendorId, productId);
      if (!dev) {
        throw new Error(`USB Device 0x${vendorId.toString(16).padStart(4, '0')}:0x${productId.toString(16).padStart(4, '0')} not found on system.`);
      }

      dev.open();

      // Find the interface with class 7 (printer) or fallback to interface 0
      for (const iface of dev.interfaces) {
        if (iface.descriptor.bInterfaceClass === 7) {
          printerIface = iface;
          break;
        }
      }
      if (!printerIface) {
        printerIface = dev.interfaces[0];
      }

      if (!printerIface) {
        throw new Error('Device does not expose any valid USB interfaces.');
      }

      // On Linux, we must detach kernel drivers to claim the interface
      try {
        if (printerIface.isKernelDriverActive()) {
          printerIface.detachKernelDriver();
        }
      } catch (err) {
        console.warn('[Driver] Detach kernel driver skipped or failed (safe on Windows/macOS):', err.message);
      }

      // Claim the interface
      printerIface.claim();

      // Find the first OUT endpoint to send data (usually bulk)
      const outEp = printerIface.endpoints.find(e => e.direction === 'out');

      if (!outEp) {
        throw new Error('No OUT endpoint found on claimed USB interface.');
      }

      this.device = dev;
      this.iface = printerIface;
      this.outEndpoint = outEp;
      this.isConnected = true;
      this.isMock = false;
      this.currentPrinterInfo = {
        name: `ZJ-58 Printer (0x${vendorId.toString(16).padStart(4, '0')}:0x${productId.toString(16).padStart(4, '0')})`,
        vendorId,
        productId,
        vendorIdHex: '0x' + vendorId.toString(16).padStart(4, '0'),
        productIdHex: '0x' + productId.toString(16).padStart(4, '0')
      };

      console.log(`[Driver] Connected to physical USB printer: 0x${vendorId.toString(16).padStart(4, '0')}:0x${productId.toString(16).padStart(4, '0')}`);
      return { success: true, isMock: false };

    } catch (err) {
      // Safe asynchronous cleanup on error
      if (printerIface) {
        try {
          printerIface.release(true, () => {
            try { dev.close(); } catch (e) {}
          });
        } catch (releaseErr) {
          try { dev.close(); } catch (e) {}
        }
      } else if (dev) {
        try { dev.close(); } catch (e) {}
      }

      this.device = null;
      this.iface = null;
      this.outEndpoint = null;
      this.isConnected = false;
      this.isMock = false;
      this.currentPrinterInfo = null;
      console.error('[Driver] Connection failed:', err);
      throw err;
    }
  }

  /**
   * Release interface and close device connection
   */
  async disconnect() {
    if (!this.isConnected) return;

    if (this.isMock) {
      this._addMockLog('Disconnected from Virtual Mock Printer');
      this.isMock = false;
      this.isConnected = false;
      this.currentPrinterInfo = null;
      console.log('[Driver] Disconnected from Virtual Mock Printer');
      return;
    }

    const dev = this.device;
    const iface = this.iface;

    this.device = null;
    this.iface = null;
    this.outEndpoint = null;
    this.isConnected = false;
    this.isMock = false;
    this.currentPrinterInfo = null;

    try {
      if (iface) {
        await new Promise((resolve) => {
          try {
            iface.release(true, () => {
              try { dev.close(); } catch (e) {}
              resolve();
            });
          } catch (e) {
            try { dev.close(); } catch (e2) {}
            resolve();
          }
        });
      } else if (dev) {
        try { dev.close(); } catch (e) {}
      }
    } catch (err) {
      console.error('[Driver] Disconnection error:', err);
    } finally {
      console.log('[Driver] Disconnected from physical USB printer');
    }
  }

  /**
   * Write binary command buffer to USB bulk transfer endpoint
   */
  write(buffer) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        return reject(new Error('Printer not connected'));
      }

      if (this.isMock) {
        const timestamp = new Date().toISOString();
        const hex = buffer.toString('hex');
        const ascii = buffer.toString('ascii').replace(/[\x00-\x1F\x7F-\xFF]/g, '.');
        
        // Render beautiful simulated receipt output with ASCII art QR / Barcode
        const parsedItems = parseEscPos(buffer);
        const receiptSim = renderReceiptToAscii(parsedItems);
        
        const logEntry = `[${timestamp}] PRINT JOB (${buffer.length} bytes):\nHEX: ${hex}\nASCII: ${ascii}\n\n${receiptSim}\n\n`;
        
        const outputFile = path.join(__dirname, 'mock_print_output.txt');
        try {
          fs.appendFileSync(outputFile, logEntry, 'utf-8');
        } catch (err) {
          console.error('[Driver Mock] Failed to write mock_print_output.txt:', err);
        }

        this._addMockLog(`Printed ${buffer.length} bytes to simulated printer.`);
        console.log(`[Driver Mock] Simulated print of ${buffer.length} bytes. logs written to backend/mock_print_output.txt`);
        
        return setTimeout(() => resolve(), 50);
      }

      // Physical printer writing with chunking to prevent buffer overflow
      const CHUNK_SIZE = 64; // 64 bytes is the standard USB Full Speed packet size
      // Larger buffers (images) need longer inter-chunk delays
      const isLargeTransfer = buffer.length > 4096;
      const CHUNK_DELAY = isLargeTransfer ? 30 : 10;
      
      (async () => {
        try {
          for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
            const chunk = buffer.subarray(offset, offset + CHUNK_SIZE);
            await new Promise((res, rej) => {
              this.outEndpoint.transfer(chunk, (err) => {
                if (err) {
                  console.error('[Driver] USB write transfer failed:', err);
                  return rej(err);
                }
                res();
              });
            });
            // Delay matches slower physical print speeds to avoid buffer overruns
            await new Promise(res => setTimeout(res, CHUNK_DELAY));
          }
          // Extra settle time after large transfers (GS v 0 raster images)
          if (isLargeTransfer) {
            await new Promise(res => setTimeout(res, 500));
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      })();
    });
  }

  /**
   * Retrieve driver status details
   */
  getStatus() {
    return {
      connected: this.isConnected,
      isMock: this.isMock,
      printerInfo: this.currentPrinterInfo,
      mockLogs: this.mockLogs.slice(-15) // Return last 15 actions
    };
  }

  _addMockLog(message) {
    this.mockLogs.push({
      timestamp: new Date().toISOString(),
      message
    });
    if (this.mockLogs.length > 50) {
      this.mockLogs.shift();
    }
  }
}

const driverInstance = new UsbPrinterDriver();

module.exports = {
  driver: driverInstance,
  getPrintersList
};
