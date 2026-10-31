// Synthetic file programs; every marker is inside the test's owned directory.
import {spawn} from 'node:child_process'
import {writeFileSync,appendFileSync} from 'node:fs'
const [mode,...args]=process.argv.slice(2)
if(mode==='grandchild'){
 const [marker,delay]=args
 setTimeout(()=>{appendFileSync(marker,'late');process.exit(0)},Number(delay))
}else if(mode==='tree'||mode==='exit-with-child'){
 const [ready,marker]=args,child=spawn(process.execPath,[import.meta.filename,'grandchild',marker,'900'],{stdio:'ignore',windowsHide:true})
 writeFileSync(ready,JSON.stringify({pid:process.pid,descendantPid:child.pid}))
 if(mode==='exit-with-child')process.exit(0)
 else setInterval(()=>{},100)
}else if(mode==='hold'){
 if(args[0])writeFileSync(args[0],JSON.stringify({pid:process.pid}))
 setInterval(()=>{},100)
}else{
 console.log(JSON.stringify({args,cwd:process.cwd()}))
 if(mode==='exit7')process.exitCode=7
}
