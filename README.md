# ZJ-58 USB Thermal Printer Service and Console

A modular, cross-platform full-stack application and developer console for ZJ-58 (and compatible ESC/POS) USB thermal receipt printers. Built with **Node.js, Express, React 19**, and **TailwindCSS 4**.

## Features

- **USB Printer Discovery & Management**: Scans system nodes using `node-usb`, detects class 7 (Printers), claims endpoints, handles driver detaches on Linux, and manages real-time connection status.
- **Virtual Simulation Mode**: Sandbox mode fallback if no physical hardware is claimed, logging commands to file and showing full visual live updates.
- **Sleek Monospace Terminal Dashboard**: A futuristic, premium dark-theme operator dashboard with real-time status logging and job queue monitors.
- **Draggable Receipt Layout Builder**: Live receipt construction canvas where elements (headers, lists, codes, images) can be added, re-ordered, and printed as a single ticket.
- **Dynamic Receipt Previewer**: Implements a 384px canvas representing 58mm thermal output, accurately simulating font zooming, bold, underline, inverse print, barcodes, and dithered raster graphics.
- **Built-in Audio Feedback**: Uses the browser's Web Audio API to synthesize a stepping motor humming and paper friction sound synced to printing durations.
- **Multimodal Printing API**: REST endpoints for raw text (with wrapping), native Model 2 QR codes, EAN/CODE128/CODE39 barcodes, and processed graphics.
- **Grayscale Image Dithering**: Backend and frontend implementations for brightness/contrast filters with 5 dithering types: Floyd-Steinberg, Atkinson, Bayer Matrix, Halftone Screen, and Threshold.

---

## Directory Structure

```
├── backend/
│   ├── driver.js          # Direct node-usb communication & mock simulator
│   ├── encoder.js         # Chainable ESC/POS command compiler
│   ├── processor.js       # Jimp image resizer & dithering processor
│   ├── queue.js           # Serial queue worker with retry logic
│   ├── server.js          # Express app routing & production hosting
│   └── verify.js          # Automated module unit tests
├── frontend/
│   ├── src/
│   │   ├── App.jsx        # Terminal dashboard control panel
│   │   ├── index.css      # Custom fonts, scanlines, paper designs
│   │   ├── components/
│   │   │   └── ReceiptPreview.jsx # HTML5 receipt output canvas
│   │   └── utils/
│   │       └── dither.js  # Real-time frontend dithering
│   └── vite.config.js     # React + Tailwind v4 + API proxying
└── package.json           # Workspace dev orchestration
```

---

## Setup and Commands

Execute these commands in the root workspace directory:

### 1. Install All Dependencies
Installs backend, frontend, and orchestration packages:
```bash
npm run setup
```

### 2. Start Development Workspace
Fires up the backend server (`http://localhost:5000`) and the Vite React server (`http://localhost:3000`) concurrently, with proxied requests:
```bash
npm run dev
```

### 3. Build & Host Production Build
Compiles production client assets and serves the full project from port 5000:
```bash
npm run prod
```
Open: `http://localhost:5000`

### 4. Execute Module Verification Tests
Runs automated assertion tests verifying command outputs and image conversions:
```bash
cd backend && node verify.js
```

---

## Technical Specifications

### USB Interface
- **Print Width**: 58mm paper (384 dots print width).
- **Encoding**: CP437 ASCII standard.
- **Raster Bit Image Command**: `GS v 0 m xL xH yL yH d1...dk` (Normal mode 0, 48 horizontal bytes).
- **Native Barcode Command**: System B (`GS k m n d1...dn`) supporting CODE128, EAN-13, EAN-8, UPC-A, and CODE39.
- **Native QR Code Command**: Symbol storage area blocks (`GS ( k`) using Model 2.
