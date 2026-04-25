'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import { cn } from '@/lib/utils';
import { formatEnum } from '@/lib/format';
import type { Database } from '@/lib/db/types';
import { updateLeadStatus, type UpdateStatusState } from './actions';

type LeadStatus = Database['public']['Enums']['lead_status'];

const STATUS_OPTIONS: readonly LeadStatus[] = [
  'new',
  'contacted',
  'quoted',
  'booked',
  'won',
  'lost',
  'cold',
] as const;

const initialState: UpdateStatusState = { status: 'idle' };

interface StatusFormProps {
  leadId: string;
  currentStatus: LeadStatus;
  lastUpdatedAt: string;
}

export function StatusForm({ leadId, currentStatus, lastUpdatedAt }: StatusFormProps) {
  const [state, formAction] = useFormState(updateLeadStatus, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  // Brief green flash on success. Clears after ~2s so the form returns
  // to its resting visual state. Keyed on (state.status, newStatus) so
  // back-to-back updates re-trigger the flash.
  const [flashing, setFlashing] = useState(false);
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
      className="flex flex-col items-end gap-1"
    >
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="last_updated_at" value={lastUpdatedAt} />
      <SelectAndStatus
        currentStatus={currentStatus}
        flashing={flashing}
        hasError={state.status === 'error'}
        onChange={() => formRef.current?.requestSubmit()}
      />
      <FormFeedback state={state} flashing={flashing} />
    </form>
  );
}

function SelectAndStatus({
  currentStatus,
  flashing,
  hasError,
  onChange,
}: {
  currentStatus: LeadStatus;
  flashing: boolean;
  hasError: boolean;
  onChange: () => void;
}) {
  const { pending } = useFormStatus();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="lead-status-select" className="sr-only">
        Status
      </label>
      <select
        id="lead-status-select"
        name="new_status"
        defaultValue={currentStatus}
        onChange={onChange}
        disabled={pending}
        className={cn(
          'rounded-md border bg-background px-3 py-1 text-sm font-medium capitalize',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
          'transition-colors',
          flashing && 'border-emerald-500 ring-2 ring-emerald-500/30',
          hasError && 'border-destructive ring-2 ring-destructive/30',
          pending && 'opacity-60',
        )}
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {formatEnum(opt)}
          </option>
        ))}
      </select>
    </div>
  );
}

function FormFeedback({
  state,
  flashing,
}: {
  state: UpdateStatusState;
  flashing: boolean;
}) {
  const { pending } = useFormStatus();

  if (pending) {
    return <span className="text-xs text-muted-foreground">Saving…</span>;
  }
  if (state.status === 'error') {
    return <span className="text-xs text-destructive">{state.message}</span>;
  }
  if (state.status === 'success' && flashing) {
    return (
      <span className="text-xs text-emerald-600">
        Status updated to {formatEnum(state.newStatus)}
      </span>
    );
  }
  return <span className="invisible text-xs">placeholder</span>;
}
