import { createContext, useContext, useEffect, useState } from 'react';
import { api, refreshSession, setAccessToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    const expire = () => {
      setAccessToken(null);
      if (active) setUser(null);
    };
    window.addEventListener('ecotrip:auth-expired', expire);
    refreshSession()
      .then((data) => {
        if (!active) return;
        setAccessToken(data?.access_token);
        setUser(data?.user || null);
      })
      .catch(() => {
        if (active) {
          setAccessToken(null);
          setUser(null);
        }
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
      window.removeEventListener('ecotrip:auth-expired', expire);
    };
  }, []);

  function establishSession(data) {
    setAccessToken(data?.access_token);
    setUser(data?.user || null);
    setReady(true);
    return data?.user || null;
  }

  async function signIn(credentials) {
    return establishSession(await api.post('/auth/login', credentials, { auth: false, retry: false }));
  }

  async function register(details) {
    return establishSession(await api.post('/auth/register', details, { auth: false, retry: false }));
  }

  async function signOut() {
    try {
      await api.post('/auth/logout', undefined, { retry: false });
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }

  return (
    <AuthContext.Provider value={{ user, ready, signIn, register, signOut, establishSession, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider.');
  return context;
}