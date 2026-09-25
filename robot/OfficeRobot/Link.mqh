//+------------------------------------------------------------------+
//| Link.mqh                                                         |
//| The robot's connection to the office database (Supabase).        |
//| One call, robot_sync, sends the report and returns the pending   |
//| commands as "id:type;id:type". Confirmations, trades and events  |
//| wait in queues until a report carrying them gets through.        |
//+------------------------------------------------------------------+
#ifndef OFFICE_LINK_MQH
#define OFFICE_LINK_MQH

#include "Json.mqh"

class COfficeLink
  {
private:
   string            m_url;
   string            m_key;
   string            m_token;
   bool              m_enabled;
   int               m_failures;
   datetime          m_retryAt;
   string            m_lastError;
   string            m_acks[];
   string            m_deals[];
   string            m_events[];
   int               m_sentAcks;
   int               m_sentDeals;
   int               m_sentEvents;

   void              Push(string &items[],const string item,const int cap)
     {
      int n=ArraySize(items);
      if(n>=cap)
        {
         ArrayRemove(items,0,1);
         n--;
        }
      ArrayResize(items,n+1);
      items[n]=item;
     }

   string            Join(string &items[],const int count)
     {
      string out="";
      for(int i=0;i<count;i++)
        {
         if(i>0)
            out+=",";
         out+=items[i];
        }
      return out;
     }

   void              Fail(const string reason)
     {
      m_lastError=reason;
      m_failures++;
      int wait=(int)MathMin(60,3*MathPow(2,MathMin(m_failures-1,5)));
      m_retryAt=TimeLocal()+wait;
     }

public:
   void              Init(string url,const string key,const string token)
     {
      StringTrimLeft(url);
      StringTrimRight(url);
      while(StringLen(url)>0 && StringGetCharacter(url,StringLen(url)-1)=='/')
         url=StringSubstr(url,0,StringLen(url)-1);
      m_url=url;
      m_key=key;
      m_token=token;
      m_enabled=!MQLInfoInteger(MQL_TESTER) && m_url!="" && m_key!="" && m_token!="";
      m_failures=0;
      m_retryAt=0;
      m_sentAcks=0;
      m_sentDeals=0;
      m_sentEvents=0;
      m_lastError="";
      if(MQLInfoInteger(MQL_TESTER))
         m_lastError="off in the Strategy Tester";
      else
         if(m_token=="")
            m_lastError="no robot token. Paste it under the robot's Inputs (right-click the chart > Expert list > Properties)";
         else
            if(m_url=="" || m_key=="")
               m_lastError="no office URL or key";
     }

   bool              Enabled(void)     { return m_enabled; }
   string            LastError(void)   { return m_lastError; }
   bool              ReadyToTry(void)  { return TimeLocal()>=m_retryAt; }
   bool              HasQueued(void)   { return ArraySize(m_acks)+ArraySize(m_deals)+ArraySize(m_events)>0; }

   void              QueueAck(const long id,const string status,const string result)
     {
      if(m_enabled)
         Push(m_acks,"{"+JKey("id")+JInt(id)+","+JKey("status")+JStr(status)+","+JKey("result")+JStr(result)+"}",100);
     }

   void              QueueDeal(const string json)
     {
      if(m_enabled)
         Push(m_deals,json,1000);
     }

   void              QueueEvent(const string kind,const string message)
     {
      if(m_enabled)
         Push(m_events,"{"+JKey("kind")+JStr(kind)+","+JKey("message")+JStr(message)+"}",100);
     }

   // The queued items as JSON members of a report. Remembers what was
   // included, so only those are dropped once the report gets through.
   string            QueuedMembers(void)
     {
      m_sentAcks=ArraySize(m_acks);
      m_sentDeals=(int)MathMin(ArraySize(m_deals),50);
      m_sentEvents=ArraySize(m_events);
      return JKey("acks")+"["+Join(m_acks,m_sentAcks)+"],"
             +JKey("deals")+"["+Join(m_deals,m_sentDeals)+"],"
             +JKey("events")+"["+Join(m_events,m_sentEvents)+"]";
     }

   // report is a full JSON object, or "" for a quick command check.
   bool              Sync(const string report,string &commands,const int timeoutMs=5000)
     {
      commands="";
      if(!m_enabled)
         return false;

      string body="{"+JKey("p_token")+JStr(m_token);
      if(report!="")
         body+=","+JKey("p_report")+report;
      body+="}";

      char data[],result[];
      string resultHeaders;
      int length=StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8);
      if(length>0)
         ArrayResize(data,length-1);   // drop the trailing zero
      // New publishable keys (sb_publishable_...) go in apikey only;
      // legacy anon keys are JWTs and also go in Authorization.
      string headers="Content-Type: application/json\r\napikey: "+m_key+"\r\n";
      if(StringFind(m_key,"eyJ")==0)
         headers+="Authorization: Bearer "+m_key+"\r\n";

      ResetLastError();
      int status=WebRequest("POST",m_url+"/rest/v1/rpc/robot_sync",headers,timeoutMs,data,result,resultHeaders);
      if(status==-1)
        {
         int error=GetLastError();
         if(error==4014)
            Fail("WebRequest is blocked: add "+m_url+" under Tools > Options > Expert Advisors");
         else
            Fail(StringFormat("cannot reach the office (error %d)",error));
         return false;
        }

      string text=CharArrayToString(result,0,WHOLE_ARRAY,CP_UTF8);
      if(status!=200)
        {
         Fail(StringFormat("office replied %d: %s",status,StringSubstr(text,0,160)));
         return false;
        }

      if(report!="")
        {
         if(m_sentAcks>0)
            ArrayRemove(m_acks,0,m_sentAcks);
         if(m_sentDeals>0)
            ArrayRemove(m_deals,0,m_sentDeals);
         if(m_sentEvents>0)
            ArrayRemove(m_events,0,m_sentEvents);
         m_sentAcks=0;
         m_sentDeals=0;
         m_sentEvents=0;
        }

      // The reply is a JSON string: "12:pause;13:start"
      StringTrimLeft(text);
      StringTrimRight(text);
      if(StringLen(text)>=2 && StringGetCharacter(text,0)=='"')
         text=StringSubstr(text,1,StringLen(text)-2);
      commands=text;

      m_failures=0;
      m_retryAt=0;
      m_lastError="";
      return true;
     }
  };

#endif
