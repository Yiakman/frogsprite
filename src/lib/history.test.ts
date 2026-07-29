import assert from 'node:assert/strict';
import test from 'node:test';
import * as history from './history.ts';

test('history walks back and forward, coalesces strokes, and drops the future on a new edit', () => {
	history.reset();
	const sel = { pkg: 'p', set: 's', sprite: 'a' };
	const at = (raw: string) => ({ raw, sel });

	assert.equal(history.undo(at('A')), null, 'nothing to undo yet');
	assert.equal(history.redo(at('A')), null);

	history.push(at('A')); // document A → B
	history.push(at('B')); // B → C
	history.push(at('B')); // an edit that changed nothing is not a step
	assert.deepEqual(history.depth(), { past: 2, future: 0 });

	assert.equal(history.undo(at('C'))?.raw, 'B');
	assert.equal(history.undo(at('B'))?.raw, 'A');
	assert.deepEqual(history.depth(), { past: 0, future: 2 });
	assert.equal(history.redo(at('A'))?.raw, 'B', 'redo walks the future without clearing it');
	assert.deepEqual(history.depth(), { past: 1, future: 1 });

	history.push(at('B')); // editing from here abandons the redo branch
	assert.deepEqual(history.depth(), { past: 2, future: 0 });

	// a drag: one snapshot however many cells it paints
	history.begin(at('D'));
	history.push(at('E'));
	history.push(at('F'));
	history.end();
	assert.deepEqual(history.depth(), { past: 3, future: 0 });
	assert.equal(history.undo(at('G'))?.raw, 'D');

	history.reset();
	for (let i = 0; i < 60; i++) history.push(at(`x${i}`));
	assert.equal(history.depth().past, 50, 'the stack is capped');
	assert.equal(history.undo(at('now'))?.raw, 'x59', 'the newest steps are the ones kept');
});

test('a push can be taken back, redo branch and all', () => {
	history.reset();
	const sel = { pkg: 'p', set: 's', sprite: 'a' };
	const at = (raw: string) => ({ raw, sel });

	history.push(at('A'));
	history.undo(at('B')); // past 0, future 1 — there is a redo branch to lose
	history.push(at('A'));
	assert.deepEqual(history.depth(), { past: 1, future: 0 }, 'the new edit cleared the future');

	history.rollback();
	assert.deepEqual(history.depth(), { past: 0, future: 1 }, 'and taking it back restored it');
	assert.equal(history.redo(at('A'))?.raw, 'B', 'the restored branch is the one that was there');

	history.reset();
	history.push(at('A'));
	history.push(at('A')); // deduped, so there is nothing to take back
	history.rollback();
	assert.deepEqual(history.depth(), { past: 1, future: 0 }, 'rollback never pops a push it did not make');
	history.rollback();
	assert.deepEqual(history.depth(), { past: 1, future: 0 }, 'and rolling back twice is not two pops');
});
