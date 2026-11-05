export type SharedVerdict = 'explicit' | 'clean'
export type CompactTrackList = {
    schema: number
    rulesVersion: number
    explicit: (string | number)[]
    clean: (string | number)[]
}
export function parseTrackList(data: unknown, rulesVersion: number): Map<string, SharedVerdict>
export function compactTrackList(tracks: ReadonlyMap<string, SharedVerdict>, rulesVersion: number): CompactTrackList
