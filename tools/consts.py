import re,json,sys
R='/workspace/videoclaw/repo/app/reconstructed/'
files=['main/chunks/workbookContents-ChzKjQX1.js','main/index.js','preload/index.mjs','main/workbookWorker.js','main/hyperframesPolicyWorker.js','main/hyperframesPreviewWorker.js','main/editorRenderWorker.js','main/chunks/rangeMedia-848zXGXe.js']
rows=[]
for f in files:
    L=open(R+f).read().split('\n')
    i=0
    while i<len(L):
        m=re.match(r'^const ([A-Z][A-Z0-9_]*(?:\$\d+)?) =\s*(.*)$',L[i])
        if m:
            name,val=m.groups(); j=i
            buf=[val]
            # collect until line ending with ; at top level (simple)
            while not buf[-1].rstrip().endswith(';') and j-i<14 and j+1<len(L):
                j+=1; buf.append(L[j].strip())
            v=' '.join(buf).strip()
            complete=v.endswith(';')
            v=re.sub(r'\s+',' ',v).rstrip(';')
            if not complete: v=v[:200]+' …(多行，见源文件)'
            rows.append((name,f,i+1,v))
            i=j
        i+=1
json.dump(rows,open('/workspace/videoclaw/tools/consts.json','w'),ensure_ascii=False)
print(len(rows))
