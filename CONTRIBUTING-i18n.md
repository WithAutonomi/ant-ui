# Contributing translations

Thanks for helping localize the Autonomi desktop UI. This guide covers the two
common contribution paths: **adding a new locale** and **polishing existing
translations**.

## TL;DR

- Locale files live at [`locales/<lang>.json`](./locales/) and are loaded by
  [`plugins/i18n.client.ts`](./plugins/i18n.client.ts).
- English (`en.json`) is the source of truth — every other locale mirrors its
  structure.
- Japanese (`ja.json`) ships as a machine-translated baseline. Native speakers
  are welcome to polish it via PR.

## Repository layout

```
locales/
  en.json     ← source of truth — every key here must exist in every locale
  ja.json     ← Japanese baseline (machine-translated, see _translator_notes)
plugins/
  i18n.client.ts  ← vue-i18n setup; register new locales here
```

Each locale file is a single JSON object grouped by feature area (`settings.*`,
`nodes.*`, `files.*`, `wallet.*`, `header.*`, ...). Keys are dotted paths used
in templates as `$t('settings.storage.warning')` and in script setup as
`t('files.toast.upload_requires_wallet')`.

ICU-style placeholders are written as `{name}`:

```json
"earnings_use_payment_button": "Use {address}"
```

Pluralization uses suffixed keys (`*_one` / `*_many`) chosen by the caller —
see `settings.upload_history.summary_one` / `summary_many` for an example. The
file does not use vue-i18n's built-in `|` plural syntax; keep the suffix
convention so call sites can pick the right key explicitly.

## Right-to-left (RTL) locales

Arabic (`ar`) and Hebrew (`he`) ship as RTL baselines. The direction is wired
through three pieces:

- **`composables/useLocale.ts`** — `RTL_LOCALES` set, and a `dir` computed
  ref that follows the active locale. Add new RTL locale codes here.
- **`app.vue`** — `useHead({ htmlAttrs: { dir: localeDir } })` binds the
  computed dir to the `<html>` element. Tailwind's `rtl:` variant fires off
  this attribute.
- **Surgical CSS** — most layout uses gap/flex which mirrors automatically,
  but anything anchored by physical edge (`left-*`, `right-*`, `ml-*`,
  `mr-*`, `text-left`, `text-right`, `border-l`, `border-r`) needs the
  logical equivalent (`start-*`, `end-*`, `ms-*`, `me-*`, `text-start`,
  `text-end`, `border-s`, `border-e`) or an explicit `rtl:` override.
  Toggle thumbs use `translate-x-N rtl:-translate-x-N` to flip motion.

Known follow-ups (first pass is intentionally surgical, not exhaustive):

- Several dialogs and detail panels still use `ml-*`/`mr-*` margins that
  read slightly off in RTL — they're functional but worth migrating to
  `ms-*`/`me-*` opportunistically.
- Dynamic StatusBadge strings stay English (see Phase-1 carve-out below);
  the BiDi handling is fine but the strings themselves don't mirror.
- **The WalletConnect / Reown AppKit modal stays English + LTR even when
  the rest of the UI is localized.** Reown AppKit (1.8.19 at time of
  writing) ships zero i18n or RTL support — no `locale` option on
  `createAppKit`, no theme variable for direction, all strings are
  hard-coded in the Shadow-DOM web components. This is an upstream
  limitation, not a config gap. CSS hacks to force-mirror the Shadow DOM
  would leave English text reading right-to-left, which is worse than
  the current state. Revisit when Reown ships localization upstream;
  don't attempt a workaround locally.

When adding a new RTL locale, register the code in `RTL_LOCALES` and verify
the toggle thumbs, sidebar border, and toast corner mirror correctly.

## Adding a new locale

1. **Copy `en.json` to `locales/<lang>.json`.** Use the ISO 639-1 code for the
   base language (`fr`, `es`, `de`, `zh`, ...). For language variants, use
   IETF tags (`pt-BR`, `zh-TW`).

2. **Add a `_translator_notes` field at the top** if the baseline is
   machine-translated or has caveats, e.g.:

   ```json
   {
     "_translator_notes": "Machine-translated baseline. Community polish via PR welcome.",
     "settings": { ... }
   }
   ```

   Keys starting with `_` are convention-only — they are not consumed at
   runtime, they just document provenance for future translators.

3. **Translate the values**, leaving every key path intact. Don't reorder keys
   — diffing against `en.json` is the fastest way to spot gaps later.

4. **Register the locale** in `plugins/i18n.client.ts`:

   ```ts
   import fr from '~/locales/fr.json'

   export const i18n = createI18n({
     ...
     messages: { en, ja, fr },
     ...
   })
   ```

5. **Add the locale to the Settings → Language picker** in `pages/settings.vue`
   (look for the existing Japanese option) so users can select it.

6. **Open a PR.** Include the translation source (machine-translated vs.
   human-authored) in the PR description.

## Polishing an existing locale

1. Edit `locales/<lang>.json` directly.
2. If you fix translations that were previously machine-translated and the
   file now reflects mostly human-reviewed content, remove the
   `_translator_notes` flag (or update it).
3. Open a PR with a short description of what you adjusted and why (idiom,
   register, technical accuracy, etc.).

If you only touch a handful of strings, that's fine — partial polish is
welcome. Don't feel obliged to review the whole file.

## Conventions

### Key naming

- **Grouped by area**, not by component: `files.upload_confirm.title`, not
  `UploadConfirmDialog.title`. Components renaming shouldn't churn locale
  files.
- **Verb_noun** for actions: `wallet.toast.invalid_address`, not
  `wallet.toast.address_invalid`.
- **Toasts under `<area>.toast.*`**, errors under `<area>.error.*`. Keeps
  short-lived UI strings out of the structural keyspace.

### Phase-1 carve-out — dynamic StatusBadge strings stay English

Status strings the backend produces dynamically (`Uploading 45%`,
`Failed: <error message>`, `Quoting · 12 of 30`) currently stay in English
even when the rest of the UI is localized. The source emits these as
pre-formatted strings rather than structured tokens, so they can't round-trip
through `t()` cleanly.

A later phase will switch the source to emit structured progress tokens
(`{ stage: 'quoting', done: 12, total: 30 }`) so the frontend can render them
through locale templates. Until then, please leave these strings alone — don't
attempt to translate them on the backend side.

### Don't translate identifiers

Network names (`Arbitrum One`, `Sepolia`), product names (`Indelible`,
`Autonomi`, `WalletConnect`), file extensions, EVM addresses, RPC URLs, and
similar identifiers should stay verbatim. Most are already inline in the
English strings — preserve them in your locale.

## Testing locally

In `npm run tauri:dev`, open the DevTools console and force a locale:

```js
__i18n.global.locale.value = 'ja'
```

The `__i18n` handle is exposed in dev builds only (`import.meta.dev` guard in
`plugins/i18n.client.ts`). The setting won't persist across reloads — to test
persistence, use **Settings → Language → 日本語**.

Look for `[intlify] Not found '<key>'` warnings in the console — they flag
keys missing from your locale that exist in English. CI does not currently
fail on these; treat them as TODOs in your PR.

## Review

- A maintainer reviews structural changes (new keys, plurals, key renames) on
  the English side.
- Translation-only PRs get a much lighter review — we trust contributors on
  language nuance. If you self-identify as a native or fluent speaker in the
  PR, that's enough.

Thanks again for the help.
