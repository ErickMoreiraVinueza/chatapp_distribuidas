import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { detectSteganography } from '../src/utils/steganographyDetector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'uploads');

(async () => {
  try {
    if (!fs.existsSync(uploadsDir)) {
      console.log('No existe carpeta uploads:', uploadsDir);
      process.exit(0);
    }

    const files = fs.readdirSync(uploadsDir);
    if (!files.length) {
      console.log('No hay archivos en uploads');
      process.exit(0);
    }

    for (const f of files) {
      const filePath = path.join(uploadsDir, f);
      try {
        const stats = fs.statSync(filePath);
        if (!stats.isFile()) continue;
        const analysis = await detectSteganography(filePath);
        console.log('--- FILE:', f);
        console.log(JSON.stringify({ file: f, size: stats.size, analysis }, null, 2));
      } catch (err) {
        console.log('Error analizando', f, err.message);
      }
    }
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
