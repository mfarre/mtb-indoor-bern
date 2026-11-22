"""Render a right-hand Maneta v01 pull/release sequence from render_cad.py's .blend.

Run Blender in background mode with --python animate_cad.py -- --blend SCENE
--output OUTPUT [--steps 24 --width 800 --samples 32]. The saved scene's lever
vertices already contain the reference 8-degree rotation. Motion uses the
source's nominal 0..22-degree travel. Spring eyes follow their actual anchor
centres; coils and fasteners are illustrative, not a force/fit simulation.
"""
from pathlib import Path
import argparse,json,math,sys,shutil
import bpy
from mathutils import Vector

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--blend',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
p.add_argument('--steps',type=int,default=24)
p.add_argument('--width',type=int,default=800)
p.add_argument('--samples',type=int,default=32)
p.add_argument('--preview',action='store_true')
a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
assert a.steps>=2 and a.width>=400 and a.samples>=1
out=a.output.resolve();out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(a.blend.resolve()))
s=bpy.context.scene
s.render.engine='CYCLES';s.cycles.samples=a.samples;s.cycles.use_denoising=True
s.cycles.seed=19;s.cycles.use_animated_seed=False
s.render.resolution_x=a.width;s.render.resolution_y=round(a.width*1152/1800)
s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG'
s.render.image_settings.color_mode='RGB';s.view_settings.exposure=-.8
s.view_settings.look='AgX - Medium High Contrast'
s.world.node_tree.nodes['Background'].inputs[1].default_value=.12

def color(name,rgb,rough=None):
    mat=bpy.data.materials[name];bsdf=mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value=(*rgb,1)
    if rough is not None:bsdf.inputs['Roughness'].default_value=rough
    return mat

color('Studio background',(.012,.013,.014),.72)
color('PETG - graphite',(.08,.095,.105),.44)
color('PETG - terracotta visualization colour',(.95,.205,.018),.4)
color('PETG - muted blue visualization colour',(.075,.32,.44),.42)
color('Black fasteners',(.055,.058,.062),.28)
color('Anodized aluminium tube',(.015,.018,.02),.32)
color('Rubber grip, contextual only',(.012,.013,.014),.8)
# Fine surface texture changes only the render shading, never the source mesh.
for mat in bpy.data.materials:
    if not mat.name.startswith('PETG'):continue
    nodes=mat.node_tree.nodes;links=mat.node_tree.links;bsdf=nodes.get('Principled BSDF')
    tex=nodes.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=3.2
    tex.inputs['Detail'].default_value=2
    coords=nodes.new('ShaderNodeTexCoord');links.new(coords.outputs['Object'],tex.inputs['Vector'])
    bump=nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.12;bump.inputs['Distance'].default_value=.018
    prior=bsdf.inputs['Normal'].links
    if prior:links.new(prior[0].from_socket,bump.inputs['Normal'])
    links.new(tex.outputs['Fac'],bump.inputs['Height']);links.new(bump.outputs['Normal'],bsdf.inputs['Normal'])
    bevel=nodes.new('ShaderNodeBevel');bevel.inputs['Radius'].default_value=.10;bevel.samples=2
    links.new(bump.outputs['Normal'],bevel.inputs['Normal']);links.new(bevel.outputs['Normal'],bsdf.inputs['Normal'])

lever=bpy.data.objects['Source STL - lever']
moving=[]
for obj in bpy.data.objects:
    if (obj.name.startswith('M3 spring anchor') and obj.location.y<1) or obj.name=='Spring anchor washer.001':
        moving.append((obj,obj.location.copy()))

spring=bpy.data.objects['Extension spring coils - illustrative']
eyes=[o for o in bpy.data.objects if o.name.startswith('Extension spring eye')]
hooks=[o for o in bpy.data.objects if o.name.startswith('Spring connecting hook')]
eyes.sort(key=lambda o:o.name);hooks.sort(key=lambda o:o.name)
anchor_a=Vector((24,21,13.5))

def rotate(v,angle):
    return Vector((v.x*math.cos(angle)-v.y*math.sin(angle),v.x*math.sin(angle)+v.y*math.cos(angle),v.z))

def points(obj,values):
    spline=obj.data.splines[0]
    assert len(spline.points)==len(values)
    for point,value in zip(spline.points,values):point.co=(*value,1)

def pose(degrees):
    angle=math.radians(degrees)
    delta=math.radians(8)-angle
    lever.rotation_euler.z=delta
    for obj,origin in moving:
        obj.location=rotate(origin,delta)
        obj.rotation_euler.z=delta
    anchor_b=Vector((24*math.cos(angle),-24*math.sin(angle),13.5))
    axis=(anchor_b-anchor_a).normalized();side=Vector((axis.y,-axis.x,0));up=Vector((0,0,1))
    start=anchor_a+axis*4;end=anchor_b-axis*4
    coil=[start.lerp(end,i/400)+side*math.cos(i/400*math.tau*12)*1.65+up*math.sin(i/400*math.tau*12)*1.65 for i in range(401)]
    points(spring,coil)
    for index,(center,sgn,endpt) in enumerate([(anchor_a,1,coil[0]),(anchor_b,-1,coil[-1])]):
        eye=[center+side*math.cos(i*math.tau/80)*2.5+axis*math.sin(i*math.tau/80)*2.5 for i in range(81)]
        points(eyes[index],eye);points(hooks[index],[eye[20 if sgn==1 else 60],endpt])
    bpy.context.view_layer.update()
    return (anchor_b-anchor_a).length

frames=out/'poses';frames.mkdir(exist_ok=True)
angles=[22*(.5-.5*math.cos(math.pi*i/(a.steps-1))) for i in range(a.steps)]
indices=[0,a.steps-1] if a.preview else range(a.steps)
distances=[]
for i in indices:
    distance=pose(angles[i]);distances.append(distance)
    s.render.filepath=str(frames/f'{i:04d}.png')
    print(f'POSE {i+1}/{a.steps}: {angles[i]:.3f} degrees; anchor spacing {distance:.3f} mm',flush=True)
    bpy.ops.render.render(write_still=True)

if not a.preview:
    sequence=out/'frames';sequence.mkdir(exist_ok=True)
    # 20 fps: 0.5 s at rest, 1.15 s pull, 0.4 s hold, 1.15 s return.
    order=[0]*10+list(range(1,a.steps))+[a.steps-1]*7+list(range(a.steps-2,-1,-1))
    for frame,index in enumerate(order):shutil.copyfile(frames/f'{index:04d}.png',sequence/f'{frame:04d}.png')
    report={'source_scene':a.blend.name,'source_geometry':'Unmodified supplied STL meshes from render_cad.py','orientation':'Right lever outward toward grip and bar end; stem inboard on left','travel_degrees':[0,22],'spring_anchor_spacing_mm':[min(distances),max(distances)],'fps':20,'frames':len(order),'duration_seconds':len(order)/20,'size':[s.render.resolution_x,s.render.resolution_y],'limitation':'Kinematic illustration; spring force, bumper compression and physical fit are not simulated or validated.'}
    (out/'animation.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report),flush=True)
