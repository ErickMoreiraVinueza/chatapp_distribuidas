import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import app from "./app.js";
import { connectDB } from "./config/db.js";
import { initializeAdmin } from "./config/initAdmin.js";
import Message from "./models/Message.js";
import Room from "./models/Room.js";
import User from "./models/User.js";
import roomAdminRoutes from "./routes/roomAdminRoutes.js";
import { encrypt, decrypt } from "./utils/encryption.js";
import { secureLog, errorLog, systemLog } from "./utils/logger.js";

dotenv.config();

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN,
    methods: ["GET", "POST"],
  },
});

// Conectar a la base de datos e inicializar admin
connectDB().then(() => {
  initializeAdmin();
});

// Lista de usuarios activos
const activeUsers = {};

// Lista de usuarios expulsados por sala
const kickedUsers = {}; // { roomId: [nickname1, nickname2, ...] }

// Control de sesión única por usuario (nickname + dispositivo)
const userSessions = {}; // { nickname: { socketId, roomId, lastActivity } }

// ✅ Bloqueo temporal para evitar reconexiones inmediatas
const reconnectCooldown = {}; // { "nickname:socketId": timestamp }
const COOLDOWN_TIME = 10000; // 3 segundos de cooldown

// ✅ DESCONEXIÓN POR INACTIVIDAD
const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutos
const CHECK_INTERVAL = 30 * 1000; // Revisar cada 30 segundos

// Verificar inactividad periódicamente
setInterval(() => {
  const now = Date.now();
  
  for (const nickname in userSessions) {
    const session = userSessions[nickname];
    const inactiveTime = now - session.lastActivity;
    
    if (inactiveTime > INACTIVITY_TIMEOUT) {
      const socket = io.sockets.sockets.get(session.socketId);
      
      if (socket) {
        console.log(`⏰ Usuario desconectado por inactividad (${Math.floor(inactiveTime / 1000)}s) - Socket: ${session.socketId}`);
        
        // Notificar al usuario
        socket.emit("inactivityDisconnect", {
          message: "Has sido desconectado por inactividad"
        });
        
        // Limpiar de la sala
        if (activeUsers[session.roomId]) {
          activeUsers[session.roomId] = activeUsers[session.roomId].filter(
            u => u.nickname !== nickname
          );
          
          io.to(session.roomId).emit("systemMessage", {
            content: `${nickname} fue desconectado por inactividad`,
            timestamp: new Date(),
          });
          
          io.to(session.roomId).emit("activeUsersUpdate", activeUsers[session.roomId]);
        }
        
        // Desconectar
        socket.disconnect(true);
      }
      
      // Limpiar sesión
      delete userSessions[nickname];
    }
  }
}, CHECK_INTERVAL);

io.on("connection", (socket) => {
  console.log("🟢 Usuario conectado:", socket.id);

  // Unirse a sala
  socket.on("joinRoom", async ({ pin, nickname }) => {
    try {
      const room = await Room.findOne({ pin });
      if (!room) {
        socket.emit("errorMessage", "PIN inválido");
        return;
      }

      const roomId = room._id.toString();

      // ✅ Verificar si el usuario está en la lista negra de esta sala
      if (kickedUsers[roomId] && kickedUsers[roomId].includes(nickname)) {
        socket.emit("kicked", {
          message: "Has sido expulsado de esta sala y no puedes volver a entrar"
        });
        secureLog("🚫", "Usuario expulsado intentó entrar", { roomId, socketId: socket.id });
        return;
      }

      // ✅ Verificar cooldown de reconexión (bloquear socket que fue desconectado)
      const cooldownKey = `${nickname}:${socket.id}`;
      if (reconnectCooldown[cooldownKey]) {
        const timeSinceBlock = Date.now() - reconnectCooldown[cooldownKey];
        if (timeSinceBlock < COOLDOWN_TIME) {
          secureLog("⏱️", "Usuario en cooldown", { socketId: socket.id, cooldownMs: COOLDOWN_TIME - timeSinceBlock });
          socket.emit("sessionReplaced", {
            message: "Tu sesión fue reemplazada por otro dispositivo. Espera unos segundos."
          });
          return;
        } else {
          // Cooldown expirado, eliminar
          delete reconnectCooldown[cooldownKey];
        }
      }

      // ✅ VALIDACIÓN: Sesión única por dispositivo
      if (userSessions[nickname]) {
        const existingSession = userSessions[nickname];
        const oldRoomId = existingSession.roomId;
        const oldSocketId = existingSession.socketId;
        
        secureLog("⚠️", "Sesión duplicada detectada", { oldSocketId, newSocketId: socket.id });
        
        // Verificar si es el MISMO socket intentando reconectarse
        if (oldSocketId === socket.id) {
          secureLog("🔄", "Reconexión del mismo socket permitida", { socketId: socket.id });
          // Es una reconexión del mismo socket, actualizar timestamp
          userSessions[nickname].lastActivity = Date.now();
          userSessions[nickname].roomId = roomId;
        } else {
          // Es un socket DIFERENTE, necesitamos reemplazar la sesión
          const oldSocket = io.sockets.sockets.get(oldSocketId);
          
          if (oldSocket) {
            // Socket anterior existe, desconectarlo
            secureLog("🔄", "Desconectando sesión anterior", { oldSocketId });
            
            // Bloquear reconexión inmediata del socket anterior
            const oldCooldownKey = `${nickname}:${oldSocketId}`;
            reconnectCooldown[oldCooldownKey] = Date.now();
            secureLog("🚫", "Cooldown activado", { cooldownMs: COOLDOWN_TIME });
            
            oldSocket.emit("sessionReplaced", {
              message: "Tu sesión ha sido reemplazada por otro dispositivo"
            });
            
            oldSocket.leave(oldRoomId);
            oldSocket.disconnect(true);
            
            // Limpiar de la sala anterior
            if (activeUsers[oldRoomId]) {
              activeUsers[oldRoomId] = activeUsers[oldRoomId].filter(
                u => u.nickname !== nickname
              );
              
              // Notificar a la sala anterior
              io.to(oldRoomId).emit("systemMessage", {
                content: `${nickname} se desconectó (sesión desde otro dispositivo)`,
                timestamp: new Date(),
              });
              
              io.to(oldRoomId).emit("activeUsersUpdate", activeUsers[oldRoomId]);
            }
          } else {
            // Socket anterior NO existe (ya desconectado), solo limpiar
            console.log(`🧹 Socket anterior de ${nickname} ya no existe, limpiando sesión antigua`);
            
            if (activeUsers[oldRoomId]) {
              activeUsers[oldRoomId] = activeUsers[oldRoomId].filter(
                u => u.nickname !== nickname
              );
              io.to(oldRoomId).emit("activeUsersUpdate", activeUsers[oldRoomId]);
            }
          }
          
          // IMPORTANTE: Eliminar la sesión anterior antes de crear la nueva
          delete userSessions[nickname];
        }
      }

      // Registrar nueva sesión
      userSessions[nickname] = {
        socketId: socket.id,
        roomId: roomId,
        lastActivity: Date.now()
      };
      
      secureLog("✅", "Sesión registrada", { nickname, socketId: socket.id, roomId });

      socket.join(roomId);
      if (!activeUsers[roomId]) activeUsers[roomId] = [];

      // 🧹 IMPORTANTE: Limpiar cualquier entrada previa de este nickname en esta sala
      activeUsers[roomId] = activeUsers[roomId].filter(
        (u) => u.nickname !== nickname
      );

      // Ahora sí, añadir el usuario con el nuevo socketId
      activeUsers[roomId].push({ nickname, socketId: socket.id });

      // Emitir mensaje de bienvenida
      io.to(roomId).emit("systemMessage", {
        content: ` ${nickname} se unió a la sala`,
        timestamp: new Date(),
      });

      // Actualizar lista de usuarios activos
      io.to(roomId).emit(
        "activeUsersUpdate",
        activeUsers[roomId]
      );

      secureLog("👤", "Usuario unido a sala", { nickname, roomId });
    } catch (err) {
      errorLog("Error al unir a la sala", err, { roomId });
    }
  });

  // Enviar mensaje o archivo
  socket.on("sendMessage", async ({ roomId, sender, content, type, fileName, messageId }) => {
    // Log sin datos sensibles
    console.log("📩 Mensaje recibido - Tipo:", type, "- Sala:", roomId);
    try {
      if (!roomId || !sender) {
        console.log("❌ Faltan datos del mensaje");
        socket.emit("errorMessage", "Sala no encontrada o datos incompletos");
        return;
      }

      // ✅ Actualizar actividad del usuario
      if (userSessions[sender]) {
        userSessions[sender].lastActivity = Date.now();
      }

      // Si es archivo, no guardar nuevamente (ya se guardó en el controller)
      // Solo propagar el mensaje a todos los usuarios (desencriptado)
      if (type === "file") {
        const savedMessage = await Message.findById(messageId);
        if (savedMessage) {
          const decrypted = savedMessage.decryptMessage();
          io.to(roomId).emit("newMessage", {
            _id: decrypted._id,
            sender: decrypted.sender,
            content: content, // La URL no se encripta
            type: "file",
            timestamp: decrypted.timestamp,
            fileName,
          });
          console.log(`📎 Archivo propagado en sala ${roomId}`);
        }
        return;
      }

      app.use("/api/admin/rooms", roomAdminRoutes);

      // Si es mensaje de texto normal, guardarlo (se encriptará automáticamente)
      const message = new Message({ room: roomId, sender, content, type: type || "text" });
      await message.save();

      // Desencriptar para enviar a los clientes
      const decryptedMessage = message.decryptMessage();

      io.to(roomId).emit("newMessage", {
        _id: decryptedMessage._id,
        sender: decryptedMessage.sender,
        content: decryptedMessage.content,
        type: decryptedMessage.type || "text",
        timestamp: decryptedMessage.timestamp,
      });
      secureLog("💬", "Mensaje enviado", { roomId, type: decryptedMessage.type });
    } catch (err) {
      errorLog("Error al enviar mensaje", err, { roomId });
      socket.emit("errorMessage", "Error al enviar mensaje");
    }
  });

  // Eliminar mensaje
  socket.on("deleteMessage", async ({ messageId, roomId, nickname, isAdmin }) => {
    try {
      const message = await Message.findById(messageId);
      if (!message) {
        socket.emit("errorMessage", "Mensaje no encontrado");
        return;
      }

      // Verificar permisos: debe ser el autor o admin de la sala
      const room = await Room.findById(roomId);
      const isRoomAdmin = room && room.createdBy && 
                          (await User.findOne({ username: nickname, _id: room.createdBy })) !== null;

      if (message.sender !== nickname && !isRoomAdmin) {
        socket.emit("errorMessage", "No tienes permiso para eliminar este mensaje");
        return;
      }

      message.content = isRoomAdmin
        ? "🗑️ Mensaje eliminado por el administrador"
        : "🗑️ Mensaje eliminado";
      message.type = "deleted";
      await message.save();

      io.to(roomId).emit("messageDeleted", { 
        id: messageId,
        newContent: message.content 
      });
      secureLog("🗑️", "Mensaje eliminado", { messageId, roomId, isAdmin });
    } catch (err) {
      errorLog("Error al eliminar mensaje", err, { messageId, roomId });
      socket.emit("errorMessage", "Error al eliminar mensaje");
    }
  });

  // Evento de edición de mensaje
  socket.on("editMessage", async ({ messageId, newContent, roomId }) => {
    try {
      const message = await Message.findById(messageId);
      if (!message) {
        socket.emit("errorMessage", "Mensaje no encontrado");
        return;
      }
      
      message.content = newContent;
      message.edited = true;
      await message.save();

      io.to(roomId).emit("messageEdited", {
        messageId,
        newContent,
        edited: true,
      });
      secureLog("✏️", "Mensaje editado", { messageId, roomId });
    } catch (err) {
      errorLog("Error al editar mensaje", err, { messageId, roomId });
      socket.emit("errorMessage", "Error al editar mensaje");
    }
  });

  // Expulsar usuario (solo admin)
  socket.on("kickUser", async ({ roomId, targetNickname, adminNickname }) => {
    try {
      const room = await Room.findById(roomId);
      if (!room) {
        socket.emit("errorMessage", "Sala no encontrada");
        return;
      }

      // Verificar que quien expulsa sea el admin de la sala
      const adminUser = await User.findOne({ username: adminNickname, _id: room.createdBy });
      if (!adminUser) {
        socket.emit("errorMessage", "No tienes permisos para expulsar usuarios");
        return;
      }

      // Buscar el socket del usuario a expulsar
      const users = activeUsers[roomId] || [];
      const targetUser = users.find(u => u.nickname === targetNickname);
      
      if (targetUser) {
        // Agregar a la lista negra de la sala
        if (!kickedUsers[roomId]) {
          kickedUsers[roomId] = [];
        }
        if (!kickedUsers[roomId].includes(targetNickname)) {
          kickedUsers[roomId].push(targetNickname);
        }
        
        // Remover de la lista de usuarios activos
        activeUsers[roomId] = users.filter(u => u.nickname !== targetNickname);
        
        // Limpiar sesión del usuario
        delete userSessions[targetNickname];
        
        // Obtener el socket del usuario expulsado
        const targetSocket = io.sockets.sockets.get(targetUser.socketId);
        
        if (targetSocket) {
          // Sacarlo de la sala de Socket.IO
          targetSocket.leave(roomId);
          
          // Notificar al usuario expulsado
          targetSocket.emit("kicked", {
            message: `Has sido expulsado de la sala por el administrador`
          });
        }

        // Notificar a todos en la sala
        io.to(roomId).emit("systemMessage", {
          content: `${targetNickname} fue expulsado de la sala`,
          timestamp: new Date(),
        });

        // Actualizar lista de participantes
        io.to(roomId).emit("activeUsersUpdate", activeUsers[roomId]);

        secureLog("🚫", "Usuario expulsado de sala", { targetNickname, roomId, adminNickname });
        secureLog("📋", "Lista negra actualizada", { roomId, count: kickedUsers[roomId]?.length || 0 });
      }
    } catch (err) {
      errorLog("Error al expulsar usuario", err, { targetNickname, adminNickname });
      socket.emit("errorMessage", "Error al expulsar usuario");
    }
  });

  // ✅ Ping para mantener actividad (heartbeat)
  socket.on("userActivity", ({ nickname }) => {
    if (userSessions[nickname]) {
      userSessions[nickname].lastActivity = Date.now();
    }
  });

  // Desconexión
  socket.on("disconnect", () => {
    console.log("🔴 Usuario desconectado:", socket.id);
    
    // Limpiar sesiones de usuario
    for (const nickname in userSessions) {
      if (userSessions[nickname].socketId === socket.id) {
        delete userSessions[nickname];
        console.log(`🧹 Sesión de ${nickname} limpiada`);
        
        // Limpiar cooldown relacionado
        const cooldownKey = `${nickname}:${socket.id}`;
        if (reconnectCooldown[cooldownKey]) {
          delete reconnectCooldown[cooldownKey];
          console.log(`🧹 Cooldown de ${cooldownKey} eliminado`);
        }
        break;
      }
    }
    
    // Limpiar de salas activas
    for (const roomId in activeUsers) {
      const users = activeUsers[roomId];
      const user = users.find((u) => u.socketId === socket.id);
      if (user) {
        activeUsers[roomId] = users.filter((u) => u.socketId !== socket.id);
        io.to(roomId).emit("systemMessage", {
          content: `${user.nickname} salió de la sala`,
          timestamp: new Date(),
        });
        io.to(roomId).emit("activeUsersUpdate", activeUsers[roomId] || []);
      }
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
  console.log(`📊 Monitoreo de sesiones activo`);
  console.log(`   - Timeout de inactividad: ${INACTIVITY_TIMEOUT / 1000}s`);
  console.log(`   - Intervalo de verificación: ${CHECK_INTERVAL / 1000}s`);
});

// 🔍 Endpoint de debug para ver sesiones activas
setInterval(() => {
  const sessionCount = Object.keys(userSessions).length;
  if (sessionCount > 0) {
    console.log(`\n📊 Sesiones activas: ${sessionCount}`);
    for (const nickname in userSessions) {
      const session = userSessions[nickname];
      const inactiveSeconds = Math.floor((Date.now() - session.lastActivity) / 1000);
      secureLog("👤", "Sesión activa", { nickname, inactiveSeconds, roomId: session.roomId });
    }
  }
}, 60 * 1000); // Log cada minuto
