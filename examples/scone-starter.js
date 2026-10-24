// An airy, slow synth loop. Press Ctrl+Enter to apply; Play and Pause control transport.
tempo(82)
const sampleSound = waveform("softWave", "0.82*sin(2*pi*f*t) + 0.12*sin(4*pi*f*t)")
const filterForm = filterform("airFilter", "1/(1 + s*(1/(2*pi*1400)))")
const envelopeForm = envelope("longFade", "(1-t)^1.6")

const melodyOffset = irand(8)
const melody = pattern(`1(2,8,0) 3(1,8,3) 5(2,8,5) 7(1,8,${melodyOffset})`)
const sample = connect(sampleSound, melody)
  .scale("c minor")
  .filter(filterForm)
  .envelope(envelopeForm)
  .gain(0.38)
  .delay(0.34)
const sampleSlow = connect(sampleSound, melody * 0.5).scale("c minor").gain(0.18)
const kickBeat = connect("kick", pattern("(3,16,0)")).gain(0.68)
const hatBeat = connect("hat", pattern("(7,16,2)")).gain(0.2)

main(
  sample.play()
  kickBeat.play()
  hatBeat.play()

  if (sample.isPlaying() && kickBeat.isPlaying()) {
    sampleSlow.pause(5)
  }
  sampleSlow.play()

  if (sample.isPlaying()) {
    screen.shapes("monkey", sample)
    screen.shapes("duck", sample)
    screen.shapes("miffy", sample)
    screen.scope(sample)
  }
)
