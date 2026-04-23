import { LoginForm } from './login-form';

export const metadata = {
  title: 'Sign in · Saxl',
};

type Props = {
  searchParams: { next?: string };
};

export default function LoginPage({ searchParams }: Props) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            We&apos;ll email you a magic link. No password needed.
          </p>
        </div>
        <LoginForm next={searchParams.next} />
      </div>
    </main>
  );
}
