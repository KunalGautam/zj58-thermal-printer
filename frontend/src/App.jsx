import React, { useState, useEffect } from 'react';
import { 
  Printer, 
  Terminal, 
  FileText, 
  QrCode, 
  Barcode, 
  Image as ImageIcon, 
  RefreshCw, 
  Plus, 
  Trash2, 
  Play, 
  Volume2, 
  VolumeX, 
  Server, 
  X, 
  FileCode,
  Layers,
  ArrowUp,
  ArrowDown,
  Edit
} from 'lucide-react';
import ReceiptPreview from './components/ReceiptPreview';

// Initial preset welcome receipt to display immediately on first load
const INITIAL_RECEIPT = [
  { id: '1', type: 'text', value: 'ANTIGRAVITY SYSTEMS', bold: true, align: 'center', fontSize: '2x', feedLines: 1 },
  { id: '2', type: 'text', value: 'USB Receipt Terminal v1.0\n--------------------------------', bold: false, align: 'center', fontSize: 'normal', feedLines: 1 },
  { id: '3', type: 'text', value: 'QTY  ITEM               PRICE\n1    ZJ-58 Controller   $19.99\n1    Dither Engine      $12.50\n1    ESC/POS Compiler   $15.00\n--------------------------------', bold: false, align: 'left', fontSize: 'normal', feedLines: 1 },
  { id: '4', type: 'text', value: 'TOTAL: $47.49', bold: true, align: 'right', fontSize: '2x', feedLines: 1 },
  { id: '5', type: 'text', value: 'Thank you for printing!', bold: false, align: 'center', fontSize: 'normal', feedLines: 1 },
  { id: '6', type: 'qr', value: 'https://github.com/google-deepmind', size: 4, ecc: 'M', align: 'center', feedLines: 1 },
  { id: '7', type: 'barcode', value: '58580101', typeFormat: 'CODE39', width: 3, height: 50, hri: 'below', align: 'center', feedLines: 3 }
];

export default function App() {
  // Global App States
  const [activeTab, setActiveTab] = useState('builder'); // 'builder', 'text', 'qr', 'barcode', 'image'
  const [printers, setPrinters] = useState([]);
  const [selectedPrinter, setSelectedPrinter] = useState({ vendorId: 0, productId: 0 });
  const [printerStatus, setPrinterStatus] = useState({ connected: false, isMock: true, printerInfo: null, mockLogs: [] });
  const [queueHistory, setQueueHistory] = useState([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState([]);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Tab editor inputs
  const [textInput, setTextInput] = useState({
    text: 'Hello World! This text wraps automatically when printed.',
    bold: false,
    underline: false,
    inverse: false,
    emphasized: false,
    align: 'center',
    fontSize: 'normal',
    lineSpacing: 30,
    feedLines: 3
  });

  const [qrInput, setQrInput] = useState({
    text: 'https://deepmind.google',
    size: 4,
    ecc: 'M',
    align: 'center',
    feedLines: 4
  });

  const [barcodeInput, setBarcodeInput] = useState({
    text: '12345678',
    typeFormat: 'CODE128',
    width: 3,
    height: 70,
    hri: 'below',
    align: 'center',
    feedLines: 4
  });

  const [imageInput, setImageInput] = useState({
    value: '', // Base64 data URI
    brightness: 0,
    contrast: 0,
    dither: 'floyd-steinberg',
    align: 'center',
    feedLines: 4
  });

  // Receipt Builder state
  const [builderItems, setBuilderItems] = useState(INITIAL_RECEIPT);

  // Edit State
  const [editingItemId, setEditingItemId] = useState(null);

  // WYSIWYG Composite Text state
  const [isCompositeMode, setIsCompositeMode] = useState(true);
  const [compositeLines, setCompositeLines] = useState([
    { id: 'l1', text: 'ANTIGRAVITY SYSTEMS', bold: true, align: 'center', fontSize: '2x', lineSpacing: 0, underline: false, inverse: false, emphasized: false },
    { id: 'l2', text: 'USB Receipt Terminal v1.0', bold: false, align: 'center', fontSize: 'normal', lineSpacing: 0, underline: false, inverse: false, emphasized: false },
    { id: 'l3', text: '--------------------------------', bold: false, align: 'center', fontSize: 'normal', lineSpacing: 0, underline: false, inverse: false, emphasized: false }
  ]);
  const [compositeFeedLines, setCompositeFeedLines] = useState(3);

  // Presets Management state
  const [presets, setPresets] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('zj58_receipt_presets') || '[]');
    } catch (e) {
      return [];
    }
  });
  const [presetNameInput, setPresetNameInput] = useState('');

  // Log message helper
  const addLog = (message, type = 'info') => {
    const time = new Date().toLocaleTimeString();
    setTerminalLogs((prev) => [
      ...prev,
      { time, message, type }
    ].slice(-40)); // keep last 40 logs
  };

  // Synthesizes a realistic thermal printer whirring motor sound in the browser
  const playPrintSound = (durationMs = 1500) => {
    if (!soundEnabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();

      // Create white noise for the paper scraping sound
      const bufferSize = ctx.sampleRate * (durationMs / 1000);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1100;
      filter.Q.value = 2.5;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.015, ctx.currentTime);

      // Low frequency hum to mimic stepping motor rotation
      const motorOsc = ctx.createOscillator();
      motorOsc.type = 'sawtooth';
      motorOsc.frequency.value = 65; // stepping frequency
      
      const motorGain = ctx.createGain();
      motorGain.gain.setValueAtTime(0.06, ctx.currentTime);

      // Connect LFO modulation to filters
      motorOsc.connect(motorGain);
      motorGain.connect(filter.frequency);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      motorOsc.start();
      noise.start();

      // Fade out at end
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (durationMs / 1000));

      setTimeout(() => {
        try {
          noise.stop();
          motorOsc.stop();
          ctx.close();
        } catch (e) {}
      }, durationMs + 100);

    } catch (err) {
      console.warn('Web Audio synthesis failed:', err);
    }
  };

  // Poll printer status and queue history
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/printer/status');
      const data = await res.json();
      if (data.success) {
        setPrinterStatus(data.printer);
        setQueueHistory(data.queue.history);
        
        // If a job is currently printing, trigger the printer whir sound!
        if (data.queue.active && data.queue.pendingJobs > 0) {
          playPrintSound(1200);
        }
      }
    } catch (err) {
      console.error('Failed to fetch printer status:', err);
    }
  };

  // Scan for available USB printers
  const scanPrinters = async () => {
    setIsScanning(true);
    addLog('Scanning for USB printer devices...', 'info');
    try {
      const res = await fetch('/api/printer/list');
      const data = await res.json();
      if (data.success) {
        setPrinters(data.printers);
        addLog(`Scan complete. Found ${data.printers.length} printer candidate(s).`, 'success');
        
        // Auto-select first printer if any found
        if (data.printers.length > 0) {
          const first = data.printers[0];
          setSelectedPrinter({ vendorId: first.vendorId, productId: first.productId });
        }
      }
    } catch (err) {
      addLog(`Scan failed: ${err.message}`, 'error');
    } finally {
      setIsScanning(false);
    }
  };

  // Connect to selected printer
  const handleConnect = async () => {
    addLog(`Connecting to printer (VID: ${selectedPrinter.vendorIdHex || '0x' + selectedPrinter.vendorId.toString(16)}, PID: ${selectedPrinter.productIdHex || '0x' + selectedPrinter.productId.toString(16)})...`, 'info');
    try {
      const res = await fetch('/api/printer/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedPrinter)
      });
      const data = await res.json();
      if (data.success) {
        addLog(data.message, 'success');
        fetchStatus();
      } else {
        addLog(`Connection error: ${data.error}`, 'error');
      }
    } catch (err) {
      addLog(`Failed to connect: ${err.message}`, 'error');
    }
  };

  // Disconnect from printer
  const handleDisconnect = async () => {
    addLog('Disconnecting from printer...', 'info');
    try {
      const res = await fetch('/api/printer/disconnect', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        addLog('Printer disconnected successfully.', 'info');
        fetchStatus();
      } else {
        addLog(`Disconnection failed: ${data.error}`, 'error');
      }
    } catch (err) {
      addLog(`Failed to disconnect: ${err.message}`, 'error');
    }
  };

  // Triggered on first mount
  useEffect(() => {
    addLog('Initialized ZJ-58 USB Receipt Console dashboard.', 'success');
    scanPrinters();
    fetchStatus();

    // Setup polling status every 3 seconds
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  // Handle Drag & Drop Image uploads
  const handleImageDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      readImageFile(file);
    }
  };

  const handleImageFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      readImageFile(file);
    }
  };

  const readImageFile = (file) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      setImageInput((prev) => ({ ...prev, value: event.target.result }));
      addLog(`Loaded image: ${file.name} (${Math.round(file.size / 1024)} KB). Adjust settings in preview.`, 'info');
    };
    reader.readAsDataURL(file);
  };

  // Pushes configurations into full Receipt Builder list
  const addToReceipt = (type) => {
    let newItem = {
      id: Date.now().toString(),
      type,
      align: 'center'
    };

    if (type === 'text') {
      if (isCompositeMode) {
        newItem = {
          ...newItem,
          value: compositeLines.map(line => ({ ...line })),
          feedLines: compositeFeedLines
        };
      } else {
        newItem = { ...newItem, ...textInput, value: textInput.text };
      }
    } else if (type === 'qr') {
      newItem = { ...newItem, ...qrInput, value: qrInput.text };
    } else if (type === 'barcode') {
      newItem = { ...newItem, ...barcodeInput, value: barcodeInput.text };
    } else if (type === 'image') {
      if (!imageInput.value) {
        addLog('No image uploaded to add to receipt.', 'error');
        return;
      }
      newItem = { ...newItem, ...imageInput };
    }

    setBuilderItems((prev) => [...prev, newItem]);
    addLog(`Added ${type.toUpperCase()} block to receipt layout.`, 'success');
  };

  // Update an existing item in the Receipt Builder layout
  const updateReceiptItem = () => {
    if (!editingItemId) return;
    
    setBuilderItems((prev) => 
      prev.map((item) => {
        if (item.id !== editingItemId) return item;
        
        let updatedItem = {
          ...item,
          align: 'center'
        };
        
        if (item.type === 'text') {
          if (isCompositeMode) {
            updatedItem = {
              ...updatedItem,
              value: compositeLines.map(line => ({ ...line })),
              feedLines: compositeFeedLines
            };
          } else {
            updatedItem = { ...updatedItem, ...textInput, value: textInput.text };
          }
        } else if (item.type === 'qr') {
          updatedItem = { ...updatedItem, ...qrInput, value: qrInput.text };
        } else if (item.type === 'barcode') {
          updatedItem = { ...updatedItem, ...barcodeInput, value: barcodeInput.text };
        } else if (item.type === 'image') {
          updatedItem = { ...updatedItem, ...imageInput };
        }
        
        return updatedItem;
      })
    );
    
    addLog(`Updated ${activeTab.toUpperCase()} block in receipt layout.`, 'success');
    cancelEdit();
  };

  const cancelEdit = () => {
    setEditingItemId(null);
  };

  const startEditItem = (item) => {
    setEditingItemId(item.id);
    setActiveTab(item.type);
    
    if (item.type === 'text') {
      if (Array.isArray(item.value)) {
        setIsCompositeMode(true);
        setCompositeLines(item.value.map((line, index) => ({
          id: line.id || `l_${Date.now()}_${index}_${Math.random()}`,
          ...line
        })));
        setCompositeFeedLines(item.feedLines || 3);
      } else {
        setIsCompositeMode(false);
        setTextInput({
          text: item.value || '',
          bold: !!item.bold,
          underline: !!item.underline,
          inverse: !!item.inverse,
          emphasized: !!item.emphasized,
          align: item.align || 'center',
          fontSize: item.fontSize || 'normal',
          lineSpacing: item.lineSpacing !== undefined ? item.lineSpacing : 30,
          feedLines: item.feedLines !== undefined ? item.feedLines : 3
        });
      }
    } else if (item.type === 'qr') {
      setQrInput({
        text: item.value || '',
        size: item.size !== undefined ? item.size : 4,
        ecc: item.ecc || 'M',
        align: item.align || 'center',
        feedLines: item.feedLines !== undefined ? item.feedLines : 4
      });
    } else if (item.type === 'barcode') {
      setBarcodeInput({
        text: item.value || '',
        typeFormat: item.typeFormat || 'CODE128',
        width: item.width !== undefined ? item.width : 3,
        height: item.height !== undefined ? item.height : 70,
        hri: item.hri || 'below',
        align: item.align || 'center',
        feedLines: item.feedLines !== undefined ? item.feedLines : 4
      });
    } else if (item.type === 'image') {
      setImageInput({
        value: item.value || '',
        brightness: item.brightness !== undefined ? item.brightness : 0,
        contrast: item.contrast !== undefined ? item.contrast : 0,
        dither: item.dither || 'floyd-steinberg',
        align: item.align || 'center',
        feedLines: item.feedLines !== undefined ? item.feedLines : 4
      });
    }
  };

  // Presets Management helper methods
  const savePreset = (name) => {
    const trimmed = name.trim();
    if (!trimmed) {
      addLog('Please enter a name for the receipt template.', 'error');
      return;
    }
    const newPresets = presets.filter((p) => p.name !== trimmed);
    newPresets.push({
      name: trimmed,
      items: builderItems
    });
    setPresets(newPresets);
    localStorage.setItem('zj58_receipt_presets', JSON.stringify(newPresets));
    setPresetNameInput('');
    addLog(`Receipt template "${trimmed}" saved successfully.`, 'success');
  };

  const loadPreset = (preset) => {
    setBuilderItems(preset.items || []);
    addLog(`Loaded receipt template "${preset.name}".`, 'success');
  };

  const deletePreset = (name) => {
    const newPresets = presets.filter((p) => p.name !== name);
    setPresets(newPresets);
    localStorage.setItem('zj58_receipt_presets', JSON.stringify(newPresets));
    addLog(`Deleted template "${name}".`, 'info');
  };

  // Delete builder items
  const removeBuilderItem = (id) => {
    setBuilderItems((prev) => prev.filter((item) => item.id !== id));
  };

  // Re-order builder items
  const moveBuilderItem = (index, direction) => {
    const newItems = [...builderItems];
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= newItems.length) return;
    
    // Swap
    const temp = newItems[index];
    newItems[index] = newItems[targetIdx];
    newItems[targetIdx] = temp;
    setBuilderItems(newItems);
  };

  // Submit print command for individual tabs (Quick Print)
  const printQuickJob = async (type) => {
    let endpoint = `/api/print/${type}`;
    let payload = {};

    if (type === 'text') {
      if (isCompositeMode) {
        payload = {
          text: compositeLines.map(line => ({
            text: line.text,
            bold: line.bold,
            underline: line.underline,
            inverse: line.inverse,
            emphasized: line.emphasized,
            align: line.align,
            fontSize: line.fontSize,
            lineSpacing: line.lineSpacing
          })),
          feedLines: compositeFeedLines
        };
      } else {
        payload = {
          text: textInput.text,
          bold: textInput.bold,
          underline: textInput.underline,
          inverse: textInput.inverse,
          emphasized: textInput.emphasized,
          align: textInput.align,
          fontSize: textInput.fontSize,
          lineSpacing: textInput.lineSpacing,
          feedLines: textInput.feedLines
        };
      }
    } else if (type === 'qr') {
      payload = qrInput;
    } else if (type === 'barcode') {
      payload = {
        text: barcodeInput.text,
        type: barcodeInput.typeFormat,
        width: barcodeInput.width,
        height: barcodeInput.height,
        hri: barcodeInput.hri,
        align: barcodeInput.align,
        feedLines: barcodeInput.feedLines
      };
    } else if (type === 'image') {
      if (!imageInput.value) {
        addLog('Upload an image before printing.', 'error');
        return;
      }
      payload = {
        image: imageInput.value,
        brightness: imageInput.brightness,
        contrast: imageInput.contrast,
        dither: imageInput.dither,
        align: imageInput.align,
        feedLines: imageInput.feedLines
      };
    }

    addLog(`Sending quick ${type.toUpperCase()} print job to API...`, 'info');
    playPrintSound(1000);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        addLog(`Job submitted. ID: ${data.jobId}`, 'success');
        fetchStatus();
      } else {
        addLog(`Job rejected: ${data.error}`, 'error');
      }
    } catch (err) {
      addLog(`Server communication failed: ${err.message}`, 'error');
    }
  };

  // Submit printing of full compiled receipt builder layout
  const printFullReceipt = async () => {
    if (builderItems.length === 0) {
      addLog('Receipt layout is empty.', 'error');
      return;
    }

    addLog(`Compiling and printing full receipt (${builderItems.length} sections)...`, 'info');
    playPrintSound(2000);

    // Send each section to queue sequentially
    let successCount = 0;
    
    for (let i = 0; i < builderItems.length; i++) {
      const item = builderItems[i];
      let endpoint = `/api/print/${item.type}`;
      let payload = {};

      if (item.type === 'text') {
        payload = {
          text: item.value,
          bold: item.bold,
          underline: item.underline,
          inverse: item.inverse,
          emphasized: item.emphasized,
          align: item.align,
          fontSize: item.fontSize,
          lineSpacing: item.lineSpacing,
          feedLines: item.feedLines || 1
        };
      } else if (item.type === 'qr') {
        payload = {
          text: item.value,
          size: item.size,
          ecc: item.ecc,
          align: item.align,
          feedLines: item.feedLines || 1
        };
      } else if (item.type === 'barcode') {
        payload = {
          text: item.value,
          type: item.typeFormat,
          width: item.width,
          height: item.height,
          hri: item.hri,
          align: item.align,
          feedLines: item.feedLines || 1
        };
      } else if (item.type === 'image') {
        payload = {
          image: item.value,
          brightness: item.brightness,
          contrast: item.contrast,
          dither: item.dither,
          align: item.align,
          feedLines: item.feedLines || 1
        };
      }

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          successCount++;
        }
      } catch (err) {
        console.error('Error queuing section:', err);
      }
    }

    // Append feed paper command at very end to eject paper past tear bar
    try {
      await fetch('/api/print/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: ' ', fontSize: 'normal', feedLines: 5 })
      });
    } catch (e) {}

    addLog(`Successfully enqueued ${successCount}/${builderItems.length} receipt sections.`, 'success');
    fetchStatus();
  };

  // Trigger self test printout
  const printSelfTest = async () => {
    addLog('Requesting printer self-test template...', 'info');
    playPrintSound(1800);
    try {
      // 1. Initial message
      await fetch('/api/print/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: '--- ZJ-58 THERMAL PRINTER SELF-TEST ---\nDriver: Node.js node-usb\nInterface: Bulk transfer USB\n\nFONT DEMO:',
          bold: true,
          align: 'center',
          feedLines: 1
        })
      });
      // 2. Normal text
      await fetch('/api/print/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Normal Font A (32 Column Wrap)\nBold Text Style demo\nUnderline Text Style demo\nWhite-on-black inverse print',
          bold: false,
          align: 'left',
          feedLines: 1
        })
      });
      // 3. Double sized
      await fetch('/api/print/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'DOUBLE SIZE FONT',
          fontSize: 'double-size',
          bold: true,
          align: 'center',
          feedLines: 2
        })
      });
      // 4. Barcode
      await fetch('/api/print/barcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: '12345678',
          type: 'CODE39',
          width: 3,
          height: 60,
          hri: 'below',
          align: 'center',
          feedLines: 2
        })
      });
      // 5. QR Code
      await fetch('/api/print/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'ZJ-58 printer self-test success',
          size: 5,
          ecc: 'H',
          align: 'center',
          feedLines: 6
        })
      });

      addLog('Self-test template enqueued.', 'success');
      fetchStatus();
    } catch (err) {
      addLog(`Self-test request failed: ${err.message}`, 'error');
    }
  };

  return (
    <div className="min-h-screen flex flex-col font-sans">
      {/* Header bar */}
      <header className="border-b border-slate-800 bg-[#0d121f] px-6 py-4 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-lg bg-cyan-600/20 border border-cyan-500/40 flex items-center justify-center glow-blue">
              <Printer className="w-5 h-5 text-cyan-400" />
            </div>
            {printerStatus.connected && (
              <div className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[#0d121f] glow-success animate-ping"></div>
            )}
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              ZJ-58 <span className="text-xs px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-mono">USB CONSOLE</span>
            </h1>
            <p className="text-xs text-slate-400">Node.js + Express + React 19 Thermal Service</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Sound toggle button */}
          <button 
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2 rounded-lg border flex items-center justify-center transition-all ${
              soundEnabled 
                ? 'border-cyan-500/30 text-cyan-400 bg-cyan-500/5 hover:bg-cyan-500/10' 
                : 'border-slate-800 text-slate-500 hover:text-slate-400 hover:border-slate-700'
            }`}
            title={soundEnabled ? 'Disable Printer Sound Effects' : 'Enable Printer Sound Effects'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          
          <div className="text-xs font-mono px-3 py-1.5 rounded-lg bg-[#080b11] border border-slate-800 flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${printerStatus.connected ? 'bg-emerald-500 glow-success' : 'bg-amber-500 glow-warning'}`}></span>
            <span className="text-slate-300">
              {printerStatus.connected 
                ? (printerStatus.isMock ? 'SIMULATION MODE (VIRTUAL)' : printerStatus.printerInfo?.name || 'PRINTER CONNECTED') 
                : 'OFFLINE'}
            </span>
          </div>
        </div>
      </header>

      {/* Main workspace layout */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 overflow-hidden">
        {/* Left Column - Controls (size 7/12) */}
        <section className="lg:col-span-7 flex flex-col gap-6 overflow-y-auto pr-1">
          {/* Printer Connection Manager Card */}
          <div className="glass-panel rounded-xl p-5 shadow-lg relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-cyan-500"></div>
            <h2 className="text-sm font-semibold tracking-wider text-slate-400 uppercase mb-4 flex items-center gap-2">
              <Server className="w-4 h-4 text-cyan-400" /> USB Device Interface
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-mono-terminal">Available USB Nodes</label>
                <div className="relative">
                  <select 
                    value={`${selectedPrinter.vendorId}:${selectedPrinter.productId}`}
                    onChange={(e) => {
                      const [vid, pid] = e.target.value.split(':').map(Number);
                      setSelectedPrinter({ vendorId: vid, productId: pid });
                    }}
                    className="w-full bg-[#080b11] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-300 font-mono focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                  >
                    {printers.length === 0 ? (
                      <option value="0:0">Virtual Mock Printer (Simulation Mode)</option>
                    ) : (
                      printers.map((p, idx) => (
                        <option key={idx} value={`${p.vendorId}:${p.productId}`}>
                          {p.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              <div className="flex gap-2.5">
                <button 
                  onClick={scanPrinters}
                  disabled={isScanning}
                  className="px-3 py-2 border border-slate-800 hover:border-slate-700 active:bg-[#0d121f] text-slate-300 rounded-lg text-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  title="Rescan USB nodes"
                >
                  <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
                  Scan
                </button>

                {printerStatus.connected ? (
                  <button 
                    onClick={handleDisconnect}
                    className="flex-1 px-4 py-2 border border-red-500/30 text-red-400 bg-red-500/5 hover:bg-red-500/10 hover:border-red-500/50 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 glow-danger cursor-pointer"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button 
                    onClick={handleConnect}
                    className="flex-1 px-4 py-2 border border-emerald-500/30 text-emerald-400 bg-emerald-500/5 hover:bg-emerald-500/10 hover:border-emerald-500/50 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 glow-success cursor-pointer"
                  >
                    Connect
                  </button>
                )}
              </div>
            </div>
            
            {/* Display connection error/notice */}
            {printerStatus.connected && printerStatus.isMock && (
              <div className="mt-3 px-3 py-2 rounded bg-amber-500/5 border border-amber-500/20 text-xs text-amber-400">
                ⚠️ **Virtual Mock Mode Active**: Physical thermal printer not claimed. Byte logs are written to `backend/mock_print_output.txt`. Live visual preview updates instantly.
              </div>
            )}
          </div>

          {/* Console Operations Tabs and Panels */}
          <div className="glass-panel rounded-xl shadow-lg overflow-hidden flex flex-col flex-1">
            {/* Tab navigation headers */}
            <div className="flex border-b border-slate-800 bg-[#0c101a] overflow-x-auto">
              <button 
                onClick={() => setActiveTab('builder')}
                className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider border-b-2 font-mono-terminal flex items-center gap-2 cursor-pointer transition-all ${
                  activeTab === 'builder' 
                    ? 'border-purple-500 text-purple-400 bg-purple-500/5' 
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/10'
                }`}
              >
                <Layers className="w-3.5 h-3.5" /> Receipt Builder
              </button>
              <button 
                onClick={() => setActiveTab('text')}
                className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider border-b-2 font-mono-terminal flex items-center gap-2 cursor-pointer transition-all ${
                  activeTab === 'text' 
                    ? 'border-cyan-500 text-cyan-400 bg-cyan-500/5' 
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/10'
                }`}
              >
                <FileText className="w-3.5 h-3.5" /> Text
              </button>
              <button 
                onClick={() => setActiveTab('qr')}
                className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider border-b-2 font-mono-terminal flex items-center gap-2 cursor-pointer transition-all ${
                  activeTab === 'qr' 
                    ? 'border-cyan-500 text-cyan-400 bg-cyan-500/5' 
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/10'
                }`}
              >
                <QrCode className="w-3.5 h-3.5" /> QR Code
              </button>
              <button 
                onClick={() => setActiveTab('barcode')}
                className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider border-b-2 font-mono-terminal flex items-center gap-2 cursor-pointer transition-all ${
                  activeTab === 'barcode' 
                    ? 'border-cyan-500 text-cyan-400 bg-cyan-500/5' 
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/10'
                }`}
              >
                <Barcode className="w-3.5 h-3.5" /> Barcode
              </button>
              <button 
                onClick={() => setActiveTab('image')}
                className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider border-b-2 font-mono-terminal flex items-center gap-2 cursor-pointer transition-all ${
                  activeTab === 'image' 
                    ? 'border-cyan-500 text-cyan-400 bg-cyan-500/5' 
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/10'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" /> Image
              </button>
            </div>

            {/* Tab Editor Panels */}
            <div className="p-5 flex-1 overflow-y-auto">
              
              {/* TAB 1: RECEIPT BUILDER LAYOUT LIST */}
              {activeTab === 'builder' && (
                <div className="flex flex-col gap-4 h-full">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-300">Composite Receipt Layout</h3>
                      <p className="text-xs text-slate-500">Add segments in the quick tabs and assemble them sequentially here.</p>
                    </div>
                    <button 
                      onClick={() => setBuilderItems([])}
                      className="px-2.5 py-1 text-xs border border-red-500/30 text-red-400 hover:bg-red-500/5 hover:border-red-500/50 rounded transition-all cursor-pointer font-mono"
                    >
                      Clear All
                    </button>
                  </div>

                  {builderItems.length === 0 ? (
                    <div className="border border-dashed border-slate-800 rounded-xl py-12 px-6 flex flex-col items-center justify-center text-center text-slate-500">
                      <Layers className="w-8 h-8 mb-2 text-slate-600 animate-pulse-glow" />
                      <p className="text-xs font-mono-terminal">Receipt outline is blank.</p>
                      <p className="text-[11px] max-w-[280px] mt-1">Configure headers, codes, or images in other tabs and click "Add to Receipt" to build.</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2.5 max-h-[400px] overflow-y-auto pr-1">
                      {builderItems.map((item, idx) => (
                        <div key={item.id} className="flex items-center justify-between px-3 py-2 bg-[#080b11] border border-slate-800 rounded-lg group">
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-900 border border-slate-800 rounded text-slate-500">{idx + 1}</span>
                            <div>
                              <div className="text-xs font-semibold text-slate-300 capitalize flex items-center gap-1.5">
                                {item.type === 'text' && <FileText className="w-3 h-3 text-cyan-500" />}
                                {item.type === 'qr' && <QrCode className="w-3 h-3 text-purple-500" />}
                                {item.type === 'barcode' && <Barcode className="w-3 h-3 text-blue-500" />}
                                {item.type === 'image' && <ImageIcon className="w-3 h-3 text-emerald-500" />}
                                {item.type}
                              </div>
                              <div className="text-[10px] font-mono text-slate-500 truncate max-w-[250px]">
                                {item.type === 'image' 
                                  ? `Dither: ${item.dither}` 
                                  : (Array.isArray(item.value) 
                                      ? `Rich: ${item.value.map(l => l.text).filter(Boolean).join(' | ').substring(0, 40)}${item.value.map(l => l.text).filter(Boolean).join(' | ').length > 40 ? '...' : ''}` 
                                      : item.value)}
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-1.5 opacity-40 group-hover:opacity-100 transition-all">
                            <button 
                              onClick={() => startEditItem(item)}
                              className={`p-1 cursor-pointer transition-all ${
                                editingItemId === item.id 
                                  ? 'text-cyan-400 hover:text-cyan-300' 
                                  : 'text-slate-400 hover:text-white'
                              }`}
                              title="Edit Item"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button 
                              onClick={() => moveBuilderItem(idx, -1)}
                              disabled={idx === 0}
                              className="p-1 text-slate-400 hover:text-white disabled:opacity-20 cursor-pointer"
                              title="Move Up"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button 
                              onClick={() => moveBuilderItem(idx, 1)}
                              disabled={idx === builderItems.length - 1}
                              className="p-1 text-slate-400 hover:text-white disabled:opacity-20 cursor-pointer"
                              title="Move Down"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button 
                              onClick={() => removeBuilderItem(item.id)}
                              className="p-1 text-red-400 hover:text-red-300 cursor-pointer ml-1"
                              title="Delete Item"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {builderItems.length > 0 && (
                    <div className="mt-auto pt-4 border-t border-slate-800 flex gap-3">
                      <button 
                        onClick={printFullReceipt}
                        className="flex-1 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 glow-purple cursor-pointer shadow-lg"
                      >
                        <Play className="w-4 h-4 fill-white" />
                        Print Full Receipt
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: TEXT FORMATTING OPTIONS */}
              {activeTab === 'text' && (
                <div className="flex flex-col gap-4">
                  {/* Mode switch */}
                  <div className="flex bg-[#080b11] border border-slate-800 p-1 rounded-lg">
                    <button
                      onClick={() => setIsCompositeMode(true)}
                      className={`flex-1 py-1 text-xs font-mono font-semibold rounded transition-all cursor-pointer ${
                        isCompositeMode 
                          ? 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-400' 
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      WYSIWYG Composite Editor
                    </button>
                    <button
                      onClick={() => setIsCompositeMode(false)}
                      className={`flex-1 py-1 text-xs font-mono font-semibold rounded transition-all cursor-pointer ${
                        !isCompositeMode 
                          ? 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-400' 
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Plain Text Block
                    </button>
                  </div>

                  {isCompositeMode ? (
                    /* COMPOSITE EDITOR */
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-slate-400 font-mono-terminal">WYSIWYG Text Lines</label>
                        <button
                          onClick={() => setCompositeLines([])}
                          className="text-[10px] border border-red-500/30 text-red-400 hover:bg-red-500/5 hover:border-red-500/50 rounded px-1.5 py-0.5 transition-all cursor-pointer font-mono"
                        >
                          Clear Lines
                        </button>
                      </div>

                      <div className="flex flex-col gap-3 max-h-[350px] overflow-y-auto pr-1">
                        {compositeLines.length === 0 ? (
                          <div className="border border-dashed border-slate-800 rounded-xl py-6 px-4 flex flex-col items-center justify-center text-center text-slate-500">
                            <p className="text-[11px] font-mono-terminal">No text lines created.</p>
                            <p className="text-[10px] mt-0.5">Click "Add New Text Line" to start composing.</p>
                          </div>
                        ) : (
                          compositeLines.map((line, idx) => (
                            <div key={line.id} className="flex flex-col gap-2 p-3 bg-[#080b11] border border-slate-800 rounded-lg group">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded">{idx + 1}</span>
                                <input 
                                  type="text"
                                  value={line.text}
                                  onChange={(e) => {
                                    const newLines = [...compositeLines];
                                    newLines[idx].text = e.target.value;
                                    setCompositeLines(newLines);
                                  }}
                                  className={`flex-1 bg-[#05070a] border border-slate-800 rounded px-2.5 py-1 text-sm text-slate-300 focus:outline-none focus:border-cyan-500 font-mono ${
                                    line.bold ? 'font-bold' : ''
                                  } ${
                                    line.underline ? 'underline' : ''
                                  } ${
                                    line.align === 'center' ? 'text-center' : line.align === 'right' ? 'text-right' : 'text-left'
                                  } ${
                                    line.inverse ? 'bg-white !text-black' : ''
                                  }`}
                                  style={{
                                    fontSize: line.fontSize === '2x' || line.fontSize === 'double-size' || line.fontSize === 'large' ? '1.15rem' : line.fontSize === '3x' ? '1.3rem' : line.fontSize === '4x' ? '1.5rem' : '0.875rem'
                                  }}
                                  placeholder="Type text for this line..."
                                />
                                
                                <div className="flex items-center gap-1">
                                  <button 
                                    onClick={() => {
                                      if (idx === 0) return;
                                      const newLines = [...compositeLines];
                                      const temp = newLines[idx];
                                      newLines[idx] = newLines[idx - 1];
                                      newLines[idx - 1] = temp;
                                      setCompositeLines(newLines);
                                    }}
                                    disabled={idx === 0}
                                    className="p-1 text-slate-500 hover:text-slate-300 disabled:opacity-20 cursor-pointer"
                                    title="Move line up"
                                  >
                                    <ArrowUp className="w-3.5 h-3.5" />
                                  </button>
                                  <button 
                                    onClick={() => {
                                      if (idx === compositeLines.length - 1) return;
                                      const newLines = [...compositeLines];
                                      const temp = newLines[idx];
                                      newLines[idx] = newLines[idx + 1];
                                      newLines[idx + 1] = temp;
                                      setCompositeLines(newLines);
                                    }}
                                    disabled={idx === compositeLines.length - 1}
                                    className="p-1 text-slate-500 hover:text-slate-300 disabled:opacity-20 cursor-pointer"
                                    title="Move line down"
                                  >
                                    <ArrowDown className="w-3.5 h-3.5" />
                                  </button>
                                  <button 
                                    onClick={() => {
                                      const newLines = compositeLines.filter((l) => l.id !== line.id);
                                      setCompositeLines(newLines);
                                    }}
                                    className="p-1 text-red-500 hover:text-red-400 cursor-pointer"
                                    title="Delete line"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                              
                              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-900/60">
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => {
                                      const newLines = [...compositeLines];
                                      newLines[idx].bold = !newLines[idx].bold;
                                      setCompositeLines(newLines);
                                    }}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-all cursor-pointer ${
                                      line.bold 
                                        ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400' 
                                        : 'bg-[#05070a] border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700'
                                    }`}
                                    title="Bold"
                                  >
                                    B
                                  </button>
                                  <button
                                    onClick={() => {
                                      const newLines = [...compositeLines];
                                      newLines[idx].underline = !newLines[idx].underline;
                                      setCompositeLines(newLines);
                                    }}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono border underline transition-all cursor-pointer ${
                                      line.underline 
                                        ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400' 
                                        : 'bg-[#05070a] border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700'
                                    }`}
                                    title="Underline"
                                  >
                                    U
                                  </button>
                                  <button
                                    onClick={() => {
                                      const newLines = [...compositeLines];
                                      newLines[idx].inverse = !newLines[idx].inverse;
                                      setCompositeLines(newLines);
                                    }}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-all cursor-pointer ${
                                      line.inverse 
                                        ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400' 
                                        : 'bg-[#05070a] border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700'
                                    }`}
                                    title="Inverse (White on Black)"
                                  >
                                    Inv
                                  </button>
                                </div>

                                <span className="w-px h-3.5 bg-slate-800"></span>

                                <div className="flex gap-1">
                                  {['left', 'center', 'right'].map((alignOpt) => (
                                    <button
                                      key={alignOpt}
                                      onClick={() => {
                                        const newLines = [...compositeLines];
                                        newLines[idx].align = alignOpt;
                                        setCompositeLines(newLines);
                                      }}
                                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono border capitalize transition-all cursor-pointer ${
                                        line.align === alignOpt
                                          ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400'
                                          : 'bg-[#05070a] border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700'
                                      }`}
                                    >
                                      {alignOpt}
                                    </button>
                                  ))}
                                </div>

                                <span className="w-px h-3.5 bg-slate-800"></span>

                                <div className="flex items-center gap-1">
                                  <span className="text-[9px] text-slate-500 font-mono">Size:</span>
                                  <select
                                    value={line.fontSize || 'normal'}
                                    onChange={(e) => {
                                      const newLines = [...compositeLines];
                                      newLines[idx].fontSize = e.target.value;
                                      setCompositeLines(newLines);
                                    }}
                                    className="bg-[#05070a] border border-slate-800 rounded px-1 py-0.5 text-[10px] text-slate-400 font-mono focus:outline-none focus:border-cyan-500"
                                  >
                                    <option value="normal">1x (Normal)</option>
                                    <option value="double-width">2xW (Double Width)</option>
                                    <option value="double-height">2xH (Double Height)</option>
                                    <option value="double-size">2x (Double Size)</option>
                                    <option value="3x">3x (Triple)</option>
                                    <option value="4x">4x (Quad)</option>
                                  </select>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      <button
                        onClick={() => {
                          setCompositeLines([
                            ...compositeLines,
                            {
                              id: `l_${Date.now()}_${Math.random()}`,
                              text: '',
                              bold: false,
                              underline: false,
                              inverse: false,
                              emphasized: false,
                              align: 'left',
                              fontSize: 'normal',
                              lineSpacing: 0
                            }
                          ]);
                        }}
                        className="w-full py-2 border border-dashed border-slate-800 hover:border-slate-700 hover:bg-[#080b11]/50 text-slate-400 hover:text-slate-300 rounded-lg text-xs font-semibold font-mono transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" /> Add New Text Line
                      </button>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-mono-terminal">Paper Feed Lines</label>
                          <input 
                            type="number" 
                            value={compositeFeedLines}
                            onChange={(e) => setCompositeFeedLines(Number(e.target.value))}
                            min="0" max="20"
                            className="w-full bg-[#080b11] border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-cyan-500"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* PLAIN TEXT BLOCK (ORIGINAL PANEL) */
                    <div className="flex flex-col gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-mono-terminal">Receipt Text Input</label>
                        <textarea 
                          value={textInput.text}
                          onChange={(e) => setTextInput({ ...textInput, text: e.target.value })}
                          rows="3"
                          className="w-full bg-[#080b11] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono"
                          placeholder="Type lines of text to print..."
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-mono-terminal">Font Alignment</label>
                          <select 
                            value={textInput.align}
                            onChange={(e) => setTextInput({ ...textInput, align: e.target.value })}
                            className="w-full bg-[#080b11] border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-cyan-500"
                          >
                            <option value="left">Left</option>
                            <option value="center">Center</option>
                            <option value="right">Right</option>
                          </select>
                        </div>
                        
                        <div>
                          <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-mono-terminal">Font Sizing</label>
                          <select 
                            value={textInput.fontSize}
                            onChange={(e) => setTextInput({ ...textInput, fontSize: e.target.value })}
                            className="w-full bg-[#080b11] border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-cyan-500"
                          >
                            <option value="normal">Normal (1x1)</option>
                            <option value="double-width">Double Width (2x1)</option>
                            <option value="double-height">Double Height (1x2)</option>
                            <option value="double-size">Double Size (2x2)</option>
                            <option value="3x">3x Triple Zoom</option>
                            <option value="4x">4x Quad Zoom</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-mono-terminal">Paper Feed Lines</label>
                          <input 
                            type="number" 
                            value={textInput.feedLines}
                            onChange={(e) => setTextInput({ ...textInput, feedLines: Number(e.target.value) })}
                            min="0" max="20"
                            className="w-full bg-[#080b11] border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-cyan-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-2 font-mono-terminal">Text Styling Effects</label>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {[
                            { key: 'bold', label: 'Bold' },
                            { key: 'underline', label: 'Underline' },
                            { key: 'inverse', label: 'Inverse (W/B)' },
                            { key: 'emphasized', label: 'Emphasized' }
                          ].map((item) => (
                            <label key={item.key} className="flex items-center gap-2 p-2 bg-[#080b11] border border-slate-800 hover:border-slate-700 rounded-lg cursor-pointer text-xs select-none">
                              <input 
                                type="checkbox"
                                checked={textInput[item.key]}
                                onChange={(e) => setTextInput({ ...textInput, [item.key]: e.target.checked })}
                                className="rounded text-cyan-600 bg-slate-900 border-slate-800 focus:ring-0"
                              />
                              <span className="text-slate-300 font-mono">{item.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Actions buttons */}
                  <div className="pt-4 border-t border-slate-800/60 flex gap-3">
                    {editingItemId && builderItems.some(item => item.id === editingItemId && item.type === 'text') ? (
                      <>
                        <button 
                          onClick={updateReceiptItem}
                          className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 glow-success cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 fill-white" /> Update Receipt Item
                        </button>
                        <button 
                          onClick={cancelEdit}
                          className="px-4 py-2 border border-slate-800 hover:border-slate-700 active:bg-slate-800/10 text-slate-300 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" /> Cancel Edit
                        </button>
                      </>
                    ) : (
                      <>
                        <button 
                          onClick={() => printQuickJob('text')}
                          className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 glow-blue cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 fill-white" /> Print Text Now
                        </button>
                        <button 
                          onClick={() => addToReceipt('text')}
                          className="px-4 py-2 border border-slate-800 hover:border-slate-700 active:bg-slate-800/10 text-slate-300 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add to Receipt
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: QR CODE CREATION */}
              {activeTab === 'qr' && (
                <div className="flex flex-col gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-mono-terminal">QR Code Data (String or URL)</label>
                    <input 
                      type="text" 
                      value={qrInput.text}
                      onChange={(e) => setQrInput({ ...qrInput, text: e.target.value })}
                      className="w-full bg-[#080b11] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-300 font-mono focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                      placeholder="e.g., https://google.com"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-slate-400 mb-1 font-mono-terminal">Module Scale Size ({qrInput.size})</label>
                      <input 
                        type="range" 
                        min="2" max="10" step="1"
                        value={qrInput.size}
                        onChange={(e) => setQrInput({ ...qrInput, size: Number(e.target.value) })}
                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                      />
                      <div className="flex justify-between text-[10px] text-slate-600 font-mono">
                        <span>Small (2)</span>
                        <span>Large (10)</span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-mono-terminal">Error Correction</label>
                      <select 
                        value={qrInput.ecc}
                        onChange={(e) => setQrInput({ ...qrInput, ecc: e.target.value })}
                        className="w-full bg-[#080b11] border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-cyan-500"
                      >
                        <option value="L">L (7% recovery)</option>
                        <option value="M">M (15% recovery)</option>
                        <option value="Q">Q (25% recovery)</option>
                        <option value="H">H (30% recovery)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-mono-terminal">Alignment</label>
                      <select 
                        value={qrInput.align}
                        onChange={(e) => setQrInput({ ...qrInput, align: e.target.value })}
                        className="w-full bg-[#080b11] border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-cyan-500"
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-800/60 flex gap-3">
                    {editingItemId && builderItems.some(item => item.id === editingItemId && item.type === 'qr') ? (
                      <>
                        <button 
                          onClick={updateReceiptItem}
                          className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 glow-success cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 fill-white" /> Update Receipt Item
                        </button>
                        <button 
                          onClick={cancelEdit}
                          className="px-4 py-2 border border-slate-800 hover:border-slate-700 active:bg-slate-800/10 text-slate-300 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" /> Cancel Edit
                        </button>
                      </>
                    ) : (
                      <>
                        <button 
                          onClick={() => printQuickJob('qr')}
                          className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 glow-blue cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 fill-white" /> Print QR Code
                        </button>
                        <button 
                          onClick={() => addToReceipt('qr')}
                          className="px-4 py-2 border border-slate-800 hover:border-slate-700 active:bg-slate-800/10 text-slate-300 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add to Receipt
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: BARCODE MAKER */}
              {activeTab === 'barcode' && (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-mono-terminal">Barcode Content</label>
                      <input 
                        type="text" 
                        value={barcodeInput.text}
                        onChange={(e) => setBarcodeInput({ ...barcodeInput, text: e.target.value })}
                        className="w-full bg-[#080b11] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-300 font-mono focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                        placeholder="e.g., 12345678"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-mono-terminal">Symbology standard</label>
                      <select 
                        value={barcodeInput.typeFormat}
                        onChange={(e) => {
                          const val = e.target.value;
                          let placeholder = '12345678';
                          if (val === 'EAN13' || val === 'EAN-13') placeholder = '1234567890128';
                          else if (val === 'EAN8' || val === 'EAN-8') placeholder = '12345670';
                          else if (val === 'UPCA' || val === 'UPC-A') placeholder = '123456789012';
                          else if (val === 'CODE39') placeholder = 'TEST39';
                          
                          setBarcodeInput({ ...barcodeInput, typeFormat: val, text: placeholder });
                        }}
                        className="w-full bg-[#080b11] border border-slate-800 rounded-lg px-2.5 py-2 text-sm text-slate-300 font-mono focus:outline-none focus:border-cyan-500"
                      >
                        <option value="CODE128">CODE128 (Alphanumeric)</option>
                        <option value="CODE39">CODE39 (Uppercase/Num)</option>
                        <option value="EAN13">EAN-13 (13 Digits)</option>
                        <option value="EAN8">EAN-8 (8 Digits)</option>
                        <option value="UPCA">UPC-A (12 Digits)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1 font-mono-terminal">Bar Width ({barcodeInput.width})</label>
                      <input 
                        type="range" 
                        min="2" max="5" step="1"
                        value={barcodeInput.width}
                        onChange={(e) => setBarcodeInput({ ...barcodeInput, width: Number(e.target.value) })}
                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1 font-mono-terminal">Bar Height ({barcodeInput.height}px)</label>
                      <input 
                        type="range" 
                        min="30" max="150" step="5"
                        value={barcodeInput.height}
                        onChange={(e) => setBarcodeInput({ ...barcodeInput, height: Number(e.target.value) })}
                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-mono-terminal">Display Text (HRI)</label>
                      <select 
                        value={barcodeInput.hri}
                        onChange={(e) => setBarcodeInput({ ...barcodeInput, hri: e.target.value })}
                        className="w-full bg-[#080b11] border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-cyan-500"
                      >
                        <option value="below">Below Barcode</option>
                        <option value="above">Above Barcode</option>
                        <option value="none">No Text</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-mono-terminal">Alignment</label>
                      <select 
                        value={barcodeInput.align}
                        onChange={(e) => setBarcodeInput({ ...barcodeInput, align: e.target.value })}
                        className="w-full bg-[#080b11] border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-cyan-500"
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-800/60 flex gap-3">
                    {editingItemId && builderItems.some(item => item.id === editingItemId && item.type === 'barcode') ? (
                      <>
                        <button 
                          onClick={updateReceiptItem}
                          className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 glow-success cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 fill-white" /> Update Receipt Item
                        </button>
                        <button 
                          onClick={cancelEdit}
                          className="px-4 py-2 border border-slate-800 hover:border-slate-700 active:bg-slate-800/10 text-slate-300 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" /> Cancel Edit
                        </button>
                      </>
                    ) : (
                      <>
                        <button 
                          onClick={() => printQuickJob('barcode')}
                          className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 glow-blue cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 fill-white" /> Print Barcode
                        </button>
                        <button 
                          onClick={() => addToReceipt('barcode')}
                          className="px-4 py-2 border border-slate-800 hover:border-slate-700 active:bg-slate-800/10 text-slate-300 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add to Receipt
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 5: DITHERED IMAGE PROCESSING */}
              {activeTab === 'image' && (
                <div className="flex flex-col gap-4">
                  {/* Drag-and-drop file input area */}
                  {!imageInput.value ? (
                    <div 
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={handleImageDrop}
                      className="border-2 border-dashed border-slate-800 hover:border-slate-700 rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all bg-[#080b11]/30 hover:bg-[#080b11]/50 group"
                    >
                      <input 
                        type="file" 
                        id="image-file" 
                        accept="image/*"
                        onChange={handleImageFileChange}
                        className="hidden" 
                      />
                      <label htmlFor="image-file" className="cursor-pointer flex flex-col items-center">
                        <ImageIcon className="w-10 h-10 mb-2.5 text-slate-600 group-hover:text-cyan-500 transition-colors" />
                        <span className="text-xs font-semibold text-slate-300">Drag & Drop Image or Click to Browse</span>
                        <span className="text-[10px] text-slate-500 mt-1 font-mono">PNG, JPG, BMP up to 5MB</span>
                      </label>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between p-3 bg-[#080b11] border border-slate-800 rounded-lg">
                      <div className="flex items-center gap-3">
                        <img 
                          src={imageInput.value} 
                          alt="Thumbnail" 
                          className="w-12 h-12 rounded object-cover border border-slate-800" 
                        />
                        <div>
                          <div className="text-xs font-semibold text-slate-300 font-mono-terminal">Source Image Loaded</div>
                          <button 
                            onClick={() => setImageInput({ ...imageInput, value: '' })}
                            className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1 cursor-pointer font-mono"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      
                      <div className="text-xs text-slate-500 font-mono bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
                        Target Width: 384px
                      </div>
                    </div>
                  )}

                  {/* Image Processing Sliders */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1 font-mono-terminal">Brightness ({imageInput.brightness > 0 ? `+${imageInput.brightness}` : imageInput.brightness})</label>
                      <input 
                        type="range" 
                        min="-150" max="150" step="5"
                        value={imageInput.brightness}
                        onChange={(e) => setImageInput({ ...imageInput, brightness: Number(e.target.value) })}
                        disabled={!imageInput.value}
                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500 disabled:opacity-35"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1 font-mono-terminal">Contrast ({imageInput.contrast > 0 ? `+${imageInput.contrast}` : imageInput.contrast})</label>
                      <input 
                        type="range" 
                        min="-100" max="100" step="5"
                        value={imageInput.contrast}
                        onChange={(e) => setImageInput({ ...imageInput, contrast: Number(e.target.value) })}
                        disabled={!imageInput.value}
                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500 disabled:opacity-35"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-mono-terminal">Dithering Algorithm</label>
                      <select 
                        value={imageInput.dither}
                        onChange={(e) => setImageInput({ ...imageInput, dither: e.target.value })}
                        disabled={!imageInput.value}
                        className="w-full bg-[#080b11] border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-cyan-500 disabled:opacity-35"
                      >
                        <option value="floyd-steinberg">Floyd-Steinberg (Diffusion)</option>
                        <option value="atkinson">Atkinson (Detail/Bright)</option>
                        <option value="bayer">Bayer Matrix (8x8 Ordered)</option>
                        <option value="halftone">Halftone Screen (Clustered)</option>
                        <option value="threshold">Threshold (Sharp cut)</option>
                      </select>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-800/60 flex gap-3">
                    {editingItemId && builderItems.some(item => item.id === editingItemId && item.type === 'image') ? (
                      <>
                        <button 
                          onClick={updateReceiptItem}
                          disabled={!imageInput.value}
                          className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 glow-success cursor-pointer disabled:opacity-50"
                        >
                          <Play className="w-3.5 h-3.5 fill-white" /> Update Receipt Item
                        </button>
                        <button 
                          onClick={cancelEdit}
                          className="px-4 py-2 border border-slate-800 hover:border-slate-700 active:bg-slate-800/10 text-slate-300 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" /> Cancel Edit
                        </button>
                      </>
                    ) : (
                      <>
                        <button 
                          onClick={() => printQuickJob('image')}
                          disabled={!imageInput.value}
                          className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 glow-blue cursor-pointer disabled:opacity-50"
                        >
                          <Play className="w-3.5 h-3.5 fill-white" /> Print Image
                        </button>
                        <button 
                          onClick={() => addToReceipt('image')}
                          disabled={!imageInput.value}
                          className="px-4 py-2 border border-slate-800 hover:border-slate-700 active:bg-slate-800/10 text-slate-300 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add to Receipt
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
              
            </div>
          </div>
        </section>

        {/* Right Column - Preview & Log Terminal (size 5/12) */}
        <section className="lg:col-span-5 flex flex-col gap-6 overflow-y-auto pl-1">
          {/* Preset templates card */}
          <div className="glass-panel rounded-xl p-5 shadow-lg relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-purple-500"></div>
            <h2 className="text-sm font-semibold tracking-wider text-slate-400 uppercase mb-4 flex items-center gap-2">
              <FileCode className="w-4 h-4 text-purple-400" /> Presets & Actions
            </h2>
            
            <div className="flex flex-wrap gap-2.5">
              <button 
                onClick={() => setBuilderItems(INITIAL_RECEIPT)}
                className="px-3 py-1.5 border border-slate-800 hover:border-slate-700 hover:bg-slate-800/10 text-xs font-mono text-slate-300 rounded cursor-pointer"
              >
                Load Welcome Template
              </button>
              
              <button 
                onClick={printSelfTest}
                className="px-3 py-1.5 border border-purple-500/20 text-purple-400 bg-purple-500/5 hover:bg-purple-500/10 hover:border-purple-500/40 text-xs font-mono rounded glow-purple cursor-pointer"
              >
                Print Device Self-Test
              </button>

              <button 
                onClick={() => {
                  setBuilderItems([
                    { id: '1', type: 'text', value: 'CAFE ROBUST', bold: true, align: 'center', fontSize: '2x', feedLines: 1 },
                    { id: '2', type: 'text', value: 'Receipt #: 00123\nTime: ' + new Date().toLocaleDateString() + '\n--------------------------------', bold: false, align: 'center', fontSize: 'normal', feedLines: 1 },
                    { id: '3', type: 'text', value: '1  Espresso Macchiato   $3.50\n1  Blueberry Scone      $3.25\n--------------------------------', bold: false, align: 'left', fontSize: 'normal', feedLines: 1 },
                    { id: '4', type: 'text', value: 'SUBTOTAL: $6.75\nTAX (8%): $0.54\nTOTAL   : $7.29', bold: true, align: 'right', fontSize: 'normal', feedLines: 2 },
                    { id: '5', type: 'text', value: 'Thanks! Scan to Review:', bold: false, align: 'center', fontSize: 'normal', feedLines: 1 },
                    { id: '6', type: 'qr', value: 'https://yelp.com', size: 4, ecc: 'M', align: 'center', feedLines: 4 }
                  ]);
                  addLog('Loaded Cafe Receipt template into Builder.', 'info');
                }}
                className="px-3 py-1.5 border border-slate-800 hover:border-slate-700 hover:bg-slate-800/10 text-xs font-mono text-slate-300 rounded cursor-pointer"
              >
                Load Cafe Invoice
              </button>
            </div>

            {/* Custom Saved Templates */}
            <div className="mt-5 pt-4 border-t border-slate-800/60">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5 font-mono-terminal">Custom Saved Templates</h3>
              
              <div className="flex gap-2 mb-3">
                <input 
                  type="text"
                  placeholder="Template Name..."
                  value={presetNameInput}
                  onChange={(e) => setPresetNameInput(e.target.value)}
                  className="flex-1 bg-[#080b11] border border-slate-800 rounded px-2.5 py-1 text-xs text-slate-300 font-mono focus:outline-none focus:border-purple-500"
                />
                <button
                  onClick={() => savePreset(presetNameInput)}
                  className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs font-semibold transition-all cursor-pointer flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Save Current
                </button>
              </div>

              {presets.length === 0 ? (
                <p className="text-[11px] text-slate-600 italic">No custom templates saved yet.</p>
              ) : (
                <div className="flex flex-col gap-1.5 max-h-[140px] overflow-y-auto pr-1">
                  {presets.map((preset) => (
                    <div key={preset.name} className="flex items-center justify-between bg-[#080b11] border border-slate-800 px-3 py-1.5 rounded text-xs group">
                      <button 
                        onClick={() => loadPreset(preset)}
                        className="text-left text-purple-400 hover:text-purple-300 font-mono truncate max-w-[80%] cursor-pointer"
                        title="Click to load template"
                      >
                        {preset.name} ({preset.items.length} items)
                      </button>
                      <button 
                        onClick={() => deletePreset(preset.name)}
                        className="text-red-400 hover:text-red-300 opacity-60 group-hover:opacity-100 transition-opacity cursor-pointer"
                        title="Delete template"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Receipt Live Output simulation panel */}
          <div className="glass-panel rounded-xl shadow-lg p-5 flex flex-col items-center">
            <h2 className="text-sm font-semibold tracking-wider text-slate-400 uppercase w-full mb-3 text-left flex items-center gap-2">
              <FileText className="w-4 h-4 text-cyan-400" /> Simulated Receipt Output
            </h2>
            <div className="w-full bg-[#080b11] border border-slate-800 rounded-lg p-4 overflow-y-auto max-h-[380px] flex justify-center">
              <ReceiptPreview items={activeTab === 'builder' ? builderItems : [
                activeTab === 'text' ? { type: 'text', value: textInput.text, ...textInput } : null,
                activeTab === 'qr' ? { type: 'qr', value: qrInput.text, ...qrInput } : null,
                activeTab === 'barcode' ? { type: 'barcode', value: barcodeInput.text, ...barcodeInput } : null,
                activeTab === 'image' ? { type: 'image', value: imageInput.value, ...imageInput } : null
              ].filter(Boolean)} />
            </div>
          </div>

          {/* Terminal History Log Panel */}
          <div className="glass-panel rounded-xl shadow-lg overflow-hidden flex flex-col flex-1 max-h-[350px]">
            <div className="border-b border-slate-800 bg-[#0c101a] px-4 py-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono-terminal flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" /> System Log Terminal
              </h2>
              <span className="text-[10px] text-slate-600 font-mono">poll: 3s</span>
            </div>
            
            <div className="bg-[#05070a]/90 terminal-screen flex-1 p-4 overflow-y-auto font-mono text-xs select-text selection:bg-emerald-500/20">
              {terminalLogs.map((log, idx) => (
                <div key={idx} className="mb-1.5 leading-relaxed">
                  <span className="text-slate-600 font-medium">[{log.time}]</span>{' '}
                  <span className={
                    log.type === 'error' ? 'text-red-400' :
                    log.type === 'success' ? 'text-emerald-400 font-semibold' :
                    'text-cyan-400'
                  }>
                    {log.type === 'error' ? '✖ ' : log.type === 'success' ? '✔ ' : 'i '}
                    {log.message}
                  </span>
                </div>
              ))}
              <div className="blink-cursor text-slate-500 mt-1">antigravity@zj58-thermal:~#</div>
            </div>
          </div>

          {/* Print Jobs Queue monitor */}
          <div className="glass-panel rounded-xl shadow-lg p-5">
            <h2 className="text-sm font-semibold tracking-wider text-slate-400 uppercase mb-3 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-amber-400" /> Active Print Queue ({queueHistory.filter(q => q.status === 'queued' || q.status === 'printing').length})
            </h2>

            <div className="flex flex-col gap-2 max-h-[160px] overflow-y-auto">
              {queueHistory.length === 0 ? (
                <div className="text-xs text-slate-600 font-mono italic">No historical print jobs logged.</div>
              ) : (
                [...queueHistory].reverse().map((job) => (
                  <div key={job.id} className="flex items-center justify-between px-3 py-1.5 bg-[#080b11] border border-slate-800 rounded text-xs font-mono">
                    <div className="flex items-center gap-2 truncate max-w-[70%]">
                      <span className={`w-2 h-2 rounded-full ${
                        job.status === 'completed' ? 'bg-emerald-500' :
                        job.status === 'printing' ? 'bg-cyan-500 animate-pulse' :
                        job.status === 'failed' ? 'bg-red-500' :
                        'bg-slate-600'
                      }`}></span>
                      <span className="text-slate-400 truncate">{job.description}</span>
                    </div>
                    
                    <div className="text-[10px] text-slate-500 flex items-center gap-2">
                      <span>{job.status}</span>
                      {job.duration > 0 && <span>({job.duration}ms)</span>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
