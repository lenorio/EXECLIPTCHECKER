import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = {
    typescript: { file: path.join(root, 'dist', 'modules', 'typescript', 'module.js'), extension: 'js', contentType: 'text/javascript' },
    rust: { file: path.join(root, 'dist', 'modules', 'rust', 'module.wasm'), extension: 'wasm', contentType: 'application/wasm' },
}

http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    response.setHeader('Cache-Control', 'no-store')

    if (request.method === 'OPTIONS') {
        response.writeHead(204).end()
        return
    }

    const match = /^\/(typescript|rust)\/([a-f0-9]{64})\.(js|wasm)$/.exec(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
    const entry = match ? files[match[1]] : undefined
    if (request.method !== 'GET' || !entry || match?.[3] !== entry.extension) {
        response.writeHead(404).end()
        return
    }

    try {
        const bytes = await readFile(entry.file)
        const hash = createHash('sha256').update(bytes).digest('hex')
        if (hash !== match[2]) {
            response.writeHead(404).end()
            return
        }
        response.writeHead(200, { 'Content-Type': entry.contentType, 'Content-Length': bytes.length }).end(bytes)
    } catch (error) {
        response.writeHead(error?.code === 'ENOENT' ? 404 : 500).end()
    }
}).listen(4174, '127.0.0.1', () => {
    console.log('Тестовые модули доступны на http://127.0.0.1:4174')
})
