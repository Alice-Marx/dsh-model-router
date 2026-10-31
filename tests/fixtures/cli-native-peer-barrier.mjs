// Test-only deterministic barriers injected into a copy of the real PowerShell helper.
// Production source is never edited by this fixture and has no runtime barrier switch.
function replaceOnce(source, anchor, replacement, label) {
  const first = source.indexOf(anchor)
  if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0) throw new Error(`BARRIER_ANCHOR_${label}`)
  return source.slice(0, first) + replacement + source.slice(first + anchor.length)
}

export function cliNativePeerBarrierSource(original, { legacy = false } = {}) {
  let source = original
  const signature = 'public static void Supervise(string executable,string[] args,string cwd,int lifetime)'
  source = replaceOnce(source, signature, signature.replace('int lifetime)', 'int lifetime,string barrierStage,string barrierDir)'), 'SIGNATURE')
  const invoke = '[DshNativePeer]::Supervise($spec.executable,[string[]]$spec.args,$spec.cwd,[int]$spec.ttlMs)'
  source = replaceOnce(source, invoke, invoke.replace('[int]$spec.ttlMs)', '[int]$spec.ttlMs,[string]$spec.barrier.stage,[string]$spec.barrier.dir)'), 'INVOKE')

  const imports = []
  if (!source.includes('static extern bool GetProcessTimes(')) imports.push('  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr p,out long creation,out long exit,out long kernel,out long user);')
  if (!source.includes('static extern uint GetCurrentProcessId(')) imports.push('  [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();')
  if (!source.includes('static extern IntPtr GetCurrentProcess(')) imports.push('  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();')
  if (!source.includes('static extern bool IsProcessInJob(')) imports.push('  [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr p,IntPtr job,out bool member);')
  if (legacy && !source.includes('AssignProcessToJobObject(job,pi.process)')) imports.push('  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr p);')
  const barrier = `${imports.join('\n')}${imports.length ? '\n' : ''}  static string testBarrierStage,testBarrierDir;
  static void TestBarrier(string stage,PI pi,IntPtr job) {
    if(testBarrierStage==null||testBarrierStage!=stage||testBarrierDir==null)return;
    long childStart=0,ownStart=0,exit=0,kernel=0,user=0;bool member=false;
    if(pi.process!=IntPtr.Zero){GetProcessTimes(pi.process,out childStart,out exit,out kernel,out user);IsProcessInJob(pi.process,job,out member);}
    GetProcessTimes(GetCurrentProcess(),out ownStart,out exit,out kernel,out user);
    File.WriteAllText(Path.Combine(testBarrierDir,"gate-"+stage+".json"),"{\\"stage\\":\\""+stage+"\\",\\"wrapperPid\\":"+GetCurrentProcessId()+",\\"wrapperStartFileTime\\":\\""+ownStart.ToString()+"\\",\\"childPid\\":"+pi.pid+",\\"childStartFileTime\\":\\""+childStart.ToString()+"\\",\\"inJob\\":"+(member?"true":"false")+"}");
    while(!File.Exists(Path.Combine(testBarrierDir,"release-"+stage)))Thread.Sleep(20);
  }
  public static void Supervise`
  source = replaceOnce(source, '  public static void Supervise', barrier, 'METHOD')
  source = replaceOnce(source, '    PI pi=new PI(); IntPtr childIn=', '    testBarrierStage=barrierStage;testBarrierDir=barrierDir;\n    PI pi=new PI(); IntPtr childIn=', 'FIELDS')

  const createPattern = /^(\s*)if\(!CreateProcess\([^\n]+\n/m
  const create = source.match(createPattern)
  if (!create) throw new Error('BARRIER_ANCHOR_CREATE')
  source = source.replace(createPattern, `${create[1]}TestBarrier("preCreate",pi,job);\n${create[0]}${create[1]}TestBarrier("created",pi,job);\n`)

  if (legacy && !source.includes('AssignProcessToJobObject(job,pi.process)')) {
    source = replaceOnce(source, 'CREATE_NO_WINDOW|CREATE_SUSPENDED|CREATE_UNICODE_ENVIRONMENT|EXTENDED_STARTUPINFO_PRESENT', 'CREATE_NO_WINDOW|CREATE_SUSPENDED', 'LEGACY_FLAGS')
    source = replaceOnce(source, 'startup.StartupInfo.cb=Marshal.SizeOf(typeof(SIX));', 'startup.StartupInfo.cb=Marshal.SizeOf(typeof(SI));', 'LEGACY_STARTUP')
    source = replaceOnce(source, '      TestBarrier("created",pi,job);\n', '      TestBarrier("created",pi,job);\n      if(!AssignProcessToJobObject(job,pi.process))throw new Exception("JOB_ASSIGN_FAILED");\n', 'LEGACY_ASSIGN')
  }
  const resumePattern = /^(\s*)(?:if\()?ResumeThread\(pi\.thread\)[^\n]+\n/m
  const resume = source.match(resumePattern)
  if (!resume) throw new Error('BARRIER_ANCHOR_RESUME')
  source = source.replace(resumePattern, `${resume[0]}${resume[1]}TestBarrier("resumed",pi,job);\n`)
  return source
}
