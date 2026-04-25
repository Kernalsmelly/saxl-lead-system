import { redirect } from 'next/navigation';

// /app is a thin redirect to the leads index — that's the dashboard
// home for now. When more sections land (settings, billing, etc.)
// we'll either keep this redirect or build a real overview here.
export default function AppHome() {
  redirect('/app/leads');
}
