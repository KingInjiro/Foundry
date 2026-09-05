import { getAuthToken, getCsrfToken, getDevAuthUserId } from '../auth/AuthContext.jsx';

const DEFAULT_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
    constructor({ code = 'API_ERROR', message = 'Platform request failed.', status = 0, details = null, requestId = null, cause } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = 'ApiError';
        this.code = code;
        this.status = status;
        this.details = details;
        this.requestId = requestId;
    }
}

function createRequestSignal(externalSignal, timeoutMs) {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromExternal = () => controller.abort(externalSignal.reason);
    if (externalSignal) {
        if (externalSignal.aborted) abortFromExternal();
        else externalSignal.addEventListener('abort', abortFromExternal, { once: true });
    }
    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort(new DOMException('Platform request timed out.', 'TimeoutError'));
    }, Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));

    return {
        signal: controller.signal,
        didTimeout: () => timedOut,
        cleanup() {
            clearTimeout(timeoutId);
            externalSignal?.removeEventListener('abort', abortFromExternal);
        }
    };
}

export async function request(endpoint, options = {}) {
    const token = await getAuthToken();
    const headers = new Headers(options.headers || {});
    const bodyIsFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (options.body !== undefined && !bodyIsFormData && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    const devUserId = getDevAuthUserId();
    if (devUserId) headers.set('x-dev-uid', devUserId);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const method = String(options.method || 'GET').toUpperCase();
    const csrfToken = getCsrfToken();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
        headers.set('X-CSRF-Token', csrfToken);
    }

    const requestSignal = createRequestSignal(options.signal, options.timeoutMs);
    try {
        return await fetch(endpoint, {
            ...options,
            credentials: options.credentials || 'same-origin',
            headers,
            signal: requestSignal.signal
        });
    } catch (error) {
        if (requestSignal.didTimeout()) {
            throw new ApiError({ code: 'REQUEST_TIMEOUT', message: 'The Platform request timed out. Try again.', cause: error });
        }
        if (requestSignal.signal.aborted) {
            throw new ApiError({ code: 'REQUEST_ABORTED', message: 'The Platform request was cancelled.', cause: error });
        }
        throw new ApiError({ code: 'NETWORK_ERROR', message: 'Could not reach the Platform. Check your connection and try again.', cause: error });
    } finally {
        requestSignal.cleanup();
    }
}

export async function requestJson(endpoint, options = {}) {
    const response = await request(endpoint, options);
    const requestId = response.headers.get('x-request-id');
    const text = await response.text();
    let payload = null;
    if (text) {
        try {
            payload = JSON.parse(text);
        } catch (error) {
            throw new ApiError({
                code: 'INVALID_API_RESPONSE',
                message: 'The Platform returned an invalid response.',
                status: response.status,
                requestId,
                cause: error
            });
        }
    }

    if (!response.ok || payload?.success === false) {
        throw new ApiError({
            code: payload?.error?.code || `HTTP_${response.status}`,
            message: payload?.error?.message || `Platform request failed with status ${response.status}.`,
            status: response.status,
            details: payload?.error?.details || null,
            requestId
        });
    }
    return payload?.data ?? payload;
}

function jsonBody(data) {
    return data === undefined ? undefined : JSON.stringify(data);
}

export const apiClient = {
    requestJson,
    get: (endpoint, options) => request(endpoint, { ...options, method: 'GET' }),
    post: (endpoint, data, options) => request(endpoint, { ...options, method: 'POST', body: jsonBody(data) }),
    put: (endpoint, data, options) => request(endpoint, { ...options, method: 'PUT', body: jsonBody(data) }),
    patch: (endpoint, data, options) => request(endpoint, { ...options, method: 'PATCH', body: jsonBody(data) }),
    delete: (endpoint, data, options) => request(endpoint, {
        ...options,
        method: 'DELETE',
        ...(data !== undefined && { body: jsonBody(data) })
    }),
    json: {
        get: (endpoint, options) => requestJson(endpoint, { ...options, method: 'GET' }),
        post: (endpoint, data, options) => requestJson(endpoint, { ...options, method: 'POST', body: jsonBody(data) }),
        put: (endpoint, data, options) => requestJson(endpoint, { ...options, method: 'PUT', body: jsonBody(data) }),
        patch: (endpoint, data, options) => requestJson(endpoint, { ...options, method: 'PATCH', body: jsonBody(data) }),
        delete: (endpoint, data, options) => requestJson(endpoint, {
            ...options,
            method: 'DELETE',
            ...(data !== undefined && { body: jsonBody(data) })
        })
    }
};
