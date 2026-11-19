import * as T from './vendor/three.module.js';
export function addTrailMarkers(engine,plan){
 if(engine.trailGroup){engine.scene.remove(engine.trailGroup);engine.trailGroup.traverse(o=>{o.geometry?.dispose();if(o.material){o.material.map?.dispose();o.material.dispose();}});}
 const group=new T.Group();engine.trailGroup=group;engine.scene.add(group);
 function board(d,off,label,detail,color='#d5e9b0',size=1){
  const p=engine.at(d),a=engine.at(Math.max(0,d-5)),b=engine.at(d+5),t=b.clone().sub(a).setY(0).normalize(),side=new T.Vector3(-t.z,0,t.x);
  const node=new T.Group();node.position.copy(p).addScaledVector(side,off);node.position.y=engine.localGround?.(node.position.x,node.position.z)??p.y;node.rotation.y=Math.atan2(-t.x,-t.z);
  const post=new T.Mesh(new T.CylinderGeometry(.035,.045,1.7,6),new T.MeshStandardMaterial({color:'#756b50',roughness:1}));post.position.y=.85;node.add(post);
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;const c=canvas.getContext('2d');c.fillStyle='#182e25';c.fillRect(0,0,512,256);c.strokeStyle=color;c.lineWidth=12;c.strokeRect(9,9,494,238);c.fillStyle=color;c.textAlign='center';c.font='bold 76px Segoe UI';c.fillText(label,256,126);c.font='26px Segoe UI';c.fillText(detail,256,190);
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
  const sign=new T.Mesh(new T.PlaneGeometry(1.45*size,.725*size),new T.MeshBasicMaterial({map:texture,side:T.DoubleSide}));sign.position.y=1.5;node.add(sign);group.add(node);
 }
 for(const c of plan.corners)board(Math.max(0,c.distance-55),c.width/2+1.15,`${c.direction>0?'↱':'↰'} ${Math.round(c.limit)}`,'REVOLT · km/h', '#f0ce8e');
 if(plan.stage){for(const [d,label]of[[plan.stage.start,'SORTIDA'],[plan.stage.end,'META']])for(const side of[-1,1])board(d,side*2.2,label,plan.stage.name.toUpperCase(),'#d9f5ac',1.25);}
}
