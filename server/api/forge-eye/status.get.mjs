import { defineEventHandler } from "h3";

export default defineEventHandler(() => {
  const deepseekConfigured = Boolean(process.env.DEEPSEEK_API_KEY);
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY);
  return {
    app: "Forge Eye AI Studio",
    mode: deepseekConfigured || geminiConfigured ? "server-configured" : "setup-required",
    providers: {
      gemini: { configured: geminiConfigured, model: "gemini-3.8-flash" },
      deepseek: { configured: deepseekConfigured, model: (process.env.DEEPSEEK_MODEL || "deepseek-chat").trim().slice(0, 80) },
      higgsfield: { configured: false, status: "not-connected", message: "لم يتم إعداد تكامل موثق ومصادق عليه لـ Higgsfield." }
    },
    safety: { credentialsServerSideOnly: true, noClientModelDownload: true, viewportTargetFps: 30, pausesWhenHidden: true }
  };
});
