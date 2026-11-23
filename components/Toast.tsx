'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';

interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info';
  duration?: number;
  onClose: () => void;
}

const toastConfig = {
  success: { bg: 'bg-green-500', Icon: CheckCircle },
  error:   { bg: 'bg-red-500',   Icon: XCircle },
  info:    { bg: 'bg-primary-500',  Icon: Info },
};

export default function Toast({ message, type, duration = 3000, onClose }: ToastProps) {
  const [isVisible, setIsVisible] = useState(true);
  const { bg, Icon } = toastConfig[type];

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 300);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  return (
    <div
      className={`fixed top-4 right-4 z-50 transition-all duration-300 transform ${
        isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
      }`}
    >
      <div className={`${bg} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 min-w-[280px]`}>
        <Icon size={18} strokeWidth={2} className="flex-shrink-0" />
        <span className="text-sm flex-1">{message}</span>
        <button
          onClick={() => { setIsVisible(false); setTimeout(onClose, 300); }}
          className="text-white/80 hover:text-white transition-colors ml-1"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
