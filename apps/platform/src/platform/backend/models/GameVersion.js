export class GameVersion {
    constructor(id, gameId, versionString, storageReference, publicationStatus, createdAt) {
        this.id = id;
        this.gameId = gameId;
        this.versionString = versionString;
        this.storageReference = storageReference; // Instance of StorageReference
        this.publicationStatus = publicationStatus; // 'DRAFT', 'PUBLISHED', 'ARCHIVED'
        this.createdAt = createdAt;
    }
}
