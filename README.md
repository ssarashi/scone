# scone

scone is a browser based live coding sound lab. Type JavaScript in the editor, press **Play**, and build slower synth patterns with wavetable equations, drawn waveforms, and Euclidean rhythms. The canvas visual sits behind the code on a minimal `#FAFAFA` background.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL Vite prints. Press **Play** once to enable browser audio. **Ctrl+Enter** toggles play and pause. Code edits are applied at the next bar; a compile error keeps the last working code running.

## Waveform, filter, and envelope lab

The complete example is in [`examples/scone-starter.js`](examples/scone-starter.js), available in the editor through **Load sample** and in the Guide panel. It shows named wave, filter, and envelope definitions, a scale-aware Euclidean pattern, a connected synth and kick, a doubled-speed pattern, MIDI/keyboard piano, and per-sound visual tools.

```js
const sampleSound = waveform("softWave", "sin(2*pi*f*t)")
const filterForm = filterform("lowPass200", "1/(1 + s*(1/(2*pi*200)))")
const envelopeForm = envelope("softEnvelope", "(1-t)^2")

const samplePattern = pattern("1(3,8,0) 5(2,8,1) 3(2,8,3)")
  .scale("c minor")
  .filter(filterForm)
const Sample = connect(sampleSound, samplePattern)
  .filter(filterForm)
  .envelope(envelopeForm)
  .gain(0.55)
  .delay(0.18)
const Kick_beat = connect("kick", pattern("X..."))

main(Sample, Kick_beat)
screen.scope(Sample)
screen.shapes("spheres", Sample)
screen.oscillator(Sample)
```

A Euclidean group is written as `degree(hits, segments, offset)`. So `1(3,8,0)` schedules degree 1 three times across eight steps, with offset 0. Multiple groups can be separated by spaces. Put the text in quotes because this project is JavaScript. Compact rhythm symbols also work: `pattern("X... ..x.")`.

In the Sound Lab, choose **Wave**, **Filter**, or **Envelope**, then **Draw** or **Equation**. Drawing changes the sound data only while the pointer is held down. The curve uses interpolation and quadratic rendering to avoid gaps and jagged joins. Click a `waveform`, `filterform`, or `envelope` definition—or its variable name—to open the matching lab pane. Close the pane with its button or by clicking outside it. The **Add to code** action inserts a named definition at the editor cursor.

- **Waveform:** `waveform(name, equation)` creates one repeating wavetable. `t` covers one cycle and `f` is the note frequency; standard calculator expressions are accepted, including `sin`, `sqrt`, and `^` for powers. For example: `waveform("bright", "sgn(sin(2*pi*f*t))")`.
- **Filter:** `filterform(name, equation)` describes response versus frequency. The graph uses log frequency from 20 Hz to 20 kHz and decibels vertically. Linear gain and dB expressions work. `1/(1 + s*(1/(2*pi*200)))` is interpreted as a first-order low pass at 200 Hz.
- **Envelope:** `envelope(name, equation)` defines amplitude over normalized time `t`, from 0 to 1. For example, `(1-t)^2` fades out.
- **Upload:** use **Upload sound** in the lab to add an audio snippet to the local sound bank. Uploaded clips are kept in this browser's IndexedDB.

## Language reference

Only the functions below are provided to user code. Ordinary JavaScript syntax is available around them.

| Function | Description |
| --- | --- |
| `main(sound1, sound2, ...)` | Registers connected sounds to run on each internal sixteenth-note step. Supply connected sounds directly; no callback is required. |
| `pattern(text)` | Parses Euclidean degree groups such as `"1(3,8,0) 5(2,8,1)"` or compact rhythm characters such as `X`, `x`, `o`, `.`, and roll digits `2`–`9`. |
| `scale(name)` | Sets the current musical key and returns the pitches in that scale. |
| `pattern(...).scale(name)` | Sets the scale used to convert degrees to pitches. Available scales: minor, major, phrygian, harmonic minor, dorian, pentatonic, chromatic. Examples: `"c minor"`, `"f# phrygian"`. |
| `pattern(...).filter(form)` | Associates a `filterform` with the pattern; `connect` applies it to the sound. |
| `connect(sound, pattern)` | Connects a waveform or named built-in/uploaded sound to a pattern. Returns the methods listed below. |
| `play(name, note?, options?)` | Triggers one built-in or uploaded sound. Options include `vol`, `at`, `pitch`, `speed`, and `reverb`. |
| `live(sound, scale).on()` | Enables the computer keyboard and MIDI input as a scale-locked piano for the selected sound. |
| `tempo(bpm)` | Sets tempo from 40 to 240 BPM. |
| `irand(max)` | Returns an integer from 0 through `max - 1`. |
| `waveform(name, equationOrSamples)` | Defines a wavetable using an equation string or array of drawn samples. |
| `filterform(name, equationOrSamples)` | Defines a frequency response using an equation string or drawn curve samples. |
| `envelope(name, equationOrSamples)` | Defines an amplitude envelope using an equation string or drawn samples. |
| `screen.scope(sound)` | Shows the selected sound's waveform scope. |
| `screen.spectrum(sound)` | Shows the selected sound's spectrum. |
| `screen.pianoRoll(sound)` | Shows the selected sound's coded rhythm. |
| `screen.shapes(kind, sound)` | Makes one of the three objects bounce on this sound's hits: `"puck"`, `"monkey"`, or `"spheres"`. |
| `screen.oscillator(sound)` | Adds the grayscale oscillator visual, driven by that sound's spectrum. |

### Methods returned by `connect`

| Method | Description |
| --- | --- |
| `.play()` | Schedules this connected sound's pattern on the current step. |
| `.pause(seconds)` | Temporarily pauses the sound for the given number of seconds; with no duration, pauses until resumed. |
| `.silence()` | Pauses the sound indefinitely until `.resume()` is called. |
| `.resume()` | Resumes a sound paused with `.pause()` or `.silence()`. |
| `.isPlaying()` | Returns true on a step where this sound's pattern actually triggers. |
| `.gain(value)` | Sets this sound's level from 0 to 1. |
| `.filter(form)` | Applies a `filterform` to this sound. |
| `.envelope(form)` | Applies an `envelope` amplitude shape. |
| `.distort(equationOrForm)` | Applies a waveshaper. An equation is evaluated over `x` from -1 to 1; for example, `"1.5*x - 0.5*x^3"` (use `^` for powers). |
| `.delay(seconds)` | Adds a feedback delay with the requested delay time. |

Pattern speed can be changed with multiplication: `samplePattern * 2` plays it twice as fast, while `samplePattern * 0.5` plays it at half speed.

The visuals use `screen.*` calls and attach directly to the selected sound; there is no separate audio-listener function. The example visual objects are the red hockey puck, wooden monkey, and blue sphere.
