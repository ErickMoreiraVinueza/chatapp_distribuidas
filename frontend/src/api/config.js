// Usar variable de entorno si está disponible, sino usar localhost
export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
