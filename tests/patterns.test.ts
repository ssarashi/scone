import { describe, expect, it } from 'vitest'
import { degreeToMidi, degrees, double, half, isHit, join, notes, parseKey, pattern, quantizeMidi, reverse, shift, thin } from '../src/engine/patterns'

describe('Euclidean pattern text', () => {
  it('parses scale-degree groups and unpitched drum groups', () => {
    const p = pattern('1(3,8,0) (4,16,0)')
    expect(p.steps).toHaveLength(24)
    expect(p.steps.slice(0,8).map(e => e.kind === 'degree' ? e.degree : null)).toEqual([1,null,null,1,null,1,null,null])
    expect(p.steps.slice(8).filter(e => e.kind === 'hit')).toHaveLength(4)
    expect(p.steps.slice(8).some(e => e.kind === 'degree')).toBe(false)
  })
  it('uses offset to rotate the Euclidean hit positions', () => {
    const p = pattern('1(3,8,1)')
    expect(p.steps.map((e,i) => e.kind === 'degree' ? i : null).filter(i => i !== null)).toEqual([1,4,6])
  })
  it('rejects compact symbols and invalid Euclidean values with clear errors', () => {
    expect(() => pattern('X...')).toThrow(/Euclidean groups/)
    expect(() => pattern('0(2,8,0)')).toThrow(/scale degree must be a positive integer/)
    expect(() => pattern('1(9,8,0)')).toThrow(/hits must be an integer/)
    expect(() => pattern('(2,0,0)')).toThrow(/segments must be an integer/)
    expect(() => degrees('1 nope 3')).toThrow(/Invalid scale degree/)
    expect(() => notes('c4 hmm')).toThrow(/Invalid note name/)
  })
  it('rotates, reverses, doubles, halves, thins and joins pattern data', () => {
    const p = pattern('1(2,4,0)')
    expect(shift(p,1).steps).toEqual([p.steps[3],p.steps[0],p.steps[1],p.steps[2]])
    expect(reverse(p).steps).toEqual([...p.steps].reverse())
    expect(double(p).steps).toHaveLength(8)
    expect(half(p).steps).toEqual([p.steps[0],p.steps[2]])
    expect(thin(p,1,()=>0).steps[0].kind).toBe('rest')
    expect(join(p,p).steps).toHaveLength(8)
    expect(isHit(p,0)).toBe(true)
    expect(isHit(p,1)).toBe(false)
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
