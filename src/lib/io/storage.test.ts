import assert from 'node:assert/strict';
import test from 'node:test';
import {
	isProject,
	parse,
	readInterchange,
	readSet,
	serialise,
	setPayload
} from './storage.ts';
import { GRIDS } from '../core/grid.ts';
import { zip } from './zip.ts';

const pkg = (over = {}) => [
	{
		name: 'p',
		sets: [
			{
				name: 's',
				grid: 8,
				sprites: [{ name: 'a', layers: [{ name: 'layer-0', pixels: new Uint8Array(64).fill(3) }] }],
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
		assert.equal(set.sprites[0].layers[0].pixels.length, grid * grid, `grid ${grid} pixel buffer`);
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
	const pixels = (parse(raw) as any)[0].sets[0].sprites[0].layers[0].pixels;
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

	// a painted layer by construction; the union means saying so
	(payload.sprites[0].layers[0] as { pixels: number[] }).pixels[0] = 99;
	assert.equal(set.sprites[0].layers[0].pixels[0], 3, 'the payload holds its own pixel arrays');
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

// --- layers ------------------------------------------------------------------

test('a pre-layers sprite loads as a single layer-0', () => {
	// what every stored project and the shipped examples.json look like on disk. parse() never reads
	// the version number, so this is decided by sniffing the shape, not by a version gate.
	const raw = JSON.stringify(pkg({ sprites: [{ name: 'a', pixels: [1, 2, 3] }], animations: [] }));
	const sprites = (parse(raw) as any)[0].sets[0].sprites;
	assert.equal(sprites[0].layers.length, 1);
	assert.equal(sprites[0].layers[0].name, 'layer-0');
	assert.deepEqual(Array.from(sprites[0].layers[0].pixels.slice(0, 3)), [1, 2, 3]);
});

test('layer order and `hidden` survive a serialise/parse round-trip', () => {
	// undo restores the whole document through parse(serialise(...)), so anything that does not
	// round-trip here is deleted by the first ⌘Z. `hidden` especially: settle() drops an undo step
	// when the serialised document is unchanged, so a `hidden` that vanished here would make
	// hide un-undoable *and* let the next undo bring the layer back visible.
	const doc = pkg({
		sprites: [
			{
				name: 'a',
				layers: [
					{ name: 'back', pixels: new Uint8Array(64).fill(1) },
					{ name: 'sketch', pixels: new Uint8Array(64).fill(2), hidden: true },
					{ name: 'front', pixels: new Uint8Array(64).fill(3) }
				]
			}
		],
		animations: []
	});
	const back = (parse(serialise(doc as any)) as any)[0].sets[0].sprites[0].layers;
	assert.deepEqual(
		back.map((l: any) => [l.name, !!l.hidden]),
		[
			['back', false],
			['sketch', true],
			['front', false]
		]
	);
	assert.deepEqual(Array.from(back[1].pixels.slice(0, 2)), [2, 2], 'a hidden layer keeps its art');
});

test('a sprite is repaired to one layer rather than left with an empty stack', () => {
	// layerOf() has to have something to hand back on a sprite that visibly exists
	const raw = JSON.stringify(pkg({ sprites: [{ name: 'a', layers: [] }], animations: [] }));
	const layers = (parse(raw) as any)[0].sets[0].sprites[0].layers;
	assert.equal(layers.length, 1);
	assert.equal(layers[0].pixels.length, 64);
});

test('junk layers are dropped and duplicate layer names keep the first', () => {
	const raw = JSON.stringify(
		pkg({
			sprites: [
				{
					name: 'a',
					layers: [
						{ name: 'keep', pixels: [5] },
						{ pixels: [6] }, // no name
						{ name: 'keep', pixels: [7] } // duplicate: select_layer would be ambiguous
					]
				}
			],
			animations: []
		})
	);
	const layers = (parse(raw) as any)[0].sets[0].sprites[0].layers;
	assert.deepEqual(
		layers.map((l: any) => l.name),
		['keep']
	);
	assert.equal(layers[0].pixels[0], 5, 'the first of a duplicated name wins');
});

test('a frame arrangement survives serialise/parse, so undo cannot eat it', () => {
	const doc = pkg({
		animations: [
			{
				name: 'walk',
				frames: [
					{ sprite: 'a', ms: 100, layers: { fuji: { dx: -4, wrap: true }, sketch: { hidden: true } } },
					{ sprite: 'a', ms: 100, layers: { fuji: -8 } } // the shorthand
				]
			}
		]
	});
	const back = (parse(serialise(doc as any)) as any)[0].sets[0].animations[0].frames;
	assert.deepEqual(back[0].layers, { fuji: { dx: -4, wrap: true }, sketch: { hidden: true } });
	assert.deepEqual(back[1].layers, { fuji: { dx: -8 } }, 'the number shorthand normalises to dx');
});

test('readSet keeps a frame arrangement it understands and drops the rest', () => {
	const set = readSet({
		name: 's',
		grid: 8,
		sprites: [{ name: 'a', pixels: [...new Uint8Array(64)] }],
		animations: [
			{
				name: 'x',
				frames: [
					{ sprite: 'a', ms: 10, layers: { good: { dx: 2, wrap: true }, junk: 'nope', empty: {}, '': { dx: 1 } } },
					{ sprite: 'a', ms: 10, layers: 'not an object' }
				]
			}
		]
	});
	assert.deepEqual(set!.animations[0].frames[0].layers, { good: { dx: 2, wrap: true } });
	assert.equal(set!.animations[0].frames[1].layers, undefined, 'junk arrangement is simply absent');
});

test('a per-layer fx in an arrangement round-trips, so undo cannot eat it', () => {
	const doc = pkg({
		animations: [
			{
				name: 'x',
				frames: [{ sprite: 'a', ms: 10, layers: { w: { rotate: 90, flipX: true, hue: 'red', dx: -4, wrap: true } } }]
			}
		]
	});
	const back = (parse(serialise(doc as any)) as any)[0].sets[0].animations[0].frames[0];
	assert.deepEqual(back.layers, { w: { dx: -4, wrap: true, hue: 'red', rotate: 90, flipX: true } });
});

test('a junk per-layer fx is dropped, the rest of the arrangement survives', () => {
	const set = readSet({
		name: 's',
		grid: 8,
		sprites: [{ name: 'a', pixels: [...new Uint8Array(64)] }],
		// rotate 45 is not a 30 step, 'teal' is not a hue
		animations: [{ name: 'x', frames: [{ sprite: 'a', ms: 10, layers: { w: { rotate: 45, hue: 'teal', dx: 2 } } }] }]
	});
	assert.deepEqual(set!.animations[0].frames[0].layers, { w: { dx: 2 } });
});

// --- linked layers -----------------------------------------------------------

/** A set whose sprite `scene` shows `tree` twice, plus the awkward keys that must not persist. */
const withLinks = () =>
	pkg({
		sprites: [
			{ name: 'tree', layers: [{ name: 'layer-0', pixels: new Uint8Array(64).fill(3) }] },
			{
				name: 'scene',
				layers: [
					{ name: 'tree', from: 'tree' },
					{ name: 'tree-2', from: 'tree', dx: 4, dy: -2, wrap: true, hidden: true }
				]
			}
		],
		animations: [{ name: 'walk', frames: [{ sprite: 'scene', ms: 100 }] }]
	});

test('a linked layer round-trips with from/dx/dy/wrap intact', () => {
	const back = parse(serialise(withLinks() as any)) as any;
	const [plain, placed] = back[0].sets[0].sprites[1].layers;
	assert.deepEqual(plain, { name: 'tree', from: 'tree' }, 'no pixels invented, no zeroes added');
	assert.deepEqual(placed, {
		name: 'tree-2',
		from: 'tree',
		dx: 4,
		dy: -2,
		wrap: true,
		hidden: true
	});
});

test('serialise is stable across a parse, so undo charges no phantom step', () => {
	// settle() drops an undo step by comparing serialised documents and restore() round-trips the
	// whole document through parse. If either side kept a `dx: 0` the other omitted, every command
	// after this point would register a change it did not make.
	const doc = pkg({
		sprites: [
			{ name: 'tree', layers: [{ name: 'layer-0', pixels: new Uint8Array(64).fill(3) }] },
			{
				name: 'scene',
				layers: [
					// the falsy keys, written out longhand — exactly what must not survive
					{ name: 'a', from: 'tree', dx: 0, dy: 0, wrap: false },
					{ name: 'b', from: 'tree', dx: 7 }
				]
			}
		],
		animations: []
	});
	const once = serialise(doc as any);
	assert.equal(serialise(parse(once) as any), once, 'parse(serialise(x)) serialises identically');
	assert.doesNotMatch(once, /"dx":0|"dy":0|"wrap":false/, 'falsy placement keys are omitted');
});

test('a link to a sprite that is not there survives, rather than being pruned', () => {
	// flatten draws it blank, which is what lets undo of a delete_sprite bring the link back live.
	// Pruning here would also empty a stack whose only layer is the link.
	const back = parse(
		serialise(pkg({
			sprites: [{ name: 'scene', layers: [{ name: 'a', from: 'gone' }] }],
			animations: []
		}) as any)
	) as any;
	const [sprite] = back[0].sets[0].sprites;
	assert.equal(sprite.layers.length, 1, 'the layer is kept');
	assert.deepEqual(sprite.layers[0], { name: 'a', from: 'gone' });
});

test('readSet(setPayload(set)) preserves links and detaches the copy', () => {
	// the deep-copy idiom copy_set is built on
	const set = (withLinks() as any)[0].sets[0];
	const copy = readSet(setPayload(set))!;
	assert.deepEqual(copy, set);
	copy.sprites[1].layers[0].name = 'moved';
	assert.equal(set.sprites[1].layers[0].name, 'tree', 'the copy owns its own layer objects');
});

test('a junk `from` is dropped the way any other malformed layer is', () => {
	const back = parse(
		serialise(pkg({
			sprites: [
				{
					name: 'scene',
					layers: [
						{ name: 'ok', pixels: new Uint8Array(64).fill(1) },
						{ name: 'bad', from: '' },
						{ name: 'worse', from: 42 }
					]
				}
			],
			animations: []
		}) as any)
	) as any;
	// '' and 42 are not names, and neither layer carries pixels either — nothing to keep
	assert.deepEqual(
		back[0].sets[0].sprites[0].layers.map((l: any) => l.name),
		['ok']
	);
});

test('a sprite whose only layer is a link still satisfies the at-least-one floor', () => {
	const back = parse(
		serialise(pkg({
			sprites: [{ name: 'scene', layers: [{ name: 'a', from: 'scene' }] }],
			animations: []
		}) as any)
	) as any;
	assert.equal(back[0].sets[0].sprites[0].layers.length, 1);
});
