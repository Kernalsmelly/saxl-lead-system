'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';

const schema = z.object({
  email: z.string().email(),
  next: z.string().optional(),
});

export type LoginState =
  | { status: 'idle' }
  | { status: 'sent'; email: string }
  | { status: 'error'; message: string };

export async function sendMagicLink(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: formData.get('email'),
    next: formData.get('next') ?? undefined,
  });

  if (!parsed.success) {
    return { status: 'error', message: 'Enter a valid email address.' };
  }

  const { email, next } = parsed.data;
  const supabase = createClient();

  const redirectTo = new URL('/auth/callback', env.NEXT_PUBLIC_APP_URL);
  if (next) redirectTo.searchParams.set('next', next);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo.toString() },
  });

  if (error) {
    return { status: 'error', message: error.message };
  }

  return { status: 'sent', email };
}
