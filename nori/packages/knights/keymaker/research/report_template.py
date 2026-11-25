"""Render source-linked research as Markdown."""
import html

def clean(text):return html.escape(str(text)).replace('[',r'\[').replace(']',r'\]')

def render(report):
    lines=['# Research: '+clean(report['question']),'', 'Mode: '+report['mode'],'', '## Findings','']
    for finding in report['findings']:
        lines.extend(['- '+clean(finding['claim'])+' '+ ' '.join('['+q['id']+']' for q in finding['evidence']), ''])
        for q in finding['evidence']:lines.extend(['> '+clean(q['quote']).replace('\n','\n> '),''])
    if not report['findings']:lines+=['No supported findings were produced.','']
    lines+=['## Limitations','']+[ '- '+clean(x) for x in report['limitations']]
    lines+=['','## Sources','']
    for s in report['sources']:lines+=['- ['+s['id']+'] '+clean(s['source'])+' (retrieved '+s['retrieved_at']+')']
    return '\n'.join(lines)+'\n'
