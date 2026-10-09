// Closed-candle demo interpretation. No trade execution in this class.
#ifndef OFFICE_STRATEGY_MQH
#define OFFICE_STRATEGY_MQH
#include "Json.mqh"
enum ENUM_SIGNAL { SIGNAL_SELL=-1,SIGNAL_NONE=0,SIGNAL_BUY=1 };
struct STrendReading { bool ready; int direction; double close,fast,slow; };

class CPlanStrategy
  {
private:
   string m_symbol,m_trends,m_check,m_mode,m_candles;
   int m_h4Fast,m_h4Slow,m_d1Fast,m_d1Slow,m_h1Fast,m_h1Slow,m_m15Fast,m_m15Slow,m_atr,m_h4Atr;
   STrendReading m_h4,m_d1,m_h1,m_m15;
   bool m_data,m_trend,m_patternRun,m_bos,m_held,m_zone,m_reaction,m_confirmation,m_shape,m_cont,m_contWindow,m_pullback;
   int m_direction,m_bosShift;
   double m_emaReaction,m_emaConfirm,m_atrReaction,m_atrConfirm,m_level,m_protected,m_reboundLevel,m_h4Previous,m_h4AtrValue;

   void Release(const int h) { if(h!=INVALID_HANDLE) IndicatorRelease(h); }
   bool Value(const int h,const int shift,double &v)
     {
      double a[];
      if(h==INVALID_HANDLE || CopyBuffer(h,0,shift,1,a)!=1 || a[0]==EMPTY_VALUE || !MathIsValidNumber(a[0]) || a[0]<=0) return false;
      v=a[0]; return true;
     }
   void ReadTrend(const ENUM_TIMEFRAMES tf,const int fastH,const int slowH,STrendReading &r)
     {
      ZeroMemory(r);
      bool fastOk=Value(fastH,1,r.fast),slowOk=Value(slowH,1,r.slow);
      r.close=iClose(m_symbol,tf,1); r.ready=fastOk && slowOk && r.close>0;
      if(!r.ready) return;
      if(r.fast>r.slow && r.close>r.fast) r.direction=1;
      else if(r.fast<r.slow && r.close<r.fast) r.direction=-1;
     }
   string Text(const STrendReading &r) { return !r.ready ? "data missing" : r.direction>0 ? "up" : r.direction<0 ? "down" : "mixed"; }
   string ReadingJson(const STrendReading &r)
     {
      return "{"+JKey("ready")+JBool(r.ready)+","+JKey("direction")+JInt(r.direction)+","+JKey("close")+JNum(r.close,5)
        +","+JKey("fast")+JNum(r.fast,5)+","+JKey("slow")+JNum(r.slow,5)+"}";
     }
   // A mixed EMA ordering alone never authorizes an entry. A recent closed
   // H4 break must retain its protected low/high and have H1/M15 support.
   int Rebound(void)
     {
      double oldFast,h4Atr;
      if(!Value(m_h4Fast,4,oldFast) || !Value(m_h4Atr,1,h4Atr)) { m_data=false; return 0; }
      m_h4Previous=oldFast; m_h4AtrValue=h4Atr;
      int d=m_h4.close>m_h4.fast && m_h4.fast>oldFast ? 1 : m_h4.close<m_h4.fast && m_h4.fast<oldFast ? -1 : 0;
      if(d==0 || m_h1.direction!=d || m_m15.direction!=d) return 0;
      MqlRates b[]; ArraySetAsSeries(b,true);
      if(CopyRates(m_symbol,PERIOD_H4,1,6,b)!=6) { m_data=false; return 0; }
      for(int k=0;k<3;k++)
        {
         double level=d>0 ? b[k+1].high : b[k+1].low;
         double protectedLevel=d>0 ? b[k+1].low : b[k+1].high;
         for(int j=k+2;j<=k+3;j++)
           { level=d>0 ? MathMax(level,b[j].high) : MathMin(level,b[j].low);
             protectedLevel=d>0 ? MathMin(protectedLevel,b[j].low) : MathMax(protectedLevel,b[j].high); }
         bool broke=d>0 ? b[k].close>level && b[k].low>protectedLevel : b[k].close<level && b[k].high<protectedLevel;
         bool held=true;
         for(int j=0;j<=k;j++)
            if((d>0 && (b[j].low<=protectedLevel || b[j].close<level-0.5*h4Atr))
              || (d<0 && (b[j].high>=protectedLevel || b[j].close>level+0.5*h4Atr))) held=false;
         if(broke && held) { m_reboundLevel=level; m_protected=protectedLevel; return d; }
        }
      return 0;
     }
   // Radius-two swing was fully confirmed BEFORE the BOS candle opened.
   bool PivotLevel(MqlRates &b[],const int k,const int d,double &level)
     {
      for(int j=k+3;j<k+15;j++)
        {
         bool pivot=true;
         for(int z=-2;z<=2;z++)
            if(z!=0 && ((d>0 && b[j].high<=b[j+z].high) || (d<0 && b[j].low>=b[j+z].low))) pivot=false;
         if(pivot) { level=d>0 ? b[j].high : b[j].low; return true; }
        }
      return false;
     }
   string Gate(const bool value) { return m_patternRun ? JBool(value) : "null"; }

public:
   CPlanStrategy(void)
     {
      m_h4Fast=m_h4Slow=m_d1Fast=m_d1Slow=m_h1Fast=m_h1Slow=m_m15Fast=m_m15Slow=m_atr=m_h4Atr=INVALID_HANDLE;
      m_trends="waiting for candles"; m_check="waiting for first completed M15 check"; Reset();
     }
   void Reset(void)
     {
      m_data=m_trend=m_patternRun=m_bos=m_held=m_zone=m_reaction=m_confirmation=m_shape=m_cont=m_contWindow=m_pullback=false;
      m_direction=m_bosShift=0; m_emaReaction=m_emaConfirm=m_atrReaction=m_atrConfirm=m_level=m_protected=m_reboundLevel=m_h4Previous=m_h4AtrValue=0;
      m_candles="[]";
      m_mode="waiting"; ZeroMemory(m_d1); ZeroMemory(m_h4); ZeroMemory(m_h1); ZeroMemory(m_m15);
     }
   bool Init(const string symbol)
     {
      m_symbol=symbol;
      m_h4Fast=iMA(symbol,PERIOD_H4,50,0,MODE_EMA,PRICE_CLOSE); m_h4Slow=iMA(symbol,PERIOD_H4,200,0,MODE_EMA,PRICE_CLOSE);
      m_d1Fast=iMA(symbol,PERIOD_D1,20,0,MODE_EMA,PRICE_CLOSE); m_d1Slow=iMA(symbol,PERIOD_D1,50,0,MODE_EMA,PRICE_CLOSE);
      m_h1Fast=iMA(symbol,PERIOD_H1,20,0,MODE_EMA,PRICE_CLOSE); m_h1Slow=iMA(symbol,PERIOD_H1,50,0,MODE_EMA,PRICE_CLOSE);
      m_m15Fast=iMA(symbol,PERIOD_M15,20,0,MODE_EMA,PRICE_CLOSE); m_m15Slow=iMA(symbol,PERIOD_M15,50,0,MODE_EMA,PRICE_CLOSE);
      m_atr=iATR(symbol,PERIOD_M15,14); m_h4Atr=iATR(symbol,PERIOD_H4,14);
      return m_h4Fast!=INVALID_HANDLE && m_h4Slow!=INVALID_HANDLE && m_d1Fast!=INVALID_HANDLE && m_d1Slow!=INVALID_HANDLE
        && m_h1Fast!=INVALID_HANDLE && m_h1Slow!=INVALID_HANDLE && m_m15Fast!=INVALID_HANDLE && m_m15Slow!=INVALID_HANDLE
        && m_atr!=INVALID_HANDLE && m_h4Atr!=INVALID_HANDLE;
     }
   void Deinit(void)
     { Release(m_h4Fast); Release(m_h4Slow); Release(m_d1Fast); Release(m_d1Slow); Release(m_h1Fast); Release(m_h1Slow);
       Release(m_m15Fast); Release(m_m15Slow); Release(m_atr); Release(m_h4Atr); }
   string Name(void) { return "XAUUSD demo v3: structure-qualified rebounds and anchored retests"; }
   string Trends(void) { return m_trends; }
   string Check(void) { return m_check; }
   bool TrendPassed(void) { return m_trend; }
   string Diagnostics(void)
     {
      return "{"+JKey("data_ready")+JBool(m_data)+","+JKey("mode")+JStr(m_mode)+","+JKey("direction")+JInt(m_direction)
        +","+JKey("indicators")+"{"+JKey("D1")+ReadingJson(m_d1)+","+JKey("H4")+ReadingJson(m_h4)
        +","+JKey("H1")+ReadingJson(m_h1)+","+JKey("M15")+ReadingJson(m_m15)+"}"
        +","+JKey("ema_reaction")+JNum(m_emaReaction,5)+","+JKey("ema_confirmation")+JNum(m_emaConfirm,5)
        +","+JKey("atr_reaction")+JNum(m_atrReaction,5)+","+JKey("atr_confirmation")+JNum(m_atrConfirm,5)
        +","+JKey("h4_ema50_three_bars_ago")+JNum(m_h4Previous,5)+","+JKey("h4_atr")+JNum(m_h4AtrValue,5)
        +","+JKey("candles")+m_candles
        +","+JKey("bos_level")+JNum(m_level,5)+","+JKey("bos_bars_ago")+JInt(m_bosShift)
        +","+JKey("rebound_level")+JNum(m_reboundLevel,5)+","+JKey("protected_level")+JNum(m_protected,5)
        +","+JKey("gates")+"{"+JKey("trend")+JBool(m_trend)+","+JKey("m15_alignment")+(m_patternRun ? JBool(m_m15.direction==m_direction) : "null")
        +","+JKey("candle_shape")+Gate(m_shape)+","+JKey("bos")+Gate(m_bos)+","+JKey("structure_held")+Gate(m_held)
        +","+JKey("zone")+Gate(m_zone)+","+JKey("reaction")+Gate(m_reaction)+","+JKey("confirmation")+Gate(m_confirmation)
        +","+JKey("continuation_window")+JBool(m_contWindow)+","+JKey("continuation_pullback")+Gate(m_pullback)+","+JKey("continuation")+Gate(m_cont)+"}"
        +","+JKey("reason")+JStr(m_check)+"}";
     }
   ENUM_SIGNAL Evaluate(double &stopPrice,double &riskFactor,double &atrValue,const bool allowContinuation=false)
     {
      Reset(); stopPrice=riskFactor=atrValue=0; m_contWindow=allowContinuation;
      ReadTrend(PERIOD_H4,m_h4Fast,m_h4Slow,m_h4); ReadTrend(PERIOD_D1,m_d1Fast,m_d1Slow,m_d1);
      ReadTrend(PERIOD_H1,m_h1Fast,m_h1Slow,m_h1); ReadTrend(PERIOD_M15,m_m15Fast,m_m15Slow,m_m15);
      m_trends="D1 "+Text(m_d1)+" / H4 "+Text(m_h4)+" / H1 "+Text(m_h1)+" / M15 "+Text(m_m15);
      MqlRates b[]; double atr[]; ArraySetAsSeries(b,true); ArraySetAsSeries(atr,true);
      m_data=m_d1.ready && m_h4.ready && m_h1.ready && m_m15.ready;
      bool emaOk=Value(m_m15Fast,2,m_emaReaction);
      if(!m_data || !emaOk || CopyRates(m_symbol,PERIOD_M15,1,40,b)!=40 || CopyBuffer(m_atr,0,1,40,atr)!=40)
        { m_data=false; m_check="data: waiting for closed candles and indicator buffers"; return SIGNAL_NONE; }
      for(int j=0;j<40;j++)
         if(atr[j]<=0 || atr[j]==EMPTY_VALUE || !MathIsValidNumber(atr[j]))
           { m_data=false; m_check="data: M15 ATR unavailable"; return SIGNAL_NONE; }
      m_emaConfirm=m_m15.fast; m_atrReaction=atr[1]; m_atrConfirm=atr[0]; atrValue=atr[0];
      m_candles="[";
      for(int j=0;j<2;j++)
        {
         if(j>0) m_candles+=",";
         m_candles+="{"+JKey("at")+JInt((long)ClockServerToUtc(b[j].time))+","+JKey("open")+JNum(b[j].open,5)+","+JKey("high")+JNum(b[j].high,5)
            +","+JKey("low")+JNum(b[j].low,5)+","+JKey("close")+JNum(b[j].close,5)+"}";
        }
      m_candles+="]";
      m_direction=m_h4.direction; m_mode="aligned";
      if(m_direction==0) { m_direction=Rebound(); m_mode=m_direction!=0 ? "rebound" : "mixed"; }
      if(!m_data) { m_check="data: H4 rebound history or indicators unavailable"; return SIGNAL_NONE; }
      m_trend=m_direction!=0 && (m_mode=="rebound" || m_d1.direction==m_direction || m_h1.direction==m_direction);
      if(!m_trend) { m_check="trend: no aligned H4 direction or structure-qualified rebound"; return SIGNAL_NONE; }
      riskFactor=m_mode=="rebound" || m_d1.direction!=m_direction || m_h1.direction!=m_direction ? 0.5 : 1.0;
      m_patternRun=true; int d=m_direction;
      double rr=b[1].high-b[1].low,rb=MathAbs(b[1].close-b[1].open),cb=MathAbs(b[0].close-b[0].open);
      m_shape=rr>0 && rb>=rr*0.25 && cb>=atr[0]*0.10;
      m_confirmation=d>0 ? b[0].close>b[0].open && b[0].close>b[1].high && b[0].close>m_emaConfirm
                         : b[0].close<b[0].open && b[0].close<b[1].low && b[0].close<m_emaConfirm;
      m_reaction=d>0 ? b[1].close>b[1].open && b[1].close>=b[1].low+0.65*rr
                            && (MathMin(b[1].open,b[1].close)-b[1].low>=0.10*atr[1] || rb>=0.35*atr[1])
                    : b[1].close<b[1].open && b[1].close<=b[1].low+0.35*rr
                            && (b[1].high-MathMax(b[1].open,b[1].close)>=0.10*atr[1] || rb>=0.35*atr[1]);
      int bestScore=-1; bool full=false;
      for(int k=3;k<=12;k++)
        {
         double level; if(!PivotLevel(b,k,d,level)) continue;
         bool broke=d>0 ? b[k].close>level+0.05*atr[k] : b[k].close<level-0.05*atr[k];
         bool held=true;
         for(int j=2;j<k;j++)
            if((d>0 && b[j].close<level-0.70*atr[k]) || (d<0 && b[j].close>level+0.70*atr[k])) held=false;
         bool zone=d>0 ? ((b[1].low<=level+0.35*atr[1] && b[1].low>=level-1.50*atr[1] && b[1].close>level)
                        || (b[1].low<=m_emaReaction+0.35*atr[1] && b[1].low>=m_emaReaction-1.50*atr[1] && b[1].close>=m_emaReaction-0.35*atr[1]))
                       : ((b[1].high>=level-0.35*atr[1] && b[1].high<=level+1.50*atr[1] && b[1].close<level)
                        || (b[1].high>=m_emaReaction-0.35*atr[1] && b[1].high<=m_emaReaction+1.50*atr[1] && b[1].close<=m_emaReaction+0.35*atr[1]));
         int score=(broke ? 4 : 0)+(held ? 2 : 0)+(zone ? 1 : 0);
         if(score>bestScore) { bestScore=score; m_bos=broke; m_held=held; m_zone=zone; m_level=level; m_bosShift=k; }
         if(broke && held && zone && m_reaction && m_confirmation && m_shape && m_m15.direction==d)
           { full=true; m_bos=m_held=m_zone=true; m_level=level; m_bosShift=k; break; }
        }
      bool pull=d>0 ? b[1].low<=m_emaReaction+0.55*atr[1] && b[1].low>=m_emaReaction-1.50*atr[1] && b[1].close>=m_emaReaction-0.35*atr[1]
                    : b[1].high>=m_emaReaction-0.55*atr[1] && b[1].high<=m_emaReaction+1.50*atr[1] && b[1].close<=m_emaReaction+0.35*atr[1];
      m_pullback=pull;
      m_cont=allowContinuation && rr>0 && cb>=0.12*atr[0] && pull && m_confirmation;
      if(full || m_cont)
        {
         double extreme=d>0 ? MathMin(b[0].low,b[1].low) : MathMax(b[0].high,b[1].high);
         if(full) extreme=d>0 ? MathMin(extreme,b[2].low) : MathMax(extreme,b[2].high);
         double raw=d>0 ? extreme-0.15*atr[0] : extreme+0.15*atr[0];
         stopPrice=d>0 ? MathMin(raw,b[0].close-1.20*atr[0]) : MathMax(raw,b[0].close+1.20*atr[0]);
         if(!full) riskFactor=0.5;
         m_check=(d>0 ? "BUY " : "SELL ")+m_mode+(full ? ": confirmed swing BOS, anchored retest, reaction and close" : ": anchored continuation; half risk");
         return d>0 ? SIGNAL_BUY : SIGNAL_SELL;
        }
      m_check=!m_confirmation ? "confirmation: waiting for a close beyond the reaction candle"
             : !m_bos ? "BOS: waiting for a break of a confirmed swing"
             : !m_held ? "structure: broken level did not hold"
             : !m_zone ? "zone: no anchored retest" : !m_reaction ? "reaction: candle did not reject the zone"
             : !m_shape ? "candle shape: body too small" : "alignment: M15 disagrees with entry direction";
      return SIGNAL_NONE;
     }
  };
#endif
