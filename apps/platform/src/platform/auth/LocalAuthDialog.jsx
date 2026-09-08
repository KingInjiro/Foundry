import React, { useEffect, useRef, useState } from 'react';
import { LockKeyhole, X } from 'lucide-react';

export function LocalAuthDialog({ open, onClose, onSubmit }) {
    const [mode, setMode] = useState('login');
    const [username, setUsername] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const dialogRef = useRef(null);
    const usernameRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const trigger = document.activeElement;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        usernameRef.current?.focus();
        return () => {
            document.body.style.overflow = previousOverflow;
            if (trigger?.isConnected) trigger.focus();
        };
    }, [open]);

    useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = event => {
            if (event.key === 'Escape' && !busy) onClose();
            if (event.key !== 'Tab') return;
            const dialog = dialogRef.current;
            const focusable = dialog?.querySelectorAll('button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), [tabindex="0"]');
            const first = focusable?.[0];
            const last = focusable?.[focusable.length - 1];
            if (!first) {
                event.preventDefault();
                dialog?.focus();
            } else if (!dialog.contains(document.activeElement) || document.activeElement === dialog) {
                event.preventDefault();
                (event.shiftKey ? last : first).focus();
            } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
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

    const onModeKeyDown = event => {
        if (busy || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const nextMode = event.key === 'Home' ? 'login' : event.key === 'End' ? 'register' : mode === 'login' ? 'register' : 'login';
        switchMode(nextMode);
        dialogRef.current?.querySelector(`#local-auth-${nextMode}-tab`)?.focus();
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
                ref={dialogRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-labelledby="local-auth-title"
                className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-2xl border border-neutral-700 bg-neutral-900 p-6 text-white shadow-2xl"
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

                <div className="mt-5 grid grid-cols-2 rounded-lg bg-neutral-950 p-1" role="tablist" aria-label="Authentication mode" onKeyDown={onModeKeyDown}>
                    <button
                        type="button"
                        role="tab"
                        id="local-auth-login-tab"
                        aria-controls="local-auth-panel"
                        aria-selected={mode === 'login'}
                        tabIndex={mode === 'login' ? 0 : -1}
                        disabled={busy}
                        onClick={() => switchMode('login')}
                        className={`rounded-md px-3 py-2 text-sm font-semibold ${mode === 'login' ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:text-white'}`}
                    >
                        Sign In
                    </button>
                    <button
                        type="button"
                        role="tab"
                        id="local-auth-register-tab"
                        aria-controls="local-auth-panel"
                        aria-selected={mode === 'register'}
                        tabIndex={mode === 'register' ? 0 : -1}
                        disabled={busy}
                        onClick={() => switchMode('register')}
                        className={`rounded-md px-3 py-2 text-sm font-semibold ${mode === 'register' ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:text-white'}`}
                    >
                        Register
                    </button>
                </div>

                <form id="local-auth-panel" role="tabpanel" aria-labelledby={`local-auth-${mode}-tab`} aria-busy={busy} className="mt-5 space-y-4" onSubmit={submit}>
                    <label className="block text-sm font-medium text-neutral-200">
                        Username
                        <input
                            ref={usernameRef}
                            required
                            minLength={3}
                            maxLength={64}
                            autoCapitalize="none"
                            autoCorrect="off"
                            autoComplete="username"
                            aria-describedby={mode === 'register' ? 'local-auth-username-hint' : undefined}
                            value={username}
                            onChange={event => setUsername(event.target.value)}
                            className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                        />
                    </label>
                    {mode === 'register' && <p id="local-auth-username-hint" className="text-xs text-neutral-400">Use 3–64 characters: A–Z, numbers, dots, underscores or hyphens. Start with a letter or number.</p>}

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
                            aria-describedby={mode === 'register' ? 'local-auth-password-hint' : undefined}
                            value={password}
                            onChange={event => setPassword(event.target.value)}
                            className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                        />
                    </label>
                    {mode === 'register' && <p id="local-auth-password-hint" className="text-xs text-neutral-400">Use at least 12 characters. A few unrelated words make a memorable password.</p>}

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
                    Forgot your password? Contact the server operator to reset your password or re-enable your account. Email recovery is not available.
                </p>
            </section>
        </div>
    );
}
