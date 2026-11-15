"""Compose two deterministic RenderCapture sequences into a labelled GIF."""
import argparse,json,shutil,subprocess,tempfile
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before',type=Path);parser.add_argument('after',type=Path)
    parser.add_argument('output',type=Path);parser.add_argument('--ffmpeg',default='ffmpeg')
    parser.add_argument('--font',default='C:/Windows/Fonts/segoeui.ttf')
    args=parser.parse_args()
    reports=[json.loads((p/'capture-report.json').read_text(encoding='utf-8-sig')) for p in [args.before,args.after]]
    before,after=[r['spec'] for r in reports]
    for key in ['StartMeters','SpeedMps','Seconds','Fps','CourseId']:
        if before[key]!=after[key]:raise ValueError(f'Unmatched capture parameter: {key}')
    count=before['Seconds']*before['Fps']
    if any(r['frames']!=count for r in reports):raise ValueError('Incomplete capture')
    seconds=min(8,before['Seconds']);count=seconds*before['Fps']
    ffmpeg=shutil.which(args.ffmpeg)
    if not ffmpeg:raise FileNotFoundError(args.ffmpeg)
    font=ImageFont.truetype(args.font,18);small=ImageFont.truetype(args.font,13)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='mtb-comparison-') as temporary:
        temporary=Path(temporary)
        for index in range(count):
            canvas=Image.new('RGB',(1120,391),'#14231c');draw=ImageDraw.Draw(canvas)
            draw.text((20,13),'VERSIÓ ANTERIOR',font=font,fill='#dbe3d4')
            draw.text((580,13),'NOU ESTIL · TARDOR',font=font,fill='#d1ef91')
            for side,folder in enumerate([args.before,args.after]):
                with Image.open(folder/f'{index:04d}.png') as frame:
                    if frame.size!=(960,540):raise ValueError(f'Unexpected capture dimensions: {frame.size}')
                    canvas.paste(frame.convert('RGB').resize((560,315),Image.Resampling.LANCZOS),(side*560,48))
            draw.line((560,0,560,363),fill='#14231c',width=3)
            distance=before['StartMeters']+index*before['SpeedMps']/before['Fps']
            draw.text((20,369),f"AL DENTE · Corriol de bosc · km {distance/1000:.2f}".replace('.',','),font=small,fill='#dbe3d4')
            draw.text((580,369),'Mateix traçat, posició i velocitat · captura del motor 3D',font=small,fill='#b8c5b3')
            canvas.save(temporary/f'{index:04d}.png')
            if index==count//2:canvas.save(args.output.with_suffix('.png'))
        subprocess.run([ffmpeg,'-y','-v','error','-framerate',str(before['Fps']),'-i',str(temporary/'%04d.png'),
            '-filter_complex','fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=none',
            '-loop','0',str(args.output)],check=True)
    with Image.open(args.output) as gif:
        dimensions=gif.size;gif_frames=gif.n_frames
    print(json.dumps({'output':str(args.output),'bytes':args.output.stat().st_size,'frames':gif_frames,
                      'seconds':seconds,'fps':10,'startMeters':before['StartMeters'],
                      'endMeters':distance,'width':dimensions[0],'height':dimensions[1]},indent=2))

if __name__=='__main__':main()
