const assert=require('node:assert/strict')
const path=require('node:path')
const {test}=require('node:test')
const loader=require('./helpers/load-typescript.cjs')
const flush=()=>new Promise(setImmediate)
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
const task=id=>({id,status:'pause',isComplate:false,downloaded:0,total:0,progress:0,speed:'',writeQueue:0,metadata:{musicInfo:{id,source:'kw',name:id,singer:'Singer',meta:{}},fileName:id+'.mp3',filePath:path.join('C:/downloads',id+'.mp3'),url:'https://audio.test/'+id,quality:'128k',ext:'mp3'}})
function fixture(t, options={}){
  const previous=global.window, previousNavigator=Object.getOwnPropertyDescriptor(global,'navigator')
  Object.defineProperty(global,'navigator',{configurable:true,value:{onLine:true}})
  const list=options.list||[task('a')], callbacks=[],started=[],startArgs=[],stopped=[],saved=[],created=[],toasts=[],events={}
  const existingPaths=new Set(list.map(item=>item.metadata.filePath).filter(Boolean))
  let lyrics=0, writes=0, fail=false, writeGate=gate()
  const settings={'download.maxDownloadNum':1,'download.skipExistFile':false,'download.isEmbedLyric':true,'download.isDownloadLrc':true,'download.autoResume':true,'download.savePath':'C:/downloads','download.fileName':'歌名 - 歌手','download.maxTaskSizeMiB':0,'download.maxBatchSizeMiB':0,...options.settings}
  global.window={i18n:{t:key=>key},app_event:{downloadListUpdate(){}},addEventListener:(name,fn)=>{events[name]=fn},lx:{worker:{download:{
    startTask:async(info,_path,_skip,callback,...args)=>{started.push(info.id);startArgs.push(args);callbacks.push(callback)},pauseTask:async id=>{stopped.push(id)},setRateLimit:async()=>{},
    createDownloadTasks:async(songs,quality)=>songs.map(song=>{const info=task(song.id);info.status='waiting';info.metadata.filePath='';info.metadata.musicInfo=song;info.metadata.quality=quality;return info}),
    writeMeta:async()=>{writes++;await writeGate.promise;if(fail)throw Object.assign(Error('disk full'),{code:'ENOSPC'})},saveLrc:async()=>{},
  }}}}
  const actions=loader({
    '@renderer/utils/ipc':{downloadTasksGet:async()=>structuredClone(list),downloadTasksUpdate:async rows=>{saved.push(...structuredClone(rows))},downloadTasksRemove:async()=>{},downloadTasksCreate:async rows=>{created.push(...structuredClone(rows))},getDownloadDiskSpace:async()=>({availableBytes:options.freeBytes??1e12,totalBytes:2e12})},
    './state':{downloadList:list},'@common/utils/vueTools':{markRaw:x=>x,toRaw:x=>x},
    '@renderer/core/music/online':{getMusicUrl:options.url|| (async()=> 'https://audio.test/new'),getLyricInfo:async()=>{lyrics++;return{lyric:'[00:01.000] line'}},getPicUrl:async()=>''},
    '../setting':{appSetting:settings},'..':{qualityList:{value:{kw:['128k','320k']}}},'@renderer/worker/utils':{proxyCallback:x=>x},'@renderer/utils':{joinPath:path.join,arrPush:(a,b)=>a.push(...b)},
    '@common/constants':{DOWNLOAD_STATUS:{RUN:'run',WAITING:'waiting',PAUSE:'pause',ERROR:'error',COMPLETED:'completed'}},'../index':{proxy:options.proxy||{}},'./utils':{buildSavePath:()=> 'C:/downloads'},
    '@renderer/plugins/Toast':message=>toasts.push(message),'@common/utils/nodejs':{getFileStats:async filePath=>existingPaths.has(filePath)?{isFile:()=>true,size:1000}:null},
  })('src/renderer/store/download/action.ts')
  t.after(async()=>{writeGate.resolve();await actions.pauseDownloadTasks(list);await new Promise(resolve=>setTimeout(resolve,150));global.window=previous;if(previousNavigator)Object.defineProperty(global,'navigator',previousNavigator);else delete global.navigator})
  return{actions,list,callbacks,started,startArgs,stopped,events,saved,created,toasts,settings,get lyrics(){return lyrics},get writes(){return writes},finish(error=false){fail=error;writeGate.resolve()},newWrite(){writeGate=gate();fail=false}}
}
const song=(id,size)=>({id,source:'kw',name:id,singer:'Singer',interval:'03:00',meta:{qualitys:size?[{type:'128k',size}]:[],_qualitys:{}}})
test('C20: batch preflight blocks oversized tasks and insufficient disk before persistence',async t=>{
  const f=fixture(t,{list:[],settings:{'download.maxTaskSizeMiB':1},freeBytes:3*1024*1024})
  const selected=[song('one','2M'),song('two','2M')]
  const preview=await f.actions.previewDownloadTasks(selected,'128k')
  assert.equal(preview.summary.overTaskCount,2)
  assert.equal(preview.summary.insufficientDisk,true)
  assert.equal(await f.actions.createDownloadTasks(selected,'128k'),false)
  assert.equal(f.created.length,0)
  f.settings['download.maxTaskSizeMiB']=0
  f.settings['download.maxBatchSizeMiB']=3
  assert.equal(await f.actions.createDownloadTasks(selected,'128k'),false)
  assert.equal(f.created.length,0)
})
test('C20: accepted batches persist one size budget and pass task limits to the worker',async t=>{
  const f=fixture(t,{list:[],settings:{'download.maxTaskSizeMiB':3,'download.maxBatchSizeMiB':5}})
  assert.equal(await f.actions.createDownloadTasks([song('one','2M'),song('two','2M')],'128k'),true)
  assert.equal(f.created.length,2)
  assert.equal(f.created[0].batchId,f.created[1].batchId)
  assert.equal(f.created[0].batchLimitBytes,5*1024*1024)
  await flush();await flush()
  assert.equal(f.startArgs[0][2],3*1024*1024)
  assert.equal(f.startArgs[0][3],0)
})
test('C20: a bulk selection still applies its batch cap when only one song is new',async t=>{
  const existing=task('one');existing.status='completed'
  const f=fixture(t,{list:[existing],settings:{'download.maxBatchSizeMiB':1}})
  const selected=[song('one','2M'),song('two','2M')]
  const preview=await f.actions.previewDownloadTasks(selected,'128k',undefined,true)
  assert.equal(preview.count,1)
  assert.equal(preview.summary.overBatch,true)
  assert.equal(await f.actions.createDownloadTasks(selected,'128k',undefined,true),false)
  assert.equal(f.created.length,0)
})
test('C20: resumed batch budgets start from actual partial file sizes',async t=>{
  const first=task('one'),second=task('two')
  for(const info of [first,second]){info.batchId='resumed-batch';info.batchLimitBytes=5*1024*1024}
  const f=fixture(t,{list:[first,second]})
  await f.actions.startDownloadTasks(f.list);await flush();await flush()
  assert.equal(f.startArgs[0][3],2000)
})
test('C01: an obsolete URL lookup cannot start a paused or replaced download',async t=>{
  const old=gate(), recent=gate();let requests=0
  const info=task('a');info.metadata.url=null
  const f=fixture(t,{list:[info],url:()=>++requests===1?old.promise:recent.promise})
  await f.actions.startDownloadTasks(f.list);await flush()
  await f.actions.pauseDownloadTasks(f.list);await flush()
  await f.actions.startDownloadTasks(f.list);await flush()
  old.resolve('https://audio.test/old');await flush();assert.deepEqual(f.started,[])
  recent.resolve('https://audio.test/current');await flush();await flush()
  assert.deepEqual(f.started,['a']);assert.equal(info.metadata.url,'https://audio.test/current')
})

test('MusicFree resumes with a fresh relay URL and keeps loopback traffic out of the configured proxy',async t=>{
  const info=task('musicfree-download')
  info.metadata.musicInfo.source='musicfree_0123456789abcdef01234567'
  info.metadata.url='http://127.0.0.1:11111/musicfree/'+'a'.repeat(48)
  const fresh='http://127.0.0.1:22222/musicfree/'+'b'.repeat(48)
  let lookups=0
  const f=fixture(t,{list:[info],url:async()=>{lookups++;return fresh},proxy:{enable:true,host:'proxy.example',port:'7890'}})
  await f.actions.startDownloadTasks(f.list);await flush();await flush()
  assert.equal(lookups,1)
  assert.equal(info.metadata.url,fresh)
  assert.equal(f.startArgs[0][0],undefined)
})
test('C09/C10: completion waits for tags; failed post-processing retries without redownloading audio',async t=>{
  const f=fixture(t), info=f.list[0]
  await f.actions.startDownloadTasks(f.list);await flush()
  f.callbacks[0]({action:'complete'});await flush()
  assert.equal(info.status,'run');assert.equal(info.isComplate,false);assert.equal(f.lyrics,1)
  f.finish(true);await flush();await flush()
  assert.equal(info.status,'error');assert.equal(info.audioDownloaded,true);assert.equal(info.failure.kind,'postprocess')
  f.newWrite();await f.actions.retryFailedDownloads('postprocess');await flush();await flush()
  assert.deepEqual(f.started,['a']);assert.equal(f.writes,2)
  f.finish();await flush();await flush()
  assert.equal(info.status,'completed');assert.equal(info.isComplate,true);assert.equal(info.failure,undefined)
})
test('C14: retry by failure reason leaves unrelated errors unchanged',async t=>{
  const network=task('network'),disk=task('disk')
  network.status=disk.status='error';network.failure={kind:'network'};disk.failure={kind:'disk'}
  const f=fixture(t,{list:[disk,network]})
  await f.actions.retryFailedDownloads('network');await flush()
  assert.deepEqual(f.started,['network']);assert.equal(disk.status,'error')
})
test('C09: pausing during a tag write keeps synchronization locked until the writer settles',async t=>{
  const f=fixture(t)
  await f.actions.startDownloadTasks(f.list);await flush()
  f.callbacks[0]({action:'complete'});await flush()
  await f.actions.pauseDownloadTasks(f.list)
  await assert.rejects(f.actions.withDownloadListSync(async()=>{}),/downloads_running/)
  f.finish();await flush();await flush()
  await f.actions.withDownloadListSync(async()=>{})
  assert.equal(f.list[0].status,'pause')
})
test('C15: priority chooses queued tasks first and reconnect does not resume manual pauses',async t=>{
  const a=task('normal'),b=task('priority');b.priority=1
  const f=fixture(t,{list:[a,b]})
  await f.actions.startDownloadTasks(f.list);await flush()
  assert.deepEqual(f.started,['priority'])
  navigator.onLine=false;f.events.offline();await flush()
  assert.equal(b.status,'waiting')
  await f.actions.pauseDownloadTasks([b]);await flush()
  navigator.onLine=true;f.events.online();await flush();await flush()
  assert.equal(b.status,'pause');assert.deepEqual(f.started,['priority','normal'])
})
