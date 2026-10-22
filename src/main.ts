import { basicSetup, EditorView } from 'codemirror'
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript'
import { completeFromList, snippetCompletion } from '@codemirror/autocomplete'
import { undo } from '@codemirror/commands'
import { hoverTooltip, keymap } from '@codemirror/view'
import { Decoration, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { EditorSelection, StateEffect, StateField, type SelectionRange, type Transaction } from '@codemirror/state'
import { setDiagnostics } from '@codemirror/lint'
import { AudioEngine, type PlayOptions } from './engine/audio'
import { degrees, double, euclidean as euclideanPattern, half, isHit, join, notes, parseKey, pattern, quantizeMidi, reverse, shift, thin, degreeToMidi, type MusicKey, type Pattern, type PatternEvent } from './engine/patterns'
import { SconeDatabase, trimAndEncodeWav, type SampleRecord, type SongRecord } from './storage/database'
import { AudioTap, beginVisualTransaction, clearVisuals, commitVisualTransaction, connectVisualAudio, gradient, grid, listen, noise, osc, rollbackVisualTransaction, setVisualPause, shape, solid, voronoi, VisualChain } from './visuals/webgl'
import { ShapeField, shapeFunctions } from './visuals/shapes'
import './style.css'
import STARTER from '../examples/scone-starter.js?raw'

type Tick = { step:number; beat:number; bar:number; time:number }
type QueuedSound = { name:string; note?:number|string; options:PlayOptions; source:'pattern'|'code'; follows?:Pattern; roll?:number }
type SampleSlice={__sconeSlice:true;sample:string;start:number;duration:number}
type Env = { main:(()=>void)|null; key:MusicKey; tempo:number; pendingKey:MusicKey|null; pendingTempo:number|null; compiling:boolean; tick:Tick; queue:QueuedSound[]; fired:Set<string>; patterns:Map<string,Pattern>; muted:Set<string>; silent:boolean; piano:string|null }
type ScheduledProgram = { source:string; env:Env; diagnostics?:string }
type FiredStep = { step:number; sources:Map<string,'pattern'|'code'>; notes:Map<string,string> }

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <header class="topbar ui"><div class="brand"><img class="brand-mark" src="${import.meta.env.BASE_URL}scone_for_scone.png" alt=""><span>scone</span></div><span class="top-note">SOUND LAB / LIVE CODE</span><div class="transport"><button class="icon-btn primary" id="play">▶ Play</button></div><span class="top-spacer"></span><button class="tool-btn" id="load-starter">Load sample</button><button class="tool-btn" id="perform">MIDI off</button><button class="tool-btn" id="docs">Guide</button><button class="tool-btn" id="fullscreen">⛶</button></header>
  <main class="workspace"><section class="editor-float ui"><div class="editor-title">song.js</div><div id="editor" style="height:100%"></div></section>
  <aside class="lab-panel ui hidden" id="lab-panel"><div class="panel-heading"><div><span class="eyebrow">SOUND DESIGN</span><h1>Waveform lab</h1></div><button class="tool-btn" id="lab-close">Close</button></div>
    <div class="lab-tabs"><button class="active" data-axis="waveform">Wave</button><button data-axis="filter">Filter</button><button data-axis="envelope">Envelope</button></div>
    <div class="lab-modes"><button class="active" data-mode="draw">Draw</button><button data-mode="equation">Equation</button><label>NAME <input id="lab-name" value="softWave" spellcheck="false"></label></div>
    <canvas id="lab-graph" width="640" height="240" aria-label="Draw a waveform or filter curve"></canvas>
    <label class="equation-label">FUNCTION / EQUATION<input id="lab-equation" value="sin(2*pi*f*t)" spellcheck="false"></label>
    <div class="lab-help" id="lab-help">Draw one repeating wave cycle. Use <code>t</code> from 0 to 1 and <code>f</code> as the note frequency.</div>
    <div class="lab-actions"><button class="icon-btn primary" id="lab-insert">Add to code</button><button class="tool-btn" id="load-audio">＋ Upload sound</button><input type="file" id="audio-file" accept="audio/*" hidden></div>
    <div class="panel-divider"></div><div class="panel-subhead"><span>YOUR SOUNDS</span><span id="sound-count">0</span></div><div id="bank-content"></div>
  </aside></main>
  <aside class="mini-docs" id="docs-panel"><div class="panel-heading"><h2>scone guide</h2><button class="tool-btn" id="docs-close">Close</button></div><p>Write plain JavaScript. <code>main(() =&gt; {})</code> runs on the internal sixteenth-note clock. Edits apply at the next bar.</p><p>Define a sound with <code>waveform()</code>, make a Euclidean rhythm with pattern tuples, connect them, then call <code>voice.play()</code> inside <code>main()</code>. Add <code>.scale("c minor")</code>, <code>.filter(filterForm)</code>, or multiply a pattern by <code>2</code> or <code>0.5</code> to change speed.</p><p><a href="${import.meta.env.BASE_URL}scone-starter.js" download>Download the full sample code</a>. Wave equations accept calculator functions such as <code>sin</code>, <code>sqrt</code>, <code>^</code>, and <code>pi</code>.</p></aside>
  <aside id="sound-panels" aria-live="off"></aside>
  <div class="status ui" id="status"></div>
  <div class="splash" id="loading">scone · loading browser audio and editor…</div>`

const audio = new AudioEngine(), shapes = new ShapeField(document.querySelector<HTMLCanvasElement>('#shapes')!), db = new SconeDatabase()
connectVisualAudio(audio)
let activeProgram:ScheduledProgram|null=null,pendingSource:string|null=null,dirty=false,running=false,absoluteStep=0,nextAudioTime=0,stepDuration=60/140/4,activeTempo=140,activeKey=parseKey('c minor'),heldSilence=false,performance=false,notesCapture=false,captureStartStep=0,saveTimer=0,recorder:MediaRecorder|null=null,recordedChunks:BlobPart[]=[],recordedStream:MediaStream|null=null,micStream:MediaStream|null=null,captureName='',noteEvents=new Map<number,number>(),currentSourceLine=-1
const performanceEvents=new Map<number,{name:string;midi:number;vol:number}[]>()
let storedSamples:SampleRecord[]=[],savedSongs:SongRecord[]=[],trimRanges=new Map<string,[number,number]>(),chromaticPiano=false
const persistentState:Record<string,unknown>={}
const pressedKeys=new Set<string>(),justPressedKeys=new Set<string>(),rhythmPatterns=new Map<string,Pattern>(),rhythmCodeHits=new Set<string>(),firedHistory:FiredStep[]=[]
const waveDefinitions=new Map<string,Float32Array>(),filterDefinitions=new Map<string,Float32Array>(),envelopeDefinitions=new Map<string,Float32Array>(),distortionDefinitions=new Map<string,Float32Array>()
let scopeSelection='lead'
const screenShapeDeclarations=new Set<string>()
const screenPanelDeclarations=new Map<string,Set<string>>()
let screenOscillatorDeclared=false
const $=<T extends Element=HTMLElement>(selector:string):T=>document.querySelector<T>(selector)!
let transportStartAudio=0
function onAudioTime(time:number,callback:()=>void):void{const delay=Math.max(0,(time-(audio.context?.currentTime??time))*1000);window.setTimeout(callback,delay)}
const setFiredLine=StateEffect.define<number|null>()
const firedLineField=StateField.define<DecorationSet>({
  create:()=>Decoration.none,
  update:(decorations:DecorationSet,transaction:Transaction)=>{decorations=decorations.map(transaction.changes);for(const effect of transaction.effects)if(effect.is(setFiredLine)){const line=effect.value;if(line===null||!editorView||line<0||line>=editorView.state.doc.lines)decorations=Decoration.none;else{const from=editorView.state.doc.line(line+1).from;decorations=Decoration.set(Decoration.line({class:'cm-fired-line'}).range(from))}}return decorations},
  provide:(field:StateField<DecorationSet>)=>EditorView.decorations.from(field),
})

function status(message:string,error=false,sticky=false):void{const el=$<HTMLDivElement>('#status');el.textContent=message;el.classList.toggle('error',error);el.classList.add('show');if(!sticky){window.clearTimeout(statusTimer);statusTimer=window.setTimeout(()=>el.classList.remove('show'),error?5000:2200)}}
let statusTimer=0
function midiLabel(midi:number):string{const names=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];return `${names[((Math.round(midi)%12)+12)%12]}${Math.floor(midi/12)-1}`}
function keyLabel(k:MusicKey):string{return `${k.tonic.replace('b','♭').replace('#','♯').toUpperCase()} ${k.scale}`}
function scaleNotes(key:MusicKey):number[]{return Array.from({length:key.intervals.length*2},(_,i)=>degreeToMidi(i+1,0,key))}
function midiToDegree(midi:number,key:MusicKey):number{let best=1,dist=Infinity;for(let d=1;d<=key.intervals.length*3;d++){const n=degreeToMidi(d,Math.floor((midi-60)/12)-Math.floor((d-1)/key.intervals.length),key),delta=Math.abs(n-midi);if(delta<dist){best=d;dist=delta}}return best}
function asPattern(events:PatternEvent[]):Pattern{return Object.freeze({kind:'pattern',steps:Object.freeze(events)})}
function equationWave(expression:string,points=128):Float32Array{
  const source=expression.trim().replace(/\^/g,'**'),fract=(x:number)=>x-Math.floor(x),tri=(x:number)=>1-4*Math.abs(fract(x)-.5),saw=(x:number)=>2*fract(x)-1
  const fn=new Function('t','f','pi','sin','cos','tan','abs','sqrt','pow','exp','log','log10','sgn','tri','saw',`"use strict"; return (${source})`) as (t:number,f:number,pi:number,sin:typeof Math.sin,cos:typeof Math.cos,tan:typeof Math.tan,abs:typeof Math.abs,sqrt:typeof Math.sqrt,pow:typeof Math.pow,exp:typeof Math.exp,log:typeof Math.log,log10:typeof Math.log10,sgn:typeof Math.sign,tri:(x:number)=>number,saw:(x:number)=>number)=>number
  const values=new Float32Array(points);let peak=0
  for(let i=0;i<points;i++){const t=i/points,value=fn(t,1,Math.PI,Math.sin,Math.cos,Math.tan,Math.abs,Math.sqrt,Math.pow,Math.exp,Math.log,Math.log10,Math.sign,tri,saw);if(!Number.isFinite(value))throw new Error(`Wave equation returned an invalid value at t=${t.toFixed(2)}.`);values[i]=value;peak=Math.max(peak,Math.abs(value))}
  if(peak>1)for(let i=0;i<values.length;i++)values[i]/=peak
  return values
}
function equationFilter(expression:string,points=128):Float32Array{const source=expression.trim().replace(/\^/g,'**'),returnsDb=/\blog10?\s*\(/.test(source),transfer=source.includes('s'),cutoff=source.match(/2\s*\*\s*pi\s*\*\s*([\d.]+)/i),fn=transfer?null:new Function('t','f','pi','sin','cos','abs','sqrt','pow','log','log10','exp',`return (${source})`) as (t:number,f:number,pi:number,sin:typeof Math.sin,cos:typeof Math.cos,abs:typeof Math.abs,sqrt:typeof Math.sqrt,pow:typeof Math.pow,log:typeof Math.log,log10:typeof Math.log10,exp:typeof Math.exp)=>number;if(transfer&&!cutoff)throw new Error('For an s-domain filter, include a cutoff such as 1/(2*pi*200).');return Float32Array.from({length:points},(_,i)=>{const t=i/(points-1),f=20*1000**t,value=transfer?1/Math.sqrt(1+(f/Number(cutoff![1]))**2):fn!(t,f,Math.PI,Math.sin,Math.cos,Math.abs,Math.sqrt,Math.pow,Math.log,Math.log10,Math.exp),db=returnsDb||value<0?value:value===0?-60:20*Math.log10(value);if(!Number.isFinite(value))throw new Error('Filter equation must return a finite linear gain or dB value.');return Math.max(-1,Math.min(0,db/60))})}
function equationDistortion(expression:string,points=256):Float32Array{const fn=new Function('x','pi','sin','cos','abs','pow','sgn',`return (${expression.replace(/\^/g,'**')})`) as (x:number,pi:number,sin:typeof Math.sin,cos:typeof Math.cos,abs:typeof Math.abs,pow:typeof Math.pow,sgn:typeof Math.sign)=>number;const curve=Float32Array.from({length:points},(_,i)=>{const x=i/(points-1)*2-1,y=fn(x,Math.PI,Math.sin,Math.cos,Math.abs,Math.pow,Math.sign);if(!Number.isFinite(y))throw new Error('Distortion equation returned an invalid value.');return y});let peak=0;for(const y of curve)peak=Math.max(peak,Math.abs(y));if(peak>1)for(let i=0;i<curve.length;i++)curve[i]/=peak;return curve}
function normalizeWave(data:number[]|Float32Array):Float32Array{const values=Float32Array.from(data.slice(0,2048),v=>Math.max(-1,Math.min(1,Number(v)||0)));if(values.length<16)throw new Error('A drawn waveform needs at least 16 points.');return values}
let labAxis:'waveform'|'filter'|'envelope'='waveform',labMode:'draw'|'equation'='draw',labData=equationWave('sin(2*pi*f*t)'),drawingLab=false
function labPreview():Float32Array{try{const eq=$<HTMLInputElement>('#lab-equation').value;return labAxis==='filter'?equationFilter(eq):equationWave(eq)}catch{return labData}}
function drawLab():void{const canvas=$<HTMLCanvasElement>('#lab-graph'),ctx=canvas.getContext('2d');if(!ctx)return;const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.strokeStyle='#dfe2df';ctx.lineWidth=1;for(let i=1;i<8;i++){ctx.beginPath();ctx.moveTo(w*i/8,0);ctx.lineTo(w*i/8,h);ctx.stroke()}for(let i=1;i<4;i++){ctx.beginPath();ctx.moveTo(0,h*i/4);ctx.lineTo(w,h*i/4);ctx.stroke()}const values=labMode==='equation'?labPreview():labData;ctx.strokeStyle='#59615d';ctx.lineWidth=2;ctx.beginPath();values.forEach((v,i)=>{const x=i/(values.length-1)*w,y=labAxis==='filter'?-Math.max(-1,Math.min(0,v))*h:labAxis==='envelope'?h-Math.max(0,Math.min(1,v))*h:h/2-v*h*.44;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});ctx.stroke();ctx.fillStyle='#888e8a';ctx.font='10px ui-monospace';ctx.fillText(labAxis==='filter'?'20 Hz':labAxis==='envelope'?'attack':'0',7,h-8);ctx.fillText(labAxis==='filter'?'20 kHz':labAxis==='envelope'?'release':'time',w-48,h-8);ctx.fillText(labAxis==='filter'?'0 dB':'1',7,13);ctx.fillText(labAxis==='filter'?'-60 dB':'-1',7,h-22)}
function updateLab():void{const equation=$<HTMLInputElement>('.equation-label'),field=$<HTMLInputElement>('#lab-equation');equation.style.display=labMode==='equation'?'block':'none';field.placeholder=labAxis==='filter'?'for example -24*log10(f/20)':'for example sin(2*pi*f*t)';$('#lab-help')!.innerHTML=labAxis==='waveform'?'Draw one repeating wave cycle. <code>t</code> is 0–1; <code>f</code> is normalized and note pitch transposes the table.':'Draw an editable curve or type an equation. Filter frequency uses a logarithmic 20 Hz–20 kHz axis; envelope is amplitude over time.';drawLab()}
function drawAt(event:PointerEvent):void{const canvas=$<HTMLCanvasElement>('#lab-graph'),r=canvas.getBoundingClientRect(),x=Math.max(0,Math.min(.999,(event.clientX-r.left)/r.width)),y=Math.max(-1,Math.min(1,(.5-(event.clientY-r.top)/r.height)*2)),i=Math.floor(x*labData.length);labData[i]=labAxis==='filter'?Math.max(-1,Math.min(0,y)):labAxis==='envelope'?Math.max(0,(y+1)/2):y;drawLab()}
function parseSourceLine():number{const stack=new Error().stack||'';const m=stack.match(/scone-user\.js:(\d+):\d+/);return m?Math.max(0,Number(m[1])-1):-1}
function setEditorDiagnostic(message:string,line:number):void{if(!editorView||line<0)return;const doc=editorView.state.doc,from=Math.min(doc.length,doc.line(Math.min(doc.lines,line+1)).from),to=doc.line(Math.min(doc.lines,line+1)).to;editorView.dispatch(setDiagnostics(editorView.state,[{from,to,severity:'error',message}]))}

function newEnv(compiling=false):Env{return{main:null,key:activeKey,tempo:activeTempo,pendingKey:null,pendingTempo:null,compiling,tick:{step:0,beat:0,bar:0,time:0},queue:[],fired:new Set(),patterns:new Map(),muted:new Set(),silent:false,piano:null}}
let editorView:EditorView|null=null
const theme=EditorView.theme({
  '&':{height:'100%',backgroundColor:'transparent'},'.cm-content':{caretColor:'#292a2b'},'.cm-cursor,.cm-dropCursor':{borderLeftColor:'#292a2b'},'&.cm-focused .cm-selectionBackground,::selection':{backgroundColor:'#bcc3c377'},'.cm-gutters':{minWidth:'34px'},'.cm-activeLine':{backgroundColor:'transparent'},'.cm-selectionMatch':{backgroundColor:'#11111110'},'.cm-scroller':{lineHeight:'1.85'},'.cm-tooltip':{zIndex:'30'}
})
const helperDocs:Record<string,string>={
  main:'Runs your music callback on the internal step clock: main(() => {}). No beat or bar arguments are needed.',tempo:'Sets the tempo in BPM.',key:'Sets the global tonic and scale.',pattern:'Makes a rhythm from Euclidean degree groups such as pattern("1(3,8,0) 5(2,8,2)").',degrees:'Makes notes as degrees in the current key.',notes:'Makes notes from names such as c4 and eb3.',track:'Plays a pattern on a named sound.',play:'Triggers a named sound or sample.',connect:'Connects a sound to a pattern; call .play() inside main(). Multiplying a pattern by 2 speeds it up.',waveform:'Makes a pitched wavetable from equation text or drawn samples.',filterform:'Makes a log-frequency filter response from dB or linear gain.',envelope:'Makes an amplitude contour.',distort:'Makes a waveshaper from an equation in x.',gain:'Sets the gain for a named sound.',irand:'Returns a random integer from zero to max-1.',live:'Turns the computer keyboard and MIDI into a scale-locked piano; call .on() to enable it.',delay:'Adds a feedback delay to a named sound.',scale:'Sets a pattern scale or returns pitches in the current key.',listen:'Reads audio for visuals without changing the sound.',shapes:'Adds one of the three toy objects that bounce on a sound hit.',screen:'Adds an audio scope, spectrum, piano roll, sound-reactive shape, or oscillator visual.',osc:'Makes a grayscale oscillator visual.',noise:'Makes slow aurora-like grayscale noise.',voronoi:'Makes a cellular visual source.',shape:'Makes a polygon visual source.',gradient:'Makes a grayscale gradient source.',solid:'Makes a solid grayscale source.',grid:'Makes a grid visual source.',out:'Draws a chain behind the editor.'
}
Object.assign(helperDocs,{rotate:'Rotate a visual source.',scale:'Change visual zoom.',kaleid:'Reflect the visual into radial symmetry.',pixelate:'Reduce visual resolution.',repeat:'Tile the visual.',color:'Tint a source; the starter uses grayscale.',colorama:'Cycle source values.',invert:'Invert source luminance.',thresh:'Threshold source luminance.',modulate:'Warp a source with another source.',diff:'Show source difference.',blend:'Blend two visual sources.',mult:'Multiply visual sources.',feedback:'Blend a previous frame.',level:'Audio tap RMS level.',fft:'Audio tap spectrum bins.',wave:'Audio tap waveform.',hit:'Audio tap transient.',band:'Average energy between two frequencies.',lpf:'Low-pass analysis filter.',hpf:'High-pass analysis filter.',bpf:'Band-pass analysis filter.'})
const completionList=Object.keys(helperDocs).map(label=>({label,type:'function' as const,info:helperDocs[label]||'Scone JavaScript helper.'}))
const helperCompletion=javascriptLanguage.data.of({autocomplete:completeFromList([...completionList,snippetCompletion('main(() => {\n  $0\n})',{label:'main',type:'snippet'}),snippetCompletion('track("kick", pattern("X... ..x. ..x. ...."))',{label:'kick pattern',type:'snippet'}),snippetCompletion('osc(() => 40 + low.level * 120, 0.08).kaleid(6).out()',{label:'reactive visual',type:'snippet'})])})
const helperHover=hoverTooltip((view:EditorView,pos:number)=>{const line=view.state.doc.lineAt(pos),col=pos-line.from,match=line.text.slice(0,col).match(/[\w.]+$/),tail=line.text.slice(col).match(/^[\w.]+/),name=(match?.[0]||'')+(tail?.[0]||'');const key=name.replace(/^\./,'').replace(/\(.*$/,'');const info=helperDocs[key];if(!info)return null;return{pos:line.from+Math.max(0,col-(match?.[0].length||0)),end:line.from+col+(tail?.[0].length||0),create(){const dom=document.createElement('div');dom.className='scone-hover';dom.innerHTML=`<b>${escapeHtml(name)}</b><div>${escapeHtml(info)}</div>`;return{dom}}}})
const copySelection=(view:EditorView)=>{void navigator.clipboard?.writeText(view.state.sliceDoc(view.state.selection.main.from,view.state.selection.main.to)).catch(()=>{});return true}
const pasteSelection=(view:EditorView)=>{void navigator.clipboard?.readText().then(text=>view.dispatch(view.state.replaceSelection(text))).catch(()=>{});return true}
const keyBindings=[{key:'Ctrl-Enter',run:()=>{if(running)stopTransport();else void startTransport();return true}},{key:'Mod-Enter',run:()=>{if(running)stopTransport();else void startTransport();return true}},{key:'Ctrl-z',run:undo},{key:'Ctrl-c',run:copySelection},{key:'Ctrl-v',run:pasteSelection},{key:'Tab',run:(view:EditorView)=>{view.dispatch(view.state.replaceSelection('  '));return true}}]

function createHelpers(env:Env):Record<string,unknown>{
  const requestTempo=(value:number)=>{const n=Math.round(Number(value));if(!Number.isFinite(n)||n<40||n>240)throw new Error('tempo(bpm) must be between 40 and 240.');if(env.compiling)env.tempo=n;else if(env.tick.beat===0){env.tempo=n;activeTempo=n;stepDuration=60/n/4}else env.pendingTempo=n}
  const requestKey=(value:string)=>{const parsed=parseKey(value);if(env.compiling)env.key=parsed;else if(env.tick.beat===0){env.key=parsed;activeKey=parsed}else env.pendingKey=parsed}
  const queueSound=(name:string,note?:number|string,options:PlayOptions={},source:'pattern'|'code'='code',follows?:Pattern,roll?:number)=>{if(!name)throw new Error('play needs a sound name.');env.fired.add(name);env.queue.push({name,note,options,source,follows,roll});currentSourceLine=parseSourceLine()}
  const queuePlayer=(name:string,note?:number|string,options:PlayOptions={})=>{const melodic=['808','bass','lead','acid','supersaw','pluck','pad','bell','techno'];if(melodic.includes(name.toLowerCase())&&note!==undefined){if(typeof note==='number')note=quantizeMidi(note,env.key);else{const event=notes(note).steps[0];if(event.kind!=='note')throw new Error(`Invalid play note "${note}".`);note=quantizeMidi(event.midi,env.key)}}queueSound(name,note,options)}
  const track=(name:string,p:Pattern)=>{
    if(!p||p.kind!=='pattern')throw new Error(`track("${name}", pattern) needs a pattern made with pattern(), degrees(), or notes().`)
    env.patterns.set(name,p);rhythmPatterns.set(name,p)
    const event=p.steps[env.tick.step%p.steps.length];if(event.kind==='rest')return
    env.fired.add(name);currentSourceLine=parseSourceLine()
    if(event.kind==='hit')queueSound(name,undefined,{at:env.tick.time,vol:event.velocity},'pattern',p,event.roll)
    else if(event.kind==='degree')queueSound(name,degreeToMidi(event.degree,event.octave,env.key),{at:env.tick.time,vol:event.velocity},'pattern',p)
    else queueSound(name,quantizeMidi(event.midi,env.key),{at:env.tick.time,vol:event.velocity},'pattern',p)
  }
  const scale=()=>{const values=scaleNotes(env.key) as number[]&{pick:()=>number};values.pick=()=>values[Math.floor(Math.random()*values.length)];return values}
  const connect=(sound:string,p:Pattern|{pattern:Pattern;speed:number},speed=1)=>{
    if('pattern' in p){speed=p.speed;p=p.pattern}
    const pat=p as Pattern & {key?:MusicKey;filterform?:{values?:Float32Array}}
    if(pat.filterform?.values)audio.setFilterForm(sound,pat.filterform.values)
    let pausedUntil=-Infinity,manuallyPaused=false
    env.patterns.set(sound,pat);rhythmPatterns.set(sound,pat)
    const connected:{sound:string;pattern:Pattern;play:()=>void;pause:(seconds?:number)=>void;silence:()=>void;resume:()=>void;isPlaying:()=>boolean;gain:(value:number)=>unknown;scale:(name:string)=>unknown;filter:(form:unknown)=>unknown;envelope:(form:unknown)=>unknown;distort:(form:unknown)=>unknown}={
      sound,pattern:pat,
      play:()=>{if(manuallyPaused||env.tick.time<pausedUntil)return;const rate=Math.max(.125,Math.min(8,Number(speed)||1)),previous=env.tick.step?Math.floor((env.tick.step-1)*rate):-1,current=Math.floor(env.tick.step*rate);for(let index=previous+1;index<=current;index++){const event=pat.steps[((index%pat.steps.length)+pat.steps.length)%pat.steps.length];if(event.kind==='rest')continue;const note=event.kind==='degree'?degreeToMidi(event.degree,event.octave,pat.key||env.key):event.kind==='note'?quantizeMidi(event.midi,pat.key||env.key):undefined,at=env.tick.time+Math.max(0,(index/rate-env.tick.step)*stepDuration);queueSound(sound,note,{at,vol:event.velocity},'pattern',pat,event.kind==='hit'?event.roll:1)}},
      pause:(seconds?:number)=>{if(seconds===undefined)manuallyPaused=true;else pausedUntil=env.tick.time+Math.max(0,seconds)},silence:()=>{manuallyPaused=true},resume:()=>{manuallyPaused=false;pausedUntil=-Infinity},isPlaying:()=>!manuallyPaused&&env.tick.time>=pausedUntil&&env.fired.has(sound),
      gain:(value:number)=>{audio.setGain(sound,value);return connected},scale:(name:string)=>{requestKey(name);return connected},filter:(form:unknown)=>{const values=(form as {values?:Float32Array})?.values;if(values)audio.setFilterForm(sound,values);return connected},envelope:(form:unknown)=>{const values=(form as {values?:Float32Array})?.values;if(values)audio.setEnvelope(sound,values);return connected},distort:(form:unknown)=>{const values=(form as {values?:Float32Array})?.values;if(values)audio.setDistortion(sound,values);return connected}
    }
    return connected
  }
  const defineWave=(nameOrSource:string|number[],maybeSource?:string|number[])=>{const name=maybeSource===undefined?`waveform${waveDefinitions.size+1}`:String(nameOrSource),source=maybeSource===undefined?nameOrSource:maybeSource;if(!audio.context)throw new Error('Press Play before defining a wavetable.');const values=Array.isArray(source)?normalizeWave(source):equationWave(source);audio.addWavetable(name,values);waveDefinitions.set(name,values);return name}
  const defineFilter=(nameOrSource:string|number[],maybeSource?:string|number[])=>{const name=maybeSource===undefined?`filterform${filterDefinitions.size+1}`:String(nameOrSource),source=maybeSource===undefined?nameOrSource:maybeSource,values=Array.isArray(source)?normalizeWave(source):equationFilter(source);filterDefinitions.set(name,values);return{name,kind:'filterform',values}}
  const defineEnvelope=(nameOrSource:string|number[],maybeSource?:string|number[])=>{const name=maybeSource===undefined?`envelope${envelopeDefinitions.size+1}`:String(nameOrSource),source=maybeSource===undefined?nameOrSource:maybeSource,values=Array.isArray(source)?normalizeWave(source):equationWave(source);envelopeDefinitions.set(name,values);return{name,kind:'envelope',values}}
  const defineDistortion=(name:string,source:string)=>{const values=equationDistortion(source);distortionDefinitions.set(name,values);return{name,kind:'distortion',values}}
  return{
    state:persistentState,speedPattern:(p:Pattern,multiplier:number)=>({pattern:p,speed:multiplier}),
    main:(fn:Env['main'])=>{if(typeof fn!=='function')throw new Error('main(callback) needs a function.');env.main=fn},
    tempo:requestTempo,key:requestKey,pattern:(source:string|number[][])=>{type ChainedPattern=Pattern & {key?:MusicKey;filterform?:{values?:Float32Array};scale?:(name:string)=>Pattern;filter?:(form:unknown)=>Pattern};const decorate=(p:ChainedPattern):ChainedPattern=>{p.scale=(name:string)=>decorate(Object.assign(Object.create(Object.getPrototypeOf(p)),p,{key:parseKey(name)}));p.filter=(form:unknown)=>{p.filterform=form as {values?:Float32Array};return p};return p};const base=typeof source==='string'?pattern(source):join(...source.map(group=>euclideanPattern(group[0],group[1],group[2],group[3]||0)));return decorate(base as ChainedPattern)},degrees,notes,
    track,
    play:(sound:string|SampleSlice,note?:number|string,options:PlayOptions={})=>{if(typeof sound==='string')queuePlayer(sound,note,options);else queueSound(sound.sample,undefined,{...options,start:sound.start,duration:sound.duration},'code')},
    live:(sound:string,keyName?:string)=>({on:()=>{env.piano=sound;if(keyName)requestKey(keyName);performance=true;updatePerformanceLabel();void enableMidi()},off:()=>{if(env.piano===sound){performance=false;updatePerformanceLabel()}}}),
    piano:(sound:string,keyName?:string)=>({on:()=>{env.piano=sound;if(keyName)requestKey(keyName);performance=true;updatePerformanceLabel();void enableMidi()},off:()=>{if(env.piano===sound){performance=false;updatePerformanceLabel()}}}),
    delay:(name:string,time=.24,feedback=.34,wet=.2)=>audio.delay(name,time,feedback,wet),
    scale,
    euclid:euclideanPattern,connect,waveform:defineWave,filterform:defineFilter,envelope:defineEnvelope,distort:defineDistortion,gain:(name:string,value:number)=>audio.setGain(name,value),irand:(max:number)=>Math.floor(Math.random()*Math.max(1,Math.trunc(max))),
    listen:(name:string)=>listen(audio,name),osc,noise,voronoi,shape,gradient,solid,grid,
    shapes:(kind:string|string[],options:Parameters<ShapeField['add']>[1]={})=>shapes.add(kind,options),
    screen:{scope:(sound:unknown)=>registerSoundPanel(sound,'scope'),spectrum:(sound:unknown)=>registerSoundPanel(sound,'spectrum'),pianoRoll:(sound:unknown)=>registerSoundPanel(sound,'piano roll'),shapes:(kind:string,sound?:unknown)=>{const key=kind==='spheres'?'blue-sphere':kind==='monkey'?'wooden-monkey':kind==='puck'?'hockey-puck':kind,source=typeof sound==='string'?sound:String((sound as {sound?:string})?.sound||scopeSelection);if(!screenShapeDeclarations.has(`${key}:${source}`)){screenShapeDeclarations.add(`${key}:${source}`);shapes.add(key,{follows:source})}},oscillator:(frequency?:number|(()=>number),speed?:number,offset?:number)=>{if(!screenOscillatorDeclared){screenOscillatorDeclared=true;osc(frequency,speed,offset).out()}}},
  }
}

function transformPatternSpeeds(source:string):string{
  const names=[...source.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*pattern\s*\(/g)].map(m=>m[1]);let out=source;for(const name of names)out=out.replace(new RegExp(`\\b${name}\\s*\\*\\s*(\\d+(?:\\.\\d+)?)\\b`,'g'),`speedPattern(${name},$1)`);return out
}
function soundName(sound:unknown):string{return typeof sound==='string'?sound:String((sound as {sound?:string})?.sound||'lead')}
function registerSoundPanel(sound:unknown,kind:string):void{const name=soundName(sound),items=screenPanelDeclarations.get(name)||new Set<string>();items.add(kind);screenPanelDeclarations.set(name,items);scopeSelection=name}
function renderSoundPanels():void{const root=$<HTMLElement>('#sound-panels'),rows=[...screenPanelDeclarations].map(([sound,kinds])=>`<section class="sound-card"><header>${escapeHtml(sound)}</header>${[...kinds].map(kind=>`<div class="sound-chart"><label>${kind}</label><canvas width="280" height="72" data-sound="${escapeHtml(sound)}" data-kind="${kind}"></canvas></div>`).join('')}</section>`).join('');root.innerHTML=rows}
function drawSoundPanels():void{requestAnimationFrame(drawSoundPanels);for(const canvas of document.querySelectorAll<HTMLCanvasElement>('#sound-panels canvas')){const name=canvas.dataset.sound||'',kind=canvas.dataset.kind||'',ctx=canvas.getContext('2d')!,meter=audio.meter(name),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.strokeStyle='#6c716f';ctx.fillStyle='#858b88';ctx.lineWidth=1.2;if(kind==='scope'){ctx.beginPath();for(let i=0;i<meter.wave.length;i++){const x=i/(meter.wave.length-1)*w,y=h/2-(meter.wave[i]-128)*h/300;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)}ctx.stroke()}else if(kind==='spectrum'){for(let i=0;i<48;i++){const v=(meter.fft[Math.floor(i/48*meter.fft.length)]||0)/255;ctx.fillRect(i*6, h-v*h, 3, v*h)}}else{ctx.strokeStyle='#d8dbd9';for(let i=1;i<4;i++){ctx.beginPath();ctx.moveTo(0,i*h/4);ctx.lineTo(w,i*h/4);ctx.stroke()}const p=rhythmPatterns.get(name);if(p)for(let i=0;i<16;i++){const e=p.steps[i%p.steps.length];if(e.kind==='rest')continue;const x=i*w/16+2;ctx.fillStyle=e.kind==='hit'?'#89918c':'#4e5853';ctx.fillRect(x,h-14,Math.max(4,w/20),7)}}}}

function compile(source:string,compilingAtBoundary:boolean):ScheduledProgram{
  const previousPanels=new Map([...screenPanelDeclarations].map(([name,kinds])=>[name,new Set(kinds)]));screenShapeDeclarations.clear();screenPanelDeclarations.clear();screenOscillatorDeclared=false;const env=newEnv(compilingAtBoundary),helpers=createHelpers(env),names=Object.keys(helpers),values=Object.values(helpers)
  beginVisualTransaction();shapes.beginTransaction()
  try{const execute=new Function(...names,`${transformPatternSpeeds(source)}\n//# sourceURL=scone-user.js`);execute(...values);if(!env.main)throw new Error('Add main(() => { ... }) to make the song run.');env.compiling=false;commitVisualTransaction();shapes.commitTransaction();renderSoundPanels();return{source,env}}
  catch(error){rollbackVisualTransaction();shapes.rollbackTransaction();screenPanelDeclarations.clear();for(const [name,kinds] of previousPanels)screenPanelDeclarations.set(name,kinds);renderSoundPanels();const e=error as Error;const m=e.stack?.match(/scone-user\.js:(\d+):\d+/);const line=m?Number(m[1])-1:-1;throw Object.assign(new Error(e.message),{line})}
}

let code=STARTER
function initializeEditor():void{
  const initial=decodeSongHash();if(initial)code=initial
  editorView=new EditorView({doc:code,extensions:[basicSetup,javascript(),helperCompletion,helperHover,theme,firedLineField,keymap.of(keyBindings),EditorView.updateListener.of((update:ViewUpdate)=>{if(update.docChanged){code=update.state.doc.toString();let design:RegExpMatchArray|null=null;update.changes.iterChangedRanges((_fromA,_toA,fromB)=>{design=update.state.doc.lineAt(fromB).text.match(/\b(waveform|filterform|envelope)\s*\(/)});if(design){const panel=$('#lab-panel');panel?.classList.remove('hidden');labAxis=design[1]==='filterform'?'filter':design[1]==='envelope'?'envelope':'waveform';document.querySelectorAll('[data-axis]').forEach(node=>node.classList.toggle('active',(node as HTMLElement).dataset.axis===labAxis));updateLab()}dirty=true;pendingSource=code;window.clearTimeout(saveTimer);saveTimer=window.setTimeout(()=>{void saveAutosave()},650);status(running?'Code queued for the next bar':'Code changed · press Play to run')}})],parent:document.querySelector('#editor')!})
  $('#loading')?.classList.add('hidden')
}
function decodeSongHash():string|null{const match=location.hash.match(/(?:^#|&)s=([^&]+)/);if(!match)return null;try{return decodeURIComponent(escape(atob(match[1])))}catch{return null}}
function clearDiagnostics():void{if(editorView)editorView.dispatch(setDiagnostics(editorView.state,[]))}
let previousProgram:ScheduledProgram|null=null
function commitCompiled(program:ScheduledProgram,initial=false):void{if(!initial&&activeProgram)previousProgram=activeProgram;activeProgram=program;activeKey=program.env.key;activeTempo=program.env.tempo;stepDuration=60/activeTempo/4;clearDiagnostics();void persistWavetables();status(initial?`Playing · ${keyLabel(activeKey)}`:`Changes applied · ${keyLabel(activeKey)}`)}
function scaleDescription(scale:string):string{return({minor:'dark and familiar',major:'bright and open',phrygian:'dark and tense', 'harmonic minor':'dramatic and eastern',dorian:'cool and soulful',pentatonic:'open and simple',chromatic:'all twelve notes'} as Record<string,string>)[scale]||scale}

async function startTransport():Promise<void>{
  try{await audio.start();audio.setMasterLevel(heldSilence?0:1,.005);for(const sample of storedSamples)await ensureSampleLoaded(sample);rhythmPatterns.clear();activeProgram=null;const program=compile(editorView?.state.doc.toString()||code,true);pendingSource=null;dirty=false;commitCompiled(program,true);absoluteStep=0;nextAudioTime=audio.context!.currentTime+.08;transportStartAudio=nextAudioTime;running=true;$('#play')!.textContent='Ⅱ Pause';$('#play')!.classList.add('primary');schedule();status('Transport running · edits apply at the next bar')}
  catch(error){const e=error as Error&{line?:number};status(e.message,true,true);setEditorDiagnostic(e.message,e.line??-1)}
}
function stopTransport():void{running=false;window.clearTimeout(timer);timer=0;$('#play')!.textContent='▶ Play';$('#play')!.classList.remove('primary');audio.setMasterLevel(0,.02);status('Paused · press Play to resume')}
let timer=0
function applyBarBoundary():void{
  if(activeProgram){const old=activeProgram.env;if(old.pendingKey){activeKey=old.pendingKey;old.key=activeKey;old.pendingKey=null}if(old.pendingTempo){activeTempo=old.pendingTempo;old.tempo=activeTempo;old.pendingTempo=null}}
  if(pendingSource!==null){const source=pendingSource;pendingSource=null;try{const next=compile(source,true);rhythmPatterns.clear();commitCompiled(next);dirty=false}catch(error){const e=error as Error&{line?:number};dirty=false;status(`Keeping last working code · ${e.message}`,true,true);setEditorDiagnostic(e.message,e.line??-1)}}
  if(activeProgram){activeProgram.env.key=activeKey;activeProgram.env.tempo=activeTempo}
  stepDuration=60/activeTempo/4
}
function schedule():void{
  if(!running||!audio.context)return
  const ctx=audio.context,lookahead=.13
  while(nextAudioTime<ctx.currentTime+lookahead){const step=absoluteStep++,beat=step%16,bar=Math.floor(step/16);if(beat===0)applyBarBoundary();const program=activeProgram;if(!program){nextAudioTime+=stepDuration;continue}
    const env=program.env;env.tick={step,beat,bar,time:nextAudioTime};env.queue=[];env.fired.clear();env.silent=heldSilence
    currentSourceLine=-1;try{program.env.main?.()}catch(error){const e=error as Error&{line?:number};const m=e.stack?.match(/scone-user\.js:(\d+):\d+/),line=e.line??(m?Number(m[1])-1:-1);env.queue.length=0;env.silent=true;if(previousProgram){activeProgram=previousProgram;previousProgram=null;activeKey=activeProgram.env.key;activeTempo=activeProgram.env.tempo;stepDuration=60/activeTempo/4;status(`Runtime error · restored last working code · ${e.message}`,true,true)}else status(`Runtime error · ${e.message} · transport remains live`,true,true);setEditorDiagnostic(e.message,line)}
    if(editorView)editorView.dispatch({effects:setFiredLine.of(currentSourceLine>=0?currentSourceLine:null)})
    const pauseAtThisStep=env.silent||heldSilence;onAudioTime(nextAudioTime,()=>{setVisualPause(pauseAtThisStep||heldSilence);shapes.setPaused(pauseAtThisStep||heldSilence)})
    for(const event of performanceEvents.get(step)||[])env.queue.push({name:event.name,note:event.midi,options:{vol:event.vol},source:'code'});performanceEvents.delete(step)
    const fired=new Map<string,'pattern'|'code'>(),noteLabels=new Map<string,string>()
    if(!env.silent&&!heldSilence){for(const cmd of env.queue){if(env.muted.has(cmd.name))continue;const at=cmd.options.at??nextAudioTime,options={...cmd.options,at,vol:cmd.options.vol??.78};if(cmd.roll&&cmd.roll>1)audio.triggerStep(cmd.name,at,options.vol,cmd.roll);else audio.play(cmd.name,cmd.note,options);onAudioTime(at,()=>{if(running){shapes.trigger(cmd.name,options.vol!);if(cmd.follows)shapes.triggerPattern(cmd.follows,options.vol!)}});fired.set(cmd.name,cmd.source);if(typeof cmd.note==='number')noteLabels.set(cmd.name,midiLabel(cmd.note));if(notesCapture&&typeof cmd.note==='number')noteEvents.set(step,cmd.note)}}
    firedHistory.push({step,sources:fired,notes:noteLabels});if(firedHistory.length>48)firedHistory.splice(0,firedHistory.length-48);justPressedKeys.clear()
    nextAudioTime+=stepDuration
  }
  timer=window.setTimeout(schedule,22)
}
function renderRhythm():void{
  requestAnimationFrame(renderRhythm);if(!running)return
  const currentBeat=Math.max(0,Math.floor((audio.context!.currentTime-transportStartAudio)/stepDuration)%16),bar=Math.floor((audio.context!.currentTime-transportStartAudio)/stepDuration/16)
  $('#rhythm-clock')!.textContent=`bar ${bar+1} · step ${currentBeat+1}`
  const root=$('#rhythm-content')!,names=new Set([...rhythmPatterns.keys(),...firedHistory.slice(-16).flatMap(x=>[...x.sources.keys()])]);if(!names.size){root.innerHTML='<div class="rhythm-empty">The rhythm strip shows coded and conditional hits.</div>';return}
  root.innerHTML=[...names].slice(0,7).map(name=>{const p=rhythmPatterns.get(name),cells=Array.from({length:16},(_,i)=>{const event=p?.steps[i%p.steps.length],wasHit=event&&event.kind!=='rest',last=firedHistory.find(x=>x.step%16===i),source=last?.sources.get(name),cls=(event?.kind==='hit'?(event.velocity>=.95?'accent':'hit'):wasHit?'soft':'')+(source==='code'?' code-hit':''),roll=event?.kind==='hit'&&event.roll>1?' roll':'',midi=event?.kind==='degree'?degreeToMidi(event.degree,event.octave,activeKey):event?.kind==='note'?quantizeMidi(event.midi,activeKey):undefined,height=midi===undefined?9:5+(midi%12)/11*9,note=midi===undefined?'':` · ${midiLabel(midi)}`;return `<span class="cell ${cls}${roll}${i===currentBeat?' playhead':''}" style="height:${height}px" title="${name} · step ${i+1}${note}"></span>`}).join('');const label=p?.steps.find(e=>e.kind==='degree'||e.kind==='note') as Extract<PatternEvent,{kind:'degree'|'note'}>|undefined;const note=label?.kind==='degree'?midiLabel(degreeToMidi(label.degree,label.octave,activeKey)):label?.kind==='note'?midiLabel(quantizeMidi(label.midi,activeKey)):'';return `<div class="rhythm-row"><span class="row-label">${escapeHtml(name)} ${note?`· ${note}`:''}</span>${cells}</div>`}).join('')
}
function escapeHtml(s:string):string{return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))}

function ensureMicAnalyser():void{if(micStream)audio.connectMicrophone(micStream)}
function micLevel():number{return audio.meter('mic').level}
function updatePerformanceLabel():void{$('#perform')!.textContent=performance?'Piano on':'Piano off';$('#perform')!.classList.toggle('primary',performance)}
function drawInstrumentPanels():void{requestAnimationFrame(drawInstrumentPanels);const source=$<HTMLSelectElement>('#scope-source').value,p=audio.meter(source),wave=$<HTMLCanvasElement>('#scope').getContext('2d')!,spectrum=$<HTMLCanvasElement>('#spectrum').getContext('2d')!,roll=$<HTMLCanvasElement>('#piano-roll').getContext('2d')!;wave.clearRect(0,0,640,72);wave.strokeStyle='#65706a';wave.lineWidth=1.5;wave.beginPath();for(let i=0;i<p.wave.length;i++){const x=i/(p.wave.length-1)*640,y=36-(p.wave[i]-128)*.24;if(i===0)wave.moveTo(x,y);else wave.lineTo(x,y)}wave.stroke();spectrum.clearRect(0,0,640,54);spectrum.fillStyle='#929a95';if(p.fft.length)for(let i=0;i<48;i++){const n=p.fft[Math.floor(i/48*p.fft.length)]/255;spectrum.fillRect(i*13+1,52-n*48,8,n*48)}roll.clearRect(0,0,640,80);roll.strokeStyle='#e0e2df';for(let i=1;i<8;i++){roll.beginPath();roll.moveTo(0,i*10);roll.lineTo(640,i*10);roll.stroke()}for(let i=0;i<16;i++){const event=rhythmPatterns.get(source)?.steps[i%(rhythmPatterns.get(source)?.steps.length||1)];if(!event||event.kind==='rest')continue;const midi=event.kind==='degree'?degreeToMidi(event.degree,event.octave,activeKey):event.kind==='note'?quantizeMidi(event.midi,activeKey):48,x=i*40+8,y=72-Math.max(0,Math.min(60,midi-36));roll.fillStyle=event.kind==='hit'?'#969d99':'#515b56';roll.fillRect(x,y,18,5)}}

async function saveAutosave():Promise<void>{try{await db.saveSong({id:'autosave-v2',name:'Autosave',code:editorView?.state.doc.toString()||code,updated:Date.now()})}catch{}}
async function loadLocalState():Promise<void>{try{savedSongs=await db.listSongs();const auto=savedSongs.find(s=>s.id==='autosave-v2');if(!location.hash&&auto){code=auto.code;savedSongs.sort((a,b)=>b.updated-a.updated)}storedSamples=await db.listSamples()}catch(error){status(`Local storage unavailable · ${(error as Error).message}`,true)}initializeEditor();renderSampleChips();renderBank();renderSavedSongs()}
async function ensureSampleLoaded(record:SampleRecord):Promise<void>{if(audio.sampleNames().includes(record.name))return;await audio.decodeSample(record.name,record.blob)}
async function addSample(name:string,blob:Blob):Promise<void>{if(!blob.size){status('The recording was empty.',true);return}try{await audio.start();const raw=await audio.context!.decodeAudioData(await blob.arrayBuffer()),trimmed=trimAndEncodeWav(raw),id=crypto.randomUUID(),record:SampleRecord={id,name,blob:trimmed,created:Date.now()};await db.saveSample(record);audio.addSample(name,await audio.context!.decodeAudioData(await trimmed.arrayBuffer()));storedSamples=await db.listSamples();status(`Saved ${name} · ready for play("${name}")`);renderSampleChips();renderBank()}catch(error){status(`Could not decode audio · ${(error as Error).message}`,true)}}
function sampleName():string{let n=1;while(storedSamples.some(s=>s.name===`sample${n}`))n++;return`sample${n}`}
function renderSampleChips():void{$('#sound-count')!.textContent=String(storedSamples.length)}
async function persistWavetables():Promise<void>{for(const [name] of waveDefinitions){if(storedSamples.some(sample=>sample.name===name))continue;const buffer=audio.sampleBuffer(name);if(!buffer)continue;try{const record:SampleRecord={id:crypto.randomUUID(),name,blob:trimAndEncodeWav(buffer),created:Date.now()};await db.saveSample(record);storedSamples.push(record)}catch{}}renderSampleChips();renderBank()}
function renderBank():void{
  const root=$<HTMLDivElement>('#bank-content');root.innerHTML=storedSamples.map(s=>`<div class="bank-row" data-sample="${escapeHtml(s.id)}"><div class="bank-row-head"><span class="sample-name">${escapeHtml(s.name)}</span><span><button class="bank-action" data-action="play">▶</button><button class="bank-action" data-action="rename">rename</button><button class="bank-action" data-action="delete">×</button></span></div><canvas class="waveform" data-wave="${escapeHtml(s.id)}" width="340" height="38"></canvas><div class="trim"><input type="range" min="0" max="49" value="0" data-trim="start"><input type="range" min="51" max="100" value="100" data-trim="end"></div><button class="bank-action" data-action="trim">apply trim</button></div>`).join('')||'<p>Upload an audio snippet or define a waveform in the editor.</p>'
  root.querySelectorAll<HTMLCanvasElement>('canvas[data-wave]').forEach(c=>drawWave(c,storedSamples.find(s=>s.id===c.dataset.wave)?.blob))
}
async function drawWave(canvas:HTMLCanvasElement,blob?:Blob):Promise<void>{if(!blob)return;try{const Decoder=window.OfflineAudioContext||(window as typeof window&{webkitOfflineAudioContext?:typeof OfflineAudioContext}).webkitOfflineAudioContext;if(!Decoder)return;const decoder=new Decoder(1,1,44100),b=await decoder.decodeAudioData(await blob.arrayBuffer()),d=b.getChannelData(0),g=canvas.getContext('2d')!,w=canvas.width,h=canvas.height;g.clearRect(0,0,w,h);g.strokeStyle='#66716c';g.beginPath();for(let x=0;x<w;x++){const i=Math.floor(x*d.length/w),end=Math.max(i+1,Math.floor((x+1)*d.length/w));let lo=1,hi=-1;for(let j=i;j<end;j++){lo=Math.min(lo,d[j]);hi=Math.max(hi,d[j])}g.moveTo(x,(1-hi)*h/2);g.lineTo(x,(1-lo)*h/2)}g.stroke()}catch{}}
function renderSavedSongs():void{const root=$<HTMLDivElement>('#bank-content'),existing=root.innerHTML;const rows=savedSongs.filter(s=>s.id!=='autosave').slice(0,12).map(s=>`<div class="song-row"><button class="bank-action" data-song="${escapeHtml(s.id)}">${escapeHtml(s.name)}</button><small>${new Date(s.updated).toLocaleDateString()}</small></div>`).join('');if(rows)root.insertAdjacentHTML('beforeend',`<h3>Saved songs</h3>${rows}`)}
function openBank():void{$('#docs-panel')!.classList.remove('open');$('#bank-panel')!.classList.toggle('open');renderBank();renderSavedSongs()}
function bytesToBase64(buffer:ArrayBuffer):string{const bytes=new Uint8Array(buffer);let text='';for(let i=0;i<bytes.length;i+=0x8000)text+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(text)}
function base64ToBlob(value:string,type:string):Blob{const binary=atob(value),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return new Blob([bytes],{type})}
function download(name:string,blob:Blob):void{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
function sampleSlice(buffer:AudioBuffer,start:number,end:number):AudioBuffer{const from=Math.floor(buffer.length*Math.max(0,Math.min(.99,start))),to=Math.max(from+1,Math.floor(buffer.length*Math.max(.01,Math.min(1,end)))),result=audio.context!.createBuffer(buffer.numberOfChannels,to-from,buffer.sampleRate);for(let c=0;c<buffer.numberOfChannels;c++)result.copyToChannel(buffer.getChannelData(c).subarray(from,to),c);return result}

async function beginRecording(source:'mic'|'tab'|'output'):Promise<void>{
  if(recorder?.state==='recording'){recorder.stop();return}
  try{
    await audio.start();let stream:MediaStream
    if(source==='mic'){micStream??=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false},video:false});stream=micStream;ensureMicAnalyser()}
    else if(source==='tab'){if(!navigator.mediaDevices.getDisplayMedia)throw new Error('Tab audio capture is unavailable in this browser.');stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});if(!stream.getAudioTracks().length)throw new Error('Choose a browser tab and enable “Share tab audio”.');}
    else{await audio.start();stream=audio.captureDestination!.stream}
    recordedStream=stream;recordedChunks=[];captureName=sampleName();const mime=['audio/webm;codecs=opus','audio/webm','audio/ogg'].find(m=>MediaRecorder.isTypeSupported(m));recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined)
    recorder.ondataavailable=e=>{if(e.data.size)recordedChunks.push(e.data)}
    recorder.onstop=async()=>{const blob=new Blob(recordedChunks,{type:recorder?.mimeType||'audio/webm'});for(const track of stream.getTracks())track.stop();if(source==='mic'){audio.disconnectMicrophone();micStream=null}recordedStream=null;$('#rec-mic')!.classList.remove('recording');$('#rec-tab')!.classList.remove('recording');$('#rec-output')!.classList.remove('recording');$('#rec-mic')!.textContent='● REC mic';$('#rec-tab')!.textContent='● REC tab';$('#rec-output')!.textContent='↻ REC output';await addSample(captureName,blob);recorder=null}
    recorder.start(200);const button=source==='mic'?'#rec-mic':source==='tab'?'#rec-tab':'#rec-output';$(button)!.classList.add('recording');$(button)!.textContent='■ STOP REC';status(`Recording ${source} audio · press again to finish`)
  }catch(error){status((error as Error).message,true)}
}

async function enableMidi():Promise<void>{if(!navigator.requestMIDIAccess)return;try{const access=await navigator.requestMIDIAccess();for(const input of access.inputs.values())input.onmidimessage=e=>{if(!performance)return;const [statusByte,note,velocity]=e.data||[];if((statusByte&0xf0)===0x90&&velocity>0)queuePianoNote(chromaticPiano?note:quantizeMidi(note,activeKey),velocity/127)}}catch{status('MIDI permission was not granted; computer keyboard piano is ready')}}
async function togglePerformance():Promise<void>{performance=!performance;updatePerformanceLabel();if(performance)await enableMidi()}
function queuePianoNote(midi:number,velocity:number):void{const name=activeProgram?.env.piano||'lead';if(running){const step=absoluteStep,list=performanceEvents.get(step)||[];list.push({name,midi,vol:velocity});performanceEvents.set(step,list);if(notesCapture)noteEvents.set(step,midi)}else if(audio.context)audio.play(name,midi,{at:audio.context.currentTime+.012,vol:velocity})}
function pianoNote(key:string):number|null{const white:Record<string,number>={a:60,s:62,d:64,f:65,g:67,h:69,j:71},black:Record<string,number>={w:61,e:63,t:66,y:68,u:70};return (white[key]??black[key]??null)}
function normalizeKey(e:KeyboardEvent):string{if(e.code==='Space')return'space';if(e.key==='Shift')return'shift';if(e.key==='Control')return'control';if(e.key==='Alt')return'alt';if(e.key==='Escape')return'escape';return e.key.toLowerCase()}
$('#play')!.addEventListener('click',()=>{if(running)stopTransport();else void startTransport()})
$('#load-starter')!.addEventListener('click',()=>{if(!editorView)return;editorView.dispatch({changes:{from:0,to:editorView.state.doc.length,insert:STARTER}});$('#docs-panel')!.classList.remove('open');status('Loaded the current scone sample')})
document.querySelectorAll<HTMLButtonElement>('[data-axis]').forEach(button=>button.addEventListener('click',()=>{labAxis=button.dataset.axis as typeof labAxis;document.querySelectorAll('[data-axis]').forEach(node=>node.classList.toggle('active',node===button));updateLab()}))
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button=>button.addEventListener('click',()=>{labMode=button.dataset.mode as typeof labMode;document.querySelectorAll('[data-mode]').forEach(node=>node.classList.toggle('active',node===button));updateLab()}))
$('#lab-equation')!.addEventListener('change',drawLab);$('#lab-equation')!.addEventListener('keydown',e=>{if(e.key==='Enter'){(e.target as HTMLInputElement).blur();drawLab()}});$('#lab-graph')!.addEventListener('pointerdown',e=>{if(labMode!=='draw')return;drawingLab=true;(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);drawAt(e)});$('#lab-graph')!.addEventListener('pointermove',e=>{if(drawingLab)drawAt(e)});$('#lab-graph')!.addEventListener('pointerup',()=>{drawingLab=false});$('#lab-graph')!.addEventListener('pointercancel',()=>{drawingLab=false});$('#lab-graph')!.addEventListener('pointerleave',()=>{drawingLab=false});$('#lab-close')!.addEventListener('click',()=>$('#lab-panel')!.classList.add('hidden'));document.addEventListener('pointerdown',e=>{const panel=$('#lab-panel');if(!panel?.classList.contains('hidden')&&!panel.contains(e.target as Node))panel.classList.add('hidden')});updateLab()
$('#perform')!.addEventListener('click',()=>{void togglePerformance()});$('#perform')!.addEventListener('contextmenu',e=>{e.preventDefault();chromaticPiano=!chromaticPiano;status(chromaticPiano?'Chromatic piano':'Piano locked to musical key')});
$('#docs')!.addEventListener('click',()=>$('#docs-panel')!.classList.toggle('open'));$('#docs-close')!.addEventListener('click',()=>$('#docs-panel')!.classList.remove('open'))
$('#fullscreen')!.addEventListener('click',async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen()}catch{status('Fullscreen is unavailable here',true)}})
$('#load-audio')!.addEventListener('click',()=>$('#audio-file')!.click());$('#audio-file')!.addEventListener('change',e=>{const file=(e.target as HTMLInputElement).files?.[0];if(file)void addSample(file.name.replace(/\.[^.]+$/,'')||sampleName(),file)})
$('#lab-insert')!.addEventListener('click',()=>{if(!editorView)return;const name=String($<HTMLInputElement>('#lab-name').value||'softWave').replace(/[^A-Za-z0-9_$]/g,'_').replace(/^\d/,'_$&'),axis=labAxis,mode=labMode;let line='';const value=mode==='equation'?JSON.stringify($<HTMLInputElement>('#lab-equation').value):JSON.stringify(Array.from(labData));if(axis==='waveform')line=`const ${name} = waveform(${JSON.stringify(name)}, ${value})\n`;else if(axis==='filter')line=`const ${name} = filterform(${JSON.stringify(name)}, ${value})\n`;else line=`const ${name} = envelope(${JSON.stringify(name)}, ${value})\n`;const pos=editorView.state.selection.main.head;editorView.dispatch({changes:{from:pos,to:pos,insert:line},selection:EditorSelection.cursor(pos+line.length)});status(`${name} definition added to code`)})

$('#bank-content')!.addEventListener('click',async e=>{const target=e.target as HTMLElement,button=target.closest<HTMLButtonElement>('[data-action]'),song=target.closest<HTMLButtonElement>('[data-song]');if(song){const r=savedSongs.find(s=>s.id===song.dataset.song);if(r&&editorView)editorView.dispatch({changes:{from:0,to:editorView.state.doc.length,insert:r.code}});return}if(!button)return;const row=button.closest<HTMLElement>('[data-sample]'),record=storedSamples.find(s=>s.id===row?.dataset.sample);if(!record)return;const action=button.dataset.action
  if(action==='play'){try{await audio.start();await ensureSampleLoaded(record);audio.play(record.name);status(`Playing ${record.name}`)}catch(error){status((error as Error).message,true)}}
  if(action==='rename'){const name=prompt('Rename sample',record.name);if(name){audio.removeSample(record.name);const next={...record,name};await db.saveSample(next);await audio.decodeSample(name,record.blob);storedSamples=await db.listSamples();renderBank();renderSampleChips()}}
  if(action==='delete'){if(confirm(`Delete ${record.name}?`)){await db.deleteSample(record.id);audio.removeSample(record.name);storedSamples=await db.listSamples();renderBank();renderSampleChips()}}
  if(action==='trim'){const a=Number(row?.querySelector<HTMLInputElement>('[data-trim=start]')?.value||0)/100,b=Number(row?.querySelector<HTMLInputElement>('[data-trim=end]')?.value||100)/100;try{await audio.start();const raw=await audio.context!.decodeAudioData(await record.blob.arrayBuffer()),cut=sampleSlice(raw,a,b),blob=trimAndEncodeWav(cut);audio.removeSample(record.name);await audio.decodeSample(record.name,blob);await db.saveSample({...record,blob});storedSamples=await db.listSamples();renderBank();status(`Trimmed ${record.name}`)}catch(error){status((error as Error).message,true)}}
})
$('#bank-content')!.addEventListener('input',e=>{const input=(e.target as HTMLInputElement);if(input.dataset.trim){const row=input.closest<HTMLElement>('[data-sample]');if(row){const start=Number(row.querySelector<HTMLInputElement>('[data-trim=start]')?.value||0),end=Number(row.querySelector<HTMLInputElement>('[data-trim=end]')?.value||100);if(start>=end)(input.dataset.trim==='start'?row.querySelector<HTMLInputElement>('[data-trim=start]')!:row.querySelector<HTMLInputElement>('[data-trim=end]')!).value=String(input.dataset.trim==='start'?Math.max(0,end-1):Math.min(100,start+1))}}})

window.addEventListener('keydown',e=>{const key=normalizeKey(e),editing=(e.target as HTMLElement)?.closest('.cm-editor')!==null
  if(key==='escape')$('#docs-panel')!.classList.remove('open')
  if(!editing||performance){if(!pressedKeys.has(key))justPressedKeys.add(key);pressedKeys.add(key)}
  if(performance){const note=pianoNote(key);if(note!==null){e.preventDefault();if(audio.context){const midi=chromaticPiano?note:quantizeMidi(note,activeKey);queuePianoNote(midi,.72)}}}
})
window.addEventListener('keyup',e=>pressedKeys.delete(normalizeKey(e)))
window.addEventListener('blur',()=>{pressedKeys.clear();justPressedKeys.clear()})

void loadLocalState();void drawSoundPanels()
