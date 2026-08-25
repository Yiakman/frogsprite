import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

// The emerging convention for "instructions for an LLM that lands on this site".
const LLMS_TXT = `# frogsprite

> A pixel-sprite editor whose entire feature set is driveable from JavaScript. Built for LLM agents.

Open the page and call commands on the global \`window.frogsprite\`. There is no API key, no server,
and no build step — the editor runs entirely in the page and saves to localStorage.

- [AGENTS.md](/AGENTS.md): the full command reference — packages, sets, sprites, painting, shapes,
  grids, the 256-colour palette, animation, undo, image import, and the SVG/PNG/ICO/ZIP/
  spritesheet exports.

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
    'AGENTS.md': read('AGENTS.md'),
    'llms.txt': LLMS_TXT,
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
