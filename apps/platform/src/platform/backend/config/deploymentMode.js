export const DEPLOYMENT_MODES = Object.freeze({
    CLOUD: 'cloud',
    SINGLE_HOST: 'single-host'
});

const SUPPORTED_MODES = new Set(Object.values(DEPLOYMENT_MODES));

export function resolveDeploymentMode(env = process.env, { requireExplicit = false } = {}) {
    const configured = typeof env.FOUNDRY_DEPLOYMENT_MODE === 'string'
        ? env.FOUNDRY_DEPLOYMENT_MODE.trim()
        : '';
    if (!configured) {
        if (requireExplicit) {
            const error = new Error('FOUNDRY_DEPLOYMENT_MODE must be explicitly set to cloud or single-host.');
            error.code = 'DEPLOYMENT_MODE_REQUIRED';
            throw error;
        }
        return DEPLOYMENT_MODES.CLOUD;
    }
    if (!SUPPORTED_MODES.has(configured)) {
        const error = new Error('FOUNDRY_DEPLOYMENT_MODE must be exactly cloud or single-host.');
        error.code = 'INVALID_DEPLOYMENT_MODE';
        throw error;
    }
    return configured;
}

export function isSingleHostMode(env = process.env) {
    return resolveDeploymentMode(env) === DEPLOYMENT_MODES.SINGLE_HOST;
}
