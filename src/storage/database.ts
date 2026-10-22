export type SongRecord = { id: string; name: string; code: string; updated: number }
export type SampleRecord = { id: string; name: string; blob: Blob; created: number }
const DB_NAME = 'scone-local-v1'

/** Small IndexedDB wrapper for local songs and audio recordings. */
export class SconeDatabase {
  private db: Promise<IDBDatabase>
  constructor() { this.db = this.open() }
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open(DB_NAME,1)
      request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('songs'))db.createObjectStore('songs',{keyPath:'id'});if(!db.objectStoreNames.contains('samples'))db.createObjectStore('samples',{keyPath:'id'})}
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)
    })
  }
  private async store<T>(name:string,mode:IDBTransactionMode,action:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{const db=await this.db;return new Promise((resolve,reject)=>{const tx=db.transaction(name,mode),req=action(tx.objectStore(name));req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);tx.onabort=()=>reject(tx.error)})}
  /** Save a song to this browser's IndexedDB. */
  saveSong(song:SongRecord):Promise<IDBValidKey>{return this.store('songs','readwrite',s=>s.put(song))}
  /** List songs saved in this browser. */
  listSongs():Promise<SongRecord[]>{return this.store('songs','readonly',s=>s.getAll())}
  /** Add or replace a locally recorded sample. */
  saveSample(sample:SampleRecord):Promise<IDBValidKey>{return this.store('samples','readwrite',s=>s.put(sample))}
  /** List saved recordings with their local audio blobs. */
  listSamples():Promise<SampleRecord[]>{return this.store('samples','readonly',s=>s.getAll())}
  /** Remove a sample from local storage. */
  deleteSample(id:string):Promise<undefined>{return this.store('samples','readwrite',s=>s.delete(id))}
}

/** Auto-trim a decoded recording and encode it as a portable 16-bit WAV blob. */
export function trimAndEncodeWav(buffer:AudioBuffer,threshold=.012):Blob{
  let first=buffer.length,last=0
  for(let i=0;i<buffer.length;i+=128){let e=0;for(let c=0;c<buffer.numberOfChannels;c++){const d=buffer.getChannelData(c);for(let j=i;j<Math.min(i+128,buffer.length);j++)e+=d[j]*d[j]}if(Math.sqrt(e/(128*buffer.numberOfChannels))>threshold){first=Math.min(first,i);last=Math.max(last,Math.min(buffer.length,i+128))}}
  if(last<=first){first=0;last=buffer.length}
  const frames=last-first,channels=buffer.numberOfChannels,bytes=44+frames*channels*2,view=new DataView(new ArrayBuffer(bytes)),write=(offset:number,text:string)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i))}
  write(0,'RIFF');view.setUint32(4,bytes-8,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,frames*channels*2,true)
  let offset=44;for(let i=first;i<last;i++)for(let c=0;c<channels;c++){const sample=Math.max(-1,Math.min(1,buffer.getChannelData(c)[i]));view.setInt16(offset,sample<0?sample*32768:sample*32767,true);offset+=2}
  return new Blob([view],{type:'audio/wav'})
}
