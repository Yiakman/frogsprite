import assert from 'node:assert/strict';
import test from 'node:test';
import { onSet, targetAnimation, targetFrames, targetLayer, type Selection } from './selection.ts';

const at = (over: Partial<Selection> = {}): Selection => ({
	pkg: 'p',
	set: 'hero',
	sprite: 'idle',
	anim: 'walk',
	layer: 'layer-0',
	...over
});

test('re-selecting the set already active changes nothing and is not a move', () => {
	const { sel, moved } = onSet(at(), 'hero', ['walk', 'hurt']);
	assert.equal(moved, false, 'no playback to interrupt');
	assert.deepEqual(sel, at(), 'the sprite and the animation being inspected both survive');
});

test('selecting a different set clears the sprite and lands on that set first animation', () => {
	const { sel, moved } = onSet(at(), 'boss', ['stomp', 'roar']);
	assert.equal(moved, true);
	// the layer goes with the sprite: its name means nothing in the set we just moved to
	assert.deepEqual(sel, { pkg: 'p', set: 'boss', sprite: '', anim: 'stomp', layer: '' });
});

test('a set with no animations selects no animation rather than keeping the old one', () => {
	const { sel } = onSet(at(), 'empty', []);
	assert.equal(sel.anim, '', '"walk" belongs to the set we just left');
});

test('set_animation resolves the name before the lookup, so it never duplicates', () => {
	// the regression: sel.anim empty and an "animation" already there. Resolving after the lookup
	// searched for '' , missed, and pushed a second "animation".
	assert.deepEqual(targetAnimation(['animation'], undefined, ''), {
		name: 'animation',
		exists: true
	});
	assert.deepEqual(targetAnimation(['animation'], '', ''), { name: 'animation', exists: true });
});

test('targetFrames takes one index, a list, or "*" for the lot', () => {
	assert.deepEqual(targetFrames(4, 2), [2]);
	assert.deepEqual(targetFrames(4, [0, 2]), [0, 2]);
	assert.deepEqual(targetFrames(4, '*'), [0, 1, 2, 3]);
	assert.deepEqual(targetFrames(1, '*'), [0]);
	assert.deepEqual(targetFrames(0, '*'), [], 'no frames is not an error, just nothing to do');
	assert.deepEqual(targetFrames(4, [1, 1, 1]), [1], 'a repeat is not applied twice');
});

test('targetFrames refuses an index that is not a frame', () => {
	for (const bad of [4, -1, 1.5, NaN, '2' as any, null as any])
		assert.throws(() => targetFrames(4, bad), /outside 0\.\.3/, `input: ${bad}`);
	assert.throws(() => targetFrames(4, [0, 9]), /outside 0\.\.3/, 'one bad index fails the batch');
	assert.throws(() => targetFrames(4, []), /no frames given/);
});

test('an explicit name wins, then the selected one, then the default', () => {
	assert.deepEqual(targetAnimation(['walk'], 'hurt', 'walk'), { name: 'hurt', exists: false });
	assert.deepEqual(targetAnimation(['walk'], undefined, 'walk'), { name: 'walk', exists: true });
	assert.deepEqual(targetAnimation([], undefined, undefined), {
		name: 'animation',
		exists: false
	});
});

test('targetLayer honours a name, then the selection, then the topmost', () => {
	const stack: [string, boolean][] = [
		['back', false],
		['front', false]
	];
	assert.equal(targetLayer(stack, 'back', 'front'), 'back', 'an explicit name wins');
	assert.equal(targetLayer(stack, undefined, 'back'), 'back', 'else the selected one');
	assert.equal(targetLayer(stack, undefined, undefined), 'front', 'else the topmost');
});

test('targetLayer falls back rather than throwing when the selection went stale', () => {
	// the layer was deleted or renamed underneath the selection — resolving by name with a fallback
	// is what stops that painting into whatever slid into the old slot
	const stack: [string, boolean][] = [['back', false]];
	assert.equal(targetLayer(stack, undefined, 'deleted'), 'back');
	assert.throws(() => targetLayer(stack, 'deleted'), /no layer "deleted"/, 'but an explicit name still throws');
});

test('only the fallback skips hidden layers — a chosen one is honoured', () => {
	const stack: [string, boolean][] = [
		['back', false],
		['sketch', true]
	];
	// nothing chosen: painting somewhere you cannot see would be a bug, not a feature
	assert.equal(targetLayer(stack, undefined, undefined), 'back', 'the fallback skips the hidden top');
	// chosen: the stroke lands where it was asked to and is simply invisible, as in any pixel editor
	assert.equal(targetLayer(stack, undefined, 'sketch'), 'sketch', 'a selected hidden layer stands');
	assert.equal(targetLayer(stack, 'sketch'), 'sketch', 'as does one named outright');
});
