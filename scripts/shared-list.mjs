import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { compactTrackList, parseTrackList } from '../src/verdict-format.mjs'

const keyPath = process.env.EXPLICIT_SIGNING_KEY || join(process.env.LOCALAPPDATA || process.env.HOME, 'LyricsExplicitMark', 'signing-key.pem')
const publicKeyPath = new URL('../src/shared-public-key.json', import.meta.url)
const dataPath = new URL('../dist/verified-tracks.json', import.meta.url)
const [command, file] = process.argv.slice(2)
const rulesVersion = 3
const emptyList = () => new Map()

function parseList(payload) {
    return parseTrackList(JSON.parse(payload.replace(/^\uFEFF/, '')), rulesVersion)
}

async function writeSigned(tracks, key) {
    const data = { schema: 1, rulesVersion, tracks: Object.fromEntries(tracks) }
    const payload = JSON.stringify(data)
    const signature = sign('sha256', Buffer.from(payload), { key, dsaEncoding: 'ieee-p1363' }).toString('base64')
    await mkdir(new URL('.', dataPath), { recursive: true })
    await writeFile(dataPath, JSON.stringify({ data, signature }, null, 2) + '\n')
    const compact = compactTrackList(tracks, rulesVersion)
    const compactSignature = sign('sha256', Buffer.from(JSON.stringify(compact)), { key, dsaEncoding: 'ieee-p1363' }).toString('base64')
    await writeFile(new URL('../dist/verified-tracks-v2.json', import.meta.url),
        JSON.stringify({ data: compact, signature: compactSignature }) + '\n')
    console.log(`Сохранено ${tracks.size} треков в verified-tracks.json и verified-tracks-v2.json. Для публикации загрузите оба файла.`)
}

if (command === 'init') {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    await mkdir(dirname(keyPath), { recursive: true })
    await writeFile(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 })
    await writeFile(publicKeyPath, JSON.stringify(publicKey.export({ format: 'jwk' }), null, 2) + '\n')
    await writeSigned(emptyList(), privateKey)
} else if (command === 'seed' || (command === 'merge' && file)) {
    const privateKey = createPrivateKey(await readFile(keyPath))
    const publicKey = createPublicKey(privateKey)
    const trustedKey = createPublicKey({ key: JSON.parse(await readFile(publicKeyPath, 'utf8')), format: 'jwk' })
    if (!publicKey.equals(trustedKey)) throw new Error('Ключ не соответствует аддону')
    if (command === 'seed') {
        await writeSigned(emptyList(), privateKey)
    } else {
        const response = await fetch('https://raw.githubusercontent.com/lenorio/EXECLIPTCHECKER/main/verified-tracks.json', { signal: AbortSignal.timeout(10000) })
        if (!response.ok) throw new Error('Не удалось прочитать опубликованный список: HTTP ' + response.status)
        const { data, signature } = await response.json()
        const payload = JSON.stringify(data)
        if (!verify('sha256', Buffer.from(payload), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64'))) {
            throw new Error('Неверная подпись опубликованного списка')
        }
        const shared = parseList(payload)
        const reviewed = parseList(await readFile(file, 'utf8'))
        for (const [id, verdict] of reviewed) {
            if (!shared.has(id)) shared.set(id, verdict)
        }
        await writeSigned(shared, privateKey)
    }
} else {
    throw new Error('Использование: node scripts/shared-list.mjs init | seed | merge <проверенная-выгрузка.json>')
}
