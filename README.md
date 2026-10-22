# scone

scone is a browser based sound lab for slow synth music. Type JavaScript in the editor, press Play, and the code schedules sound on a steady sixteenth note clock. A white and gray aurora visual fills the background. The optional sound lab opens when the code contains `waveform()`, `filterform()`, or `envelope()`.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL Vite prints and press **Play** once to enable browser audio. **Ctrl+Enter** toggles play and pause. Edits made during playback are compiled at the next bar; code errors keep the last working program running.

## First pattern

```js
const leadWave = waveform("sin(2*pi*f*t)")
const pulse = pattern([[4,2,8,0], [2,3,8,1], [1,2,8,2]]).scale("c minor")
const lead = connect(leadWave, pulse)

main(() => {
  lead.play()
})
```

Use valid JavaScript: pattern text and musical scales are strings, so they need quotes. `main(() => {})` is called at each internal step; it does not pass beat or bar values. Pattern groups are `[degree, beats, segments, offset]` tuples, so you can write them without a pattern string. `pattern()` also accepts a quoted shorthand or the compact `x`, `X`, `o`, `.`, and `2`–`9` rhythm symbols. `euclid(degree, beats, segments, offset)` creates a single group.

Multiplying a pattern variable by `2` doubles its playback speed; multiplying it by `.5` halves the speed. The editor applies this to declared pattern variables in `connect()`, for example `connect(wave, pulse * 2)`. Other JavaScript arithmetic keeps its usual meaning.

## Waveform, filter, and envelope lab

Write one of these definitions in the editor to open the lab:

```js
const leadWave = waveform("sin(2*pi*f*t)")
const lowPass = filterform("1/(1 + s*(1/(2*pi*200)))")
const ampShape = envelope("(1-t)^2")
```

The panel can be closed; edit one of those declarations again to reopen it. In **Draw** mode, click and drag on the graph to draw; hovering without a pressed pointer does not alter it. In **Equation** mode, edits update the graph when you press Enter or leave the field. The **Add to code** button inserts a named definition at the cursor. The panel also has an upload control and the local sound bank.

- **Wave:** one repeating cycle, with `t` from 0 to 1 and `f` as the pitch frequency. Available calculator functions include `sin`, `cos`, `tan`, `tri`, `saw`, `sgn`, `abs`, `sqrt`, `pow`, `exp`, `log`, and `log10`. Use `^` for exponentiation.
- **Filter:** frequency is `f` in Hz; the graph uses a logarithmic 20 Hz–20 kHz axis and a dB scale. Linear gain expressions and dB expressions are accepted. A first order s-domain low pass such as `1/(1 + s*(1/(2*pi*200)))` maps to a 200 Hz cutoff.
- **Envelope:** amplitude over time. Connect one with `voice.envelope(ampShape)`.

`waveform`, `filterform`, and `envelope` accept an expression or an array of drawn samples. They can also take a name first, as in `waveform("lead", equation)`. Wavetables are saved in the local sound bank. Uploaded audio snippets are stored in IndexedDB in this browser.

## Music and playback helpers

| Function | Purpose |
| --- | --- |
| `main(callback)` | Register the function called on every internal sequencer step. |
| `pattern(text)` | Parse Euclidean degree groups or compact rhythm symbols. |
| `euclid(degree, beats, segments, offset)` | Create one Euclidean degree pattern. |
| `degrees(text, options?)` | Create scale-degree notes and rests. |
| `notes(text)` | Create note-name events such as `c4 eb3 g3`. |
| `pattern(...).scale(name)` | Set the musical scale for the pattern, such as `"c minor"` or `"f# phrygian"`. Available scales are minor, major, phrygian, harmonic minor, dorian, pentatonic, and chromatic. |
| `connect(sound, pattern)` | Connect a waveform or named sound to a pattern. Returns `.play()`, `.pause(seconds?)`, `.silence()`, `.resume()`, `.isPlaying()`, `.gain(value)`, `.filter(form)`, `.envelope(form)`, and `.distort(form)`. |
| `play(name, note?, options?)` | Trigger one sound or uploaded sample. Options include `vol`, `at`, `pitch`, `speed`, and `reverb`. |
| `track(name, pattern)` | Run a pattern on a built in drum or synth voice. |
| `live(sound, scale).on()` | Enable the computer keyboard and MIDI as a scale-locked piano for a sound. |
| `tempo(bpm)` | Set tempo from 40 to 240 BPM. |
| `gain(name, amount)` | Set a sound bus level. |
| `delay(name, seconds?, feedback?, wet?)` | Add a feedback delay to a sound. |
| `distort(name, equation)` | Build a waveshaper from an equation in `x`; `^` means exponentiation. |
| `irand(max)` | Choose an integer from zero through `max - 1`. |
| `listen(name)` | Read `.level`, `.fft`, `.wave`, `.hit`, `.band(lo, hi)`, `.lpf(hz)`, `.hpf(hz)`, and `.bpf(hz, q)` for visuals. |
| `screen.scope(sound)` | Show a waveform scope for one sound. |
| `screen.spectrum(sound)` | Show a spectrum for one sound. |
| `screen.pianoRoll(sound)` | Show the coded rhythm for one sound. |
| `screen.shapes(kind, sound)` | Make the puck, wooden monkey, or blue sphere bounce on sound hits. |
| `screen.oscillator(...)` | Add an oscillator visual behind the code. |

## Visuals

Visuals render behind the editor. The background is grayscale and aurora-like; the three sound-reactive objects are a red hockey puck, wooden monkey, and blue sphere. For example:

```js
const all = listen("all")
noise(() => 1 + all.fft[1] / 90, .015)
  .modulate(noise(() => 2 + all.fft[0] / 24), .16)
  .out()
screen.shapes("spheres", lead)
screen.scope(lead)
```

Sources include `osc`, `noise`, `voronoi`, `shape`, `gradient`, `solid`, and `grid`. Visual chains support `rotate`, `scale`, `kaleid`, `pixelate`, `repeat`, `color`, `colorama`, `invert`, `thresh`, `modulate`, `diff`, `blend`, `mult`, `feedback`, and `out`.

## GitHub Pages

A Pages workflow is included in `.github/workflows/pages.yml`; Vite is configured for the project URL `https://ssarashi.github.io/scone/`. Push the project to a repository named `scone` under `ssarashi`, then select **Settings → Pages → GitHub Actions**. The current workspace has no Git remote or authenticated GitHub CLI, so it cannot publish to the account from this environment by itself.
