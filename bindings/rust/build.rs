fn main() {
    let src_dir = std::path::Path::new("src");

    let mut c_config = cc::Build::new();
    c_config.std("c11").include(src_dir);

    #[cfg(target_env = "msvc")]
    c_config.flag("-utf-8");

    // Without these, editing the scanner leaves cargo linking a stale object
    // file, so the Rust tests silently keep testing the previous build.
    println!("cargo:rerun-if-changed={}", src_dir.join("parser.c").display());
    println!("cargo:rerun-if-changed={}", src_dir.join("scanner.c").display());

    c_config.file(src_dir.join("parser.c"));
    c_config.file(src_dir.join("scanner.c"));

    c_config.compile("tree-sitter-move");
}
