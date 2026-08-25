export class AIToolingProvider {
    /**
     * @param {string} prompt 
     */
    async generateAsset(prompt) {
        throw new Error("Method not implemented.");
    }

    /**
     * @param {string} context 
     */
    async generateCutscene(context) {
        throw new Error("Method not implemented.");
    }
}

export class GeminiToolingProvider extends AIToolingProvider {
    async generateAsset(prompt) {
        console.log(`Generating asset using Gemini: ${prompt}`);
        // Future Gemini API integration
        return "asset_url.png";
    }
}
