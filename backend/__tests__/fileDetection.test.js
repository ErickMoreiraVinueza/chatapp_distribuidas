import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { detectSteganography } from '../src/utils/steganographyDetector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samplesDir = path.join(__dirname, 'samples');

const writeSample = (name, buffer) => {
  if (!fs.existsSync(samplesDir)) fs.mkdirSync(samplesDir, { recursive: true });
  const p = path.join(samplesDir, name);
  fs.writeFileSync(p, Buffer.from(buffer));
  return p;
};

describe('detectSteganography - sample file detection', () => {
  const files = [];

  afterAll(() => {
    // limpiar
    for (const f of files) {
      try { fs.unlinkSync(f); } catch (e) {}
    }
    try { fs.rmdirSync(samplesDir); } catch (e) {}
  });

  test('detect JPEG', async () => {
    const buf = [0xFF,0xD8,0xFF,0xE0,0x00,0x10,0x4A,0x46,0x49,0x46,0x00,0x01,0xFF,0xD9];
    const p = writeSample('sample.jpg', buf);
    files.push(p);
    const res = await detectSteganography(p);
    expect(res.detectedType).toBe('JPEG');
    expect(res.safe).toBe(true);
  });

  test('detect MP4', async () => {
    // minimal ftyp box near start
    const buf = [0x00,0x00,0x00,0x18,0x66,0x74,0x79,0x70,0x6D,0x70,0x34,0x32,0x00,0x00,0x00];
    const p = writeSample('sample.mp4', buf);
    files.push(p);
    const res = await detectSteganography(p);
    expect(res.detectedType).toBe('MP4');
    expect(res.safe).toBe(true);
  });

  test('detect WEBP', async () => {
    const buf = [0x52,0x49,0x46,0x46,0x00,0x00,0x00,0x00,0x57,0x45,0x42,0x50,0x2A,0x2A];
    const p = writeSample('sample.webp', buf);
    files.push(p);
    const res = await detectSteganography(p);
    expect(res.detectedType).toBe('WEBP');
    expect(res.safe).toBe(true);
  });

  test('detect AVI (RIFF/AVI )', async () => {
    const buf = [0x52,0x49,0x46,0x46,0x00,0x00,0x00,0x00,0x41,0x56,0x49,0x20,0x00];
    const p = writeSample('sample.avi', buf);
    files.push(p);
    const res = await detectSteganography(p);
    expect(res.detectedType).toBe('AVI');
    expect(res.safe).toBe(true);
  });

  test('detect MKV (EBML)', async () => {
    const buf = [0x1A,0x45,0xDF,0xA3,0x42,0x82,0x88,0x6D,0x61,0x74,0x00,0x00,0x11,0x22,0x33,0x44];
    const p = writeSample('sample.mkv', buf);
    files.push(p);
    const res = await detectSteganography(p);
    expect(res.detectedType).toBe('MKV');
    expect(res.safe).toBe(true);
  });

  test('detect PDF', async () => {
    const buf = [0x25,0x50,0x44,0x46,0x2D,0x31,0x2E,0x34,0x0A,0x25,0x25,0x0A,0x00,0x11,0x22,0x33];
    const p = writeSample('sample.pdf', buf);
    files.push(p);
    const res = await detectSteganography(p);
    expect(res.detectedType).toBe('PDF');
    expect(res.safe).toBe(true);
  });

  test('detect PDF with embedded JPEG that contains hidden ZIP signature', async () => {
    // JPEG minimal header/footer plus some data and then a ZIP signature embedded
    const jpeg = Buffer.from([0xFF,0xD8,0xFF,0xE0,0x00,0x10,0x4A,0x46,0x49,0x46,0x00,0x01,0x11,0x22,0x33,0xFF,0xD9]);
    const zipSig = Buffer.from([0x50,0x4B,0x03,0x04,0x14,0x00,0x00,0x00]);
    const imgWithZip = Buffer.concat([jpeg, Buffer.from([0x00,0xAA,0xBB,0xCC]), zipSig, Buffer.from([0x01,0x02])]);

    const header = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /XObject /Subtype /Image /Filter /DCTDecode >>\nstream\n','latin1');
    const footer = Buffer.from('\nendstream\nendobj\n','latin1');
    const pdfBuf = Buffer.concat([header, imgWithZip, footer]);

    const p = writeSample('sample_pdf_with_hidden.zip.pdf', pdfBuf);
    files.push(p);

    const res = await detectSteganography(p);
    expect(res.detectedType).toBe('PDF');
    // Debe detectar al menos una detección oculta (ZIP) dentro de la imagen embebida
    const hidden = res.hiddenFiles || [];
    const pdfImgs = res.pdfImageAnalysis || [];
    const foundZip = hidden.some(h => h.type === 'ZIP') || pdfImgs.some(img => (img.hiddenFiles || []).some(h=>h.type==='ZIP'));
    expect(foundZip).toBe(true);
    expect(res.safe).toBe(false);
  });
});
