import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { adjustBrightnessContrast, applyDither } from '../utils/dither';

const PRINTER_WIDTH = 384; // 58mm thermal printer width in dots

export default function ReceiptPreview({ items }) {
  const canvasRef = useRef(null);
  const [imageElements, setImageElements] = useState({});
  const [redrawTrigger, setRedrawTrigger] = useState(0);

  // Pre-load images asynchronously and cache them
  useEffect(() => {
    items.forEach((item) => {
      if (item.type === 'image' && item.value && !imageElements[item.value]) {
        const img = new Image();
        img.onload = () => {
          setImageElements((prev) => ({ ...prev, [item.value]: img }));
          setRedrawTrigger((t) => t + 1);
        };
        img.src = item.value;
      }
    });
  }, [items, imageElements]);

  // Render receipt whenever items, loaded images, or triggers change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // 1. Calculate heights and positions of each element to resize the canvas dynamically
    let totalHeight = 20; // top padding
    const itemLayouts = [];

    items.forEach((item, index) => {
      const layout = { y: totalHeight, height: 0, draw: null };

      if (item.type === 'text') {
        const textVal = item.value || '';
        const fontSize = item.fontSize || 'normal';
        let scaleX = 1;
        let scaleY = 1;
        
        if (fontSize === 'double-width') scaleX = 2;
        else if (fontSize === 'double-height') scaleY = 2;
        else if (fontSize === 'double-size' || fontSize === 'large' || fontSize === '2x') { scaleX = 2; scaleY = 2; }
        else if (fontSize === '3x') { scaleX = 3; scaleY = 3; }
        else if (fontSize === '4x') { scaleX = 4; scaleY = 4; }

        const maxChars = Math.floor(32 / scaleX);
        const fontHeight = 24 * scaleY;
        const lineSpacing = item.lineSpacing !== undefined ? Number(item.lineSpacing) : 0;
        
        // Wrap text
        const lines = wrapTextLines(textVal, maxChars);
        const heightNeeded = lines.length * (fontHeight + lineSpacing) + (item.feedLines ? item.feedLines * 12 : 0);

        layout.height = heightNeeded;
        layout.draw = (y) => {
          ctx.save();
          ctx.textBaseline = 'top';
          
          lines.forEach((line, lineIdx) => {
            const lineY = y + lineIdx * (fontHeight + lineSpacing);
            
            // Set font style
            let fontStyle = '';
            if (item.bold) fontStyle += 'bold ';
            fontStyle += `${14 * scaleY}px monospace`; // 14px mimics thermal font size nicely
            ctx.font = fontStyle;
            
            const textWidth = ctx.measureText(line).width;
            let textX = 10;
            if (item.align === 'center') textX = (PRINTER_WIDTH - textWidth) / 2;
            else if (item.align === 'right') textX = PRINTER_WIDTH - textWidth - 10;
            
            // Draw background if inverse mode
            if (item.inverse) {
              ctx.fillStyle = '#000000';
              ctx.fillRect(
                item.align === 'center' ? textX - 4 : 5, 
                lineY, 
                item.align === 'center' ? textWidth + 8 : PRINTER_WIDTH - 10, 
                fontHeight
              );
              ctx.fillStyle = '#ffffff';
            } else {
              ctx.fillStyle = '#000000';
            }
            
            ctx.fillText(line, textX, lineY);
            
            // Underline
            if (item.underline) {
              ctx.strokeStyle = '#000000';
              ctx.lineWidth = 1.5 * scaleY;
              ctx.beginPath();
              ctx.moveTo(textX, lineY + fontHeight - 2);
              ctx.lineTo(textX + textWidth, lineY + fontHeight - 2);
              ctx.stroke();
            }
          });
          ctx.restore();
        };

        totalHeight += heightNeeded;

      } else if (item.type === 'qr') {
        const textVal = item.value || '';
        const size = item.size !== undefined ? Number(item.size) : 4;
        const ecc = item.ecc || 'M';
        const feedLines = item.feedLines ? Number(item.feedLines) : 4;
        
        let qrModules = null;
        try {
          const qrCodeObj = QRCode.create(textVal, { errorCorrectionLevel: ecc });
          qrModules = qrCodeObj.modules;
        } catch (err) {
          // Fallback if qr code fails to generate
        }

        if (qrModules) {
          const qrSize = qrModules.size * size;
          const heightNeeded = qrSize + 10 + (feedLines * 12);
          layout.height = heightNeeded;
          
          layout.draw = (y) => {
            let startX = 10;
            if (item.align === 'center') startX = (PRINTER_WIDTH - qrSize) / 2;
            else if (item.align === 'right') startX = PRINTER_WIDTH - qrSize - 10;
            
            ctx.fillStyle = '#000000';
            for (let row = 0; row < qrModules.size; row++) {
              for (let col = 0; col < qrModules.size; col++) {
                if (qrModules.get(col, row)) {
                  ctx.fillRect(startX + col * size, y + 5 + row * size, size, size);
                }
              }
            }
          };
          totalHeight += heightNeeded;
        }

      } else if (item.type === 'barcode') {
        const textVal = item.value || '';
        const format = item.typeFormat || 'CODE128';
        const width = item.width !== undefined ? Number(item.width) : 3;
        const height = item.height !== undefined ? Number(item.height) : 60;
        const hri = item.hri || 'below';
        const feedLines = item.feedLines ? Number(item.feedLines) : 4;

        const heightNeeded = height + 30 + (feedLines * 12);
        layout.height = heightNeeded;

        layout.draw = (y) => {
          try {
            // Use temporary canvas to render JsBarcode
            const tempCanvas = document.createElement('canvas');
            JsBarcode(tempCanvas, textVal, {
              format: format,
              width: width,
              height: height,
              displayValue: hri !== 'none',
              textPosition: hri === 'above' ? 'top' : 'bottom',
              font: 'monospace',
              fontSize: 14,
              background: '#fafaf5',
              lineColor: '#000000',
              margin: 0
            });

            const barWidth = tempCanvas.width;
            let startX = 10;
            if (item.align === 'center') startX = (PRINTER_WIDTH - barWidth) / 2;
            else if (item.align === 'right') startX = PRINTER_WIDTH - barWidth - 10;

            ctx.drawImage(tempCanvas, Math.max(0, startX), y + 5);
          } catch (err) {
            ctx.fillStyle = '#ff0000';
            ctx.font = '12px monospace';
            ctx.fillText(`[Barcode Error: ${err.message}]`, 10, y + 10);
          }
        };

        totalHeight += heightNeeded;

      } else if (item.type === 'image') {
        const img = imageElements[item.value];
        const brightness = item.brightness !== undefined ? Number(item.brightness) : 0;
        const contrast = item.contrast !== undefined ? Number(item.contrast) : 0;
        const dither = item.dither || 'floyd-steinberg';
        const feedLines = item.feedLines ? Number(item.feedLines) : 4;

        if (img) {
          const scaleFactor = PRINTER_WIDTH / img.width;
          const imgHeight = Math.round(img.height * scaleFactor);
          const heightNeeded = imgHeight + 10 + (feedLines * 12);
          layout.height = heightNeeded;

          layout.draw = (y) => {
            // Create temporary canvas to dither image in real-time
            const tempSrcCanvas = document.createElement('canvas');
            const tempDestCanvas = document.createElement('canvas');
            tempSrcCanvas.width = PRINTER_WIDTH;
            tempSrcCanvas.height = imgHeight;
            
            const tempSrcCtx = tempSrcCanvas.getContext('2d');
            tempSrcCtx.fillStyle = '#fafaf5';
            tempSrcCtx.fillRect(0, 0, PRINTER_WIDTH, imgHeight);
            tempSrcCtx.drawImage(img, 0, 0, PRINTER_WIDTH, imgHeight);

            // Apply contrast, brightness, and dither
            const srcImgData = tempSrcCtx.getImageData(0, 0, PRINTER_WIDTH, imgHeight);
            const adjustedData = adjustBrightnessContrast(srcImgData.data, PRINTER_WIDTH, imgHeight, brightness, contrast);
            const ditheredPixels = applyDither(adjustedData, PRINTER_WIDTH, imgHeight, dither);

            tempDestCanvas.width = PRINTER_WIDTH;
            tempDestCanvas.height = imgHeight;
            const destCtx = tempDestCanvas.getContext('2d');
            const destImgData = destCtx.createImageData(PRINTER_WIDTH, imgHeight);

            for (let i = 0; i < ditheredPixels.length; i++) {
              const idx = i * 4;
              // 1 = black, 0 = white (thermal paper background matches '#fafaf5')
              const isBlack = ditheredPixels[i] === 1;
              destImgData.data[idx] = isBlack ? 0 : 250;     // R
              destImgData.data[idx + 1] = isBlack ? 0 : 250; // G
              destImgData.data[idx + 2] = isBlack ? 0 : 245; // B
              destImgData.data[idx + 3] = 255;               // A
            }
            destCtx.putImageData(destImgData, 0, 0);

            // Draw to receipt canvas
            ctx.drawImage(tempDestCanvas, 0, y + 5);
          };
          totalHeight += heightNeeded;
        } else {
          // Placeholder height while loading image
          const heightNeeded = 60;
          layout.height = heightNeeded;
          layout.draw = (y) => {
            ctx.fillStyle = '#64748b';
            ctx.fillRect(10, y + 5, PRINTER_WIDTH - 20, 50);
            ctx.fillStyle = '#ffffff';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Loading Image...', PRINTER_WIDTH / 2, y + 35);
            ctx.textAlign = 'left';
          };
          totalHeight += heightNeeded;
        }
      }

      itemLayouts.push(layout);
    });

    totalHeight += 40; // bottom padding and serrated edge spacing

    // 2. Adjust canvas height dynamically to fit the exact thermal paper output length
    canvas.width = PRINTER_WIDTH;
    canvas.height = totalHeight;

    // Fill paper background
    ctx.fillStyle = '#fafaf5';
    ctx.fillRect(0, 0, PRINTER_WIDTH, totalHeight);

    // Draw grid lines on the background to look like thermal paper texture
    ctx.strokeStyle = '#f1f1eb';
    ctx.lineWidth = 0.5;
    for (let i = 8; i < totalHeight; i += 8) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(PRINTER_WIDTH, i);
      ctx.stroke();
    }

    // 3. Execute all layout draw callbacks at their computed Y offsets
    itemLayouts.forEach((layout) => {
      if (layout.draw) {
        layout.draw(layout.y);
      }
    });

    // Draw vertical guide borders to show printable area bounds (384px)
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.4)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, totalHeight);
    ctx.moveTo(PRINTER_WIDTH, 0);
    ctx.lineTo(PRINTER_WIDTH, totalHeight);
    ctx.stroke();
    ctx.setLineDash([]);

  }, [items, imageElements, redrawTrigger]);

  /**
   * Fits lines of text to the printer character width constraint
   */
  function wrapTextLines(text, maxChars) {
    const paragraphs = text.split('\n');
    const allLines = [];
    
    paragraphs.forEach((p) => {
      if (!p.trim()) {
        allLines.push('');
        return;
      }
      const words = p.split(' ');
      let currentLine = '';

      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        
        if (word.length > maxChars) {
          if (currentLine) {
            allLines.push(currentLine);
            currentLine = '';
          }
          let remaining = word;
          while (remaining.length > maxChars) {
            allLines.push(remaining.substring(0, maxChars));
            remaining = remaining.substring(maxChars);
          }
          currentLine = remaining;
          continue;
        }

        const testLine = currentLine ? currentLine + ' ' + word : word;
        if (testLine.length <= maxChars) {
          currentLine = testLine;
        } else {
          allLines.push(currentLine);
          currentLine = word;
        }
      }
      if (currentLine) {
        allLines.push(currentLine);
      }
    });
    
    return allLines;
  }

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="relative receipt-paper overflow-hidden rounded-t shadow-2xl max-w-[400px]">
        {/* Paper feeder indicator header */}
        <div className="h-2 bg-slate-300 w-full opacity-60"></div>
        <div className="receipt-content p-1">
          <canvas ref={canvasRef} className="block w-[384px] mx-auto" />
        </div>
      </div>
      <div className="w-[384px] h-3 flex items-center justify-between px-1">
        <div className="w-2 h-2 rounded-full bg-slate-800 opacity-20"></div>
        <div className="text-[10px] text-slate-500 font-mono select-none tracking-widest">--- PAPER CUT LINE ---</div>
        <div className="w-2 h-2 rounded-full bg-slate-800 opacity-20"></div>
      </div>
    </div>
  );
}
