//+------------------------------------------------------------------+
//| OfficeRobot.mq5                                                  |
//| Demo robot for the Trading Office.                               |
//|  - Trades a placeholder strategy (EMA cross) until we pick ours. |
//|  - Enforces the FTMO 2-Step rules itself (see Guards.mqh).       |
//|  - Obeys Start / Pause / Done for today / Close everything from  |
//|    the office and confirms every command.                        |
//|  - Always starts paused. Nothing trades until someone presses    |
//|    Start in the office.                                          |
//+------------------------------------------------------------------+
#property copyright   "Trading Office"
#property version     "0.10"
#property description "Trading Office robot: placeholder EMA-cross strategy, FTMO 2-Step guards, controlled from the office."

#include "Clock.mqh"
#include "Json.mqh"
#include "Guards.mqh"
#include "Strategy.mqh"
#include "Trader.mqh"
#include "Link.mqh"

#define ROBOT_VERSION "0.1.0"

enum ENUM_ROBOT_STATE
  {
   STATE_PAUSED=0,
   STATE_ACTIVE=1,
   STATE_DONE_TODAY=2
  };

input group "Office link"
input string          InpOfficeUrl          = "";          // Supabase project URL (https://xxxx.supabase.co)
input string          InpOfficeKey          = "";          // Supabase anon public key
input string          InpRobotToken         = "";          // This robot's token (from create_robot)
input int             InpPollSeconds        = 3;           // Check for commands every N seconds
input int             InpReportSeconds      = 30;          // Send a full report every N seconds

input group "Robot"
input long            InpMagic              = 101;         // Magic number (one per robot)
input bool            InpDemoOnly           = true;        // Refuse to trade on non-demo accounts

input group "Strategy (placeholder: EMA cross)"
input ENUM_TIMEFRAMES InpTimeframe          = PERIOD_M15;  // Timeframe for signals
input int             InpFastEma            = 20;          // Fast EMA period
input int             InpSlowEma            = 50;          // Slow EMA period
input int             InpAtrPeriod          = 14;          // ATR period
input double          InpStopAtr            = 1.5;         // Stop distance = ATR x this
input double          InpTargetR            = 2.0;         // Target distance = stop x this
input bool            InpExitOnOppositeCross= true;        // Close on the opposite cross
input double          InpRiskPercent        = 0.5;         // Risk per trade, % of initial balance
input int             InpMaxTradesPerDay    = 4;           // Max new trades per FTMO day
input int             InpStartHourPrague    = 8;           // No new trades before this hour (Prague)
input int             InpEndHourPrague      = 20;          // No new trades from this hour (Prague)
input int             InpMaxSlippagePoints  = 30;          // Max slippage, points

input group "FTMO 2-Step rules"
input double          InpInitialBalance     = 0;           // Initial balance (0 = first deposit)
input double          InpFtmoDailyLossPct   = 5.0;         // FTMO Maximum Daily Loss, %
input double          InpFtmoMaxLossPct     = 10.0;        // FTMO Maximum Loss, %
input double          InpRobotDailyStopPct  = 4.0;         // Robot stops for the day at this loss, %
input double          InpRobotMaxStopPct    = 8.0;         // Robot stops for good at this loss, %
input bool            InpNewsFilter         = true;        // No new trades around high-impact news
input int             InpNewsMinutesBefore  = 15;          // News window: minutes before
input int             InpNewsMinutesAfter   = 15;          // News window: minutes after
input int             InpCloseBufferMinutes = 120;         // No new trades this close to a 2h+ market close
input int             InpMaxRequestsPerDay  = 200;         // Order budget per day (FTMO flags 2,000+)
input int             InpTesterGmtOffset    = 2;           // Strategy Tester only: server time minus GMT, hours

CFtmoGuards      g_guards;
CEmaCross        g_strategy;
COfficeTrader    g_trader;
COfficeLink      g_link;

ENUM_ROBOT_STATE g_state=STATE_PAUSED;     // robots always start paused
bool             g_maxStopTripped=false;
datetime         g_lastBar=0;
datetime         g_lastPoll=0;
datetime         g_lastReport=0;
bool             g_reportNow=true;
string           g_blocks[];               // why the robot can't open a trade right now
string           g_lastAction="";
long             g_doneIds[];              // commands already carried out

//+------------------------------------------------------------------+
//| Names                                                            |
//+------------------------------------------------------------------+
string StateName(void)
  {
   if(g_state==STATE_ACTIVE)
      return "active";
   if(g_state==STATE_DONE_TODAY)
      return "done_today";
   return "paused";
  }

string StateLabel(void)
  {
   if(g_state==STATE_ACTIVE)
      return "ACTIVE";
   if(g_state==STATE_DONE_TODAY)
      return "DONE FOR TODAY";
   return "PAUSED";
  }

string CommandLabel(const string type)
  {
   if(type=="start")
      return "Start";
   if(type=="pause")
      return "Pause";
   if(type=="done_today")
      return "Done for today";
   if(type=="close_all")
      return "Close everything";
   return type;
  }

string TimeframeName(const ENUM_TIMEFRAMES timeframe)
  {
   return StringSubstr(EnumToString(timeframe),7);
  }

string TradeModeName(void)
  {
   long mode=AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(mode==ACCOUNT_TRADE_MODE_DEMO)
      return "demo";
   if(mode==ACCOUNT_TRADE_MODE_CONTEST)
      return "contest";
   return "real";
  }

string DealReasonName(const long reason)
  {
   if(reason==DEAL_REASON_SL)
      return "stop loss";
   if(reason==DEAL_REASON_TP)
      return "take profit";
   if(reason==DEAL_REASON_EXPERT)
      return "robot";
   if(reason==DEAL_REASON_SO)
      return "stop out";
   if(reason==DEAL_REASON_CLIENT || reason==DEAL_REASON_MOBILE || reason==DEAL_REASON_WEB)
      return "manual";
   return "other";
  }

string DeinitReasonText(const int reason)
  {
   switch(reason)
     {
      case REASON_REMOVE:
         return "removed from the chart";
      case REASON_RECOMPILE:
         return "recompiled";
      case REASON_CHARTCHANGE:
         return "chart symbol or timeframe changed";
      case REASON_CHARTCLOSE:
         return "chart closed";
      case REASON_PARAMETERS:
         return "settings changed";
      case REASON_ACCOUNT:
         return "account changed";
      case REASON_CLOSE:
         return "MetaTrader closed";
     }
   return StringFormat("reason %d",reason);
  }

//+------------------------------------------------------------------+
//| Events: shown on the chart, printed, and sent to the office      |
//+------------------------------------------------------------------+
void Event(const string kind,const string message)
  {
   g_lastAction=TimeToString(ClockPrague(),TIME_MINUTES)+" "+message;
   Print("[Office] ",message);
   g_link.QueueEvent(kind,message);
   g_reportNow=true;
  }

void AddBlock(const string reason)
  {
   int n=ArraySize(g_blocks);
   ArrayResize(g_blocks,n+1);
   g_blocks[n]=reason;
  }

// Everything that stops a new trade right now, in plain words.
void RefreshBlocks(void)
  {
   ArrayResize(g_blocks,0);
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED))
      AddBlock("Algo Trading is switched off in MetaTrader");
   if(InpDemoOnly && AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO)
      AddBlock("not a demo account (this robot is set to demo only)");
   if(g_maxStopTripped)
      AddBlock("max-loss stop reached");
   if(g_guards.DailyStopTripped())
      AddBlock("daily loss stop reached");
   int hour=ClockPragueHour();
   if(hour<InpStartHourPrague || hour>=InpEndHourPrague)
      AddBlock(StringFormat("outside trading hours (%02d:00-%02d:00 Prague)",InpStartHourPrague,InpEndHourPrague));
   if(g_guards.TradesToday()>=InpMaxTradesPerDay)
      AddBlock(StringFormat("already %d trades today",g_guards.TradesToday()));
   if(g_guards.RequestsToday()>=InpMaxRequestsPerDay)
      AddBlock(StringFormat("order budget used (%d requests today)",g_guards.RequestsToday()));
   string session=g_guards.SessionReason();
   if(session!="")
      AddBlock(session);
   string news=g_guards.NewsReason();
   if(news!="")
      AddBlock(news);
  }

//+------------------------------------------------------------------+
//| Trades as JSON for the office                                    |
//+------------------------------------------------------------------+
string DealJson(const ulong ticket)
  {
   string symbol=HistoryDealGetString(ticket,DEAL_SYMBOL);
   int digits=(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);
   long type=HistoryDealGetInteger(ticket,DEAL_TYPE);
   long entry=HistoryDealGetInteger(ticket,DEAL_ENTRY);
   string entryName="out_by";
   if(entry==DEAL_ENTRY_IN)
      entryName="in";
   else
      if(entry==DEAL_ENTRY_OUT)
         entryName="out";
      else
         if(entry==DEAL_ENTRY_INOUT)
            entryName="inout";
   string side=type==DEAL_TYPE_BUY ? "buy" : (type==DEAL_TYPE_SELL ? "sell" : "other");
   return "{"+JKey("ticket")+JInt((long)ticket)
          +","+JKey("position")+JInt(HistoryDealGetInteger(ticket,DEAL_POSITION_ID))
          +","+JKey("time")+JInt((long)ClockServerToUtc((datetime)HistoryDealGetInteger(ticket,DEAL_TIME)))
          +","+JKey("symbol")+JStr(symbol)
          +","+JKey("side")+JStr(side)
          +","+JKey("entry")+JStr(entryName)
          +","+JKey("volume")+JNum(HistoryDealGetDouble(ticket,DEAL_VOLUME),2)
          +","+JKey("price")+JNum(HistoryDealGetDouble(ticket,DEAL_PRICE),digits)
          +","+JKey("profit")+JNum(HistoryDealGetDouble(ticket,DEAL_PROFIT))
          +","+JKey("commission")+JNum(HistoryDealGetDouble(ticket,DEAL_COMMISSION)+HistoryDealGetDouble(ticket,DEAL_FEE))
          +","+JKey("swap")+JNum(HistoryDealGetDouble(ticket,DEAL_SWAP))
          +","+JKey("reason")+JStr(DealReasonName(HistoryDealGetInteger(ticket,DEAL_REASON)))
          +","+JKey("comment")+JStr(HistoryDealGetString(ticket,DEAL_COMMENT))
          +"}";
  }

// The office keeps its own copy of the last week of this robot's trades.
void QueueRecentDeals(void)
  {
   if(!g_link.Enabled())
      return;
   if(!HistorySelect(ClockPragueDayStartServer()-7*86400,TimeTradeServer()+60))
      return;
   int total=HistoryDealsTotal();
   for(int i=0;i<total;i++)
     {
      ulong ticket=HistoryDealGetTicket(i);
      if(ticket>0 && HistoryDealGetInteger(ticket,DEAL_MAGIC)==InpMagic)
         g_link.QueueDeal(DealJson(ticket));
     }
  }

string BuildReport(void)
  {
   double balance=AccountInfoDouble(ACCOUNT_BALANCE);
   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   string blocks="";
   for(int i=0;i<ArraySize(g_blocks);i++)
     {
      if(i>0)
         blocks+=",";
      blocks+=JStr(g_blocks[i]);
     }
   string status="{"
                 +JKey("version")+JStr(ROBOT_VERSION)
                 +","+JKey("strategy")+JStr(g_strategy.Name())
                 +","+JKey("timeframe")+JStr(TimeframeName(InpTimeframe))
                 +","+JKey("risk_pct")+JNum(InpRiskPercent,2)
                 +","+JKey("server")+JStr(AccountInfoString(ACCOUNT_SERVER))
                 +","+JKey("trade_mode")+JStr(TradeModeName())
                 +","+JKey("currency")+JStr(AccountInfoString(ACCOUNT_CURRENCY))
                 +","+JKey("balance")+JNum(balance)
                 +","+JKey("equity")+JNum(equity)
                 +","+JKey("initial")+JNum(g_guards.Initial())
                 +","+JKey("day_start")+JNum(g_guards.DayStartBalance())
                 +","+JKey("day_pnl")+JNum(equity-g_guards.DayStartBalance())
                 +","+JKey("open_pnl")+JNum(g_trader.OpenPnl())
                 +","+JKey("ftmo_daily_floor")+JNum(g_guards.FtmoDailyFloor())
                 +","+JKey("robot_daily_stop")+JNum(g_guards.RobotDailyStop())
                 +","+JKey("daily_used_pct")+JNum(g_guards.DailyUsedPct(equity),1)
                 +","+JKey("ftmo_max_floor")+JNum(g_guards.FtmoMaxFloor())
                 +","+JKey("robot_max_stop")+JNum(g_guards.RobotMaxStop())
                 +","+JKey("max_used_pct")+JNum(g_guards.MaxUsedPct(equity),1)
                 +","+JKey("trades_today")+JInt(g_guards.TradesToday())
                 +","+JKey("requests_today")+JInt(g_guards.RequestsToday())
                 +","+JKey("positions")+g_trader.PositionsJson()
                 +","+JKey("blocks")+"["+blocks+"]"
                 +","+JKey("can_trade")+JBool(g_state==STATE_ACTIVE && ArraySize(g_blocks)==0)
                 +","+JKey("last_action")+JStr(g_lastAction)
                 +","+JKey("link_error")+JStr(g_link.LastError())
                 +","+JKey("prague_time")+JStr(TimeToString(ClockPrague(),TIME_MINUTES))
                 +"}";
   return "{"+JKey("state")+JStr(StateName())
          +","+JKey("account_login")+JInt(AccountInfoInteger(ACCOUNT_LOGIN))
          +","+JKey("symbol")+JStr(_Symbol)
          +","+JKey("magic")+JInt(InpMagic)
          +","+JKey("status")+status
          +","+g_link.QueuedMembers()
          +"}";
  }

//+------------------------------------------------------------------+
//| Commands from the office                                         |
//+------------------------------------------------------------------+
bool AlreadyDone(const long id)
  {
   for(int i=0;i<ArraySize(g_doneIds);i++)
      if(g_doneIds[i]==id)
         return true;
   return false;
  }

void RememberDone(const long id)
  {
   int n=ArraySize(g_doneIds);
   if(n>=50)
     {
      ArrayRemove(g_doneIds,0,1);
      n--;
     }
   ArrayResize(g_doneIds,n+1);
   g_doneIds[n]=id;
  }

bool CloseEverything(string &info)
  {
   int requests=0;
   bool ok=g_trader.CloseAll(info,requests);
   g_guards.AddRequest(requests);
   return ok;
  }

bool Execute(const string type,string &result)
  {
   if(type=="start")
     {
      if(g_maxStopTripped)
        {
         result="refused: the max-loss stop was reached";
         return false;
        }
      if(g_guards.DailyStopTripped())
        {
         result="refused: the daily loss stop was reached, back at 00:00 Prague";
         return false;
        }
      g_state=STATE_ACTIVE;
      result="working";
      return true;
     }
   if(type=="pause")
     {
      g_state=STATE_PAUSED;
      result="paused";
      return true;
     }
   if(type=="done_today")
     {
      g_state=STATE_DONE_TODAY;
      result="done for today, back at 00:00 Prague";
      return true;
     }
   if(type=="close_all")
     {
      string info;
      bool ok=CloseEverything(info);
      g_state=STATE_PAUSED;
      result=ok ? info+", paused" : "paused, but "+info;
      return ok;
     }
   result="unknown command";
   return false;
  }

void HandleCommands(const string list)
  {
   string items[];
   int n=StringSplit(list,';',items);
   for(int i=0;i<n;i++)
     {
      string parts[];
      if(StringSplit(items[i],':',parts)!=2)
         continue;
      long id=StringToInteger(parts[0]);
      string type=parts[1];
      if(AlreadyDone(id))
        {
         g_link.QueueAck(id,"done","already done");
         continue;
        }
      string result;
      bool ok=Execute(type,result);
      RememberDone(id);
      g_link.QueueAck(id,ok ? "done" : "refused",result);
      Event("command",CommandLabel(type)+": "+result);
     }
   g_reportNow=true;
  }

void SyncOnce(const bool withReport)
  {
   string commands;
   bool ok=g_link.Sync(withReport ? BuildReport() : "",commands);
   g_lastPoll=TimeLocal();
   if(!ok)
      return;
   if(withReport)
     {
      g_lastReport=g_lastPoll;
      g_reportNow=false;
     }
   if(commands=="")
      return;
   HandleCommands(commands);
   // Confirm straight away instead of waiting for the next round.
   string more;
   if(g_link.Sync(BuildReport(),more))
     {
      g_lastReport=TimeLocal();
      g_reportNow=false;
      if(more!="")
         HandleCommands(more);
     }
  }

//+------------------------------------------------------------------+
//| FTMO limits: checked every tick and every second                 |
//+------------------------------------------------------------------+
void CheckNewDay(void)
  {
   if(!g_guards.IsNewDay())
      return;
   g_guards.StartDay();
   if(g_state==STATE_DONE_TODAY)
     {
      g_state=STATE_ACTIVE;
      Event("info","New FTMO day: back to work after Done for today");
     }
   g_reportNow=true;
  }

void EnforceLimits(void)
  {
   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   if(!g_maxStopTripped && g_guards.MaxStopHit(equity))
     {
      g_maxStopTripped=true;
      string info;
      CloseEverything(info);
      g_state=STATE_PAUSED;
      Event("guard",StringFormat("Max-loss stop: equity %.2f reached %.2f (FTMO fails the account at %.2f). %s. Paused for good.",
                                 equity,g_guards.RobotMaxStop(),g_guards.FtmoMaxFloor(),info));
      return;
     }
   if(!g_guards.DailyStopTripped() && g_guards.DailyStopHit(equity))
     {
      g_guards.TripDailyStop();
      string info;
      CloseEverything(info);
      if(g_state==STATE_ACTIVE)
         g_state=STATE_DONE_TODAY;
      Event("guard",StringFormat("Daily loss stop: equity %.2f reached %.2f (FTMO's daily limit is %.2f). %s. Stopped until 00:00 Prague.",
                                 equity,g_guards.RobotDailyStop(),g_guards.FtmoDailyFloor(),info));
     }
  }

//+------------------------------------------------------------------+
//| Strategy: once per closed bar                                    |
//+------------------------------------------------------------------+
void OnNewBar(void)
  {
   ENUM_SIGNAL signal=g_strategy.Signal();
   int direction=g_trader.Direction();

   // Exits work in every state: open trades always finish normally.
   if(direction!=0 && InpExitOnOppositeCross && signal!=SIGNAL_NONE && (int)signal==-direction)
     {
      string info;
      CloseEverything(info);
      Event("trade","Opposite cross: "+info);
      direction=g_trader.Direction();
     }

   if(signal==SIGNAL_NONE || direction!=0)
      return;
   RefreshBlocks();
   if(g_state!=STATE_ACTIVE || ArraySize(g_blocks)>0)
      return;

   double atr=g_strategy.Atr();
   if(atr<=0)
      return;
   double risk=g_guards.Initial()*InpRiskPercent/100.0;
   string info;
   bool sent=false;
   bool opened=g_trader.Open((int)signal,atr*InpStopAtr,InpTargetR,risk,"office "+ROBOT_VERSION,info,sent);
   if(sent)
      g_guards.AddRequest();
   if(opened)
     {
      g_guards.AddTrade();
      Event("trade","Opened "+info);
     }
   else
      Event(sent ? "error" : "trade","Skipped a signal: "+info);
  }

//+------------------------------------------------------------------+
//| On the chart, for whoever looks at MetaTrader                    |
//+------------------------------------------------------------------+
void ShowOnChart(void)
  {
   string link="office link: not configured";
   if(g_link.Enabled())
      link=g_link.LastError()=="" ? "office link: ok" : "office link: "+g_link.LastError();
   string blocks="none";
   for(int i=0;i<ArraySize(g_blocks);i++)
      blocks=(i==0 ? "" : blocks+"; ")+g_blocks[i];
   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   double today=equity-g_guards.DayStartBalance();
   Comment(StringFormat("Trading Office robot %s  |  %s  |  %s\n"
                        "%s on %s %s, risk %.2f%% per trade\n"
                        "Equity %.2f  |  today %s%.2f  |  FTMO daily limit used %.0f%%, max loss used %.0f%%\n"
                        "No new trades because: %s\n"
                        "Last: %s",
                        ROBOT_VERSION,StateLabel(),link,
                        g_strategy.Name(),_Symbol,TimeframeName(InpTimeframe),InpRiskPercent,
                        equity,today>=0 ? "+" : "",today,g_guards.DailyUsedPct(equity),g_guards.MaxUsedPct(equity),
                        blocks,g_lastAction));
  }

//+------------------------------------------------------------------+
//| MetaTrader events                                                |
//+------------------------------------------------------------------+
int OnInit(void)
  {
   if(InpRobotDailyStopPct>=InpFtmoDailyLossPct || InpRobotMaxStopPct>=InpFtmoMaxLossPct)
     {
      Print("[Office] The robot's stops must be tighter than FTMO's limits.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(InpFastEma>=InpSlowEma || InpRiskPercent<=0 || InpStopAtr<=0 || InpTargetR<=0)
     {
      Print("[Office] Check the strategy settings.");
      return INIT_PARAMETERS_INCORRECT;
     }

   ClockInit(InpTesterGmtOffset);
   g_guards.Init(_Symbol,InpMagic,InpInitialBalance,InpFtmoDailyLossPct,InpFtmoMaxLossPct,
                 InpRobotDailyStopPct,InpRobotMaxStopPct,InpNewsFilter,InpNewsMinutesBefore,
                 InpNewsMinutesAfter,InpCloseBufferMinutes);
   if(!g_strategy.Init(_Symbol,InpTimeframe,InpFastEma,InpSlowEma,InpAtrPeriod))
     {
      Print("[Office] Could not create the strategy's indicators.");
      return INIT_FAILED;
     }
   g_trader.Init(_Symbol,InpMagic,InpMaxSlippagePoints);
   g_link.Init(InpOfficeUrl,InpOfficeKey,InpRobotToken);

   g_state=STATE_PAUSED;
   if(MQLInfoInteger(MQL_TESTER))
      g_state=STATE_ACTIVE;                    // no office in the Strategy Tester
   if(g_guards.MaxStopHit(AccountInfoDouble(ACCOUNT_EQUITY)))
     {
      g_maxStopTripped=true;
      g_state=STATE_PAUSED;
     }

   QueueRecentDeals();
   Event("started",StringFormat("Started %s on %s %s, account %s (%s). Paused until you press Start.",
                                ROBOT_VERSION,_Symbol,TimeframeName(InpTimeframe),
                                IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)),TradeModeName()));
   if(!g_link.Enabled() && !MQLInfoInteger(MQL_TESTER))
      Print("[Office] The office link is not configured, so this robot can't receive Start and stays paused.");

   RefreshBlocks();
   ShowOnChart();
   EventSetTimer(1);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   Event("stopped","Stopped: "+DeinitReasonText(reason));
   string commands;
   g_link.Sync(BuildReport(),commands,2000);   // best effort
   g_strategy.Deinit();
   Comment("");
  }

void OnTick(void)
  {
   CheckNewDay();
   EnforceLimits();
   datetime bar=iTime(_Symbol,InpTimeframe,0);
   if(bar==0 || bar==g_lastBar)
      return;
   bool first=(g_lastBar==0);
   g_lastBar=bar;
   if(!first)                                  // never act on a bar that was already open at start-up
      OnNewBar();
  }

void OnTimer(void)
  {
   CheckNewDay();
   EnforceLimits();
   RefreshBlocks();
   ShowOnChart();
   if(!g_link.Enabled() || !g_link.ReadyToTry())
      return;
   datetime now=TimeLocal();
   bool reportDue=g_reportNow || g_link.HasQueued() || now-g_lastReport>=InpReportSeconds;
   if(!reportDue && now-g_lastPoll<InpPollSeconds)
      return;
   SyncOnce(reportDue);
  }

void OnTradeTransaction(const MqlTradeTransaction &trans,const MqlTradeRequest &request,const MqlTradeResult &result)
  {
   if(trans.type!=TRADE_TRANSACTION_DEAL_ADD || !HistoryDealSelect(trans.deal))
      return;
   if(HistoryDealGetInteger(trans.deal,DEAL_MAGIC)!=InpMagic)
      return;
   g_link.QueueDeal(DealJson(trans.deal));
   long entry=HistoryDealGetInteger(trans.deal,DEAL_ENTRY);
   if(entry==DEAL_ENTRY_OUT || entry==DEAL_ENTRY_OUT_BY)
     {
      double pnl=HistoryDealGetDouble(trans.deal,DEAL_PROFIT)+HistoryDealGetDouble(trans.deal,DEAL_COMMISSION)
                 +HistoryDealGetDouble(trans.deal,DEAL_SWAP)+HistoryDealGetDouble(trans.deal,DEAL_FEE);
      Event("trade",StringFormat("Closed by %s: %s%.2f",DealReasonName(HistoryDealGetInteger(trans.deal,DEAL_REASON)),
                                 pnl>=0 ? "+" : "",pnl));
     }
   g_reportNow=true;
  }
//+------------------------------------------------------------------+
