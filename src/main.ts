import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { frogsprite } from './lib/commands';
import { editor } from './lib/store.svelte';
import { stored } from './lib/storage';

const firstVisit = !stored();
editor.load();
if (firstVisit) editor.seed();

// The agent-facing API — everything the UI can do is reachable from here.
(globalThis as any).frogsprite = frogsprite;

// Agents routinely read the console before anything else, so leave a pointer there too.
// Plain text, no %c styling: console readers surface the format string and its style arguments
// verbatim, which turns decoration into noise for the reader this line exists for.
console.info(
	'frogsprite — this editor is driveable from JavaScript. Run frogsprite.help(), or read /AGENTS.md'
);

export default mount(App, { target: document.getElementById('app')! });
