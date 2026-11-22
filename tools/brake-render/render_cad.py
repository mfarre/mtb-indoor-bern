"""Render the uploaded right-hand STL assembly without changing its geometry.

Run with Blender 4.5: blender --background --python render_cad.py --
    --source PATH_TO_EXTRACTED_PACKAGE --output OUTPUT_DIRECTORY
All modelling coordinates are the source's millimetres, not physical metres.
"""
from pathlib import Path
import bpy, bmesh, struct, math, argparse, sys
from mathutils import Vector

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--samples', type=int, default=48)
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
SRC = args.source.resolve() / 'STL' / 'dreta'
OUT = args.output.resolve()
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def material(name, color, metal=0, rough=.42, printed=False):
    m=bpy.data.materials.new(name);m.use_nodes=True
    n=m.node_tree.nodes; p=n.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal
    p.inputs['Roughness'].default_value=rough
    if printed:
        tex=n.new('ShaderNodeTexCoord'); sep=n.new('ShaderNodeSeparateXYZ')
        mul=n.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.inputs[1].default_value=math.tau/.2
        sine=n.new('ShaderNodeMath');sine.operation='SINE'
        bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.16;bump.inputs['Distance'].default_value=.025
        links=m.node_tree.links
        links.new(tex.outputs['Object'],sep.inputs[0])
        links.new(sep.outputs['Z'],mul.inputs[0]);links.new(mul.outputs[0],sine.inputs[0])
        links.new(sine.outputs[0],bump.inputs['Height']);links.new(bump.outputs['Normal'],p.inputs['Normal'])
    return m

petg=material('PETG - graphite',(.075,.10,.105),rough=.4,printed=True)
levermat=material('PETG - terracotta visualization colour',(.56,.19,.065),rough=.44,printed=True)
covermat=material('PETG - muted blue visualization colour',(.065,.19,.245),rough=.40,printed=True)
guide=material('PETG - warm grey',(.30,.34,.33),rough=.45,printed=True)
steel=material('Brushed steel',(.46,.49,.52),metal=.92,rough=.25)
blacksteel=material('Black fasteners',(.035,.043,.047),metal=.7,rough=.3)
brass=material('Brass pins',(.59,.36,.10),metal=.8,rough=.26)
rubber=material('Black EPDM bumper',(.024,.024,.022),rough=.85)
pcbmat=material('AS5600 illustrative PCB',(.025,.19,.065),rough=.45)
chipmat=material('Sensor package',(.015,.017,.017),rough=.45)
bar_mat=material('Anodized aluminium tube',(.045,.054,.058),metal=.8,rough=.35)
gripmat=material('Rubber grip, contextual only',(.026,.03,.029),rough=.75)
groundmat=material('Studio background',(.065,.077,.078),rough=.7)

def mesh_stl(filename, transform, mat, name):
    data=(SRC/filename).read_bytes();count=struct.unpack_from('<I',data,80)[0]
    vs=[];fs=[]
    for i in range(count):
        a=struct.unpack_from('<12fH',data,84+50*i)
        fs.append((len(vs),len(vs)+1,len(vs)+2))
        vs.extend(transform(a[j:j+3]) for j in (3,6,9))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vs,[],fs);mesh.update()
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=bm.verts,dist=1e-5)
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(mesh);bm.free()
    ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    # No subdivision, bevel, remeshing or silhouette-changing modifiers.
    return ob

angle=math.radians(8)
def rot(x,y):return (x*math.cos(angle)+y*math.sin(angle),-x*math.sin(angle)+y*math.cos(angle))
parts=[]
parts.append(mesh_stl('base.stl',lambda p:p,petg,'Source STL - base'))
parts.append(mesh_stl('palanca.stl',lambda p:(*rot(p[0],p[1]),p[2]+4.85),levermat,'Source STL - lever'))
parts.append(mesh_stl('guia.stl',lambda p:(p[0],p[1],p[2]+12.15),guide,'Source STL - guide'))
cover=mesh_stl('tapa.stl',lambda p:(p[0],-p[1],24.55-p[2]),covermat,'Source STL - cover');parts.append(cover)
parts.append(mesh_stl('mordassa.stl',lambda p:(8-p[2],p[1]-45,p[0]-15.5),petg,'Source STL - upper clamp'))
parts.append(mesh_stl('mordassa.stl',lambda p:(8-p[2],p[1]-45,-p[0]-15.5),petg,'Source STL - lower clamp'))

def cyl(name,p,r,depth,mat,axis='Z',vertices=48):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=depth,location=p)
    ob=bpy.context.object;ob.name=name;ob.data.materials.append(mat)
    if axis=='X':ob.rotation_euler[1]=math.pi/2
    for poly in ob.data.polygons:poly.use_smooth=len(poly.vertices)==4
    return ob
def box(name,p,size,mat):
    bpy.ops.mesh.primitive_cube_add(size=1,location=p)
    ob=bpy.context.object;ob.name=name;ob.dimensions=size;ob.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return ob
def path(name,points,r,mat):
    c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.resolution_u=12;c.bevel_depth=r;c.bevel_resolution=4
    s=c.splines.new('POLY');s.points.add(len(points)-1)
    for p,v in zip(s.points,points):p.co=(*v,1)
    ob=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(ob);ob.data.materials.append(mat);return ob
def washer(name,x,y,z,r=3.3,hole=1.65):
    # Ring generated directly to retain a visible hole.
    verts=[];faces=[];n=48
    for zz in [z,z+.6]:
        for rad in [r,hole]:
            verts.extend((x+rad*math.cos(i*math.tau/n),y+rad*math.sin(i*math.tau/n),zz) for i in range(n))
    for i in range(n):
        j=(i+1)%n
        faces.extend([(i,j,2*n+j,2*n+i),(n+i,3*n+i,3*n+j,n+j),(i,n+i,n+j,j),(2*n+i,2*n+j,3*n+j,3*n+i)])
    m=bpy.data.meshes.new(name);m.from_pydata(verts,[],faces);m.update()
    o=bpy.data.objects.new(name,m);bpy.context.collection.objects.link(o);o.data.materials.append(steel);return o
def screw_head(name,x,y,z,r=2.7):
    ob=cyl(name,(x,y,z+.9),r,1.8,blacksteel)
    # A shallow dark socket mark is illustrative hardware, not additional STL geometry.
    cyl(name+' socket',(x,y,z+1.81),r*.48,.02,chipmat,vertices=6)
    return ob

cyl('4 mm brass pivot',(0,0,5),2,10,brass)
cyl('3 mm travel stop pin',(12,0,5),1.5,10,brass)
cyl('6 x 2.5 mm diametric magnet',(0,0,15.4),3,2.5,steel)
box('EPDM bumper',(28.5,-16,8.05),(9,6,5.5),rubber)
pcb=box('23 x 23 mm PCB - layout illustrative',(0,0,20.35),(23,23,1.6),pcbmat)
box('AS5600 downward-facing chip - approximate',(0,0,19.05),(5,4,1),chipmat)
for x in [-2.5,2.5]:
    for y in [-1.3,-.45,.45,1.3]: box('Chip contact',(x,y,19.25),(.7,.35,.25),steel)
for y in [-11,11]:
    cyl('M3 cover screw shaft',(-16,y,15.3),1.5,20,steel)
    washer('M3 cover washer',-16,y,24.55)
    screw_head('M3 cover screw',-16,y,25.15)
for y in [-62.5,-27.5]:
    cyl('M4 clamp bolt shaft',(0,y,-13.2),2,40,steel)
    washer('M4 clamp washer',0,y,4.5,4.5,2.15)
    screw_head('M4 clamp bolt head',0,y,5.1,3.6)
    cyl('M4 clamp nut',(0,y,-33),4,3.2,steel,vertices=6)
    washer('M4 lower washer',0,y,-31.7,4.5,2.15)

a=Vector((24,21,13.5));b=Vector((*rot(24,0),13.5))
for p in [a,b]:
    cyl('M3 spring anchor spacer',(p.x,p.y,12.85),2.35,2,steel)
    washer('Spring anchor washer',p.x,p.y,14.1)
    screw_head('M3 spring anchor',p.x,p.y,14.7)
axis=(b-a).normalized(); side=Vector((axis.y,-axis.x,0));up=Vector((0,0,1))
# Real source fixes eye centres; coil/eye shape is a visual approximation.
start=a+axis*4;end=b-axis*4
pts=[]
for i in range(401):
    t=i/400;phi=t*math.tau*12
    p=start.lerp(end,t)+side*math.cos(phi)*1.65+up*math.sin(phi)*1.65
    pts.append(tuple(p))
path('Extension spring coils - illustrative',pts,.34,steel)
for center,sgn,endpt in [(a,1,pts[0]),(b,-1,pts[-1])]:
    eye=[tuple(center+side*math.cos(t*math.tau/80)*2.5+axis*math.sin(t*math.tau/80)*2.5) for t in range(81)]
    path('Extension spring eye',eye,.34,steel)
    path('Spring connecting hook',[eye[20 if sgn==1 else 60],endpt],.34,steel)

cyl('22.2 mm handlebar context',(25,-45,-15.5),11.1,200,bar_mat,'X',96)
cyl('Rubber grip context',(77.5,-45,-15.5),14.4,100,gripmat,'X',96)
for x in [29,126]:cyl('Grip lock ring',(x,-45,-15.5),14.6,3.5,blacksteel,'X',96)
for i in range(38):
    x=33+i*2.4
    points=[(x,-45+14.48*math.cos(t*math.tau/96),-15.5+14.48*math.sin(t*math.tau/96)) for t in range(97)]
    path('Grip rib',points,.16,gripmat)

wirecols=[(.3,.035,.025),(.015,.015,.015),(.12,.24,.4),(.36,.3,.035)]
for i,col in enumerate(wirecols):
    wm=material('Four-wire sensor lead '+str(i),col,rough=.6)
    pts=[(-10+i*1.5,10.8,19.7),(-10+i*1.5,16,18.5),(-13+i*1.5,18,10),(-24+i*1.2,10,5),(-31+i,0,0),(-40+i,-20,-3),(-43+i,-43,-5)]
    path('Sensor cable - routing illustrative',pts,.45,wm)

box('Ground',(0,0,-40),(2000,2000,5),groundmat)
def area(name,loc,power,size,target):
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size
    o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);o.location=loc
    o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
area('Key softbox',(20,30,230),950000,180,(0,0,0))
area('Fill softbox',(-120,-70,100),500000,150,(0,-20,0))
area('Rim softbox',(80,160,80),700000,110,(20,-10,0))
world=bpy.context.scene.world;world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.12,.15,.17,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.35

scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=args.samples;scene.cycles.use_denoising=True
scene.render.resolution_x=1800;scene.render.resolution_y=1152;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.view_settings.view_transform='AgX'
camdata=bpy.data.cameras.new('Camera');cam=bpy.data.objects.new('Camera',camdata);bpy.context.collection.objects.link(cam)
scene.camera=cam;camdata.type='ORTHO';camdata.ortho_scale=192
def camera(loc,target):
    cam.location=loc;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
camera((125,150,180),(21,-20,-2))
scene.render.filepath=str(OUT/'maneta-v01-cad-assembly.png')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'maneta-v01-assembly.blend'))
bpy.ops.render.render(write_still=True)
# Second inspection view exposes source geometry by hiding sensor cover only.
cover.hide_render=True
pcb.hide_render=True
for o in bpy.data.objects:
    if o.name.startswith(('AS5600 downward','Chip contact','M3 cover','Four-wire')):o.hide_render=True
camera((70,100,260),(20,-18,-2));camdata.ortho_scale=160
scene.render.filepath=str(OUT/'maneta-v01-cad-open.png')
bpy.ops.render.render(write_still=True)
print('Saved exact STL reference renders',flush=True)
