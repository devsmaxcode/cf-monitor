# Link-wise Country Control Plan

## বিস্তারিত Requirements - সহজ ভাষা 🧭

- User যেন প্রতিটা link/URL-এর জন্য আলাদা country control করতে পারে।
- কোনো link যদি নির্দিষ্ট country দিয়ে lock করা হয়, তাহলে ওই link শুধু ওই country দিয়েই check হবে।
- কোনো link-এ country set না করলে, সেটা আগের মতো global country list দিয়ে check হবে।
- এখনকার system-এ `Configuration -> Proxy Locations -> Proxy Countries` থেকে country set করা যায়, কিন্তু সেটা সব link-এর জন্য একসাথে কাজ করে।
- এখন যদি শুধু এক country দিয়ে সব link check করতে চান, তাহলে `Proxy Countries` field-এ শুধু ওই country রাখলেই হবে, যেমন `Bangladesh`।
- strict one-country check চাইলে `Direct request` বন্ধ রাখতে হবে, কারণ direct request কোনো proxy country না।
- নতুন feature-এ link list-এর পাশেই country বাছাই করার option থাকা দরকার, যাতে কোন link কোন country দিয়ে check হবে সেটা চোখে দেখা যায়।
- saved configuration restart বা refresh-এর পরেও একই থাকবে।
- running monitor থাকলে current running round পুরোনো setting দিয়ে finish করতে পারে; নতুন setting next round থেকে apply হবে।
- metrics table-এ result আগের মতো URL এবং country অনুযায়ী দেখা যাবে।

## Suggested / Missing Requirements - সহজ ভাষা 💡

- Country select করার list fixed রাখা ভালো, যেমন Bangladesh, India, United States ইত্যাদি।
- User country name বা country code দুইভাবেই দিলে system বুঝতে পারা উচিত, যেমন `Bangladesh` বা `BD`।
- কোনো link-এর selected country যদি global list-এ না থাকে, system যেন automatically ওই country-এর proxy load করে।
- link-specific country lock থাকলে direct request defaultভাবে বন্ধ থাকা উচিত, কারণ user বলেছেন "only one country"।
- চাইলে future-এ per-link "also direct" checkbox রাখা যায়, কিন্তু first version-এ না রাখাই clean।
- invalid country দিলে save করার সময় clear error message দেখানো দরকার।
- target URL remove করলে ওই URL-এর old country rule automatically remove হওয়া দরকার।
- duplicate URL থাকলে একটাই rule রাখা উচিত।
- local proxies কীভাবে behave করবে সেটা fixed করা দরকার: recommendation হলো country-locked link-এ local proxy ব্যবহার না করা, unless user explicitly `Local` বেছে নেয়।
- round details/config snapshot-এ per-link country rules save থাকা দরকার, যাতে পরে বোঝা যায় কোন round কোন rules দিয়ে run হয়েছিল।
- existing old config যেন না ভাঙে; old config-এ per-link rule না থাকলে সব আগের মতো চলবে।

## Implementation Plan - সহজ ভাষা 🛠️

- Configuration page-এ `Target URLs` section-টা একটু উন্নত করা হবে।
- প্রতিটা URL row-এর পাশে country dropdown থাকবে।
- dropdown-এর default value হবে `Use global countries`।
- user যদি কোনো country select করে, তখন ওই URL শুধু সেই country দিয়ে check হবে।
- Save চাপলে URL list এবং link-wise country choice দুইটাই save হবে।
- monitor run শুরু হলে system আগে দেখে নেবে কোন URL global country use করছে আর কোন URL locked country use করছে।
- collector/proxy checker প্রতিটা URL-এর জন্য ঠিক country group বেছে নেবে।
- কোনো URL Bangladesh locked হলে সেটার জন্য শুধু Bangladesh proxy group run হবে।
- কোনো URL global থাকলে সেটার জন্য current global countries আগের মতোই run হবে।
- metrics database schema বদলানো লাগবে না, কারণ result already URL আর country ধরে save হয়।
- পুরোনো saved config থাকলে সেটা auto-compatible থাকবে।
- UI-তে small label/badge রাখা যায়: `Only Bangladesh`, `Use global` ইত্যাদি।

## Implementation Plan - Technical 🔧

- `src/lib/monitor.server.ts`
  - `Config` type-এ optional field add করা: `pageCountryOverrides: Record<string, string>`.
  - `defaultConfig`-এ `pageCountryOverrides: {}` রাখা।
  - `sanitizeConfig()`-এ URL normalize করার পর only existing normalized pages-এর override রাখা।
  - country value normalize করা, e.g. `Bangladesh -> BD`, `United States -> US`.
  - invalid/empty country drop বা validation error policy decide করা। Recommendation: save error দেখানো।
  - `configuredProxyLocationCount()`-এ global countries + override countries union count করা।
  - `monitorArgs()`-এ `--proxy-countries` হিসেবে global countries + override countries-এর union পাঠানো।
  - per-link rules JSON file তৈরি করার জন্য `ensureRunFiles()`-এ নতুন runtime file রাখা, e.g. `page-country-overrides.json`.

- `scripts/cloudflare_cache_monitor.ts`
  - নতুন CLI arg add করা: `--page-country-overrides <file>`.
  - file থেকে normalized map পড়া: `{ "https://example.com/": "BD" }`.
  - `checkPage()`-এর আগে page-specific proxy filtering করা।
  - override থাকলে proxy list filter হবে শুধু ওই country-এর জন্য।
  - strict one-country behavior চাইলে override pages থেকে `direct` বাদ যাবে।
  - no override থাকলে current behavior unchanged থাকবে।
  - `roundConfigJson()`-এ overrides include করা।

- `src/lib/monitor.functions.ts`
  - `configSchema`-এ `pageCountryOverrides` add করা।
  - Zod validation দিয়ে object shape enforce করা।
  - existing `.passthrough()` রাখা যায়, কিন্তু explicit field type রাখলে safer।

- `src/components/dashboard/types.ts`
  - `ConfigDraft` automatically new field পাবে যদি `Config` update হয়।
  - দরকার হলে draft-specific helper type add করা।

- `src/components/dashboard/dashboard-consumers.ts`
  - `configToDraft()` এবং `draftToConfig()`-এ `pageCountryOverrides` preserve করা।
  - removed URL-এর stale override client-side clean করা যেতে পারে, server-side sanitize final authority থাকবে।

- `src/components/dashboard/panels/config-panel.tsx`
  - `Target URLs` textarea-এর বদলে row editor করা ভালো।
  - প্রতিটা row: URL input + Country select + remove button।
  - Add URL button রাখা।
  - Country select options:
    - `Use global countries`
    - `Bangladesh`
    - `India`
    - `United States`
    - existing configured countries
  - প্রথম version-এ multi-country per link করা হবে না, কারণ user requirement one country।

- `src/components/dashboard/helpers.ts`
  - country normalization helper share করা যেতে পারে, অথবা server-side source of truth রাখা যেতে পারে।
  - `normalizeDraft()`-এ `pageCountryOverrides` clean করে save payload পাঠানো।

- Database
  - schema change দরকার নেই।
  - `cache_metrics` already `page`, `url`, `proxy_country` রাখে।
  - `cache_rounds.config_json`-এ rules save করলেই audit/history থাকবে।

## Virtual Testing - কোনো test code লেখা হয়নি ✅

- Scenario 1: global-only old behavior
  - `Proxy Countries = Bangladesh,India`
  - কোনো per-link override নেই।
  - expected: সব URL Bangladesh + India দিয়ে check হবে।

- Scenario 2: one link locked
  - URL A override = Bangladesh।
  - URL B override empty/global।
  - expected: URL A শুধু Bangladesh দিয়ে check হবে; URL B global country list দিয়ে check হবে।

- Scenario 3: strict one-country
  - URL A override = Bangladesh।
  - `Direct request` globally enabled থাকলেও override page-এ direct বাদ যাবে।
  - expected: URL A result rows-এ শুধু Bangladesh থাকবে, direct থাকবে না।

- Scenario 4: override country global list-এ নেই
  - Global = India।
  - URL A override = Bangladesh।
  - expected: monitor Bangladesh proxy load করবে এবং URL A Bangladesh দিয়ে check করবে।

- Scenario 5: removed URL
  - URL A remove করা হলো।
  - expected: URL A-এর saved country override auto-remove হবে।

- Scenario 6: invalid country
  - URL A country = `Mars`।
  - expected: save block হবে এবং user-friendly error দেখাবে।

- Scenario 7: old saved config
  - পুরোনো config-এ `pageCountryOverrides` নেই।
  - expected: app load হবে, default `{}` use করবে, existing behavior unchanged থাকবে।

## Current Quick Way - এখনই যা করা যায় ⚡

- Dashboard-এ যান: `Configuration -> Proxy Locations -> Proxy Countries`
- সব country remove করে শুধু এক country রাখুন, যেমন:

```text
Bangladesh
```

- strict single country চাইলে `Direct request` off করুন।
- এতে সব link শুধু ওই country দিয়ে check হবে।
- কিন্তু per-link আলাদা country control এখন নেই; সেটা add করতে উপরের feature implementation দরকার।
