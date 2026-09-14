import { LocalZipPackageSource } from '../backend/validation/LocalZipPackageSource.js';
import { GamePackageValidator } from '../backend/validation/GamePackageValidator.js';
import { toValidationQuotas } from './uploadLimits.js';

self.addEventListener('message', async event => {
    const { requestId, file, limits } = event.data || {};
    if (!requestId || !file) return;
    try {
        const result = await new GamePackageValidator().validate(new LocalZipPackageSource(file), { quotas: toValidationQuotas(limits) });
        self.postMessage({ requestId, result });
    } catch (error) {
        self.postMessage({
            requestId,
            error: {
                code: error?.code || 'VALIDATION_EXCEPTION',
                message: error instanceof Error ? error.message : String(error)
            }
        });
    }
});
