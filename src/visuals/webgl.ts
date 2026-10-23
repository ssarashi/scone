import type { AudioEngine } from '../engine/audio'

export type LiveNumber = number | (() => number)
export type SourceName = 'osc' | 'noise' | 'voronoi' | 'shape' | 'gradient' | 'solid' | 'grid'
type Mod = { name: string; args: unknown[] }

/** A chainable Hydra-style visual source rendered by a generated WebGL2 shader. */
export class VisualChain {
  readonly source: SourceName
  readonly args: unknown[]
  readonly mods: Mod[] = []
  constructor(source: SourceName, args: unknown[]) { this.source = source; this.args = args }
  private add(name: string, ...args: unknown[]): this { this.mods.push({ name, args }); return this }
  rotate(amount: LiveNumber = 0): this { return this.add('rotate', amount) }
  scale(amount: LiveNumber = 1): this { return this.add('scale', amount) }
  kaleid(sides: LiveNumber = 6): this { return this.add('kaleid', sides) }
  pixelate(x: LiveNumber = 40, y: LiveNumber = x): this { return this.add('pixelate', x, y) }
  repeat(x: LiveNumber = 3, y: LiveNumber = x): this { return this.add('repeat', x, y) }
  color(r: LiveNumber = 1, g: LiveNumber = 1, b: LiveNumber = 1): this { return this.add('color', r, g, b) }
  colorama(amount: LiveNumber = .1): this { return this.add('colorama', amount) }
  invert(amount: LiveNumber = 1): this { return this.add('invert', amount) }
  thresh(amount: LiveNumber = .5): this { return this.add('thresh', amount) }
  modulate(other: VisualChain, amount: LiveNumber = .1): this { return this.add('modulate', other, amount) }
  diff(other: VisualChain): this { return this.add('diff', other) }
  blend(other: VisualChain, amount: LiveNumber = .5): this { return this.add('blend', other, amount) }
  mult(other: VisualChain): this { return this.add('mult', other) }
  feedback(amount: LiveNumber = .96): this { return this.add('feedback', amount) }
  out(target: 'o0' | 'o1' | 'o2' | 'o3' = 'o0'): this { renderer.set(target, this); return this }
}

const live = (value: unknown): number => {
  try { const result = typeof value === 'function' ? (value as () => number)() : Number(value); return Number.isFinite(result) ? result : 0 } catch { return 0 }
}
type Param = { value: unknown }

/** Build and continuously render up to four shader chains across the viewport. */
class VisualRenderer {
  private gl: WebGL2RenderingContext | null = null
  private program: WebGLProgram | null = null
  private buffer: WebGLBuffer | null = null
  private params: Param[] = []
  private uniforms: WebGLUniformLocation[] = []
  private feedbackTexture: WebGLTexture | null = null
  private feedbackFramebuffer: WebGLFramebuffer | null = null
  private outs = new Map<string, VisualChain>()
  private previousOuts: Map<string,VisualChain>|null=null
  private audio: AudioEngine | null = null
  private reduced = false
  private paused = false
  constructor(private canvas: HTMLCanvasElement) {
    this.gl = canvas.getContext('webgl2', { alpha: true, antialias: false, preserveDrawingBuffer: true })
    if (!this.gl) console.warn('Scone visuals require WebGL2; the canvas will remain a pale background.')
    this.resize(); addEventListener('resize', () => this.resize()); requestAnimationFrame((t) => this.frame(t))
  }
  connectAudio(audio: AudioEngine): void { this.audio = audio }
  setReduceFlashing(value: boolean): void { this.reduced = value }
  setPaused(value:boolean):void{this.paused=value}
  set(target: string, chain: VisualChain): void { this.outs.set(target, chain); this.compile() }
  clear(): void { this.outs.clear(); this.compile() }
  beginTransaction():void{this.previousOuts=new Map(this.outs);this.outs.clear();this.compile()}
  commitTransaction():void{this.previousOuts=null}
  rollbackTransaction():void{if(this.previousOuts){this.outs=this.previousOuts;this.previousOuts=null;this.compile()}}
  private resize(): void {
    const dpr = Math.min(devicePixelRatio || 1, 2), w = Math.max(1, Math.floor(innerWidth * dpr)), h = Math.max(1, Math.floor(innerHeight * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; this.gl?.viewport(0, 0, w, h); this.makeFeedback() }
  }
  private parameter(value: unknown): number { const i = this.params.length; this.params.push({ value }); return i }
  private compile(): void {
    const gl = this.gl; if (!gl) return
    this.params = []
    let body = 'vec3 col=vec3(.93,.935,.93); float alpha=1.0; vec2 uv=vUv;'
    for (const [out, chain] of [...this.outs.entries()].slice(0, 4)) {
      const color = this.chainColor(chain, 'vUv')
      const mix = out === 'o0' ? 1 : .6
      body += `col=mix(col,${color},${mix.toFixed(2)});`
    }
    const fragment = `#version 300 es\nprecision highp float; in vec2 vUv; out vec4 fragColor; uniform float uTime; uniform float u[${Math.max(1,this.params.length)}]; uniform float uPause; uniform vec2 uResolution; uniform sampler2D uFeedback;\nfloat hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\nvec3 srcOsc(vec2 p,float f,float s,float o){float c=.5+.5*cos((p.x+p.y)*f+uTime*s+o);return vec3(c);}\nvec3 srcNoise(vec2 p,float f,float s){vec2 q=p*f+uTime*s;float flow=q.y*2.8+sin(q.x*2.1+uTime*s)*.75+sin(q.x*.73-uTime*s*.6)*.42;float band=smoothstep(.35,.95,.5+.5*sin(flow));vec2 i=floor(q),r=fract(q);r=r*r*(3.-2.*r);float n=mix(mix(hash(i),hash(i+vec2(1.,0.)),r.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),r.x),r.y);return vec3(.68+n*.12+band*.2);}\nvec3 srcVoronoi(vec2 p,float f){vec2 q=p*f,cell=floor(q),r=fract(q);float md=1.;for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 g=vec2(float(x),float(y)),o=vec2(hash(cell+g),hash(cell+g+7.));md=min(md,length(g+o-r));}return vec3(1.-md);}\nvec3 srcShape(vec2 p,float sides,float radius){vec2 q=p-.5;float a=atan(q.y,q.x),seg=6.2831853/max(3.,sides);float d=length(q)*cos(floor(.5+a/seg)*seg-a);float edge=radius*.48;float line=1.-smoothstep(.004,.025,abs(d-edge));return vec3(line);}\nvec3 srcGrid(vec2 p,float n){vec2 q=abs(fract(p*n)-.5);float l=1.-smoothstep(.46,.49,max(q.x,q.y));return vec3(l);}\nvec2 rotateUv(vec2 p,float a){p-=.5;return mat2(cos(a),-sin(a),sin(a),cos(a))*p+.5;}\nvec2 kaleidUv(vec2 p,float n){vec2 q=p-.5;float a=atan(q.y,q.x),seg=6.2831853/max(2.,n);a=abs(mod(a,seg)-seg*.5);return vec2(cos(a),sin(a))*length(q)+.5;}\n${this.functionsForChains()}\nvoid main(){${body} float mono=dot(col,vec3(.2126,.7152,.0722));col=vec3(mono);float pauseLine=1.-smoothstep(.0,.012,abs(vUv.y-.5));col=mix(col,vec3(.65+.18*pauseLine),uPause);fragColor=vec4(col,alpha);}`
    const vs = `#version 300 es\nprecision highp float; in vec2 aPosition; out vec2 vUv; void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}`
    const vert = this.shader(gl.VERTEX_SHADER, vs), frag = this.shader(gl.FRAGMENT_SHADER, fragment); if (!vert || !frag) return
    const program = gl.createProgram()!; gl.attachShader(program, vert); gl.attachShader(program, frag); gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(program)); return }
    if (this.program) gl.deleteProgram(this.program); this.program = program
    this.uniforms = this.params.map((_, i) => gl.getUniformLocation(program, `u[${i}]`)!).filter(Boolean)
    this.buffer ||= gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW)
  }
  private functionsForChains(): string { return '' }
  private chainColor(chain: VisualChain, uvName: string, depth=0): string {
    if(depth>4)return 'vec3(0.)'
    let uv=uvName
    const add=(v:unknown)=>`u[${this.parameter(v)}]`,a=chain.args
    const colorOps:((color:string)=>string)[]=[]
    for(const mod of chain.mods){const x=mod.args[0],y=mod.args[1],z=mod.args[2]
      if(mod.name==='rotate')uv=`rotateUv(${uv},${add(x)})`
      else if(mod.name==='scale')uv=`((${uv}-.5)/max(.02,${add(x)})+.5)`
      else if(mod.name==='kaleid')uv=`kaleidUv(${uv},${add(x)})`
      else if(mod.name==='pixelate'){const px=add(x),py=add(y);uv=`(floor(${uv}*vec2(${px},${py}))/max(vec2(.01),vec2(${px},${py})))`}
      else if(mod.name==='repeat'){const rx=add(x),ry=add(y);uv=`fract(${uv}*vec2(${rx},${ry}))`}
      else if(mod.name==='modulate'&&x instanceof VisualChain)uv=`(${uv}+((${this.chainColor(x,uv,depth+1)}).rg-.5)*${add(y)})`
      else if(mod.name==='color')colorOps.push(c=>`${c}*vec3(${add(x)},${add(y)},${add(z)})`)
      else if(mod.name==='colorama')colorOps.push(c=>`fract(${c}+vec3(${add(x)},${add(x)}*.67,${add(x)}*.33))`)
      else if(mod.name==='invert')colorOps.push(c=>`mix(${c},vec3(1.)-${c},${add(x)})`)
      else if(mod.name==='thresh')colorOps.push(c=>`vec3(step(${add(x)},dot(${c},vec3(.333))))`)
      else if(mod.name==='diff'&&x instanceof VisualChain)colorOps.push(c=>`abs(${c}-${this.chainColor(x,uv,depth+1)})`)
      else if(mod.name==='mult'&&x instanceof VisualChain)colorOps.push(c=>`${c}*${this.chainColor(x,uv,depth+1)}`)
      else if(mod.name==='blend'&&x instanceof VisualChain)colorOps.push(c=>`mix(${c},${this.chainColor(x,uv,depth+1)},${add(y)})`)
      else if(mod.name==='feedback')colorOps.push(c=>`mix(${c},texture(uFeedback,${uv}).rgb,${add(x)})`)
    }
    let color=''
    switch(chain.source){
      case'osc':color=`srcOsc(${uv},${add(a[0]??60.)},${add(a[1]??.1)},${add(a[2]??0.)})`;break
      case'noise':color=`srcNoise(${uv},${add(a[0]??3.)},${add(a[1]??.15)})`;break
      case'voronoi':color=`srcVoronoi(${uv},${add(a[0]??5.)})`;break
      case'shape':color=`srcShape(${uv},${add(a[0]??4.)},${add(a[1]??.45)})`;break
      case'gradient':color=`vec3(${uv}.y+.12*sin(uTime*${add(a[0]??.2)}),${uv}.y*.4,1.-${uv}.y)`;break
      case'solid':color=`vec3(${add(a[0]??.2)},${add(a[1]??.1)},${add(a[2]??.4)})`;break
      case'grid':color=`srcGrid(${uv},${add(a[0]??8.)})`;break
    }
    for(const op of colorOps)color=op(color)
    return color
  }
  private shader(kind: number, text: string): WebGLShader | null {
    const gl = this.gl!, shader = gl.createShader(kind)!; gl.shaderSource(shader, text); gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(shader)); return null }
    return shader
  }
  private makeFeedback(): void {
    const gl = this.gl; if (!gl) return
    if (this.feedbackTexture) gl.deleteTexture(this.feedbackTexture)
    this.feedbackTexture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.feedbackTexture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,this.canvas.width,this.canvas.height,0,gl.RGBA,gl.UNSIGNED_BYTE,null)
    if (this.feedbackFramebuffer) gl.deleteFramebuffer(this.feedbackFramebuffer)
    this.feedbackFramebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,this.feedbackFramebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.feedbackTexture,0); gl.bindFramebuffer(gl.FRAMEBUFFER,null)
  }
  private frame(time: number): void {
    requestAnimationFrame((t) => this.frame(t)); const gl = this.gl; if (!gl) return
    if(!this.program){this.resize();gl.clearColor(.9804,.9804,.9804,1);gl.clear(gl.COLOR_BUFFER_BIT);return}
    this.resize(); gl.useProgram(this.program); gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer)
    const loc=gl.getAttribLocation(this.program,'aPosition');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0)
    gl.uniform1f(gl.getUniformLocation(this.program,'uTime'),this.reduced?time*.0002:time*.001)
    gl.uniform1f(gl.getUniformLocation(this.program,'uPause'),this.paused?1:0)
    gl.uniform2f(gl.getUniformLocation(this.program,'uResolution'),this.canvas.width,this.canvas.height)
    for(let i=0;i<this.params.length;i++)gl.uniform1f(this.uniforms[i],live(this.params[i].value))
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.feedbackTexture);gl.uniform1i(gl.getUniformLocation(this.program,'uFeedback'),0)
    gl.drawArrays(gl.TRIANGLES,0,6);if(this.feedbackFramebuffer){gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,this.feedbackFramebuffer);gl.blitFramebuffer(0,0,this.canvas.width,this.canvas.height,0,0,this.canvas.width,this.canvas.height,gl.COLOR_BUFFER_BIT,gl.LINEAR);gl.bindFramebuffer(gl.FRAMEBUFFER,null)}
  }
}

const renderer = new VisualRenderer(document.querySelector<HTMLCanvasElement>('#visuals')!)
export function connectVisualAudio(audio: AudioEngine): void { renderer.connectAudio(audio) }
export function clearVisuals(): void { renderer.clear() }
export function beginVisualTransaction():void{renderer.beginTransaction()}
export function commitVisualTransaction():void{renderer.commitTransaction()}
export function rollbackVisualTransaction():void{renderer.rollbackTransaction()}
export function reduceFlashing(value: boolean): void { renderer.setReduceFlashing(value) }
export function setVisualPause(value:boolean):void{renderer.setPaused(value)}
export const osc = (frequency?: LiveNumber, speed?: LiveNumber, offset?: LiveNumber) => new VisualChain('osc',[frequency,speed,offset])
export const noise = (frequency?: LiveNumber, speed?: LiveNumber) => new VisualChain('noise',[frequency,speed])
export const voronoi = (scale?: LiveNumber) => new VisualChain('voronoi',[scale])
export const shape = (sides?: LiveNumber, radius?: LiveNumber) => new VisualChain('shape',[sides,radius])
export const gradient = (speed?: LiveNumber) => new VisualChain('gradient',[speed])
export const solid = (r?: LiveNumber,g?: LiveNumber,b?: LiveNumber) => new VisualChain('solid',[r,g,b])
export const grid = (scale?: LiveNumber) => new VisualChain('grid',[scale])
