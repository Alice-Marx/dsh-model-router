// Test-only handle inspection. Every target comes from an owned gate/launcher;
// termination requires its exact process creation FILETIME, on the same handle.
export const CONTROL_SOURCE=`using System;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
class FixtureProcessControl {
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint id);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr handle,out long creation,out long exit,out long kernel,out long user);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr handle,uint code);
 [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 static int Main(string[] args){IntPtr handle=IntPtr.Zero;try{
  if(args.Length<2)return 2;uint pid=uint.Parse(args[1]);if(pid==0)return 2;bool kill=args[0]=="kill";
  handle=OpenProcess(0x00101000u|(kill?1u:0u),false,pid);
  if(handle==IntPtr.Zero){if(Marshal.GetLastWin32Error()!=87)return 4;Console.WriteLine(new JavaScriptSerializer().Serialize(new {alive=false}));return 0;}
  long creation,exit,kernel,user;uint code;if(!GetProcessTimes(handle,out creation,out exit,out kernel,out user)||!GetExitCodeProcess(handle,out code))return 4;
  if(kill){if(args.Length!=3||creation.ToString()!=args[2])return 3;if(code==259&&(!TerminateProcess(handle,125)||WaitForSingleObject(handle,10000)!=0))return 5;code=0;}
  Console.WriteLine(new JavaScriptSerializer().Serialize(new {pid=pid,creation=creation.ToString(),alive=code==259}));return 0;
 }catch{return 6;}finally{if(handle!=IntPtr.Zero)CloseHandle(handle);}}
}
`
