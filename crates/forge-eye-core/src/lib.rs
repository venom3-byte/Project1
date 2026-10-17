//! Forge Eye portable geometry kernel.
//! UI/rendering stays in the browser for now; this crate isolates deterministic
//! geometry algorithms so native tests and a future WebAssembly bridge share code.

use std::f32::consts::TAU;

#[derive(Debug, Clone, PartialEq)]
pub enum GeometryError {
    InvalidProfile(&'static str),
    InvalidContour(&'static str),
    InvalidDimensions,
    InvalidResolution,
    EmptyVisualHull,
    EmptyMesh,
}

impl std::fmt::Display for GeometryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidProfile(s) => write!(f, "invalid profile: {s}"),
            Self::InvalidContour(s) => write!(f, "invalid contour: {s}"),
            Self::InvalidDimensions => write!(f, "dimensions must be finite and positive"),
            Self::InvalidResolution => write!(f, "resolution must be between 12 and 64"),
            Self::EmptyVisualHull => write!(f, "the supplied silhouettes do not intersect"),
            Self::EmptyMesh => write!(f, "the reconstruction produced no faces"),
        }
    }
}
impl std::error::Error for GeometryError {}

#[derive(Debug, Clone, Default)]
pub struct TriangleMesh {
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub indices: Vec<u32>,
}
impl TriangleMesh {
    pub fn vertex_count(&self) -> usize { self.positions.len() }
    pub fn triangle_count(&self) -> usize { self.indices.len() / 3 }
    pub fn is_valid(&self) -> bool {
        !self.positions.is_empty()
            && !self.indices.is_empty()
            && self.indices.iter().all(|&i| (i as usize) < self.positions.len())
            && self.positions.iter().flatten().all(|v| v.is_finite())
            && self.normals.iter().flatten().all(|v| v.is_finite())
            && self.normals.len() == self.positions.len()
            && self.indices.len() % 3 == 0
    }
}

#[derive(Debug, Clone, Copy)]
pub struct LatheOptions {
    pub diameter: f32,
    pub height: f32,
    pub segments: usize,
    pub smoothing: usize,
}
impl Default for LatheOptions {
    fn default() -> Self {
        Self { diameter: 0.08, height: 0.25, segments: 48, smoothing: 1 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReferenceView { Front, Side, Top, Oblique }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReconstructionIntent { Auto, Rotational, SilhouetteBlockout, FullVolume }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReconstructionStrategy {
    SpinLathe,
    ExtrudedSilhouetteBlockout,
    MultiViewVisualHull { view_count: u8 },
    NeedMoreViews,
    NeedAUsableContour,
}

/// Route using observed evidence. This is a conservative heuristic, not an AI classifier.
pub fn choose_reconstruction_strategy(
    intent: ReconstructionIntent,
    views: &[ReferenceView],
    contour_available: bool,
    rotational_symmetry: f32,
) -> ReconstructionStrategy {
    if !contour_available { return ReconstructionStrategy::NeedAUsableContour; }
    let front = views.contains(&ReferenceView::Front);
    let side = views.contains(&ReferenceView::Side);
    let top = views.contains(&ReferenceView::Top);
    let view_count = (front as u8) + (side as u8) + (top as u8);

    if intent == ReconstructionIntent::Rotational && front && rotational_symmetry >= 0.58 {
        return ReconstructionStrategy::SpinLathe;
    }
    if intent == ReconstructionIntent::Auto && front && rotational_symmetry >= 0.82 {
        return ReconstructionStrategy::SpinLathe;
    }
    if view_count >= 2 {
        return ReconstructionStrategy::MultiViewVisualHull { view_count };
    }
    match intent {
        ReconstructionIntent::FullVolume => ReconstructionStrategy::NeedMoreViews,
        ReconstructionIntent::Rotational if !front || rotational_symmetry < 0.58 =>
            ReconstructionStrategy::NeedMoreViews,
        ReconstructionIntent::Auto | ReconstructionIntent::SilhouetteBlockout =>
            ReconstructionStrategy::ExtrudedSilhouetteBlockout,
        ReconstructionIntent::Rotational => ReconstructionStrategy::NeedMoreViews,
    }
}

fn smooth_open_profile(points: &[[f32; 2]], levels: usize) -> Vec<[f32; 2]> {
    let mut out = points.to_vec();
    for _ in 0..levels.min(3) {
        let mut next = Vec::with_capacity(out.len() * 2);
        next.push(out[0]);
        for pair in out.windows(2) {
            let a = pair[0];
            let b = pair[1];
            next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
            next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
        }
        next.push(*out.last().unwrap());
        out = next;
    }
    out
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
}
fn normalize(v: [f32; 3]) -> [f32; 3] {
    let n = (v[0]*v[0] + v[1]*v[1] + v[2]*v[2]).sqrt();
    if n < 1e-12 { [0.0, 1.0, 0.0] } else { [v[0]/n, v[1]/n, v[2]/n] }
}
fn compute_normals(positions: &[[f32; 3]], indices: &[u32]) -> Vec<[f32; 3]> {
    let mut normals = vec![[0.0; 3]; positions.len()];
    for tri in indices.chunks_exact(3) {
        let a = positions[tri[0] as usize];
        let b = positions[tri[1] as usize];
        let c = positions[tri[2] as usize];
        let ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
        let ac = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
        let n = cross(ab, ac);
        for &id in tri {
            let v = &mut normals[id as usize];
            v[0] += n[0]; v[1] += n[1]; v[2] += n[2];
        }
    }
    normals.into_iter().map(normalize).collect()
}

/// Revolve a traced 2-D half-profile around the Y axis.
/// Input points are normalized image coordinates; x=0.5 is the spin axis.
/// A hollow bottle profile should trace the exterior, rim, interior wall and base return.
pub fn build_lathe_mesh(
    profile: &[[f32; 2]],
    options: LatheOptions,
) -> Result<TriangleMesh, GeometryError> {
    if profile.len() < 3 || profile.len() > 256 {
        return Err(GeometryError::InvalidProfile("requires 3 to 256 source points"));
    }
    if profile.iter().flatten().any(|v| !v.is_finite() || *v < 0.0 || *v > 1.0) {
        return Err(GeometryError::InvalidProfile("points must be finite normalized image coordinates"));
    }
    if !options.diameter.is_finite() || !options.height.is_finite()
        || options.diameter <= 0.0 || options.height <= 0.0 {
        return Err(GeometryError::InvalidDimensions);
    }
    if !(12..=128).contains(&options.segments) {
        return Err(GeometryError::InvalidProfile("radial segments must be between 12 and 128"));
    }
    for pair in profile.windows(2) {
        if (pair[0][0]-pair[1][0]).hypot(pair[0][1]-pair[1][1]) < 0.002 {
            return Err(GeometryError::InvalidProfile("consecutive points are almost identical"));
        }
    }
    let points = smooth_open_profile(profile, options.smoothing);
    let radial_extent = points.iter().map(|p| (p[0]-0.5).abs()).fold(0.0_f32, f32::max);
    let y_min = points.iter().map(|p| p[1]).fold(f32::INFINITY, f32::min);
    let y_max = points.iter().map(|p| p[1]).fold(f32::NEG_INFINITY, f32::max);
    if radial_extent < 0.015 { return Err(GeometryError::InvalidProfile("profile is too close to spin axis")); }
    if y_max-y_min < 0.05 { return Err(GeometryError::InvalidProfile("profile height is too small")); }

    let seg = options.segments;
    let mut positions = Vec::with_capacity(points.len() * seg);
    for p in &points {
        let radius = (p[0]-0.5).abs() / radial_extent * (options.diameter * 0.5);
        let y = ((y_max-p[1]) / (y_max-y_min)) * options.height - options.height*0.5;
        for j in 0..seg {
            let angle = j as f32 / seg as f32 * TAU;
            positions.push([angle.cos()*radius, y, angle.sin()*radius]);
        }
    }
    let mut indices = Vec::with_capacity(points.len() * seg * 6);
    for i in 0..points.len() {
        let next = (i+1) % points.len();
        let radius_a = (points[i][0]-0.5).abs()/radial_extent*(options.diameter*0.5);
        let radius_b = (points[next][0]-0.5).abs()/radial_extent*(options.diameter*0.5);
        if radius_a < 1e-6 && radius_b < 1e-6 { continue; }
        for j in 0..seg {
            let n=(j+1)%seg;
            let a=(i*seg+j) as u32; let b=(i*seg+n) as u32;
            let c=(next*seg+j) as u32; let d=(next*seg+n) as u32;
            if radius_a < 1e-6 { indices.extend([a,c,d]); }
            else if radius_b < 1e-6 { indices.extend([a,c,b]); }
            else { indices.extend([a,c,b,b,c,d]); }
        }
    }
    if indices.len() < seg*3 { return Err(GeometryError::EmptyMesh); }
    let normals = compute_normals(&positions, &indices);
    Ok(TriangleMesh { positions, normals, indices })
}

#[derive(Debug, Clone, Copy)]
pub struct VolumeDimensions { pub width: f32, pub height: f32, pub depth: f32 }
fn valid_contour(contour: &[[f32; 2]]) -> bool {
    contour.len() >= 3
        && contour.iter().flatten().all(|v| v.is_finite() && *v >= 0.0 && *v <= 1.0)
        && contour.windows(2).all(|p| (p[0][0]-p[1][0]).hypot(p[0][1]-p[1][1]) > 1e-5)
}
fn point_in_contour(point: [f32; 2], contour: &[[f32; 2]]) -> bool {
    let (x,y)=(point[0],point[1]); let mut inside=false; let mut j=contour.len()-1;
    for i in 0..contour.len() {
        let (ax,ay)=(contour[i][0],contour[i][1]); let (bx,by)=(contour[j][0],contour[j][1]);
        if (ay>y)!=(by>y) && x < (bx-ax)*(y-ay)/(by-ay+1e-15)+ax { inside=!inside; }
        j=i;
    }
    inside
}
/// Intersect calibrated front, side and optional top silhouettes into a voxel grid.
pub fn intersect_visual_hull(
    front: &[[f32; 2]], side: &[[f32; 2]], top: Option<&[[f32; 2]]>, resolution: usize,
) -> Result<Vec<u8>, GeometryError> {
    if !valid_contour(front) || !valid_contour(side) || top.map_or(false, |c| !valid_contour(c)) {
        return Err(GeometryError::InvalidContour("use valid normalized closed polygons"));
    }
    if !(12..=64).contains(&resolution) { return Err(GeometryError::InvalidResolution); }
    let r=resolution; let slice=r*r;
    let mut front_mask=vec![false;slice]; let mut side_mask=vec![false;slice];
    let mut top_mask=top.map(|_| vec![false;slice]);
    for j in 0..r { for i in 0..r {
        let u=(i as f32+0.5)/r as f32; let v=(j as f32+0.5)/r as f32;
        front_mask[j*r+i]=point_in_contour([u,v],front);
        side_mask[j*r+i]=point_in_contour([u,v],side);
        if let (Some(contour),Some(mask))=(top,top_mask.as_mut()) { mask[j*r+i]=point_in_contour([u,v],contour); }
    }}
    let mut occupied=vec![0u8;slice*r]; let mut count=0usize;
    for k in 0..r { for j in 0..r { for i in 0..r {
        let idx=i+r*(j+r*k);
        let accepts_top=match top_mask.as_ref(){Some(mask)=>mask[k*r+i],None=>true};
        if front_mask[j*r+i] && side_mask[j*r+k] && accepts_top { occupied[idx]=1; count+=1; }
    }}}
    if count==0 { return Err(GeometryError::EmptyVisualHull); }
    Ok(occupied)
}
fn push_quad(mesh: &mut TriangleMesh, vertices: [[f32;3];4], normal: [f32;3]) {
    let base=mesh.positions.len() as u32;
    mesh.positions.extend(vertices);
    mesh.normals.extend([normal;4]);
    mesh.indices.extend([base,base+1,base+2,base,base+2,base+3]);
}
/// Polygonize an occupancy grid by emitting only faces exposed to empty voxels.
pub fn build_visual_hull_mesh(
    occupancy: &[u8], resolution: usize, dimensions: VolumeDimensions,
) -> Result<TriangleMesh, GeometryError> {
    if !(12..=64).contains(&resolution) { return Err(GeometryError::InvalidResolution); }
    if !dimensions.width.is_finite() || !dimensions.height.is_finite() || !dimensions.depth.is_finite()
        || dimensions.width<=0.0 || dimensions.height<=0.0 || dimensions.depth<=0.0 {
        return Err(GeometryError::InvalidDimensions);
    }
    let r=resolution; if occupancy.len()!=r*r*r { return Err(GeometryError::EmptyVisualHull); }
    let has=|i:isize,j:isize,k:isize| -> bool {
        i>=0&&j>=0&&k>=0&&i<r as isize&&j<r as isize&&k<r as isize
            && occupancy[i as usize+r*(j as usize+r*k as usize)]!=0
    };
    let dx=dimensions.width/r as f32; let dy=dimensions.height/r as f32; let dz=dimensions.depth/r as f32;
    let mut mesh=TriangleMesh::default();
    for k in 0..r { for j in 0..r { for i in 0..r {
        if !has(i as isize,j as isize,k as isize) { continue; }
        let x0=-dimensions.width*0.5+i as f32*dx; let x1=x0+dx;
        let y0=dimensions.height*0.5-j as f32*dy; let y1=y0-dy;
        let z0=-dimensions.depth*0.5+k as f32*dz; let z1=z0+dz;
        if !has(i as isize-1,j as isize,k as isize) { push_quad(&mut mesh,[[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]],[-1.,0.,0.]); }
        if !has(i as isize+1,j as isize,k as isize) { push_quad(&mut mesh,[[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]],[1.,0.,0.]); }
        if !has(i as isize,j as isize-1,k as isize) { push_quad(&mut mesh,[[x0,y0,z1],[x0,y0,z0],[x1,y0,z0],[x1,y0,z1]],[0.,1.,0.]); }
        if !has(i as isize,j as isize+1,k as isize) { push_quad(&mut mesh,[[x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0]],[0.,-1.,0.]); }
        if !has(i as isize,j as isize,k as isize-1) { push_quad(&mut mesh,[[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]],[0.,0.,-1.]); }
        if !has(i as isize,j as isize,k as isize+1) { push_quad(&mut mesh,[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],[0.,0.,1.]); }
    }}}
    if mesh.indices.is_empty() { return Err(GeometryError::EmptyMesh); }
    Ok(mesh)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn bottle_profile() -> Vec<[f32;2]> {
        vec![[0.50,0.95],[0.90,0.95],[0.90,0.75],[0.78,0.60],[0.66,0.45],
             [0.64,0.20],[0.64,0.10],[0.56,0.10],[0.56,0.22],[0.60,0.46],
             [0.73,0.65],[0.74,0.82],[0.50,0.92]]
    }
    fn square() -> Vec<[f32;2]> { vec![[0.1,0.1],[0.9,0.1],[0.9,0.9],[0.1,0.9]] }

    #[test]
    fn lathe_mesh_is_deterministic_and_smoothed() {
        let p=bottle_profile();
        let mesh=build_lathe_mesh(&p,LatheOptions{diameter:0.08,height:0.25,segments:32,smoothing:1}).unwrap();
        assert_eq!(mesh.vertex_count(),26*32);
        assert_eq!(mesh.normals.len(),mesh.positions.len());
        assert!(mesh.triangle_count()>600);
        assert!(mesh.is_valid());
    }
    #[test]
    fn smooth_profile_preserves_endpoints() {
        let p=bottle_profile();let out=smooth_open_profile(&p,2);
        assert_eq!(out.len(),(p.len()-1)*4+2);
        assert_eq!(out[0],p[0]);assert_eq!(*out.last().unwrap(),*p.last().unwrap());
    }
    #[test]
    fn strategy_picker_respects_available_evidence() {
        assert_eq!(choose_reconstruction_strategy(ReconstructionIntent::Auto,&[ReferenceView::Front],true,0.92),ReconstructionStrategy::SpinLathe);
        assert_eq!(choose_reconstruction_strategy(ReconstructionIntent::Auto,&[ReferenceView::Front],true,0.42),ReconstructionStrategy::ExtrudedSilhouetteBlockout);
        assert_eq!(choose_reconstruction_strategy(ReconstructionIntent::Auto,&[ReferenceView::Front,ReferenceView::Side],true,0.42),ReconstructionStrategy::MultiViewVisualHull{view_count:2});
        assert_eq!(choose_reconstruction_strategy(ReconstructionIntent::FullVolume,&[ReferenceView::Front],true,0.42),ReconstructionStrategy::NeedMoreViews);
        assert_eq!(choose_reconstruction_strategy(ReconstructionIntent::Auto,&[ReferenceView::Front],false,0.95),ReconstructionStrategy::NeedAUsableContour);
    }
    #[test]
    fn three_view_hull_is_tighter_than_two_view() {
        let broad=square();let narrow=vec![[0.25,0.1],[0.75,0.1],[0.75,0.9],[0.25,0.9]];
        let a=intersect_visual_hull(&broad,&broad,None,16).unwrap();
        let b=intersect_visual_hull(&broad,&broad,Some(&narrow),16).unwrap();
        assert!(a.iter().map(|v|*v as usize).sum::<usize>()>b.iter().map(|v|*v as usize).sum::<usize>());
        let mesh=build_visual_hull_mesh(&b,16,VolumeDimensions{width:2.,height:2.,depth:1.}).unwrap();
        assert!(mesh.is_valid());
    }
}
