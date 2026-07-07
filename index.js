import {
  chat_metadata,
  eventSource,
  event_types,
  getCurrentChatId,
  saveMetadata,
} from '../../../../script.js';
import {
  createNewWorldInfo,
  loadWorldInfo,
  openWorldInfoEditor,
  selected_world_info,
  world_names,
} from '../../../world-info.js';
import { POPUP_RESULT, POPUP_TYPE, callGenericPopup } from '../../../popup.js';
import {
  buildInjectedSelection,
  buildWorldbookCandidateList,
  getBindingConflict,
  normalizeNativeChatLorebookNames,
  normalizeSourceName,
  removeSourceName,
  readSourceState,
  replaceArrayContents,
  setSourceState,
} from './core.mjs';

const EXTENSION_NAME = '聊天世界书肋手';
const MENU_BUTTON_ID = 'chat_lore_sources_button';
const MENU_BADGE_ID = 'chat_lore_sources_badge';
const STYLE_ID = 'chat_lore_sources_styles';

const state = {
  started: false,
  menuButton: null,
  menuRetryTimer: null,
  popupOpen: false,
  lastMenuMissLoggedAt: 0,
};

const runtime = {
  active: false,
  selectedSnapshot: null,
  injectedSources: [],
  reason: null,
};

function log(...args) {
  console.log(`[${EXTENSION_NAME}]`, ...args);
}

function warn(...args) {
  console.warn(`[${EXTENSION_NAME}]`, ...args);
}

function formatError(value) {
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function infoToast(message) {
  globalThis.toastr?.info?.(message, EXTENSION_NAME);
}

function successToast(message) {
  globalThis.toastr?.success?.(message, EXTENSION_NAME);
}

function errorToast(message) {
  globalThis.toastr?.error?.(message, EXTENSION_NAME);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hasActiveChat() {
  return Boolean(getCurrentChatId?.());
}

function getMetadata() {
  return chat_metadata ?? {};
}

function getNativeChatLorebookNames() {
  return normalizeNativeChatLorebookNames(getMetadata());
}

function isNativeChatLorebookName(name) {
  const sourceName = normalizeSourceName(name);
  return Boolean(sourceName && getNativeChatLorebookNames().includes(sourceName));
}

function listSources() {
  return readSourceState(getMetadata()).sources;
}

function listGlobalWorldbookNames() {
  return Array.isArray(selected_world_info)
    ? selected_world_info.map((value) => normalizeSourceName(value)).filter(Boolean)
    : [];
}

async function writeSources(sources) {
  const written = setSourceState(getMetadata(), sources);
  await saveMetadata();
  refreshMenuButton();
  return written;
}

async function writeNativeChatLorebook(name) {
  const sourceName = normalizeSourceName(name);
  if (sourceName) {
    getMetadata().world_info = sourceName;
    $('.chat_lorebook_button').addClass('world_set');
  } else {
    delete getMetadata().world_info;
    $('.chat_lorebook_button').removeClass('world_set');
  }

  await saveMetadata();
  refreshMenuButton();
  return sourceName;
}

function syncGlobalWorldbookSelect(names) {
  const indexes = names
    .map((name) => world_names.indexOf(name))
    .filter((index) => index >= 0)
    .map((index) => String(index));

  $('#world_info').val(indexes.length ? indexes : null).trigger('change');
}

function removeGlobalWorldbook(name) {
  const current = listGlobalWorldbookNames();
  const next = removeSourceName(current, name);
  if (next.length === current.length) {
    return false;
  }

  replaceArrayContents(selected_world_info, next);
  syncGlobalWorldbookSelect(next);
  return true;
}

async function confirmMoveFromGlobal(sourceName) {
  const result = await callGenericPopup(
    `《${escapeHtml(sourceName)}》已在全局世界书启用。要从全局移除，并改为在此面板绑定吗？`,
    POPUP_TYPE.CONFIRM,
    '',
    {
      okButton: '移除并绑定',
      cancelButton: '取消',
    },
  );

  return result === POPUP_RESULT.AFFIRMATIVE;
}

async function prepareExtensionBinding(sourceName, targetKind) {
  const nativeNames = getNativeChatLorebookNames();
  const sources = listSources();
  const globalNames = listGlobalWorldbookNames();
  const conflict = getBindingConflict(sourceName, { nativeNames, sources, globalNames });

  if (conflict === targetKind) {
    infoToast(`已经绑定过：${sourceName}`);
    return false;
  }

  if (conflict === 'native') {
    infoToast(`已在原生绑定中：${sourceName}`);
    return false;
  }

  if (conflict === 'source') {
    infoToast(`已在额外来源中：${sourceName}`);
    return false;
  }

  if (conflict === 'global') {
    if (!(await confirmMoveFromGlobal(sourceName))) {
      return false;
    }

    removeGlobalWorldbook(sourceName);
  }

  return true;
}

async function worldbookExists(name) {
  const sourceName = normalizeSourceName(name);
  if (!sourceName) {
    return false;
  }

  try {
    const data = await loadWorldInfo(sourceName);
    return Boolean(data);
  } catch (error) {
    warn(`读取世界书失败: ${sourceName}\n${formatError(error)}`);
    return false;
  }
}

async function addSource(name) {
  if (!hasActiveChat()) {
    errorToast('当前没有活动聊天，无法添加来源世界书');
    return false;
  }

  const sourceName = normalizeSourceName(name);
  if (!sourceName) {
    infoToast('请输入世界书名称');
    return false;
  }

  if (!(await worldbookExists(sourceName))) {
    warn(`来源世界书不存在，拒绝自动创建: ${sourceName}`);
    errorToast(`找不到世界书：${sourceName}`);
    return false;
  }

  if (!(await prepareExtensionBinding(sourceName, 'source'))) {
    return false;
  }

  const current = listSources();
  await writeSources([...current, sourceName]);
  successToast(`已添加额外来源：${sourceName}`);
  return true;
}

async function setNativeChatLorebook(name) {
  if (!hasActiveChat()) {
    errorToast('当前没有活动聊天，无法设置原生绑定');
    return false;
  }

  const sourceName = normalizeSourceName(name);
  if (!sourceName) {
    infoToast('请输入世界书名称');
    return false;
  }

  if (!(await worldbookExists(sourceName))) {
    warn(`原生绑定世界书不存在: ${sourceName}`);
    errorToast(`找不到世界书：${sourceName}`);
    return false;
  }

  if (!(await prepareExtensionBinding(sourceName, 'native'))) {
    return false;
  }

  await writeNativeChatLorebook(sourceName);
  successToast(`已设为原生绑定：${sourceName}`);
  return true;
}

async function removeNativeChatLorebook(name) {
  const sourceName = normalizeSourceName(name);
  if (!sourceName || !isNativeChatLorebookName(sourceName)) {
    return false;
  }

  const next = removeSourceName(getNativeChatLorebookNames(), sourceName);
  await writeNativeChatLorebook(next[0] ?? null);
  successToast(`已移除原生绑定：${sourceName}`);
  return true;
}

async function removeSource(name) {
  const sourceName = normalizeSourceName(name);
  if (!sourceName) {
    return false;
  }

  const current = listSources();
  const next = current.filter((item) => item !== sourceName);
  if (next.length === current.length) {
    return false;
  }

  await writeSources(next);
  successToast(`已移除来源世界书：${sourceName}`);
  return true;
}

async function clearSources() {
  await writeSources([]);
  successToast('已清空当前聊天的来源世界书列表');
}

async function setSources(names) {
  const requested = Array.isArray(names) ? names : [];
  const nativeNames = getNativeChatLorebookNames();
  const valid = [];
  const missing = [];

  for (const rawName of requested) {
    const name = normalizeSourceName(rawName);
    if (!name || valid.includes(name)) {
      continue;
    }

    if (nativeNames.includes(name)) {
      continue;
    }

    if (await worldbookExists(name)) {
      valid.push(name);
    } else {
      missing.push(name);
    }
  }

  if (missing.length) {
    warn(`以下来源世界书不存在，已忽略: ${missing.join(', ')}`);
    errorToast(`部分世界书不存在：${missing.join(', ')}`);
  }

  return await writeSources(valid);
}

async function createEmptySource(name) {
  if (!hasActiveChat()) {
    errorToast('当前没有活动聊天，无法创建来源世界书');
    return false;
  }

  const sourceName = normalizeSourceName(name);
  if (!sourceName) {
    infoToast('请输入要创建的世界书名称');
    return false;
  }

  if (isNativeChatLorebookName(sourceName)) {
    infoToast(`已在原生绑定中：${sourceName}`);
    return false;
  }

  if (await worldbookExists(sourceName)) {
    return await addSource(sourceName);
  }

  let created = false;
  try {
    created = await createNewWorldInfo(sourceName, { interactive: false });
  } catch (error) {
    warn(`创建空世界书失败: ${sourceName}\n${formatError(error)}`);
    errorToast(`创建空世界书失败：${sourceName}`);
    return false;
  }

  if (!created) {
    errorToast(`未创建世界书：${sourceName}`);
    return false;
  }

  if (Array.isArray(world_names) && !world_names.includes(sourceName)) {
    world_names.push(sourceName);
  }

  successToast(`已创建空世界书：${sourceName}`);
  return await addSource(sourceName);
}

function openWorldbook(name) {
  const sourceName = normalizeSourceName(name);
  if (!sourceName) {
    return;
  }

  openWorldInfoEditor(sourceName);
  setTimeout(() => {
    $('.popup[open] .popup-button-close').last().trigger('click');
  }, 0);
}

async function collectValidSources(sourceNames) {
  const nativeNames = getNativeChatLorebookNames();
  const valid = [];
  const missing = [];

  for (const name of sourceNames) {
    if (nativeNames.includes(name)) {
      continue;
    }

    if (await worldbookExists(name)) {
      valid.push(name);
    } else {
      missing.push(name);
    }
  }

  if (missing.length) {
    warn(`生成前跳过不存在的来源世界书: ${missing.join(', ')}`);
  }

  return { valid, missing };
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function beginRuntimeInjection(reason = 'unknown') {
  if (runtime.active) {
    restoreRuntimeInjection(`restart:${reason}`);
  }

  const configuredSources = listSources();
  if (!configuredSources.length) {
    return false;
  }

  const { valid } = await collectValidSources(configuredSources);
  if (!valid.length) {
    return false;
  }

  const snapshot = Array.isArray(selected_world_info) ? selected_world_info.slice() : [];
  const nextSelection = buildInjectedSelection(snapshot, valid, getNativeChatLorebookNames());
  if (arraysEqual(snapshot, nextSelection)) {
    return false;
  }

  runtime.active = true;
  runtime.selectedSnapshot = snapshot;
  runtime.injectedSources = valid;
  runtime.reason = reason;

  replaceArrayContents(selected_world_info, nextSelection);
  log(`已临时加入来源世界书 (${reason}): ${valid.join(', ')}`);
  return true;
}

function restoreRuntimeInjection(reason = 'unknown') {
  if (!runtime.active || !runtime.selectedSnapshot) {
    return;
  }

  replaceArrayContents(selected_world_info, runtime.selectedSnapshot);
  log(`已恢复全局世界书选择 (${reason}); 临时来源: ${runtime.injectedSources.join(', ')}`);

  runtime.active = false;
  runtime.selectedSnapshot = null;
  runtime.injectedSources = [];
  runtime.reason = null;
}

function getAvailableWorldbookNames() {
  const names = new Set();

  if (Array.isArray(world_names)) {
    for (const name of world_names) {
      const normalized = normalizeSourceName(name);
      if (normalized) {
        names.add(normalized);
      }
    }
  }

  $('#world_info option, #world_editor_select option').each((_, option) => {
    const text = normalizeSourceName($(option).text());
    if (text && !text.startsWith('---')) {
      names.add(text);
    }
  });

  return Array.from(names).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
}

async function getMissingSources() {
  const missing = [];
  for (const name of listSources()) {
    if (!(await worldbookExists(name))) {
      missing.push(name);
    }
  }
  return missing;
}

function getStatus() {
  const sources = listSources();
  return {
    chatId: getCurrentChatId?.() ?? null,
    active: sources.length > 0,
    nativeChatLorebooks: getNativeChatLorebookNames(),
    sources,
    runtime: {
      active: runtime.active,
      injectedSources: runtime.injectedSources.slice(),
      reason: runtime.reason,
    },
  };
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .cls-panel {
      display: flex;
      flex-direction: column;
      gap: 18px;
      width: min(760px, calc(100vw - 72px));
      max-width: 100%;
      margin: 0 auto;
      box-sizing: border-box;
      text-align: left;
    }
    .cls-section {
      border-top: 1px solid var(--SmartThemeBorderColor);
      padding-top: 16px;
    }
    .cls-hero {
      padding: 2px 0 0;
    }
    .cls-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .cls-title {
      font-weight: 700;
      font-size: 1rem;
      line-height: 1.25;
    }
    .cls-main-title {
      font-size: 1.18rem;
    }
    .cls-muted {
      opacity: 0.75;
      font-size: 0.92em;
      line-height: 1.45;
    }
    .cls-summary {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .cls-summary-item {
      display: inline-flex;
      align-items: baseline;
      gap: 6px;
      border: 1px solid var(--SmartThemeBorderColor);
      border-radius: 999px;
      padding: 4px 10px;
      background: color-mix(in srgb, var(--SmartThemeBlurTintColor) 68%, transparent);
    }
    .cls-summary-value {
      font-size: 0.98rem;
      font-weight: 700;
      line-height: 1;
    }
    .cls-summary-label {
      opacity: 0.72;
      font-size: 0.86em;
    }
    .cls-section-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 8px;
    }
    .cls-field-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto auto;
      gap: 8px;
      align-items: start;
    }
    .cls-picker {
      min-width: 0;
    }
    .cls-picker .cls-input {
      width: 100%;
      box-sizing: border-box;
    }
    .cls-input,
    .cls-select {
      flex: 1 1 240px;
      min-width: 0;
      min-height: 34px;
      padding: 6px 9px;
      border-radius: 6px;
      border: 1px solid var(--SmartThemeBorderColor);
      background: var(--SmartThemeBlurTintColor);
      color: inherit;
    }
    .cls-panel .menu_button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 72px;
      width: auto;
      max-width: none;
      min-height: 34px;
      white-space: nowrap;
      writing-mode: horizontal-tb;
      text-align: center;
      padding-left: 10px;
      padding-right: 10px;
    }
    .cls-panel .cls-danger-button {
      opacity: 0.85;
      border-color: color-mix(in srgb, #ff6b6b 55%, var(--SmartThemeBorderColor));
    }
    .cls-panel .cls-primary-button {
      border-color: color-mix(in srgb, var(--SmartThemeQuoteColor) 62%, var(--SmartThemeBorderColor));
      background: color-mix(in srgb, var(--SmartThemeQuoteColor) 24%, var(--SmartThemeBlurTintColor));
      font-weight: 700;
    }
    .cls-candidate-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-height: 164px;
      margin-top: 6px;
      overflow-y: auto;
      border: 1px solid var(--SmartThemeBorderColor);
      border-radius: 8px;
      background: color-mix(in srgb, var(--SmartThemeBlurTintColor) 90%, #000 10%);
    }
    .cls-candidate-button {
      min-height: 30px;
      border: 0;
      border-bottom: 1px solid color-mix(in srgb, var(--SmartThemeBorderColor) 60%, transparent);
      padding: 6px 9px;
      background: transparent;
      color: inherit;
      text-align: left;
      overflow-wrap: anywhere;
      cursor: pointer;
      font-family: monospace;
    }
    .cls-candidate-button:last-child {
      border-bottom: 0;
    }
    .cls-candidate-button:hover,
    .cls-candidate-button:focus-visible {
      background: color-mix(in srgb, var(--SmartThemeQuoteColor) 18%, transparent);
      outline: none;
    }
    .cls-list {
      display: flex;
      flex-direction: column;
      gap: 0;
      border: 1px solid var(--SmartThemeBorderColor);
      border-radius: 8px;
      overflow: hidden;
    }
    .cls-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      border-bottom: 1px solid var(--SmartThemeBorderColor);
      padding: 8px 10px;
      background: color-mix(in srgb, var(--SmartThemeBodyColor) 4%, transparent);
    }
    .cls-item:last-child {
      border-bottom: 0;
    }
    .cls-item-main {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .cls-item-name {
      min-width: 0;
      overflow-wrap: anywhere;
      font-family: monospace;
    }
    .cls-name-button {
      min-width: 0;
      border: 0;
      padding: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      font-family: monospace;
      text-align: left;
      overflow-wrap: anywhere;
      cursor: pointer;
      text-decoration: underline;
      text-decoration-thickness: 1px;
      text-underline-offset: 3px;
    }
    .cls-info-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      min-width: 22px;
      margin-left: 6px;
      padding: 0;
      border: 1px solid var(--SmartThemeBorderColor);
      border-radius: 999px;
      background: color-mix(in srgb, var(--SmartThemeQuoteColor) 18%, transparent);
      color: inherit;
      cursor: pointer;
      font-size: 0.82rem;
    }
    .cls-title-row {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .cls-pill {
      border: 1px solid var(--SmartThemeBorderColor);
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 0.78em;
      opacity: 0.82;
      white-space: nowrap;
    }
    .cls-pill-native {
      background: color-mix(in srgb, var(--SmartThemeQuoteColor) 20%, transparent);
    }
    .cls-pill-source {
      background: color-mix(in srgb, var(--SmartThemeBodyColor) 8%, transparent);
    }
    .cls-warning {
      color: #ffa502;
      overflow-wrap: anywhere;
      margin-top: 8px;
    }
    .cls-empty {
      opacity: 0.78;
      border: 1px dashed var(--SmartThemeBorderColor);
      border-radius: 8px;
      padding: 12px;
      background: color-mix(in srgb, var(--SmartThemeBodyColor) 3%, transparent);
    }
    .cls-form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .cls-label {
      font-weight: 600;
      font-size: 0.92em;
    }
    .cls-add-card {
      padding: 0;
    }
    @media (max-width: 720px) {
      .cls-panel {
        width: min(100%, calc(100vw - 32px));
      }
      .cls-header {
        align-items: stretch;
      }
      .cls-summary {
        width: 100%;
      }
      .cls-field-row {
        grid-template-columns: 1fr;
      }
    }
    #${MENU_BADGE_ID} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 22px;
      height: 22px;
      padding: 0 7px;
      border-radius: 999px;
      background: rgba(123,92,255,.18);
      color: var(--SmartThemeBodyColor,#fff);
      font-size: 12px;
      font-weight: 700;
      margin-left: auto;
    }
  `;
  document.head.appendChild(style);
}

function renderScanList(nativeNames, sources) {
  if (!nativeNames.length && !sources.length) {
    return '<div class="cls-empty">当前聊天还没有世界书参与扫描。</div>';
  }

  return `
    <div class="cls-list">
      ${nativeNames.map((name) => `
        <div class="cls-item">
          <div class="cls-item-main">
            <span class="cls-pill cls-pill-native">原生绑定</span>
            <button class="cls-name-button" type="button" data-action="open-worldbook" data-name="${escapeHtml(name)}" title="打开世界书">${escapeHtml(name)}</button>
          </div>
          <button class="menu_button" type="button" data-action="remove-native" data-name="${escapeHtml(name)}">移除</button>
        </div>
      `).join('')}
      ${sources.map((name) => `
        <div class="cls-item">
          <div class="cls-item-main">
            <span class="cls-pill cls-pill-source">额外来源</span>
            <button class="cls-name-button" type="button" data-action="open-worldbook" data-name="${escapeHtml(name)}" title="打开世界书">${escapeHtml(name)}</button>
          </div>
          <button class="menu_button" type="button" data-action="remove-source" data-name="${escapeHtml(name)}">移除</button>
        </div>
      `).join('')}
    </div>
  `;
}

function renderCandidateList(candidates, query) {
  const visibleCandidates = buildWorldbookCandidateList(candidates, query, 8);
  if (!visibleCandidates.length) {
    return '';
  }

  return `
    <div class="cls-candidate-list" role="listbox" aria-label="可选世界书">
      ${visibleCandidates.map((name) => `<button class="cls-candidate-button" type="button" role="option" data-action="select-candidate" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join('')}
    </div>
  `;
}

function createPanel() {
  ensureStyles();

  const root = $('<div class="cls-panel"></div>');
  let sourceQuery = '';
  let currentCandidates = [];

  const render = async () => {
    const sources = listSources();
    const nativeNames = getNativeChatLorebookNames();
    const scanCount = nativeNames.length + sources.length;
    const missing = await getMissingSources();
    currentCandidates = getAvailableWorldbookNames()
      .filter((name) => !sources.includes(name) && !nativeNames.includes(name));

    root.html(`
      <section class="cls-hero">
        <div class="cls-header">
          <div class="cls-title cls-main-title">聊天世界书肋手</div>
          <div class="cls-summary" aria-label="当前聊天世界书数量">
            <div class="cls-summary-item">
              <div class="cls-summary-value">${scanCount}</div>
              <div class="cls-summary-label">全部</div>
            </div>
            <div class="cls-summary-item">
              <div class="cls-summary-value">${nativeNames.length}</div>
              <div class="cls-summary-label">原生绑定</div>
            </div>
            <div class="cls-summary-item">
              <div class="cls-summary-value">${sources.length}</div>
              <div class="cls-summary-label">额外来源</div>
            </div>
          </div>
        </div>
        ${missing.length ? `<div class="cls-warning">缺失来源：${escapeHtml(missing.join(', '))}</div>` : ''}
      </section>

      <section class="cls-section">
        <div class="cls-section-head">
          <div>
            <div class="cls-title-row">
              <div class="cls-title">扫描列表</div>
              <button class="cls-info-button fa-solid fa-info" type="button" data-action="show-info" aria-label="说明" title="原生绑定 / 额外来源说明"></button>
            </div>
          </div>
          ${sources.length ? '<button class="menu_button cls-danger-button" type="button" data-action="clear-sources">清空来源</button>' : ''}
        </div>
        ${renderScanList(nativeNames, sources)}
      </section>

      <section class="cls-section">
        <div class="cls-section-head">
          <div>
            <div class="cls-title">添加世界书</div>
          </div>
        </div>

        <div class="cls-add-card">
          <div class="cls-form-group">
            <label class="cls-label" for="cls_source_search">世界书名称</label>
            <div class="cls-field-row">
              <div class="cls-picker">
                <input class="cls-input" id="cls_source_search" type="text" placeholder="输入筛选，或点下方名称" value="${escapeHtml(sourceQuery)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-np-ignore="true" data-lpignore="true" data-1p-ignore="true" data-form-type="other" aria-autocomplete="list">
                <div class="cls-candidate-slot">${renderCandidateList(currentCandidates, sourceQuery)}</div>
              </div>
              <button class="menu_button cls-primary-button" type="button" data-action="set-native-query">设为原生</button>
              <button class="menu_button" type="button" data-action="add-source-query">加为来源</button>
              <button class="menu_button" type="button" data-action="create-source-query">新建空书</button>
            </div>
          </div>
        </div>
      </section>
    `);
  };

  root.on('input', '#cls_source_search', function () {
    sourceQuery = String($(this).val() ?? '');
    root.find('.cls-candidate-slot').html(renderCandidateList(currentCandidates, sourceQuery));
  });

  root.on('keydown', '#cls_source_search', async function (event) {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    if (await addSource(sourceQuery)) {
      sourceQuery = '';
      await render();
    }
  });

  root.on('click', '[data-action="select-candidate"]', async function () {
    sourceQuery = String($(this).attr('data-name') ?? '');
    await render();
    const input = root.find('#cls_source_search');
    input.trigger('focus');
    input[0]?.setSelectionRange?.(sourceQuery.length, sourceQuery.length);
  });

  root.on('click', '[data-action="show-info"]', async () => {
    await callGenericPopup(
      '<div class="cls-muted"><b>原生绑定</b>：SillyTavern 自带的聊天世界书绑定。<br><b>额外来源</b>：本扩展在生成前临时加入扫描的世界书。</div>',
      POPUP_TYPE.TEXT,
      '',
      { okButton: '知道了' },
    );
  });

  root.on('click', '[data-action="open-worldbook"]', function () {
    openWorldbook($(this).attr('data-name'));
  });

  root.on('click', '[data-action="set-native-query"]', async () => {
    if (await setNativeChatLorebook(sourceQuery)) {
      sourceQuery = '';
      await render();
    }
  });

  root.on('click', '[data-action="add-source-query"]', async () => {
    if (await addSource(sourceQuery)) {
      sourceQuery = '';
      await render();
    }
  });

  root.on('click', '[data-action="create-source-query"]', async () => {
    if (await createEmptySource(sourceQuery)) {
      sourceQuery = '';
      await render();
    }
  });

  root.on('click', '[data-action="remove-source"]', async function () {
    const name = $(this).attr('data-name');
    await removeSource(name);
    await render();
  });

  root.on('click', '[data-action="remove-native"]', async function () {
    const name = $(this).attr('data-name');
    await removeNativeChatLorebook(name);
    await render();
  });

  root.on('click', '[data-action="clear-sources"]', async () => {
    await clearSources();
    await render();
  });

  void render();
  return root;
}

async function showPanel() {
  state.popupOpen = true;
  try {
    await callGenericPopup(createPanel(), POPUP_TYPE.TEXT, '', {
      okButton: '关闭',
      wide: true,
      allowVerticalScrolling: true,
    });
  } catch (error) {
    errorToast('打开来源世界书面板失败，请查看控制台');
    warn(`打开面板失败\n${formatError(error)}`);
  } finally {
    state.popupOpen = false;
  }
}

function stopMenuWatcher() {
  if (state.menuRetryTimer) {
    clearInterval(state.menuRetryTimer);
    state.menuRetryTimer = null;
  }
}

function ensureMenuButton(reason = 'unknown') {
  if (state.menuButton?.length) {
    return state.menuButton;
  }

  const existing = $(`#${MENU_BUTTON_ID}`);
  if (existing.length) {
    state.menuButton = existing;
    return existing;
  }

  const host = $('#extensionsMenu');
  if (!host.length) {
    const now = Date.now();
    if (now - state.lastMenuMissLoggedAt > 3000) {
      state.lastMenuMissLoggedAt = now;
      warn(`找不到 #extensionsMenu，暂时无法注入按钮 (${reason})`);
    }
    return null;
  }

  const button = $(`
    <div id="${MENU_BUTTON_ID}" class="list-group-item">
      <div style="display:flex; align-items:center; gap:8px; width:100%;">
        <div class="fa-solid fa-book-open extensionsMenuExtensionButton" title="聊天世界书肋手"></div>
        <span style="flex:1 1 auto; min-width:0;">聊天世界书肋手</span>
        <span id="${MENU_BADGE_ID}">0</span>
      </div>
    </div>
  `);

  button.on('click', async () => {
    await showPanel();
  });

  host.append(button);
  state.menuButton = button;
  stopMenuWatcher();
  refreshMenuButton();
  log(`已注入扩展菜单按钮 (${reason})`);
  return button;
}

function ensureMenuWatcher(reason = 'unknown') {
  if (state.menuButton?.length || state.menuRetryTimer) {
    return;
  }

  state.menuRetryTimer = setInterval(() => {
    const button = ensureMenuButton(`watch:${reason}`);
    if (button?.length) {
      stopMenuWatcher();
    }
  }, 1000);
}

function refreshMenuButton() {
  ensureStyles();
  const button = ensureMenuButton('refresh');
  if (!button?.length) {
    ensureMenuWatcher('refresh');
    return;
  }

  const sourceCount = listSources().length;
  const scanCount = getNativeChatLorebookNames().length + sourceCount;
  const badge = button.find(`#${MENU_BADGE_ID}`);
  const icon = button.find('.extensionsMenuExtensionButton');
  badge.text(String(scanCount));
  badge.css('display', scanCount > 0 ? 'inline-flex' : 'none');
  icon.css('color', scanCount > 0 ? 'var(--SmartThemeQuoteColor)' : '');
  button.attr('title', scanCount > 0
    ? `当前聊天会扫描 ${scanCount} 个世界书入口；额外来源：${listSources().join(', ') || '无'}`
    : '当前聊天没有世界书扫描入口');
}

function exposePublicInterface() {
  globalThis.ChatLoreSources = {
    list: listSources,
    add: addSource,
    setNative: setNativeChatLorebook,
    removeNative: removeNativeChatLorebook,
    create: createEmptySource,
    remove: removeSource,
    clear: clearSources,
    set: setSources,
    getStatus,
    showPanel,
  };
  log('已暴露接口: window.ChatLoreSources');
}

function bindRuntimeEvents() {
  eventSource.on(event_types.GENERATION_AFTER_COMMANDS, async () => {
    try {
      await beginRuntimeInjection('generation_after_commands');
    } catch (error) {
      restoreRuntimeInjection('generation_after_commands_error');
      warn(`生成前注入来源世界书失败\n${formatError(error)}`);
      errorToast('生成前注入来源世界书失败，请查看控制台');
    }
  });

  eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, () => {
    restoreRuntimeInjection('after_combine_prompts');
  });

  eventSource.on(event_types.GENERATION_STOPPED, () => {
    restoreRuntimeInjection('generation_stopped');
  });

  eventSource.on(event_types.GENERATION_ENDED, () => {
    restoreRuntimeInjection('generation_ended');
  });

  eventSource.on(event_types.CHAT_CHANGED, () => {
    restoreRuntimeInjection('chat_changed');
    refreshMenuButton();
  });

  eventSource.on(event_types.WORLDINFO_UPDATED, () => {
    if (state.popupOpen) {
      refreshMenuButton();
    }
  });

  globalThis.addEventListener?.('pagehide', () => restoreRuntimeInjection('pagehide'));
  globalThis.addEventListener?.('beforeunload', () => restoreRuntimeInjection('beforeunload'));
}

function bootstrap() {
  if (state.started) {
    return;
  }

  state.started = true;
  ensureStyles();
  exposePublicInterface();
  bindRuntimeEvents();
  ensureMenuButton('bootstrap');
  ensureMenuWatcher('bootstrap');
  refreshMenuButton();
  log('已加载；来源世界书只在生成期间临时加入，扫描后恢复原本选择。');
}

eventSource.on(event_types.APP_READY, bootstrap);
bootstrap();
