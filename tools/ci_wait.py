#!/usr/bin/env python3
"""docs/43 M26: wait until a GitHub Actions run is REALLY finished before calling it green.

Run 39801527607 was read while the jobs API still listed 2 of 14 jobs as "in_progress" (a snapshot taken before
the queued jobs had finished), so this script does not trust a single read. It polls the public REST API with no
token (the repo is public) until run.status == "completed", every job has a conclusion, and the job count matches
--expect. Exit 0 = all success, 1 = finished but not green, 2 = timed out still running.

  python3 tools/ci_wait.py --repo pf-sjtu/reelkiln --sha <commit> [--expect 14] [--timeout 3600]
  python3 tools/ci_wait.py --selftest
"""
import argparse, json, os, sys, time, urllib.request

API = "https://api.github.com"


def get(url):
    h = {"Accept": "application/vnd.github+json", "User-Agent": "reelkiln-ci-wait"}
    if os.environ.get("GH_TOKEN"):  # optional: the anonymous API limit is 60 requests/hour per IP
        h["Authorization"] = "Bearer " + os.environ["GH_TOKEN"]
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def verdict(run, jobs, expect):
    """-> ("running"|"green"|"red", detail). A run is settled only when it AND every job say so."""
    if not run or run.get("status") != "completed":
        return "running", f"run status {run and run.get('status')}"
    open_jobs = [j["name"] for j in jobs if j.get("status") != "completed" or not j.get("conclusion")]
    if open_jobs:
        return "running", f"jobs not settled: {open_jobs}"
    if expect and len(jobs) != expect:
        return "running", f"{len(jobs)} jobs listed, expected {expect}"
    bad = [f"{j['name']}={j['conclusion']}" for j in jobs if j["conclusion"] not in ("success", "skipped")]
    if bad or run.get("conclusion") != "success":
        return "red", f"run {run.get('conclusion')}; {bad}"
    return "green", f"{len(jobs)}/{len(jobs)} jobs success"


def selftest():
    j = lambda n, s="completed", c="success": {"name": n, "status": s, "conclusion": c}
    done = {"status": "completed", "conclusion": "success"}
    assert verdict({"status": "in_progress"}, [], 2)[0] == "running"
    assert verdict(done, [j("a"), j("b", "in_progress", None)], 2)[0] == "running"
    assert verdict(done, [j("a")], 2)[0] == "running"
    assert verdict(done, [j("a"), j("b")], 2) == ("green", "2/2 jobs success")
    assert verdict({"status": "completed", "conclusion": "failure"}, [j("a"), j("b", c="failure")], 2)[0] == "red"
    print("selftest ok")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default="pf-sjtu/reelkiln")
    ap.add_argument("--sha"); ap.add_argument("--run-id", type=int)
    ap.add_argument("--expect", type=int, default=14)
    ap.add_argument("--timeout", type=int, default=3600); ap.add_argument("--every", type=int, default=30)
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    deadline = time.time() + a.timeout
    while True:
        run = None
        try:
            if a.run_id:
                run = get(f"{API}/repos/{a.repo}/actions/runs/{a.run_id}")
            else:
                runs = get(f"{API}/repos/{a.repo}/actions/runs?head_sha={a.sha}&per_page=5").get("workflow_runs", [])
                run = runs[0] if runs else None
            jobs = get(f"{API}/repos/{a.repo}/actions/runs/{run['id']}/jobs?per_page=100")["jobs"] if run else []
            state, detail = verdict(run, jobs, a.expect)
        except Exception as e:  # rate limit / network: keep polling
            state, detail = "running", f"poll error {e}"
        print(time.strftime("%H:%M:%S"), state, (run or {}).get("id"), detail, flush=True)
        if state != "running":
            sys.exit(0 if state == "green" else 1)
        if time.time() > deadline:
            sys.exit(2)
        time.sleep(a.every)


if __name__ == "__main__":
    main()
