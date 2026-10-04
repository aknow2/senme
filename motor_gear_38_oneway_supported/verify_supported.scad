use <motor_gear_38_oneway_supported.scad>
check="fit";
if(check=="fit") intersection() {
 clutch_hub();
 union() {clutch_gear();translate([0,0,11.2]) clutch_cover();}
}
// 剛体として指定した退避経路のチェック。弾性変形シミュレーションではない。
else if(check=="inward") linear_extrude(height=1) intersection() {
 drive_stop_profile();
 union() for(d=[0:0.1:2.2]) translate([-d*cos(-5),-d*sin(-5)]) pawl_profile();
}
else if(check=="rest") linear_extrude(height=1) intersection() {
 drive_stop_profile(); pawl_profile();
}
// 爪が駆動反力でCW側へ1度逃げるとストッパーに当たる形状であること。
else if(check=="stop") linear_extrude(height=1) intersection() {
 drive_stop_profile(); rotate(-1) pawl_profile();
}
