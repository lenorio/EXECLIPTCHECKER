import { defineModule } from '@pulsesync/addon-sdk'

import type { TypeScriptModule } from '../../src/module-contracts'

defineModule<TypeScriptModule>({
    apiMajor: 1,
    create({ signal }) {
        return {
            exports: {
                formatLabel(value) {
                    signal.throwIfAborted()
                    return `TS-модуль: ${value.trim()}`
                },
            },
        }
    },
})
