// A missing lyric is never classified as clean. These patterns favor catching
// common explicit words, but cannot certify that a song is suitable for an event.
const SWEAR_WORDS = [
    /(?<!\p{L})(?:на|за|по|про|до|вы|от|раз|с|у)?(?:ёб|еб|ъеб)\p{L}*/iu,
    /(?<!\p{L})(?:пизд|бляд|блят|хуй|хуя|хуе|хуё|хуи|хую|нахуй|похуй|пидор|пидар|мудак|гандон)\p{L}*/iu,
    /(?<!\p{L})(?:сук(?:а|и|у|е|ой|ами|ах)|сучк(?:а|и|у|е|ой|ами|ах))(?!\p{L})/iu,
    /(?<!\p{L})(?:fuck|shit|bitch|cunt|motherfuck|asshole|dickhead)\p{L}*/iu,
    /(?<!\p{L})(?:bastard|damn|crap)(?!\p{L})/iu,
]

const SEXUAL_WORDS = [
    /(?<!\p{L})(?:sex(?:y|ual\p{L}*)?|sext\p{L}*|porn\p{L}*|nude|naked|orgasm\p{L}*|masturbat\p{L}*|pussy|dicks?|cocks?|horny|boobs?|tits?|titties)(?!\p{L})/iu,
    /(?<!\p{L})(?:секс(?:а|у|ом|е|ы|уальн\p{L}*)?|порно\p{L}*|трах\p{L}*|оргазм\p{L}*|мастурб\p{L}*|минет\p{L}*|эротик\p{L}*|шлюх\p{L}*|проститут\p{L}*|сиськ\p{L}*|пенис\p{L}*|вагин\p{L}*)(?!\p{L})/iu,
]

export function containsRestrictedContent(content: string): boolean {
    const text = content.normalize('NFKC').replace(/^\[[^\]\n]{1,40}\]/gm, '')
    return [...SWEAR_WORDS, ...SEXUAL_WORDS].some(word => word.test(text))
}
