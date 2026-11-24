// MTB simulator brake lever | mm | OpenSCAD 2021.01+
// F5 previews the assembly. Each STL exports in its print orientation.
peca = "conjunt"; // [conjunt,base,palanca,guia,tapa,mordassa,prova]
costat = "dreta"; // [dreta,esquerra]
angle = 8;        // [0:1:22]
explode = 0;      // [0:1:12]
diam_manillar = 22.2;
diam_imant = 6;
gruix_imant = 2.5;
joc_radial = 0.15; // per side, at the pivot
altura_espai_sensor = 5.4; // from guide to inside cover roof
radi_dit = 55;   // approximate pivot-to-index-finger distance
$fn = 72;
eps = 0.02;
bar_y = -45;
brida_z = -15.5;
altura_base = 4.5;
z_pal = 4.85;
gruix_pal = 7;
z_guia = 12.15;
gruix_guia = 4;
z_tapa = z_guia + gruix_guia;
limit = 22;
pilars = [[-16,-11],[-16,11]];
ancora = [24,21];

module disc(p,r){ translate(p) circle(r=r); }
module tram(a,ra,b,rb){ hull(){ disc(a,ra); disc(b,rb); } }
module cil(p,z,h,d){ translate([p[0],p[1],z]) cylinder(h=h,d=d); }
module cos2d(){
    hull(){ for(y=[bar_y-17.5,bar_y+17.5]) disc([0,y],6.5); }
    tram([0,bar_y+14],6.5,[0,0],9);
    for(p=pilars) tram([0,0],9,p,4.9);
    tram([0,0],9,[12,0],3.8);
    tram([-16,11],4.9,ancora,5.0);
    tram([0,-18],7,[29,-21],5);
}
module base(){
    difference(){
        union(){
            linear_extrude(altura_base) cos2d();
            for(p=pilars) cil(p,altura_base-eps,z_guia-altura_base+eps,9);
            cil(ancora,altura_base-eps,z_pal+gruix_pal-altura_base+eps,9.2);
            // Rear wall for rubber stop. Front face y = -19.
            translate([23.5,-23.5,altura_base-eps]) cube([10,4.5,7.5]);
        }
        for(y=[bar_y-17.5,bar_y+17.5]) cil([0,y],-eps,altura_base+2*eps,4.5);
        cil([0,0],-eps,altura_base+2*eps,4.05);
        cil([12,0],-eps,altura_base+2*eps,3.05);
        for(p=pilars) cil(p,2,z_guia,2.65);
        cil(ancora,2,14,2.65);
    }
}
module escletxa(){
    for(a=[0:2:limit-2]) hull()
        for(b=[a,a+2]) disc([12*cos(b),12*sin(b)],1.68);
}
module palanca(){
    difference(){
        union(){
            linear_extrude(gruix_pal) union(){
                tram([0,0],8.0,[12,2.6],5.8);
                tram([11,2.6],5.8,[24,0],4.8);
                tram([24,0],4.8,[radi_dit-9,0.8],3.8);
                tram([radi_dit-9,0.8],3.8,[radi_dit,2.5],4.5);
                tram([radi_dit,2.5],4.5,[radi_dit+5,5.1],3.2);
            }
            cil([0,0],gruix_pal-eps,4.8+eps,10);
        }
        cil([0,0],-eps,6.05+eps,4+2*joc_radial);
        cil([0,0],gruix_pal+4.8-gruix_imant,gruix_imant+eps,diam_imant+0.18);
        translate([0,0,-eps]) linear_extrude(gruix_pal+2*eps) escletxa();
        cil([24,0],0.55,gruix_pal,2.65);
    }
}
module guia(){
    difference(){
        linear_extrude(gruix_guia) hull(){
            for(p=pilars) disc(p,4.5);
            disc([0,0],8.4);
        }
        cil([0,0],-eps,gruix_guia+2*eps,10+2*joc_radial);
        for(p=pilars) cil(p,-eps,gruix_guia+2*eps,3.35);
    }
}
module tapa(){
    difference(){
        union(){
            translate([0,0,altura_espai_sensor]) linear_extrude(3) hull(){
                for(p=pilars) disc(p,4.5);
                for(x=[-10.2,10.2],y=[-10.2,10.2]) disc([x,y],3.1);
            }
            for(p=pilars) cil(p,0,altura_espai_sensor+eps,8);
        }
        for(p=pilars) cil(p,-eps,altura_espai_sensor+3+2*eps,3.35);
        // Board alignment window: align the axis with the chip centre.
        cil([0,0],altura_espai_sensor-eps,3+2*eps,3);
    }
}
module mordassa(){
    // Clamp half. Outer plane z=15.5; gap between jaws = 1.2.
    difference(){
        translate([-8,-23,0.6]) cube([16,46,14.9]);
        rotate([0,90,0]) cylinder(h=20,d=diam_manillar+0.12,center=true);
        for(y=[-17.5,17.5]) cil([0,y],0,18,4.5);
    }
}
module volandera(p,z,d=7){color("silver")difference(){cil(p,z,0.7,d);cil(p,z-eps,0.8,3.2);}}
module maquinari(a){
    color("goldenrod"){cil([0,0],0,10,4);cil([12,0],0,10,3);}
    color("dimgray") rotate([0,0,-a]) cil([0,0],z_pal+gruix_pal+4.8-gruix_imant,gruix_imant,diam_imant);
    // Uncompressed rubber, shown only in the assembly illustration.
    color("sienna") translate([24,-19,5.3]) cube([9,6,5.5]);
    color("darkgreen") translate([-11.5,-11.5,z_tapa+altura_espai_sensor-2.0]) cube([23,23,1.6]);
}
module conjunt(a,e){
    color("slategray") base();
    color("peru") translate([0,0,z_pal+e]) rotate([0,0,-a]) palanca();
    color("silver") translate([0,0,z_guia+2*e]) guia();
    color("steelblue") translate([0,0,z_tapa+3*e]) tapa();
    color("gray") translate([0,bar_y,brida_z-e]) mordassa();
    color("gray") translate([0,bar_y,brida_z-2*e]) mirror([0,0,1]) mordassa();
    if(e==0) maquinari(a);
}
module prova(){
    // Contacts between fixed plastic and lever only. Empty = normal.
    intersection(){
        translate([0,0,z_pal]) rotate([0,0,-angle]) palanca();
        union(){base(); translate([0,0,z_guia]) guia(); translate([0,0,z_tapa]) tapa();}
    }
}
module model(){
    if(peca=="base") base();
    else if(peca=="palanca") palanca();
    else if(peca=="guia") guia();
    else if(peca=="tapa") translate([0,0,altura_espai_sensor+3]) rotate([180,0,0]) tapa();
    else if(peca=="mordassa") translate([0,0,8]) rotate([0,90,0]) mordassa();
    else if(peca=="prova") prova();
    else conjunt(angle,explode);
}
if(costat=="esquerra") mirror([1,0,0]) model(); else model();
