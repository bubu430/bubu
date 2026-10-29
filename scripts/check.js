const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
let count = 0
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'artifacts'].includes(item.name)) continue
    const file = path.join(dir, item.name)
    if (item.isDirectory()) walk(file)
    else if (file.endsWith('.json')) { JSON.parse(fs.readFileSync(file, 'utf8')); count++ }
    else if (file.endsWith('.js')) { execFileSync(process.execPath, ['--check', file]); count++ }
  }
}
walk(root)
const config = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'))
for (const page of config.pages) {
  for (const ext of ['js', 'json', 'wxml', 'wxss']) {
    if (!fs.existsSync(path.join(root, 'miniprogram', `${page}.${ext}`))) throw new Error(`Missing page ${page}.${ext}`)
  }
}
console.log(`Checked ${count} JS/JSON files and all registered page files.`)
