using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Runtime.InteropServices;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Collections.Generic;

[ComImport,Guid("A5CD92FF-29BE-454C-8D04-D82879FB3F1B"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface VirtualDesktopManager {
  [PreserveSig] int IsWindowOnCurrentVirtualDesktop(IntPtr window,[MarshalAs(UnmanagedType.Bool)]out bool current);
  [PreserveSig] int GetWindowDesktopId(IntPtr window,out Guid id);
  [PreserveSig] int MoveWindowToDesktop(IntPtr window,[In]ref Guid id);
}

class WheelEntry : TextBox {
  [DllImport("user32.dll")] static extern bool HideCaret(IntPtr window);
  internal int WheelEvents;
  protected override void OnGotFocus(EventArgs args) {base.OnGotFocus(args);HideCaret(Handle);}
  protected override void WndProc(ref Message message) {
    if(message.Msg==0x020A)WheelEvents++;
    base.WndProc(ref message);
  }
}
class Fixture {
  static bool Live;static string ClaimStatus="not-attempted",DesktopStatus="not-queried";
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window,int attribute,out int value,int length);
  [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint id);
  [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll")] static extern bool GetUserObjectInformation(IntPtr value,int index,StringBuilder text,int length,out int needed);
  [DllImport("user32.dll",EntryPoint="GetWindowThreadProcessId")] static extern uint WindowProcess(IntPtr window,out uint process);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
  static string ObjectName(IntPtr value){StringBuilder text=new StringBuilder(256);int needed;return GetUserObjectInformation(value,2,text,512,out needed)?text.ToString():"unavailable";}
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window,int mode);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr window);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,IntPtr processId);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint attach,uint attachTo,bool attachFlag);
  // A background process may not raise itself, so borrow the foreground thread's input queue for
  // the call. Without this the fixture only takes the foreground when a human clicks it.
  static void Claim(Form form) {
    if(GetForegroundWindow()==form.Handle)return;
    if(Live)try{
      VirtualDesktopManager manager=(VirtualDesktopManager)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("AA509086-5CA9-4C25-8F95-589D3C07B48A")));
      bool onCurrent;Guid own,foregroundId;int currentResult=manager.IsWindowOnCurrentVirtualDesktop(form.Handle,out onCurrent),ownResult=manager.GetWindowDesktopId(form.Handle,out own),foregroundResult=manager.GetWindowDesktopId(GetForegroundWindow(),out foregroundId);
      DesktopStatus="current="+onCurrent+";query="+currentResult+";own="+own+";foreground="+foregroundId;
      // Move only this synthetic window. Never switch the user's virtual
      // desktop or move/activate an unrelated application.
      if(currentResult==0&&!onCurrent&&foregroundResult==0&&foregroundId!=Guid.Empty)DesktopStatus+=";move="+manager.MoveWindowToDesktop(form.Handle,ref foregroundId);
      Marshal.ReleaseComObject(manager);
    }catch(Exception e){DesktopStatus=e.GetType().Name+":"+e.HResult;}
    uint foreground=GetWindowThreadProcessId(GetForegroundWindow(),IntPtr.Zero),current=GetCurrentThreadId();
    bool attached=foreground!=current&&AttachThreadInput(foreground,current,true);
    try{ShowWindow(form.Handle,9);if(Live)SetWindowPos(form.Handle,new IntPtr(-1),0,0,0,0,0x1|0x2|0x40);bool top=BringWindowToTop(form.Handle),raised=SetForegroundWindow(form.Handle);SetFocus(form.Handle);form.Activate();ClaimStatus="attached="+attached+";top="+top+";foreground="+raised;}
    finally{if(attached)AttachThreadInput(foreground,current,false);}
  }
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [STAThread] static void Main(string[] args) {
    if(args[0]=="--acl") {
      using(NamedPipeClientStream pipe=new NamedPipeClientStream(".",args[1],PipeAccessRights.ReadWrite|PipeAccessRights.ReadPermissions,PipeOptions.None,TokenImpersonationLevel.Identification,HandleInheritability.None)) {
        pipe.Connect(3000);PipeSecurity acl=pipe.GetAccessControl();bool broad=false,network=false;
        foreach(PipeAccessRule rule in acl.GetAccessRules(true,true,typeof(SecurityIdentifier))) {
          string sid=rule.IdentityReference.Value;
          if(rule.AccessControlType==AccessControlType.Allow&&(sid=="S-1-1-0"||sid=="S-1-5-11"||sid=="S-1-5-32-545"))broad=true;
          if(rule.AccessControlType==AccessControlType.Deny&&sid=="S-1-5-2")network=true;
        }
        File.WriteAllText(args[2],new JavaScriptSerializer().Serialize(new{protectedAcl=acl.AreAccessRulesProtected,broadAllowed=broad,networkDenied=network}));
      }
      return;
    }
    SetProcessDpiAwarenessContext(new IntPtr(-4));Application.EnableVisualStyles();
    Live=args.Length>2&&args[2]=="--live";
    Form form=new Form{Text="DSH isolated desktop validation",ClientSize=new Size(420,180),StartPosition=FormStartPosition.CenterScreen,TopMost=true,KeyPreview=true};
    WheelEntry entry=new WheelEntry{Location=new Point(20,45),Width=360,MaxLength=20000};
    Label label=new Label{Location=new Point(20,15),AutoSize=true,Text="Synthetic fixture only"};
    Button button=new Button{Location=new Point(20,100),Text="Fixture button",Width=160,FlatStyle=FlatStyle.Flat};
    int clicks=0;button.Click+=delegate{clicks++;};
    HashSet<int> held=new HashSet<int>();int keyDowns=0,keyUps=0;form.KeyDown+=delegate(object sender,KeyEventArgs e){held.Add((int)e.KeyCode);keyDowns++;};form.KeyUp+=delegate(object sender,KeyEventArgs e){held.Remove((int)e.KeyCode);keyUps++;};
    form.Controls.Add(entry);form.Controls.Add(label);form.Controls.Add(button);
    JavaScriptSerializer json=new JavaScriptSerializer();System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer{Interval=50};int ticks=0;
    timer.Tick+=delegate {
      int cloaked=0;uint foregroundProcess;WindowProcess(GetForegroundWindow(),out foregroundProcess);DwmGetWindowAttribute(form.Handle,14,out cloaked,4);
      File.WriteAllText(args[1],json.Serialize(new{text=entry.Text,clicks=clicks,wheelEvents=entry.WheelEvents,tick=++ticks,visible=IsWindowVisible(form.Handle),foreground=GetForegroundWindow()==form.Handle,foregroundWindow=GetForegroundWindow().ToInt64().ToString(),foregroundProcess=foregroundProcess,cloaked=cloaked,claimStatus=ClaimStatus,desktopStatus=DesktopStatus,windowStation=ObjectName(GetProcessWindowStation()),desktop=ObjectName(GetThreadDesktop(GetCurrentThreadId())),shiftDown=(GetAsyncKeyState(0x10)&0x8000)!=0,leftShiftDown=(GetAsyncKeyState(0xA0)&0x8000)!=0,controlDown=(GetAsyncKeyState(0x11)&0x8000)!=0,heldKeys=new List<int>(held).ToArray(),keyDownEvents=keyDowns,keyUpEvents=keyUps}));
      if(Live)label.Text="Synthetic live fixture: "+ticks;
      if(ticks>2400)form.Close();
    };
    form.Shown+=delegate {
      Claim(form);entry.Focus();
      // The desktop can be busy; a few retries make the precondition dependable.
      System.Windows.Forms.Timer claim=new System.Windows.Forms.Timer{Interval=400};int attempts=0;
      claim.Tick+=delegate{if(++attempts>10){claim.Stop();claim.Dispose();return;}Claim(form);entry.Focus();};
      claim.Start();
      Point input=entry.PointToScreen(new Point(10,10)),click=button.PointToScreen(new Point(20,12));
      File.WriteAllText(args[0],json.Serialize(new{targetWindow=form.Handle.ToInt64().ToString(),sessionSelector=Process.GetCurrentProcess().SessionId,displayId=Screen.FromHandle(form.Handle).DeviceName,inputScreenX=input.X,inputScreenY=input.Y,buttonScreenX=click.X,buttonScreenY=click.Y}));
      timer.Start();
    };
    Application.Run(form);
  }
}
