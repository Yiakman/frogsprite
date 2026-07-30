import assert from 'node:assert/strict';
import test from 'node:test';
import { onSet, targetAnimation, type Selection } from './selection.ts';

const at = (over: Partial<Selection> = {}): Selection => ({
	pkg: 'p',
	set: 'hero',
	sprite: 'idle',
	anim: 'walk',
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
	assert.deepEqual(sel, { pkg: 'p', set: 'boss', sprite: '', anim: 'stomp' });
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

test('an explicit name wins, then the selected one, then the default', () => {
	assert.deepEqual(targetAnimation(['walk'], 'hurt', 'walk'), { name: 'hurt', exists: false });
	assert.deepEqual(targetAnimation(['walk'], undefined, 'walk'), { name: 'walk', exists: true });
	assert.deepEqual(targetAnimation([], undefined, undefined), {
		name: 'animation',
		exists: false
	});
});
