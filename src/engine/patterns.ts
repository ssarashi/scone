export type PatternEvent =
  | { kind: 'rest' }
  | { kind: 'hit'; velocity: number; roll: number }
  | { kind: 'degree'; degree: number; octave: number; velocity: number }
  | { kind: 'note'; midi: number; velocity: number }

export type Pattern = { readonly kind: 'pattern'; readonly steps: readonly PatternEvent[] }

const rest: PatternEvent = Object.freeze({ kind: 'rest' })
const hitEvent = (velocity = 0.78, roll = 1): PatternEvent => ({ kind: 'hit', velocity, roll })
const make = (steps: PatternEvent[]): Pattern => Object.freeze({ kind: 'pattern', steps: Object.freeze(steps) })

/** Convert x/X/o/digit rhythm glyphs into immutable sequencer steps. */
export function pattern(source: string): Pattern {
  const groups = [...source.matchAll(/(\d+)\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(-?\d+)\s*\)/g)]
  if (groups.length && source.replace(/\s+/g, '').replace(/\d+\(\d+,\d+,-?\d+\)/g, '') === '') {
    return make(groups.flatMap(([, degree, beats, segments, offset]) => euclideanSteps(Number(degree), Number(beats), Number(segments), Number(offset))))
  }
  const glyphs = source.replace(/\s+/g, '').replace(/[|]/g, '').toLowerCase()
  const steps: PatternEvent[] = []
  for (let i = 0; i < glyphs.length; i++) {
    const original = source.replace(/\s+/g, '').replace(/[|]/g, '')[i]
    const glyph = glyphs[i]
    if (glyph === '.' || glyph === '-') steps.push(rest)
    else if (glyph === 'x') steps.push(hitEvent(original === 'X' ? 1 : 0.78))
    else if (glyph === 'o') steps.push(hitEvent(0.42))
    else if (/^[2-9]$/.test(glyph)) steps.push(hitEvent(0.7, Number(glyph)))
    else throw new Error(`Unknown pattern symbol "${original}" at step ${i + 1}.`)
  }
  if (!steps.length) throw new Error('A pattern needs at least one step.')
  return make(steps)
}

/** Make one Euclidean scale-degree rhythm; offset rotates the distributed hits. */
export function euclidean(degree:number,beats:number,segments:number,offset=0):Pattern {
  return make(euclideanSteps(degree,beats,segments,offset))
}
function euclideanSteps(degree:number,beats:number,segments:number,offset:number):PatternEvent[]{
  const n=Math.max(1,Math.min(256,Math.trunc(segments))),k=Math.max(0,Math.min(n,Math.trunc(beats))),d=Math.max(1,Math.trunc(degree)),o=((Math.trunc(offset)%n)+n)%n
  return Array.from({length:n},(_,step)=>((Math.floor(((step+o+1)*k)/n)>Math.floor(((step+o)*k)/n))?{kind:'degree' as const,degree:d,octave:0,velocity:.78}:rest))
}

/** Build a scale-degree melody. Dots/rests are silent; degrees start at 1. */
export function degrees(source: string, options: { octave?: number } = {}): Pattern {
  const octave = Number.isFinite(options.octave) ? Number(options.octave) : 0
  const tokens = source.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) throw new Error('A degree pattern needs at least one step.')
  return make(tokens.map((token) => {
    if (token === '.' || token === '-' || token === '_') return rest
    const match = token.match(/^(\d+)(!)?$/)
    if (!match) throw new Error(`Invalid scale degree "${token}".`)
    return { kind: 'degree', degree: Number(match[1]), octave, velocity: match[2] ? 1 : 0.76 }
  }))
}

const pitchClass: Record<string, number> = { c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11 }
/** Parse note-name patterns such as "c4 . eb4 g3" into MIDI events. */
export function notes(source: string): Pattern {
  const tokens = source.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) throw new Error('A note pattern needs at least one step.')
  return make(tokens.map((token) => {
    if (token === '.' || token === '-' || token === '_') return rest
    const m = token.toLowerCase().match(/^([a-g](?:#|b)?)(-?\d+)$/)
    if (!m || pitchClass[m[1]] === undefined) throw new Error(`Invalid note name "${token}". Try c4, eb3, or f#5.`)
    const midi = (Number(m[2]) + 1) * 12 + pitchClass[m[1]]
    return { kind: 'note', midi, velocity: 0.76 }
  }))
}

export function isHit(p: Pattern, step: number): boolean { return p.steps[((step % p.steps.length) + p.steps.length) % p.steps.length]?.kind !== 'rest' }
export function reverse(p: Pattern): Pattern { return make([...p.steps].reverse()) }
export function shift(p: Pattern, amount: number): Pattern {
  const n = ((Math.trunc(amount) % p.steps.length) + p.steps.length) % p.steps.length
  return make([...p.steps.slice(p.steps.length - n), ...p.steps.slice(0, p.steps.length - n)])
}
export function thin(p: Pattern, amount: number, random = Math.random): Pattern {
  const probability = Math.max(0, Math.min(1, amount))
  return make(p.steps.map((step) => step.kind !== 'rest' && random() < probability ? rest : step))
}
export function double(p: Pattern): Pattern { return make([...p.steps, ...p.steps]) }
export function half(p: Pattern): Pattern {
  const compact = p.steps.filter((_, i) => i % 2 === 0)
  return make(compact.length ? compact : [rest])
}
export function join(...patterns: Pattern[]): Pattern {
  if (!patterns.length) throw new Error('join needs at least one pattern.')
  return make(patterns.flatMap((p) => [...p.steps]))
}

export const SCALES: Record<string, readonly number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10], 'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10], pentatonic: [0, 3, 5, 7, 10], chromatic: [...Array(12).keys()],
}
export type MusicKey = { tonic: string; pitch: number; scale: string; intervals: readonly number[] }
/** Parse a global tonic and scale, for example "f# phrygian". */
export function parseKey(source: string): MusicKey {
  const m = source.trim().toLowerCase().match(/^([a-g](?:#|b)?)(?:\s+(.+))?$/)
  if (!m || pitchClass[m[1]] === undefined) throw new Error(`Invalid key "${source}". Use a key such as "c minor" or "f# phrygian".`)
  const tonic = m[1], scale = m[2] || 'minor', intervals = SCALES[scale]
  if (!intervals) throw new Error(`Unknown scale "${scale}". Available scales: ${Object.keys(SCALES).join(', ')}.`)
  return { tonic, pitch: pitchClass[tonic], scale, intervals }
}
/** Resolve a one-based degree to a MIDI note in the current global key. */
export function degreeToMidi(degree: number, octave: number, key: MusicKey): number {
  const index = Math.max(0, Math.trunc(degree) - 1)
  const wrapped = index % key.intervals.length
  const scaleOctave = Math.floor(index / key.intervals.length)
  return 60 + key.pitch + key.intervals[wrapped] + 12 * (scaleOctave + octave)
}
/** Quantize an arbitrary MIDI note to the closest note in the active key. */
export function quantizeMidi(note: number, key: MusicKey): number {
  let best = Math.round(note), distance = Infinity
  for (let candidate = Math.floor(note) - 12; candidate <= Math.ceil(note) + 12; candidate++) {
    const pitch = ((candidate - key.pitch) % 12 + 12) % 12
    if (key.intervals.includes(pitch) && Math.abs(candidate - note) < distance) { best = candidate; distance = Math.abs(candidate - note) }
  }
  return best
}
