// A minimal ZIP writer. No dependency: `CompressionStream('deflate-raw')` emits exactly the raw
// deflate stream that ZIP method 8 expects, and it is native in both browsers and Node.
// Entries that do not shrink (PNGs are already compressed) fall back to stored/method 0.
export type ZipEntry = { name: string; data: Uint8Array };

const CRC_TABLE = /* @__PURE__ */ (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[i] = c >>> 0;
	}
	return table;
})();

export function crc32(data: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS packed time and date, which is what the ZIP header stores. */
function dosStamp(d: Date): [time: number, date: number] {
	return [
		(d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
		((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
	];
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
	try {
		const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
		return new Uint8Array(await new Response(stream).arrayBuffer());
	} catch {
		return null; // no CompressionStream here — every entry just gets stored instead
	}
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const UTF8_NAMES = 0x800; // general-purpose flag bit 11

export async function zip(entries: ZipEntry[], now = new Date()): Promise<Blob> {
	const [time, date] = dosStamp(now);
	const encoder = new TextEncoder();
	const body: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;

	for (const entry of entries) {
		const name = encoder.encode(entry.name);
		const crc = crc32(entry.data);
		const deflated = await deflateRaw(entry.data);
		const useDeflate = !!deflated && deflated.length < entry.data.length;
		const payload = useDeflate ? deflated! : entry.data;
		const method = useDeflate ? 8 : 0;

		const local = new Uint8Array(30 + name.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, SIG_LOCAL, true);
		lv.setUint16(4, 20, true); // version needed
		lv.setUint16(6, UTF8_NAMES, true);
		lv.setUint16(8, method, true);
		lv.setUint16(10, time, true);
		lv.setUint16(12, date, true);
		lv.setUint32(14, crc, true);
		lv.setUint32(18, payload.length, true);
		lv.setUint32(22, entry.data.length, true);
		lv.setUint16(26, name.length, true);
		local.set(name, 30);
		body.push(local, payload);

		const dir = new Uint8Array(46 + name.length);
		const dv = new DataView(dir.buffer);
		dv.setUint32(0, SIG_CENTRAL, true);
		dv.setUint16(4, 20, true); // version made by
		dv.setUint16(6, 20, true); // version needed
		dv.setUint16(8, UTF8_NAMES, true);
		dv.setUint16(10, method, true);
		dv.setUint16(12, time, true);
		dv.setUint16(14, date, true);
		dv.setUint32(16, crc, true);
		dv.setUint32(20, payload.length, true);
		dv.setUint32(24, entry.data.length, true);
		dv.setUint16(28, name.length, true);
		dv.setUint32(42, offset, true); // offset of the matching local header
		dir.set(name, 46);
		central.push(dir);

		offset += local.length + payload.length;
	}

	const centralSize = central.reduce((sum, d) => sum + d.length, 0);
	const eocd = new Uint8Array(22);
	const ev = new DataView(eocd.buffer);
	ev.setUint32(0, SIG_EOCD, true);
	ev.setUint16(8, entries.length, true);
	ev.setUint16(10, entries.length, true);
	ev.setUint32(12, centralSize, true);
	ev.setUint32(16, offset, true);

	return new Blob([...body, ...central, eocd] as BlobPart[], { type: 'application/zip' });
}
