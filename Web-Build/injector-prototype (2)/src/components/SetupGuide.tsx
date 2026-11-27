import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { hapticTap } from '../utils/haptics';

interface CommandBlock {
  id: string;
  title: string;
  note: string;
  code: string;
}

const COMMAND_BLOCKS: CommandBlock[] = [
  {
    id: 'install',
    title: '1. Build & Install Debug APK on Emulator',
    note: 'Open the downloaded android/ folder in Android Studio (AGP 8.5+, JDK 17) or build via Gradle.',
    code: `./gradlew assembleDebug\nadb install -r app/build/outputs/apk/debug/app-debug.apk`,
  },
  {
    id: 'device-owner',
    title: '2. Provision Device Owner (Enables Lock Task Mode)',
    note: 'Run on a fresh emulator with no signed-in Google accounts so startLockTask() pins AlertActivity without confirmation.',
    code: `adb shell dpm set-device-owner com.argo.alert/.AdminReceiver`,
  },
  {
    id: 'permissions',
    title: '3. Grant Runtime Permissions & Set Mock GPS Fix',
    note: 'Grants GPS location, notifications, and overlay permissions, then injects a GPS fix into LocationManager.',
    code: `adb shell pm grant com.argo.alert android.permission.ACCESS_FINE_LOCATION\nadb shell pm grant com.argo.alert android.permission.POST_NOTIFICATIONS\nadb emu geo fix 139.7671 35.6812`,
  },
  {
    id: 'direct-boot',
    title: '4. Test Direct Boot & Low-Battery Reserve Mode',
    note: 'Verify LOCKED_BOOT_COMPLETED startup and battery <= 5% reserve power behavior.',
    code: `adb shell dumpsys battery set level 4\nadb reboot`,
  },
];

const SAMPLE_POLL_JSON = `{
  "status": "ACTIVE",
  "payload": "{\\"alert_id\\":\\"argo-eq-01\\",\\"type\\":\\"EARTHQUAKE\\",\\"severity\\":\\"EXTREME\\",\\"headline\\":\\"Evacuate unstable structures immediately.\\",\\"region\\":{\\"center\\":{\\"lat\\":35.685,\\"lon\\":139.77},\\"radius_km\\":15},\\"shelters\\":[{\\"name\\":\\"Marunouchi Plaza\\",\\"lat\\":35.6838,\\"lon\\":139.7642}],\\"protocol_steps\\":[\\"Drop, cover, and hold on.\\",\\"Use stairs only.\\"],\\"protocol_note\\":\\"Civil Protection Directive CP-14\\",\\"checkin_interval_s\\":30}",
  "sig": "<hex HMAC-SHA256 of raw payload with key argo-demo-shared-secret>"
}`;

const SAMPLE_CLEAR_JSON = `{
  "status": "CLEARED",
  "alert_id": "argo-eq-01",
  "clear_sig": "<hex HMAC-SHA256 of 'argo-eq-01|CLEARED' with key argo-demo-shared-secret>"
}`;

export function SetupGuide() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyText = async (key: string, text: string) => {
    hapticTap();
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-[#D4DCE6]">
            Emulator Provisioning &amp; ADB Commands
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Configure the Android emulator so{' '}
            <code className="font-mono text-slate-800 dark:text-slate-200">com.argo.alert</code>{' '}
            operates as a Device Owner emergency layer before launching normal apps.
          </p>
        </div>

        <div className="space-y-3">
          {COMMAND_BLOCKS.map((block) => (
            <div
              key={block.id}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-[#1B2230] dark:bg-[#0C1017]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-[#D4DCE6]">
                    {block.title}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {block.note}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => copyText(block.id, block.code)}
                  aria-label={`Copy command for ${block.title}`}
                  className="inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-slate-300 hover:text-slate-900 dark:border-[#222B3B] dark:bg-[#07090D] dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-[#D4DCE6] whitespace-nowrap"
                >
                  {copiedKey === block.id ? (
                    <>
                      <Check
                        className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                        aria-hidden="true"
                      />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 dark:border-[#161D2B] dark:bg-[#06080B] dark:text-[#C5D0DF]">
                {block.code}
              </pre>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-[#D4DCE6]">
            Backend Contract (
            <code className="font-mono text-slate-800 dark:text-slate-200">
              http://10.0.2.2:8000
            </code>
            )
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Cleartext traffic is permitted exclusively to{' '}
            <code className="font-mono text-slate-800 dark:text-slate-200">10.0.2.2</code> via{' '}
            <code className="font-mono text-slate-800 dark:text-slate-200">
              network_security_config.xml
            </code>
            .
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-[#1B2230] dark:bg-[#0C1017]">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-[#D4DCE6]">
            Poll Endpoint (Every 2 Seconds)
          </h3>
          <p className="mt-1 font-mono text-xs text-blue-700 dark:text-sky-400">
            GET /api/device/poll?device=emu1&amp;lat=&lt;lat&gt;&amp;lon=&lt;lon&gt;&amp;battery=&lt;pct&gt;
          </p>

          <p className="mt-4 text-xs font-medium text-slate-700 dark:text-slate-300">
            Active Alert Response
          </p>
          <pre className="mt-1.5 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-800 dark:border-[#161D2B] dark:bg-[#06080B] dark:text-[#C5D0DF]">
            {SAMPLE_POLL_JSON}
          </pre>

          <p className="mt-4 text-xs font-medium text-slate-700 dark:text-slate-300">
            Signed All-Clear Response
          </p>
          <pre className="mt-1.5 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-800 dark:border-[#161D2B] dark:bg-[#06080B] dark:text-[#C5D0DF]">
            {SAMPLE_CLEAR_JSON}
          </pre>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-[#1B2230] dark:bg-[#0C1017]">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-[#D4DCE6]">
            Event Reporting Endpoint
          </h3>
          <p className="mt-1 font-mono text-xs text-emerald-700 dark:text-emerald-400">
            POST /api/device/event
          </p>
          <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            Every protocol stage posts JSON{' '}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-900 dark:bg-[#06080B] dark:text-slate-100">
              {`{"device":"emu1","event":NAME,"detail":TEXT,"lat":..,"lon":..}`}
            </code>{' '}
            in order:{' '}
            <code className="font-mono text-slate-800 dark:text-slate-200">ALERT_RECEIVED</code>,{' '}
            <code className="font-mono text-slate-800 dark:text-slate-200">SIGNATURE_OK</code> /{' '}
            <code className="font-mono text-slate-800 dark:text-slate-200">SIGNATURE_FAIL</code>,{' '}
            <code className="font-mono text-slate-800 dark:text-slate-200">IN_REGION</code> /{' '}
            <code className="font-mono text-slate-800 dark:text-slate-200">OUT_OF_REGION</code>,{' '}
            <code className="font-mono text-slate-800 dark:text-slate-200">
              RESERVE_POWER_ACTIVE
            </code>
            , <code className="font-mono text-slate-800 dark:text-slate-200">SIREN_ON</code>,{' '}
            <code className="font-mono text-slate-800 dark:text-slate-200">SLIDER_CONFIRMED</code>,{' '}
            <code className="font-mono text-slate-800 dark:text-slate-200">NEAREST_SHELTER</code>,{' '}
            <code className="font-mono text-slate-800 dark:text-slate-200">CHECKIN</code>,{' '}
            <code className="font-mono text-slate-800 dark:text-slate-200">ESCALATED</code>, and{' '}
            <code className="font-mono text-slate-800 dark:text-slate-200">ALL_CLEAR</code>.
          </p>
        </div>
      </section>
    </div>
  );
}
