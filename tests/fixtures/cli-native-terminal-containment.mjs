function replaceOnce(source, anchor, replacement, label) {
  const first = source.indexOf(anchor)
  if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0) throw new Error(`K31_ANCHOR_${label}`)
  return source.slice(0, first) + replacement + source.slice(first + anchor.length)
}

export function cliNativeTerminalAdapterSource(original, nativeProcessUrl) {
  return replaceOnce(original, "import { privateEnvironment } from './native-process.mjs'",
    `import { privateEnvironment } from ${JSON.stringify(nativeProcessUrl)}`, 'PRIVATE_ENVIRONMENT')
}

export const BREAKAWAY_SOURCE = String.raw`
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
public static class K31BreakawayProbe {
  const uint CREATE_SUSPENDED=0x00000004,CREATE_UNICODE_ENVIRONMENT=0x00000400,CREATE_BREAKAWAY_FROM_JOB=0x01000000;
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct SI {
    public int cb; public string reserved,desktop,title; public int x,y,xs,ys,xc,yc,fill,flags; public short show,cb2; public IntPtr r2,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] public struct PI { public IntPtr process,thread; public uint pid,tid; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref SI startup,out PI pi);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out long creation,out long exit,out long kernel,out long user);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  static string Quote(string value) { return "\""+value.Replace("\"","\\\"")+"\""; }
  public static int Main(string[] args) {
    if(args.Length!=4)return 64;
    uint flags=CREATE_SUSPENDED|CREATE_UNICODE_ENVIRONMENT|CREATE_BREAKAWAY_FROM_JOB;
    SI startup=new SI();startup.cb=Marshal.SizeOf(typeof(SI));PI pi=new PI();
    StringBuilder command=new StringBuilder(Quote(args[0])+" "+Quote(args[1])+" breakaway-child "+Quote(args[2]));
    bool created=CreateProcessW(null,command,IntPtr.Zero,IntPtr.Zero,false,flags,IntPtr.Zero,null,ref startup,out pi);
    int error=created?0:Marshal.GetLastWin32Error();long creation=0;bool terminated=false;uint waited=0;
    if(created) {
      long exit,kernel,user;GetProcessTimes(pi.process,out creation,out exit,out kernel,out user);
      terminated=TerminateProcess(pi.process,137);waited=WaitForSingleObject(pi.process,5000);
      CloseHandle(pi.thread);CloseHandle(pi.process);
    }
    File.WriteAllText(args[3],"{\"attempted\":true,\"flags\":"+flags+",\"created\":"+(created?"true":"false")+",\"win32\":"+error+",\"pid\":"+pi.pid+",\"creation\":\""+creation+"\",\"cleanupTerminated\":"+(terminated?"true":"false")+",\"cleanupWait\":"+waited+"}");
    return created?3:0;
  }
}
`

export function cliNativeTerminalDeathHelperSource(original) {
  let source = replaceOnce(original, '  $spec = $line | ConvertFrom-Json', `  $spec = $line | ConvertFrom-Json
  $k31Evidence = Split-Path -Parent ([string]$spec.privateOutput)
  [IO.File]::WriteAllText((Join-Path $k31Evidence 'helper-pid.json'), ('{"pid":'+$PID+'}'))`, 'HELPER_PID')
  source = replaceOnce(source, '  static void Write(string value)', `  static void Barrier(string stage,string privateOutput,IDictionary environment) {
    if(!environment.Contains("K31_BARRIER")||!string.Equals(Convert.ToString(environment["K31_BARRIER"]),stage,StringComparison.Ordinal))return;
    string parent=Directory.GetParent(privateOutput).FullName;
    File.WriteAllText(Path.Combine(parent,"helper-barrier-"+stage+".json"),"{\\"stage\\":\\""+stage+"\\"}");
    while(true)Thread.Sleep(1000);
  }
  static void Write(string value)`, 'BARRIER_METHOD')
  source = replaceOnce(source, '      if(!CreateProcess(executable,command', '      Barrier("preCreate",privateOutput,environment);\n      if(!CreateProcess(executable,command', 'PRE_CREATE')
  source = replaceOnce(source, '      Write("{\\"control\\":\\"launcherCreated\\",\\"pid\\":"+pi.pid+",\\"start\\":\\""+start+"\\",\\"containment\\":\\"windows-job\\",\\"conpty\\":true}");',
    '      Write("{\\"control\\":\\"launcherCreated\\",\\"pid\\":"+pi.pid+",\\"start\\":\\""+start+"\\",\\"containment\\":\\"windows-job\\",\\"conpty\\":true}");Barrier("created",privateOutput,environment);', 'CREATED')
  source = replaceOnce(source, '            Write("{\\"control\\":\\"started\\",\\"pid\\":"+pi.pid+",\\"start\\":\\""+start+"\\"}");',
    '            Write("{\\"control\\":\\"started\\",\\"pid\\":"+pi.pid+",\\"start\\":\\""+start+"\\"}");Barrier("resumed",privateOutput,environment);', 'RESUMED')
  source = replaceOnce(source, '          Write("{\\"control\\":\\"hostExit\\",\\"pid\\":"+pi.pid+",\\"start\\":\\""+start+"\\",\\"exitCode\\":"+exitCode+"}");',
    '          Write("{\\"control\\":\\"hostExit\\",\\"pid\\":"+pi.pid+",\\"start\\":\\""+start+"\\",\\"exitCode\\":"+exitCode+"}");Barrier("hostExited",privateOutput,environment);', 'HOST_EXITED')
  return source
}

export function cliNativeTerminalQueryFaultHelperSource(original) {
  let source = replaceOnce(original, '  static readonly IntPtr PROC_THREAD_ATTRIBUTE_JOB_LIST=', '  static string QueryMode=null,QueryReady=null;\n  static readonly IntPtr PROC_THREAD_ATTRIBUTE_JOB_LIST=', 'QUERY_FIELDS')
  source = replaceOnce(source, '    uint creatorPid;IntPtr creator=OpenCreatorProcess(out creatorPid);', '    QueryMode=environment.Contains("K31_QUERY")?Convert.ToString(environment["K31_QUERY"]):null;QueryReady=Path.Combine(Directory.GetParent(privateOutput).Parent.FullName,"ready.json");\n    uint creatorPid;IntPtr creator=OpenCreatorProcess(out creatorPid);', 'QUERY_SETUP')
  source = replaceOnce(source, '      uint returned;if(!QueryInformationJobObject(job,1,memory,(uint)Marshal.SizeOf(typeof(BASIC_ACCOUNTING)),out returned)||returned!=Marshal.SizeOf(typeof(BASIC_ACCOUNTING)))return false;',
    '      uint returned;if(!QueryInformationJobObject(job,1,memory,(uint)Marshal.SizeOf(typeof(BASIC_ACCOUNTING)),out returned))return false;if(File.Exists(QueryReady+".armed")&&QueryMode=="fail")return false;if(File.Exists(QueryReady+".armed")&&QueryMode=="bad-length")returned=0;if(returned!=Marshal.SizeOf(typeof(BASIC_ACCOUNTING)))return false;', 'QUERY_RESULT')
  return source
}

export function cliNativeTerminalStopTimeoutHelperSource(original) {
  return replaceOnce(original, 'if(!stopRequested){TerminateJobObject(job,137);stopRequested=true;stopClock=Stopwatch.StartNew();Write("{\\"control\\":\\"stopRequested\\",\\"reason\\":\\""+(control=="abort"?"abort":"stop")+"\\"}");}',
    'if(environment.Contains("K31_STOP_TIMEOUT")){}else if(!stopRequested){TerminateJobObject(job,137);stopRequested=true;stopClock=Stopwatch.StartNew();Write("{\\"control\\":\\"stopRequested\\",\\"reason\\":\\""+(control=="abort"?"abort":"stop")+"\\"}");}', 'STOP_TIMEOUT')
}

export function cliNativeTerminalDataFaultHelperSource(original) {
  let source = replaceOnce(original, 'bool controlEnded=false,stopRequested=false;', 'bool controlEnded=false,stopRequested=false,dataFaulted=false;', 'DATA_FLAG')
  source = replaceOnce(source, '        uint active;if(QueryActive(job,out active))', `        if(!dataFaulted&&environment.Contains("K31_DATA_FAULT")&&File.Exists(Path.Combine(Directory.GetParent(privateOutput).Parent.FullName,"data-fault.armed"))) { dataFaulted=true;data.Dispose();throw new Exception("DATA_FAULT_INJECTED"); }
        uint active;if(QueryActive(job,out active))`, 'DATA_FAULT')
  return source
}

export function cliNativeTerminalControlEndAdapterSource(original) {
  let source = replaceOnce(original, "import { spawn } from 'node:child_process'", "import { spawn } from 'node:child_process'\nimport { existsSync, writeFileSync } from 'node:fs'", 'CONTROL_IMPORT')
  source = replaceOnce(source, '  const accept = frame => {', '  const accept = frame => {\n    if(env.K31_CONTROL_EOF==="1"&&frame.control==="stopRequested")writeFileSync(join(cwd,"stop-requested.json"),JSON.stringify(frame));', 'CONTROL_OBSERVE')
  source = replaceOnce(source, "    else if (frame.control === 'started') startedCall?.wait.resolve(Object.freeze({ pid: frame.pid, startIdentity: frame.start, started: true }))", `    else if (frame.control === 'started') {
      startedCall?.wait.resolve(Object.freeze({ pid: frame.pid, startIdentity: frame.start, started: true }))
      if(env.K31_CONTROL_EOF==='1') {
        const timer=setInterval(()=>{if(existsSync(join(cwd,'control-eof.armed'))){clearInterval(timer);helper.stdin.end()}},25)
      }
    }`, 'CONTROL_EOF')
  return source
}

export function cliNativeTerminalFrameAdapterSource(original) {
  let source = replaceOnce(original, "import { spawn } from 'node:child_process'", "import { spawn } from 'node:child_process'\nimport { existsSync, writeFileSync } from 'node:fs'", 'FRAME_IMPORT')
  source = replaceOnce(source, "    else if (frame.control === 'started') startedCall?.wait.resolve(Object.freeze({ pid: frame.pid, startIdentity: frame.start, started: true }))", `    else if (frame.control === 'started') {
      startedCall?.wait.resolve(Object.freeze({ pid: frame.pid, startIdentity: frame.start, started: true }))
      if(env.K31_DUPLICATE_STARTED==='1') {
        const timer=setInterval(()=>{if(existsSync(join(cwd,'duplicate-started.armed'))){clearInterval(timer);accept(frame)}},25)
      }
    }`, 'DUPLICATE_STARTED')
  source = replaceOnce(source, "      emit('tree', Object.freeze({ proof: frame.proof, activeProcesses: 0 }))", `      emit('tree', Object.freeze({ proof: frame.proof, activeProcesses: 0 }))
      if(env.K31_LATE_FRAME==='1')setTimeout(()=>{const late={control:'hostExit',pid:frame.pid,start:frame.start,exitCode:0};writeFileSync(join(cwd,'late-frame-attempt.json'),JSON.stringify(late));accept(late)},100)`, 'LATE_FRAME')
  return source
}
