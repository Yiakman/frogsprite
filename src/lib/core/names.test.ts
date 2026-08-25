import assert from 'node:assert/strict';
import test from 'node:test';
import { freeName, taken } from './names.ts';

const list = (...names: string[]) => names.map((name) => ({ name }));

test('taken refuses a duplicate, naming the kind', () => {
	assert.throws(() => taken(list('a'), 'a', 'sprite'), /sprite "a" already exists/);
	assert.doesNotThrow(() => taken(list('a'), 'b', 'sprite'));
});

test('taken refuses an empty or non-string name before checking the list', () => {
	// the falsy check comes first on purpose: `list.some` on '' would pass and let a nameless
	// sprite through, which every lookup afterwards resolves to undefined
	for (const bad of ['', null, undefined, 0, {}])
		assert.throws(() => taken(list(), bad as never, 'layer'), /layer needs a name/);
});

test('freeName returns the bare name when nothing has taken it', () => {
	assert.equal(freeName(list(), 'tree'), 'tree');
	assert.equal(freeName(list('other'), 'tree'), 'tree');
});

test('freeName counts from 2, because the bare name is the first one', () => {
	// `tree, tree-2, tree-3` reads as three trees; `tree, tree-1` reads as a mistake
	assert.equal(freeName(list('tree'), 'tree'), 'tree-2');
	assert.equal(freeName(list('tree', 'tree-2'), 'tree'), 'tree-3');
	assert.equal(freeName(list('tree', 'tree-2', 'tree-3'), 'tree'), 'tree-4');
});

test('freeName skips a gap rather than filling it', () => {
	// it looks for the first *free* name, so a deleted tree-2 is reused — which matters because
	// the alternative is counting forever upward as a scene is edited
	assert.equal(freeName(list('tree', 'tree-3'), 'tree'), 'tree-2');
});
