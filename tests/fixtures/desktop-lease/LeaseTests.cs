using System;
using System.Threading;
using System.Threading.Tasks;

class LeaseTests {
  static int passed;
  static void Require(bool value,string message){if(!value)throw new Exception(message);}
  static void Refused(Action work,string code){try{work();}catch(InvalidOperationException e){Require(e.Message==code,"Unexpected refusal: "+e.Message);return;}throw new Exception("Expected refusal: "+code);}
  static void Case(string name,Action work){work();passed++;Console.WriteLine("passed: "+name);}
  static void Main(){
    Case("idle owner TTL and same-owner continuity",delegate{
      long now=0;DesktopLease lease=new DesktopLease(delegate{return now;},10,15000);
      DesktopLease.Ticket first=lease.Enter("agent-a");lease.Check(first);lease.Exit(first);
      now=14999;Refused(delegate{lease.Enter("agent-b");},"DESKTOP_BUSY");
      DesktopLease.Ticket again=lease.Enter("agent-a");lease.Exit(again);
      now=30000;DesktopLease.Ticket other=lease.Enter("agent-b");lease.Exit(other);
      Refused(delegate{lease.Check(first);},"DESKTOP_CANCELLED");
    });
    Case("active owner does not yield on expired TTL",delegate{
      long now=0;DesktopLease lease=new DesktopLease(delegate{return now;},10,15000);DesktopLease.Ticket active=lease.Enter("agent-a");
      now=16000;Refused(delegate{lease.Enter("agent-b");},"DESKTOP_BUSY");
      Require(!lease.Cancel("agent-a",0),"Cancellation request is not confirmed before the active step exits");
      Refused(delegate{lease.Check(active);},"DESKTOP_CANCELLED");lease.Exit(active);
      DesktopLease.Ticket next=lease.Enter("agent-b");lease.Exit(next);
      Refused(delegate{lease.Enter("agent-a");},"DESKTOP_CANCELLED");
    });
    Case("cancelling another owner does not fence the active owner",delegate{
      DesktopLease lease=new DesktopLease(delegate{return 0L;},10,15000);DesktopLease.Ticket active=lease.Enter("agent-a");
      Require(lease.Cancel("other-agent",0),"No action from the other owner is running");lease.Check(active);lease.Exit(active);
      Refused(delegate{lease.Enter("other-agent");},"DESKTOP_CANCELLED");
    });
    Case("cancellation before dispatch blocks the queued old packet",delegate{
      DesktopLease lease=new DesktopLease(delegate{return 0L;},10,15000);Require(lease.Cancel("old-packet",0),"Pre-dispatch cancellation must be confirmed");
      Refused(delegate{lease.Enter("old-packet");},"DESKTOP_CANCELLED");
    });
    Case("confirmed stop waits for own exit, never for the next owner",delegate{
      DesktopLease lease=new DesktopLease(delegate{return 0L;},10,15000);DesktopLease.Ticket active=lease.Enter("agent-a");
      Task<bool> cancel=Task.Factory.StartNew(delegate{return lease.Cancel("agent-a",1000);});
      DateTime end=DateTime.UtcNow.AddSeconds(1);bool fenced=false;
      while(DateTime.UtcNow<end){try{lease.Check(active);}catch(InvalidOperationException e){fenced=e.Message=="DESKTOP_CANCELLED";break;}Thread.Sleep(1);}
      Require(fenced,"Cancellation must fence input before waiting for completion");Require(!cancel.IsCompleted,"Cannot confirm a still-active step");
      lease.Exit(active);DesktopLease.Ticket next=lease.Enter("agent-b");
      try{Require(cancel.Wait(1000)&&cancel.Result,"Own stop must be confirmed while the next owner is still active");lease.Check(next);}finally{lease.Exit(next);}
    });
    Case("capacity exhaustion fails closed instead of evicting a live tombstone",delegate{
      long now=0;DesktopLease lease=new DesktopLease(delegate{return now;},1,15000);
      lease.Cancel("cancelled-a",0);lease.Cancel("cancelled-b",0);Require(lease.RevokedCount==1,"Revocation memory must stay bounded");
      Refused(delegate{lease.Enter("new-owner");},"DESKTOP_LEASE_LIMIT");now=400000;
      Require(lease.RevokedCount==0,"Expired tombstones may be collected");Refused(delegate{lease.Enter("new-owner");},"DESKTOP_LEASE_LIMIT");
    });
    Case("normal expired tombstones are pruned",delegate{
      long now=0;DesktopLease lease=new DesktopLease(delegate{return now;},2,15000);lease.Cancel("expired",0);now=310001;
      Require(lease.RevokedCount==0,"Expired entry retained");DesktopLease.Ticket ticket=lease.Enter("fresh-authorized-owner");lease.Exit(ticket);
    });
    Case("operator invalidation stops active input and allows a fresh capture later",delegate{
      DesktopLease lease=new DesktopLease(delegate{return 0L;},10,15000);DesktopLease.Ticket active=lease.Enter("agent-a");lease.Invalidate();
      Refused(delegate{lease.Check(active);},"DESKTOP_CANCELLED");Refused(delegate{lease.Enter("agent-b");},"DESKTOP_BUSY");lease.Exit(active);
      DesktopLease.Ticket fresh=lease.Enter("agent-a");lease.Check(fresh);lease.Exit(fresh);
    });
    Case("step deadline and double-exit cannot release a different active owner",delegate{
      long now=0;DesktopLease lease=new DesktopLease(delegate{return now;},10,15000);DesktopLease.Ticket first=lease.Enter("agent-a");now=15000;
      Refused(delegate{lease.Check(first);},"DESKTOP_DEADLINE");lease.Exit(first);DesktopLease.Ticket second=lease.Enter("agent-b");
      Refused(delegate{lease.Exit(first);},"DESKTOP_LEASE_STATE");lease.Check(second);lease.Exit(second);
    });
    Case("invalid identity and regressing clock fail closed",delegate{
      long now=100;DesktopLease lease=new DesktopLease(delegate{return now;},10,15000);Refused(delegate{lease.Enter("");},"DESKTOP_OWNER_REQUIRED");
      DesktopLease.Ticket active=lease.Enter("agent-a");now=99;Refused(delegate{lease.Check(active);},"DESKTOP_CLOCK_UNAVAILABLE");lease.Exit(active);
    });
    Case("renew keeps a held session ticket alive and still fences other owners",delegate{
      long now=0;DesktopLease lease=new DesktopLease(delegate{return now;},10,15000);DesktopLease.Ticket session=lease.Enter("session-owner");
      now=14000;lease.Check(session);now=15000;Refused(delegate{lease.Check(session);},"DESKTOP_DEADLINE");
      lease.Renew(session,15000);Refused(delegate{lease.Enter("model-bot");},"DESKTOP_BUSY");
      now=29000;lease.Check(session);lease.Exit(session);Refused(delegate{lease.Renew(session,15000);},"DESKTOP_CANCELLED");
      now=30000;DesktopLease.Ticket next=lease.Enter("model-bot");lease.Check(next);lease.Exit(next);
    });
    Case("renew after invalidation or cancel stops the session",delegate{
      DesktopLease lease=new DesktopLease(delegate{return 0L;},10,15000);DesktopLease.Ticket session=lease.Enter("session-owner");lease.Invalidate();
      Refused(delegate{lease.Renew(session,15000);},"DESKTOP_CANCELLED");lease.Exit(session);
      DesktopLease.Ticket second=lease.Enter("session-owner");lease.Cancel("session-owner",0);lease.Exit(second);
      Refused(delegate{lease.Renew(second,15000);},"DESKTOP_CANCELLED");
    });
    Case("human takeover fences the active Bot before waiting and releases immediately",delegate{
      DesktopLease lease=new DesktopLease(delegate{return 0L;},10,15000);DesktopLease.Ticket bot=lease.Enter("bot");
      Task<DesktopLease.Ticket> acquire=Task.Factory.StartNew(delegate{return lease.Takeover("human",1000);});
      DateTime end=DateTime.UtcNow.AddSeconds(1);bool fenced=false;
      while(DateTime.UtcNow<end){try{lease.Check(bot);}catch(InvalidOperationException e){fenced=e.Message=="DESKTOP_CANCELLED";break;}Thread.Sleep(1);}
      Require(fenced&&!acquire.IsCompleted,"Control cannot be acknowledged before the Bot exits");Refused(delegate{lease.Enter("queued-bot");},"DESKTOP_BUSY");
      lease.Exit(bot);Require(acquire.Wait(1000),"Control did not acquire after Bot cleanup");DesktopLease.Ticket human=acquire.Result;lease.Check(human);
      Refused(delegate{lease.Enter("bot");},"DESKTOP_BUSY");Refused(delegate{lease.Takeover("other-human",0);},"DESKTOP_BUSY");lease.Exit(human);
      DesktopLease.Ticket resumed=lease.Enter("bot");lease.Check(resumed);Require(resumed.Generation!=bot.Generation,"Old screenshots must not survive takeover");lease.Exit(resumed);
    });
    Case("human takeover preempts an idle Bot lease without its fifteen-second delay",delegate{
      DesktopLease lease=new DesktopLease(delegate{return 0L;},10,15000);DesktopLease.Ticket bot=lease.Enter("bot");lease.Exit(bot);
      DesktopLease.Ticket human=lease.Takeover("human",0);lease.Check(human);lease.Renew(human,15000);lease.Exit(human);
      DesktopLease.Ticket other=lease.Enter("other-bot");lease.Check(other);lease.Exit(other);
    });
    Case("timed-out takeover never reports control while the old input is running",delegate{
      DesktopLease lease=new DesktopLease(delegate{return 0L;},10,15000);DesktopLease.Ticket bot=lease.Enter("bot");
      Refused(delegate{lease.Takeover("human",0);},"DESKTOP_TAKEOVER_PENDING");Refused(delegate{lease.Check(bot);},"DESKTOP_CANCELLED");Refused(delegate{lease.Enter("later");},"DESKTOP_BUSY");
      lease.Exit(bot);DesktopLease.Ticket later=lease.Enter("later");lease.Check(later);lease.Exit(later);
    });
    Console.WriteLine("{\"passed\":"+passed+"}");
  }
}
