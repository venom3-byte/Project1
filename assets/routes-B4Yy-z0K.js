import { t as require_jsx_runtime } from "./index-l_bXmkWy.js";
//#region src/routes/index.tsx?tsr-split=component
var import_jsx_runtime = require_jsx_runtime();
/**
* Keep the public Forge workbench isolated from the host app bundle.
* This mirrors the Macaly Forge host route and preserves its static ES modules.
*/
function ForgeHost() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		"data-macaly-loc": "src/routes/index.tsx:9:4",
		"data-macaly-name": "main",
		className: "h-screen w-screen overflow-hidden bg-black",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("iframe", {
			"data-macaly-loc": "src/routes/index.tsx:10:6",
			"data-macaly-name": "iframe",
			title: "Forge Studio 3.7",
			src: "forge/index.html",
			className: "h-full w-full border-0",
			allow: "fullscreen; clipboard-read; clipboard-write"
		})
	});
}
//#endregion
export { ForgeHost as component };
