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
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll")] static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder data, int length, out int needed);
  static void Require(bool condition, string code) { if (!condition) throw new InvalidOperationException(code); }
  // JSON numbers arrive as int, long or decimal; a null, a string or a fraction is a request
  // error, not a zero. Coercing them silently would click the window origin or type nothing.
  static int NumberArg(Dictionary<string,object> args, string key) {
    object value; Require(args.TryGetValue(key, out value) && value != null, "INVALID_ARGUMENT");
    if (value is int) return (int)value;
    if (value is long) { long number = (long)value; Require(number >= int.MinValue && number <= int.MaxValue, "INVALID_ARGUMENT"); return (int)number; }
    if (value is decimal) { decimal number = (decimal)value; Require(number == decimal.Truncate(number) && number >= int.MinValue && number <= int.MaxValue, "INVALID_ARGUMENT"); return (int)number; }
    if (value is double) { double number = (double)value; Require(!double.IsNaN(number) && number == Math.Truncate(number) && number >= int.MinValue && number <= int.MaxValue, "INVALID_ARGUMENT"); return (int)number; }
    throw new InvalidOperationException("INVALID_ARGUMENT");
  }
  static string TextArg(Dictionary<string,object> args, string key) {
    object value; Require(args.TryGetValue(key, out value) && value is string, "INVALID_ARGUMENT"); return (string)value;
  }
  static INPUT Mouse(uint flags, uint data = 0) { return new INPUT { type = 0, value = new UNION { mouse = new MOUSEINPUT { mouseData = data, dwFlags = flags } } }; }
  static void ForwardKey(ushort key, uint flags) { Input(Keyboard(key, 0, flags), Keyboard(key, 0, flags | 0x2)); }
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
    int selector = args.ContainsKey("sessionSelector") ? NumberArg(args, "sessionSelector") : Session;
    if(!args.ContainsKey("sessionSelector"))args["sessionSelector"]=selector;
    Require(selector == Session, "DESKTOP_UNAVAILABLE");
    IntPtr w;
    if(args.ContainsKey("targetWindow")){long number;Require(long.TryParse(Convert.ToString(args["targetWindow"]),out number),"EXPLICIT_TARGET_REQUIRED");w=new IntPtr(number);}
    else w=GetForegroundWindow();
    Require(w != IntPtr.Zero && (!requireForeground||GetForegroundWindow() == w) && IsWindowVisible(w) && !IsIconic(w),"TARGET_STALE");
    uint pid; GetWindowThreadProcessId(w,out pid); Process process = Process.GetProcessById((int)pid);
    Require(process.SessionId == Session && String.Equals(process.ProcessName,AllowedProcess,StringComparison.OrdinalIgnoreCase),"TARGET_OUTSIDE_SCOPE"); return w;
  }
  static byte[] Png(IntPtr window,Rectangle r,out bool blank) {
    Require(r.Width <= 8192 && r.Height <= 8192 && (long)r.Width*r.Height <= 20000000,"CAPTURE_LIMIT");
    // PrintWindow renders in the target's DPI context. Restore the caller's context
    // before returning a bitmap normalized to physical desktop pixels.
    IntPtr previous=SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(window));
    try { Rectangle logical=Bounds(window);using (Bitmap image = new Bitmap(logical.Width,logical.Height)) using (Graphics graphics = Graphics.FromImage(image)) using (MemoryStream bytes = new MemoryStream()) { IntPtr dc=graphics.GetHdc();try{Require(PrintWindow(window,dc,2),"CAPTURE_BACKEND_UNAVAILABLE");}finally{graphics.ReleaseHdc(dc);}using(Bitmap physical=new Bitmap(image,r.Size)){blank=Blank(physical);physical.Save(bytes,ImageFormat.Png);return bytes.ToArray();} } }
    finally { SetThreadDpiAwarenessContext(previous); }
  }
  // A GPU, UWP or Electron window often answers PrintWindow with one flat colour. Clicks are
  // still refused later by the content hash, so the capture is reported rather than trusted.
  static bool Blank(Bitmap image) {
    int stepX=Math.Max(1,image.Width/32),stepY=Math.Max(1,image.Height/32);Color first=image.GetPixel(0,0);int changed=0;
    for(int y=0;y<image.Height;y+=stepY)for(int x=0;x<image.Width;x+=stepX)if(image.GetPixel(x,y)!=first)changed++;
    return changed<2;
  }
  static string Hash(byte[] bytes) { using (SHA256 hash = SHA256.Create()) return Convert.ToBase64String(hash.ComputeHash(bytes)); }
  static long UnixMilliseconds(){return (long)(DateTime.UtcNow-new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds;}
  static void Input(params INPUT[] input) { Ready();Leases.Check(ActiveTicket);InputStarted=true;Require(SendInput((uint)input.Length,input,Marshal.SizeOf(typeof(INPUT))) == input.Length,"INPUT_REJECTED"); }
  static INPUT Keyboard(ushort vk,ushort scan,uint flags) { return new INPUT { type=1, value=new UNION { keyboard=new KEYBDINPUT { vk=vk,scan=scan,flags=flags } } }; }
  static object Execute(string name,Dictionary<string,object> args,string owner) {
    Ready();IntPtr w = Target(args,name!="desktop_screenshot"&&name!="desktop_click");Rectangle bounds=Bounds(w);uint dpi=Dpi(w);
    Screen selected=Screen.FromHandle(w);if(!args.ContainsKey("displayId"))args["displayId"]=selected.DeviceName;Require(String.Equals(Convert.ToString(args["displayId"]),selected.DeviceName,StringComparison.Ordinal),"DISPLAY_MISMATCH");
    DesktopLease.Ticket ticket=Leases.Enter(owner);ActiveTicket=ticket;
    try{Leases.Check(ticket);return ExecuteOwned(name,args,owner,w,bounds,dpi,ticket);}
    finally{ActiveTicket=null;Leases.Exit(ticket);}
  }
  static object ExecuteOwned(string name,Dictionary<string,object> args,string owner,IntPtr w,Rectangle bounds,uint dpi,DesktopLease.Ticket ticket) {
    if(name=="desktop_screenshot") {
      bool blank;byte[] bytes=Png(w,bounds,out blank);Require(bytes.Length<=8388608,"CAPTURE_LIMIT");Ready();Leases.Check(ticket);string id="screenshot-"+Guid.NewGuid().ToString("N"); Captures.Clear();Captures[id]=new Capture{Window=w,Foreground=GetForegroundWindow(),Bounds=bounds,Dpi=dpi,Created=Clock.ElapsedMilliseconds,Hash=Hash(bytes),Owner=owner,Generation=ticket.Generation,Epoch=Volatile.Read(ref CaptureEpoch)};
      Screen screen=Screen.FromHandle(w);Require(String.Equals(Convert.ToString(args["displayId"]),screen.DeviceName,StringComparison.Ordinal),"DISPLAY_MISMATCH");
      return new { screenshotId=id, displayId=screen.DeviceName, width=bounds.Width,height=bounds.Height,dpi=dpi,physicalOrigin=new{x=bounds.X,y=bounds.Y},coordinateSpace="screenshot-pixels",sessionId=Session,capturedAt=DateTime.UtcNow.ToString("o"),targetWindow=w.ToInt64().ToString(),pngBase64=Convert.ToBase64String(bytes),captureBackend="GDI-PrintWindow",clipboardUsed=false,blank=blank };
    }
    string captureId=TextArg(args,"screenshotId");Capture capture;Require(Captures.TryGetValue(captureId,out capture),"TARGET_STALE");
    Require(capture.Owner==owner,"TARGET_STALE");Require(capture.Generation==ticket.Generation,"TARGET_STALE");Require(capture.Epoch==Volatile.Read(ref CaptureEpoch),"TARGET_STALE");Require(capture.Window==w,"TARGET_STALE");
    Require(capture.Foreground==GetForegroundWindow(),"TARGET_STALE");Require(capture.Bounds==bounds,"TARGET_STALE");Require(capture.Dpi==dpi,"TARGET_STALE");Require(Clock.ElapsedMilliseconds-capture.Created<15000,"TARGET_STALE");
    bool unchanged;Require(capture.Hash==Hash(Png(w,bounds,out unchanged)),"TARGET_STALE");Captures.Remove(captureId);Ready();
    if(name=="desktop_click") {
      // x/y are pixels in the screenshot, which is the window's physical rectangle: 1:1 with
      // screen pixels under this process's per-monitor DPI awareness. Nothing is scaled here.
      int x=NumberArg(args,"x"),y=NumberArg(args,"y");
      string button=args.ContainsKey("button")?TextArg(args,"button"):"left";
      int clicks=args.ContainsKey("clickCount")?NumberArg(args,"clickCount"):1;
      Require(button=="left"||button=="right"||button=="middle","INVALID_ARGUMENT");
      Require(clicks>=1&&clicks<=3,"INVALID_ARGUMENT");
      Require(x>=0&&y>=0&&x<bounds.Width&&y<bounds.Height,"TARGET_OUTSIDE_SCOPE");
      uint down=button=="right"?0x8u:button=="middle"?0x20u:0x2u,up=button=="right"?0x10u:button=="middle"?0x40u:0x4u;
      int px=bounds.X+x,py=bounds.Y+y;
      // The window can move or lose the foreground between the capture and this line; both are
      // re-checked immediately before the input, so the click cannot land on another window.
      Require(Bounds(w)==bounds&&capture.Foreground==GetForegroundWindow(),"TARGET_STALE");
      Require(GetAncestor(WindowFromPoint(new Point(px,py)),2)==w,"TARGET_OCCLUDED");
      // SetCursorPos puts the pointer at a physical pixel, so no virtual-screen normalization or
      // rounding is involved (the former disagreed with mixed-DPI monitor origins).
      Require(SetCursorPos(px,py),"INPUT_REJECTED");
      for(int click=0;click<clicks;click++){if(click>0)Thread.Sleep(40);Input(Mouse(down),Mouse(up));}
    } else if(name=="desktop_type") {
      string text=TextArg(args,"text");int pace=args.ContainsKey("interKeyDelayMs")?NumberArg(args,"interKeyDelayMs"):0;
      Require(text.Length<=8192&&pace>=0&&pace<=5,"INPUT_LIMIT");
      // Validated before the first character: a rejected control character must not leave half
      // of the text typed. Newline and tab become the keys an editor expects.
      foreach(char check in text)Require(check=='\n'||check=='\r'||check=='\t'||check>=0x20,"INVALID_ARGUMENT");
      foreach(char ch in text){
        Ready();Require(GetForegroundWindow()==w,"TARGET_STALE");
        if(ch=='\r')continue;
        if(ch=='\n')ForwardKey(13,0);else if(ch=='\t')ForwardKey(9,0);else Input(Keyboard(0,ch,0x4),Keyboard(0,ch,0x6));
        if(pace>0)Thread.Sleep(pace);
      }
    } else if(name=="desktop_key") {
      Dictionary<string,ushort> keys=new Dictionary<string,ushort>{{"Enter",13},{"Tab",9},{"Escape",27},{"Backspace",8},{"Delete",46},{"ArrowLeft",37},{"ArrowRight",39},{"ArrowUp",38},{"ArrowDown",40},{"Home",36},{"End",35},{"PageUp",33},{"PageDown",34}};
      ushort key;Require(keys.TryGetValue(TextArg(args,"key"),out key),"KEY_NOT_ALLOWED");
      List<ushort> modifiers=new List<ushort>();
      if(args.ContainsKey("modifiers")){
        object raw=args["modifiers"];object[] list=raw as object[];
        Require(list!=null,"INVALID_ARGUMENT");
        foreach(object item in list){string nameOfModifier=item as string;Require(nameOfModifier!=null,"INVALID_ARGUMENT");
          if(nameOfModifier=="ctrl")modifiers.Add(0x11);else if(nameOfModifier=="alt")modifiers.Add(0x12);else if(nameOfModifier=="shift")modifiers.Add(0x10);else throw new InvalidOperationException("INVALID_ARGUMENT");}
        Require(modifiers.Count==new HashSet<ushort>(modifiers).Count&&!modifiers.Contains(0)&&modifiers.Count<=3,"INVALID_ARGUMENT");
      }
      uint extended=(key==37||key==38||key==39||key==40||key==33||key==34||key==35||key==36||key==45||key==46)?0x1u:0u;
      foreach(ushort modifier in modifiers)Input(Keyboard(modifier,0,0));
      try{Input(Keyboard(key,0,extended),Keyboard(key,0,extended|0x2));}
      finally{foreach(ushort modifier in modifiers)Input(Keyboard(modifier,0,0x2));}
    } else if(name=="desktop_scroll") {
      int delta=NumberArg(args,"delta");Require(Math.Abs((long)delta)<=1200,"INPUT_LIMIT");
      // The wheel goes to the window under the pointer; an explicit point lets the model scroll
      // without a preceding click, with the same occlusion and freshness checks.
      if(args.ContainsKey("x")||args.ContainsKey("y")){
        int x=NumberArg(args,"x"),y=NumberArg(args,"y");
        Require(x>=0&&y>=0&&x<bounds.Width&&y<bounds.Height,"TARGET_OUTSIDE_SCOPE");
        int px=bounds.X+x,py=bounds.Y+y;
        Require(Bounds(w)==bounds&&capture.Foreground==GetForegroundWindow(),"TARGET_STALE");
        Require(GetAncestor(WindowFromPoint(new Point(px,py)),2)==w,"TARGET_OCCLUDED");
        Require(SetCursorPos(px,py),"INPUT_REJECTED");Thread.Sleep(20);
      }
      Point cursor;Require(Math.Abs((long)delta)<=1200,"INPUT_LIMIT");
      Require(GetCursorPos(out cursor)&&GetAncestor(WindowFromPoint(cursor),2)==w,"TARGET_OUTSIDE_SCOPE");
      Input(Mouse(0x800,unchecked((uint)delta)));
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
