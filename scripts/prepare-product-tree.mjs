import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync,mkdirSync,readFileSync,writeFileSync,lstatSync} from 'node:fs'
import {dirname,isAbsolute,resolve} from 'node:path'

// Build a reviewable current source tree. This command never commits, uploads,
// deletes, installs dependencies or replaces an existing staging directory.
const root=resolve(import.meta.dirname,'..'), output=process.argv[2]&&resolve(process.argv[2])
assert.ok(output&&output!==root,'Provide a new output directory')
assert.ok(!existsSync(output),'Refusing to overwrite an existing directory')
const top=new Set(['.gitignore','.gitattributes','LICENSE','README.md','README.zh.md','README.i18n.yaml',
 'package.json','package-lock.json','cordis.patch.yml'])
const prefixes=['.github/assets/','.dsh-plugin/','apps/integration-client/','apps/desktop-client/','packages/',
 'modules/bot-runtime/','modules/independent-runtime/','modules/openmaus-protocol/','native/','remote-computer-agent/',
 'scripts/','tests/','contracts/','deploy/']
const upstreamPolicy='modules/bot-runtime/vendor/ds-bot/.npmrc'
const inventory=execFileSync('git',['ls-files','-c','-o','--exclude-standard','-z'],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024}).split('\0').filter(Boolean)
const paths=[...new Set([...inventory,upstreamPolicy])].sort()
const provenance=JSON.parse(readFileSync(resolve(root,'modules/bot-runtime/SOURCE.json'),'utf8'))
const policyHash=provenance.files.find(row=>row.path==='vendor/ds-bot/.npmrc')?.sha256
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const copied=[]
for(const name of paths){
 if(!top.has(name)&&!prefixes.some(prefix=>name.startsWith(prefix)))continue
 assert.ok(!isAbsolute(name)&&!name.split('/').includes('..'),'Source path escapes the checkout')
 if(name.split('/').some(part=>['node_modules','.git','.dsh','__pycache__'].includes(part)))continue
 if(/\.(?:log|tgz|tmp|temp|sqlite|db)$/.test(name)||/(?:^|\/)\.env(?:\.|$)|_token\.txt$/.test(name))continue
 if(name.endsWith('/.npmrc')&&name!==upstreamPolicy)continue
 const source=resolve(root,name)
 if(!existsSync(source))continue
 assert.ok(lstatSync(source).isFile()&&!lstatSync(source).isSymbolicLink(),`Unsupported source member: ${name}`)
 const payload=readFileSync(source)
 if(name===upstreamPolicy)assert.equal(sha(payload),policyHash,'Pinned dependency policy changed')
 const target=resolve(output,name)
 mkdirSync(dirname(target),{recursive:true});writeFileSync(target,payload)
 copied.push(name)
}
assert.ok(copied.includes('scripts/test-plan.json')&&copied.includes('modules/openmaus-protocol/SOURCE.json'))
assert.ok(!copied.some(name=>/^(?:docs|output|tmp|host-parity-audit)\//.test(name)))
// All test files, helper fixtures and declared stages are retained, including
// wildcard plans; no test name is mistaken for a literal source file.
for(const name of ['README.md','README.zh.md']){
 const file=resolve(output,name)
 const text=readFileSync(file,'utf8').replace(/\]\((docs\/[^)#]+)(#[^)]*)?\)/g,(_all,path,anchor)=>
   `](https://gitlab.com/Alice_marx/dsh-model-router/-/blob/main/${path}${anchor??''})`)
 writeFileSync(file,text)
}
const pairing=resolve(output,'README.i18n.yaml')
let text=readFileSync(pairing,'utf8')
for(const name of ['README.md','README.zh.md']){
 const bytes=readFileSync(resolve(output,name)),blob=createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
 text=text.replace(new RegExp(`^${name.replaceAll('.','\\.')}: .+$`,'m'),`${name}: ${blob}`)
}
writeFileSync(pairing,text)
const files=copied.map(path=>{const bytes=readFileSync(resolve(output,path));return{path,bytes:bytes.length,sha256:sha(bytes)}})
const manifest=JSON.parse(readFileSync(resolve(output,'package.json'),'utf8'))
console.log(JSON.stringify({status:'prepared-not-yet-validated',output,version:manifest.version,files:files.length,
 testPlanRetained:true,upstreamPolicyVerified:true,remoteWritePerformed:false,
 sourceInventorySha256:sha(Buffer.from(JSON.stringify(files)))}))
