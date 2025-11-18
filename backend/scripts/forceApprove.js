import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'uploads');
const quarantineDir = path.join(uploadsDir, 'quarantine');
const approvedDir = path.join(uploadsDir, 'approved');

const ensureDir = (d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); };

(async () => {
  ensureDir(approvedDir);
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Uso: node scripts/forceApprove.js <filename_en_quarantine>');
    process.exit(1);
  }
  const filename = args.join(' ');
  const src = path.join(quarantineDir, filename);
  if (!fs.existsSync(src)) {
    console.error('No existe el archivo en quarantine:', src);
    process.exit(1);
  }
  const dest = path.join(approvedDir, filename);
  fs.renameSync(src, dest);
  console.log('Archivo movido a approved:', dest);
  console.warn('ATENCIÓN: Has forzado la aprobación del archivo. Esto reduce la seguridad.');
})();
