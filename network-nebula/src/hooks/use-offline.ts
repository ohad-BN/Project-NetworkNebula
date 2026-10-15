import { useState, useEffect, useCallback } from 'react';

export interface UseOfflineReturn {
  isOffline: boolean;
  wasOffline: boolean;
  goOnline: () => void;
  goOffline: () => void;
}

export function useOffline(): UseOfflineReturn {
  const [isOffline, setIsOffline] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    // Initialize with current status
    setIsOffline(!navigator.onLine);

    const handleOnline = () => {
      setIsOffline(false);
    };

    const handleOffline = () => {
      setIsOffline(true);
      setWasOffline(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const goOnline = useCallback(() => {
    setIsOffline(false);
  }, []);

  const goOffline = useCallback(() => {
    setIsOffline(true);
    setWasOffline(true);
  }, []);

  return { isOffline, wasOffline, goOnline, goOffline };
}
