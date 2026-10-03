// VP16 テーブル脚受け / 単位 mm
// 同じパーツを4個、天板の裏側の四隅に取り付ける。
// 1個あたりM4ねじ・ナット4組。天板側からねじを通し、脚受け側でナット留め。
// 造形時は平らな板面を下向き。管は差し込み式で、抜け止めはない。
// 管穴は台座まで貫通し、管の端面を天板の裏面で受ける。
// CLI: openscad -o vp16_leg_socket.stl vp16_leg_socket.scad

pipe_od = 22;
diametral_clearance = 0.5; // 直径方向の余裕。実物の管とプリンタに合わせて調整。
socket_depth = 30; // 台座からの筒の高さ。差し込み深さは台座厚を含め35mm。
socket_wall = 4;
plate_size = 48;
plate_thickness = 5;
corner_radius = 4;
mount_hole_pitch = 36;
mount_hole_diameter = 4.5;
rib_thickness = 4;
rib_height = 16;
render_part = "socket"; // "socket": STL用、"preview": 管の差し込み確認

$fn = 128;
eps = 0.02;
socket_id = pipe_od + diametral_clearance;
socket_od = socket_id + 2*socket_wall;
total_height = plate_thickness + socket_depth;

assert(pipe_od > 0 && diametral_clearance >= 0);
assert(socket_depth > 0 && socket_wall > 0 && plate_thickness > 0);
assert(corner_radius > 0 && corner_radius < plate_size/2);
assert(mount_hole_diameter > 0 && mount_hole_pitch > 0);
assert((plate_size-mount_hole_pitch)/2 > mount_hole_diameter/2+2);
assert(mount_hole_pitch/sqrt(2)-socket_od/2 > 5,
       "ナット周囲の余裕が足りません");
assert(socket_od/2 < plate_size/2-2);
assert(rib_height > 0 && rib_height <= socket_depth && rib_thickness > 0);

module base_plate() {
    linear_extrude(height=plate_thickness)
        offset(r=corner_radius)
            square([plate_size-2*corner_radius,
                    plate_size-2*corner_radius],center=true);
}

// 四方向の三角リブ。管受け根元を補強し、角のねじ周辺を空ける。
module rib() {
    inner_x = socket_od/2-1;
    outer_x = plate_size/2-2;
    translate([0,rib_thickness/2,plate_thickness-eps])
        rotate([90,0,0])
            linear_extrude(height=rib_thickness)
                polygon([[inner_x,0],[outer_x,0],[inner_x,rib_height]]);
}

module leg_socket() {
    difference() {
        union() {
            base_plate();
            translate([0,0,plate_thickness-eps])
                cylinder(d=socket_od,h=socket_depth+eps);
            for (angle=[0:90:270]) rotate([0,0,angle]) rib();
        }
        // 台座の底まで貫通。パイプの端面は天板の裏面に当たる。
        translate([0,0,-eps])
            cylinder(d=socket_id,h=total_height+2*eps);
        // 差し込み口に0.8mmの面取り。
        translate([0,0,total_height-0.8])
            cylinder(d1=socket_id,d2=socket_id+1.6,h=0.8+eps);
        for (x=[-mount_hole_pitch/2,mount_hole_pitch/2])
            for (y=[-mount_hole_pitch/2,mount_hole_pitch/2])
                translate([x,y,-eps])
                    cylinder(d=mount_hole_diameter,h=plate_thickness+2*eps);
    }
}

assert(render_part == "socket" || render_part == "preview");
leg_socket();
if (render_part == "preview") {
    %translate([0,0,0])
        difference() {
            cylinder(d=pipe_od,h=100);
            translate([0,0,-eps]) cylinder(d=16,h=100+2*eps);
        }
}

echo("Base / overall height mm",[plate_size,plate_size,total_height]);
echo("Socket ID / insertion depth mm",[socket_id,total_height]);
echo("M4 hole pitch / diameter mm",[mount_hole_pitch,mount_hole_diameter]);
