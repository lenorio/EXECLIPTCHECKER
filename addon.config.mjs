const addonConfig = {
    id: 'lyrics-explicit-mark',
    directoryName: 'lyrics-explicit-mark',
    name: 'Lyrics Explicit Mark',
    description: 'Проверяет текст трека на ругательства и сексуальные упоминания.',
    version: '0.1.20',
    author: 'agencyofviolence',
    image: 'Assets/main_image.png',
    banner: 'Assets/banner.png',
    libraryLogo: '',
    tags: ['lyrics', 'explicit'],
    dependencies: [],
    cssScope: 'global',
    allowedUrls: ['https://lrclib.net', 'https://raw.githubusercontent.com/lenorio/EXECLIPTCHECKER/'],
    supportedVersions: [],
    requirements: { minHostApi: 1, capabilities: ['lifecycle-v1', 'async-start-v1', 'net-per-addon-v1'] },
}

export default addonConfig
