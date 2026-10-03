// 別体爪＋金属ピン＋独立ねじりバネの機構試作 / mm
// 元モデルと一体バネ試作を変更せず参照。説明は同名.md。
use <motor_gear_38.scad>
use <motor_gear_38_oneway.scad>

render_part = "open"; // open, assembly, exploded, layout, gear, hub, pawl, retainer, cover, motion
show_hardware = true; // ピン・バネは参考表示。印刷部品ではない。
show_retainer = false; // open/motionでは押さえ板を外し、爪とバネを見せる。
pawl_lift_angle = 0;  // 0=噛み合い待機 / 20=歯先から退避。物理解析ではない。
pin_d = 3;
pin_hole_d = 3.3;
spring_wire_d = 0.3;  // 市販品未選定。バネのスペース検討用。
spring_mean_d = 4.5;
spring_turns = 3;

$fn = 96;
e = 0.01;
h = 13;
base_z = 2.2;
base_h = 1.4;
pawl_z = 3.9;
pawl_h = 4;
retainer_z = 9.6;
retainer_h = 1.2;
pivot = [21,-7];
fixed_spring_end = [15,-7];
moving_spring_end = [24,-2];
assert(pin_hole_d > pin_d);
assert(pawl_lift_angle >= 0 && pawl_lift_angle <= 20);
assert(spring_mean_d-spring_wire_d > pin_d);

function rot2(p,a) = [p.x*cos(a)-p.y*sin(a),p.x*sin(a)+p.y*cos(a)];
function moved(p,a) = pivot+rot2(p-pivot,a);

module stations() { for(a=[0,120,240]) rotate([0,0,a]) children(); }
module cap_screws() {
    for(a=[60,180,300]) rotate([0,0,a]) translate([15.5,0,0]) children();
}

module carrier_profile() {
    circle(r=18.5);
    stations() hull() {
        translate([16,-6]) circle(r=3);
        translate(pivot) circle(r=3.3);
    }
}

module pawl_profile_rigid() {
    union() {
        translate(pivot) circle(r=3);
        polygon([[19.5,-6],[22.5,-8],[27.55,-0.3],[24,-0.3],[20,-4]]);
        // 駆動時に受けへ当たる短いかかと。
        translate([22,-9]) square([2,2]);
    }
}

module drive_stop_profile() {
    // 歯先r26より内側。爪のCW回転を受け、CCW退避は許す。
    difference() {
        intersection() {
            circle(r=25.7);
            translate([20,-12]) square([4,2.9]);
        }
        translate(pivot) circle(r=3.25);
    }
}

module pivot_hub() {
    difference() {
        union() {
            cylinder(r=12,h=h);
            translate([0,0,base_z]) linear_extrude(height=base_h) carrier_profile();
            translate([0,0,base_z]) cylinder(r=18.5,h=retainer_z-base_z);
            translate([0,0,base_z]) linear_extrude(height=pawl_z+pawl_h-base_z)
                stations() drive_stop_profile();
        }
        shaft_hole(h);
        stations() translate([pivot.x,pivot.y,base_z-e])
            cylinder(d=pin_hole_d,h=base_h+2*e);
        cap_screws() translate([0,0,retainer_z-5]) cylinder(d=2.2,h=5+e);
        // 固定側バネ脚の溝と曲げ端を受ける穴。上から組み込む。
        stations() {
            translate([14.6,-7.45,8.05]) cube([5,0.9,2]);
            translate([fixed_spring_end.x,fixed_spring_end.y,7.2]) cylinder(d=0.9,h=2.5);
        }
    }
}

// 出力座標は底面Z=0。組立時にpawl_zへ移動する。
module rigid_pawl() {
    difference() {
        linear_extrude(height=pawl_h) pawl_profile_rigid();
        translate([pivot.x,pivot.y,-e]) cylinder(d=pin_hole_d,h=pawl_h+2*e);
        translate([moving_spring_end.x,moving_spring_end.y,pawl_h-1.2])
            cylinder(d=0.9,h=1.2+e);
    }
}

module hub_retainer() {
    difference() {
        linear_extrude(height=retainer_h) carrier_profile();
        translate([0,0,-e]) cylinder(r=12.3,h=retainer_h+2*e);
        // 上側ピン穴は盲穴。3x8 mmピンを上下で保持する。
        stations() translate([pivot.x,pivot.y,-e]) cylinder(d=pin_hole_d,h=0.85+e);
        // M2.5皿ねじ。頭径5mm/90度の包絡。実物に合わせて調整。
        cap_screws() {
            translate([0,0,-e]) cylinder(d=2.9,h=retainer_h+2*e);
            translate([0,0,retainer_h-1.05]) cylinder(d1=2.9,d2=5,h=1.05+e);
        }
    }
}

module pivot_pawl_at(angle=0) {
    translate([pivot.x,pivot.y,pawl_z]) rotate([0,0,angle])
        translate([-pivot.x,-pivot.y,0]) rigid_pawl();
}

module wire_segment(a,b) {
    hull() {
        translate(a) sphere(d=spring_wire_d,$fn=10);
        translate(b) sphere(d=spring_wire_d,$fn=10);
    }
}

// ねじりバネ参考形状。両脚先端を下向きに曲げて固定穴へ入れる案。
// 角度変更ではコイルを据え置き、可動脚のみ追従。弾性解析ではない。
module spring_reference(angle=0) {
    lower_z = 8.25;
    upper_z = 9.1;
    end_angle = atan2(moving_spring_end.y-pivot.y,moving_spring_end.x-pivot.x)+angle;
    total_angle = spring_turns*360+end_angle-180;
    steps = 100;
    function helix(i) = [pivot.x+spring_mean_d/2*cos(180+total_angle*i/steps),
                         pivot.y+spring_mean_d/2*sin(180+total_angle*i/steps),
                         lower_z+(upper_z-lower_z)*i/steps];
    for(i=[0:steps-1]) wire_segment(helix(i),helix(i+1));
    tip = moved(moving_spring_end,angle);
    wire_segment(helix(0),[fixed_spring_end.x,fixed_spring_end.y,lower_z]);
    wire_segment([fixed_spring_end.x,fixed_spring_end.y,lower_z],
                 [fixed_spring_end.x,fixed_spring_end.y,7.4]);
    wire_segment(helix(steps),[tip.x,tip.y,upper_z]);
    wire_segment([tip.x,tip.y,upper_z],[tip.x,tip.y,7.1]);
}

module pivot_assembly(explode=0,cover=false,angle=pawl_lift_angle) {
    color("orange") clutch_gear();
    color("steelblue") translate([0,0,explode]) pivot_hub();
    color("seagreen") translate([0,0,2*explode]) stations() pivot_pawl_at(angle);
    if(cover || explode>0 || show_retainer)
        color("lightskyblue") translate([0,0,retainer_z+4*explode]) hub_retainer();
    if(show_hardware) translate([0,0,3*explode]) stations() {
        color("silver") translate([pivot.x,pivot.y,2.3]) cylinder(d=pin_d,h=8);
        color("crimson") spring_reference(angle);
    }
    if(cover) color("lightgray") translate([0,0,11.2+5*explode]) clutch_cover();
}

if(render_part=="assembly") pivot_assembly(cover=true);
else if(render_part=="open") pivot_assembly();
else if(render_part=="exploded") pivot_assembly(explode=12,cover=true);
else if(render_part=="motion") pivot_assembly(angle=10-10*cos(360*$t));
else if(render_part=="gear") clutch_gear();
else if(render_part=="hub") pivot_hub();
else if(render_part=="pawl") rigid_pawl();
else if(render_part=="retainer") hub_retainer();
else if(render_part=="cover") clutch_cover();
else if(render_part=="layout") {
    clutch_gear();
    translate([75,0,0]) pivot_hub();
    translate([0,80,0]) clutch_cover();
    translate([75,60,0]) hub_retainer();
    for(i=[0:2]) translate([105,20*i,0]) translate([-pivot.x,-pivot.y,0]) rigid_pawl();
} else assert(false,"render_partの値が不正です");

echo("PROTOTYPE: spring not selected; torque and 160 RPM operation unverified");
echo("Drive: motor CCW / turntable CW, viewed from +Z");
