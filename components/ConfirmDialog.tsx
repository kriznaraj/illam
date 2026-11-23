'use client';

import { AlertTriangle, Info, Trash2, AlertCircle } from 'lucide-react';
import Modal from './Modal';

export type ConfirmDialogVariant = 'danger' | 'warning' | 'info' | 'success';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  showCancelButton?: boolean;
  variant?: ConfirmDialogVariant;
  confirmButtonColor?: string;
  isLoading?: boolean;
}

export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  showCancelButton = false,
  variant = 'info',
  confirmButtonColor,
  isLoading = false,
}: ConfirmDialogProps) {
  const getVariantConfig = () => {
    switch (variant) {
      case 'danger':
        return {
          icon: Trash2,
          iconColor: 'text-red-600',
          iconBg: 'bg-red-100',
        };
      case 'warning':
        return {
          icon: AlertTriangle,
          iconColor: 'text-yellow-600',
          iconBg: 'bg-yellow-100',
        };
      case 'success':
        return {
          icon: AlertCircle,
          iconColor: 'text-green-600',
          iconBg: 'bg-green-100',
        };
      case 'info':
      default:
        return {
          icon: Info,
          iconColor: 'text-primary-600',
          iconBg: 'bg-primary-100',
        };
    }
  };

  const config = getVariantConfig();
  const Icon = config.icon;
  const confirmClassName = confirmButtonColor
    ? `btn text-white ${confirmButtonColor}`
    : variant === 'danger'
      ? 'btn btn-danger'
      : variant === 'success'
        ? 'btn btn-success'
        : 'btn btn-primary';

  const handleConfirm = async () => {
    await onConfirm();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title=""
      maxWidth="sm"
      footer={
        <>
          {showCancelButton && (
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="btn btn-secondary disabled:opacity-50"
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isLoading}
            className={`${confirmClassName} disabled:opacity-50`}
          >
            {isLoading ? 'Processing...' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex gap-4">
        {/* Icon */}
        <div className={`flex-shrink-0 w-12 h-12 rounded-full ${config.iconBg} flex items-center justify-center`}>
          <Icon className={`w-6 h-6 ${config.iconColor}`} />
        </div>

        {/* Content */}
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
          <p className="text-sm text-gray-600 whitespace-pre-wrap">{message}</p>
        </div>
      </div>
    </Modal>
  );
}
