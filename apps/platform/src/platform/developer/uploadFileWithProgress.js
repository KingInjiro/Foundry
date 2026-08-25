export class UploadCancelledError extends Error {
    constructor(message = 'Upload cancelled. You can resume this upload session.') {
        super(message);
        this.name = 'UploadCancelledError';
        this.code = 'UPLOAD_CANCELLED';
    }
}

export function uploadFileWithProgress({ url, file, signal, onProgress = () => {}, XMLHttpRequestImpl = globalThis.XMLHttpRequest }) {
    if (typeof XMLHttpRequestImpl !== 'function') {
        return Promise.reject(new Error('This browser does not support upload progress.'));
    }
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequestImpl();
        let settled = false;

        const cleanup = () => signal?.removeEventListener('abort', abort);
        const finish = callback => value => {
            if (settled) return;
            settled = true;
            cleanup();
            callback(value);
        };
        const succeed = finish(resolve);
        const fail = finish(reject);
        const abort = () => xhr.abort();

        if (signal?.aborted) {
            fail(new UploadCancelledError());
            return;
        }
        signal?.addEventListener('abort', abort, { once: true });

        xhr.open('PUT', url, true);
        xhr.setRequestHeader('Content-Type', 'application/zip');
        xhr.upload.addEventListener('progress', event => {
            const total = event.lengthComputable && event.total > 0 ? event.total : Number(file?.size || 0);
            const percentage = total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0;
            onProgress({ loaded: event.loaded, total, percentage });
        });
        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) succeed({ status: xhr.status });
            else fail(new Error(`The package upload failed (HTTP ${xhr.status || 'unknown'}). Please try again.`));
        });
        xhr.addEventListener('error', () => fail(new Error('The package upload failed because the connection was interrupted. Please try again.')));
        xhr.addEventListener('timeout', () => fail(new Error('The package upload timed out. Please try again.')));
        xhr.addEventListener('abort', () => fail(new UploadCancelledError()));
        xhr.send(file);
    });
}
