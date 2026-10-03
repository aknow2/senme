// φ300 mm丸板に側面からネジ止めする外周リング。単位: mm
// 内径300.6 mmで、丸板との径方向の隙間は片側0.3 mm。
// 同一の120度パーツを3個印刷し、それぞれ丸板に固定する。
// 両端の蟻継ぎを上下にスライドして接続する。
// 底面z=0を丸板の底面に揃える。横穴の中心高さは10 mm。
// 穴径4 mmは仮設定。使用するネジの軸径に合わせて変更する。
// CLI: openscad -o outer_board_rim_segment.stl outer_board_rim.scad

$fn = 240;
inner_diameter = 300.6;
wall_thickness = 5;
rim_height = 30;
screw_hole_diameter = 4;
screw_hole_height = 10;
segment_count = 3;

// 5 mmの壁内に収めた蟻継ぎ。凹側は各方向へ0.25 mm広げる。
joint_clearance = 0.25;
joint_depth = 3;
joint_neck_width = 2;
joint_head_width = 3;

// 指定内径に追加する径方向の片側すき間。0なら内径300.6 mm。
radial_clearance = 0;
// "segment": 印刷用 / "assembly": 組立 / "preview": 丸板付き
render_part = "segment";
board_diameter = 300;
board_thickness = 18;

inner_radius = inner_diameter / 2 + radial_clearance;
outer_radius = inner_radius + wall_thickness;
segment_angle = 360 / segment_count;
joint_radius = (inner_radius + outer_radius) / 2;

assert(segment_count == 3, "This part uses three 120-degree segments");
assert(inner_diameter > 0 && wall_thickness > 0 && rim_height > 0);
assert(radial_clearance >= 0);
assert(joint_clearance >= 0 && joint_depth > 0);
assert(joint_neck_width > 0 && joint_head_width > joint_neck_width);
assert(joint_radius - joint_head_width / 2 - joint_clearance > inner_radius
    && sqrt(pow(joint_radius + joint_head_width / 2, 2)
          + pow(joint_depth, 2)) + joint_clearance < outer_radius,
    "Dovetail sockets must leave material on both sides of the wall");
assert(screw_hole_diameter > 0);
assert(screw_hole_height > screw_hole_diameter / 2
    && screw_hole_height + screw_hole_diameter / 2 < rim_height,
    "Screw holes must fit within the wall height");

module joint_prism(angle, clearance = 0) {
    rotate([0, 0, angle])
        translate([joint_radius, 0, 0])
            linear_extrude(height = rim_height)
                offset(delta = clearance)
                    polygon([
                        [-joint_neck_width / 2, -1],
                        [ joint_neck_width / 2, -1],
                        [ joint_neck_width / 2, 0],
                        [ joint_head_width / 2, joint_depth],
                        [-joint_head_width / 2, joint_depth],
                        [-joint_neck_width / 2, 0]
                    ]);
}

module rim_segment() {
    difference() {
        union() {
            rotate([0, 0, -segment_angle / 2])
                rotate_extrude(angle = segment_angle, convexity = 10)
                    translate([inner_radius, 0])
                        square([wall_thickness, rim_height]);
            joint_prism(segment_angle / 2);
        }

        // 反対側の端に、隣のパーツの凸部が入る凹部を設ける。
        translate([0, 0, -1])
            linear_extrude(height = rim_height + 2)
                projection(cut = false)
                    joint_prism(-segment_angle / 2, joint_clearance);

        // 円の中心へ向く水平の貫通穴。端面から各30度の位置。
        for (angle = [-segment_angle / 4, segment_angle / 4])
            rotate([0, 0, angle])
                translate([inner_radius - 1, 0, screw_hole_height])
                    rotate([0, 90, 0])
                        cylinder(h = wall_thickness + 2,
                                 d = screw_hole_diameter, $fn = 64);
    }
}

module assembly() {
    for (i = [0 : segment_count - 1])
        color(i % 2 == 0 ? "darkorange" : "gold")
            rotate([0, 0, i * segment_angle]) rim_segment();
}

if (render_part == "segment") {
    // 45度回転し、XYの中央付近へ移動。底面はz=0。
    shift = -(outer_radius + outer_radius * cos(105)) / 2;
    translate([shift, shift, 0]) rotate([0, 0, 45]) rim_segment();
} else if (render_part == "assembly") {
    assembly();
} else if (render_part == "preview") {
    assembly();
    %color([0.58, 0.36, 0.18, 0.5])
        cylinder(d = board_diameter, h = board_thickness);
} else {
    assert(false, "render_part must be segment, assembly or preview");
}

echo(str("Inner diameter: ", inner_radius * 2, " mm"));
echo(str("Outer diameter: ", outer_radius * 2, " mm"));
echo(str("Height: ", rim_height, " mm"));
echo(str("Horizontal screw holes: diameter ", screw_hole_diameter,
         " mm, center height ", screw_hole_height, " mm"));
