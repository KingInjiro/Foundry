import { apiClient } from '../api/apiClient.js';

async function loadCollection(client, endpoint, label) {
    const response = await client.get(endpoint);
    let result;
    try {
        result = await response.json();
    } catch {
        throw new Error(`${label} returned an unreadable response.`);
    }
    if (!response.ok || !result.success) {
        throw new Error(result.error?.message || `${label} could not be loaded.`);
    }
    return result.data;
}

async function runLibraryAction(client, endpoint, label) {
    const response = await client.delete(endpoint);
    let result;
    try {
        result = await response.json();
    } catch {
        throw new Error(`${label} returned an unreadable response.`);
    }
    if (!response.ok || !result.success) {
        throw new Error(result.error?.message || `${label} could not be completed.`);
    }
    return result.data;
}

export async function loadLibraryCollections(client = apiClient) {
    const requests = [
        ['saved', '/api/library', 'Saved games'],
        ['recent', '/api/continue-playing', 'Recently played games'],
        ['following', '/api/following', 'Followed developers']
    ];
    const settled = await Promise.allSettled(
        requests.map(([, endpoint, label]) => loadCollection(client, endpoint, label))
    );

    const result = {
        saved: [],
        recent: [],
        following: { developers: [], games: [] },
        errors: []
    };

    settled.forEach((entry, index) => {
        const [key, , label] = requests[index];
        if (entry.status === 'fulfilled') {
            if (key === 'following') {
                const value = entry.value;
                result.following = value && typeof value === 'object'
                    ? {
                        developers: Array.isArray(value.developers) ? value.developers : [],
                        games: Array.isArray(value.games) ? value.games : []
                    }
                    : { developers: [], games: [] };
            } else {
                result[key] = Array.isArray(entry.value) ? entry.value : [];
            }
        } else {
            result.errors.push(entry.reason?.message || `${label} could not be loaded.`);
        }
    });

    return result;
}

export function removeSavedGame(gameId, client = apiClient) {
    return runLibraryAction(client, `/api/library/${encodeURIComponent(gameId)}`, 'Removing the saved game');
}

export function dismissRecentGame(gameId, client = apiClient) {
    return runLibraryAction(client, `/api/continue-playing/${encodeURIComponent(gameId)}`, 'Hiding the recently played game');
}

export function unfollowDeveloper(developerUid, client = apiClient) {
    return runLibraryAction(client, `/api/developers/${encodeURIComponent(developerUid)}/follow`, 'Unfollowing the developer');
}
