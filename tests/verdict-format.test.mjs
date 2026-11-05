import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compactTrackList, parseTrackList } from '../src/verdict-format.mjs'

test('legacy and compact lists produce the same verdicts', () => {
    const legacy = { schema: 1, rulesVersion: 3, tracks: { 123: 'explicit', 456: 'clean' } }
    const tracks = parseTrackList(legacy, 3)
    const compact = compactTrackList(tracks, 3)
    assert.deepEqual(compact, { schema: 2, rulesVersion: 3, explicit: [123], clean: [456] })
    assert.deepEqual(parseTrackList(compact, 3), tracks)
})

test('large IDs and leading zeros round-trip without precision loss', () => {
    const tracks = new Map([['9007199254740993', 'explicit'], ['00123', 'clean']])
    assert.deepEqual(parseTrackList(compactTrackList(tracks, 3), 3), tracks)
})

test('conflicting or duplicate compact IDs are rejected', () => {
    assert.throws(() => parseTrackList({ schema: 2, rulesVersion: 3, explicit: [123], clean: ['123'] }, 3))
    assert.throws(() => parseTrackList({ schema: 2, rulesVersion: 3, explicit: [123, '123'], clean: [] }, 3))
})

test('malformed lists, unsafe numbers and outdated rules are rejected', () => {
    for (const id of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, 'abc', '']) {
        assert.throws(() => parseTrackList({ schema: 2, rulesVersion: 3, explicit: [id], clean: [] }, 3))
    }
    assert.throws(() => parseTrackList({ schema: 2, rulesVersion: 2, explicit: [], clean: [] }, 3))
    assert.throws(() => parseTrackList({ schema: 2, rulesVersion: 3, explicit: [] }, 3))
    assert.throws(() => parseTrackList({ schema: 1, rulesVersion: 3, tracks: { 123: 'missing' } }, 3))
})
