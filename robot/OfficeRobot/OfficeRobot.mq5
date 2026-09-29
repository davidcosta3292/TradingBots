//+------------------------------------------------------------------+
//| OfficeRobot.mq5                                                  |
//| Demo robot for the Trading Office.                               |
//|  - Draft XAUUSD plan: H4-led trend, M15 structure/pullback.      |
//|  - Enforces the FTMO 2-Step rules itself (see Guards.mqh).       |
//|  - Obeys Start / Pause / Done for today / Close everything from  |
//|    the office and confirms every command.                        |
//|  - Always starts paused. Nothing trades until someone presses    |
//|    Start in the office.                                          |
//+------------------------------------------------------------------+
#property copyright   "Trading Office"
#property version     "1.22"
#property description "Trading Office robot: XAUUSD plan draft, demo only, FTMO guards, office controls."

#include "Clock.mqh"
#include "Json.mqh"
#include "Guards.mqh"
#include "Strategy.mqh"
#include "Trader.mqh"
#include "Link.mqh"

#define ROBOT_VERSION "1.2.2"
// Our office. Used whenever the URL or key input is left empty.
#define OFFICE_URL    "https://tpmrowyqsayyypkxkvfz.supabase.co"
#define OFFICE_KEY    "sb_publishable_wsTQsr8pwa9lJP8I2QEv9g_gbmj_gvM"

enum ENUM_ROBOT_STATE
  {
   STATE_PAUSED=0,
   STATE_ACTIVE=1,
   STATE_DONE_TODAY=2
  };

input group "Office link"
input string          InpOfficeUrl          = OFFICE_URL;  // Supabase project URL (empty = our office)
input string          InpOfficeKey          = OFFICE_KEY;  // Supabase publishable key (empty = our office)
input string          InpRobotToken         = "";          // This robot's token (from create_robot)
input int             InpPollSeconds        = 3;           // Check for commands every N seconds
input int             InpReportSeconds      = 30;          // Send a full report every N seconds

input group "Robot"
input long            InpMagic              = 101;         // Magic number (one per robot)

input group "XAUUSD strategy draft (demo only)"
input double          InpTargetR            = 3.0;         // Broker target at 3 times initial risk
input double          InpRiskPercent        = 0.10;        // Full setup: % of initial balance; half if one trend conflicts
input double          InpMaxLots            = 1.0;         // Never exceed this size
input int             InpMaxTradesPerDay    = 5;           // Maximum filled entries per Prague day
input int             InpMaxHoldHours       = 6;           // Time exit if stop or target has not fired
input int             InpLossCooldownMinutes= 30;          // No new entry after one losing position
input int             InpStartHourNewYork   = 8;           // No new entries before this NY hour
input int             InpEndHourNewYork     = 13;          // No new entries from this NY hour
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
CPlanStrategy    g_strategy;
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
string           g_lastNewsReason="";
string           g_lastUpcomingNews="";
int              g_holdCloseFailures=0;
datetime         g_lastHoldAttempt=0;
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

// Inputs pasted with stray spaces or quotes still work.
string Cleaned(string value)
  {
   StringTrimLeft(value);
   StringTrimRight(value);
   while(StringLen(value)>0 && (StringGetCharacter(value,0)=='"' || StringGetCharacter(value,0)=='\''))
      value=StringSubstr(value,1);
   while(StringLen(value)>0 && (StringGetCharacter(value,StringLen(value)-1)=='"' || StringGetCharacter(value,StringLen(value)-1)=='\''))
      value=StringSubstr(value,0,StringLen(value)-1);
   return value;
  }

string OrDefault(const string value,const string fallback)
  {
   string cleaned=Cleaned(value);
   return cleaned=="" ? fallback : cleaned;
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
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO)
      AddBlock("not a demo account (this version cannot trade live)");
   string symbolName=_Symbol;
   StringToUpper(symbolName);
   bool goldDollarName=StringFind(symbolName,"XAUUSD")==0;
   bool goldDollarMetadata=SymbolInfoString(_Symbol,SYMBOL_CURRENCY_BASE)=="XAU"
                           && SymbolInfoString(_Symbol,SYMBOL_CURRENCY_PROFIT)=="USD";
   if(!goldDollarName && !goldDollarMetadata)
      AddBlock("this strategy only trades gold quoted in USD (XAUUSD)");
   if(g_maxStopTripped)
      AddBlock("max-loss stop reached");
   if(g_guards.DailyStopTripped())
      AddBlock("daily loss stop reached");
   MqlDateTime ny;
   TimeToStruct(ClockNewYork(),ny);
   if(ny.hour<InpStartHourNewYork || ny.hour>=InpEndHourNewYork
      || ny.hour==9 || ny.hour==11)
      AddBlock("outside entry windows (08:00-09:00, 10:00-11:00, 12:00-13:00 New York)");
   if(g_guards.TradesToday()>=InpMaxTradesPerDay)
      AddBlock(StringFormat("already %d trades today",g_guards.TradesToday()));
   string loss=g_guards.LossReason(InpLossCooldownMinutes);
   if(loss!="")
      AddBlock(loss);
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
      if(ticket>0 && HistoryDealGetInteger(ticket,DEAL_MAGIC)==InpMagic
         && HistoryDealGetString(ticket,DEAL_SYMBOL)==_Symbol)
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
                 +","+JKey("exercise_mode")+JBool(false)
                 +","+JKey("timeframe")+JStr("M15")
                 +","+JKey("risk_pct")+JNum(InpRiskPercent,2)
                 +","+JKey("max_lots")+JNum(InpMaxLots,2)
                 +","+JKey("target_r")+JNum(InpTargetR,1)
                 +","+JKey("max_hold_hours")+JInt(InpMaxHoldHours)
                 +","+JKey("trends")+JStr(g_strategy.Trends())
                 +","+JKey("signal_check")+JStr(g_strategy.Check())
                 +","+JKey("loss_streak")+JInt(g_guards.ConsecutiveLosses())
                 +","+JKey("new_york_time")+JStr(TimeToString(ClockNewYork(),TIME_MINUTES))
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
                 +","+JKey("upcoming_news")+JStr(g_guards.UpcomingNews())
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
         result="the max-loss stop was reached";
         return false;
        }
      if(g_guards.DailyStopTripped())
        {
         result="the daily loss stop was reached, back at 00:00 Prague";
         return false;
        }
      if(AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO)
        {
         result="this strategy version only runs on a demo account";
         return false;
        }
      if(g_guards.ConsecutiveLosses()>=2)
        {
         result="two consecutive losing trades today, back at 00:00 Prague";
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
      Event("command",CommandLabel(type)+(ok ? ": " : " refused: ")+result);
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

void EnforceLossStreak(void)
  {
   if(g_state==STATE_ACTIVE && g_guards.ConsecutiveLosses()>=2)
     {
      g_state=STATE_DONE_TODAY;
      Event("guard","Two consecutive net-losing positions: done for today, back at 00:00 Prague.");
     }
  }

// Stop/target live at the broker. This time exit is additional and needs MT5
// to be running. Retry at most once a minute; pause after three failures.
void EnforceHoldTime(void)
  {
   datetime opened=g_trader.OldestOpenTime();
   if(opened==0)
     {
      g_holdCloseFailures=0;
      return;
     }
   if(TimeTradeServer()-opened<InpMaxHoldHours*3600 || g_holdCloseFailures>=3
      || (g_lastHoldAttempt>0 && TimeTradeServer()-g_lastHoldAttempt<60))
      return;
   g_lastHoldAttempt=TimeTradeServer();
   string info;
   bool closed=CloseEverything(info);
   if(!closed)
      g_holdCloseFailures++;
   Event(closed ? "info" : "error","Six-hour plan exit: "+info);
   if(g_holdCloseFailures>=3)
     {
      g_state=STATE_PAUSED;
      Event("error","Time exit failed three times. Paused; broker stop/target remain. Inspect MetaTrader or use Close everything.");
     }
  }

// The calendar is the first news watcher. It alerts the office/Telegram once
// when a high-impact event approaches, once when entry is blocked, and when
// the block clears. A separate news agent can use the same event channel later.
void WatchNews(void)
  {
   if(!InpNewsFilter || MQLInfoInteger(MQL_TESTER))
      return;
   string reason=g_guards.NewsReason();
   string upcoming=g_guards.UpcomingNews();
   if(upcoming!="" && upcoming!=g_lastUpcomingNews && StringFind(reason,"news:")!=0)
      Event("info","News watch: high-impact "+upcoming+" within the next hour. New trades pause 15 minutes before and after.");
   if(reason!=g_lastNewsReason)
     {
      if(StringFind(reason,"news:")==0)
         Event("info","News pause: "+reason+". No new trades until the window ends.");
      else if(StringFind(reason,"news calendar unavailable")==0)
         Event("error",reason);
      else if(reason=="" && g_lastNewsReason!="")
         Event("info","News watch clear: calendar checked and new trades may resume when other rules allow.");
     }
   g_lastNewsReason=reason;
   g_lastUpcomingNews=upcoming;
  }

//+------------------------------------------------------------------+
//| Strategy: once per closed bar                                    |
//+------------------------------------------------------------------+
void OnNewBar(void)
  {
   double stopPrice=0,riskFactor=0,atr=0;
   ENUM_SIGNAL signal=g_strategy.Evaluate(stopPrice,riskFactor,atr);
   g_reportNow=true;                           // show current trend/signal check in office
   if(signal==SIGNAL_NONE || g_trader.Direction()!=0 || g_trader.HasPending())
      return;
   RefreshBlocks();
   if(g_state!=STATE_ACTIVE || ArraySize(g_blocks)>0)
      return;

   if(atr<=0 || riskFactor<=0)
      return;
   double risk=g_guards.Initial()*InpRiskPercent/100.0*riskFactor;
   string info;
   bool sent=false;
   bool opened=g_trader.Open((int)signal,stopPrice,4.0*atr,InpTargetR,risk,
                             InpMaxLots,"XAU plan "+ROBOT_VERSION,info,sent);
   if(sent)
      g_guards.AddRequest();
   if(opened)
     {
      // Only the broker's DEAL_ENTRY_IN confirms a fill. The transaction
      // callback below counts it and sends the Telegram trade notification.
      Print("[Office] Entry order accepted: ",info,". Waiting for the fill.");
     }
   else
      Event(sent ? "error" : "info","Skipped a plan signal: "+info);
  }

//+------------------------------------------------------------------+
//| On the chart, for whoever looks at MetaTrader                    |
//+------------------------------------------------------------------+
void ShowOnChart(void)
  {
   string link=g_link.LastError()=="" ? "office link: ok" : "office link: "+g_link.LastError();
   string blocks="none";
   for(int i=0;i<ArraySize(g_blocks);i++)
      blocks=(i==0 ? "" : blocks+"; ")+g_blocks[i];
   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   double today=equity-g_guards.DayStartBalance();
   Comment(StringFormat("Trading Office robot %s  |  %s  |  %s\n"
                        "%s on %s %s, risk %.2f%% per trade\n"
                        "%s | %s\n"
                        "Equity %.2f  |  today %s%.2f  |  FTMO daily limit used %.0f%%, max loss used %.0f%%\n"
                        "No new trades because: %s\n"
                        "Last: %s",
                        ROBOT_VERSION,StateLabel(),link,
                        g_strategy.Name(),_Symbol,"M15",InpRiskPercent,
                        g_strategy.Trends(),g_strategy.Check(),
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
   if(InpRiskPercent<=0 || InpRiskPercent>0.10 || InpTargetR<2.0 || InpTargetR>4.0
      || InpMaxLots<=0 || InpMaxLots>1.0 || InpMaxTradesPerDay<1
      || InpMaxTradesPerDay>5 || InpMaxHoldHours<1 || InpMaxHoldHours>6
      || InpLossCooldownMinutes<20 || InpLossCooldownMinutes>30
      || InpStartHourNewYork<0 || InpEndHourNewYork>24
      || InpStartHourNewYork>=InpEndHourNewYork)
     {
      Print("[Office] Check the XAUUSD demo strategy settings.");
      return INIT_PARAMETERS_INCORRECT;
     }

   ClockInit(InpTesterGmtOffset);
   g_guards.Init(_Symbol,InpMagic,InpInitialBalance,InpFtmoDailyLossPct,InpFtmoMaxLossPct,
                 InpRobotDailyStopPct,InpRobotMaxStopPct,InpNewsFilter,InpNewsMinutesBefore,
                 InpNewsMinutesAfter,InpCloseBufferMinutes);
   if(!g_strategy.Init(_Symbol))
     {
      Print("[Office] Could not create the strategy's indicators.");
      return INIT_FAILED;
     }
   g_trader.Init(_Symbol,InpMagic,InpMaxSlippagePoints);
   g_link.Init(OrDefault(InpOfficeUrl,OFFICE_URL),OrDefault(InpOfficeKey,OFFICE_KEY),Cleaned(InpRobotToken));

   g_state=STATE_PAUSED;
   if(MQLInfoInteger(MQL_TESTER))
      g_state=STATE_ACTIVE;                    // no office in the Strategy Tester
   if(g_guards.MaxStopHit(AccountInfoDouble(ACCOUNT_EQUITY)))
     {
      g_maxStopTripped=true;
      g_state=STATE_PAUSED;
     }

   QueueRecentDeals();
   Event("started",StringFormat("Started %s on %s %s, account %s (%s), %s. Paused until you press Start.",
                                ROBOT_VERSION,_Symbol,"M15",
                                IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)),TradeModeName(),
                                "XAUUSD plan draft"));
   if(!g_link.Enabled() && !MQLInfoInteger(MQL_TESTER))
      Print("[Office] Office link off (",g_link.LastError(),"), so this robot can't receive Start and stays paused.");

   RefreshBlocks();
   WatchNews();
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
   datetime bar=iTime(_Symbol,PERIOD_M15,0);
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
   EnforceHoldTime();
   EnforceLossStreak();
   RefreshBlocks();
   WatchNews();
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
   if(HistoryDealGetInteger(trans.deal,DEAL_MAGIC)!=InpMagic
      || HistoryDealGetString(trans.deal,DEAL_SYMBOL)!=_Symbol)
      return;
   g_link.QueueDeal(DealJson(trans.deal));
   g_guards.InvalidateLosses();
   long entry=HistoryDealGetInteger(trans.deal,DEAL_ENTRY);
   if(entry==DEAL_ENTRY_IN)
     {
      if(StringFind(HistoryDealGetString(trans.deal,DEAL_COMMENT),"demo exercise ")!=0)
         g_guards.AddTrade();
      int digits=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
      string side=HistoryDealGetInteger(trans.deal,DEAL_TYPE)==DEAL_TYPE_BUY ? "BUY" : "SELL";
      Event("trade",StringFormat("Opened %s %s lots %s at %s (broker fill)",
                                 side,
                                 DoubleToString(HistoryDealGetDouble(trans.deal,DEAL_VOLUME),2),
                                 _Symbol,
                                 DoubleToString(HistoryDealGetDouble(trans.deal,DEAL_PRICE),digits)));
     }
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
