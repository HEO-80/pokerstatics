import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { fetchMe, loginUser, loginWithGoogle, logoutUser, registerUser } from "@/lib/api";

// Sesión de usuario (paso 1 de persistencia — ver backend/auth_api.py):
// SOLO login, sin progreso/histórico todavía. Login OPCIONAL: `user` es
// `null` en invitado y nada de la app lo exige — este contexto es el único
// canal (App.js monta el Provider, cualquier página/NavBar puede leer
// useAuth() sin pasar props a mano, mismo patrón que useNavBarStats).
const AuthContext = createContext({
  user: null,
  loading: true,
  login: async () => {},
  register: async () => {},
  loginGoogle: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((u) => { if (!cancelled) setUser(u); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email, password) => {
    const u = await loginUser({ email, password });
    setUser(u);
    return u;
  }, []);

  const register = useCallback(async (name, email, password) => {
    const u = await registerUser({ name, email, password });
    setUser(u);
    return u;
  }, []);

  const loginGoogle = useCallback(async (credential) => {
    const u = await loginWithGoogle(credential);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    await logoutUser();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, loginGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
