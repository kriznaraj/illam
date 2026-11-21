interface ModalRecordActionsProps {
  onDelete: () => void;
  onEdit: () => void;
  onTertiary?: () => void;
  tertiaryLabel?: string;
  deleteDisabled?: boolean;
  editDisabled?: boolean;
  tertiaryDisabled?: boolean;
  compact?: boolean;
}

export function ModalRecordActions({
  onDelete,
  onEdit,
  onTertiary,
  tertiaryLabel,
  deleteDisabled = false,
  editDisabled = false,
  tertiaryDisabled = false,
  compact = false,
}: ModalRecordActionsProps) {
  const sizeClass = compact ? ' btn-sm' : '';

  return (
    <>
      <button onClick={onDelete} className={`btn btn-danger${sizeClass}`} disabled={deleteDisabled}>
        Delete
      </button>
      {onTertiary && tertiaryLabel ? (
        <button
          onClick={onTertiary}
          className={`btn btn-secondary${sizeClass}`}
          disabled={tertiaryDisabled}
        >
          {tertiaryLabel}
        </button>
      ) : null}
      <button onClick={onEdit} className={`btn btn-primary${sizeClass}`} disabled={editDisabled}>
        Edit
      </button>
    </>
  );
}
