import { readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { extname } from 'node:path';
import { isAbsolute, join, resolve } from 'node:path';
import { parse as parseTOML } from 'smol-toml';

function getProfilesDir(freecadRoot) {
  return join(freecadRoot, 'configs', 'profiles');
}

function looksLikePath(profileName) {
  return profileName.includes('/') || profileName.includes('\\') || profileName.endsWith('.json') || profileName.endsWith('.toml');
}

async function parseProfileFile(profilePath) {
  const content = await readFile(profilePath, 'utf8');
  const ext = extname(profilePath).toLowerCase();
  if (ext === '.toml') return parseTOML(content);
  return JSON.parse(content);
}

function resolveProfilePath(freecadRoot, profileName) {
  if (looksLikePath(profileName)) {
    return isAbsolute(profileName) ? profileName : resolve(freecadRoot, profileName);
  }
  return null;
}

async function loadProfileFromProfilesDir(freecadRoot, profileName) {
  const profilesDir = getProfilesDir(freecadRoot);
  for (const ext of ['.json', '.toml']) {
    const profilePath = join(profilesDir, `${profileName}${ext}`);
    try {
      const profile = await parseProfileFile(profilePath);
      return { path: profilePath, profile };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw Object.assign(new Error(`Profile not found: ${profileName}`), { code: 'ENOENT' });
}

export async function loadShopProfile(freecadRoot, profileName, options = {}) {
  const { silent = true } = options;
  if (!profileName || profileName === '_default') return null;

  try {
    const explicitPath = resolveProfilePath(freecadRoot, profileName);
    if (explicitPath) {
      return await parseProfileFile(explicitPath);
    }

    const { profile } = await loadProfileFromProfilesDir(freecadRoot, profileName);
    return profile;
  } catch (err) {
    if (silent) return null;
    throw err;
  }
}

export async function listShopProfiles(freecadRoot) {
  const profilesDir = getProfilesDir(freecadRoot);
  const files = await readdir(profilesDir);
  const profileFiles = files.filter((file) => file.endsWith('.json') || file.endsWith('.toml'));

  const profiles = await Promise.all(
    profileFiles.map(async (file) => {
      try {
        const data = await parseProfileFile(join(profilesDir, file));
        return {
          name: file.replace(/\.(json|toml)$/i, ''),
          description: data.description || '',
          label: data.label || data.name || file.replace(/\.(json|toml)$/i, ''),
        };
      } catch {
        return null;
      }
    })
  );

  return profiles.filter(Boolean);
}

export async function getShopProfile(freecadRoot, name) {
  const explicitPath = resolveProfilePath(freecadRoot, name);
  const profile = explicitPath
    ? await parseProfileFile(explicitPath)
    : (await loadProfileFromProfilesDir(freecadRoot, name)).profile;
  return { name, ...profile };
}

export async function createShopProfile(freecadRoot, name, profileData) {
  const profilePath = join(getProfilesDir(freecadRoot), `${name}.json`);
  const now = new Date().toISOString();
  const profile = { name, ...profileData, created: now, updated: now };
  await writeFile(profilePath, JSON.stringify(profile, null, 2), 'utf8');
  return { success: true, name };
}

export async function updateShopProfile(freecadRoot, name, profileData) {
  const profilePath = join(getProfilesDir(freecadRoot), `${name}.json`);
  const existing = await readFile(profilePath, 'utf8');
  const current = JSON.parse(existing);
  const updated = {
    ...current,
    ...profileData,
    name,
    created: current.created,
    updated: new Date().toISOString(),
  };
  await writeFile(profilePath, JSON.stringify(updated, null, 2), 'utf8');
  return { success: true };
}

export async function deleteShopProfile(freecadRoot, name) {
  const profilePath = join(getProfilesDir(freecadRoot), `${name}.json`);
  await unlink(profilePath);
  return { success: true };
}
