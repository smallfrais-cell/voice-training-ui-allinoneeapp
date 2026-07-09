"""Analyzer launcher with a more forgiving resonance fallback.

The main analyzer is intentionally strict about vowel-core formants. That is good for
clean clips, but short/browser-recorded takes can fail the stability/loudness gates and
leave F1/F2/F3 as null. This wrapper keeps the main analyzer unchanged, but patches the
formant picker with a fallback before calling its normal CLI entry point.
"""

from __future__ import annotations

import math
import statistics

import numpy as np
from parselmouth.praat import call

import analyze as base

_original_vowel_formants = base.vowel_formants


def robust_vowel_formants(sound, pitch) -> dict[int, float | None]:
    """Use the strict vowel-core formants first, then fall back to voiced medians.

    The original method is best when it finds enough loud, stable vowel nuclei. When
    it does not, the dashboard used to show blank resonance gauges. For practice
    takes, a rough-but-present estimate is better than nothing, so the fallback uses
    median F1/F2/F3 over plausible voiced frames.
    """
    strict = _original_vowel_formants(sound, pitch)
    if strict.get(2) is not None and strict.get(3) is not None:
        return strict

    fallback = fallback_formants(sound, pitch)
    return {
        1: strict.get(1) if strict.get(1) is not None else fallback.get(1),
        2: strict.get(2) if strict.get(2) is not None else fallback.get(2),
        3: strict.get(3) if strict.get(3) is not None else fallback.get(3),
    }


def fallback_formants(sound, pitch) -> dict[int, float | None]:
    f0s = pitch.selected_array["frequency"]
    ts = pitch.xs()
    voiced_ts = [float(t) for t, f in zip(ts, f0s) if f > 0]
    if not voiced_ts:
        return {1: None, 2: None, 3: None}

    max_frames = 500
    if len(voiced_ts) > max_frames:
        step = len(voiced_ts) / max_frames
        voiced_ts = [voiced_ts[int(i * step)] for i in range(max_frames)]

    best: dict[int, list[float]] | None = None
    best_spread = float("inf")

    for ceiling in (base.FORMANT_CEILING, 5000.0, 6000.0):
        rows = measure_formants(sound, voiced_ts, ceiling)
        if len(rows[2]) < 3:
            continue
        spread = statistics.pstdev(rows[2]) if len(rows[2]) > 1 else float("inf")
        if spread < best_spread:
            best_spread = spread
            best = rows

    if best is None:
        return {1: None, 2: None, 3: None}

    return {n: (statistics.median(best[n]) if best[n] else None) for n in (1, 2, 3)}


def measure_formants(sound, times: list[float], ceiling: float) -> dict[int, list[float]]:
    formant = call(sound, "To Formant (burg)", 0.0, 5, ceiling, 0.025, 50)
    out: dict[int, list[float]] = {1: [], 2: [], 3: []}

    for t in times:
        vals: list[float] = []
        ok = True
        for n in (1, 2, 3):
            v = formant.get_value_at_time(n, t)
            if math.isnan(v) or math.isinf(v) or v <= 0:
                ok = False
                break
            vals.append(float(v))

        if not ok:
            continue

        f1, f2, f3 = vals
        if not (150.0 <= f1 <= 1200.0):
            continue
        if not (600.0 <= f2 <= 3200.0):
            continue
        if not (1400.0 <= f3 <= 4500.0):
            continue

        out[1].append(f1)
        out[2].append(f2)
        out[3].append(f3)

    return out


base.vowel_formants = robust_vowel_formants


if __name__ == "__main__":
    base.main()
