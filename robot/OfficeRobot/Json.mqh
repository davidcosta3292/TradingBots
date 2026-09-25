//+------------------------------------------------------------------+
//| Json.mqh                                                         |
//| Just enough JSON to write reports for the office.                |
//+------------------------------------------------------------------+
#ifndef OFFICE_JSON_MQH
#define OFFICE_JSON_MQH

string JsonEscape(string s)
  {
   StringReplace(s,"\\","\\\\");
   StringReplace(s,"\"","\\\"");
   StringReplace(s,"\r","\\r");
   StringReplace(s,"\n","\\n");
   StringReplace(s,"\t","\\t");
   return s;
  }

string JKey(const string key)
  {
   return "\""+key+"\":";
  }

string JStr(const string value)
  {
   return "\""+JsonEscape(value)+"\"";
  }

string JNum(const double value,const int digits=2)
  {
   if(!MathIsValidNumber(value))
      return "null";
   return DoubleToString(value,digits);
  }

string JInt(const long value)
  {
   return IntegerToString(value);
  }

string JBool(const bool value)
  {
   return value ? "true" : "false";
  }

#endif
