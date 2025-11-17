import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Admin from "../models/Admin.js";
import validator from "validator";

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });
};

// 🔐 Login de Usuario (solo nickname - sin registro previo)
export const loginUser = async (req, res) => {
  try {
    let { nickname } = req.body;

    // Sanitizar entrada
    nickname = validator.escape(nickname.trim());

    if (!nickname || nickname === "") {
      return res.status(400).json({ message: "El nickname es requerido" });
    }

    // Buscar o crear usuario temporal con ese nickname
    let user = await User.findOne({ username: nickname });

    if (!user) {
      // Crear usuario temporal automáticamente
      user = await User.create({
        name: nickname,
        username: nickname,
        email: `${nickname}@temp.chatapp.com`, // Email temporal
        password: Math.random().toString(36), // Password aleatorio (no se usará)
      });
    }

    res.json({
      _id: user._id,
      name: user.name,
      username: user.username,
      token: generateToken(user._id),
    });
  } catch (err) {
    res.status(500).json({ message: "Error al iniciar sesión", error: err.message });
  }
};

// 🔐 Login de Admin (solo el admin predefinido: admin/admin)
export const loginAdmin = async (req, res) => {
  try {
    let { username, password } = req.body;

    // Sanitizar entrada
    username = validator.escape(username.trim());

    // Solo permitir login con "admin"
    if (username !== "admin") {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    const admin = await Admin.findOne({ email: "admin@chatapp.com" });

    if (!admin) {
      return res.status(500).json({ message: "Admin no encontrado. Contacte al administrador del sistema." });
    }

    if (await admin.matchPassword(password)) {
      res.json({
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        token: generateToken(admin._id),
      });
    } else {
      res.status(401).json({ message: "Credenciales inválidas" });
    }
  } catch (err) {
    res.status(500).json({ message: "Error al iniciar sesión de admin", error: err.message });
  }
};

// ❌ Registro deshabilitado - ya no se permite registro manual
export const registerUser = async (req, res) => {
  res.status(403).json({ 
    message: "El registro manual está deshabilitado. Usa tu nickname para entrar directamente." 
  });
};
