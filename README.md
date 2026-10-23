# scone

scone is a browser based live coding sound lab. Type JavaScript in the editor, press **Play**, and make slower synth patterns from drawn waveforms, equations, and Euclidean rhythms. The canvas fills the window behind the code on a minimal `#FAFAFA` background.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL Vite prints and press **Play** once to enable browser audio. **Ctrl+Enter** toggles playback. Code edits are applied at the next bar; an error keeps the last working program running.

## Waveform, filter, and envelope lab

The editor loads this working starter by default. You can restore it any time with **Load sample**. The same sample is in [`examples/scone-starter.js`](examples/scone-starter.js).

```js
// Start the song with Play or Ctrl+Enter.
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
const Kick_beat = connect("kick", pattern("(4,16,0)")).gain(0.9)
const fastMelody = connect(sampleSound, melody * 2).scale("c minor").gain(0.2)

const SampleLive = live(sampleSound, "c minor")
SampleLive.on()

main(Sample, Kick_beat, fastMelody)
screen.scope(Sample)
screen.spectrum(Sample)
screen.pianoRoll(Kick_beat)
screen.shapes("puck", Kick_beat)
screen.shapes("spheres", Sample)
screen.oscillator(Sample)
```

`1(3,8,0)` means play scale degree 1 for three hits across eight segments, with offset zero. For an unpitched sound such as a kick, write `(4,16,0)` for four hits across sixteen segments. Write each group inside a quoted string because the editor runs JavaScript. The compact `X...` rhythm form is not supported.

The Sound Lab has **Wave**, **Filter**, and **Envelope** axes, with **Draw** and **Equation** modes. Press and hold the primary mouse button on the graph to draw; moving the pointer while released does not change the data. The pad interpolates between pointer samples and renders the curve with quadratic smoothing. Clicking a `waveform`, `filterform`, or `envelope` declaration—or its variable name—opens the lab for that definition. Clicking the graph switches to Draw mode, so you can start drawing immediately. Click **Add to code** to insert the current drawing or equation as a named definition.

- **Waveform:** `waveform(name, equationOrSamples)` defines one repeating wavetable. `t` runs from 0 to 1 and `f` follows the played pitch. Calculator functions include `sin`, `sqrt`, `abs`, and `sgn`; `^` means exponentiation.
- **Filter:** `filterform(name, equationOrSamples)` defines a frequency response. The graph spans 20 Hz to 20 kHz on a logarithmic axis and displays decibels. For example, `1/(1 + s*(1/(2*pi*200)))` describes a low pass with a 200 Hz cutoff.
- **Envelope:** `envelope(name, equationOrSamples)` defines amplitude over normalized time `t` from 0 to 1.
- **Upload:** select **Upload sound** in the lab to add an audio snippet to the browser sound bank. Connect the uploaded sound to a pattern to play it.

## Language reference

| Function | Description |
| --- | --- |
| `main(sound1, sound2, ...)` | Runs each connected sound on every internal sequencer step. Pass connected sounds directly; no callback is used. |
| `pattern(text)` | Parses pitched groups `degree(hits, segments, offset)` or unpitched groups `(hits, segments, offset)`. |
| `scale(name)` | Sets the current musical key and returns its scale pitches. Available scales: minor, major, phrygian, harmonic minor, dorian, pentatonic, chromatic. |
| `connect(sound, pattern)` | Connects a built-in, uploaded, or waveform sound to a pattern. Returns the chain methods below. |
| `waveform(name, equationOrSamples)` | Defines a wavetable from an equation or drawn samples. |
| `filterform(name, equationOrSamples)` | Defines a filter response from an equation or drawn samples. |
| `envelope(name, equationOrSamples)` | Defines an amplitude envelope from an equation or drawn samples. |
| `live(sound, scale).on()` | Enables the computer keyboard and MIDI as a scale-locked piano for a sound. |
| `tempo(bpm)` | Sets tempo from 40 to 240 BPM. |
| `irand(max)` | Returns an integer from 0 through `max - 1`. |
| `screen.scope(sound)` | Shows the selected sound's waveform scope. |
| `screen.spectrum(sound)` | Shows the selected sound's frequency spectrum. |
| `screen.pianoRoll(sound)` | Shows the selected sound's coded rhythm. |
| `screen.shapes(kind, sound)` | Bounces the red puck, wooden monkey, or blue sphere on this sound's hits. Kinds: `"puck"`, `"monkey"`, `"spheres"`. |
| `screen.oscillator(sound)` | Adds a grayscale oscillator visual driven by this sound. |

### Methods returned by `connect`

| Method | Description |
| --- | --- |
| `.play()` | Plays the connected sound according to its pattern. It is only available on the result of `connect()`. |
| `.pause(seconds)` | Temporarily pauses for the given number of seconds. With no duration, pauses until resumed. |
| `.silence()` | Pauses indefinitely until `.resume()` is called. |
| `.resume()` | Resumes a sound paused with `.pause()` or `.silence()`. |
| `.isPlaying()` | Returns true on a sequencer step when this sound actually triggers. |
| `.scale(name)` | Sets the musical key used to turn this pattern's scale degrees into pitches. |
| `.gain(value)` | Sets the sound level from 0 to 1. |
| `.filter(form)` | Applies a `filterform(...)` response. |
| `.envelope(form)` | Applies an `envelope(...)` amplitude shape. |
| `.distort(equation)` | Applies a waveshaper equation evaluated over `x` from -1 to 1; for example, `"1.5*x - 0.5*x^3"`. |
| `.delay(seconds)` | Adds a feedback delay with the requested delay time. |

Pattern multiplication expresses speed: `melody * 2` plays twice as fast, and `melody * 0.5` plays at half speed. Connect the result as usual: `connect(sampleSound, melody * 0.5)`.
