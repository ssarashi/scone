export type PlayOptions = { vol?: number; at?: number; pitch?: number; reverse?: boolean; speed?: number; reverb?: number; start?:number; duration?:number }
export type Meter = { level: number; fft: Uint8Array<ArrayBuffer>; wave: Uint8Array<ArrayBuffer>; hit: number }

/** Owns the Web Audio graph, built-in voices, sample playback, analysis and ducking. */
export class AudioEngine {
  context: AudioContext | null = null
  master: GainNode | null = null
  limiter: DynamicsCompressorNode | null = null
  masterAnalyser: AnalyserNode | null = null
  captureDestination: MediaStreamAudioDestinationNode | null = null
  private micAnalyser:AnalyserNode|null=null
  private micSource:MediaStreamAudioSourceNode|null=null
  private micMeter:Meter|null=null
  private masterHit=0
  masterLevel = 1
  private buses = new Map<string, GainNode>()
  private analysers = new Map<string, AnalyserNode>()
  private meters = new Map<string, Meter>()
  private filtered = new Map<string, { analyser:AnalyserNode; filter:BiquadFilterNode; meter:Meter }>()
  private samples = new Map<string, AudioBuffer>()
  private wavetables = new Set<string>()
  private filterForms=new Map<string,ConvolverNode>()
  private distortions=new Map<string,WaveShaperNode>()
  private envelopes=new Map<string,Float32Array>()
  private delays = new Set<string>()
  private noise: AudioBuffer | null = null
  private impulse: AudioBuffer | null = null
  private active = new Map<string, boolean>()
  private ducks = new Map<string, { target: string; amount: number; release: number }>()

  /** Create or resume the audio context after a user gesture. */
  async start(): Promise<void> {
    if (!this.context) this.createGraph()
    await this.context!.resume()
  }

  /** Set up a compressor-limited master and per-track analysis taps. */
  private createGraph(): void {
    const AC = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) throw new Error('This browser does not support the Web Audio API.')
    const ctx = new AC(); this.context = ctx
    this.master = ctx.createGain(); this.limiter = ctx.createDynamicsCompressor(); this.masterAnalyser = ctx.createAnalyser()
    this.limiter.threshold.value = -7; this.limiter.knee.value = 4; this.limiter.ratio.value = 12; this.limiter.attack.value = .002; this.limiter.release.value = .13
    this.masterAnalyser.fftSize = 1024; this.masterAnalyser.smoothingTimeConstant = .72
    this.master.connect(this.limiter); this.limiter.connect(this.masterAnalyser); this.masterAnalyser.connect(ctx.destination)
    this.captureDestination=ctx.createMediaStreamDestination();this.masterAnalyser.connect(this.captureDestination)
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = this.noise.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    this.impulse = ctx.createBuffer(2, ctx.sampleRate * 1.3, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) { const d = this.impulse.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2) }
  }

  /** Read or lazily create a named track mixer bus. */
  bus(name: string): GainNode {
    if (!this.context || !this.master) throw new Error('Press Play first to start audio.')
    let bus = this.buses.get(name)
    if (!bus) {
      bus = this.context.createGain(); bus.gain.value = 1
      const analyser = this.context.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = .72
      bus.connect(this.master); bus.connect(analyser)
      this.buses.set(name, bus); this.analysers.set(name, analyser)
      this.meters.set(name, { level: 0, fft: new Uint8Array(analyser.frequencyBinCount), wave: new Uint8Array(analyser.fftSize), hit: 0 })
    }
    return bus
  }

  /** Register a browser-decoded sample buffer under a name. */
  addSample(name: string, buffer: AudioBuffer): void { this.samples.set(name, buffer) }
  /** Register one cycle of user drawn/equation-defined audio as a pitched wavetable. */
  addWavetable(name:string,cycle:Float32Array):void{if(!this.context)return;const buffer=this.context.createBuffer(1,cycle.length,this.context.sampleRate);buffer.copyToChannel(cycle,0);buffer.getChannelData(0)[cycle.length-1]=buffer.getChannelData(0)[0];this.samples.set(name,buffer);this.wavetables.add(name)}
  /** Remove a sample from the live sound bank. */
  removeSample(name:string):void{this.samples.delete(name);this.wavetables.delete(name)}
  /** Return sample names currently available for play(). */
  sampleNames(): string[] { return [...this.samples.keys()] }
  /** Return the decoded buffer for analysis, slicing or UI waveform rendering. */
  sampleBuffer(name:string):AudioBuffer|undefined{return this.samples.get(name)}
  /** Attach microphone analysis without routing the mic into the audible master. */
  connectMicrophone(stream:MediaStream):void{if(!this.context||this.micAnalyser)return;this.micSource=this.context.createMediaStreamSource(stream);this.micAnalyser=this.context.createAnalyser();this.micAnalyser.fftSize=512;this.micAnalyser.smoothingTimeConstant=.65;this.micMeter={level:0,fft:new Uint8Array(this.micAnalyser.frequencyBinCount),wave:new Uint8Array(this.micAnalyser.fftSize),hit:0};this.micSource.connect(this.micAnalyser)}
  /** Release the microphone analysis graph when the user stops mic capture. */
  disconnectMicrophone():void{this.micSource?.disconnect();this.micSource=null;this.micAnalyser=null;this.micMeter=null;for(const [key,tap] of this.filtered)if(key.startsWith('mic:')){tap.filter.disconnect();tap.analyser.disconnect();this.filtered.delete(key)}}
  /** Decode and register audio bytes as a named playable sample. */
  async decodeSample(name:string,blob:Blob):Promise<AudioBuffer>{if(!this.context)await this.start();const buffer=await this.context!.decodeAudioData(await blob.arrayBuffer());this.addSample(name,buffer);return buffer}
  /** Return the analyser state for a named track, or the master with "all". */
  meter(name = 'all'): Meter {
    if(name==='mic'&&this.micAnalyser)return this.readMicMeter()
    if (name === 'all' && this.masterAnalyser) return this.readMeter('all', this.masterAnalyser)
    const analyser = this.analysers.get(name)
    return analyser ? this.readMeter(name, analyser) : { level: 0, fft: new Uint8Array(0), wave: new Uint8Array(0), hit: 0 }
  }
  private readMicMeter():Meter{const a=this.micAnalyser!,m=this.micMeter!;a.getByteFrequencyData(m.fft);a.getByteTimeDomainData(m.wave);let sum=0;for(const n of m.wave){const x=(n-128)/128;sum+=x*x}m.level=Math.sqrt(sum/m.wave.length);return m}
  /** Create an isolated filtered analysis tap that never changes audible output. */
  filteredMeter(name:string,type:BiquadFilterType,hz:number,q=.707):Meter{
    if(!this.context)return{level:0,fft:new Uint8Array(0),wave:new Uint8Array(0),hit:0}
    const key=`${name}:${type}:${Math.round(hz)}:${q}`;let item=this.filtered.get(key)
    if(!item){const source=name==='all'?this.master!:name==='mic'?this.micAnalyser:this.bus(name),filter=this.context.createBiquadFilter(),analyser=this.context.createAnalyser();if(!source)return{level:0,fft:new Uint8Array(0),wave:new Uint8Array(0),hit:0};filter.type=type;filter.frequency.value=Math.max(20,Math.min(20000,hz));filter.Q.value=Math.max(.1,q);analyser.fftSize=512;analyser.smoothingTimeConstant=.72;source.connect(filter);filter.connect(analyser);item={analyser,filter,meter:{level:0,fft:new Uint8Array(analyser.frequencyBinCount),wave:new Uint8Array(analyser.fftSize),hit:0}};this.filtered.set(key,item)}
    item.analyser.getByteFrequencyData(item.meter.fft);item.analyser.getByteTimeDomainData(item.meter.wave);let sum=0;for(const n of item.meter.wave){const x=(n-128)/128;sum+=x*x}item.meter.level=Math.sqrt(sum/item.meter.wave.length);item.meter.hit=name==='all'?this.masterHit:this.meters.get(name)?.hit||0;if(name==='all')this.masterHit*=.82;return item.meter
  }
  private readMeter(name: string, analyser: AnalyserNode): Meter {
    const meter = this.meters.get(name) || { level: 0, fft: new Uint8Array(analyser.frequencyBinCount), wave: new Uint8Array(analyser.fftSize), hit: 0 }
    analyser.getByteFrequencyData(meter.fft); analyser.getByteTimeDomainData(meter.wave)
    let sum = 0; for (const n of meter.wave) { const x = (n - 128) / 128; sum += x * x }
    meter.level = Math.sqrt(sum / meter.wave.length); if(name==='all'){meter.hit=this.masterHit;this.masterHit*=.82}else meter.hit *= .82
    this.meters.set(name, meter); return meter
  }

  /** Schedule a built-in voice or a named sample on the audio clock. */
  play(name: string, note?: number | string, options: PlayOptions = {}): void {
    if (!this.context) return
    const ctx = this.context, at = Math.max(options.at ?? ctx.currentTime, ctx.currentTime), velocity = Math.max(0, Math.min(1, options.vol ?? .8))
    const midi = typeof note === 'number' ? note : note ? this.noteNameToMidi(note) : 48
    this.active.set(name, true);this.bus(name)
    const delay=Math.max(0,(at-ctx.currentTime)*1000)
    window.setTimeout(()=>{const meter=this.meters.get(name);if(meter)meter.hit=1;this.masterHit=1},delay)
    this.triggerDucks(name, at)
    const sample = this.samples.get(name)
    if (sample) { this.playBuffer(name, sample, at, velocity, this.wavetables.has(name)?{...options,pitch:2**((midi-69)/12)}:options); return }
    switch (name.toLowerCase()) {
      case 'kick': case 'bd': this.kick(name, at, velocity, midi); break
      case 'snare': case 'sd': this.noiseHit(name, at, velocity, 1900, .14); this.tone(name, at, 175, .12, velocity * .35, 'triangle'); break
      case 'hat': case 'hihat': case 'hh': this.noiseHit(name, at, velocity * .48, 8200, .042); break
      case 'clap': this.noiseHit(name, at, velocity * .7, 1250, .12); break
      case '808': case 'bass': this.kick(name, at, velocity, midi || 36, .34); break
      default: this.synth(name, midi, at, velocity, options)
    }
  }

  /** Trigger a drum or sample row hit with accent and optional ratchet count. */
  triggerStep(name: string, at: number, velocity: number, roll = 1): void {
    const n = Math.max(1, Math.min(9, Math.trunc(roll))), spacing = .11 / n
    for (let i = 0; i < n; i++) this.play(name, undefined, { at: at + i * spacing, vol: velocity * (i === 0 ? 1 : .72) })
  }
  /** Set a target track to dip briefly whenever the source track fires. */
  duck(target: string, source: string, amount = .58, release = .22): void { this.ducks.set(source, { target, amount: Math.max(0, Math.min(1, amount)), release: Math.max(.03, release) }); this.bus(target) }
  /** Add a tempo-aligned feedback delay send to one track bus. */
  delay(name:string,seconds=.24,feedback=.34,wet=.2):void{if(!this.context)return;const id=`${name}:${seconds}:${feedback}:${wet}`;if(this.delays.has(id))return;const bus=this.bus(name),delay=this.context.createDelay(2),loop=this.context.createGain(),send=this.context.createGain();delay.delayTime.value=Math.max(.015,Math.min(1.5,seconds));loop.gain.value=Math.max(0,Math.min(.88,feedback));send.gain.value=Math.max(0,Math.min(.8,wet));bus.connect(delay);delay.connect(loop);loop.connect(delay);delay.connect(send);send.connect(this.master!);this.delays.add(id)}
  /** Set master amplitude. Zero is used by hold-to-silence. */
  setMasterLevel(level: number, ramp = .012): void {
    this.masterLevel = Math.max(0, Math.min(1, level)); if (!this.context || !this.master) return
    const g = this.master.gain, t = this.context.currentTime; g.cancelScheduledValues(t); g.setTargetAtTime(this.masterLevel, t, ramp)
  }
  /** Mute a selected track bus without stopping the master clock. */
  mute(name: string, yes = true): void {
    if (!this.context) return
    const bus = this.bus(name), t = this.context.currentTime; bus.gain.cancelScheduledValues(t); bus.gain.setTargetAtTime(yes ? 0 : 1, t, .012)
  }
  /** Set one named instrument bus gain with a short click-free ramp. */
  setGain(name:string,level:number,ramp=.02):void{const bus=this.bus(name),ctx=this.context!,t=ctx.currentTime;bus.gain.cancelScheduledValues(t);bus.gain.setTargetAtTime(Math.max(0,Math.min(1,level)),t,Math.max(.002,ramp))}
  /** Apply a drawn dB response as a short FIR filter on one instrument bus. */
  setFilterForm(name:string,response:Float32Array):void{
    if(!this.context)return
    const ctx=this.context,bus=this.bus(name),size=256,half=size/2
    const mag=Array.from({length:half+1},(_,k)=>{
      const index=Math.min(response.length-1,Math.floor(k/half*(response.length-1)))
      const db=Math.max(-1,Math.min(0,response[index]??0))*60
      return 10**(db/20)
    })
    const impulse=new Float32Array(size)
    for(let n=0;n<size;n++){const centered=n-half;let sum=mag[0]+mag[half]*Math.cos(Math.PI*centered);for(let k=1;k<half;k++)sum+=2*mag[k]*Math.cos(2*Math.PI*k*centered/size);const window=.5-.5*Math.cos(2*Math.PI*n/(size-1));impulse[n]=sum/size*window}
    let peak=0;for(const v of impulse)peak=Math.max(peak,Math.abs(v));if(peak>0)for(let i=0;i<size;i++)impulse[i]/=peak
    const buffer=ctx.createBuffer(1,size,ctx.sampleRate);buffer.copyToChannel(impulse,0)
    let node=this.filterForms.get(name);if(!node){node=ctx.createConvolver();node.normalize=false;this.filterForms.set(name,node)}node.buffer=buffer;this.rebuildRoute(name,bus)
  }
  /** Set a custom Chebyshev or drawn waveshaper curve on one instrument bus. */
  setDistortion(name:string,curve:Float32Array):void{if(!this.context)return;const bus=this.bus(name);let node=this.distortions.get(name);if(!node){node=this.context.createWaveShaper();node.oversample='4x';this.distortions.set(name,node)}node.curve=curve;this.rebuildRoute(name,bus)}
  /** Store an amplitude contour applied to subsequent notes on this instrument. */
  setEnvelope(name:string,values:Float32Array):void{this.envelopes.set(name,values)}
  private rebuildRoute(name:string,bus:GainNode):void{bus.disconnect();const analyser=this.analysers.get(name);if(analyser)bus.connect(analyser);let tail:AudioNode=bus;const filter=this.filterForms.get(name),distortion=this.distortions.get(name);if(filter){tail.connect(filter);tail=filter}if(distortion){tail.connect(distortion);tail=distortion}tail.connect(this.master!)}

  private route(source: AudioNode, name: string, reverb = 0): void {
    const bus = this.bus(name)
    if (reverb > 0 && this.impulse && this.context) { const dry = this.context.createGain(), wet = this.context.createGain(), convolver = this.context.createConvolver(); convolver.buffer = this.impulse; dry.gain.value = 1 - reverb * .5; wet.gain.value = reverb; source.connect(dry); source.connect(convolver); dry.connect(bus); convolver.connect(wet); wet.connect(bus) }
    else source.connect(bus)
  }
  private kick(name: string, at: number, velocity: number, midi = 36, duration = .24): void {
    const ctx = this.context!, osc = ctx.createOscillator(), gain = ctx.createGain(); osc.type = 'sine'
    const hz = name.toLowerCase() === 'kick' || name.toLowerCase() === 'bd' ? 155 : 440 * 2 ** ((midi - 69) / 12)
    osc.frequency.setValueAtTime(hz, at); osc.frequency.exponentialRampToValueAtTime(Math.max(28, hz * .29), at + duration * .58)
    gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(velocity, at + .004); gain.gain.exponentialRampToValueAtTime(.0001, at + duration)
    osc.connect(gain); this.route(gain, name); osc.start(at); osc.stop(at + duration + .02)
  }
  private noiseHit(name: string, at: number, velocity: number, cutoff: number, duration: number): void {
    const ctx = this.context!, src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain(); src.buffer = this.noise
    filter.type = 'highpass'; filter.frequency.value = cutoff; filter.Q.value = .72
    gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(velocity, at + .003); gain.gain.exponentialRampToValueAtTime(.0001, at + duration)
    src.connect(filter); filter.connect(gain); this.route(gain, name); src.start(at); src.stop(at + duration + .01)
  }
  private tone(name: string, at: number, hz: number, duration: number, velocity: number, type: OscillatorType): void {
    const ctx = this.context!, osc = ctx.createOscillator(), gain = ctx.createGain(); osc.type = type; osc.frequency.value = hz
    gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(velocity, at + .004); gain.gain.exponentialRampToValueAtTime(.0001, at + duration)
    osc.connect(gain); this.route(gain, name); osc.start(at); osc.stop(at + duration + .01)
  }
  private synth(name: string, midi: number, at: number, velocity: number, options: PlayOptions): void {
    const ctx = this.context!, osc = ctx.createOscillator(), sub = ctx.createOscillator(), filter = ctx.createBiquadFilter(), gain = ctx.createGain(), drive = ctx.createWaveShaper()
    const speed = Math.max(.1, options.speed ?? 1), hz = 440 * 2 ** ((midi - 69) / 12) * (options.pitch ?? 1), duration = name === 'pad' ? .8 : .19
    osc.type = name === 'bell' ? 'sine' : name === 'pluck' ? 'triangle' : name === 'pad' || name === 'supersaw' ? 'sawtooth' : 'sawtooth'
    osc.frequency.setValueAtTime(Math.max(20, hz), at); if (name === '808' || name === 'bass' || name === 'acid') osc.frequency.setTargetAtTime(hz * (options.pitch ?? 1), at + .01, .04)
    sub.type = name === 'supersaw' ? 'sawtooth' : 'square'; sub.frequency.value = hz * (name === 'supersaw' ? 1.006 : 2); sub.detune.value = name === 'supersaw' ? -13 : 0
    filter.type = 'lowpass'; filter.frequency.setValueAtTime(name === 'acid' ? 2400 : name === '808' || name === 'bass' ? 520 : 8400, at); filter.frequency.exponentialRampToValueAtTime(name === 'acid' ? 420 : 1200, at + duration * .75); filter.Q.value = name === 'acid' ? 15 : 7
    const envelope=this.envelopes.get(name);if(envelope?.length){const length=duration/speed;gain.gain.setValueAtTime(Math.max(.0001,envelope[0]*velocity),at);for(let i=1;i<envelope.length;i++)gain.gain.linearRampToValueAtTime(Math.max(.0001,envelope[i]*velocity),at+length*i/(envelope.length-1))}else{gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(velocity * (name === '808' || name === 'bass' ? .72 : .26), at + .006); gain.gain.exponentialRampToValueAtTime(.0001, at + duration / speed)}
    const curve = new Float32Array(256); for (let i = 0; i < curve.length; i++) { const x = i * 2 / (curve.length - 1) - 1; curve[i] = Math.tanh(x * (name === '808' || name === 'acid' ? 5 : 2.6)) }
    drive.curve = curve; drive.oversample = '4x'; osc.connect(filter); if (name === 'supersaw' || name === '808' || name === 'bass') sub.connect(filter); filter.connect(drive); drive.connect(gain); this.route(gain, name, options.reverb ?? 0)
    osc.start(at); osc.stop(at + duration / speed + .03); if (name === 'supersaw' || name === '808' || name === 'bass') { sub.start(at); sub.stop(at + duration / speed + .03) }
  }
  private playBuffer(name: string, buffer: AudioBuffer, at: number, velocity: number, options: PlayOptions): void {
    const ctx = this.context!, src = ctx.createBufferSource(), gain = ctx.createGain(),wavetable=this.wavetables.has(name); src.buffer = options.reverse ? this.reverseBuffer(buffer) : buffer
    const frequency=440*(options.pitch??1)
    src.playbackRate.value = wavetable ? frequency*buffer.length/ctx.sampleRate : Math.max(.1, options.speed ?? 1) * (options.pitch ?? 1); src.loop=wavetable;gain.gain.value = velocity; src.connect(gain); this.route(gain, name, options.reverb ?? 0)
    if(wavetable){const envelope=this.envelopes.get(name),duration=(options.duration??.22)/Math.max(.1,options.speed??1);if(envelope?.length){gain.gain.setValueAtTime(Math.max(.0001,envelope[0]*velocity),at);for(let i=1;i<envelope.length;i++)gain.gain.linearRampToValueAtTime(Math.max(.0001,envelope[i]*velocity),at+duration*i/(envelope.length-1))}src.start(at);src.stop(at+duration)}
    else if(options.duration===undefined)src.start(at,Math.max(0,options.start??0));else src.start(at,Math.max(0,options.start??0),options.duration)
  }
  private reverseBuffer(buffer: AudioBuffer): AudioBuffer {
    const ctx = this.context!, result = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) { const src = buffer.getChannelData(ch), dst = result.getChannelData(ch); for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i] }
    return result
  }
  private triggerDucks(source: string, at: number): void {
    if (!this.context) return
    const duck = this.ducks.get(source); if (!duck) return
    const bus = this.buses.get(duck.target); if (!bus) return
    const g = bus.gain; g.cancelScheduledValues(at); g.setValueAtTime(g.value, at); g.linearRampToValueAtTime(1 - duck.amount, at + .008); g.setTargetAtTime(1, at + .015, duck.release / 3)
  }
  private noteNameToMidi(note: string): number {
    const m = note.toLowerCase().match(/^([a-g])([#b]?)(-?\d+)$/); if (!m) return 48
    const pcs: Record<string, number> = { c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11 }
    return (Number(m[3]) + 1) * 12 + (pcs[m[1] + m[2]] ?? 0)
  }
}
