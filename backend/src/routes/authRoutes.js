import express from "express";
import { loginUser, loginAdmin, registerUser } from "../controllers/authController.js";
import { 
  validateUserLogin, 
  validateAdminLogin 
} from "../middleware/validators.js";

const router = express.Router();

// Login de usuario (solo nickname)
router.post("/login", validateUserLogin, loginUser);

// Login de admin (admin/admin)
router.post("/admin/login", validateAdminLogin, loginAdmin);

// Registro deshabilitado
router.post("/register", registerUser);

export default router;
