import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildUserPrompt } from "./utils/prompt.js";
import { createQueryOptions } from "./core/options.js";

// const userMessage = "Can you help check, is there any claude code installed in this system? if there is a claude code, you may try ask claude code to write a simple helloword with golang code, then ask it to try run it. Then tell me if it can run";
// const userMessage = `Coba buat kode helloworld dengan golang, kemudian test jalankan di bawah directory /Users/mirza/Workspace/personal-ai-assistant6/temp. Saya ingin kamu membuat secara bertahap seperti mengajarkan via tutorial. Mulai dari pembuatan go mod, pembuatan file main.go kemudian sampai pada menjalankan kode-nya. untuk setiap tahapannya kabari saya ya.`
const userMessage = 'Misal aku minta kamu membuatkan skills untuk melakukan pencatatan pengeluaran sehingga nanti diakhir bulan aku bisa minta rekap-nya atau misal bertanya "kepadamu pengeluaran paling besar apa ya?". Apakah ini termasuk skills ? Bisa kamu elaborate lagi kah?'
const prompt = buildUserPrompt(userMessage);

console.log(`[user]: ${userMessage}`);

const options = await createQueryOptions('1e6d66e3-9fb4-41b7-a3ed-95394765c37c');
const responses = query({ prompt, options });

for await (const message of responses) {
  if (message.type === "system" && message.subtype === "init") {
    // session started
  } else if (message.type === "result") {
    console.log(`\n💰 Cost: $${message.total_cost_usd.toFixed(6)}`);
    console.log(`📍 Session: ${message.session_id}`);
  }
}
