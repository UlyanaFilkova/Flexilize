const MAX_FILES = 10;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function response(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store"
    }
  });
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function safeFilename(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "screenshot";
}

function toBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return response(null, 204);
    if (request.method !== "POST") return response("Method not allowed", 405);
    if (!env.RESEND_API_KEY || !env.FEEDBACK_TO || !env.FEEDBACK_FROM) {
      return response("Feedback service is not configured", 503);
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_FILE_BYTES + 256_000) return response("Request is too large", 413);

    let form;
    try {
      form = await request.formData();
    } catch {
      return response("Invalid form data", 400);
    }

    if (String(form.get("website") || "").trim()) return response("Thanks", 200);
    const message = String(form.get("message") || "").trim();
    const replyEmail = String(form.get("email") || "").trim();
    if (!message || message.length > 5000) return response("Message is required", 400);
    if (replyEmail && (replyEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyEmail))) {
      return response("Invalid reply email", 400);
    }

    const files = form.getAll("screenshots").filter((item) => item instanceof File && item.size > 0);
    if (files.length > MAX_FILES) return response("Too many screenshots", 400);
    if (files.some((file) => !ALLOWED_TYPES.has(file.type) || file.size > MAX_FILE_BYTES)) {
      return response("Unsupported screenshot", 400);
    }
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_FILE_BYTES) {
      return response("Screenshots are too large", 413);
    }

    const attachments = await Promise.all(files.map(async (file) => ({
      filename: safeFilename(file.name),
      content: toBase64(new Uint8Array(await file.arrayBuffer()))
    })));
    const reply = replyEmail ? `<p><strong>Reply email:</strong> ${escapeHtml(replyEmail)}</p>` : "";
    const payload = {
      from: env.FEEDBACK_FROM,
      to: [env.FEEDBACK_TO],
      subject: "Context Translator feedback",
      text: `${message}${replyEmail ? `\n\nReply email: ${replyEmail}` : ""}`,
      html: `<p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>${reply}`,
      ...(attachments.length ? {attachments} : {}),
      ...(replyEmail ? {reply_to: replyEmail} : {})
    };

    try {
      const sent = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json"},
        body: JSON.stringify(payload)
      });
      if (!sent.ok) return response("Email could not be sent", 502);
    } catch {
      return response("Email service unavailable", 502);
    }
    return response("Sent", 200);
  }
};
