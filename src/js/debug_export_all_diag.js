'use strict';

// ─── Export-all diagnostic ────────────────────────────────────────────────────
// Usage (DevTools console):
//   await BoardfishDebug.exportAllDiag.run()
//
// Probes the Windows-safe Export All Images flow.
// The expected order is:
//   1) pick_folder opens before image rendering/cache registration
//   2) images are resolved to native cache keys sequentially
//   3) save_images_to_existing_folder_by_keys writes those keys to the picked folder
//
var ExportAllDiag = (() => {
  const WARN_MB  = 10;   // yellow warning
  const FATAL_MB = 50;   // likely fatal on Windows WebView2

  let _last = null;

  function mb(bytes) { return Math.round(bytes / 1024 / 1024 * 100) / 100; }
  function ms(t0)    { return Math.round((performance.now() - t0) * 10) / 10; }
  function pushTop(list, row, scoreKey, limit) {
    list.push(row);
    list.sort((a, b) => Number(b[scoreKey] || 0) - Number(a[scoreKey] || 0));
    if (list.length > limit) list.length = limit;
  }
  function pushSample(list, row, limit) {
    if (list.length < limit) list.push(row);
  }

  async function run(options = {}) {
    const sampleLimit = Math.max(1, Math.min(25, Number(options.sampleLimit) || 8));
    const full = options.full === true;
    if (!hasTauri()) {
      console.warn('[exportAllDiag] Not inside Tauri — aborting.');
      return null;
    }

    const imageObjs = (typeof objects !== 'undefined')
      ? [...objects].filter(o => o.type === 'image')
      : [];

    if (!imageObjs.length) {
      console.warn('[exportAllDiag] No image objects on this board.');
      return null;
    }

    console.group(`%c[exportAllDiag] Diagnosing export of ${imageObjs.length} image(s) — IS_WIN=${IS_WIN}`,
      'font-weight:bold');

    console.group('Phase 1: classify images without rendering');
    const perImage = full ? [] : undefined;
    const largestStored = [];
    const missingSources = [];
    const duplicateKeys = [];
    const seenKeys = new Map();
    let nativeRefCount = 0;
    let dataUrlCount = 0;
    let needsRenderCount = 0;
    let totalBytes = 0;

    for (let i = 0; i < imageObjs.length; i++) {
      const obj = imageObjs[i];
      const imgKey = obj.data?.imgKey ?? '?';
      const needsRender = imageNeedsRendering(obj);
      const bytes = imageStoreBytesEstimate(imageStore[obj.data?.imgKey]);
      const kb = Math.round(bytes / 1024 * 10) / 10;
      totalBytes += bytes;
      if (needsRender) needsRenderCount++;
      if (isNativeImageRef(imageStore[obj.data?.imgKey])) nativeRefCount++;
      else if (typeof imageStore[obj.data?.imgKey] === 'string') dataUrlCount++;
      else pushSample(missingSources, { index: i, objectId: obj.id, imgKey }, sampleLimit);
      if (imgKey) {
        const prev = seenKeys.get(imgKey) || 0;
        if (prev === 1) pushSample(duplicateKeys, imgKey, sampleLimit);
        seenKeys.set(imgKey, prev + 1);
      }

      const row = { index: i, imgKey, needsRender, renderMs: 0, kb, ok: true, error: undefined };
      if (full) perImage.push(row);
      pushTop(largestStored, { index: i, objectId: obj.id, imgKey, needsRender, storedMB: mb(bytes) }, 'storedMB', sampleLimit);
    }

    const totalMB = mb(totalBytes);
    const severity = totalMB > FATAL_MB ? 'FATAL' : totalMB > WARN_MB ? 'WARN' : 'OK';
    const severityStyle = severity === 'FATAL' ? 'color:red;font-weight:bold' : severity === 'WARN' ? 'color:orange;font-weight:bold' : 'color:green';
    console.log(`%cEstimated stored payload: ${totalMB} MB | severity=${severity}`, severityStyle);
    if (severity === 'FATAL') console.error('[exportAllDiag] Payload almost certainly exceeds Tauri/WebView2 IPC limit on Windows');
    else if (severity === 'WARN') console.warn('[exportAllDiag] Payload is large — may intermittently hit IPC limits on Windows');
    console.table([{
      imageCount: imageObjs.length,
      needsRenderCount,
      passthroughCount: imageObjs.length - needsRenderCount,
      nativeRefCount,
      dataUrlCount,
      missingSourceSamples: missingSources.length,
      duplicateKeySamples: duplicateKeys.length,
      totalMB,
      severity,
    }]);
    console.table(largestStored);
    console.groupEnd();

    console.group('Phase 2: pick folder first');
    const pickStart = performance.now();
    let folder = null, pickOk = false, pickErr = null;
    try {
      folder = await tauriInvoke(TAURI_COMMANDS.PICK_FOLDER);
      pickOk = true;
    } catch (e) {
      pickErr = String(e);
    }
    const pickMs = ms(pickStart);
    console.log(`  pick_folder completed in ${pickMs}ms  ok=${pickOk}  picked=${!!folder}${pickErr ? '  ERR:'+pickErr : ''}`);
    console.groupEnd();

    const keyProbe = full ? [] : undefined;
    const keyProbeSlowest = [];
    const keyProbeErrors = [];
    const tempKeys = [];
    let renderedCount = 0;
    let saveProbe = null;
    if (pickOk && folder) {
      console.group('Phase 3: sequential key resolution');
      const keys = [];
      for (let i = 0; i < imageObjs.length; i++) {
        const obj = imageObjs[i];
        const imgKey = obj.data?.imgKey;
        const needsRender = imageNeedsRendering(obj);
        const t0 = performance.now();
        let key = null, ok = false, err = null;
        try {
          if (needsRender) {
            const dataUrl = await getRenderedImageDataUrl(obj, null);
            if (dataUrl) {
              key = `__export_diag_tmp_${obj.id}`;
              tempKeys.push(key);
              renderedCount++;
              await tauriInvoke(TAURI_COMMANDS.REGISTER_IMAGE_SOURCE, { imgKey: key, dataUrl });
            }
          } else {
            await cacheImageSourceForSave(imgKey, imageStore[imgKey]);
            key = imgKey;
          }
          ok = !!key;
          if (key) keys.push(key);
        } catch (e) {
          err = String(e);
        }
        const row = { index: i, imgKey, key, needsRender, ms: ms(t0), ok, error: err ?? '' };
        if (full) keyProbe.push(row);
        pushTop(keyProbeSlowest, row, 'ms', sampleLimit);
        if (err || !ok) pushSample(keyProbeErrors, row, sampleLimit);
        if ((i + 1) % 50 === 0 || i === imageObjs.length - 1) {
          console.log(`  resolved ${i + 1}/${imageObjs.length}; keys=${keys.length}; rendered=${renderedCount}; errors=${keyProbeErrors.length}`);
        }
      }
      console.table(keyProbeSlowest);
      if (keyProbeErrors.length) console.table(keyProbeErrors);
      console.groupEnd();

      console.group('Phase 4: save picked folder by keys');
      const saveStart = performance.now();
      let savedCount = 0, saveOk = false, saveErr = null;
      try {
        savedCount = await tauriInvoke(TAURI_COMMANDS.SAVE_IMAGES_TO_EXISTING_FOLDER_BY_KEYS, { folder, imgKeys: keys });
        saveOk = true;
      } catch (e) {
        saveErr = String(e);
      } finally {
        BoardfishExportUtils.cleanupTempKeys(tempKeys);
      }
      saveProbe = { keyCount: keys.length, savedCount, saveMs: ms(saveStart), saveOk, error: saveErr ?? '' };
      console.log(`  save_images_to_existing_folder_by_keys keyCount=${keys.length} saved=${savedCount} ${saveProbe.saveMs}ms ok=${saveOk}${saveErr ? ' ERR:'+saveErr : ''}`);
      console.groupEnd();
    } else {
      console.warn('[exportAllDiag] Folder picker was cancelled or failed; skipped key resolution and saving.');
    }

    const report = {
      mode: 'keyed-folder-first',
      isWindows: IS_WIN,
      imageCount: imageObjs.length,
      totalStoredPayloadMB: totalMB,
      payloadSeverity: severity,
      compact: !full,
      folderPickedBeforeKeyResolution: !!folder,
      pickProbe: { pickMs, pickOk, picked: !!folder, error: pickErr ?? '' },
      keyProbe,
      keyProbeSlowest,
      keyProbeErrors,
      renderedCount,
      tempKeyCount: tempKeys.length,
      saveProbe,
      perImage,
      largestStored,
      missingSources,
      duplicateKeys,
    };
    console.group('Full report');
    if (full) {
      console.table(report.perImage);
      console.table(report.keyProbe);
    } else {
      console.table(report.largestStored);
      console.table(report.keyProbeSlowest);
      if (report.keyProbeErrors.length) console.table(report.keyProbeErrors);
    }
    if (report.saveProbe) console.table([report.saveProbe]);
    console.log('Full report → BoardfishDebug.exportAllDiag.last');
    console.groupEnd();
    console.groupEnd();

    _last = report;
    return report;
  }

  return {
    run,
    get last() { return _last; },
  };
})();

exposeDebug({ exportAllDiag: ExportAllDiag });
