import { S3Client } from '@aws-sdk/client-s3';
import { r2RequestHandler } from './controlledR2.mjs';

// Only the compiled test launcher imports this file. Production factory,
// signing, serialization, routes, auth, jobs and ZIP processing stay real.
const original = S3Client.prototype.send;
S3Client.prototype.send = function (...args) {
    this.config.requestHandler = r2RequestHandler(process.env.FOUNDRY_TEST_R2_ORIGIN);
    this.config.maxAttempts = async () => 1;
    return original.apply(this, args);
};
