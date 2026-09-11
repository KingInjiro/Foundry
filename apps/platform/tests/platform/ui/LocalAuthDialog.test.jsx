/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalAuthDialog } from '../../../src/platform/auth/LocalAuthDialog.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('local authentication dialog usability', () => {
    let container, root, opener, onClose, onSubmit;
    const dialog = () => container.querySelector('[role="dialog"]');
    const username = () => container.querySelector('input[autocomplete="username"]');
    const submit = () => container.querySelector('button[type="submit"]');
    const key = (target, value, options = {}) => target.dispatchEvent(new KeyboardEvent('keydown', {
        key: value, bubbles: true, cancelable: true, ...options
    }));
    const render = async (open, props = {}) => act(async () => root.render(<LocalAuthDialog open={open} onClose={onClose} onSubmit={onSubmit} {...props} />));

    beforeEach(() => {
        container = document.createElement('div');
        opener = document.createElement('button');
        opener.textContent = 'Open sign in';
        document.body.append(opener, container);
        opener.focus();
        root = createRoot(container);
        onClose = vi.fn();
        onSubmit = vi.fn();
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        opener.remove();
        document.body.style.overflow = '';
        vi.restoreAllMocks();
    });

    it('contains keyboard focus and restores the trigger and page scroll on close', async () => {
        document.body.style.overflow = 'auto';
        await render(true);
        expect(document.activeElement).toBe(username());
        expect(document.body.style.overflow).toBe('hidden');
        submit().focus();
        await act(async () => key(submit(), 'Tab'));
        const close = container.querySelector('[aria-label="Close authentication dialog"]');
        expect(document.activeElement).toBe(close);
        await act(async () => key(close, 'Tab', { shiftKey: true }));
        expect(document.activeElement).toBe(submit());
        await render(false);
        expect(document.activeElement).toBe(opener);
        expect(document.body.style.overflow).toBe('auto');
    });

    it('supports keyboard mode selection and explains registration requirements', async () => {
        await render(true);
        const tabs = container.querySelectorAll('[role="tab"]');
        tabs[0].focus();
        await act(async () => key(tabs[0], 'ArrowRight'));
        expect(tabs[1].getAttribute('aria-selected')).toBe('true');
        expect(document.activeElement).toBe(tabs[1]);
        expect(container.querySelector('[role="tabpanel"]').getAttribute('aria-labelledby')).toBe(tabs[1].id);
        const password = container.querySelector('input[type="password"]');
        expect(password.minLength).toBe(12);
        expect(document.getElementById(password.getAttribute('aria-describedby')).textContent).toContain('12');
        expect(document.getElementById(username().getAttribute('aria-describedby')).textContent).toContain('3');
    });

    it('keeps the dialog open during submission and preserves a visible failure for retry', async () => {
        let reject;
        onSubmit.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
        await render(true);
        await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        expect(submit().disabled).toBe(true);
        await act(async () => key(window, 'Escape'));
        expect(onClose).not.toHaveBeenCalled();
        expect([...container.querySelectorAll('[role="tab"]')].every(tab => tab.disabled)).toBe(true);
        await act(async () => reject(new Error('Username or password is incorrect.')));
        expect(container.querySelector('[role="alert"]').textContent).toContain('Username or password is incorrect.');
        expect(submit().disabled).toBe(false);
        expect(dialog()).not.toBeNull();
    });

    it.each(['login', 'register'])('preserves the %s form submission contract', async mode => {
        await render(true);
        if (mode === 'register') {
            await act(async () => container.querySelectorAll('[role="tab"]')[1].click());
        }
        const setValue = async (input, value) => act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await setValue(username(), 'navigation-user');
        await setValue(container.querySelector('input[type="password"]'), 'navigation test password');
        if (mode === 'register') await setValue(container.querySelector('input[autocomplete="name"]'), 'Navigation User');
        await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
            mode,
            username: 'navigation-user',
            password: 'navigation test password',
            displayName: mode === 'register' ? 'Navigation User' : ''
        });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('shows optional Google sign-in in both modes while keeping local fields and keyboard dismissal', async () => {
        await render(true);
        expect(container.textContent).not.toContain('Continue with Google');
        const onGoogle = vi.fn();
        await render(true, { onGoogle });
        const google = [...container.querySelectorAll('button')].find(button => button.textContent.includes('Continue with Google'));
        expect(google.type).toBe('button');
        expect(google.querySelector('img').alt).toBe('');
        await act(async () => container.querySelectorAll('[role="tab"]')[1].click());
        expect(google.isConnected).toBe(true);
        expect(username()).not.toBeNull();
        expect(container.querySelector('input[type="password"]')).not.toBeNull();
        google.focus();
        await act(async () => key(google, 'Escape'));
        expect(onClose).toHaveBeenCalledOnce();
        await render(false, { onGoogle });
        expect(document.activeElement).toBe(opener);
    });

    it('recovers from a failed Google start and allows the unchanged local submission', async () => {
        let reject;
        const onGoogle = vi.fn(() => new Promise((_, fail) => { reject = fail; }));
        await render(true, { onGoogle });
        const google = [...container.querySelectorAll('button')].find(button => button.textContent.includes('Continue with Google'));
        await act(async () => google.click());
        expect(onGoogle).toHaveBeenCalledOnce();
        expect(onSubmit).not.toHaveBeenCalled();
        expect(google.disabled).toBe(true);
        expect(submit().disabled).toBe(true);
        await act(async () => key(window, 'Escape'));
        expect(onClose).not.toHaveBeenCalled();
        await act(async () => reject(new Error('Google start unavailable')));
        expect(container.querySelector('[role="alert"]').textContent).toBe('Google start unavailable');
        expect(google.disabled).toBe(false);
        expect(submit().disabled).toBe(false);
        await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        expect(onSubmit).toHaveBeenCalledOnce();
    });
});
