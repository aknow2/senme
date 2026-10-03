// main_gear.scad + motor_gear_38.scad のかみ合いアニメーション
// OpenSCADで開き、F5 → 表示(View) → アニメーション(Animate)。
// FPS=30、Steps=2400を設定。Time（$t）を手動変更しても確認できます。
// 1周期で両ギアが整数回転し、軸穴・マーカーも連続してループします。
// 歯数比による運動表示です。荷重・摩擦・変形の物理解析は行いません。

include <BOSL2/std.scad>
include <BOSL2/gears.scad>
use <main_gear.scad>
use <motor_gear_38.scad>

show_bearing = true;
show_markers = true;
show_pitch_circles = false;
center_extra = 0; // 軸間距離の追加量 mm。通常は0。
manual_motor_angle = 0; // $t=0のときの手動回転角（度）

$fn = 160;
$gear_steps = 16;
$vpr = [0, 0, 0];
$vpt = [40, 0, 0];
$vpd = 850;

function integer_gcd(a,b) = b==0 ? a : integer_gcd(b,a%b);

module pitch_circle(radius,z) {
    translate([0,0,z])
        linear_extrude(height=0.15)
            difference() {
                circle(r=radius+0.2,$fn=240);
                circle(r=radius-0.2,$fn=240);
            }
}

// useで形状モジュールと寸法取得関数を読み込みます。
module motor_and_driven(main_teeth,main_pitch,main_pressure,main_height,base_z) {
    motor = motor_gear_specs();
    gear_teeth = motor[0];
    gear_circular_pitch = motor[1];
    gear_pressure_angle = motor[2];
    gear_thickness = motor[3];

    assert(abs(main_pitch-gear_circular_pitch)<0.000001,
           "両ギアの円ピッチを一致させてください");
    assert(abs(main_pressure-gear_pressure_angle)<0.000001,
           "両ギアの圧力角を一致させてください");
    assert(center_extra>=0);
    distance = gear_dist(circ_pitch=main_pitch,
                         teeth1=main_teeth,teeth2=gear_teeth,
                         pressure_angle=main_pressure)+center_extra;
    motor_turns = main_teeth/integer_gcd(main_teeth,gear_teeth);
    motor_angle = 360*$t*motor_turns+manual_motor_angle;
    // BOSL2の標準歯位置に対し、主歯車の歯と小歯車の谷を向かい合わせる。
    driven_angle = -90-motor_angle*gear_teeth/main_teeth;
    drive_angle = 90-180/gear_teeth+motor_angle;
    motor_z = base_z+(main_height-gear_thickness)/2;

    echo("軸間距離 mm",distance);
    echo("歯数 主/モータ",main_teeth,gear_teeth);
    echo("減速比",main_teeth/gear_teeth);

    translate([0,0,base_z]) rotate([0,0,driven_angle]) {
        color("lightsteelblue") children();
        if (show_markers)
            color("royalblue")
                translate([0,main_pitch*main_teeth/(2*PI)-8,main_height])
                    cylinder(d=4,h=0.3);
    }
    translate([distance,0,motor_z]) rotate([0,0,drive_angle]) {
        color("orange") motor_gear();
        if (show_markers)
            color("firebrick")
                translate([0,gear_circular_pitch*gear_teeth/(2*PI)-8,gear_thickness])
                    cylinder(d=4,h=0.3);
    }
    if (show_pitch_circles) {
        color("navy") pitch_circle(main_pitch*main_teeth/(2*PI),base_z+main_height+0.4);
        color("red") translate([distance,0,0])
            pitch_circle(gear_circular_pitch*gear_teeth/(2*PI),motor_z+gear_thickness+0.4);
    }
}

module gear_preview() {
    main = main_gear_specs();

    if (show_bearing)
        color("dimgray") bearing_mounting_plate();
    motor_and_driven(main[0],main[1],main[2],main[3],main[4])
        top_gear();
}

gear_preview();
