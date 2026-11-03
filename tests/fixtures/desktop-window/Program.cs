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
    uint foreground=GetWindowThreadProcessId(GetForegroundWindow(),IntPtr.Zero),current=GetCurrentThreadId();
    bool attached=foreground!=current&&AttachThreadInput(foreground,current,true);
    try{ShowWindow(form.Handle,5);BringWindowToTop(form.Handle);SetForegroundWindow(form.Handle);SetFocus(form.Handle);form.Activate();}
    finally{if(attached)AttachThreadInput(foreground,current,false);}
  }
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
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
    Form form=new Form{Text="DSH isolated desktop validation",ClientSize=new Size(420,180),StartPosition=FormStartPosition.CenterScreen,TopMost=true};
    WheelEntry entry=new WheelEntry{Location=new Point(20,45),Width=360,MaxLength=20000};
    Label label=new Label{Location=new Point(20,15),AutoSize=true,Text="Synthetic fixture only"};
    Button button=new Button{Location=new Point(20,100),Text="Fixture button",Width=160,FlatStyle=FlatStyle.Flat};
    int clicks=0;button.Click+=delegate{clicks++;};
    form.Controls.Add(entry);form.Controls.Add(label);form.Controls.Add(button);
    JavaScriptSerializer json=new JavaScriptSerializer();System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer{Interval=50};int ticks=0;
    timer.Tick+=delegate {
      File.WriteAllText(args[1],json.Serialize(new{text=entry.Text,clicks=clicks,wheelEvents=entry.WheelEvents,tick=++ticks,visible=IsWindowVisible(form.Handle),foreground=GetForegroundWindow()==form.Handle}));
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
