async function parseError(response) {
  try {
    const payload = await response.json();
    return payload?.error?.messages?.join(' ') || payload?.message || `${response.status}`;
  } catch {
    return `${response.status}`;
  }
}

async function fetchConfigJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json();
}

export async function listStudioConfigProfiles() {
  const payload = await fetchConfigJson('/api/config/profiles');
  return Array.isArray(payload?.profiles) ? payload.profiles : [];
}
