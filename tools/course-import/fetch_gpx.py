"""Prepare a GPX and cache public swisstopo/OSM data. Requires Pillow for the mosaic."""
import argparse, concurrent.futures, hashlib, json, math, time, urllib.request, urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image

def main():
    ap=argparse.ArgumentParser();ap.add_argument('gpx',type=Path);ap.add_argument('--work',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);ap.add_argument('--name',required=True);args=ap.parse_args()
    work=args.work.resolve();out=args.output.resolve();work.mkdir(parents=True,exist_ok=True);out.mkdir(parents=True,exist_ok=True)
    previous=work/'manifest.json'
    if previous.exists() and json.loads(previous.read_text(encoding='utf-8'))['inputSha256']!=hashlib.sha256(args.gpx.read_bytes()).hexdigest():raise ValueError('Use a new work folder for a different GPX to avoid stale map data.')
    root=ET.parse(args.gpx).getroot();ns={'g':'http://www.topografix.com/GPX/1/1'}
    if len(root.findall('.//g:trkseg',ns))!=1:raise ValueError('Supply one continuous GPX track segment.')
    points=[]
    for p in root.findall('.//g:trkpt',ns):
        ele=p.find('g:ele',ns)
        q={'lat':float(p.attrib['lat']),'lon':float(p.attrib['lon']),'altitudeM':float(ele.text) if ele is not None else None}
        if q['altitudeM'] is None or not all(math.isfinite(v) for v in q.values()):raise ValueError('GPX needs finite coordinates and elevations.')
        if not 45<q['lat']<48.5 or not 5<q['lon']<11:raise ValueError('This importer is configured for Switzerland.')
        points.append(q)
    if len(points)<3:raise ValueError('Track has too few points.')
    def distance(a,b):return math.hypot((b['lat']-a['lat'])*111320,(b['lon']-a['lon'])*111320*math.cos(math.radians((b['lat']+a['lat'])/2)))
    legs=[distance(a,b) for a,b in zip(points,points[1:])]
    if max(legs)>500:raise ValueError('GPX has a gap larger than 500 m; inspect before importing.')
    length=sum(legs);ascent=sum(max(0,b['altitudeM']-a['altitudeM']) for a,b in zip(points,points[1:]))
    lo=min(p['lon'] for p in points);hi=max(p['lon'] for p in points);south=min(p['lat'] for p in points);north=max(p['lat'] for p in points)
    origin={'lat':(south+north)/2,'lon':(lo+hi)/2};cos=math.cos(math.radians(origin['lat']));padLat=450/111320;padLon=450/(111320*cos)
    zoom=16;n=2**zoom
    tx=lambda lon:math.floor((lon+180)/360*n)
    ty=lambda lat:math.floor((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n)
    imagery={'zoom':zoom,'x0':tx(lo-padLon),'x1':tx(hi+padLon),'y0':ty(north+padLat),'y1':ty(south-padLat),'file':'aerial.jpg','attribution':'SWISSIMAGE © swisstopo'}
    lonAt=lambda x:x/n*360-180;latAt=lambda y:math.degrees(math.atan(math.sinh(math.pi*(1-2*y/n))))
    west=lonAt(imagery['x0']);east=lonAt(imagery['x1']+1);top=latAt(imagery['y0']);bottom=latAt(imagery['y1']+1)
    step=180/2**14
    terrainBounds={'x0':math.floor((west+180)/step),'x1':math.floor((east+180)/step),'y0':math.floor((bottom+90)/step),'y1':math.floor((top+90)/step)}
    waypoints=[{'name':p.findtext('g:name',default='',namespaces=ns),'lat':float(p.attrib['lat']),'lon':float(p.attrib['lon'])} for p in root.findall('g:wpt',ns)]
    manifest={'name':args.name,'origin':origin,'inputSha256':hashlib.sha256(args.gpx.read_bytes()).hexdigest(),'inputName':args.gpx.name,'output':str(out),'imagery':imagery,'terrainBounds':terrainBounds,'bounds':{'west':west,'east':east,'south':bottom,'north':top},'waypoints':waypoints,'summary':{'distanceM':length,'ascentM':ascent,'loopGapM':distance(points[0],points[-1])}}
    (work/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8');(work/'input-route.json').write_text(json.dumps({'summary':manifest['summary'],'points':points,'source':args.gpx.name},ensure_ascii=False),encoding='utf-8')
    (work/'terrain').mkdir(exist_ok=True);(work/'imagery').mkdir(exist_ok=True)
    def download(url,path,data=None):
        if path.exists() and path.stat().st_size>100:return
        for attempt in range(3):
            try:
                request=urllib.request.Request(url,data=data,headers={'User-Agent':'MTBIndoorBern/1.0 (course asset preparation)'})
                with urllib.request.urlopen(request,timeout=90 if data else 35) as response:body=response.read()
                if len(body)<100:raise ValueError('Empty response from '+url)
                tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_bytes(body);tmp.replace(path);return
            except Exception:
                if attempt==2:raise
                time.sleep(1+attempt)
    jobs=[]
    for y in range(imagery['y0'],imagery['y1']+1):
        for x in range(imagery['x0'],imagery['x1']+1):jobs.append((f'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{zoom}/{x}/{y}.jpeg',work/'imagery'/f'{x}-{y}.jpeg'))
    for y in range(terrainBounds['y0'],terrainBounds['y1']+1):
        for x in range(terrainBounds['x0'],terrainBounds['x1']+1):jobs.append((f'https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/20250101/14/{x}/{y}.terrain',work/'terrain'/f'14-{x}-{y}.terrain'))
    print(json.dumps({'points':len(points),'lengthKm':round(length/1000,2),'downloadFiles':len(jobs),'mosaic':[(imagery['x1']-imagery['x0']+1)*256,(imagery['y1']-imagery['y0']+1)*256]}),flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures=[pool.submit(download,*job) for job in jobs]
        for i,f in enumerate(concurrent.futures.as_completed(futures),1):
            f.result()
            if i%60==0:print(f'Cached {i}/{len(jobs)} tiles',flush=True)
    mosaic=Image.new('RGB',((imagery['x1']-imagery['x0']+1)*256,(imagery['y1']-imagery['y0']+1)*256))
    for y in range(imagery['y0'],imagery['y1']+1):
        for x in range(imagery['x0'],imagery['x1']+1):
            with Image.open(work/'imagery'/f'{x}-{y}.jpeg') as tile:mosaic.paste(tile,((x-imagery['x0'])*256,(y-imagery['y0'])*256))
    mosaic.save(out/'aerial.jpg',quality=90,optimize=True)
    # Query public map features once. Crop buildings to the track corridor in the builder.
    bbox=f'{south-padLat},{lo-padLon},{north+padLat},{hi+padLon}'
    query=f'[out:json][timeout:90];(way["natural"="wood"]({bbox});way["landuse"="forest"]({bbox});relation["landuse"="forest"]({bbox});way["highway"]({bbox});way["building"]({bbox}););out geom;'
    (work/'osm-query.txt').write_text(query,encoding='utf-8')
    download('https://overpass-api.de/api/interpreter',work/'osm.json',urllib.parse.urlencode({'data':query}).encode())
    osm=json.loads((work/'osm.json').read_text(encoding='utf-8'))
    if 'remark' in osm:raise ValueError('Incomplete OSM response: '+osm['remark'])
    print(json.dumps({'downloadComplete':True,'osmFeatures':len(osm.get('elements',[])),'aerialBytes':(out/'aerial.jpg').stat().st_size}),flush=True)

if __name__=='__main__':main()
