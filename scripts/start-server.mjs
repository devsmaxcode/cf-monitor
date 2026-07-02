import { stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import serverEntry from '../dist/server/server.js'

const root = resolve(process.env.APP_ROOT || process.cwd())
const clientDir = resolve(root, 'dist/client')
const hostname = process.env.HOST || process.env.APP_HOST || '127.0.0.1'
const port = Number.parseInt(
  process.env.PORT || process.env.APP_PORT || '3033',
  10,
)

if (!Number.isFinite(port)) {
  throw new Error(`Invalid PORT: ${process.env.PORT || process.env.APP_PORT}`)
}

if (!globalThis.Bun) {
  throw new Error('scripts/start-server.mjs must be run with Bun')
}

async function serveStatic(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null

  let pathname
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname)
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const filePath = resolve(clientDir, `.${pathname}`)
  const fileRelativePath = relative(clientDir, filePath)
  if (
    !fileRelativePath ||
    fileRelativePath.startsWith('..') ||
    isAbsolute(fileRelativePath)
  ) {
    return null
  }

  const fileStat = await stat(filePath).catch(() => null)
  if (!fileStat?.isFile()) return null

  const headers = new Headers()
  if (pathname.startsWith('/assets/')) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  } else if (/\.(png|ico|webmanifest|json|txt)$/.test(pathname)) {
    headers.set('Cache-Control', 'public, max-age=3600')
  }

  return new Response(request.method === 'HEAD' ? null : Bun.file(filePath), {
    headers,
  })
}

Bun.serve({
  hostname,
  port,
  async fetch(request) {
    return (await serveStatic(request)) ?? serverEntry.fetch(request)
  },
})

console.log(`Listening on http://${hostname}:${port}/`)
