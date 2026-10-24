import { describe, expect, it } from 'vitest'
import { transformMainBlocks, transformPatternSpeeds } from '../src/engine/livecode'
import { fitWaveEquation } from '../src/engine/waveform-fit'
import { BUILTIN_SOUND_NAMES } from '../src/engine/audio'

describe('live-code syntax transforms', () => {
  it('runs statement blocks passed to main on each sequencer step', () => {
    const source = `main(
  Sample.play()
  Kick_beat.play()
  if (Sample.isPlaying() && Kick_beat.isPlaying()) {
    Sample2.pause(5)
  }
)`
    const output = transformMainBlocks(source)
    expect(output).toContain('main(() => {')
    const calls: string[] = []
    let step: (() => void) | undefined
    const Sample = { play: () => calls.push('sample'), isPlaying: () => true }
    const Kick_beat = { play: () => calls.push('kick'), isPlaying: () => true }
    const Sample2 = { pause: (seconds: number) => calls.push(`pause:${seconds}`) }
    new Function('main', 'Sample', 'Kick_beat', 'Sample2', output)((fn: () => void) => { step = fn }, Sample, Kick_beat, Sample2)
    step?.()
    expect(calls).toEqual(['sample', 'kick', 'pause:5'])
  })

  it('keeps connected-sound shorthand and rewrites arithmetic speed', () => {
    const shorthand = 'main(Sample, Kick_beat)'
    expect(transformMainBlocks(shorthand)).toBe(shorthand)
    const source = 'const melody = pattern("1(2,8,0)")\nconnect("lead", melody * 0.5)'
    expect(transformPatternSpeeds(source)).toContain('connect("lead", speedPattern(melody,0.5))')
  })
})

describe('drawn waveform regression', () => {
  it('returns an equation whose Pearson correlation is at least 0.95', () => {
    const values = Float32Array.from({ length: 128 }, (_, i) => {
      const t = i / 128
      return .72 * Math.sin(2 * Math.PI * t) + .2 * Math.sin(6 * Math.PI * t) + (i > 29 && i < 42 ? .12 : 0)
    })
    const fitted = fitWaveEquation(values)
    const evaluate = new Function('t', 'pi', 'sin', 'cos', `return ${fitted.equation}`) as (t: number, pi: number, sin: typeof Math.sin, cos: typeof Math.cos) => number
    const predicted = Array.from({ length: values.length }, (_, i) => evaluate(i / values.length, Math.PI, Math.sin, Math.cos))
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const predictedMean = predicted.reduce((sum, value) => sum + value, 0) / predicted.length
    let covariance = 0, actualVariance = 0, predictedVariance = 0
    for (let i = 0; i < values.length; i++) {
      covariance += (values[i] - mean) * (predicted[i] - predictedMean)
      actualVariance += (values[i] - mean) ** 2
      predictedVariance += (predicted[i] - predictedMean) ** 2
    }
    const actualR = covariance / Math.sqrt(actualVariance * predictedVariance)
    expect(fitted.r).toBeGreaterThanOrEqual(.95)
    expect(actualR).toBeGreaterThanOrEqual(.95)
  })

  it('handles a flat drawn waveform', () => {
    expect(fitWaveEquation(new Float32Array(128).fill(.25))).toEqual({ equation: '0.25', r: 1 })
  })
})

it('transforms the shipped starter into executable JavaScript with main-step statements', async () => {
  const { readFile } = await import('node:fs/promises')
  const { resolve } = await import('node:path')
  const source = await readFile(resolve(process.cwd(), 'examples/scone-starter.js'), 'utf8')
  const readme = await readFile(resolve(process.cwd(), 'README.md'), 'utf8')
  const monkey = await readFile(resolve(process.cwd(), 'public/wooden_monkey.png'))
  const readmeStarter = readme.match(/## Starter song[\s\S]*?```js\n([\s\S]*?)```/)?.[1]
  const transformed = transformMainBlocks(transformPatternSpeeds(source))
  expect(source).not.toMatch(/^\s*const\s+[A-Z]/m)
  expect(source).not.toMatch(/screen\.spectrum|SampleLive|\blive\s*\(/i)
  expect(source).toContain('screen.shapes("miffy", sample)')
  expect(readmeStarter?.trim()).toBe(source.trim())
  expect(monkey.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  expect(monkey[25]).toBe(6)
  expect(() => new Function('tempo', 'waveform', 'filterform', 'envelope', 'pattern', 'connect', 'speedPattern', 'main', 'screen', transformed)).not.toThrow()
})

it('exposes only the requested drum and synth voices', () => {
  expect(BUILTIN_SOUND_NAMES).toEqual(expect.arrayContaining([
    'kick', 'bd', '808', 'hat', 'hihat', 'openhat', 'oh', 'snare',
    'acid', 'bells', 'choir_aahs', 'seashore', 'crickets',
    'triangle', 'saw', 'sine', 'supersaw', 'pulse',
  ]))
  expect(BUILTIN_SOUND_NAMES).not.toContain('clap')
  expect(BUILTIN_SOUND_NAMES).not.toContain('pluck')
  expect(BUILTIN_SOUND_NAMES).not.toContain('pad')
  expect(BUILTIN_SOUND_NAMES).not.toContain('lead')
})
