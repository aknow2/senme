// 写真を参考に、斜めの長方形4枚を半分ずつずらして接続。
// 単位mm。外形60 x 200、板厚2、折り目に残す厚み1。
width = 60;
depth = 200;
thickness = 2;
fold_thickness = 1;
fold_width = 1;
tilt = 18; // 長辺の鉛直からの傾き（度）
rope_hole_diameter = 6; // 縄を通す貫通穴の直径
rope_hole_inset = 8;    // 上端の短辺から穴中心までの距離

module shide(width, depth, thickness, fold_thickness, fold_width, tilt,
             rope_hole_diameter, rope_hole_inset) {
    assert(width > 0 && depth > 0 && thickness > 0);
    assert(fold_thickness > 0 && fold_thickness <= thickness);
    assert(fold_width > 0 && tilt > 0 && tilt < 45);

    // 長方形の直角を保ち、外形寸法から長辺・短辺を求める。
    c = cos(tilt);
    s = sin(tilt);
    overlap = 0.02; // 接続面の数値誤差を避ける微小な重なり
    length = (depth * c - width * s) / (2.5 * c*c + 0.5 * s*s);
    total_short = (width + 0.5 * length * s) / c;
    strip_width = (total_short + 3 * overlap) / 4;
    pitch = strip_width - overlap;
    assert(length > 0 && strip_width > fold_width);
    assert(pitch * c > length * s / 2,
           "Dimensions and tilt cannot form the intended stepped silhouette.");
    assert(rope_hole_diameter > 0 && rope_hole_diameter < strip_width);
    assert(rope_hole_inset > rope_hole_diameter / 2 &&
           rope_hole_inset + rope_hole_diameter / 2 < length / 2,
           "Rope hole must fit inside the free upper end.");

    // ローカルXが短辺方向、Yが長辺方向。
    translate([length * s, depth, 0])
        rotate([0, 0, -tilt])
            mirror([0, 1, 0])
                difference() {
                    linear_extrude(height = thickness)
                        union() {
                            for (i = [0:3])
                                translate([i * pitch, i * length / 2])
                                    square([strip_width, length]);
                        }

                    // 最上段の短辺中央寄りに穴を開ける。標準で端に5mm残る。
                    translate([strip_width / 2, rope_hole_inset, -0.1])
                        cylinder(d = rope_hole_diameter,
                                 h = thickness + 0.2, $fn = 96);

                    // 接する長辺に沿う3本の折り目。底面は平らに保つ。
                    for (i = [1:3])
                        translate([i * pitch + overlap / 2 - fold_width / 2,
                                   i * length / 2 - overlap, fold_thickness])
                            cube([fold_width, length / 2 + 2 * overlap,
                                  thickness - fold_thickness + 0.1]);
                }
}

shide(width, depth, thickness, fold_thickness, fold_width, tilt,
      rope_hole_diameter, rope_hole_inset);
