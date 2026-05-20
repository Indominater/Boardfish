'use strict';

async function exportAllText() {
  const dbg = ExportDebug.start('exportAllText', { objectCount: objects.length });
  globalThis.BoardfishMotion?.applyActionAnimation?.('export-all-text');
  const textObjs = objects.filter((o) => o.type === 'text').sort((a, b) => b.z - a.z);
  if (!textObjs.length) { ExportDebug.end(dbg, { skipped: true, reason: 'no-text' }); return; }
  const releaseInputShield = acquireInputShield();

  const combined = textObjs.map((o) => o.data.content).join('\n\n');
  ExportDebug.step(dbg, 'combined', { textCount: textObjs.length, combinedLen: combined.length });

  if (hasTauri()) {
    try {
      const path = await ExportDebug.wrap(
        dbg,
        TAURI_COMMANDS.SAVE_TEXT_FILE_DIALOG,
        () => BoardfishTauri.saveTextFileDialog(),
        { textCount: textObjs.length }
      );
      ExportDebug.step(dbg, 'text:path-selected', { selected: !!path });
      if (!path) {
        globalThis.BoardfishMotion?.applyActionAnimation?.('file-dialog-cancel');
        releaseInputShield();
        ExportDebug.end(dbg, { saved: false, cancelled: true });
        return;
      }
      await runShieldedPillTask({
        releaseInputShield,
        successMessage: 'Text Exported',
        task: () => ExportDebug.wrap(
          dbg,
          TAURI_COMMANDS.WRITE_TEXT_FILE,
          () => BoardfishTauri.writeTextFile(path, combined),
          { textCount: textObjs.length, textLen: combined.length }
        ),
      });
      ExportDebug.end(dbg, { saved: true });
    } catch (err) {
      releaseInputShield();
      ExportDebug.end(dbg, { error: String(err) });
      console.error('Export all text failed:', err);
    }
    return;
  }

  const hex = BoardfishExportUtils.randomHex();
  const blob = new Blob([combined], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `text_${hex}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  releaseInputShield();
  ExportDebug.end(dbg, { saved: true, method: 'download', textCount: textObjs.length });
}
