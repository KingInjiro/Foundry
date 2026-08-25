export class StorageReference {
    constructor(provider, location, version, checksum, size) {
        this.provider = provider; // 'platform', 'external'
        this.location = location;
        this.version = version;
        this.checksum = checksum;
        this.size = size;
    }
}
