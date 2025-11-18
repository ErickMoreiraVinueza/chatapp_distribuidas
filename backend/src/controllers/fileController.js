import Message from "../models/Message.js";
import Room from "../models/Room.js";
import { detectSteganography, quickValidation } from "../utils/steganographyDetector.js";
import fs from "fs";
import { secureLog, errorLog } from "../utils/logger.js";

export const uploadFile = async (req, res) => {
  try {
    const { roomId, sender } = req.body;
    const file = req.file;

    if (!file) {
      errorLog("No se recibió archivo", new Error("Missing file"));
      return res.status(400).json({ message: "No se recibió archivo" });
    }

    if (!roomId || !sender) {
      errorLog("Faltan datos obligatorios", new Error("Missing roomId or sender"));
      return res.status(400).json({ message: "Faltan datos obligatorios (roomId, sender)" });
    }

    // 🔒 PASO 1: Validación rápida por extensión y MIME
    const quickCheck = quickValidation(file.mimetype, file.originalname);
    if (!quickCheck.safe) {
      // Eliminar archivo inmediatamente
      fs.unlinkSync(file.path);
      secureLog("🚫", "Archivo bloqueado (validación rápida)", { 
        roomId, 
        mimetype: file.mimetype,
        reason: quickCheck.reason 
      });
      return res.status(403).json({ 
        message: "Archivo no permitido", 
        reason: quickCheck.reason 
      });
    }

    // 🔒 PASO 2: Análisis profundo de esteganografía
    secureLog("🔍", "Analizando archivo por esteganografía", { roomId, mimetype: file.mimetype });
    const stegoAnalysis = await detectSteganography(file.path);
    // --- DEBUG LOGS (temporal) ------------------------------------------
    try {
      let fileSize = file.size || null;
      try {
        if (!fileSize) {
          const stats = fs.statSync(file.path);
          fileSize = stats.size;
        }
      } catch (e) {
        // ignore stat error
      }

      secureLog("DEBUG_UPLOAD", "Debug upload info", {
        roomId,
        originalName: file.originalname,
        declaredMime: file.mimetype,
        detectedMime: stegoAnalysis.detectedMime || null,
        detectedType: stegoAnalysis.detectedType,
        filePath: file.path,
        fileSize
      });
    } catch (logErr) {
      // ignore logging errors
    }
    // ---------------------------------------------------------------------
    
    if (!stegoAnalysis.safe) {
      // Minimal security policy for multimedia and common document/archive types:
      // Allow the upload for these types unless the file is corrupted or there are
      // CRITICAL detections that are NOT executables (EXE). This keeps a minimal
      // safety net while avoiding false-positives for common user files.
      const relaxTypes = [
        "MP4","WEBM","MKV","AVI","WAV","MP3",
        "PDF","ZIP","DOCX","XLSX","PPTX","TXT","RAR","7Z","ODT"
      ];
      const detectedType = stegoAnalysis.detectedType;

      if (relaxTypes.includes(detectedType) && !stegoAnalysis.corrupted) {
        const hidden = stegoAnalysis.hiddenFiles || [];
        const critical = hidden.filter(f => f.risk === 'CRITICAL');
        const nonExeCritical = critical.filter(f => f.type !== 'EXE');

        if (nonExeCritical.length === 0) {
          // minimal security: allow file despite EXE signatures
          secureLog("⚠️", "MINIMAL FILE SECURITY: permitiendo archivo a pesar de detecciones EXE", {
            roomId,
            detectedType: stegoAnalysis.detectedType,
            detectedMime: stegoAnalysis.detectedMime || null,
            criticalCount: critical.length,
            details: stegoAnalysis.details
          });
          // continue processing (don't block)
        } else {
          // Hay detecciones críticas de tipo distinto a EXE -> bloquear
          fs.unlinkSync(file.path);
          secureLog("⛔", "ARCHIVO BLOQUEADO - Esteganografía detectada (critico no-EXE)", {
            roomId,
            detectedType: stegoAnalysis.detectedType,
            entropy: stegoAnalysis.entropy,
            hiddenFiles: stegoAnalysis.hiddenFiles?.length || 0,
            corrupted: stegoAnalysis.corrupted || false,
            details: stegoAnalysis.details
          });
          return res.status(403).json({ 
            message: "Archivo sospechoso bloqueado",
            reason: stegoAnalysis.corrupted 
              ? "El archivo está corrupto o tiene una estructura inválida"
              : "Se detectó contenido oculto o esteganografía en el archivo",
            details: stegoAnalysis.details
          });
        }
      } else {
        // No es un tipo con política mínima o está corrupto -> bloquear
        fs.unlinkSync(file.path);
        secureLog("⛔", "ARCHIVO BLOQUEADO - Esteganografía detectada", {
          roomId,
          detectedType: stegoAnalysis.detectedType,
          entropy: stegoAnalysis.entropy,
          hiddenFiles: stegoAnalysis.hiddenFiles?.length || 0,
          corrupted: stegoAnalysis.corrupted || false,
          details: stegoAnalysis.details
        });
        return res.status(403).json({ 
          message: "Archivo sospechoso bloqueado",
          reason: stegoAnalysis.corrupted 
            ? "El archivo está corrupto o tiene una estructura inválida"
            : "Se detectó contenido oculto o esteganografía en el archivo",
          details: stegoAnalysis.details
        });
      }
    }
    
    // 🔒 PASO 3: Validar que el tipo MIME coincida con el contenido real
    const mimeTypeMap = {
      'JPEG': ['image/jpeg', 'image/jpg'],
      'PNG': ['image/png'],
      'GIF': ['image/gif'],
      'BMP': ['image/bmp'],
      'WEBP': ['image/webp'],
      'PDF': ['application/pdf'],
      'MP4': ['video/mp4', 'video/quicktime'],
      'WEBM': ['video/webm'],
      'MKV': ['video/x-matroska', 'video/webm'],
      'AVI': ['video/x-msvideo'],
      'WAV': ['audio/wav', 'audio/x-wav'],
      'MP3': ['audio/mpeg'],
      'ZIP': ['application/zip'],
      'DOCX': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      'XLSX': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      'PPTX': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
      'TXT': ['text/plain'],
      'RAR': ['application/x-rar-compressed', 'application/vnd.rar'],
      '7Z': ['application/x-7z-compressed'],
      'ODT': ['application/vnd.oasis.opendocument.text']
    };
    
    const expectedMimes = mimeTypeMap[stegoAnalysis.detectedType] || [];
    // Allow if declared mimetype matches expected OR if detector reported a mime that matches expected
    const declaredMime = file.mimetype;
    const detectedMime = stegoAnalysis.detectedMime || null;

    const declaredMatches = expectedMimes.length > 0 && expectedMimes.includes(declaredMime);
    const detectedMatches = expectedMimes.length > 0 && detectedMime && expectedMimes.includes(detectedMime);

    if (expectedMimes.length > 0 && !(declaredMatches || detectedMatches)) {
      // Special-case: OOXML files (docx/pptx/xlsx) are ZIP containers.
      // If the client declared an OOXML MIME but the detector reports ZIP,
      // allow the upload when the original filename extension matches the declared MIME.
      const ooxmlMimes = {
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx'
      };

      const declaredExt = file.originalname ? file.originalname.split('.').pop()?.toLowerCase() : null;
      const declaredExtWithDot = declaredExt ? `.${declaredExt}` : null;

      if (stegoAnalysis.detectedType === 'ZIP' && declaredMime in ooxmlMimes && declaredExtWithDot === ooxmlMimes[declaredMime]) {
        secureLog("⚠️", "MIME mismatch but allowing OOXML ZIP (docx/pptx/xlsx)", {
          roomId,
          declaredMime,
          detectedType: stegoAnalysis.detectedType,
          originalName: file.originalname
        });
        // allow to continue processing
      } else {
        fs.unlinkSync(file.path);
        secureLog("⚠️", "MIME type no coincide con contenido", {
          roomId,
          declaredMime,
          detectedType: stegoAnalysis.detectedType,
          expectedMimes: expectedMimes.join(', ')
        });
        return res.status(403).json({
          message: "Tipo de archivo no coincide",
          reason: `El archivo dice ser ${declaredMime} pero su contenido es ${stegoAnalysis.detectedType}`,
          details: "Posible intento de falsificación de tipo de archivo"
        });
      }
    }

    secureLog("✅", "Archivo aprobado análisis de seguridad", { 
      roomId, 
      detectedType: stegoAnalysis.detectedType,
      entropy: stegoAnalysis.entropy 
    });

    // Confirmar datos sin información sensible
    secureLog("�", "Procesando archivo aprobado", { roomId, mimetype: file.mimetype });

    // Buscar sala
    const room = await Room.findById(roomId);
    if (!room) {
      fs.unlinkSync(file.path); // Limpiar archivo
      errorLog("Sala no encontrada", new Error("Room not found"), { roomId });
      return res.status(404).json({ message: "Sala no encontrada" });
    }

    // ✅ Validar que la sala sea multimedia
    if (room.type !== "multimedia") {
      fs.unlinkSync(file.path); // Limpiar archivo
      secureLog("⚠️", "Sala no permite archivos", { roomId, roomType: room.type });
      return res.status(403).json({ message: "Esta sala no permite archivos. Solo salas multimedia pueden compartir archivos." });
    }

    // Construir URL del archivo
    const fileUrl = `/uploads/${file.filename}`;

    // Guardar mensaje en Mongo
    const message = new Message({
      room: roomId,
      sender,
      content: fileUrl,
      type: "file",
    });

    await message.save();
    secureLog("✅", "Archivo guardado en base de datos", { 
      roomId, 
      mimetype: file.mimetype,
      messageId: message._id 
    });

    res.status(200).json({
      message: "Archivo subido correctamente",
      fileUrl: fileUrl,
      fileName: file.originalname,
      messageId: message._id,
    });
  } catch (error) {
    // Limpiar archivo si hubo error
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        // Ignorar error de limpieza
      }
    }
    errorLog("Error al subir archivo", error, { roomId: req.body.roomId });
    res.status(500).json({ message: "Error al subir archivo", error: error.message });
  }
};
