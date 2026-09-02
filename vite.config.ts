import { readFileSync, readdirSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

/**
 * Every worked example, discovered rather than listed. A hand-maintained index has to be edited in
 * two places to add one file, and forgetting either fails *silently* — the doc simply never ships.
 * Here the file existing is the single fact that makes it both served and indexed.
 *
 * README.md leads; the rest are alphabetical.
 */
const dirDocs = (dir: string): string[] =>
  readdirSync(new URL(`./${dir}`, import.meta.url))
    .filter((f) => f.endsWith('.md'))
    .sort((a, b) => (a === 'README.md' ? -1 : b === 'README.md' ? 1 : a.localeCompare(b)))
    .map((f) => `${dir}/${f}`)

/** Worked examples and topical reference pages, discovered the same way — a directory that has a
 *  README leads with it; otherwise plain alphabetical. */
const exampleDocs = (): string[] => dirDocs('examples')
const referenceDocs = (): string[] => dirDocs('docs')

/**
 * One llms.txt bullet per example, read out of the file itself: the `# title`, and the `> summary`
 * under it. That is the shape llms.txt already uses for the site as a whole, so an example carries
 * its own index entry rather than having one written about it somewhere else.
 */
const indexEntry = (name: string): string => {
  const src = read(name)
  // the summary must sit directly under the title: a doc body may quote things too, and the first
  // stray blockquote is not the one that belongs in an index
  const [, title = name, summary] = src.match(/^#[^#\n]\s*(.+?)\s*\n\n>\s*(.+?)\s*$/m)
    ?? src.match(/^#[^#\n]\s*(.+?)\s*$/m)
    ?? []
  return `- [${title}](/${name})${summary ? `: ${summary}` : ''}`
}

// The emerging convention for "instructions for an LLM that lands on this site". Built at request
// time rather than as a literal, so the worked-example list cannot drift from the directory — and
// so example titles containing backticks need no escaping.
const llmsTxt = (): string => `# frogsprite

> A pixel-sprite editor whose entire feature set is driveable from JavaScript. Built for LLM agents.

Open the page and call commands on the global \`window.frogsprite\`. There is no API key, no server,
and no build step — the editor runs entirely in the page and saves to localStorage.

- [AGENTS.md](/AGENTS.md): the command reference — packages, sets, sprites, painting, shapes,
  grids, the 256-colour palette, undo, and inspection.

Reference — the deep material, one topic per page:

${referenceDocs().map(indexEntry).join('\n')}

Worked examples — complete sprite packages, each with the script that built it and notes on what the
API rewards and where it pushes back:

${exampleDocs().map(indexEntry).join('\n')}

Quick start, pasted into the browser console:

    frogsprite.new_package('demo');
    frogsprite.new_set('hero', 16);
    frogsprite.new_sprite('idle');
    frogsprite.shapes.circle(8, 8, 5, '#22aa33');   // or a square, triangle, ellipse, polygon…
    frogsprite.paint_map(['.gg.', 'gggg'], { g: '#22aa33' });
    frogsprite.rotate(90);              // turn it, in steps of 30°, clockwise
    frogsprite.undo();                  // every command is one step
    frogsprite.print_sprite();          // read your own work back as ASCII
    await frogsprite.export_zip({ download: true });

Call \`frogsprite.help()\` in the page for the command list without leaving the console.
`

/**
 * Serve the agent docs at stable URLs in dev, and ship them alongside the built app so a deployed
 * site can answer /AGENTS.md too. Keeps AGENTS.md at the repo root rather than duplicating it
 * into public/.
 */
function agentDocs(): Plugin {
  const files = (): Record<string, string> => ({
    ...Object.fromEntries(['AGENTS.md', ...referenceDocs(), ...exampleDocs()].map((name) => [name, read(name)])),
    'llms.txt': llmsTxt(),
  })
  return {
    name: 'frogsprite:agent-docs',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0]?.replace(/^\//, '') ?? ''
        const all = files()
        if (!(name in all)) return next()
        res.setHeader(
          'Content-Type',
          name.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8',
        )
        res.end(all[name])
      })
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(files()))
        this.emitFile({ type: 'asset', fileName, source })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), agentDocs()],
})
