// モータ用38歯ギア / 単位 mm
// 穴の設定: F7 / 片側すき間0.06 mm（ユーザー指定）。
// まずrender_part="fit_test"を出力して軸へのはまり具合を確認。
include <BOSL2/std.scad>
include <BOSL2/gears.scad>

render_part = "gear"; // "gear" または "fit_test"
gear_teeth = 38;
gear_circular_pitch = 6.5;
gear_pressure_angle = 20;
gear_thickness = 13; // 有効軸長13 mmに対し1 mmの余裕
gear_backlash = 0.15; // ピッチ円上の歯厚を減らす量

shaft_diameter = 8;
shaft_length = 13;
shaft_flat_to_back = 7; // F7: 公称の平面から反対側の円弧までの距離
shaft_clearance = 0.06; // 各面のすき間。穴の円弧径8.12 mm、平面～反対側7.12 mm
entry_chamfer = 0.4;
fit_test_thickness = 3;

$fn = 160;
$gear_steps = 16;
epsilon = 0.01;

assert(shaft_flat_to_back > shaft_diameter/2
       && shaft_flat_to_back < shaft_diameter,
       "Dカット寸法は軸半径より大きく、直径より小さくしてください");
assert(shaft_clearance >= 0 && entry_chamfer >= 0);
assert(gear_thickness > 2*entry_chamfer && gear_thickness <= shaft_length);

// +X側がDカットの平面。公称輪郭を全方向に一定量拡張する。
module shaft_profile(extra = 0) {
    offset(delta = shaft_clearance + extra)
        intersection() {
            circle(d = shaft_diameter);
            translate([-shaft_diameter, -shaft_diameter])
                square([shaft_diameter + shaft_flat_to_back
                        - shaft_diameter/2, 2*shaft_diameter]);
        }
}

module shaft_hole(height) {
    translate([0, 0, -epsilon])
        linear_extrude(height = height + 2*epsilon)
            shaft_profile();
    // 両側の挿入口を面取り。中間部分のD形状は維持。
    if (entry_chamfer > 0) {
        hull() {
            translate([0, 0, -epsilon])
                linear_extrude(height = epsilon)
                    shaft_profile(entry_chamfer);
            translate([0, 0, entry_chamfer])
                linear_extrude(height = epsilon) shaft_profile();
        }
        hull() {
            translate([0, 0, height-entry_chamfer-epsilon])
                linear_extrude(height = epsilon) shaft_profile();
            translate([0, 0, height])
                linear_extrude(height = epsilon)
                    shaft_profile(entry_chamfer);
        }
    }
}

function motor_gear_specs() = [gear_teeth, gear_circular_pitch,
    gear_pressure_angle, gear_thickness];

module motor_gear() {
    difference() {
        spur_gear(circ_pitch = gear_circular_pitch,
                  teeth = gear_teeth, thickness = gear_thickness,
                  pressure_angle = gear_pressure_angle,
                  backlash = gear_backlash, anchor = BOTTOM);
        shaft_hole(gear_thickness);
    }
}

if (render_part == "gear") {
    motor_gear();
} else if (render_part == "fit_test") {
    difference() {
        cylinder(d = 18, h = fit_test_thickness);
        shaft_hole(fit_test_thickness);
    }
} else {
    assert(false, "render_partはgearまたはfit_testにしてください");
}

echo("Dカット F / 片側すき間", shaft_flat_to_back, shaft_clearance);
echo("ピッチ円直径 mm", 2*pitch_radius(circ_pitch=gear_circular_pitch, teeth=gear_teeth));
echo("歯先外径 mm", 2*outer_radius(circ_pitch=gear_circular_pitch, teeth=gear_teeth));
// D形状は回り止めです。軸方向の抜け止めは別途必要です。
