# Technical Context: ZJ-58 USB Thermal Printer System

This document provides architectural details, hardware configurations, and data workflows for the ZJ-58 printer console workspace.

## System Architecture

The application uses a modular, decoupled structure:

```
[React 19 Console Client] ──(HTTP JSON/Multipart)──> [Express API Server]
                                                            │
                                                   [Print Queue Worker]
                                                            │
                                                    [ESC/POS Encoder]
                                                            │
                                                   [USB Driver Agent]
                                                            │
                                                 [ZJ-58 Printer / Mock]
```

### 1. Presentation Layer (React 19 + TailwindCSS 4)
- **State Management**: Keeps a sequential array of abstract layout items (Text, QR, Barcode, Image).
- **Instant Preview**: Canvas-based renderer converts formatting variables (font size, lines, alignment) and draws them. Applies local pixel adjustments (dithering) immediately on canvas when image sliders change.
- **Audio Feed**: Synthesizes stepper motor humming sounds during print queues using the browser's Web Audio API.

### 2. Service Layer (Express API)
- **Endpoints**: Standardized endpoints handle printer scans, status polling, and item prints.
- **Processor**: Backend image processor adjusts uploaded files (contrast/brightness), resizes them to 384px, dithers them, and converts them to packed bytes.

### 3. Print Queue Manager (Sequential Worker)
- **Problem**: Concurrent writes to a single USB interface cross paths and corrupt raw data frames.
- **Solution**: Jobs are queued in memory and written sequentially. Failed attempts are retried up to 2 times with a 1-second delay (re-verifying driver connection status before writing).

### 4. Encoder Layer (ESC/POS Compiler)
- Converts layout attributes to raw binary buffers:
  - Text bold, underline, inverse white-on-black, dynamic spacing, margins, and lines.
  - Word wrapping is calculated based on font size multipliers: Normal (32 cols), Double Width (16 cols), 3x Size (10 cols), 4x Size (8 cols).
  - Native barcodes (System B) and QR codes (Model 2 symbol storage sequences).
  - Monochrome dithered images are compiled into `GS v 0` raster arrays.

### 5. Driver Interfacing (node-usb + Virtual Sandbox)
- **Scanning**: Iterates through system USB buses. It identifies devices matching Class 7 (Printers) or known ZJ-58 Vendor IDs (`0x0416`, `0x0483`, etc.).
- **Claims**: Claims interface 0, detaches kernel modules on Linux, and targets the bulk transfer OUT endpoint.
- **Mock Sandbox**: If no printer is attached or selected, it defaults to Mock mode: logging hex sequences and ASCII text grids to `backend/mock_print_output.txt`.

---

## Hardware Interfacing & Drivers

Direct USB block writing requires OS-level permissions to release standard system printing drivers:

### 1. Linux Setup (Permissions & Kernel Drivers)
By default, Linux claims USB printers under the `usblp` kernel module, preventing Node.js from claiming the device.
- **Detaching**: Our driver attempts to call `iface.detachKernelDriver()` automatically.
- **Permissions**: Add a `udev` rule to allow raw USB writing without sudo privileges. We provide an automated helper script `setup-udev.sh` in the workspace root to handle this.
  
  Run the script:
  ```bash
  ./setup-udev.sh
  ```
  
  Alternatively, you can configure it manually:
  1. Create a rules file:
     ```bash
     sudo nano /etc/udev/rules.d/99-thermal-printer.rules
     ```
  2. Add the following rule (replace `0416` and `5011` with your printer's VID and PID if different):
     ```udev
     SUBSYSTEM=="usb", ATTR{idVendor}=="0416", ATTR{idProduct}=="5011", MODE="0666"
     ```
  3. Reload rules:
     ```bash
     sudo udevadm control --reload-rules && sudo udevadm trigger
     ```

### 2. Windows Setup (WinUSB Driver Replacement)
Windows blocks raw USB transfers under default system print spoolers.
- **Solution**: Install the generic `WinUSB` driver for the device.
  1. Download and run [Zadig](https://zadig.akeo.ie/).
  2. Select **Options** -> **List All Devices**.
  3. Select your thermal printer from the dropdown list (e.g., `ZJ-58` or `USB Printing Support`).
  4. In the target driver box, select **WinUSB**.
  5. Click **Replace Driver** (or **Reinstall Driver**).
  *Note: Swapping to WinUSB disables standard Windows printer spoolers for that USB port. To restore default printing, uninstall the device from Device Manager.*

### 3. macOS Setup
No driver configuration is usually necessary. Standard kernel printer attachments do not block bulk transfers.
