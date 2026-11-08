from PIL import Image, ImageDraw
import sys, os
out = os.path.join(os.path.dirname(__file__), "..", "static", "icons")
os.makedirs(out, exist_ok=True)
BG=(18,20,25,255); ACC=(255,77,46,255); FG=(244,245,247,255)
def make(n):
    S=16*n if n<64 else 8*n
    S=max(S,512)
    im=Image.new("RGBA",(S,S),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.rounded_rectangle([0,0,S-1,S-1],radius=S*0.22,fill=BG)
    c=S/2; small=n<=16
    r=S*(0.31 if small else 0.29); w=S*(0.12 if small else 0.075)
    d.ellipse([c-r,c-r,c+r,c+r],outline=ACC,width=int(w))
    tw=S*(0.10 if small else 0.06)
    if not small:
        for dx,dy in((0,-1),(0,1),(-1,0),(1,0)):
            x0,y0=c+dx*S*0.17,c+dy*S*0.17; x1,y1=c+dx*S*0.40,c+dy*S*0.40
            d.line([x0,y0,x1,y1],fill=ACC,width=int(tw))
        d.ellipse([c-S*0.03,c-S*0.03,c+S*0.03,c+S*0.03],fill=ACC)
    k=S*0.30
    # slash: dark outline then white
    d.line([c-k,c+k,c+k,c-k],fill=BG,width=int(S*(0.26 if small else 0.19)))
    d.line([c-k,c+k,c+k,c-k],fill=FG,width=int(S*(0.14 if small else 0.09)))
    return im.resize((n,n),Image.LANCZOS)
for n in (16,32,48,128): make(n).save(f"{out}/{n}.png")
