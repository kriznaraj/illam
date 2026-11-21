interface EmptyStateProps {
  icon: string;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'success';
  };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="card text-center py-12 md:py-16">
      <div className="text-5xl md:text-6xl mb-4">{icon}</div>
      <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-2">{title}</h2>
      <p className="text-gray-600 mb-6 max-w-md mx-auto">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className={`btn ${action.variant === 'success' ? 'btn-success' : 'btn-primary'} px-6 py-3`}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
