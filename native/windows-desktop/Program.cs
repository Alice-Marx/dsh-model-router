// .NET Framework 4.8 / C# 5: deliberately builds on supported Windows without a global SDK install.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

class DesktopHelper {
  const int ProtocolVersion = 2;
  static readonly string InstanceId = Guid.NewGuid().ToString("N");
  static readonly DesktopLease Leases = new DesktopLease();
  static readonly Stopwatch Clock = Stopwatch.StartNew();
  static int CaptureEpoch;
  [ThreadStatic] static DesktopLease.Ticket ActiveTicket;
  [ThreadStatic] static bool InputStarted;
  [ThreadStatic] static long FrameExpiresAt;
  static volatile bool Paused = false, Stopping = false;
  static string Token, AllowedProcess, PipeName; static int Session;
  static Dictionary<string, Capture> Captures = new Dictionary<string, Capture>();
  static object Gate = new object();
  class Capture { public IntPtr Window,Foreground; public Rectangle Bounds; public uint Dpi; public long Created,Generation;public int Epoch;public string Hash,Owner; }
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mouse; [FieldOffset(0)] public KEYBDINPUT keyboard; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION value; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr w, out RECT rect);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr window,IntPtr target,uint flags);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flags);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr w, out uint pid);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr w);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int awareness);
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, INPUT[] input, int size);
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll")] static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder data, int length, out int needed);
  static void Require(bool condition, string code) { if (!condition) throw new InvalidOperationException(code); }
  static void Ready() {
    Require(FrameExpiresAt==0||UnixMilliseconds()<FrameExpiresAt,"DESKTOP_GRANT_EXPIRED");
    Require(!Stopping,"DESKTOP_STOPPED");Require(!Paused, "DESKTOP_PAUSED"); Require(Environment.UserInteractive && Session != 0 && Process.GetCurrentProcess().SessionId == Session, "DESKTOP_UNAVAILABLE");
    IntPtr desktop = OpenInputDesktop(0, false, 1); Require(desktop != IntPtr.Zero, "DESKTOP_LOCKED");
    try { int needed; StringBuilder name = new StringBuilder(256); Require(GetUserObjectInformation(desktop, 2, name, 512, out needed) && name.ToString() == "Default", "DESKTOP_LOCKED"); }
    finally { CloseDesktop(desktop); }
  }
  static Rectangle Bounds(IntPtr w) { RECT r; Require(GetWindowRect(w, out r), "TARGET_STALE"); Require(r.Right > r.Left && r.Bottom > r.Top, "TARGET_STALE"); return Rectangle.FromLTRB(r.Left,r.Top,r.Right,r.Bottom); }
  static uint Dpi(IntPtr w) { try { return GetDpiForWindow(w); } catch (EntryPointNotFoundException) { return 96; } }
  static IntPtr Target(Dictionary<string,object> args,bool requireForeground) {
    Require(args.ContainsKey("sessionSelector") && Convert.ToInt32(args["sessionSelector"]) == Session, "DESKTOP_UNAVAILABLE");
    Require(args.ContainsKey("targetWindow"), "EXPLICIT_TARGET_REQUIRED"); long number; Require(long.TryParse(Convert.ToString(args["targetWindow"]),out number),"EXPLICIT_TARGET_REQUIRED");
    IntPtr w = new IntPtr(number); Require(w != IntPtr.Zero && (!requireForeground||GetForegroundWindow() == w) && IsWindowVisible(w) && !IsIconic(w),"TARGET_STALE");
    uint pid; GetWindowThreadProcessId(w,out pid); Process process = Process.GetProcessById((int)pid);
    Require(process.SessionId == Session && String.Equals(process.ProcessName,AllowedProcess,StringComparison.OrdinalIgnoreCase),"TARGET_OUTSIDE_SCOPE"); return w;
  }
  static byte[] Png(IntPtr window,Rectangle r) {
    Require(r.Width <= 8192 && r.Height <= 8192 && (long)r.Width*r.Height <= 20000000,"CAPTURE_LIMIT");
    // PrintWindow renders in the target's DPI context. Restore the caller's context
    // before returning a bitmap normalized to physical desktop pixels.
    IntPtr previous=SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(window));
    try { Rectangle logical=Bounds(window);using (Bitmap image = new Bitmap(logical.Width,logical.Height)) using (Graphics graphics = Graphics.FromImage(image)) using (MemoryStream bytes = new MemoryStream()) { IntPtr dc=graphics.GetHdc();try{Require(PrintWindow(window,dc,2),"CAPTURE_BACKEND_UNAVAILABLE");}finally{graphics.ReleaseHdc(dc);}using(Bitmap physical=new Bitmap(image,r.Size)){physical.Save(bytes,ImageFormat.Png);return bytes.ToArray();} } }
    finally { SetThreadDpiAwarenessContext(previous); }
  }
  static string Hash(byte[] bytes) { using (SHA256 hash = SHA256.Create()) return Convert.ToBase64String(hash.ComputeHash(bytes)); }
  static long UnixMilliseconds(){return (long)(DateTime.UtcNow-new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds;}
  static void Input(params INPUT[] input) { Ready();Leases.Check(ActiveTicket);InputStarted=true;Require(SendInput((uint)input.Length,input,Marshal.SizeOf(typeof(INPUT))) == input.Length,"INPUT_REJECTED"); }
  static INPUT Keyboard(ushort vk,ushort scan,uint flags) { return new INPUT { type=1, value=new UNION { keyboard=new KEYBDINPUT { vk=vk,scan=scan,flags=flags } } }; }
  static object Execute(string name,Dictionary<string,object> args,string owner) {
    Ready();IntPtr w = Target(args,name!="desktop_screenshot"&&name!="desktop_click");Rectangle bounds=Bounds(w);uint dpi=Dpi(w);
    Screen selected=Screen.FromHandle(w);Require(args.ContainsKey("displayId")&&String.Equals(Convert.ToString(args["displayId"]),selected.DeviceName,StringComparison.Ordinal),"DISPLAY_MISMATCH");
    DesktopLease.Ticket ticket=Leases.Enter(owner);ActiveTicket=ticket;
    try{Leases.Check(ticket);return ExecuteOwned(name,args,owner,w,bounds,dpi,ticket);}
    finally{ActiveTicket=null;Leases.Exit(ticket);}
  }
  static object ExecuteOwned(string name,Dictionary<string,object> args,string owner,IntPtr w,Rectangle bounds,uint dpi,DesktopLease.Ticket ticket) {
    if(name=="desktop_screenshot") {
      byte[] bytes=Png(w,bounds);Require(bytes.Length<=8388608,"CAPTURE_LIMIT");Ready();Leases.Check(ticket);string id="screenshot-"+Guid.NewGuid().ToString("N"); Captures.Clear();Captures[id]=new Capture{Window=w,Foreground=GetForegroundWindow(),Bounds=bounds,Dpi=dpi,Created=Clock.ElapsedMilliseconds,Hash=Hash(bytes),Owner=owner,Generation=ticket.Generation,Epoch=Volatile.Read(ref CaptureEpoch)};
      Screen screen=Screen.FromHandle(w);Require(String.Equals(Convert.ToString(args["displayId"]),screen.DeviceName,StringComparison.Ordinal),"DISPLAY_MISMATCH");
      return new { screenshotId=id, displayId=screen.DeviceName, width=bounds.Width,height=bounds.Height,dpi=dpi,physicalOrigin=new{x=bounds.X,y=bounds.Y},logicalToPhysicalScale=dpi/96.0,sessionId=Session,capturedAt=DateTime.UtcNow.ToString("o"),targetWindow=w.ToInt64().ToString(),pngBase64=Convert.ToBase64String(bytes),captureBackend="GDI-PrintWindow",clipboardUsed=false };
    }
    string captureId=Convert.ToString(args["screenshotId"]);Capture capture;Require(Captures.TryGetValue(captureId,out capture),"TARGET_STALE");
    Require(capture.Owner==owner&&capture.Generation==ticket.Generation&&capture.Epoch==Volatile.Read(ref CaptureEpoch)&&capture.Window==w && capture.Foreground==GetForegroundWindow() && capture.Bounds==bounds && capture.Dpi==dpi && Clock.ElapsedMilliseconds-capture.Created<15000,"TARGET_STALE");
    Require(capture.Hash==Hash(Png(w,bounds)),"TARGET_STALE");Captures.Remove(captureId);Ready();
    if(name=="desktop_click") {
      int x=Convert.ToInt32(args["x"]),y=Convert.ToInt32(args["y"]);Require(x>=0&&y>=0&&x<bounds.Width&&y<bounds.Height,"TARGET_OUTSIDE_SCOPE");
      Rectangle all=SystemInformation.VirtualScreen;int px=bounds.X+x,py=bounds.Y+y;
      Require(GetAncestor(WindowFromPoint(new Point(px,py)),2)==w,"TARGET_OCCLUDED");
      Input(new INPUT { type=0,value=new UNION { mouse=new MOUSEINPUT { dx=(int)((long)(px-all.X)*65535/Math.Max(1,all.Width-1)),dy=(int)((long)(py-all.Y)*65535/Math.Max(1,all.Height-1)),dwFlags=0xC001 } } },new INPUT{type=0,value=new UNION{mouse=new MOUSEINPUT{dwFlags=0x2}}},new INPUT{type=0,value=new UNION{mouse=new MOUSEINPUT{dwFlags=0x4}}});
    } else if(name=="desktop_type") {
      string text=Convert.ToString(args["text"]);int pace=args.ContainsKey("interKeyDelayMs")?Convert.ToInt32(args["interKeyDelayMs"]):0;Require(text.Length<=8192&&pace>=0&&pace<=5,"INPUT_LIMIT");foreach(char ch in text){Ready();Require(GetForegroundWindow()==w,"TARGET_STALE");Input(Keyboard(0,ch,0x4),Keyboard(0,ch,0x6));if(pace>0)Thread.Sleep(pace);}
    } else if(name=="desktop_key") {
      Dictionary<string,ushort> keys=new Dictionary<string,ushort>{{"Enter",13},{"Tab",9},{"Escape",27},{"Backspace",8},{"Delete",46},{"ArrowLeft",37},{"ArrowRight",39},{"ArrowUp",38},{"ArrowDown",40},{"Home",36},{"End",35}};ushort key;Require(keys.TryGetValue(Convert.ToString(args["key"]),out key),"KEY_NOT_ALLOWED");Input(Keyboard(key,0,0),Keyboard(key,0,2));
    } else if(name=="desktop_scroll") {
      int delta=Convert.ToInt32(args["delta"]);Point cursor;Require(Math.Abs((long)delta)<=1200,"INPUT_LIMIT");Require(GetCursorPos(out cursor)&&GetAncestor(WindowFromPoint(cursor),2)==w,"TARGET_OUTSIDE_SCOPE");Input(new INPUT{type=0,value=new UNION{mouse=new MOUSEINPUT{mouseData=unchecked((uint)delta),dwFlags=0x800}}});
    } else throw new InvalidOperationException("TOOL_NOT_READY");
    return new { completed=true,sessionId=Session,clipboardUsed=false };
  }
  static bool Equal(string a,string b) { byte[] aa=Encoding.UTF8.GetBytes(a),bb=Encoding.UTF8.GetBytes(b);int difference=aa.Length^bb.Length;for(int i=0;i<Math.Max(aa.Length,bb.Length);i++)difference|=(i<aa.Length?aa[i]:0)^(i<bb.Length?bb[i]:0);return difference==0; }
  static string ReadPacket(StreamReader reader) {
    Stopwatch wait=Stopwatch.StartNew();StringBuilder value=new StringBuilder();char[] buffer=new char[2048];
    while(true){
      int left=5000-(int)wait.ElapsedMilliseconds;Require(left>0,"IPC_TIMEOUT");
      Task<int> read=reader.ReadAsync(buffer,0,buffer.Length);Require(read.Wait(left),"IPC_TIMEOUT");int count=read.Result;Require(count>0,"IPC_LIMIT");
      for(int i=0;i<count;i++){if(buffer[i]=='\n'){Require(i==count-1,"IPC_LIMIT");return value.ToString();}Require(value.Length<1048576,"IPC_LIMIT");value.Append(buffer[i]);}
    }
  }
  static object Handle(Dictionary<string,object> request,bool control) {
    Require(request.ContainsKey("token")&&Equal(Convert.ToString(request["token"]),Token),"AUTH_INVALID");
    Require(request.ContainsKey("protocolVersion")&&Convert.ToInt32(request["protocolVersion"])==ProtocolVersion,"DESKTOP_PROTOCOL_UNSUPPORTED");
    string name=Convert.ToString(request["name"]);
    if(control&&name=="probe")return new {protocolVersion=ProtocolVersion,helperInstanceId=InstanceId,sessionId=Session};
    string owner=request.ContainsKey("owner")?Convert.ToString(request["owner"]):"";
    Require(System.Text.RegularExpressions.Regex.IsMatch(owner,"^[a-f0-9]{64}$"),"DESKTOP_OWNER_REQUIRED");
    Require(request.ContainsKey("helperInstanceId")&&Convert.ToString(request["helperInstanceId"])==InstanceId,"DESKTOP_HELPER_CHANGED");
    if(control){Require(name=="cancel","TOOL_NOT_READY");return new {stopConfirmed=Leases.Cancel(owner,5000),helperInstanceId=InstanceId};}
    Require(request.ContainsKey("expiresAt"),"DESKTOP_GRANT_EXPIRED");FrameExpiresAt=Convert.ToInt64(request["expiresAt"]);long now=UnixMilliseconds();Require(FrameExpiresAt>now&&FrameExpiresAt-now<=300000,"DESKTOP_GRANT_EXPIRED");
    lock(Gate){return Execute(name,(Dictionary<string,object>)request["args"],owner);}
  }
  static void Loop(PipeSecurity security,bool control) {
    while(!Stopping) try {
      using(NamedPipeServerStream pipe=new NamedPipeServerStream(PipeName+(control?"-control":""),PipeDirection.InOut,control?8:1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous,65536,65536,security)) {
        pipe.WaitForConnection();using(StreamReader reader=new StreamReader(pipe,new UTF8Encoding(false,true),false,4096,true)) using(StreamWriter writer=new StreamWriter(pipe,new UTF8Encoding(false),4096,true)) {
          // A bounded read prevents another local process from retaining the helper forever.
          object response;InputStarted=false;FrameExpiresAt=0;JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=24000000};
          try { string line=ReadPacket(reader);var request=json.Deserialize<Dictionary<string,object>>(line);response=new {protocolVersion=ProtocolVersion,ok=true,result=Handle(request,control)}; }
          catch(Exception e){string code=e is InvalidOperationException?e.Message:"DESKTOP_UNAVAILABLE";response=new{protocolVersion=ProtocolVersion,ok=false,code=code,effect=InputStarted?"possibly-applied":"not-applied",stopConfirmed=true};}
          writer.WriteLine(json.Serialize(response));writer.Flush();
        }
      }
    } catch { Thread.Sleep(100); }
  }
  [STAThread] static int Main(string[] args) {
    try {
      Dictionary<string,string> options=new Dictionary<string,string>();for(int i=0;i+1<args.Length;i+=2)options[args[i]]=args[i+1];
      Session=Process.GetCurrentProcess().SessionId;Require(Environment.UserInteractive&&Session!=0,"DESKTOP_UNAVAILABLE");
      PipeName=options["--pipe"];Require(System.Text.RegularExpressions.Regex.IsMatch(PipeName,"^dsh-desktop-[-a-zA-Z0-9]{1,64}$"),"INVALID_PIPE");AllowedProcess=options["--allowed-process"];Token=File.ReadAllText(options["--secret-file"]).Trim();Require(Token.Length>=43,"AUTH_INVALID");
      try{SetProcessDpiAwarenessContext(new IntPtr(-4));}catch{try{SetProcessDpiAwareness(2);}catch{}}
      bool created;using(Mutex lease=new Mutex(true,"Local\\DSH-Desktop-Exclusive",out created)) {
        Require(created,"DESKTOP_BUSY");PipeSecurity security=new PipeSecurity();security.SetAccessRuleProtection(true,false);
        SecurityIdentifier current=WindowsIdentity.GetCurrent().User;security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid,null),PipeAccessRights.FullControl,AccessControlType.Deny));security.AddAccessRule(new PipeAccessRule(current,PipeAccessRights.FullControl,AccessControlType.Allow));
        if(options.ContainsKey("--agent-sid"))security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(options["--agent-sid"]),PipeAccessRights.ReadWrite,AccessControlType.Allow));
        Application.EnableVisualStyles();NotifyIcon tray=new NotifyIcon{Icon=SystemIcons.Application,Text="DSH desktop control",Visible=true};ContextMenuStrip menu=new ContextMenuStrip();
        menu.Items.Add("Pause / resume",null,delegate{Paused=!Paused;Leases.Invalidate();Interlocked.Increment(ref CaptureEpoch);tray.Text=Paused?"DSH desktop control paused":"DSH desktop control";});
        menu.Items.Add("Stop and revoke session",null,delegate{Stopping=true;Token="";Leases.Invalidate();Interlocked.Increment(ref CaptureEpoch);tray.Visible=false;Application.Exit();});tray.ContextMenuStrip=menu;
        new Thread(delegate(){Loop(security,false);}){IsBackground=true}.Start();
        for(int i=0;i<8;i++)new Thread(delegate(){Loop(security,true);}){IsBackground=true}.Start();
        Application.Run();tray.Dispose();lease.ReleaseMutex();
      } return 0;
    } catch(Exception e){Console.Error.WriteLine(e is InvalidOperationException?e.Message:"HELPER_START_FAILED");return 2;}
  }
}
