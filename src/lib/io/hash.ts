/**
 * SHA-256 as hex, of anything an agent might move between machines.
 *
 * A `data:` URL hashes as its **decoded bytes** — the PNG file itself, not the base64 text — so
 * the digest matches `shasum -a 256` of the file that arrives on the other side. Anything else
 * that is a string hashes as its UTF-8 bytes.
 */
export async function sha256(data: string | Uint8Array | Blob): Promise<string> {
	const bytes =
		typeof data === 'string'
			? data.startsWith('data:')
				? Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), (c) => c.charCodeAt(0))
				: new TextEncoder().encode(data)
			: data instanceof Blob
				? new Uint8Array(await data.arrayBuffer())
				: data;
	// the passthrough branch keeps the caller's Uint8Array generic, which TS narrows to
	// ArrayBufferLike — a view over a plain ArrayBuffer at runtime, whatever the type says
	const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
