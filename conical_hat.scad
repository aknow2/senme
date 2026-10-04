// 三角帽子（底面が開いた円すい）。単位: mm。
// diameter は裾の外径、height は底面から頂点までの外形高さ。
// thickness は斜面に垂直な肉厚。
diameter = 210;
height = 30;
thickness = 2;
$fn = 360;

module conical_hat(diameter, height, thickness) {
    assert(diameter > 0 && height > 0 && thickness > 0);
    radius = diameter / 2;
    slope = height / radius;
    // 外面 z = height - slope*r を法線方向に thickness だけ内側へ移す。
    inner_height = height - thickness * sqrt(1 + slope * slope);
    inner_radius = inner_height / slope;
    assert(inner_height > 0, "Thickness is too large for this cone.");

    rotate_extrude(convexity = 10)
        polygon(points = [
            [radius, 0],
            [0, height],
            [0, inner_height],
            [inner_radius, 0]
        ]);
}

conical_hat(diameter, height, thickness);
