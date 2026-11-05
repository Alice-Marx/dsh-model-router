using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

partial class DesktopHelper {
  class StreamSession {
    public string Owner;public bool ControlAllowed,Controlling,Torn,StopConfirmed;public volatile bool Stopping;
    public long ExpiresAt;public int Fps,Quality,ScalePercent=100,Sequence;public Screen Display;public Rectangle Bounds;public uint Dpi;
    public byte[] PreviousPixels;public int PreviousWidth,PreviousHeight;public bool ForceKeyframe=true;public long LastKeyframe;
    public NamedPipeServerStream Pipe;public Thread CaptureThread;public DesktopLease.Ticket Ticket;
    public readonly object Gate=new object(),PipeGate=new object();public readonly AutoResetEvent FrameRequested=new AutoResetEvent(false);
    public readonly Dictionary<ushort,uint> Keys=new Dictionary<ushort,uint>();public readonly HashSet<uint> Buttons=new HashSet<uint>();
  }
  static readonly object StreamsGate=new object();static readonly HashSet<StreamSession> Streams=new HashSet<StreamSession>();
  static bool ReadFull(Stream stream,byte[] data){int offset=0;while(offset<data.Length){int n=stream.Read(data,offset,data.Length-offset);if(n<=0)return false;offset+=n;}return true;}
  // Internal pipe framing: uint32 LE length (including tag), then J JSON / F JPEG.
  // One requested frame in flight bounds video memory independently of viewers.
  static Dictionary<string,object> ReadStreamJson(Stream stream){byte[] head=new byte[4];Require(ReadFull(stream,head),"DESKTOP_DISCONNECTED");int n=BitConverter.ToInt32(head,0);Require(n>1&&n<=65536,"IPC_LIMIT");byte[] body=new byte[n];Require(ReadFull(stream,body)&&body[0]=='J',"IPC_LIMIT");return new JavaScriptSerializer{MaxJsonLength=65536}.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(body,1,n-1));}
  static void WriteStream(StreamSession session,byte tag,byte[] payload){lock(session.PipeGate){byte[] head=BitConverter.GetBytes(payload.Length+1);session.Pipe.Write(head,0,4);session.Pipe.WriteByte(tag);session.Pipe.Write(payload,0,payload.Length);session.Pipe.Flush();}}
  static void StreamJson(StreamSession session,object value){WriteStream(session,(byte)'J',Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(value)));}
  static void SessionReady(StreamSession session){
    Require(!session.Stopping&&!Stopping,"DESKTOP_STOPPED");Require(!Paused,"DESKTOP_PAUSED");Require(UnixMilliseconds()<Interlocked.Read(ref session.ExpiresAt),"DESKTOP_GRANT_EXPIRED");
    Require(Environment.UserInteractive&&Session!=0&&System.Diagnostics.Process.GetCurrentProcess().SessionId==Session,"DESKTOP_UNAVAILABLE");
    IntPtr desktop=OpenInputDesktop(0,false,1);Require(desktop!=IntPtr.Zero,"DESKTOP_LOCKED");try{int needed;StringBuilder name=new StringBuilder(256);Require(GetUserObjectInformation(desktop,2,name,512,out needed)&&name.ToString()=="Default","DESKTOP_LOCKED");}finally{CloseDesktop(desktop);}
    bool found=false;foreach(Screen screen in Screen.AllScreens)if(screen.DeviceName==session.Display.DeviceName){found=true;Require(screen.Bounds==session.Bounds&&DisplayDpi(screen)==session.Dpi,"DISPLAY_CHANGED");break;}Require(found,"DISPLAY_NOT_FOUND");
  }
  static void SessionSend(StreamSession session,params INPUT[] input){SessionReady(session);Require(session.Controlling&&session.Ticket!=null,"CONTROL_NOT_GRANTED");Leases.Check(session.Ticket);Leases.Renew(session.Ticket,SessionLeaseMs);if(input.Length>0){InputStarted=true;Require(SendInput((uint)input.Length,input,Marshal.SizeOf(typeof(INPUT)))==input.Length,"INPUT_REJECTED");}}
  static uint ButtonFlag(string name,bool down){if(name=="left")return down?2u:4u;if(name=="right")return down?8u:16u;if(name=="middle")return down?32u:64u;throw new InvalidOperationException("INVALID_ARGUMENT");}
  static readonly Dictionary<string,ushort> SessionKeys=BuildSessionKeys();
  static Dictionary<string,ushort> BuildSessionKeys(){
    Dictionary<string,ushort> map=new Dictionary<string,ushort>();for(int i=0;i<26;i++)map["Key"+(char)('A'+i)]=(ushort)(65+i);for(int i=0;i<10;i++){map["Digit"+i]=(ushort)(48+i);map["Numpad"+i]=(ushort)(96+i);}for(int i=1;i<=24;i++)map["F"+i]=(ushort)(111+i);
    string[] codes={"Space","Enter","NumpadEnter","Escape","Backspace","Tab","Delete","Insert","Home","End","PageUp","PageDown","ArrowLeft","ArrowUp","ArrowRight","ArrowDown","ShiftLeft","ShiftRight","ControlLeft","ControlRight","AltLeft","AltRight","MetaLeft","MetaRight","CapsLock","NumLock","ScrollLock","ContextMenu","Minus","Equal","BracketLeft","BracketRight","Backslash","Semicolon","Quote","Comma","Period","Slash","Backquote","NumpadMultiply","NumpadAdd","NumpadSubtract","NumpadDecimal","NumpadDivide"};
    ushort[] keys={32,13,13,27,8,9,46,45,36,35,33,34,37,38,39,40,160,161,162,163,164,165,91,92,20,144,145,93,189,187,219,221,220,186,222,188,190,191,192,106,107,109,110,111};for(int i=0;i<codes.Length;i++)map[codes[i]]=keys[i];return map;
  }
  static uint KeyFlags(ushort vk,string code){return (vk>=33&&vk<=46||vk==163||vk==165||vk==91||vk==92||vk==93||vk==111||code=="NumpadEnter")?1u:0u;}
  static void ApplySessionInput(StreamSession session,Dictionary<string,object> message){
    lock(session.Gate){
      SessionSend(session);string kind=TextArg(message,"kind");
      if(kind=="pointer"){
        string action=TextArg(message,"action");Require(action=="move"||action=="down"||action=="up","INVALID_ARGUMENT");int x=NumberArg(message,"x"),y=NumberArg(message,"y");Require(x>=0&&y>=0&&x<session.Bounds.Width&&y<session.Bounds.Height,"TARGET_OUTSIDE_SCOPE");
        string button=message.ContainsKey("button")?TextArg(message,"button"):"left";uint down=ButtonFlag(button,true),up=ButtonFlag(button,false);
        SessionSend(session);InputStarted=true;Require(SetCursorPos(session.Bounds.X+x,session.Bounds.Y+y),"INPUT_REJECTED");
        if(action=="down"){session.Buttons.Add(up);SessionSend(session,Mouse(down));}else if(action=="up"){SessionSend(session,Mouse(up));session.Buttons.Remove(up);}
      }else if(kind=="key"){
        string action=TextArg(message,"action"),code=TextArg(message,"code");Require(action=="down"||action=="up","INVALID_ARGUMENT");ushort key;Require(SessionKeys.TryGetValue(code,out key),"KEY_NOT_ALLOWED");uint flags=KeyFlags(key,code);
        if(action=="down"){session.Keys[key]=flags;SessionSend(session,Keyboard(key,0,flags));}else{SessionSend(session,Keyboard(key,0,flags|2));session.Keys.Remove(key);}
      }else if(kind=="wheel"){
        int x=NumberArg(message,"deltaX"),y=NumberArg(message,"deltaY");Require(Math.Abs((long)x)<=4800&&Math.Abs((long)y)<=4800,"INPUT_LIMIT");if(y!=0)SessionSend(session,Mouse(0x800,unchecked((uint)-y)));if(x!=0)SessionSend(session,Mouse(0x1000,unchecked((uint)x)));
      }else if(kind=="text"){
        string text=TextArg(message,"text");Require(text.Length<=8192,"INPUT_LIMIT");foreach(char ch in text)Require(ch=='\n'||ch=='\r'||ch=='\t'||ch>=32,"INVALID_ARGUMENT");foreach(char ch in text){if(ch=='\r')continue;if(ch=='\n')SessionSend(session,Keyboard(13,0,0),Keyboard(13,0,2));else if(ch=='\t')SessionSend(session,Keyboard(9,0,0),Keyboard(9,0,2));else SessionSend(session,Keyboard(0,ch,4),Keyboard(0,ch,6));}
      }else throw new InvalidOperationException("INVALID_ARGUMENT");
    }
  }
  static bool ReleaseSessionInput(StreamSession session){
    bool ok=true;foreach(KeyValuePair<ushort,uint> row in session.Keys)if(SendInput(1,new[]{Keyboard(row.Key,0,row.Value|2)},Marshal.SizeOf(typeof(INPUT)))!=1)ok=false;foreach(uint flag in session.Buttons)if(SendInput(1,new[]{Mouse(flag)},Marshal.SizeOf(typeof(INPUT)))!=1)ok=false;
    if(ok){session.Keys.Clear();session.Buttons.Clear();}return ok;
  }
  static void ReleaseSessionControl(StreamSession session){lock(session.Gate){Require(ReleaseSessionInput(session),"INPUT_RELEASE_UNCONFIRMED");session.Controlling=false;if(session.Ticket!=null){Leases.Exit(session.Ticket);session.Ticket=null;}}}
  static void AcquireSessionControl(StreamSession session){
    lock(session.Gate){
      SessionReady(session);Require(session.ControlAllowed,"CONTROL_NOT_GRANTED");if(session.Controlling){Leases.Check(session.Ticket);return;}
      DesktopLease.Ticket ticket=Leases.Takeover(session.Owner,5000);
      try{SessionReady(session);lock(Gate){Require(ReleaseModelInput(),"INPUT_RELEASE_UNCONFIRMED");Interlocked.Increment(ref CaptureEpoch);}session.Ticket=ticket;session.Controlling=true;}catch{Leases.Exit(ticket);throw;}
    }
  }
  static bool EndSession(StreamSession session,string code){
    lock(session.Gate){if(session.Torn)return session.StopConfirmed;session.Torn=true;session.Stopping=true;session.FrameRequested.Set();try{ReleaseSessionControl(session);session.StopConfirmed=true;}catch{session.StopConfirmed=false;}}
    if(session.CaptureThread!=null&&session.CaptureThread!=Thread.CurrentThread&&!session.CaptureThread.Join(3000))session.StopConfirmed=false;
    try{StreamJson(session,new{t="ended",code=code,stopConfirmed=session.StopConfirmed});}catch{}
    lock(StreamsGate){Streams.Remove(session);}return session.StopConfirmed;
  }
  // Compare the uncompressed current image. A changed bounding rectangle preserves readable
  // physical pixels while avoiding repeatedly sending the unchanged wallpaper and windows.
  static Rectangle ChangedRegion(StreamSession session,Bitmap image,out bool keyframe){
    Rectangle bounds=new Rectangle(0,0,image.Width,image.Height);BitmapData locked=image.LockBits(bounds,ImageLockMode.ReadOnly,PixelFormat.Format24bppRgb);
    int stride=Math.Abs(locked.Stride);byte[] pixels=new byte[stride*image.Height];
    try{for(int y=0;y<image.Height;y++)Marshal.Copy(IntPtr.Add(locked.Scan0,y*locked.Stride),pixels,y*stride,stride);}finally{image.UnlockBits(locked);}
    keyframe=session.ForceKeyframe||session.PreviousPixels==null||session.PreviousWidth!=image.Width||session.PreviousHeight!=image.Height||Clock.ElapsedMilliseconds-session.LastKeyframe>5000;
    int left=image.Width,top=image.Height,right=-1,bottom=-1;
    if(!keyframe){for(int y=0;y<image.Height;y++){int offset=y*stride;for(int x=0;x<image.Width;x++){int p=offset+x*3;if(pixels[p]!=session.PreviousPixels[p]||pixels[p+1]!=session.PreviousPixels[p+1]||pixels[p+2]!=session.PreviousPixels[p+2]){if(x<left)left=x;if(x>right)right=x;if(y<top)top=y;if(y>bottom)bottom=y;}}}}
    session.PreviousPixels=pixels;session.PreviousWidth=image.Width;session.PreviousHeight=image.Height;
    if(keyframe){session.ForceKeyframe=false;session.LastKeyframe=Clock.ElapsedMilliseconds;return bounds;}
    // A one-pixel unchanged heartbeat keeps frame/expiry monitoring alive without a full JPEG.
    if(right<left)return new Rectangle(0,0,1,1);
    left=Math.Max(0,left-2);top=Math.Max(0,top-2);right=Math.Min(image.Width-1,right+2);bottom=Math.Min(image.Height-1,bottom+2);
    return Rectangle.FromLTRB(left,top,right+1,bottom+1);
  }
  static void StopStreams(string code){StreamSession[] sessions;lock(StreamsGate){sessions=new StreamSession[Streams.Count];Streams.CopyTo(sessions);}foreach(StreamSession session in sessions){EndSession(session,code);try{session.Pipe.Dispose();}catch{}}lock(Gate){ReleaseModelInput();}}
  static void CaptureStream(StreamSession session){
    long last=0;try{
      while(!session.Stopping){
        SessionReady(session);lock(session.Gate){if(session.Controlling)Leases.Renew(session.Ticket,SessionLeaseMs);}
        if(!session.FrameRequested.WaitOne(100))continue;
        long interval=1000/session.Fps,wait=last+interval-Clock.ElapsedMilliseconds;if(wait>0)Thread.Sleep((int)wait);SessionReady(session);
        last=Clock.ElapsedMilliseconds;long captureStart=last;int quality,scale;lock(session.Gate){quality=session.Quality;scale=session.ScalePercent;}
        int frameWidth=Math.Max(1,session.Bounds.Width*scale/100),frameHeight=Math.Max(1,session.Bounds.Height*scale/100);long captureMs,encodeMs;byte[] jpeg;Rectangle region;bool keyframe;
        using(Bitmap physical=DesktopBitmap(session.Display,session.Bounds))using(MemoryStream bytes=new MemoryStream()){
          captureMs=Clock.ElapsedMilliseconds-captureStart;long encodeStart=Clock.ElapsedMilliseconds;Bitmap image=physical;
          if(scale!=100){image=new Bitmap(frameWidth,frameHeight,PixelFormat.Format24bppRgb);using(Graphics resize=Graphics.FromImage(image)){resize.CompositingMode=System.Drawing.Drawing2D.CompositingMode.SourceCopy;resize.InterpolationMode=System.Drawing.Drawing2D.InterpolationMode.Bilinear;resize.DrawImage(physical,new Rectangle(0,0,frameWidth,frameHeight));}}
          try{
          region=ChangedRegion(session,image,out keyframe);
          ImageCodecInfo codec=null;foreach(ImageCodecInfo item in ImageCodecInfo.GetImageEncoders())if(item.FormatID==ImageFormat.Jpeg.Guid){codec=item;break;}Require(codec!=null,"CAPTURE_BACKEND_UNAVAILABLE");
          using(Bitmap patch=image.Clone(region,PixelFormat.Format24bppRgb))using(EncoderParameters parameters=new EncoderParameters(1)){parameters.Param[0]=new EncoderParameter(System.Drawing.Imaging.Encoder.Quality,(long)quality);patch.Save(bytes,codec,parameters);}Require(bytes.Length<=8388608,"CAPTURE_LIMIT");jpeg=bytes.ToArray();
          }finally{if(image!=physical)image.Dispose();}encodeMs=Clock.ElapsedMilliseconds-encodeStart;
        }
        if(session.Stopping)break;
        StreamJson(session,new{t="frame-meta",sequence=++session.Sequence,width=session.Bounds.Width,height=session.Bounds.Height,frameWidth=frameWidth,frameHeight=frameHeight,region=new{x=region.X,y=region.Y,width=region.Width,height=region.Height},keyframe=keyframe,quality=quality,scalePercent=scale,captureMs=captureMs,encodeMs=encodeMs,capturedAt=UnixMilliseconds()});
        WriteStream(session,(byte)'F',jpeg);
      }
    }catch(InvalidOperationException e){if(!session.Stopping){EndSession(session,e.Message);try{session.Pipe.Dispose();}catch{}}}catch{if(!session.Stopping){EndSession(session,"DESKTOP_DISCONNECTED");try{session.Pipe.Dispose();}catch{}}}
  }
  static void StreamHandler(NamedPipeServerStream pipe){
    StreamSession session=new StreamSession{Pipe=pipe};bool opened=false;
    try{
      // An idle local connector cannot consume a stream slot indefinitely.
      System.Threading.Tasks.Task<Dictionary<string,object>> read=System.Threading.Tasks.Task.Factory.StartNew(delegate{return ReadStreamJson(pipe);});Require(read.Wait(5000),"IPC_TIMEOUT");Dictionary<string,object> request=read.Result;
      Require(FullDesktop,"DESKTOP_FULL_DISABLED");Require(NumberArg(request,"streamVersion")==StreamVersion,"DESKTOP_PROTOCOL_UNSUPPORTED");Require(request.ContainsKey("token")&&Equal(TextArg(request,"token"),Token),"AUTH_INVALID");
      session.Owner=TextArg(request,"owner");Require(System.Text.RegularExpressions.Regex.IsMatch(session.Owner,"^[a-f0-9]{64}$"),"DESKTOP_OWNER_REQUIRED");
      session.ControlAllowed=request.ContainsKey("controlAllowed")&&request["controlAllowed"] is bool&&(bool)request["controlAllowed"];
      session.ExpiresAt=LongArg(request,"expiresAt");Require(session.ExpiresAt>UnixMilliseconds()&&session.ExpiresAt-UnixMilliseconds()<=300000,"DESKTOP_GRANT_EXPIRED");
      session.Fps=NumberArg(request,"fps");Require(session.Fps>=1&&session.Fps<=30,"INVALID_ARGUMENT");session.Quality=70;
      session.Display=SelectDisplay(request);session.Bounds=session.Display.Bounds;session.Dpi=DisplayDpi(session.Display);SessionReady(session);
      lock(StreamsGate){Streams.Add(session);}StreamJson(session,new{t="opened",ok=true,helperInstanceId=InstanceId,streamVersion=StreamVersion,displayId=session.Display.DeviceName,displays=Displays(),width=session.Bounds.Width,height=session.Bounds.Height,dpi=session.Dpi,physicalOrigin=new{x=session.Bounds.X,y=session.Bounds.Y},sessionId=Session,captureBackend="GDI-BitBlt",coordinateSpace="display-physical-pixels",mode="watch"});opened=true;
      session.CaptureThread=new Thread(delegate(){CaptureStream(session);}){IsBackground=true};session.CaptureThread.Start();
      while(!session.Stopping){
        Dictionary<string,object> message=ReadStreamJson(pipe);string type=TextArg(message,"t");if(type=="frame"){if(message.ContainsKey("keyframe")&&message["keyframe"] is bool&&(bool)message["keyframe"])session.ForceKeyframe=true;session.FrameRequested.Set();continue;}
        long id=LongArg(message,"id");InputStarted=false;
        try{
          if(type=="close"){bool stopped=EndSession(session,"SESSION_CLOSED");StreamJson(session,new{t="ack",id=id,ok=true,stopConfirmed=stopped});break;}
          SessionReady(session);
          if(type=="control"){string action=TextArg(message,"action");if(action=="acquire")AcquireSessionControl(session);else{Require(action=="release","INVALID_ARGUMENT");ReleaseSessionControl(session);}StreamJson(session,new{t="ack",id=id,ok=true,mode=session.Controlling?"control":"watch"});}
          else if(type=="release-input"){lock(session.Gate){Require(ReleaseSessionInput(session),"INPUT_RELEASE_UNCONFIRMED");}StreamJson(session,new{t="ack",id=id,ok=true});}
          else if(type=="input"){ApplySessionInput(session,message);StreamJson(session,new{t="ack",id=id,ok=true});}
          else if(type=="renew"){long expires=LongArg(message,"expiresAt");Require(expires>UnixMilliseconds()&&expires-UnixMilliseconds()<=300000,"DESKTOP_GRANT_EXPIRED");Interlocked.Exchange(ref session.ExpiresAt,expires);StreamJson(session,new{t="ack",id=id,ok=true,expiresAt=expires});}
          else if(type=="video"){int scale=NumberArg(message,"scalePercent"),quality=NumberArg(message,"quality");Require(scale>=25&&scale<=100&&quality>=20&&quality<=85,"INVALID_ARGUMENT");lock(session.Gate){session.ScalePercent=scale;session.Quality=quality;}StreamJson(session,new{t="ack",id=id,ok=true});}
          else throw new InvalidOperationException("INVALID_ARGUMENT");
        }catch(InvalidOperationException e){StreamJson(session,new{t="ack",id=id,ok=false,code=e.Message,possiblyApplied=InputStarted});if(e.Message=="INPUT_REJECTED"||e.Message=="INPUT_RELEASE_UNCONFIRMED")throw;}
      }
    }catch(InvalidOperationException e){if(!opened)try{StreamJson(session,new{t="opened",ok=false,code=e.Message});}catch{}}
    catch{}
    finally{EndSession(session,"DESKTOP_DISCONNECTED");try{pipe.Dispose();}catch{}}
  }
  static void StreamLoop(PipeSecurity security){
    while(!Stopping)try{
      // Ownership transfers to StreamHandler after accept. A using here would
      // dispose the connection immediately while its worker is reading it.
      NamedPipeServerStream pipe=new NamedPipeServerStream(PipeName+"-stream",PipeDirection.InOut,4,PipeTransmissionMode.Byte,PipeOptions.Asynchronous,65536,1048576,security);
      try{pipe.WaitForConnection();}catch{pipe.Dispose();throw;}
      new Thread(delegate(){StreamHandler(pipe);}){IsBackground=true}.Start();
    }catch{Thread.Sleep(100);}
  }
}
