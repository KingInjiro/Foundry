// Best-effort browser hint. This applies to the Foundry origin as a whole;
// it never guarantees that a particular game's cache will be kept forever.
export async function requestPersistentStorage() {
    try {
        if (!navigator.storage?.persist) return false;
        if (navigator.storage.persisted && await navigator.storage.persisted()) return true;
        return Boolean(await navigator.storage.persist());
    } catch {
        return false;
    }
}
