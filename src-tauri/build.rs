fn main() {
    // rfd/muda import comctl32's `TaskDialogIndirect`, which only exists in
    // comctl32 v6. Bin targets get v6 via the manifest tauri-build embeds,
    // but test executables link the same code with no manifest, bind ancient
    // comctl32 v5 at load and die with STATUS_ENTRYPOINT_NOT_FOUND before
    // running a single test. Delay-loading comctl32 defers the bind to the
    // first actual call: tests never make one, and the app resolves v6
    // through its manifest exactly as before.
    let is_windows_msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    if is_windows_msvc {
        println!("cargo:rustc-link-arg=/DELAYLOAD:comctl32.dll");
        println!("cargo:rustc-link-arg=/DEFAULTLIB:delayimp.lib");
    }

    tauri_build::build()
}
