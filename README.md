# scone

scone is a browser based live-coding sound lab for slow, airy synth music and Euclidean rhythms. Its visuals fill the browser behind a full-width JavaScript editor on a clean `#FAFAFA` background.

## Run locally

```sh
npm install
npm run dev
```

Open the Vite URL and press **Play** to start. Click **Pause** or press **Ctrl+Esc** to pause. Edit code freely; changes stay as drafts until **Ctrl+Enter** applies them. While playing, accepted code takes effect at the next unscheduled sequencer step, not automatically at a bar. **Ctrl+Z**, **Ctrl+C**, and **Ctrl+V** undo, copy, and paste in the editor. A code error keeps the last applied program running.

## Starter song

The same starter loads by default and is in [`examples/scone-starter.js`](examples/scone-starter.js).

```js
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
    screen.scope(sample)
  }
)
```

All `const` names start with a lowercase letter. `irand(8)` picks an integer from 0 to 7; here it computes the last melody group’s Euclidean offset. `main(...)` contains ordinary JavaScript statements and runs them once per sequencer step.

## Sound Lab

Click a `waveform`, `filterform`, or `envelope` definition in the editor to open its graph. You can type an equation in **Equation** mode or draw by holding the primary mouse button on the graph. The graph only records pointer movement while pressed and smooths the curve. Drawing over an existing equation starts from the displayed curve.

After drawing, scone fits an equation and displays the graph and measured Pearson correlation **r**. Waveform, filter, and envelope fits target **r ≥ 0.95**. Press **Enter** in the equation field or click **Enter to update code** to write the equation into the selected definition. That edits the code draft only; press **Ctrl+Enter** to apply the draft to the running song. Typing without Enter does not change the code. Filter equations are functions of frequency: the graph spans 20 Hz to 20 kHz logarithmically and uses a decibel scale. For example, `1/(1 + s*(1/(2*pi*200)))` is a 200 Hz low-pass transfer function. Envelope equations use normalized time `t` from 0 to 1.

The waveform lab includes an on-screen piano. Its keys play the current waveform definition directly, including an uncommitted drawing preview. The separate live/MIDI piano has been removed. scone does not provide an audio upload control or user sound bank.

## Language reference

| Function | Purpose |
| --- | --- |
| `main(statements...)` | Runs its JavaScript statement block once per internal sequencer step. Use normal `if` blocks. |
| `pattern(text)` | Parses scale groups like `1(3,8,0)` and unpitched groups like `(3,16,0)`. Groups are `degree(hits, segments, offset)`. |
| `scale(name)` | Sets the key for a pattern, e.g. `.scale("c minor")`. Scales: major, minor, pentatonic, ritusen. Tonics include C, D, E, F, G, A, B (for example `.scale("d ritusen")`); sharp and flat spellings also work. `c:minor` is accepted alongside `c minor`. |
| `connect(sound, pattern)` | Connects a built-in sound or waveform to a pattern. |
| `waveform(name, equationOrSamples)` | Defines a repeating wavetable. `f` follows the played note pitch; `t` spans one cycle. |
| `filterform(name, equationOrSamples)` | Defines a response over frequency, represented and drawn in dB. |
| `envelope(name, equationOrSamples)` | Defines an amplitude contour over normalized time. |
| `tempo(bpm)` | Sets tempo from 40 to 240 BPM. |
| `irand(max)` | Returns an integer from zero through `max - 1`. |
| `screen.scope(sound)` | Draws the sound’s waveform as a full-window background layer in `#4B3A59`. |
| `screen.shapes(kind, sound)` | Bounces the hockey puck, wooden monkey, or blue sphere on hits. Kinds: `"puck"`, `"monkey"`, `"spheres"`. |

The wooden monkey uses the transparent photo cutout at `public/wooden_monkey.png`. The app builds its URL from Vite’s `BASE_URL`, so the image path keeps the `/scone/` project prefix when served from GitHub Pages.

### Methods returned by `connect`

| Method | Purpose |
| --- | --- |
| `.play()` | Schedules the connected pattern for the current step. |
| `.isPlaying()` | Returns true while this connection has a note active, including its short release, and false between notes. Call `.play()` before checking it in `main(...)`. Visual declarations inside an `if` are active only while that condition is true. |
| `.pause(seconds)` | Temporarily skips this sound for the given duration; with no duration it pauses until resumed. |
| `.silence()` | Pauses until `.resume()` is called. |
| `.resume()` | Resumes this connected sound. |
| `.gain(value)` | Sets this sound’s linear track multiplier from 0 to 8. `1` is normal level; values above `1` boost it. It is applied after the voice and before track effects. |
| `.filter(form)` | Applies a `filterform(...)` response. |
| `.envelope(form)` | Applies an `envelope(...)` amplitude contour. |
| `.distort(equation)` | Applies a waveshaper equation over `x` from -1 to 1. |
| `.delay(seconds)` | Adds or updates a feedback delay send after the track filters; seconds are clamped to 0.015–1.5. |

`if (sample.isPlaying())` enables visuals while that connection has an active note. `if (!sample.isPlaying())` enables them during gaps; visual calls inside either branch are cleared when the branch stops running.

Pattern multiplication controls speed: `melody * 2` plays twice as fast; `melody * 0.5` plays at half speed.

## Built-in sound kit

These names and aliases are implemented in the built-in audio engine:

- **Kick:** `kick`, `bd`
- **Snare:** `snare`, `sd`
- **Hi-hat:** `hat`, `hihat`, `hh`
- **Clap:** `clap`
- **808/bass:** `808`, `bass`
- **Synth voices:** `lead` (the default for other names), `acid`, `supersaw`, `pluck`, `pad`, `bell`

For example, `connect("snare", pattern("(2,16,4)"))` connects the built-in snare to two hits over sixteen steps.
