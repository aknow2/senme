
// 119.5mm ターンテーブルベアリング用 センタリング治具（φ3mm センターピン付き）
// OpenSCAD
//
// 用途:
// - 119.5mm中央穴のあるターンテーブルベアリングに差し込む
// - 木板側にあらかじめ開けた φ3mm のセンター穴へピンを差し込んで位置決めする
// - その状態でベアリングの取付穴位置をマーキングする
//
// 印刷向き:
// - フランジ面を下にして印刷
// - 基本的にサポート不要
//
// きつい / ゆるい場合:
// - diameter_clearance を調整してください
//   例) きつい -> 0.40〜0.50
//       ゆるい -> 0.15〜0.20

$fn = 180;

// ===== パラメータ =====

// ベアリング中央穴の実測値
bearing_hole_d = 119.5;

// 穴よりどれだけ小さくするか（直径差）
diameter_clearance = 0.30;

// 差し込み部分
insert_d = bearing_hole_d - diameter_clearance;
insert_h = 7.0;

// 上側フランジ
flange_d = bearing_hole_d;
flange_h = 3.0;

// センターピン
center_pin_d = 2.5;
center_pin_h = 6.0;

// ピン先端の軽いテーパー
pin_tip_h = 1.5;
pin_tip_d = 1.5;

// 視認用の浅いくぼみ（上面）
center_recess_d = 16.0;
center_recess_depth = 0.8;


// ===== 本体 =====
difference() {
    union() {
        // 上側フランジ
        cylinder(d = flange_d, h = flange_h);

        // ベアリング穴へ入る差し込み部
        translate([0, 0, flange_h])
            cylinder(d = insert_d, h = insert_h);

        // 差し込み部の先に出るセンターピン
        translate([0, 0, flange_h + insert_h])
            cylinder(d = center_pin_d, h = center_pin_h);

        // ピン先端のテーパー
        translate([0, 0, flange_h + insert_h + center_pin_h])
            cylinder(d1 = center_pin_d, d2 = pin_tip_d, h = pin_tip_h);
    }

    // 上面の中心視認用くぼみ
    translate([0, 0, -0.01])
        cylinder(d = center_recess_d, h = center_recess_depth);
}
