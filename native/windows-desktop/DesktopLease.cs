using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;

// The helper, rather than each connecting Node process, owns this arbiter.
// Pure state/clock logic also runs without an interactive desktop in native tests.
internal sealed class DesktopLease {
  internal sealed class Ticket {
    internal string Owner;
    internal long Generation, Deadline;
    internal bool Exited;
  }
  readonly object gate = new object();
  readonly Dictionary<string,long> revoked = new Dictionary<string,long>();
  readonly Func<long> clock;
  readonly int capacity;
  readonly long leaseMs;
  string owner = "";
  long until, generation, lastTime;
  int active;
  bool cancelling, releaseWhenIdle, faulted;

  internal DesktopLease() : this(NewClock(),4096,15000) {}
  static Func<long> NewClock() { Stopwatch watch=Stopwatch.StartNew();return delegate {return watch.ElapsedMilliseconds;}; }
  internal DesktopLease(Func<long> monotonic,int maxRevoked,long duration) {
    if(monotonic==null||maxRevoked<1||maxRevoked>4096||duration<1||duration>15000)throw new ArgumentException("DESKTOP_LEASE_CONFIG");
    clock=monotonic;capacity=maxRevoked;leaseMs=duration;
  }
  static void Require(bool value,string code) {if(!value)throw new InvalidOperationException(code);}
  long Now() {
    long now=clock();
    if(now<lastTime){faulted=true;generation++;throw new InvalidOperationException("DESKTOP_CLOCK_UNAVAILABLE");}
    lastTime=now;return now;
  }
  void Prune(long now) {
    List<string> expired=new List<string>();
    foreach(KeyValuePair<string,long> row in revoked)if(row.Value<=now)expired.Add(row.Key);
    foreach(string key in expired)revoked.Remove(key);
  }
  internal Ticket Enter(string requested) {
    lock(gate){
      Require(!String.IsNullOrEmpty(requested)&&requested.Length<=256,"DESKTOP_OWNER_REQUIRED");
      long now=Now();Prune(now);
      Require(!faulted,"DESKTOP_LEASE_LIMIT");Require(!revoked.ContainsKey(requested),"DESKTOP_CANCELLED");
      Require(!cancelling,"DESKTOP_BUSY");
      Require(owner==requested||active==0&&until<=now,"DESKTOP_BUSY");
      if(owner!=requested){owner=requested;generation++;}
      until=now+leaseMs;active++;
      return new Ticket{Owner=requested,Generation=generation,Deadline=now+leaseMs};
    }
  }
  internal void Check(Ticket ticket) {
    lock(gate){
      long now=Now();Require(ticket!=null&&!ticket.Exited&&!faulted&&!cancelling&&ticket.Generation==generation&&ticket.Owner==owner&&!revoked.ContainsKey(ticket.Owner),"DESKTOP_CANCELLED");
      Require(now<ticket.Deadline,"DESKTOP_DEADLINE");
    }
  }
  internal void Exit(Ticket ticket) {
    lock(gate){
      Require(ticket!=null&&!ticket.Exited&&active>0,"DESKTOP_LEASE_STATE");ticket.Exited=true;active--;
      if(active==0){
        if(releaseWhenIdle){owner="";until=0;cancelling=false;releaseWhenIdle=false;}
        Monitor.PulseAll(gate);
      }
    }
  }
  internal bool Cancel(string requested,int waitMs) {
    lock(gate){
      Require(!String.IsNullOrEmpty(requested)&&requested.Length<=256,"DESKTOP_OWNER_REQUIRED");
      Require(waitMs>=0&&waitMs<=5000,"DESKTOP_CANCEL_TIMEOUT");
      long now=Now();Prune(now);
      if(!revoked.ContainsKey(requested)&&revoked.Count>=capacity){
        // Never evict a live cancellation marker: queued old input must not revive.
        faulted=true;generation++;cancelling=active>0;releaseWhenIdle=true;
      }else revoked[requested]=now+310000;
      if(owner==requested){generation++;cancelling=active>0;releaseWhenIdle=active>0;if(active==0){owner="";until=0;}}
      Stopwatch waiting=Stopwatch.StartNew();
      while(owner==requested&&active>0){
        long remaining=waitMs-waiting.ElapsedMilliseconds;if(remaining<=0)return false;
        Monitor.Wait(gate,(int)remaining);
      }
      // Do not wait for a different owner's later step after ours has exited.
      return true;
    }
  }
  internal void Invalidate() {
    lock(gate){generation++;if(active==0){owner="";until=0;}else{cancelling=true;releaseWhenIdle=true;}}
  }
  internal int RevokedCount { get {lock(gate){Prune(Now());return revoked.Count;}} }
}
