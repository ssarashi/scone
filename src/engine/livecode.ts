import type { Pattern } from './patterns'

/** Rewrites pattern arithmetic into an explicit speed wrapper for JavaScript. */
export function transformPatternSpeeds(source: string): string {
  const names = [...source.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*pattern\s*\(/g)].map(match => match[1])
  let output = source
  for (const name of names) output = output.replace(new RegExp(`\\b${name}\\s*\\*\\s*(\\d+(?:\\.\\d+)?)\\b`, 'g'), `speedPattern(${name},$1)`)
  return output
}

/** Turns `main( statements )` into a per-step callback while leaving `main(Sample, Kick)` intact. */
export function transformMainBlocks(source: string): string {
  const replacements: Array<{ from: number; to: number; value: string }> = []
  let i = 0
  while (i < source.length) {
    const c = source[i]
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      i++
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue }
        if (source[i++] === quote) break
      }
      continue
    }
    if (c === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i + 2); if (i < 0) break; continue }
    if (c === '/' && source[i + 1] === '*') { const end = source.indexOf('*/', i + 2); i = end < 0 ? source.length : end + 2; continue }
    if (!/[A-Za-z_$]/.test(c)) { i++; continue }
    const start = i++
    while (i < source.length && /[\w$]/.test(source[i])) i++
    if (source.slice(start, i) !== 'main' || /[\w$.]/.test(source[start - 1] || '')) continue
    let open = i
    while (/\s/.test(source[open] || '')) open++
    if (source[open] !== '(') continue

    let depth = 1, j = open + 1, quote = ''
    while (j < source.length && depth) {
      const ch = source[j]
      if (quote) {
        if (ch === '\\') { j += 2; continue }
        if (ch === quote) quote = ''
        j++
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; j++; continue }
      if (ch === '/' && source[j + 1] === '/') { j = source.indexOf('\n', j + 2); if (j < 0) break; continue }
      if (ch === '/' && source[j + 1] === '*') { const end = source.indexOf('*/', j + 2); j = end < 0 ? source.length : end + 2; continue }
      if (ch === '(') depth++
      else if (ch === ')') depth--
      j++
    }
    if (depth) continue
    const body = source.slice(open + 1, j - 1)
    const connectedNames = /^\s*[A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*\s*$/
    if (!connectedNames.test(body) && !body.includes('=>')) {
      const statements = body.replace(/\bIf\s*\(/g, 'if (')
      replacements.push({ from: start, to: j, value: `main(() => {${statements}\n})` })
    }
    i = j
  }
  for (const replacement of replacements.reverse()) source = source.slice(0, replacement.from) + replacement.value + source.slice(replacement.to)
  return source
}

/** Builds a bounded speed wrapper consumed by `connect(sound, pattern * rate)`. */
export function speedPattern(pattern: Pattern, multiplier: number): { pattern: Pattern; speed: number } {
  if (!Number.isFinite(multiplier) || multiplier < .125 || multiplier > 8) {
    throw new Error('Pattern speed must be between 0.125 and 8; use *2 to speed up or *0.5 to slow down.')
  }
  return { pattern, speed: multiplier }
}
