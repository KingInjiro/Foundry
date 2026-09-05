window.addEventListener('error', event => {
    if (event.message && (
        event.message.includes('ResizeObserver loop')
        || event.message.includes('ResizeObserver loop completed with undelivered notifications.')
    )) {
        event.stopImmediatePropagation();
        event.preventDefault();
    }
});
