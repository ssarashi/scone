/** Fit sampled values to the shortest Fourier series reaching Pearson r >= 0.95. */
export function fitPeriodicEquation(values: Float32Array, coordinate = 't', multiplier = 1): { equation: string; r: number } {
  const n = values.length
  if (n < 4) throw new Error('A drawn waveform needs at least four samples before it can be fitted.')
  const mean = values.reduce((sum, value) => sum + value, 0) / n
  const centered = Array.from(values, value => value - mean)
  const total = centered.reduce((sum, value) => sum + value * value, 0)
  if (total < 1e-12) return { equation: Number((mean * multiplier).toPrecision(8)).toString(), r: 1 }

  const prediction = Array(n).fill(mean) as number[]
  const roundedMean = Number((mean * multiplier).toPrecision(8))
  const terms = [roundedMean === 0 ? '' : roundedMean.toString()]
  const correlation = (): number => {
    const average = prediction.reduce((sum, value) => sum + value, 0) / n
    let covariance = 0, sourceVariance = 0, predictedVariance = 0
    for (let i = 0; i < n; i++) {
      const a = centered[i], b = prediction[i] - average
      covariance += a * b
      sourceVariance += a * a
      predictedVariance += b * b
    }
    return predictedVariance < 1e-12 ? 0 : covariance / Math.sqrt(sourceVariance * predictedVariance)
  }

  let r = 0
  for (let harmonic = 1; harmonic <= Math.floor(n / 2); harmonic++) {
    let cosine = 0, sine = 0
    for (let i = 0; i < n; i++) {
      const angle = 2 * Math.PI * harmonic * i / n
      cosine += values[i] * Math.cos(angle)
      sine += values[i] * Math.sin(angle)
    }
    const isNyquist = harmonic === n / 2
    const scale = isNyquist ? 1 / n : 2 / n
    const a = Number((cosine * scale * multiplier).toPrecision(8))
    const b = isNyquist ? 0 : Number((sine * scale * multiplier).toPrecision(8))
    for (let i = 0; i < n; i++) {
      const angle = 2 * Math.PI * harmonic * i / n
      prediction[i] += a * Math.cos(angle) + b * Math.sin(angle)
    }
    if (Math.abs(a) > 1e-8) terms.push(`${a}*cos(2*pi*${harmonic}*${coordinate})`)
    if (Math.abs(b) > 1e-8) terms.push(`${b}*sin(2*pi*${harmonic}*${coordinate})`)
    r = correlation()
    if (r >= .95) {
      if (multiplier !== 1 && terms.length === 0) terms.push(`0*log10(f/20)`)
      return { equation: terms.filter(Boolean).join(' + ').replace(/\+ -/g, '- '), r }
    }
  }
  throw new Error(`Waveform regression reached r = ${r.toFixed(4)}, below the required 0.95.`)
}

/** Fit a drawn wavetable to an equation in normalized cycle time. */
export function fitWaveEquation(values: Float32Array): { equation: string; r: number } {
  return fitPeriodicEquation(values)
}

/** Fit a drawn filter in dB over normalized log-frequency (20 Hz to 20 kHz). */
export function fitFilterEquation(values: Float32Array): { equation: string; r: number } {
  const result = fitPeriodicEquation(values, 'log10(f/20)/3', 60)
  return { ...result, equation: result.equation.includes('log10') ? result.equation : `${result.equation || '0'} + 0*log10(f/20)` }
}

/** Fit a drawn amplitude envelope to an equation over normalized time. */
export function fitEnvelopeEquation(values: Float32Array): { equation: string; r: number } {
  return fitPeriodicEquation(values)
}
