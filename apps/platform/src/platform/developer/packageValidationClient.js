async function validateDirectly(file) {
    const [{ LocalZipPackageSource }, { GamePackageValidator }] = await Promise.all([
        import('../backend/validation/LocalZipPackageSource.js'),
        import('../backend/validation/GamePackageValidator.js')
    ]);
    return new GamePackageValidator().validate(new LocalZipPackageSource(file));
}

export async function validatePackageOffMainThread(file) {
    if (typeof Worker !== 'function') return validateDirectly(file);

    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./packageValidation.worker.js', import.meta.url), {
            type: 'module',
            name: 'foundry-package-validator'
        });
        const requestId = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
        const finish = callback => value => {
            worker.terminate();
            callback(value);
        };
        worker.addEventListener('message', event => {
            if (event.data?.requestId !== requestId) return;
            if (event.data.error) {
                const error = new Error(event.data.error.message || 'Package validation failed.');
                error.code = event.data.error.code;
                finish(reject)(error);
                return;
            }
            finish(resolve)(event.data.result);
        });
        worker.addEventListener('error', event => {
            finish(reject)(new Error(event.message || 'The package validation worker failed.'));
        }, { once: true });
        worker.postMessage({ requestId, file });
    });
}
