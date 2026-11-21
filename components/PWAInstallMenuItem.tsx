'use client';

import { Download } from 'lucide-react';
import { usePWAInstall } from '@/lib/pwa/usePWAInstall';

interface PWAInstallMenuItemProps {
  onClick?: () => void;
  className?: string;
}

export function PWAInstallMenuItem({ onClick, className }: PWAInstallMenuItemProps) {
  const { canInstall, install } = usePWAInstall();

  if (!canInstall) return null;

  const handleClick = async () => {
    onClick?.();
    await install();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={
        className ??
        'flex items-center gap-2.5 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50'
      }
    >
      <Download size={15} className="text-gray-400" />
      <span>Install app</span>
    </button>
  );
}
