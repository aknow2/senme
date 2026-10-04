// 全印刷・6鼓形ローラー式ワンウェイクラッチ v2 / mm
// +Zから見てモーターCCW駆動、112歯テーブルCW。実負荷未検証。
// 印刷: gear/hub/ring/cover 各1、roller 6個、pin 3個（計13部品）。
// 全部PETG。軸・バネ・球は不要。各STLのZ=0面を下にして印刷。
// ローラー: 中央φ6.2、上下φ7.4、高さ8.5、上下の斜面各2mm。
// 蓋は突起を上にして印刷し、組立時は裏返す（突起が下）。
// 組立: ギアを平置き→下リング→ハブ（D穴を合わせる）。
// 各ポケットの広い側（insertビュー）で、中心半径24mmにローラーを上から挿入。
// 底まで入れた後、各ローラーを外周側へ0.86mm寄せる（openビュー）。
// 蓋のリング状突起を下にして載せ、3穴を合わせてピンを差す。
// 蓋が浮く場合は押し込まず、ローラーが外側に寄っているか確認。
// リング状突起がローラー上端の内倒れを制限。全周連続なので空転を妨げない。
// カム上端と蓋突起下端は軸方向に0.3mm離し、どの回転位置でも干渉させない。
// 下側鼓形面・上側リング・上下端面で姿勢を制限する。ガタゼロではない。
// ハブは下面平坦。ハブ10.7＋別リング2.3で組立高さ13mm。
// リングのD穴入口の面取り側を下。ローラーは上下対称、中実で印刷。
// シーム・バリ・初層膨らみを除去し、通電前に手回しで噛み込み/解放を確認。
// 今回の一式で組み立てる。旧9個版とはハブ・蓋が異なる。
// 6個の均等荷重、噛み込み遅れ、解放抵抗、160RPM/10kgf.cm耐久性は未検証。
// ピン頭は幅8×奥行5mm、蓋上面より4mm突出。頭の下に1mmのつかみ代。
// モーター軸からの抜け止めは別途必要。
use <../motor_gear_38.scad>

render_part = "open"; // open, insert, assembly, section, exploded, layout, gear, hub, ring, roller, cover, pin, motion
roller_state = "free"; // free, wedge
roller_count = 6;       // 組立スペースを確保するため6個。
reverse_direction = false;
roller_d = 6.2;         // 実際に出力するローラー径
cam_design_d = 6.2;     // カム設計基準径。ローラー径の試験時もここは変えない。
roller_h = 8.5;
roller_end_d = 7.4;    // 上下の太い部分
shoulder_h = 2;        // 上下の斜面の高さ
guide_relief = 0.8;    // ギア・カムの端部の逃げ量（半径方向）
release_gap = 2.0;      // 広い挿入部を作るための余裕
cam_interference = 0.5;
cam_ramp_angle = 27;
loading_ramp_end = 31;
loading_center_r = 24;
loading_clearance = 0.2; // 挿入経路の検証用余裕（半径方向）
pocket_end_angle = 48;
min_web = 2;
radial_gap = 0.3;
pin_d = 3.1;           // 実物がきつかったため、差し込み径を3.3から0.2mm縮小。
pin_hole_d = 3.15;

$fn = 180;
eps = 0.01;
height = motor_gear_specs()[3];
floor_h = 2;
cover_h = 2;
cover_z = height-cover_h;
cam_z = floor_h+0.3;
guide_bottom_z = 9.5;
guide_h = cover_z-guide_bottom_z;
guide_outer_r = 20.85;
guide_inner_r = 19.3;
cam_h = guide_bottom_z-0.3-cam_z;
race_r = 28;
journal_r = 10;
cover_r = 34.5;
pin_radius = 32;
pin_depth = 7.5;
pin_head_h = 4;
pin_grip_h = 3;
pitch = 360/roller_count;
cam_low_r = race_r-cam_design_d-release_gap;
cam_high_r = race_r-cam_design_d+cam_interference;
drive_end_r = race_r-cam_design_d-0.6;
barrier_r = race_r-1.2;
roller_center_r = race_r-roller_d/2-0.04;
roller_z = (height-roller_h)/2;
waist_bottom_z = roller_z+shoulder_h;
waist_top_z = roller_z+roller_h-shoulder_h;
free_angle = 36;
web = 2*cam_low_r*sin((pitch-pocket_end_angle)/2);

assert(roller_count>=3 && roller_count<=6 && floor(roller_count)==roller_count);
assert(pitch>pocket_end_angle && web>=min_web,"ポケット間の肉厚不足");
assert(roller_d>=5.8 && roller_d<=6.4);
assert(roller_z>floor_h && roller_z+roller_h<cover_z);
assert(roller_end_d>roller_d && roller_h>2*shoulder_h);
assert(guide_relief>(roller_end_d-roller_d)/2);
assert(web-2*guide_relief>=0.8,"ガイド端部の隔壁が薄すぎます");
assert(pin_radius-pin_hole_d/2>race_r+guide_relief+0.5);
assert(pin_radius+pin_hole_d/2<cover_r-0.5);

function polar(r,a) = [r*cos(a),r*sin(a)];
function ramp_r(a) = a<=cam_ramp_angle ?
    cam_high_r+(drive_end_r-cam_high_r)*a/cam_ramp_angle :
    a<=loading_ramp_end ? drive_end_r+(cam_low_r-drive_end_r)*(a-cam_ramp_angle)/(loading_ramp_end-cam_ramp_angle) : cam_low_r;
// 1区画: 下降カム→解放部→半径方向の終端壁→肉厚を確保した隔壁。
function sector_points(s) = concat(
    [for(i=[0:loading_ramp_end]) polar(ramp_r(i),s+i)],
    [polar(cam_low_r,s+pocket_end_angle),polar(barrier_r,s+pocket_end_angle)],
    [polar(barrier_r,s+pitch)]); // 隔壁の外側は直線。端部オフセットの折り返しを防ぐ。
cam_points = [for(k=[0:roller_count-1]) each sector_points(k*pitch)];
function dot2(a,b) = a.x*b.x+a.y*b.y;
function seg_dist(p,a,b) = let(v=b-a,t=max(0,min(1,dot2(p-a,v)/dot2(v,v)))) norm(p-a-t*v);
function cam_distance(a,r=roller_center_r) = let(p=polar(r,a))
    min([for(i=[0:len(cam_points)-1]) seg_dist(p,cam_points[i],cam_points[(i+1)%len(cam_points)])]);
function contact_angle(lo=8,hi=25,n=20) = n==0 ? (lo+hi)/2 :
    let(m=(lo+hi)/2) cam_distance(m)<roller_d/2+0.04 ? contact_angle(m,hi,n-1) : contact_angle(lo,m,n-1);
wedge_angle = contact_angle();
assert(cam_distance(8)<roller_d/2 && cam_distance(free_angle)>roller_d/2+0.2,
       "噛み込み・解放位置が成立しません");

module handed() { if(reverse_direction) mirror([0,1,0]) children(); else children(); }
module pin_positions() {
    for(a=[30,150,270]) rotate([0,0,a]) translate([pin_radius,0,0]) children();
}
module cam_profile() { handed() polygon(cam_points); }
// 多角形を内側へ一定距離ずらすマイターオフセット。同じ頂点数でロフトする。
function unit(v) = v/norm(v);
function inward(v) = [-v.y,v.x];
function inset_vertex(i,d) =
    let(p=cam_points[i], prev=cam_points[(i-1+len(cam_points))%len(cam_points)],
        next=cam_points[(i+1)%len(cam_points)],
        n1=inward(unit(p-prev)),n2=inward(unit(next-p)))
    p+(n1+n2)*d/(1+dot2(n1,n2));
loft_z = [0,waist_bottom_z-cam_z,waist_top_z-cam_z,cam_h];
loft_inset = [guide_relief,0,0,guide_relief];
module shaped_cam() {
    n=len(cam_points);
    points=[for(k=[0:3],i=[0:n-1]) let(p=inset_vertex(i,loft_inset[k])) [p.x,p.y,loft_z[k]]];
    faces=concat(
        [[for(i=[n-1:-1:0]) i]],
        [for(k=[0:2],i=[0:n-1]) each [
            [k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n],
            [k*n+i,(k+1)*n+(i+1)%n,(k+1)*n+i]]],
        [[for(i=[0:n-1]) 3*n+i]]);
    handed() polyhedron(points=points,
        faces=[for(f=faces) [for(i=[len(f)-1:-1:0]) f[i]]],convexity=10);
}
// 円形受け面は中央で内側へ張り出し、上下に逃げる。
module shaped_race_void() {
    translate([0,0,floor_h]) cylinder(r1=race_r+guide_relief,r2=race_r,h=waist_bottom_z-floor_h);
    translate([0,0,waist_bottom_z-eps]) cylinder(r=race_r,h=waist_top_z-waist_bottom_z+2*eps);
    translate([0,0,waist_top_z]) cylinder(r1=race_r,r2=race_r+guide_relief,h=cover_z-waist_top_z+eps);
}

module outer_gear() {
    difference() {
        motor_gear();
        translate([0,0,-eps]) cylinder(r=journal_r+radial_gap,h=height+2*eps);
        shaped_race_void();
        translate([0,0,cover_z]) cylinder(r=cover_r+0.25,h=cover_h+eps);
        pin_positions() translate([0,0,height-pin_depth-0.3]) cylinder(d=pin_hole_d,h=pin_depth+1);
    }
}

module hub_body() {
    difference() {
        union() {
            cylinder(r=journal_r,h=height-cam_z);
            shaped_cam();
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
    // 軸穴なし。太い端面を下に印刷し、上側も緩い斜面なのでサポート不要。
    rotate_extrude(convexity=4)
        polygon([[0,0],[roller_end_d/2,0],[roller_d/2,shoulder_h],
                 [roller_d/2,roller_h-shoulder_h],[roller_end_d/2,roller_h],[0,roller_h]]);
}
module cover() {
    // 印刷姿勢: 外面を下、倒れ止めリングを上。組立時に裏返す。
    difference() {
        union() {
            cylinder(r=cover_r,h=cover_h);
            translate([0,0,cover_h-eps]) difference() {
                union() {
                    cylinder(r=guide_outer_r,h=guide_h-0.35+eps);
                    translate([0,0,guide_h-0.35]) cylinder(r1=guide_outer_r,r2=guide_outer_r-0.35,h=0.35+eps);
                }
                translate([0,0,-eps]) cylinder(r=guide_inner_r,h=guide_h+3*eps);
            }
        }
        translate([0,0,-eps]) cylinder(r=journal_r+radial_gap,h=cover_h+2*eps);
        pin_positions() translate([0,0,-eps]) cylinder(d=pin_hole_d,h=cover_h+2*eps);
    }
}
module assembled_cover() { translate([0,0,height]) rotate([0,0,60]) rotate([180,0,0]) cover(); }
module pin() {
    difference() {
        union() {
            // 印刷時は大きな頭を下。平行な2面を指・ペンチでつかめる。
            intersection() {
                cylinder(d=8,h=pin_grip_h);
                translate([-2.5,-4,0]) cube([5,8,pin_grip_h]);
            }
            // 組立時に頭の下へ1mmの隙間を作る首。
            translate([0,0,pin_grip_h-eps]) cylinder(d=4.8,h=pin_head_h-pin_grip_h+eps);
            translate([0,0,pin_head_h]) cylinder(d=pin_d,h=pin_depth-0.8);
            translate([0,0,pin_head_h+pin_depth-0.8]) cylinder(d1=pin_d,d2=pin_d-0.6,h=0.8);
        }
        translate([-0.4,-3,pin_head_h+1.2]) cube([0.8,6,pin_depth]);
    }
}
module element_positions(a,r=roller_center_r) {
    handed() for(k=[0:roller_count-1]) rotate([0,0,a+k*pitch]) translate([r,0,0]) children();
}
module rolling_elements(a=free_angle) {
    element_positions(a) {
        translate([0,0,roller_z]) roller();
    }
}
module assembly(explode=0,lid=false,a=free_angle,r=roller_center_r) {
    color("orange") outer_gear();
    color("goldenrod") translate([0,0,explode]) lower_ring();
    color("steelblue") translate([0,0,cam_z+2*explode]) hub_body();
    element_positions(a,r) {
        color("seagreen") translate([0,0,roller_z+3*explode]) roller();
    }
    if(lid) {
        color("lightgray") translate([0,0,4*explode]) assembled_cover();
        color("orchid") pin_positions() translate([0,0,height+pin_head_h+5*explode]) rotate([180,0,0]) pin();
    }
}

assert(roller_state=="free" || roller_state=="wedge");
display_angle = roller_state=="free" ? free_angle : wedge_angle;
if(render_part=="open") assembly(a=display_angle);
else if(render_part=="insert") assembly(a=free_angle,r=loading_center_r);
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
else if(render_part=="cover") cover();
else if(render_part=="pin") pin();
else if(render_part=="layout") {
    outer_gear(); translate([78,0,0]) hub_body();
    translate([0,80,0]) cover(); translate([80,50,0]) lower_ring();
    for(i=[0:roller_count-1]) {
        translate([60+(i%3)*12,78+floor(i/3)*12,0]) roller();
    }
    for(i=[0:2]) translate([108,25+12*i,0]) pin();
} else assert(false,"render_partの値が不正です");

echo("PROTOTYPE: equal load sharing, torque, release and lifetime unverified");
echo("Roller count / diameter / height",roller_count,roller_d,roller_h);
echo("Cam web mm",web);
echo("Free gap / wedge angle",cam_distance(free_angle)-roller_d/2,wedge_angle);

assert(cam_distance(free_angle,loading_center_r)>roller_end_d/2+loading_clearance,"挿入時にハブに接触");
assert(loading_center_r+roller_end_d/2+loading_clearance<race_r*cos(180/$fn),"挿入時に外ギアに接触");
assert(roller_center_r-roller_end_d/2-guide_outer_r>=0.25,"蓋ガイドの隙間不足");
assert(cam_z+cam_h+0.29<guide_bottom_z,"蓋ガイドとカムが接触");
echo("Insertion hub / outer radial clearance",cam_distance(free_angle,loading_center_r)-roller_end_d/2,race_r-loading_center_r-roller_end_d/2);
echo("Top guide inner clearance",roller_center_r-roller_end_d/2-guide_outer_r);
