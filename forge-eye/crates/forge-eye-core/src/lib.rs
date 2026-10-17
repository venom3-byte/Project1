//! Forge Eye's deterministic geometry core.
//!
//! No browser or renderer dependencies live here. The same validated geometry
//! operations can run natively in tests, in WebAssembly, and in a future desktop host.

use serde::{Deserialize, Serialize};

pub mod editor;
pub use editor::{
    CommandResult, EditorCommand, EditorSession, Interpolation, MaterialState, ObjectKind,
    PrimitiveKind, Scene, SceneObject, TimelineState, Transform, TransformKeyframe,
};
use std::collections::HashMap;
use std::error::Error;
use std::fmt::{Display, Formatter};

const EPSILON: f32 = 1.0e-6;
const MAX_CONTOUR_POINTS: usize = 512;
const MIN_RESOLUTION: usize = 8;
const MAX_RESOLUTION: usize = 64;
const MIN_LATHE_SEGMENTS: usize = 12;
const MAX_LATHE_SEGMENTS: usize = 128;

/// A normalized 2D image coordinate. Origin is top-left; both axes are in [0, 1].
pub type Point2 = [f32; 2];
/// A 3D position in meters, with Y up.
pub type Point3 = [f32; 3];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeometryError(pub String);

impl Display for GeometryError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl Error for GeometryError {}

fn error(message: impl Into<String>) -> GeometryError {
    GeometryError(message.into())
}

/// A single indexed mesh. Vertices are intentionally duplicated per face for
/// stable hard normals; a later topology pass may weld them for editing/export.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MeshData {
    pub name: String,
    pub vertices: Vec<Point3>,
    pub normals: Vec<Point3>,
    pub indices: Vec<u32>,
    pub color: [f32; 4],
    pub diagnostics: MeshDiagnostics,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct MeshDiagnostics {
    pub method: String,
    pub view_count: usize,
    pub resolution: usize,
    pub occupied_voxels: usize,
    pub triangle_count: usize,
    pub vertex_count: usize,
    pub bounds_min: Point3,
 
…[1 chars truncated — re-run with head/grep/tail for full output]…
o(),
            view_count: 1,
            resolution: seg,
            ..Default::default()
        },
    };
    for i in 0..rings.len() {
        let next_profile = (i + 1) % rings.len();
        let radius_a = radii[i];
        let radius_b = radii[next_profile];
        if radius_a <= EPSILON && radius_b <= EPSILON {
            continue;
        }
        for j in 0..seg {
            let next_angle = (j + 1) % seg;
            let a = rings[i][j];
            let b = rings[i][next_angle];
            let c = rings[next_profile][j];
            let d = rings[next_profile][next_angle];
            if radius_a <= EPSILON {
                push_flat_triangle(&mut mesh, [a, c, d])?;
            } else if radius_b <= EPSILON {
                push_flat_triangle(&mut mesh, [a, c, b])?;
            } else {
                push_flat_triangle(&mut mesh, [a, c, b])?;
                push_flat_triangle(&mut mesh, [b, c, d])?;
            }
        }
    }
    if mesh.indices.len() < seg * 3 {
        return Err(error(
            "Lathe profile did not produce a valid rotational surface.",
        ));
    }
    finish_diagnostics(&mut mesh);
    Ok(mesh)
}

const MAX_SPIN_SUBDIVISION: usize = 3;

/// Subdivide the 2D control profile before spinning it. This is a deterministic
/// Catmull–Rom profile refinement approximation, not Blender's full Catmull–Clark
/// polygon modifier. Supporting points remain user-editable in the source profile.
fn subdivide_spin_profile(profile: &[Point2], level: usize) -> Result<Vec<Point2>, GeometryError> {
    if level > MAX_SPIN_SUBDIVISION {
        return Err(error(format!(
            "Profile subdivision must be between 0 and {MAX_SPIN_SUBDIVISION}."
        )));
    }
    validate_contour(profile)?;
    if level == 0 {
        return Ok(profile.to_vec());
    }
    let steps = 1usize << level;
    let cap = 256usize.saturating_mul(steps);
    let mut out = Vec::with_capacity((profile.len() * steps).min(cap));
    let catmull = |p0: Point2, p1: Point2, p2: Point2, p3: Point2, t: f32| -> Point2 {
        let t2 = t * t;
        let t3 = t2 * t;
        std::array::from_fn(|axis| {
            let value = 0.5
                * ((2.0 * p1[axis])
                    + (-p0[axis] + p2[axis]) * t
                    + (2.0 * p0[axis] - 5.0 * p1[axis] + 4.0 * p2[axis] - p3[axis]) * t2
                    + (-p0[axis] + 3.0 * p1[axis] - 3.0 * p2[axis] + p3[axis]) * t3);
            value.clamp(0.0, 1.0)
        })
    };
    for i in 0..profile.len() - 1 {
        let p0 = profile[i.saturating_sub(1)];
        let p1 = profile[i];
        let p2 = profile[i + 1];
        let p3 = profile[(i + 2).min(profile.len() - 1)];
        for step in 0..steps {
            let point = catmull(p0, p1, p2, p3, step as f32 / steps as f32);
            if out
                .last()
                .is_none_or(|prev: &Point2| distance_sq(*prev, point) > EPSILON * EPSILON)
            {
                out.push(point);
            }
        }
    }
    let last = *profile.last().expect("validated contour is not empty");
    if out
        .last()
        .is_none_or(|prev| distance_sq(*prev, last) > EPSILON * EPSILON)
    {
        out.push(last);
    }
    if out.len() > MAX_CONTOUR_POINTS {
        return Err(error(format!(
            "Refined profile has {} points; limit is {MAX_CONTOUR_POINTS}. Reduce subdivision or input points.",
            out.len()
        )));
    }
    validate_contour(&out)?;
    Ok(out)
}

/// Smooth normals by averaging adjacent triangle normals at coincident positions.
/// The mesh can retain face-local vertices for simple export while appearing smooth.
fn smooth_mesh_normals(mesh: &mut MeshData) {
    let key = |p: Point3| {
        (
            (p[0] * 100_000.0).round() as i64,
            (p[1] * 100_000.0).round() as i64,
            (p[2] * 100_000.0).round() as i64,
        )
    };
    let mut sums: HashMap<(i64, i64, i64), Point3> = HashMap::new();
    for (p, n) in mesh.vertices.iter().zip(mesh.normals.iter()) {
        let value = sums.entry(key(*p)).or_insert([0.0; 3]);
        for axis in 0..3 {
            value[axis] += n[axis];
        }
    }
    mesh.normals = mesh
        .vertices
        .iter()
        .map(|p| {
            let v = sums.get(&key(*p)).copied().unwrap_or([0.0, 1.0, 0.0]);
            let length = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
                .sqrt()
                .max(EPSILON);
            [v[0] / length, v[1] / length, v[2] / length]
        })
        .collect();
}

/// Blender-inspired Spin/Lathe operation: trace a profile, revolve it 360°,
/// refine the profile, and optionally smooth shared normals.
pub fn build_spin_profile(request: &SpinRequest) -> Result<MeshData, GeometryError> {
    if request.subdivision_level > MAX_SPIN_SUBDIVISION {
        return Err(error(format!(
            "Profile subdivision must be between 0 and {MAX_SPIN_SUBDIVISION}."
        )));
    }
    if !(MIN_LATHE_SEGMENTS..=MAX_LATHE_SEGMENTS).contains(&request.segments) {
        return Err(error(format!(
            "Spin segments must be between {MIN_LATHE_SEGMENTS} and {MAX_LATHE_SEGMENTS}."
        )));
    }
    let profile = subdivide_spin_profile(&request.profile, request.subdivision_level)?;
    let multiplier = 1usize << request.subdivision_level;
    let effective_segments = request
        .segments
        .saturating_mul(multiplier)
        .min(MAX_LATHE_SEGMENTS);
    let lathe = LatheRequest {
        name: request.name.clone(),
        profile,
        diameter: request.diameter,
        height: request.height,
        segments: effective_segments,
        color: request.color,
    };
    let mut mesh = build_lathed_profile(&lathe)?;
    if request.smooth_shading {
        smooth_mesh_normals(&mut mesh);
    }
    mesh.diagnostics.method = format!(
        "Blender-style spin / lathe + profile smoothing (level {}){}",
        request.subdivision_level,
        if request.smooth_shading {
            " + smooth normals"
        } else {
            ""
        }
    );
    mesh.diagnostics.resolution = effective_segments;
    Ok(mesh)
}

fn validate_dimensions(width: f32, height: f32, depth: f32) -> Result<(), GeometryError> {
    for (name, value) in [("width", width), ("height", height), ("depth", depth)] {
        if !value.is_finite() || value <= 0.0 || value > 10_000.0 {
            return Err(error(format!(
                "{name} must be finite and between 0 and 10,000 meters."
            )));
        }
    }
    Ok(())
}
fn validate_color(color: [f32; 4]) -> Result<(), GeometryError> {
    if color
        .iter()
        .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
    {
        return Err(error(
            "Mesh color components must be finite values in [0, 1].",
        ));
    }
    Ok(())
}
fn signed_area(contour: &[Point2]) -> f32 {
    contour
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let q = contour[(i + 1) % contour.len()];
            p[0] * q[1] - q[0] * p[1]
        })
        .sum::<f32>()
        * 0.5
}
fn cross2(a: Point2, b: Point2, c: Point2) -> f32 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}
fn distance_sq(a: Point2, b: Point2) -> f32 {
    (a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)
}
fn point_in_triangle(p: Point2, a: Point2, b: Point2, c: Point2) -> bool {
    let x = cross2(a, b, p);
    let y = cross2(b, c, p);
    let z = cross2(c, a, p);
    (x >= -EPSILON && y >= -EPSILON && z >= -EPSILON)
        || (x <= EPSILON && y <= EPSILON && z <= EPSILON)
}
fn orientation(a: Point2, b: Point2, c: Point2) -> i32 {
    let v = cross2(a, b, c);
    if v.abs() <= EPSILON {
        0
    } else if v > 0.0 {
        1
    } else {
        -1
    }
}
fn on_segment(a: Point2, b: Point2, p: Point2) -> bool {
    p[0] >= a[0].min(b[0]) - EPSILON
        && p[0] <= a[0].max(b[0]) + EPSILON
        && p[1] >= a[1].min(b[1]) - EPSILON
        && p[1] <= a[1].max(b[1]) + EPSILON
}
fn segments_intersect(a: Point2, b: Point2, c: Point2, d: Point2) -> bool {
    let (o1, o2, o3, o4) = (
        orientation(a, b, c),
        orientation(a, b, d),
        orientation(c, d, a),
        orientation(c, d, b),
    );
    if o1 != o2 && o3 != o4 {
        return true;
    }
    (o1 == 0 && on_segment(a, b, c))
        || (o2 == 0 && on_segment(a, b, d))
        || (o3 == 0 && on_segment(c, d, a))
        || (o4 == 0 && on_segment(c, d, b))
}
fn point_in_polygon(point: Point2, contour: &[Point2]) -> bool {
    let (x, y) = (point[0], point[1]);
    let mut inside = false;
    let mut j = contour.len() - 1;
    for i in 0..contour.len() {
        let (xi, yi) = (contour[i][0], contour[i][1]);
        let (xj, yj) = (contour[j][0], contour[j][1]);
        let crosses = (yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi;
        if crosses {
            inside = !inside
        }
        j = i;
    }
    inside
}
fn push_quad(mesh: &mut MeshData, p: [Point3; 4], normal: Point3) -> Result<(), GeometryError> {
    let base = u32::try_from(mesh.vertices.len())
        .map_err(|_| error("Mesh exceeds u32 vertex indexing."))?;
    mesh.vertices.extend(p);
    mesh.normals.extend([normal; 4]);
    mesh.indices
        .extend([base, base + 1, base + 2, base, base + 2, base + 3]);
    Ok(())
}
fn push_triangle(mesh: &mut MeshData, p: [Point3; 3], normal: Point3) -> Result<(), GeometryError> {
    let base = u32::try_from(mesh.vertices.len())
        .map_err(|_| error("Mesh exceeds u32 vertex indexing."))?;
    mesh.vertices.extend(p);
    mesh.normals.extend([normal; 3]);
    mesh.indices.extend([base, base + 1, base + 2]);
    Ok(())
}
fn push_flat_triangle(mesh: &mut MeshData, p: [Point3; 3]) -> Result<(), GeometryError> {
    // Revolving profile points that touch the axis or lie on a straight section
    // can generate zero-area triangles at the poles. Do not serialize degenerate
    // faces into the renderer/export buffers; skip them and validate the final mesh.
    let Some(normal) = normalize3(cross3(sub3(p[1], p[0]), sub3(p[2], p[0]))) else {
        return Ok(());
    };
    push_triangle(mesh, p, normal)
}
fn push_flat_quad(mesh: &mut MeshData, p: [Point3; 4]) -> Result<(), GeometryError> {
    let u = sub3(p[1], p[0]);
    let v = sub3(p[2], p[0]);
    let n = normalize3(cross3(u, v)).ok_or_else(|| error("Degenerate contour wall."))?;
    push_quad(mesh, p, n)
}
fn sub3(a: Point3, b: Point3) -> Point3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn cross3(a: Point3, b: Point3) -> Point3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn normalize3(v: Point3) -> Option<Point3> {
    let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if l <= EPSILON {
        None
    } else {
        Some([v[0] / l, v[1] / l, v[2] / l])
    }
}
fn finish_diagnostics(mesh: &mut MeshData) {
    mesh.diagnostics.vertex_count = mesh.vertices.len();
    mesh.diagnostics.triangle_count = mesh.indices.len() / 3;
    if let Some(first) = mesh.vertices.first().copied() {
        let (mut min, mut max) = (first, first);
        for p in &mesh.vertices {
            for axis in 0..3 {
                min[axis] = min[axis].min(p[axis]);
                max[axis] = max[axis].max(p[axis])
            }
        }
        mesh.diagnostics.bounds_min = min;
        mesh.diagnostics.bounds_max = max;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn square() -> Vec<Point2> {
        vec![[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]
    }
    fn rect() -> Vec<Point2> {
        vec![[0.15, 0.15], [0.85, 0.15], [0.85, 0.85], [0.15, 0.85]]
    }
    #[test]
    fn triangulates_simple_contour() {
        let triangles = triangulate_contour(&square()).unwrap();
        assert_eq!(triangles.len(), 2);
    }
    #[test]
    fn rejects_self_intersections() {
        let p = vec![[0.1, 0.1], [0.9, 0.9], [0.1, 0.9], [0.9, 0.1]];
        assert!(
            validate_contour(&p)
                .unwrap_err()
                .0
                .contains("self-intersects")
        );
    }
    #[test]
    fn rejects_non_finite_coordinates() {
        let p = vec![[0.1, 0.1], [f32::NAN, 0.9], [0.2, 0.8]];
        assert!(validate_contour(&p).is_err());
    }
    #[test]
    fn rejects_zero_dimensions() {
        let req = HullRequest {
            name: "bad".into(),
            front_contour: square(),
            side_contour: square(),
            top_contour: None,
            width: 0.0,
            height: 3.0,
            depth: 2.0,
            resolution: 16,
            color: default_color(),
        };
        assert!(build_visual_hull(&req).is_err());
    }
    #[test]
    fn builds_two_view_visual_hull() {
        let req = HullRequest {
            name: "box".into(),
            front_contour: rect(),
            side_contour: rect(),
            top_contour: None,
            width: 4.0,
            height: 2.0,
            depth: 3.0,
            resolution: 16,
            color: default_color(),
        };
        let m = build_visual_hull(&req).unwrap();
        assert_eq!(m.diagnostics.view_count, 2);
        assert!(m.diagnostics.occupied_voxels > 0);
        assert_eq!(m.indices.len() % 3, 0);
        assert!(!m.vertices.is_empty());
        assert!(
            (m.diagnostics.bounds_max[0] - m.diagnostics.bounds_min[0] - 4.0 * 0.75).abs() < 0.6
        );
    }
    #[test]
    fn top_view_reduces_or_keeps_volume() {
        let base = HullRequest {
            name: "two".into(),
            front_contour: rect(),
            side_contour: rect(),
            top_contour: None,
            width: 4.0,
            height: 2.0,
            depth: 3.0,
            resolution: 20,
            color: default_color(),
        };
        let mut top = base.clone();
        top.name = "three".into();
        top.top_contour = Some(vec![[0.3, 0.1], [0.7, 0.1], [0.7, 0.9], [0.3, 0.9]]);
        let a = build_visual_hull(&base).unwrap();
        let b = build_visual_hull(&top).unwrap();
        assert_eq!(b.diagnostics.view_count, 3);
        assert!(b.diagnostics.occupied_voxels <= a.diagnostics.occupied_voxels);
    }
    #[test]
    fn extrusion_produces_real_indexed_mesh() {
        let req = ExtrusionRequest {
            name: "slab".into(),
            contour: square(),
            axis: ProjectionAxis::Front,
            width: 3.0,
            height: 2.0,
            depth: 0.5,
            color: default_color(),
        };
        let m = build_extruded_silhouette(&req).unwrap();
        assert_eq!(m.diagnostics.triangle_count, 12);
        // The four side quads use four vertices each; cap triangles share their own
        // vertices. Verify the indexed topology rather than assuming welded vertices.
        assert_eq!(m.indices.len(), 36);
        assert_eq!(m.vertices.len(), 28);
        assert!((m.diagnostics.bounds_max[2] - m.diagnostics.bounds_min[2] - 0.5).abs() < EPSILON);
    }
    #[test]
    fn rejects_too_low_resolution() {
        let req = HullRequest {
            name: "bad".into(),
            front_contour: square(),
            side_contour: square(),
            top_contour: None,
            width: 3.0,
            height: 2.0,
            depth: 1.0,
            resolution: 4,
            color: default_color(),
        };
        assert!(
            build_visual_hull(&req)
                .unwrap_err()
                .0
                .contains("resolution")
        );
    }
    fn bottle_profile() -> Vec<Point2> {
        vec![
            [0.80, 0.90],
            [0.80, 0.78],
            [0.70, 0.68],
            [0.61, 0.56],
            [0.58, 0.43],
            [0.58, 0.18],
            [0.55, 0.11],
            [0.53, 0.18],
            [0.53, 0.43],
            [0.56, 0.58],
            [0.67, 0.70],
            [0.76, 0.79],
            [0.76, 0.88],
        ]
    }

    #[test]
    fn lathe_profile_builds_a_closed_rotational_mesh() {
        let request = LatheRequest {
            name: "Bottle".into(),
            profile: bottle_profile(),
            diameter: 0.08,
            height: 0.25,
            segments: 32,
            color: default_color(),
        };
        let mesh = build_lathed_profile(&request).unwrap();
        assert!(mesh.diagnostics.triangle_count > request.segments * request.profile.len());
        assert_eq!(mesh.diagnostics.vertex_count, mesh.indices.len());
        assert_eq!(mesh.diagnostics.resolution, 32);
        assert_eq!(mesh.diagnostics.method, "spin / lathe profile");
        assert!((mesh.diagnostics.bounds_min[1] + 0.125).abs() < 1.0e-5);
        assert!((mesh.diagnostics.bounds_max[1] - 0.125).abs() < 1.0e-5);
    }

    #[test]
    fn lathe_profile_rejects_invalid_segments_and_crossing_profile() {
        let mut request = LatheRequest {
            name: "Bottle".into(),
            profile: bottle_profile(),
            diameter: 0.08,
            height: 0.25,
            segments: 8,
            color: default_color(),
        };
        assert!(
            build_lathed_profile(&request)
                .unwrap_err()
                .0
                .contains("segments")
        );
        request.segments = 32;
        request.profile = vec![[0.2, 0.2], [0.8, 0.8], [0.2, 0.8], [0.8, 0.2]];
        assert!(build_lathed_profile(&request).is_err());
    }

    #[test]
    fn serializes_mesh_diagnostics() {
        let req = HullRequest {
            name: "box".into(),
            front_contour: rect(),
            side_contour: rect(),
            top_contour: None,
            width: 3.0,
            height: 2.0,
            depth: 2.0,
            resolution: 8,
            color: default_color(),
        };
        let m = build_visual_hull(&req).unwrap();
        let json = serde_json::to_string(&m).unwrap();
        assert!(json.contains("occupied_voxels"));
        assert!(json.contains("vertices"));
    }
}
