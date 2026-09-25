//+------------------------------------------------------------------+
//| Clock.mqh                                                        |
//| FTMO counts days in Prague time (CET/CEST): the daily loss limit |
//| resets at 00:00 Prague. Everything day-based uses these helpers. |
//+------------------------------------------------------------------+
#ifndef OFFICE_CLOCK_MQH
#define OFFICE_CLOCK_MQH

// Server time minus GMT in the Strategy Tester, where TimeGMT() is not real.
int g_clockTesterOffset=2*3600;

void ClockInit(const int testerServerGmtOffsetHours)
  {
   g_clockTesterOffset=testerServerGmtOffsetHours*3600;
  }

// 01:00 UTC on the last Sunday of March or October: when EU clocks change.
datetime ClockLastSunday(const int year,const int month)
  {
   MqlDateTime t;
   ZeroMemory(t);
   t.year=year;
   t.mon=month;
   t.day=31;
   t.hour=1;
   datetime d=StructToTime(t);
   MqlDateTime x;
   TimeToStruct(d,x);
   return d-x.day_of_week*86400;
  }

datetime ClockGmt(void)
  {
   if(MQLInfoInteger(MQL_TESTER))
      return TimeTradeServer()-g_clockTesterOffset;
   return TimeGMT();
  }

int ClockRound15(const long seconds)
  {
   return (int)(MathRound(seconds/900.0)*900);
  }

// Server time minus GMT, in seconds.
int ClockServerOffset(void)
  {
   return ClockRound15((long)(TimeTradeServer()-ClockGmt()));
  }

datetime ClockServerToUtc(const datetime serverTime)
  {
   return serverTime-ClockServerOffset();
  }

datetime ClockUtcToPrague(const datetime utc)
  {
   MqlDateTime t;
   TimeToStruct(utc,t);
   bool summer=(utc>=ClockLastSunday(t.year,3) && utc<ClockLastSunday(t.year,10));
   return utc+(summer ? 7200 : 3600);
  }

datetime ClockPrague(void)
  {
   return ClockUtcToPrague(ClockGmt());
  }

int ClockPragueHour(void)
  {
   MqlDateTime t;
   TimeToStruct(ClockPrague(),t);
   return t.hour;
  }

// Prague time minus server time, in seconds.
int ClockPragueMinusServer(void)
  {
   return ClockRound15((long)(ClockPrague()-TimeTradeServer()));
  }

datetime ClockServerToPrague(const datetime serverTime)
  {
   return serverTime+ClockPragueMinusServer();
  }

// Start of the current FTMO day (00:00 Prague), as a Prague timestamp.
datetime ClockPragueDayStart(void)
  {
   long p=(long)ClockPrague();
   return (datetime)(p-p%86400);
  }

// The same instant in server time, for history queries.
datetime ClockPragueDayStartServer(void)
  {
   return ClockPragueDayStart()-ClockPragueMinusServer();
  }

#endif
