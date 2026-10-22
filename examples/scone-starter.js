// scone — slow synth, Euclidean rhythm, live instrument, and reactive visuals
// Press Play (or Ctrl+Enter) to start the piece.
tempo(84)

// Drawn shapes or equations from the Sound Lab can be named and used here.
const sampleSound = waveform("softWave", "sin(2*pi*f*t) + 0.12*sin(3*pi*f*t)")
const filterForm = filterform("lowPass200", "1/(1 + s*(1/(2*pi*200)))")
const envelopeForm = envelope("slowEnvelope", "(1-t)^2")

// Each row is [scale degree, hits, segments, offset].
const samplePattern = pattern([
  [1, 3, 8, 0],
  [5, 2, 8, 1],
  [3, 2, 8, 3],
]).scale("c minor").filter(filterForm)

const Sample = connect(sampleSound, samplePattern)
  .envelope(envelopeForm)
  .gain(0.55)
const Sample2 = connect(sampleSound, samplePattern * 2) // 2x pattern speed
const Kick_beat = connect("kick", pattern("X..."))

// The keyboard and MIDI play this sound in C minor.
const SampleLive = live(sampleSound, "c minor")
SampleLive.on()

main(() => {
  Sample.play()
  Sample2.play()
  Kick_beat.play()

  // This is true only on a step where both connected patterns hit.
  if (Sample.isPlaying() && Kick_beat.isPlaying()) {
    Sample2.pause(5)
  }
})

// Floating toy objects bounce when their linked sound plays.
screen.shapes("puck", Kick_beat)
screen.shapes("monkey", Sample)
screen.shapes("spheres", Sample2)

// Per-sound displays appear only for the sounds named here.
screen.scope(Sample)
screen.spectrum(Sample)
screen.pianoRoll(Kick_beat)

// Soft gray aurora responds to the mix; the oscillator is also audio-reactive.
const all = listen("all")
noise(() => 1 + all.fft[1] / 100, 0.012)
  .color(0.84, 0.85, 0.84)
  .modulate(noise(() => 2 + all.fft[0] / 28), 0.12)
  .out()
screen.oscillator(() => 18 + all.fft[2] / 12, 0.018, 0.25)
