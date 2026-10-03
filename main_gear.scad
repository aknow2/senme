// 6インチ・ターンテーブルベアリング用 ギア天板と取付側プレート
// 単位: mm
// 印刷用: openscad -D 'render_part="top_gear"' -o main_gear.stl main_gear.scad

include <BOSL2/std.scad>
include <BOSL2/gears.scad>

$fn = 180;
$gear_steps = 16;

// 表示する内容: "assembly", "top_gear", "mounting_plate"
render_part = "assembly";

// 組立表示
exploded_gap = 0; // 内部を見やすくするときは20などに変更

// ギア天板
gear_thickness      = 18;
gear_circular_pitch = 6.5;   // ピッチ円上での隣り合う歯の間隔
gear_teeth          = 112;
gear_pressure_angle = 20;
center_hole_diameter = 110;

// BOSL2の歯車計算に基づく直径
gear_pitch_diameter = 2 * pitch_radius(
    circ_pitch = gear_circular_pitch,
    teeth = gear_teeth
);
gear_outer_diameter = 2 * outer_radius(
    circ_pitch = gear_circular_pitch,
    teeth = gear_teeth,
    pressure_angle = gear_pressure_angle
);
gear_root_diameter = 2 * root_radius(
    pitch = gear_circular_pitch,
    teeth = gear_teeth,
    pressure_angle = gear_pressure_angle
);

echo(str("ギア歯先外径: ", round(gear_outer_diameter * 100) / 100, " mm"));
echo(str("ギアピッチ円直径: ", round(gear_pitch_diameter * 100) / 100, " mm"));
echo(str("ギア歯底径: ", round(gear_root_diameter * 100) / 100, " mm"));

// M4真鍮六角スペーサーの胴体を通す取付穴。
// m4_spacer_test_plateで確認したF7 / C0.14。穴の対辺は7.28 mm。
spacer_flat_size      = 7;
spacer_clearance      = 0.14; // 片側すき間
spacer_entry_chamfer  = 0.4;  // テストプレートと同じ上下の面取り
mounting_hole_pitch    = 120; // 隣り合う穴の中心間距離

// 丸板を取り付けるベアリング上面（φ4.9 mm側）の簡易プレート
bearing_plate_size        = 156;
bearing_plate_thickness   = 0.8;
bearing_center_hole       = 119.5;
bearing_mount_hole        = 4.9;
bearing_mount_hole_pitch  = 120;

// BOSL2によるインボリュート平歯車
function main_gear_specs() = [gear_teeth, gear_circular_pitch,
    gear_pressure_angle, gear_thickness, bearing_plate_thickness];

module spacer_hex_profile(extra=0) {
    // テストプレートと同じ向き・対辺寸法からの換算。
    circle(d=(spacer_flat_size+2*(spacer_clearance+extra))/cos(30), $fn=6);
}

module spacer_mounting_hole() {
    epsilon = 0.01;
    assert(spacer_flat_size>0 && spacer_clearance>=0);
    assert(spacer_entry_chamfer>=0 && gear_thickness>2*spacer_entry_chamfer);
    translate([0,0,-epsilon])
        linear_extrude(height=gear_thickness+2*epsilon)
            spacer_hex_profile();
    if (spacer_entry_chamfer>0) {
        hull() {
            translate([0,0,-epsilon])
                linear_extrude(height=epsilon)
                    spacer_hex_profile(spacer_entry_chamfer);
            translate([0,0,spacer_entry_chamfer])
                linear_extrude(height=epsilon) spacer_hex_profile();
        }
        hull() {
            translate([0,0,gear_thickness-spacer_entry_chamfer-epsilon])
                linear_extrude(height=epsilon) spacer_hex_profile();
            translate([0,0,gear_thickness])
                linear_extrude(height=epsilon)
                    spacer_hex_profile(spacer_entry_chamfer);
        }
    }
}

module top_gear() {
    difference() {
        spur_gear(
            circ_pitch = gear_circular_pitch,
            teeth = gear_teeth,
            thickness = gear_thickness,
            pressure_angle = gear_pressure_angle,
            shaft_diam = center_hole_diameter,
            anchor = BOTTOM
        );

        // 120 × 120 mmの正方形上に配置した4個の六角貫通穴
        for (x = [-mounting_hole_pitch / 2, mounting_hole_pitch / 2])
            for (y = [-mounting_hole_pitch / 2, mounting_hole_pitch / 2])
                translate([x, y, 0])
                    spacer_mounting_hole();
    }
}

// ベアリングの取付側だけを表した簡易プレート。
// 実物のプレス成形、レース、回転側プレートは省略している。
module bearing_mounting_plate() {
    difference() {
        translate([
            -bearing_plate_size / 2,
            -bearing_plate_size / 2,
            0
        ])
            cube([
                bearing_plate_size,
                bearing_plate_size,
                bearing_plate_thickness
            ]);

        // 中央開口
        translate([0, 0, -0.1])
            cylinder(
                h = bearing_plate_thickness + 0.2,
                d = bearing_center_hole
            );

        // 120 × 120 mmの正方形上に配置した4個の取付穴
        for (x = [-bearing_mount_hole_pitch / 2,
                   bearing_mount_hole_pitch / 2])
            for (y = [-bearing_mount_hole_pitch / 2,
                       bearing_mount_hole_pitch / 2])
                translate([x, y, -0.1])
                    cylinder(
                        h = bearing_plate_thickness + 0.2,
                        d = bearing_mount_hole
                    );
    }
}

module assembly() {
    color("dimgray")
        bearing_mounting_plate();

    color("lightsteelblue")
        translate([0, 0, bearing_plate_thickness + exploded_gap])
            top_gear();
}

if (render_part == "assembly") {
    assembly();
} else if (render_part == "top_gear") {
    top_gear();
} else if (render_part == "mounting_plate") {
    bearing_mounting_plate();
} else {
    assert(false, "render_partの値が不正です");
}
