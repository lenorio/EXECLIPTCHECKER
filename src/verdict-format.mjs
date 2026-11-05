function normalizeId(value) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value)
    if (typeof value === 'string' && /^\d+$/.test(value)) return value
    throw new Error('Неверный ID трека')
}

export function parseTrackList(data, rulesVersion) {
    if (!data || typeof data !== 'object' || data.rulesVersion !== rulesVersion) {
        throw new Error('Неверная версия правил списка')
    }
    const tracks = new Map()
    const add = (id, verdict) => {
        const normalized = normalizeId(id)
        if (tracks.has(normalized)) throw new Error('Повторяющийся ID трека в списке')
        tracks.set(normalized, verdict)
    }
    if (data.schema === 1 && data.tracks && typeof data.tracks === 'object' && !Array.isArray(data.tracks)) {
        for (const [id, verdict] of Object.entries(data.tracks)) {
            if (verdict !== 'explicit' && verdict !== 'clean') throw new Error('Неверная метка трека')
            add(id, verdict)
        }
    } else if (data.schema === 2 && Array.isArray(data.explicit) && Array.isArray(data.clean)) {
        for (const verdict of ['explicit', 'clean']) {
            for (const id of data[verdict]) add(id, verdict)
        }
    } else {
        throw new Error('Неверный формат списка')
    }
    return tracks
}

export function compactTrackList(tracks, rulesVersion) {
    const data = { schema: 2, rulesVersion, explicit: [], clean: [] }
    for (const [id, verdict] of [...tracks].sort(([left], [right]) => left.localeCompare(right, 'en'))) {
        const number = Number(id)
        data[verdict].push(Number.isSafeInteger(number) && String(number) === id ? number : id)
    }
    return data
}
