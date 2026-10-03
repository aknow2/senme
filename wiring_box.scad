// 配線用の箱と外かぶせ蓋 / 単位: mm
// 内寸 120 x 120 x 30。各側面に直径10mmの横向き貫通穴を3個。
// 「箱付き」は「蓋付き」と解釈。蓋不要なら render_part = "box"。
// layout: 箱と蓋を印刷向きで並べる / assembled: 蓋を閉じた状態
render_part = "layout"; // [layout, box, lid, assembled]

inner_width = 120;
inner_depth = 120;
inner_height = 30;
wall = 2;
bottom = 2;
hole_diameter = 10;
holes_per_side = 3;
hole_height = 15; // 内側の床から穴中心まで
lid_thickness = 2;
lid_skirt = 6; // 箱の外側にかぶる長さ
lid_wall = 2;
lid_clearance = 0.3; // 箱と蓋の片側の隙間。プリンタに合わせて調整

$fn = 80;
eps = 0.02;
outer_width = inner_width + 2 * wall;
outer_depth = inner_depth + 2 * wall;
box_height = inner_height + bottom;
lid_inner_width = outer_width + 2 * lid_clearance;
lid_inner_depth = outer_depth + 2 * lid_clearance;
lid_width = lid_inner_width + 2 * lid_wall;
lid_depth = lid_inner_depth + 2 * lid_wall;

assert(inner_width > 0 && inner_depth > 0 && inner_height > 0);
assert(wall > 0 && bottom > 0 && lid_wall > 0 && lid_thickness > 0);
assert(lid_clearance >= 0 && lid_skirt > 0);
assert(holes_per_side >= 1 && floor(holes_per_side) == holes_per_side);
assert(hole_diameter > 0 && hole_height > hole_diameter / 2);
assert(hole_height + hole_diameter / 2 < inner_height - lid_skirt,
       "蓋の縁が配線穴にかかります");
assert(min(inner_width, inner_depth) / (holes_per_side + 1) > hole_diameter);
assert(render_part == "layout" || render_part == "box" ||
       render_part == "lid" || render_part == "assembled");

module box() {
    difference() {
        translate([-outer_width / 2, -outer_depth / 2, 0])
            cube([outer_width, outer_depth, box_height]);
        translate([-inner_width / 2, -inner_depth / 2, bottom])
            cube([inner_width, inner_depth, inner_height + eps]);
        // 一本の水平円柱で向かい合う二面を貫通させる。
        for (i = [1:holes_per_side]) {
            translate([-inner_width / 2 + inner_width * i / (holes_per_side + 1),
                       0, bottom + hole_height])
                rotate([90, 0, 0])
                    cylinder(d=hole_diameter, h=outer_depth + 2 * eps, center=true);
            translate([0,
                       -inner_depth / 2 + inner_depth * i / (holes_per_side + 1),
                       bottom + hole_height])
                rotate([0, 90, 0])
                    cylinder(d=hole_diameter, h=outer_width + 2 * eps, center=true);
        }
    }
}

// 天面を造形プレートに置く向き。外かぶせ式で箱の内寸を保つ。
module lid() {
    difference() {
        translate([-lid_width / 2, -lid_depth / 2, 0])
            cube([lid_width, lid_depth, lid_thickness + lid_skirt]);
        translate([-lid_inner_width / 2, -lid_inner_depth / 2, lid_thickness])
            cube([lid_inner_width, lid_inner_depth, lid_skirt + eps]);
    }
}

if (render_part == "box") box();
if (render_part == "lid") lid();
if (render_part == "layout") {
    box();
    translate([(outer_width + lid_width) / 2 + 10, 0, 0]) lid();
}
if (render_part == "assembled") {
    color("LightSteelBlue") box();
    color("LightGray", 0.65)
        translate([0, 0, box_height + lid_thickness])
            rotate([180, 0, 0]) lid();
}

echo("内寸", [inner_width, inner_depth, inner_height]);
echo("箱の外寸", [outer_width, outer_depth, box_height]);
echo("蓋の外寸", [lid_width, lid_depth, lid_thickness + lid_skirt]);
echo("配線穴の総数 / 直径", [4 * holes_per_side, hole_diameter]);
