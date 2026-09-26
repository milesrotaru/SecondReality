from s3minfo import load
import struct
def pattern_dec(m,i):
    d=m['d'];o=m['patp'][i]
    if o==0: return None
    ln=struct.unpack('<H',d[o:o+2])[0]
    raw=bytearray(d[o:o+ln])
    for si in range(2,ln): raw[si]^=((si*4)^si)&0xff
    p=2; rows=[]
    for r in range(64):
        row={}
        while True:
            b=raw[p];p+=1
            if b==0: break
            ch=b&31; note=ins=vol=cmd=inf=None
            if b&32: note=raw[p];ins=raw[p+1];p+=2
            if b&64: vol=raw[p];p+=1
            if b&128: cmd=raw[p];inf=raw[p+1];p+=2
            row[ch]=(note,ins,vol,cmd,inf)
        rows.append(row)
    return rows
