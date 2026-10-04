// 全印刷・2球式ワンウェイクラッチの形状試作 / mm（円筒版も選択可）
// 参考: https://note.com/tomohiro_hiyama/n/n3b9a240ac29b
// 原作のカム＋転動体の考え方を使い、38歯・D軸用に独自寸法で作成。
// モーターCCW駆動→テーブルCW（+Zから見た方向）。強度・寿命は未検証。
use <../motor_gear_38.scad>

render_part = "open"; // open, assembly, exploded, layout, gear, hub, ring, roller, cover, pin, motion
roller_state = "free"; // free または wedge（噛み込み直前の幾何位置）
reverse_direction = false;
roller_d = 6;
roller_shape = "ball"; // ball: 向きに依存しない球（既定） / cylinder: 従来の円筒
roller_h = 8.4;
roller_chamfer = 0.3;
race_r = 28;
release_clearance = 0.8; // 広い側の公称すき間=ローラー径+この値
cam_interference = 1;   // 狭い側の公称すき間=ローラー径-この値
radial_gap = 0.3;       // ハブの上下ジャーナル片側すき間
axial_gap = 0.3;
pin_hole_d = 3.15;      // 固定ピンのはまり具合は試し刷りで調整
pin_shaft_d = 3.3;      // 割り入り印刷ピン。実物の保持力は未検証

$fn = 180;
eps = 0.01;
height = motor_gear_specs()[3];
floor_h = 1.8;
cover_h = 1.8;
cover_z = height-cover_h;
cam_z = floor_h+axial_gap;
cam_h = cover_z-axial_gap-cam_z;
journal_r = 10;
cover_r = 32.5;
pin_radius = 30.4;
cam_high_r = race_r-roller_d+cam_interference;
cam_low_r = race_r-roller_d-release_clearance;
barrier_r = race_r-1.2;
roller_center_r = race_r-roller_d/2-0.04;
free_angle = 49;
// 球は重力で床に載る位置を表示（表示用すき間0.04mm）。
roller_z = roller_shape=="ball" ? floor_h+0.04 : floor_h+(cover_z-floor_h-roller_h)/2;
pin_depth = 7.5;
pin_head_h = 1.2;

assert(roller_d>=4 && roller_d<=8);
assert(roller_shape=="ball" || roller_shape=="cylinder");
assert(roller_d+0.08<cover_z-floor_h,"球の上下すき間が不足しています");
// 床側・蓋側のどちらへ寄っても球の赤道がカム側面の高さ内にある。
assert(floor_h+roller_d/2>cam_z && cover_z-roller_d/2<cam_z+cam_h);
assert(cam_low_r>journal_r+2 && cam_high_r<barrier_r);
assert(roller_h>2*roller_chamfer && roller_h<=cam_h);
assert(release_clearance>0 && cam_interference>0);
assert(pin_radius-pin_hole_d/2>race_r);
assert(radial_gap>0 && axial_gap>0);

function polar(r,a) = [r*cos(a),r*sin(a)];
// 0〜50度: CCWへ広がるカム通路。反時計回り駆動時、ローラーは
// ハブに対して時計回りへ移り、狭い側に噛む。50〜65度は逃げ領域。
function cam_radius(a) =
    a<=50 ? cam_high_r+(cam_low_r-cam_high_r)*a/50 :
    a<=65 ? cam_low_r : barrier_r;
// 広い側の終端は半径方向の壁。ここに第2の浅いくさびを作らない。
cam_points = [for(sector=[0,180],i=[0:180]) each
    (i==65 ? [polar(cam_low_r,sector+i),polar(barrier_r,sector+i)] :
             [polar(cam_radius(i),sector+i)])];

// 転動体の赤道円とカム多角形の距離。半径差だけでは接触位置は決まらない。
function dot2(a,b) = a.x*b.x+a.y*b.y;
function segment_distance(p,a,b) =
    let(v=b-a,t=max(0,min(1,dot2(p-a,v)/dot2(v,v)))) norm(p-(a+t*v));
function cam_distance(a) = let(p=polar(roller_center_r,a))
    min([for(i=[0:len(cam_points)-1])
        segment_distance(p,cam_points[i],cam_points[(i+1)%len(cam_points)])]);
function contact_angle(lo=10,hi=45,n=22) =
    n==0 ? (lo+hi)/2 :
    let(mid=(lo+hi)/2)
    cam_distance(mid)<roller_d/2+0.04 ? contact_angle(mid,hi,n-1) : contact_angle(lo,mid,n-1);
wedge_angle = contact_angle();
assert(cam_distance(10)<roller_d/2 && cam_distance(45)>roller_d/2+0.04,
       "この寸法では噛み込み位置を探索できません。カム寸法を調整してください");
assert(cam_distance(free_angle)>roller_d/2+0.2,"解放側のすき間が不足しています");

module handed() {
    if(reverse_direction) mirror([0,1,0]) children(); else children();
}
module pin_positions() {
    for(a=[30,150,270]) rotate([0,0,a]) translate([pin_radius,0,0]) children();
}
module cam_profile() { handed() polygon(cam_points); }

module roller_gear() {
    difference() {
        motor_gear();
        translate([0,0,-eps]) cylinder(r=journal_r+radial_gap,h=height+2*eps);
        translate([0,0,floor_h]) cylinder(r=race_r,h=height);
        translate([0,0,cover_z]) cylinder(r=cover_r+0.25,h=cover_h+eps);
        pin_positions() translate([0,0,height-pin_depth-0.3])
            cylinder(d=pin_hole_d,h=pin_depth+1);
    }
}

// 下側支持部を別リングへ分離。本体は平らなカム下面をZ=0として印刷。
module hub_body() {
    difference() {
        union() {
            cylinder(r=journal_r,h=height-cam_z);
            linear_extrude(height=cam_h) cam_profile();
        }
        // 組立時のD穴と上側面取りの位置を維持する。
        translate([0,0,-cam_z]) shaft_hole(height);
    }
}

module lower_ring() {
    difference() {
        cylinder(r=journal_r,h=cam_z);
        // 元モデルの下側面取りを維持。接合面は平らなD穴。
        shaft_hole(height);
    }
}

// 干渉検査等で使う組立座標のハブ。本体とリングで従来の外形を再現。
module cam_hub() {
    lower_ring();
    translate([0,0,cam_z]) hub_body();
}

module printed_roller() {
    if(roller_shape=="ball") {
        // 平面カットなしの球。印刷時はサポートを使い、除去後に表面を仕上げる。
        translate([0,0,roller_d/2]) sphere(d=roller_d);
    } else union() {
        cylinder(d1=roller_d-2*roller_chamfer,d2=roller_d,h=roller_chamfer);
        translate([0,0,roller_chamfer]) cylinder(d=roller_d,h=roller_h-2*roller_chamfer);
        translate([0,0,roller_h-roller_chamfer])
            cylinder(d1=roller_d,d2=roller_d-2*roller_chamfer,h=roller_chamfer);
    }
}

module roller_cover() {
    difference() {
        cylinder(r=cover_r,h=cover_h);
        translate([0,0,-eps]) cylinder(r=journal_r+radial_gap,h=cover_h+2*eps);
        pin_positions() translate([0,0,-eps]) cylinder(d=pin_hole_d,h=cover_h+2*eps);
    }
}

// 頭を下にして印刷する。スリットを持つ摩擦保持ピン（ねじではない）。
module printed_pin() {
    difference() {
        union() {
            cylinder(d=4.8,h=pin_head_h);
            translate([0,0,pin_head_h]) cylinder(d=pin_shaft_d,h=pin_depth-0.8);
            translate([0,0,pin_head_h+pin_depth-0.8])
                cylinder(d1=pin_shaft_d,d2=pin_shaft_d-0.6,h=0.8);
        }
        translate([-0.4,-3,pin_head_h+1.2]) cube([0.8,6,pin_depth]);
    }
}

module rollers_at(a=free_angle) {
    handed() for(offset=[0,180]) rotate([0,0,a+offset])
        translate([roller_center_r,0,roller_z]) printed_roller();
}

module roller_assembly(explode=0,cover=false,a=free_angle) {
    color("orange") roller_gear();
    color("goldenrod") translate([0,0,explode]) lower_ring();
    color("steelblue") translate([0,0,cam_z+2*explode]) hub_body();
    color("seagreen") translate([0,0,3*explode]) rollers_at(a);
    if(cover) {
        color("lightgray") translate([0,0,cover_z+4*explode]) roller_cover();
        color("orchid") pin_positions() translate([0,0,height+pin_head_h+5*explode])
            rotate([180,0,0]) printed_pin();
    }
}

assert(roller_state=="free" || roller_state=="wedge");
display_angle = roller_state=="free" ? free_angle : wedge_angle;
if(render_part=="open") roller_assembly(a=display_angle);
else if(render_part=="assembly") roller_assembly(cover=true,a=display_angle);
else if(render_part=="exploded") roller_assembly(explode=14,cover=true,a=display_angle);
else if(render_part=="motion")
    roller_assembly(a=wedge_angle+(free_angle-wedge_angle)*(0.5-0.5*cos(360*$t)));
else if(render_part=="gear") roller_gear();
else if(render_part=="hub") hub_body();
else if(render_part=="ring") lower_ring();
else if(render_part=="roller") printed_roller();
else if(render_part=="cover") roller_cover();
else if(render_part=="pin") printed_pin();
else if(render_part=="layout") {
    roller_gear();
    translate([76,0,0]) hub_body();
    translate([0,80,0]) roller_cover();
    translate([105,60,0]) lower_ring();
    for(i=[0,1]) translate([65+12*i,55,0]) printed_roller();
    for(i=[0:2]) translate([62+12*i,75,0]) printed_pin();
} else assert(false,"render_partの値が不正です");

echo("Printed roller clutch PROTOTYPE: load capacity, release, fatigue unverified");
echo("Rolling elements: shape / diameter / height / count",roller_shape,roller_d,
     roller_shape=="ball" ? roller_d : roller_h,2);
echo("Free / near-wedge angles",free_angle,wedge_angle);
echo("Free cam-to-roller surface gap",cam_distance(free_angle)-roller_d/2);
