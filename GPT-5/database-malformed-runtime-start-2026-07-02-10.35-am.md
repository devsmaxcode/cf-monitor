# Database Malformed Error After Start

## 1. বিস্তারিত দরকারি জিনিসগুলো, সহজ ভাষায় 🧾

- Start করার পর UI-তে `database disk image is malformed` error দেখানো যাবে না।
- Monitor চলার সময় Metrics, Rounds, Summary, Logs page স্বাভাবিকভাবে খোলা থাকতে হবে।
- DB ফাইল সাময়িকভাবে busy বা write অবস্থায় থাকলেও UI যেন পুরোপুরি ভেঙে না পড়ে।
- Dashboard polling হালকা থাকতে হবে, কিন্তু চলমান round/status ঠিকভাবে দেখাতে হবে।
- Metrics data corrupt হলে app যেন ব্যবহারকারীকে পরিষ্কার message দেয় এবং recovery-এর পথ রাখে।
- DB save করার সময় পুরোনো ভালো DB ফাইল নষ্ট হওয়ার ঝুঁকি কমাতে হবে।
- Start/Stop/Run Once চাপলে একই DB-তে একাধিক জায়গা থেকে একসঙ্গে ঝুঁকিপূর্ণ write হওয়া কমাতে হবে।

## 2. Suggested / Missing Requirements, ফিচার লিস্টের সঙ্গে মিল রেখে ✅

- Runtime polling lightweight রাখার পাশাপাশি DB read failure হলে fallback response দিতে হবে।
- DB write করার সময় direct overwrite না করে safe write ব্যবহার করা দরকার: আগে temporary file, তারপর replace।
- একই SQLite file-এ একসঙ্গে একাধিক write আটকানোর জন্য server-side write queue বা mutex দরকার।
- Read operation failure হলে UI-তে শেষ ভালো status/summary রাখা দরকার, খালি crash/error নয়।
- DB integrity check করার admin/helper path দরকার, যাতে `malformed` হলে বোঝা যায় এটা real corruption নাকি temporary race।
- Soft recovery দরকার: malformed DB হলে current file rename করে fresh DB শুরু করার guided action।
- Error message-এ শুধু raw SQLite message না দেখিয়ে সহজ ভাষায় বলা দরকার: “metrics database পড়তে সমস্যা হয়েছে, monitor এখনো চলতে পারে।”

## 3. বিস্তারিত implementation plan, সহজ ভাষায় 🛠️

- প্রথমে DB file সত্যি নষ্ট কিনা বোঝার ব্যবস্থা রাখতে হবে।
- যদি DB file ঠিক থাকে, তাহলে problem সম্ভবত start করার সময় read/write একসঙ্গে হওয়া থেকে আসছে।
- DB save করার সময় এক ধাপে overwrite না করে নিরাপদভাবে save করতে হবে।
- একসঙ্গে দুইটা save যেন না হয়, তার জন্য ভেতরে লাইন ধরে কাজ করানোর ব্যবস্থা করতে হবে।
- Polling error হলে আগের dashboard data রেখে শুধু error banner দেখানো উচিত।
- Runtime polling যেন বড় metrics data না আনে, এটা আগের মতো lightweight থাকবে।
- যদি DB সত্যিই corrupt হয়, তাহলে app যেন নতুন DB শুরু করতে পারে এবং পুরোনো DB backup হিসেবে রেখে দেয়।
- শেষ ধাপে start monitor, runtime polling, metrics page refresh, stop monitor এগুলো manual/virtual flow দিয়ে verify করতে হবে।

## 4. বিস্তারিত implementation plan, technical ⚙️

- `metrics-db.ts`-এ DB write serialization যোগ করা:
  - `persist: true` operations queue/mutex দিয়ে run করানো।
  - একই process-এর মধ্যে overlapping `db.export()` + `writeFile()` আটকানো।
- `persistDb()` safe atomic-ish write-এ বদলানো:
  - write to `${filename}.tmp-${process.pid}-${Date.now()}`।
  - তারপর `rename(temp, filename)`।
  - failure হলে temp cleanup attempt।
- `openMetricsDb()`-এ malformed read handling যোগ করা:
  - SQL.js `new SQL.Database(bytes)` fail করলে typed error throw।
  - চাইলে read-only call-এর জন্য fallback empty DB না দিয়ে clear diagnostic return।
- Dashboard runtime path harden করা:
  - `getRuntime()`-এ metrics summary read fail করলে `status` যতটা সম্ভব return করা।
  - UI context-এ runtime poll catch হলে existing metrics untouched রাখা।
- `readMetricRuntimeSummary()` আর `readMetricRounds()` একসঙ্গে parallel read করছে:
  - corruption/race suspected হলে sequential read try করা যেতে পারে।
  - কিন্তু মূল fix write safety হওয়া উচিত।
- Recovery helper যোগ করা:
  - `checkMetricDbHealth()` with `PRAGMA integrity_check`।
  - `quarantineMetricDb()` যা corrupt DB rename করে fresh DB তৈরি হতে দেয়।
- UI message improve করা:
  - raw `database disk image is malformed` রেখে দেওয়া যায়, কিন্তু তার পাশে friendly explanation দরকার।
  - action: Retry / Reset metrics DB / Download backup।

## 5. Virtual Testing Notes 🧪

- Read-only storage scan করা হয়েছে:
  - `storage/cloudflare-cache-metrics.sqlite` আছে।
  - size প্রায় `892928` bytes।
  - start time-এর কাছাকাছি file update হয়েছে।
- Read-only SQLite integrity check চালানো হয়েছে:
  - `PRAGMA integrity_check` result: `ok`।
- তাই এই মুহূর্তে DB পুরোপুরি corrupt প্রমাণ হয়নি।
- সবচেয়ে সম্ভাব্য কারণ:
  - monitor start হওয়ার সময় app একই SQLite file read/write করছে।
  - SQL.js পুরো DB export করে file overwrite করে।
  - ওই ছোট window-তে UI read করলে malformed error দেখা যেতে পারে।
- Direct server helper simulation চেষ্টা করা হয়েছে:
  - Node extension resolution issue-এর কারণে import আটকে গেছে।
  - এটা app bug নয়, local one-off script limitation।

## 6. Expected Result After Fix 🎯

- Start করার পর error banner আর random malformed দেখাবে না।
- Polling চললেও dashboard responsive থাকবে।
- DB write safer হবে।
- সত্যিকারের corruption হলে app পরিষ্কার recovery path দেখাবে।
- Metrics page শুধু নতুন data version এলে refresh করবে, অকারণে heavy DB read করবে না।
