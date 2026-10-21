import { defineEventHandler } from "h3";

export default defineEventHandler(() => ({
  app: "Forge Eye AI Studio",
  mode: process.env.DEEPSEEK_API_KEY ? "server-configured" : "setup-required",
  providers: {
    deepseek: { configured: Boolean(process.env.DEEPSEEK_API_KEY), model: (process.env.DEEPSEEK_MODEL || "deepseek-chat").trim().slice(0, 80) },
    higgsfield: { configured: false, status: "not-connected", message: "لم يتم إعداد تكامل موثق ومصادق عليه لـ Higgsfield." }
  },
  safety: { credentialsServerSideOnly: true, noClientModelDownload: true, viewportTargetFps: 30, pausesWhenHidden: true }
}));