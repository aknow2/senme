// motor_gear_38_oneway_gear.stl / cover.stl 専用の印刷ピン試作。
// 元設計はM2.5樹脂用ねじ。ギア穴φ2.2、蓋穴φ2.9、蓋厚1.8mm。
// 3本使用。大きな頭を下に印刷。ギア・蓋の変更は不要。
// 差込み長8mm、ギアへの挿入6.2mm、穴底まで0.8mmの余裕。
// まず1本で確認。保持は摩擦頼みで、ねじと同等の保持力はない。
// 緩く抜ける場合は使用せず、shaft_dを少し増やして再印刷する。
// 6個鼓形版のφ3.1ピンとは互換性なし。
shaft_d = 2.1; // φ2.2の既存穴へ入りやすさを優先。保持力は実物で確認。
cover_guide_d = 2.75;
cover_guide_h = 1.6;
head_h = 4;
grip_h = 3;
insert_h = 8;
tip_h = 0.6;
$fn = 128;
eps = 0.01;
assert(shaft_d>1.5 && shaft_d<cover_guide_d);
difference() {
 union() {
  intersection() {
   cylinder(d=8,h=grip_h);
   translate([-2.5,-4,0]) cube([5,8,grip_h]);
  }
  translate([0,0,grip_h-eps]) cylinder(d=4.8,h=head_h-grip_h+eps);
  translate([0,0,head_h-eps]) cylinder(d=cover_guide_d,h=cover_guide_h+eps);
  translate([0,0,head_h+cover_guide_h-eps]) cylinder(d=shaft_d,h=insert_h-cover_guide_h-tip_h+eps);
  translate([0,0,head_h+insert_h-tip_h]) cylinder(d1=shaft_d,d2=shaft_d-0.5,h=tip_h);
 }
 translate([-0.25,-2,head_h+cover_guide_h+0.8]) cube([0.5,4,insert_h]);
}
