// M4真鍮六角スペーサーの胴体を通す六角穴テスト / 単位 mm
// motor_d_shaft_test_plateと同じ、寸法と片側すき間の比較プレート。
// 行 F = 六角胴体の対辺寸法（向かい合う平らな面どうしの幅）。
// 列 C = 各平面に追加する片側すき間。穴の対辺寸法はF+2*C。
// 例 F7 / C0.15: 六角穴の対辺7.30、対角7.30/cos(30)。
// M4はねじ径の呼びであり、胴体の対辺寸法は実物に合わせてください。
// 選んだFとCを本体に転記し、hex_profileと同じ形状で穴を作ります。
// 刻印面を上にして印刷。本体と同じ材料・積層条件で比較してください。
// 上下の入口を面取り。穴は六角形のまま貫通し、ねじ山はありません。
// 板厚4.2mmでの試験。本体での差し込み長さが違う場合は再確認。
// CLI: openscad -o m4_spacer_test_plate.stl m4_spacer_test_plate.scad

flat_sizes = [6, 6.5, 7, 7.5, 8]; // 実測値が分かれば、例 [7] に絞れます。
clearances = [0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30];
plate_thickness = 4.2;
hole_spacing = 18;
entry_chamfer = 0.4;
engraving_depth = 0.5;
label_size = 3;

epsilon = 0.01;
plate_width = 32 + (len(clearances)-1)*hole_spacing + 16;
plate_height = 20 + (len(flat_sizes)-1)*hole_spacing + 28;
max_opening = (max(flat_sizes)+2*max(clearances)+2*entry_chamfer)/cos(30);

assert(len(flat_sizes)>0 && len(clearances)>0);
assert(min(flat_sizes)>0 && min(clearances)>=0);
assert(entry_chamfer>=0 && plate_thickness>2*entry_chamfer);
assert(engraving_depth>0 && engraving_depth<plate_thickness);
assert(hole_spacing>max_opening+4);
assert(max_opening/2+2<14, "穴が刻印または外周に近すぎます");

module hex_profile(flat_size, clearance, extra=0) {
    // $fn=6の円のdは対角寸法。対辺寸法から換算する。
    circle(d=(flat_size+2*(clearance+extra))/cos(30), $fn=6);
}

module test_hole(flat_size, clearance) {
    translate([0,0,-epsilon])
        linear_extrude(height=plate_thickness+2*epsilon)
            hex_profile(flat_size,clearance);
    if (entry_chamfer>0) {
        hull() {
            translate([0,0,-epsilon])
                linear_extrude(height=epsilon)
                    hex_profile(flat_size,clearance,entry_chamfer);
            translate([0,0,entry_chamfer])
                linear_extrude(height=epsilon)
                    hex_profile(flat_size,clearance);
        }
        hull() {
            translate([0,0,plate_thickness-entry_chamfer-epsilon])
                linear_extrude(height=epsilon)
                    hex_profile(flat_size,clearance);
            translate([0,0,plate_thickness])
                linear_extrude(height=epsilon)
                    hex_profile(flat_size,clearance,entry_chamfer);
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
    label_at(plate_width/2,6,"M4 HEX / F=flats  C=clearance");
}

echo("Plate size mm",[plate_width,plate_height,plate_thickness]);
echo("Hex hole count",len(flat_sizes)*len(clearances));
echo("Body across flats mm",flat_sizes);
echo("Per-side clearances mm",clearances);
