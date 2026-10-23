// scone — type code, press Play (or Ctrl+Enter), and hear the pattern.
tempo(84)

// These equations can be edited in the Sound Lab, or replace them with drawings.
const sampleSound = waveform("softWave", "sin(2*pi*f*t) + 0.12*sin(3*pi*f*t)")
const filterForm = filterform("lowPass200", "1/(1 + s*(1/(2*pi*200)))")
const envelopeForm = envelope("slowEnvelope", "(1-t)^2")

// Each text group is scaleDegree(hits, segments, offset).
// Here degree 1 has 3 hits across 8 steps, beginning at offset 0.
const samplePattern = pattern("1(3,8,0) 5(2,8,1) 3(2,8,3)")
  .scale("c minor")
  .filter(filterForm)

const Sample = connect(sampleSound, samplePattern)
  .envelope(envelopeForm)
  .gain(0.55)
  .delay(0.18)
const Sample2 = connect(sampleSound, samplePattern * 2) // twice the pattern speed
const Kick_beat = connect("kick", pattern("X..."))

// Optional: enable the computer keyboard and connected MIDI device as a piano.
const SampleLive = live(sampleSound, "c minor")
SampleLive.on()

// main accepts connected sounds and asks each one to play its pattern per step.
main(Sample, Sample2, Kick_beat)

// These visuals and meters are linked directly to their individual sounds.
screen.shapes("puck", Kick_beat)
screen.shapes("monkey", Sample)
screen.shapes("spheres", Sample2)
screen.scope(Sample)
screen.spectrum(Sample)
screen.pianoRoll(Kick_beat)
screen.oscillator(Sample)
