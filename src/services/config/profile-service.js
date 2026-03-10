import { readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

function getProfilesDir(freecadRoot) {
  return join(freecadRoot, 'configs', 'profiles');
}

export async function loadShopProfile(freecadRoot, profileName, options = {}) {
  const { silent = true } = options;
  if (!profileName || profileName === '_default') return null;

  try {
    const profilePath = join(getProfilesDir(freecadRoot), `${profileName}.json`);
    const content = await readFile(profilePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (silent) return null;
    throw err;
  }
}

export async function listShopProfiles(freecadRoot) {
  const profilesDir = getProfilesDir(freecadRoot);
  const files = await readdir(profilesDir);
  const jsonFiles = files.filter((file) => file.endsWith('.json'));

  const profiles = await Promise.all(
    jsonFiles.map(async (file) => {
      try {
        const content = await readFile(join(profilesDir, file), 'utf8');
        const data = JSON.parse(content);
        return {
          name: file.replace('.json', ''),
          description: data.description || '',
          label: data.label || file.replace('.json', ''),
        };
      } catch {
        return null;
      }
    })
  );

  return profiles.filter(Boolean);
}

export async function getShopProfile(freecadRoot, name) {
  const profilePath = join(getProfilesDir(freecadRoot), `${name}.json`);
  const content = await readFile(profilePath, 'utf8');
  const profile = JSON.parse(content);
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
