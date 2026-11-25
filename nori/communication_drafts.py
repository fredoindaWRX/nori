"""Reviewable local drafts. These functions never contact a provider or send."""
from datetime import datetime, timezone
from email.message import EmailMessage
from email import policy
from email.utils import parseaddr
from uuid import uuid4


def email_draft(recipient, subject, body):
    if any(not isinstance(v,str) for v in [recipient,subject,body]): raise ValueError('Draft fields must be text')
    if len(recipient)>320 or len(subject)>200 or len(body)>16000: raise ValueError('Draft field limit exceeded')
    if any(c in recipient+subject for c in '\r\n'): raise ValueError('Email headers cannot contain newlines')
    name,address=parseaddr(recipient)
    if not address or '@' not in address or name or address!=recipient or any(c.isspace() for c in address):
        raise ValueError('Use one plain recipient email address')
    message=EmailMessage(policy=policy.SMTP)
    message['To']=recipient;message['Subject']=subject
    message['X-Unsent']='1'
    message.set_content(body)
    return message.as_string()


def calendar_draft(summary, start, end):
    if not isinstance(summary,str) or not 1<=len(summary)<=200: raise ValueError('Calendar title requires 1 to 200 characters')
    begin,finish=[datetime.fromisoformat(v.replace('Z','+00:00')) for v in [start,end]]
    if begin.tzinfo is None or finish.tzinfo is None or finish<=begin: raise ValueError('Use increasing times with explicit timezone offsets')
    def utc(v): return v.astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    title=summary.replace('\\','\\\\').replace('\r\n','\n').replace('\r','\n').replace('\n','\\n').replace(';','\\;').replace(',','\\,')
    lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//NORI//Local Draft//EN','BEGIN:VEVENT',
           'UID:'+uuid4().hex+'@nori.local','DTSTAMP:'+utc(datetime.now(timezone.utc)),
           'DTSTART:'+utc(begin),'DTEND:'+utc(finish),'SUMMARY:'+title,'END:VEVENT','END:VCALENDAR']
    # Fold to at most 75 UTF-8 bytes per physical line, without splitting characters.
    folded=[]
    for line in lines:
        segment=''
        for char in line:
            if len((segment+char).encode())>75:
                folded.append(segment);segment=' '
            segment+=char
        folded.append(segment)
    return '\r\n'.join(folded)+'\r\n'
