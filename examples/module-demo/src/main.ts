import { defineAddon } from '@pulsesync/addon-sdk'

import addonConfig from '../addon.config.mjs'
import { runRustDemo, runTypeScriptDemo } from './module-demo'

export default defineAddon({
    id: addonConfig.id,
    name: addonConfig.name,
    trackMenuItems: [
        {
            id: 'check-typescript-module',
            label: 'Проверить TS-модуль',
            icon: 'info',
            position: 1,
            onClick: ({ track }) => runTypeScriptDemo(track.title ?? 'Без названия'),
        },
    ],
    playerBarButtons: [
        {
            id: 'random-queue-track-wasm',
            label: 'Случайный трек · WASM',
            icon: 'shuffle',
            position: 'end',
            onClick: ({ api }) => runRustDemo(api.client),
        },
    ],
})
