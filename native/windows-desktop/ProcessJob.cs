using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
// Owns only the process created below and its descendants. This is process-level
// containment; it is not a Windows account, AppContainer or filesystem boundary.
//
// Guarantees actually implemented here:
//   1. Job membership is established as part of CreateProcess through
//      PROC_THREAD_ATTRIBUTE_JOB_LIST (Windows 10 / Windows Server 2016 and newer), so a
//      created child is never outside the job for any observable window. The previous
//      CREATE_SUSPENDED + AssignProcessToJobObject sequence left a suspended, unowned
//      child whenever this wrapper died between those two calls.
//   2. KILL_ON_JOB_CLOSE plus a job handle that only this process holds means any abrupt
//      death of this wrapper tears down the whole descendant tree.
//   3. The Agent that spawned this wrapper holds no job handle, so Agent death alone does
//      not tear the job down. A watchdog therefore holds a real kernel handle for the
//      process that created this wrapper and terminates the job when that process ends,
//      checked before creation and again before the child is resumed.
// No process-name based cancellation is used anywhere.
class ProcessJob {
  const uint CREATE_SUSPENDED=0x00000004,CREATE_NO_WINDOW=0x08000000,CREATE_UNICODE_ENVIRONMENT=0x00000400,EXTENDED_STARTUPINFO_PRESENT=0x00080000,STARTF_USESTDHANDLES=0x00000100;
  const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE=0x00002000;
  const int JobObjectExtendedLimitInformation=9;
  static readonly IntPtr PROC_THREAD_ATTRIBUTE_JOB_LIST=(IntPtr)0x0002000D;
  const int ProcessBasicInformation=0;
  const uint PROCESS_QUERY_LIMITED_INFORMATION=0x00001000,PROCESS_SYNCHRONIZE=0x00100000;
  const uint WAIT_OBJECT_0=0x00000000,INFINITE=0xFFFFFFFF;
  const int STD_INPUT_HANDLE=-10,STD_OUTPUT_HANDLE=-11,STD_ERROR_HANDLE=-12;
  const int ExitIsolationUnavailable=126;
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong ReadOperationCount,WriteOperationCount,OtherOperationCount,ReadTransferCount,WriteTransferCount,OtherTransferCount; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long PerProcessUserTimeLimit,PerJobUserTimeLimit; public uint LimitFlags;public UIntPtr MinimumWorkingSetSize,MaximumWorkingSetSize;public uint ActiveProcessLimit;public UIntPtr Affinity;public uint PriorityClass,SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT { public BASIC_LIMIT Basic;public IO_COUNTERS IoInfo;public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemoryUsed,PeakJobMemoryUsed; }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct STARTUPINFO {public uint cb;public string reserved,desktop,title;public uint x,y,xSize,ySize,xChars,yChars,fill,flags;public ushort show,reserved2;public IntPtr reservedPtr,input,output,error;}
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX {public STARTUPINFO StartupInfo;public IntPtr AttributeList;}
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION {public IntPtr process,thread;public uint pid,tid;}
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_BASIC_INFORMATION {public int ExitStatus;public IntPtr PebBaseAddress;public IntPtr AffinityMask;public int BasePriority;public IntPtr UniqueProcessId;public IntPtr InheritedFromUniqueProcessId;}
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,ref EXTENDED_LIMIT info,uint length);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string executable,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string cwd,ref STARTUPINFOEX startup,out PROCESS_INFORMATION process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,int flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint processId);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out long creation,out long exit,out long kernel,out long user);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForMultipleObjects(uint count,IntPtr[] handles,bool all,uint timeout);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr handle,uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int type);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process,int informationClass,ref PROCESS_BASIC_INFORMATION information,int length,out int returned);
  static string Quote(string text) {StringBuilder s=new StringBuilder("\"");int slashes=0;foreach(char ch in text){if(ch=='\\'){slashes++;continue;}if(ch=='\"')s.Append('\\',slashes*2+1);else s.Append('\\',slashes);s.Append(ch);slashes=0;}s.Append('\\',slashes*2);return s.Append('"').ToString();}
  // Holds a real kernel handle for the process that created this wrapper. Returning
  // IntPtr.Zero means "parent identity not proven", which every caller treats as parent
  // death so that an unmonitored child is never started.
  static IntPtr OpenParentProcess() {
    PROCESS_BASIC_INFORMATION information=new PROCESS_BASIC_INFORMATION();int returned;
    if(NtQueryInformationProcess(GetCurrentProcess(),ProcessBasicInformation,ref information,Marshal.SizeOf(typeof(PROCESS_BASIC_INFORMATION)),out returned)!=0)return IntPtr.Zero;
    uint pid=(uint)information.InheritedFromUniqueProcessId.ToInt32();
    if(pid==0||pid==GetCurrentProcessId())return IntPtr.Zero;
    IntPtr handle=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|PROCESS_SYNCHRONIZE,false,pid);
    if(handle==IntPtr.Zero)return IntPtr.Zero;
    long parentStart=0,ownStart=0,exit=0,kernel=0,user=0;
    // PID reuse guard: the recorded parent PID is only meaningful while the creator is
    // still alive, and a recycled PID always belongs to a process created after this
    // wrapper. Requiring the parent to be strictly older than this wrapper rejects a
    // recycled PID, and any failure to read the times rejects too.
    if(!GetProcessTimes(handle,out parentStart,out exit,out kernel,out user)||!GetProcessTimes(GetCurrentProcess(),out ownStart,out exit,out kernel,out user)||parentStart<=0||parentStart>=ownStart){CloseHandle(handle);return IntPtr.Zero;}
    return handle;
  }
  static bool ParentEnded(IntPtr parent) {return parent==IntPtr.Zero||WaitForSingleObject(parent,0)!=0x102;}
  // The Agent holds no job handle, so its death alone never tears the job down. This
  // thread waits on the creator's kernel handle and terminates the job (and this
  // process) when the creator ends. Any wait outcome other than a live parent is treated
  // as parent death, because leaving a supervised child running is the unsafe direction.
  static Thread StartParentWatchdog(IntPtr parent,IntPtr job,ManualResetEvent shuttingDown) {
    Thread thread=new Thread(()=>{uint outcome=WaitForMultipleObjects(2,new IntPtr[]{parent,shuttingDown.SafeWaitHandle.DangerousGetHandle()},false,INFINITE);if(outcome==WAIT_OBJECT_0+1)return;TerminateJobObject(job,(uint)ExitIsolationUnavailable);Environment.Exit(ExitIsolationUnavailable);});
    thread.IsBackground=true;thread.Start();return thread;
  }
#if DSH_JOB_TEST_BARRIER
  // Test-only hook. This whole region is compiled solely when DSH_JOB_TEST_BARRIER is
  // defined; the shipped build script never defines it. No production binary therefore
  // contains this code, and no runtime switch (environment variable, request field or
  // command line) can enable a barrier in a production build.
  static string barrierStage,barrierDir;
  static void LoadBarrier(Dictionary<string,object> request) {
    object raw;if(!request.TryGetValue("barrier",out raw)||raw==null)return;
    Dictionary<string,object> map=raw as Dictionary<string,object>;if(map==null)return;
    object stage,dir;if(map.TryGetValue("stage",out stage))barrierStage=(string)stage;if(map.TryGetValue("dir",out dir))barrierDir=(string)dir;
  }
  static void Barrier(string stage,PROCESS_INFORMATION pi,IntPtr job) {
    if(barrierStage==null||barrierStage!=stage||barrierDir==null)return;
    long childStart=0,ownStart=0,exit=0,kernel=0,user=0;bool member=false;
    if(pi.process!=IntPtr.Zero){GetProcessTimes(pi.process,out childStart,out exit,out kernel,out user);IsProcessInJob(pi.process,job,out member);}
    GetProcessTimes(GetCurrentProcess(),out ownStart,out exit,out kernel,out user);
    File.WriteAllText(Path.Combine(barrierDir,"gate-"+stage+".json"),new JavaScriptSerializer().Serialize(new Dictionary<string,object>{
      {"stage",stage},{"wrapperPid",GetCurrentProcessId()},{"wrapperStartFileTime",ownStart.ToString()},
      {"childPid",pi.pid},{"childThreadId",pi.tid},{"childStartFileTime",childStart.ToString()},{"inJob",member}}));
    while(!File.Exists(Path.Combine(barrierDir,"release-"+stage)))Thread.Sleep(20);
  }
#endif
  static int Main() {IntPtr job=IntPtr.Zero,attributeList=IntPtr.Zero,jobArray=IntPtr.Zero,parent=IntPtr.Zero;PROCESS_INFORMATION pi=new PROCESS_INFORMATION();bool supervising=false,attributeReady=false;Thread watchdog=null;ManualResetEvent shuttingDown=new ManualResetEvent(false);try {
    Console.InputEncoding=new UTF8Encoding(false,true);Console.OutputEncoding=new UTF8Encoding(false);
    string line=Console.ReadLine();if(line==null||line.Length>2097152)return ExitIsolationUnavailable;
    var request=new JavaScriptSerializer{MaxJsonLength=2097152}.Deserialize<Dictionary<string,object>>(line);
    string executable=(string)request["executable"],cwd=(string)request["cwd"];var args=(System.Collections.ArrayList)request["args"];
#if DSH_JOB_TEST_BARRIER
    LoadBarrier(request);
#endif
    parent=OpenParentProcess();
    if(ParentEnded(parent))throw new Win32Exception("creator process already ended");
    job=CreateJobObject(IntPtr.Zero,null);if(job==IntPtr.Zero)throw new Win32Exception();EXTENDED_LIMIT limits=new EXTENDED_LIMIT();limits.Basic.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if(!SetInformationJobObject(job,JobObjectExtendedLimitInformation,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT))))throw new Win32Exception();
    watchdog=StartParentWatchdog(parent,job,shuttingDown);
    StringBuilder command=new StringBuilder(Quote(executable));foreach(object arg in args)command.Append(' ').Append(Quote((string)arg));
    IntPtr attributeSize=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref attributeSize);
    if(attributeSize==IntPtr.Zero)throw new Win32Exception();
    attributeList=Marshal.AllocHGlobal(attributeSize);
    if(!InitializeProcThreadAttributeList(attributeList,1,0,ref attributeSize))throw new Win32Exception();
    attributeReady=true;
    jobArray=Marshal.AllocHGlobal((IntPtr)Marshal.SizeOf(typeof(IntPtr)));Marshal.WriteIntPtr(jobArray,job);
    if(!UpdateProcThreadAttribute(attributeList,0,PROC_THREAD_ATTRIBUTE_JOB_LIST,jobArray,(IntPtr)Marshal.SizeOf(typeof(IntPtr)),IntPtr.Zero,IntPtr.Zero))throw new Win32Exception();
    STARTUPINFOEX startup=new STARTUPINFOEX();
    startup.StartupInfo.cb=(uint)Marshal.SizeOf(typeof(STARTUPINFOEX));
    startup.StartupInfo.flags=STARTF_USESTDHANDLES;
    startup.StartupInfo.input=GetStdHandle(STD_INPUT_HANDLE);
    startup.StartupInfo.output=GetStdHandle(STD_OUTPUT_HANDLE);
    startup.StartupInfo.error=GetStdHandle(STD_ERROR_HANDLE);
    startup.AttributeList=attributeList;
#if DSH_JOB_TEST_BARRIER
    Barrier("preCreate",pi,job);
#endif
    if(!CreateProcess(executable,command,IntPtr.Zero,IntPtr.Zero,true,CREATE_NO_WINDOW|CREATE_SUSPENDED|CREATE_UNICODE_ENVIRONMENT|EXTENDED_STARTUPINFO_PRESENT,IntPtr.Zero,cwd,ref startup,out pi))throw new Win32Exception();
    bool member=false;if(!IsProcessInJob(pi.process,job,out member)||!member){TerminateProcess(pi.process,(uint)ExitIsolationUnavailable);throw new Win32Exception("child was not created inside the job");}
#if DSH_JOB_TEST_BARRIER
    Barrier("created",pi,job);
#endif
    if(ParentEnded(parent)){TerminateProcess(pi.process,(uint)ExitIsolationUnavailable);throw new Win32Exception("creator process ended before the child was resumed");}
    if(ResumeThread(pi.thread)==0xFFFFFFFF){TerminateProcess(pi.process,(uint)ExitIsolationUnavailable);throw new Win32Exception();}
#if DSH_JOB_TEST_BARRIER
    Barrier("resumed",pi,job);
#endif
    supervising=true;if(WaitForSingleObject(pi.process,INFINITE)!=WAIT_OBJECT_0)throw new Win32Exception();uint code;if(!GetExitCodeProcess(pi.process,out code))throw new Win32Exception();return unchecked((int)code);
  }catch{Console.Error.WriteLine("PROCESS_ISOLATION_UNAVAILABLE");return ExitIsolationUnavailable;}
  finally{
    // Join the watchdog before closing its waited handles: closing a handle from
    // another thread while WaitForMultipleObjects is pending is undefined.
    shuttingDown.Set();if(watchdog!=null&&!watchdog.Join(5000))Environment.Exit(ExitIsolationUnavailable);
    // Fail closed: a child that was created but never reached supervised execution is
    // terminated here, so no unattached program keeps running or holds the pipes.
    if(!supervising&&pi.process!=IntPtr.Zero)TerminateProcess(pi.process,(uint)ExitIsolationUnavailable);
    if(pi.thread!=IntPtr.Zero)CloseHandle(pi.thread);
    if(pi.process!=IntPtr.Zero)CloseHandle(pi.process);
    if(attributeReady)DeleteProcThreadAttributeList(attributeList);
    if(jobArray!=IntPtr.Zero)Marshal.FreeHGlobal(jobArray);
    if(attributeList!=IntPtr.Zero)Marshal.FreeHGlobal(attributeList);
    if(parent!=IntPtr.Zero)CloseHandle(parent);
    // Closed last: dropping the only job handle is what kills any remaining descendant.
    if(job!=IntPtr.Zero)CloseHandle(job);
    shuttingDown.Dispose();
  }}
}
