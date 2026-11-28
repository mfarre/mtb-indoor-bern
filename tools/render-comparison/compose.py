"""Compose matching engine captures into a labelled MP4 and a short silent GIF."""
import argparse,json,shutil,subprocess,tempfile
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before',type=Path);parser.add_argument('after',type=Path)
    parser.add_argument('output',type=Path);parser.add_argument('--ffmpeg',default='ffmpeg')
    parser.add_argument('--font',default='C:/Windows/Fonts/segoeui.ttf')
    parser.add_argument('--audio',type=Path)
    parser.add_argument('--gif-start',type=float,default=14)
    parser.add_argument('--gif-seconds',type=float,default=8)
    parser.add_argument('--before-label',default='PREVIOUS VERSION')
    parser.add_argument('--after-label',default='CURRENT VERSION')
    parser.add_argument('--course-label',default=None)
    args=parser.parse_args()
    reports=[json.loads((p/'capture-report.json').read_text(encoding='utf-8-sig')) for p in [args.before,args.after]]
    before,after=[r['spec'] for r in reports]
    for key in ['StartMeters','SpeedMps','Seconds','Fps','CourseId','Width','Height']:
        if before[key]!=after[key]:raise ValueError(f'Unmatched capture parameter: {key}')
    count=before['Seconds']*before['Fps']
    if any(r['frames']!=count for r in reports):raise ValueError('Incomplete capture')
    seconds=before['Seconds'];count=seconds*before['Fps']
    if args.output.suffix.lower()!='.mp4':raise ValueError('Output must be an MP4 path')
    if not 0<=args.gif_start<seconds or not 0<args.gif_seconds<=seconds-args.gif_start:raise ValueError('GIF excerpt exceeds the capture')
    ffmpeg=shutil.which(args.ffmpeg)
    if not ffmpeg:raise FileNotFoundError(args.ffmpeg)
    font=ImageFont.truetype(args.font,18);small=ImageFont.truetype(args.font,13)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='mtb-comparison-') as temporary:
        temporary=Path(temporary)
        for index in range(count):
            canvas=Image.new('RGB',(1120,391),'#14231c');draw=ImageDraw.Draw(canvas)
            draw.text((20,13),args.before_label,font=font,fill='#dbe3d4')
            draw.text((580,13),args.after_label,font=font,fill='#d1ef91')
            for side,folder in enumerate([args.before,args.after]):
                with Image.open(folder/f'{index:04d}.png') as frame:
                    if frame.size!=(960,540):raise ValueError(f'Unexpected capture dimensions: {frame.size}')
                    canvas.paste(frame.convert('RGB').resize((560,315),Image.Resampling.LANCZOS),(side*560,48))
            draw.line((560,0,560,363),fill='#14231c',width=3)
            distance=before['StartMeters']+index*before['SpeedMps']/before['Fps']
            draw.text((20,369),f"{args.course_label or before['CourseId'].upper()} · Forest singletrack · km {distance/1000:.2f}",font=small,fill='#dbe3d4')
            draw.text((580,369),'Same route, position and speed · 3D engine capture',font=small,fill='#b8c5b3')
            canvas.save(temporary/f'{index:04d}.png')
            if index==round((args.gif_start+args.gif_seconds/2)*before['Fps']):canvas.save(args.output.with_suffix('.png'))
        command=[ffmpeg,'-y','-v','error','-framerate',str(before['Fps']),'-i',str(temporary/'%04d.png')]
        if args.audio:command+=['-i',str(args.audio),'-c:a','aac','-b:a','128k']
        command+=['-t',str(seconds),'-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',str(args.output)]
        subprocess.run(command,check=True)
        subprocess.run([ffmpeg,'-y','-v','error','-ss',str(args.gif_start),'-t',str(args.gif_seconds),'-i',str(args.output),'-an',
            '-filter_complex','fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
            '-loop','0',str(args.output.with_suffix('.gif'))],check=True)
    with Image.open(args.output.with_suffix('.gif')) as gif:
        dimensions=gif.size;gif_frames=gif.n_frames
    proof={'course':before['CourseId'],'courseLabel':args.course_label or before['CourseId'].upper(),'beforeLabel':args.before_label,'afterLabel':args.after_label,'mp4Bytes':args.output.stat().st_size,'gifBytes':args.output.with_suffix('.gif').stat().st_size,'gifFrames':gif_frames,
           'seconds':seconds,'fps':before['Fps'],'gifStartSeconds':args.gif_start,'gifSeconds':args.gif_seconds,'startMeters':before['StartMeters'],
           'endMeters':distance,'width':dimensions[0],'height':dimensions[1],'method':'Deterministic engine capture; not a real-time performance measurement',
           'audio':'Same application graph rendered offline against the coasting capture trajectory' if args.audio else None}
    args.output.with_suffix('.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof,indent=2))

if __name__=='__main__':main()
