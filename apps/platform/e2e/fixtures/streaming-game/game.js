export default class CustomGame {
    constructor(engine) {
        this.engine = engine;
    }
    async start() {
        console.log('[Game] Starting custom game, requesting test-asset.json');
        try {
            const data = await this.engine.assets.loadJSON('test', 'test-asset.json');
            console.log('[Game] Loaded asset data:', JSON.stringify(data));
            if (data.streaming === true) {
                console.log('[Game] Streaming integration successful');
            }
        } catch (err) {
            console.error('[Game] Error loading asset:', err);
        }
    }
}
