'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import { cn } from '@/lib/utils';
import { updateLeadField, type UpdateFieldState } from './actions';

const initialState: UpdateFieldState = { status: 'idle' };

type EditableField = 'notes' | 'quote_amount' | 'job_date' | 'revenue';

interface BaseProps {
  leadId: string;
  field: EditableField;
  initialValue: string | null;
  lastUpdatedAt: string;
  label: string;
  placeholder?: string;
  variant: 'text' | 'textarea' | 'number' | 'date';
  /** Optional prefix shown adjacent to the input (e.g. "$" for money). */
  prefix?: string;
}

/**
 * One editable lead field. Auto-saves on blur (or change for date),
 * matches the status-update pattern: per-field form, useFormState
 * for outcome tracking, brief green flash + "Saved" on success,
 * red border + error message on failure.
 *
 * The field name is sent in a hidden input and validated server-side
 * against an allowlist — the client never picks the column.
 */
export function EditableField(props: BaseProps) {
  const [state, formAction] = useFormState(updateLeadField, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const [flashing, setFlashing] = useState(false);

  // 2-second green flash on success.
  useEffect(() => {
    if (state.status === 'success') {
      setFlashing(true);
      const t = setTimeout(() => setFlashing(false), 2000);
      return () => clearTimeout(t);
    }
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-1"
    >
      <label htmlFor={`field-${props.field}`} className="text-xs font-medium text-muted-foreground">
        {props.label}
      </label>
      <input type="hidden" name="lead_id" value={props.leadId} />
      <input type="hidden" name="field" value={props.field} />
      <input type="hidden" name="last_updated_at" value={props.lastUpdatedAt} />

      <FieldInput
        {...props}
        flashing={flashing}
        hasError={state.status === 'error'}
        onCommit={() => formRef.current?.requestSubmit()}
      />

      <FieldFeedback state={state} flashing={flashing} field={props.field} />
    </form>
  );
}

function FieldInput({
  field,
  initialValue,
  variant,
  placeholder,
  prefix,
  flashing,
  hasError,
  onCommit,
}: BaseProps & { flashing: boolean; hasError: boolean; onCommit: () => void }) {
  const { pending } = useFormStatus();

  const [value, setValue] = useState(initialValue ?? '');
  // Sync with server-truth when the page re-renders after a save
  // elsewhere (e.g. concurrent edit from another tab).
  useEffect(() => {
    setValue(initialValue ?? '');
  }, [initialValue]);

  const inputClass = cn(
    'w-full rounded-md border bg-background px-3 py-2 text-sm',
    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
    'transition-colors',
    flashing && 'border-emerald-500 ring-2 ring-emerald-500/30',
    hasError && 'border-destructive ring-2 ring-destructive/30',
    pending && 'opacity-60',
  );

  if (variant === 'textarea') {
    return (
      <textarea
        id={`field-${field}`}
        name="value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          // Only fire if the value actually changed; saves a no-op round trip.
          if ((value || null) !== (initialValue || null)) onCommit();
        }}
        placeholder={placeholder}
        disabled={pending}
        rows={4}
        className={cn(inputClass, 'resize-y font-sans')}
      />
    );
  }

  if (variant === 'date') {
    return (
      <input
        id={`field-${field}`}
        type="date"
        name="value"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          // Native date pickers don't really fire blur in a useful way;
          // commit on change instead.
          if ((e.target.value || null) !== (initialValue || null)) onCommit();
        }}
        disabled={pending}
        className={inputClass}
      />
    );
  }

  // Number / text — share an inline-prefix wrapper.
  return (
    <div className="relative">
      {prefix ? (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          {prefix}
        </span>
      ) : null}
      <input
        id={`field-${field}`}
        type={variant === 'number' ? 'number' : 'text'}
        inputMode={variant === 'number' ? 'decimal' : undefined}
        step={variant === 'number' ? '0.01' : undefined}
        min={variant === 'number' ? '0' : undefined}
        name="value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if ((value || null) !== (initialValue || null)) onCommit();
        }}
        placeholder={placeholder}
        disabled={pending}
        className={cn(inputClass, prefix ? 'pl-7' : '')}
      />
    </div>
  );
}

function FieldFeedback({
  state,
  flashing,
  field,
}: {
  state: UpdateFieldState;
  flashing: boolean;
  field: string;
}) {
  const { pending } = useFormStatus();

  if (pending) return <span className="text-xs text-muted-foreground">Saving…</span>;
  if (state.status === 'error') {
    return <span className="text-xs text-destructive">{state.message}</span>;
  }
  if (state.status === 'success' && flashing && state.field === field) {
    return <span className="text-xs text-emerald-600">Saved</span>;
  }
  return <span className="invisible text-xs">placeholder</span>;
}
