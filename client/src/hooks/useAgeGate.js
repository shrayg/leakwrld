import { useCallback, useEffect, useMemo, useState } from 'react';

const AGE_GATE_STORAGE_KEY = 'pornwrld.age_gate.accepted.v1';

function readAcceptedFromStorage() {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage.getItem(AGE_GATE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function useAgeGate() {
  const [isAccepted, setIsAccepted] = useState(readAcceptedFromStorage);

  const accept = useCallback(() => {
    try {
      window.localStorage.setItem(AGE_GATE_STORAGE_KEY, 'true');
    } catch {
      // Ignore storage errors (private mode, browser restrictions).
    }
    setIsAccepted(true);
  }, []);

  useEffect(() => {
    setIsAccepted(readAcceptedFromStorage());
  }, []);

  const isOpen = useMemo(() => !isAccepted, [isAccepted]);

  return {
    isOpen,
    isAccepted,
    accept,
    storageKey: AGE_GATE_STORAGE_KEY,
  };
}
