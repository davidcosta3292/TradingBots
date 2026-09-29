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
   string            m_upcomingNews;
   datetime          m_sessionCheckedAt;
   string            m_sessionReason;
   datetime          m_lossCheckedAt;
   datetime          m_lastLossAt;
   int               m_lossStreak;
   bool              m_lossHistoryOk;

   // Rebuild closed-position outcomes from broker history, including entry
   // commission. Partial exits only count after the position is fully closed.
   // The retired three-minute exercise has a distinct entry comment and must
   // not become this plan's losing streak on the day we change strategies.
   void              RefreshLosses(void)
     {
      datetime now=TimeTradeServer();
      if(m_lossCheckedAt>0 && now-m_lossCheckedAt<15)
         return;
      m_lossCheckedAt=now;
      m_lastLossAt=0;
      m_lossStreak=0;
      datetime dayStart=ClockPragueDayStartServer();
      m_lossHistoryOk=HistorySelect(dayStart-7*86400,now+60);
      if(!m_lossHistoryOk)
         return;
      long ids[];
      double net[];
      datetime closedAt[];
      bool exercise[];
      int n=0;
      int total=HistoryDealsTotal();
      for(int i=0;i<total;i++)
        {
         ulong ticket=HistoryDealGetTicket(i);
         if(ticket==0 || HistoryDealGetInteger(ticket,DEAL_MAGIC)!=m_magic
            || HistoryDealGetString(ticket,DEAL_SYMBOL)!=m_symbol)
            continue;
         long entry=HistoryDealGetInteger(ticket,DEAL_ENTRY);
         if(entry!=DEAL_ENTRY_IN && entry!=DEAL_ENTRY_OUT
            && entry!=DEAL_ENTRY_OUT_BY && entry!=DEAL_ENTRY_INOUT)
            continue;
         long id=HistoryDealGetInteger(ticket,DEAL_POSITION_ID);
         if(id<=0)
            continue;
         int found=-1;
         for(int j=0;j<n;j++)
            if(ids[j]==id)
              {
               found=j;
               break;
              }
         if(found<0)
           {
            found=n++;
            ArrayResize(ids,n);
            ArrayResize(net,n);
            ArrayResize(closedAt,n);
            ArrayResize(exercise,n);
            ids[found]=id;
            net[found]=0;
            closedAt[found]=0;
            exercise[found]=false;
           }
         if(entry==DEAL_ENTRY_IN
            && StringFind(HistoryDealGetString(ticket,DEAL_COMMENT),"demo exercise ")==0)
            exercise[found]=true;
         net[found]+=HistoryDealGetDouble(ticket,DEAL_PROFIT)
                     +HistoryDealGetDouble(ticket,DEAL_COMMISSION)
                     +HistoryDealGetDouble(ticket,DEAL_SWAP)
                     +HistoryDealGetDouble(ticket,DEAL_FEE);
         if(entry==DEAL_ENTRY_OUT || entry==DEAL_ENTRY_OUT_BY || entry==DEAL_ENTRY_INOUT)
            closedAt[found]=(datetime)HistoryDealGetInteger(ticket,DEAL_TIME);
        }
      datetime latest=0,previous=0;
      double latestNet=0,previousNet=0;
      for(int i=0;i<n;i++)
        {
         if(closedAt[i]<dayStart || exercise[i])
            continue;
         bool stillOpen=false;
         for(int p=PositionsTotal()-1;p>=0;p--)
           {
            ulong ticket=PositionGetTicket(p);
            if(ticket>0 && PositionGetInteger(POSITION_IDENTIFIER)==ids[i])
              {
               stillOpen=true;
               break;
              }
           }
         if(stillOpen)
            continue;
         if(closedAt[i]>=latest)
           {
            previous=latest;
            previousNet=latestNet;
            latest=closedAt[i];
            latestNet=net[i];
           }
         else if(closedAt[i]>previous)
           {
            previous=closedAt[i];
            previousNet=net[i];
           }
        }
      if(latest>0 && latestNet<0)
        {
         m_lossStreak=1;
         m_lastLossAt=latest;
         if(previous>0 && previousNet<0)
            m_lossStreak=2;
        }
     }

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
            && HistoryDealGetString(ticket,DEAL_SYMBOL)==m_symbol
            && HistoryDealGetInteger(ticket,DEAL_ENTRY)==DEAL_ENTRY_IN
            && StringFind(HistoryDealGetString(ticket,DEAL_COMMENT),"demo exercise ")!=0)
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
         return "market hours unavailable: no new trades";

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
      m_upcomingNews="";
      m_sessionCheckedAt=0;
      m_sessionReason="";
      m_lossCheckedAt=0;
      m_lastLossAt=0;
      m_lossStreak=0;
      m_lossHistoryOk=true;

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
      m_lossCheckedAt=0;
      m_lastLossAt=0;
      m_lossStreak=0;
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
   void              InvalidateLosses(void)         { m_lossCheckedAt=0; }
   int               ConsecutiveLosses(void)        { RefreshLosses(); return m_lossStreak; }
   string            LossReason(const int cooldownMinutes)
     {
      RefreshLosses();
      if(!m_lossHistoryOk)
         return "trade history unavailable: no new trades";
      if(m_lossStreak>=2)
         return "two consecutive losing trades today";
      if(m_lastLossAt>0 && TimeTradeServer()-m_lastLossAt<cooldownMinutes*60)
         return StringFormat("loss cooldown: wait %d minutes after the last losing trade",cooldownMinutes);
      return "";
     }

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
      m_upcomingNews="";
      datetime nextAt=0;

      string currencies[2];
      currencies[0]=SymbolInfoString(m_symbol,SYMBOL_CURRENCY_BASE);
      currencies[1]=SymbolInfoString(m_symbol,SYMBOL_CURRENCY_PROFIT);
      for(int c=0;c<2;c++)
        {
         if(currencies[c]=="" || (c==1 && currencies[1]==currencies[0]))
            continue;
         MqlCalendarValue values[];
         ResetLastError();
         int count=CalendarValueHistory(values,now-m_newsAfter*60,now+3600,NULL,currencies[c]);
         if(count<0)
           {
            m_newsReason=StringFormat("news calendar unavailable (error %d): no new trades",GetLastError());
            return m_newsReason;
           }
         for(int i=0;i<ArraySize(values);i++)
           {
            MqlCalendarEvent ev;
            if(!CalendarEventById(values[i].event_id,ev))
              {
               m_newsReason="news calendar unavailable (event lookup failed): no new trades";
               return m_newsReason;
              }
            if(ev.importance!=CALENDAR_IMPORTANCE_HIGH)
               continue;
            string eventText=StringFormat("%s %s at %s Prague",currencies[c],ev.name,
                                          TimeToString(ClockServerToPrague(values[i].time),TIME_MINUTES));
            if(values[i].time>now && (nextAt==0 || values[i].time<nextAt))
              {
               nextAt=values[i].time;
               m_upcomingNews=eventText;
              }
            if(values[i].time<=now+m_newsBefore*60 && m_newsReason=="")
               m_newsReason="news: "+eventText;
           }
        }
      return m_newsReason;
     }

   string            UpcomingNews(void)
     {
      NewsReason();
      return m_upcomingNews;
     }
  };

#endif
