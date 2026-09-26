import struct,sys
def load(fn):
    d=open(fn,'rb').read()
    title=d[:28].split(b'\0')[0]
    ordnum,insnum,patnum,flags,cwt,ffi=struct.unpack('<6H',d[0x20:0x2c])
    gv,is_,it,mv,uc,dp=struct.unpack('<6B',d[0x30:0x36])
    chset=list(d[0x40:0x60])
    orders=list(d[0x60:0x60+ordnum])
    p=0x60+ordnum
    insp=[struct.unpack('<H',d[p+2*i:p+2*i+2])[0]*16 for i in range(insnum)]
    p+=2*insnum
    patp=[struct.unpack('<H',d[p+2*i:p+2*i+2])[0]*16 for i in range(patnum)]
    p+=2*patnum
    pan=list(d[p:p+32]) if dp==252 else None
    return dict(d=d,title=title,ordnum=ordnum,insnum=insnum,patnum=patnum,flags=flags,cwt=cwt,ffi=ffi,gv=gv,is_=is_,it=it,mv=mv,chset=chset,orders=orders,insp=insp,patp=patp,pan=pan)
def pattern(m,i):
    d=m['d'];o=m['patp'][i]
    if o==0: return [[None]*32 for _ in range(64)]
    ln=struct.unpack('<H',d[o:o+2])[0]; p=o+2
    rows=[]
    for r in range(64):
        row={}
        while True:
            b=d[p];p+=1
            if b==0: break
            ch=b&31; note=ins=vol=cmd=inf=None
            if b&32: note=d[p];ins=d[p+1];p+=2
            if b&64: vol=d[p];p+=1
            if b&128: cmd=d[p];inf=d[p+1];p+=2
            row[ch]=(note,ins,vol,cmd,inf)
        rows.append(row)
    return rows
if __name__=='__main__':
    m=load(sys.argv[1])
    print(m['title'],'ord',m['ordnum'],'ins',m['insnum'],'pat',m['patnum'],'flags',m['flags'],'cwt',hex(m['cwt']),'gv',m['gv'],'speed',m['is_'],'tempo',m['it'],'mv',m['mv'])
    print('chset',m['chset']); print('orders',m['orders']); print('pan',m['pan'])
    for i,o in enumerate(m['insp']):
        d=m['d'];t=d[o]
        name=d[o+48:o+76].split(b'\0')[0]
        fn=d[o+1:o+13].split(b'\0')[0]
        ln,ls,le=struct.unpack('<3I',d[o+16:o+28]); vol=d[o+28]; fl=d[o+31]; c2=struct.unpack('<I',d[o+32:o+36])[0]
        print(i+1,t,fn,name,ln,ls,le,vol,fl,c2)
    cmds={}
    for pi in range(m['patnum']):
        for r,row in enumerate(pattern(m,pi)):
            for ch,(n,ins,v,c,inf) in row.items():
                if c: 
                    L=chr(64+c)
                    cmds.setdefault(L,set()).add(inf)
                    if L in 'Z': print('pat',pi,'row',r,'ch',ch,L,hex(inf))
    for k in sorted(cmds): print(k,sorted(cmds[k])[:40])
