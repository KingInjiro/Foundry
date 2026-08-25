export class RevenueSharePolicy {
    constructor(storageMode) {
        this.storageMode = storageMode;
        if (storageMode === 'platform') {
            this.platformPercent = 0.80;
            this.developerPercent = 0.20;
        } else {
            this.platformPercent = 0.70;
            this.developerPercent = 0.30;
        }
    }

    calculateDeveloperShare(grossRevenue) {
        return grossRevenue * this.developerPercent;
    }
}

export class MonetizationProvider {
    async initializeSession(user, game) {
        throw new Error("Method not implemented.");
    }

    async requestAd(session, type) {
        throw new Error("Method not implemented.");
    }

    async reportCompletion(session, adId) {
        throw new Error("Method not implemented.");
    }
}
