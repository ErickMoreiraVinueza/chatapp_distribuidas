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
    
    if (!stegoAnalysis.safe) {
      // Eliminar archivo sospechoso
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
    
    // 🔒 PASO 3: Validar que el tipo MIME coincida con el contenido real
    const mimeTypeMap = {
      'JPEG': ['image/jpeg', 'image/jpg'],
      'PNG': ['image/png'],
      'GIF': ['image/gif'],
      'BMP': ['image/bmp'],
      'WEBP': ['image/webp'],
      'PDF': ['application/pdf']
    };
    
    const expectedMimes = mimeTypeMap[stegoAnalysis.detectedType] || [];
    if (expectedMimes.length > 0 && !expectedMimes.includes(file.mimetype)) {
      fs.unlinkSync(file.path);
      secureLog("⚠️", "MIME type no coincide con contenido", {
        roomId,
        declaredMime: file.mimetype,
        detectedType: stegoAnalysis.detectedType,
        expectedMimes: expectedMimes.join(', ')
      });
      return res.status(403).json({
        message: "Tipo de archivo no coincide",
        reason: `El archivo dice ser ${file.mimetype} pero su contenido es ${stegoAnalysis.detectedType}`,
        details: "Posible intento de falsificación de tipo de archivo"
      });
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
