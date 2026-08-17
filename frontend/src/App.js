import "@/App.css";
import { useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import NavBar from "@/components/NavBar";
import { NavBarStatsSetterProvider } from "@/hooks/useNavBarStats";
import { AuthProvider } from "@/hooks/useAuth";
import Home from "@/pages/Home";
import Train from "@/pages/Train";
import Practice from "@/pages/Practice";
import Tournament from "@/pages/Tournament";
import SitAndGo from "@/pages/SitAndGo";
import Stats from "@/pages/Stats";
import Review from "@/pages/Review";
import Admin from "@/pages/Admin";
import { Toaster } from "@/components/ui/sonner";

function App() {
  // Cápsula de stats de sesión en la NavBar (Tarea "layout sin scroll", Sit&Go
  // §1): la NavBar vive AQUÍ, fuera de las páginas — este estado es el punto
  // de encuentro entre NavBar (lo pinta) y la página en curso (lo publica vía
  // useNavBarStats, ver hooks/useNavBarStats.js). Necesita vivir en App.js
  // (no dentro de NavBar) porque las páginas ruteadas no son hijas de NavBar.
  const [navBarStats, setNavBarStats] = useState(null);

  return (
    // h-screen + overflow-hidden en la raíz (Tarea "layout sin scroll" §2):
    // NavBar es shrink-0 (altura fija) y el cuerpo de rutas es flex-1 min-h-0
    // con su propio scroll — así páginas como SitAndGo pueden gestionar su
    // ALTURA COMPLETA disponible (exactamente "viewport menos NavBar") sin
    // reintroducir el scroll de página que tenía antes; el resto de páginas
    // (Home/Stats/Admin/...) siguen scrolleando exactamente igual que antes,
    // solo que el scrollbar vive en este div en vez de en el body.
    <div className="App h-screen flex flex-col overflow-hidden bg-[#0b0e13] text-[#F8FAFC]">
      <AuthProvider>
        <BrowserRouter>
          <NavBar stats={navBarStats} />
          <NavBarStatsSetterProvider value={setNavBarStats}>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/train" element={<Train />} />
                <Route path="/practice" element={<Practice />} />
                <Route path="/tournament" element={<Tournament />} />
                <Route path="/sitandgo" element={<SitAndGo />} />
                <Route path="/stats" element={<Stats />} />
                <Route path="/review" element={<Review />} />
                <Route path="/admin" element={<Admin />} />
              </Routes>
            </div>
          </NavBarStatsSetterProvider>
        </BrowserRouter>
      </AuthProvider>
      <Toaster theme="dark" position="top-right" />
    </div>
  );
}

export default App;
