---
name: task-checklist
description: Manage Mirza's personal task/reminder notes stored in /home/botuser/tasks.md. Use this skill to add tasks, list pending tasks, mark tasks as done, or proactively follow up on unchecked items. Trigger when: user says "ingatkan aku untuk X", "tolong catat X", "remind me to X" — or when doing proactive check-ins and you want to follow up on pending tasks.
---

# Task Checklist Skill

Skill ini mengelola file `/home/botuser/tasks.md` sebagai catatan task pribadi Mirza.

---

## File Location

```
/home/botuser/tasks.md
```

Gunakan Bash tool untuk membaca dan menulis file ini.

---

## Task Format

```markdown
- [ ] Deskripsi task | added: YYYY-MM-DD | due: YYYY-MM-DD atau -
- [x] Deskripsi task | added: YYYY-MM-DD | done: YYYY-MM-DD
```

---

## Operations

### 1. ADD TASK

Trigger: User bilang *"ingatkan aku untuk X"*, *"tolong catat"*, *"remind me to..."*

Steps:
1. Baca file: `cat /home/botuser/tasks.md`
2. Tambahkan baris baru di bawah `## ⏳ Pending Tasks`:
   ```
   - [ ] [deskripsi] | added: [tanggal hari ini] | due: [due date atau -]
   ```
3. Tulis balik file dengan konten yang sudah diupdate
4. Konfirmasi ke Mirza dengan casual: *"Oke, udah aku catat!"* atau *"Noted! Aku ingetin nanti ya."*

### 2. LIST PENDING TASKS

Trigger: User tanya *"ada task apa aja?"*, *"list reminder aku"*, atau saat kamu mau proaktif follow up

Steps:
1. Baca file: `cat /home/botuser/tasks.md`
2. Parse semua baris yang ada `- [ ]`
3. Tampilkan dengan format yang ramah dan readable
4. Jika kosong: *"Ga ada task pending nih, bersih! ✨"*

### 3. COMPLETE TASK

Trigger: User bilang *"udah selesai"*, *"sudah dilakukan"*, *"done"*, atau mengonfirmasi task tertentu sudah dikerjakan

Steps:
1. Baca file: `cat /home/botuser/tasks.md`
2. Identifikasi task yang dimaksud (match by keyword)
3. Pindahkan dari Pending ke Completed:
   - Ganti `- [ ]` → `- [x]`
   - Ganti `due: ...` → `done: [tanggal hari ini]`
   - Pindahkan baris dari section `## ⏳ Pending Tasks` ke `## ✅ Completed Tasks`
4. Tulis balik file
5. Respond casual: *"Nice, aku centang ya! ✅"* atau *"Mantap, beres satu!"*

### 4. PROACTIVE FOLLOW-UP

Trigger: Saat doing check-in harian, atau di sela-sela obrolan biasa

Steps:
1. Baca file: `cat /home/botuser/tasks.md`
2. Cek apakah ada task pending
3. Jika ada → selipkan pertanyaan natural ke dalam percakapan:
   - *"Eh btw, kamu udah [task] belum?"*
   - *"Oh iya, gimana [task]-nya? Udah done?"*
   - *"Jangan lupa ya [task] 👀"*
4. Pilih **satu task saja** per check-in — jangan dump semua sekaligus
5. Pilih task yang paling relevan dengan konteks saat itu (misal: task "foto meteran" lebih relevan diingatkan saat Mirza udah pulang kantor)

---

## Tone & Style

- **Casual dan natural** — jangan seperti notifikasi robot
- **Satu task per check-in** — jangan overwhelm
- **Timing matters** — sesuaikan dengan konteks: task yang butuh keluar rumah → ingatkan saat Mirza udah pulang
- **Jangan paksa** — kalau Mirza lagi sibuk atau lagi fokus sesuatu, cukup selipkan ringan

---

## Example Interactions

**Adding a task:**
> Mirza: "Ingatkan aku untuk perpanjang SIM"
> → Tambah ke Pending: `- [ ] Perpanjang SIM | added: 2026-03-23 | due: -`
> → Reply: "Oke, udah aku catat! Nanti aku ingetin ya 😄"

**Proactive follow-up (during afternoon check-in):**
> → Baca tasks.md → ada "Foto meteran air"
> → Selipkan: "Eh btw, udah foto meteran air belum? 📸"

**Completing a task:**
> Mirza: "Udah tadi difoto"
> → Pindah ke Completed, update done date
> → Reply: "Nice! Aku centang ya ✅ Beres satu!"

---

## Notes

- File ini adalah sumber kebenaran — selalu baca file terbaru sebelum melakukan operasi apapun
- Jangan hardcode asumsi tentang isi file — selalu baca dulu
- Kalau task ambigu (user bilang "udah selesai" tanpa spesifik) → tanya klarifikasi: *"Yang mana nih, [task A] atau [task B]?"*
