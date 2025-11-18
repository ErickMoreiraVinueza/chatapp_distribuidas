import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { detectSteganography } from '../src/utils/steganographyDetector.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'uploads');
const quarantineDir = path.join(uploadsDir, 'quarantine');
const cleanDir = path.join(uploadsDir, 'clean');
const approvedDir = path.join(uploadsDir, 'approved');

const videoTypes = new Set(['MP4','WEBM','MKV','AVI']);
const audioTypes = new Set(['MP3','WAV']);

const ensureDir = (d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); };

const getFfmpegCmd = () => {
  // Allow overriding ffmpeg path with env var FFMPEG_PATH
  return process.env.FFMPEG_PATH || 'ffmpeg';
};

const ffmpegExists = async (cmd) => {
  try {
    await execFileAsync(cmd, ['-version']);
    return true;
  } catch (e) {
    return false;
  }
};

const reencodeVideo = async (inputPath, outputPath) => {
  // Re-encode to mp4 with h.264 + aac
  const args = ['-y', '-i', inputPath, '-c:v', 'libx264', '-crf', '23', '-preset', 'medium', '-c:a', 'aac', '-b:a', '128k', outputPath];
  await execFileAsync('ffmpeg', args, { windowsHide: true });
};

const reencodeAudioMp3 = async (inputPath, outputPath) => {
  const args = ['-y', '-i', inputPath, '-c:a', 'libmp3lame', '-b:a', '192k', outputPath];
  await execFileAsync('ffmpeg', args, { windowsHide: true });
};

(async () => {
  ensureDir(quarantineDir);
  ensureDir(cleanDir);
  ensureDir(approvedDir);

  const ffmpegCmd = getFfmpegCmd();
  const ff = await ffmpegExists(ffmpegCmd);
  if (!ff) {
    console.error(`ffmpeg no encontrado en PATH ni en FFMPEG_PATH (${ffmpegCmd}). Instala ffmpeg o añade su ruta al PATH.`);
    process.exit(1);
  }

  if (!fs.existsSync(uploadsDir)) {
    console.log('No existe carpeta uploads. Nada que procesar.');
    process.exit(0);
  }

  const files = fs.readdirSync(uploadsDir).filter(f => f !== 'quarantine' && f !== 'clean' && f !== 'approved');
  if (!files.length) {
    console.log('No hay archivos en uploads.');
    process.exit(0);
  }

  for (const f of files) {
    const inputPath = path.join(uploadsDir, f);
    try {
      const stats = fs.statSync(inputPath);
      if (!stats.isFile()) continue;

      console.log('Analizando:', f);
      const analysis = await detectSteganography(inputPath);
      console.log('Resultado:', analysis.detectedType, 'safe=', analysis.safe);

      if (analysis.safe) {
        console.log('Archivo seguro, saltando:', f);
        continue;
      }

      const dtype = analysis.detectedType;
      if (videoTypes.has(dtype)) {
        console.log('Intentando re-encode video:', f);
        const baseName = path.parse(f).name;
        const out = path.join(cleanDir, `${baseName}_reenc.mp4`);
        try {
          // use provided ffmpegCmd when calling
          await execFileAsync(ffmpegCmd, ['-y', '-i', inputPath, '-c:v', 'libx264', '-crf', '23', '-preset', 'medium', '-c:a', 'aac', '-b:a', '128k', out], { windowsHide: true });
          console.log('Re-encode completado:', out);
          const newAnalysis = await detectSteganography(out);
          console.log('Nuevo análisis:', newAnalysis.detectedType, 'safe=', newAnalysis.safe);
          if (newAnalysis.safe) {
            // mover original a quarantine, mover nuevo a approved
            fs.renameSync(inputPath, path.join(quarantineDir, f));
            fs.renameSync(out, path.join(approvedDir, path.basename(out)));
            console.log('Archivo reencodificado aprobado. Original movido a quarantine.');
          } else {
            // mover todo a quarantine
            fs.renameSync(inputPath, path.join(quarantineDir, f));
            fs.renameSync(out, path.join(quarantineDir, path.basename(out)));
            console.log('Re-encode no limpió el archivo. Ambos movidos a quarantine.');
          }
        } catch (e) {
          console.error('Error re-encode video:', e.message);
          // mover original a quarantine
          fs.renameSync(inputPath, path.join(quarantineDir, f));
        }
      } else if (audioTypes.has(dtype)) {
        console.log('Intentando re-encode audio:', f);
        const baseName = path.parse(f).name;
        const out = path.join(cleanDir, `${baseName}_reenc.mp3`);
        try {
          await execFileAsync(ffmpegCmd, ['-y', '-i', inputPath, '-c:a', 'libmp3lame', '-b:a', '192k', out], { windowsHide: true });
          console.log('Re-encode audio completado:', out);
          const newAnalysis = await detectSteganography(out);
          console.log('Nuevo análisis:', newAnalysis.detectedType, 'safe=', newAnalysis.safe);
          if (newAnalysis.safe) {
            fs.renameSync(inputPath, path.join(quarantineDir, f));
            fs.renameSync(out, path.join(approvedDir, path.basename(out)));
            console.log('Audio reencodificado aprobado. Original movido a quarantine.');
          } else {
            fs.renameSync(inputPath, path.join(quarantineDir, f));
            fs.renameSync(out, path.join(quarantineDir, path.basename(out)));
            console.log('Re-encode audio no limpió el archivo. Ambos movidos a quarantine.');
          }
        } catch (e) {
          console.error('Error re-encode audio:', e.message);
          fs.renameSync(inputPath, path.join(quarantineDir, f));
        }
      } else {
        // no es video/audio o no soportado -> mover a quarantine
        console.log('No es video/audio reconocido o no es seguro: moviendo a quarantine:', f);
        fs.renameSync(inputPath, path.join(quarantineDir, f));
      }
    } catch (err) {
      console.error('Error procesando', f, err.message);
      try { fs.renameSync(inputPath, path.join(quarantineDir, f)); } catch (e) {}
    }
  }

  console.log('Proceso finalizado. Revisa carpetas quarantine/approved/clean.');
})();
