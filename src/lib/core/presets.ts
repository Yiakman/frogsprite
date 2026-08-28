// Named colour lists, as authored. These are *lists*, not rules: unlike the cube in palette.ts
// (a uniform lattice, derived) these are historical artifacts with nothing to generate them from,
// so they are spelled out. Each one snaps onto the cube when it is made active, which is lossy —
// `palette()` reports how many distinct entries survived so a collision is visible rather than
// silent.
export const PRESETS: Record<string, string[]> = {
	pico8: [
		'#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
		'#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'
	],
	gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
	sweetie16: [
		'#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
		'#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57'
	],
	cga: [
		'#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
		'#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff'
	]
};

export const PRESET_NAMES = Object.keys(PRESETS);
