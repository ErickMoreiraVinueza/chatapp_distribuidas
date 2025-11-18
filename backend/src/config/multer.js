import multer from "multer";
import path from "path";
import { secureLog } from "../utils/logger.js";
import fs from "fs";

// Crear carpeta si no existe
const uploadDir = "uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    // conservar extensión original pero usa path.extname para seguridad
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  },
});

// MIME-based filters (más robusto que usar solo la extensión)
const imageMimeTypes = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  // intentionally excluding image/svg+xml (SVG) - handle separately if needed
];

const generalMimeTypes = [
  // imágenes
  ...imageMimeTypes,
  // videos
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  // audio
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  // documentos
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // presentaciones PowerPoint (ppt / pptx)
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // OpenDocument Text
  "application/vnd.oasis.opendocument.text",
  // comprimidos
  "application/zip",
  // texto
  "text/plain",
];

const imageFilter = (req, file, cb) => {
  if (!file || !file.mimetype) return cb(new Error('No file or mimetype'), false);
  if (imageMimeTypes.includes(file.mimetype.toLowerCase())) {
    cb(null, true);
  } else {
    console.log("❌ Tipo de imagen no permitido:", file.originalname, file.mimetype);
    cb(new Error(`Tipo de imagen no permitido: ${file.mimetype}`), false);
  }
};

const generalFilter = (req, file, cb) => {
  if (!file || !file.mimetype) return cb(new Error('No file or mimetype'), false);
  const mime = file.mimetype.toLowerCase();
  if (generalMimeTypes.includes(mime)) {
    cb(null, true);
    return;
  }

  // Algunos navegadores/clients envían 'application/octet-stream' para archivos
  // de Office/Texto. Permitirlo si la extensión del archivo es conocida y segura.
  if (mime === 'application/octet-stream') {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExts = [
      '.txt', '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.zip', '.rar', '.7z'
    ];
    if (allowedExts.includes(ext)) {
      cb(null, true);
      return;
    }
  }

  console.log("❌ Tipo de archivo no permitido (general):", file.originalname, file.mimetype);
  cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`), false);
};

// Límite de tamaño (50 MB)
export const upload = multer({
  storage,
  fileFilter: generalFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Exportar un middleware específico para imágenes (endpoints que solo aceptan imágenes)
export const uploadImage = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // límite más estricto para imágenes (10MB)
});
