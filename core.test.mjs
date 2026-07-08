import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SOURCE_METADATA_KEY,
  buildInjectedSelection,
  buildWorldbookCandidateList,
  clearSourceState,
  getBindingConflict,
  normalizeNativeChatLorebookNames,
  removeSourceName,
  readSourceState,
  replaceArrayContents,
  setSourceState,
} from './core.mjs';

test('readSourceState normalizes missing and malformed metadata', () => {
  assert.deepEqual(readSourceState({}), {
    version: 1,
    sources: [],
    updatedAt: 0,
  });

  assert.deepEqual(readSourceState({
    [SOURCE_METADATA_KEY]: {
      version: 1,
      sources: [' Book A ', '', 'Book A', 42, 'Book B'],
      updatedAt: 123,
    },
  }), {
    version: 1,
    sources: ['Book A', '42', 'Book B'],
    updatedAt: 123,
  });
});

test('setSourceState updates only extension metadata and preserves native chat binding', () => {
  const metadata = {
    world_info: 'Native Chat Book',
    unrelated: true,
  };

  const written = setSourceState(metadata, ['Book A', 'Book B', 'Book A'], 456);

  assert.deepEqual(written, ['Book A', 'Book B']);
  assert.equal(metadata.world_info, 'Native Chat Book');
  assert.equal(metadata.unrelated, true);
  assert.deepEqual(metadata[SOURCE_METADATA_KEY], {
    version: 1,
    sources: ['Book A', 'Book B'],
    updatedAt: 456,
  });

  clearSourceState(metadata);

  assert.equal(metadata.world_info, 'Native Chat Book');
  assert.equal(metadata.unrelated, true);
  assert.equal(metadata[SOURCE_METADATA_KEY], undefined);
});

test('buildInjectedSelection appends valid sources without mutating the snapshot', () => {
  const snapshot = ['Global A', 'Book A'];
  const next = buildInjectedSelection(snapshot, ['Book B', 'Book A', '', 'Book C']);

  assert.deepEqual(snapshot, ['Global A', 'Book A']);
  assert.deepEqual(next, ['Global A', 'Book A', 'Book B', 'Book C']);
});

test('buildInjectedSelection excludes native chat books only from injected sources', () => {
  const snapshot = ['Global A', 'Native Chat Book'];
  const next = buildInjectedSelection(
    snapshot,
    ['Book B', 'Native Chat Book', 'Book C'],
    ['Native Chat Book'],
  );

  assert.deepEqual(next, ['Global A', 'Native Chat Book', 'Book B', 'Book C']);
});

test('normalizeNativeChatLorebookNames supports current and legacy metadata shapes', () => {
  assert.deepEqual(normalizeNativeChatLorebookNames({ world_info: ' Native Book ' }), ['Native Book']);
  assert.deepEqual(normalizeNativeChatLorebookNames({ world_info: ['Native Book', '', 'Native Book', 7] }), ['Native Book', '7']);
  assert.deepEqual(normalizeNativeChatLorebookNames({}), []);
});

test('getBindingConflict reports the existing binding source in priority order', () => {
  assert.equal(getBindingConflict('Book A', {
    nativeNames: ['Book A'],
    sources: ['Book B'],
    globalNames: ['Book C'],
  }), 'native');

  assert.equal(getBindingConflict('Book B', {
    nativeNames: ['Book A'],
    sources: ['Book B'],
    globalNames: ['Book C'],
  }), 'source');

  assert.equal(getBindingConflict('Book C', {
    nativeNames: ['Book A'],
    sources: ['Book B'],
    globalNames: ['Book C'],
  }), 'global');

  assert.equal(getBindingConflict('Book D', {
    nativeNames: ['Book A'],
    sources: ['Book B'],
    globalNames: ['Book C'],
  }), null);
});

test('removeSourceName removes a normalized name without mutating the input', () => {
  const source = ['Book A', 'Book B', 'Book C'];
  const next = removeSourceName(source, ' Book B ');

  assert.deepEqual(next, ['Book A', 'Book C']);
  assert.deepEqual(source, ['Book A', 'Book B', 'Book C']);
});

test('buildWorldbookCandidateList filters by query and caps visible options', () => {
  const result = buildWorldbookCandidateList(
    ['Alpha', 'Beta', 'alphabet', 'Gamma', 'Alpha', 'Alpine'],
    ' alp ',
    2,
  );

  assert.deepEqual(result, ['Alpha', 'alphabet']);
});

test('buildWorldbookCandidateList keeps an exact typed value visible', () => {
  const result = buildWorldbookCandidateList(['Hilo', 'Hilo extra'], 'Hilo', 8);

  assert.deepEqual(result, ['Hilo', 'Hilo extra']);
});

test('replaceArrayContents mutates the original array reference', () => {
  const selected = ['Old A', 'Old B'];
  const sameReference = selected;

  replaceArrayContents(selected, ['New A']);

  assert.equal(selected, sameReference);
  assert.deepEqual(selected, ['New A']);
});
