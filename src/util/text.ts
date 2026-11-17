// Text cut to a length on whole characters. A JavaScript string counts UTF-16 units, and a character outside the
// basic plane (any emoji) takes two of them: a cut between the two leaves half a character, a lone surrogate. A
// request that holds one is not well-formed Unicode, and Anthropic's API refuses the whole body (audit 2026-11-16,
// ATK-4: one tournament title stopped every plan). Every cut of text that reaches the model or Telegram goes
// through `cut`; the request itself is made well-formed once more where it leaves (Strategist.create).

const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu
/** Raised digits, signs and letters (¹ ² ³ ⁰ to ⁹, ⁺ ⁻ ⁼ ⁽ ⁾, ⁱ ⁿ), and their lowered kin (₀ to ₉, ₊ ₋ ₌ ₍ ₎, ₐ to ₜ). */
const RAISED = /^[\u00b2\u00b3\u00b9\u2070\u2071\u2074-\u207f]/
const LOWERED = /^[\u2080-\u208e\u2090-\u209c]/
/**
 * A raised run, a lowered run, or one other character NFKC folds to a digit (fractions, circled, bracketed and stopped
 * numbers, squared units and dates): every such character of Unicode but the digits of another width or font.
 */
const NUMBERS = /[\u00b2\u00b3\u00b9\u2070\u2071\u2074-\u207f]+|[\u2080-\u208e\u2090-\u209c]+|[\u00bc-\u00be\u2150-\u215f\u2189\u2460-\u249b\u24ea\u3251-\u325f\u32b1-\u32cb\u3358-\u3370\u3378-\u3379\u339f-\u33a6\u33a8\u33af\u33e0-\u33fe\u{1f100}-\u{1f10a}]/gu

/** A digit, of any width or font, first; a digit last, with a stop or comma after it at most. */
const DIGIT_FIRST = /^\p{Nd}/u
const DIGIT_LAST = /\p{Nd}[.,]?$/u
/** What `apart` writes for each single character it found (pieceOf). */
const PIECES = new Map<string, string | null>()

/**
 * Text as a reader sees it (audit 2026-11-16, R2T-3): well-formed, the compatibility forms folded (NFKC: fullwidth
 * letters, ligatures) and every character Unicode marks as invisible (Default_Ignorable_Code_Point: joiners, variation
 * selectors, fillers, tag characters, bidi controls) left out, so a word or a run of brackets cannot hide between them.
 * Letters, accents, emoji and every script stay as they are, and a number keeps its value (FC-3, `apart`). Rival and
 * server text goes through it before it is checked for the snapshot fence's markers, and is written as it returns.
 */
export function asSeen(s: string): string {
  return apart(s.toWellFormed().replace(INVISIBLE, '')).normalize('NFKC').replace(INVISIBLE, '')
}

/**
 * The characters NFKC folds into plain digits that would then join the digits around them, written apart first
 * (audit 2026-11-16, FC-3: FoxLeague's "3⁴ = 81 Commons" was written "34 = 81 Commons"): a raised run after `^`
 * (3^4, 10^-3), a lowered run after `_` (log_2), a fraction with a plain slash (½ as 1/2), and a fraction or another
 * folded number (① ⒈ ㉑) set off by a space from a number just before or after it (2 1/2, 1 2). Digits that are digits
 * in another width or font (３, 𝟑) fold as they are, and so does everything that folds to no digit.
 */
function apart(s: string): string {
  const parts: string[] = []
  let last = 0
  /** The end of what is written so far, and whether a digit after it would join it. */
  let tail = ''
  let open = false
  for (const m of s.matchAll(NUMBERS)) {
    const text = m[0]
    const piece = pieceOf(text)
    // Anything that folds to no digit is left for NFKC, which folds it the same way.
    if (piece === null) continue
    const gap = s.slice(last, m.index)
    if (gap) {
      parts.push(open && DIGIT_FIRST.test(gap) ? ` ${gap}` : gap)
      tail = gap.slice(-3)
    }
    if (/^[\d(]/.test(piece) && DIGIT_LAST.test(tail)) parts.push(' ')
    parts.push(piece)
    tail = piece
    open = /[\p{L}\p{N}.,]$/u.test(piece)
    last = m.index + text.length
  }
  if (!last) return s
  const rest = s.slice(last)
  parts.push(open && DIGIT_FIRST.test(rest) ? ` ${rest}` : rest)
  return parts.join('')
}

/** What `apart` writes for a run it found, or null to leave it to NFKC; kept for a single character (a few hundred at most). */
function pieceOf(text: string): string | null {
  const known = PIECES.get(text)
  if (known !== undefined) return known
  const folded = text.normalize('NFKC')
  const piece = RAISED.test(text) ? `^${folded}` : LOWERED.test(text) ? `_${folded}` : /\d/.test(folded) ? folded.replace(/\u2044/g, '/') : null
  if (text.length <= 2 && [...text].length === 1) PIECES.set(text, piece)
  return piece
}

/** `s` cut to at most `max` UTF-16 units, never between the two halves of a character; a lone half in `s` becomes U+FFFD. */
export function cut(s: string, max: number): string {
  const whole = s.toWellFormed()
  if (whole.length <= max) return whole
  const end = Math.max(0, Math.floor(max))
  // A high surrogate as the last unit kept is the first half of a character the cut would split: leave it out.
  const code = whole.charCodeAt(end - 1)
  return whole.slice(0, code >= 0xd800 && code <= 0xdbff ? end - 1 : end)
}
