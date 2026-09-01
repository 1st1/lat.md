export type DocumentMode = 'view' | 'edit';

export function DocumentModeSwitch({
  mode,
  onChange,
}: {
  mode: DocumentMode;
  onChange: (mode: DocumentMode) => void;
}) {
  return (
    <div
      aria-label="Document presentation"
      className="document-mode-switch"
      role="group"
    >
      {(['view', 'edit'] as const).map((value) => (
        <button
          aria-pressed={mode === value}
          key={value}
          onClick={() => onChange(value)}
          type="button"
        >
          {value === 'edit' && (
            <svg aria-hidden="true" viewBox="0 0 14 14">
              <path d="m3 10.8.5-2.5 5.8-5.8 1.4 1.4-5.8 5.8-2.9.1Z" />
              <path d="m8.5 3.3 1.4 1.4" />
            </svg>
          )}
          <span>{value}</span>
        </button>
      ))}
    </div>
  );
}
