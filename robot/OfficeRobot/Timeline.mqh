// Observational only: this journal never authorizes, retries or cancels an order.
#ifndef OFFICE_TIMELINE_MQH
#define OFFICE_TIMELINE_MQH
#include "Clock.mqh"
#include "Json.mqh"

struct SDecisionRef
  {
   string check_id,attempt_id,version;
   datetime bar_at;
   ulong order;
   uint request_id;
  };

string TicketString(const ulong ticket) { return StringFormat("%I64u",ticket); }

string DecisionId(const string version,const datetime bar)
  { return version+"/"+JInt((long)bar); }

bool TraceComment(const string comment,SDecisionRef &ref)
  {
   string parts[];
   if(StringSplit(comment,'|',parts)!=4 || parts[0]!="TO") return false;
   if(StringLen(parts[1])<1 || StringLen(parts[1])>16 || StringLen(parts[3])<1 || StringLen(parts[3])>9) return false;
   for(int i=0;i<StringLen(parts[1]);i++)
     { ushort c=StringGetCharacter(parts[1],i); if(c!='.' && (c<'0' || c>'9')) return false; }
   for(int p=2;p<4;p++)
      for(int i=0;i<StringLen(parts[p]);i++)
        { ushort c=StringGetCharacter(parts[p],i); if(c<'0' || c>'9') return false; }
   long epoch=StringToInteger(parts[2]);
   if(epoch<1262304000 || epoch>4102444800) return false;
   ref.version=parts[1]; ref.bar_at=(datetime)epoch;
   ref.check_id=DecisionId(ref.version,ref.bar_at); ref.attempt_id=ref.check_id+"/"+parts[3];
   ref.order=0; ref.request_id=0;
   return true;
  }

string ResponseStage(const bool ok,const uint code)
  {
   if(code==TRADE_RETCODE_DONE || code==TRADE_RETCODE_DONE_PARTIAL || code==TRADE_RETCODE_PLACED) return ok ? "accepted" : "unknown";
   if(code==0 || code==TRADE_RETCODE_TIMEOUT || code==TRADE_RETCODE_CONNECTION || code==TRADE_RETCODE_ERROR) return "unknown";
   return "rejected";
  }

string TradeResponseJson(const MqlTradeRequest &request,const MqlTradeResult &result,
                         const bool ok,const int terminalError=0,const long durationUs=0)
  {
   return "{"+JKey("call_ok")+JBool(ok)+","+JKey("retcode")+JInt(result.retcode)
      +","+JKey("retcode_external")+JInt(result.retcode_external)+","+JKey("request_id")+JInt(result.request_id)
      +","+JKey("order_ticket")+JStr(TicketString(result.order))+","+JKey("deal_ticket")+JStr(TicketString(result.deal))
      +","+JKey("result_volume")+JNum(result.volume,8)+","+JKey("result_price")+JNum(result.price,5)
      +","+JKey("message")+JStr(StringSubstr(result.comment,0,160))
      +","+JKey("action")+JInt(request.action)+","+JKey("side")+JStr(request.type==ORDER_TYPE_BUY ? "buy" : "sell")
      +","+JKey("symbol")+JStr(request.symbol)+","+JKey("magic")+JInt((long)request.magic)
      +","+JKey("position_ticket")+JStr(TicketString(request.position))
      +","+JKey("requested_volume")+JNum(request.volume,8)+","+JKey("requested_price")+JNum(request.price,5)
      +","+JKey("stop")+JNum(request.sl,5)+","+JKey("target")+JNum(request.tp,5)
      +","+JKey("terminal_error")+JInt(terminalError)+","+JKey("duration_us")+JInt(durationUs)+"}";
  }

class CDecisionJournal
  {
private:
   bool m_enabled;
   int m_file;
   string m_ackPath,m_error,m_memory[];
   ulong m_ack,m_batchEnd;
   int m_sentMemory,m_gaps;
   SDecisionRef m_refs[];

   void MemoryPush(const string line)
     {
      int n=ArraySize(m_memory);
      if(n>=200) { ArrayRemove(m_memory,0,1); n--; m_gaps++; }
      ArrayResize(m_memory,n+1); m_memory[n]=line;
     }

public:
   void Init(const string token,const string symbol,const long magic,const bool enabled)
     {
      m_enabled=enabled; m_file=INVALID_HANDLE; m_ack=0; m_batchEnd=0; m_sentMemory=0; m_gaps=0; m_error="";
      ArrayResize(m_memory,0); ArrayResize(m_refs,0);
      if(!m_enabled) return;
      uchar data[],key[],hash[];
      string identity=token+"|"+AccountInfoString(ACCOUNT_SERVER)+"|"+JInt(AccountInfoInteger(ACCOUNT_LOGIN))+"|"+symbol+"|"+JInt(magic);
      int n=StringToCharArray(identity,data,0,WHOLE_ARRAY,CP_UTF8); if(n>0) ArrayResize(data,n-1);
      if(CryptEncode(CRYPT_HASH_SHA256,data,key,hash)<=0)
        { m_error="Journal identity hash failed; memory queue only"; return; }
      string fingerprint="";
      for(int i=0;i<ArraySize(hash);i++) fingerprint+=StringFormat("%02x",hash[i]);
      FolderCreate("OfficeTimeline");
      string path="OfficeTimeline\\"+fingerprint;
      m_ackPath=path+".ack";
      ResetLastError();
      m_file=FileOpen(path+".jsonl",FILE_READ|FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_SHARE_READ,0,CP_UTF8);
      if(m_file==INVALID_HANDLE)
        { m_error=StringFormat("Journal open failed (%d); memory queue only",GetLastError()); return; }
      int ackFile=FileOpen(m_ackPath,FILE_READ|FILE_TXT|FILE_ANSI,0,CP_UTF8);
      if(ackFile!=INVALID_HANDLE)
        {
         long offset=StringToInteger(FileReadString(ackFile)); FileClose(ackFile);
         if(offset>=0 && (ulong)offset<=FileSize(m_file)) m_ack=(ulong)offset;
         else { m_gaps++; m_error="Invalid journal checkpoint; replaying retained events"; }
        }
      // A newline isolates a crash-interrupted last record from future records.
      FileSeek(m_file,0,SEEK_END);
      if(FileSize(m_file)>0) { FileWriteString(m_file,"\n"); FileFlush(m_file); }
     }

   void Close(void) { if(m_file!=INVALID_HANDLE) FileClose(m_file); m_file=INVALID_HANDLE; }
   bool HasPending(void) { return ArraySize(m_memory)>0 || (m_file!=INVALID_HANDLE && FileSize(m_file)>m_ack); }
   string Health(void)
     {
      return "{"+JKey("enabled")+JBool(m_enabled)+","+JKey("durable")+JBool(m_file!=INVALID_HANDLE)
         +","+JKey("pending")+JBool(HasPending())+","+JKey("gaps")+JInt(m_gaps)+","+JKey("error")+JStr(m_error)+"}";
     }

   void Remember(const SDecisionRef &ref)
     {
      for(int i=0;i<ArraySize(m_refs);i++)
         if(m_refs[i].attempt_id==ref.attempt_id)
           {
            ulong order=m_refs[i].order; uint requestId=m_refs[i].request_id; m_refs[i]=ref;
            if(ref.order==0) m_refs[i].order=order; if(ref.request_id==0) m_refs[i].request_id=requestId; return;
           }
      int n=ArraySize(m_refs); if(n>=64) { ArrayRemove(m_refs,0,1); n--; }
      ArrayResize(m_refs,n+1); m_refs[n]=ref;
     }
   bool Find(const ulong order,const uint requestId,SDecisionRef &ref)
     {
      for(int i=ArraySize(m_refs)-1;i>=0;i--)
         if((order>0 && m_refs[i].order==order) || (requestId>0 && m_refs[i].request_id==requestId))
           { ref=m_refs[i]; return true; }
      return false;
     }

   void Record(const string id,const SDecisionRef &ref,const string kind,const string stage,
               const string entryPoint,const string payload,const datetime occurred=0)
     {
      if(!m_enabled) return;
      string line="{"+JKey("event_id")+JStr(id)+","+JKey("check_id")+(ref.check_id=="" ? "null" : JStr(ref.check_id))
         +","+JKey("attempt_id")+(ref.attempt_id=="" ? "null" : JStr(ref.attempt_id))
         +","+JKey("bar_at")+(ref.bar_at==0 ? "null" : JInt((long)ref.bar_at))
         +","+JKey("version")+JStr(ref.version=="" ? "unknown" : ref.version)
         +","+JKey("kind")+JStr(kind)+","+JKey("stage")+JStr(stage)
         +","+JKey("at")+JInt((long)(occurred>0 ? occurred : ClockGmt()))
         +","+JKey("entry_point")+JStr(entryPoint)+","+JKey("payload")+payload+"}";
      Print("[Office][timeline] ",line);
      if(StringLen(line)>28000) { m_gaps++; m_error="Oversized telemetry record omitted"; return; }
      if(m_file==INVALID_HANDLE) { MemoryPush(line); return; }
      FileSeek(m_file,0,SEEK_END); ResetLastError();
      uchar encoded[]; int expected=StringToCharArray(line+"\r\n",encoded,0,WHOLE_ARRAY,CP_UTF8)-1;
      uint written=FileWriteString(m_file,line+"\n"); FileFlush(m_file);
      if(written!=(uint)expected || GetLastError()!=0)
        {
         m_error="Journal write failed; memory queue only until reattach";
         FileClose(m_file); m_file=INVALID_HANDLE; MemoryPush(line);
        }
     }

   // A successful full robot_sync is the only acknowledgement. Retried records
   // have stable IDs; the database ignores duplicates, never resubmits orders.
   string Batch(void)
     {
      string out=""; int count=0; m_batchEnd=m_ack; m_sentMemory=0;
      if(m_file!=INVALID_HANDLE)
        {
         FileSeek(m_file,(long)m_ack,SEEK_SET);
         while(!FileIsEnding(m_file) && count<20 && StringLen(out)<150000)
           {
            string line=FileReadString(m_file); m_batchEnd=FileTell(m_file);
            if(line=="") continue;
            if(StringLen(line)>28000 || StringGetCharacter(line,0)!='{' || StringGetCharacter(line,StringLen(line)-1)!='}')
              { m_gaps++; m_error="Incomplete journal record skipped; telemetry gap recorded"; continue; }
            if(out!="") out+=","; out+=line; count++;
           }
         FileSeek(m_file,0,SEEK_END);
        }
      for(int i=0;i<ArraySize(m_memory) && count<20 && StringLen(out)<150000;i++)
        { if(out!="") out+=","; out+=m_memory[i]; m_sentMemory++; count++; }
      return "["+out+"]";
     }
   void AcknowledgeBatch(void)
     {
      if(m_file!=INVALID_HANDLE && m_batchEnd>m_ack)
        {
         string temp=m_ackPath+".tmp";
         ResetLastError();
         int file=FileOpen(temp,FILE_WRITE|FILE_TXT|FILE_ANSI,0,CP_UTF8);
         if(file==INVALID_HANDLE) { m_error="Checkpoint unavailable; events will be replayed"; return; }
         uint written=FileWriteString(file,JInt((long)m_batchEnd)); FileFlush(file); int err=GetLastError(); FileClose(file);
         if(written==0 || err!=0 || !FileMove(temp,0,m_ackPath,FILE_REWRITE))
           { m_error="Checkpoint failed; events will be replayed"; return; }
         m_ack=m_batchEnd;
        }
      if(m_sentMemory>0) ArrayRemove(m_memory,0,m_sentMemory);
      m_sentMemory=0;
     }
  };
#endif
