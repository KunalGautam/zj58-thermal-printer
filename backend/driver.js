const usb = require('usb');
const fs = require('fs');
const path = require('path');

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

    try {
      const dev = usb.findByIds(vendorId, productId);
      if (!dev) {
        throw new Error(`USB Device 0x${vendorId.toString(16).padStart(4, '0')}:0x${productId.toString(16).padStart(4, '0')} not found on system.`);
      }

      dev.open();

      // Find the interface with class 7 (printer) or fallback to interface 0
      let printerIface = dev.interfaces[0];
      for (const iface of dev.interfaces) {
        if (iface.descriptor.bInterfaceClass === 7) {
          printerIface = iface;
          break;
        }
      }

      if (!printerIface) {
        dev.close();
        throw new Error('Device does not expose any valid USB interfaces.');
      }

      // On Linux, we must detach kernel drivers to claim the interface
      try {
        if (printerIface.isKernelDriverActive()) {
          printerIface.detachKernelDriver();
        }
      } catch (err) {
        // Can be ignored if it's not a platform error or not supported
        console.warn('[Driver] Detach kernel driver skipped or failed (safe on Windows/macOS):', err.message);
      }

      // Claim the interface
      printerIface.claim();

      // Find the bulk OUT endpoint to send data
      const outEp = printerIface.endpoints.find(
        e => e.direction === 'out' && e.transferType === usb.LIBUSB_TRANSFER_TYPE_BULK
      );

      if (!outEp) {
        printerIface.release(true);
        dev.close();
        throw new Error('No bulk OUT endpoint found on claimed USB interface.');
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

    try {
      if (this.iface) {
        await new Promise((resolve) => {
          this.iface.release(true, () => resolve());
        });
      }
      if (this.device) {
        this.device.close();
      }
    } catch (err) {
      console.error('[Driver] Disconnection error:', err);
    } finally {
      this.device = null;
      this.iface = null;
      this.outEndpoint = null;
      this.isConnected = false;
      this.isMock = false;
      this.currentPrinterInfo = null;
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
        // Filter out non-printable ASCII characters for safe representation in logs
        const ascii = buffer.toString('ascii').replace(/[\x00-\x1F\x7F-\xFF]/g, '.');
        
        const logEntry = `[${timestamp}] PRINT JOB (${buffer.length} bytes):\nHEX: ${hex}\nASCII: ${ascii}\n\n`;
        
        const outputFile = path.join(__dirname, 'mock_print_output.txt');
        try {
          fs.appendFileSync(outputFile, logEntry, 'utf-8');
        } catch (err) {
          console.error('[Driver Mock] Failed to write mock_print_output.txt:', err);
        }

        this._addMockLog(`Printed ${buffer.length} bytes to simulated printer.`);
        console.log(`[Driver Mock] Simulated print of ${buffer.length} bytes. logs written to backend/mock_print_output.txt`);
        
        // Simulate minor writing delay
        return setTimeout(() => resolve(), 50);
      }

      this.outEndpoint.transfer(buffer, (err) => {
        if (err) {
          console.error('[Driver] USB write transfer failed:', err);
          return reject(err);
        }
        resolve();
      });
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
