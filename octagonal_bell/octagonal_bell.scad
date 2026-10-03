// 正八角形の電子鈴 / mm / OpenSCAD 2021.01以上 / 外部ライブラリ不要
// STL出力時は body, lid, tray, shelf, ball のいずれかを指定。
/* [Display] */
part = "shelf"; // [assembly,section,exploded,print,body,lid,tray,shelf,ball]
show_electronics = true;
/* [Electronics space] */
electronics_clearance = 30; // トレー上面から電池棚下面までの有効高さ
/* [Hidden] */
electronics_height_extra = electronics_clearance-16.6; // 元の基板空間から増えた高さ
/* [Shell] */
body_width = 180; // 正八角形の対辺。画像の150mmから収納余裕のため拡大。
wall = 3;
bottom_width = 100;
top_width = 104;
bevel_height = 28;
shoulder_z = 88+electronics_height_extra;
roof_z = 113+electronics_height_extra;
seam_z = 78+electronics_height_extra;
seam_gap = 0.35;
fit = 0.3; // はめ合わせ片側余裕
/* [Rope and sound] */
lug_width = 38;
lug_thickness = 14;
lug_height = 22;
rope_hole_width = 19;
rope_hole_height = 14;
sound_slit = 4;
sound_end_d = 10;
sound_length = 90; // 底面の音穴全長（両端の丸穴を含む）
ball_d = 25;
/* [Electronics - reference envelopes] */
battery = [135.5,69,16];
esp32 = [52,28,12];
mpu6050 = [21,16,5];
/* [Tray fasteners] */
tray_screw_d = 3.4; // M3ねじの貫通穴。電池棚も同径。
tray_nut_af = 6.0; // M3六角ナット用くぼみの対辺（想定ナット対辺5.5）
tray_nut_depth = 2.6; // トレー裏面からの深さ（想定ナット厚2.4）
/* [Lid fasteners] */
lid_screw_length = 35; // 棚の固定ねじとM3x35に統一（頭の下からの長さ）
lid_screw_d = 3.4; // M3ねじ用の通し穴
lid_nut_af = 6.0; // 横差しナット受けの対辺（想定ナット対辺5.5）
lid_nut_height = 2.8; // 想定ナット厚2.4に挿入余裕を追加
/* [Hidden] */
lid_nut_roof = lid_screw_length-16; // M3x35で合わせ面から19mm下
$fn = 64;
eps = 0.02;
plate_t = 2.4;
tray_z = 48; // 鈴玉の空間を維持
shelf_z = tray_z+plate_t+electronics_clearance;
screw_y = body_width/2-8;
inner_width = body_width-2*wall;
tray_width = inner_width-2*fit;
assert(wall >= 2 && wall <= 4);
assert(battery[0]+battery[1]+4 < inner_width*sqrt(2), "電池と八角形の角が干渉します。body_widthを増やしてください。");
assert(battery[0]+2 < inner_width);
assert(shelf_z+plate_t+battery[2] < shoulder_z-wall+2, "電池上面と肩の高さを確認してください。");
assert(ball_d+wall+3 < tray_z);
assert(electronics_clearance > 0);
assert(tray_z-3 >= bevel_height+wall,
       "トレー受けが底面の傾斜部に干渉します。隙間を減らすか外装の高さを調整してください。");
assert(sound_slit < ball_d && sound_end_d < ball_d);
assert(sound_length > sound_end_d && sound_length < bottom_width-2*wall);
assert(rope_hole_width+10 <= lug_width && rope_hole_height+8 <= lug_height);
assert(tray_screw_d > 0 && tray_screw_d < tray_nut_af);
assert(tray_nut_af/cos(30) < 9, "ナットくぼみが支柱の外径を超えます。");
assert(tray_nut_depth > 0 && tray_nut_depth < shelf_z-tray_z);
assert(lid_screw_d > 0 && lid_screw_d < lid_nut_af);
assert(lid_nut_af/cos(30) < 12);
assert(lid_nut_roof >= 3 && lid_nut_height >= 2.4);
assert(lid_nut_roof+lid_nut_height < lid_screw_length-12,
       "ねじ先端がナット下面を通過するようナット受けの深さを調整してください。");
assert(seam_z-(lid_screw_length-8) > 45,
       "ねじの逃げ穴が固定部の底面を超えます。");
assert(seam_z-lid_nut_roof-lid_nut_height > shelf_z+plate_t ||
       seam_z-lid_nut_roof < shelf_z,
       "ナットの挿入口が電池棚にかかります。");

module oct2(w) { rotate(22.5) circle(d=w/cos(22.5),$fn=8); }
module slice(w,z) { translate([0,0,z]) linear_extrude(eps) oct2(w); }
module taper(w1,z1,w2,z2) { hull() { slice(w1,z1); slice(w2,z2); } }
module outer() {
    union() {
        taper(bottom_width,0,body_width,bevel_height);
        taper(body_width,bevel_height,body_width,shoulder_z);
        taper(body_width,shoulder_z,top_width,roof_z);
    }
}
module cavity() {
    union() {
        taper(bottom_width-2*wall,wall,inner_width,bevel_height+wall);
        taper(inner_width,bevel_height+wall,inner_width,shoulder_z-wall);
        taper(inner_width,shoulder_z-wall,top_width-2*wall,roof_z-wall);
    }
}
module shell() { difference() { outer(); cavity(); } }
module zclip(lo,hi) { translate([-200,-200,lo]) cube([400,400,hi-lo]); }
module sound_hole() {
    // 底面中央を上下方向に貫通。前後に延びるスリットと両端の丸穴。
    end_y = (sound_length-sound_end_d)/2;
    translate([0,0,-eps]) linear_extrude(wall+2*eps) union() {
        for(y=[-end_y,end_y]) translate([0,y]) circle(d=sound_end_d);
        square([sound_slit,2*end_y],center=true);
    }
}
module ring(w,t,h) {
    linear_extrude(h) difference() { oct2(w); oct2(w-2*t); }
}
module screw_positions() { for(y=[-screw_y,screw_y]) translate([0,y,0]) children(); }
// 内側から差し込む横穴。平行な側壁でナットの空回りを防ぐ。
// 外側は六角形の端で止め、外装には貫通させない。
module lid_nut_slots() {
    for(side=[-1,1])
        translate([0,side*screw_y,seam_z-lid_nut_roof-lid_nut_height])
            rotate([0,0,side==1 ? 0 : 180])
                hull() {
                    for(inward=[0,8]) translate([0,-inward,0])
                        rotate([0,0,30])
                            cylinder(d=lid_nut_af/cos(30),h=lid_nut_height,$fn=6);
                }
}
// Body専用。底面を広げ、八角形の頂点でも下部の張り出しを鉛直から45度以下にする。
// 共通のouter/cavityは変えず、蓋などの形状を維持する。
body_bottom_width = max(bottom_width,body_width-2*bevel_height*cos(22.5));
module body_shell() {
    difference() {
        intersection() {
            union() {
                taper(body_bottom_width,0,body_width,bevel_height);
                taper(body_width,bevel_height,body_width,seam_z);
            }
            zclip(0,seam_z);
        }
        union() {
            taper(body_bottom_width-2*wall,wall,inner_width,bevel_height+wall);
            taper(inner_width,bevel_height+wall,inner_width,seam_z+eps);
        }
    }
}
module body_tray_seat() {
    // 上面Z=48と受け幅は従来どおり。下面の4.7mmの張り出しを6mm高の斜面にする。
    seat_inner = inner_width+0.6-10;
    slope = (inner_width-seat_inner)/6;
    translate([0,0,tray_z-9]) difference() {
        linear_extrude(6+eps) oct2(inner_width+0.6);
        translate([0,0,-eps])
            linear_extrude(6+2*eps,
                scale=(seat_inner-slope*eps)/(inner_width+slope*eps))
                    oct2(inner_width+slope*eps);
    }
    translate([0,0,tray_z-3]) ring(inner_width+0.6,5,3);
}
module body_screw_bosses() {
    for(side=[-1,1]) {
        // 壁の内部から徐々に張り出す。Z=45以上の外径・位置は従来どおり。
        hull() {
            translate([0,side*(screw_y+6),33]) cylinder(r=0.2,h=eps);
            translate([0,side*screw_y,45]) cylinder(d=12,h=eps);
        }
        translate([0,side*screw_y,45]) cylinder(d=12,h=seam_z-45);
    }
}
module body_nut_bridge_relief() {
    // 穴を含む天井を一度に印刷しないための2段の逃げ。
    // 第1段は左右の壁を結ぶ最大6mmのブリッジ、第2段は前後3.4mm。
    // その上で丸穴に戻す。除去する膜はなく、ナットの前後に平らな座面を残す。
    // 各段0.3mm：この付近は積層0.2mm以下を想定。
    screw_positions() translate([0,0,seam_z-lid_nut_roof]) {
        translate([-lid_nut_af/2,-lid_screw_d/2,-eps])
            cube([lid_nut_af,lid_screw_d,0.3+eps]);
        translate([-lid_screw_d/2,-lid_screw_d/2,-eps])
            cube([lid_screw_d,lid_screw_d,0.6+eps]);
    }
}
module body() {
    difference() {
        union() {
            body_shell();
            // トレー受け。鈴室と電子機器室を分離する。
            body_tray_seat();
            body_screw_bosses();
        }
        sound_hole();
        // ナットより下までねじを通す逃げ穴。M3x35の先端は合わせ面から23mm下。
        screw_positions() translate([0,0,seam_z-(lid_screw_length-8)])
            cylinder(d=lid_screw_d,h=lid_screw_length-8+eps);
        lid_nut_slots();
        body_nut_bridge_relief();
    }
}
module lug() {
    // 穴は前後方向。上部を面取りした本体一体形状。
    translate([0,lug_thickness/2,roof_z-1]) rotate([90,0,0])
    linear_extrude(lug_thickness) difference() {
        polygon([[-lug_width/2,0],[lug_width/2,0],
                 [lug_width/2,lug_height-4],[lug_width/2-5,lug_height+1],
                 [-lug_width/2+5,lug_height+1],[-lug_width/2,lug_height-4]]);
        translate([-rope_hole_width/2,5]) square([rope_hole_width,rope_hole_height]);
    }
}
module lid() {
    difference() {
        union() {
            intersection() { shell(); zclip(seam_z+seam_gap,roof_z+eps); }
            lug();
            // 差し込みリップは胴体内壁と片側fitの隙間。
            translate([0,0,seam_z-3]) ring(inner_width-2*fit,1.8,6);
            translate([0,0,seam_z+1]) ring(inner_width+0.6,2.1+fit,2);
            screw_positions() translate([0,0,seam_z+seam_gap]) cylinder(d=12,h=15);
        }
        screw_positions() {
            translate([0,0,seam_z-4]) cylinder(d=lid_screw_d,h=60);
            translate([0,0,seam_z+12]) cylinder(d=6.6,h=60);
            // リップと下側ボスの干渉を除去
            translate([0,0,seam_z-4]) cylinder(d=12+2*fit,h=4+seam_gap);
        }
    }
}
module tray_outline() {
    difference() {
        oct2(tray_width);
        for(y=[-screw_y,screw_y]) translate([0,y]) circle(d=12+2*fit);
    }
}
module tray() {
    difference() {
        union() {
            translate([0,0,tray_z]) linear_extrude(plate_t) tray_outline();
            // 電池棚の支柱。基板の固定は結束バンド／粘着スペーサー。
            for(x=[-48,48],y=[-44,44]) translate([x,y,tray_z])
                cylinder(d=9,h=shelf_z-tray_z);
        }
        for(x=[-48,48],y=[-44,44]) {
            // 支柱とトレー底面を貫通。棚側からねじを入れ、裏面のナットで固定。
            translate([x,y,tray_z-eps])
                cylinder(d=tray_screw_d,h=shelf_z-tray_z+2*eps);
            translate([x,y,tray_z-eps])
                cylinder(d=tray_nut_af/cos(30),h=tray_nut_depth+eps,$fn=6);
        }
        // 基板用結束バンド穴
        for(x=[-48,-8,16,36],y=[-19,19])
            translate([x-2,y-1,tray_z-1]) cube([4,2,plate_t+2]);
    }
}
module shelf() {
    difference() {
        translate([0,0,shelf_z]) linear_extrude(plate_t) tray_outline();
        for(x=[-48,48],y=[-44,44]) translate([x,y,shelf_z-1]) cylinder(d=tray_screw_d,h=plate_t+2);
        // 電池を跨ぐ結束バンド用の穴
        for(x=[-45,45],y=[-battery[1]/2-3,battery[1]/2+3])
            translate([x-3,y-1,shelf_z-1]) cube([6,2,5]);
        // ケーブル通過口
        translate([-12,46,shelf_z-1]) cube([24,9,5]);
    }
}
module box_at(p,size,c) { color(c) translate(p) translate([-size[0]/2,-size[1]/2,0]) cube(size); }
module electronics(dz=0) {
    box_at([0,0,shelf_z+plate_t+dz],battery,[0.12,0.14,0.17]);
    box_at([-26,0,tray_z+plate_t+2],esp32,[0.04,0.32,0.40]);
    box_at([26,0,tray_z+plate_t+2],mpu6050,[0.02,0.35,0.65]);
}
module ball() { translate([0,0,wall+ball_d/2]) sphere(d=ball_d); }
module assembly(explode=0) {
    color([0.72,0.68,0.54]) body();
    color([0.82,0.78,0.64]) translate([0,0,explode*3]) lid();
    color([0.64,0.61,0.48]) translate([0,0,explode]) tray();
    color([0.70,0.67,0.53]) translate([0,0,explode*2]) shelf();
    color([0.86,0.63,0.18]) ball();
    if(show_electronics) translate([0,0,explode]) electronics(explode);
}
if(part=="body") body();
else if(part=="lid") translate([0,0,-(seam_z-3)]) lid();
else if(part=="tray") translate([0,0,-tray_z]) tray();
else if(part=="shelf") translate([0,0,-shelf_z]) shelf();
else if(part=="ball") translate([0,0,-wall]) ball();
else if(part=="print") {
    body();
    translate([body_width+15,0,-(seam_z-3)]) lid();
    translate([0,body_width+15,-tray_z]) tray();
    translate([body_width+15,body_width+15,-shelf_z]) shelf();
}
else if(part=="section") intersection() { assembly(); translate([-200,0,-1]) cube([400,200,300]); }
else if(part=="exploded") assembly(30);
else assembly();
