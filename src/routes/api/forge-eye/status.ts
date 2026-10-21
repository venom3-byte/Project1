import { createFileRoute } from "@tanstack/react-router";
import { getForgeEyeStatusResponse } from "../../../lib/forge-eye-api";

export const Route = createFileRoute("/api/forge-eye/status")({
  server: {
    handlers: {
      GET: async () => getForgeEyeStatusResponse()
    }
  }
});
