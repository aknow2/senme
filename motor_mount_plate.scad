// モーター固定板 / 単位 mm
// 穴中心間隔40 x 28、厚さ5、M4ねじ用通し穴4個。
// CLI: openscad -o motor_mount_plate.stl motor_mount_plate.scad

plate_thickness = 12;
hole_pitch_x = 40;
hole_pitch_y = 28;
hole_diameter = 4.5; // M4用クリアランス。造形に応じて調整。
edge_margin = 6; // 穴中心から板外周まで
corner_radius = 3;
opening_width = 38; // 中央開口の長辺
opening_depth = 20; // 中央開口の短辺

plate_width = hole_pitch_x + 2*edge_margin;
plate_depth = hole_pitch_y + 2*edge_margin;
$fn = 96;
epsilon = 0.01;

assert(plate_thickness>0 && hole_pitch_x>0 && hole_pitch_y>0);
assert(hole_diameter>0 && edge_margin>hole_diameter/2);
assert(corner_radius>=0 && corner_radius<=edge_margin);
assert(opening_width>0 && opening_width<hole_pitch_x
       && opening_depth>0 && opening_depth<hole_pitch_y);
assert(sqrt(pow((hole_pitch_x-opening_width)/2,2)
            + pow((hole_pitch_y-opening_depth)/2,2))>hole_diameter/2,
       "中央開口とネジ穴が接触しています");

module plate_outline() {
    if (corner_radius>0)
        offset(r=corner_radius)
            square([plate_width-2*corner_radius,
                    plate_depth-2*corner_radius],center=true);
    else
        square([plate_width,plate_depth],center=true);
}

difference() {
    linear_extrude(height=plate_thickness) plate_outline();
    translate([-opening_width/2,-opening_depth/2,-epsilon])
        cube([opening_width,opening_depth,plate_thickness+2*epsilon]);
    for (x=[-hole_pitch_x/2,hole_pitch_x/2])
        for (y=[-hole_pitch_y/2,hole_pitch_y/2])
            translate([x,y,-epsilon])
                cylinder(d=hole_diameter,h=plate_thickness+2*epsilon);
}

echo("Plate size mm",[plate_width,plate_depth,plate_thickness]);
echo("Hole center spacing mm",[hole_pitch_x,hole_pitch_y]);
echo("M4 through hole diameter mm",hole_diameter);
echo("Central opening mm",[opening_width,opening_depth]);
