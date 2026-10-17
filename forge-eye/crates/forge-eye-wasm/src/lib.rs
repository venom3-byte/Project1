use forge_eye_core::{build_extruded_silhouette, build_visual_hull, ExtrusionRequest, HullRequest};
use wasm_bindgen::prelude::*;
use forge_eye_core::EditorSession;

/// Stateful, deterministic command session shared by the browser and native hosts.
#[wasm_bindgen]
pub struct ForgeEyeSession {
    inner: EditorSession,
}

#[wasm_bindgen]
impl ForgeEyeSession {
    #[wasm_bindgen(constructor)]
    pub fn new() -> ForgeEyeSession {
        ForgeEyeSession { inner: EditorSession::new() }
    }

    /// Executes one validated JSON editor command and returns { result, scene, history }.
    pub fn execute_json(&mut self, command_json: &str) -> Result<String, JsValue> {
        self.inner.execute_json(command_json).map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Returns the serializable current scene.
    pub fn scene_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.inner.scene).map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Restores a versioned scene after validating IDs, transforms, materials, keys, and mesh indices.
    pub fn load_scene_json(&mut self, scene_json: &str) -> Result<(), JsValue> {
        self.inner.load_scene_json(scene_json).map_err(|error| JsValue::from_str(&error.to_string()))
    }

    pub fn undo_json(&mut self) -> Result<String, JsValue> {
        self.inner.undo().map_err(|error| JsValue::from_str(&error.to_string()))?;
        self.scene_json()
    }

    pub fn redo_json(&mut self) -> Result<String, JsValue> {
        self.inner.redo().map_err(|error| JsValue::from_str(&error.to_string()))?;
        self.scene_json()
    }

    pub fn can_undo(&self) -> bool { self.inner.can_undo() }
    pub fn can_redo(&self) -> bool { self.inner.can_redo() }
}


#[wasm_bindgen]
pub fn engine_version() -> String {
    format!("Forge Eye Rust Core {}", env!("CARGO_PKG_VERSION"))
}

#[wasm_bindgen]
pub fn build_visual_hull_json(request_json: &str) -> Result<String, JsValue> {
    let request: HullRequest = serde_json::from_str(request_json)
        .map_err(|err| JsValue::from_str(&format!("Invalid visual-hull request: {err}")))?;
    let mesh = build_visual_hull(&request)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    serde_json::to_string(&mesh)
        .map_err(|err| JsValue::from_str(&format!("Could not serialize generated mesh: {err}")))
}

#[wasm_bindgen]
pub fn build_extruded_silhouette_json(request_json: &str) -> Result<String, JsValue> {
    let request: ExtrusionRequest = serde_json::from_str(request_json)
        .map_err(|err| JsValue::from_str(&format!("Invalid silhouette-extrusion request: {err}")))?;
    let mesh = build_extruded_silhouette(&request)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    serde_json::to_string(&mesh)
        .map_err(|err| JsValue::from_str(&format!("Could not serialize generated mesh: {err}")))
}

#[wasm_bindgen]
pub fn validate_contour_json(contour_json: &str) -> Result<String, JsValue> {
    let contour: Vec<[f32; 2]> = serde_json::from_str(contour_json)
        .map_err(|err| JsValue::from_str(&format!("Invalid contour JSON: {err}")))?;
    let triangles = forge_eye_core::triangulate_contour(&contour)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    serde_json::to_string(&triangles)
        .map_err(|err| JsValue::from_str(&format!("Could not serialize contour triangulation: {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_rejects_malformed_json() {
        assert!(build_visual_hull_json("{broken").is_err());
    }
    #[test]
    fn bridge_returns_serialized_mesh_for_valid_request() {
        let request = r#"{"name":"test","front_contour":[[0.1,0.1],[0.9,0.1],[0.9,0.9],[0.1,0.9]],"side_contour":[[0.1,0.1],[0.9,0.1],[0.9,0.9],[0.1,0.9]],"width":2.0,"height":1.0,"depth":1.0,"resolution":8}"#;
        let value = build_visual_hull_json(request).unwrap();
        assert!(value.contains("occupied_voxels"));
    }
}