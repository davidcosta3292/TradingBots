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

   // Is the currently selected position one of ours?
   bool              Mine(void)
     {
      return PositionGetInteger(POSITION_MAGIC)==m_magic && PositionGetString(POSITION_SYMBOL)==m_symbol;
     }

public:
   void              Init(const string symbol,const long magic,const int slippagePoints)
     {
      m_symbol=symbol;
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

   // Opens one trade sized so that hitting the stop loses riskMoney.
   // sent is true when an order actually went to the server.
   bool              Open(const int direction,const double stopDistance,const double targetR,
                          const double riskMoney,const string comment,string &info,bool &sent)
     {
      sent=false;
      MqlTick tick;
      if(!SymbolInfoTick(m_symbol,tick))
        {
         info="no price yet";
         return false;
        }
      int digits=(int)SymbolInfoInteger(m_symbol,SYMBOL_DIGITS);
      double point=SymbolInfoDouble(m_symbol,SYMBOL_POINT);
      double minStop=(double)SymbolInfoInteger(m_symbol,SYMBOL_TRADE_STOPS_LEVEL)*point;
      if(stopDistance<=0 || stopDistance<minStop)
        {
         info="stop would be too close to the price";
         return false;
        }

      bool buy=direction>0;
      ENUM_ORDER_TYPE type=buy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
      double entry=buy ? tick.ask : tick.bid;
      double sl=NormalizeDouble(buy ? entry-stopDistance : entry+stopDistance,digits);
      double tp=NormalizeDouble(buy ? entry+stopDistance*targetR : entry-stopDistance*targetR,digits);

      // What one lot would lose at the stop, in account currency.
      double lossPerLot=0;
      if(!OrderCalcProfit(type,m_symbol,1.0,entry,sl,lossPerLot) || lossPerLot>=0)
        {
         info="could not price the stop";
         return false;
        }
      double step=SymbolInfoDouble(m_symbol,SYMBOL_VOLUME_STEP);
      double minLots=SymbolInfoDouble(m_symbol,SYMBOL_VOLUME_MIN);
      double maxLots=SymbolInfoDouble(m_symbol,SYMBOL_VOLUME_MAX);
      double lots=MathFloor(riskMoney/(-lossPerLot)/step)*step;
      if(lots<minLots)
        {
         info=StringFormat("the risk per trade is too small for the minimum size (%.2f lots)",minLots);
         return false;
        }
      lots=MathMin(lots,maxLots);
      int volumeDigits=(int)MathMax(0,MathRound(-MathLog10(step)));
      lots=NormalizeDouble(lots,volumeDigits);

      double margin=0;
      if(OrderCalcMargin(type,m_symbol,lots,entry,margin) && margin>AccountInfoDouble(ACCOUNT_MARGIN_FREE)*0.9)
        {
         info="not enough free margin";
         return false;
        }

      sent=true;
      bool ok=buy ? m_trade.Buy(lots,m_symbol,0.0,sl,tp,comment)
                  : m_trade.Sell(lots,m_symbol,0.0,sl,tp,comment);
      uint code=m_trade.ResultRetcode();
      if(!ok || (code!=TRADE_RETCODE_DONE && code!=TRADE_RETCODE_PLACED))
        {
         info=StringFormat("order rejected: %s",m_trade.ResultRetcodeDescription());
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
         if(!m_trade.OrderDelete(ticket))
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
