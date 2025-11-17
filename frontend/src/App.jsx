import { useState } from "react";
import Login from "./components/Login";
import AdminLogin from "./components/AdminLogin";
import Dashboard from "./components/Dashboard";
import ChatRoom from "./components/ChatRoom";
import AdminPanel from "./components/AdminPanel";

export default function App() {
  const [nickname, setNickname] = useState(localStorage.getItem("nickname") || "");
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [view, setView] = useState("login");

  // Vista de login para administrador
  if (view === "adminLogin") {
    return (
      <AdminLogin
        onLogin={(adminData) => {
          setView("adminPanel");
        }}
      />
    );
  }

  // Vista de panel de administrador
  if (view === "adminPanel") {
    return (
      <AdminPanel
        onBack={() => {
          localStorage.removeItem("token");
          localStorage.removeItem("adminName");
          setView("login");
        }}
      />
    );
  }

  // Vista de login para usuarios (entrada con nickname + PIN)
  if (!nickname || view === "login") {
    return (
      <Login
        onLogin={(action) => {
          if (action === "admin") {
            setView("adminLogin");
          }
        }}
        onJoinRoom={(data) => {
          // Usuario ingresó directamente con nickname + PIN
          setNickname(data.nickname);
          localStorage.setItem("nickname", data.nickname);
          setSelectedRoom(data.room);
          setView("chat");
        }}
      />
    );
  }

  // Vista de sala de chat
  if (view === "chat" && selectedRoom) {
    return (
      <ChatRoom
        roomId={selectedRoom._id}
        pin={selectedRoom.pin}
        nickname={nickname}
        onBack={() => {
          setSelectedRoom(null);
          setNickname("");
          localStorage.removeItem("nickname");
          setView("login");
        }}
      />
    );
  }

  // Vista de dashboard (por si acaso se necesita en el futuro)
  return (
    <Dashboard
      nickname={nickname}
      onEnterRoom={(room) => {
        setSelectedRoom(room);
        setView("chat");
      }}
      onLogout={() => {
        localStorage.removeItem("nickname");
        localStorage.removeItem("token");
        setNickname("");
        setView("login");
      }}
      onOpenAdmin={() => setView("adminLogin")}
    />
  );
}
