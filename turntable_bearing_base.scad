// ターンテーブルベアリングの下側台 / 単位: mm
// 寸法根拠: turntable-bearing-dimensions.md（提供画像の読み取り）
// φ6.4側の4穴に対応。底面z=0、ベアリングを載せる上面z=40。
// CLI: openscad -o turntable_bearing_base.stl turntable_bearing_base.scad

base_width = 156;
base_depth = 156;
base_height = 40;
mounting_pitch = 136;
mounting_hole_diameter = 6.6;
center_hole_diameter = 135;

$fn = 180;

assert(base_height > 0);
assert(mounting_hole_diameter > 0 && mounting_pitch > 0);
assert(center_hole_diameter > 0
       && center_hole_diameter < min(base_width, base_depth));
assert(mounting_pitch + mounting_hole_diameter < min(base_width, base_depth),
       "Mounting holes must fit inside the base");
assert(sqrt(2) * mounting_pitch / 2
       > (center_hole_diameter + mounting_hole_diameter) / 2,
       "Mounting holes must not intersect the center opening");

// 同一断面を40mm押し出し、中央穴と4つの取付穴を上下に貫通させる。
linear_extrude(height = base_height)
    difference() {
        square([base_width, base_depth], center = true);
        circle(d = center_hole_diameter);
        for (x = [-mounting_pitch / 2, mounting_pitch / 2])
            for (y = [-mounting_pitch / 2, mounting_pitch / 2])
                translate([x, y]) circle(d = mounting_hole_diameter);
    }

echo("Base size mm", [base_width, base_depth, base_height]);
echo("Mounting hole pitch XY mm", [mounting_pitch, mounting_pitch]);
echo("Four mounting through holes mm", mounting_hole_diameter);
echo("Center through hole mm", center_hole_diameter);
