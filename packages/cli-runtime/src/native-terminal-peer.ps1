$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false, $true)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;
public static class DshNativeTerminal {
  const uint CREATE_SUSPENDED=0x00000004,CREATE_UNICODE_ENVIRONMENT=0x00000400,EXTENDED_STARTUPINFO_PRESENT=0x00080000;
  const int STARTF_USESTDHANDLES=0x100;
  static readonly IntPtr PROC_THREAD_ATTRIBUTE_JOB_LIST=(IntPtr)0x0002000D;
  static readonly IntPtr PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE=(IntPtr)0x00020016;
  static readonly object WriteLock=new object();
  [StructLayout(LayoutKind.Sequential)] struct COORD { public short X,Y; public COORD(short x,short y){X=x;Y=y;} }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct SI {
    public int cb; public string reserved,desktop,title; public int x,y,xs,ys,xc,yc,fill,flags; public short show,cb2; public IntPtr r2,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct SIX { public SI StartupInfo; public IntPtr AttributeList; }
  [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC { public long time1,time2; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED { public BASIC basic; public IO io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [StructLayout(LayoutKind.Sequential)] struct SECURITY { public int size; public IntPtr descriptor; [MarshalAs(UnmanagedType.Bool)] public bool inherit; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_ACCOUNTING {
    public long totalUser,totalKernel,periodUser,periodKernel; public uint pageFaults,totalProcesses,activeProcesses,totalTerminated;
  }
  [StructLayout(LayoutKind.Sequential)] struct PBI { public IntPtr reserved,peb,r1,r2,pid,ppid; }
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe,out uint pid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process,int kind,ref PBI value,int size,out int returned);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out long creation,out long exit,out long kernel,out long user);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref SIX startup,out PI pi);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref SECURITY security,uint size);
  [DllImport("kernel32.dll")] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr security,string name);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job,int kind,ref EXTENDED value,uint length);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool member);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,int flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForMultipleObjects(uint count,IntPtr[] handles,bool all,uint ms);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,IntPtr value,uint length,out uint returned);
  [DllImport("kernel32.dll",SetLastError=true)] static extern int CreatePseudoConsole(COORD size,IntPtr inputRead,IntPtr outputWrite,uint flags,out IntPtr console);
  [DllImport("kernel32.dll",SetLastError=true)] static extern int ResizePseudoConsole(IntPtr console,COORD size);
  [DllImport("kernel32.dll")] static extern void ClosePseudoConsole(IntPtr console);
  static void Write(string value) { lock(WriteLock) { Console.Out.WriteLine(value); Console.Out.Flush(); } }
  public static string ReadControlLine() {
    StringBuilder line=new StringBuilder();int next;
    while((next=Console.In.Read())>=0) {
      if(next=='\n') { string value=line.ToString().TrimEnd('\r');if(Encoding.UTF8.GetByteCount(value)>262144)throw new Exception("CONTROL_FRAME_LIMIT");return value; }
      if(line.Length>=262144)throw new Exception("CONTROL_FRAME_LIMIT");line.Append((char)next);
    }
    if(line.Length!=0)throw new Exception("CONTROL_FRAME_INCOMPLETE");return null;
  }
  static string Quote(string value) {
    StringBuilder result=new StringBuilder("\"");int slashes=0;
    foreach(char c in value) { if(c=='\\') { slashes++;continue; } if(c=='\"')result.Append('\\',slashes*2+1);else result.Append('\\',slashes);slashes=0;result.Append(c); }
    result.Append('\\',slashes*2);result.Append('"');return result.ToString();
  }
  static FileStream OwnStream(ref IntPtr handle,FileAccess access) {
    SafeFileHandle safe=new SafeFileHandle(handle,true);handle=IntPtr.Zero;
    try { return new FileStream(safe,access); } catch { safe.Dispose();throw; }
  }
  static long Creation(IntPtr process) {
    long creation,exit,kernel,user;if(!GetProcessTimes(process,out creation,out exit,out kernel,out user)||creation<=0)throw new Exception("PROCESS_IDENTITY_FAILED");return creation;
  }
  static IntPtr OpenCreatorProcess(out uint creatorPid) {
    creatorPid=0;PBI value=new PBI();int returned;
    if(NtQueryInformationProcess(GetCurrentProcess(),0,ref value,Marshal.SizeOf(value),out returned)!=0)return IntPtr.Zero;
    uint pid=(uint)value.ppid.ToInt32();if(pid==0||pid==GetCurrentProcessId())return IntPtr.Zero;
    IntPtr handle=OpenProcess(0x101000,false,pid);if(handle==IntPtr.Zero)return IntPtr.Zero;
    long parentStart=Creation(handle),ownStart=Creation(GetCurrentProcess());if(parentStart>=ownStart){CloseHandle(handle);return IntPtr.Zero;}
    creatorPid=pid;return handle;
  }
  static bool CreatorEnded(IntPtr creator) { return creator==IntPtr.Zero||WaitForSingleObject(creator,0)!=0x102; }
  static Thread StartCreatorWatchdog(IntPtr creator,IntPtr job,ManualResetEvent shutdown) {
    Thread thread=new Thread(()=>{uint result=WaitForMultipleObjects(2,new IntPtr[]{creator,shutdown.SafeWaitHandle.DangerousGetHandle()},false,0xFFFFFFFF);if(result==1)return;TerminateJobObject(job,137);Environment.Exit(137);});
    thread.IsBackground=true;thread.Start();return thread;
  }
  static void ProtectDirectory(string path) {
    DirectorySecurity security=Directory.GetAccessControl(path,AccessControlSections.Owner|AccessControlSections.Access);
    SecurityIdentifier owner=WindowsIdentity.GetCurrent().User;
    if(!security.AreAccessRulesProtected||!owner.Equals(security.GetOwner(typeof(SecurityIdentifier))))throw new Exception("PRIVATE_OUTPUT_OWNER_MISMATCH");
    bool allowed=false;
    foreach(FileSystemAccessRule rule in security.GetAccessRules(true,true,typeof(SecurityIdentifier))) {
      if(!owner.Equals(rule.IdentityReference)||rule.AccessControlType!=AccessControlType.Allow)throw new Exception("PRIVATE_OUTPUT_ACL_INVALID");
      if((rule.FileSystemRights&FileSystemRights.FullControl)==FileSystemRights.FullControl)allowed=true;
    }
    if(!allowed)throw new Exception("PRIVATE_OUTPUT_ACL_INVALID");
  }
  static string PipeName(string endpoint) {
    const string prefix="\\\\.\\pipe\\dsh-terminal-";
    if(endpoint==null||!endpoint.StartsWith(prefix,StringComparison.Ordinal)||endpoint.Length<=prefix.Length||endpoint.Length>240)throw new Exception("DATA_ENDPOINT_INVALID");
    const string transport="\\\\.\\pipe\\";
    string name=endpoint.Substring(transport.Length);if(name.IndexOfAny(new char[]{'\\','/','\0'})>=0)throw new Exception("DATA_ENDPOINT_INVALID");return name;
  }
  static IntPtr EnvironmentBlock(IDictionary environment) {
    SortedDictionary<string,string> values=new SortedDictionary<string,string>(StringComparer.OrdinalIgnoreCase);
    foreach(DictionaryEntry item in environment) {
      string key=(string)item.Key,value=item.Value==null?"":(string)item.Value;
      if(key.Length==0||key.IndexOf('=')>=0||key.IndexOf('\0')>=0||value.IndexOf('\0')>=0)throw new Exception("ENVIRONMENT_INVALID");values[key]=value;
    }
    StringBuilder block=new StringBuilder();foreach(KeyValuePair<string,string> item in values)block.Append(item.Key).Append('=').Append(item.Value).Append('\0');block.Append('\0');
    return Marshal.StringToHGlobalUni(block.ToString());
  }
  static bool QueryActive(IntPtr job,out uint active) {
    active=0;IntPtr memory=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(BASIC_ACCOUNTING)));
    try {
      uint returned;if(!QueryInformationJobObject(job,1,memory,(uint)Marshal.SizeOf(typeof(BASIC_ACCOUNTING)),out returned)||returned!=Marshal.SizeOf(typeof(BASIC_ACCOUNTING)))return false;
      BASIC_ACCOUNTING value=(BASIC_ACCOUNTING)Marshal.PtrToStructure(memory,typeof(BASIC_ACCOUNTING));active=value.activeProcesses;return true;
    } finally { Marshal.FreeHGlobal(memory); }
  }
  static Dictionary<string,object> Command(string line) {
    if(line==null||Encoding.UTF8.GetByteCount(line)>262144)throw new Exception("CONTROL_FRAME_LIMIT");
    Dictionary<string,object> value=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(line);
    if(value==null||!value.ContainsKey("control")||!(value["control"] is string))throw new Exception("CONTROL_FRAME_INVALID");return value;
  }
  static string CommandIdentity(Dictionary<string,object> command,PI pi,string start) {
    if(!command.ContainsKey("pid")||!command.ContainsKey("start")||Convert.ToUInt32(command["pid"])!=pi.pid||!string.Equals(Convert.ToString(command["start"]),start,StringComparison.Ordinal))throw new Exception("CONTROL_IDENTITY_MISMATCH");return start;
  }
  public static void Run(string executable,string[] args,bool verbatim,string cwd,IDictionary environment,short cols,short rows,int lifetime,string dataEndpoint,string privateOutput) {
    uint creatorPid;IntPtr creator=OpenCreatorProcess(out creatorPid);if(CreatorEnded(creator)){if(creator!=IntPtr.Zero)CloseHandle(creator);throw new Exception("CREATOR_PROCESS_ENDED");}
    IntPtr job=CreateJobObject(IntPtr.Zero,null);if(job==IntPtr.Zero){CloseHandle(creator);throw new Exception("JOB_UNAVAILABLE");}
    IntPtr console=IntPtr.Zero,inputRead=IntPtr.Zero,inputWrite=IntPtr.Zero,outputRead=IntPtr.Zero,outputWrite=IntPtr.Zero;
    IntPtr attributeList=IntPtr.Zero,jobArray=IntPtr.Zero,environmentBlock=IntPtr.Zero;PI pi=new PI();bool attributeReady=false,created=false,started=false,hostExited=false,treeClosed=false;
    ManualResetEvent shutdown=new ManualResetEvent(false);Thread watchdog=null,outputReader=null,outputWriter=null,inputPump=null;NamedPipeServerStream data=null;FileStream consoleInput=null,consoleOutput=null;
    BlockingCollection<byte[]> outputQueue=new BlockingCollection<byte[]>(256);string stage="PRIVATE_OUTPUT";long droppedBytes=0,reportedDroppedBytes=0;int outputFailure=0;
    try {
      ProtectDirectory(privateOutput);
      stage="JOB_LIMIT";
      EXTENDED limits=new EXTENDED();limits.basic.flags=0x2000;
      if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits)))throw new Exception("JOB_LIMIT_FAILED");
      watchdog=StartCreatorWatchdog(creator,job,shutdown);
      stage="DATA_PIPE";
      PipeSecurity acl=new PipeSecurity();acl.SetAccessRuleProtection(true,false);acl.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User,PipeAccessRights.FullControl,AccessControlType.Allow));
      data=new NamedPipeServerStream(PipeName(dataEndpoint),PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous,8192,8192,acl);
      Write("{\"control\":\"listening\"}");
      Task connected=data.WaitForConnectionAsync();if(!connected.Wait(Math.Min(lifetime,15000)))throw new Exception("DATA_CONNECT_TIMEOUT");
      uint peer;if(!GetNamedPipeClientProcessId(data.SafePipeHandle,out peer)||peer!=creatorPid||CreatorEnded(creator))throw new Exception("DATA_PEER_MISMATCH");
      Write("{\"control\":\"dataConnected\"}");
      stage="CONPTY";
      SECURITY security=new SECURITY();security.size=Marshal.SizeOf(security);security.inherit=true;
      if(!CreatePipe(out inputRead,out inputWrite,ref security,0)||!SetHandleInformation(inputWrite,1,0))throw new Exception("CONPTY_INPUT_PIPE_FAILED");
      if(!CreatePipe(out outputRead,out outputWrite,ref security,0)||!SetHandleInformation(outputRead,1,0))throw new Exception("CONPTY_OUTPUT_PIPE_FAILED");
      int hr=CreatePseudoConsole(new COORD(cols,rows),inputRead,outputWrite,0,out console);if(hr<0)throw new Exception("CONPTY_CREATE_FAILED_"+hr.ToString("X8"));
      consoleInput=OwnStream(ref inputWrite,FileAccess.Write);consoleOutput=OwnStream(ref outputRead,FileAccess.Read);
      stage="PROCESS_ATTRIBUTES";
      IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref size);if(size==IntPtr.Zero)throw new Exception("ATTRIBUTE_LIST_UNAVAILABLE");
      attributeList=Marshal.AllocHGlobal(size);if(!InitializeProcThreadAttributeList(attributeList,2,0,ref size))throw new Exception("ATTRIBUTE_LIST_INIT_FAILED");attributeReady=true;
      jobArray=Marshal.AllocHGlobal((IntPtr)IntPtr.Size);Marshal.WriteIntPtr(jobArray,job);
      if(!UpdateProcThreadAttribute(attributeList,0,PROC_THREAD_ATTRIBUTE_JOB_LIST,jobArray,(IntPtr)IntPtr.Size,IntPtr.Zero,IntPtr.Zero))throw new Exception("JOB_LIST_UPDATE_FAILED");
      if(!UpdateProcThreadAttribute(attributeList,0,PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,console,(IntPtr)IntPtr.Size,IntPtr.Zero,IntPtr.Zero))throw new Exception("CONPTY_ATTRIBUTE_UPDATE_FAILED");
      // Explicit null std handles match node-pty's ConPTY startup; no handles are inherited.
      SIX startup=new SIX();startup.StartupInfo.cb=Marshal.SizeOf(typeof(SIX));startup.StartupInfo.flags=STARTF_USESTDHANDLES;startup.AttributeList=attributeList;
      StringBuilder command=new StringBuilder(Quote(executable));
      if(verbatim) { if(args.Length!=1)throw new Exception("VERBATIM_ARGUMENT_INVALID");command.Append(' ').Append(args[0]); }
      else foreach(string arg in args)command.Append(' ').Append(Quote(arg));
      environmentBlock=EnvironmentBlock(environment);
      stage="PROCESS_CREATE";
      if(!CreateProcess(executable,command,IntPtr.Zero,IntPtr.Zero,false,CREATE_SUSPENDED|CREATE_UNICODE_ENVIRONMENT|EXTENDED_STARTUPINFO_PRESENT,environmentBlock,cwd,ref startup,out pi))throw new Exception("SPAWN_FAILED_"+Marshal.GetLastWin32Error());
      CloseHandle(inputRead);inputRead=IntPtr.Zero;CloseHandle(outputWrite);outputWrite=IntPtr.Zero;
      created=true;bool member=false;if(!IsProcessInJob(pi.process,job,out member)||!member)throw new Exception("JOB_MEMBERSHIP_FAILED");
      string start=Creation(pi.process).ToString();
      Write("{\"control\":\"launcherCreated\",\"pid\":"+pi.pid+",\"start\":\""+start+"\",\"containment\":\"windows-job\",\"conpty\":true}");
      outputReader=new Thread(()=>{try{byte[] buffer=new byte[8192];int read;while((read=consoleOutput.Read(buffer,0,buffer.Length))>0){byte[] chunk=new byte[read];Buffer.BlockCopy(buffer,0,chunk,0,read);if(!outputQueue.TryAdd(chunk)){long lost=Interlocked.Add(ref droppedBytes,read);if(lost==read){Write("{\"control\":\"outputDropped\",\"bytesDropped\":"+lost+"}");Interlocked.Exchange(ref reportedDroppedBytes,lost);}}}}catch{Interlocked.Exchange(ref outputFailure,1);TerminateJobObject(job,137);}finally{outputQueue.CompleteAdding();}});outputReader.IsBackground=true;outputReader.Start();
      outputWriter=new Thread(()=>{try{foreach(byte[] chunk in outputQueue.GetConsumingEnumerable())data.Write(chunk,0,chunk.Length);}catch{Interlocked.Exchange(ref outputFailure,1);TerminateJobObject(job,137);}});outputWriter.IsBackground=true;outputWriter.Start();
      inputPump=new Thread(()=>{try{byte[] buffer=new byte[8192];int read;while((read=data.Read(buffer,0,buffer.Length))>0){consoleInput.Write(buffer,0,read);consoleInput.Flush();}}catch{} });inputPump.IsBackground=true;inputPump.Start();
      stage="PROCESS_CONTROL";
      Task<string> hostInput=Task.Run(()=>ReadControlLine());Stopwatch clock=Stopwatch.StartNew(),stopClock=null;bool controlEnded=false,stopRequested=false;
      while(!treeClosed) {
        if(CreatorEnded(creator))throw new Exception("CREATOR_PROCESS_ENDED");
        if(!hostExited&&WaitForSingleObject(pi.process,0)==0) {
          uint exitCode;if(!GetExitCodeProcess(pi.process,out exitCode))throw new Exception("HOST_EXIT_CODE_FAILED");hostExited=true;
          Write("{\"control\":\"hostExit\",\"pid\":"+pi.pid+",\"start\":\""+start+"\",\"exitCode\":"+exitCode+"}");
        }
        uint active;if(QueryActive(job,out active)) {
          if(active==0) { if(!hostExited)continue;Write("{\"control\":\"treeClosed\",\"pid\":"+pi.pid+",\"start\":\""+start+"\",\"proof\":\"windows-job-active-process-zero\",\"activeProcesses\":0}");treeClosed=true;break; }
        } else { Write("{\"control\":\"operationFailed\",\"operation\":\"query\",\"code\":\"JOB_QUERY_FAILED\"}");throw new Exception("JOB_QUERY_FAILED"); }
        if(clock.ElapsedMilliseconds>=lifetime&&!stopRequested) { TerminateJobObject(job,137);stopRequested=true;stopClock=Stopwatch.StartNew();Write("{\"control\":\"stopRequested\",\"reason\":\"deadline\"}"); }
        if(stopRequested&&stopClock.ElapsedMilliseconds>=3000)break;
        if(!controlEnded&&hostInput.Wait(20)) {
          string line=hostInput.GetAwaiter().GetResult();if(line==null){controlEnded=true;if(!stopRequested){TerminateJobObject(job,137);stopRequested=true;stopClock=Stopwatch.StartNew();Write("{\"control\":\"stopRequested\",\"reason\":\"control-ended\"}");}continue;}
          hostInput=Task.Run(()=>ReadControlLine());Dictionary<string,object> frame=Command(line);string control=(string)frame["control"];
          if(control=="resume") {
            CommandIdentity(frame,pi,start);if(started||hostExited||stopRequested)throw new Exception("CONTROL_RESUME_ORDER");
            if(CreatorEnded(creator))throw new Exception("CREATOR_PROCESS_ENDED");if(ResumeThread(pi.thread)==0xFFFFFFFF)throw new Exception("CHILD_RESUME_FAILED");started=true;
            Write("{\"control\":\"started\",\"pid\":"+pi.pid+",\"start\":\""+start+"\"}");
          } else if(control=="stop"||control=="abort") {
            CommandIdentity(frame,pi,start);if(!stopRequested){TerminateJobObject(job,137);stopRequested=true;stopClock=Stopwatch.StartNew();Write("{\"control\":\"stopRequested\",\"reason\":\""+(control=="abort"?"abort":"stop")+"\"}");}
          } else if(control=="resize") {
            CommandIdentity(frame,pi,start);int requestId=Convert.ToInt32(frame["requestId"]);if(requestId<1)throw new Exception("RESIZE_ID_INVALID");
            if(!started||hostExited||stopRequested)throw new Exception("CONTROL_RESIZE_ORDER");int nextCols=Convert.ToInt32(frame["cols"]),nextRows=Convert.ToInt32(frame["rows"]);
            if(nextCols<1||nextRows<1||nextCols>32767||nextRows>32767)throw new Exception("RESIZE_INVALID");
            if(ResizePseudoConsole(console,new COORD((short)nextCols,(short)nextRows))<0) { Write("{\"control\":\"operationFailed\",\"operation\":\"resize\",\"code\":\"CONPTY_RESIZE_FAILED\",\"requestId\":"+requestId+"}"); }
            else Write("{\"control\":\"resized\",\"cols\":"+nextCols+",\"rows\":"+nextRows+",\"requestId\":"+requestId+"}");
          } else throw new Exception("CONTROL_FRAME_INVALID");
        } else if(controlEnded)Thread.Sleep(20);
      }
    } catch(Exception error) {
      string code=error.Message;
      if(!System.Text.RegularExpressions.Regex.IsMatch(code??"","^[A-Z0-9_]{1,64}$"))code=stage+"_FAILED_"+error.HResult.ToString("X8");
      try { Write("{\"control\":\"fault\",\"stage\":\"native\",\"code\":\""+code+"\"}"); } catch {}
      throw new Exception(code);
    } finally {
      if(created&&!treeClosed)TerminateJobObject(job,137);
      if(console!=IntPtr.Zero) {
        IntPtr closingConsole=console;console=IntPtr.Zero;
        Thread closer=new Thread(()=>ClosePseudoConsole(closingConsole));closer.IsBackground=true;closer.Start();
        if(!closer.Join(5000))Environment.Exit(137);
      }
      if(outputReader!=null&&!outputReader.Join(5000))Environment.Exit(137);
      outputQueue.CompleteAdding();
      if(outputWriter!=null&&!outputWriter.Join(5000))Environment.Exit(137);
      if(Interlocked.CompareExchange(ref outputFailure,0,0)!=0)Environment.Exit(137);
      long finalDropped=Interlocked.Read(ref droppedBytes);
      if(finalDropped>Interlocked.Read(ref reportedDroppedBytes))Write("{\"control\":\"outputDropped\",\"bytesDropped\":"+finalDropped+"}");
      if(data!=null)try{data.Dispose();}catch{}
      if(inputPump!=null&&!inputPump.Join(1000))Environment.Exit(137);
      if(consoleInput!=null)try{consoleInput.Dispose();}catch{}
      if(consoleOutput!=null)try{consoleOutput.Dispose();}catch{}
      if(inputRead!=IntPtr.Zero)CloseHandle(inputRead);if(inputWrite!=IntPtr.Zero)CloseHandle(inputWrite);
      if(outputRead!=IntPtr.Zero)CloseHandle(outputRead);if(outputWrite!=IntPtr.Zero)CloseHandle(outputWrite);
      if(pi.thread!=IntPtr.Zero)CloseHandle(pi.thread);if(pi.process!=IntPtr.Zero)CloseHandle(pi.process);
      if(attributeReady)DeleteProcThreadAttributeList(attributeList);
      if(jobArray!=IntPtr.Zero)Marshal.FreeHGlobal(jobArray);if(attributeList!=IntPtr.Zero)Marshal.FreeHGlobal(attributeList);if(environmentBlock!=IntPtr.Zero)Marshal.FreeHGlobal(environmentBlock);
      shutdown.Set();if(watchdog!=null&&!watchdog.Join(5000))Environment.Exit(137);
      if(creator!=IntPtr.Zero)CloseHandle(creator);CloseHandle(job);shutdown.Dispose();outputQueue.Dispose();
    }
  }
}
'@ -ReferencedAssemblies 'System.Web.Extensions'
try {
  $line = [DshNativeTerminal]::ReadControlLine()
  if ($null -eq $line -or [Text.Encoding]::UTF8.GetByteCount($line) -gt 262144) { throw 'SPEC_FRAME_INVALID' }
  $spec = $line | ConvertFrom-Json
  $environment = @{}
  foreach ($property in $spec.env.PSObject.Properties) { $environment[[string]$property.Name] = [string]$property.Value }
  $privateSecurity = New-Object System.Security.AccessControl.DirectorySecurity
  $privateSecurity.SetAccessRuleProtection($true,$false)
  $privateOwner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $privateSecurity.SetOwner($privateOwner)
  $privateSecurity.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($privateOwner,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
  try { Set-Acl -LiteralPath ([string]$spec.privateOutput) -AclObject $privateSecurity } catch { throw 'PRIVATE_OUTPUT_PROTECT_FAILED' }
  [DshNativeTerminal]::Run([string]$spec.executable,[string[]]@($spec.args),[bool]$spec.verbatim,[string]$spec.cwd,$environment,[int16]$spec.cols,[int16]$spec.rows,[int]$spec.ttlMs,[string]$spec.dataEndpoint,[string]$spec.privateOutput)
} catch {
  [Console]::Error.WriteLine('NATIVE_TERMINAL_REFUSED: ' + $_.Exception.GetBaseException().Message)
  exit 2
}
