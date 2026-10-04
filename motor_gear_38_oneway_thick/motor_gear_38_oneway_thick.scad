// 旧バネ爪式ワンウェイクラッチ・バネ腕1.4mm比較版。
// ストッパーなし。spring_widthだけ旧版の1.2mmから1.4mmへ変更。
// 幅を共有するアンカー先端も追従。爪先、D穴、全高、回転方向は旧版と同じ。
// ハブだけ交換し、旧版onewayの外ギア・蓋・金属ねじを再利用する。
// カチカチ音が追い越し空転なら正常動作の可能性があり、厚肉化は対策にならない。
// 厚肉化で空転抵抗や爪の曲げに必要な力は増え得る。性能・耐久性は実機未確認。
// 印刷は旧ハブ同様に張り出し下面のサポートが必要。バリを除去し手回しで比較。
// PETG試作用ワンウェイクラッチ。元のmotor_gear_38.scadは変更しない。
// +Z（ターンテーブル上面）から見て、ハブCCW駆動 / 外側ギアCCW追越し。
// 外歯車で接続されたターンテーブルはCW。裏側から見ると方向は逆。
// 印刷・組立・制約は親フォルダのmotor_gear_38_oneway.mdを参照。
use <../motor_gear_38.scad>

render_part = "open"; // assembly, open, exploded, gear, hub, cover, layout
reverse_direction = false;
motor_rpm = 160;         // モーター出力軸の回転数。強度定格ではない。
driven_teeth = 112;
floor_h = 1.8;
cover_h = 1.8;
axial_gap = 0.4;          // 爪と床・蓋の片側すき間
journal_r = 12;
radial_gap = 0.3;         // ジャーナル片側すき間
hub_body_r = 16;
ratchet_teeth = 24;
ratchet_tip_r = 26;       // 内歯の先端（穴の最小半径）
ratchet_root_r = 28;
pawl_count = 3;
spring_r = 24.6;
spring_width = 1.4;      // 旧版1.2mmから少し太くした比較用
spring_start = -5;
spring_anchor = 65;
pawl_tip_r = 27.65;
pawl_tip_angle = -0.6;
cover_r = 32.5;
cover_gap = 0.25;
screw_radius = 30.3;
screw_clearance_d = 2.9; // M2.5、蓋は通し穴
screw_pilot_d = 2.2;     // 樹脂用ねじの下穴。端材で調整すること
screw_depth = 7;

$fn = 128;
eps = 0.01;
specs = motor_gear_specs();
height = specs[3];
cover_z = height-cover_h;
pawl_z = floor_h+axial_gap;
pawl_h = cover_z-axial_gap-pawl_z;

assert(pawl_h > 3 && floor_h > 0 && cover_h > 0);
assert(ratchet_teeth % pawl_count == 0, "各爪の歯位相を一致させてください");
assert(spring_r+spring_width/2 < ratchet_tip_r);
assert(pawl_tip_r > ratchet_tip_r && pawl_tip_r < ratchet_root_r);
assert(journal_r+radial_gap < hub_body_r);
assert(cover_z-screw_depth > floor_h);
assert(screw_radius-screw_clearance_d/2 > ratchet_root_r);

function polar(r,a) = [r*cos(a),r*sin(a)];

module handed() {
    if (reverse_direction) mirror([0,1,0]) children();
    else children();
}

// 各歯はCCW方向に穴半径が増え、次の歯境界で急に小さくなる。
// ハブのCCW相対回転は急斜面でロック。逆の相対回転は緩斜面で退避。
module ratchet_void() {
    polygon([for (i=[0:ratchet_teeth-1], j=[0:12])
        polar(ratchet_tip_r+(ratchet_root_r-ratchet_tip_r)*j/12,
              (i+j/12)*360/ratchet_teeth)]);
}

module screw_positions() {
    for(a=[30,150,270]) rotate([0,0,a])
        translate([screw_radius,0,0]) children();
}

module clutch_gear() {
    difference() {
        motor_gear();
        translate([0,0,-eps]) cylinder(r=journal_r+radial_gap,h=height+2*eps);
        translate([0,0,floor_h]) linear_extrude(height=height)
            handed() ratchet_void();
        translate([0,0,cover_z]) cylinder(r=cover_r+cover_gap,h=cover_h+eps);
        screw_positions() translate([0,0,cover_z-screw_depth])
            cylinder(d=screw_pilot_d,h=screw_depth+eps);
    }
}

module curved_spring() {
    steps = 70;
    polygon(concat(
        [for(i=[0:steps]) polar(spring_r+spring_width/2,
            spring_start+(spring_anchor-spring_start)*i/steps)],
        [for(i=[steps:-1:0]) polar(spring_r-spring_width/2,
            spring_start+(spring_anchor-spring_start)*i/steps)]));
}

module pawl_profile() {
    curved_spring();
    // アンカーは爪よりCCW側。駆動時の接線力を受ける長い弾性腕。
    hull() {
        translate(polar(hub_body_r-1,spring_anchor)) circle(r=2);
        // 固定部も内歯先端より内側に収め、全位相で干渉させない。
        translate(polar(spring_r,spring_anchor)) circle(r=spring_width/2);
    }
    polygon([polar(spring_r-0.3,spring_start),
             polar(pawl_tip_r,pawl_tip_angle),
             polar(spring_r-0.3,pawl_tip_angle)]);
}

module clutch_hub() {
    difference() {
        union() {
            cylinder(r=journal_r,h=height);
            translate([0,0,pawl_z]) linear_extrude(height=pawl_h) {
                circle(r=hub_body_r);
                handed() for(a=[0:360/pawl_count:359]) rotate(a) pawl_profile();
            }
        }
        shaft_hole(height); // 元ファイルのF7 / C0.06と面取りを再利用
    }
}

module clutch_cover() {
    difference() {
        cylinder(r=cover_r,h=cover_h);
        translate([0,0,-eps]) cylinder(r=journal_r+radial_gap,h=cover_h+2*eps);
        screw_positions() translate([0,0,-eps])
            cylinder(d=screw_clearance_d,h=cover_h+2*eps);
    }
}

module assembly(explode=0,show_cover=true) {
    color("orange") clutch_gear();
    color("steelblue") translate([0,0,explode]) clutch_hub();
    if(show_cover) color("lightgray")
        translate([0,0,cover_z+2*explode]) clutch_cover();
}

if(render_part == "assembly") assembly();
else if(render_part == "open") assembly(show_cover=false);
else if(render_part == "exploded") assembly(explode=18);
else if(render_part == "gear") clutch_gear();
else if(render_part == "hub") clutch_hub();
else if(render_part == "cover") clutch_cover();
else if(render_part == "layout") {
    clutch_gear();
    translate([78,0,0]) clutch_hub();
    translate([0,80,0]) clutch_cover();
} else assert(false,"render_partの値が不正です");

echo("PROTOTYPE: rated torque and fatigue life not established");
echo("Body height / with screw heads excluded",height);
echo("Pawl flexure height",pawl_h);
echo("Motor drive viewed from +Z",reverse_direction ? "CW" : "CCW");
echo("Turntable RPM (nominal)",motor_rpm*specs[0]/driven_teeth);
echo("Clicks/sec per pawl at full overrun",motor_rpm*ratchet_teeth/60);
