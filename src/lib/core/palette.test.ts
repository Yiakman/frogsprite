import assert from 'node:assert/strict';
import test from 'node:test';
import { PALETTE, ramp, toIndex } from './palette.ts';

test('palette is 256 entries, index 0 transparent, gray ramp at the end', () => {
	assert.equal(PALETTE.length, 256);
	assert.equal(PALETTE[0], 'transparent');
	assert.equal(PALETTE[1], '#000000');
	assert.equal(PALETTE[216], '#ffffff');
	assert.match(PALETTE[255], /^#([0-9a-f]{2})\1\1$/); // last entry is a gray
});

test('toIndex resolves indices, hex and transparent', () => {
	assert.equal(toIndex(5), 5);
	assert.equal(toIndex(null), 0);
	assert.equal(toIndex('transparent'), 0);
	assert.equal(toIndex('#000000'), 1);
	assert.equal(toIndex('#fff'), 216);
	assert.equal(PALETTE[toIndex('#22aa33')], '#339933'); // snaps to the nearest cube entry
	assert.throws(() => toIndex('nope'));
	assert.throws(() => toIndex(300));
});

test('ramp blends between two colours, ends included', () => {
	const black = toIndex('#000000');
	const white = toIndex('#ffffff');
	const r = ramp(black, white, 6);
	assert.equal(r.length, 6);
	assert.equal(r[0], black, 'starts on the first colour');
	assert.equal(r[5], white, 'and ends on the second');
});

test('a ramp is monotonic in brightness', () => {
	const lum = (i: number) => {
		const m = PALETTE[i].match(/#(..)(..)(..)/)!;
		return parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16);
	};
	const r = ramp(toIndex('#000033'), toIndex('#ffcc99'), 8);
	for (let i = 1; i < r.length; i++)
		assert.ok(lum(r[i]) >= lum(r[i - 1]), `step ${i} must not go backwards`);
});

test('ramp repeats an index rather than inventing a colour the palette lacks', () => {
	// 20 steps between two near-identical colours cannot yield 20 distinct palette entries
	const r = ramp(toIndex('#000000'), toIndex('#000033'), 20);
	assert.equal(r.length, 20);
	assert.ok(new Set(r).size < 20, 'duplicates are the honest answer');
	assert.ok(r.every((i) => Number.isInteger(i) && i > 0 && i < 256));
});

test('ramp needs at least two steps to have ends at all', () => {
	assert.equal(ramp(1, 2, 1).length, 2);
	assert.equal(ramp(1, 2, 0).length, 2);
});
