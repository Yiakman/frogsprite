import assert from 'node:assert/strict';
import test from 'node:test';
import { isProject, parse, readInterchange, readSet, serialise, setPayload } from './storage.ts';
import { GRIDS } from './grid.ts';
import { zip } from './zip.ts';

const pkg = (over = {}) => [
	{
		name: 'p',
		sets: [
			{
				name: 's',
				grid: 8,
				sprites: [{ name: 'a', pixels: new Uint8Array(64).fill(3) }],
				animations: [{ name: 'walk', frames: [{ sprite: 'a', ms: 100 }] }],
				...over
			}
		]
	}
];

/** `pkg()` as it looks on disk: JSON has no Uint8Array, so pixels are written as plain arrays. */
const stored = (over = {}) => JSON.stringify(JSON.parse(serialise(pkg(over) as any)).packages);

test('storage round-trips packages', () => {
	assert.deepEqual(parse(serialise(pkg() as any)), pkg());
	// pixels are a Uint8Array, which JSON writes as {"0":3,…} unless serialise converts it back
	assert.match(serialise(pkg() as any), /"pixels":\[3,3,3/);
});

test('storage still reads the older bare-array format', () => {
	assert.deepEqual(parse(stored()), pkg());
});

test('parse never throws and salvages what it can', () => {
	for (const junk of [null, '', 'not json', '{}', '[]', '42', '{"packages":"nope"}'])
		assert.deepEqual(parse(junk), [], `input: ${junk}`);

	// unnamed / wrong-grid entries are dropped, duplicate names keep the first
	const messy = JSON.stringify([
		{ name: 'p', sets: [{ name: 's', grid: 7, sprites: [] }] },
		{ sets: [] },
		{ name: 'p', sets: [] }
	]);
	assert.deepEqual(parse(messy), [{ name: 'p', sets: [] }]);
});

test('every supported grid round-trips, and only those', () => {
	assert.deepEqual(GRIDS, [8, 16, 32, 64, 128]);
	for (const grid of GRIDS) {
		const raw = JSON.stringify([
			{ name: 'p', sets: [{ name: 's', grid, sprites: [{ name: 'a', pixels: [] }], frames: [] }] }
		]);
		const set = (parse(raw) as any)[0]?.sets[0];
		assert.equal(set?.grid, grid, `grid ${grid} should survive a load`);
		assert.equal(set.sprites[0].pixels.length, grid * grid, `grid ${grid} pixel buffer`);
	}
	for (const bad of [7, 24, 256, 0]) {
		const raw = JSON.stringify([{ name: 'p', sets: [{ name: 's', grid: bad, sprites: [] }] }]);
		assert.deepEqual((parse(raw) as any)[0].sets, [], `grid ${bad} should be rejected on load`);
	}
});

test('parse repairs bad pixel data instead of dropping the sprite', () => {
	const raw = JSON.stringify(
		pkg({ sprites: [{ name: 'a', pixels: [1, 999, 'x', -1, null, 2.5] }], animations: [] })
	);
	const pixels = (parse(raw) as any)[0].sets[0].sprites[0].pixels;
	assert.equal(pixels.length, 64, 'short array is padded to the grid');
	assert.deepEqual(
		Array.from(pixels.slice(0, 6)),
		[1, 0, 0, 0, 0, 0],
		'out-of-range values become transparent'
	);
	assert.ok(pixels.every((p: number) => Number.isInteger(p) && p >= 0 && p < 256));
});

test('parse drops frames pointing at sprites that did not survive', () => {
	const raw = stored({
		animations: [
			{
				name: 'walk',
				frames: [{ sprite: 'a', ms: 100 }, { sprite: 'ghost', ms: 50 }, { sprite: 'a', ms: 0 }]
			}
		]
	});
	assert.deepEqual((parse(raw) as any)[0].sets[0].animations, [
		{ name: 'walk', frames: [{ sprite: 'a', ms: 100 }] }
	]);
});

test('a v1 set, with one unnamed frame list, loads as one named animation', () => {
	const v1 = JSON.stringify({
		version: 1,
		packages: [
			{
				name: 'p',
				sets: [
					{
						name: 's',
						grid: 8,
						sprites: [{ name: 'a', pixels: [...new Uint8Array(64).fill(3)] }],
						frames: [{ sprite: 'a', ms: 100 }]
					}
				]
			}
		]
	});
	assert.deepEqual((parse(v1) as any)[0].sets[0].animations, [
		{ name: 'animation', frames: [{ sprite: 'a', ms: 100 }] }
	]);
});

test('readSet keeps the effects it understands and drops the rest', () => {
	const set = readSet({
		name: 's',
		grid: 8,
		sprites: [{ name: 'a', pixels: [...new Uint8Array(64)] }],
		animations: [
			{
				name: 'hurt',
				frames: [
					{
						sprite: 'a',
						ms: 100,
						// rotate 45 is not a 30° step, 'teal' is not a hue, 'melt' is not a transition
						fx: { invert: true, hue: 'teal', rotate: 45, dx: 2.4, flipY: true, wat: 1 },
						transition: 'melt'
					},
					{ sprite: 'a', ms: 50, fx: {}, transition: 'vanish' }
				]
			}
		]
	});
	assert.deepEqual(set!.animations[0].frames, [
		{ sprite: 'a', ms: 100, fx: { invert: true, dx: 2, flipY: true } },
		{ sprite: 'a', ms: 50, transition: { kind: 'vanish' } }
	]);
});

// --- interchange -------------------------------------------------------------

test('setPayload is readSet inverse, and copies rather than aliasing', () => {
	const set = (pkg() as any)[0].sets[0];
	const payload = setPayload(set);
	assert.deepEqual(readSet(payload), set);

	payload.sprites[0].pixels[0] = 99;
	assert.equal(set.sprites[0].pixels[0], 3, 'the payload holds its own pixel arrays');
});

test('readInterchange takes an object, JSON text, a .json blob or a .zip', async () => {
	const set = (pkg() as any)[0].sets[0];
	const payload = setPayload(set);
	const text = JSON.stringify(payload);

	assert.equal(await readInterchange(payload), payload, 'an object is handed straight back');
	assert.deepEqual(await readInterchange(text), payload);
	assert.deepEqual(await readInterchange(new Blob([text])), payload, 'a .json file');

	const archive = await zip([
		{ name: 'set.json', data: new TextEncoder().encode(text) },
		{ name: 'png/a.png', data: new Uint8Array([1, 2, 3]) }
	]);
	assert.deepEqual(await readInterchange(archive), payload, 'a .zip export');
});

test('readInterchange refuses junk with a readable message', async () => {
	await assert.rejects(() => readInterchange('<html>'), /not JSON/);
	const noSet = await zip([{ name: 'png/a.png', data: new Uint8Array([1, 2, 3]) }]);
	await assert.rejects(() => readInterchange(noSet), /no set\.json/);
});

test('isProject tells a whole project from a single set', () => {
	assert.equal(isProject({ version: 1, packages: [] }), true);
	assert.equal(isProject(setPayload((pkg() as any)[0].sets[0])), false);
	for (const junk of [null, undefined, 'packages', 42]) assert.equal(isProject(junk), false);
});
