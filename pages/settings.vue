<template>
  <div class="mx-auto max-w-2xl space-y-4">
    <!-- Indelible Enterprise (shown at top when connected) -->
    <div v-if="settingsStore.indelibleConnected" class="rounded-lg border border-green-500/20 bg-green-500/5 p-4">
      <div class="flex items-center justify-between">
        <div class="min-w-0 flex-1">
          <h3 class="text-sm font-medium text-green-400">{{ $t('settings.indelible.title') }}</h3>
          <p class="text-xs text-autonomi-muted">{{ $t('settings.indelible.subtitle_connected') }}</p>
        </div>
        <span class="ml-3 shrink-0 rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-400">
          {{ $t('settings.indelible.connected_badge') }}
        </span>
      </div>
      <div class="mt-3 space-y-2">
        <div class="rounded-md bg-autonomi-dark px-3 py-2">
          <p class="text-xs text-autonomi-muted">{{ $t('settings.indelible.server_label') }}</p>
          <p class="truncate font-mono text-xs text-autonomi-text">{{ settingsStore.indelibleUrl }}</p>
        </div>
        <div class="rounded-md bg-autonomi-dark px-3 py-2">
          <p class="text-xs text-autonomi-muted">{{ $t('settings.indelible.signed_in_as') }}</p>
          <p class="text-xs text-autonomi-text">{{ settingsStore.indelibleOrgName }}</p>
          <p class="text-xs text-autonomi-muted">{{ settingsStore.indelibleUserEmail }}</p>
        </div>
        <button
          class="rounded-md border border-autonomi-border px-2.5 py-1.5 text-xs text-autonomi-muted hover:text-autonomi-text"
          @click="disconnectIndelible"
        >
          {{ $t('settings.indelible.disconnect') }}
        </button>
      </div>
    </div>

    <!-- Storage Directory -->
    <div class="rounded-lg border border-autonomi-border p-4">
      <div class="flex items-center justify-between">
        <div class="min-w-0 flex-1">
          <h3 class="text-sm font-medium">{{ $t('settings.storage.title') }}</h3>
          <p class="text-xs text-autonomi-muted">{{ $t('settings.storage.description') }}</p>
          <p class="mt-0.5 truncate font-mono text-xs text-autonomi-muted">{{ settingsStore.storageDir ?? $t('settings.storage.default') }}</p>
        </div>
        <button
          class="ml-3 shrink-0 rounded-md border border-autonomi-border px-2.5 py-1 text-xs text-autonomi-muted hover:text-autonomi-text"
          @click="pickStorageDir"
        >
          {{ $t('settings.storage.browse') }}
        </button>
      </div>
      <p class="mt-2 text-xs text-autonomi-warning">
        {{ $t('settings.storage.warning') }}
      </p>
      <p v-if="settingsStore.storageDirProbeError" class="mt-2 rounded border border-autonomi-error/40 bg-autonomi-error/10 px-2 py-1.5 text-xs text-autonomi-error">
        {{ settingsStore.storageDirProbeError }}
      </p>
    </div>

    <!-- Downloads Directory -->
    <div class="flex items-center justify-between rounded-lg border border-autonomi-border p-4">
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-medium">{{ $t('settings.downloads.title') }}</h3>
        <p class="text-xs text-autonomi-muted">{{ $t('settings.downloads.description') }}</p>
        <p class="mt-0.5 truncate font-mono text-xs text-autonomi-muted">{{ settingsStore.downloadDir ?? $t('settings.downloads.not_set') }}</p>
      </div>
      <button
        class="ml-3 shrink-0 rounded-md border border-autonomi-border px-2.5 py-1 text-xs text-autonomi-muted hover:text-autonomi-text"
        @click="pickDownloadDir"
      >
        {{ $t('settings.downloads.browse') }}
      </button>
    </div>

    <!-- Bell on Critical -->
    <div class="flex items-center justify-between rounded-lg border border-autonomi-border p-4">
      <div>
        <h3 class="text-sm font-medium">{{ $t('settings.alert.title') }}</h3>
        <p class="text-xs text-autonomi-muted">{{ $t('settings.alert.description') }}</p>
      </div>
      <button
        role="switch"
        :aria-checked="settingsStore.bellOnCritical"
        :aria-label="$t('settings.alert.aria_toggle')"
        class="relative h-6 w-11 rounded-full transition-colors"
        :class="settingsStore.bellOnCritical ? 'bg-autonomi-blue' : 'bg-autonomi-border'"
        @click="settingsStore.toggleBell()"
      >
        <span
          class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
          :class="settingsStore.bellOnCritical ? 'translate-x-5' : ''"
        />
      </button>
    </div>

    <!-- Appearance -->
    <div class="flex items-center justify-between rounded-lg border border-autonomi-border p-4">
      <div>
        <h3 class="text-sm font-medium">{{ $t('settings.theme.title') }}</h3>
        <p class="text-xs text-autonomi-muted">{{ $t('settings.theme.description') }}</p>
      </div>
      <button
        role="switch"
        :aria-checked="settingsStore.themeMode === 'light'"
        :aria-label="$t('settings.theme.aria_toggle')"
        class="relative h-6 w-11 rounded-full transition-colors"
        :class="settingsStore.themeMode === 'light' ? 'bg-autonomi-blue' : 'bg-autonomi-border'"
        @click="settingsStore.setThemeMode(settingsStore.themeMode === 'light' ? 'dark' : 'light')"
      >
        <span
          class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
          :class="settingsStore.themeMode === 'light' ? 'translate-x-5' : ''"
        />
      </button>
    </div>

    <!-- Language -->
    <div class="flex items-center justify-between rounded-lg border border-autonomi-border p-4">
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-medium">{{ $t('settings.language.label') }}</h3>
        <p class="text-xs text-autonomi-muted">{{ $t('settings.language.description') }}</p>
      </div>
      <select
        v-model="localeChoice"
        :aria-label="$t('settings.language.label')"
        class="ml-3 shrink-0 rounded-md border border-autonomi-border bg-autonomi-dark px-3 py-1.5 text-xs text-autonomi-text focus:border-autonomi-blue focus:outline-none"
      >
        <option value="system">{{ systemDefaultLabel }}</option>
        <option value="en">English</option>
        <option value="ja">日本語</option>
        <option value="nl">Nederlands</option>
        <option value="fr">Français</option>
        <option value="bg">Български</option>
      </select>
    </div>

    <!-- Advanced -->
    <div>
      <button
        class="text-xs text-autonomi-muted hover:text-autonomi-text"
        :aria-expanded="showAdvanced"
        @click="showAdvanced = !showAdvanced"
      >
        {{ showAdvanced ? $t('settings.advanced.hide') : $t('settings.advanced.show') }}
      </button>
      <div v-if="showAdvanced" class="mt-2 space-y-4">

        <!-- Node daemon -->
        <div class="rounded-lg border border-autonomi-border p-4">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <h3 class="text-sm font-medium">{{ $t('settings.daemon.title') }}</h3>
              <p class="text-xs text-autonomi-muted">
                {{ $t('settings.daemon.description') }}
              </p>
            </div>
            <button
              :disabled="daemonRestarting"
              class="ml-3 shrink-0 rounded-md border border-autonomi-border px-2.5 py-1 text-xs text-autonomi-muted hover:text-autonomi-text disabled:opacity-50"
              @click="restartDaemon"
            >
              {{ daemonRestarting ? $t('settings.daemon.restarting') : $t('settings.daemon.restart') }}
            </button>
          </div>
        </div>

        <!-- Upload concurrency -->
        <div class="rounded-lg border border-autonomi-border p-4">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <h3 class="text-sm font-medium">{{ $t('settings.concurrency.title') }}</h3>
              <p class="mt-1 text-xs text-autonomi-muted">
                {{ $t('settings.concurrency.description_1') }}
              </p>
              <p class="mt-1 text-xs text-autonomi-muted">
                {{ $t('settings.concurrency.description_2') }}
              </p>
            </div>
            <input
              :value="settingsStore.uploadConcurrency"
              type="number"
              :min="UPLOAD_CONCURRENCY_MIN"
              :max="UPLOAD_CONCURRENCY_MAX"
              step="1"
              class="w-16 shrink-0 rounded-md border border-autonomi-border bg-autonomi-dark px-2 py-1 text-center text-sm text-autonomi-text focus:border-autonomi-blue focus:outline-none"
              @change="onConcurrencyChange(($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>

        <!-- Pre-release channel -->
        <div class="rounded-lg border border-autonomi-border p-4">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <h3 class="text-sm font-medium">{{ $t('settings.prerelease.title') }}</h3>
              <p class="mt-1 text-xs text-autonomi-muted">
                {{ $t('settings.prerelease.description') }}
              </p>
              <div
                v-if="prereleaseChannelRestartRequired"
                class="mt-1.5 flex items-center gap-2"
              >
                <p class="text-xs font-medium text-amber-400">
                  {{ $t('settings.prerelease.restart_required') }}
                </p>
                <button
                  type="button"
                  class="rounded-md border border-amber-400/40 px-2 py-0.5 text-xs font-medium text-amber-400 hover:bg-amber-400/10"
                  @click="relaunchApp"
                >
                  {{ $t('settings.prerelease.restart_now') }}
                </button>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              :aria-checked="settingsStore.prereleaseChannel"
              :class="[
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors',
                settingsStore.prereleaseChannel ? 'bg-autonomi-blue' : 'bg-autonomi-border',
              ]"
              @click="onPrereleaseToggle"
            >
              <span
                :class="[
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  settingsStore.prereleaseChannel ? 'translate-x-6' : 'translate-x-1',
                ]"
              />
            </button>
          </div>
        </div>

        <!-- Indelible Enterprise Connection (only show setup when not connected) -->
        <div v-if="!settingsStore.indelibleConnected" class="rounded-lg border border-autonomi-border p-4">
          <div class="flex items-center justify-between">
            <div class="min-w-0 flex-1">
              <h3 class="text-sm font-medium">{{ $t('settings.indelible.title') }}</h3>
              <p class="text-xs text-autonomi-muted">{{ $t('settings.indelible.subtitle_setup') }}</p>
            </div>
            <span
              v-if="settingsStore.indelibleConnected"
              class="ml-3 shrink-0 rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-400"
            >
              {{ $t('settings.indelible.connected_badge') }}
            </span>
          </div>

          <!-- Connected state -->
          <div v-if="settingsStore.indelibleConnected" class="mt-3 space-y-2">
            <div class="rounded-md bg-autonomi-dark px-3 py-2">
              <p class="text-xs text-autonomi-muted">{{ $t('settings.indelible.server_label') }}</p>
              <p class="truncate font-mono text-xs text-autonomi-text">{{ settingsStore.indelibleUrl }}</p>
            </div>
            <div class="rounded-md bg-autonomi-dark px-3 py-2">
              <p class="text-xs text-autonomi-muted">{{ $t('settings.indelible.signed_in_as') }}</p>
              <p class="text-xs text-autonomi-text">{{ settingsStore.indelibleOrgName }}</p>
              <p class="text-xs text-autonomi-muted">{{ settingsStore.indelibleUserEmail }}</p>
            </div>
            <button
              class="rounded-md border border-autonomi-border px-2.5 py-1.5 text-xs text-autonomi-muted hover:text-autonomi-text"
              @click="disconnectIndelible"
            >
              {{ $t('settings.indelible.disconnect') }}
            </button>
          </div>

          <!-- Setup form -->
          <div v-else-if="editingIndelible" class="mt-3 space-y-3">
            <div>
              <label class="mb-1 block text-xs text-autonomi-muted">{{ $t('settings.indelible.server_url_label') }}</label>
              <input
                v-model="indelibleUrlInput"
                type="text"
                :placeholder="$t('settings.indelible.server_url_placeholder')"
                class="w-full rounded-md border border-autonomi-border bg-autonomi-dark px-3 py-1.5 font-mono text-xs text-autonomi-text placeholder-autonomi-muted focus:border-autonomi-blue focus:outline-none"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-autonomi-muted">{{ $t('settings.indelible.api_key_label') }}</label>
              <input
                v-model="indelibleApiKeyInput"
                type="password"
                autocomplete="off"
                :placeholder="$t('settings.indelible.api_key_placeholder')"
                class="w-full rounded-md border border-autonomi-border bg-autonomi-dark px-3 py-1.5 font-mono text-xs text-autonomi-text placeholder-autonomi-muted focus:border-autonomi-blue focus:outline-none"
              />
            </div>
            <div v-if="indelibleError" class="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {{ indelibleError }}
            </div>
            <div class="flex gap-2">
              <button
                :disabled="indelibleTesting || !indelibleUrlInput || !indelibleApiKeyInput"
                class="rounded-md bg-autonomi-blue px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                @click="testIndelible"
              >
                {{ indelibleTesting ? $t('settings.indelible.testing') : $t('settings.indelible.test_connect') }}
              </button>
              <button
                class="rounded-md border border-autonomi-border px-2.5 py-1.5 text-xs text-autonomi-muted hover:text-autonomi-text"
                @click="editingIndelible = false"
              >
                {{ $t('common.cancel') }}
              </button>
            </div>
          </div>

          <!-- Connect button -->
          <div v-else class="mt-3">
            <button
              class="rounded-md border border-autonomi-border px-2.5 py-1.5 text-xs text-autonomi-muted hover:text-autonomi-text"
              @click="startEditIndelible"
            >
              {{ $t('settings.indelible.configure') }}
            </button>
          </div>
        </div>

        <!-- Direct Wallet (private key) -->
        <div class="rounded-lg border border-autonomi-border p-4">
          <div class="flex items-center justify-between">
            <div class="min-w-0 flex-1">
              <h3 class="text-sm font-medium">{{ $t('settings.direct_wallet.title') }}</h3>
              <p class="text-xs text-autonomi-muted">{{ $t('settings.direct_wallet.description') }}</p>
            </div>
            <span
              v-if="walletStore.connected && directWalletActive"
              class="ml-3 shrink-0 rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-400"
            >
              {{ $t('settings.direct_wallet.connected_badge') }}
            </span>
          </div>

          <div v-if="walletStore.connected && directWalletActive" class="mt-3 space-y-2">
            <div class="rounded-md bg-autonomi-dark px-3 py-2">
              <p class="text-xs text-autonomi-muted">{{ $t('settings.direct_wallet.address_label') }}</p>
              <p class="truncate font-mono text-xs text-autonomi-text">{{ walletStore.paymentAddress }}</p>
            </div>
            <button
              class="rounded-md border border-autonomi-border px-2.5 py-1.5 text-xs text-autonomi-muted hover:text-autonomi-text"
              @click="disconnectDirectWallet"
            >
              {{ $t('settings.direct_wallet.disconnect') }}
            </button>
          </div>

          <div v-else-if="editingDirectWallet" class="mt-3 space-y-3">
            <div>
              <label class="mb-1 block text-xs text-autonomi-muted">{{ $t('settings.direct_wallet.network_label') }}</label>
              <select
                v-model="directWalletNetwork"
                class="w-full rounded-md border border-autonomi-border bg-autonomi-dark px-3 py-1.5 text-xs text-autonomi-text focus:border-autonomi-blue focus:outline-none"
              >
                <option value="arbitrum-sepolia">{{ $t('settings.direct_wallet.network_sepolia_option') }}</option>
                <option value="arbitrum">{{ $t('settings.direct_wallet.network_arbitrum_option') }}</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-xs text-autonomi-muted">
                {{ $t('settings.direct_wallet.rpc_url_label') }} <span class="text-autonomi-muted/60">{{ $t('settings.direct_wallet.rpc_url_optional') }}</span>
              </label>
              <input
                v-model="directWalletRpcInput"
                type="text"
                autocomplete="off"
                :placeholder="$t('settings.direct_wallet.rpc_url_placeholder')"
                class="w-full rounded-md border border-autonomi-border bg-autonomi-dark px-3 py-1.5 font-mono text-xs text-autonomi-text placeholder-autonomi-muted focus:border-autonomi-blue focus:outline-none"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-autonomi-muted">{{ $t('settings.direct_wallet.private_key_label') }}</label>
              <input
                v-model="directWalletKeyInput"
                type="password"
                autocomplete="off"
                :placeholder="$t('settings.direct_wallet.private_key_placeholder')"
                class="w-full rounded-md border border-autonomi-border bg-autonomi-dark px-3 py-1.5 font-mono text-xs text-autonomi-text placeholder-autonomi-muted focus:border-autonomi-blue focus:outline-none"
                @keyup.enter="connectDirectWallet"
              />
            </div>
            <div v-if="directWalletError" class="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {{ directWalletError }}
            </div>
            <div class="flex gap-2">
              <button
                :disabled="!directWalletKeyInput"
                class="rounded-md bg-autonomi-blue px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                @click="connectDirectWallet"
              >
                {{ $t('settings.direct_wallet.connect') }}
              </button>
              <button
                class="rounded-md border border-autonomi-border px-2.5 py-1.5 text-xs text-autonomi-muted hover:text-autonomi-text"
                @click="editingDirectWallet = false"
              >
                {{ $t('common.cancel') }}
              </button>
            </div>
          </div>

          <div v-else class="mt-3">
            <button
              class="rounded-md border border-autonomi-border px-2.5 py-1.5 text-xs text-autonomi-muted hover:text-autonomi-text"
              @click="editingDirectWallet = true; directWalletError = ''"
            >
              {{ $t('settings.direct_wallet.import_button') }}
            </button>
          </div>
        </div>

        <!-- Diagnostics -->
        <div class="rounded-lg border border-autonomi-border p-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-sm font-medium">{{ $t('settings.diagnostics.title') }}</h3>
              <p class="text-xs text-autonomi-muted">{{ $t('settings.diagnostics.summary', { entries: errorLogStore.entries.length, errors: errorLogStore.errors.length }) }}</p>
            </div>
            <div class="flex gap-2">
              <button
                class="shrink-0 rounded-md border border-autonomi-border px-2.5 py-1 text-xs text-autonomi-muted hover:text-autonomi-text"
                @click="copyDiagnostics"
              >
                {{ $t('settings.diagnostics.copy_button') }}
              </button>
              <button
                v-if="errorLogStore.entries.length > 0"
                class="shrink-0 rounded-md border border-autonomi-border px-2.5 py-1 text-xs text-autonomi-muted hover:text-autonomi-text"
                @click="clearLog"
              >
                {{ $t('settings.diagnostics.clear_button') }}
              </button>
            </div>
          </div>
          <div v-if="showLog" class="mt-3 max-h-48 overflow-auto rounded-md bg-autonomi-dark p-3">
            <div
              v-for="entry in errorLogStore.recent"
              :key="entry.id"
              class="font-mono text-[11px] leading-relaxed"
              :class="{
                'text-autonomi-error': entry.level === 'error',
                'text-autonomi-warning': entry.level === 'warning',
                'text-autonomi-muted': entry.level === 'info',
              }"
            >
              <span class="text-autonomi-muted/50">{{ entry.timestamp.slice(11, 19) }}</span>
              <span class="ml-1">[{{ entry.source }}]</span>
              <span class="ml-1">{{ entry.message }}</span>
            </div>
            <p v-if="errorLogStore.entries.length === 0" class="text-xs text-autonomi-muted">{{ $t('settings.diagnostics.empty') }}</p>
          </div>
          <button
            class="mt-2 text-xs text-autonomi-muted hover:text-autonomi-text"
            @click="showLog = !showLog"
          >
            {{ showLog ? $t('settings.diagnostics.hide_log') : $t('settings.diagnostics.show_log') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Upload history (V2-232) — bulk clear lives here so it's not a
         single click away on the Files page. Per-row × on hover handles
         the common single-row case. -->
    <div class="flex items-center justify-between rounded-lg border border-autonomi-border p-4">
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-medium">{{ $t('settings.upload_history.title') }}</h3>
        <p class="mt-0.5 text-xs text-autonomi-muted">
          {{ settledUploadCount === 1
            ? $t('settings.upload_history.summary_one', { count: settledUploadCount })
            : $t('settings.upload_history.summary_many', { count: settledUploadCount }) }}
        </p>
      </div>
      <button
        :disabled="settledUploadCount === 0"
        class="shrink-0 rounded-md border border-autonomi-border px-2.5 py-1 text-xs text-autonomi-muted hover:text-autonomi-error disabled:opacity-50 disabled:hover:text-autonomi-muted"
        @click="confirmClearUploadHistory"
      >
        {{ $t('settings.upload_history.clear_button') }}
      </button>
    </div>

    <!-- Software -->
    <div class="rounded-lg border border-autonomi-border p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <h3 class="text-sm font-medium">{{ $t('settings.software.title') }}</h3>
          <div class="mt-1 flex items-baseline gap-2 text-xs">
            <span class="text-autonomi-muted">{{ $t('settings.software.version_label') }}</span>
            <span class="font-mono">{{ appVersion }}</span>
          </div>
          <p v-if="lastCheckedLabel" class="mt-0.5 text-xs text-autonomi-muted">
            {{ $t('settings.software.last_checked', { label: lastCheckedLabel }) }}
          </p>
        </div>
        <button
          :disabled="updaterStore.checking"
          class="shrink-0 rounded-md border border-autonomi-border px-2.5 py-1 text-xs text-autonomi-muted hover:text-autonomi-text disabled:opacity-50"
          @click="checkForUpdates"
        >
          {{ updaterStore.checking ? $t('settings.software.checking') : $t('settings.software.check_button') }}
        </button>
      </div>
    </div>

    <!-- About -->
    <div class="rounded-lg border border-autonomi-border p-4">
      <h3 class="text-sm font-medium">{{ $t('settings.about.title') }}</h3>
      <div class="mt-3 space-y-1.5 text-xs">
        <div class="flex justify-between">
          <span class="text-autonomi-muted">{{ $t('settings.about.node_version_label') }}</span>
          <span class="font-mono">{{ nodeVersion }}</span>
        </div>
      </div>
      <div class="mt-3 flex gap-3">
        <button class="text-xs text-autonomi-blue hover:underline" @click="tauriOpenUrl('https://autonomi.com')">
          autonomi.com
        </button>
        <button class="text-xs text-autonomi-blue hover:underline" @click="tauriOpenUrl('https://github.com/WithAutonomi')">
          GitHub
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { openUrl as tauriOpenUrl } from '@tauri-apps/plugin-opener'
import { arbitrum, arbitrumSepolia } from 'viem/chains'
import { setDevnetWalletKey, UPLOAD_CONCURRENCY_MIN, UPLOAD_CONCURRENCY_MAX } from '~/stores/settings'
import { useSettingsStore } from '~/stores/settings'
import { useLocale, SUPPORTED_LOCALES, NATIVE_LOCALE_NAMES, type SupportedLocale } from '~/composables/useLocale'
import { isValidEthAddress } from '~/utils/validators'
import { useToastStore } from '~/stores/toasts'
import { useErrorLogStore } from '~/stores/errorlog'
import { useUpdaterStore } from '~/stores/updater'
import { useFilesStore } from '~/stores/files'

const settingsStore = useSettingsStore()
const { setLocale, osLocale, t } = useLocale()

/** Bound to the Language <select>. `'system'` is the sentinel for "follow
 *  the OS locale" (persisted as null in config.toml). */
const localeChoice = computed<'system' | SupportedLocale>({
  get: () => {
    const persisted = settingsStore.i18nLocale
    return persisted && (SUPPORTED_LOCALES as readonly string[]).includes(persisted)
      ? (persisted as SupportedLocale)
      : 'system'
  },
  set: (value) => {
    setLocale(value === 'system' ? null : value)
  },
})

/** Label for the "Follow system" option. Shows the detected OS-locale's
 *  native name once detection resolves (e.g. "System default: English"),
 *  falling back to the bare label during the brief pre-detection window. */
const systemDefaultLabel = computed(() =>
  osLocale.value
    ? t('settings.language.system_default', { name: NATIVE_LOCALE_NAMES[osLocale.value] })
    : t('settings.language.system_default_pending'),
)

const walletStore = useWalletStore()
const nodesStore = useNodesStore()
const toasts = useToastStore()
const errorLogStore = useErrorLogStore()
const updaterStore = useUpdaterStore()
const filesStore = useFilesStore()
const showAdvanced = ref(false)
const showLog = ref(false)
const appVersion = ref('0.1.0')

/** Number of settled (complete/failed) upload rows we'd wipe if Clear is
 *  pressed. Mid-transfer rows survive — clearUploadHistory's filter only
 *  drops complete + failed entries. */
const settledUploadCount = computed(() =>
  filesStore.settledUploads.filter(f => f.status === 'complete' || f.status === 'failed').length,
)

async function confirmClearUploadHistory() {
  if (settledUploadCount.value === 0) return
  // Native window.confirm is enough here — the sheet is already a settings
  // page surface and the action is reversible only via OS-level file
  // restoration on `upload_history.json`.
  const message = settledUploadCount.value === 1
    ? t('settings.upload_history.confirm_one')
    : t('settings.upload_history.confirm_many', { count: settledUploadCount.value })
  const ok = window.confirm(message)
  if (!ok) return
  filesStore.clearUploadHistory()
  toasts.add(t('settings.toast.upload_history_cleared'), 'info')
}

// Re-compute "Last checked X ago" every 30s so the label stays fresh while
// the settings page is visible, without paying for a global ticker.
const nowTick = ref(Date.now())
let tickHandle: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  tickHandle = setInterval(() => { nowTick.value = Date.now() }, 30_000)
})
onUnmounted(() => {
  if (tickHandle) clearInterval(tickHandle)
})

const lastCheckedLabel = computed(() => {
  const ts = updaterStore.lastCheckedAt
  if (!ts) return ''
  const secs = Math.max(0, Math.round((nowTick.value - ts) / 1000))
  if (secs < 10) return t('settings.relative_time.just_now')
  if (secs < 60) return t('settings.relative_time.seconds_ago', { n: secs })
  const mins = Math.round(secs / 60)
  if (mins < 60) return t('settings.relative_time.minutes_ago', { n: mins })
  const hours = Math.round(mins / 60)
  if (hours < 24) return t('settings.relative_time.hours_ago', { n: hours })
  const days = Math.round(hours / 24)
  return t('settings.relative_time.days_ago', { n: days })
})

async function checkForUpdates() {
  const result = await updaterStore.checkForUpdate()
  if (!result.ok) {
    toasts.add(result.error ?? t('settings.toast.update_check_failed'), 'error')
    return
  }
  if (result.available) {
    toasts.add(t('settings.toast.update_available', { version: updaterStore.version }), 'info')
    updaterStore.showDialog = true
  } else {
    toasts.add(t('settings.toast.on_latest_version', { version: appVersion.value }), 'success')
  }
}
const nodeVersion = computed(() => {
  const versions = nodesStore.nodes.map(n => n.version).filter(Boolean)
  return versions.length > 0 ? versions[0] : '-'
})

// Earnings address editing
const editingEarnings = ref(false)
const earningsInput = ref('')
const earningsInputRef = ref<HTMLInputElement | null>(null)

// Daemon URL editing
const editingDaemon = ref(false)
const daemonInput = ref('')
const daemonInputRef = ref<HTMLInputElement | null>(null)

// Daemon control — delegate to the nodes store so the nodes page can show a
// "Restarting" panel instead of the default "Cannot connect" flicker during
// the brief window when the old daemon is down.
const daemonRestarting = computed(() => nodesStore.restarting)

async function restartDaemon() {
  try {
    await nodesStore.restartDaemon()
    toasts.add(t('settings.toast.daemon_restarted'), 'info')
  } catch (e: any) {
    toasts.add(t('settings.toast.daemon_restart_failed', { error: e?.message ?? e }), 'error')
  }
}

// Direct wallet (private key)
const editingDirectWallet = ref(false)
const directWalletKeyInput = ref('')
const directWalletNetwork = ref('arbitrum-sepolia')
/** Optional user-provided RPC URL. When empty, the chain branch in
 *  `connectDirectWallet` falls back to the public RPC (Sepolia rollup,
 *  arb1.arbitrum.io). Lets paid-RPC users plug in their own endpoint
 *  instead of being rate-limited by public infra during merkle uploads. */
const directWalletRpcInput = ref('')
const directWalletError = ref('')
const directWalletActive = ref(false)

async function connectDirectWallet() {
  directWalletError.value = ''
  try {
    let key = directWalletKeyInput.value.trim()
    if (!key.startsWith('0x')) key = `0x${key}`
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      directWalletError.value = t('settings.error.private_key_invalid')
      return
    }

    // Configure the network based on selection
    const isSepolia = directWalletNetwork.value === 'arbitrum-sepolia'
    const rpcOverride = directWalletRpcInput.value.trim() || null
    setDevnetWalletKey(key)
    settingsStore._devnetWalletKeySet = true
    settingsStore.devnetActive = true
    if (isSepolia) {
      settingsStore.devnetChainId = arbitrumSepolia.id
      settingsStore.devnetRpcUrl = rpcOverride ?? 'https://sepolia-rollup.arbitrum.io/rpc'
      settingsStore.devnetTokenAddress = '0x4bc1aCE0E66170375462cB4E6Af42Ad4D5EC689C'
      settingsStore.devnetVaultAddress = '0xd742E8CFEf27A9a884F3EFfA239Ee2F39c276522'
    } else {
      // Arbitrum One mainnet — use mainnet token/vault defaults via wallet-config.
      settingsStore.devnetChainId = arbitrum.id
      settingsStore.devnetRpcUrl = rpcOverride
      settingsStore.devnetTokenAddress = null
      settingsStore.devnetVaultAddress = null
    }

    const { initDevnetWallet } = await import('~/composables/useDevnetWallet')
    const config = initDevnetWallet()
    if (!config) {
      directWalletError.value = 'Failed to initialize wallet'
      return
    }

    // Hot-attach the wallet on the Rust client so direct-PK uploads take the
    // evmlib path (wallet_upload). Without this, uploads triggered via the
    // settings-UI key-entry flow hit the Rust side with no wallet attached
    // and error out — the JS state flips _devnetWalletKeySet=true while the
    // Rust client was initialised wallet-less at app startup.
    try {
      await invoke('attach_wallet', {
        walletPrivateKey: key,
        evmRpcUrl: settingsStore.devnetRpcUrl,
        evmTokenAddress: settingsStore.devnetTokenAddress,
        evmVaultAddress: settingsStore.devnetVaultAddress,
      })
    } catch (e: any) {
      console.warn('attach_wallet failed:', e)
      // Non-fatal — uploads will fall back to the JS wagmi path. Surface
      // through the toast so the user sees something didn't go right.
      toasts.add(t('settings.toast.wallet_attach_failed', { error: e?.message ?? e }), 'error')
    }

    directWalletActive.value = true
    editingDirectWallet.value = false
    directWalletKeyInput.value = ''
    directWalletRpcInput.value = ''
    toasts.add(t('settings.toast.wallet_connected', { address: walletStore.paymentAddress }), 'info')
  } catch (e: any) {
    directWalletError.value = e.message ?? 'Failed to import key'
  }
}

async function disconnectDirectWallet() {
  walletStore.connected = false
  walletStore.paymentAddress = null
  walletStore.balance = null
  walletStore.ethBalance = null
  walletStore.antBalance = null
  walletStore.usdcBalance = null
  directWalletActive.value = false
  setDevnetWalletKey(null)
  settingsStore._devnetWalletKeySet = false
  // Clear devnet-routing settings so the next upload falls back to the
  // external-signer (WalletConnect) path. Leaving these set means the next
  // upload still tries the direct-wallet route with no key and errors out
  // with "Wallet not connected".
  settingsStore.devnetActive = false
  settingsStore.devnetChainId = null
  settingsStore.devnetRpcUrl = null
  settingsStore.devnetTokenAddress = null
  settingsStore.devnetVaultAddress = null
  // Drop the module-scope wagmi config + viem account so a re-import has to
  // rebuild from scratch.
  const { disposeDevnetWallet } = await import('~/composables/useDevnetWallet')
  disposeDevnetWallet()
  toasts.add(t('settings.toast.wallet_disconnected'), 'info')
}

// Indelible connection
const editingIndelible = ref(false)
const indelibleUrlInput = ref('')
const indelibleApiKeyInput = ref('')
const indelibleTesting = ref(false)
const indelibleError = ref('')

function startEditIndelible() {
  indelibleUrlInput.value = settingsStore.indelibleUrl ?? ''
  indelibleApiKeyInput.value = settingsStore.indelibleApiKey ?? ''
  indelibleError.value = ''
  editingIndelible.value = true
}

async function testIndelible() {
  indelibleTesting.value = true
  indelibleError.value = ''
  const result = await settingsStore.testIndelibleConnection(
    indelibleUrlInput.value.trim(),
    indelibleApiKeyInput.value.trim(),
  )
  indelibleTesting.value = false
  if (result.ok) {
    editingIndelible.value = false
    toasts.add(t('settings.toast.indelible_connected'), 'info')
  } else {
    indelibleError.value = result.error ?? 'Connection failed'
  }
}

async function disconnectIndelible() {
  await settingsStore.disconnectIndelible()
  toasts.add(t('settings.toast.indelible_disconnected'), 'info')
}

onMounted(async () => {
  try {
    appVersion.value = await invoke<string>('get_app_version')
  } catch { /* fallback to default */ }
})

async function pickStorageDir() {
  try {
    const selected = await open({ directory: true, title: t('settings.picker.storage_title') })
    if (!selected) return
    const path = selected as string
    const result = await settingsStore.probeStorageDir(path)
    if (!result.ok) {
      settingsStore.storageDirProbeError = result.error
      toasts.add(t('settings.toast.storage_dir_unwritable'), 'error')
      return
    }
    settingsStore.storageDirProbeError = null
    await settingsStore.setStorageDir(path)
    toasts.add(t('settings.toast.storage_dir_verified'), 'success')
  } catch (e) {
    toasts.add(t('settings.toast.select_directory_failed'), 'error')
  }
}

async function pickDownloadDir() {
  try {
    const selected = await open({ directory: true, title: t('settings.picker.downloads_title') })
    if (selected) {
      await settingsStore.setDownloadDir(selected as string)
      toasts.add(t('settings.toast.downloads_dir_updated'), 'info')
    }
  } catch (e) {
    toasts.add(t('settings.toast.select_directory_failed'), 'error')
  }
}

function startEditEarnings() {
  earningsInput.value = settingsStore.earningsAddress ?? ''
  editingEarnings.value = true
  nextTick(() => earningsInputRef.value?.focus())
}

async function saveEarnings() {
  const val = earningsInput.value.trim()
  if (val && !isValidEthAddress(val)) {
    toasts.add(t('settings.error.invalid_eth_address'), 'warning')
    return
  }
  await settingsStore.setEarningsAddress(val || null)
  editingEarnings.value = false
  toasts.add(t('settings.toast.earnings_updated'), 'info')
}

function startEditDaemon() {
  daemonInput.value = settingsStore.daemonUrl
  editingDaemon.value = true
  nextTick(() => daemonInputRef.value?.focus())
}

async function saveDaemon() {
  const val = daemonInput.value.trim()
  if (!val) return
  await settingsStore.setDaemonUrl(val)
  editingDaemon.value = false
  toasts.add(t('settings.toast.daemon_url_updated'), 'info')
}

async function onConcurrencyChange(raw: string) {
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return
  await settingsStore.setUploadConcurrency(n)
}

const prereleaseChannelRestartRequired = computed(
  () => settingsStore.prereleaseChannel !== settingsStore.prereleaseChannelBootValue,
)

async function onPrereleaseToggle() {
  await settingsStore.setPrereleaseChannel(!settingsStore.prereleaseChannel)
}

async function relaunchApp() {
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
}

async function copyDiagnostics() {
  const report = errorLogStore.buildReport()
  try {
    await navigator.clipboard.writeText(report)
    toasts.add(t('settings.toast.diagnostics_copied'), 'info')
  } catch {
    toasts.add(t('settings.toast.diagnostics_copy_failed'), 'error')
  }
}

function clearLog() {
  errorLogStore.clear()
  toasts.add(t('settings.toast.log_cleared'), 'info')
}


</script>
