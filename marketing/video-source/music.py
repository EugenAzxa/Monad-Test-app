import numpy as np, wave, struct

SR = 44100
DUR = 36.0
N = int(SR*DUR)
t = np.arange(N)/SR
out = np.zeros(N)

def note_freq(name):
    # name like 'A3','C4'
    names={'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11}
    p=name[:-1]; octv=int(name[-1])
    midi=(octv+1)*12+names[p]
    return 440.0*2**((midi-69)/12)

def adsr(length, a, d, s, r, sus):
    n=int(length*SR)
    env=np.ones(n)*sus
    ai=int(a*SR); di=int(d*SR); ri=int(r*SR)
    if ai>0: env[:ai]=np.linspace(0,1,ai)
    if di>0: env[ai:ai+di]=np.linspace(1,sus,di)
    if ri>0: env[-ri:]=np.linspace(env[-ri] if n-ri>0 else sus,0,ri)
    return env

def add(sig, start):
    i=int(start*SR)
    e=min(i+len(sig), N)
    out[i:e]+=sig[:e-i]

# ---- pad: sustained chords with gentle vibrato + crossfade ----
chords=[
    (['A2','A3','C4','E4'], 0.0),
    (['F2','F3','A3','C4'], 8.0),
    (['C3','C4','E4','G4'], 16.0),
    (['G2','G3','B3','D4'], 24.0),
    (['C3','C4','E4','G4'], 32.0),
]
seg=9.0  # each pad seg length (overlaps next for crossfade)
for notes,start in chords:
    ln=seg
    n=int(ln*SR); tt=np.arange(n)/SR
    sig=np.zeros(n)
    for nm in notes:
        f=note_freq(nm)
        vib=1+0.004*np.sin(2*np.pi*4.5*tt)
        sig+=np.sin(2*np.pi*f*tt*vib)
    sig/=len(notes)
    # soft envelope with long attack/release for crossfade
    env=np.ones(n)
    aa=int(1.6*SR); rr=int(2.2*SR)
    env[:aa]=np.linspace(0,1,aa)
    env[-rr:]=np.linspace(1,0,rr)
    sig*=env*0.16
    add(sig,start)

# ---- soft bass pulse on chord roots ----
roots=[('A1',0.0),('F1',8.0),('C2',16.0),('G1',24.0),('C2',32.0)]
for nm,start in roots:
    f=note_freq(nm)
    for k in range(9):  # gentle pulses
        ns=start+k*1.0
        if ns>=DUR: break
        ln=0.9; n=int(ln*SR); tt=np.arange(n)/SR
        env=np.exp(-tt*3.0)
        sig=np.sin(2*np.pi*f*tt)*env*0.10
        add(sig,ns)

# ---- arpeggio (plucked bell tones) cycling chord tones ----
def pluck(f, ln):
    n=int(ln*SR); tt=np.arange(n)/SR
    env=np.exp(-tt*4.5)
    s=(np.sin(2*np.pi*f*tt)+0.5*np.sin(2*np.pi*2*f*tt)+0.25*np.sin(2*np.pi*3*f*tt))
    return s*env
arp_sets=[['A4','C5','E5','C5'],['A4','C5','F5','C5'],['C5','E5','G5','E5'],['B4','D5','G5','D5'],['C5','E5','G5','C6']]
step=0.5
for ci,(notes,start_pad) in enumerate(chords):
    base=ci*8.0
    seq=arp_sets[ci]
    k=0
    tcur=base
    while tcur < base+8.0 and tcur<DUR:
        f=note_freq(seq[k%len(seq)])
        sig=pluck(f,0.8)*0.09
        add(sig,tcur)
        tcur+=step; k+=1

# ---- feature/accent bells at key moments ----
for nm,start,vol in [('A5',0.4,0.14),('E5',16.2,0.10),('A5',24.2,0.12),('C6',32.2,0.16)]:
    f=note_freq(nm); ln=3.0; n=int(ln*SR); tt=np.arange(n)/SR
    env=np.exp(-tt*1.6)
    s=(np.sin(2*np.pi*f*tt)+0.4*np.sin(2*np.pi*2*f*tt))*env*vol
    add(s,start)

# ---- simple stereo + slap delay for space ----
delay=int(0.28*SR)
echo=np.zeros(N)
echo[delay:]=out[:N-delay]*0.28
out=out+echo

# master fade + normalize
fi=int(2.0*SR); fo=int(3.0*SR)
out[:fi]*=np.linspace(0,1,fi)
out[-fo:]*=np.linspace(1,0,fo)
peak=np.max(np.abs(out))
out=out/peak*0.82

# soft stereo widening
left=out.copy(); right=out.copy()
right[delay//2:]=out[:N-delay//2]*1.0
# clip safety
left=np.clip(left,-1,1); right=np.clip(right,-1,1)

stereo=np.empty((N,2))
stereo[:,0]=left; stereo[:,1]=right
data=(stereo*32767).astype(np.int16)

with wave.open('/root/willvault/video/music.wav','w') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(data.tobytes())
print('music.wav written', DUR, 's')
