use <motor_gear_38_oneway_thick.scad>
// 組立初期位置で意図しない干渉がなければ、結果はempty objectになる。
intersection() {
 clutch_hub();
 union() {clutch_gear();translate([0,0,11.2]) clutch_cover();}
}
