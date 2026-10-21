import { defineEventHandler, readBody, setResponseStatus } from "h3";

const SYSTEM_PROMPT = [
  "You are Forge Eye, a precise senior 3D modeling and game-development engineer.",
  "Specialize in Blender, Three.js, topology, PBR materials, UVs, rigging, animation, asset pipelines, visual QA, and mobile performance.",
  "Reply in the user's language and prefer Arabic when the user writes Arabic.",
  "Separate verified facts from assumptions. Never claim you created, imported, tested, edited, or inspected an asset unless a connected tool result proves it.",
  "For modeling requests, give practical geometry, proportion, material, topology, reference, and validation details; avoid fake certainty and generic placeholders.",
  "This chat endpoint does not itself control Blender or Higgsfield. Do not claim external tool control without an actual tool result.",
  "Be actionable and consider low-power mobile hardware."
].join(" ");

export default defineEventHandler(async (event) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    setResponseStatus(event, 503);
    return { code: "AI_NOT_CONFIGURED", message: "لم يُضبط مفتاح DeepSeek على الخادم. أضف DEEPSEEK_API_KEY إلى أسرار الاستضافة، ولا تضعه في ملفات الواجهة أو GitHub." };
  }
  let body;
  try { body = await readBody(event); } catch {
    setResponseStatus(event, 400);
    return { code: "INVALID_JSON", message: "تعذر قراءة نص الرسالة." };
  }
  if (!body || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 16) {
    setResponseStatus(event, 400);
    return { code: "INVALID_MESSAGES", message: "أرسل من رسالة واحدة إلى 16 رسالة." };
  }
  const messages = [];
  let totalChars = 0;
  for (const item of body.messages) {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string") {
      setResponseStatus(event, 400);
      return { code: "INVALID_MESSAGE", message: "صيغة إحدى الرسائل غير صالحة." };
    }
    const content = item.content.trim();
    if (!content || content.length > 8000) {
      setResponseStatus(event, 400);
      return { code: "MESSAGE_LIMIT", message: "يجب أن تكون الرسالة بين حرف واحد و8000 حرف." };
    }
    totalChars += content.length;
    if (totalChars > 24000) {
      setResponseStatus(event, 413);
      return { code: "CONTEXT_LIMIT", message: "حجم المحادثة أكبر من الحد المسموح." };
    }
    messages.push({ role: item.role, content });
  }
  const model = (process.env.DEEPSEEK_MODEL || "deepseek-chat").trim().slice(0, 80);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages], stream: false, temperature: 0.35, max_tokens: 1800 }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setResponseStatus(event, 502);
      const auth = response.status === 401 || response.status === 403;
      return { code: auth ? "PROVIDER_AUTH_FAILED" : "PROVIDER_REQUEST_FAILED", message: auth ? "رفض DeepSeek بيانات الاعتماد؛ تحقق من DEEPSEEK_API_KEY في أسرار الخادم." : "تعذر إكمال طلب DeepSeek؛ تحقق من صلاحية API والرصيد والشبكة." };
    }
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) {
      setResponseStatus(event, 502);
      return { code: "EMPTY_PROVIDER_REPLY", message: "استجاب DeepSeek دون محتوى نصي." };
    }
    return { reply: reply.trim(), model: data.model || model, provider: "deepseek" };
  } catch (error) {
    setResponseStatus(event, 502);
    return { code: "PROVIDER_UNAVAILABLE", message: error?.name === "AbortError" ? "انتهت مهلة اتصال DeepSeek بعد 45 ثانية." : "تعذر الوصول إلى DeepSeek من الخادم. تحقق من اتصال الاستضافة." };
  } finally { clearTimeout(timeout); }
});