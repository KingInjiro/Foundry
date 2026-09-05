import React, { useEffect, useState } from 'react';
import { LockKeyhole, X } from 'lucide-react';

export function LocalAuthDialog({ open, onClose, onSubmit }) {
    const [mode, setMode] = useState('login');
    const [username, setUsername] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = event => {
            if (event.key === 'Escape' && !busy) onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [busy, onClose, open]);

    useEffect(() => {
        if (!open) {
            setPassword('');
            setError('');
            setBusy(false);
        }
    }, [open]);

    if (!open) return null;

    const submit = async event => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        try {
            await onSubmit({ mode, username, displayName, password });
            setPassword('');
        } catch (submitError) {
            setError(submitError?.message || 'Authentication failed. Try again.');
        } finally {
            setBusy(false);
        }
    };

    const switchMode = nextMode => {
        if (busy) return;
        setMode(nextMode);
        setPassword('');
        setError('');
    };

    return (
        <div
            className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4"
            role="presentation"
            onMouseDown={event => {
                if (event.target === event.currentTarget && !busy) onClose();
            }}
        >
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="local-auth-title"
                className="w-full max-w-md rounded-2xl border border-neutral-700 bg-neutral-900 p-6 text-white shadow-2xl"
            >
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <LockKeyhole className="h-7 w-7 text-blue-400" />
                        <h1 id="local-auth-title" className="mt-3 text-2xl font-bold">
                            {mode === 'login' ? 'Sign in to Foundry' : 'Create a Foundry account'}
                        </h1>
                        <p className="mt-1 text-sm text-neutral-400">
                            This account is stored on this Foundry server.
                        </p>
                    </div>
                    <button
                        type="button"
                        aria-label="Close authentication dialog"
                        disabled={busy}
                        onClick={onClose}
                        className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-800 hover:text-white disabled:opacity-50"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="mt-5 grid grid-cols-2 rounded-lg bg-neutral-950 p-1" role="tablist" aria-label="Authentication mode">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={mode === 'login'}
                        onClick={() => switchMode('login')}
                        className={`rounded-md px-3 py-2 text-sm font-semibold ${mode === 'login' ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:text-white'}`}
                    >
                        Sign In
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={mode === 'register'}
                        onClick={() => switchMode('register')}
                        className={`rounded-md px-3 py-2 text-sm font-semibold ${mode === 'register' ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:text-white'}`}
                    >
                        Register
                    </button>
                </div>

                <form className="mt-5 space-y-4" onSubmit={submit}>
                    <label className="block text-sm font-medium text-neutral-200">
                        Username
                        <input
                            autoFocus
                            required
                            minLength={3}
                            maxLength={64}
                            autoCapitalize="none"
                            autoCorrect="off"
                            autoComplete="username"
                            value={username}
                            onChange={event => setUsername(event.target.value)}
                            className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                        />
                    </label>

                    {mode === 'register' && (
                        <label className="block text-sm font-medium text-neutral-200">
                            Display name <span className="font-normal text-neutral-500">(optional)</span>
                            <input
                                maxLength={80}
                                autoComplete="name"
                                value={displayName}
                                onChange={event => setDisplayName(event.target.value)}
                                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                            />
                        </label>
                    )}

                    <label className="block text-sm font-medium text-neutral-200">
                        Password
                        <input
                            type="password"
                            required
                            minLength={12}
                            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                            value={password}
                            onChange={event => setPassword(event.target.value)}
                            className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                        />
                    </label>

                    {error && (
                        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                            {error}
                        </p>
                    )}

                    <button
                        type="submit"
                        disabled={busy}
                        className="w-full rounded-lg bg-blue-600 px-4 py-3 font-bold hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {busy ? (mode === 'login' ? 'Signing in…' : 'Creating account…') : (mode === 'login' ? 'Sign In' : 'Create Account')}
                    </button>
                </form>

                <p className="mt-4 text-xs leading-relaxed text-neutral-500">
                    Password recovery by email is not available in single-host v1. The server operator can reset or re-enable an account.
                </p>
            </section>
        </div>
    );
}
