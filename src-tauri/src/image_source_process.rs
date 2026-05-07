#[cfg(unix)]
pub(crate) fn process_is_running(pid: u32) -> bool {
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    unsafe { kill(pid as i32, 0) == 0 }
}

#[cfg(target_os = "windows")]
pub(crate) fn process_is_running(pid: u32) -> bool {
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> isize;
    }
    extern "system" {
        fn GetExitCodeProcess(process: isize, exit_code: *mut u32) -> i32;
    }
    extern "system" {
        fn CloseHandle(object: isize) -> i32;
    }
    unsafe {
        let handle = OpenProcess(0x1000, 0, pid);
        if handle == 0 {
            return false;
        }
        let mut exit_code = 0u32;
        let ok = GetExitCodeProcess(handle, &mut exit_code) != 0;
        CloseHandle(handle);
        ok && exit_code == 259
    }
}

#[cfg(not(any(unix, target_os = "windows")))]
pub(crate) fn process_is_running(_pid: u32) -> bool {
    true
}
