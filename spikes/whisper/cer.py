#!/usr/bin/env python3
"""Compute Character Error Rate (CER) between a reference text and a hypothesis text.

CER = edit_distance(ref_chars, hyp_chars) / len(ref_chars)

Usage:
  python3 cer.py reference.txt hypothesis.txt
  python3 cer.py reference.txt - < hypothesis.txt   # hypothesis from stdin

Normalization applied before comparison (both ref and hyp):
  - all whitespace (spaces, newlines, tabs) removed
  - full-width and half-width punctuation kept as-is (whisper output often
    includes 。、 punctuation while the reference script may or may not,
    so by default punctuation is stripped for a fairer comparison; pass
    --keep-punct to disable this)
"""
import sys
import re

PUNCT_RE = re.compile(
    r"[\s、。，,．.！!？?「」『』（）()【】・　​]"
)


def normalize(text: str, keep_punct: bool = False) -> str:
    if keep_punct:
        return re.sub(r"\s+", "", text)
    return PUNCT_RE.sub("", text)


def edit_distance(a: str, b: str) -> int:
    n, m = len(a), len(b)
    if n == 0:
        return m
    if m == 0:
        return n
    prev = list(range(m + 1))
    for i in range(1, n + 1):
        curr = [i] + [0] * m
        ca = a[i - 1]
        for j in range(1, m + 1):
            cost = 0 if ca == b[j - 1] else 1
            curr[j] = min(
                prev[j] + 1,       # deletion
                curr[j - 1] + 1,   # insertion
                prev[j - 1] + cost,  # substitution
            )
        prev = curr
    return prev[m]


def cer(ref: str, hyp: str, keep_punct: bool = False):
    ref_n = normalize(ref, keep_punct)
    hyp_n = normalize(hyp, keep_punct)
    dist = edit_distance(ref_n, hyp_n)
    rate = dist / len(ref_n) if ref_n else float("nan")
    return rate, dist, len(ref_n), len(hyp_n)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    ref_path, hyp_path = sys.argv[1], sys.argv[2]
    keep_punct = "--keep-punct" in sys.argv

    with open(ref_path, encoding="utf-8") as f:
        ref = f.read()

    if hyp_path == "-":
        hyp = sys.stdin.read()
    else:
        with open(hyp_path, encoding="utf-8") as f:
            hyp = f.read()

    rate, dist, ref_len, hyp_len = cer(ref, hyp, keep_punct)
    print(f"ref_chars={ref_len} hyp_chars={hyp_len} edit_distance={dist} CER={rate:.4f}")


if __name__ == "__main__":
    main()
