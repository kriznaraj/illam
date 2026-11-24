'use client';

import { useState, useEffect, useSyncExternalStore } from 'react';
import { Wifi, WifiOff } from 'lucide-react';

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

export default function OfflineIndicator() {
  // Online while prerendering; the browser's real value after hydration.
  const isOnline = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [showIndicator, setShowIndicator] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setShowIndicator(true);
      // Hide success message after 3 seconds
      setTimeout(() => setShowIndicator(false), 3000);
    };

    const handleOffline = () => {
      setShowIndicator(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!showIndicator) return null;

  return (
    <div
      className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg transition-all ${
        isOnline
          ? 'bg-green-500 text-white'
          : 'bg-red-500 text-white'
      }`}
    >
      <div className="flex items-center gap-2">
        {isOnline ? <Wifi size={18} aria-hidden /> : <WifiOff size={18} aria-hidden />}
        <span className="font-medium">
          {isOnline ? 'Back Online' : 'You are offline'}
        </span>
      </div>
    </div>
  );
}
