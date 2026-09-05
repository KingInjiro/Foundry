function githubHeaders(token) {
    return {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
    };
}

async function githubError(response, operation) {
    let detail = '';
    try {
        const payload = await response.json();
        detail = typeof payload?.message === 'string' ? `: ${payload.message}` : '';
    } catch {
        // The status and operation still provide a safe diagnostic.
    }
    const error = new Error(`${operation} failed with HTTP ${response.status}${detail}`);
    error.code = 'GITHUB_EXPORT_FAILED';
    error.status = response.status;
    return error;
}

function encodeUtf8Base64(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

export async function pushFilesToGitHub({ token, repository, files, fetchImpl = fetch, onProgress = () => {} }) {
    const normalizedRepository = String(repository || '').trim();
    if (!token || !/^[A-Za-z0-9._-]{1,100}$/.test(normalizedRepository)) {
        throw new Error('A session-only token and a valid repository name are required.');
    }
    const headers = githubHeaders(token);
    onProgress('Creating repository…');
    const createResponse = await fetchImpl('https://api.github.com/user/repos', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: normalizedRepository, private: true, auto_init: true })
    });

    let owner;
    if (createResponse.ok) {
        const created = await createResponse.json();
        owner = created?.owner?.login;
    } else if (createResponse.status === 422) {
        const userResponse = await fetchImpl('https://api.github.com/user', { headers });
        if (!userResponse.ok) throw await githubError(userResponse, 'GitHub account lookup');
        owner = (await userResponse.json())?.login;
        if (!owner) throw new Error('GitHub account lookup did not return an owner login.');
        const existingResponse = await fetchImpl(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(normalizedRepository)}`, { headers });
        if (!existingResponse.ok) throw await githubError(existingResponse, 'Existing repository verification');
    } else {
        throw await githubError(createResponse, 'Repository creation');
    }
    if (!owner) throw new Error('GitHub did not return a repository owner.');

    for (const file of files) {
        const encodedPath = file.path.split('/').map(encodeURIComponent).join('/');
        const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(normalizedRepository)}/contents/${encodedPath}`;
        onProgress(`Uploading ${file.path}…`);
        const existingResponse = await fetchImpl(url, { headers });
        let sha;
        if (existingResponse.ok) {
            sha = (await existingResponse.json())?.sha;
        } else if (existingResponse.status !== 404) {
            throw await githubError(existingResponse, `Reading ${file.path}`);
        }

        const uploadResponse = await fetchImpl(url, {
            method: 'PUT',
            headers,
            body: JSON.stringify({
                message: `Export ${file.path}`,
                content: file.encoding === 'base64' ? file.content : encodeUtf8Base64(file.content),
                ...(sha && { sha })
            })
        });
        if (!uploadResponse.ok) throw await githubError(uploadResponse, `Uploading ${file.path}`);
    }

    return { owner, repository: normalizedRepository, url: `https://github.com/${owner}/${normalizedRepository}` };
}
