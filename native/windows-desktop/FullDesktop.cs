using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

partial class DesktopHelper {
  [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(Point point,uint flags);
  [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr monitor,int type,out uint x,out uint y);
  static Screen SelectDisplay(Dictionary<string,object> args) {
    if(args.ContainsKey("sessionSelector"))Require(NumberArg(args,"sessionSelector")==Session,"DESKTOP_UNAVAILABLE");
    string id=args.ContainsKey("displayId")?TextArg(args,"displayId"):null;
    foreach(Screen screen in Screen.AllScreens)if(id==screen.DeviceName)return screen;
    Require(id==null,"DISPLAY_NOT_FOUND");return Screen.PrimaryScreen;
  }
  static uint DisplayDpi(Screen display){
    try{uint x,y;Rectangle r=display.Bounds;if(GetDpiForMonitor(MonitorFromPoint(new Point(r.Left+r.Width/2,r.Top+r.Height/2),2),0,out x,out y)==0&&x>0)return x;}catch(EntryPointNotFoundException){}catch(DllNotFoundException){}
    IntPtr dc=CreateDC(null,display.DeviceName,null,IntPtr.Zero);
    try{return dc==IntPtr.Zero?96u:(uint)Math.Max(96,GetDeviceCaps(dc,88));}finally{if(dc!=IntPtr.Zero)DeleteDC(dc);}
  }
  static object[] Displays(){
    List<object> list=new List<object>();foreach(Screen display in Screen.AllScreens){Rectangle r=display.Bounds;list.Add(new{id=display.DeviceName,name=display.DeviceName,width=r.Width,height=r.Height,x=r.X,y=r.Y,dpi=DisplayDpi(display),primary=display.Primary});}return list.ToArray();
  }
  static Bitmap DesktopBitmap(Screen display,Rectangle bounds){
    Require(bounds.Width>0&&bounds.Height>0&&bounds.Width<=8192&&bounds.Height<=8192&&(long)bounds.Width*bounds.Height<=20000000,"CAPTURE_LIMIT");
    Bitmap image=new Bitmap(bounds.Width,bounds.Height,PixelFormat.Format24bppRgb);
    try{using(Graphics graphics=Graphics.FromImage(image)){IntPtr target=graphics.GetHdc();try{IntPtr source=CreateDC(null,display.DeviceName,null,IntPtr.Zero);try{Require(source!=IntPtr.Zero,"CAPTURE_BACKEND_UNAVAILABLE");Require(BitBlt(target,0,0,bounds.Width,bounds.Height,source,0,0,0x00CC0020|0x40000000),"CAPTURE_BACKEND_UNAVAILABLE");}finally{if(source!=IntPtr.Zero)DeleteDC(source);}}finally{graphics.ReleaseHdc(target);}}return image;}catch{image.Dispose();throw;}
  }
  // Full desktop authority is an explicit helper launch option. Model actions
  // still require a fresh, single-use frame belonging to their native lease.
  // Monitor pixels naturally change; this path intentionally has no image hash.
  static object ExecuteFull(string name,Dictionary<string,object> args,string owner){
    Ready();Screen display=SelectDisplay(args);Rectangle bounds=display.Bounds;uint dpi=DisplayDpi(display);
    DesktopLease.Ticket ticket=Leases.Enter(owner);ActiveTicket=ticket;
    try{
      Leases.Check(ticket);
      if(name=="desktop_screenshot"){
        byte[] data;using(Bitmap image=DesktopBitmap(display,bounds))using(MemoryStream bytes=new MemoryStream()){image.Save(bytes,ImageFormat.Png);data=bytes.ToArray();}
        Require(data.Length<=8388608,"CAPTURE_LIMIT");Ready();Leases.Check(ticket);
        string id="screenshot-"+Guid.NewGuid().ToString("N");Captures.Clear();Captures[id]=new Capture{Full=true,DisplayId=display.DeviceName,Bounds=bounds,Dpi=dpi,Created=Clock.ElapsedMilliseconds,Generation=ticket.Generation,Epoch=Volatile.Read(ref CaptureEpoch),Owner=owner};
        return new{screenshotId=id,displayId=display.DeviceName,displays=Displays(),width=bounds.Width,height=bounds.Height,dpi=dpi,physicalOrigin=new{x=bounds.X,y=bounds.Y},coordinateSpace="screenshot-pixels",sessionId=Session,capturedAt=DateTime.UtcNow.ToString("o"),pngBase64=Convert.ToBase64String(data),captureBackend="GDI-BitBlt",clipboardUsed=false,blank=false};
      }
      string captureId=TextArg(args,"screenshotId");Capture frame;Require(Captures.TryGetValue(captureId,out frame),"TARGET_STALE");
      // Selecting no display continues the exact display from the screenshot.
      if(!args.ContainsKey("displayId")){args["displayId"]=frame.DisplayId;display=SelectDisplay(args);bounds=display.Bounds;dpi=DisplayDpi(display);}
      Require(frame.Full&&frame.Owner==owner&&frame.Generation==ticket.Generation&&frame.Epoch==Volatile.Read(ref CaptureEpoch),"TARGET_STALE");
      Require(frame.DisplayId==display.DeviceName&&frame.Bounds==bounds&&frame.Dpi==dpi&&Clock.ElapsedMilliseconds-frame.Created<15000,"TARGET_STALE");
      Captures.Remove(captureId);Ready();Leases.Check(ticket);
      if(name=="desktop_click"){
        int x=NumberArg(args,"x"),y=NumberArg(args,"y"),clicks=args.ContainsKey("clickCount")?NumberArg(args,"clickCount"):1;
        string button=args.ContainsKey("button")?TextArg(args,"button"):"left";uint down=ButtonFlag(button,true),up=ButtonFlag(button,false);
        Require(clicks>=1&&clicks<=3,"INVALID_ARGUMENT");Require(x>=0&&y>=0&&x<bounds.Width&&y<bounds.Height,"TARGET_OUTSIDE_SCOPE");
        Ready();Leases.Check(ticket);InputStarted=true;Require(SetCursorPos(bounds.X+x,bounds.Y+y),"INPUT_REJECTED");
        for(int i=0;i<clicks;i++){if(i>0)Thread.Sleep(40);Input(Mouse(down),Mouse(up));}
      }else if(name=="desktop_type"){
        string text=TextArg(args,"text");int pace=args.ContainsKey("interKeyDelayMs")?NumberArg(args,"interKeyDelayMs"):0;
        Require(text.Length<=8192&&pace>=0&&pace<=5,"INPUT_LIMIT");foreach(char ch in text)Require(ch=='\n'||ch=='\r'||ch=='\t'||ch>=32,"INVALID_ARGUMENT");
        foreach(char ch in text){if(ch=='\r')continue;if(ch=='\n')ForwardKey(13,0);else if(ch=='\t')ForwardKey(9,0);else Input(Keyboard(0,ch,4),Keyboard(0,ch,6));if(pace>0)Thread.Sleep(pace);}
      }else if(name=="desktop_key"){
        Dictionary<string,ushort> keys=new Dictionary<string,ushort>{{"Enter",13},{"Tab",9},{"Escape",27},{"Backspace",8},{"Delete",46},{"ArrowLeft",37},{"ArrowRight",39},{"ArrowUp",38},{"ArrowDown",40},{"Home",36},{"End",35},{"PageUp",33},{"PageDown",34}};
        ushort key;Require(keys.TryGetValue(TextArg(args,"key"),out key),"KEY_NOT_ALLOWED");List<ushort> modifiers=new List<ushort>();
        if(args.ContainsKey("modifiers")){object[] list=args["modifiers"] as object[];Require(list!=null,"INVALID_ARGUMENT");foreach(object item in list){if((string)item=="ctrl")modifiers.Add(17);else if((string)item=="alt")modifiers.Add(18);else if((string)item=="shift")modifiers.Add(16);else throw new InvalidOperationException("INVALID_ARGUMENT");}Require(modifiers.Count<=3&&new HashSet<ushort>(modifiers).Count==modifiers.Count,"INVALID_ARGUMENT");}
        uint ext=KeyFlags(key,null);foreach(ushort mod in modifiers)Input(Keyboard(mod,0,0));try{Input(Keyboard(key,0,ext),Keyboard(key,0,ext|2));}finally{foreach(ushort mod in modifiers)Input(Keyboard(mod,0,2));}
      }else if(name=="desktop_scroll"){
        int delta=NumberArg(args,"delta");Require(Math.Abs((long)delta)<=1200,"INPUT_LIMIT");
        if(args.ContainsKey("x")||args.ContainsKey("y")){int x=NumberArg(args,"x"),y=NumberArg(args,"y");Require(x>=0&&y>=0&&x<bounds.Width&&y<bounds.Height,"TARGET_OUTSIDE_SCOPE");Ready();Leases.Check(ticket);InputStarted=true;Require(SetCursorPos(bounds.X+x,bounds.Y+y),"INPUT_REJECTED");}
        else{Point cursor;Require(GetCursorPos(out cursor)&&bounds.Contains(cursor),"TARGET_OUTSIDE_SCOPE");}
        Input(Mouse(0x800,unchecked((uint)delta)));
      }else throw new InvalidOperationException("TOOL_NOT_READY");
      return new{completed=true,sessionId=Session,displayId=display.DeviceName,clipboardUsed=false};
    }finally{ReleaseModelInput();ActiveTicket=null;Leases.Exit(ticket);}
  }
}
