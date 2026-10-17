# make-diagrams.py — writes the README's four diagrams (how-it-works, task-lifecycle,
# layers, agent-modes) into docs/media. Edit here and re-run; do not hand-edit the SVGs.
# Each SVG carries light and dark colours (prefers-color-scheme), so it reads on
# GitHub's light and dark themes.   python3 docs/media/make-diagrams.py
import os
OUT=os.path.dirname(os.path.abspath(__file__))
STYLE='''<style>
  text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  .frame { fill: #FFFFFF; stroke: #D0D7DE; }
  .box   { fill: #FFFFFF; stroke: #D0D7DE; }
  .h  { fill: #1F2328; font-weight: 600; }
  .s  { fill: #59636E; }
  .k  { fill: #59636E; font-weight: 600; letter-spacing: .06em; }
  .ln { stroke: #8C959F; fill: none; }
  .ah { fill: #8C959F; }
  .blue   { fill: #0969DA; } .blueS   { stroke: #0969DA; }
  .green  { fill: #1A7F37; } .greenS  { stroke: #1A7F37; }
  .purple { fill: #8250DF; } .purpleS { stroke: #8250DF; }
  .orange { fill: #BC4C00; } .orangeS { stroke: #BC4C00; }
  .gray   { fill: #59636E; } .grayS   { stroke: #8C959F; }
  .zone { fill-opacity: .06; stroke-opacity: .45; }
  .chipT { fill: #FFFFFF; font-weight: 600; }
  @media (prefers-color-scheme: dark) {
    .frame { fill: #0D1117; stroke: #30363D; }
    .box   { fill: #161B22; stroke: #3D444D; }
    .h  { fill: #F0F6FC; } .s, .k { fill: #9198A1; }
    .ln { stroke: #6E7681; } .ah { fill: #6E7681; }
    .blue { fill: #4493F8; } .blueS { stroke: #4493F8; }
    .green { fill: #3FB950; } .greenS { stroke: #3FB950; }
    .purple { fill: #AB7DF8; } .purpleS { stroke: #AB7DF8; }
    .orange { fill: #F0883E; } .orangeS { stroke: #F0883E; }
    .gray { fill: #9198A1; } .grayS { stroke: #6E7681; }
    .zone { fill-opacity: .10; }
    .chipT { fill: #0D1117; }
  }
</style>
<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0,0 L10,5 L0,10 z"/></marker></defs>'''
def svg(name,w,h,title,body):
  s=f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">\n<title>{title}</title>\n{STYLE}\n<rect class="frame" x="0.5" y="0.5" width="{w-1}" height="{h-1}" rx="16"/>\n{body}\n</svg>\n'
  open(os.path.join(OUT,name),'w').write(s)
def T(x,y,txt,cls='s',size=14,anchor='middle',extra=''):
  return f'<text x="{x}" y="{y}" class="{cls}" font-size="{size}" text-anchor="{anchor}" {extra}>{txt}</text>'
def box(x,y,w,h,cls='box',rx=12): return f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}"/>'
def arrow(x1,y1,x2,y2,both=False): return f'<line class="ln" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke-width="2" marker-end="url(#a)"{" marker-start=\"url(#a)\"" if both else ""}/>'

# 1. How it works
b=[]
b.append(f'<rect class="gray grayS zone" x="24" y="56" width="200" height="212" rx="14"/>')
b.append(T(124,42,'CLAUDE','k',13))
b.append(box(44,96,160,132)); b.append(T(124,150,'Claude app','h',17)); b.append(T(124,174,'you ask in chat,')); b.append(T(124,194,'on phone or desktop'))
b.append(f'<rect class="blue blueS zone" x="314" y="56" width="384" height="212" rx="14"/>')
b.append(T(506,42,'YOUR SERVER · NODE.JS ON LINUX','k',13))
for i,(x,name,l1,l2) in enumerate([(330,'server','the tools','Claude calls'),(450,'device','starts and stops','automation'),(570,'agent','looks, decides,','taps and types')]):
  b.append(box(x,88,112,118)); b.append(T(x+56,128,name,'h',17)); b.append(T(x+56,154,l1,'s',13)); b.append(T(x+56,172,l2,'s',13))
b.append(T(506,240,'the agent runs GPT, Claude, Gemini, Jev or the Decisions API','s',13))
b.append(f'<rect class="green greenS zone" x="788" y="56" width="148" height="212" rx="14"/>')
b.append(T(862,42,'YOUR IPHONE','k',13))
b.append(box(804,96,116,132)); b.append(T(862,140,'runner','h',17)); b.append(T(862,166,'XCTest app:','s',13)); b.append(T(862,184,'taps, types,','s',13)); b.append(T(862,202,'screenshots','s',13))
b.append(arrow(208,162,326,162,True)); b.append(T(267,148,'MCP · HTTPS','s',13)); b.append(T(267,186,'Tailscale Funnel','s',12))
b.append(arrow(686,162,800,162,True)); b.append(T(743,148,'Tailscale','s',13)); b.append(T(743,186,'VPN','s',12))
b.append(T(480,304,'The device part reaches the phone with pymobiledevice3 and a patched go-ios. No cable, no Mac, no app to keep open.','s',13))
svg('how-it-works.svg',960,330,'How a task gets from Claude to your iPhone','\n'.join(b))

# 2. One task, start to finish
b=[T(40,46,'One task, start to finish','h',20,'start')]
steps=[('YOU','Ask Claude','in the chat','gray'),('CLAUDE','Calls your','server','gray'),('SERVER','Starts','automation','purple'),('AGENT','Looks, decides,','acts, repeats','purple'),('SERVER','Sends the','answer back','purple'),('SERVER','Stops','automation','green')]
xs=[100+152*i for i in range(6)]
for i,((who,a1,a2,c),x) in enumerate(zip(steps,xs)):
  b.append(f'<circle class="box {c}S" cx="{x}" cy="110" r="22" stroke-width="2.5"/>'); b.append(T(x,116,str(i+1),c,17,extra='font-weight="700"'))
  b.append(T(x,160,who,'k',12)); b.append(T(x,184,a1,'h',15)); b.append(T(x,204,a2,'h',15))
  if i<5: b.append(arrow(x+28,110,xs[i+1]-28,110))
b.append(f'<rect class="purple purpleS zone" x="{xs[2]-60}" y="232" width="{xs[5]-xs[2]+120}" height="36" rx="18"/>')
b.append(T((xs[2]+xs[5])/2,255,'“Automation Running” shows on the phone only during these steps','purple',14,extra='font-weight="600"'))
b.append(T(40,302,'However the task ends (done, failed, stopped, connection lost), step 6 runs.','s',13,'start'))
svg('task-lifecycle.svg',960,324,'One task from start to finish','\n'.join(b))

# 3. Layers
b=[T(40,46,'Four layers, each resting on the one below','h',20,'start')]
rows=[('4','Runner','XCTest app on the iPhone','taps, types, screenshots','purple'),('3','Session','go-ios, patched','keeps the runner alive','purple'),
      ('2','Tunnel','pymobiledevice3','the encrypted channel to iOS','blue'),('1','Network','Tailscale','reaches the phone on any network','green')]
y=72
for i,(n,name,tech,what,c) in enumerate(rows):
  if i==2:
    b.append(f'<line class="orangeS" x1="40" y1="{y+6}" x2="680" y2="{y+6}" stroke-width="1.5" stroke-dasharray="6 5"/>')
    b.append(T(920,y+11,'ended with each task ↑ · kept warm ↓','orange',13,'end',extra='font-weight="600"')); y+=24
  b.append(box(40,y,880,58)); b.append(f'<rect class="{c}" x="40" y="{y}" width="6" height="58" rx="3"/>')
  b.append(T(76,y+36,n,c,22,extra='font-weight="700"')); b.append(T(118,y+36,name,'h',17,'start'))
  b.append(T(300,y+36,tech,'s',15,'start')); b.append(T(560,y+36,what,'s',15,'start')); y+=70
svg('layers.svg',960,y+20,'The four layers that let a server drive an unplugged iPhone','\n'.join(b))

# 4. Agent modes
b=[T(40,46,'Three ways to drive the phone','h',20,'start'), T(40,72,'Each step the agent reads the screen and does one thing. What differs is who chooses.','s',14,'start')]
cards=[('LLM','GPT · Claude · Gemini',['Gets the screenshot','and the element list','','Writes the next action','itself: tap("Save")'],'20','gray'),
       ('Decision model','Jev · OpenAI Decisions API',['Gets the element list','The agent lists every','possible action','','Picks one, with a','probability for each'],'2','blue'),
       ('Hybrid, sticky','decision model + LLM',['The decision model','picks most steps','','Unsure, typing, done','or stuck: the LLM takes','over until it hands back'],'24','purple')]
for i,(name,who,lines,score,c) in enumerate(cards):
  x=40+300*i
  b.append(f'<rect class="{c} {c}S zone" x="{x}" y="96" width="280" height="290" rx="14"/>')
  b.append(T(x+20,128,name,'h',18,'start')); b.append(T(x+20,150,who,'s',13,'start'))
  yy=186
  for l in lines:
    if l: b.append(T(x+20,yy,l,'s',15,'start'))
    yy+=22 if l else 12
  b.append(f'<rect class="{c}" x="{x+20}" y="330" width="96" height="34" rx="17"/>')
  b.append(T(x+68,353,f'{score} / 27','chipT',16)); b.append(T(x+128,352,'iOSWorld tasks','s',13,'start'))
b.append(T(40,412,'Real passes on iOSWorld’s 27 single-app tasks, simulator, one trial: LLM = GPT-6 Luna, decision model = Decisions API, hybrid = both.','s',12,'start'))
svg('agent-modes.svg',960,430,'Three ways the agent can drive the phone: an LLM, a decision model, or a hybrid','\n'.join(b))
print('written')
