#!/usr/bin/env python3
"""PORT-NEW (docs/20 §3.4): machine-checkable acceptance for main-flow scenario S1.

  python3 tools/accept_check.py JOB_DIR [--inputs FIXTURE_DIR] [--userdata UD --session SID]
                                [--export EXPORTED.mp4] [--attachments]

Engine-level criteria (E*) only need JOB_DIR; app-level criteria (A*) additionally read the
port's userData (sessions.json / versions.json). Anything that cannot be evaluated is reported
"pending", never "pass". docs/22: A3 also requires the approval in versions.json (a final record
for v1 with madeFinalAtMs); --export checks the file:saveItemAs copy (X1: same bytes as v1 +
ffprobe-playable); --attachments checks S1-L2 (L2: every fixture input was materialized by the
attachment path into JOB_DIR/incoming/ byte-identical). Prints one JSON object; exit 0 iff every
evaluated criterion passed and none is pending (use --engine-only to evaluate E* alone).
"""
import argparse, hashlib, json, re, subprocess, sys
from pathlib import Path

def sh(*a):
    p = subprocess.run(a, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr

def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("job"); ap.add_argument("--inputs"); ap.add_argument("--engine-only", action="store_true")
    ap.add_argument("--userdata"); ap.add_argument("--session"); ap.add_argument("--export"); ap.add_argument("--attachments", action="store_true")
    a = ap.parse_args()
    J = Path(a.job); F = J / "final.mp4"; res = {}
    def put(k, ok, detail=""): res[k] = {"ok": bool(ok), "detail": detail}
    put("E1_final_exists", F.is_file() and F.stat().st_size > 0, str(F))
    if not F.is_file():
        print(json.dumps(res, indent=1)); sys.exit(1)
    rc, out, err = sh("ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(F))
    put("E2_ffprobe_exit0", rc == 0, err.strip()[:200])
    info = json.loads(out or "{}"); st = info.get("streams", [])
    v = [s for s in st if s.get("codec_type") == "video"]; au = [s for s in st if s.get("codec_type") == "audio"]
    put("E3_one_h264_video", len(v) == 1 and v[0].get("codec_name") == "h264" and v[0].get("pix_fmt") in ("yuv420p", "yuvj420p"),
        f"{[(s.get('codec_name'), s.get('pix_fmt')) for s in v]}")
    if v:
        w, h = int(v[0]["width"]), int(v[0]["height"])
        put("E4_vertical_9x16", (w, h) in ((720, 1280), (1080, 1920)), f"{w}x{h}")
        put("E5_fps_30", v[0].get("r_frame_rate") == "30/1", v[0].get("r_frame_rate"))
    put("E6_one_aac_audio", len(au) == 1 and au[0].get("codec_name") == "aac", f"{[s.get('codec_name') for s in au]}")
    dur = float(info.get("format", {}).get("duration", 0))
    put("E7_duration_6.5s", abs(dur - 6.5) <= 0.25, f"{dur:.3f}s")
    rc, _, err = sh("ffmpeg", "-v", "error", "-i", str(F), "-f", "null", "-")
    put("E8_full_decode_clean", rc == 0 and not err.strip(), err.strip()[:200])
    _, _, err = sh("ffmpeg", "-hide_banner", "-i", str(F), "-vf", "blackdetect=d=0.5:pix_th=0.1", "-an", "-f", "null", "-")
    put("E9_no_black_segments", "black_start" not in err)
    _, _, err = sh("ffmpeg", "-hide_banner", "-i", str(F), "-vf", "scdet=threshold=10:sc_pass=1,metadata=print", "-an", "-f", "null", "-")
    cuts = [float(x) for x in re.findall(r"lavfi\.scd\.time: ([0-9.]+)", err)]
    ok = len(cuts) == 2 and abs(cuts[0] - 2.5) <= 0.2 and abs(cuts[1] - 4.5) <= 0.2
    put("E10_cuts_at_2.5_4.5", ok, f"cuts={cuts}")
    def band(f):
        _, _, e = sh("ffmpeg", "-hide_banner", "-i", str(F), "-vn", "-af", f"bandpass=f={f}:width_type=q:w=20,volumedetect", "-f", "null", "-")
        m = re.search(r"mean_volume: (-?[0-9.]+) dB", e); return float(m.group(1)) if m else -999.0
    b330, b440 = band(330), band(440)
    put("E11_music_bed_is_audio", b330 > -30 and b330 - b440 >= 12, f"330Hz={b330}dB 440Hz={b440}dB")
    man = J / "render-manifest.json"
    if man.is_file():
        m = json.loads(man.read_text())
        put("E12_render_manifest_binds_final", m.get("output", {}).get("sha256") == sha(F) and m.get("output", {}).get("path") == "final.mp4", m.get("schema"))
    else:
        put("E12_render_manifest_binds_final", False, "missing render-manifest.json")
    ev = []
    rl = J / "run.log.jsonl"
    if rl.is_file():
        for line in rl.read_text().splitlines():
            try: ev.append(json.loads(line))
            except Exception: pass
    names = [e.get("event") for e in ev]
    put("E13_runlog_assemble_compose", names.count("beat_assembled") == 3 and "timeline_assembled" in names and "render_completed" in names, f"{names}")
    spend = sum(float(e.get("estimate_usd") or 0) for e in ev)
    put("E14_zero_spend", spend == 0.0, f"sum(estimate_usd)={spend}")
    if a.inputs:
        sums = dict(reversed(l.split()) for l in (Path(a.inputs) / "SHA256SUMS").read_text().splitlines())
        ok = all(sha(Path(a.inputs) / n) == h for n, h in sums.items())
        put("E15_inputs_untouched", ok, "originals unchanged")
    if not a.engine_only:
        pend = lambda k, why: res.__setitem__(k, {"ok": None, "detail": "pending: " + why})
        vdir = J / "versions"
        v1 = vdir / "v1.mp4"
        if v1.is_file():
            put("A1_version_v1_minted", sha(v1) == sha(F), str(v1))
        else:
            pend("A1_version_v1_minted", "VersionStore not ported (versions/v1.mp4 absent)")
        if a.userdata and a.session:
            reg = Path(a.userdata) / "sessions.json"
            try:
                data = json.loads(reg.read_text()); s = next(x for x in data.get("sessions", []) if x.get("sessionId") == a.session)
                put("A2_session_bound_to_job", s.get("jobId") == J.name, f"jobId={s.get('jobId')}")
                if "finalizedAtMs" in s:
                    try:
                        vs = json.loads((Path(a.userdata) / "versions.json").read_text()).get(J.name, {})
                        fin = [f for f in vs.get("finals", []) if f.get("n") == 1 and isinstance(f.get("madeFinalAtMs"), (int, float))]
                        v1rec = next((v for v in vs.get("versions", []) if v.get("n") == 1), None)
                        okv = bool(fin) and v1.is_file() and fin[-1].get("qaSha256") == sha(v1)
                        put("A3_version_approved", okv, f"finalizedAtMs={s['finalizedAtMs']} finals(v1)={len(fin)} madeFinalAtMs={fin[-1].get('madeFinalAtMs') if fin else None} v1Recorded={bool(v1rec)}")
                    except Exception as e:
                        put("A3_version_approved", False, f"finalizedAtMs set but versions.json unreadable ({type(e).__name__})")
                else: pend("A3_version_approved", "no finalizedAtMs on session meta")
            except Exception as e:
                pend("A2_session_bound_to_job", f"registry unreadable or session absent ({type(e).__name__})")
        else:
            pend("A2_session_bound_to_job", "--userdata/--session not given")
    if a.export:
        X = Path(a.export); v1 = J / "versions" / "v1.mp4"
        if X.is_file() and v1.is_file():
            rc, out, err = sh("ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height", "-of", "json", str(X))
            d = float(json.loads(out or "{}").get("format", {}).get("duration", 0) or 0)
            put("X1_export_copy_playable", sha(X) == sha(v1) and rc == 0 and abs(d - 6.5) <= 0.25, f"sha==v1:{sha(X) == sha(v1)} ffprobe_rc={rc} duration={d}")
        else:
            put("X1_export_copy_playable", False, f"missing {X if not X.is_file() else v1}")
    if a.attachments:
        inc = J / "incoming"
        if a.inputs and inc.is_dir():
            sums = dict(reversed(l.split()) for l in (Path(a.inputs) / "SHA256SUMS").read_text().splitlines())
            got = {p.name: sha(p) for p in inc.iterdir() if p.is_file()}
            put("L2_attachments_materialized", all(got.get(n) == h for n, h in sums.items()), f"incoming={sorted(got)}")
        else:
            put("L2_attachments_materialized", False, f"no {inc} (or --inputs missing)")
    failed = [k for k, r in res.items() if r["ok"] is False]
    pending = [k for k, r in res.items() if r["ok"] is None]
    print(json.dumps({"failed": failed, "pending": pending, "results": res}, indent=1))
    sys.exit(0 if not failed and not pending else 1)

if __name__ == "__main__":
    main()
