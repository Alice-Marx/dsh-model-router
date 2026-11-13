import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

export const managedRuntimeTool=id=>['gemini','stepcode','dsh-tui','mimo-code'].includes(id)
/** The ACL runner chooses its private writable TEMP only after it starts.
 * Provision CLI caches there, never in the user's account home or project. */
export async function prepareOfficialRuntime(spec,toolId,workspace,mode){
 const stateRoot=await mkdtemp(join(tmpdir(),'dsh-official-'))
 const manifest=join(stateRoot,'launch.json')
 try{await writeFile(manifest,JSON.stringify({toolId,spec}),{flag:'wx',mode:0o600})}
 catch(error){await rm(stateRoot,{recursive:true,force:true});throw error}
 return {spec:{...spec,file:process.execPath,args:[...(process.versions.electron?['--expose-internals']:[]),fileURLToPath(new URL('./official-runtime-bootstrap.mjs',import.meta.url)),manifest],env:{ELECTRON_RUN_AS_NODE:'1'}},
  policy:{mode:'workspace-write',workspaceRoot:mode==='read-only'?stateRoot:workspace},
  dispose:()=>rm(stateRoot,{recursive:true,force:true})}
}
