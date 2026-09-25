//+------------------------------------------------------------------+
//| Strategy.mqh                                                     |
//| Placeholder until we write our own strategy card: a common EMA   |
//| crossover. Buy when the fast EMA crosses above the slow one on a |
//| closed bar, sell on the opposite cross. The stop is a multiple   |
//| of ATR, so it widens and narrows with volatility.                |
//+------------------------------------------------------------------+
#ifndef OFFICE_STRATEGY_MQH
#define OFFICE_STRATEGY_MQH

enum ENUM_SIGNAL
  {
   SIGNAL_SELL=-1,
   SIGNAL_NONE=0,
   SIGNAL_BUY=1
  };

class CEmaCross
  {
private:
   string            m_symbol;
   ENUM_TIMEFRAMES   m_timeframe;
   int               m_fast;
   int               m_slow;
   int               m_atrPeriod;
   int               m_fastHandle;
   int               m_slowHandle;
   int               m_atrHandle;

public:
                     CEmaCross(void) : m_fastHandle(INVALID_HANDLE),
                                       m_slowHandle(INVALID_HANDLE),
                                       m_atrHandle(INVALID_HANDLE) {}

   bool              Init(const string symbol,const ENUM_TIMEFRAMES timeframe,
                          const int fast,const int slow,const int atrPeriod)
     {
      m_symbol=symbol;
      m_timeframe=timeframe;
      m_fast=fast;
      m_slow=slow;
      m_atrPeriod=atrPeriod;
      m_fastHandle=iMA(symbol,timeframe,fast,0,MODE_EMA,PRICE_CLOSE);
      m_slowHandle=iMA(symbol,timeframe,slow,0,MODE_EMA,PRICE_CLOSE);
      m_atrHandle=iATR(symbol,timeframe,atrPeriod);
      return m_fastHandle!=INVALID_HANDLE && m_slowHandle!=INVALID_HANDLE && m_atrHandle!=INVALID_HANDLE;
     }

   void              Deinit(void)
     {
      if(m_fastHandle!=INVALID_HANDLE)
         IndicatorRelease(m_fastHandle);
      if(m_slowHandle!=INVALID_HANDLE)
         IndicatorRelease(m_slowHandle);
      if(m_atrHandle!=INVALID_HANDLE)
         IndicatorRelease(m_atrHandle);
     }

   string            Name(void)
     {
      return StringFormat("EMA %d/%d cross, ATR(%d) stop",m_fast,m_slow,m_atrPeriod);
     }

   // Compares the last two closed bars. Oldest value first in each array.
   ENUM_SIGNAL       Signal(void)
     {
      double fast[],slow[];
      if(CopyBuffer(m_fastHandle,0,1,2,fast)!=2 || CopyBuffer(m_slowHandle,0,1,2,slow)!=2)
         return SIGNAL_NONE;
      if(fast[0]<=slow[0] && fast[1]>slow[1])
         return SIGNAL_BUY;
      if(fast[0]>=slow[0] && fast[1]<slow[1])
         return SIGNAL_SELL;
      return SIGNAL_NONE;
     }

   double            Atr(void)
     {
      double atr[];
      if(CopyBuffer(m_atrHandle,0,1,1,atr)!=1)
         return 0;
      return atr[0];
     }
  };

#endif
