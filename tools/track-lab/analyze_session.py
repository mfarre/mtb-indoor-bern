"""Extract upright reference frames and a FIT-linked index without changing originals."""
import argparse, bisect, datetime as dt, json, pathlib, subprocess, shutil
from PIL import Image, ImageDraw

def run(args):
    return subprocess.run([str(a) for a in args], check=True, capture_output=True, text=True).stdout

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('session',type=pathlib.Path)
    ap.add_argument('--ffmpeg',type=pathlib.Path,required=True)
    ap.add_argument('--interval',type=int,default=60)
    ap.add_argument('--offset',type=float,default=0,help='Seconds added to camera UTC to obtain FIT UTC')
    ap.add_argument('--rotation',type=int,choices=[0,180],default=180)
    args=ap.parse_args(); session=args.session.resolve()
    ff=pathlib.Path(shutil.which(str(args.ffmpeg)) or args.ffmpeg).resolve(); probe=ff.with_name('ffprobe.exe')
    if not ff.is_file() or not probe.is_file():raise FileNotFoundError('Cal configurar ffmpeg.exe i ffprobe.exe a la mateixa carpeta.')
    frames=session/'frames'; frames.mkdir(exist_ok=True)
    track=json.loads((session/'track.json').read_text(encoding='utf-8'))
    pts=track['points']; times=[p['time'] for p in pts]
    videos=[]; entries=[]
    available=sorted((session/'originals/video').rglob('*'))
    proxies=[p for p in available if p.suffix.lower()=='.lrf']
    stems={p.stem for p in proxies}
    sources=sorted(proxies+[p for p in available if p.suffix.lower() in ('.mp4','.mov') and p.stem not in stems])
    if not sources: raise ValueError('No videos found')
    for video in sources:
        meta=json.loads(run([probe,'-v','quiet','-show_format','-show_streams','-of','json',video]))
        (session/(video.stem+'-metadata.json')).write_text(json.dumps(meta,indent=2),encoding='utf-8')
        stream=next(s for s in meta['streams'] if s['codec_type']=='video' and not s['disposition']['attached_pic'])
        start=meta['format']['tags']['creation_time']; epoch=dt.datetime.fromisoformat(start.replace('Z','+00:00')).timestamp()
        duration=float(stream['duration']); vi=len(videos)
        preview=session/'preview'; preview.mkdir(exist_ok=True)
        playable=preview/(video.stem+'.mp4')
        if not playable.exists():
            # Remux only: original pixels/audio, rotation handled by the viewer.
            codec=['-c','copy'] if stream['codec_name']=='h264' else ['-vf','scale=-2:720','-c:v','libx264','-preset','veryfast','-crf','24','-c:a','aac']
            partial=playable.with_suffix('.partial.mp4')
            run([ff,'-v','error','-nostdin','-y','-noautorotate','-i',video,'-map','0:v:0','-map','0:a:0?','-map_metadata','-1',*codec,'-movflags','+faststart',partial])
            partial.replace(playable)
        videos.append({'file':playable.relative_to(session).as_posix(),'original':video.relative_to(session).as_posix(),'name':video.name,'start':start,'epoch':epoch,'duration':duration,'width':stream['width'],'height':stream['height'],'rotation':args.rotation})
        high=video.with_suffix('.MP4')
        if high.exists():videos[-1]['highResolution']=high.relative_to(session).as_posix()
        first=min(5,max(0,int(duration/2)))
        for sec in range(first,max(first+1,int(duration)),args.interval):
            target=frames/f'{vi+1:02d}-r{args.rotation}-{sec:04d}.jpg'
            if not target.exists():
                vf=('hflip,vflip,' if args.rotation==180 else '')+'scale=960:-2'
                run([ff,'-v','error','-nostdin','-y','-ss',sec,'-noautorotate','-i',video,'-map','0:v:0','-frames:v','1','-vf',vf,'-q:v','3',target])
            t=epoch+sec+args.offset; k=bisect.bisect_left(times,t); candidates=pts[max(0,k-1):k+1]
            p=min(candidates,key=lambda p:abs(p['time']-t)) if candidates else None
            valid=p and abs(p['time']-t)<=3
            entries.append({'image':target.relative_to(session).as_posix(),'video':vi,'seconds':sec,'time':t,'timestamp':dt.datetime.fromtimestamp(t,dt.timezone.utc).isoformat(),'point':p if valid else None})
            print(f'{video.name} {sec}s',flush=True)
    result={'version':1,'title':session.name,'rotation':args.rotation,'offsetSeconds':args.offset,'clockNote':'Hora UTC de la càmera + ajust manual. La coincidència GPS no garanteix la sincronització del rellotge.','videos':videos,'frames':entries,'track':track}
    (session/'analysis.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
    for page,start in enumerate(range(0,len(entries),16),1):
        sheet=Image.new('RGB',(1280,4*204),'#141b19'); draw=ImageDraw.Draw(sheet)
        for n,e in enumerate(entries[start:start+16]):
            x=n%4*320;y=n//4*204
            im=Image.open(session/e['image']);im.thumbnail((320,180));sheet.paste(im,(x,y))
            p=e['point']
            d=f"{p['courseDistance']/1000:.2f} km / {p['courseError']:.0f} m" if p and p.get('courseDistance') is not None else (f"FIT {p['distance']/1000:.2f} km" if p and not track.get('matching') else 'fora de ruta / pausa')
            draw.text((x+5,y+183),f"V{e['video']+1} {e['seconds']}s | {d}",fill='white')
        sheet.save(session/f'contact-{page:02d}.jpg',quality=90)
    print(json.dumps({'videos':videos,'frames':len(entries)},indent=2))
if __name__=='__main__':main()
