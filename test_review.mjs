const response = await fetch("http://localhost:3000/api/review/stream", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: "https://github.com/explorerNW/ai-agent-monorepo/pull/165", model: "deepseek" }),
});

console.log("Status:", response.status);
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      const e = JSON.parse(line.slice(6));
      console.log(`[${e.stage}]`, JSON.stringify(e.data).substring(0, 200));
    }
  }
}

console.log("DONE");
