param([ValidateSet('server','client','supervise','probe','protect')][string]$Mode)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false, $true)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
# Only packaged source is compiled. No supplied command or script is evaluated.
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.IO.Pipes;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;
public static class DshNativePeer {
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetNamedPipeClientProcessId(SafePipeHandle h, out uint id);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetNamedPipeServerProcessId(SafePipeHandle h, out uint id);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr p, uint access, out IntPtr t);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr p, int info, ref PBI value, int size, out int returned);
  [StructLayout(LayoutKind.Sequential)] struct PBI { public IntPtr reserved; public IntPtr peb; public IntPtr r1; public IntPtr r2; public IntPtr pid; public IntPtr ppid; }
  static int Parent(int pid) {
    IntPtr h=OpenProcess(0x1000,false,(uint)pid); if(h==IntPtr.Zero) throw new Exception("PROCESS_UNREADABLE");
    try { PBI b=new PBI(); int n; if(NtQueryInformationProcess(h,0,ref b,Marshal.SizeOf(b),out n)!=0) throw new Exception("PARENT_UNREADABLE"); return b.ppid.ToInt32(); } finally { CloseHandle(h); }
  }
  static string Owner(int pid) {
    IntPtr h=OpenProcess(0x1000,false,(uint)pid), t=IntPtr.Zero; if(h==IntPtr.Zero) throw new Exception("OWNER_UNREADABLE");
    try { if(!OpenProcessToken(h,8,out t)) throw new Exception("OWNER_UNREADABLE"); using(WindowsIdentity i=new WindowsIdentity(t)) return i.User.Value; }
    finally { if(t!=IntPtr.Zero) CloseHandle(t); CloseHandle(h); }
  }
  public static string Identity(int pid) { using(Process p=Process.GetProcessById(pid)) return p.StartTime.ToUniversalTime().Ticks.ToString(); }
  static void SameOwner(int pid) { if(Owner(pid)!=WindowsIdentity.GetCurrent().User.Value) throw new Exception("OWNER_MISMATCH"); }
  static void Root(int pid, string start) { SameOwner(pid); if(Identity(pid)!=start) throw new Exception("ROOT_REPLACED"); }
  static void Descendant(int pid,int root,string start) {
    Root(root,start); int cursor=pid;
    for(int n=0;n<64;n++) { SameOwner(cursor); if(cursor==root) { Root(root,start); return; } cursor=Parent(cursor); if(cursor<1) break; }
    throw new Exception("PEER_OUTSIDE_TREE");
  }
  static void Write(string value) { Console.Out.WriteLine(value); Console.Out.Flush(); }
  static void Relay(Stream stream,int root,string start,int lifetime) {
    StreamReader reader=new StreamReader(stream,new UTF8Encoding(false,true),false,4096,true);
    StreamWriter writer=new StreamWriter(stream,new UTF8Encoding(false),4096,true); writer.AutoFlush=true;
    // .NET Framework Console.In.ReadLineAsync may synchronously block its caller.
    Task<string> fromPipe=reader.ReadLineAsync(), fromHost=Task.Run(()=>Console.In.ReadLine()); Stopwatch timer=Stopwatch.StartNew();
    while(timer.ElapsedMilliseconds<lifetime) {
      if(root>0) Root(root,start);
      int which=Task.WaitAny(new Task[]{fromPipe,fromHost},200);
      if(which<0) continue;
      string line=(which==0?fromPipe:fromHost).GetAwaiter().GetResult(); if(line==null) break;
      if(Encoding.UTF8.GetByteCount(line)>262144) throw new Exception("FRAME_LIMIT");
      if(which==0) { Write(line); fromPipe=reader.ReadLineAsync(); }
      else { writer.WriteLine(line); fromHost=Task.Run(()=>Console.In.ReadLine()); }
    }
  }
  public static void Server(string name,int root,string start,int lifetime) {
    Root(root,start);
    PipeSecurity acl=new PipeSecurity(); acl.SetAccessRuleProtection(true,false);
    acl.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User,PipeAccessRights.FullControl,AccessControlType.Allow));
    // Current-user ACL plus kernel-reported PID and creation identity; name is never a bearer capability.
    for(int attempt=0;attempt<16;attempt++) {
      using(NamedPipeServerStream pipe=new NamedPipeServerStream(name,PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous,4096,4096,acl)) {
        Write("{\"control\":\"listening\",\"pid\":"+Process.GetCurrentProcess().Id+",\"start\":\""+Identity(Process.GetCurrentProcess().Id)+"\"}");
        Task connected=pipe.WaitForConnectionAsync(); if(!connected.Wait(lifetime)) throw new Exception("BOOTSTRAP_EXPIRED");
        uint peer; if(!GetNamedPipeClientProcessId(pipe.SafePipeHandle,out peer)) throw new Exception("PEER_UNAVAILABLE");
        try { Descendant((int)peer,root,start); }
        catch { Write("{\"control\":\"rejected\",\"code\":\"PEER_OUTSIDE_TREE\"}"); continue; }
        Write("{\"control\":\"accepted\",\"peerPid\":"+peer+",\"rootPid\":"+root+",\"ownerVerified\":true,\"treeVerified\":true}");
        Relay(pipe,root,start,lifetime); return;
      }
    }
    throw new Exception("BOOTSTRAP_ATTEMPT_LIMIT");
  }
  public static void Client(string name,int server,string start,int lifetime) {
    SameOwner(server); if(Identity(server)!=start) throw new Exception("SERVER_REPLACED");
    using(NamedPipeClientStream pipe=new NamedPipeClientStream(".",name,PipeDirection.InOut,PipeOptions.Asynchronous)) {
      pipe.Connect(Math.Min(lifetime,15000)); uint peer;
      if(!GetNamedPipeServerProcessId(pipe.SafePipeHandle,out peer)||peer!=server) throw new Exception("SERVER_MISMATCH");
      SameOwner((int)peer); if(Identity((int)peer)!=start) throw new Exception("SERVER_REPLACED");
      Relay(pipe,server,start,lifetime);
    }
  }
  // CreateProcess admits the suspended child through a Job list atomically. This
  // is process containment, not an account/AppContainer/filesystem boundary.
  const uint CREATE_SUSPENDED=0x00000004,CREATE_NO_WINDOW=0x08000000,CREATE_UNICODE_ENVIRONMENT=0x00000400,EXTENDED_STARTUPINFO_PRESENT=0x00080000;
  static readonly IntPtr PROC_THREAD_ATTRIBUTE_JOB_LIST=(IntPtr)0x0002000D;
  static readonly IntPtr PROC_THREAD_ATTRIBUTE_HANDLE_LIST=(IntPtr)0x00020002;
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct SI {
    public int cb; public string reserved; public string desktop; public string title; public int x,y,xs,ys,xc,yc,fill,flags; public short show,cb2; public IntPtr r2,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct SIX { public SI StartupInfo; public IntPtr AttributeList; }
  [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC { public long time1,time2; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED { public BASIC basic; public IO io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [StructLayout(LayoutKind.Sequential)] struct SECURITY { public int size; public IntPtr descriptor; [MarshalAs(UnmanagedType.Bool)] public bool inherit; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref SIX startup,out PI pi);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref SECURITY s,uint size);
  [DllImport("kernel32.dll")] static extern bool SetHandleInformation(IntPtr h,uint mask,uint flags);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int type);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr p,out long creation,out long exit,out long kernel,out long user);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr a,string name);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr h,int info,ref EXTENDED value,uint length);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr p,IntPtr job,out bool member);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,int flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr p,uint code);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h,uint ms);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForMultipleObjects(uint count,IntPtr[] handles,bool all,uint ms);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool DuplicateHandle(IntPtr sourceProcess,IntPtr source,IntPtr targetProcess,out IntPtr target,uint access,bool inherit,uint options);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr p,out uint code);
  [DllImport("kernel32.dll")] static extern bool QueryInformationJobObject(IntPtr job,int kind,IntPtr value,uint length,out uint returned);
  static IntPtr OpenCreatorProcess() {
    PBI b=new PBI();int n;
    if(NtQueryInformationProcess(GetCurrentProcess(),0,ref b,Marshal.SizeOf(b),out n)!=0)return IntPtr.Zero;
    uint pid=(uint)b.ppid.ToInt32();if(pid==0||pid==GetCurrentProcessId())return IntPtr.Zero;
    IntPtr handle=OpenProcess(0x101000,false,pid);if(handle==IntPtr.Zero)return IntPtr.Zero;
    long parentStart=0,ownStart=0,exit=0,kernel=0,user=0;
    if(!GetProcessTimes(handle,out parentStart,out exit,out kernel,out user)||!GetProcessTimes(GetCurrentProcess(),out ownStart,out exit,out kernel,out user)||parentStart<=0||parentStart>=ownStart){CloseHandle(handle);return IntPtr.Zero;}
    return handle;
  }
  static bool CreatorEnded(IntPtr creator) { return creator==IntPtr.Zero||WaitForSingleObject(creator,0)!=0x102; }
  static Thread StartCreatorWatchdog(IntPtr creator,IntPtr job,ManualResetEvent shutdown) {
    Thread thread=new Thread(()=>{uint outcome=WaitForMultipleObjects(2,new IntPtr[]{creator,shutdown.SafeWaitHandle.DangerousGetHandle()},false,0xFFFFFFFF);if(outcome==1)return;TerminateJobObject(job,137);Environment.Exit(137);});
    thread.IsBackground=true;thread.Start();return thread;
  }
  static string Quote(string s) {
    StringBuilder b=new StringBuilder("\""); int slashes=0;
    foreach(char c in s) { if(c=='\\') { slashes++; continue; } if(c=='\"') b.Append('\\',slashes*2+1); else b.Append('\\',slashes); slashes=0; b.Append(c); }
    b.Append('\\',slashes*2); b.Append('"'); return b.ToString();
  }
  /**
   * Transfer raw-handle ownership into the FileStream in one step. The safe
   * handle is created and the raw pointer cleared before construction, so a
   * constructing failure closes the handle exactly once instead of racing the
   * raw-pointer cleanup in the caller's finally block.
   */
  static FileStream OwnStream(ref IntPtr handle,FileAccess access) {
    SafeFileHandle safe=new SafeFileHandle(handle,true); handle=IntPtr.Zero;
    try { return new FileStream(safe,access); } catch { safe.Dispose(); throw; }
  }
  /**
   * The child inherits exactly the listed handles (stdin/stdout ends plus a
   * private inheritable duplicate of stderr) instead of every inheritable
   * handle in this process. The duplicated stderr keeps the standard-handle
   * table valid under the restricted list; the original stays untouched.
   */
  static IntPtr DuplicateStderrForChild() {
    IntPtr raw=GetStdHandle(-12);
    if(raw==IntPtr.Zero||raw==(IntPtr)(-1)) return IntPtr.Zero;
    IntPtr duplicate;
    if(!DuplicateHandle(GetCurrentProcess(),raw,GetCurrentProcess(),out duplicate,0,true,2)) throw new Exception("STDERR_DUP_FAILED");
    return duplicate;
  }
  public static void Supervise(string executable,string[] args,string cwd,int lifetime) {
    IntPtr creator=OpenCreatorProcess();if(CreatorEnded(creator)){if(creator!=IntPtr.Zero)CloseHandle(creator);throw new Exception("CREATOR_PROCESS_ENDED");}
    IntPtr job=CreateJobObject(IntPtr.Zero,null); if(job==IntPtr.Zero){CloseHandle(creator);throw new Exception("JOB_UNAVAILABLE");}
    PI pi=new PI(); IntPtr childIn=IntPtr.Zero,parentIn=IntPtr.Zero,childOut=IntPtr.Zero,parentOut=IntPtr.Zero,attributeList=IntPtr.Zero,jobArray=IntPtr.Zero,handleArray=IntPtr.Zero,childError=IntPtr.Zero;
    bool attributeReady=false;Thread watchdog=null;ManualResetEvent shutdown=new ManualResetEvent(false);
    try {
      EXTENDED limits=new EXTENDED(); limits.basic.flags=0x2000;
      if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits))) throw new Exception("JOB_LIMIT_FAILED");
      watchdog=StartCreatorWatchdog(creator,job,shutdown);
      SECURITY security=new SECURITY(); security.size=Marshal.SizeOf(security); security.inherit=true;
      if(!CreatePipe(out childIn,out parentIn,ref security,0)||!SetHandleInformation(parentIn,1,0)) throw new Exception("STDIN_PIPE_FAILED");
      if(!CreatePipe(out parentOut,out childOut,ref security,0)||!SetHandleInformation(parentOut,1,0)) throw new Exception("STDOUT_PIPE_FAILED");
      childError=DuplicateStderrForChild();
      IntPtr[] inherited=childError==IntPtr.Zero?new IntPtr[]{childIn,childOut}:new IntPtr[]{childIn,childOut,childError};
      IntPtr attributeSize=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref attributeSize);if(attributeSize==IntPtr.Zero)throw new Exception("JOB_LIST_UNAVAILABLE");
      attributeList=Marshal.AllocHGlobal(attributeSize);if(!InitializeProcThreadAttributeList(attributeList,2,0,ref attributeSize))throw new Exception("JOB_LIST_INIT_FAILED");attributeReady=true;
      jobArray=Marshal.AllocHGlobal((IntPtr)Marshal.SizeOf(typeof(IntPtr)));Marshal.WriteIntPtr(jobArray,job);
      if(!UpdateProcThreadAttribute(attributeList,0,PROC_THREAD_ATTRIBUTE_JOB_LIST,jobArray,(IntPtr)Marshal.SizeOf(typeof(IntPtr)),IntPtr.Zero,IntPtr.Zero))throw new Exception("JOB_LIST_UPDATE_FAILED");
      handleArray=Marshal.AllocHGlobal((IntPtr)(Marshal.SizeOf(typeof(IntPtr))*inherited.Length));
      for(int n=0;n<inherited.Length;n++)Marshal.WriteIntPtr(handleArray,n*IntPtr.Size,inherited[n]);
      if(!UpdateProcThreadAttribute(attributeList,0,PROC_THREAD_ATTRIBUTE_HANDLE_LIST,handleArray,(IntPtr)(Marshal.SizeOf(typeof(IntPtr))*inherited.Length),IntPtr.Zero,IntPtr.Zero))throw new Exception("HANDLE_LIST_UPDATE_FAILED");
      SIX startup=new SIX();startup.StartupInfo.cb=Marshal.SizeOf(typeof(SIX));startup.StartupInfo.flags=0x100;startup.StartupInfo.input=childIn;startup.StartupInfo.output=childOut;startup.StartupInfo.error=childError;startup.AttributeList=attributeList;
      StringBuilder command=new StringBuilder(Quote(executable)); foreach(string a in args) command.Append(" ").Append(Quote(a));
      if(!CreateProcess(executable,command,IntPtr.Zero,IntPtr.Zero,true,CREATE_NO_WINDOW|CREATE_SUSPENDED|CREATE_UNICODE_ENVIRONMENT|EXTENDED_STARTUPINFO_PRESENT,IntPtr.Zero,cwd,ref startup,out pi)) throw new Exception("SPAWN_FAILED_"+Marshal.GetLastWin32Error());
      bool member=false;if(!IsProcessInJob(pi.process,job,out member)||!member)throw new Exception("JOB_MEMBERSHIP_FAILED");
      CloseHandle(childIn); childIn=IntPtr.Zero;
      CloseHandle(childOut); childOut=IntPtr.Zero;
      if(childError!=IntPtr.Zero) { CloseHandle(childError); childError=IntPtr.Zero; }
      // Child stdout is framed on a separate pipe, so it cannot forge native control evidence.
      FileStream output=OwnStream(ref parentOut,FileAccess.Read);
      Task outputPump=Task.Run(()=> { using(output) { byte[] bytes=new byte[4096]; int read; while((read=output.Read(bytes,0,bytes.Length))>0) Write("{\"type\":\"cli-output\",\"data\":\""+Convert.ToBase64String(bytes,0,read)+"\"}"); } });
      Write("{\"control\":\"spawned\",\"pid\":"+pi.pid+",\"start\":\""+Identity((int)pi.pid)+"\",\"containment\":\"windows-job\"}");
      if(CreatorEnded(creator))throw new Exception("CREATOR_PROCESS_ENDED");
      if(ResumeThread(pi.thread)==0xFFFFFFFF)throw new Exception("CHILD_RESUME_FAILED");
      CloseHandle(pi.thread); pi.thread=IntPtr.Zero;
      FileStream stream=OwnStream(ref parentIn,FileAccess.Write);
      StreamWriter writer=new StreamWriter(stream,new UTF8Encoding(false)); writer.AutoFlush=true;
      System.Collections.Concurrent.BlockingCollection<string> relay=new System.Collections.Concurrent.BlockingCollection<string>(128);
      // The relay is drained by its own thread, so a child pipe that fills up
      // surfaces as a bounded queue timeout here instead of wedging the
      // deadline, the EOF path or the stopped evidence. A broken pipe (the
      // child died first) only ends the drain; the loop observes the exit.
      Thread drain=new Thread(()=>{ try { foreach(string pending in relay.GetConsumingEnumerable()) writer.WriteLine(pending); } catch {} finally { try{writer.Dispose();}catch{} } });
      drain.IsBackground=true; drain.Start();
      {
        Task<string> input=Task.Run(()=>Console.In.ReadLine()); Stopwatch timer=Stopwatch.StartNew(); string reason="exited";
        while(WaitForSingleObject(pi.process,0)==258) {
          if(timer.ElapsedMilliseconds>=lifetime) { reason="deadline"; break; }
          if(!input.Wait(100)) continue; string line=input.GetAwaiter().GetResult();
          if(line==null) { reason="cancelled"; break; }
          if(Encoding.UTF8.GetByteCount(line)>262144) { reason="input-limit"; break; }
          if(!relay.TryAdd(line,5000)) { reason="input-stalled"; break; }
          input=Task.Run(()=>Console.In.ReadLine());
        }
        uint code=0; GetExitCodeProcess(pi.process,out code);
        TerminateJobObject(job,reason=="exited"?0u:137u);
        WaitForSingleObject(pi.process,5000);
        GetExitCodeProcess(pi.process,out code);
        // JOBOBJECT_BASIC_ACCOUNTING_INFORMATION ActiveProcesses is offset 40.
        IntPtr accounting=Marshal.AllocHGlobal(48); bool stopped=false;
        try { for(int n=0;n<100;n++) { uint returned; if(QueryInformationJobObject(job,1,accounting,48,out returned)&&Marshal.ReadInt32(accounting,40)==0) { stopped=true; break; } Thread.Sleep(20); } }
        finally { Marshal.FreeHGlobal(accounting); }
        outputPump.Wait(3000);
        relay.CompleteAdding(); drain.Join(3000);
        Write("{\"control\":\"stopped\",\"pid\":"+pi.pid+",\"exitCode\":"+code+",\"reason\":\""+reason+"\",\"treeStopped\":"+(stopped?"true":"false")+",\"containment\":\"windows-job\"}");
      }
    } finally {
      shutdown.Set();if(watchdog!=null&&!watchdog.Join(5000))Environment.Exit(137);
      if(pi.process!=IntPtr.Zero) { TerminateProcess(pi.process,137); CloseHandle(pi.process); }
      if(pi.thread!=IntPtr.Zero) CloseHandle(pi.thread);
      if(childIn!=IntPtr.Zero) CloseHandle(childIn); if(parentIn!=IntPtr.Zero) CloseHandle(parentIn);
      if(childOut!=IntPtr.Zero) CloseHandle(childOut); if(parentOut!=IntPtr.Zero) CloseHandle(parentOut);
      if(childError!=IntPtr.Zero) CloseHandle(childError);
      if(attributeReady)DeleteProcThreadAttributeList(attributeList);
      if(jobArray!=IntPtr.Zero)Marshal.FreeHGlobal(jobArray);if(handleArray!=IntPtr.Zero)Marshal.FreeHGlobal(handleArray);if(attributeList!=IntPtr.Zero)Marshal.FreeHGlobal(attributeList);
      if(creator!=IntPtr.Zero)CloseHandle(creator);
      CloseHandle(job);shutdown.Dispose();
    }
  }
  // Exercise the same atomic Job admission under this process's real Job
  // constraints. The fixed Windows image is never resumed or allowed to run.
  public static string ProbeJob() {
    IntPtr creator=IntPtr.Zero,job=IntPtr.Zero,childIn=IntPtr.Zero,parentIn=IntPtr.Zero,childOut=IntPtr.Zero,parentOut=IntPtr.Zero,attributeList=IntPtr.Zero,jobArray=IntPtr.Zero,handleArray=IntPtr.Zero,childError=IntPtr.Zero;
    PI pi=new PI(); bool attributeReady=false; string result="OK";Thread watchdog=null;ManualResetEvent shutdown=new ManualResetEvent(false);
    try {
      creator=OpenCreatorProcess();if(CreatorEnded(creator))throw new Exception("CREATOR_PROCESS_ENDED");
      job=CreateJobObject(IntPtr.Zero,null);if(job==IntPtr.Zero)throw new Exception("JOB_UNAVAILABLE");
      EXTENDED limits=new EXTENDED();limits.basic.flags=0x2000;
      if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits)))throw new Exception("JOB_LIMIT_FAILED");
      watchdog=StartCreatorWatchdog(creator,job,shutdown);
      SECURITY security=new SECURITY();security.size=Marshal.SizeOf(security);security.inherit=true;
      if(!CreatePipe(out childIn,out parentIn,ref security,0)||!SetHandleInformation(parentIn,1,0))throw new Exception("STDIN_PIPE_FAILED");
      if(!CreatePipe(out parentOut,out childOut,ref security,0)||!SetHandleInformation(parentOut,1,0))throw new Exception("STDOUT_PIPE_FAILED");
      childError=DuplicateStderrForChild();
      IntPtr[] inherited=childError==IntPtr.Zero?new IntPtr[]{childIn,childOut}:new IntPtr[]{childIn,childOut,childError};
      IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref size);if(size==IntPtr.Zero)throw new Exception("JOB_LIST_UNAVAILABLE");
      attributeList=Marshal.AllocHGlobal(size);if(!InitializeProcThreadAttributeList(attributeList,2,0,ref size))throw new Exception("JOB_LIST_INIT_FAILED");attributeReady=true;
      jobArray=Marshal.AllocHGlobal((IntPtr)Marshal.SizeOf(typeof(IntPtr)));Marshal.WriteIntPtr(jobArray,job);
      if(!UpdateProcThreadAttribute(attributeList,0,PROC_THREAD_ATTRIBUTE_JOB_LIST,jobArray,(IntPtr)Marshal.SizeOf(typeof(IntPtr)),IntPtr.Zero,IntPtr.Zero))throw new Exception("JOB_LIST_UPDATE_FAILED");
      handleArray=Marshal.AllocHGlobal((IntPtr)(Marshal.SizeOf(typeof(IntPtr))*inherited.Length));
      for(int n=0;n<inherited.Length;n++)Marshal.WriteIntPtr(handleArray,n*IntPtr.Size,inherited[n]);
      if(!UpdateProcThreadAttribute(attributeList,0,PROC_THREAD_ATTRIBUTE_HANDLE_LIST,handleArray,(IntPtr)(Marshal.SizeOf(typeof(IntPtr))*inherited.Length),IntPtr.Zero,IntPtr.Zero))throw new Exception("HANDLE_LIST_UPDATE_FAILED");
      SIX startup=new SIX();startup.StartupInfo.cb = Marshal.SizeOf(typeof(SIX));startup.StartupInfo.flags=0x100;startup.StartupInfo.input=childIn;startup.StartupInfo.output=childOut;startup.StartupInfo.error=childError;startup.AttributeList=attributeList;
      string executable=Path.Combine(Environment.SystemDirectory,"cmd.exe");StringBuilder command=new StringBuilder(Quote(executable));
      if(!CreateProcess(executable,command,IntPtr.Zero,IntPtr.Zero,true,EXTENDED_STARTUPINFO_PRESENT|CREATE_NO_WINDOW|CREATE_SUSPENDED|CREATE_UNICODE_ENVIRONMENT,IntPtr.Zero,Environment.SystemDirectory,ref startup,out pi))throw new Exception("JOB_PROBE_SPAWN_FAILED_"+Marshal.GetLastWin32Error());
      bool member=false;if(!IsProcessInJob(pi.process,job,out member)||!member)throw new Exception("JOB_MEMBERSHIP_FAILED");
      if(childError!=IntPtr.Zero){CloseHandle(childError);childError=IntPtr.Zero;}
      if(CreatorEnded(creator))throw new Exception("CREATOR_PROCESS_ENDED");
    } catch(Exception error) { result=error.Message; }
    finally {
      shutdown.Set();if(watchdog!=null&&!watchdog.Join(5000))Environment.Exit(137);
      if(pi.process!=IntPtr.Zero) {
        if(!TerminateProcess(pi.process,137)||WaitForSingleObject(pi.process,5000)!=0)result="JOB_PROBE_CLEANUP_FAILED";
        CloseHandle(pi.process);
      }
      if(pi.thread!=IntPtr.Zero)CloseHandle(pi.thread);
      if(childIn!=IntPtr.Zero)CloseHandle(childIn);if(parentIn!=IntPtr.Zero)CloseHandle(parentIn);
      if(childOut!=IntPtr.Zero)CloseHandle(childOut);if(parentOut!=IntPtr.Zero)CloseHandle(parentOut);
      if(childError!=IntPtr.Zero)CloseHandle(childError);
      if(attributeReady)DeleteProcThreadAttributeList(attributeList);
      if(jobArray!=IntPtr.Zero)Marshal.FreeHGlobal(jobArray);if(handleArray!=IntPtr.Zero)Marshal.FreeHGlobal(handleArray);if(attributeList!=IntPtr.Zero)Marshal.FreeHGlobal(attributeList);
      if(creator!=IntPtr.Zero)CloseHandle(creator);if(job!=IntPtr.Zero)CloseHandle(job);shutdown.Dispose();
    }
    return result;
  }
}
'@
try {
  if ($Mode -eq 'probe') {
    $result = [DshNativePeer]::ProbeJob()
    $response = @{ peer = 'windows-kernel-pid'; supervisor = 'windows-job'; available = ($result -eq 'OK') }
    if ($result -ne 'OK') { $response.reason = $result }
    [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress)); exit 0
  }
  $spec = [Console]::In.ReadLine() | ConvertFrom-Json
  if ($Mode -eq 'protect') {
    $security = New-Object System.Security.AccessControl.DirectorySecurity
    $security.SetAccessRuleProtection($true,$false)
    $ownerSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $security.SetOwner($ownerSid)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($ownerSid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $security.AddAccessRule($rule)
    Set-Acl -LiteralPath $spec.path -AclObject $security
    [Console]::Out.WriteLine('{"protected":true}')
  }
  elseif ($Mode -eq 'server') { [DshNativePeer]::Server($spec.endpoint,[int]$spec.rootPid,[string]$spec.rootStart,[int]$spec.ttlMs) }
  elseif ($Mode -eq 'client') { [DshNativePeer]::Client($spec.endpoint,[int]$spec.serverPid,[string]$spec.serverStart,[int]$spec.ttlMs) }
  else { [DshNativePeer]::Supervise($spec.executable,[string[]]$spec.args,$spec.cwd,[int]$spec.ttlMs) }
} catch { [Console]::Error.WriteLine('NATIVE_PEER_REFUSED: ' + $_.Exception.GetBaseException().Message); exit 2 }
