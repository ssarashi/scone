# scone

scone is a nerdy sound lab built around live coding. Shape sound by drawing or writing equations for waveforms, filters, and envelopes, then connect those forms to JavaScript rhythms. It is a browser based lab for focused sound design, with a full-window visual canvas behind the editor on a clean `#FAFAFA` background.

## Run locally

```sh
npm install
npm run dev
```

Open the Vite URL and press **Play** to start. The production site reloads with the default starter code every time; local development can restore its browser autosave. Click **Pause** or press **Ctrl+Esc** to pause. Edit code freely; changes stay as drafts until **Ctrl+Enter** applies them. While playing, accepted code takes effect at the next unscheduled sequencer step, not automatically at a bar. **Ctrl+Z**, **Ctrl+C**, and **Ctrl+V** undo, copy, and paste in the editor. A code error names its source line and keeps the last applied program running. Each line that triggers a sound briefly highlights on the audio clock.

## Starter song

The same starter loads by default and is in [`examples/scone-starter.js`](examples/scone-starter.js).

```js
tempo(82)
const sampleSound = waveform("softWave", "0.82*sin(2*pi*f*t) + 0.12*sin(4*pi*f*t)")
const filterForm = filterform("airFilter", "1/(1 + s*(1/(2*pi*1400)))")
const envelopeForm = envelope("longFade", "(1-t)^1.6")

const melodyOffset = irand(8)
const melody = pattern(`1(2,8,0) 3(1,8,3) 5(2,8,5) 7(1,8,${melodyOffset})`)
const sample = connect(sampleSound, melody).scale("c ritusen")
  .filter(filterForm)
  .envelope(envelopeForm)
  .gain(1.38)
  .delay(1.34)
const sampleSlow = connect(sampleSound, melody * 0.5).scale("c ritusen").gain(0.18)
const kickBeat = connect("kick", pattern("(3,16,0)")).gain(0.68)
const hatBeat = connect("hat", pattern("(7,16,2)")).gain(0.2)

main(
  sample.play()
  kickBeat.play()
  hatBeat.play()

  if (sample.isPlaying() && kickBeat.isPlaying()) {
    sampleSlow.play()
  }

  if (sample.isPlaying() == false) {
    screen.shapes("miffy", sample)
    screen.scope(sample)
  }
)
```

All `const` names start with a lowercase letter. `irand(8)` picks an integer from 0 to 7; here it computes the last melody group’s Euclidean offset. `main(...)` contains ordinary JavaScript statements and runs them once per sequencer step.

## Sound Lab

Click a `waveform`, `filterform`, or `envelope` definition in the editor to open its graph. You can type an equation in **Equation** mode or draw by holding the primary mouse button on the graph. The graph only records pointer movement while pressed and smooths the curve. Drawing over an existing equation starts from the displayed curve.

After drawing, scone fits an equation and displays the graph and measured Pearson correlation **r**. Waveform, filter, and envelope fits target **r ≥ 0.95**. Press **Enter** in the equation field or click **Enter to update code** to write the equation into the selected definition. That edits the code draft only; press **Ctrl+Enter** to apply the draft to the running song. Typing without Enter does not change the code. Filter equations are functions of frequency: the graph spans 20 Hz to 20 kHz logarithmically and uses a decibel scale. For example, `1/(1 + s*(1/(2*pi*200)))` is a 200 Hz low-pass transfer function. Envelope equations use normalized time `t` from 0 to 1.

The waveform lab includes an on-screen piano. Its keys audition the current waveform, including an uncommitted drawing preview, through a temporary sound so the song’s committed waveform stays unchanged. Press **Enter** to write the equation into the code draft, then **Ctrl+Enter** to apply it to the song. The separate live/MIDI piano has been removed. scone does not provide an audio upload control or user sound bank.

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
| `screen.shapes(kind, sound)` | Bounces a visual object inside the viewport on the sound’s hits. A new object appears at a random position every fourth hit; existing objects get a small impulse on each hit. All objects render 150 CSS pixels wide. Kinds: `"puck"`, `"monkey"`, `"spheres"`, `"duck"`, and `"miffy"`. |

The wooden monkey, rubber duck, and Miffy use transparent PNG cutouts at `public/wooden_monkey.png`, `public/rubberduck.png`, and `public/miffy.png`. Their image URLs use Vite’s `BASE_URL`, so they load under the `/scone/` project prefix on GitHub Pages. For example, `screen.shapes("duck", sample)` adds a rubber duck and `screen.shapes("miffy", sample)` adds Miffy.

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

The built-in drum kit contains only basic drum and bass sounds, generated in Web Audio:

- **Bass drum / kick:** `kick`, `bd`, `bass drum`, `bass-drum`
- **808:** `808`, `bass`
- **Closed hi-hat:** `hat`, `hihat`, `hh`, `highhat`, `high-hat`, `closedhat`
- **Open hi-hat:** `openhat`, `open-hat`, `oh`
- **Snare:** `snare`, `sd`

The synth voices are `acid`, `bell` / `bells`, `choir_aahs`, `seashore`, and `crickets`. Basic oscillator voices are `triangle`, `saw`, `sine`, `supersaw`, and `pulse`. Only these built-in voices are accepted by `connect()`. Use `waveform(...)` to draw or calculate a custom oscillator.
For example, `connect("snare", pattern("(2,16,4)"))` connects the built-in snare to two hits over sixteen steps.
