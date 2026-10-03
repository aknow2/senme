// Dカット軸のはめ合いテストプレート / 単位 mm
// 各穴はmotor_gear_47.scadと同じ方法で公称D形状を拡張します。
// 列 C = shaft_clearance（片側すき間）
// 行 F = shaft_flat_to_back（公称の平面～反対側円弧の距離）
// 選んだ穴のFとCをギアファイルの同名パラメータに転記してください。
// 実際の穴の円弧径 = shaft_diameter + 2*C
// 実際の穴の平面～反対側円弧 = F + 2*C
// 例 F7 / C0.15: 円弧径8.30、平面～反対側7.30。
// 刻印面を上にして印刷。3 mm厚での試験なので、12 mm厚の本体でも再確認。

shaft_diameter = 8;
flat_sizes = [6.5, 6.75, 7, 7.25, 7.5];
clearances = [0.05, 0.10, 0.15, 0.20, 0.25];
plate_thickness = 4.2;
hole_spacing = 18;
entry_chamfer = 0.4;
engraving_depth = 0.5;
label_size = 3;
$fn = 128;

epsilon = 0.01;
plate_width = 32 + (len(clearances)-1)*hole_spacing + 16;
plate_height = 20 + (len(flat_sizes)-1)*hole_spacing + 28;

assert(len(flat_sizes)>0 && len(clearances)>0);
assert(plate_thickness > 2*entry_chamfer);
assert(engraving_depth > 0 && engraving_depth < plate_thickness);
assert(min(flat_sizes)>shaft_diameter/2 && max(flat_sizes)<shaft_diameter);
assert(min(clearances)>=0 && entry_chamfer>=0);
assert(hole_spacing > shaft_diameter + 2*max(clearances) + 2*entry_chamfer + 2);

module d_profile(flat_size, clearance, extra=0) {
    offset(delta=clearance+extra)
        intersection() {
            circle(d=shaft_diameter);
            translate([-shaft_diameter, -shaft_diameter])
                square([shaft_diameter/2+flat_size, 2*shaft_diameter]);
        }
}

module test_hole(flat_size, clearance) {
    translate([0,0,-epsilon])
        linear_extrude(height=plate_thickness+2*epsilon)
            d_profile(flat_size, clearance);
    if (entry_chamfer>0) {
        hull() {
            translate([0,0,-epsilon])
                linear_extrude(height=epsilon)
                    d_profile(flat_size,clearance,entry_chamfer);
            translate([0,0,entry_chamfer])
                linear_extrude(height=epsilon)
                    d_profile(flat_size,clearance);
        }
        hull() {
            translate([0,0,plate_thickness-entry_chamfer-epsilon])
                linear_extrude(height=epsilon)
                    d_profile(flat_size,clearance);
            translate([0,0,plate_thickness])
                linear_extrude(height=epsilon)
                    d_profile(flat_size,clearance,entry_chamfer);
        }
    }
}

module label_at(x,y,value,size=label_size) {
    translate([x,y,plate_thickness-engraving_depth])
        linear_extrude(height=engraving_depth+epsilon)
            text(value,size=size,halign="center",valign="center",
                 font="Liberation Sans:style=Bold");
}

difference() {
    cube([plate_width,plate_height,plate_thickness]);
    for (row=[0:len(flat_sizes)-1]) {
        y = plate_height-28-row*hole_spacing;
        label_at(12,y,str("F",flat_sizes[row]));
        for (col=[0:len(clearances)-1])
            translate([32+col*hole_spacing,y,0])
                test_hole(flat_sizes[row],clearances[col]);
    }
    for (col=[0:len(clearances)-1])
        label_at(32+col*hole_spacing,plate_height-14,str("C",clearances[col]));
    label_at(plate_width/2,6,str("D",shaft_diameter," / F=flat  C=clearance"));
}

echo("Plate size",[plate_width,plate_height,plate_thickness]);
echo("Hole count",len(flat_sizes)*len(clearances));
