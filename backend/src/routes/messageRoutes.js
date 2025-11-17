import express from "express";
import Message from "../models/Message.js";
import { deleteMessage, editMessage } from "../controllers/messageController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Obtener mensajes de una sala
router.get("/room/:roomId", async (req, res) => {
  try {
    const { roomId } = req.params;
    const messages = await Message.find({ room: roomId }).sort({ timestamp: 1 });
    
    // Desencriptar mensajes antes de enviar
    const decryptedMessages = Message.decryptMessages(messages);
    
    res.json(decryptedMessages);
  } catch (err) {
    errorLog("Error obteniendo mensajes", err, { roomId: req.params.roomId });
    res.status(500).json({ message: "Error al obtener mensajes" });
  }
});

// Eliminar mensaje (requiere autenticación)
router.delete("/:id", protect, deleteMessage);

// Editar mensaje (requiere autenticación)
router.put("/:id", protect, editMessage);

export default router;
