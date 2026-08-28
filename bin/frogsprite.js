#!/usr/bin/env node

import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs'
import { join, extname, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec } from 'node:child_process'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const distDir = resolve(__dirname, '../dist')
const pkgJsonPath = resolve(__dirname, '../package.json')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
}

function parseArgs(args) {
  const options = {
    port: 5173,
    host: 'localhost',
    open: true,
    help: false,
    version: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--version' || arg === '-v') {
      options.version = true
    } else if (arg === '--no-open') {
      options.open = false
    } else if (arg === '--open' || arg === '-o') {
      options.open = true
    } else if (arg === '--port' || arg === '-p') {
      const val = parseInt(args[++i], 10)
      if (!isNaN(val)) options.port = val
    } else if (arg.startsWith('--port=')) {
      const val = parseInt(arg.split('=')[1], 10)
      if (!isNaN(val)) options.port = val
    } else if (arg === '--host') {
      options.host = args[++i] || 'localhost'
    } else if (arg.startsWith('--host=')) {
      options.host = arg.split('=')[1] || 'localhost'
    }
  }

  return options
}

function getVersion() {
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function showHelp() {
  console.log(`
🐸 frogsprite — pixel-sprite editor for LLM agents & humans

Usage:
  npx -y frogsprite [options]

Options:
  -p, --port <number>   Port to listen on (default: 5173, or next open port)
      --host <host>     Host to bind to (default: localhost)
  -o, --open            Open browser automatically (default: true)
      --no-open         Do not open browser
  -v, --version         Show frogsprite version
  -h, --help            Show this help message
`)
}

function openBrowser(url) {
  const start =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`

  exec(start, () => {
    // Ignore errors opening browser (e.g. headless environments)
  })
}

function startServer(port, host, open) {
  if (!existsSync(distDir)) {
    console.error(`\n❌ Error: Built assets not found at ${distDir}`)
    console.error('Please run "npm run build" first if running from source repository.\n')
    process.exit(1)
  }

  const server = createServer((req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    let pathname = decodeURIComponent(parsedUrl.pathname)

    // Normalize path to prevent directory traversal
    const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, '')
    let filePath = join(distDir, safePath)

    // Verify it doesn't escape distDir
    if (!filePath.startsWith(distDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' })
      res.end('Forbidden')
      return
    }

    // If directory or root, serve index.html
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, 'index.html')
    }

    // If file doesn't exist, fallback to index.html for SPA routing
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      filePath = join(distDir, 'index.html')
    }

    if (!existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
      return
    }

    const ext = extname(filePath).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    })

    createReadStream(filePath).pipe(res)
  })

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      // Try next port
      startServer(port + 1, host, open)
    } else {
      console.error('Server error:', err)
      process.exit(1)
    }
  })

  server.listen(port, host, () => {
    const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`
    console.log(`\n🐸 frogsprite v${getVersion()} is running!`)
    console.log(`\n   ➜  Local:   ${url}\n`)
    console.log('   Press Ctrl+C to stop.\n')

    if (open) {
      openBrowser(url)
    }
  })

  const shutdown = () => {
    server.close(() => {
      process.exit(0)
    })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

function main() {
  const args = process.argv.slice(2)
  const options = parseArgs(args)

  if (options.help) {
    showHelp()
    process.exit(0)
  }

  if (options.version) {
    console.log(`frogsprite v${getVersion()}`)
    process.exit(0)
  }

  startServer(options.port, options.host, options.open)
}

main()
