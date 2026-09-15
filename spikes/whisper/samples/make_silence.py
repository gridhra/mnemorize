#!/usr/bin/env python3
"""Generate silent / padded WAV files for whisper.cpp spike testing.

Usage:
  python3 make_silence.py silence 10 sample_b_silence.wav
  python3 make_silence.py pad sample_a.wav 3 3 sample_c_padded.wav
"""
import sys
import wave
import struct


def write_silence(path, seconds, framerate=16000):
    n_frames = int(seconds * framerate)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(framerate)
        w.writeframes(b"\x00\x00" * n_frames)


def pad_with_silence(src_path, lead_seconds, trail_seconds, dst_path):
    with wave.open(src_path, "rb") as r:
        params = r.getparams()
        frames = r.readframes(r.getnframes())
    framerate = params.framerate
    sampwidth = params.sampwidth
    nchannels = params.nchannels
    silence_frame = b"\x00" * (sampwidth * nchannels)
    lead = silence_frame * int(lead_seconds * framerate)
    trail = silence_frame * int(trail_seconds * framerate)
    with wave.open(dst_path, "wb") as w:
        w.setnchannels(nchannels)
        w.setsampwidth(sampwidth)
        w.setframerate(framerate)
        w.writeframes(lead + frames + trail)


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "silence":
        seconds = float(sys.argv[2])
        out = sys.argv[3]
        write_silence(out, seconds)
        print(f"wrote {out}: {seconds}s silence")
    elif mode == "pad":
        src = sys.argv[2]
        lead = float(sys.argv[3])
        trail = float(sys.argv[4])
        out = sys.argv[5]
        pad_with_silence(src, lead, trail, out)
        print(f"wrote {out}: {src} padded with {lead}s lead / {trail}s trail")
    else:
        print("unknown mode", mode)
        sys.exit(1)
