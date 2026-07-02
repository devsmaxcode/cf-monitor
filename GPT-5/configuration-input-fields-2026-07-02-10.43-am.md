# Configuration Input Fields Issue Report - 2026-07-02 10.43 AM

## পাওয়া সমস্যা / Findings 🔎

- Configuration page-এর input fields পুরোপুরি broken না, কিন্তু typing experience ভাঙছে।
- সবচেয়ে বড় সমস্যা `Target URLs` আর `Proxy Countries` textarea-তে:
  - User যখন নতুন line দেয়, blank line রাখে, duplicate ঠিক করতে চায়, বা partial text type করে, app সঙ্গে সঙ্গে value clean করে ফেলে।
  - তাই user মনে করতে পারে field typing accept করছে না।
  - Code location: `src/components/dashboard/panels/config-panel.tsx:69`, `src/components/dashboard/panels/config-panel.tsx:71`, `src/components/dashboard/panels/config-panel.tsx:94`, `src/components/dashboard/panels/config-panel.tsx:98`
- `normalizeList()` প্রতি keypress-এ empty line, duplicate, extra space remove করছে।
  - এটা save করার সময় দরকার, কিন্তু typing করার সময় করলে cursor/input feel নষ্ট হয়।
  - Code location: `src/components/dashboard/helpers.ts:119`, `src/components/dashboard/helpers.ts:122`
- Number input fields-এ empty value রাখা যায় না।
  - User field clear করলে `Number('')` হয়ে `0` বসে যায়।
  - কিছু field-এর min value 1/15, কিন্তু screen-এ temporary `0` দেখা যেতে পারে বা typing আটকে যাওয়ার মতো feel হতে পারে।
  - Code location: `src/components/dashboard/panels/config-panel.tsx:109`, `src/components/dashboard/panels/config-panel.tsx:111`, `src/components/dashboard/panels/config-panel.tsx:138`, `src/components/dashboard/panels/config-panel.tsx:140`, `src/components/dashboard/panels/config-panel.tsx:150`, `src/components/dashboard/panels/config-panel.tsx:152`, `src/components/dashboard/panels/config-panel.tsx:162`, `src/components/dashboard/panels/config-panel.tsx:164`
- Re-render/race issue-এর সম্ভাবনা আছে।
  - Dashboard load/poll থেকে config update হয়: `src/components/dashboard/dashboard-context.tsx:77`, `src/components/dashboard/dashboard-context.tsx:81`
  - Dirty panel হলে future polling skip করে: `src/components/dashboard/dashboard-context.tsx:112`
  - কিন্তু কোনো refresh request যদি typing শুরু করার আগেই in-flight থাকে, সেটা পরে ফিরে এসে config state update করতে পারে।
  - Config consumer dirty হলে draft reset আটকায়: `src/components/dashboard/dashboard-consumers.ts:205`
  - তাই এই race সবসময় হবে না, কিন্তু first keypress বা route load timing-এ flicker/reset দেখা যেতে পারে।
- Save করার পর extra dashboard reload হচ্ছে।
  - `setConfig(saved)` করার পর আবার `loadDashboard()` call হচ্ছে।
  - এতে save-এর পর form আবার server value দিয়ে replace হয়। Save success হলে ঠিক আছে, কিন্তু unnecessary refresh typing UX/debugging কঠিন করে।
  - Code location: `src/components/dashboard/dashboard-context.tsx:142`, `src/components/dashboard/dashboard-context.tsx:144`
- `missIntervalSeconds` config type/schema/server-এ আছে, কিন্তু UI-তে edit করার field নেই।
  - Code location: `src/lib/monitor.functions.ts:43`, `src/lib/monitor.server.ts:49`, `src/lib/monitor.server.ts:318`

## বিস্তারিত Requirements - সহজ ভাষায় 🧾

- Configuration form-এ user যা type করবে, তা typing করার সময় হারানো যাবে না।
- URL list-এ user নতুন line দিলে সেটা সঙ্গে সঙ্গে মুছে যাবে না।
- Proxy countries list-এ user partial country name type করলে সেটা সঙ্গে সঙ্গে trim/clean হবে না।
- Number field clear করে নতুন number type করা যাবে।
- Save করার আগে form user-এর draft value ধরে রাখবে।
- Save button চাপলে শুধু তখনই value clean/validate হবে।
- Background refresh চললেও unsaved form value overwrite হবে না।
- Save success হলে saved clean value দেখাবে।
- Save fail হলে user-এর typed draft হারাবে না।
- Form-এর checkbox/toggle values immediately visible থাকবে।
- User বুঝতে পারবে কোন value save হয়েছে আর কোনটা এখনো draft।

## Suggested / Missing Requirements - আপনার feature list-এর সাথে aligned 💡

- Unsaved changes থাকলে background refresh config form replace করবে না।
- User যদি config tab ছেড়ে যায়, তখন unsaved changes নিয়ে clear behavior দরকার:
  - হয় draft preserve থাকবে,
  - অথবা confirmation/warning দেখাবে।
- Textarea fields raw text হিসেবে রাখা দরকার, save করার সময় list বানানো দরকার।
- Number fields string draft হিসেবে রাখা দরকার, save করার সময় number বানানো দরকার।
- Invalid number হলে clear ছোট message দেখানো দরকার, silent clamp না।
- `missIntervalSeconds` যদি app behavior-এ লাগে, তাহলে UI field দরকার।
- `hitIntervalSeconds` backend compatibility value হলে UI-তে confuse না করে hidden/generated রাখা ভালো।
- Save চলার সময় input disable করা হবে কি না সেটা ঠিক করা দরকার।
  - Current UX-এ শুধু save button disabled।
- Save success/fail feedback visible থাকা দরকার।
  - এখন global error আছে, কিন্তু config form-এর local error span hidden।

## Implementation Plan - সহজ ভাষায় 🛠️

- প্রথমে form-এর draft আলাদা করে রাখা হবে, যাতে typing করার সময় app value clean না করে।
- URL textarea আর country textarea user যেমন type করে তেমনই screen-এ থাকবে।
- Save চাপলে URL/country list clean হবে।
- Number field type করার সময় text হিসেবে থাকবে, তাই empty field possible হবে।
- Save করার সময় number valid কি না check হবে।
- Background refresh থেকে form overwrite হওয়া আটকানো হবে যখন user edit করছে।
- Save success হলে server থেকে পাওয়া final clean config form-এ বসানো হবে।
- Save fail হলে typed value আগের মতোই থাকবে।
- Missing config field থাকলে UI-তে add করা হবে অথবা intentionally hidden হিসেবে documented হবে।
- শেষে manual/virtual test দিয়ে typing, save, fail, polling race scenario check করা হবে।

## Implementation Plan - Technical 🧑‍💻

- `useConfigConsumer()`-এ UI draft shape consider করা:
  - `pagesText: string`
  - `proxyCountriesText: string`
  - numeric fields as strings: `roundIntervalSecondsText`, `timeoutText`, `delayText`, `maxProxiesPerCountryText`, optional `missIntervalSecondsText`
- `ConfigPanelProps` update করে panel-কে raw draft text পাঠানো।
- `ConfigPanel` textarea `value` হিসেবে raw text use করবে:
  - `pagesText`
  - `proxyCountriesText`
- `onChange`-এ `normalizeList()` call remove করা।
- Submit handler-এ raw draft থেকে `Config` বানানো:
  - `pages: normalizeList(pagesText)`
  - `proxyCountries: normalizeList(proxyCountriesText).join(',')`
  - numeric fields parsed with explicit validation
  - `hitIntervalSeconds: roundIntervalSeconds`
- Number parser:
  - empty string হলে validation error
  - non-number হলে validation error
  - min/max client-side error অথবা server `sanitizeConfig()`-এর clamp behavior clearly mirrored
- `DashboardProvider.loadDashboard()` অথবা config consumer effect-এ in-flight refresh race guard improve করা:
  - dirty state ref/context দিয়ে late config payload ignore করা যেতে পারে।
  - অথবা `loadDashboard({ preserveDirtyConfig: true })` style behavior।
- Save flow simplify:
  - save success: `setConfig(saved)` যথেষ্ট হলে immediate `await loadDashboard()` avoid করা।
  - metrics/status refresh দরকার হলে config overwrite না করে separate runtime refresh করা।
- Local form error state expose করা:
  - `useConfigConsumer()` returns `error`
  - `ConfigPanel` hidden `.config-error` span বাস্তবে message দেখায়।
- Optional: `missIntervalSeconds` UI field add করা, যদি monitoring logic-এ configurable রাখা required হয়।

## Virtual Testing Done ✅

- Existing source files modify করা হয়নি।
- Test code add করা হয়নি।
- `bun run lint` চালানো হয়েছে: pass ✅
- `bun x tsc --noEmit` চালানো হয়েছে: pass ✅
- Small runtime simulation দিয়ে `normalizeList()` behavior check করা হয়েছে:
  - `"https://a.com\n"` becomes `["https://a.com"]`
  - `"https://a.com\n\n"` becomes `["https://a.com"]`
  - `"BD\nUnited "` becomes `["BD","United"]`
  - `"BD\nBD\nIN"` becomes `["BD","IN"]`
- এই simulation confirm করে যে textarea typing-এর সময় formatting/blank lines immediately হারাচ্ছে।

## Final Diagnosis 🎯

- আপনার re-render সন্দেহ partially valid।
- কিন্তু primary issue হচ্ছে input value প্রতি keypress-এ normalize/convert করা।
- Textarea fields raw text না রেখে array/string-cleaned value দিয়ে controlled হওয়ায় user typing state হারাচ্ছে।
- Number fields-এ `Number(event.target.value)` immediate conversion-ও typing UX নষ্ট করতে পারে।
- Fix should focus on: raw draft while typing, normalize only on save, and protect dirty draft from background refresh.
