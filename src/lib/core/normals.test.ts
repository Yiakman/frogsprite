import assert from 'node:assert/strict';
import test from 'node:test';
import { PALETTE } from './palette.ts';
import { LABEL_INDEX, LABELS, nearestLabel, normalColors, normalsOf, remapLabels } from './normals.ts';

const grid = 16;
const filled = () => {
	const px = new Uint8Array(grid * grid);
	for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) px[y * grid + x] = 1;
	return px;
};
const nameAt = (labels: Uint8Array, x: number, y: number) =>
	LABELS[LABEL_INDEX.indexOf(labels[y * grid + x])].name;

test('labels are cube-exact, distinct, and none of them grey', () => {
	assert.equal(new Set(LABEL_INDEX).size, LABELS.length);
	LABELS.forEach((l, i) => assert.equal(PALETTE[LABEL_INDEX[i]], l.hex));
	// a grey label reads as "uncoloured" in print_sprite, which is exactly the wrong signal
	const grey = (hex: string) => hex.slice(1, 3) === hex.slice(3, 5) && hex.slice(3, 5) === hex.slice(5, 7);
	for (const l of LABELS) assert.ok(!grey(l.hex), `${l.name} (${l.hex}) is grey`);
});

test('every compass label shares one z, so strength cannot steer direction', () => {
	const z = LABELS.filter((l) => l.name !== 'flat').map((l) => l.z);
	assert.equal(new Set(z).size, 1);
	// and each is a unit vector, or the dot-product comparison is not measuring angle
	for (const l of LABELS) assert.ok(Math.abs(Math.hypot(l.x, l.y, l.z) - 1) < 1e-9, l.name);
});

test('each label round-trips through nearestLabel', () => {
	LABELS.forEach((l, i) => assert.equal(nearestLabel(l.x, l.y, l.z), i, l.name));
});

test('flipX and flipY are involutions, and together equal a half turn', () => {
	const fx = remapLabels({ flipX: true });
	const fy = remapLabels({ flipY: true });
	const half = remapLabels({ rotate: 180 });
	for (const i of LABEL_INDEX) {
		assert.equal(fx[fx[i]], i, 'flipX twice is identity');
		assert.equal(fy[fy[i]], i, 'flipY twice is identity');
		assert.equal(fy[fx[i]], half[i], 'flipX then flipY is a 180 rotation');
	}
});

test('a quarter turn four times is identity, and is a permutation of the labels', () => {
	const q = remapLabels({ rotate: 90 });
	const seen = new Set(LABEL_INDEX.map((i) => q[i]));
	assert.equal(seen.size, LABELS.length, 'a quarter turn must not collapse two labels onto one');
	for (const i of LABEL_INDEX) assert.equal(q[q[q[q[i]]]], i);
});

test('flipX negates east/west and leaves north/south alone', () => {
	const at = (name: string) => LABEL_INDEX[LABELS.findIndex((l) => l.name === name)];
	const fx = remapLabels({ flipX: true });
	assert.equal(fx[at('E')], at('W'));
	assert.equal(fx[at('NE')], at('NW'));
	assert.equal(fx[at('N')], at('N'));
	assert.equal(fx[at('flat')], at('flat'));
});

test('a rotation composes in the right order when a flip is also set', () => {
	// flip-then-rotate and rotate-then-flip differ; the push-through must match applyFx's order,
	// which is flipX before rotate. Composing separate tables the other way round is the bug.
	const both = remapLabels({ flipX: true, rotate: 90 });
	const flip = remapLabels({ flipX: true });
	const spin = remapLabels({ rotate: 90 });
	for (const i of LABEL_INDEX) assert.equal(both[i], spin[flip[i]]);
});

test('a bevel is flat inside and faces outward at every edge', () => {
	const { labels, painted } = normalsOf(filled(), grid);
	assert.equal(painted, 100);
	assert.equal(nameAt(labels, 8, 8), 'flat');
	assert.equal(nameAt(labels, 3, 8), 'W');
	assert.equal(nameAt(labels, 12, 8), 'E');
	assert.equal(nameAt(labels, 8, 3), 'N'); // row 0 is the top, so the top edge faces up
	assert.equal(nameAt(labels, 8, 12), 'S');
});

test('the map has a hole exactly where the art does', () => {
	const px = filled();
	const { labels } = normalsOf(px, grid);
	for (let i = 0; i < px.length; i++) assert.equal(labels[i] === 0, px[i] === 0);
});

test('strength widens the bevel without changing which way an edge faces', () => {
	const wide = normalsOf(filled(), grid, { strength: 4 }).labels;
	const narrow = normalsOf(filled(), grid, { strength: 0.5 }).labels;
	const bevelled = (a: Uint8Array) =>
		[...a].filter((v) => v && v !== LABEL_INDEX[0]).length;
	assert.ok(bevelled(wide) > bevelled(narrow), 'a higher threshold should bevel more of the sprite');
	assert.equal(nameAt(wide, 3, 8), 'W');
	assert.equal(nameAt(narrow, 3, 8), 'W');
});

test('export colours are true normals, with flat for anything that is not a label', () => {
	const c = normalColors();
	assert.equal(c[LABEL_INDEX[0]], '#8080ff'); // flat is the canonical normal the cube cannot store
	assert.equal(PALETTE[LABEL_INDEX[0]], '#9999ff'); // ...and the label it is stored as is not it
	assert.equal(c[1], '#8080ff', 'a stray non-label pixel reads as facing the camera');
	// east leans +x, north leans +y under the OpenGL convention Godot and Unity expect
	const at = (n: string) => c[LABEL_INDEX[LABELS.findIndex((l) => l.name === n)]];
	assert.ok(parseInt(at('E').slice(1, 3), 16) > 0x80);
	assert.ok(parseInt(at('W').slice(1, 3), 16) < 0x80);
	assert.ok(parseInt(at('N').slice(3, 5), 16) > 0x80);
	assert.ok(parseInt(at('S').slice(3, 5), 16) < 0x80);
	// DirectX is the same map with green inverted
	assert.ok(parseInt(normalColors(true)[LABEL_INDEX[3]].slice(3, 5), 16) < 0x80);
});
