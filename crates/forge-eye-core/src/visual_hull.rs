use crate::geometry::MeshData;
use serde::{Deserialize, Serialize};
use std::fmt::{Display, Formatter};

const MIN_RESOLUTION: u32 = 12;
const MAX_RESOLUTION: u32 = 48;
const MAX_CONTOUR_POINTS: usize = 256;
const MAX_SURFACE_VERTICES: usize = 1_500_000;
const EPSILON: f32 = 1.0e-6;

/// Real-world bounding dimensions for the calibrated reference views.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct VisualHullOptions {
    pub width: f32,
    pub height: f32,
    pub depth: f32,
    #[serde(default = "default_resolution")]
    pub resolution: u32,
}

fn default_resolution() -> u32 {
    24
}

impl Default for VisualHullOptions {
    fn default() -> Self {
        Self {
            width: 3.0,
            height: 2.0,
            depth: 3.0,
            resolution: default_resolution(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VisualHullResult {
    pub mesh: MeshData,
    pub occupied_voxels: usize,
    pub view_count: u32,
    pub resolution: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum VisualHullError {
    TooFewContourPoints,
    TooManyContourPoints,
    InvalidContourPoint,
    ContourOutsideNormalizedBounds,
    DegenerateContour,
    SelfIntersectingContour,
    InvalidDimensions,
    InvalidResolution,
    EmptyIntersection,
    ExcessiveOccupancy,
    MeshTooLarge,
}

impl Display for VisualHullError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::TooFewContourPoints => "Each reference outline needs at least three points.",
            Self::TooManyContourPoints => "An outline may contain at most 256 points.",
            Self::InvalidContourPoint => "Outline coordinates must be finite numbers.",
            Self::ContourOutsideNormalizedBounds => {
                "Outline coordinates must be normalized to the 0–1 image range."
            }
            Self::DegenerateContour => "The outline has no usable area.",
            Self::SelfIntersectingContour => {
                "The outline crosses itself. Fix the crossing points before reconstruction."
            }
            Self::InvalidDimensions => {
                "Reference dimensions must be finite and between 0.01 and 10000 world units."
            }
            Self::InvalidResolution => "Voxel resolution must be between 12 and 48.",
            Self::EmptyIntersection => {
                "The calibrated silhouettes do not intersect. Check orientation and scale."
            }
            Self::ExcessiveOccupancy => {
                "The silhouettes fill nearly the entire reconstruction volume. Refine the outlines."
            }
            Self::MeshTooLarge => {
                "The reconstructed surface exceeds the safe mesh vertex limit. Reduce voxel resolution."
            }
        };
        f.write_str(message)
    }
}

impl std::error::Error for VisualHullError {}

/// Build a watertight voxel-boundary visual hull from calibrated image silhouettes.
///
/// Coordinates are normalized to [0, 1] with the image origin at its top-left.
/// Front maps (X,Y), Side maps (Z,Y), and optional Top maps (X,Z). This is a
/// coarse visual-hull reconstruction, not an estimate of hidden concavities.
pub fn generate_visual_hull_mesh(
    front_contour: &[[f32; 2]],
    side_contour: &[[f32; 2]],
    top_contour: Option<&[[f32; 2]]>,
    options: VisualHullOptions,
) -> Result<VisualHullResult, VisualHullError> {
    validate_contour(front_contour)?;
    validate_contour(side_contour)?;
    if let Some(top) = top_contour {
        validate_contour(top)?;
    }
    for dimension in [options.width, options.height, options.depth] {
        if !dimension.is_finite() || !(0.01..=10_000.0).contains(&dimension) {
            return Err(VisualHullError::InvalidDimensions);
        }
    }
    if !(MIN_RESOLUTION..=MAX_RESOLUTION).contains(&options.resolution) {
        return Err(VisualHullError::InvalidResolution);
    }

    let r = options.resolution as usize;
    let plane = r * r;
    let mut front_mask = vec![0_u8; plane];
    let mut side_mask = vec![0_u8; plane];
    let mut top_mask = top_contour.map(|_| vec![0_u8; plane]);

    for j in 0..r {
        let v = (j as f32 + 0.5) / r as f32;
        for i in 0..r {
            let u = (i as f32 + 0.5) / r as f32;
            let index = j * r + i;
            front_mask[index] = u8::from(point_in_polygon([u, v], front_contour));
            side_mask[index] = u8::from(point_in_polygon([u, v], side_contour));
            if let (Some(top), Some(mask)) = (top_contour, top_mask.as_mut()) {
                mask[index] = u8::from(point_in_polygon([u, v], top));
            }
        }
    }

    let mut occupied = vec![0_u8; plane * r];
    let mut occupied_voxels = 0_usize;
    for k in 0..r {
        for j in 0..r {
            for i in 0..r {
                let index = i + r * (j + r * k);
                let fits_front = front_mask[j * r + i] != 0;
                let fits_side = side_mask[j * r + k] != 0;
                let fits_top = top_mask.as_ref().is_none_or(|mask| mask[k * r + i] != 0);
                if fits_front && fits_side && fits_top {
                    occupied[index] = 1;
                    occupied_voxels += 1;
                }
            }
        }
    }

    let voxel_count = plane * r;
    if occupied_voxels == 0 {
        return Err(VisualHullError::EmptyIntersection);
    }
    if occupied_voxels as f32 > voxel_count as f32 * 0.92 {
        return Err(VisualHullError::ExcessiveOccupancy);
    }

    let dx = options.width / r as f32;
    let dy = options.height / r as f32;
    let dz = options.depth / r as f32;
    let mut positions: Vec<[f32; 3]> = Vec::new();
    let mut normals: Vec<[f32; 3]> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();

    let has = |i: isize, j: isize, k: isize| -> bool {
        if i < 0 || j < 0 || k < 0 || i >= r as isize || j >= r as isize || k >= r as isize {
            return false;
        }
        occupied[i as usize + r * (j as usize + r * k as usize)] != 0
    };

    for k in 0..r {
        for j in 0..r {
            for i in 0..r {
                if !has(i as isize, j as isize, k as isize) {
                    continue;
                }
                let x0 = -options.width / 2.0 + i as f32 * dx;
                let x1 = x0 + dx;
                let y0 = options.height / 2.0 - j as f32 * dy;
                let y1 = y0 - dy;
                let z0 = -options.depth / 2.0 + k as f32 * dz;
                let z1 = z0 + dz;

                if !has(i as isize - 1, j as isize, k as isize) {
                    push_quad(
                        &mut positions,
                        &mut normals,
                        &mut indices,
                        [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]],
                        [-1.0, 0.0, 0.0],
                    )?;
                }
                if !has(i as isize + 1, j as isize, k as isize) {
                    push_quad(
                        &mut positions,
                        &mut normals,
                        &mut indices,
                        [[x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [x1, y0, z0]],
                        [1.0, 0.0, 0.0],
                    )?;
                }
                if !has(i as isize, j as isize - 1, k as isize) {
                    push_quad(
                        &mut positions,
                        &mut normals,
                        &mut indices,
                        [[x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]],
                        [0.0, 1.0, 0.0],
                    )?;
                }
                if !has(i as isize, j as isize + 1, k as isize) {
                    push_quad(
                        &mut positions,
                        &mut normals,
                        &mut indices,
                        [[x1, y1, z1], [x0, y1, z1], [x0, y1, z0], [x1, y1, z0]],
                        [0.0, -1.0, 0.0],
                    )?;
                }
                if !has(i as isize, j as isize, k as isize - 1) {
                    push_quad(
                        &mut positions,
                        &mut normals,
                        &mut indices,
                        [[x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z0]],
                        [0.0, 0.0, -1.0],
                    )?;
                }
                if !has(i as isize, j as isize, k as isize + 1) {
                    push_quad(
                        &mut positions,
                        &mut normals,
                        &mut indices,
                        [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
                        [0.0, 0.0, 1.0],
                    )?;
                }
            }
        }
    }

    Ok(VisualHullResult {
        mesh: MeshData {
            positions,
            normals,
            indices,
        },
        occupied_voxels,
        view_count: if top_contour.is_some() { 3 } else { 2 },
        resolution: options.resolution,
    })
}

fn push_quad(
    positions: &mut Vec<[f32; 3]>,
    normals: &mut Vec<[f32; 3]>,
    indices: &mut Vec<u32>,
    vertices: [[f32; 3]; 4],
    normal: [f32; 3],
) -> Result<(), VisualHullError> {
    if positions.len().saturating_add(4) > MAX_SURFACE_VERTICES {
        return Err(VisualHullError::MeshTooLarge);
    }
    let base = positions.len() as u32;
    positions.extend(vertices);
    normals.extend([normal; 4]);
    indices.extend([base, base + 1, base + 2, base, base + 2, base + 3]);
    Ok(())
}

fn validate_contour(points: &[[f32; 2]]) -> Result<(), VisualHullError> {
    if points.len() < 3 {
        return Err(VisualHullError::TooFewContourPoints);
    }
    if points.len() > MAX_CONTOUR_POINTS {
        return Err(VisualHullError::TooManyContourPoints);
    }
    if points.iter().flatten().any(|value| !value.is_finite()) {
        return Err(VisualHullError::InvalidContourPoint);
    }
    if points
        .iter()
        .flatten()
        .any(|value| !(0.0..=1.0).contains(value))
    {
        return Err(VisualHullError::ContourOutsideNormalizedBounds);
    }
    let mut twice_area = 0.0;
    for index in 0..points.len() {
        let a = points[index];
        let b = points[(index + 1) % points.len()];
        twice_area += a[0] * b[1] - b[0] * a[1];
    }
    if self_intersects(points) {
        return Err(VisualHullError::SelfIntersectingContour);
    }
    if twice_area.abs() < EPSILON {
        return Err(VisualHullError::DegenerateContour);
    }
    Ok(())
}

fn self_intersects(points: &[[f32; 2]]) -> bool {
    let n = points.len();
    for i in 0..n {
        let a = points[i];
        let b = points[(i + 1) % n];
        for j in (i + 1)..n {
            if j == i || j == (i + 1) % n || (j + 1) % n == i {
                continue;
            }
            let c = points[j];
            let d = points[(j + 1) % n];
            if segments_intersect(a, b, c, d) {
                return true;
            }
        }
    }
    false
}

fn orientation(a: [f32; 2], b: [f32; 2], c: [f32; 2]) -> f32 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

fn segments_intersect(a: [f32; 2], b: [f32; 2], c: [f32; 2], d: [f32; 2]) -> bool {
    let (o1, o2, o3, o4) = (
        orientation(a, b, c),
        orientation(a, b, d),
        orientation(c, d, a),
        orientation(c, d, b),
    );
    (o1 > EPSILON && o2 < -EPSILON || o1 < -EPSILON && o2 > EPSILON)
        && (o3 > EPSILON && o4 < -EPSILON || o3 < -EPSILON && o4 > EPSILON)
}

fn point_in_polygon(point: [f32; 2], polygon: &[[f32; 2]]) -> bool {
    let (x, y) = (point[0], point[1]);
    let mut inside = false;
    let mut previous = polygon[polygon.len() - 1];
    for current in polygon {
        let crossing = (current[1] > y) != (previous[1] > y)
            && x < (previous[0] - current[0]) * (y - current[1]) / (previous[1] - current[1])
                + current[0];
        if crossing {
            inside = !inside;
        }
        previous = *current;
    }
    inside
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square(min: f32, max: f32) -> Vec<[f32; 2]> {
        vec![[min, min], [max, min], [max, max], [min, max]]
    }

    #[test]
    fn two_view_hull_creates_a_valid_mesh() {
        let result = generate_visual_hull_mesh(
            &square(0.1, 0.9),
            &square(0.1, 0.9),
            None,
            VisualHullOptions {
                width: 3.0,
                height: 2.0,
                depth: 4.0,
                resolution: 16,
            },
        )
        .unwrap();
        assert!(result.occupied_voxels > 0);
        assert_eq!(result.view_count, 2);
        assert_eq!(result.mesh.positions.len(), result.mesh.normals.len());
        assert!(!result.mesh.indices.is_empty());
        assert_eq!(result.mesh.indices.len() % 3, 0);
        assert!(
            result
                .mesh
                .positions
                .iter()
                .flatten()
                .all(|x| x.is_finite())
        );
        assert!(result.mesh.normals.iter().flatten().all(|x| x.is_finite()));
        assert!(
            result
                .mesh
                .indices
                .iter()
                .all(|i| (*i as usize) < result.mesh.positions.len())
        );
    }

    #[test]
    fn top_silhouette_tightens_the_volume() {
        let front = square(0.05, 0.95);
        let side = square(0.05, 0.95);
        let wide_top = square(0.1, 0.9);
        let narrow_top = square(0.35, 0.65);
        let options = VisualHullOptions {
            width: 3.0,
            height: 2.0,
            depth: 3.0,
            resolution: 24,
        };
        let wide = generate_visual_hull_mesh(&front, &side, Some(&wide_top), options).unwrap();
        let narrow = generate_visual_hull_mesh(&front, &side, Some(&narrow_top), options).unwrap();
        assert!(narrow.occupied_voxels < wide.occupied_voxels);
        assert_eq!(narrow.view_count, 3);
    }

    #[test]
    fn rejects_self_intersecting_outlines() {
        let bowtie = vec![[0.1, 0.1], [0.9, 0.9], [0.1, 0.9], [0.9, 0.1]];
        assert_eq!(
            generate_visual_hull_mesh(
                &bowtie,
                &square(0.1, 0.9),
                None,
                VisualHullOptions::default()
            )
            .unwrap_err(),
            VisualHullError::SelfIntersectingContour
        );
    }

    #[test]
    fn rejects_invalid_resolution_and_dimensions() {
        let contour = square(0.1, 0.9);
        let options = VisualHullOptions {
            resolution: 8,
            ..VisualHullOptions::default()
        };
        assert_eq!(
            generate_visual_hull_mesh(&contour, &contour, None, options).unwrap_err(),
            VisualHullError::InvalidResolution
        );
        let options = VisualHullOptions {
            resolution: 16,
            width: f32::INFINITY,
            ..VisualHullOptions::default()
        };
        assert_eq!(
            generate_visual_hull_mesh(&contour, &contour, None, options).unwrap_err(),
            VisualHullError::InvalidDimensions
        );
    }
}
