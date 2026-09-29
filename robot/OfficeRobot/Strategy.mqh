//+------------------------------------------------------------------+
//| Strategy.mqh                                                     |
//| Deterministic demo interpretation of the supplied XAUUSD plan. |
//| Every signal uses completed candles only.                       |
//+------------------------------------------------------------------+
#ifndef OFFICE_STRATEGY_MQH
#define OFFICE_STRATEGY_MQH

enum ENUM_SIGNAL
  {
   SIGNAL_SELL=-1,
   SIGNAL_NONE=0,
   SIGNAL_BUY=1
  };

class CPlanStrategy
  {
private:
   string            m_symbol;
   int               m_h4Fast,m_h4Slow,m_d1Fast,m_d1Slow;
   int               m_h1Fast,m_h1Slow,m_m15Fast,m_m15Slow,m_atr;
   string            m_trends;
   string            m_check;

   void              Release(const int handle)
     {
      if(handle!=INVALID_HANDLE)
         IndicatorRelease(handle);
     }

   bool              Value(const int handle,double &value)
     {
      double result[];
      if(handle==INVALID_HANDLE || CopyBuffer(handle,0,1,1,result)!=1 || result[0]==EMPTY_VALUE)
         return false;
      value=result[0];
      return value>0;
     }

   int               Trend(const ENUM_TIMEFRAMES tf,const int fastHandle,const int slowHandle)
     {
      double fast,slow;
      if(!Value(fastHandle,fast) || !Value(slowHandle,slow))
         return 0;
      double close=iClose(m_symbol,tf,1);
      if(close<=0)
         return 0;
      if(fast>slow && close>fast)
         return 1;
      if(fast<slow && close<fast)
         return -1;
      return 0;
     }

   string            TrendText(const int trend)
     {
      if(trend>0)
         return "up";
      if(trend<0)
         return "down";
      return "mixed";
     }

public:
                     CPlanStrategy(void) : m_h4Fast(INVALID_HANDLE),m_h4Slow(INVALID_HANDLE),
                                            m_d1Fast(INVALID_HANDLE),m_d1Slow(INVALID_HANDLE),
                                            m_h1Fast(INVALID_HANDLE),m_h1Slow(INVALID_HANDLE),
                                            m_m15Fast(INVALID_HANDLE),m_m15Slow(INVALID_HANDLE),
                                            m_atr(INVALID_HANDLE),m_trends("waiting for candles"),
                                            m_check("waiting for first closed M15 candle") {}

   bool              Init(const string symbol)
     {
      m_symbol=symbol;
      m_h4Fast=iMA(symbol,PERIOD_H4,50,0,MODE_EMA,PRICE_CLOSE);
      m_h4Slow=iMA(symbol,PERIOD_H4,200,0,MODE_EMA,PRICE_CLOSE);
      m_d1Fast=iMA(symbol,PERIOD_D1,20,0,MODE_EMA,PRICE_CLOSE);
      m_d1Slow=iMA(symbol,PERIOD_D1,50,0,MODE_EMA,PRICE_CLOSE);
      m_h1Fast=iMA(symbol,PERIOD_H1,20,0,MODE_EMA,PRICE_CLOSE);
      m_h1Slow=iMA(symbol,PERIOD_H1,50,0,MODE_EMA,PRICE_CLOSE);
      m_m15Fast=iMA(symbol,PERIOD_M15,20,0,MODE_EMA,PRICE_CLOSE);
      m_m15Slow=iMA(symbol,PERIOD_M15,50,0,MODE_EMA,PRICE_CLOSE);
      m_atr=iATR(symbol,PERIOD_M15,14);
      return m_h4Fast!=INVALID_HANDLE && m_h4Slow!=INVALID_HANDLE
             && m_d1Fast!=INVALID_HANDLE && m_d1Slow!=INVALID_HANDLE
             && m_h1Fast!=INVALID_HANDLE && m_h1Slow!=INVALID_HANDLE
             && m_m15Fast!=INVALID_HANDLE && m_m15Slow!=INVALID_HANDLE
             && m_atr!=INVALID_HANDLE;
     }

   void              Deinit(void)
     {
      Release(m_h4Fast); Release(m_h4Slow);
      Release(m_d1Fast); Release(m_d1Slow);
      Release(m_h1Fast); Release(m_h1Slow);
      Release(m_m15Fast); Release(m_m15Slow); Release(m_atr);
     }

   string            Name(void)    { return "XAUUSD plan draft v1: H4/D1/H1 trend, M15 BOS-pullback"; }
   string            Trends(void)  { return m_trends; }
   string            Check(void)   { return m_check; }

   // The last completed M15 bar is b[0]; b[1] is the reaction, b[k]
   // is an earlier structure break. Series indexing is explicit here.
   ENUM_SIGNAL       Evaluate(double &stopPrice,double &riskFactor,double &atrValue)
     {
      stopPrice=0;
      riskFactor=0;
      atrValue=0;
      int h4=Trend(PERIOD_H4,m_h4Fast,m_h4Slow);
      int d1=Trend(PERIOD_D1,m_d1Fast,m_d1Slow);
      int h1=Trend(PERIOD_H1,m_h1Fast,m_h1Slow);
      int m15=Trend(PERIOD_M15,m_m15Fast,m_m15Slow);
      m_trends=StringFormat("D1 %s / H4 %s / H1 %s / M15 %s",
                            TrendText(d1),TrendText(h4),TrendText(h1),TrendText(m15));
      if(h4==0 || m15!=h4 || (d1!=h4 && h1!=h4))
        {
         m_check="trend alignment: waiting for H4 and M15 plus D1 or H1";
         return SIGNAL_NONE;
        }
      riskFactor=(d1==h4 && h1==h4) ? 1.0 : 0.5;

      double ema20;
      if(!Value(m_m15Fast,ema20) || !Value(m_atr,atrValue) || atrValue<=0)
        {
         m_check="waiting for M15 EMA/ATR data";
         return SIGNAL_NONE;
        }
      MqlRates b[];
      ArraySetAsSeries(b,true);
      if(CopyRates(m_symbol,PERIOD_M15,1,32,b)!=32)
        {
         m_check="waiting for 32 completed M15 candles";
         return SIGNAL_NONE;
        }

      double reactionRange=b[1].high-b[1].low;
      double reactionBody=MathAbs(b[1].close-b[1].open);
      double confirmBody=MathAbs(b[0].close-b[0].open);
      if(reactionRange<=0 || reactionBody<reactionRange*0.25 || confirmBody<atrValue*0.10)
        {
         m_check="waiting for a clear pullback reaction and confirmation";
         return SIGNAL_NONE;
        }

      for(int k=3;k<=12;k++)
        {
         double level=h4>0 ? b[k+1].high : b[k+1].low;
         for(int j=k+2;j<=k+6;j++)
           {
            if(h4>0)
               level=MathMax(level,b[j].high);
            else
               level=MathMin(level,b[j].low);
           }
         bool broke=h4>0 ? b[k].close>level+0.05*atrValue
                          : b[k].close<level-0.05*atrValue;
         if(!broke)
            continue;
         bool held=true;
         for(int j=k-1;j>=2;j--)
           {
            if((h4>0 && b[j].close<level-0.70*atrValue)
               || (h4<0 && b[j].close>level+0.70*atrValue))
               held=false;
           }
         if(!held)
            continue;

         bool zone=false,reaction=false,confirmation=false;
         if(h4>0)
           {
            zone=((b[1].low<=level+0.35*atrValue && b[1].low>=level-0.55*atrValue
                    && b[1].close>level)
                   || (b[1].low<=ema20+0.25*atrValue && b[1].low>=ema20-0.55*atrValue
                       && b[1].close>=ema20));
            reaction=b[1].close>b[1].open && b[1].close>=b[1].low+0.65*reactionRange
                     && ((MathMin(b[1].open,b[1].close)-b[1].low)>=0.10*atrValue
                         || reactionBody>=0.35*atrValue);
            confirmation=b[0].close>b[0].open && b[0].close>b[1].high && b[0].close>ema20;
           }
         else
           {
            zone=((b[1].high>=level-0.35*atrValue && b[1].high<=level+0.55*atrValue
                    && b[1].close<level)
                   || (b[1].high>=ema20-0.25*atrValue && b[1].high<=ema20+0.55*atrValue
                       && b[1].close<=ema20));
            reaction=b[1].close<b[1].open && b[1].close<=b[1].low+0.35*reactionRange
                     && ((b[1].high-MathMax(b[1].open,b[1].close))>=0.10*atrValue
                         || reactionBody>=0.35*atrValue);
            confirmation=b[0].close<b[0].open && b[0].close<b[1].low && b[0].close<ema20;
           }
         if(!zone || !reaction || !confirmation)
            continue;

         double extreme=h4>0 ? MathMin(b[0].low,MathMin(b[1].low,b[2].low))
                             : MathMax(b[0].high,MathMax(b[1].high,b[2].high));
         double rawStop=h4>0 ? extreme-0.15*atrValue : extreme+0.15*atrValue;
         double minDistance=1.20*atrValue;
         stopPrice=h4>0 ? MathMin(rawStop,b[0].close-minDistance)
                        : MathMax(rawStop,b[0].close+minDistance);
         m_check=StringFormat("%s: structure break %d M15 bars ago, zone retest, reaction, confirmation; %s risk",
                               h4>0 ? "BUY" : "SELL",k,riskFactor==1.0 ? "full" : "half");
         return h4>0 ? SIGNAL_BUY : SIGNAL_SELL;
        }
      m_check="waiting for BOS, zone retest, reaction and next-candle confirmation";
      return SIGNAL_NONE;
     }
  };

#endif
