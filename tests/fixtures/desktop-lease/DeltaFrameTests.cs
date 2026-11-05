using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Reflection;
class DeltaFrameTests {
  static void Check(bool value,string message){if(!value)throw new Exception(message);}
  static void Main(){
    Type helper=typeof(DeltaFrameTests).Assembly.GetType("DesktopHelper"),type=helper.GetNestedType("StreamSession",BindingFlags.NonPublic);
    object session=Activator.CreateInstance(type,true);MethodInfo method=helper.GetMethod("ChangedRegion",BindingFlags.NonPublic|BindingFlags.Static);
    using(Bitmap image=new Bitmap(160,100,PixelFormat.Format24bppRgb)){
      using(Graphics g=Graphics.FromImage(image))g.Clear(Color.White);
      object[] call={session,image,false};Rectangle first=(Rectangle)method.Invoke(null,call);Check((bool)call[2]&&first==new Rectangle(0,0,160,100),"Initial frame must be complete");
      call=new object[]{session,image,false};Rectangle still=(Rectangle)method.Invoke(null,call);Check(!(bool)call[2]&&still==new Rectangle(0,0,1,1),"Unchanged desktop must use a bounded heartbeat patch");
      using(Graphics g=Graphics.FromImage(image))g.FillRectangle(Brushes.Black,30,20,40,10);
      call=new object[]{session,image,false};Rectangle changed=(Rectangle)method.Invoke(null,call);Check(!(bool)call[2]&&changed.Contains(new Rectangle(30,20,40,10))&&changed.Width<80&&changed.Height<40,"Dirty rectangle must cover all changed pixels without the wallpaper");
      type.GetField("ForceKeyframe").SetValue(session,true);call=new object[]{session,image,false};Check((Rectangle)method.Invoke(null,call)==first&&(bool)call[2],"Lost downstream frames require a complete replacement");
      using(Bitmap resized=new Bitmap(80,50,PixelFormat.Format24bppRgb)){call=new object[]{session,resized,false};Check((Rectangle)method.Invoke(null,call)==new Rectangle(0,0,80,50)&&(bool)call[2],"Resolution changes must start with a keyframe");}
    }
    Console.WriteLine("Delta frame coverage, unchanged heartbeat, forced recovery and resize passed");
  }
}
