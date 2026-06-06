const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { driver, getPrintersList } = require('./driver');
const EscPosEncoder = require('./encoder');
const { processImage } = require('./processor');
const queue = require('./queue');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Setup multer for drag-and-drop file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// --- API ROUTES ---

// 1. GET /api/printer/status
app.get('/api/printer/status', (req, res) => {
  try {
    const status = driver.getStatus();
    const queueHistory = queue.getHistory();
    const isQueueActive = queue.active;
    res.json({
      success: true,
      printer: status,
      queue: {
        active: isQueueActive,
        pendingJobs: queue.jobs.length,
        history: queueHistory
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. GET /api/printer/list
app.get('/api/printer/list', (req, res) => {
  try {
    const list = getPrintersList();
    res.json({ success: true, printers: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. POST /api/printer/connect
app.post('/api/printer/connect', async (req, res) => {
  const { vendorId, productId } = req.body;
  if (vendorId === undefined || productId === undefined) {
    return res.status(400).json({ success: false, error: 'vendorId and productId are required parameters.' });
  }

  try {
    const connResult = await driver.connect(Number(vendorId), Number(productId));
    res.json({
      success: true,
      message: connResult.isMock
        ? 'Connected successfully in Virtual Mock Mode.'
        : `Connected successfully to printer (VID: ${vendorId}, PID: ${productId}).`,
      printer: driver.getStatus()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: `Connection failed: ${err.message}` });
  }
});

// 4. POST /api/printer/disconnect
app.post('/api/printer/disconnect', async (req, res) => {
  try {
    await driver.disconnect();
    res.json({ success: true, message: 'Printer disconnected successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: `Disconnection error: ${err.message}` });
  }
});

// 5. POST /api/print/text
app.post('/api/print/text', (req, res) => {
  const {
    text,
    bold,
    underline,
    inverse,
    emphasized,
    align,
    fontSize,
    lineSpacing,
    feedLines
  } = req.body;

  if (text === undefined || text === null) {
    return res.status(400).json({ success: false, error: 'Text field is required.' });
  }

  try {
    const encoder = new EscPosEncoder();
    encoder.init();
    
    if (Array.isArray(text)) {
      text.forEach((line) => {
        encoder.align(line.align || 'left');
        // Treat lineSpacing=0 as "use default" (ESC 2) rather than "0 dots" (ESC 3 0)
        // which would cause zero paper advance and invisible text
        const ls = line.lineSpacing ? Number(line.lineSpacing) : undefined;
        encoder.lineSpacing(ls);
        
        encoder.bold(!!line.bold);
        encoder.underline(!!line.underline);
        encoder.inverse(!!line.inverse);
        // Note: ESC G (double-strike) is omitted — not supported by basic ZJ-58 firmware
        // and causes command parser desync when the printer doesn't recognize it
        
        encoder.fontSize(line.fontSize || 'normal');
        encoder.wrappedText(line.text || '', line.fontSize || 'normal');
      });
    } else {
      if (align) encoder.align(align);
      // Treat lineSpacing=0 as "use default"
      if (lineSpacing) encoder.lineSpacing(Number(lineSpacing));
      
      encoder.bold(!!bold);
      encoder.underline(!!underline);
      encoder.inverse(!!inverse);
      // ESC G omitted — see note above
      
      if (fontSize) encoder.fontSize(fontSize);
      encoder.wrappedText(text, fontSize);
    }
    
    // Default to at least a small feed so the printed lines are visible
    encoder.feed(feedLines !== undefined ? Number(feedLines) : 3);
    
    const buffer = encoder.getBuffer();
    const descText = Array.isArray(text)
      ? `Composite [${text.length} lines]`
      : `Text Print: "${text.replace(/\n/g, ' ').substring(0, 25)}${text.length > 25 ? '...' : ''}"`;

    const jobId = queue.enqueue(buffer, {
      type: 'text',
      description: descText
    });

    res.json({ success: true, jobId, message: 'Text print job added to queue.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. POST /api/print/qr
app.post('/api/print/qr', async (req, res) => {
  const { text, size, ecc, align, feedLines } = req.body;

  if (!text) {
    return res.status(400).json({ success: false, error: 'QR Code text/data is required.' });
  }

  try {
    const qrWidth = size ? Number(size) * 40 : 160;
    const qrPngBuffer = await QRCode.toBuffer(text, {
      type: 'png',
      margin: 1,
      width: Math.min(384, qrWidth),
      errorCorrectionLevel: ecc || 'M'
    });

    const { width: imgW, height: imgH, buffer: packedBuffer } = await processImage(qrPngBuffer, {
      brightness: 0,
      contrast: 0,
      dither: 'threshold'
    });

    const encoder = new EscPosEncoder();
    encoder.init();
    
    if (align) encoder.align(align);
    encoder.image(packedBuffer, imgW, imgH);
    
    encoder.feed(feedLines !== undefined ? Number(feedLines) : 4);
    
    const buffer = encoder.getBuffer();
    const jobId = queue.enqueue(buffer, {
      type: 'qr',
      description: `QR Code (as Image): "${text.substring(0, 20)}${text.length > 20 ? '...' : ''}"`
    });

    res.json({ success: true, jobId, message: 'QR print job added to queue.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. POST /api/print/barcode
app.post('/api/print/barcode', async (req, res) => {
  const { text, type, width, height, hri, align, feedLines } = req.body;

  if (!text) {
    return res.status(400).json({ success: false, error: 'Barcode text/data is required.' });
  }

  try {
    let bcid = (type || 'CODE128').toLowerCase().replace('-', '');
    if (bcid === 'ean13') bcid = 'ean13';
    else if (bcid === 'ean8') bcid = 'ean8';
    else if (bcid === 'upca') bcid = 'upca';
    else if (bcid === 'code39') bcid = 'code39';
    else bcid = 'code128';

    const barcodePngBuffer = await bwipjs.toBuffer({
      bcid: bcid,
      text: text,
      scale: width !== undefined ? Math.min(5, Math.max(1, Number(width))) : 2,
      height: height ? Math.round(Number(height) / 8) : 10,
      includetext: hri !== 'none',
      textxalign: 'center',
      backgroundcolor: 'ffffff',
    });

    const { width: imgW, height: imgH, buffer: packedBuffer } = await processImage(barcodePngBuffer, {
      brightness: 0,
      contrast: 0,
      dither: 'threshold'
    });

    const encoder = new EscPosEncoder();
    encoder.init();
    
    if (align) encoder.align(align);
    encoder.image(packedBuffer, imgW, imgH);
    
    encoder.feed(feedLines !== undefined ? Number(feedLines) : 4);
    
    const buffer = encoder.getBuffer();
    const jobId = queue.enqueue(buffer, {
      type: 'barcode',
      description: `Barcode ${type || 'CODE128'} (as Image): "${text}"`
    });

    res.json({ success: true, jobId, message: 'Barcode print job added to queue.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. POST /api/print/image
// Supports both base64 JSON payload and raw multipart upload
app.post('/api/print/image', upload.single('imageFile'), async (req, res) => {
  try {
    let fileBuffer;
    let brightness = 0;
    let contrast = 0;
    let dither = 'floyd-steinberg';
    let align = 'center';
    let feedLines = 4;

    // Check if multipart file upload
    if (req.file) {
      fileBuffer = req.file.buffer;
      brightness = req.body.brightness !== undefined ? Number(req.body.brightness) : 0;
      contrast = req.body.contrast !== undefined ? Number(req.body.contrast) : 0;
      dither = req.body.dither || 'floyd-steinberg';
      align = req.body.align || 'center';
      feedLines = req.body.feedLines !== undefined ? Number(req.body.feedLines) : 4;
    } else {
      // Check if JSON base64 payload
      const { image, brightness: b, contrast: c, dither: d, align: a, feedLines: f } = req.body;
      if (!image) {
        return res.status(400).json({ success: false, error: 'No image uploaded. Please upload a file (imageFile) or send a base64 string (image).' });
      }
      
      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      fileBuffer = Buffer.from(base64Data, 'base64');
      brightness = b !== undefined ? Number(b) : 0;
      contrast = c !== undefined ? Number(c) : 0;
      dither = d || 'floyd-steinberg';
      align = a || 'center';
      feedLines = f !== undefined ? Number(f) : 4;
    }

    // Process image (resizing, dithering, converting)
    const { width, height, buffer: packedBuffer, monoBase64 } = await processImage(fileBuffer, {
      brightness,
      contrast,
      dither
    });

    const encoder = new EscPosEncoder();
    encoder.init();
    
    if (align) encoder.align(align);
    encoder.image(packedBuffer, width, height);
    encoder.feed(feedLines);
    
    const printBuffer = encoder.getBuffer();
    const jobId = queue.enqueue(printBuffer, {
      type: 'image',
      description: `Raster Image Print (${dither})`,
      preview: monoBase64 // Store visual monochrome preview in job log metadata
    });

    res.json({
      success: true,
      jobId,
      preview: monoBase64,
      message: 'Image print job processed and added to queue.'
    });

  } catch (err) {
    console.error('[API Image Print Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Serve frontend assets in production/deployment
const clientPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(clientPath));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(clientPath, 'index.html'));
});

// Clean print connections on shutdown
const handleShutdown = async () => {
  console.log('\n[Server] Shutdown signal received. Disconnecting printers...');
  try {
    await driver.disconnect();
  } catch (err) {
    console.error('Error during driver shutdown:', err);
  }
  process.exit(0);
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

app.listen(PORT, () => {
  console.log(`[Server] ZJ-58 printer API service running on port ${PORT}`);
});
