import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { parse as parseTOML } from 'smol-toml';

export const DEFAULT_RULE_PROFILE = 'ks-basic';

const PACK_DIRS = {
  standards: ['configs', 'rule-packs', 'standards'],
  materials: ['configs', 'rule-packs', 'materials'],
  processes: ['configs', 'rule-packs', 'processes'],
};

function getProfilesDir(freecadRoot) {
  return join(freecadRoot, 'configs', 'rule-profiles');
}

function getPackDir(freecadRoot, packType) {
  return join(freecadRoot, ...PACK_DIRS[packType]);
}

function looksLikePath(name = '') {
  return name.includes('/') || name.includes('\\') || name.endsWith('.json') || name.endsWith('.toml');
}

async function parseRuleFile(filePath) {
  const content = await readFile(filePath, 'utf8');
  const ext = extname(filePath).toLowerCase();
  if (ext === '.toml') return parseTOML(content);
  return JSON.parse(content);
}

async function loadNamedConfig(dirPath, name) {
  for (const ext of ['.json', '.toml']) {
    const filePath = join(dirPath, `${name}${ext}`);
    try {
      const data = await parseRuleFile(filePath);
      return { path: filePath, data };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw Object.assign(new Error(`Rule definition not found: ${name}`), { code: 'ENOENT' });
}

async function loadProfileDefinition(freecadRoot, profileName) {
  if (looksLikePath(profileName)) {
    const profilePath = isAbsolute(profileName) ? profileName : resolve(freecadRoot, profileName);
    const data = await parseRuleFile(profilePath);
    return {
      path: profilePath,
      name: data.id || data.name || profileName.replace(/\.(json|toml)$/i, ''),
      data,
    };
  }

  const { path, data } = await loadNamedConfig(getProfilesDir(freecadRoot), profileName);
  return {
    path,
    name: data.id || data.name || profileName,
    data,
  };
}

async function loadPackDefinition(freecadRoot, packType, packName) {
  const { path, data } = await loadNamedConfig(getPackDir(freecadRoot, packType), packName);
  return {
    path,
    name: data.id || data.name || packName,
    data,
  };
}

function summarizePack(pack) {
  if (!pack) return null;
  return {
    id: pack.id || null,
    label: pack.label || pack.name || pack.id || null,
  };
}

function normalizeAliasLookup(aliases = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(aliases)) {
    normalized[String(key).toLowerCase()] = value;
  }
  return normalized;
}

export function getSelectedRuleProfileName(config = {}, options = {}) {
  if (typeof options.profileName === 'string' && options.profileName.trim()) {
    return options.profileName.trim();
  }
  if (typeof config.standards?.profile === 'string' && config.standards.profile.trim()) {
    return config.standards.profile.trim();
  }
  return options.defaultProfile || DEFAULT_RULE_PROFILE;
}

export function summarizeRuleProfile(ruleProfile) {
  if (!ruleProfile) return null;
  return {
    id: ruleProfile.id || null,
    label: ruleProfile.label || ruleProfile.id || null,
    description: ruleProfile.description || '',
    standards_pack: summarizePack(ruleProfile.standards),
    material_pack: summarizePack(ruleProfile.materials),
    process_pack: summarizePack(ruleProfile.processes),
    selection: ruleProfile.selection || null,
  };
}

export function resolveMaterialProfile(ruleProfile, materialName) {
  if (!ruleProfile || typeof materialName !== 'string' || !materialName.trim()) return null;

  const materialPack = ruleProfile.materials || {};
  const aliases = normalizeAliasLookup(materialPack.aliases || {});
  const catalog = materialPack.materials || {};
  const lookupKey = materialName.trim().toLowerCase();
  const canonicalName = aliases[lookupKey] || materialName.trim();
  const material = catalog[canonicalName];

  if (!material) return null;
  return {
    name: canonicalName,
    ...material,
    pack_id: materialPack.id || null,
    pack_label: materialPack.label || materialPack.id || null,
  };
}

export async function loadRuleProfile(freecadRoot, config = {}, options = {}) {
  const {
    fallbackProfile = DEFAULT_RULE_PROFILE,
    profileName,
    silent = true,
  } = options;

  if (!freecadRoot) return null;

  const requestedName = getSelectedRuleProfileName(config, {
    profileName,
    defaultProfile: fallbackProfile,
  });

  let profileRecord;
  let selectionReason = 'requested';

  try {
    profileRecord = await loadProfileDefinition(freecadRoot, requestedName);
  } catch (error) {
    if (error.code === 'ENOENT' && requestedName !== fallbackProfile) {
      try {
        profileRecord = await loadProfileDefinition(freecadRoot, fallbackProfile);
        selectionReason = 'fallback';
      } catch (fallbackError) {
        if (silent) return null;
        throw fallbackError;
      }
    } else if (silent) {
      return null;
    } else {
      throw error;
    }
  }

  if (!profileRecord) return null;

  try {
    const profile = profileRecord.data || {};
    const standardsPackName = profile.standards_pack;
    const materialPackName = profile.material_pack;
    const processPackName = profile.process_pack;

    const [standardsPack, materialPack, processPack] = await Promise.all([
      standardsPackName ? loadPackDefinition(freecadRoot, 'standards', standardsPackName) : Promise.resolve(null),
      materialPackName ? loadPackDefinition(freecadRoot, 'materials', materialPackName) : Promise.resolve(null),
      processPackName ? loadPackDefinition(freecadRoot, 'processes', processPackName) : Promise.resolve(null),
    ]);

    return {
      id: profile.id || profileRecord.name,
      label: profile.label || profile.name || profileRecord.name,
      description: profile.description || '',
      standards: standardsPack ? { ...standardsPack.data, id: standardsPack.name } : null,
      materials: materialPack ? { ...materialPack.data, id: materialPack.name } : null,
      processes: processPack ? { ...processPack.data, id: processPack.name } : null,
      selection: {
        requested: requestedName,
        resolved: profile.id || profileRecord.name,
        reason: selectionReason,
      },
    };
  } catch (error) {
    if (silent) return null;
    throw error;
  }
}
