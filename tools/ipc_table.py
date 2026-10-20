import re,json,sys
R='/workspace/videoclaw/repo/app/reconstructed/'
main=open(R+'main/index.js').read(); pre=open(R+'preload/index.mjs').read()
mlines=main.split('\n')
def ipcobj(src):
    s=src.index('const IPC = {'); e=src.index('\n};',s)
    return re.findall(r'^\s+(\w+): "([^"]+)"',src[s:e],re.M)
mi=ipcobj(main); pi=dict(ipcobj(pre))
# preload bridge
bridge={}
for m in re.finditer(r'^  (\w+): \(([^)]*)\)\s*=>\s*\n?\s*(ipcRenderer\.(invoke|send)\(IPC\.(\w+)|subscribe\(IPC\.(\w+)|webUtils)',pre,re.M):
    name,args,_,kind,k1,k2=m.groups()
    key=k1 or k2
    if key: bridge.setdefault(key,[]).append((name,args,'subscribe' if k2 else kind))
def lineno(pos): return main.count('\n',0,pos)+1
handlers={}
for m in re.finditer(r'ipcMain\.(handle|on|once)\(\s*IPC\.(\w+),\s*([^\n]*)',main):
    kind,key,rest=m.groups()
    sig=rest.strip()
    if not sig or sig in ('(',): sig=mlines[lineno(m.end())].strip()
    handlers.setdefault(key,[]).append((kind,lineno(m.start()),sig[:110]))
sends={}
for m in re.finditer(r'sendToRenderer\(\s*IPC\.(\w+)(,\s*([^\n]*))?',main):
    sends.setdefault(m.group(1),[]).append((lineno(m.start()),(m.group(3) or '').strip()[:90]))
for m in re.finditer(r'\? IPC\.(\w+) : IPC\.(\w+)',main):
    for k in m.groups(): sends.setdefault(k,[]).append((lineno(m.start()),'(replayPendingInteractions 重放)'))
out=[]
for key,ch in mi:
    b=bridge.get(key,[]); h=handlers.get(key,[]); s=sends.get(key,[])
    if h and s: d='双向'
    elif h: d='R→M'
    elif s: d='M→R'
    else: d='—'
    out.append(dict(key=key,channel=ch,inPreload=key in pi,bridge=b,handlers=h,sends=s,dir=d))
json.dump(out,open('/workspace/videoclaw/tools/ipc.json','w'),ensure_ascii=False,indent=1)
print(len(mi),'channels; preload',len(pi))
print('no handler & no send:',[o['channel'] for o in out if o['dir']=='—'])
print('handler but no bridge:',[o['channel'] for o in out if o['handlers'] and not o['bridge']])
print('bridge but no handler:',[o['channel'] for o in out if o['bridge'] and o['bridge'][0][2]!='subscribe' and not o['handlers']])
print('subscribe w/o send:',[o['channel'] for o in out if any(x[2]=='subscribe' for x in o['bridge']) and not o['sends']])
print('kinds',sorted(set(h[0] for o in out for h in o['handlers'])))
print(sum(len(v) for v in bridge.values()),'bridge methods (excl pathForFile)')
