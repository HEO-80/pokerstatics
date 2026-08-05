import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import NavBar from "@/components/NavBar";
import Home from "@/pages/Home";
import Train from "@/pages/Train";
import Play from "@/pages/Play";
import Stats from "@/pages/Stats";
import Review from "@/pages/Review";
import Admin from "@/pages/Admin";
import { Toaster } from "@/components/ui/sonner";

function App() {
  return (
    <div className="App min-h-screen bg-[#050505] text-[#F8FAFC]">
      <BrowserRouter>
        <NavBar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/train" element={<Train />} />
          <Route path="/play" element={<Play />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/review" element={<Review />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </BrowserRouter>
      <Toaster theme="dark" position="top-right" />
    </div>
  );
}

export default App;
