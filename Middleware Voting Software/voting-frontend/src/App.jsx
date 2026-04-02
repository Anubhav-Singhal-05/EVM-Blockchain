import { useState } from "react";
import Login from "./pages/Login";
import OfficerPanel from "./pages/OfficerPanel";
import AdminPanel from "./pages/AdminPanel";
import "./App.css";

export default function App() {
  const [user, setUser] = useState(null);

  const handleLogin = (loggedInUser) => {
    setUser(loggedInUser);
  };

  const handleLogout = () => {
    setUser(null);
  };

  if (!user) return <Login onLogin={handleLogin} />;
  if (user.role === "admin") return <AdminPanel user={user} onLogout={handleLogout} />;
  if (user.role === "officer") return <OfficerPanel user={user} onLogout={handleLogout} />;
}