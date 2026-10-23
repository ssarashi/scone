// An airy, slow synth loop. Press Play or Ctrl+Enter.
tempo(82)

const sampleSound = waveform("softWave", "0.82*sin(2*pi*f*t) + 0.12*sin(4*pi*f*t)")
const filterForm = filterform("airFilter", "1/(1 + s*(1/(2*pi*1400)))")
const envelopeForm = envelope("longFade", "(1-t)^1.6")

const melody = pattern("1(2,8,0) 3(1,8,3) 5(2,8,5) 7(1,8,2)")
const Sample = connect(sampleSound, melody)
  .scale("c minor")
  .filter(filterForm)
  .envelope(envelopeForm)
  .gain(0.38)
  .delay(0.34)

const Sample2 = connect(sampleSound, melody * 0.5)
  .scale("c minor")
const Kick_beat = connect("kick", pattern("(3,16,0)")).gain(0.68)
const Hat_beat = connect("hat", pattern("(7,16,2)")).gain(0.2)
const SampleLive = live(sampleSound, "c minor")

main(
  Sample.play()
  Kick_beat.play()
  Hat_beat.play()
  SampleLive.on()

  if (Sample.isPlaying() && Kick_beat.isPlaying()) {
    Sample2.pause(5)
  }
  Sample2.play()

  if (Sample.isPlaying()) {
    screen.shapes("spheres", Sample)
    screen.scope(Sample)
    screen.spectrum(Sample)
  }
)
