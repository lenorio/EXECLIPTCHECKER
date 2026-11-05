import type { AddonApi } from '@pulsesync/addon-sdk'
import publicKey from './shared-public-key.json'
import { parseTrackList } from './verdict-format.mjs'
import { createSettingsRow, RULES_VERSION, type CachedVerdict } from './shared-verdicts'

const baseUrl = 'https://raw.githubusercontent.com/lenorio/EXECLIPTCHECKER/main/'
const storageKey = 'shared-database-signed-v2'

async function verifyDatabase(text: string): Promise<Map<string, CachedVerdict>> {
    const envelope = JSON.parse(text)
    const key = await crypto.subtle.importKey('jwk', publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const valid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' }, key,
        Uint8Array.from(atob(envelope.signature), char => char.charCodeAt(0)),
        new TextEncoder().encode(JSON.stringify(envelope.data)),
    )
    if (!valid) throw new Error('Недействительная подпись базы')
    return parseTrackList(envelope.data, RULES_VERSION)
}

export function createSharedDatabase(api: AddonApi, onUpdated: () => void) {
    const verdicts = new Map<string, CachedVerdict>()
    const { item, button, detail } = createSettingsRow(
        'База треков GitHub', 'Загрузка базы…', 'data-lyrics-database-settings',
    )
    detail.setAttribute('role', 'status')
    const progress = document.createElement('div')
    progress.setAttribute('data-lyrics-database-progress', '')
    progress.setAttribute('role', 'progressbar')
    progress.setAttribute('aria-label', 'Обновление базы треков GitHub')
    progress.setAttribute('aria-valuemin', '0')
    progress.setAttribute('aria-valuemax', '100')
    let disposed = false
    let active: Promise<Map<string, CachedVerdict>> | undefined
    let size = 0
    let loaded = false

    const render = (message = '') => {
        const stats = loaded
            ? `Импортировано ${verdicts.size.toLocaleString('ru-RU')} треков · ${(size / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} КБ`
            : 'База ещё не загружена'
        detail.textContent = message ? `${stats} · ${message}` : stats
    }
    const commit = (tracks: Map<string, CachedVerdict>, text: string) => {
        verdicts.clear()
        for (const [id, verdict] of tracks) verdicts.set(id, verdict)
        size = new TextEncoder().encode(text).byteLength
        loaded = true
        render()
        onUpdated()
    }
    const stage = (text: string) => {
        progress.setAttribute('aria-valuetext', text)
        render(text)
    }
    const refresh = (): Promise<Map<string, CachedVerdict>> => {
        if (active) return active
        if (disposed || api.signal.aborted) return Promise.resolve(verdicts)
        active = (async () => {
            button.disabled = true
            button.setAttribute('aria-busy', 'true')
            document.documentElement.append(progress)
            try {
                let text: string | undefined
                let tracks: Map<string, CachedVerdict> | undefined
                for (const file of ['verified-tracks-v2.json', 'verified-tracks.json']) {
                    try {
                        stage('Загрузка…')
                        const response = await api.net.fetch(baseUrl + file, {
                            timeoutMs: 10000, signal: api.signal, cache: 'no-store',
                        })
                        if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`)
                        text = await response.text()
                        if (disposed || api.signal.aborted) return verdicts
                        stage('Проверка подписи…')
                        tracks = await verifyDatabase(text)
                        break
                    } catch (error) {
                        if (disposed || api.signal.aborted) return verdicts
                        api.logger.warn('Не удалось загрузить базу GitHub', error)
                    }
                }
                if (!tracks || text === undefined) throw new Error('База GitHub недоступна или подпись недействительна')
                if (disposed || api.signal.aborted) return verdicts
                commit(tracks, text)
                progress.setAttribute('aria-valuenow', '100')
                stage('База обновлена')
                try {
                    await api.storage.set(storageKey, text)
                } catch (error) {
                    api.logger.warn('Не удалось сохранить общую базу локально', error)
                    if (!disposed) render('Обновлена, но не сохранена локально')
                }
            } catch (error) {
                api.logger.warn('Ошибка обновления базы GitHub', error)
                if (!disposed && !api.signal.aborted) render('Ошибка обновления. Нажмите, чтобы повторить')
            } finally {
                progress.remove()
                progress.removeAttribute('aria-valuenow')
                button.disabled = false
                button.removeAttribute('aria-busy')
                active = undefined
            }
            return verdicts
        })()
        return active
    }
    const ready = (async () => {
        try {
            const saved = await api.storage.get<string>(storageKey)
            if (typeof saved === 'string') {
                const tracks = await verifyDatabase(saved)
                if (!disposed && !api.signal.aborted) commit(tracks, saved)
            }
        } catch (error) {
            api.logger.warn('Не удалось прочитать сохранённую базу GitHub', error)
        }
        if (disposed || api.signal.aborted) return verdicts
        if (loaded) {
            void refresh()
            return verdicts
        }
        return refresh()
    })()
    button.addEventListener('click', () => { void ready.then(() => refresh()) })
    return {
        item, ready,
        dispose: () => {
            disposed = true
            progress.remove()
            item.remove()
        },
    }
}
