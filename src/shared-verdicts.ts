import type { AddonApi } from '@pulsesync/addon-sdk'
import { compactTrackList } from './verdict-format.mjs'

export const CACHE_PREFIX = 'lyrics-verdict-v1:'
export const RULES_VERSION = 3
export type CachedVerdict = 'explicit' | 'clean' | 'missing'

export function isShareableVerdict(value: unknown): value is 'explicit' | 'clean' {
    return value === 'explicit' || value === 'clean'
}

const exportFileName = 'explicit-track-submission.json'
type SaveFilePicker = (options: {
    suggestedName: string
    types: { description: string; accept: Record<string, string[]> }[]
}) => Promise<{ createWritable(): Promise<FileSystemWritableFileStream> }>

function openExportDialog(json: string, count: number): HTMLDialogElement {
    const dialog = document.createElement('dialog')
    dialog.setAttribute('data-lyrics-export-dialog', '')
    dialog.setAttribute('aria-label', 'Экспорт проверенных треков')

    const heading = document.createElement('h2')
    heading.textContent = 'Экспорт проверенных треков'
    const description = document.createElement('p')
    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = 'Закрыть'
    close.addEventListener('click', () => dialog.close())
    dialog.append(heading, description)
    if (count === 0) {
        description.textContent = 'В локальном кеше пока нет результатов для экспорта. Дождитесь проверки треков и попробуйте снова.'
        dialog.append(close)
    } else {
        description.textContent = `Записей в выгрузке: ${count}. Скачайте файл или скопируйте JSON.`
        const field = document.createElement('textarea')
        field.readOnly = true
        field.value = json
        field.setAttribute('aria-label', 'Содержимое JSON')

        const download = document.createElement('button')
        download.type = 'button'
        download.textContent = 'Сохранить JSON'
        const copy = document.createElement('button')
        copy.type = 'button'
        copy.textContent = 'Скопировать'
        const status = document.createElement('p')
        status.setAttribute('role', 'status')
        download.addEventListener('click', async () => {
            download.disabled = true
            status.textContent = ''
            try {
                const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
                if (!picker) throw new Error('File picker unavailable')
                const file = await picker.call(window, {
                    suggestedName: exportFileName,
                    types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
                })
                const writable = await file.createWritable()
                await writable.write(json)
                await writable.close()
                status.textContent = 'JSON сохранён.'
            } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError') {
                    status.textContent = 'Сохранение отменено.'
                } else {
                    field.focus()
                    field.select()
                    status.textContent = 'Клиент не смог сохранить файл. Скопируйте JSON и сохраните его в файле explicit-track-submission.json.'
                }
            } finally {
                download.disabled = false
            }
        })
        copy.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(json)
                status.textContent = 'JSON скопирован.'
            } catch {
                field.focus()
                field.select()
                status.textContent = 'JSON выделен. Нажмите Ctrl+C, чтобы скопировать.'
            }
        })
        const actions = document.createElement('div')
        actions.append(download, copy, close)
        dialog.append(field, actions, status)
    }
    dialog.addEventListener('close', () => dialog.remove(), { once: true })
    document.body.append(dialog)
    dialog.showModal()
    return dialog
}

async function exportVerdicts(api: AddonApi): Promise<HTMLDialogElement | undefined> {
    try {
        const tracks = new Map<string, 'explicit' | 'clean'>()
        for (const key of await api.storage.keys()) {
            if (!key.startsWith(CACHE_PREFIX)) continue
            const id = key.slice(CACHE_PREFIX.length)
            if (!/^\d+$/.test(id)) continue
            const entry = await api.storage.get<{ verdict?: unknown; rulesVersion?: number }>(key)
            if (entry?.rulesVersion === RULES_VERSION && isShareableVerdict(entry.verdict)) tracks.set(id, entry.verdict)
        }
        if (api.signal.aborted) return
        const json = JSON.stringify(compactTrackList(tracks, RULES_VERSION))
        return openExportDialog(json, tracks.size)
    } catch (error) {
        api.logger.warn('Ошибка экспорта проверок', error)
        await api.modals.alert({
            title: 'Не удалось экспортировать проверки',
            message: 'Попробуйте открыть экспорт ещё раз.',
        })
    }
}

export function createSettingsRow(name: string, description: string, attribute: string) {
    const item = document.createElement('li')
    item.setAttribute(attribute, '')
    item.setAttribute('data-lyrics-settings-row', '')
    const button = document.createElement('button')
    button.type = 'button'
    const text = document.createElement('span')
    const title = document.createElement('strong')
    title.textContent = name
    const detail = document.createElement('small')
    detail.textContent = description
    text.append(title, detail)
    const arrow = document.createElement('span')
    arrow.setAttribute('aria-hidden', 'true')
    button.append(text, arrow)
    item.append(button)
    return { item, button, detail }
}

export function createExportSettingsItem(api: AddonApi) {
    const { item, button } = createSettingsRow(
        'Экспортировать проверенные треки', 'Сохранить результаты проверки в JSON', 'data-lyrics-export-settings',
    )
    let dialog: HTMLDialogElement | undefined
    let disposed = false
    button.addEventListener('click', async () => {
        button.disabled = true
        button.setAttribute('aria-busy', 'true')
        try {
            dialog = await exportVerdicts(api)
            if (disposed) dialog?.close()
        } finally {
            button.disabled = false
            button.removeAttribute('aria-busy')
        }
    })
    return { item, dispose: () => {
        disposed = true
        dialog?.close()
        item.remove()
    } }
}
