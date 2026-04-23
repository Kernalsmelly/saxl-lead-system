'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { sendMagicLink, type LoginState } from './actions';

const initialState: LoginState = { status: 'idle' };

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useFormState(sendMagicLink, initialState);

  if (state.status === 'sent') {
    return (
      <div className="rounded-md border bg-muted/30 p-4 text-sm">
        Check <span className="font-medium">{state.email}</span> for a sign-in link.
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>
      <SubmitButton />
      {state.status === 'error' ? (
        <p className="text-sm text-destructive">{state.message}</p>
      ) : null}
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Sending…' : 'Send magic link'}
    </Button>
  );
}
