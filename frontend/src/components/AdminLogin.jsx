import { useState } from "react";
import axios from "axios";
import { API_URL } from "../api/config";
import toast from "react-hot-toast";
import "./AdminLogin.css";

export default function AdminLogin({ onLogin }) {
  const [form, setForm] = useState({ username: "admin", password: "" });
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const res = await axios.post(`${API_URL}/api/auth/admin/login`, {
        username: form.username,
        password: form.password,
      });
      localStorage.setItem("token", res.data.token);
      localStorage.setItem("adminName", res.data.name);
      toast.success("Bienvenido Administrador 👨‍💼");
      onLogin(res.data);
    } catch (error) {
      toast.error(error.response?.data?.message || "Credenciales inválidas");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-indigo-300 to-purple-300">
      <div className="bg-white rounded-xl shadow-lg p-8 w-96">
        <h2 className="text-2xl font-semibold mb-6 text-center text-gray-700">
          Panel de Administración
        </h2>

        <form onSubmit={handleLogin}>
          <input
            type="text"
            name="username"
            placeholder="Usuario"
            value={form.username}
            onChange={handleChange}
            className="border p-2 rounded w-full mb-3"
            required
            readOnly
          />

          <input
            type="password"
            name="password"
            placeholder="Contraseña"
            value={form.password}
            onChange={handleChange}
            className="border p-2 rounded w-full mb-4"
            required
            autoFocus
          />

          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white py-2 w-full rounded hover:bg-blue-700 transition disabled:bg-gray-400"
          >
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>

        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-xs text-gray-600">
          <strong>⚠️ Nota:</strong> Solo existe un administrador con credenciales predefinidas.
        </div>
      </div>
    </div>
  );
}
