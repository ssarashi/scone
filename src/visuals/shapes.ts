import type { Pattern } from '../engine/patterns'

export type ShapeOptions = { follows?: string | Pattern; count?: number; size?: number | (() => number); color?: string | (() => string); glow?: number | (() => number); spin?: number | (() => number); wander?: number; chaos?: number; speed?: number; life?: number; edge?: 'wrap' | 'bounce'; seed?: number }
type ShapeSpec = { kind: string | string[]; options: ShapeOptions; baseSeed:number; births:number }
type FloatingShape = { kind: string; x: number; y: number; vx: number; vy: number; size: number; angle: number; spin: number; age: number; life: number; seed: number; spec: ShapeSpec }
const read = <T,>(v: T | (() => T) | undefined, fallback: T): T => { try { return typeof v === 'function' ? (v as () => T)() : v ?? fallback } catch { return fallback } }

/** Full-window drifting shape layer with seeded smooth motion and per-hit impulses. */
export class ShapeField {
  private ctx: CanvasRenderingContext2D
  private monkeyImage=new Image()
  private duckImage=new Image()
  private miffyImage=new Image()
  private specs: ShapeSpec[] = []
  private shapes: FloatingShape[] = []
  private hitCounts=new Map<string,number>()
  private time = 0
  private seed = 1
  private reduced = false
  private paused = false
  private previousSpecs:ShapeSpec[]|null=null
  private previousShapes:FloatingShape[]|null=null
  constructor(private canvas: HTMLCanvasElement,images:{monkey:string;duck:string;miffy:string}) {
    this.monkeyImage.decoding='async';this.monkeyImage.src=images.monkey
    this.duckImage.decoding='async';this.duckImage.src=images.duck
    this.miffyImage.decoding='async';this.miffyImage.src=images.miffy
    this.ctx = canvas.getContext('2d')!; this.resize(); addEventListener('resize', () => this.resize()); requestAnimationFrame((t) => this.frame(t))
  }
  /** Register a visual object family and its audio or pattern trigger. */
  add(kind: string | string[], options: ShapeOptions): void { const aliases:Record<string,string>={puck:'hockey-puck',monkey:'wooden-monkey',spheres:'blue-sphere',duck:'rubber-duck',rubberduck:'rubber-duck'},allowed=['hockey-puck','wooden-monkey','blue-sphere','rubber-duck','miffy'],items=(Array.isArray(kind)?kind:[kind]).map(name=>{const resolved=aliases[name]||name;return allowed.includes(resolved)?resolved:'blue-sphere'});this.specs.push({ kind:items, options, baseSeed:options.seed??++this.seed*13.37+Math.random()*1000, births:0 }) }
  /** Clear user-defined shape families and active particles on a live recompilation. */
  clear(): void { this.specs = []; this.shapes = [] }
  beginTransaction():void{this.previousSpecs=[...this.specs];this.previousShapes=[...this.shapes];this.specs=[];this.shapes=[]}
  commitTransaction():void{this.previousSpecs=null;this.previousShapes=null}
  rollbackTransaction():void{if(this.previousSpecs){this.specs=this.previousSpecs;this.shapes=this.previousShapes||[];this.previousSpecs=null;this.previousShapes=null}}
  /** Spawn every family whose follows source matches the triggering sound. */
  trigger(source: string, strength = 1, enabled?: ReadonlySet<string>): void {
    const matching=this.specs.filter(spec=>{
      const follows = spec.options.follows
      if(typeof follows!=='string'||follows!==source)return false
      const kinds=Array.isArray(spec.kind)?spec.kind:[spec.kind]
      return !enabled||kinds.some(kind=>enabled.has(`${kind}:${follows}`))
    })
    if(!matching.length)return
    const hit=(this.hitCounts.get(source)||0)+1
    this.hitCounts.set(source,hit)
    for (const spec of matching) {
      for (const shape of this.shapes) if (shape.spec === spec) { const a = Math.random() * Math.PI * 2, impulse = strength * (.2 + (spec.options.chaos ?? .5)); shape.vx += Math.cos(a) * impulse; shape.vy += Math.sin(a) * impulse }
      if(hit%4!==0)continue
      const count = Math.max(1, Math.min(40, Math.floor(spec.options.count ?? 1)))
      for (let i = 0; i < count; i++) this.spawn(spec, strength)
    }
  }
  /** Spawn a shape when a declared visual follows the supplied pattern object. */
  triggerPattern(pattern: Pattern, strength = 1, _enabled?: ReadonlySet<string>): void {
    for (const spec of this.specs) if (spec.options.follows === pattern) this.triggerBySpec(spec, strength)
  }
  private triggerBySpec(spec: ShapeSpec, strength: number): void {
    for(const shape of this.shapes)if(shape.spec===spec){const a=Math.random()*Math.PI*2;shape.vx+=Math.cos(a)*strength;shape.vy+=Math.sin(a)*strength}
    const count=Math.max(1,Math.min(40,Math.floor(spec.options.count??1)))
    for(let i=0;i<count;i++)this.spawn(spec,strength)
    if(this.shapes.length>1200)this.shapes.splice(0,this.shapes.length-1200)
  }
  /** Freeze and gray drifting objects while the musical transport is silent. */
  setReducedFlashing(value: boolean): void { this.reduced = value }
  /** Enable only shape families declared by the current sequencer step. */
  setActiveDeclarations(keys:ReadonlySet<string>):void{this.shapes=this.shapes.filter(shape=>{const follows=shape.spec.options.follows,kinds=Array.isArray(shape.spec.kind)?shape.spec.kind:[shape.spec.kind];return typeof follows==='string'&&kinds.some(kind=>keys.has(`${kind}:${follows}`))})}
  setPaused(value:boolean):void{if(this.paused&&!value)for(const shape of this.shapes){const a=Math.random()*Math.PI*2;shape.vx+=Math.cos(a)*3;shape.vy+=Math.sin(a)*3}this.paused=value}
  private resize(): void { const dpr = Math.min(devicePixelRatio || 1, 2); this.canvas.width = Math.floor(innerWidth * dpr); this.canvas.height = Math.floor(innerHeight * dpr); this.ctx.setTransform(dpr,0,0,dpr,0,0) }
  private random(seed: number): number { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }
  private smooth(seed:number,t:number):number{const i=Math.floor(t),f=t-i,s=f*f*(3-2*f);return this.random(seed+i)*(1-s)+this.random(seed+i+1)*s}
  private spawn(spec: ShapeSpec, power: number): void {
    const opts = spec.options, seed = spec.baseSeed+spec.births++*17.31, angle = this.random(seed) * Math.PI * 2, velocity = (opts.speed ?? 2) * (.6 + power)
    const list = Array.isArray(spec.kind) ? spec.kind : [spec.kind], kind = list[Math.floor(this.random(seed + 1) * list.length)]
    const imageKind=kind==='wooden-monkey'||kind==='rubber-duck'||kind==='miffy'
    this.shapes.push({ kind, x: innerWidth * (.2 + this.random(seed + 2) * .6), y: innerHeight * (.2 + this.random(seed + 3) * .6), vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, size: imageKind?600+this.random(seed+4)*80:18+this.random(seed + 4) * 45, angle: this.random(seed + 5) * 6, spin: this.random(seed + 6) * 2 - 1, age: 0, life: opts.life ?? 520, seed, spec })
    if (this.shapes.length > 1200) this.shapes.splice(0, this.shapes.length - 1200)
  }
  private frame(t: number): void {
    requestAnimationFrame((time) => this.frame(time)); const dt = Math.min(2.5, Math.max(.3, (t - this.time) / 16.7)); this.time = t
    const ctx = this.ctx; ctx.clearRect(0,0,innerWidth,innerHeight)
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const p = this.shapes[i], o = p.spec.options, age = p.age / p.life, wander = o.wander ?? .7, chaos = o.chaos ?? .5
      const noise = (this.smooth(p.seed,t*.003+p.age*.02)-.5)*.18*chaos
      p.vx += (Math.sin(t * .0006 + p.seed) * .025 + Math.cos(t * .00019 + p.seed * 2) * .018 + noise) * wander
      p.vy += (Math.cos(t * .0005 + p.seed * 3) * .024 + Math.sin(t * .00021 + p.seed) * .018 - noise) * wander
      const maxSpeed = (o.speed ?? 2) * (1 + chaos); p.vx = Math.max(-maxSpeed, Math.min(maxSpeed,p.vx)); p.vy = Math.max(-maxSpeed, Math.min(maxSpeed,p.vy));
      const motion=this.reduced ? .2 : 1
      if (!this.paused) { p.x += p.vx * dt*motion; p.y += p.vy * dt*motion }
      p.age += this.paused ? 0 : dt*motion; p.angle += this.paused?0:(read(o.spin, p.spin) + p.spin * .12) * .006 * dt*motion
      const image=this.imageFor(p.kind),size=image?Math.max(600,read(o.size,p.size)*(.98+Math.sin(t*.001+p.seed)*.02)):Math.max(1,read(o.size,p.size)*(.65+Math.sin(t*.001+p.seed)*.07))
      const edge = o.edge ?? 'bounce'; if (edge === 'bounce') { const halfW=size/2,halfH=image?.naturalWidth?halfW*image.naturalHeight/image.naturalWidth:halfW,minX=Math.min(halfW,innerWidth/2),maxX=Math.max(innerWidth-halfW,innerWidth/2),minY=Math.min(halfH,innerHeight/2),maxY=Math.max(innerHeight-halfH,innerHeight/2);if(p.x<minX){p.x=minX;p.vx=Math.abs(p.vx)}else if(p.x>maxX){p.x=maxX;p.vx=-Math.abs(p.vx)}if(p.y<minY){p.y=minY;p.vy=Math.abs(p.vy)}else if(p.y>maxY){p.y=maxY;p.vy=-Math.abs(p.vy)} } else { if(p.x< -40)p.x=innerWidth+40;if(p.x>innerWidth+40)p.x=-40;if(p.y< -40)p.y=innerHeight+40;if(p.y>innerHeight+40)p.y=-40 }
      const fade = Math.min(1, age * 5, (1 - age) * 4); if (age >= 1) { this.shapes.splice(i,1); continue }
      const opacity=Math.max(0,fade*(this.reduced ? .55 : 1)*(this.paused ? .55 : 1)), color=this.reduced||this.paused?'#a8a6ad':read(o.color,'#b7ff4a'), glow=read(o.glow,7)
      this.draw(p.kind,p.x,p.y,size,p.angle,color,opacity,glow)
    }
  }
  private imageFor(kind:string):HTMLImageElement|null{return kind==='wooden-monkey'?this.monkeyImage:kind==='rubber-duck'?this.duckImage:kind==='miffy'?this.miffyImage:null}
  private draw(kind: string,x: number,y: number,size: number,angle: number,color: string,opacity:number,glow:number):void {
    const c=this.ctx;c.save();c.translate(x,y);c.rotate(angle);c.globalAlpha=opacity;c.strokeStyle=color;c.fillStyle=color;c.lineWidth=1.4;c.shadowColor=color;c.shadowBlur=glow
    const r=size/2
    if(kind==='hockey-puck'){
      const h=c.createLinearGradient(-r,-r,r,r);h.addColorStop(0,'#fa6a67');h.addColorStop(.48,'#d21e2b');h.addColorStop(1,'#8c101c');c.shadowColor='#c82731';c.shadowBlur=glow*.45;c.fillStyle=h;c.beginPath();c.ellipse(0,r*.13,r,r*.43,0,0,Math.PI*2);c.fill();c.fillStyle='#e73640';c.beginPath();c.ellipse(0,-r*.1,r,r*.4,0,Math.PI,Math.PI*2);c.fill();c.strokeStyle='#9f1520';c.lineWidth=Math.max(1,size*.035);c.beginPath();c.ellipse(0,-r*.1,r,r*.4,0,Math.PI,Math.PI*2);c.stroke();c.restore();return
    }
    if(kind==='blue-sphere'){
      const g=c.createRadialGradient(-r*.35,-r*.4,r*.04,0,0,r);g.addColorStop(0,'#d5edff');g.addColorStop(.2,'#68b8f4');g.addColorStop(.68,'#2878c9');g.addColorStop(1,'#16457d');c.shadowColor='#8fcafa';c.shadowBlur=glow;c.fillStyle=g;c.beginPath();c.arc(0,0,r,0,Math.PI*2);c.fill();c.restore();return
    }
    const image=this.imageFor(kind);if(image){if(image.complete&&image.naturalWidth){const height=size*image.naturalHeight/image.naturalWidth;c.drawImage(image,-r,-height/2,size,height)}c.restore();return}
    c.beginPath()
    switch(kind){case 'circle':c.arc(0,0,r,0,Math.PI*2);break;case 'ring':c.arc(0,0,r,0,Math.PI*2);c.arc(0,0,r*.64,0,Math.PI*2,true);break;case 'square':c.rect(-r,-r,size,size);break;case 'line':c.moveTo(-r,0);c.lineTo(r,0);break;case 'cross':c.moveTo(-r,0);c.lineTo(r,0);c.moveTo(0,-r);c.lineTo(0,r);break;default:{const sides=kind==='triangle'?3:kind==='hexagon'?6:kind==='star'?10:5;for(let i=0;i<sides;i++){const rr=kind==='star'&&i%2===1?r*.42:r,a=i/sides*Math.PI*2-Math.PI/2;if(i===0)c.moveTo(Math.cos(a)*rr,Math.sin(a)*rr);else c.lineTo(Math.cos(a)*rr,Math.sin(a)*rr)}c.closePath()}}
    c.stroke();c.restore()
  }
}

export const shapeFunctions = (field: ShapeField) => ({ shapes: (kind: string | string[], options: ShapeOptions = {}) => field.add(kind, options) })
