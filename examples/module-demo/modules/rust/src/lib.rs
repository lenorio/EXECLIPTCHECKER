#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

#[no_mangle]
pub extern "C" fn pick_track(count: u32, random: u32) -> i32 {
    if count == 0 || count > i32::MAX as u32 {
        return -1;
    }
    ((random as u64 * count as u64) >> 32) as i32
}
