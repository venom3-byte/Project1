//! Minimal JSON ABI so the browser can call the same Rust code without generated glue.
//! Wasm callers must pass valid (pointer, length) pairs allocated through forge_eye_alloc.

use crate::{
    AnimationTrack, LatheOptions, LatheProfilePoint, Transform, VisualHullOptions,
    generate_lathe_mesh, generate_visual_hull_mesh,
};
use serde::{Deserialize, Serialize};
use std::slice;

#[derive(Deserialize)]
struct LatheRequest {
    profile: Vec<LatheProfilePoint>,
    #[serde(default)]
    options: LatheOptions,
}

#[derive(Deserialize)]
struct VisualHullRequest {
    front_contour: Vec<[f32; 2]>,
    side_contour: Vec<[f32; 2]>,
    #[serde(default)]
    top_contour: Option<Vec<[f32; 2]>>,
    #[serde(default)]
    options: VisualHullOptions,
}

#[derive(Deserialize)]
struct AnimationRequest {
    #[serde(default)]
    track: AnimationTrack,
    frame: f32,
}

#[derive(Serialize)]
struct SuccessMesh<'a> {
    ok: bool,
    mesh: &'a crate::MeshData,
    version: &'static str,
}

#[derive(Serialize)]
struct SuccessVisualHull<'a> {
    ok: bool,
    mesh: &'a crate::MeshData,
    occupied_voxels: usize,
    view_count: u32,
    resolution: u32,
    version: &'static str,
}

#[derive(Serialize)]
struct SuccessTransform {
    ok: bool,
    transform: Transform,
    version: &'static str,
}

#[derive(Serialize)]
struct Failure {
    ok: bool,
    error: String,
    version: &'static str,
}

fn pack_output(json: String) -> u64 {
    let data = json.into_bytes().into_boxed_slice();
    let len = data.len() as u32;
    let ptr = Box::into_raw(data) as *mut u8 as u32;
    ((ptr as u64) << 32) | (len as u64)
}

fn failure(message: impl Into<String>) -> u64 {
    pack_output(
        serde_json::to_string(&Failure {
            ok: false,
            error: message.into(),
            version: env!("CARGO_PKG_VERSION"),
        })
        .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"serialization failed\"}".to_owned()),
    )
}

#[unsafe(no_mangle)]
pub extern "C" fn forge_eye_version() -> u32 {
    0x0001_0000
}

#[unsafe(no_mangle)]
pub extern "C" fn forge_eye_alloc(length: u32) -> u32 {
    let data = vec![0_u8; length as usize].into_boxed_slice();
    Box::into_raw(data) as *mut u8 as u32
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn forge_eye_dealloc(pointer: u32, length: u32) {
    if pointer == 0 {
        return;
    }
    let slice_ptr = std::ptr::slice_from_raw_parts_mut(pointer as *mut u8, length as usize);
    unsafe {
        drop(Box::from_raw(slice_ptr));
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn forge_eye_free_output(pointer: u32, length: u32) {
    if pointer == 0 {
        return;
    }
    let slice_ptr = std::ptr::slice_from_raw_parts_mut(pointer as *mut u8, length as usize);
    unsafe {
        drop(Box::from_raw(slice_ptr));
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn forge_eye_lathe_json(pointer: u32, length: u32) -> u64 {
    let payload = unsafe { slice::from_raw_parts(pointer as *const u8, length as usize) };
    let request: LatheRequest = match serde_json::from_slice(payload) {
        Ok(value) => value,
        Err(error) => return failure(format!("Invalid lathe request: {error}")),
    };
    match generate_lathe_mesh(&request.profile, request.options) {
        Ok(mesh) => {
            match serde_json::to_string(&SuccessMesh {
                ok: true,
                mesh: &mesh,
                version: env!("CARGO_PKG_VERSION"),
            }) {
                Ok(json) => pack_output(json),
                Err(error) => failure(format!("Could not serialize generated mesh: {error}")),
            }
        }
        Err(error) => failure(error.to_string()),
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn forge_eye_visual_hull_json(pointer: u32, length: u32) -> u64 {
    let payload = unsafe { slice::from_raw_parts(pointer as *const u8, length as usize) };
    let request: VisualHullRequest = match serde_json::from_slice(payload) {
        Ok(value) => value,
        Err(error) => return failure(format!("Invalid visual-hull request: {error}")),
    };
    match generate_visual_hull_mesh(
        &request.front_contour,
        &request.side_contour,
        request.top_contour.as_deref(),
        request.options,
    ) {
        Ok(result) => {
            match serde_json::to_string(&SuccessVisualHull {
                ok: true,
                mesh: &result.mesh,
                occupied_voxels: result.occupied_voxels,
                view_count: result.view_count,
                resolution: result.resolution,
                version: env!("CARGO_PKG_VERSION"),
            }) {
                Ok(json) => pack_output(json),
                Err(error) => failure(format!("Could not serialize visual-hull mesh: {error}")),
            }
        }
        Err(error) => failure(error.to_string()),
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn forge_eye_animation_json(pointer: u32, length: u32) -> u64 {
    let payload = unsafe { slice::from_raw_parts(pointer as *const u8, length as usize) };
    let request: AnimationRequest = match serde_json::from_slice(payload) {
        Ok(value) => value,
        Err(error) => return failure(format!("Invalid animation request: {error}")),
    };
    if !request.frame.is_finite() {
        return failure("Animation frame must be finite.");
    }
    let transform = request
        .track
        .evaluate(request.frame.clamp(0.0, 1_000_000.0));
    match serde_json::to_string(&SuccessTransform {
        ok: true,
        transform,
        version: env!("CARGO_PKG_VERSION"),
    }) {
        Ok(json) => pack_output(json),
        Err(error) => failure(format!("Could not serialize evaluated transform: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Axis;

    #[test]
    fn request_contract_defaults_to_y_axis_64_segments_and_smoothing() {
        let input = r#"{"profile":[{"radius":0.0,"height":0.0},{"radius":0.5,"height":0.0},{"radius":0.0,"height":1.0}]}"#;
        let request: LatheRequest = serde_json::from_str(input).unwrap();
        assert_eq!(request.options.axis, Axis::Y);
        assert_eq!(request.options.radial_segments, 64);
        assert_eq!(request.options.profile_subdivisions, 1);
    }
}
