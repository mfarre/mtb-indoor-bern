"""Prepare the official Eiger 20 km GPX, Swiss imagery and Alpine terrain.

Requires Python with Pillow, Node.js, and the sibling course-import tools.
Network downloads are cached. Use a new work directory for a revised GPX.
"""
from pathlib import Path
import argparse,bisect,concurrent.futures,gzip,hashlib,json,math,socket,struct,subprocess,sys,urllib.error,urllib.request

GPX_URL='https://www.eigerbike.ch/wp-content/uploads/gpx/ebc20km.gpx'
PDF_URL='https://www.eigerbike.ch/wp-content/uploads/profile/Track-20-EBC.pdf'
ap=argparse.ArgumentParser(description=__doc__)
ap.add_argument('--work',type=Path,required=True)
ap.add_argument('--output',type=Path,required=True)
ap.add_argument('--node',default='node')
ap.add_argument('--reuse-built',action='store_true',help='Reuse the completed generic importer output in this work directory')
a=ap.parse_args();work=a.work.resolve();out=a.output.resolve();work.mkdir(parents=True,exist_ok=True);out.mkdir(parents=True,exist_ok=True)
generic=Path(__file__).resolve().parents[1]/'course-import'
gpx=work/'ebc20km.gpx';geo=work/'geodata';headers={}
def download(url,path):
    if path.exists():return
    req=urllib.request.Request(url,headers={'User-Agent':'MTBIndoorBern/1.0 (course preparation)'})
    try:response=urllib.request.urlopen(req,timeout=50)
    except urllib.error.URLError as exc:
        if not isinstance(exc.reason,socket.gaierror) or not url.startswith('https://www.eigerbike.ch/'):raise
        # Some resolvers omit the official site's www record. Resolve only that
        # host through the same site's apex; HTTPS host and certificate stay www.
        original_resolver=socket.getaddrinfo
        socket.getaddrinfo=lambda host,*args,**kwargs:original_resolver('eigerbike.ch' if host=='www.eigerbike.ch' else host,*args,**kwargs)
        try:response=urllib.request.urlopen(req,timeout=50)
        finally:socket.getaddrinfo=original_resolver
    with response as r:
        content=r.read()
        if url==GPX_URL:headers.update(dict(r.headers))
    if len(content)<100:raise ValueError('Empty resource: '+url)
    path.write_bytes(content)
if not gpx.exists():download(GPX_URL,gpx)
if headers:(work/'official-source-headers.json').write_text(json.dumps(headers,indent=2),encoding='utf-8')
if not a.reuse_built:
    subprocess.run([sys.executable,str(generic/'fetch_gpx.py'),str(gpx),'--work',str(geo),'--output',str(out),'--name','Eiger Bike Challenge 20 km'],check=True)
    subprocess.run([a.node,str(generic/'build_course.mjs'),str(geo)],check=True)
    (geo/'base-route.json').write_bytes((out/'route.json').read_bytes())
elif not (geo/'base-route.json').exists():(geo/'base-route.json').write_bytes((out/'route.json').read_bytes())
config=json.loads((geo/'manifest.json').read_text(encoding='utf-8'))
route=json.loads((geo/'base-route.json').read_text(encoding='utf-8'))
world=json.loads((out/'world.json').read_text(encoding='utf-8'))
validation=json.loads((geo/'elevation-validation.json').read_text(encoding='utf-8'))
origin=route['origin'];sx=111320*math.cos(math.radians(origin['lat']));sz=111320
local=lambda lat,lon:((lon-origin['lon'])*sx,-(lat-origin['lat'])*sz)

# Preserve actual GPX hairpin vertices that a uniform 5 m chord can skip.
# This fixes artificial grades when two points lie almost opposite each other
# across a turn, without clipping slopes or changing the altitude profile.
raw=json.loads((geo/'input-route.json').read_text(encoding='utf-8'))['points'];path=[]
for q in raw:
    x,z=local(q['lat'],q['lon'])
    if not path or math.hypot(x-path[-1]['x'],z-path[-1]['z'])>1.5:path.append({'x':x,'z':z})
smooth=[];length=0
for i,p in enumerate(path):
    before=path[max(0,i-1)];after=path[min(len(path)-1,i+1)]
    q={'x':(before['x']+2*p['x']+after['x'])/4,'z':(before['z']+2*p['z']+after['z'])/4}
    if smooth:length+=math.hypot(q['x']-smooth[-1]['x'],q['z']-smooth[-1]['z'])
    q['d']=length;smooth.append(q)
for q in smooth:q['d']*=route['length']/length
distances=[q['d'] for q in smooth];ps=route['points'];fixed=[];added=0
for i,p in enumerate(ps[:-1]):
    fixed.append(p);end=ps[i+1];delta=end['d']-p['d'];chord=math.hypot(end['x']-p['x'],end['z']-p['z'])
    if chord>=delta*.75:continue
    left=bisect.bisect_right(distances,p['d']+.001);right=bisect.bisect_left(distances,end['d']-.001)
    for q in smooth[left:right]:
        t=(q['d']-p['d'])/delta;y=p['y']+(end['y']-p['y'])*t
        fixed.append({'d':round(q['d'],4),'x':round(q['x'],3),'z':round(q['z'],3),'y':round(y,3),'alt':round(y-.2,3),'grade':0});added+=1
fixed.append(ps[-1]);route['points']=fixed
for p,q in zip(fixed,fixed[1:]):
    span=math.hypot(q['x']-p['x'],q['z']-p['z'])
    if span<.01:raise ValueError('Degenerate route edge')
    p['grade']=round((q['y']-p['y'])/span*100,4)
fixed[-1]['grade']=fixed[-2]['grade'];route['source']=GPX_URL

# Low-resolution far mesh covers the Eiger, Monch, Jungfrau and Wetterhorn.
# Its real heights and coordinates share the route origin and terrain datum.
far=work/'alpine-terrain';far.mkdir(exist_ok=True);zoom=12;step=180/2**zoom
bounds={'west':7.90,'east':8.20,'south':46.52,'north':46.71}
tile_bounds={'x0':math.floor((bounds['west']+180)/step),'x1':math.floor((bounds['east']+180)/step),'y0':math.floor((bounds['south']+90)/step),'y1':math.floor((bounds['north']+90)/step)}
jobs=[]
for y in range(tile_bounds['y0'],tile_bounds['y1']+1):
    for x in range(tile_bounds['x0'],tile_bounds['x1']+1):jobs.append((f'https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/20250101/{zoom}/{x}/{y}.terrain',far/f'{zoom}-{x}-{y}.terrain'))
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(lambda j:download(*j),jobs))
vertices=[];indices=[]
for _,file in jobs:
    b=file.read_bytes()
    if b[:2]==b'\x1f\x8b':b=gzip.decompress(b)
    _,tx,ty=map(int,file.stem.split('-'));lo,hi=struct.unpack_from('<ff',b,24);n=struct.unpack_from('<I',b,88)[0];offset=92;arrays=[]
    for axis in range(3):
        previous=0;values=[]
        for code in struct.unpack_from('<'+'H'*n,b,offset):previous+=(code>>1)^-(code&1);values.append(previous)
        offset+=n*2;arrays.append(values)
    size=4 if n>65536 else 2;offset=math.ceil(offset/size)*size;count=struct.unpack_from('<I',b,offset)[0];offset+=4
    highest=0;tri=[]
    for code in struct.unpack_from('<'+('I' if size==4 else 'H')*(count*3),b,offset):
        tri.append(highest-code)
        if code==0:highest+=1
    start=len(vertices)//3;u,v,h=arrays
    for i in range(n):
        x,z=local(ty*step-90+v[i]/32767*step,tx*step-180+u[i]/32767*step)
        vertices.extend([round(x,2),round(lo+h[i]/32767*(hi-lo)-validation['datumOffsetM'],2),round(z,2)])
    indices.extend(index+start for index in tri)
world['alpineTerrain']={'vertices':vertices,'indices':indices,'zoom':zoom,'tileBounds':tile_bounds,'bounds':bounds,'source':'Terrain © swisstopo, quantized mesh 20250101','datumOffsetM':validation['datumOffsetM']}
for i,t in enumerate(world['trees']):t[4]=1 if t[1]>1400 or i%4 else 0
world['sources']=['Terrain and SWISSIMAGE © swisstopo','© OpenStreetMap contributors — ODbL','Route: official Eiger Bike Challenge 20 km GPX']
appearance=json.loads((out/'appearance.json').read_text(encoding='utf-8'));appearance['season']='summer'
appearance['notes']='Summer rendering. Surfaces and widths are inferred from OpenStreetMap; tree locations use mapped forest footprints, with illustrative alpine conifer/broadleaf species. Race props are illustrative and do not alter route geometry.'
handling={'version':1,'descent':{'id':'eiger-upper-descent','name':'Eiger · upper traverse and descent','start':8250,'end':13030}}
sectors=[{'id':'climb','name':'Grindelwald climb','start':0,'end':8250},{'id':'descent','name':'Upper traverse & descent','start':8250,'end':13030},{'id':'finish','name':'Mühlebach & finish','start':13030,'end':route['length']}]
metadata={}
if (work/'official-source-headers.json').exists():metadata=json.loads((work/'official-source-headers.json').read_text(encoding='utf-8'))
provenance={'name':route['name'],'prepared':'2026-11-22','routeSource':'Official downloadable Eiger Bike Challenge 20 km GPX; title EBC-20KM, creator MySchweizMobil','routeUrl':GPX_URL,'profileUrl':PDF_URL,'sourceLastModified':metadata.get('Last-Modified'),'inputSha256':hashlib.sha256(gpx.read_bytes()).hexdigest(),'nominalDistanceKm':20,'advertisedAscentM':900,'measuredDistanceM':route['length'],'smoothedAscentM':route['ascent'],'originalPointCount':len(raw),'loopGapM':config['summary']['loopGapM'],'routeMethod':'Resample at 5 m with approximately 40 m altitude smoothing; preserve interior GPX corner vertices when a short chord would cause a false steep grade. Road, HUD, physics and trainer share the same profile. Original 35.48 m finish/start gap retained; no artificial closing connector.','cornerVerticesRetained':added,'sectorMethod':'Three app-defined training starts, not official timed sectors','sectors':sectors,'imagerySource':'SWISSIMAGE © swisstopo','imageryZoom':16,'imageryPixels':[3072,3072],'terrainSource':'Terrain © swisstopo, quantized mesh 20250101; zoom14 near route, zoom12 Alpine backdrop','terrainDatumOffsetM':validation['datumOffsetM'],'mapSource':'© OpenStreetMap contributors — ODbL','raceAccessNote':'The organiser marks some sections as race-day-only. This is an indoor reconstruction, not outdoor navigation or an access guarantee.','visualLimitations':'Summer materials, vegetation species, spectators and race furniture are interpretations. Reference photos are not bundled as textures.','urls':['https://www.eigerbike.ch/en/race/profiles/','https://www.eigerbike.ch/en/race/informations/',GPX_URL,PDF_URL,'https://docs.geo.admin.ch/visualize-data/xyz.html','https://docs.geo.admin.ch/visualize-data/terrain-service.html','https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices','https://www.openstreetmap.org/copyright']}
for name,data in [('route',route),('world',world),('appearance',appearance),('handling',handling),('sectors',sectors),('provenance',provenance)]:
    (out/(name+'.json')).write_text(json.dumps(data,ensure_ascii=False,separators=(',',':') if name in {'route','world'} else None,indent=None if name in {'route','world'} else 2)+'\n',encoding='utf-8')
report={'length':route['length'],'ascent':route['ascent'],'points':len(fixed),'cornerVerticesRetained':added,'gradeMin':min(p['grade'] for p in fixed),'gradeMax':max(p['grade'] for p in fixed),'datumOffsetM':validation['datumOffsetM'],'oppositeGrades':sum(p['grade']*(q['y']-p['y'])<0 for p,q in zip(fixed,fixed[1:])),'maxGradeErrorPercent':max(abs(p['grade']-(q['y']-p['y'])/math.hypot(q['x']-p['x'],q['z']-p['z'])*100) for p,q in zip(fixed,fixed[1:])),'alpineTiles':len(jobs),'alpineVertices':len(vertices)//3,'alpineTriangles':len(indices)//3,'alpineMaxElevation':max(vertices[1::3]),'sectors':sectors}
(work/'course-verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
source_check=work/'raw-elevation-comparison.json'
if source_check.exists():
    source_validation=json.loads(source_check.read_text(encoding='utf-8'))
    if source_validation.get('inputSha256')==provenance['inputSha256']:
        report['sourceElevationComparison']=source_validation
        provenance['rawElevationComparison']={key:value for key,value in source_validation.items() if key!='marmorbruchSteepSection'}
provenance['elevationVerificationFile']='elevation-verification.json'
(out/'provenance.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(out/'elevation-verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report),flush=True)
