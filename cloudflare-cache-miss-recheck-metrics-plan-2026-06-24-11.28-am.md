# ☁️ Cloudflare Cache MISS Recheck + Metrics Plan

তারিখ: 2026-06-24, 11.28 am  
নোট: আপনার instruction অনুযায়ী কোনো existing file edit/modify করা হয়নি। এই নতুন `.md` file শুধু requirements + implementation planning output হিসেবে তৈরি করা হয়েছে। ✅

---

## ✅ Detailed Requirements - সহজ ভাষায়

- কোনো URL request করলে যদি Cloudflare cache `MISS` বা cache problem টাইপ status দেয়, তাহলে ওই URL-টা আবার request করতে হবে। 🔁
- দ্বিতীয় request-এর উদ্দেশ্য হবে দেখা: পরের request cache থেকে serve হলো নাকি আবার origin থেকে আসলো। 🧭
- প্রতিটা monitored URL/page-এর জন্য cache result পরিষ্কারভাবে দেখাতে হবে: `HIT`, `MISS`, `BYPASS`, `DYNAMIC`, `EXPIRED`, `STALE`, `REVALIDATED`, `UPDATING`, বা `FAIL`। 🟢🟡🔴
- প্রথম request আর recheck request আলাদা করে বোঝা যাবে, যেন user বুঝতে পারে “আগে MISS ছিল, পরে HIT হলো কিনা।” 👀
- দুইটা main metric দরকার:
  - কতগুলো request/cache check `MISS` বা miss-like হলো। 📉
  - request পাঠানোর সময়/response time সহ result `HIT` নাকি `MISS` সেটা দেখা। ⏱️
- প্রতিটা URL-এর জন্য send/check time দেখাতে হবে, যেন user বুঝতে পারে কখন request করা হয়েছে। 🕒
- response time দেখাতে হবে, যেন বোঝা যায় cache থেকে আসলে fast কিনা আর origin থেকে আসলে slow কিনা। ⚡
- dashboard/API-তে latest result দেখানোর সময় initial check আর recheck result দুইটাই useful ভাবে summarize করতে হবে। 📊
- যদি প্রথম request `HIT` হয়, তাহলে immediate recheck বাধ্যতামূলক না; কারণ cache already working। ✅
- যদি প্রথম request `MISS`, `BYPASS`, `DYNAMIC`, `EXPIRED`, `STALE`, `UPDATING`, error, বা missing Cloudflare cache header দেয়, তাহলে recheck করতে হবে। ⚠️
- recheck result যদি `HIT` হয়, তাহলে message হবে cache warm হয়েছে / next request cache থেকে serve হচ্ছে। 🔥
- recheck result যদি আবার `MISS` বা origin-like হয়, তাহলে message হবে cache এখনো origin থেকে আসছে বা cache rule issue থাকতে পারে। 🚨
- direct request এবং proxy/country-based request দুই জায়গাতেই একই logic apply হওয়া দরকার। 🌍
- existing monitor schedule থাকবে, তবে miss পাওয়া মাত্র same round-এর ভেতরে quick recheck যোগ হবে। 🛠️

---

## 🧩 Suggested / Missing Requirements - আপনার feature list-এর সাথে aligned

- **Recheck delay setting দরকার** ⏳
  - MISS পাওয়ার সাথে সাথেই recheck করা যাবে, কিন্তু অনেক সময় 1-3 seconds wait দিলে Cloudflare cache warm হওয়ার chance বেশি।
  - config-এ `recheckDelaySeconds` রাখা ভালো।

- **Maximum recheck count দরকার** 🔢
  - একবার recheck করলেই হয়তো enough, কিন্তু future-এ চাইলে 2 বা 3 বার retry করা যেতে পারে।
  - config-এ `maxRechecksOnMiss` রাখা যেতে পারে, default `1`।

- **Same route দিয়ে recheck করা দরকার** 🧭
  - যে country/proxy/direct route দিয়ে MISS পাওয়া গেছে, recheck-টাও ideally একই route দিয়ে করা উচিত।
  - কারণ Cloudflare edge cache location অনুযায়ী আলাদা result দিতে পারে।

- **Final cache decision দরকার** ✅
  - শুধু raw status না, human-friendly final result দরকার:
    - `Already Cached`
    - `Warmed After Recheck`
    - `Still Origin`
    - `Cache Bypassed`
    - `Request Failed`

- **Origin vs Cache classification দরকার** 🏷️
  - `HIT` হলে cache।
  - `MISS`, `BYPASS`, `DYNAMIC`, `EXPIRED` হলে origin/origin-like।
  - `STALE`, `UPDATING`, `REVALIDATED` আলাদা warning হিসেবে ধরা ভালো, কারণ এগুলো mixed cache behavior।

- **Dashboard summary card দরকার** 📌
  - `Initial MISS`
  - `Recheck HIT`
  - `Still MISS / Origin`
  - `Avg Recheck Response`
  - `Last Recheck Time`

- **Per URL detail দরকার** 🔎
  - URL/page, country, edge, first status, second status, first response time, second response time, checked time - সব এক row-তে দেখা গেলে user দ্রুত বুঝবে।

- **Alert-friendly output দরকার** 📣
  - future-এ Telegram/Slack/email alert লাগলে “MISS then HIT” আর “MISS then still origin” আলাদা message পাঠানো সহজ হবে।

- **Cache header missing case handle করতে হবে** 🧯
  - যদি `cf-cache-status` না আসে, তাহলে সেটাকে silent ignore না করে “No Cloudflare Cache Header” হিসেবে দেখানো ভালো।

- **CSV compatibility plan দরকার** 🗂️
  - existing CSV append-only। নতুন fields add করলে old CSV parse যাতে না ভাঙে সেটা plan করতে হবে।

---

## 🛠️ Detailed Implementation Plan - সহজ ভাষায় Non-Technical

- প্রথমে app প্রতিটা URL আগের মতোই request করবে। 🌐
- response থেকে Cloudflare cache status দেখবে। 👀
- যদি status `HIT` হয়, app বলবে “এই URL cache থেকে serve হচ্ছে।” ✅
- যদি status `MISS` বা problem টাইপ হয়, app same URL আরেকবার request করবে। 🔁
- দ্বিতীয় request-এর আগে ছোট delay রাখা যাবে, যেমন 1 বা 2 seconds। ⏳
- দ্বিতীয় response দেখে app বলবে:
  - “আগে MISS ছিল, এখন HIT - cache warm হয়েছে।” 🟢
  - “আগেও MISS, এখনো MISS - origin থেকে আসছে।” 🟡
  - “BYPASS/DYNAMIC - cache rule bypass করছে।” 🟠
  - “Error - request/proxy সমস্যা।” 🔴
- dashboard-এ URL-wise row থাকবে যেখানে first check আর recheck একসাথে দেখা যাবে। 📊
- summary card-এ মোট MISS, recheck-এর পরে HIT, এখনো origin থেকে আসছে এমন URL count দেখাবে। 📌
- request পাঠানোর সময় এবং response time দুইটাই দেখানো হবে। ⏱️
- country/proxy অনুযায়ী আলাদা result থাকবে, কারণ এক দেশের edge HIT হতে পারে আর আরেক দেশের edge MISS হতে পারে। 🌍
- logs-এ পরিষ্কার message থাকবে: কোন URL, কোন country, first status কী, recheck status কী। 🧾
- config থেকে user চাইলে recheck on/off, delay, আর max recheck count control করতে পারবে। ⚙️
- existing Start/Stop/Run Now flow একই থাকবে; শুধু MISS হলে same round-এর ভেতরে extra recheck add হবে। 🚀

---

## 👨‍💻 Detailed Implementation Plan - Technical

- Current collector file: `scripts/cloudflare_cache_monitor_bun.ts`
- Current server/API file: `src/server.ts`
- Current dashboard file: `src/client.ts`
- Current styling file: `src/styles.css`
- Current CSV output: `scripts/storage/cloudflare-cache-metrics.csv`

- Add config fields:
  - `recheckOnMiss: boolean`
  - `recheckDelaySeconds: number`
  - `maxRechecksOnMiss: number`

- Update config sanitize/default logic in backend:
  - default `recheckOnMiss = true`
  - default `recheckDelaySeconds = 1`
  - default `maxRechecksOnMiss = 1`
  - clamp delay to safe range, example `0-30`
  - clamp max recheck to safe range, example `0-5`

- Pass new config values from server to collector args:
  - `--recheck-on-miss`
  - `--recheck-delay`
  - `--max-rechecks-on-miss`

- Add CLI arg parsing in collector:
  - support boolean recheck flag
  - support numeric delay and retry count

- Add helper in collector:
  - `isMissLikeStatus(status)`
  - `shouldRecheck(metrics)`
  - `cacheDecision(initial, recheck)`
  - `originOrCache(status)`

- Suggested miss-like statuses:
  - `MISS`
  - `BYPASS`
  - `DYNAMIC`
  - `EXPIRED`
  - `REVALIDATED`
  - `STALE`
  - `UPDATING`
  - empty `cf-cache-status`
  - request error

- Recheck flow inside current page + proxy group loop:
  - run initial `request(url, proxy.url, timeout, userAgent)`
  - build initial row with `check_phase = initial`
  - if initial is useful and status is `HIT`, stop current group as today
  - if initial is miss-like and `recheckOnMiss` enabled:
    - wait `recheckDelaySeconds`
    - request same `url` with same `proxy.url`
    - build recheck row with `check_phase = recheck`
    - attach relation fields such as `trigger_status`, `final_cache_result`
  - if proxy fails before useful Cloudflare response, keep existing behavior of trying next proxy candidate

- CSV schema option A, safest for dashboard:
  - append new columns while keeping old columns first:
    - `check_phase`
    - `trigger_status`
    - `final_cache_result`
    - `origin_or_cache`
    - `initial_response_ms`
    - `recheck_response_ms`
    - `recheck_count`
  - server parser should tolerate old CSV files where these fields are missing

- CSV schema option B, less invasive:
  - keep every request as normal row
  - add only `check_phase` and `trigger_status`
  - calculate final result in server by grouping `page + proxy_country + proxy + round`
  - this keeps collector simple but dashboard grouping becomes a bit more complex

- Recommended approach:
  - Use option B first। কম change, কম risk। 🙂

- Update backend `buildMetrics(config)`:
  - parse `check_phase` if present
  - group initial + recheck rows by page/country/proxy/round
  - derive:
    - `initialMissCount`
    - `recheckHitCount`
    - `stillOriginCount`
    - `recheckErrorCount`
    - `avgInitialResponseMs`
    - `avgRecheckResponseMs`
    - `lastRecheckTimestamp`

- Add dashboard payload fields:
  - `recheckSummary`
  - `recheckRows`
  - keep existing `summary`, `latestRows`, `pageStats`, `matrix` for backward compatibility

- Update frontend metrics UI:
  - add summary cards:
    - Initial MISS
    - Recheck HIT
    - Still Origin
    - Avg Recheck Time
  - add table columns:
    - First Status
    - Recheck Status
    - Final Result
    - First Time
    - Recheck Time
    - Checked At
  - color final result:
    - green = cached / warmed
    - amber = still origin / miss-like
    - red = error

- Update logs:
  - initial row log example:
    - `initial MISS 200 580ms country=BD page=/quran`
  - recheck row log example:
    - `recheck HIT 200 95ms country=BD page=/quran final=warmed`

- Keep existing scheduling:
  - if latest result has miss/error, `missIntervalSeconds` still schedules faster future run
  - immediate recheck is separate and happens inside the same collector round

- Edge/country correctness:
  - recheck should use the same direct/proxy route where possible
  - store `cf_edge` from both checks
  - if first edge and second edge differ, show small warning because result may not be same Cloudflare edge

- Backward compatibility:
  - old CSV rows without `check_phase` should be treated as `initial`
  - missing new fields should not break `/api/metrics`
  - dashboard should show recheck cards as `0` or `No recheck data yet` until new rows exist

---

## 🧪 Virtual Testing Plan - কোনো test code লেখা হবে না

- **Scenario 1: First request HIT** ✅
  - URL request করা হলো।
  - `cf-cache-status = HIT`
  - expected: no immediate recheck needed।
  - dashboard shows `Already Cached`, response time visible।

- **Scenario 2: First MISS, second HIT** 🟢
  - first request: `MISS`
  - recheck request: `HIT`
  - expected: final result `Warmed After Recheck`
  - metrics:
    - initial miss count +1
    - recheck hit count +1
    - first response time and recheck response time both visible

- **Scenario 3: First MISS, second MISS** 🟡
  - first request: `MISS`
  - recheck request: `MISS`
  - expected: final result `Still Origin`
  - metrics:
    - initial miss count +1
    - still origin count +1
    - dashboard amber warning

- **Scenario 4: BYPASS/DYNAMIC** 🟠
  - first request: `BYPASS` or `DYNAMIC`
  - recheck request: same result
  - expected: final result says cache rule may be bypassing cache
  - dashboard should not call it healthy cache

- **Scenario 5: Error then success** 🔁
  - first proxy request fails
  - next proxy in same country succeeds
  - expected: existing proxy fallback still works
  - failed attempt saved/logged, useful result selected

- **Scenario 6: Missing Cloudflare header** 🧯
  - status code exists but no `cf-cache-status`
  - expected: show `No Cache Header`
  - recheck allowed
  - dashboard should not silently mark it healthy

- **Scenario 7: Same URL different country** 🌍
  - BD result HIT
  - US result MISS then HIT
  - expected: country-wise results stay separate
  - matrix/list should not merge countries incorrectly

- **Scenario 8: Recheck disabled** ⚙️
  - config `recheckOnMiss = false`
  - first request MISS
  - expected: no immediate second request
  - normal fast schedule still uses `missIntervalSeconds`

- **Scenario 9: Old CSV compatibility** 🗂️
  - existing CSV has no `check_phase`
  - expected: API still loads metrics
  - recheck cards show empty/zero until new data exists

- **Scenario 10: Response time metric** ⏱️
  - initial response `700ms`, recheck response `90ms`
  - expected: dashboard shows both values
  - summary avg initial/recheck response updates correctly

---

## 📌 Priority Suggestion

- **Phase 1:** Collector immediate recheck on MISS/miss-like status 🔁
- **Phase 2:** CSV/API derived metrics for initial MISS + recheck HIT/still origin 📊
- **Phase 3:** Dashboard cards/table for first status, recheck status, send/check time, response time 🖥️
- **Phase 4:** Config controls for recheck enable/delay/count ⚙️
- **Phase 5:** Better warnings for edge mismatch, missing cache header, and bypassed cache 🚨

সবচেয়ে আগে collector recheck logic করলে core value পাওয়া যাবে। তারপর dashboard polish করলে user এক নজরে বুঝবে কোন URL cache warm হচ্ছে, আর কোনটা এখনো origin থেকে serve হচ্ছে। 🚀
