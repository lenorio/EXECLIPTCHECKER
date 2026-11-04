import { defineAddon } from '@pulsesync/addon-sdk'
import addonConfig from '../addon.config.mjs'
import { skipMenuLabel, startExplicitMarks, toggleExplicitSkip } from './marks'

export default defineAddon({
    id: addonConfig.id,
    name: addonConfig.name,
    playlistMenuItems: [{
        id: 'toggle-explicit-skip',
        label: skipMenuLabel,
        icon: 'next',
        position: 'end',
        onClick: ({ api }) => toggleExplicitSkip(api),
    }],
    start: startExplicitMarks,
})
