//+------------------------------------------------------------------+
//| Trader.mqh                                                       |
//| Opens and closes this robot's trades. Only positions with this   |
//| robot's magic number on this symbol are ever touched.            |
//+------------------------------------------------------------------+
#ifndef OFFICE_TRADER_MQH
#define OFFICE_TRADER_MQH

#include <Trade\Trade.mqh>
#include "Clock.mqh"
#include "Json.mqh"

class COfficeTrader
  {
private:
   CTrade            m_trade;
   string            m_symbol;
   long              m_magic;
   bool              m_planAvailable,m_planReady;
   double            m_entry,m_stop,m_target,m_distance,m_minRisk,m_risk,m_rawVolume,m_volume,m_minVolume;
   string            m_planReason;

   bool FailPlan(const string reason,string &info)
     { m_planReady=false; m_planReason=reason; info=reason; return false; }

   // Is the currently selected position one of ours?
   bool              Mine(void)
     {
      return PositionGetInteger(POSITION_MAGIC)==m_magic && PositionGetString(POSITION_SYMBOL)==m_symbol;
     }

public:
   void ResetPlan(void)
     {
      m_planAvailable=m_planReady=false; m_entry=m_stop=m_target=m_distance=m_minRisk=m_risk=m_rawVolume=m_volume=m_minVolume=0;
      m_planReason="No confirmed signal to size";
     }
   string PlanJson(void)
     {
      return "{"+JKey("available")+JBool(m_planAvailable)+","+JKey("feasible")+JBool(m_planReady)
       +","+JKey("entry")+JNum(m_entry,5)+","+JKey("stop")+JNum(m_stop,5)+","+JKey("target")+JNum(m_target,5)
       +","+JKey("stop_distance")+JNum(m_distance,5)+","+JKey("minimum_lot_risk")+JNum(m_minRisk,5)
       +","+JKey("risk_budget")+JNum(m_risk,5)+","+JKey("raw_volume")+JNum(m_rawVolume,8)
       +","+JKey("calculated_volume")+JNum(m_volume,8)+","+JKey("minimum_volume")+JNum(m_minVolume,8)
       +","+JKey("reason")+JStr(m_planReason)+"}";
     }
   void              Init(const string symbol,const long magic,const int slippagePoints)
     {
      m_symbol=symbol;
      ResetPlan();
      m_magic=magic;
      m_trade.SetExpertMagicNumber((ulong)magic);
      m_trade.SetDeviationInPoints((ulong)slippagePoints);
      m_trade.SetTypeFillingBySymbol(symbol);
      m_trade.LogLevel(LOG_LEVEL_ERRORS);
     }

   // +1 long, -1 short, 0 flat.
   int               Direction(void)
     {
      for(int i=PositionsTotal()-1;i>=0;i--)
        {
         ulong ticket=PositionGetTicket(i);
         if(ticket>0 && Mine())
            return PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY ? 1 : -1;
        }
      return 0;
     }

   bool              HasPending(void)
     {
      for(int i=OrdersTotal()-1;i>=0;i--)
        {
         ulong ticket=OrderGetTicket(i);
         if(ticket>0 && OrderGetInteger(ORDER_MAGIC)==m_magic
            && OrderGetString(ORDER_SYMBOL)==m_symbol)
            return true;
        }
      return false;
     }

   datetime          OldestOpenTime(void)
     {
      datetime oldest=0;
      for(int i=PositionsTotal()-1;i>=0;i--)
        {
         ulong ticket=PositionGetTicket(i);
         if(ticket==0 || !Mine())
            continue;
         datetime opened=(datetime)PositionGetInteger(POSITION_TIME);
         if(oldest==0 || opened<oldest)
            oldest=opened;
        }
      return oldest;
     }

   double            OpenPnl(void)
     {
      double sum=0;
      for(int i=PositionsTotal()-1;i>=0;i--)
        {
         ulong ticket=PositionGetTicket(i);
         if(ticket>0 && Mine())
            sum+=PositionGetDouble(POSITION_PROFIT)+PositionGetDouble(POSITION_SWAP);
        }
      return sum;
     }

   string            PositionsJson(void)
     {
      int digits=(int)SymbolInfoInteger(m_symbol,SYMBOL_DIGITS);
      string out="";
      for(int i=PositionsTotal()-1;i>=0;i--)
        {
         ulong ticket=PositionGetTicket(i);
         if(ticket==0 || !Mine())
            continue;
         if(out!="")
            out+=",";
         out+="{"+JKey("ticket")+JInt((long)ticket)
              +","+JKey("side")+JStr(PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY ? "buy" : "sell")
              +","+JKey("volume")+JNum(PositionGetDouble(POSITION_VOLUME),2)
              +","+JKey("open")+JNum(PositionGetDouble(POSITION_PRICE_OPEN),digits)
              +","+JKey("sl")+JNum(PositionGetDouble(POSITION_SL),digits)
              +","+JKey("tp")+JNum(PositionGetDouble(POSITION_TP),digits)
              +","+JKey("profit")+JNum(PositionGetDouble(POSITION_PROFIT)+PositionGetDouble(POSITION_SWAP),2)
              +","+JKey("opened")+JInt((long)ClockServerToUtc((datetime)PositionGetInteger(POSITION_TIME)))
              +"}";
        }
      return "["+out+"]";
     }

   // Pure broker pricing preview: no order is sent. Open uses the same path.
   bool              Preview(const int direction,const double stopPrice,const double maxStopDistance,
                          const double targetR,const double riskMoney,const double maxAllowedLots,
                          string &info)
     {
      ResetPlan(); m_planAvailable=true; m_risk=riskMoney;
      MqlTick tick;
      if(!SymbolInfoTick(m_symbol,tick))
        {
         return FailPlan("no price yet",info);
        }
      int digits=(int)SymbolInfoInteger(m_symbol,SYMBOL_DIGITS);
      double point=SymbolInfoDouble(m_symbol,SYMBOL_POINT);
      double minStop=(double)SymbolInfoInteger(m_symbol,SYMBOL_TRADE_STOPS_LEVEL)*point;

      bool buy=direction>0;
      ENUM_ORDER_TYPE type=buy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
      double entry=buy ? tick.ask : tick.bid;
      double stopDistance=buy ? entry-stopPrice : stopPrice-entry;
      m_entry=entry; m_stop=NormalizeDouble(stopPrice,digits); m_distance=stopDistance;
      if(stopDistance<=0 || stopDistance>maxStopDistance)
        {
         return FailPlan("price moved too far from the planned structural stop",info);
        }
      if(stopDistance<minStop+2*point)
        {
         return FailPlan("stop would be too close to the price",info);
        }
      double sl=NormalizeDouble(stopPrice,digits);
      double tp=NormalizeDouble(buy ? entry+stopDistance*targetR : entry-stopDistance*targetR,digits);
      m_target=tp;

      // What one lot would lose at the stop, in account currency.
      double lossPerLot=0;
      if(!OrderCalcProfit(type,m_symbol,1.0,entry,sl,lossPerLot) || lossPerLot>=0)
        {
         return FailPlan("could not price the stop",info);
        }
      double step=SymbolInfoDouble(m_symbol,SYMBOL_VOLUME_STEP);
      double minLots=SymbolInfoDouble(m_symbol,SYMBOL_VOLUME_MIN);
      double maxLots=SymbolInfoDouble(m_symbol,SYMBOL_VOLUME_MAX);
      m_minVolume=minLots; m_minRisk=(-lossPerLot)*minLots;
      if(step<=0 || minLots<=0 || riskMoney<=0) return FailPlan("invalid broker volume or risk budget",info);
      m_rawVolume=riskMoney/(-lossPerLot);
      double lots=MathFloor((m_rawVolume+1e-10)/step)*step;
      m_volume=lots;
      if(lots<minLots)
        {
         return FailPlan(StringFormat("minimum %.2f lot risks %.2f; budget %.2f: size rejected",minLots,m_minRisk,riskMoney),info);
        }
      lots=MathMin(lots,MathMin(maxLots,maxAllowedLots));
      lots=MathFloor(lots/step)*step;
      if(lots<minLots)
        {
         m_volume=lots; return FailPlan("lot cap is below the broker's minimum size",info);
        }
      int volumeDigits=(int)MathMax(0,MathRound(-MathLog10(step)));
      lots=NormalizeDouble(lots,volumeDigits);
      m_volume=lots;
      if((-lossPerLot)*lots>riskMoney+1e-7) return FailPlan("rounded volume exceeds the risk budget",info);

      double margin=0;
      if(OrderCalcMargin(type,m_symbol,lots,entry,margin) && margin>AccountInfoDouble(ACCOUNT_MARGIN_FREE)*0.9)
        {
         return FailPlan("not enough free margin",info);
        }
      m_planReady=true; m_planReason="size fits the risk budget (before fees)"; info=m_planReason; return true;
     }
   // sent is true only when an order actually went to the server.
   bool Open(const int direction,const double stopPrice,const double maxStopDistance,
             const double targetR,const double riskMoney,const double maxAllowedLots,
             const string comment,string &info,bool &sent)
     {
      sent=false;
      if(!Preview(direction,stopPrice,maxStopDistance,targetR,riskMoney,maxAllowedLots,info)) return false;
      bool buy=direction>0; int digits=(int)SymbolInfoInteger(m_symbol,SYMBOL_DIGITS);
      double lots=m_volume,sl=m_stop,tp=m_target;
      double step=SymbolInfoDouble(m_symbol,SYMBOL_VOLUME_STEP);
      int volumeDigits=(int)MathMax(0,MathRound(-MathLog10(step)));
      sent=true;
      bool ok=buy ? m_trade.Buy(lots,m_symbol,0.0,sl,tp,comment)
                  : m_trade.Sell(lots,m_symbol,0.0,sl,tp,comment);
      uint code=m_trade.ResultRetcode();
      if(!ok || (code!=TRADE_RETCODE_DONE && code!=TRADE_RETCODE_DONE_PARTIAL
                 && code!=TRADE_RETCODE_PLACED))
        {
         info=StringFormat("order rejected: %s",m_trade.ResultRetcodeDescription());
         m_planReason=info;
         return false;
        }
      info=StringFormat("%s %s lots %s, stop %s, target %s",buy ? "BUY" : "SELL",
                        DoubleToString(lots,volumeDigits),m_symbol,
                        DoubleToString(sl,digits),DoubleToString(tp,digits));
      return true;
     }

   // Closes this robot's positions and deletes its pending orders.
   // requests is how many orders were sent to the server.
   bool              CloseAll(string &info,int &requests)
     {
      requests=0;
      int closed=0,failed=0;
      string lastError="";
      for(int i=PositionsTotal()-1;i>=0;i--)
        {
         ulong ticket=PositionGetTicket(i);
         if(ticket==0 || !Mine())
            continue;
         requests++;
         if(m_trade.PositionClose(ticket) && m_trade.ResultRetcode()==TRADE_RETCODE_DONE)
            closed++;
         else
           {
            failed++;
            lastError=m_trade.ResultRetcodeDescription();
           }
        }
      for(int i=OrdersTotal()-1;i>=0;i--)
        {
         ulong ticket=OrderGetTicket(i);
         if(ticket==0 || OrderGetInteger(ORDER_MAGIC)!=m_magic || OrderGetString(ORDER_SYMBOL)!=m_symbol)
            continue;
         requests++;
         if(!m_trade.OrderDelete(ticket) || m_trade.ResultRetcode()!=TRADE_RETCODE_DONE)
           {
            failed++;
            lastError=m_trade.ResultRetcodeDescription();
           }
        }
      if(failed>0)
        {
         info=StringFormat("%d close(s) failed: %s",failed,lastError);
         return false;
        }
      info=closed==0 ? "nothing was open" : StringFormat("closed %d position(s)",closed);
      return true;
     }
  };

#endif
