import { mkdir, mkdtemp, writeFile, readFile, symlink, appendFile, copyFile, cp, readdir, lstat, unlink } from 'node:fs/promises'
import { basename, dirname, resolve, join } from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
// Uses a real installed Harness with a new, isolated home. No UI or API mocks.
const repo=resolve(import.meta.dirname,'..'),passed=process.argv.slice(2)
const option=name=>{const at=passed.indexOf(name);if(at<0)return null;if(!passed[at+1])throw Error('Missing '+name);return passed[at+1]}
const source=resolve(option('--source')??repo)
const desktopRoot=option('--desktop-root')??(process.env.LOCALAPPDATA?join(process.env.LOCALAPPDATA,'Programs/DeepSeek Harness'):null)
if(process.platform!=='win32'||!desktopRoot)throw Error('Provide an existing Windows Harness installation with --desktop-root')
const pkg=JSON.parse(await readFile(join(source,'package.json'),'utf8'))
if(!['@ljwei-stak/dsh-model-route-bot','@ljwei-stak/dsh-model-router'].includes(pkg.name))throw Error('A Bot or router-only package is required')
const base=resolve(option('--base')??join(repo,'tmp/integration/actual-harness-ui'))
await mkdir(base,{recursive:true})
const reuse=option('--reuse-run')
const run=reuse?resolve(reuse):await mkdtemp(join(base,'case-'))
const home=join(run,'home'),profile=join(home,'profiles/verification'),pluginLink=join(profile,'node_modules',pkg.name)
if(reuse){
  if(dirname(run)!==base||!basename(run).startsWith('case-'))throw Error('Use a case from this isolated verification directory')
  const previous=JSON.parse(await readFile(join(run,'stopped.json'),'utf8'))
  if(previous.packageName!==pkg.name||!(await lstat(pluginLink)).isSymbolicLink())throw Error('The stopped case must contain the same package edition')
  await unlink(pluginLink)
  for(const name of ['stopped.json','stop.flag','connection.private.json']){
    await unlink(join(run,name)).catch(error=>{if(error.code!=='ENOENT')throw error})
  }
}
await mkdir(dirname(pluginLink),{recursive:true})
await symlink(source,pluginLink,'junction')
// Explicitly opt into installed visual plugins, with fresh isolated settings.
// Only package code and an explicitly named skin are read from the live profile.
const visualProfile = option('--visual-profile'), visualBundles = [], classicVisuals = []
if (visualProfile) {
 const modules = join(resolve(visualProfile), 'node_modules')
 await symlink(join(modules, '@linxin666'), join(profile, 'node_modules/@linxin666'), 'junction')
 for (const name of await readdir(modules)) if (name === 'dsh-plugin-wallpaper-engine' || name.startsWith('dsh-plugin-wallpaper-engine-')) await symlink(join(modules, name), join(profile, 'node_modules', name), 'junction')
 for (const name of ['@linxin666/dsh-client-ui-skin-center', 'dsh-plugin-wallpaper-engine']) {
  const installed = JSON.parse(await readFile(join(modules, name, 'package.json'), 'utf8'))
  if (installed.name !== name) throw Error('Unexpected visual package identity')
  visualBundles.push(name); classicVisuals.push({ name, version: installed.version })
 }
}
let seedSkin = null
const skinDirectory = option('--skin-directory')
if (skinDirectory) {
 if (!visualProfile) throw Error('--skin-directory requires --visual-profile')
 const manifest = JSON.parse(await readFile(join(resolve(skinDirectory), 'skin.json'), 'utf8'))
 if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) throw Error('Invalid skin id')
 seedSkin = { id: manifest.id, version: manifest.version }
 await cp(resolve(skinDirectory), join(home, 'skins', manifest.id), { recursive: true })
 await writeFile(join(home, 'skin-center-active.json'), JSON.stringify({ active: manifest.id, initialized: true,
  background: { enabled: true, backgroundOpacity: 25, backgroundBlurContent: 2, inputCardBlur: 9, bubbleOpacity: 45, bubbleBlur: 5 } }))
}
await writeFile(join(profile,'package.json'),JSON.stringify({private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app',...visualBundles,pkg.name]}}},null,2))
const verificationPlugin=option('--verification-plugin')
const verificationCache=option('--verification-cache')
if(verificationPlugin&&verificationCache){await mkdir(join(home,'model-router'),{recursive:true});for(const file of ['npm-attestations.json','vendor-release-digests.json'])await copyFile(join(resolve(verificationCache),file),join(home,'model-router',file))}
const patches = []
if (verificationPlugin) patches.push({ insert: [{ id: 'official-execution-verification', name: pathToFileURL(resolve(verificationPlugin)).href }] })
if (visualProfile) patches.push({ insert: [{ id: 'visual-compat', name: '@linxin666/dsh-web-all' }] })
await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify(patches)+'\n')
const env={ELECTRON_RUN_AS_NODE:'1',DSH_HOME:home,DSH_STATE_HOME:home,DSH_TELEMETRY:'0'}
for(const key of ['PATH','Path','PATHEXT','SystemRoot','windir','ComSpec','USERPROFILE','HOME','APPDATA','LOCALAPPDATA','TEMP','TMP','TMPDIR','LANG'])if(process.env[key])env[key]=process.env[key]
if(passed.includes('--offline-tools')){
  delete env.Path
  env.PATH=[join(env.SystemRoot??env.windir,'System32'),dirname(process.execPath)].join(';')
}
for(const key of ['USERPROFILE','HOME','APPDATA','LOCALAPPDATA','TEMP','TMP','TMPDIR']){env[key]=join(run,'isolated-user',key.toLowerCase());await mkdir(env[key],{recursive:true})}
const executable=join(desktopRoot,'DeepSeek Harness.exe')
const cli=join(desktopRoot,'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')
const versionScript=`process.stdout.write(JSON.parse(require('node:fs').readFileSync(${JSON.stringify(join(desktopRoot,'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/package.json'))},'utf8')).version)`
const harnessVersion=(await promisify(execFile)(executable,['--expose-internals','-e',versionScript],{env,windowsHide:true,timeout:10000,maxBuffer:16000})).stdout.trim()
if(!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(harnessVersion))throw Error('Cannot identify the installed Harness runtime')
const args=['--expose-internals',cli,'--profile','verification','--host','127.0.0.1','--port','0','--no-open']
const child=spawn(executable,args,{cwd:run,env,windowsHide:true,stdio:['ignore','pipe','pipe']})
const chunks=[];let ready=false
const consume=b=>{
 chunks.push(b);void appendFile(join(run,'launcher.log'),b)
 if(!ready){const match=Buffer.concat(chunks).toString().replace(/\x1b\[[0-9;]*m/g,'').match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s\x1b]+/)
  if(match){ready=true;void writeFile(join(run,'connection.private.json'),JSON.stringify({ownerUrl:match[0],origin:new URL(match[0]).origin}));console.log(JSON.stringify({state:'ready',run,origin:new URL(match[0]).origin}))}}
}
child.stdout.on('data',consume);child.stderr.on('data',consume)
const stopTimer=setInterval(async()=>{try{await readFile(join(run,'stop.flag'));child.kill()}catch{}},500)
await writeFile(join(base,'current.json'),JSON.stringify({run,home,profile,source,packageName:pkg.name,packageVersion:pkg.version,harnessVersion,classicVisuals,seedSkin,launcherPid:child.pid},null,2))
process.once('SIGINT',()=>child.kill());process.once('SIGTERM',()=>child.kill())
const code=await new Promise(r=>child.once('close',r));clearInterval(stopTimer);await writeFile(join(run,'launcher.log'),Buffer.concat(chunks))
await writeFile(join(run,'stopped.json'),JSON.stringify({packageName:pkg.name,code}))
console.log(JSON.stringify({code,run}));console.log(Buffer.concat(chunks).toString().replace(/([?&]token=)[^\s&]+/g,'$1[REDACTED]').slice(-8000));process.exitCode=code??1
