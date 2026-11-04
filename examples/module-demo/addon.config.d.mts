declare const addonConfig: {
    id: string
    directoryName: string
    name: string
    description: string
    version: string
    author: string
    tags: string[]
    moduleBaseUrl: string
    allowedUrls: string[]
    modules?: Record<string, { moduleId: string; apiMajor: number; channel: 'stable' | 'dev'; optional: boolean }>
}

export default addonConfig
