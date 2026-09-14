import { toValidationQuotas } from './uploadLimits.js';

async function validateDirectly(file, limits) {
    const [{ LocalZipPackageSource }, { GamePackageValidator }] = await Promise.all([
        import('../backend/validation/LocalZipPackageSource.js'),
        import('../backend/validation/GamePackageValidator.js')
    ]);
    return new GamePackageValidator().validate(new LocalZipPackageSource(file), { quotas: toValidationQuotas(limits) });
}

export async function validatePackageOffMainThread(file, { limits, signal } = {}) {
    toValidationQuotas(limits);
    if (signal?.aborted) throw new DOMException('Validation cancelled.', 'AbortError');
    if (typeof Worker !== 'function') return validateDirectly(file, limits);

    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./packageValidation.worker.js', import.meta.url), {
            type: 'module',
            name: 'foundry-package-validator'
        });
        const requestId = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
        const finish = callback => value => {
            signal?.removeEventListener('abort', abort);
            worker.terminate();
            callback(value);
        };
        const abort = () => finish(reject)(new DOMException('Validation cancelled.', 'AbortError'));
        signal?.addEventListener('abort', abort, { once: true });
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
        worker.postMessage({ requestId, file, limits });
    });
}
