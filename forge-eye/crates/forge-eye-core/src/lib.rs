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
use std::error::Error;
use std::fmt::{Display, Formatter};

const EPSILON: f32 = 1.0e-6;
const MAX_CONTOUR_POINTS: usize = 512;
const MIN_RESOLUTION: usize = 8;
const MAX_RESOLUTION: usize = 64;

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
    pub bounds_max: Point3,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HullRequ
…[1 chars truncated — re-run with head/grep/tail for full output]…
tween {MIN_RESOLUTION} and {MAX_RESOLUTION}."
        )));
    }
    validate_contour(&request.front_contour)?;
    validate_contour(&request.side_contour)?;
    if let Some(top) = &request.top_contour {
        validate_contour(top)?;
    }
    validate_color(request.color)?;

    let r = request.resolution;
    let slice = r * r;
    let mut front_mask = vec![false; slice];
    let mut side_mask = vec![false; slice];
    let mut top_mask = request.top_contour.as_ref().map(|_| vec![false; slice]);

    for y in 0..r {
        for x in 0..r {
            let point = [(x as f32 + 0.5) / r as f32, (y as f32 + 0.5) / r as f32];
            front_mask[y * r + x] = point_in_polygon(point, &request.front_contour);
            side_mask[y * r + x] = point_in_polygon(point, &request.side_contour);
            if let (Some(contour), Some(mask)) = (&request.top_contour, &mut top_mask) {
                mask[y * r + x] = point_in_polygon(point, contour);
            }
        }
    }

    let volume = slice * r;
    let mut occupied = vec![false; volume];
    let mut occupied_count = 0usize;
    for z in 0..r {
        for y in 0..r {
            for x in 0..r {
                let at = x + r * (y + r * z);
                let passes_front = front_mask[y * r + x];
                let passes_side = side_mask[y * r + z];
                let passes_top = top_mask.as_ref().is_none_or(|mask| mask[z * r + x]);
                if passes_front && passes_side && passes_top {
                    occupied[at] = true;
                    occupied_count += 1;
                }
            }
        }
    }
    if occupied_count == 0 {
        return Err(error(
            "The calibrated silhouettes have no shared volume. Check axis orientation, scale, and traced contours.",
        ));
    }

    let mut mesh = MeshData {
        name: if request.name.trim().is_empty() {
            "Forge Eye Visual Hull".to_owned()
        } else {
            request.name.clone()
        },
        vertices: Vec::new(),
        normals: Vec::new(),
        indices: Vec::new(),
        color: request.color,
        diagnostics: MeshDiagnostics {
            method: if top_mask.is_some() {
                "three-view voxel visual hull".into()
            } else {
                "two-view voxel visual hull".into()
            },
            view_count: if top_mask.is_some() { 3 } else { 2 },
            resolution: r,
            occupied_voxels: occupied_count,
            ..Default::default()
        },
    };

    let step_x = request.width / r as f32;
    let step_y = request.height / r as f32;
    let step_z = request.depth / r as f32;
    let is_filled = |x: isize, y: isize, z: isize| -> bool {
        if x < 0 || y < 0 || z < 0 || x >= r as isize || y >= r as isize || z >= r as isize {
            return false;
        }
        occupied[x as usize + r * (y as usize + r * z as usize)]
    };
    for z in 0..r {
        for y in 0..r {
            for x in 0..r {
                if !occupied[x + r * (y + r * z)] {
                    continue;
                }
                let x0 = x as f32 * step_x - request.width / 2.0;
                let x1 = x0 + step_x;
                let y1 = request.height / 2.0 - y as f32 * step_y;
                let y0 = y1 - step_y;
                let z0 = z as f32 * step_z - request.depth / 2.0;
                let z1 = z0 + step_z;
                if !is_filled(x as isize - 1, y as isize, z as isize) {
                    push_quad(
                        &mut mesh,
                        [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
                        [-1.0, 0.0, 0.0],
                    )?;
                }
                if !is_filled(x as isize + 1, y as isize, z as isize) {
                    push_quad(
                        &mut mesh,
                        [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
                        [1.0, 0.0, 0.0],
                    )?;
                }
                if !is_filled(x as isize, y as isize - 1, z as isize) {
                    push_quad(
                        &mut mesh,
                        [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
                        [0.0, -1.0, 0.0],
                    )?;
                }
                if !is_filled(x as isize, y as isize + 1, z as isize) {
                    push_quad(
                        &mut mesh,
                        [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
                        [0.0, 1.0, 0.0],
                    )?;
                }
                if !is_filled(x as isize, y as isize, z as isize - 1) {
                    push_quad(
                        &mut mesh,
                        [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
                        [0.0, 0.0, -1.0],
                    )?;
                }
                if !is_filled(x as isize, y as isize, z as isize + 1) {
                    push_quad(
                        &mut mesh,
                        [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
                        [0.0, 0.0, 1.0],
                    )?;
                }
            }
        }
    }
    finish_diagnostics(&mut mesh);
    Ok(mesh)
}

/// Extrudes a traced image contour along the normal of a front/side/top plane.
pub fn build_extruded_silhouette(request: &ExtrusionRequest) -> Result<MeshData, GeometryError> {
    validate_dimensions(request.width, request.height, request.depth)?;
    validate_contour(&request.contour)?;
    validate_color(request.color)?;
    let triangles = triangulate_contour(&request.contour)?;
    let mut mesh = MeshData {
        name: if request.name.trim().is_empty() {
            "Forge Eye Silhouette".to_owned()
        } else {
            request.name.clone()
        },
        vertices: Vec::new(),
        normals: Vec::new(),
        indices: Vec::new(),
        color: request.color,
        diagnostics: MeshDiagnostics {
            method: "extruded image silhouette".into(),
            view_count: 1,
            ..Default::default()
        },
    };
    let half = match request.axis {
        ProjectionAxis::Front => request.depth / 2.0,
        ProjectionAxis::Side => request.width / 2.0,
        ProjectionAxis::Top => request.height / 2.0,
    };
    let map = |p: Point2, normal: f32| -> Point3 {
        let u = p[0];
        let v = p[1];
        match request.axis {
            ProjectionAxis::Front => [
                (u - 0.5) * request.width,
                (0.5 - v) * request.height,
                normal,
            ],
            ProjectionAxis::Side => [
                normal,
                (0.5 - v) * request.height,
                (u - 0.5) * request.depth,
            ],
            ProjectionAxis::Top => [(u - 0.5) * request.width, normal, (v - 0.5) * request.depth],
        }
    };
    // Polygon caps are triangulated from the source outline; side walls connect
    // matching points on front/back contours, preserving the traced silhouette.
    let normal_axis = match request.axis {
        ProjectionAxis::Front => 2,
        ProjectionAxis::Side => 0,
        ProjectionAxis::Top => 1,
    };
    let mut cap_normal = [0.0, 0.0, 0.0];
    cap_normal[normal_axis] = 1.0;
    let mut back_normal = cap_normal;
    back_normal[normal_axis] = -1.0;
    let front: Vec<Point3> = request.contour.iter().map(|p| map(*p, half)).collect();
    let back: Vec<Point3> = request.contour.iter().map(|p| map(*p, -half)).collect();
    for t in &triangles {
        push_triangle(
            &mut mesh,
            [
                front[t[0] as usize],
                front[t[1] as usize],
                front[t[2] as usize],
            ],
            cap_normal,
        )?;
        push_triangle(
            &mut mesh,
            [
                back[t[0] as usize],
                back[t[2] as usize],
                back[t[1] as usize],
            ],
            back_normal,
        )?;
    }
    for i in 0..request.contour.len() {
        let j = (i + 1) % request.contour.len();
        let a = front[i];
        let b = front[j];
        let c = back[j];
        let d = back[i];
        // Per-face normals are computed from the actual wall, which preserves
        // the winding even for silhouettes that are not aligned to an axis.
        push_flat_quad(&mut mesh, [a, b, c, d])?;
    }
    finish_diagnostics(&mut mesh);
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
