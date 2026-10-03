// 直径600 mmの球体（底面開口φ250 mm）用の円形サポート
// 単位: mm
//
// 外径φ300 mm、内径φ250 mmのリングで球体の開口周囲を受けます。
// 上面はφ600 mmの球面に合わせ、内周側の厚みを約3 mmにしています。

$fn = 180;

// --- 球体 ---
sphere_diameter         = 600;
sphere_opening_diameter = 250;
sphere_shell_thickness  = 3;   // プレビュ表示用
contact_clearance       = 0.6;

// --- リングサポート ---
support_outer_diameter = 300;
support_inner_diameter = 250;
inner_edge_height      = 3;

// --- M6固定穴 ---
bolt_hole_count       = 6;
bolt_circle_diameter  = 275;
bolt_hole_diameter    = 6.6;
counterbore_diameter  = 12;
hole_bottom_thickness = 3;

// --- 木板（プレビュ表示用） ---
board_diameter  = 300;
board_thickness = 18;

// 同じ120度のパーツを3個印刷。上から差し込む蟻継ぎで接続。
segment_count = 3;
joint_clearance = 0.25; // 凹側を各方向に広げる量
joint_depth = 6;
joint_neck_width = 6;
joint_head_width = 10;
joint_radius = 137.5;

// "segment": 印刷用の1/3パーツ（底面z=0、45度回転済み）
// "assembly": 3個の組立表示
// "support": 分割前の一体リング
// "preview": 開口のある球体、サポート、木板の配置確認
render_part = "segment";

sphere_radius        = sphere_diameter / 2;
opening_radius       = sphere_opening_diameter / 2;
support_outer_radius = support_outer_diameter / 2;
support_inner_radius = support_inner_diameter / 2;
bolt_circle_radius   = bolt_circle_diameter / 2;
segment_angle = 360 / segment_count;
assert(segment_count == 3 && bolt_hole_count == 6,
       "three identical segments require six mounting holes");

assert(opening_radius < sphere_radius,
       "sphere opening must be smaller than the sphere");
assert(support_inner_diameter == sphere_opening_diameter,
       "support inner diameter must match the sphere opening");
assert(support_outer_diameter > support_inner_diameter,
       "support outer diameter must be larger than its inner diameter");
assert(board_diameter >= support_outer_diameter,
       "board must not be smaller than the support");
assert(counterbore_diameter > bolt_hole_diameter,
       "counterbore must be larger than the bolt hole");
assert(hole_bottom_thickness > 0,
       "hole bottom thickness must be positive");
assert(
    bolt_circle_radius - counterbore_diameter / 2 > support_inner_radius
    && bolt_circle_radius + counterbore_diameter / 2 < support_outer_radius,
    "bolt counterbores must fit inside the support ring"
);

// 球体のφ250 mm開口縁を z=0 に配置するための中心高さ。
sphere_center_z = sqrt(
    sphere_radius * sphere_radius - opening_radius * opening_radius
);

// サポート外周での球面高さ。
outer_surface_z = sphere_center_z - sqrt(
    sphere_radius * sphere_radius
    - support_outer_radius * support_outer_radius
);

// 球とのすき間を含めて、内周側に実質3 mmの厚みを残す。
support_bottom_z    = -(inner_edge_height + contact_clearance);
support_blank_top   = outer_surface_z + 1;
support_total_height = support_blank_top - support_bottom_z;

module support_blank() {
    difference() {
        translate([0, 0, support_bottom_z])
            cylinder(h = support_total_height, d = support_outer_diameter);

        translate([0, 0, support_bottom_z - 1])
            cylinder(
                h = support_total_height + 2,
                d = support_inner_diameter
            );
    }
}

module mounting_holes() {
    for (angle = [30 : 360 / bolt_hole_count : 390 - 360 / bolt_hole_count]) {
        hole_x = bolt_circle_radius * cos(angle);
        hole_y = bolt_circle_radius * sin(angle);

        // 木板へ垂直に通るM6ボルト穴。
        translate([hole_x, hole_y, support_bottom_z - 1])
            cylinder(
                h = support_total_height + 2,
                d = bolt_hole_diameter,
                $fn = 64
            );

        // 上側の座ぐり。底側3 mmはφ6.6 mmのまま残す。
        translate([
            hole_x,
            hole_y,
            support_bottom_z + hole_bottom_thickness
        ])
            cylinder(
                h = support_total_height + 1,
                d = counterbore_diameter,
                $fn = 64
            );
    }
}

module circular_support() {
    difference() {
        // 球の内部を差し引き、リング上面を球面に合わせる。
        difference() {
            support_blank();

            translate([0, 0, sphere_center_z - contact_clearance])
                sphere(r = sphere_radius, $fn = 240);
        }

        mounting_holes();
    }
}

// 中空の球殻を作り、z=0より下を切り落として底部を開口する。
module reference_sphere_with_opening() {
    difference() {
        difference() {
            translate([0, 0, sphere_center_z])
                sphere(r = sphere_radius);

            translate([0, 0, sphere_center_z])
                sphere(r = sphere_radius - sphere_shell_thickness);
        }

        translate([
            -sphere_radius - 1,
            -sphere_radius - 1,
            -sphere_radius - 1
        ])
            cube([
                2 * sphere_radius + 2,
                2 * sphere_radius + 2,
                sphere_radius + 1
            ]);
    }
}

// 左右60度の放射状平面で切断。
// 円弧の外まで届く三角柱を使い、外周を切り落とさないようにする。
module plain_segment() {
    intersection() {
        circular_support();
        translate([0, 0, support_bottom_z - 1])
            linear_extrude(height = support_total_height + 2)
                polygon([
                    [0, 0],
                    [2 * support_outer_radius * cos(segment_angle / 2),
                     -2 * support_outer_radius * sin(segment_angle / 2)],
                    [2 * support_outer_radius * cos(segment_angle / 2),
                     2 * support_outer_radius * sin(segment_angle / 2)]
                ]);
    }
}

// XY平面の蟻継ぎ。底から上まで同じ輪郭なので上から挿入できる。
module joint_prism(angle, clearance = 0) {
    rotate([0, 0, angle])
        translate([joint_radius, 0, support_bottom_z - 1])
            linear_extrude(height = support_total_height + 2)
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

module support_segment() {
    difference() {
        union() {
            plain_segment();
            intersection() {
                circular_support();
                joint_prism(segment_angle / 2);
            }
        }
        joint_prism(-segment_angle / 2, joint_clearance);
    }
}

module segmented_assembly() {
    for (i = [0 : segment_count - 1])
        color(i % 2 == 0 ? "darkorange" : "gold")
            rotate([0, 0, i * segment_angle]) support_segment();
}

module reference_board() {
    translate([0, 0, support_bottom_z - board_thickness])
        cylinder(h = board_thickness, d = board_diameter);
}

if (render_part == "segment") {
    translate([
        -(support_outer_radius + support_outer_radius * cos(105)) / 2,
        -(support_outer_radius + support_outer_radius * cos(105)) / 2,
        -support_bottom_z
    ]) rotate([0, 0, 45]) support_segment();
} else if (render_part == "assembly") {
    segmented_assembly();
} else if (render_part == "support") {
    circular_support();
} else if (render_part == "preview") {
    segmented_assembly();
    color([0.58, 0.36, 0.18, 0.65]) %reference_board();
    color([0.65, 0.78, 0.95, 0.25]) %reference_sphere_with_opening();
} else {
    assert(false, "render_part must be segment, assembly, support or preview");
}

echo(str("sphere diameter: ", sphere_diameter, " mm"));
echo(str("sphere bottom opening: ", sphere_opening_diameter, " mm"));
echo(str("support outer diameter: ", support_outer_diameter, " mm"));
echo(str("support inner diameter: ", support_inner_diameter, " mm"));
echo(str("inner edge height: ", inner_edge_height, " mm"));
echo(str("M6 hole count: ", bolt_hole_count));
echo(str("M6 hole diameter: ", bolt_hole_diameter, " mm"));
echo(str("counterbore diameter: ", counterbore_diameter, " mm"));
echo(str("outer contact height: ", round(outer_surface_z * 100) / 100, " mm"));
