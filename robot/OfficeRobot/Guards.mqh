//+------------------------------------------------------------------+
//| Guards.mqh                                                       |
//| FTMO 2-Step rules, enforced by the robot itself:                 |
//|  - Maximum Daily Loss: equity may not fall below the balance at  |
//|    00:00 Prague minus 5% of the initial balance.                 |
//|  - Maximum Loss: equity may not fall below 90% of the initial.   |
//|  - No new trades in the last 2 hours before a market closes for  |
//|    2 hours or more (FTMO calls it gap trading).                  |
//|  - No new trades around high-impact news.                        |
//|  - Stay far below FTMO's 2,000 server requests a day.            |
//| The robot's own stops sit below FTMO's so it stops first.        |
//+------------------------------------------------------------------+
#ifndef OFFICE_GUARDS_MQH
#define OFFICE_GUARDS_MQH

#include "Clock.mqh"

class CFtmoGuards
  {
private:
   string            m_symbol;
   long              m_magic;
   double            m_initial;
   double            m_dayStartBalance;
   datetime          m_dayKey;
   int               m_tradesToday;
   int               m_requestsToday;
   bool              m_dailyStopTripped;
   double            m_ftmoDailyPct;
   double            m_ftmoMaxPct;
   double            m_robotDailyPct;
   double            m_robotMaxPct;
   bool              m_newsFilter;
   int               m_newsBefore;
   int               m_newsAfter;
   int               m_closeBuffer;
   datetime          m_newsCheckedAt;
   string            m_newsReason;
   datetime          m_sessionCheckedAt;
   string            m_sessionReason;

   // The account's first deposit is the FTMO initial balance.
   double            DetectInitialBalance(void)
     {
      if(!HistorySelect(0,TimeCurrent()+86400))
         return 0;
      int total=HistoryDealsTotal();
      for(int i=0;i<total;i++)
        {
         ulong ticket=HistoryDealGetTicket(i);
         if(ticket==0 || HistoryDealGetInteger(ticket,DEAL_TYPE)!=DEAL_TYPE_BALANCE)
            continue;
         double amount=HistoryDealGetDouble(ticket,DEAL_PROFIT);
         if(amount>0)
            return amount;
        }
      return 0;
     }

   // Trading results booked since 00:00 Prague, and how many trades this robot opened.
   double            BookedToday(int &entries)
     {
      entries=0;
      double sum=0;
      if(!HistorySelect(ClockPragueDayStartServer(),TimeTradeServer()+60))
         return 0;
      int total=HistoryDealsTotal();
      for(int i=0;i<total;i++)
        {
         ulong ticket=HistoryDealGetTicket(i);
         if(ticket==0)
            continue;
         long type=HistoryDealGetInteger(ticket,DEAL_TYPE);
         if(type==DEAL_TYPE_BALANCE || type==DEAL_TYPE_CREDIT || type==DEAL_TYPE_BONUS)
            continue;
         sum+=HistoryDealGetDouble(ticket,DEAL_PROFIT)+HistoryDealGetDouble(ticket,DEAL_COMMISSION)
              +HistoryDealGetDouble(ticket,DEAL_SWAP)+HistoryDealGetDouble(ticket,DEAL_FEE);
         if(HistoryDealGetInteger(ticket,DEAL_MAGIC)==m_magic
            && HistoryDealGetInteger(ticket,DEAL_ENTRY)==DEAL_ENTRY_IN)
            entries++;
        }
      return sum;
     }

   string            FindSessionReason(const datetime now)
     {
      MqlDateTime t;
      TimeToStruct(now,t);
      long day0=(long)now-(t.hour*3600+t.min*60+t.sec);

      // Trading sessions for today and the next 7 days, as absolute times.
      datetime starts[],ends[];
      int n=0;
      for(int d=0;d<8;d++)
        {
         ENUM_DAY_OF_WEEK dow=(ENUM_DAY_OF_WEEK)((t.day_of_week+d)%7);
         datetime from,to;
         for(uint s=0;SymbolInfoSessionTrade(m_symbol,dow,s,from,to);s++)
           {
            ArrayResize(starts,n+1);
            ArrayResize(ends,n+1);
            starts[n]=(datetime)(day0+d*86400+(long)from);
            ends[n]=(datetime)(day0+d*86400+(long)to);
            n++;
           }
        }
      if(n==0)
         return "";

      // Sessions that touch (23:59 -> 00:00) are one stretch of trading.
      datetime ms[],me[];
      int m=0;
      for(int i=0;i<n;i++)
        {
         if(m>0 && starts[i]<=me[m-1]+60)
           {
            if(ends[i]>me[m-1])
               me[m-1]=ends[i];
            continue;
           }
         ArrayResize(ms,m+1);
         ArrayResize(me,m+1);
         ms[m]=starts[i];
         me[m]=ends[i];
         m++;
        }

      for(int i=0;i<m;i++)
        {
         if(now<ms[i] || now>=me[i])
            continue;
         long toClose=(long)(me[i]-now);
         long breakLength=(i+1<m) ? (long)(ms[i+1]-me[i]) : 7*86400;
         if(breakLength>=7200 && toClose<=m_closeBuffer*60)
            return StringFormat("market closes for %dh at %s Prague: no new trades in the last %d min",
                                (int)(breakLength/3600),
                                TimeToString(ClockServerToPrague(me[i]),TIME_MINUTES),
                                m_closeBuffer);
         return "";
        }
      return "market closed";
     }

public:
   void              Init(const string symbol,const long magic,const double initialBalance,
                          const double ftmoDailyPct,const double ftmoMaxPct,
                          const double robotDailyPct,const double robotMaxPct,
                          const bool newsFilter,const int newsBefore,const int newsAfter,
                          const int closeBufferMinutes)
     {
      m_symbol=symbol;
      m_magic=magic;
      m_ftmoDailyPct=ftmoDailyPct;
      m_ftmoMaxPct=ftmoMaxPct;
      m_robotDailyPct=robotDailyPct;
      m_robotMaxPct=robotMaxPct;
      m_newsFilter=newsFilter;
      m_newsBefore=newsBefore;
      m_newsAfter=newsAfter;
      m_closeBuffer=closeBufferMinutes;
      m_newsCheckedAt=0;
      m_newsReason="";
      m_sessionCheckedAt=0;
      m_sessionReason="";

      m_initial=initialBalance>0 ? initialBalance : DetectInitialBalance();
      if(m_initial<=0)
         m_initial=AccountInfoDouble(ACCOUNT_BALANCE);
      StartDay();
     }

   // At start-up and at every 00:00 Prague.
   void              StartDay(void)
     {
      m_dayKey=ClockPragueDayStart();
      int entries=0;
      double booked=BookedToday(entries);
      m_dayStartBalance=AccountInfoDouble(ACCOUNT_BALANCE)-booked;
      m_tradesToday=entries;
      m_requestsToday=0;
      m_dailyStopTripped=false;
     }

   bool              IsNewDay(void)            { return ClockPragueDayStart()!=m_dayKey; }

   double            Initial(void)             { return m_initial; }
   double            DayStartBalance(void)     { return m_dayStartBalance; }
   double            FtmoDailyFloor(void)      { return m_dayStartBalance-m_initial*m_ftmoDailyPct/100.0; }
   double            RobotDailyStop(void)      { return m_dayStartBalance-m_initial*m_robotDailyPct/100.0; }
   double            FtmoMaxFloor(void)        { return m_initial*(1.0-m_ftmoMaxPct/100.0); }
   double            RobotMaxStop(void)        { return m_initial*(1.0-m_robotMaxPct/100.0); }

   bool              DailyStopHit(const double equity) { return equity<=RobotDailyStop(); }
   bool              MaxStopHit(const double equity)   { return equity<=RobotMaxStop(); }
   void              TripDailyStop(void)               { m_dailyStopTripped=true; }
   bool              DailyStopTripped(void)            { return m_dailyStopTripped; }

   // How much of FTMO's allowance is used, in percent (100 = account failed).
   double            DailyUsedPct(const double equity)
     {
      double allowance=m_initial*m_ftmoDailyPct/100.0;
      if(allowance<=0)
         return 0;
      return MathMax(0.0,(m_dayStartBalance-equity)/allowance*100.0);
     }

   double            MaxUsedPct(const double equity)
     {
      double allowance=m_initial*m_ftmoMaxPct/100.0;
      if(allowance<=0)
         return 0;
      return MathMax(0.0,(m_initial-equity)/allowance*100.0);
     }

   void              AddRequest(const int count=1) { m_requestsToday+=count; }
   void              AddTrade(void)                { m_tradesToday++; }
   int               TradesToday(void)             { return m_tradesToday; }
   int               RequestsToday(void)           { return m_requestsToday; }

   // "" when the session allows new trades, otherwise the reason it doesn't.
   string            SessionReason(void)
     {
      datetime now=TimeTradeServer();
      if(now-m_sessionCheckedAt<30)
         return m_sessionReason;
      m_sessionCheckedAt=now;
      m_sessionReason=FindSessionReason(now);
      return m_sessionReason;
     }

   // "" when no high-impact news is near for the symbol's currencies.
   string            NewsReason(void)
     {
      if(!m_newsFilter || MQLInfoInteger(MQL_TESTER))
         return "";
      datetime now=TimeTradeServer();
      if(now-m_newsCheckedAt<60)
         return m_newsReason;
      m_newsCheckedAt=now;
      m_newsReason="";

      string currencies[2];
      currencies[0]=SymbolInfoString(m_symbol,SYMBOL_CURRENCY_BASE);
      currencies[1]=SymbolInfoString(m_symbol,SYMBOL_CURRENCY_PROFIT);
      for(int c=0;c<2;c++)
        {
         if(currencies[c]=="" || (c==1 && currencies[1]==currencies[0]))
            continue;
         MqlCalendarValue values[];
         if(!CalendarValueHistory(values,now-m_newsAfter*60,now+m_newsBefore*60,NULL,currencies[c]))
            continue;
         for(int i=0;i<ArraySize(values);i++)
           {
            MqlCalendarEvent ev;
            if(!CalendarEventById(values[i].event_id,ev) || ev.importance!=CALENDAR_IMPORTANCE_HIGH)
               continue;
            m_newsReason=StringFormat("news: %s %s at %s Prague",currencies[c],ev.name,
                                      TimeToString(ClockServerToPrague(values[i].time),TIME_MINUTES));
            return m_newsReason;
           }
        }
      return m_newsReason;
     }
  };

#endif
