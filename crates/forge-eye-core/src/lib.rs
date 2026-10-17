//! Forge Eye's deterministic geometry and animation core.
//!
//! Rendering remains behind an adapter boundary: native apps can use wgpu,
//! while the current web preview adapts MeshData into its renderer. Geometry,
//! keyframe evaluation and validation are implemented in Rust.

pub mod animation;
pub mod geometry;

pub use animation::{AnimationTrack, KeyInterpolation, Transform, TransformKey};
pub use geometry::{
    Axis, LatheOptions, LatheProfilePoint, MeshData, MeshError, generate_lathe_mesh,
};

#[cfg(target_arch = "wasm32")]
mod wasm_abi;
