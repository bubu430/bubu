const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' }
const port = Number(process.env.PORT) || 4173
http.createServer((req, res) => {
  let pathname
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname) } catch { res.writeHead(400); return res.end('Bad request') }
  const relative = pathname === '/' ? 'preview/index.html' : pathname.replace(/^\//, '')
  const file = path.resolve(root, relative)
  const publicFile = ['preview/', 'miniprogram/assets/', 'miniprogram/shared/'].some(prefix => relative.startsWith(prefix))
  if (!publicFile || !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end('Forbidden') }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); return res.end('Not found') }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    res.end(body)
  })
}).listen(port, '0.0.0.0', () => console.log(`芽芽漫步 browser preview on port ${port}`))
