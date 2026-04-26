import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ShellContext = createContext(null);

export function ShellProvider({ children }) {
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState('login');
  const [referralOpen, setReferralOpen] = useState(false);
  const [fastOpen, setFastOpen] = useState(false);
  const openAuth = useCallback((tab = 'login') => {
    setAuthTab(tab === 'signup' ? 'signup' : 'login');
    setAuthOpen(true);
  }, []);

  const closeAuth = useCallback(() => setAuthOpen(false), []);

  const openReferral = useCallback(() => setReferralOpen(true), []);
  const closeReferral = useCallback(() => setReferralOpen(false), []);

  const openFast = useCallback(() => setFastOpen(true), []);
  const closeFast = useCallback(() => setFastOpen(false), []);

  const value = useMemo(
    () => ({
      authOpen,
      authTab,
      setAuthTab,
      openAuth,
      closeAuth,
      referralOpen,
      openReferral,
      closeReferral,
      fastOpen,
      openFast,
      closeFast,
    }),
    [
      authOpen,
      authTab,
      openAuth,
      closeAuth,
      referralOpen,
      openReferral,
      closeReferral,
      fastOpen,
      openFast,
      closeFast,
    ],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used within ShellProvider');
  return ctx;
}
