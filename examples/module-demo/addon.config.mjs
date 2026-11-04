const moduleIds = {
    typescript: '437154d2-4b29-4b50-b750-d9d81d2a46c9',
    rust: '536fade3-07c0-41e4-b982-83f09f7793ab',
}
const moduleBaseUrl = 'http://127.0.0.1:4174'

const modules = Object.fromEntries(
    Object.entries(moduleIds)
        .filter(([, moduleId]) => moduleId)
        .map(([alias, moduleId]) => [alias, { moduleId, apiMajor: 1, channel: 'stable', optional: true }]),
)

export default {
    id: 'pulsesync-module-demo',
    directoryName: 'pulsesync-module-demo',
    name: 'PulseSync Module Demo',
    description: 'Тестовый аддон',
    version: '0.1.1',
    author: 'forea.adoxid',
    tags: ['template'],
    moduleBaseUrl,
    allowedUrls: Object.keys(modules).length ? [moduleBaseUrl] : [],
    ...(Object.keys(modules).length ? { modules } : {}),
}
