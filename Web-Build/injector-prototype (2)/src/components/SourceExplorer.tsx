import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, FileCode2, FileText, Search } from 'lucide-react';
import { ANDROID_PROJECT_FILES, type AndroidProjectFile } from '../core/androidProjectFiles';
import { hapticTap } from '../utils/haptics';

interface SourceExplorerProps {
  onDownloadProject: () => void;
  selectedFileId?: string;
}

const GROUPS: AndroidProjectFile['group'][] = [
  'Kotlin Sources',
  'Manifest & XML',
  'Gradle Config',
];

export function SourceExplorer({ onDownloadProject, selectedFileId }: SourceExplorerProps) {
  const [selectedId, setSelectedId] = useState<string>(
    selectedFileId ?? ANDROID_PROJECT_FILES[0].id,
  );
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedFileId) {
      setSelectedId(selectedFileId);
    }
  }, [selectedFileId]);

  const filteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ANDROID_PROJECT_FILES;
    return ANDROID_PROJECT_FILES.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.path.toLowerCase().includes(q) ||
        f.summary.toLowerCase().includes(q),
    );
  }, [search]);

  const activeFile =
    ANDROID_PROJECT_FILES.find((f) => f.id === selectedId) ?? ANDROID_PROJECT_FILES[0];

  const lines = useMemo(() => activeFile.content.replace(/\n$/, '').split('\n'), [activeFile]);

  const handleCopy = async () => {
    hapticTap();
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setCopiedId(activeFile.id);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Clipboard blocked in non-secure context
    }
  };

  const handleDownloadSingle = () => {
    hapticTap();
    const blob = new Blob([activeFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.name.split('/').pop() ?? activeFile.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[290px_minmax(0,1fr)]">
      {/* Left file tree */}
      <aside className="flex flex-col rounded-xl border border-slate-200 bg-white dark:border-[#1B2230] dark:bg-[#0C1017]">
        <div className="border-b border-slate-200 p-3 sm:p-4 dark:border-[#1B2230]">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-[#D4DCE6]">
              Project Files
            </h2>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {ANDROID_PROJECT_FILES.length} files
            </span>
          </div>
          <div className="relative mt-3">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter files..."
              aria-label="Filter Android project files"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none dark:border-[#1E2636] dark:bg-[#07090D] dark:text-[#D4DCE6] dark:placeholder:text-slate-500 dark:focus:border-slate-600"
            />
          </div>
        </div>

        <div className="max-h-[260px] lg:max-h-[620px] flex-1 overflow-y-auto p-2">
          {GROUPS.map((group) => {
            const items = filteredFiles.filter((f) => f.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} className="mb-3 last:mb-0">
                <p className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  {group}
                </p>
                <div className="space-y-0.5">
                  {items.map((file) => {
                    const isActive = file.id === activeFile.id;
                    return (
                      <button
                        key={file.id}
                        type="button"
                        onClick={() => {
                          hapticTap();
                          setSelectedId(file.id);
                        }}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                          isActive
                            ? 'bg-slate-900 font-semibold text-white dark:bg-[#182030] dark:text-[#E2E8F0]'
                            : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-[#131924] dark:hover:text-[#D4DCE6]'
                        }`}
                      >
                        {file.language === 'kotlin' ? (
                          <FileCode2
                            className={`h-3.5 w-3.5 shrink-0 ${
                              isActive ? 'text-sky-300' : 'text-blue-600 dark:text-sky-400'
                            }`}
                            aria-hidden="true"
                          />
                        ) : (
                          <FileText
                            className={`h-3.5 w-3.5 shrink-0 ${
                              isActive ? 'text-slate-300' : 'text-slate-400'
                            }`}
                            aria-hidden="true"
                          />
                        )}
                        <span className="truncate font-mono">{file.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {filteredFiles.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-slate-500">
              No files match &ldquo;{search}&rdquo;.
            </p>
          )}
        </div>
      </aside>

      {/* Right full code viewer */}
      <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#1B2230] dark:bg-[#0C1017]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-[#1B2230]">
          <div className="min-w-0">
            <h3 className="truncate font-mono text-sm font-semibold text-slate-900 dark:text-[#D4DCE6]">
              {activeFile.path}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {activeFile.summary}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-[#222B3B] dark:bg-[#07090D] dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-[#131924] dark:hover:text-[#D4DCE6] whitespace-nowrap"
            >
              {copiedId === activeFile.id ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Copy File</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownloadSingle}
              className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-[#222B3B] dark:bg-[#07090D] dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-[#131924] dark:hover:text-[#D4DCE6] whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Save File</span>
            </button>

            <button
              type="button"
              onClick={onDownloadProject}
              className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Download All (.zip)</span>
            </button>
          </div>
        </div>

        <div className="max-h-[620px] overflow-auto bg-slate-50 p-4 font-mono text-xs leading-relaxed dark:bg-[#06080B]">
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((line, index) => (
                <tr key={index} className="hover:bg-slate-200/40 dark:hover:bg-slate-800/35">
                  <td className="w-11 pr-4 text-right align-top text-slate-400 select-none tabular-nums dark:text-slate-600">
                    {index + 1}
                  </td>
                  <td className="whitespace-pre text-slate-800 dark:text-[#C5D0DF]">
                    {line || ' '}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
