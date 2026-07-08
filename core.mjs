export const SOURCE_METADATA_KEY = 'multi_chat_lore_sources';

export function normalizeSourceName(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

export function normalizeSourceList(values) {
  const sourceValues = Array.isArray(values) ? values : [];
  const seen = new Set();
  const result = [];

  for (const value of sourceValues) {
    const name = normalizeSourceName(value);
    if (!name || seen.has(name)) {
      continue;
    }

    seen.add(name);
    result.push(name);
  }

  return result;
}

export function normalizeNativeChatLorebookNames(metadata) {
  const raw = metadata?.world_info;
  return normalizeSourceList(Array.isArray(raw) ? raw : [raw]);
}

export function readSourceState(metadata) {
  const raw = metadata?.[SOURCE_METADATA_KEY];
  const updatedAt = Number.isFinite(Number(raw?.updatedAt)) ? Number(raw.updatedAt) : 0;

  return {
    version: 1,
    sources: normalizeSourceList(raw?.sources),
    updatedAt,
  };
}

export function setSourceState(metadata, sources, now = Date.now()) {
  if (!metadata || typeof metadata !== 'object') {
    throw new Error('metadata object is required');
  }

  const normalized = normalizeSourceList(sources);

  if (!normalized.length) {
    clearSourceState(metadata);
    return [];
  }

  metadata[SOURCE_METADATA_KEY] = {
    version: 1,
    sources: normalized,
    updatedAt: now,
  };

  return normalized;
}

export function clearSourceState(metadata) {
  if (metadata && typeof metadata === 'object') {
    delete metadata[SOURCE_METADATA_KEY];
  }
}

export function getBindingConflict(name, { nativeNames = [], sources = [], globalNames = [] } = {}) {
  const sourceName = normalizeSourceName(name);
  if (!sourceName) {
    return null;
  }

  if (normalizeSourceList(nativeNames).includes(sourceName)) {
    return 'native';
  }

  if (normalizeSourceList(sources).includes(sourceName)) {
    return 'source';
  }

  if (normalizeSourceList(globalNames).includes(sourceName)) {
    return 'global';
  }

  return null;
}

export function removeSourceName(values, name) {
  const sourceName = normalizeSourceName(name);
  return normalizeSourceList(values).filter((value) => value !== sourceName);
}

export function buildWorldbookCandidateList(names, query = '', limit = 8) {
  const normalizedQuery = String(query ?? '').trim().toLowerCase();
  const normalizedLimit = Math.max(0, Number(limit) || 0);

  return normalizeSourceList(names)
    .filter((name) => !normalizedQuery || name.toLowerCase().includes(normalizedQuery))
    .slice(0, normalizedLimit);
}

export function buildInjectedSelection(snapshot, sources, excludedSources = []) {
  const excluded = new Set(normalizeSourceList(excludedSources));
  const sourceNames = normalizeSourceList(sources).filter((name) => !excluded.has(name));

  return normalizeSourceList([
    ...(Array.isArray(snapshot) ? snapshot : []),
    ...sourceNames,
  ]);
}

export function replaceArrayContents(target, values) {
  target.length = 0;
  target.push(...values);
}
