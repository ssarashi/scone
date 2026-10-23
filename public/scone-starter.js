// scone starter: press Play (or Ctrl+Enter) to start the song.
tempo(84)

const sampleSound = waveform("softWave", "sin(2*pi*f*t) + 0.12*sin(3*pi*f*t)")
const filterForm = filterform("lowPass200", "1/(1 + s*(1/(2*pi*200)))")
const envelopeForm = envelope("slowEnvelope", "(1-t)^2")

// Melody groups use degree(hits, segments, offset).
const melody = pattern("1(3,8,0) 5(2,8,1) 3(2,8,3)")
const Sample = connect(sampleSound, melody)
  .scale("c minor")
  .filter(filterForm)
  .envelope(envelopeForm)
  .gain(0.55)
  .delay(0.18)

// Drum groups omit the degree: (hits, segments, offset).
const kickPattern = pattern("(4,16,0)")
const Kick_beat = connect("kick", kickPattern).gain(0.9)

// Pattern multiplication is computation: *2 is twice as fast; *0.5 is half speed.
const fastMelody = connect(sampleSound, melody * 2).scale("c minor").gain(0.2)

// Optional scale-locked keyboard and MIDI input.
const SampleLive = live(sampleSound, "c minor")
SampleLive.on()

// Connected sounds play their pattern on each sequencer step.
main(Sample, Kick_beat, fastMelody)

screen.scope(Sample)
screen.spectrum(Sample)
screen.pianoRoll(Kick_beat)
screen.shapes("puck", Kick_beat)
screen.shapes("spheres", Sample)
screen.oscillator(Sample)
