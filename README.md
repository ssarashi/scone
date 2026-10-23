# scone

scone is a browser based live coding sound lab. Type JavaScript in the full-width editor, press **Play**, and make airy synth music from waveforms, equations, and Euclidean patterns. The visuals fill the window behind the code on a minimal `#FAFAFA` background.

## Run locally

```sh
npm install
npm run dev
```

Open the local Vite URL, then press **Play** or **Ctrl+Enter** to start or pause. **Ctrl+Z**, **Ctrl+C**, and **Ctrl+V** undo, copy, and paste in the editor. Code edits apply at the next bar; a code error leaves the last working program running.

## Waveform, filter, and envelope lab

The editor loads this working starter by default. **Load sample** restores it. The source is [`examples/scone-starter.js`](examples/scone-starter.js).

```js
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
const Sample2 = connect(sampleSound, melody * 0.5).scale("c minor")
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
```

`main(...)` contains ordinary JavaScript statements that run once per sequencer step; no arrow callback is needed. Use lowercase JavaScript `if`. Each pitched group is `degree(hits, segments, offset)`, such as `1(2,8,0)`. An unpitched drum group omits the degree, for example `(3,16,0)`. Keep the groups inside a quoted string because `pattern()` parses this text. Compact `X...` symbols are not part of the syntax.

In the Sound Lab, select **Wave**, **Filter**, or **Envelope** and draw by pressing and holding the primary mouse button on the graph. Pointer movement while released does not alter the curve. The pad fills gaps between pointer samples and uses quadratic curve smoothing. Clicking a definition or its variable opens that sound in the lab. Clicking the graph switches to Draw mode.

When you draw over a waveform equation, scone fits the resulting cycle to a Fourier series equation and writes that equation back into the selected `waveform(...)` definition. The regression increases the number of harmonics until the Pearson correlation coefficient **r is at least 0.95**; the measured value is shown in the lab. Filter and envelope drawings are written back as sample arrays. Equation edits are written back when you press Enter or leave the field.

- **Waveform:** `waveform(name, equationOrSamples)` defines one repeating wavetable. `t` spans 0 to 1 and `f` tracks the note pitch. Calculator functions include `sin`, `sqrt`, `abs`, and `sgn`; `^` means exponentiation.
- **Filter:** `filterform(name, equationOrSamples)` defines response over frequency. The graph uses a log scale from 20 Hz to 20 kHz and displays decibels. `1/(1 + s*(1/(2*pi*200)))` describes a low pass at 200 Hz.
- **Envelope:** `envelope(name, equationOrSamples)` defines amplitude over normalized time `t`.
- **Upload:** use **Upload sound** to save audio snippets in the browser sound bank, then use the sample name with `connect(sampleName, pattern(...))`.

## Language reference

| Function | Description |
| --- | --- |
| `main(statements...)` | Runs the statements inside its parentheses on each internal sequencer step. It accepts direct `.play()` calls and ordinary `if` blocks. |
| `pattern(text)` | Parses pitched groups `degree(hits, segments, offset)` and unpitched groups `(hits, segments, offset)`. |
| `scale(name)` | Sets the current musical key and returns its pitches. Scales: minor, major, phrygian, harmonic minor, dorian, pentatonic, chromatic. |
| `connect(sound, pattern)` | Connects a built-in, uploaded, or waveform sound to a pattern. Returns the methods below. |
| `waveform(name, equationOrSamples)` | Defines a wavetable from an equation or drawn samples. |
| `filterform(name, equationOrSamples)` | Defines a filter response from an equation or drawn samples. |
| `envelope(name, equationOrSamples)` | Defines an amplitude envelope from an equation or drawn samples. |
| `live(sound, scale).on()` | Enables the keyboard and MIDI as a scale-locked piano for this sound. |
| `tempo(bpm)` | Sets tempo from 40 to 240 BPM. |
| `irand(max)` | Returns an integer from 0 through `max - 1`. |
| `screen.scope(sound)` | Shows the selected sound's waveform. |
| `screen.spectrum(sound)` | Shows its frequency spectrum. |
| `screen.pianoRoll(sound)` | Shows its coded rhythm. |
| `screen.shapes(kind, sound)` | Bounces the red hockey puck, wooden monkey, or blue sphere on sound hits. Kinds: `"puck"`, `"monkey"`, `"spheres"`. |

### Methods returned by `connect`

| Method | Description |
| --- | --- |
| `.play()` | Runs this connected sound's pattern on the current step. |
| `.pause(seconds)` | Pauses for the given number of seconds; without a duration, pauses until resumed. |
| `.silence()` | Pauses until `.resume()` is called. |
| `.resume()` | Resumes a paused sound. |
| `.isPlaying()` | Returns true on a step when this pattern triggers. |
| `.scale(name)` | Sets the key used to turn pattern degrees into pitches. |
| `.gain(value)` | Sets sound level from 0 to 1. |
| `.filter(form)` | Applies a `filterform(...)` response. |
| `.envelope(form)` | Applies an `envelope(...)` shape. |
| `.distort(equation)` | Applies a waveshaper equation over `x` from -1 to 1. |
| `.delay(seconds)` | Adds a feedback delay. |

Pattern multiplication is the speed control: `melody * 2` plays twice as fast and `melody * 0.5` plays at half speed.
