const SYSTEM_PROMPT = [
  "You are Forge Eye, a precise senior 3D modeling and game-development engineer.",
  "Specialize in Blender, Three.js, topology, PBR materials, UVs, rigging, animation, asset pipelines, visual QA, and mobile performance.",
  "Reply in the user's language and prefer Arabic when the user writes Arabic.",
  "Separate verified facts from assumptions. Never claim you created, imported, tested, edited, or inspected an asset unless a connected tool result proves it.",
  "For modeling requests, give practical geometry, proportion, material, topology, reference, and validation details; avoid fake certainty and generic placeholders.",
  "This chat endpoint does not itself control Blender or Higgsfield. Do not claim external tool control without an actual tool result.",
  "Be actionable and consider low-power mobile hardware."
].join(" ");

type Provider = "deepseek" | "gemini";
type ChatMessage = { role: "user" | "assistant"; content: string };

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export function getForgeEyeStatusResponse(): Response {
  const deepseekConfigured = Boolean(process.env.DEEPSEEK_API_KEY);
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY);
  return json({
    app: "Forge Eye AI Studio",
    mode: deepseekConfigured || geminiConfigured ? "server-configured" : "setup-required",
    providers: {
      gemini: { configured: geminiConfigured, model: "gemini-3.8-flash" },
      deepseek: {
        configured: deepseekConfigured,
        model: (process.env.DEEPSEEK_MODEL || "deepseek-chat").trim().slice(0, 80)
      },
      higgsfield: {
        configured: false,
        status: "not-connected",
        message: "لم يتم إعداد تكامل موثق ومصادق عليه لـ Higgsfield."
      }
    },
    safety: {
      credentialsServerSideOnly: true,
      noClientModelDownload: true,
      viewportTargetFps: 30,
      pausesWhenHidden: true
    }
  });
}

function validateMessages(value: unknown): { messages?: ChatMessage[]; response?: Response } {
  if (!value || typeof value !== "object" || !Array.isArray((value as { messages?: unknown }).messages)) {
    return { response: json({ code: "INVALID_MESSAGES", message: "أرسل من رسالة واحدة إلى 16 رسالة." }, 400) };
  }
  const raw = (value as { messages: unknown[] }).messages;
  if (raw.length < 1 || raw.length > 16) {
    return { response: json({ code: "INVALID_MESSAGES", message: "أرسل من رسالة واحدة إلى 16 رسالة." }, 400) };
  }
  const messages: ChatMessage[] = [];
  let totalChars = 0;
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { response: json({ code: "INVALID_MESSAGE", message: "صيغة إحدى الرسائل غير صالحة." }, 400) };
    }
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      return { response: json({ code: "INVALID_MESSAGE", message: "صيغة إحدى الرسائل غير صالحة." }, 400) };
    }
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > 8000) {
      return { response: json({ code: "MESSAGE_LIMIT", message: "يجب أن تكون الرسالة بين حرف واحد و8000 حرف." }, 400) };
    }
    totalChars += trimmed.length;
    if (totalChars > 24000) {
      return { response: json({ code: "CONTEXT_LIMIT", message: "حجم المحادثة أكبر من الحد المسموح." }, 413) };
    }
    messages.push({ role, content: trimmed });
  }
  return { messages };
}

export async function handleForgeEyeChatRequest(request: Request, provider: Provider): Promise<Response> {
  const apiKey = provider === "deepseek" ? process.env.DEEPSEEK_API_KEY : process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const message = provider === "deepseek"
      ? "لم يُضبط مفتاح DeepSeek على الخادم. أضف DEEPSEEK_API_KEY إلى أسرار الاستضافة، ولا تضعه في ملفات الواجهة أو GitHub."
      : "لم يُضبط GEMINI_API_KEY على الخادم. أضفه في أسرار الاستضافة، ولا تضعه في ملفات الواجهة أو GitHub.";
    return json({ code: "AI_NOT_CONFIGURED", message }, 503);
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 160000) {
    return json({ code: "BODY_TOO_LARGE", message: "حجم طلب المحادثة أكبر من الحد المسموح." }, 413);
  }

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (rawBody.length > 160000) {
      return json({ code: "BODY_TOO_LARGE", message: "حجم طلب المحادثة أكبر من الحد المسموح." }, 413);
    }
    body = JSON.parse(rawBody);
  } catch {
    return json({ code: "INVALID_JSON", message: "تعذر قراءة نص الرسالة." }, 400);
  }

  const validated = validateMessages(body);
  if (validated.response) return validated.response;
  const messages = validated.messages!;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    if (provider === "deepseek") {
      const model = (process.env.DEEPSEEK_MODEL || "deepseek-chat").trim().slice(0, 80);
      const upstream = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
          stream: false,
          temperature: 0.35,
          max_tokens: 1800
        }),
        signal: controller.signal
      });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        const auth = upstream.status === 401 || upstream.status === 403;
        return json({
          code: auth ? "PROVIDER_AUTH_FAILED" : upstream.status === 429 ? "PROVIDER_QUOTA_LIMIT" : "PROVIDER_REQUEST_FAILED",
          message: auth
            ? "رفض DeepSeek بيانات الاعتماد؛ تحقق من DEEPSEEK_API_KEY في أسرار الخادم."
            : upstream.status === 429
              ? "وصل DeepSeek إلى حد الاستخدام أو الحصة. تحقق من حدود API والتسعير."
              : "تعذر إكمال طلب DeepSeek؛ تحقق من صلاحية API والشبكة."
        }, 502);
      }
      const reply = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
      if (typeof reply !== "string" || !reply.trim()) {
        return json({ code: "EMPTY_PROVIDER_REPLY", message: "استجاب DeepSeek دون محتوى نصي." }, 502);
      }
      return json({ reply: reply.trim(), model: (data as { model?: string }).model || model, provider: "deepseek" });
    }

    const contents = messages.map(message => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }]
    }));
    const upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent", {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: { maxOutputTokens: 1800, thinkingConfig: { thinkingLevel: "medium" } }
      }),
      signal: controller.signal
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const auth = upstream.status === 401 || upstream.status === 403;
      const quota = upstream.status === 429;
      return json({
        code: auth ? "PROVIDER_AUTH_FAILED" : quota ? "PROVIDER_QUOTA_LIMIT" : "PROVIDER_REQUEST_FAILED",
        message: auth
          ? "رفض Gemini بيانات الاعتماد؛ تحقق من GEMINI_API_KEY وصلاحياته."
          : quota
            ? "وصل Gemini إلى حد الاستخدام أو الحصة. تحقق من حدود API والتسعير."
            : "تعذر إكمال طلب Gemini؛ تحقق من إعداد API والشبكة."
      }, 502);
    }
    const reply = ((data as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> })?.candidates?.[0]?.content?.parts || [])
      .map(part => typeof part.text === "string" ? part.text : "")
      .join("")
      .trim();
    if (!reply) {
      return json({ code: "EMPTY_PROVIDER_REPLY", message: "استجاب Gemini دون محتوى نصي؛ قد تكون الاستجابة محجوبة أو غير مكتملة." }, 502);
    }
    return json({
      reply,
      model: (data as { modelVersion?: string }).modelVersion || "gemini-3.8-flash",
      provider: "gemini"
    });
  } catch (error) {
    return json({
      code: "PROVIDER_UNAVAILABLE",
      message: error instanceof Error && error.name === "AbortError"
        ? "انتهت مهلة اتصال المزود بعد 45 ثانية."
        : "تعذر الوصول إلى مزود الذكاء الاصطناعي من الخادم. تحقق من اتصال الاستضافة."
    }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
