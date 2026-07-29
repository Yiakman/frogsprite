<script module lang="ts">
	/** A field is its native input attributes; `options` turns it into a <select>. */
	export type Field = {
		name: string;
		options?: readonly (string | number)[];
		type?: string;
		value?: string | number;
		step?: number;
		required?: boolean;
		placeholder?: string;
	};

	export type Request = {
		title: string;
		fields: Field[];
		/** may throw — the message lands inline and the dialog stays open */
		submit: (values: Record<string, string>) => unknown;
	};

	// ponytail: one dialog at a time. A second open replaces the first, the way prompt() used to.
	let req = $state<Request | null>(null);
	let error = $state('');

	export function form(r: Request) {
		req = r;
		error = '';
	}

	/** The old alert(): a message and an OK. */
	export function notify(message: string) {
		form({ title: message, fields: [], submit: () => {} });
	}
</script>

<script lang="ts">
	const attrs = ({ options, ...rest }: Field) => rest;

	const modal = (d: HTMLDialogElement) => d.showModal();

	async function submit(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
		e.preventDefault();
		const r = req;
		if (!r) return;
		try {
			await r.submit(
				Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
			);
			// a submit that opened its own dialog (a warning) keeps it — only close our own
			if (req === r) req = null;
		} catch (err) {
			error = (err as Error).message;
		}
	}
</script>

{#if req}
	<!-- showModal() gives the backdrop and focus trap; native validation gates onsubmit.
	     Esc is handled here rather than through close/cancel — those events don't fire in every
	     runtime, and a dialog that closes without clearing `req` never reopens. -->
	<dialog
		{@attach modal}
		onkeydown={(e) => {
			if (e.key !== 'Escape') return;
			e.preventDefault();
			req = null;
		}}
		data-testid="dialog"
	>
		<!-- `form()` always hands over a new object, so keying on it rebuilds the fields per open —
		     a request replacing another must not inherit the last one's typed-in DOM -->
		{#key req}
		<!-- the error describes the values as submitted; editing them makes it stale -->
		<form onsubmit={submit} oninput={() => (error = '')}>
			<h2>{req.title}</h2>

			{#each req.fields as f (f.name)}
				<label>
					<span>{f.name}</span>
					{#if f.options}
						<select name={f.name}>
							{#each f.options as o (o)}
								<option value={o} selected={o === f.value}>{o}</option>
							{/each}
						</select>
					{:else}
						<input {...attrs(f)} />
					{/if}
				</label>
			{/each}

			{#if error}<p class="err" role="alert">{error}</p>{/if}

			<div class="row">
				{#if req.fields.length}
					<button type="button" onclick={() => (req = null)}>Cancel</button>
				{/if}
				<button type="submit" class="go">OK</button>
			</div>
		</form>
		{/key}
	</dialog>
{/if}

<style>
	dialog {
		background: #1a1a1a;
		color: #ddd;
		border: 1px solid #444;
		border-radius: 6px;
		padding: 1rem;
		min-width: 15rem;
		font: inherit;
	}
	dialog::backdrop {
		background: #000a;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	h2 {
		margin: 0 0 0.25rem;
		font-size: 0.85rem;
		font-weight: 600;
	}
	label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		font-size: 0.78rem;
		color: #888;
	}
	input,
	select {
		background: #222;
		color: #ddd;
		border: 1px solid #444;
		border-radius: 4px;
		padding: 0.25rem 0.4rem;
		font: inherit;
		font-size: 0.78rem;
		width: 9rem;
	}
	input:focus,
	select:focus {
		outline: none;
		border-color: #7cf;
	}
	.err {
		margin: 0;
		font-size: 0.75rem;
		color: #f88;
	}
	.row {
		display: flex;
		justify-content: flex-end;
		gap: 0.35rem;
		margin-top: 0.25rem;
	}
	button {
		background: #222;
		color: #ddd;
		border: 1px solid #444;
		border-radius: 4px;
		padding: 0.25rem 0.7rem;
		font-size: 0.75rem;
		cursor: pointer;
	}
	button.go {
		border-color: #35617d;
		color: #cfe9ff;
	}
</style>
