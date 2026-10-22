import { describe, expect, it } from 'vitest'
import { degreeToMidi, degrees, double, half, isHit, join, notes, parseKey, pattern, quantizeMidi, reverse, shift, thin } from '../src/engine/patterns'

describe('text patterns', () => {
  it('parses hits, accents, soft hits, rests and rolls while ignoring spaces and bars', () => {
    const p = pattern('X... | o2')
    expect(p.steps).toHaveLength(6)
    expect(p.steps[0]).toEqual({ kind: 'hit', velocity: 1, roll: 1 })
    expect(p.steps[4]).toEqual({ kind: 'hit', velocity: 0.42, roll: 1 })
    expect(p.steps[5]).toEqual({ kind: 'hit', velocity: 0.7, roll: 2 })
    expect(isHit(p, 6)).toBe(true)
    expect(isHit(p, 3)).toBe(false)
  })
  it('supports arbitrary cycle lengths for polyrhythms', () => {
    const p = pattern('x..')
    expect(Array.from({ length: 8 }, (_, step) => isHit(p, step))).toEqual([true,false,false,true,false,false,true,false])
  })
  it('rotates, reverses, doubles, halves, thins and joins', () => {
    const p = pattern('x.o.')
    expect(shift(p,1).steps).toEqual([p.steps[3],p.steps[0],p.steps[1],p.steps[2]])
    expect(reverse(p).steps).toEqual([...p.steps].reverse())
    expect(double(p).steps).toHaveLength(8)
    expect(half(p).steps).toEqual([p.steps[0],p.steps[2]])
    expect(thin(p,1,()=>0).steps[0].kind).toBe('rest')
    expect(join(p,p).steps).toHaveLength(8)
  })
  it('reports invalid pattern and melody tokens clearly', () => {
    expect(() => pattern('x?')).toThrow(/Unknown pattern symbol/)
    expect(() => degrees('1 nope 3')).toThrow(/Invalid scale degree/)
    expect(() => notes('c4 hmm')).toThrow(/Invalid note name/)
  })
})

describe('global key and scale math', () => {
  it('maps scale degrees into the named tonic and scale', () => {
    const cMinor = parseKey('c minor')
    expect(degreeToMidi(1,0,cMinor)).toBe(60)
    expect(degreeToMidi(3,0,cMinor)).toBe(63)
    expect(degreeToMidi(5,0,cMinor)).toBe(67)
    expect(degreeToMidi(1,1,cMinor)).toBe(72)
  })
  it('supports enharmonic keys and named modes', () => {
    expect(parseKey('f# phrygian').pitch).toBe(6)
    expect(parseKey('db major').pitch).toBe(1)
    expect(parseKey('a harmonic minor').intervals).toEqual([0,2,3,5,7,8,11])
    expect(() => parseKey('h lydian')).toThrow(/Invalid key/)
    expect(() => parseKey('c blues')).toThrow(/Unknown scale/)
  })
  it('quantizes notes to the active global key', () => {
    const gMinor = parseKey('g minor')
    expect(quantizeMidi(61,gMinor)%12).toBe(0)
    expect([0,2,3,5,7,8,10]).toContain((quantizeMidi(67,gMinor)-gMinor.pitch+120)%12)
  })
})
