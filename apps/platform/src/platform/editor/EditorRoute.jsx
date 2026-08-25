import React from 'react';
import EditorApp from '@foundry/engine/editor';
import { polyfill } from 'mobile-drag-drop';
import 'mobile-drag-drop/default.css';

let browserWorkaroundsInstalled = false;

function installEditorBrowserWorkarounds() {
    if (browserWorkaroundsInstalled || typeof window === 'undefined') return;
    browserWorkaroundsInstalled = true;

    polyfill({ dragImageCenterOnTouch: true });
    window.addEventListener('touchmove', () => {}, { passive: false });

    const NativeResizeObserver = window.ResizeObserver;
    if (NativeResizeObserver) {
        window.ResizeObserver = class ResizeObserver extends NativeResizeObserver {
            constructor(callback) {
                super((entries, observer) => {
                    window.requestAnimationFrame(() => {
                        try {
                            callback(entries, observer);
                        } catch {
                            // Monaco can dispatch a stale observer callback while unmounting.
                        }
                    });
                });
            }
        };
    }

    window.addEventListener('error', event => {
        if (event.message?.includes('ResizeObserver')) {
            event.stopImmediatePropagation();
            event.preventDefault();
        }
    });

    window.addEventListener('unhandledrejection', event => {
        if (event.reason?.message?.includes('ResizeObserver')) {
            event.stopImmediatePropagation();
            event.preventDefault();
        }
    });
}

installEditorBrowserWorkarounds();

export default function EditorRoute() {
    return <EditorApp />;
}
