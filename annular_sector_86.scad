// 86度分のドーナツ形プレート / 単位: mm
// 外径273、内径110。残す部分が86度（0〜86度）。
// 板全体の基本厚み3。底面は共通。
// 直径5の貫通穴は元の円の中心から横60・縦60（半径約84.853、45度）。
// 穴中心の直径10mm範囲のみ基本厚み3＋補強5＝合計厚み8。
// 補強部の上面は平らで、直径5の穴は全厚を貫通。
// CLI: openscad -o annular_sector_86.stl annular_sector_86.scad

outer_diameter = 273;
inner_diameter = 110;
thickness = 3;
sector_angle = 86;
hole_diameter = 5;
hole_center = [60, 60];
hole_pad_diameter = 10;
hole_pad_extra_height = 5;
hole_pad_thickness = thickness + hole_pad_extra_height;

outer_radius = outer_diameter / 2;
inner_radius = inner_diameter / 2;
hole_center_radius = sqrt(hole_center[0]*hole_center[0] + hole_center[1]*hole_center[1]);
hole_angle = atan2(hole_center[1], hole_center[0]);
arc_steps = ceil(sector_angle / 0.25);

assert(outer_radius > inner_radius && inner_radius > 0);
assert(thickness > 0 && sector_angle > 0 && sector_angle <= 180);
assert(hole_diameter > 0);
assert(hole_pad_diameter > hole_diameter && hole_pad_thickness > thickness);
assert(hole_center_radius - hole_pad_diameter / 2 > inner_radius &&
       hole_center_radius + hole_pad_diameter / 2 < outer_radius,
       "穴周囲の補強部が内周または外周に接触しています");
assert(hole_center_radius * sin(hole_angle) > hole_pad_diameter / 2 &&
       hole_center_radius * sin(sector_angle - hole_angle) > hole_pad_diameter / 2,
       "穴周囲の補強部が切断面に接触しています");
assert(hole_center_radius - hole_diameter / 2 > inner_radius,
       "穴が内周に接触しています");
assert(hole_center_radius + hole_diameter / 2 < outer_radius,
       "穴が外周に接触しています");
assert(hole_angle > 0 && hole_angle < sector_angle);
assert(hole_center_radius * sin(hole_angle) > hole_diameter / 2 &&
       hole_center_radius * sin(sector_angle - hole_angle) > hole_diameter / 2,
       "穴が切断面に接触しています");

module annular_sector(radius = outer_radius) {
    polygon(points = concat(
        [for (i = [0 : arc_steps])
            let(a = sector_angle * i / arc_steps)
            [radius * cos(a), radius * sin(a)]],
        [for (i = [arc_steps : -1 : 0])
            let(a = sector_angle * i / arc_steps)
            [inner_radius * cos(a), inner_radius * sin(a)]]
    ));
}

difference() {
    union() {
        linear_extrude(height = thickness)
            annular_sector();
        translate([hole_center[0], hole_center[1], 0])
            cylinder(h = hole_pad_thickness, d = hole_pad_diameter, $fn = 128);
    }
    translate([hole_center[0], hole_center[1], -0.01])
        cylinder(h = hole_pad_thickness + 0.02, d = hole_diameter, $fn = 128);
}

echo("Hole center (mm)", hole_center);
echo("Hole center radius (mm) / angle (deg)", hole_center_radius, hole_angle);
echo("Material between hole and inner edge (mm)",
     hole_center_radius - hole_diameter / 2 - inner_radius);
