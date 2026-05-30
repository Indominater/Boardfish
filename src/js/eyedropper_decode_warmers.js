'use strict';

(() => {
  function currentEyedropperPointerEvent() {
    return _eyedropperLatestPointerEvent || _eyedropperLastMouseEvent || _eyedropperLastSampleEvent || null;
  }

  function currentEyedropperPointerWorldPoint() {
    const event = currentEyedropperPointerEvent();
    if (!event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    return clientToBoardWorldPoint(event.clientX, event.clientY);
  }

  function eyedropperImageFormatMultiplier(key) {
    const source = imageStore[key];
    const img = imageCache[key];
    const raw = [
      source?.mime,
      source?.ext,
      img?.type,
      typeof source === 'string' ? source.slice(0, 64) : '',
    ].filter(Boolean).join(' ').toLowerCase();
    if (raw.includes('avif') || raw.includes('heic') || raw.includes('heif')) return 2;
    if (raw.includes('webp')) return 1.5;
    if (raw.includes('png')) return 1.25;
    if (raw.includes('gif')) return 1.5;
    return 1;
  }

  function eyedropperDecodeImageSize(key) {
    const safeSource = eyedropperSafeImageCache.get(key)?.source || null;
    return imageSourceSize(imageBitmapCache[key] || imageCache[key] || safeSource || null);
  }

  function eyedropperDecodeCost(key) {
    const size = eyedropperDecodeImageSize(key);
    const naturalWidth = size.width;
    const naturalHeight = size.height;
    const formatMultiplier = eyedropperImageFormatMultiplier(key);
    return naturalWidth * naturalHeight * formatMultiplier;
  }

  function canEyedropperDecodeCachedPixels(key) {
    if (!key) return false;
    if (typeof hasTauri !== 'function' || !hasTauri() || !BoardfishTauri?.prewarmCachedImagePixels) return false;
    if (!globalThis.hasEyedropperNativePixelCacheSource?.(key)) return false;
    if (imageSourceCachePromises.has(key)) return false;
    const size = eyedropperDecodeImageSize(key);
    return size.width > 0 && size.height > 0;
  }

  function isEyedropperDecodeCandidate(obj) {
    const key = obj?.data?.imgKey;
    return !!(obj?.type === 'image' &&
      key &&
      canEyedropperDecodeCachedPixels(key) &&
      !indominaterGreedyEyedropperNativeDecodePrewarm.active.has(key) &&
      !indominaterGreedyEyedropperNativeDecodePrewarm.ready.has(key) &&
      !indominaterGreedyEyedropperNativeDecodePrewarm.failed.has(key));
  }

  function betterEyedropperDecodeCandidate(decoderId, candidate, best) {
    if (!best) return candidate;
    if (decoderId === 'd1') {
      if (candidate.distanceSq !== best.distanceSq) return candidate.distanceSq < best.distanceSq ? candidate : best;
      return candidate.order > best.order ? candidate : best;
    }
    if (candidate.decodeCost !== best.decodeCost) return candidate.decodeCost > best.decodeCost ? candidate : best;
    return candidate.order > best.order ? candidate : best;
  }

  function findEyedropperBackgroundDecodeCandidate(decoderId) {
    const pointer = decoderId === 'd1' ? currentEyedropperPointerWorldPoint() : null;
    if (decoderId === 'd1' && !pointer) return null;

    let best = null;
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      if (!isEyedropperDecodeCandidate(obj)) continue;
      const key = obj.data.imgKey;
      const candidate = {
        key,
        obj,
        decoderId,
        distanceSq: decoderId === 'd1' ? imageBoundsDistanceSqToWorldPoint(obj, pointer) : Infinity,
        decodeCost: eyedropperDecodeCost(key),
        token: eyedropperSafeImageToken(key),
        order: i,
      };
      best = betterEyedropperDecodeCandidate(decoderId, candidate, best);
    }
    return best;
  }

  function findEyedropperSamplerDecodeCandidate() {
    if (!eyedropperEnabled || !eyedropperSampling) return null;
    const event = _eyedropperLatestPointerEvent || _eyedropperLastSampleEvent || _eyedropperLastMouseEvent;
    if (!event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    const point = clientToBoardWorldPoint(event.clientX, event.clientY);
    const topObject = topObjectAtWorldPoint(point, objects, isEyedropperSampleObject);
    if (topObject?.type !== 'image') return null;
    if (!isEyedropperDecodeCandidate(topObject)) return null;
    const key = topObject.data.imgKey;
    return {
      key,
      obj: topObject,
      decoderId: 'd3',
      distanceSq: 0,
      decodeCost: eyedropperDecodeCost(key),
      token: eyedropperSafeImageToken(key),
      order: objects.indexOf(topObject),
    };
  }

  function findEyedropperDecodeCandidate(decoderId) {
    if (decoderId === 'd3') return findEyedropperSamplerDecodeCandidate();
    if (decoderId === 'd1' || decoderId === 'd2') return findEyedropperBackgroundDecodeCandidate(decoderId);
    return null;
  }

  function resetEyedropperDecodedImageKey(key) {
    if (!key) return;
    indominaterGreedyEyedropperNativeDecodePrewarm.ready.delete(key);
    indominaterGreedyEyedropperNativeDecodePrewarm.failed.delete(key);
    if (_eyedropperNativePixelTarget?.key === key && !_eyedropperNativePixelInFlight) _eyedropperNativePixelTarget = null;
  }

  function noteEyedropperImageSourceChanged(key, reason = 'image-source') {
    resetEyedropperDecodedImageKey(key);
    scheduleEyedropperNativeDecodePrewarm(reason);
  }

  function noteEyedropperImageAvailable(key = '', reason = 'image-available') {
    if (key) indominaterGreedyEyedropperNativeDecodePrewarm.failed.delete(key);
    scheduleEyedropperNativeDecodePrewarm(reason);
  }

  function noteEyedropperBoardContentChanged(reason = 'board-content') {
    scheduleEyedropperNativeDecodePrewarm(reason);
  }

  function startEyedropperImageDecode(decoderId, candidate, reason = 'decode') {
    const decoder = indominaterGreedyEyedropperNativeDecodePrewarm.decoders[decoderId];
    const key = candidate?.key;
    if (!decoder || decoder.running || !key || indominaterGreedyEyedropperNativeDecodePrewarm.active.has(key)) return false;

    decoder.running = true;
    decoder.key = key;
    const token = candidate.token || eyedropperSafeImageToken(key);
    indominaterGreedyEyedropperNativeDecodePrewarm.active.set(key, {
      decoderId,
      token,
      startedAt: performance.now(),
      reason,
    });
    EyedropperDebug._logSamplingEvent('decode-prewarm-start', {
      imgKey: key,
      decoderId,
      reason,
      sourceKind: 'native-pixel',
      decodeCost: candidate.decodeCost,
      distanceSq: Number.isFinite(candidate.distanceSq) ? candidate.distanceSq : '',
    });

    BoardfishTauri.prewarmCachedImagePixels(key)
      .then((result) => {
        const currentToken = eyedropperSafeImageToken(key);
        if (currentToken !== token) {
          EyedropperDebug._logSamplingEvent('decode-prewarm-discarded', {
            imgKey: key,
            decoderId,
            reason: 'token-changed',
          });
          return;
        }
        indominaterGreedyEyedropperNativeDecodePrewarm.ready.add(key);
        indominaterGreedyEyedropperNativeDecodePrewarm.failed.delete(key);
        EyedropperDebug._logSamplingEvent('decode-prewarm-ready', {
          imgKey: key,
          decoderId,
          cached: result?.cached ?? '',
          sourceW: result?.sourceW ?? '',
          sourceH: result?.sourceH ?? '',
          decodeMs: result?.decodeMs ?? '',
          totalMs: result?.totalMs ?? '',
        });
      })
      .catch((err) => {
        indominaterGreedyEyedropperNativeDecodePrewarm.ready.delete(key);
        indominaterGreedyEyedropperNativeDecodePrewarm.failed.set(key, String(err));
        EyedropperDebug._logReadbackFailure('decode-prewarm', {
          imgKey: key,
          decoderId,
          error: String(err),
        });
      })
      .finally(() => {
        indominaterGreedyEyedropperNativeDecodePrewarm.active.delete(key);
        decoder.running = false;
        decoder.key = '';
        if (eyedropperSampling) {
          if (_eyedropperLatestPointerEvent || _eyedropperLastSampleEvent) indominaterPumpEyedropperNativePixelQueue();
          pumpEyedropperDecodeWarmer('d3', 'decode-finished');
        }
        pumpEyedropperImageDecodeWarmup('decode-finished');
      });
    return true;
  }

  function pumpEyedropperDecodeWarmer(decoderId, reason = 'pump') {
    const decoder = indominaterGreedyEyedropperNativeDecodePrewarm.decoders[decoderId];
    if (!decoder || decoder.running) return false;
    const candidate = findEyedropperDecodeCandidate(decoderId);
    if (!candidate) return false;
    return startEyedropperImageDecode(decoderId, candidate, reason);
  }

  function pumpEyedropperImageDecodeWarmup(reason = 'pump') {
    const d1 = pumpEyedropperDecodeWarmer('d1', reason);
    const d2 = pumpEyedropperDecodeWarmer('d2', reason);
    return { d1, d2 };
  }

  function scheduleEyedropperImageDecodeWarmup(reason = 'change') {
    indominaterGreedyEyedropperNativeDecodePrewarm.pendingReasons.add(reason);
    if (indominaterGreedyEyedropperNativeDecodePrewarm.scheduled) {
      return { scheduled: false, pending: true, reason };
    }
    indominaterGreedyEyedropperNativeDecodePrewarm.scheduled = true;
    const schedule = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (callback) => setTimeout(callback, 0);
    schedule(() => {
      const reasons = [...indominaterGreedyEyedropperNativeDecodePrewarm.pendingReasons].join(',');
      indominaterGreedyEyedropperNativeDecodePrewarm.pendingReasons.clear();
      indominaterGreedyEyedropperNativeDecodePrewarm.scheduled = false;
      pumpEyedropperImageDecodeWarmup(reasons || reason);
      if (eyedropperSampling) pumpEyedropperDecodeWarmer('d3', reasons || reason);
    });
    return { scheduled: true, reason };
  }

  function scheduleEyedropperSamplerDecode(reason = 'sampler') {
    if (!eyedropperEnabled || !eyedropperSampling) return { scheduled: false, reason, dormant: true };
    const started = pumpEyedropperDecodeWarmer('d3', reason);
    return { scheduled: started, reason, dormant: false };
  }

  function scheduleEyedropperNativeDecodePrewarm(reason = 'viewport') {
    return scheduleEyedropperImageDecodeWarmup(reason);
  }

  Object.assign(globalThis, {
    resetEyedropperDecodedImageKey,
    noteEyedropperImageSourceChanged,
    noteEyedropperImageAvailable,
    noteEyedropperBoardContentChanged,
    scheduleEyedropperImageDecodeWarmup,
    scheduleEyedropperSamplerDecode,
    scheduleEyedropperNativeDecodePrewarm,
  });
})();
