export function assertSafeRuntimeMode(env = process.env) {
    const production = env.NODE_ENV === 'production';
    const e2eMode = env.E2E_MODE === 'true';
    const localDevMode = env.LOCAL_DEV_MODE === 'true';
    const singleHostTestMode = env.SINGLE_HOST_TEST_MODE === 'true';
    const devAuthBypass = env.AUTH_DEV_BYPASS === 'true';

    if (production && e2eMode) {
        throw new Error('Refusing to start: E2E_MODE cannot be enabled when NODE_ENV=production.');
    }
    if (production && localDevMode) {
        throw new Error('Refusing to start: LOCAL_DEV_MODE cannot be enabled when NODE_ENV=production.');
    }
    if (production && devAuthBypass) {
        throw new Error('Refusing to start: AUTH_DEV_BYPASS cannot be enabled when NODE_ENV=production.');
    }
    if (production && singleHostTestMode) {
        throw new Error('Refusing to start: SINGLE_HOST_TEST_MODE cannot be enabled when NODE_ENV=production.');
    }
    if (singleHostTestMode && (e2eMode || localDevMode || devAuthBypass)) {
        throw new Error('Refusing to start: SINGLE_HOST_TEST_MODE cannot be combined with E2E_MODE, LOCAL_DEV_MODE, or AUTH_DEV_BYPASS.');
    }
    if (production && env.JOB_MODE === 'inline') {
        throw new Error('Refusing to start: JOB_MODE=inline cannot be enabled when NODE_ENV=production.');
    }

    return {
        production,
        e2eMode,
        localDevMode: !production && localDevMode,
        singleHostTestMode: !production && singleHostTestMode
    };
}
