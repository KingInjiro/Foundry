import React, { useState } from 'react';
import { LogIn } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

export function ProtectedRouteGate({ area = 'this page' }) {
    const { login } = useAuth();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const signIn = async () => {
        if (busy) return;
        setBusy(true);
        setError('');
        try {
            const signedIn = await login();
            if (!signedIn) setError('Sign-in was not completed. You can try again or browse without signing in.');
        } catch (signInError) {
            setError(signInError?.message || 'Sign-in failed. Try again to continue.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <main className="min-h-screen bg-neutral-950 text-white grid place-items-center p-6">
            <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-7 text-center">
                <LogIn className="mx-auto h-8 w-8 text-blue-400" />
                <h1 className="mt-4 text-2xl font-bold">Sign in to continue</h1>
                <p className="mt-2 text-sm text-neutral-400">Your destination is preserved. Sign in to open {area}.</p>
                {error && <p className="mt-4 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-200" role="alert">{error}</p>}
                {/* Dialog cleanup may restore focus before the login continuation clears busy.
                    Keep the trigger focusable; signIn's busy guard prevents repeat activation. */}
                <button type="button" onClick={() => void signIn()} aria-disabled={busy} className="mt-5 w-full rounded-lg bg-blue-600 px-5 py-3 font-bold hover:bg-blue-500 aria-disabled:opacity-50">
                    {busy ? 'Signing in…' : 'Sign In'}
                </button>
                <nav aria-label="Public navigation" className="mt-4 flex flex-wrap justify-center gap-2 text-sm">
                    <Link to="/" className="rounded-lg px-3 py-2 text-neutral-300 hover:bg-neutral-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">Back to Home</Link>
                    <Link to="/player" className="rounded-lg px-3 py-2 text-neutral-300 hover:bg-neutral-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">Browse Catalog</Link>
                </nav>
            </div>
        </main>
    );
}
