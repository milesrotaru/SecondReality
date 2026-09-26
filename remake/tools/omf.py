import struct,sys
def parse(fn):
    d=open(fn,'rb').read(); p=0
    segs={}; lnames=['']; segdefs=[]; pubs=[]; exts=['']; fix=[]
    last=None
    while p<len(d):
        t=d[p]; ln=struct.unpack('<H',d[p+1:p+3])[0]; rec=d[p+3:p+3+ln-1]; p+=3+ln
        if t==0x96:
            q=0
            while q<len(rec):
                n=rec[q]; lnames.append(rec[q+1:q+1+n].decode('latin1')); q+=1+n
        elif t in (0x98,0x99):
            attr=rec[0]; q=1
            if (attr>>5)==0: q+=3
            if t==0x98: length=struct.unpack('<H',rec[q:q+2])[0]; q+=2
            else: length=struct.unpack('<I',rec[q:q+4])[0]; q+=4
            segdefs.append((lnames[rec[q]],length)); segs[len(segdefs)]=bytearray(length)
        elif t in (0xA0,0xA1):
            si=rec[0]; 
            if t==0xA0: off=struct.unpack('<H',rec[1:3])[0]; data=rec[3:]
            else: off=struct.unpack('<I',rec[1:5])[0]; data=rec[5:]
            segs[si][off:off+len(data)]=data; last=(si,off)
        elif t in (0x90,0x91):
            q=0; bg=rec[q]; bs=rec[q+1]; q+=2
            if bs==0 and bg==0: q+=2
            while q<len(rec):
                n=rec[q]; name=rec[q+1:q+1+n].decode('latin1'); q+=1+n
                off=struct.unpack('<H',rec[q:q+2])[0]; q+=2; q+=1
                pubs.append((name,bs,off))
        elif t==0x8C:
            q=0
            while q<len(rec):
                n=rec[q]; exts.append(rec[q+1:q+1+n].decode('latin1')); q+=1+n+1
    return segdefs,segs,pubs
if __name__=='__main__':
    sd,segs,pubs=parse(sys.argv[1])
    print(sd)
    for n,s,o in sorted(pubs,key=lambda x:x[2]): print('%04x %s seg%d'%(o,n,s))
    open(sys.argv[2],'wb').write(segs[1])
