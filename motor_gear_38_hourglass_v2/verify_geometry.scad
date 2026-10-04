// 再実行: openscad -D 'check="insert"' -o /tmp/check.stl verify_geometry.scad
// insert / shift / lid_path / free / wedge / hub: empty objectが合格（OpenSCAD終了値1）。
// path: ECHOのPASSを確認。エラー・警告がないことも必須。
use <motor_gear_38_hourglass_v2.scad>
check="insert";
module gear() { import("motor_gear_38_hourglass_v2_gear.stl"); }
module hub() {
 import("motor_gear_38_hourglass_v2_ring.stl");
 translate([0,0,2.3]) import("motor_gear_38_hourglass_v2_hub.stl");
}
module lid() { translate([0,0,13]) rotate([0,0,60]) rotate([180,0,0]) import("motor_gear_38_hourglass_v2_cover.stl"); }
module surroundings() { gear(); hub(); lid(); }
// 最大径より半径0.2mm大きい円柱を使い、直線挿入の全経路を保守的に検査。
if(check=="insert") intersection() {
 element_positions(36,24) translate([0,0,2.25]) cylinder(r=3.9,h=25,$fn=180);
 union() {gear(); hub();}
}
// 3つの凸部分に分けてhullし、鼓形を維持したまま半径方向への全移動を検査。
else if(check=="shift") intersection() {
 union() for(k=[0:5]) rotate([0,0,36+60*k]) {
  for(seg=[[0,2,3.7,3.1],[2,4.5,3.1,3.1],[6.5,2,3.1,3.7]]) hull() {
   for(r=[24,24.86]) translate([r,0,2.25+seg[0]]) cylinder(h=seg[1],r1=seg[2],r2=seg[3],$fn=180);
  }
 }
 union() {gear(); hub();}
}
else if(check=="free" || check=="wedge") intersection() {
 rolling_elements(check=="free" ? 36 : contact_angle());
 surroundings();
}
else if(check=="hub") intersection() { hub(); union() {gear(); lid();} }
// 蓋を真下に下ろす全経路。突起の面取りを埋めた保守的な包絡体で検査。
else if(check=="lid_path") intersection() {
 union() {
  translate([0,0,9.5]) difference() {
   cylinder(r=20.85,h=25,$fn=180);
   translate([0,0,-0.01]) cylinder(r=19.3,h=25.02,$fn=180);
  }
  // z=11は蓋の意図した着座面。接触面そのものを交差判定から除外する。
  translate([0,0,11.01]) difference() {
   cylinder(r=34.5,h=25,$fn=180);
   translate([0,0,-0.01]) cylinder(r=10.3,h=25.02,$fn=180);
  }
 }
 union() {gear(); hub(); rolling_elements(36);}
}
else if(check=="path") {
 for(i=[0:80]) assert(cam_distance(contact_angle()+(36-contact_angle())*i/80)>3.1,"waist collision");
 assert(cam_distance(contact_angle()-2)<3.1,"no lock contact");
 echo("PASS: 81 waist path samples clear; narrowing side contacts");
}
else assert(false,"unknown check");
