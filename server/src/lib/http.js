function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  });
  response.end(body);
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  response.end(text);
}

function readJsonBody(request, options = {}) {
  const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : 1024 * 1024;

  return new Promise((resolve, reject) => {
    let raw = "";

    request.on("data", (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw, "utf8") > maxBytes) {
        reject(new Error("Request body is too large."));
      }
    });

    request.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });

    request.on("error", reject);
  });
}

module.exports = {
  sendJson,
  sendText,
  readJsonBody
};
