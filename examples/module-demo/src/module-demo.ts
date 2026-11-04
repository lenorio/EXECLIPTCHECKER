import { logger, modules, net, notifications, type WebHostClient } from '@pulsesync/addon-sdk'

import addonConfig from '../addon.config.mjs'
import type { RustModule, TypeScriptModule } from './module-contracts'

function moduleFile(alias: 'typescript' | 'rust', extension: 'js' | 'wasm'): Parameters<typeof modules.load>[1] {
    return {
        fetch: async ({ descriptor, signal }) => {
            const url = `${addonConfig.moduleBaseUrl}/${alias}/${descriptor.sha256}.${extension}`
            const response = await net.fetch(url, { signal })
            if (!response.ok) throw new Error(`Модуль не скачан: HTTP ${response.status}`)
            return new Uint8Array(await response.arrayBuffer())
        },
    }
}

async function runDemo(alias: 'typescript' | 'rust', action: () => Promise<string>) {
    try {
        await notifications.info(await action())
    } catch (error) {
        logger.error(`Ошибка ${alias}-модуля`, error)
        await notifications.error(`Ошибка ${alias}-демо: ${error instanceof Error ? error.message : String(error)}`)
    }
}

export function runTypeScriptDemo(trackTitle: string) {
    return runDemo('typescript', async () => {
        const module = await modules.load<TypeScriptModule>('typescript', moduleFile('typescript', 'js'))
        return module.formatLabel(trackTitle)
    })
}

export function runRustDemo(client: WebHostClient) {
    return runDemo('rust', async () => {
        const module = await modules.instantiateWasm<RustModule>('rust', moduleFile('rust', 'wasm'))
        const queue = await client.getQueueSnapshot()
        const currentId = queue.currentIndex === null ? undefined : queue.items[queue.currentIndex]?.id
        const tracks = queue.items.filter(track => track.id && track.id !== currentId)
        if (!tracks.length) return 'Добавьте в очередь ещё треки'

        const random = crypto.getRandomValues(new Uint32Array(1))[0]
        const track = tracks[module.pick_track(tracks.length, random)]
        if (!track) throw new Error('WASM вернул неверную позицию трека')

        await client.playTrackById(track.id)
        return `Выбрано: ${track.title || 'Без названия'}`
    })
}
