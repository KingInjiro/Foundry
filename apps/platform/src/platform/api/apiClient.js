import { getAuthToken, getDevAuthUserId } from '../auth/AuthContext.jsx';

async function request(endpoint, options = {}) {
    const token = await getAuthToken();
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };
    
    const devUserId = getDevAuthUserId();
    if (devUserId) {
        headers['x-dev-uid'] = devUserId;
    }
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const config = {
        ...options,
        headers
    };

    const response = await fetch(endpoint, config);
    return response;
}

export const apiClient = {
    get: (endpoint, options) => request(endpoint, { ...options, method: 'GET' }),
    post: (endpoint, data, options) => request(endpoint, { ...options, method: 'POST', body: JSON.stringify(data) }),
    put: (endpoint, data, options) => request(endpoint, { ...options, method: 'PUT', body: JSON.stringify(data) }),
    patch: (endpoint, data, options) => request(endpoint, { ...options, method: 'PATCH', body: JSON.stringify(data) }),
    delete: (endpoint, data, options) => request(endpoint, {
        ...options,
        method: 'DELETE',
        ...(data !== undefined && { body: JSON.stringify(data) })
    })
};
