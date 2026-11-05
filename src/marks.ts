import type { AddonApi, CurrentTrack } from '@pulsesync/addon-sdk'
import { setNativeTooltip } from '@pulsesync/addon-sdk'
import addonConfig from '../addon.config.mjs'
import explicitSvg from '../addon/Assets/explicit.svg?raw'
import cleanSvg from '../addon/Assets/noexlicit.svg?raw'
import missingSvg from '../addon/Assets/missing-lyrics.svg?raw'
import spinnerSvg from '../addon/Assets/spinner-solid-full.svg?raw'
import { containsRestrictedContent } from './profanity'
import { CACHE_PREFIX, RULES_VERSION, createExportSettingsItem, loadSharedVerdicts, type CachedVerdict } from './shared-verdicts'
import './marks.css'

type Track = { id?: string; title: string; artist: string; duration?: number }
type Verdict = 'explicit' | 'clean' | 'missing' | 'unknown'
const cache = new Map<string, Verdict>()
const pending = new Map<string, Promise<Verdict>>()
const failedUntil = new Map<string, number>()
const LRCLIB_INTERVAL_MS = 500
const SKIP_SETTING_KEY = 'skip-explicit'
export const skipMenuLabel = 'Пропускать треки с матом или без текста'
const menuItemSelector = '[data-pulsesync-addon-menu-item]'
const switchSelector = '[data-lyrics-skip-switch]'
let toggleSkip: ((api: AddonApi) => Promise<void>) | undefined

export async function toggleExplicitSkip(api: AddonApi): Promise<void> {
    await toggleSkip?.(api)
}
let lrclibQueue: Promise<void> = Promise.resolve()
let lrclibNextRequestAt = 0
let lrclibBlockedUntil = 0

const delay = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms))

function queueLrclib<T>(request: () => Promise<T>): Promise<T> {
    const result = lrclibQueue.then(async () => {
        const wait = Math.max(lrclibNextRequestAt, lrclibBlockedUntil) - Date.now()
        if (wait > 0) await delay(wait)
        try { return await request() } finally { lrclibNextRequestAt = Date.now() + LRCLIB_INTERVAL_MS }
    })
    lrclibQueue = result.then(() => undefined, () => undefined)
    return result
}

function remember(key: string, verdict: CachedVerdict): void {
    cache.delete(key)
    cache.set(key, verdict)
    if (cache.size > 300) cache.delete(cache.keys().next().value!)
}

const normalize = (text: string) => text.normalize('NFKC').trim().toLocaleLowerCase()
const keyOf = (track: Track) => track.id?.match(/^\d+/)?.[0] || track.id || `${normalize(track.artist)}\u0000${normalize(track.title)}`

function currentDuration(track: CurrentTrack): number | undefined {
    if (typeof track.durationMs === 'number') return Math.round(track.durationMs / 1000)
    if (typeof track.duration === 'number') return Math.round(track.duration)
    return undefined
}

const titleSelector = '[data-test-id="TRACK_TITLE"]'
const rowSelector = '[data-test-id^="TRACK_"]:not([data-test-id="TRACK_TITLE"]):not([data-test-id="TRACK_VERSION"]), [class*="TrackCard_root"], [class*="Meta_root__"]'
const trackLink = 'a[href*="trackId="], a[href*="/track/"]'

function findTrack(title: Element): Track | null {
    const name = title.textContent?.trim()
    if (!name) return null
    let parent = title.parentElement
    for (let depth = 0; parent && depth < 7; depth++, parent = parent.parentElement) {
        if (parent.querySelectorAll(titleSelector).length !== 1) break
        const link = title.closest(trackLink) || title.querySelector(trackLink) || parent.querySelector(trackLink)
        const href = link?.getAttribute('href') || ''
        const id = href.match(/[?&]trackId=(\d+)/)?.[1] || href.match(/\/track\/(\d+)/)?.[1]
        const artist = parent.querySelector('a[href*="/artist"], a[href*="artistId="], [class*="artists"], [class*="Artists"]')?.textContent?.trim()
        if (artist && (id || parent.matches(rowSelector))) return { id, title: name, artist }
    }
    return null
}

async function lrclibLyrics(api: AddonApi, track: Track): Promise<string | null> {
    const params = new URLSearchParams({ track_name: track.title, artist_name: track.artist })
    if (track.duration) params.set('duration', String(track.duration))
    return queueLrclib(async () => {
        api.signal.throwIfAborted()
        const response = await api.net.fetch(`https://lrclib.net/api/get?${params}`, {
            timeoutMs: 8000,
            signal: api.signal,
            headers: { 'Lrclib-Client': `LyricsExplicitMark/${addonConfig.version} (https://github.com/lenorio/EXECLIPTCHECKER)` },
        })
        if (response.status === 429 || response.status === 503) {
            const retryAfter = response.headers.get('Retry-After')
            const seconds = retryAfter ? Number(retryAfter) : NaN
            const retryAt = Number.isFinite(seconds) ? Date.now() + Math.max(1, seconds) * 1000
                : retryAfter ? Date.parse(retryAfter) : NaN
            lrclibBlockedUntil = Math.max(lrclibBlockedUntil, Number.isFinite(retryAt) ? retryAt : Date.now() + 60_000)
            throw new Error(`LRCLIB: HTTP ${response.status}`)
        }
        if (response.status === 404) return null
        if (!response.ok) throw new Error(`LRCLIB: HTTP ${response.status}`)
        const data: unknown = await response.json()
        if (!data || typeof data !== 'object') return null
        const record = data as Record<string, unknown>
        if (normalize(String(record.trackName || '')) !== normalize(track.title) ||
            normalize(String(record.artistName || '')) !== normalize(track.artist)) return null
        return typeof record.plainLyrics === 'string' ? record.plainLyrics
            : typeof record.syncedLyrics === 'string' ? record.syncedLyrics : null
    })
}

async function classify(api: AddonApi, track: Track, shared: Promise<Map<string, CachedVerdict>>): Promise<Verdict> {
    const key = keyOf(track)
    const explicitTitle = containsRestrictedContent(track.title)
    const cached = cache.get(key)
    if (cached && (!explicitTitle || cached === 'explicit')) return cached
    if (!explicitTitle && (failedUntil.get(key) || 0) > Date.now()) return 'unknown'
    const active = pending.get(key)
    if (active) return active
    const task = (async (): Promise<Verdict> => {
        const storageKey = `${CACHE_PREFIX}${encodeURIComponent(key)}`
        const verified = explicitTitle ? undefined : (await shared).get(key)
        if (api.signal.aborted) return 'unknown'
        if (verified) {
            remember(key, verified)
            return verified
        }
        try {
            const saved = await api.storage.get<{ verdict?: CachedVerdict; rulesVersion?: number }>(storageKey)
            if (!explicitTitle && (saved?.verdict === 'explicit' || saved?.verdict === 'missing' ||
                (saved?.verdict === 'clean' && saved.rulesVersion === RULES_VERSION))) {
                remember(key, saved.verdict)
                return saved.verdict
            }
        } catch (error) {
            api.logger.warn('Не удалось прочитать кеш текста трека', error)
        }
        if (explicitTitle) {
            remember(key, 'explicit')
            try { await api.storage.set(storageKey, { verdict: 'explicit', rulesVersion: RULES_VERSION }) } catch (error) {
                api.logger.warn('Не удалось сохранить кеш текста трека', error)
            }
            return 'explicit'
        }
        let lyrics: string | null = null
        if (track.id) {
            try { lyrics = await api.resources.getLyrics(track.id, 'TEXT') } catch { /* LRCLIB fallback */ }
        }
        if (api.signal.aborted) return 'unknown'
        let lrclibCompleted = false
        if (!lyrics?.trim()) {
            try { lyrics = await lrclibLyrics(api, track); lrclibCompleted = true } catch (error) {
                api.logger.warn('Не удалось получить текст трека', error)
            }
        }
        if (api.signal.aborted) return 'unknown'
        const verdict: Verdict = lyrics?.trim() ? containsRestrictedContent(lyrics) ? 'explicit' : 'clean' : lrclibCompleted ? 'missing' : 'unknown'
        if (verdict !== 'unknown') {
            remember(key, verdict)
            try { await api.storage.set(storageKey, { verdict, rulesVersion: RULES_VERSION }) } catch (error) {
                api.logger.warn('Не удалось сохранить кеш текста трека', error)
            }
        } else {
            failedUntil.set(key, Math.max(Date.now() + 60_000, lrclibBlockedUntil))
        }
        return verdict
    })().finally(() => {
        if (pending.get(key) === task) pending.delete(key)
    })
    pending.set(key, task)
    return task
}

type Badge = CachedVerdict | 'loading'
const badges = {
    explicit: { markup: explicitSvg, label: 'В треке есть мат' },
    clean: { markup: cleanSvg, label: 'В треке нет мата' },
    missing: { markup: missingSvg, label: 'Текст песни не найден' },
    loading: { markup: spinnerSvg, label: 'Проверяем текст песни' },
}
const playerBar = '[class*="PlayerBar_root"], [class*="PlayerBarDesktopWithBackgroundProgressBar_root"], [class*="PlayerBarMobile_root"], [class*="CommonLayout_playerBar"]'
const tooltipCleanup = new WeakMap<Element, () => void>()

function removeBadge(host: Element): void {
    const badge = host.querySelector(':scope > [data-lyrics-verdict-mark]')
    if (!badge) return
    tooltipCleanup.get(badge)?.()
    tooltipCleanup.delete(badge)
    badge.remove()
}

function showBadge(host: Element, badge: Badge): void {
    const existing = host.querySelector(':scope > [data-lyrics-verdict-mark]')
    if (existing?.getAttribute('data-lyrics-verdict-mark') === badge) return
    const { markup, label } = badges[badge]
    const svg = document.importNode(new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement, true)
    svg.setAttribute('fill', 'currentColor')
    svg.setAttribute('aria-hidden', 'true')
    const anchor = document.createElement('span')
    anchor.setAttribute('data-lyrics-verdict-mark', badge)
    anchor.setAttribute('role', 'img')
    anchor.setAttribute('aria-label', label)
    anchor.append(svg)
    tooltipCleanup.set(anchor, setNativeTooltip(anchor, { content: label }))
    removeBadge(host)
    host.append(anchor)
}

export function startExplicitMarks(api: AddonApi): () => void {
    pending.clear()
    cache.clear()
    failedUntil.clear()
    const shared = loadSharedVerdicts(api)
    const { item: exportItem, dispose: disposeExport } = createExportSettingsItem(api)
    const marks = new Map<Element, { key: string; verdict?: Verdict }>()
    let current: CurrentTrack | null = null
    let stopped = false
    let timer: number | undefined
    const skipped = new Set<string>()
    let playbackCheck = 0
    let skipEnabled = false
    let savingSkip = false
    let upcoming: Track[] = []
    let prechecking = false
    let queueRevision = 0
    const switchRoles = new Map<HTMLElement, string | null>()

    const updateMenuSwitch = () => {
        for (const item of switchRoles.keys()) {
            if (!item.isConnected) switchRoles.delete(item)
        }
        document.querySelectorAll<HTMLElement>(menuItemSelector).forEach(item => {
            if (item.textContent?.trim() !== skipMenuLabel) return
            if (!switchRoles.has(item)) switchRoles.set(item, item.getAttribute('role'))
            item.setAttribute('data-lyrics-skip-switch', '')
            item.setAttribute('role', 'menuitemcheckbox')
            item.setAttribute('aria-checked', String(skipEnabled))
            item.setAttribute('aria-busy', String(savingSkip))
        })
    }

    const trackPlaying = (): Track | null => current?.title && current.artists?.[0]?.name
        ? { id: current.id, title: current.title, artist: current.artists[0].name, duration: currentDuration(current) }
        : null

    const precheckQueue = async () => {
        if (prechecking) return
        prechecking = true
        try {
            while (!stopped && skipEnabled && upcoming.length) {
                const track = upcoming.shift()!
                try {
                    await classify(api, track, shared)
                } catch (error) {
                    if (!stopped) api.logger.warn('Не удалось заранее проверить трек очереди', error)
                }
            }
        } finally {
            prechecking = false
        }
    }

    const acceptQueue = (snapshot: Awaited<ReturnType<AddonApi['client']['getQueueSnapshot']>>) => {
        upcoming = []
        if (stopped || !skipEnabled) return
        const currentId = current?.id
        const snapshotIndex = snapshot.currentIndex ?? -1
        const currentIndex = !currentId || snapshot.items[snapshotIndex]?.id === currentId
            ? snapshotIndex
            : snapshot.items.findIndex(track => track.id === currentId)
        if (currentIndex < 0) return
        for (const track of snapshot.items.slice(currentIndex + 1, currentIndex + 11)) {
            if (track.title && track.artists?.[0]?.name) {
                upcoming.push({
                    id: track.id, title: track.title,
                    artist: track.artists[0].name, duration: currentDuration(track),
                })
            }
        }
        void precheckQueue()
    }

    const refreshQueue = () => {
        const revision = ++queueRevision
        if (!skipEnabled) {
            upcoming = []
            return
        }
        void api.client.getQueueSnapshot().then(snapshot => {
            if (!stopped && revision === queueRevision) acceptQueue(snapshot)
        }).catch(error => {
            if (!stopped) api.logger.warn('Не удалось прочитать очередь для предварительной проверки', error)
        })
    }

    const checkPlayback = () => {
        const check = ++playbackCheck
        const track = trackPlaying()
        if (!track || !skipEnabled) {
            skipped.clear()
            return
        }
        const key = keyOf(track)
        void classify(api, track, shared).then(async verdict => {
            if (stopped || check !== playbackCheck || verdict === 'unknown') return
            if (verdict !== 'explicit' && verdict !== 'missing') {
                skipped.clear()
                return
            }
            if (skipped.has(key) || skipped.size >= 20) return
            const playing = await api.client.getCurrentTrack()
            if (stopped || check !== playbackCheck || !skipEnabled || playing?.id !== track.id) return
            skipped.add(key)
            await api.client.next()
        }).catch(error => api.logger.warn('Не удалось пропустить трек', error))
    }

    const clearMark = (host: Element) => {
        removeBadge(host)
        host.removeAttribute('data-lyrics-verdict-host')
        marks.delete(host)
    }

    const scan = () => {
        timer = undefined
        const settingsList = document.querySelector('[data-test-id="SETTINGS_LIST"]')
        const fckCensorItem = settingsList?.querySelector(':scope > [fckcensorsettings]')
        if (fckCensorItem && fckCensorItem.nextElementSibling !== exportItem) fckCensorItem.after(exportItem)
        else if (settingsList && exportItem.parentElement !== settingsList) {
            settingsList.insertBefore(exportItem, settingsList.children[1] || null)
        }
        updateMenuSwitch()
        const active = new Set<Element>()
        document.querySelectorAll(titleSelector).forEach(title => {
            const bar = title.closest(playerBar)
            const playing = bar ? trackPlaying() : null
            const track = bar ? (title.textContent?.trim() === playing?.title ? playing : null) : findTrack(title)
            if (!track) return
            const host = title.closest('[class*="_titleContainer__"]') || title.parentElement
            if (!host || active.has(host)) return
            active.add(host)
            const key = keyOf(track)
            const previous = marks.get(host)
            if (previous?.key === key && (previous.verdict !== 'unknown' || (failedUntil.get(key) || 0) > Date.now())) {
                if (previous.verdict !== 'unknown') showBadge(host, previous.verdict || 'loading')
                return
            }
            const entry: { key: string; verdict?: Verdict } = { key }
            marks.set(host, entry)
            host.setAttribute('data-lyrics-verdict-host', '')
            const cached = cache.get(key)
            showBadge(host, cached && cached !== 'unknown' ? cached : 'loading')
            void classify(api, track, shared).then(verdict => {
                const latestTrack = bar ? trackPlaying() : findTrack(title)
                if (stopped || !title.isConnected || !latestTrack || keyOf(latestTrack) !== key || marks.get(host) !== entry) return
                entry.verdict = verdict
                if (verdict === 'unknown') removeBadge(host)
                else showBadge(host, verdict)
            }).catch(error => api.logger.warn('Не удалось проверить трек', error))
        })
        for (const host of marks.keys()) {
            if (!active.has(host)) clearMark(host)
        }
    }

    const schedule = () => {
        if (!stopped && timer === undefined) timer = window.setTimeout(scan, 80)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(document.documentElement, {
        childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['href', 'xlink:href', 'data-test-id'],
    })
    const onTrack = (track: CurrentTrack | null) => {
        if (current?.id === track?.id && current?.title === track?.title) return
        current = track
        checkPlayback()
        refreshQueue()
        schedule()
    }
    let receivedTrackEvent = false
    const unsubscribe = api.client.onCurrentTrackChange(track => {
        receivedTrackEvent = true
        onTrack(track)
    })
    const unsubscribeQueue = api.client.onQueueChange(snapshot => {
        ++queueRevision
        acceptQueue(snapshot)
    })
    const readSkip = api.storage.get<boolean>(SKIP_SETTING_KEY).then(saved => {
        if (stopped) return
        const legacy = api.settings.getCurrent().skipExplicit
        const legacyValue = legacy && typeof legacy === 'object' && 'value' in legacy ? legacy.value : legacy
        skipEnabled = typeof saved === 'boolean' ? saved : legacyValue === true
        updateMenuSwitch()
        checkPlayback()
        refreshQueue()
    }).catch(error => api.logger.warn('Не удалось прочитать настройку пропуска', error))
    const toggle = async (actionApi: AddonApi) => {
        if (savingSkip || stopped) return
        savingSkip = true
        updateMenuSwitch()
        try {
            await readSkip
            if (stopped) return
            const enabled = !skipEnabled
            await actionApi.storage.set(SKIP_SETTING_KEY, enabled)
            if (stopped) return
            skipEnabled = enabled
            checkPlayback()
            refreshQueue()
            await actionApi.toasts.show(enabled
                ? 'Пропуск треков с матом или без текста включён.'
                : 'Пропуск треков с матом или без текста выключен.')
        } catch (error) {
            actionApi.logger.warn('Не удалось изменить пропуск треков', error)
            if (!stopped) await actionApi.notifications.error('Не удалось изменить пропуск треков.')
        } finally {
            savingSkip = false
            if (!stopped) updateMenuSwitch()
        }
    }
    toggleSkip = toggle
    const onSwitchClick = (event: MouseEvent) => {
        if (!(event.target instanceof Element) || !event.target.closest(switchSelector)) return
        event.preventDefault()
        event.stopPropagation()
        void toggle(api)
    }
    document.addEventListener('click', onSwitchClick, true)
    void api.client.getCurrentTrack().then(track => {
        if (!stopped && !receivedTrackEvent) onTrack(track ?? null)
    }).catch(error => api.logger.warn('Не удалось прочитать текущий трек', error))
    schedule()
    return () => {
        stopped = true
        observer.disconnect()
        disposeExport()
        document.removeEventListener('click', onSwitchClick, true)
        for (const [item, role] of switchRoles) {
            item.removeAttribute('data-lyrics-skip-switch')
            item.removeAttribute('aria-checked')
            item.removeAttribute('aria-busy')
            if (role === null) item.removeAttribute('role')
            else item.setAttribute('role', role)
        }
        unsubscribe()
        unsubscribeQueue()
        if (toggleSkip === toggle) toggleSkip = undefined
        if (timer !== undefined) window.clearTimeout(timer)
        for (const host of marks.keys()) clearMark(host)
    }
}
