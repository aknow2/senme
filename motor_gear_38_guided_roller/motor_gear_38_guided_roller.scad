// 全印刷・9円筒ローラー / 上下ガイド式ワンウェイクラッチ試作 / mm
// +Zから見てモーターCCW駆動、112歯テーブルCW。実負荷未検証。
// 印刷: gear/hub/ring/cover 各1、roller/axle 各9、pin 3個（計25部品）。
// すべてPETG。各STLのZ=0面を下へ。蓋はガイド溝を上にして印刷し、
// 組立時は溝を下へ向ける。本体10.7mm＋下リング2.3mmで高さ13mm。
// ローラーは中実相当（中心の軸穴は残す）、φ2の軸は縦置き＋必要ならブリム。
// 組立: 下リング→ハブ→ローラーに軸を通す→軸下端を床の環状溝へ入れる
// →9本全ての上端を蓋の環状溝へ入れる→印刷ピン3本で蓋を保持。
// 軸はハブに固定しない。溝内で周方向へ移動できることが噛み込みに必要。
// ローラー上下すき間は各0.25mm。軸端は上下の溝へ各0.8mm入る。
// 軸が上下へ最大0.4mm移動しても、反対側の溝へ0.4mm残る（直立時）。
// 少量の傾き・遊びは許す設計。「完全に垂直」ではなく横倒れを抑える。
// 最初はローラーと軸を各1個試し刷りし、穴に通り軽く回ることを確認。
// バリ・シームを除去し、蓋を締めても噛み込み→解放を手回しで確認する。
// ピン頭は高さ13mmから1.2mm突出。モーター軸からの抜け止めは別途必要。
// ローラー9本は本カム形状・基準径・最小隔壁2mmの条件での上限。
// 9等分の荷重分担や旧版の4.5倍の強度を意味しない。始動・摩耗・解放力、
// 160RPM/10kgf.cmでの能力は未検証。バネなしによる噛み込み遅れも残る。
// 旧版とは床・蓋・ハブが異なるため、このフォルダの部品を一式で使用する。
// CAD検証: 7種類のSTL生成・閉メッシュ確認済み。解放位置/噛み込み直前の
// ローラー+軸とハブ+床+蓋の共通体積は空。ハブと床+蓋も干渉なし。
// 41点のカム距離検査、狭い側での接触を確認。荷重・傾斜時の挙動は未解析。
use <../motor_gear_38.scad>

render_part = "open"; // open, assembly, section, exploded, layout, gear, hub, ring, roller, axle, cover, pin, motion
roller_state = "free"; // free, wedge
roller_count = 9;       // このカム形状では3〜9本。溝間肉厚をassertで制限。
reverse_direction = false;
roller_d = 6.2;         // 実際に出力するローラー径
cam_design_d = 6.2;     // カム設計基準径。ローラー径の試験時もここは変えない。
roller_h = 8.5;
roller_chamfer = 0.25;
axle_d = 2;
axle_h = 10.6;
roller_bore_d = 2.35;
guide_width = 2.8;
guide_depth = 1.2;
release_gap = 0.6;
cam_interference = 0.5;
cam_ramp_angle = 28;
pocket_end_angle = 34;
min_web = 2;
radial_gap = 0.3;
pin_d = 3.3;
pin_hole_d = 3.15;

$fn = 180;
eps = 0.01;
height = motor_gear_specs()[3];
floor_h = 2;
cover_h = 2;
cover_z = height-cover_h;
cam_z = floor_h+0.3;
cam_h = cover_z-0.3-cam_z;
race_r = 28;
journal_r = 10;
cover_r = 32.5;
pin_radius = 30.8;
pin_depth = 7.5;
pin_head_h = 1.2;
pitch = 360/roller_count;
cam_low_r = race_r-cam_design_d-release_gap;
cam_high_r = race_r-cam_design_d+cam_interference;
barrier_r = race_r-1.2;
guide_r = race_r-cam_design_d/2-0.04;
roller_center_r = race_r-roller_d/2-0.04;
roller_z = (height-roller_h)/2;
axle_z = (height-axle_h)/2;
free_angle = 26;
web = 2*cam_low_r*sin((pitch-pocket_end_angle)/2);

assert(roller_count>=3 && roller_count<=9 && floor(roller_count)==roller_count);
assert(pitch>pocket_end_angle && web>=min_web,"ポケット間の肉厚不足");
assert(roller_d>=5.8 && roller_d<=6.4);
assert(roller_bore_d>axle_d && roller_d-roller_bore_d>3);
assert(roller_z>floor_h && roller_z+roller_h<cover_z);
assert(floor_h-guide_depth>0.6 && cover_h-guide_depth>0.6);
assert(axle_z>floor_h-guide_depth && axle_z+axle_h<cover_z+guide_depth);
assert(floor_h-axle_z>0.6 && axle_z+axle_h-cover_z>0.6);
assert(abs(roller_center_r-guide_r)+axle_d/2<guide_width/2);
assert(guide_r+guide_width/2<race_r);
assert(pin_radius-pin_hole_d/2>race_r);
assert(roller_chamfer>0 && roller_h>2*roller_chamfer);

function polar(r,a) = [r*cos(a),r*sin(a)];
function ramp_r(a) = a<=cam_ramp_angle ?
    cam_high_r+(cam_low_r-cam_high_r)*a/cam_ramp_angle : cam_low_r;
// 1区画: 下降カム→解放部→半径方向の終端壁→肉厚を確保した隔壁。
function sector_points(s) = concat(
    [for(i=[0:cam_ramp_angle]) polar(ramp_r(i),s+i)],
    [polar(cam_low_r,s+pocket_end_angle),polar(barrier_r,s+pocket_end_angle)],
    [for(i=[1:ceil(pitch-pocket_end_angle)])
        polar(barrier_r,s+pocket_end_angle+(pitch-pocket_end_angle)*i/ceil(pitch-pocket_end_angle))]);
cam_points = [for(k=[0:roller_count-1]) each sector_points(k*pitch)];
function dot2(a,b) = a.x*b.x+a.y*b.y;
function seg_dist(p,a,b) = let(v=b-a,t=max(0,min(1,dot2(p-a,v)/dot2(v,v)))) norm(p-a-t*v);
function cam_distance(a) = let(p=polar(roller_center_r,a))
    min([for(i=[0:len(cam_points)-1]) seg_dist(p,cam_points[i],cam_points[(i+1)%len(cam_points)])]);
function contact_angle(lo=8,hi=26,n=20) = n==0 ? (lo+hi)/2 :
    let(m=(lo+hi)/2) cam_distance(m)<roller_d/2+0.04 ? contact_angle(m,hi,n-1) : contact_angle(lo,m,n-1);
wedge_angle = contact_angle();
assert(cam_distance(8)<roller_d/2 && cam_distance(free_angle)>roller_d/2+0.2,
       "噛み込み・解放位置が成立しません");

module handed() { if(reverse_direction) mirror([0,1,0]) children(); else children(); }
module pin_positions() {
    for(a=[30,150,270]) rotate([0,0,a]) translate([pin_radius,0,0]) children();
}
module cam_profile() { handed() polygon(cam_points); }
module guide_track(depth) {
    difference() {
        cylinder(r=guide_r+guide_width/2,h=depth);
        translate([0,0,-eps]) cylinder(r=guide_r-guide_width/2,h=depth+2*eps);
    }
}

module outer_gear() {
    difference() {
        motor_gear();
        translate([0,0,-eps]) cylinder(r=journal_r+radial_gap,h=height+2*eps);
        translate([0,0,floor_h]) cylinder(r=race_r,h=height);
        translate([0,0,floor_h-guide_depth]) guide_track(guide_depth+eps);
        translate([0,0,cover_z]) cylinder(r=cover_r+0.25,h=cover_h+eps);
        pin_positions() translate([0,0,height-pin_depth-0.3]) cylinder(d=pin_hole_d,h=pin_depth+1);
    }
}

module hub_body() {
    difference() {
        union() {
            cylinder(r=journal_r,h=height-cam_z);
            linear_extrude(height=cam_h) cam_profile();
        }
        translate([0,0,-cam_z]) shaft_hole(height);
    }
}
module lower_ring() {
    difference() { cylinder(r=journal_r,h=cam_z); shaft_hole(height); }
}
module assembled_hub() {
    lower_ring(); translate([0,0,cam_z]) hub_body();
}

module roller() {
    difference() {
        union() {
            cylinder(d1=roller_d-2*roller_chamfer,d2=roller_d,h=roller_chamfer);
            translate([0,0,roller_chamfer]) cylinder(d=roller_d,h=roller_h-2*roller_chamfer);
            translate([0,0,roller_h-roller_chamfer]) cylinder(d1=roller_d,d2=roller_d-2*roller_chamfer,h=roller_chamfer);
        }
        translate([0,0,-eps]) cylinder(d=roller_bore_d,h=roller_h+2*eps);
    }
}
module axle() {
    cylinder(d1=axle_d-0.3,d2=axle_d,h=0.15);
    translate([0,0,0.15]) cylinder(d=axle_d,h=axle_h-0.3);
    translate([0,0,axle_h-0.15]) cylinder(d1=axle_d,d2=axle_d-0.3,h=0.15);
}

// 印刷面はZ=0。ガイド溝を上に向けるため組立時に裏返す。
module cover() {
    difference() {
        cylinder(r=cover_r,h=cover_h);
        translate([0,0,-eps]) cylinder(r=journal_r+radial_gap,h=cover_h+2*eps);
        translate([0,0,cover_h-guide_depth]) guide_track(guide_depth+eps);
        pin_positions() translate([0,0,-eps]) cylinder(d=pin_hole_d,h=cover_h+2*eps);
    }
}
module assembled_cover() {
    // X反転後のねじ穴角度を元に戻すためZ軸で60度回す。
    translate([0,0,height]) rotate([0,0,60]) rotate([180,0,0]) cover();
}
module pin() {
    difference() {
        union() {
            cylinder(d=4.8,h=pin_head_h);
            translate([0,0,pin_head_h]) cylinder(d=pin_d,h=pin_depth-0.8);
            translate([0,0,pin_head_h+pin_depth-0.8]) cylinder(d1=pin_d,d2=pin_d-0.6,h=0.8);
        }
        translate([-0.4,-3,pin_head_h+1.2]) cube([0.8,6,pin_depth]);
    }
}
module element_positions(a) {
    handed() for(k=[0:roller_count-1]) rotate([0,0,a+k*pitch]) translate([roller_center_r,0,0]) children();
}
module rolling_elements(a=free_angle) {
    element_positions(a) {
        translate([0,0,roller_z]) roller();
        translate([0,0,axle_z]) axle();
    }
}
module assembly(explode=0,lid=false,a=free_angle) {
    color("orange") outer_gear();
    color("goldenrod") translate([0,0,explode]) lower_ring();
    color("steelblue") translate([0,0,cam_z+2*explode]) hub_body();
    element_positions(a) {
        color("seagreen") translate([0,0,roller_z+3*explode]) roller();
        color("crimson") translate([0,0,axle_z+4*explode]) axle();
    }
    if(lid) {
        color("lightgray") translate([0,0,5*explode]) assembled_cover();
        color("orchid") pin_positions() translate([0,0,height+pin_head_h+6*explode]) rotate([180,0,0]) pin();
    }
}

assert(roller_state=="free" || roller_state=="wedge");
display_angle = roller_state=="free" ? free_angle : wedge_angle;
if(render_part=="open") assembly(a=display_angle);
else if(render_part=="assembly") assembly(lid=true,a=display_angle);
else if(render_part=="section") intersection() {
    rotate([0,0,reverse_direction ? display_angle : -display_angle]) assembly(lid=true,a=display_angle);
    translate([-50,-50,-1]) cube([100,50.01,30]);
}
else if(render_part=="exploded") assembly(explode=10,lid=true,a=display_angle);
else if(render_part=="motion") assembly(a=wedge_angle+(free_angle-wedge_angle)*(0.5-0.5*cos(360*$t)));
else if(render_part=="gear") outer_gear();
else if(render_part=="hub") hub_body();
else if(render_part=="ring") lower_ring();
else if(render_part=="roller") roller();
else if(render_part=="axle") axle();
else if(render_part=="cover") cover();
else if(render_part=="pin") pin();
else if(render_part=="layout") {
    outer_gear(); translate([78,0,0]) hub_body();
    translate([0,80,0]) cover(); translate([80,50,0]) lower_ring();
    for(i=[0:roller_count-1]) {
        translate([60+(i%3)*12,78+floor(i/3)*12,0]) roller();
        translate([102+(i%3)*7,78+floor(i/3)*12,0]) axle();
    }
    for(i=[0:2]) translate([108,25+12*i,0]) pin();
} else assert(false,"render_partの値が不正です");

echo("PROTOTYPE: equal load sharing, torque, release and lifetime unverified");
echo("Roller count / diameter / height",roller_count,roller_d,roller_h);
echo("Cam web mm",web);
echo("Free gap / wedge angle",cam_distance(free_angle)-roller_d/2,wedge_angle);
