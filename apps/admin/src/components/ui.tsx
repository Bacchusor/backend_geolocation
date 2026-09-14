import type { ReactNode } from 'react';
import type { FieldError } from 'react-hook-form';

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: FieldError | { message?: string };
  children: ReactNode;
}) {
  return (
    <label>
      <span>{label}</span>
      {children}
      {error?.message && <span className="field-error">{error.message}</span>}
    </label>
  );
}

export function Alert({ kind, children }: { kind: 'ok' | 'err' | 'warn'; children: ReactNode }) {
  return <div className={`alert ${kind}`}>{children}</div>;
}

export function Badge({
  kind,
  children,
}: {
  kind?: 'ok' | 'warn' | 'err' | 'info';
  children: ReactNode;
}) {
  return <span className={`badge ${kind ?? ''}`}>{children}</span>;
}

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString() : '—';

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
export function DaysPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (days: number[]) => void;
}) {
  return (
    <div className="days">
      {DAY_LABELS.map((label, d) => (
        <button
          type="button"
          key={d}
          className={`btn sm ${value.includes(d) ? 'on' : ''}`}
          onClick={() =>
            onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort())
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const details = (err as { details?: Array<{ path: string; message: string }> }).details;
    if (Array.isArray(details) && details.length)
      return `${err.message}: ${details.map((d) => `${d.path} ${d.message}`).join('; ')}`;
    return err.message;
  }
  return String(err);
}
