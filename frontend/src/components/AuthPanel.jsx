import { useState } from "react";
import { GoogleLogin, GoogleOAuthProvider } from "@react-oauth/google";
import { Eye, EyeOff, LogOut, User as UserIcon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;

/** Input de contraseña con botón de ojo para alternar entre puntos y texto
 * plano — sin esto no hay forma de revisar lo escrito antes de enviar. */
function PasswordInput({ value, onChange, placeholder }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        type={visible ? "text" : "password"}
        placeholder={placeholder} value={value} required
        onChange={onChange}
        className="pr-9"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6b7686] hover:text-white"
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

/**
 * Login opcional (paso 1 de persistencia — ver backend/auth_api.py): un
 * botón en la NavBar que abre un modal de entrar/registrarse (email+password
 * o Google), o el nombre del usuario + "salir" si ya hay sesión. Nada de la
 * app exige esto — un invitado sin sesión juega exactamente igual que hoy.
 */
export default function AuthPanel() {
  const { user, loading, login, register, loginGoogle, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) return null;

  if (user) {
    return (
      <div className="flex items-center gap-2 shrink-0">
        <div
          className="pl-mono flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs"
          style={{ background: "var(--pl-tile-alt)", border: "1px solid #2f3846", color: "#c2cad6" }}
        >
          {user.picture
            ? <img src={user.picture} alt="" className="w-4 h-4 rounded-full" referrerPolicy="no-referrer" />
            : <UserIcon className="w-3.5 h-3.5" />}
          <span className="max-w-[140px] truncate">{user.name}</span>
        </div>
        <Button variant="ghost" size="sm" className="text-[#94A3B8] hover:text-white" onClick={logout}>
          <LogOut className="w-3.5 h-3.5" /> Salir
        </Button>
      </div>
    );
  }

  const resetAndClose = () => {
    setOpen(false);
    setError("");
    setForm({ name: "", email: "", password: "", confirmPassword: "" });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (mode === "register" && form.password !== form.confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "register") {
        await register(form.name, form.email, form.password);
      } else {
        await login(form.email, form.password);
      }
      resetAndClose();
    } catch (err) {
      setError(err?.response?.data?.detail || "Algo ha ido mal, inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    setError("");
    try {
      await loginGoogle(credentialResponse.credential);
      resetAndClose();
    } catch {
      setError("No se pudo entrar con Google.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : resetAndClose())}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 pl-mono"
          style={{ background: "var(--pl-tile-alt)", border: "1px solid #2f3846", color: "#c2cad6" }}
        >
          <UserIcon className="w-3.5 h-3.5" /> Entrar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{mode === "login" ? "Entrar" : "Crear cuenta"}</DialogTitle>
        </DialogHeader>

        {GOOGLE_CLIENT_ID && (
          <>
            <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
              <div className="flex justify-center">
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={() => setError("No se pudo entrar con Google.")}
                  theme="filled_black"
                  text="continue_with"
                  width="300"
                />
              </div>
            </GoogleOAuthProvider>
            <div className="flex items-center gap-2 text-xs text-[#6b7686]">
              <div className="flex-1 h-px bg-white/10" /> o <div className="flex-1 h-px bg-white/10" />
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {mode === "register" && (
            <Input
              placeholder="Nombre" value={form.name} required
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          )}
          <Input
            type="email" placeholder="Email" value={form.email} required
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
          <PasswordInput
            placeholder="Contraseña" value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          />
          {mode === "register" && (
            <PasswordInput
              placeholder="Confirmar contraseña" value={form.confirmPassword}
              onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
            />
          )}
          {error && <div className="text-xs text-red-400">{error}</div>}
          <Button type="submit" disabled={busy}>
            {busy ? "..." : mode === "login" ? "Entrar" : "Crear cuenta"}
          </Button>
        </form>

        <button
          type="button"
          className="text-xs text-[#6b7686] hover:text-white text-center"
          onClick={() => { setMode((m) => (m === "login" ? "register" : "login")); setError(""); }}
        >
          {mode === "login" ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Entra"}
        </button>
      </DialogContent>
    </Dialog>
  );
}
