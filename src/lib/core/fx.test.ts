import assert from 'node:assert/strict';
import test from 'node:test';
import { applyFx, compose, patchEffects, progress, readTrail, steps } from './fx.ts';
import { PALETTE } from './palette.ts';

// 2x2 corners, so every geometric effect moves a distinguishable pixel:
//   1 2
//   3 4
const corners = () => Uint8Array.of(1, 2, 3, 4);
const rows = (px: Uint8Array) => Array.from(px);

/**
 * How bright a palette entry is, 0–255. Index order is NOT brightness order — the grey ramp lives
 * at 217+, so a dimmed white comes back as a *higher* index than the white it came from.
 */
const lum = (i: number) => {
	const m = PALETTE[i]?.match(/#(..)(..)(..)/);
	return m ? (parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16)) / 3 : 0;
};

test('applyFx leaves the source alone and applies nothing for an empty fx', () => {
	const src = corners();
	assert.deepEqual(rows(applyFx(src, 2)), [1, 2, 3, 4]);
	assert.deepEqual(rows(applyFx(src, 2, { flipX: true })), [2, 1, 4, 3]);
	assert.deepEqual(rows(src), [1, 2, 3, 4], 'the sprite buffer is never written through');
});

test('applyFx flips, turns and displaces', () => {
	assert.deepEqual(rows(applyFx(corners(), 2, { flipY: true })), [3, 4, 1, 2]);
	assert.deepEqual(rows(applyFx(corners(), 2, { flipX: true, flipY: true })), [4, 3, 2, 1]);
	// a half turn about the grid centre is the only rotation that is exact on a 2x2
	assert.deepEqual(rows(applyFx(corners(), 2, { rotate: 180 })), [4, 3, 2, 1]);
	// displaced right and down by one: only the top-left corner has anywhere to land
	assert.deepEqual(rows(applyFx(corners(), 2, { dx: 1, dy: 1 })), [0, 0, 0, 1]);
	assert.deepEqual(rows(applyFx(corners(), 2, { dx: 9, dy: 9 })), [0, 0, 0, 0], 'shifted clean off');
});

test('invert is a negative, and hue reduces to one colour keeping order', () => {
	// index 1 is #000000 and the gray ramp tops out near white, so black must come back light
	const [black] = rows(applyFx(Uint8Array.of(1), 1, { invert: true }));
	assert.match(PALETTE[black], /^#f{6}$|^#f[0-9a-f]/, `black inverted to ${PALETTE[black]}`);
	assert.deepEqual(rows(applyFx(Uint8Array.of(0), 1, { invert: true })), [0], 'transparent stays');

	// a dark and a light pixel through the red reduction: both red-only, and still in that order
	const dark = PALETTE.indexOf('#333333') > 0 ? PALETTE.indexOf('#333333') : 220;
	const out = applyFx(Uint8Array.of(dark, 255), 1, { hue: 'red' });
	for (const i of out) {
		const [, , g, b] = PALETTE[i].match(/#(..)(..)(..)/)!;
		assert.equal(Number.parseInt(g, 16), 0, `${PALETTE[i]} has green in it`);
		assert.equal(Number.parseInt(b, 16), 0, `${PALETTE[i]} has blue in it`);
	}
	const red = (i: number) => Number.parseInt(PALETTE[i].slice(1, 3), 16);
	assert.ok(red(out[0]) < red(out[1]), 'the darker pixel stays the darker red');
});

test('steps subdivides a transition only, and never past 60fps or the grid', () => {
	assert.equal(steps({ sprite: 'a', ms: 1000 }, 32), 1, 'no transition, one draw');
	const scan = { kind: 'scan-down' } as const;
	assert.equal(steps({ sprite: 'a', ms: 1000, transition: scan }, 32), 32, 'capped by the grid');
	assert.equal(steps({ sprite: 'a', ms: 100, transition: scan }, 32), 6, 'capped at ~60fps');
	assert.equal(steps({ sprite: 'a', ms: 5, transition: scan }, 32), 1, 'never zero');
	assert.equal(progress(0, 1), 1, 'a single step is a finished frame');
	assert.deepEqual([progress(0, 2), progress(1, 2)], [0.5, 1]);
});

test('compose applies fx, and honours the bake opt-outs', () => {
	const sprites = [{ name: 'a', pixels: corners() }];
	const frames = [{ sprite: 'a', ms: 100, fx: { flipX: true } }];
	assert.deepEqual(rows(compose(frames, 0, sprites, 2)), [2, 1, 4, 3]);
	assert.deepEqual(rows(compose(frames, 0, sprites, 2, 1, { effects: false })), [1, 2, 3, 4]);
	assert.deepEqual(rows(compose([], 0, sprites, 2)), [0, 0, 0, 0], 'no frame is a blank grid');
	assert.deepEqual(
		rows(compose([{ sprite: 'ghost', ms: 10 }], 0, sprites, 2)),
		[0, 0, 0, 0],
		'a missing sprite renders empty rather than throwing inside a render effect'
	);
});

test('trail draws earlier frames underneath, dimmed, newest on top', () => {
	// three single-pixel sprites in three different cells, so a ghost is identifiable by position
	const sprites = [
		{ name: 'a', pixels: Uint8Array.of(216, 0, 0, 0) }, // #ffffff, top-left
		{ name: 'b', pixels: Uint8Array.of(0, 216, 0, 0) },
		{ name: 'c', pixels: Uint8Array.of(0, 0, 216, 0) }
	];
	const frames = [
		{ sprite: 'a', ms: 100 },
		{ sprite: 'b', ms: 100 },
		{ sprite: 'c', ms: 100, trail: { frames: 2, fade: 0.5 } }
	];
	const out = compose(frames, 2, sprites, 2);

	assert.equal(out[2], 216, 'the head keeps its own full brightness');
	assert.ok(out[1] !== 0, 'one frame back is drawn at all');
	assert.ok(lum(out[1]) < lum(216), `one frame back is dimmed, got ${PALETTE[out[1]]}`);
	assert.ok(out[0] !== 0 && lum(out[0]) < lum(out[1]), 'two frames back is dimmer still');
	assert.equal(out[3], 0, 'nothing is invented where no frame ever drew');
});

test('the head wins where it overlaps its own trail', () => {
	const sprites = [{ name: 'a', pixels: Uint8Array.of(216, 216, 0, 0) }];
	const frames = [
		{ sprite: 'a', ms: 100 },
		{ sprite: 'a', ms: 100, trail: { frames: 1, fade: 0.5 } }
	];
	// both frames are the same sprite, so the ghost lands exactly under the head
	assert.deepEqual(rows(compose(frames, 1, sprites, 2)), [216, 216, 0, 0]);
});

test('trail wraps at the loop seam, and never eats its own frame', () => {
	const sprites = [
		{ name: 'a', pixels: Uint8Array.of(216, 0, 0, 0) },
		{ name: 'b', pixels: Uint8Array.of(0, 216, 0, 0) }
	];
	// frame 0 is the first frame; its ghost has to come from the last one, because animations loop
	const frames = [
		{ sprite: 'a', ms: 100, trail: { frames: 1, fade: 0.5 } },
		{ sprite: 'b', ms: 100 }
	];
	const seam = compose(frames, 0, sprites, 2);
	assert.equal(seam[0], 216, 'head');
	assert.ok(seam[1] !== 0 && lum(seam[1]) < lum(216), 'ghost of the last frame, dimmed');

	// asking for more depth than there are other frames must not wrap onto the head itself
	const greedy = compose(
		[{ sprite: 'a', ms: 100, trail: { frames: 30, fade: 0.5 } }, frames[1]],
		0,
		sprites,
		2
	);
	assert.deepEqual(rows(greedy), rows(seam), 'depth is capped at the other frames');
});

test('trail is an effect, so effects:false drops it', () => {
	const sprites = [
		{ name: 'a', pixels: Uint8Array.of(216, 0, 0, 0) },
		{ name: 'b', pixels: Uint8Array.of(0, 216, 0, 0) }
	];
	const frames = [
		{ sprite: 'a', ms: 100 },
		{ sprite: 'b', ms: 100, trail: { frames: 1 } }
	];
	assert.deepEqual(rows(compose(frames, 1, sprites, 2, 1, { effects: false })), [0, 216, 0, 0]);
});

test('a ghost carries its own fx but never its own trail or transition', () => {
	const sprites = [
		{ name: 'a', pixels: Uint8Array.of(216, 0, 0, 0) },
		{ name: 'b', pixels: Uint8Array.of(0, 216, 0, 0) }
	];
	// frame 0 flips, and also has a trail of its own — the flip must show in the ghost, the trail
	// must not recurse (it would reach back to frame 1 and paint cell 1 twice over)
	const frames = [
		{ sprite: 'a', ms: 100, fx: { flipX: true }, trail: { frames: 1 }, transition: { kind: 'vanish' as const } },
		{ sprite: 'b', ms: 100, trail: { frames: 1, fade: 0.5 } }
	];
	// flipX moves the ghost's pixel from cell 0 to cell 1, which is where the head already is, so
	// the head wins and cell 0 is left empty. Without the fx the ghost would have shown at cell 0;
	// with a recursing trail, cell 0 would have picked up a second-hand ghost of frame 1.
	assert.deepEqual(rows(compose(frames, 1, sprites, 2)), [0, 216, 0, 0]);
});

test('scan reveals from the edge it is named for, and finishes whole', () => {
	const sprites = [{ name: 'a', pixels: corners() }];
	const at = (kind: 'scan-down' | 'scan-up', t: number) =>
		rows(compose([{ sprite: 'a', ms: 100, transition: { kind } }], 0, sprites, 2, t));

	assert.deepEqual(at('scan-down', 0.5), [1, 2, 0, 0], 'top row first');
	assert.deepEqual(at('scan-down', 1), [1, 2, 3, 4]);
	assert.deepEqual(at('scan-up', 0.5), [0, 0, 3, 4], 'bottom row first');
	assert.deepEqual(at('scan-up', 1), [1, 2, 3, 4]);
});

test('vanish empties the frame as it runs, and is the same every time', () => {
	const sprites = [{ name: 'a', pixels: new Uint8Array(64).fill(5) }];
	const frames = [{ sprite: 'a', ms: 100, transition: { kind: 'vanish' as const } }];
	const left = (t: number) => compose(frames, 0, sprites, 8, t).reduce((n, p) => n + (p ? 1 : 0), 0);

	assert.equal(left(0), 64, 'nothing has gone yet');
	assert.ok(left(0.5) > 0 && left(0.5) < 64, `half way through, ${left(0.5)} of 64 left`);
	assert.ok(left(0.5) > left(0.9), 'and it keeps emptying');
	assert.equal(left(1), 0);
	assert.equal(left(0.5), left(0.5), 'the dissolve order carries no state');
});

test('silhouette flattens the frame and dissolves the next one in over it', () => {
	const sprites = [
		{ name: 'a', pixels: Uint8Array.of(7, 8, 9, 0) },
		{ name: 'b', pixels: Uint8Array.of(0, 0, 0, 4) },
		{ name: 'c', pixels: Uint8Array.of(0, 0, 0, 6) }
	];
	const flat = { sprite: 'a', ms: 100, transition: { kind: 'silhouette' as const, color: 2 } };
	const frames = [flat, { sprite: 'b', ms: 100 }];
	// at t = 0 nothing of the next frame has arrived: just this one, flattened
	assert.deepEqual(rows(compose(frames, 0, sprites, 2, 0)), [2, 2, 2, 0]);
	// by the end the next frame's pixels are all through, over what is left of the silhouette
	assert.deepEqual(rows(compose(frames, 0, sprites, 2, 1)), [2, 2, 2, 4]);
	// the last frame's "next" wraps to the first, because animations loop — 6 is sprite c's, so
	// taking the neighbour (b, 4) instead of the wrap would show here
	assert.deepEqual(
		rows(compose([{ sprite: 'c', ms: 100 }, { sprite: 'b', ms: 100 }, flat], 2, sprites, 2, 1)),
		[2, 2, 2, 6]
	);
});

// --- validators (moved from io/storage) --------------------------------------

test('readTrail takes the shorthand, clamps the depth and refuses a pointless fade', () => {
	assert.deepEqual(readTrail(5), { frames: 5 }, 'a bare number is a frame count');
	assert.deepEqual(readTrail({ frames: 5 }), { frames: 5 }, 'fade is left to the default');
	assert.deepEqual(readTrail({ frames: 3, fade: 0.55 }), { frames: 3, fade: 0.55 });
	assert.deepEqual(readTrail({ frames: 1e9 }), { frames: 32 }, 'clamped once, not every redraw');
	assert.deepEqual(readTrail({ frames: 4.7 }), { frames: 4 }, 'truncated to whole frames');

	// fade 0 would erase the trail and 1 would leave it as bright as the head — neither is a trail,
	// so the key is dropped and the default stands rather than the frame being thrown away
	for (const fade of [0, 1, -0.5, 2, 'x', null, NaN])
		assert.deepEqual(readTrail({ frames: 2, fade }), { frames: 2 }, `fade: ${fade}`);

	for (const junk of [undefined, null, 0, -1, 'x', {}, { frames: 'lots' }, { fade: 0.5 }])
		assert.equal(readTrail(junk), undefined, `input: ${JSON.stringify(junk)}`);
});

test('patchEffects leaves absent fields alone and clears on null', () => {
	const frame = {
		sprite: 'a',
		ms: 100,
		fx: { invert: true as const },
		trail: { frames: 3 },
		transition: { kind: 'vanish' as const }
	};
	assert.deepEqual(patchEffects(frame, {}), frame, 'an empty patch changes nothing');
	assert.deepEqual(patchEffects(frame, { trail: null }), {
		sprite: 'a',
		ms: 100,
		fx: { invert: true },
		transition: { kind: 'vanish' }
	});
	assert.deepEqual(patchEffects(frame, { fx: null, trail: null, transition: null }), {
		sprite: 'a',
		ms: 100
	});
	assert.deepEqual(frame.fx, { invert: true }, 'the frame handed in is never written through');
});

test('patchEffects merges fx, so setting one key keeps the others', () => {
	const frame = { sprite: 'a', ms: 100, fx: { invert: true as const, flipX: true as const } };
	assert.deepEqual(patchEffects(frame, { fx: { hue: 'red' } }).fx, {
		invert: true,
		hue: 'red',
		flipX: true
	});
	// a key turned off is dropped by the validator, which is how the timeline untoggles a chip
	assert.deepEqual(patchEffects(frame, { fx: { invert: false } }).fx, { flipX: true });
	assert.equal(
		patchEffects(frame, { fx: { invert: false, flipX: false } }).fx,
		undefined,
		'an fx with nothing left in it goes away rather than persisting as {}'
	);
});

test('patchEffects normalises through the same validators the format uses', () => {
	const frame = { sprite: 'a', ms: 100 };
	assert.equal(patchEffects(frame, { fx: { rotate: 0 } }).fx, undefined, 'a no-op turn is no fx');
	assert.deepEqual(patchEffects(frame, { fx: { rotate: 45 } }).fx, undefined, 'not a 30° step');
	assert.deepEqual(patchEffects(frame, { trail: 4 }).trail, { frames: 4 }, 'shorthand');
	assert.deepEqual(patchEffects(frame, { transition: 'vanish' }).transition, { kind: 'vanish' });
	assert.equal(patchEffects(frame, { transition: 'melt' }).transition, undefined);
});
