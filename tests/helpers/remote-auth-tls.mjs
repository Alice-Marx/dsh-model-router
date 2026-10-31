import {execFileSync} from 'node:child_process'
import {join,resolve} from 'node:path'
import {writeFile,access} from 'node:fs/promises'

// Generate ephemeral fixture keys only under ignored tmp/integration/.
export async function createTlsFixture(dir){
  const names=['ca.crt','server.key','server.crt','client.key','client.crt','untrusted.key','untrusted.crt']
  if(process.env.DSH_TEST_TLS_FIXTURE){
    const supplied=resolve(process.env.DSH_TEST_TLS_FIXTURE)
    for(const name of names)await access(join(supplied,name))
    return Object.fromEntries(names.map(name=>[name,join(supplied,name)]))
  }
  const choices=['openssl',...(process.platform==='win32'?['C:/Program Files/Git/usr/bin/openssl.exe']:[])]
  const binary=choices.find(value=>{try{execFileSync(value,['version'],{windowsHide:true,stdio:'ignore'});return true}catch{return false}})
  if(!binary)throw new Error('TLS native tests require OpenSSL (Git for Windows includes it)')
  const run=args=>execFileSync(binary,args,{cwd:dir,windowsHide:true,stdio:'pipe'})
  run(['req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca.key','-out','ca.crt','-days','1','-subj','/CN=DSH ephemeral test CA'])
  for(const name of ['server','client']){
    run(['req','-new','-newkey','rsa:2048','-nodes','-keyout',`${name}.key`,'-out',`${name}.csr`,'-subj',`/CN=DSH ephemeral ${name}`])
    await writeFile(join(dir,`${name}.ext`),`basicConstraints=CA:FALSE\nextendedKeyUsage=${name==='server'?'serverAuth':'clientAuth'}\n${name==='server'?'subjectAltName=IP:127.0.0.1\n':''}`)
    run(['x509','-req','-in',`${name}.csr`,'-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-out',`${name}.crt`,'-days','1','-extfile',`${name}.ext`])
  }
  run(['req','-x509','-newkey','rsa:2048','-nodes','-keyout','untrusted.key','-out','untrusted.crt','-days','1','-subj','/CN=DSH untrusted test client'])
  return Object.fromEntries(names.map(name=>[name,join(dir,name)]))
}
