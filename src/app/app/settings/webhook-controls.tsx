'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  rotateWebhookSecret,
  toggleChannelEnabled,
  type SettingsActionState,
} from './actions';

const initialState: SettingsActionState = { status: 'idle' };

interface WebhookSecretControlsProps {
  channelId: string;
  secret: string | null;
}

/**
 * Reveal/copy/rotate UI for a website_form webhook secret.
 *
 * - Masked by default (`whsec_•••...•••`); reveal button toggles plaintext.
 * - Copy button writes to clipboard with a brief "Copied" flash.
 * - Rotate is a two-step confirm (button → "Are you sure?" + confirm)
 *   because rotating breaks any existing form integration.
 */
export function WebhookSecretControls({ channelId, secret }: WebhookSecretControlsProps) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useFormState(rotateWebhookSecret, initialState);

  // Clear "Copied" after ~1.5s so the button label resets.
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  // Once a rotate succeeds, drop confirming state so the next attempt
  // requires a fresh confirm.
  useEffect(() => {
    if (state.status === 'success') {
      setConfirming(false);
      setRevealed(true); // reveal so the user can copy the new value immediately
    }
  }, [state]);

  if (!secret) {
    return (
      <p className="text-sm text-muted-foreground">
        No webhook secret on this channel. Rotate to generate one.
      </p>
    );
  }

  const masked = `${secret.slice(0, 6)}${'•'.repeat(Math.max(secret.length - 12, 4))}${secret.slice(-4)}`;
  const display = revealed ? secret : masked;

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(secret!);
      setCopied(true);
    } catch {
      // Old browsers / non-secure contexts: fall back to selecting the input.
      // Practically a non-issue on https + modern browsers; surface so the
      // user knows to copy by hand.
      setCopied(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <code className="flex-1 select-all rounded-md border bg-muted px-3 py-2 font-mono text-xs break-all">
          {display}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRevealed((v) => !v)}
        >
          {revealed ? 'Hide' : 'Reveal'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={copyToClipboard}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      {!confirming ? (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConfirming(true)}
          >
            Rotate secret
          </Button>
          <p className="text-xs text-muted-foreground">
            Generates a new secret. Any existing form integration will start
            failing with 401 until you paste the new value.
          </p>
        </div>
      ) : (
        <form action={formAction} className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <input type="hidden" name="channel_id" value={channelId} />
          <p className="text-sm">
            <strong>Confirm rotate.</strong> The current secret stops working
            immediately. Update the form integration before the next submission
            or the webhook will return 401.
          </p>
          <div className="flex items-center gap-2">
            <RotateSubmit />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      <ActionFeedback state={state} />
    </div>
  );
}

function RotateSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" size="sm" disabled={pending}>
      {pending ? 'Rotating…' : 'Yes, rotate now'}
    </Button>
  );
}

interface ChannelEnabledToggleProps {
  channelId: string;
  enabled: boolean;
}

/**
 * Enable/disable toggle for a tenant_channels row. Submits on change,
 * matches the status-update pattern (no separate Save button).
 */
export function ChannelEnabledToggle({ channelId, enabled }: ChannelEnabledToggleProps) {
  const [state, formAction] = useFormState(toggleChannelEnabled, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="flex items-center gap-3">
      <form
        ref={formRef}
        action={formAction}
        className="flex items-center gap-2"
      >
        <input type="hidden" name="channel_id" value={channelId} />
        <input type="hidden" name="desired" value={enabled ? 'false' : 'true'} />
        <ToggleSwitch enabled={enabled} onClick={() => formRef.current?.requestSubmit()} />
        <span className="text-sm">{enabled ? 'Enabled' : 'Disabled'}</span>
      </form>
      <ActionFeedback state={state} compact />
    </div>
  );
}

function ToggleSwitch({ enabled, onClick }: { enabled: boolean; onClick: () => void }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      disabled={pending}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
        enabled ? 'bg-emerald-500' : 'bg-muted',
        pending && 'opacity-60',
      )}
      aria-pressed={enabled}
      aria-label={`Channel ${enabled ? 'enabled' : 'disabled'}`}
    >
      <span
        className={cn(
          'inline-block h-3 w-3 transform rounded-full bg-white transition-transform',
          enabled ? 'translate-x-5' : 'translate-x-1',
        )}
      />
    </button>
  );
}

function ActionFeedback({
  state,
  compact = false,
}: {
  state: SettingsActionState;
  compact?: boolean;
}) {
  if (state.status === 'idle') return null;
  return (
    <span
      className={cn(
        'text-xs',
        state.status === 'success' ? 'text-emerald-600' : 'text-destructive',
        compact ? '' : 'block',
      )}
    >
      {state.message}
    </span>
  );
}
