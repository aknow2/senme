// ================================
// 直径30cm円用 中心出し治具
// 鉛筆用スリット付き
// 隣り合う2辺の立ち上がりを円の縁に当てて使用
// 単位: mm
// ================================

// ---- パラメータ ----
outer_size   = 174;   // 治具全体サイズ（1辺17cm）
thickness    = 2.5;     // 板厚
wall_height  = 15;    // 板の表面からの立ち上がり高さ
wall_thickness = 4;  // 2辺共通の壁厚（内側の当たり面は x=y に対して対称）
slot_width   = 3.2;   // 鉛筆先用スリット幅（2.5〜4.0くらいで調整）
slot_start   = 20;    // スリット開始位置
slot_end     = outer_size - 10; // 端から10mm手前まで（直径30cm円の中心位置154mmを含む）
corner_round = 2;     // 角のR

// ---- 2点を結ぶ細長い穴 ----
module line_slot_2d(p1=[20,20], p2=[210,210], w=3.2) {
    hull() {
        translate(p1) circle(d=w, $fn=48);
        translate(p2) circle(d=w, $fn=48);
    }
}

// ---- 角丸四角形 ----
module rounded_square(size=100, r=3) {
    offset(r=r)
        offset(delta=-r)
            square([size, size]);
}

// ---- 本体 ----
difference() {
    union() {
        // 本体プレート
        linear_extrude(height=thickness)
            rounded_square(outer_size, corner_round);

        // x=0側とy=0側の2辺にL字の壁を追加
        // 板と同じ外形で切り取り、外寸と角丸を維持
        linear_extrude(height=thickness + wall_height)
            intersection() {
                rounded_square(outer_size, corner_round);
                union() {
                    square([outer_size, wall_thickness]);
                    square([wall_thickness, outer_size]);
                }
            }
    }

    // 45度スリット
    translate([0,0,-0.1])
        linear_extrude(height=thickness + 0.2)
            line_slot_2d(
                [slot_start, slot_start],
                [slot_end,   slot_end],
                slot_width
            );
}
