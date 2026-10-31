// Fixed trusted PID 1, mounted read-only. Caller argv is data for an unprivileged
// child, never JavaScript source. A child cannot signal/ptrace this root process.
export async function runContainerSupervisor(){
const {spawn}=await import('node:child_process')
const {stat}=await import('node:fs/promises')
const [deadlineText,identityText,executable,...argv]=process.argv.slice(2),deadline=Number(deadlineText)
if(!Number.isSafeInteger(deadline)||deadline<=Date.now()||!executable)process.exit(124)
// Docker/runc resolves the bind source after the Agent's final path check.
// Verify the actual mounted directory before any untrusted program can run.
let expected
try{expected=JSON.parse(identityText)}catch{process.exit(125)}
if(!expected||Object.keys(expected).sort().join(',')!=='birth,dev,ino'||!['birth','dev','ino'].every(k=>typeof expected[k]==='string'&&/^(0|[1-9][0-9]{0,39})$/.test(expected[k]))||expected.ino==='0'||expected.birth==='0')process.exit(125)
for(const path of ['/workspace','.']){
 const s=await stat(path,{bigint:true})
 if(!s.isDirectory()||String(s.dev)!==expected.dev||String(s.ino)!==expected.ino||String(s.birthtimeNs)!==expected.birth)process.exit(125)
}
process.setgroups([])
let child
// Exiting namespace PID1 tears down its descendants. This needs no CAP_KILL;
// the supervisor intentionally has only SETUID/SETGID for the initial spawn.
const stop=code=>process.exit(code)
const timer=setTimeout(()=>stop(124),Math.max(1,deadline-Date.now()))
process.once('SIGTERM',()=>stop(143));process.once('SIGINT',()=>stop(130))
try{
 child=spawn(executable,argv,{uid:65532,gid:65532,env:{PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8',HOME:'/tmp'},stdio:['ignore','inherit','inherit']})
 child.once('error',()=>stop(126))
 child.once('close',(code,signal)=>{clearTimeout(timer);stop(code??(signal?128:1))})
}catch{stop(126)}
}
// Self-contained function text avoids an eval CLI and keeps direct source builds
// and the normal Agent bundler on the same canonical supervisor implementation.
export const CONTAINER_SUPERVISOR_SOURCE=`(${runContainerSupervisor.toString()})().catch(()=>process.exit(126))\n`
