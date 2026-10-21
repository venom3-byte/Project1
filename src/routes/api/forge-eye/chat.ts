import { createFileRoute } from "@tanstack/react-router";
import { handleForgeEyeChatRequest } from "../../../lib/forge-eye-api";

export const Route = createFileRoute("/api/forge-eye/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => handleForgeEyeChatRequest(request, "deepseek")
    }
  }
});
