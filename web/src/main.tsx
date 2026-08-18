import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import "./styles.css";
import Today from "./pages/Today";
import Workout from "./pages/Workout";
import History from "./pages/History";
import Progress from "./pages/Progress";
import Queue from "./pages/Queue";
import Sounds from "./pages/Sounds";

const TABS = [
  { to: "/", label: "Today", ico: "🐷" },
  { to: "/queue", label: "Queue", ico: "📋" },
  { to: "/history", label: "History", ico: "🗓" },
  { to: "/progress", label: "Progress", ico: "📈" },
];

function Shell() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Today />} />
        <Route path="/workout/:id" element={<Workout />} />
        <Route path="/history" element={<History />} />
        <Route path="/progress" element={<Progress />} />
        <Route path="/queue" element={<Queue />} />
        {/* Not in the nav — a scratch page for auditioning the rest cues. */}
        <Route path="/sounds" element={<Sounds />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <nav className="nav">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === "/"} className={({ isActive }) => (isActive ? "on" : "")}>
            <span className="ico">{t.ico}</span>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  </StrictMode>,
);
