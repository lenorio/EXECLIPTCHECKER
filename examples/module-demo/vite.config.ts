import { addonPlugin, defineAddonManifest } from '@pulsesync/addon-sdk/vite'
import { defineConfig } from 'vite'

import addonConfig from './addon.config.mjs'

export default defineConfig(({ mode }) => ({
    plugins: [
        addonPlugin({
            manifest: defineAddonManifest(addonConfig),
            entry: 'src/main.ts',
            staticDir: false,
            minify: mode === 'development' ? false : 'oxc',
            ...(process.env.PULSESYNC_ADDON_OUT_DIR ? { outDir: process.env.PULSESYNC_ADDON_OUT_DIR } : {}),
        }),
    ],
}))
