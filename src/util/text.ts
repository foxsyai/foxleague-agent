// Text cut to a length on whole characters. A JavaScript string counts UTF-16 units, and a character outside the
// basic plane (any emoji) takes two of them: a cut between the two leaves half a character, a lone surrogate. A
// request that holds one is not well-formed Unicode, and Anthropic's API refuses the whole body (audit 2026-11-16,
// ATK-4: one tournament title stopped every plan). Every cut of text that reaches the model or Telegram goes
// through `cut`; the request itself is made well-formed once more where it leaves (Strategist.create).

/** `s` cut to at most `max` UTF-16 units, never between the two halves of a character; a lone half in `s` becomes U+FFFD. */
export function cut(s: string, max: number): string {
  const whole = s.toWellFormed()
  if (whole.length <= max) return whole
  const end = Math.max(0, Math.floor(max))
  // A high surrogate as the last unit kept is the first half of a character the cut would split: leave it out.
  const code = whole.charCodeAt(end - 1)
  return whole.slice(0, code >= 0xd800 && code <= 0xdbff ? end - 1 : end)
}
