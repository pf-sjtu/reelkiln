# 06a · 顶层常量全量清单（自动生成）

> 由 `tools/consts.py` 从 `app/reconstructed/` 中抽取所有顶层 `const SCREAMING_CASE = …`（共 1014 条）。值超过 14 行或未在 14 行内闭合的标注“多行”，请以源文件为准。值中的 `|` 已转义。**全部为 verified 原文**（仅压缩空白）。


## `main/chunks/workbookContents-ChzKjQX1.js`

| 常量 | 行 | 值 |
|---|---|---|
| `SPEND_APPROVAL_PENDING_CODE` | 17 | `"SPEND_APPROVAL_PENDING"` |
| `SPEND_AUTHORITY_REQUIRED_CODE` | 18 | `"SPEND_AUTHORITY_REQUIRED"` |
| `MANAGED_DEVELOPMENT` | 19 | `false` |
| `PROD_GATEWAY_URL` | 20 | `"https://videoclaw-gw-650303209435.us-central1.run.app"` |
| `STAGING_GATEWAY_URL` | 21 | `"".trim()` |
| `STAGING_APP_NAME` | 22 | `"Videoclaw Staging"` |
| `DEV_APP_NAME` | 23 | `"Videoclaw Dev"` |
| `KEY_METER_PATH` | 108 | `"/v1/me"` |
| `ANTHROPIC_PASSTHROUGH_PATH` | 140 | `"/anthropic/v1/messages"` |
| `ANTHROPIC_CLIENT_JOB_HEADER` | 144 | `"X-VideoClaw-Client-Job"` |
| `CLIENT_JOB_ID_RE` | 145 | `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/` |
| `ALPHA_TERMS_VERSION` | 152 | `"alpha-2026-08-17"` |
| `ACCOUNT_PATH` | 156 | `"/v1/account"` |
| `ACCOUNT_CONSENT_PATH` | 157 | `"/v1/account/consent"` |
| `ACCOUNT_KEY_PATH` | 158 | `"/v1/account/key"` |
| `ACCOUNT_KEY_CLAIM_PATH` | 159 | `"/v1/account/key/claim"` |
| `ACCOUNT_KEY_ACCESS_PATH` | 160 | `"/v1/account/key/access"` |
| `ACCOUNT_ACQUISITION_PATH` | 161 | `"/v1/account/acquisition"` |
| `ACCOUNT_CAPABILITIES` | 162 | `["onboarding_preview", "nightly_updates"]` |
| `VERIFY_BACKOFF_MS` | 215 | `[2e3, 5e3, 15e3, 6e4]` |
| `ACCOUNT_BLOCKED_COPY` | 278 | `"Sign in to your Videoclaw account to keep generating. Your projects are all still here."` |
| `UNREADABLE_VAULT_COPY` | 280 | `"Videoclaw needs to refresh a saved login on this Mac. Continue with Google or email below. Your videos and projects are untouched, and the old encrypted login will be kept as a private backup."` |
| `INSECURE_STORAGE_COPY` | 282 | `"Videoclaw can’t store your credentials securely on this Mac — the system keychain isn’t available. Signing in would mean writing a long-lived token to disk in the clear, so it’s been stopped. Unlock your login keychain in Keychain Access, then quit and reopen Videoclaw. Nothing already saved has been touched."` |
| `MANAGED_KEY_MANUAL_WRITE_COPY` | 284 | `"This Mac’s generation access is managed by your Videoclaw account, so it can’t be pasted over or removed by hand. Nothing has been changed. Sign in again and Videoclaw will restore access automatically."` |
| `SIGN_OUT_NOT_PERSISTED_COPY` | 289 | `"You’ve been signed out and everything running has been stopped, but Videoclaw couldn’t update its saved credentials. If you reopen Videoclaw and it’s still signed in, sign out again. Your Videoclaw key and your projects have not been touched."` |
| `FIREBASE_PROD_CONFIG` | 308 | `parseConfig( '{"apiKey":"***REDACTED***","authDomain":"videoclaw-backend.firebaseapp.com","googleClientId":"650303209435-n9j48rb7bh1moo40381ndrr8sitg4va6.apps.googleusercontent.com","googleClientSecret":"***REDACTED***"}', )` |
| `FIREBASE_STAGING_CONFIG` | 311 | `parseConfig("")` |
| `SIGN_IN_UNAVAILABLE_COPY` | 320 | `{ unconfigured: "Account sign-in isn’t set up for this Videoclaw environment in this build.", "untrusted-gateway": "Account sign-in is only available on the official Videoclaw gateways. Paste a vc_ key to use this custom gateway.", }` |
| `EMAIL_LINK_SEND_COPY` | 349 | `{ unavailable: "Email sign-in isn’t set up for this Videoclaw environment right now. Signing in with Google still works.", throttled: "Too many sign-in emails were requested — wait a few minutes and try again.", "invalid-email": "Enter a valid email address.", unknown: "Couldn't send the sign-in email — check the address and try again.", }` |
| `EMAIL_LINK_WAIT_HINT_MS` | 356 | `45e3` |
| `EMAIL_LINK_RESEND_INTERVAL_MS` | 357 | `3e4` |
| `SUPPORT_EMAIL` | 358 | `"founders@humeo.com"` |
| `ACCOUNT_DISABLED_COPY` | 359 | `This Videoclaw account has been disabled. Contact the Videoclaw team at ${SUPPORT_EMAIL}.` |
| `GENERIC_ACTIVITY` | 360 | `"Working on the video…"` |
| `ENGINE_LINES` | 361 | { // JC-specified lines (verbatim from the chunk spec) ─────────────────────── mint_image: (s) => (s ? `Creating a still — ${s}` : "Creating a still"), mint_video: (s) => (s ? `Generating footage — ${ …(多行，见源文件) |
| `SUBJECT_TOOLS` | 410 | `/* @__PURE__ */ new Set(["mint_image", "mint_video"])` |
| `SYNTH_VOICE_MODE_LINES` | 411 | `{ tts: "Creating the voiceover", reference_tts: "Creating the approved voiceover", design: "Creating the voiceover", voice_change: "Re-voicing your recording", transcribe: "Transcribing your recording", list_voices: "Choosing a voice", }` |
| `SYNTH_VOICE_GENERATION_MODES` | 419 | `["tts", "reference_tts", "design", "voice_change"]` |
| `ENGINE_ALIASES` | 420 | `{ lipsync: "lipsync_footage", }` |
| `QUOTED_TOOL_ENGINE` | 432 | `{ music: "score_bed", depth_map: "fx_parallax", audio_enhance: "clean_audio", media_pull: "pull_video", enumerate_profile: "pull_video", embed: "index_media", llm: "check_script", }` |
| `QUOTED_TOOL_LINES` | 441 | `{ qa_video: "Reviewing footage", model_call: "Running a model", }` |
| `GENERATION_TOOLS` | 463 | `[ "mint_image", // a still "mint_video", // a video clip "synth_voice", // the voiceover "lipsync_footage", // voice + avatar work "perform_avatar", "cast_avatar", "sam3", // effect work (cutouts) "bu …(多行，见源文件)` |
| `GENERATION_FAMILY_LINES` | 480 | `/* @__PURE__ */ new Set([ ...GENERATION_TOOLS.map((t) => engineFamilyLine(t)).filter((l) => l !== null), // synth_voice generation modes carry mode-specific lines (e.g. voice_change // → "Re-voicing your recording") — still live audio generation, still strip-worthy. ...SYNTH_VOICE_GENERATION_MODES.map((m) => SYNTH_VOICE_MODE_LINES[m]), ])` |
| `COMMAND_WORDS` | 561 | `/* @__PURE__ */ new Set([ "sh", "bash", "zsh", "rm", "mv", "cp", "ls", "cat", "grep", "sed", "awk", "curl", "wget", "git", …(多行，见源文件)` |
| `INTERNAL_WORDS` | 600 | `/* @__PURE__ */ new Set([ // models + providers, matched in any casing "claude", "sonnet", "opus", "haiku", "anthropic", "gpt", "gpt-image", "openai", "gemini", "seedance", "seedream", "bytedance", "k …(多行，见源文件)` |
| `BEAT_ID_RE` | 637 | `/^(?:[wb]\d{1,3}\|seg\d{1,3})$/i` |
| `SUBJECT_LEAD_JARGON` | 678 | `/* @__PURE__ */ new Set([ "vertical", "horizontal", "square", "portrait", "landscape", "widescreen", "cinematic", "photorealistic", "photoreal", "hyperrealistic", "realistic", "photo", "photograph", " …(多行，见源文件)` |
| `VIDEO_EXTS` | 737 | `[".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"]` |
| `IMAGE_EXTS` | 738 | `[".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".heif", ".tiff", ".tif"]` |
| `AUDIO_EXTS` | 739 | `[".mp3", ".wav", ".m4a", ".aac", ".flac", ".aiff", ".aif", ".ogg"]` |
| `DOC_EXTS` | 740 | `[ ".pdf", ".txt", ".md", ".rtf", ".json", ".yaml", ".yml", ".csv", ".tsv", ".xlsx", ".xls", ".ods", ".srt", ".vtt", …(多行，见源文件)` |
| `OPAQUE_EXTS` | 759 | `[".svg"]` |
| `ARCHIVE_EXTS` | 760 | `[".zip"]` |
| `WORKBOOK_EXTS` | 761 | `[".xlsx", ".xls", ".ods"]` |
| `ACCEPTED_ASSET_HINT` | 790 | `"Video, images, audio, scripts, vector art, and archives"` |
| `INTAKE_FOLDER_MAX_DEPTH` | 791 | `8` |
| `INTAKE_FOLDER_MAX_FILES` | 792 | `1e3` |
| `INTAKE_FOLDER_MAX_BYTES` | 793 | `64 * 1024 * 1024 * 1024` |
| `INTAKE_FOLDER_MAX_VISITS` | 794 | `2e4` |
| `ARCHIVE_MAX_FILES` | 812 | `INTAKE_FOLDER_MAX_FILES` |
| `ARCHIVE_MAX_DEPTH` | 813 | `INTAKE_FOLDER_MAX_DEPTH` |
| `ARCHIVE_MAX_ENTRIES` | 814 | `INTAKE_FOLDER_MAX_VISITS` |
| `ARCHIVE_MAX_FILE_BYTES` | 815 | `4 * 1024 ** 3` |
| `ARCHIVE_MAX_TOTAL_BYTES` | 816 | `16 * 1024 ** 3` |
| `ARCHIVE_MAX_RATIO` | 817 | `100` |
| `ARCHIVE_RATIO_FLOOR_BYTES` | 818 | `1024 * 1024` |
| `ARCHIVE_MAX_WORKBOOKS` | 819 | `20` |
| `ARCHIVE_MAX_PDFS` | 820 | `20` |
| `WORKBOOK_MAX_BYTES` | 856 | `25 * 1024 * 1024` |
| `WORKBOOK_MAX_SHEETS` | 857 | `64` |
| `WORKBOOK_MAX_CELLS` | 858 | `1e5` |
| `WORKBOOK_MAX_CELL_CHARS` | 859 | `32767` |
| `WORKBOOK_MAX_OUTPUT_BYTES` | 860 | `16 * 1024 * 1024` |
| `WORKBOOK_CONTAINER_MAX_ENTRIES` | 861 | `1e4` |
| `WORKBOOK_CONTAINER_MAX_BYTES` | 862 | `64 * 1024 * 1024` |
| `WORKBOOK_CONTAINER_MAX_RATIO` | 863 | `1e3` |
| `WORKBOOK_PAGE_MAX_CELLS` | 864 | `500` |
| `PDF_MAX_BYTES` | 865 | `64 * 1024 * 1024` |
| `PDF_MAX_PAGES` | 866 | `500` |
| `PDF_MAX_TEXT_CHARS` | 867 | `1e6` |
| `CLIPBOARD_IMAGE_MAX_BYTES` | 885 | `64 * 1024 * 1024` |
| `CLIPBOARD_IMAGE_MAX_PIXELS` | 886 | `32 * 1024 * 1024` |
| `DEFAULT_ELIGIBLE_ROUTE_LEVELS` | 887 | `["qualified"]` |
| `CODEX_PACKAGED_0_153_4_SMOKE` | 893 | `[ "historical packaged-app smoke on 0.153.4; native UI smoke pending for 0.160.1", "streaming", "tool execution (VideoClaw dynamic tool + provider command)", "image/frame understanding from a project file", "commentary/final-answer classification", "payer labelling", "persistence and default isolation", ]` |
| `CODEX_QUALIFIED_RESIDUAL_GAPS` | 916 | [ "perceptual/rubric scoring and human calibration", "monetary cost and token accounting (not exposed by Codex subscription mode)", "a LIVE file-change approval event — precluded by the intentional read-only production sandbox, and covered deterministically rather than by weakening that sandbox", `evidence at any reasoning effort other than the recommended one — the model's other supported depths  …(截断) |
| `AGENT_ROUTE_EVIDENCE` | 922 | [ { routeId: agentRouteId("codex-app-server", "chatgpt", "gpt-5.6-terra"), harness: "codex-app-server", provider: "chatgpt", modelId: "gpt-5.6-terra", // PROMOTED from `smoke-validated`. The same suite Astra cleared was run // against this exact route, re-established on 0.160.1: 28/28 conformance and a // 3/3 VideoClaw Bench record. It is the reason an account that cannot // address Astra still ha …(截断) |
| `BY_ROUTE_ID` | 990 | `new Map(AGENT_ROUTE_EVIDENCE.map((row) => [row.routeId, row]))` |
| `RECORDED_CLAUDE_EFFORT_MODELS` | 1013 | `["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5"]` |
| `RECORDED_CLAUDE_NO_EFFORT_MODELS` | 1014 | `["claude-haiku-4-5-20251001"]` |
| `CODEX_CONTAINMENT` | 1054 | `{ approvalPolicy: "on-request", sandbox: "read-only", }` |
| `CODEX_HOST_APPROVAL` | 1058 | `{ default: "ask", acceptEdits: "edits", auto: "all", bypassPermissions: "all", }` |
| `CODEX_PROVIDER_LABELS` | 1078 | `{ chatgpt: "ChatGPT", "openai-api": "OpenAI API", openrouter: "OpenRouter", }` |
| `CLAUDE_CLI_TURN` | 1195 | `["live turn on the bundled CLI returned a completed result"]` |
| `CLAUDE_BENCH_RUN` | 1196 | `"three isolated rollouts on the bundled CLI — one fresh SDK session in a fresh workspace each, no resume, all terminating on a normal result"` |
| `CLAUDE_BENCH_WIRE_IDENTITY` | 1198 | "the requested model id was the session model reported by `system/init` on every rollout; `modelUsage` additionally lists the CLI's own internal helper model, recorded as concurrent side usage and NOT as a fallback of the requested model" |
| `CLAUDE_BENCH_PAYER` | 1200 | `"payer observed per rollout: signed-in claude.ai, apiProvider firstParty, Team subscription, no gateway credentials injected"` |
| `CLAUDE_BENCH_NOT_COVERED` | 1202 | [ "protocol/capability conformance on this harness — there is no Claude equivalent of the 28-check Codex conformance manifest, so structured output, interrupt/resume and approval semantics are not separately graded here", "perceptual/rubric scoring and human calibration", "monetary cost accounting — the manifests record the SDK's own `total_cost_usd` estimate for a subscription-route turn, which i …(截断) |
| `CLAUDE_CLI_TURN_NOT_COVERED` | 1208 | `[ "a VideoClaw Bench record of any kind — this row rests on one completed turn, which is why it is no longer the id a new video starts on", ...CLAUDE_BENCH_NOT_COVERED, ]` |
| `CLAUDE_MODEL_EVIDENCE` | 1243 | [ // The row that shows why the binary is the authority and a string search // over it is NOT: `claude-opus-5` occurs nowhere in this CLI's string table // and runs anyway. That table is a pricing/ali …(多行，见源文件) |
| `CLAUDE_EVIDENCE_BY_ROUTE_ID` | 1367 | `new Map(CLAUDE_MODEL_EVIDENCE.map((row) => [row.routeId, row]))` |
| `CLAUDE_ROUTE_LABELS` | 1368 | `{ "claude-code": "the Claude Code plan", gateway: "Videoclaw credit", }` |
| `STALE_RESUME_RE` | 1483 | `/no conversation found with session id/i` |
| `NETWORK_RE` | 1487 | `/\b(ECONNREFUSED\|ECONNRESET\|ETIMEDOUT\|ENOTFOUND\|EAI_AGAIN\|EPIPE\|ENETUNREACH\|EHOSTUNREACH)\b/i` |
| `CONVERSATION_TOO_LARGE_RE` | 1489 | `/(?:API Error:\s*(?:409\|413).*HTTP 413\|API Error:\s*413\|request_too_large\|operation body is too large to quote\|conversation contains too much media history)/i` |
| `FRIENDLY` | 1542 | `{ conversation_too_large: "This chat has grown too large to continue here. Continue in a fresh chat — your video and files will come with you.", network: "The connection failed. Check your connection before trying again.", storage_full: "There is not enough disk space to save. Free up space, then try again.", storage_unavailable: "Storage is unavailable for saving. Check that the drive is connecte …(截断)` |
| `RUNTIME_ERROR_KINDS` | 1563 | `{ authentication_failed: "access", oauth_org_not_allowed: "access", account_on_hold: "access", verification_required: "access", billing_error: "access", cloud_credential_error: "access", rate_limit: " …(多行，见源文件)` |
| `CODEX_CHATGPT_AUTH_REJECTED` | 1579 | `"codex_chatgpt_auth_rejected"` |
| `CODEX_API_KEY_REJECTED` | 1580 | `"codex_api_key_rejected"` |
| `VIDEOCLAW_CREDIT_EXHAUSTED` | 1588 | `"videoclaw_credit_exhausted"` |
| `CLAUDE_TERMS_REQUIRED` | 1592 | `"claude_terms_required"` |
| `CLAUDE_TERMS_NOTICE` | 1593 | `/\b(?:consumer terms\|privacy policy\|updated terms)\b/i` |
| `CLAUDE_TERMS_ACTION` | 1594 | `/\baccept(?:ed\|ing\|ance)?\b\|\baction required\b\|\breview the updated terms\b/i` |
| `RUNTIME_ERROR_HEADLINE` | 1609 | `{ authentication_failed: "The model account is signed out, so this step could not run. Reconnect it, then send your instruction again.", oauth_org_not_allowed: "The model account is signed in, but its …(多行，见源文件)` |
| `RUNTIME_AUTH_ERRORS` | 1638 | `/* @__PURE__ */ new Set([ "authentication_failed", "oauth_org_not_allowed", "account_on_hold", "verification_required", "cloud_credential_error", ])` |
| `MODEL_REFUSAL_CODE` | 1658 | `/\b(?:model[_ -](?:not[_ -]found\|unavailable\|unsupported\|access[_ -]denied)\|unsupported[_ -]model\|invalid[_ -]model\|unknown[_ -]model)\b/i` |
| `MODEL_WORD` | 1660 | `/\bmodels?\b/i` |
| `MODEL_REFUSAL_PHRASE` | 1661 | `/\b(?:is not available\|isn't available\|not available\|no longer available\|not supported\|unsupported\|not found\|does not exist\|doesn't exist\|no access\|(?:does not\|doesn't) have access\|denied access\|access denied\|not authorized\|not entitled\|not enabled\|cannot be used)\b/i` |
| `ACCESS_REFUSAL` | 1663 | `/\b40[13]\b\|\b(?:unauthorized\|forbidden\|access denied\|permission denied\|insufficient[_ ]quota\|quota exceeded\|rate limit exceeded\|plan (?:limit\|does not include)\|subscription (?:required\|expired))\b/i` |
| `UPSTREAM_TIMEOUT` | 1665 | `/\b504\b\|\bgateway time-?out\b\|\b(?:request\|upstream\|stream) timed out\b\|\btimed out after\b/i` |
| `UPSTREAM_OUTAGE` | 1667 | `/\b(?:HTTP\|API Error:?\|status(?: code)?\|error code\|returned status\|responded(?: with)?)\s*(?:50[0-9]\|52[0-9])\b\|\b(?:internal server error\|bad gateway\|service unavailable\|server error\|no healthy upstream\|upstream connect error\|temporarily unavailable\|currently unavailable\|(?:is\|are) (?:down\|offline)\|overloaded(?:_error)?\|server is busy)\b/i` |
| `RATE_LIMITED` | 1669 | `/\b(?:HTTP\|API Error:?\|status(?: code)?\|error code\|responded(?: with)?)\s*429\b\|\b(?:rate[_ -]?limit(?:ed\|_error)?\|rate limit exceeded\|too many requests\|slow down)\b/i` |
| `QUOTA_EXHAUSTED` | 1671 | `/\b(?:usage limits?\|insufficient[_ ]quota\|quota exceeded\|plan limit\|workspace is out of credits)\b/i` |
| `SUBSCRIPTION_PLAN_OFFER` | 1673 | `/\bupgrade to (?:plus\|pro\|team\|business\|enterprise)\b/i` |
| `PROVIDER_ERROR_PATTERNS` | 1678 | `[ [ "model-unavailable", (text) => MODEL_REFUSAL_CODE.test(text) \|\| (MODEL_WORD.test(text) && MODEL_REFUSAL_PHRASE.test(text)), ], [ "access", (text) => ACCESS_REFUSAL.test(text) \|\| QUOTA_EXHAUSTED.test(text) \|\| RATE_LIMITED.test(text), ], ["timeout", (text) => UPSTREAM_TIMEOUT.test(text)], ["outage", (text) => UPSTREAM_OUTAGE.test(text)], ]` |
| `TURN_CHARGE_NOTE` | 1731 | `{ not_charged: "This turn was not charged.", unknown: "Charge status for this turn could not be confirmed.", }` |
| `CAPABILITY_LABELS` | 1735 | [ // Longest/most specific engine tool names first — `lipsync_footage` must not // be read as the bare `lipsync` alias, and `script_preflight` is a script // check rather than the cut's preflight. [/\ …(多行，见源文件) |
| `SYNTH_VOICE_CAPABILITIES` | 1761 | `[ [/\btranscribe\b/i, "Transcription"], [/\b(?:voice_change\|reference_tts\|voice clon\w*\|clone[_ -]?voice)\b/i, "Voice cloning"], [/\blist_voices\b/i, "The voice list"], ]` |
| `VIDEOCLAW_CREDIT_GUIDANCE` | 1845 | `"Each step holds its worst-case cost before it starts, and this one needs more than your remaining balance. Top up, then send a new instruction to continue — the rest of your video is kept."` |
| `CLAUDE_TERMS_GUIDANCE` | 1847 | `"Until the terms are accepted, Claude will refuse every step the same way. Your video is not the problem."` |
| `QUOTA_HEADLINE` | 1849 | `{ subscription: "You've reached the usage limit on your model runtime plan. That is a quota on that plan — not a problem with your video and not a spending limit.", provider: "The model runtime refused this step because its quota is used up. That is a limit on the plan or billing behind that account — not a problem with your video.", }` |
| `PROVIDER_GUIDANCE` | 1855 | `{ transient: "This usually clears on its own. Wait a few minutes and retry — the rest of your video is untouched.", terminal: "Retrying will not clear this on its own. Choose a different option for this step, or carry on with the rest of the video.", }` |
| `LIMITED_ACCOUNT_LABELS` | 1873 | `{ ...CODEX_PROVIDER_LABELS, claude: "Claude", }` |
| `LIMITED_ACCOUNT_URLS` | 1877 | `{ chatgpt: "https://chatgpt.com/codex/settings/usage", "openai-api": "https://platform.openai.com/", openrouter: "https://openrouter.ai/", claude: "https://claude.ai/", }` |
| `FREE_GEN_TOOLS` | 1924 | `[ "assemble", "assemble_plate", "check_layout", "check_promise", "chunk_boundaries", // compose_render is NOT here: --mode episode shells out to synth_voice, // lipsync_footage, and mint_image as chil …(多行，见源文件)` |
| `FREE_GEN_TOOL_SET` | 1974 | `new Set(FREE_GEN_TOOLS)` |
| `PAID_GEN_TOOLS` | 1975 | `[ "acquire_footage", "analyze_reference", "breakdown_reference", "build_carousel", "build_character_sheet", "cast_avatar", "check_script", "clean_audio", "compose_render", // Reference-sensitive: ever …(多行，见源文件)` |
| `PAID_GEN_RE` | 2038 | new RegExp(`\\b(${PAID_GEN_TOOLS.join("\|")})\\b`) |
| `PAID_TARGET_RE` | 2039 | new RegExp(`^(?:\\S*/)?(${PAID_GEN_TOOLS.join("\|")})(?:\\.py)?$`) |
| `TOOLS_PATH_TARGET_RE` | 2040 | `/^(?:\S*\/)?tools\/([^/\s]+?)\.py$/` |
| `FREE_SUBCOMMANDS` | 2050 | `{ lipsync_footage: /* @__PURE__ */ new Set([ "plan", "face-envelope", "motion-envelope", "composite", ]), }` |
| `FREE_FLAGS` | 2058 | `{ check_script: /* @__PURE__ */ new Set(["--skip-llm"]), script_preflight: /* @__PURE__ */ new Set(["--skip-llm"]), verify_output: /* @__PURE__ */ new Set(["--pre-gen"]), }` |
| `FREE_MODES` | 2063 | `{ compose_render: /* @__PURE__ */ new Set(["render", "retrofit", "cover_bake"]), synth_voice: /* @__PURE__ */ new Set(["list_voices"]), verify_output: /* @__PURE__ */ new Set(["render", "audio", "pre-gen"]), // score_bed --mode bed ASSEMBLES a bed from already-acquired stems locally // (ffmpeg), so cost.py rates it $0 on purpose; generate/split genuinely spend // and stay paid. Downgrading bed her …(截断)` |
| `DECODE_AUDIO_REF_FLAGS` | 2077 | `["--input", "--candidates", "--vocal-stems", "--vocal-stem"]` |
| `DECODE_AUDIO_MULTI_REF_FLAGS` | 2078 | `/* @__PURE__ */ new Set(["--candidates", "--vocal-stems"])` |
| `DECODE_AUDIO_NO_RESOLVE_FLAGS` | 2079 | `/* @__PURE__ */ new Set(["--selftest", "-h", "--help"])` |
| `REMOTE_SCHEMES` | 2080 | `/* @__PURE__ */ new Set(["http", "https"])` |
| `AMBIGUOUS_REF_FLAG` | 2089 | `Symbol("ambiguous")` |
| `LOOK_AT_VIDEO_FREE_TOKENS` | 2136 | `["--no-transcript", "-h", "--help"]` |
| `READER_HEADS` | 2155 | `/* @__PURE__ */ new Set([ "cat", "grep", "rg", "head", "tail", "echo", "printf", "ls", "wc", "nl", "diff", "stat", "file", "du", …(多行，见源文件)` |
| `EXEC_HOOK_ENV_RE` | 2180 | `/^(?:LESSOPEN\|LESSCLOSE\|BASH_ENV\|ENV\|PYTHONSTARTUP\|PYTHONINSPECT\|NODE_OPTIONS\|PERL5OPT\|RUBYOPT\|LD_PRELOAD\|DYLD_INSERT_LIBRARIES)=/` |
| `PRICE_DETERMINING_FLAGS` | 2182 | `[ // count "--count", "--variants", "--slides", "--num", "--n", // role / mode "--role", "--mode", "--vision-mode", "--rail", // gateway route / fixed-output duration "--model", "--duration", …(多行，见源文件)` |
| `WRAPPER_HEADS` | 2230 | `/* @__PURE__ */ new Set(["env", "nohup", "time", "command", "exec"])` |
| `ENV_ASSIGN_RE` | 2231 | `/^[A-Za-z_][A-Za-z0-9_]*=/` |
| `PYTHON_RE` | 2232 | `/^python(?:\d+(?:\.\d+)*)?$/` |
| `IN_WORD_BLANK_RE` | 2233 | `/[^\S \t\n\r]/` |
| `CODE_EXEC_RE` | 2535 | `/(?:\bsubprocess\b\|\bcreate_subprocess_(?:exec\|shell)\b\|\bmultiprocessing\b\|\bos\.(?:system\|popen\|spawn\w*\|exec\w*\|posix_spawn\|startfile)\b\|\b(?:system\|popen\|spawn\|exec\|eval\|compile)\s*\(\|\brunpy\b\|\bimportlib\b\|\b__import__\b\|\bbuiltins\b\|\b(?:getattr\|vars\|globals\|locals)\s*\(\|\bPopen\b\|\bcheck_(?:call\|output)\b\|\bpty\.spawn\b)/` |
| `PROVIDER_STRONG_RE` | 2672 | `/(?:VIDEOCLAW_(?:API_KEY\|GATEWAY(?:_URL)?\|GW_URL)\|vc_[A-Za-z0-9]{16,}\|videoclaw-gw-[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.run\.app\|aiplatform\.googleapis\.com\|api\.anthropic\.com\|api\.apify\.com\|api\.elevenlabs\.io\|api\.openai\.com\|api\.replicate\.com\|generativelanguage\.googleapis\.com\|openrouter\.ai\|fal\.(?:ai\|run))/i` |
| `PROVIDER_SDK_CALL_RE` | 2674 | `/(?:\.chat\.completions\.create\s*\(\|\.images\.(?:generate\|edit\|create_variation)\s*\(\|\.messages\.(?:create\|stream)\s*\(\|\.models\.generate_(?:content\|images)\s*\(\|\.predictions\.create\s*\(\|\.responses\.create\s*\(\|\.audio\.(?:speech\|transcriptions\|translations)\.create\s*\(\|\.text_to_speech\.(?:convert\|stream)\s*\(\|\bfal_client\.(?:run\|stream\|submit\|subscribe)\s*\(\|\bGenerati …(截断)` |
| `PROVIDER_GENERIC_CLIENT_RE` | 2676 | `/(?:\baiohttp\b\|\baxios\b\|\bfetch\s*\(\|\bhttpx\b\|\bhttps?\.request\s*\(\|\bnode-fetch\b\|\brequests\b\|\bundici\b\|\burllib3?\b\|\burlopen\s*\(\|HTTPS?Connection\s*\(\|XMLHttpRequest)/` |
| `PROVIDER_MUTATION_RE` | 2678 | `/(?:(?:^\|\s)-d\b\|-d@\|--data\b\|--data-[a-z]+\b\|--json\b\|--form(?:-string)?\b\|(?:^\|\s)-F\b\|(?:^\|\s)-T\b\|--upload-file\b\|--post-data\b\|--post-file\b\|\b(?:DELETE\|PATCH\|POST\|PUT)\b\|\.(?:post\|put\|patch\|send\|upload)\s*\(\|\b(?:aiohttp\|axios\|httpx\|requests\|urllib3)\.(?:delete\|patch\|post\|put)\s*\(\|\b(?:aiohttp\|axios\|httpx\|requests\|urllib3)\.request\s*\(\s*["'](?:post\|put\ …(截断)` |
| `PROVIDER_ACQUISITION_HOST_PATTERNS` | 2680 | [String.raw`api\.apify\.com`] |
| `PROVIDER_ACQUISITION_HOST_RE` | 2681 | new RegExp( `(?:^\|\\.)(?:${PROVIDER_ACQUISITION_HOST_PATTERNS.join("\|")})$`, "i", ) |
| `SCHEMELESS_ACQUISITION_RE` | 2685 | new RegExp( String.raw`(^\|[\s"'(=])((?:[\w-]+\.)*(?:${PROVIDER_ACQUISITION_HOST_PATTERNS.join("\|")})\.?(?=[:/?#\s"'<>\|;,)\]}+]\|$))`, "gi", ) |
| `PROVIDER_ORIGIN_HOSTNAME_RE` | 2699 | `/(?:^\|\.)(?:videoclaw-gw-[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.run\.app\|aiplatform\.googleapis\.com\|api\.anthropic\.com\|api\.apify\.com\|api\.elevenlabs\.io\|api\.openai\.com\|api\.replicate\.com\|generativelanguage\.googleapis\.com\|openrouter\.ai\|fal\.(?:ai\|run))$/i` |
| `PROVIDER_CLIENT_BINARY_RE` | 2711 | `/^(?:curl\|curlie\|http\|https\|httpie\|xh\|wget\|hurl)$/` |
| `HTTPIE_EXPANSION_HEAD_RE` | 2712 | /^[$`{~*?[\\]/ |
| `HTTPIE_EXPANSION_RE` | 2713 | /[$`{}*?[\]\\]/ |
| `HTTPIE_REDIRECT_TOKEN_RE` | 2714 | `/^[0-9&]*[<>][<>&\|-]*$/` |
| `PROVIDER_CLIENT_ANYWHERE_RE` | 2739 | `/(?:^\|[\s"'(;])(?:curl\|curlie\|http\|https\|httpie\|xh\|wget\|hurl)(?=$\|[\s"'();])/` |
| `CURL_HEADS` | 2741 | `["curl", "curlie"]` |
| `NESTED_CURL_LAUNCHERS` | 2742 | `[ "exec", "find", "parallel", "setsid", "stdbuf", "timeout", "watch", "xargs", ]` |
| `READER_SHELL_OUT_PATTERNS` | 2752 | [ String.raw`(?:^\|[\s;{}])e\s+\S`, String.raw`["']\s*\\|\s*&?\s*getline`, String.raw`\bexecl?p?\s*\(`, String.raw`\bpopen\s*\(`, String.raw`\bs(.)(?:(?!\1).)*\1(?:(?!\1).)*\1[a-zA-Z0-9]*e(?![a-zA-Z0-9])`, String.raw`\bsystem\s*\(`, String.raw`\\|\s*&?\s*["']`, ] |
| `PROVIDER_READ_ONLY_HEADS` | 2761 | `[ "awk", "basename", "cat", "column", "comm", "cut", "diff", "dirname", "du", "echo", "false", "ffprobe", "file", "find", …(多行，见源文件)` |
| `CURL_HEAD_SET` | 2801 | `new Set(CURL_HEADS)` |
| `NESTED_CURL_LAUNCHER_SET` | 2802 | `new Set(NESTED_CURL_LAUNCHERS)` |
| `PROVIDER_READ_ONLY_HEAD_SET` | 2803 | `new Set(PROVIDER_READ_ONLY_HEADS)` |
| `FIND_EXEC_FLAGS` | 2804 | `/* @__PURE__ */ new Set(["-exec", "-execdir", "-ok", "-okdir"])` |
| `READER_SHELL_OUT_RE` | 2805 | new RegExp(`(?:${READER_SHELL_OUT_PATTERNS.join("\|")})`, "i") |
| `DYNAMIC_EXEC_RE` | 2806 | `/(?:execFile\|execSync\|spawn\|subprocess\|system)\b\|\.run\s*\(/i` |
| `NESTED_CURL_RE` | 2807 | `/\bcurl(?:ie)?\b/g` |
| `XARGS_LONG_OPTIONS_WITH_VALUE` | 2936 | `/* @__PURE__ */ new Set([ "--arg-file", "--delimiter", "--eof", "--max-args", "--max-chars", "--max-lines", "--max-procs", "--process-slot-var", "--replace", ])` |
| `XARGS_LONG_BOOLEAN_OPTIONS` | 2947 | `/* @__PURE__ */ new Set([ "--exit", "--help", "--interactive", "--no-run-if-empty", "--null", "--open-tty", "--show-limits", "--verbose", "--version", ])` |
| `XARGS_SHORT_OPTIONS_WITH_VALUE` | 2958 | `/* @__PURE__ */ new Set([ "a", "d", "E", "I", "L", "n", "P", "s", ])` |
| `XARGS_SHORT_BOOLEAN_OPTIONS` | 2968 | `/* @__PURE__ */ new Set(["0", "o", "p", "r", "t", "x"])` |
| `TIMEOUT_LONG_OPTIONS_WITH_VALUE` | 2969 | `/* @__PURE__ */ new Set(["--kill-after", "--signal"])` |
| `TIMEOUT_LONG_BOOLEAN_OPTIONS` | 2970 | `/* @__PURE__ */ new Set([ "--foreground", "--help", "--preserve-status", "--verbose", "--version", ])` |
| `TIMEOUT_SHORT_OPTIONS_WITH_VALUE` | 2977 | `/* @__PURE__ */ new Set(["k", "s"])` |
| `TIMEOUT_SHORT_BOOLEAN_OPTIONS` | 2978 | `/* @__PURE__ */ new Set(["v"])` |
| `STDBUF_LONG_OPTIONS_WITH_VALUE` | 2979 | `/* @__PURE__ */ new Set(["--error", "--input", "--output"])` |
| `STDBUF_LONG_BOOLEAN_OPTIONS` | 2980 | `/* @__PURE__ */ new Set(["--help", "--version"])` |
| `STDBUF_SHORT_OPTIONS_WITH_VALUE` | 2981 | `/* @__PURE__ */ new Set(["e", "i", "o"])` |
| `PARALLEL_LONG_OPTIONS_WITH_VALUE` | 2982 | `/* @__PURE__ */ new Set(["--jobs"])` |
| `PARALLEL_LONG_BOOLEAN_OPTIONS` | 2983 | `/* @__PURE__ */ new Set(["--bar", "--keep-order"])` |
| `PARALLEL_SHORT_OPTIONS_WITH_VALUE` | 2984 | `/* @__PURE__ */ new Set(["j"])` |
| `PARALLEL_SHORT_BOOLEAN_OPTIONS` | 2985 | `/* @__PURE__ */ new Set(["k"])` |
| `SETSID_LONG_BOOLEAN_OPTIONS` | 2986 | `/* @__PURE__ */ new Set([ "--ctty", "--fork", "--help", "--version", "--wait", ])` |
| `SETSID_SHORT_BOOLEAN_OPTIONS` | 2993 | `/* @__PURE__ */ new Set(["c", "f", "h", "V", "w"])` |
| `NO_OPTIONS` | 2994 | `/* @__PURE__ */ new Set()` |
| `CURL_BODY_FLAGS` | 3143 | `[ "--data", "--data-ascii", "--data-binary", "--data-raw", "--data-urlencode", "--form", "--form-string", "--json", "--upload-file", "-F", "-T", "-d", ]` |
| `CURL_METHOD_FLAGS` | 3157 | `["--request", "-X"]` |
| `CURL_FORCE_GET_FLAGS` | 3158 | `["--get", "-G"]` |
| `CURL_FORCE_HEAD_FLAGS` | 3159 | `["--head", "-I"]` |
| `CURL_VALUE_SHORT_OPTIONS` | 3160 | `[ "A", "C", "D", "E", "F", "H", "K", "P", "Q", "T", "U", "X", "Y", "b", …(多行，见源文件)` |
| `CURL_LONG_WITH_VALUE` | 3188 | `[ "--aws-sigv4", "--cacert", "--capath", "--cert", "--config", "--connect-timeout", "--connect-to", "--continue-at", "--cookie", "--cookie-jar", "--data", "--data-ascii", "--data-binary", "--data-raw" …(多行，见源文件)` |
| `CURL_READ_METHODS` | 3231 | `["GET", "HEAD", "OPTIONS"]` |
| `CURL_BODY_FLAG_SET` | 3232 | `new Set(CURL_BODY_FLAGS)` |
| `CURL_METHOD_FLAG_SET` | 3233 | `new Set(CURL_METHOD_FLAGS)` |
| `CURL_FORCE_GET_FLAG_SET` | 3234 | `new Set(CURL_FORCE_GET_FLAGS)` |
| `CURL_VALUE_SHORT_OPTION_SET` | 3235 | `new Set(CURL_VALUE_SHORT_OPTIONS)` |
| `CURL_LONG_WITH_VALUE_SET` | 3236 | `new Set(CURL_LONG_WITH_VALUE)` |
| `CURL_READ_METHOD_SET` | 3237 | `new Set(CURL_READ_METHODS)` |
| `BILLED_MEDIA_BY_KEY` | 3623 | `{ lipsync_footage: "--audio", "mint_video:edit": "--video", "mint_video:reenact": "--driver-video", // videoclaw#272 / backend#302: Higgsfield Genjutsu bills whole seconds of the // INPUT clip at the --resolution tier; the gateway re-measures the upload. "mint_video:genjutsu": "--video", }` |
| `INPUT_BOUND_MINT_VIDEO_ROLES` | 3631 | `["edit", "reenact", "genjutsu"]` |
| `UV_RUN_OPTIONS_WITH_VALUE` | 3644 | `/* @__PURE__ */ new Set([ "--directory", "--env-file", "--index", "--index-url", "--project", "--python", "--python-platform", "--resolution", "--with", "--with-editable", "--with-requirements", ])` |
| `UV_RUN_RELOCATING_OPTIONS` | 3657 | `/* @__PURE__ */ new Set(["--directory", "--project"])` |
| `ENGINE_REF_RE_SRC` | 3979 | [ '"\\$VIDEOCLAW_ENGINE"', "'\\$VIDEOCLAW_ENGINE'", "\\$VIDEOCLAW_ENGINE", '"\\$\\{VIDEOCLAW_ENGINE\\}"', "'\\$\\{VIDEOCLAW_ENGINE\\}'", "\\$\\{VIDEOCLAW_ENGINE\\}", '"\\$\\{VIDEOCLAW_ENGINE:-[^}"\'`\\\\]*\\}"', "'\\$\\{VIDEOCLAW_ENGINE:-[^}\"'`\\\\]*\\}'", "\\$\\{VIDEOCLAW_ENGINE:-[^}\\s\"'`\\\\]*\\}", ].join("\|") |
| `CD_ENGINE_PREFIX_RE` | 3990 | new RegExp(`^\\s*cd\\s+(?:${ENGINE_REF_RE_SRC})\\s+&&\\s+([^]+)$`) |
| `UV_DIRECTORY_ENGINE_RE` | 3991 | new RegExp( `^(\\s*uv\\s+run\\s+)--directory(?:=\|\\s+)(?:${ENGINE_REF_RE_SRC})\\s+([^]+)$`, ) |
| `OUTPUT_FILTER_HEADS` | 3994 | `/* @__PURE__ */ new Set([ "tail", "head", "grep", "egrep", "fgrep", "wc", "cat", "uniq", "cut", "tr", "jq", ])` |
| `UV_PROJECT_ENGINE_RE` | 4085 | new RegExp( `^(\\s*uv\\s+run\\s+)--project(?:=\|\\s+)(?:${ENGINE_REF_RE_SRC})\\s+([^]+)$`, ) |
| `ENGINE_REF_IN_TOKEN_RE` | 4088 | new RegExp( `\\$(?:\\{VIDEOCLAW_ENGINE\\}\|VIDEOCLAW_ENGINE)(?=/\|"\|'\|\\s\|$)`, "g", ) |
| `BANNED_USER_FACING_VOCABULARY` | 4129 | `[ "workflow", "molecule", "taste pack", "tenant", "job", "pipeline", "reading set", ]` |
| `VOICE_GUARD` | 4138 | ` ## Videoclaw app voice (overrides conversational habits, not operating rules) You are the engine inside the Videoclaw desktop app; the user is a video creator, not a developer. In everything you SAY …(多行，见源文件) |
| `CLAUDE_CODE_INTERNAL_PLAN_TOOLS` | 4211 | `["EnterPlanMode", "ExitPlanMode"]` |
| `CLAUDE_COMPACTION_PREAMBLE` | 4213 | `"This session is being continued from a previous conversation that ran out of context."` |
| `CLAUDE_SYNTHETIC_MODEL` | 4215 | `"<synthetic>"` |
| `APP_SPEND_REFUSAL_TEXT` | 4230 | `/^\s*API Error:\s*402\s+(\{[\s\S]*\})\s*$/` |
| `APP_SPEND_REFUSAL_CODES` | 4231 | `/* @__PURE__ */ new Set([ SPEND_APPROVAL_PENDING_CODE, SPEND_AUTHORITY_REQUIRED_CODE, ])` |
| `GATEWAY_PREPAID_CREDIT_REFUSAL` | 4247 | `"not enough prepaid credit; top up to continue"` |
| `CLAUDE_CODE_PLAN_MODE_REDIRECT` | 4289 | `"Special plan mode is not available in this studio. You may reason about or describe your approach in ordinary conversation, then continue the current request without asking for plan approval. Tool permissions and paid-operation approval are enforced separately by the app."` |
| `CLAUDE_CODE_SELF_STARTING_TOOLS` | 4298 | `[ "CronCreate", "CronDelete", "CronList", "ScheduleWakeup", "RemoteTrigger", "Workflow", "SendMessage", "ListAgents", "PushNotification", ]` |
| `ARCHIVE_LIMITS` | 4419 | `{ maxEntries: ARCHIVE_MAX_ENTRIES, maxFiles: ARCHIVE_MAX_FILES, maxDepth: ARCHIVE_MAX_DEPTH, maxFileBytes: ARCHIVE_MAX_FILE_BYTES, maxTotalBytes: ARCHIVE_MAX_TOTAL_BYTES, maxRatio: ARCHIVE_MAX_RATIO, ratioFloorBytes: ARCHIVE_RATIO_FLOOR_BYTES, }` |
| `FREE_SPACE_RESERVE_BYTES` | 4428 | `1024 ** 3` |
| `MAX_ENTRY_NAME_BYTES` | 4429 | `1024` |
| `MAX_SEGMENT_BYTES` | 4430 | `255` |
| `S_IFMT` | 4431 | `61440` |
| `S_IFREG` | 4432 | `32768` |
| `S_IFDIR` | 4433 | `16384` |
| `S_IFLNK` | 4434 | `40960` |
| `NESTED_ARCHIVE_EXTS` | 4435 | `/* @__PURE__ */ new Set([ ".zip", ".7z", ".rar", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".zst", ".lz", ".lzma", ".cab", ".jar", ".war", …(多行，见源文件)` |
| `WORKBOOK_SCHEMA` | 4754 | `"videoclaw.workbook/v1"` |
| `WORKBOOK_PAGE_MAX_CHARS` | 4755 | `6e4` |
| `WORKBOOK_PAGE_CELL_CHARS` | 4756 | `4e3` |
| `SHA256_RE` | 4757 | `/^[a-f0-9]{64}$/` |
| `CELL_TYPES` | 4758 | `/* @__PURE__ */ new Set(["string", "number", "boolean", "date", "error"])` |
| `WORKBOOK_READ_TIMEOUT_MS` | 4947 | `2e4` |

## `main/index.js`

| 常量 | 行 | 值 |
|---|---|---|
| `NEW_VIDEO_TITLE` | 266 | `"New video"` |
| `VOICE_NOTE_MAX_BYTES` | 282 | `2 * 1024 * 1024` |
| `VOICE_NOTE_MAX_SECONDS` | 283 | `120` |
| `DEFAULT_LLM_ROUTE` | 319 | `"claude-code"` |
| `DEFAULT_AGENT_HARNESS` | 323 | `"claude-code"` |
| `DEFAULT_CODEX_PROVIDER` | 327 | `"chatgpt"` |
| `IPC` | 354 | `{ readSessionPlan: "sessionPlan:read", chooseSessionPlan: "sessionPlan:choose", retrySessionPlan: "sessionPlan:retry", sessionPlanChanged: "sessionPlan:changed", readProjectMemory: "memory:read", upda …(多行，见源文件)` |
| `LOCAL_RESET_REFUSAL_COPY` | 638 | `{ "vault-unreadable": "VideoClaw can’t read the saved logins on this Mac, so it can’t reset without risking your other saved keys. Nothing was changed. Unlock your login keychain and try again, or con …(多行，见源文件)` |
| `TASTE_TITLE_BANNED` | 669 | `/\b(workflows?\|molecules?\|taste\s*packs?\|tenants?\|jobs?)\b/i` |
| `POLICY_REFUSAL_MARKER` | 687 | `"[videoclaw-policy-refusal:v1]"` |
| `SERVER_CLASSIFIER` | 715 | `"The server-side auto mode classifier"` |
| `SAFETY` | 716 | `", so auto mode cannot determine the safety of "` |
| `NAME` | 717 | `"(The [^:\\n]{0,80}?classifier)"` |
| `PAREN` | 718 | `"(?: \\(([^()\\n]{1,80})\\))?"` |
| `TEMPLATES` | 719 | [ { pattern: new RegExp( `^${NAME} gave no verdict${PAREN}${SAFETY}[^\\n]+?\\. This is a transient failure of the check\\b`, ), retry: "transient", }, { pattern: new RegExp( `^${NAME} gave no verdict$ …(多行，见源文件) |
| `STOPPED` | 751 | `/^Auto mode is unavailable: the server returned no safety verdict for \d+ responses in a row\b/` |
| `RUNNER_ROUTES` | 774 | { /** POST — create a session from the context bundle. */ createSession: "/v1/sessions", /** POST — the up-stream message envelope. */ messages: (sessionId) => `/v1/sessions/${sessionId}/messages`, /** GET (SSE) — the down-stream frame stream; `Last-Event-ID` resumes. */ events: (sessionId) => `/v1/sessions/${sessionId}/events`, } |
| `RUNNER_PROTOCOL_VERSION` | 782 | `11` |
| `RUNNER_CAPABILITY_SPEND_BUDGET` | 783 | `"spend-budget-production-auth-v4-shell-ir"` |
| `RUNNER_CAPABILITY_CONTEXT_RECEIPT` | 784 | `"session-context-receipt-v1"` |
| `RUNNER_CAPABILITY_HOSTED_LLM_PERMIT` | 785 | `"hosted-llm-exact-permit-v1"` |
| `RUNNER_CAPABILITY_SESSION_POLICY` | 786 | `"session-policy-context-v2"` |
| `RUNNER_HOSTED_LLM_TOOL_NAME` | 787 | `"mcp__runner__anthropic"` |
| `RUNNER_REQUIRED_CAPABILITIES` | 788 | `[ RUNNER_CAPABILITY_SPEND_BUDGET, RUNNER_CAPABILITY_CONTEXT_RECEIPT, RUNNER_CAPABILITY_HOSTED_LLM_PERMIT, RUNNER_CAPABILITY_SESSION_POLICY, ]` |
| `RUNNER_CAPABILITY_PROJECT_MEMORY` | 794 | `"project-memory-desktop-v1"` |
| `PROJECT_MEMORY_FORWARD_TIMEOUT_MS` | 795 | `5e3` |
| `RUNNER_CAPABILITY_SESSION_PLAN` | 796 | `"session-plan-desktop-v2"` |
| `RUNNER_CAPABILITY_SESSION_PLAN_V1` | 797 | `"session-plan-desktop-v1"` |
| `SESSION_PLAN_FORWARD_TIMEOUT_MS` | 798 | `55e3` |
| `RUNNER_CAPABILITY_CHARACTER_VOICE` | 799 | `"character-voice-desktop-v1"` |
| `CHARACTER_VOICE_FORWARD_TIMEOUT_MS` | 800 | `9e5` |
| `DISPLAY_TURN_ID_RE` | 801 | `/^[a-f0-9]{8}-[a-f0-9]{4}-[45][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/` |
| `CHARACTER_VOICE_TOOL_DESCRIPTION` | 806 | `Save and reuse a named person's voice in this project, for the user or an explicitly authorized person. List first. prepare takes actual project audio references and asks the real rights question once; it starts no paid work. For files in this video, use kind=file, sessionId="current", and the job-relative path for references, photos and originalVideo; the app resolves its own video ID. Only when …(截断) |
| `CHARACTER_VOICE_GUIDANCE` | 807 | `## Saved project voices When planning new narration, use character_voice list to check this project's approved voice and permitted use before choosing a new narrator. The current user's request wins; …(多行，见源文件) |
| `SAVED_VOICE_RIGHTS_EXEMPTION` | 823 | `"Not needed for an approved saved voice that character_voice get returned for this use: its rights_confirmation receipt already carries the user's saved consent, so pass it unchanged instead of asking again. "` |
| `SAVED_VOICE_RIGHTS_INSTRUCTION` | 825 | `"This approved saved voice already carries the user's rights decision for this use. Pass rights_confirmation unchanged to reference_tts; do not call request_rights_confirmation for it."` |
| `SESSION_ROUTER_MAX_BYTES` | 827 | `16 * 1024` |
| `SESSION_CAPABILITY_DIGEST_MAX_BYTES` | 828 | `8 * 1024` |
| `SESSION_WORKFLOW_INDEX_MAX_BYTES` | 829 | `16 * 1024` |
| `WORKFLOW_INDEX_HEADING` | 830 | `"## Workflow index (this session's pinned catalog)"` |
| `ENGINE_TOOL_LAUNCHER` | 840 | `'uv run --project "$VIDEOCLAW_ENGINE" python "$VIDEOCLAW_ENGINE/tools/<tool>.py" --job <bare-id>'` |
| `ENGINE_PIPE_RULE` | 842 | "One engine command per call; its output may only be piped into `tail -n <N>`; never write `set -o pipefail` (the app adds it)." |
| `PREPARE_PRODUCTION_NO_PIPE` | 844 | "Never pipe `prepare_production`; read its whole output." |
| `PROJECT_MEMORY_GUIDANCE` | 845 | `## Optional project memory Use project_memory to read, save, revise or forget a short project note whenever it is likely to spare the user a repeated explanation, correction, setup step or failed att …(多行，见源文件) |
| `ACCOUNT_PREFERENCE_TOOL_DESCRIPTION` | 875 | `"Save one standing preference that applies to ALL of the user's projects and videos into their account-wide Taste. The app shows a notice in this chat and lists it in Settings → Taste → All your projects."` |
| `ACCOUNT_PREFERENCE_GUIDANCE` | 877 | `## Account-wide preferences When the user explicitly asks for a standing rule for every video or project ("any time you make videos, use X"), call save_account_preference once with a self-contained rule that briefly includes the user's own words. Do not Edit or Write taste/GLOBAL.md COMMITMENTS directly for this. The saved rule is visible to the user in the chat notice and in Settings → Taste → A …(截断) |
| `WORKFLOW_ADVISOR_GUIDANCE` | 888 | `## App-owned workflow guidance When this prompt includes a Workflow index section, it lists every workflow in this session's pinned catalog, one line each. For a video creation or editing task, pick  …(多行，见源文件) |
| `SESSION_LAWS_VERSION` | 972 | `/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/` |
| `DEFAULT_RING_CAPACITY` | 1126 | `500` |
| `MAX_ENTRY_CHARS` | 1127 | `4e3` |
| `CLAMP_MARKER` | 1128 | `"…[clipped]"` |
| `CONTINUE_TURN_ID_PREFIX` | 1193 | `"continue-"` |
| `STUDIO_CHANNEL_SCHEMA` | 1211 | `"videoclaw.studio-channel/v1"` |
| `STUDIO_CACHE_SCHEMA` | 1212 | `"videoclaw.studio-channel-cache/v1"` |
| `DISK_FULL` | 1228 | `"Your disk is full. Videoclaw needs "` |
| `NOT_PREPARED` | 1229 | `"Videoclaw couldn’t prepare its verified workflows."` |
| `OFFLINE` | 1230 | `${NOT_PREPARED} Check your connection and try again.` |
| `REPAIR` | 1231 | `"Open Engine status from your account menu to repair it, or send us a report with this error."` |
| `FEATURE_FLAGS_SCHEMA` | 1249 | `"videoclaw.feature-flags/v1"` |
| `FEATURE_FLAGS_CACHE_SCHEMA` | 1250 | `"videoclaw.feature-flags-cache/v1"` |
| `FEATURE_FLAGS_DENY_FLOOR_SCHEMA` | 1251 | `"videoclaw.feature-flags-deny-floor/v1"` |
| `FEATURE_FLAG_REASON_CODES_BY_NAMESPACE` | 1253 | `{ tools: ["tool_incident", "tool_staged"], vendors: ["vendor_incident", "vendor_staged"], ui: ["ui_incident", "ui_staged"], }` |
| `FEATURE_FLAG_REASON_CODES` | 1258 | `[ "tool_incident", "tool_staged", "vendor_incident", "vendor_staged", "ui_incident", "ui_staged", ]` |
| `FLAGGABLE_UI_CAPABILITIES` | 1266 | `["hyperframes_editor", "codex_runtime", "remote_runtime"]` |
| `ENGINE_TO_GATEWAY_TOOL` | 1267 | `{ mint_video: "mint_video", mint_image: "mint_image", cast_avatar: "cast_avatar", perform_avatar: "perform_avatar", synth_voice: "synth_voice", sam3: "sam3", stem_split: "stem_split", lipsync_footage: "lipsync", score_bed: "music", }` |
| `FEATURE_FLAG_REASON_COPY` | 1283 | `{ tool_incident: "This is temporarily turned off by VideoClaw while we fix a problem. Nothing you did caused this, and you have not been charged.", tool_staged: "This isn't switched on for your account yet.", vendor_incident: "This capability is temporarily unavailable while we work around a provider problem.", vendor_staged: "This isn't switched on for your account yet.", ui_incident: "This is te …(截断)` |
| `GATEWAY_TOOL_DISABLED_CODE` | 1293 | `"TOOL_DISABLED_BY_OPERATOR"` |
| `GATEWAY_CAPABILITY_UNAVAILABLE_CODE` | 1294 | `"CAPABILITY_UNAVAILABLE"` |
| `VENDOR_KEY_RE` | 1304 | `/^[a-z0-9][a-z0-9._/-]*$/` |
| `TOOL_KEY_RE` | 1305 | `/^[a-z0-9][a-z0-9._-]*$/` |
| `ROLLOUT_SALT_RE` | 1306 | `/^[a-z0-9][a-z0-9._-]{0,63}$/` |
| `KEY_ID_RE$2` | 1307 | `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/` |
| `BASE64URL_RE` | 1308 | `/^[A-Za-z0-9_-]+$/` |
| `SEMVER_RE` | 1309 | `/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/` |
| `RFC3339_UTC_RE` | 1310 | `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z\|[+-]\d{2}:\d{2})$/` |
| `DOCUMENT_KEYS` | 1311 | `[ "environment", "flags", "generation", "issued_at", "rollout_salt", "schema", "signature", ]` |
| `ENTRY_KEYS` | 1320 | `/* @__PURE__ */ new Set(["state", "percent", "reason_code", "min_app_version"])` |
| `SIGNATURE_KEYS` | 1321 | `["algorithm", "key_id", "value"]` |
| `ROLLOUT_PREFIX` | 1470 | `"videoclaw-flag-rollout/v1"` |
| `COHORT_ID_RE` | 1471 | `/^[0-9a-f]{64}$/` |
| `SUBMISSION_ID_RE` | 1579 | `/^[A-Za-z0-9_-]{8,64}$/` |
| `WORKFLOW_SUBMISSION_LIMITS` | 1583 | `{ maxEntries: 400, maxEntryBytes: 1024 * 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 * 1024, /** * The largest textual file this app will fully secret-scan. A textual file * bigger than this is SKIPPE …(多行，见源文件)` |
| `WORKFLOW_NAME_MAX_LEN` | 1601 | `60` |
| `TEMPLATE_FILE_EXT` | 1620 | `/\.(?:tsx?\|jsx?\|html\|css\|json)$/` |
| `TEMPLATE_ENTRYPOINT_EXT` | 1621 | `/\.(?:tsx?\|html)$/` |
| `EXAMPLE_FILE_EXT` | 1622 | `/\.(?:py\|mjs\|js\|ts)$/` |
| `ACCOUNT_PREFERENCE_MAX_TEXT` | 1638 | `1e3` |
| `PROJECT_MEMORY_MAX_TEXT` | 1651 | `4e3` |
| `PROJECT_MEMORY_MAX_SOURCES` | 1652 | `16` |
| `PROJECT_MEMORY_MAX_RELATED` | 1653 | `16` |
| `PROJECT_MEMORY_TOOL_DESCRIPTION` | 1666 | `"Optional project notes. Read first, then save/revise/forget with the returned expectedRevision. Set retain:true on a file/version source only for an explicitly reusable asset (logo, brand file, identity reference or reuse request); ordinary evidence never needs a copy. The app adds its saved Library link. Use the returned persisted messageSources; file paths are relative to the cited video job, L …(截断)` |
| `NOT_ANSWERED` | 1668 | `{ retired: "Closed before it was answered", aborted: "Closed when the turn ended", }` |
| `MONEY_ASK_TITLE` | 1756 | `"Paid operation"` |
| `FAMILIES` | 1833 | `/* @__PURE__ */ new Set([ "question", "voiceover", "files", "rights", "permission", "money", "budget", ])` |
| `OUTCOMES` | 1842 | `/* @__PURE__ */ new Set([ "answered", "approved", "denied", "failed", "cancelled", "retired", "aborted", ])` |
| `MATERIALS_LEDGER_LIMIT` | 1884 | `200` |
| `VIDEO_EXT$1` | 1885 | `/\.(mp4\|mov\|m4v\|webm\|mkv\|avi)$/i` |
| `IMAGE_EXT$1` | 1886 | `/\.(png\|jpe?g\|webp\|gif\|heic\|avif\|tiff?)$/i` |
| `AUDIO_EXT$1` | 1887 | `/\.(mp3\|wav\|m4a\|aac\|flac\|ogg\|aiff?)$/i` |
| `DOC_EXT` | 1888 | `/\.(pdf\|txt\|md\|rtf\|csv\|tsv\|json\|srt\|vtt\|xlsx\|xls\|ods)$/i` |
| `ORIGINS` | 1896 | `/* @__PURE__ */ new Set([ "upload", "paste", "voice-note", "studio-files", "voiceover", "quickstart", "agent-pull", ])` |
| `KINDS` | 1905 | `/* @__PURE__ */ new Set(["video", "image", "audio", "document", "other"])` |
| `STATES` | 1906 | `/* @__PURE__ */ new Set(["present", "missing", "unverified"])` |
| `SESSION_PREVIEW_ASPECTS` | 1928 | `[ "21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16", "4:1", "1:4", "8:1", "1:8", …(多行，见源文件)` |
| `SESSION_PLAN_CHANGES` | 1953 | `["title", "format", "length", "shots", "script", "cost"]` |
| `PLAN_PAID_OPERATIONS_WHEN` | 1954 | `"Optional: use it before multi-step paid work when no plan was proposed. It is not needed for a single asset or a small edit, and after a plan is built its paidOperations already count as this declaration."` |
| `SESSION_PLAN_MAX_TEXT` | 1956 | `8e3` |
| `SESSION_PLAN_MAX_CORRECTION` | 1957 | `4e3` |
| `SESSION_PLAN_MAX_TITLE` | 1958 | `80` |
| `SESSION_PLAN_MAX_SHOT_LABEL` | 1959 | `40` |
| `SESSION_PLAN_MAX_SECONDS` | 1960 | `3600` |
| `SESSION_PLAN_MOTION_GUIDANCE` | 1961 | `"Direct simple proposals use still-image previews only. Always omit motionReason from the fallback payload, including revisions of an older plan. Put motion or no-motion explanations in text or description instead; this field must not enable a motion preview."` |
| `SESSION_PLAN_GUIDANCE` | 1963 | `Follow the live app-owned session policy. Answer informational questions directly in every mode. In Bypass (bypassPermissions), proceed with reasonable creative assumptions: do not ask optional creative questions or require a plan/Build click. This includes optional Quickstart preferences; do not invent missing required inputs or rights. Proceed to the full build, including after a Preview choice …(截断) |
| `SESSION_PLAN_GUIDANCE_V1` | 1964 | `Follow the live app-owned session policy. Answer informational questions directly in every mode. In Bypass (bypassPermissions), proceed with reasonable creative assumptions: do not ask optional creative questions or require a plan/Build click. This includes optional Quickstart preferences; do not invent missing required inputs or rights. Proceed to the full build, including after a Preview choice …(截断) |
| `SESSION_PREVIEW_GUIDANCE` | 1965 | `The preview-only limits below apply outside Bypass. Under the live Bypass policy, proceed to the full build with reasonable creative assumptions, including after a Preview choice; required inputs, rights, valid prices and credits still apply. Only after the user explicitly chooses Show me a preview for this exact text revision, prepare a representative preview, not a full build. For a saved story …(截断) |
| `REDACTIONS` | 1966 | [ // Videoclaw keys: vc_<hex/alnum>. The acceptance grep is `vc_[0-9a-f]` — cover // that and any alnum minting shape. [/vc_[A-Za-z0-9]{6,}/g, "[redacted-key]"], // OpenAI-style keys. [/sk-[A-Za-z0-9_ …(多行，见源文件) |
| `PATH_REDACTIONS` | 1995 | `[ // file:// resources (the renderer's own bundle URLs carry the home dir) stay // fully redacted: they are local filesystem paths wearing a URL costume. // First, so the home-directory rule below can …(多行，见源文件)` |
| `URL_CANDIDATE` | 2011 | /https?:\/\/[^\s<>"'`]*/gi |
| `CLOSERS` | 2012 | `{ ")": "(", "]": "[", "}": "{" }` |
| `EXCEPTION_MESSAGE_MAX` | 2058 | `500` |
| `EXCEPTION_PROPERTY_KEYS` | 2059 | `[ "token", "distinct_id", "$session_id", "$window_id", "$is_identified", "$process_person_profile", "$exception_list", "$exception_type", "$exception_message", "$exception_level", "app_version", "envi …(多行，见源文件)` |
| `V8_FRAME` | 2086 | `/^\s*at (?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/` |
| `LEVELS` | 2446 | `["log", "info", "warn", "error", "debug"]` |
| `VOICEOVER_NAME_PREFIX_RE` | 2534 | `/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/` |
| `GENERATED_IMAGE_EXTENSIONS` | 2535 | `/* @__PURE__ */ new Set([".png", ".jpg", ".jpeg", ".webp"])` |
| `MAX_GENERATED_IMAGE_BYTES` | 2536 | `32 * 1024 * 1024` |
| `PROJECT_TEXT_EXTENSIONS` | 2537 | `/* @__PURE__ */ new Set([ ".ass", ".cjs", ".css", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".srt", ".ts", ".tsx", ".txt", ".vtt", …(多行，见源文件)` |
| `MAX_PROJECT_TEXT_BYTES` | 2555 | `1e6` |
| `RESERVED_PROJECT_TEXT_NAME` | 2556 | `/(?:^\.\|lock\|receipt\|provenance\|run\.log)/i` |
| `RELATIVE_TEXT_REPLACER` | 2674 | String.raw` const fs = require('node:fs') |
| `RELATIVE_WRITER` | 2864 | String.raw` set -eu case "$3" in darwin) actual=$(/usr/bin/stat -f '%d:%i' .)  |
| `MAX_FILE_BYTES` | 2998 | `1024 * 1024` |
| `ID` | 2999 | `/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/` |
| `SHA$1` | 3000 | `/^[a-f0-9]{64}$/` |
| `HEADER` | 3001 | `"# Project memory\n\n"` |
| `META$1` | 3002 | `"<!-- videoclaw-project-memory/v1 "` |
| `ENTRY` | 3003 | `"<!-- memory-entry "` |
| `END` | 3004 | `"\n<!-- /memory-entry -->"` |
| `SOURCES` | 3005 | `"\n\n<!-- memory-sources -->\n"` |
| `SESSION_PREVIEW_MAX_ATTEMPTS` | 3582 | `3` |
| `REQUIRED_SESSION_CONTEXT_FILES` | 4024 | `{ operatingRules: "CLAUDE.md", laws: "laws/producer_laws.md", capabilityDigest: "laws/capability_digest.md", router: "workflows/README.md", preflightHook: ".claude/hooks/preflight.sh", preflightBlock: ".claude/PRODUCTION_PREFLIGHT.md", productionGuard: ".claude/hooks/production_guard.py", engineSettings: ".claude/settings.json", prepareProductionTool: "tools/prepare_production.py", projectBriefToo …(截断)` |
| `PORTABLE_ENGINE_ROOT` | 4049 | `"${VIDEOCLAW_ENGINE:-$CLAUDE_PROJECT_DIR}"` |
| `ENGINE_PYTHON_PROBLEM` | 4203 | `"the engine's own Python (.venv/bin/python) is missing or damaged"` |
| `AUDIT_SCHEMA` | 4245 | `"videoclaw.workspace-channel-audit/v1"` |
| `AUDIT_NAME` | 4246 | `"channel-workspace-audit.json"` |
| `CLAIM_SCHEMA$1` | 4247 | `"videoclaw.workspace-channel-claim/v1"` |
| `CLAIM_NAME` | 4248 | `"channel-workspace-claim.json"` |
| `LEGACY_MIGRATION_SCHEMA` | 4249 | `"videoclaw.legacy-storage-migration/v1"` |
| `LEGACY_MIGRATION_NAME` | 4250 | `".videoclaw-storage-migration.json"` |
| `GATEWAY_KEY_FORMAT` | 5106 | `/^vc_[0-9a-f]{40}$/` |
| `KEY_ID_DOMAIN` | 5156 | `"videoclaw-alpha-consent-key/v1\0"` |
| `KEY_ID_RE$1` | 5157 | `/^[a-f0-9]{64}$/` |
| `APP_SETTINGS_KEYS` | 5273 | `[ "gatewayUrl", "updateChannelPreference", "telemetry", "usageSharingConsentAt", "agentHarness", "codexProvider", "codexModel", "llmRoute", "llmRouteAcknowledgedAt", "alphaConsentAt", "alphaConsentsBy …(多行，见源文件)` |
| `LOCAL_RESET_SETTINGS_KEEP` | 5594 | `[ "gatewayUrl", "accountSignedInOnce", "lastEngineVersion", "world3", "runnerUrl", ]` |
| `LOCAL_RESET_MARKER` | 5650 | `"reset-pending.json"` |
| `MARKER_SCHEMA` | 5651 | `"videoclaw.local-reset/v1"` |
| `CODEX_AUTH_FILE` | 5652 | `"auth.json"` |
| `FLAG_DENY_FLOOR` | 5653 | `"deny-floor.json"` |
| `LOCAL_RESET_USERDATA` | 5654 | `[ "sessions.json*", "engine-profile", "display-transcripts", "remote-sessions", "material-ledgers", "versions.json*", "composer-*", "session-context-receipts", "post-compact-route-barriers.pending.jso …(多行，见源文件)` |
| `BILLING_CLI_CONTRACT_SCHEMA` | 6239 | `"videoclaw.cost-cli-capabilities/v2"` |
| `BILLING_CLI_ESTIMATE_CONTRACT_SCHEMA` | 6240 | `"videoclaw.cost-cli-capabilities/v3"` |
| `BILLING_CLI_PLAN_CAPABILITY` | 6241 | `"videoclaw.cost-cli.plan/v1"` |
| `BILLING_CLI_ESTIMATE_CAPABILITY` | 6242 | `"videoclaw.cost-cli.estimate/v1"` |
| `EXPECTED_BILLING_CLI_CONTRACT` | 6243 | `JSON.stringify({ commands: { plan: BILLING_CLI_PLAN_CAPABILITY, }, schema: BILLING_CLI_CONTRACT_SCHEMA, })` |
| `EXPECTED_BILLING_CLI_ESTIMATE_CONTRACT` | 6249 | `JSON.stringify({ commands: { estimate: BILLING_CLI_ESTIMATE_CAPABILITY, plan: BILLING_CLI_PLAN_CAPABILITY, }, schema: BILLING_CLI_ESTIMATE_CONTRACT_SCHEMA, })` |
| `PRICE_SURFACE_DUMP` | 6266 | `[ "import json, math, sys", 'sys.path.insert(0, "tools")', "import cost", "def valid_number(value):", " return (isinstance(value, (int, float)) and not isinstance(value, bool)", " and math.isfinite(va …(多行，见源文件)` |
| `PYTHON_MISSING_REASON` | 6435 | `"VideoClaw's own Python is missing or damaged, so it can't run commands safely."` |
| `SETUP_REPAIR_ACTION` | 6437 | `"Repair VideoClaw"` |
| `PYTHON_REPAIR_MESSAGE` | 6438 | `${PYTHON_MISSING_REASON} Click ${SETUP_REPAIR_ACTION} in the chat to fix it.` |
| `PRODUCTION_VERDICT_SCHEMA` | 6439 | `"videoclaw.production-verdict/v5"` |
| `PRODUCTION_ANALYZER` | 6440 | `"prepare_production.shell-ir/v1"` |
| `ROUTE_RECEIPT_SCHEMA` | 6441 | `"videoclaw.route-receipt/v8"` |
| `SHA256_RE$3` | 6442 | `/^[0-9a-f]{64}$/` |
| `JOB_ID_RE$3` | 6443 | `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` |
| `ACTION_NAME_RE` | 6444 | `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` |
| `TOP_LEVEL_KEYS` | 6445 | `[ "actionFamily", "actions", "analyzer", "classification", "commandSha256", "error", "jobIds", "jobs", "routeCurrent", "schema", "spendRisk", ]` |
| `ACTION_KEYS` | 6458 | `["argv", "family", "jobId", "name", "spendRisk"]` |
| `JOB_KEYS` | 6459 | `["jobId", "receiptIdentity"]` |
| `IDENTITY_KEYS` | 6460 | `[ "contextEpochSha256", "contextIdentitySha256", "engineBuildSha256", "engineIdentitySha256", "receiptSha256", "schema", ]` |
| `ERROR_KEYS` | 6468 | `["code", "message"]` |
| `UV_PYTHON_POLICY_ENV` | 7145 | `{ UV_PYTHON_PREFERENCE: "only-managed" }` |
| `CPU_TYPE_ARM64` | 7146 | `16777228` |
| `MH_MAGIC_64` | 7147 | `4277009103` |
| `FAT_MAGIC` | 7148 | `3405691582` |
| `FAT_MAGIC_64` | 7149 | `3405691583` |
| `GIT_UNAVAILABLE_MESSAGE` | 7199 | `"git isn't available because this Mac doesn't have Apple's developer tools."` |
| `PIP_UNAVAILABLE_MESSAGE` | 7201 | `"pip isn't available in VideoClaw. Setup installs its Python packages."` |
| `ENGINE_COMMAND_SHIMS` | 7203 | `["python3", "python", "pip3", "pip", "git"]` |
| `SHA256$2` | 7309 | `/^[a-f0-9]{64}$/` |
| `SEMVER` | 7310 | `/^v?\d+(?:\.\d+)*(?:-[A-Za-z0-9.-]+)?$/` |
| `KEY_ID$1` | 7311 | `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/` |
| `ED25519_SPKI_PREFIX$2` | 7312 | `Buffer.from("302a300506032b6570032100", "hex")` |
| `MAX_STUDIO_ARCHIVE_BYTES` | 7314 | `256 * 1024 * 1024` |
| `MAX_STUDIO_ARCHIVE_ENTRIES` | 7315 | `1e4` |
| `MAX_STUDIO_MEMBER_BYTES` | 7316 | `256 * 1024 * 1024` |
| `MAX_STUDIO_UNCOMPRESSED_BYTES` | 7317 | `1024 * 1024 * 1024` |
| `MAX_STUDIO_COMPRESSION_RATIO` | 7318 | `100` |
| `MAX_UNPUBLISHED_REFRESH_BACKOFF` | 7319 | `16` |
| `DOWNLOAD_STALLED` | 7320 | `"Studio download stalled. Try again."` |
| `ED25519_SPKI_PREFIX$1` | 8320 | `Buffer.from("302a300506032b6570032100", "hex")` |
| `DECISION_RUN_LIMIT` | 8345 | `64` |
| `EXTRA_PATHS` | 9322 | `[ join(homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".cargo", "bin"), ]` |
| `STORAGE_FAILURE` | 9439 | `/\bENOSPC\b\|no space left on device\|not enough space\|insufficient (disk )?space\|disk (is )?full\|out of disk space/i` |
| `MIN_PLAN_FREE_ENGINE_APP_VERSION` | 9464 | `"0.0.11"` |
| `WORKSPACE_LAUNCHER_LINE` | 9572 | ` ${ENGINE_TOOL_LAUNCHER} ...` |
| `EXECUTION_CONTRACT_MARKER` | 9573 | `"<!-- videoclaw-execution-contract:3 -->"` |
| `EXECUTION_CONTRACT_BULLETS` | 9574 | [ "- `$VIDEOCLAW_ENGINE` is pinned for this app session. Use the launcher above for every engine tool; do not resolve or rewrite its path.", `- ${ENGINE_PIPE_RULE}`, '- Direct URL acquisition may be metered, and the app authorizes it like any paid step. Call `pull_video --mode pull --url "<url>" --name <slot> --job <id>`; it owns retries and saves under `footage/`.', "- Quality and resolution are  …(截断) |
| `EXECUTION_CONTRACT` | 9581 | `[ EXECUTION_CONTRACT_MARKER, "", "Execution contract:", ...EXECUTION_CONTRACT_BULLETS, "", ].join("\n")` |
| `LEGACY_WORKSPACE_LINES` | 9588 | `/* @__PURE__ */ new Map([ [ "CLAUDE.md + preflight are authoritative. Run every tool from the engine:", "CLAUDE.md + preflight are authoritative. Run every engine tool from this folder with:", ], [ '  …(多行，见源文件)` |
| `VOICE_NOTE_RATE` | 10512 | `48e3` |
| `PROGRESS_INTERVAL_MS` | 11240 | `100` |
| `COPY_SIZE_MISMATCH` | 11241 | `"COPY_SIZE_MISMATCH"` |
| `INTAKE_FOLDER_LIMITS` | 11242 | `{ maxDepth: INTAKE_FOLDER_MAX_DEPTH, maxFiles: INTAKE_FOLDER_MAX_FILES, maxBytes: INTAKE_FOLDER_MAX_BYTES, maxVisits: INTAKE_FOLDER_MAX_VISITS, }` |
| `HEIC_RE$1` | 11526 | `/\.(heic\|heif)$/i` |
| `META` | 11564 | `"meta.json"` |
| `SHEET` | 11565 | `"sheet.png"` |
| `REFS` | 11566 | `"refs"` |
| `PENDING` | 11567 | `"pending"` |
| `MAX_DOCUMENT_BYTES` | 11794 | `1024 * 1024` |
| `UUID` | 11795 | `/^[a-f0-9-]{36}$/` |
| `SHA` | 11796 | `/^[a-f0-9]{64}$/` |
| `CLAIM_SCHEMA` | 12295 | `"videoclaw.version-registry-claim/v1"` |
| `CLAIM_PREFIX` | 12296 | `"claim-"` |
| `CLAIM_SUFFIX` | 12297 | `".json"` |
| `MALFORMED_CLAIM_STALE_MS` | 12298 | `3e4` |
| `SHA256_RE$2` | 12531 | `/^[0-9a-f]{64}$/i` |
| `PASS_WORDS` | 12532 | `/* @__PURE__ */ new Set(["ok", "pass", "passed", "succeeded", "success"])` |
| `QA_OUTCOMES` | 12533 | `/* @__PURE__ */ new Set(["PASS", "CONTENT_FAIL", "QA_UNAVAILABLE"])` |
| `SUPPORTED_FINAL_QA_SCHEMAS` | 12534 | `/* @__PURE__ */ new Set([ "videoclaw.final-qa/v1", "videoclaw.final-qa/v2", "videoclaw.final-qa/v3", "videoclaw.final-qa/v4", "videoclaw.final-qa/v5", ])` |
| `ENGINE_STAGING` | 12796 | `/^\.[^/]+\.(\d+)\.\d+\.partial(\.[a-z0-9]+)?$/i` |
| `SCRATCH_ACTIVE_MS` | 12805 | `6e4` |
| `RENDER_RECORD_SCHEMA` | 12815 | `"videoclaw.render-complete/v1"` |
| `RENDER_RECORD_NAME` | 12816 | `/^([0-9a-f]{64})\.json$/` |
| `RECORDED_VIDEO` | 12817 | `/\.(mp4\|mov\|m4v\|webm)$/i` |
| `MAX_MINTS_PER_SCAN` | 12873 | `2` |
| `FALLBACK_RENDER_QUIET_MS` | 12874 | `3e3` |
| `VIDEO_EXT` | 14333 | `/\.(mp4\|mov\|webm\|m4v)$/i` |
| `IMAGE_EXT` | 14334 | `/\.(png\|jpe?g\|webp\|gif)$/i` |
| `AUDIO_EXT` | 14335 | `/\.(mp3\|wav\|m4a\|aac\|flac)$/i` |
| `SKIP_DIRS` | 14336 | `/* @__PURE__ */ new Set([ "node_modules", ".git", "__pycache__", "review_frames", "versions", // app-managed version snapshots — listed separately ".takes", // engine#283: paid results awaiting public …(多行，见源文件)` |
| `MAX_ASSETS` | 14362 | `300` |
| `INTERNAL_ROOT_RENDERS` | 14363 | `/* @__PURE__ */ new Set(["final_raw.mp4", "base_source.mp4"])` |
| `FINAL_CANDIDATE_SETTLE_MS` | 14364 | `500` |
| `CUT_NOTE_TIMELINE` | 14430 | `"In the cut = the edit map (timeline.json): the on-camera base + the stills it places. VO/music matched to delivered files by heuristic. No per-version map, so versions share this one."` |
| `CUT_NOTE_NONE` | 14432 | `"No edit map found — showing everything this video used and produced, ungrouped by use."` |
| `ENGINE_RENDERS_FILE` | 14557 | `/^\.?[0-9a-f]{64}\.(json\|mp4\|mov\|m4v\|webm)(\..*)?$/i` |
| `SOURCE_DIRS` | 14586 | `/* @__PURE__ */ new Set([ "breakdown", "capframes", "footage", "frames", "incoming", "reference", "references", "social_pull", "source", ])` |
| `WORKING_DIRS` | 14597 | `/* @__PURE__ */ new Set([ "analysis", "captions", "contact_sheets", "driver_clips", "masks", "qa", "review_frames", "stems", "strips", "words", ])` |
| `PROJECT_TRASH_DIR` | 14786 | `".videoclaw-trash"` |
| `PROJECT_TRASH_SCHEMA` | 14787 | `"videoclaw.project-trash/v1"` |
| `PROJECT_TRASH_RETENTION_MS` | 14788 | `7 * 24 * 60 * 60 * 1e3` |
| `PROJECT_TRASH_PURGE_BUDGET` | 14789 | `8` |
| `ENTRY_ID_RE` | 14790 | `/^[0-9A-Za-z][0-9A-Za-z-]{9,127}$/` |
| `MANIFEST_NAME` | 14791 | `"manifest.json"` |
| `SECTION` | 15178 | `"## COMMITMENTS"` |
| `ANTI` | 15179 | `"## ANTI-COMMITMENTS"` |
| `ANTI_HEADING` | 15180 | `"## ANTI-COMMITMENTS (declined proposals — do not re-raise)"` |
| `DATED` | 15274 | `/^\d{4}-\d{2}-\d{2} — /` |
| `SYSTEM_CODE` | 15566 | `/\b(EPIPE\|ECONNRESET\|ECONNREFUSED\|ETIMEDOUT\|ENOTFOUND\|EAI_AGAIN\|ENETUNREACH\|EHOSTUNREACH\|ENOENT\|EACCES\|EPERM\|ENOMEM\|ENOSPC\|EDQUOT\|EIO\|EROFS)\b/i` |
| `RUNTIME_ERROR_CODES` | 15568 | `{ authentication_failed: { code: "AUTH_REJECTED", kind: "auth" }, oauth_org_not_allowed: { code: "AUTH_REJECTED", kind: "auth" }, account_on_hold: { code: "AUTH_REJECTED", kind: "auth" }, verification …(多行，见源文件)` |
| `PYTHON_HELPER` | 15672 | String.raw`(?:^\|[\s'"/])` |
| `AUTOMATIC_ENGINE_STEP_REFUSAL` | 15679 | `"This engine step isn’t run directly here; continue with the edit."` |
| `FINAL_RENDER_TIMEOUT_MS` | 15698 | `6e5` |
| `REVIEW_RENDER_TOOL` | 15699 | `"review_render"` |
| `FULL_WINDOW_MODES` | 15700 | `{ compose_render: /* @__PURE__ */ new Set([ "render", "retrofit", "cover_bake", "episode", "bespoke", ]), remotion_render: null, score_bed: /* @__PURE__ */ new Set(["bed", "generate", "recover"]), [REVIEW_RENDER_TOOL]: null, }` |
| `HOUSE_PAID_TOOLS` | 15753 | `/* @__PURE__ */ new Set([ "review_render", "review_output", "run_final_qa", ])` |
| `URL_PULL_MAXIMUM_CENTS` | 15758 | `162` |
| `URL_PULL_TOOLS` | 15759 | `/* @__PURE__ */ new Set(["pull_video", "acquire_footage"])` |
| `NON_PULL_ROLES` | 15760 | `/* @__PURE__ */ new Set(["enumerate", "search"])` |
| `TOOL$1` | 15772 | `/^[a-z][a-z0-9_]{1,63}$/` |
| `ROLE` | 15773 | `/^[a-z][a-z0-9_-]{0,63}$/` |
| `MAX_OPERATIONS` | 15774 | `32` |
| `MAX_COUNT` | 15775 | `500` |
| `ESTIMATE_TIMEOUT_MS` | 15776 | `5e3` |
| `MIN_PLANNED_SECONDS` | 15890 | `0.1` |
| `MAX_PLANNED_SECONDS` | 15891 | `3600` |
| `PLAN_DISPLAY_DEADLINE_MS` | 15892 | `8e3` |
| `PLAN_DISPLAY_CONCURRENCY` | 15893 | `4` |
| `AGENT_STARTUP_ENV_DENYLIST` | 16004 | `/* @__PURE__ */ new Set([ "BASH_ENV", "BASHOPTS", "CDPATH", "ENV", "GLOBIGNORE", "PYTHONHOME", "PYTHONINSPECT", "PYTHONPATH", "PYTHONSTARTUP", "PYTHONUSERBASE", "PYTHONEXECUTABLE", "SHELLOPTS", "UV_EN …(多行，见源文件)` |
| `COMMAND_BROKER_AMBIENT_ALLOWLIST` | 16044 | `/* @__PURE__ */ new Set([ "HOME", "LANG", "LC_ALL", "PATH", "SSL_CERT_DIR", "SSL_CERT_FILE", "TMP", "TMPDIR", "TEMP", "TZ", ])` |
| `COMMAND_BROKER_ENGINE_ALLOWLIST` | 16056 | `/* @__PURE__ */ new Set([ "PATH", // #1038: the app's own value (only-managed), never the launch environment's. "UV_PYTHON_PREFERENCE", "VIDEOCLAW_CONTEXT_EPOCH", "VIDEOCLAW_EFFECTIVE_LAWS_SHA256", "VIDEOCLAW_EFFECTIVE_PREFLIGHT_SHA256", "VIDEOCLAW_EFFECTIVE_SETTINGS_SHA256", "VIDEOCLAW_ENGINE", "VIDEOCLAW_ENGINE_BUILD_SHA256", "VIDEOCLAW_JOBS_DIR", "VIDEOCLAW_OPERATION_RECOVERY", "VIDEOCLAW_TENAN …(截断)` |
| `GUARDED_SPEND_AUTHORITY_ALLOWLIST` | 16071 | `/* @__PURE__ */ new Set([ "VIDEOCLAW_API_KEY", "VIDEOCLAW_GATEWAY_URL", ])` |
| `CLOUD_ROOT` | 16092 | `join(homedir(), "Library", "CloudStorage")` |
| `TOOL` | 16119 | `["run", "python", "tools/index_media.py"]` |
| `SOURCE_TOO_BROAD_RE` | 16155 | `/\bsource-too-broad\b/` |
| `LIBRARY_SOURCE_TOO_BROAD` | 16156 | `"Pick your footage folder, not your whole home folder."` |
| `PNG_SIGNATURE` | 16364 | `Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])` |
| `CLIPBOARD_INTAKE_MAX_AGE_MS` | 16365 | `7 * 24 * 60 * 60 * 1e3` |
| `PDF_SCHEMA` | 16412 | `"videoclaw.pdf-text/v1"` |
| `PDF_PAGE_MAX_CHARS` | 16413 | `3e4` |
| `SHA256_RE$1` | 16414 | `/^[a-f0-9]{64}$/` |
| `VOICE_NOTE_TRANSCRIPT_MAX` | 16528 | `2e4` |
| `PDF_STATUSES` | 16529 | `/* @__PURE__ */ new Set([ "read", "encrypted", "image-only", "damaged", "too-large", "unavailable", ])` |
| `SKIP_LABEL` | 16538 | { unsupported: "not a file type I can use", "nested-archive": "archive inside the archive, not unpacked", "unreadable-workbook": "workbook I could not read", "workbook-limit": `more than ${ARCHIVE_MAX_WORKBOOKS} workbooks, not read`, } |
| `SHA256_RE` | 16597 | `/^[a-f0-9]{64}$/` |
| `HEIC_RE` | 16598 | `/\.(heic\|heif)$/i` |
| `MAX_LISTED_SKIPS` | 16601 | `50` |
| `HEIF_BRANDS` | 16602 | `/* @__PURE__ */ new Set([ "heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1", ])` |
| `JOURNAL_VERSION` | 18107 | `1` |
| `PROVIDER_REFUSAL_KINDS` | 18371 | `/* @__PURE__ */ new Set([ "content_policy", "nsfw", "likeness", "input_invalid", "unknown", ])` |
| `MAX_PROVIDER_REASON` | 18378 | `120` |
| `MAX_PROVIDER_NEXT_STEP` | 18379 | `400` |
| `PROVIDER_TEXT_UNSAFE` | 18380 | `/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff\u{e0000}-\u{e007f}]/u` |
| `UNSAFE_RUNS` | 18382 | new RegExp(`${PROVIDER_TEXT_UNSAFE.source}+`, "gu") |
| `SERVICE_PREFIX` | 18383 | `/^the [a-z0-9_.-]+ service reported:\s*/i` |
| `MAX_PROVIDER_SCAN` | 18384 | `2048` |
| `BASE32` | 18434 | `"abcdefghijklmnopqrstuvwxyz234567"` |
| `MODEL_ID_PREFIX` | 18435 | `"vcm1_"` |
| `MODEL_ID` | 18436 | `/^vcm1_[a-z2-7]{1,410}$/` |
| `MODEL_LABEL` | 18437 | `/^[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/` |
| `MAX_MODEL_LABEL` | 18438 | `128` |
| `TERMINAL` | 18468 | `/* @__PURE__ */ new Set([ "succeeded", "failed", "canceled", "cancelled", "timeout", ])` |
| `JOURNAL_NAME` | 18478 | `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/` |
| `MAX_JOURNAL_BYTES` | 18479 | `1024 * 1024` |
| `MAX_JOURNAL_SCAN` | 18480 | `1e3` |
| `UPLOAD_REFERENCE` | 18538 | `/^upload:([a-f0-9]{32})$/` |
| `MAX_RECOVERY_UPLOADS` | 18539 | `16` |
| `REFUSAL_NOTE` | 18771 | `{ content_policy: { verb: "refused", why: " under its content policy", again: "be refused again" }, nsfw: { verb: "refused", why: " as explicit content", again: "be refused again" }, likeness: { verb: "refused", why: " because its image may show a real person", again: "be refused again", }, input_invalid: { verb: "rejected the input of", why: "", again: "fail the same way" }, unknown: { verb: "dec …(截断)` |
| `BUSY_COLLECTION_LOCK_WAIT_S` | 18793 | `5` |
| `BUSY_COLLECTOR` | 18794 | `[ "import contextlib, inspect, json, os, sys", "fallback, script, argv = sys.argv[1], sys.argv[2], sys.argv[3:]", "sys.path.insert(0, os.path.dirname(os.path.abspath(script)))", 'operation_id = argv[a …(多行，见源文件)` |
| `DEV_FALLBACK_ENGINE` | 19076 | `"~/projects/videoclaw"` |
| `VENV_PY` | 19077 | `join(".venv", "bin", "python")` |
| `TOOL_REL` | 19078 | `join("tools", "build_character_sheet.py")` |
| `STUDIO_UPDATE_MSG` | 19079 | `"Building sheets needs a newer version of your studio than you have right now — it'll arrive with the next update. Your photos are saved."` |
| `GENERIC_FAIL` | 19081 | `"Something went wrong building the sheet. Your photos are safe — try again."` |
| `NETWORK_FAIL` | 19082 | `"Can't reach the studio right now — your photos are safe. Try again in a minute."` |
| `PHOTOS_FAIL` | 19084 | `"Those photos couldn't be used. Add a few clear, well-lit photos and rebuild the sheet."` |
| `REJECTED_FAIL` | 19086 | `"The studio couldn't work from one of those photos. Try building with a different set."` |
| `PLAN_TIMEOUT_MSG` | 19088 | `"The studio didn't answer in time — nothing was charged. Try again in a minute."` |
| `PLAN_TIMEOUT_MS` | 19090 | `2e4` |
| `SHEET_BANNED_RES` | 19111 | `[ /claude/i, /anthropic/i, /\bsdk\b/i, /\bapi\b/i, /session\|conversation/i, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, // UUIDs /\//, // any path (or URL) fragment /https?:/i, /- …(多行，见源文件)` |
| `PHOTOS_RE` | 19150 | `/no photos found\|photos folder\|couldn['’]t read ["'“]/i` |
| `REJECTED_RE` | 19151 | `/couldn['’]t create /i` |
| `REJECTED_CAUSE_RE` | 19152 | `/\b(400\|403\|422\|invalid\|reject(?:ed\|ion)?\|refus(?:ed\|al)\|policy\|moderation\|safety\|unsupported)\b/i` |
| `JOB_ID_RE$2` | 19639 | `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` |
| `COMPOSITION_DIR_REL` | 19640 | `"hyperframes"` |
| `COMPOSITION_ENTRY_REL` | 19641 | `join("hyperframes", "index.html")` |
| `TELEMETRY_REQUEST_TIMEOUT_MS` | 19708 | `3e4` |
| `JOB_ID_RE$1` | 19865 | `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` |
| `BOUND_JOB_ENV` | 19866 | `"VIDEOCLAW_BOUND_JOB"` |
| `SHELL_ASSIGNMENT_RE` | 19867 | `/^[A-Za-z_][A-Za-z0-9_]*=.*/` |
| `SHELL_VARIABLE_RE` | 19868 | `/^\$(?:([A-Za-z_][A-Za-z0-9_]*)\|\{([A-Za-z_][A-Za-z0-9_]*)\})$/` |
| `TOOL_PATH_RE` | 19869 | `/(?:^\|\/)tools\/([a-z_][a-z0-9_]*)\.py$/` |
| `PYTHON_EXE_RE` | 19870 | `/^python(?:\d+(?:\.\d+)*)?$/` |
| `MEDIA_OUTPUT_SUFFIX_RE` | 19871 | `/\.(?:gif\|m4v\|mkv\|mov\|mp4\|png\|webm)$/i` |
| `JOB_MENTION_RE` | 19872 | `/(?:^\|[^A-Za-z0-9._-])jobs\/([A-Za-z0-9][A-Za-z0-9._-]*)(?:\/\|$)/g` |
| `PROTECTED_TOOLS` | 19873 | `/* @__PURE__ */ new Set([ "assemble", "build_carousel", "build_character_sheet", "cast_avatar", "clean_audio", "compose_render", "densify", "frame_insert", "fx_parallax", "lipsync_footage", "mint_imag …(多行，见源文件)` |
| `PROTECTED_TOOL_NAME_RE` | 19894 | new RegExp( String.raw`(?:^\|/)tools/(?:${[...PROTECTED_TOOLS].sort().join("\|")})\.py(?:\s\|[;&\|()]\|$)`, ) |
| `PROVIDER_SERVICE_PATTERNS` | 19897 | [ String.raw`VIDEOCLAW_(?:API_KEY\|GATEWAY(?:_URL)?\|GW_URL)`, String.raw`aiplatform\.googleapis\.com`, String.raw`anthropic`, String.raw`api\.anthropic\.com`, String.raw`api\.apify\.com`, String.raw`ap …(多行，见源文件) |
| `PROVIDER_ACTION_PATTERNS` | 19919 | [ String.raw`\.(?:create\|generate(?:_content)?\|predict\|run\|submit)\s*\(`, String.raw`\b(?:create\|generate(?:_content)?\|predict\|run\|submit)\s*\(`, ] |
| `PROVIDER_SDK_PATTERNS` | 19923 | [ String.raw`\.audio\.(?:speech\|transcriptions\|translations)\.create\s*\(`, String.raw`\.chat\.completions\.create\s*\(`, String.raw`\.images\.(?:generate\|edit\|create_variation)\s*\(`, String.raw`\.messages\.(?:create\|stream)\s*\(`, String.raw`\.models\.generate_(?:content\|images)\s*\(`, String.raw`\.predictions\.create\s*\(`, String.raw`\.responses\.create\s*\(`, String.raw`\.text_to_speech …(截断) |
| `PROVIDER_SDK_CTOR_PATTERNS` | 19936 | [ String.raw`\bGenerativeModel\s*\(`, String.raw`genai\.Client\s*\(`, ] |
| `PROVIDER_HTTP_CLIENT_PATTERNS` | 19940 | [ String.raw`\baiohttp\b`, String.raw`\baxios\b`, String.raw`\bfetch\s*\(`, String.raw`\bgot\s*\(`, String.raw`\bhttp\.client\b`, String.raw`\bhttps?\.request\s*\(`, String.raw`\bhttpx\b`, String.raw` …(多行，见源文件) |
| `PROVIDER_HTTP_MUTATING_PATTERNS` | 19957 | [ String.raw`\.(?:patch\|post\|put\|send\|stream\|upload)\s*\(`, String.raw`\b(?:Request\|urlopen)\s*\([^)]*\bdata\s*=`, String.raw`\b(?:aiohttp\|axios\|httpx\|requests\|urllib3)\.(?:delete\|patch\|post\|put)\b`, String.raw`\b(?:httpx\|requests\|session)\.(?:request\|stream)\s*\(\s*["'](?:delete\|patch\|post\|put)["']`, String.raw`\bmethod\s*[:=]\s*["'](?:delete\|patch\|post\|put)["']`, String.raw …(截断) |
| `PROVIDER_TRANSPORT_PATTERNS` | 19969 | [ String.raw`\bcurl\b`, String.raw`\bcurlie\b`, String.raw`\bhttpie\b`, String.raw`\bhurl\b`, String.raw`\bwget\b`, String.raw`\bxh\b`, String.raw`https?://`, ] |
| `PROVIDER_BARE_NAME_PATTERNS` | 19978 | [ String.raw`anthropic`, String.raw`elevenlabs`, String.raw`fal_client`, String.raw`google\.generativeai`, String.raw`kling`, String.raw`openai`, String.raw`replicate(?:\.run)?`, String.raw`seedance`, ] |
| `PROVIDER_CREDENTIAL_PATTERNS` | 19988 | [ String.raw`VIDEOCLAW_(?:API_KEY\|GATEWAY(?:_URL)?\|GW_URL)`, String.raw`vc_[A-Za-z0-9]{16,}`, ] |
| `PROVIDER_ORIGIN_HOST_PATTERNS` | 19992 | `PROVIDER_SERVICE_PATTERNS.filter( (pattern) => !PROVIDER_BARE_NAME_PATTERNS.includes(pattern) && !PROVIDER_CREDENTIAL_PATTERNS.includes(pattern), )` |
| `PROVIDER_ORIGIN_HOST_RE` | 19999 | `hostAlternation(PROVIDER_ORIGIN_HOST_PATTERNS)` |
| `PROVIDER_SERVICE_RE` | 20011 | `alternation(PROVIDER_SERVICE_PATTERNS)` |
| `PROVIDER_STRONG_SERVICE_RE` | 20012 | `alternation( PROVIDER_SERVICE_PATTERNS.filter((pattern) => !PROVIDER_BARE_NAME_PATTERNS.includes(pattern)), )` |
| `PROVIDER_ACTION_RE` | 20015 | `alternation(PROVIDER_ACTION_PATTERNS)` |
| `PROVIDER_SDK_RE` | 20016 | `alternation(PROVIDER_SDK_PATTERNS)` |
| `PROVIDER_SDK_CALL_RE` | 20017 | `alternation( PROVIDER_SDK_PATTERNS.filter((pattern) => !PROVIDER_SDK_CTOR_PATTERNS.includes(pattern)), )` |
| `PROVIDER_HTTP_CLIENT_RE` | 20020 | `alternation(PROVIDER_HTTP_CLIENT_PATTERNS)` |
| `PROVIDER_HTTP_MUTATING_RE` | 20021 | `alternation(PROVIDER_HTTP_MUTATING_PATTERNS, "")` |
| `MAX_PROVIDER_INLINE_SOURCE_CHARS` | 20022 | `8192` |
| `MAX_PROVIDER_INLINE_BINDINGS` | 20023 | `256` |
| `PROVIDER_TRANSPORT_RE` | 20024 | `alternation(PROVIDER_TRANSPORT_PATTERNS)` |
| `READER_SHELL_OUT_RE` | 20025 | `alternation(READER_SHELL_OUT_PATTERNS)` |
| `PROVIDER_READ_ONLY_HEAD_SET` | 20026 | `new Set(PROVIDER_READ_ONLY_HEADS)` |
| `FIND_EXEC_FLAGS` | 20027 | `/* @__PURE__ */ new Set(["-exec", "-execdir", "-ok", "-okdir"])` |
| `GATEWAY_URL_ENV_VARS` | 20029 | `["VIDEOCLAW_GATEWAY_URL", "VIDEOCLAW_GW_URL"]` |
| `DEFAULT_PORTS` | 20030 | `{ "http:": "80", "https:": "443" }` |
| `URL_IN_TEXT_RE` | 20031 | `/https?:\/\/[^\s"'<>\|;,)\]}+]+/gi` |
| `PRINT_CALL_RE` | 20089 | `/\b(?:print\|puts\|echo\|console\.(?:log\|error\|info\|warn\|debug)\|sys\.(?:stdout\|stderr)\.write)\s*\(/g` |
| `HTTP_CALL_HEAD_RE` | 20178 | `/(?:\b(?:fetch\|urlopen\|Request\|axios\|got\|https?\.request)\s*\|\b(?:aiohttp\|axios\|client\|got\|httpx\|requests\|session\|superagent\|urllib3)\.[A-Za-z_]\w*\s*\|(?:\b[A-Za-z_]\w*\|\))\.(?:get\|head\|options\|delete\|patch\|post\|put\|request\|stream\|send\|upload\|open)\s*)\(/g` |
| `ASSIGNMENT_HEAD_RE` | 20180 | `/(?:^\|;\|\n\|[{}:]\|\s(?:-e\|-c)\s+)\s*(?:const\s+\|let\s+\|var\s+)?([A-Za-z_]\w*)\s*=\s*/g` |
| `PROVIDER_MODULE_PATTERN` | 20182 | String.raw`aiohttp\|anthropic\|axios\|fal_client\|genai\|got\|http\|https\|httpx\|openai\|replicate\|requests\|superagent\|undici\|urllib(?:3\|\.request)?` |
| `HTTP_ALIAS_DIRECT_RE` | 20183 | `/\b(?:aiohttp\|axios\|client\|got\|http\|https\|httpx\|requests\|session\|superagent\|undici\|urllib3)\.([A-Za-z_]\w*)\s*$/i` |
| `HTTP_ALIAS_CALLABLE_RE` | 20185 | `/^\s*(?:axios\|got)\s*$/i` |
| `HTTP_ALIAS_GETATTR_RE` | 20186 | `/\bgetattr\s*\(\s*(?:aiohttp\|axios\|client\|got\|http\|https\|httpx\|requests\|session\|superagent\|undici\|urllib3)\s*,\s*(?:["']([A-Za-z]+)["']\|[^,)]+)\s*\)\s*$/i` |
| `LITERAL_MEMBER_RE` | 20188 | new RegExp( String.raw`(?<base>\b[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\[\s*(?<quote>["'])(?<member>[A-Za-z_$][\w$]*)\k<quote>\s*\]`, "g", ) |
| `READ_METHODS` | 20192 | `/* @__PURE__ */ new Set(["get", "head", "options"])` |
| `MUTATING_METHODS` | 20193 | `/* @__PURE__ */ new Set([ "delete", "patch", "post", "put", "send", "upload", ])` |
| `COMPUTED_PROVIDER_MEMBERS` | 20201 | `/* @__PURE__ */ new Set([ ...READ_METHODS, ...MUTATING_METHODS, "create", "generate", "generate_content", "predict", "request", "run", "stream", "submit", ])` |
| `HTTP_ROOT_NAMES` | 20642 | `/* @__PURE__ */ new Set([ "aiohttp", "axios", "got", "http", "https", "httpx", "requests", "superagent", "undici", "urllib", "urllib3", ])` |
| `VENDOR_ROOT_NAMES` | 20655 | `/* @__PURE__ */ new Set([ "anthropic", "fal_client", "genai", "openai", "replicate", ])` |
| `INERT_PROVIDER_CONSTRUCTORS` | 20662 | `/* @__PURE__ */ new Set([ "aiohttp.clientsession", "axios.create", "genai.client", "google.generativeai.generativemodel", "got.extend", "http.client.httpconnection", "http.client.httpsconnection", "ht …(多行，见源文件)` |
| `INERT_CONSTRUCTOR_HEAD_RE` | 20679 | new RegExp( String.raw`\b(?:${[...INERT_PROVIDER_CONSTRUCTORS].map((value) => value.replace(/[.*+?^${}()\|[\]\\]/g, "\\$&")).join("\|")})\s*\(`, "gi", ) |
| `OPAQUE_CALL_HEAD_RE` | 20683 | `/\b([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\(/g` |
| `NESTED_CURL_RE` | 20855 | `/\bcurl(?:ie)?\b/g` |
| `DYNAMIC_EXEC_RE` | 20892 | `/(?:execFile\|execSync\|spawn\|subprocess\|system)\b\|\b(?:eval\|exec)\s*\(\|\.run\s*\(/i` |
| `MUTATING_SIGNAL_RE` | 20894 | new RegExp( [ String.raw`\bffmpeg\b`, String.raw`\bremotion\s+(?:render\|still)\b`, String.raw`execFile`, String.raw`execSync`, String.raw`subprocess`, String.raw`spawn\s*\(`, ...PROVIDER_SERVICE_PATTERNS, ...PROVIDER_SDK_PATTERNS, ].join("\|"), "i", ) |
| `READ_ONLY_MODES` | 20907 | `{ synth_voice: /* @__PURE__ */ new Set(["transcribe", "list_voices"]), densify: /* @__PURE__ */ new Set(["transcribe"]), }` |
| `FFMPEG_INPUT_PATH_OPTIONS` | 20911 | `/* @__PURE__ */ new Set([ "-attach", "-filter_complex_script", "-filter_script", "-i", ])` |
| `PROVIDER_CLI_NAMES` | 20917 | `/* @__PURE__ */ new Set([ "elevenlabs", "fal", "fal-client", "openai", "replicate", ])` |
| `PROVIDER_CLI_ACTIONS` | 20924 | `/* @__PURE__ */ new Set([ "create", "generate", "predict", "run", "submit", ])` |
| `CURL_HEAD_SET` | 20931 | `new Set(CURL_HEADS)` |
| `HTTPIE_HEADS` | 20932 | `/* @__PURE__ */ new Set(["http", "https", "httpie", "xh"])` |
| `NESTED_CURL_LAUNCHER_SET` | 20933 | `new Set(NESTED_CURL_LAUNCHERS)` |
| `INPUT_BINDING_ENV_NAMES` | 20934 | `["VIDEOCLAW_INPUT_BINDING", "VIDEOCLAW_REQUIRE_INPUT_BINDING"]` |
| `INPUT_BINDING_PYTHON_RE` | 20935 | `/^python(?:\d+(?:\.\d+)*)?$/` |
| `INPUT_BOUND_ENV_ALLOWLIST` | 21250 | `/* @__PURE__ */ new Set([ "ALL_PROXY", "CURL_CA_BUNDLE", "HOME", "HTTPS_PROXY", "HTTP_PROXY", "LANG", "LC_ALL", "NO_PROXY", "REQUESTS_CA_BUNDLE", "SSL_CERT_DIR", "SSL_CERT_FILE", "TMP", "TMPDIR", "TEM …(多行，见源文件)` |
| `PIPELINE_BREAK_OPS` | 21505 | `/* @__PURE__ */ new Set([";", "&", "&&", "\|\|", "(", ")"])` |
| `REDIRECT_OP_RE` | 21512 | `/^(?:[<>&]*[<>][<>&]*\|>\\|)$/` |
| `EMBEDDED_VARIABLE_RE` | 21713 | `/\$(?:([A-Za-z_][A-Za-z0-9_]*)\|\{([A-Za-z_][A-Za-z0-9_]*)\})/g` |
| `ENV_REF_RE` | 21721 | `/(?:os\.environ\.get\|os\.getenv)\s*\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\|os\.environ\s*\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]\|process\.env\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]\|process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g` |
| `ANTHROPIC_VERSION` | 22342 | `{ "anthropic-version": "2023-06-01" }` |
| `URL_RE` | 22388 | `/https?:\/\/\S+\|\bwww\.\S+/i` |
| `ASK_RE` | 22389 | `/\b(make\|build\|create\|copy\|duplicate\|dupe\|remix\|recreate\|recast\|grab\|pull\|fetch\|download\|rip\|turn (this\|that\|it) into\|do (this\|that)\|edit\|cut)\b/i` |
| `HEDGE_RE` | 22391 | `/\b(can'?t\|cannot\|can not\|couldn'?t\|could not\|unable\|not able\|won'?t be able\|no way\|no route\|don'?t have\|do not have\|you'?ll (have\|need) to\|you (?:will )?have to\|send me the file\|drop the (video\|file\|clip)\|instead of\|blocked\|walls? off)\b/i` |
| `SESSION_CAP` | 22393 | `3` |
| `JUDGE_TIMEOUT_MS` | 22394 | `2500` |
| `JUDGE_MODEL` | 22395 | `"claude-haiku-4-5-20251001"` |
| `LIVE_WORK_TERMINAL_LINGER_MS` | 22595 | `2600` |
| `NETWORK_PASSTHROUGH` | 22727 | `[ "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS", ]` |
| `CLAUDEAI_CONNECTORS_OFF` | 22736 | `{ ENABLE_CLAUDEAI_MCP_SERVERS: "0" }` |
| `CLAUDE_CODE_NO_SELF_STARTING_WORK` | 22737 | `{ CLAUDE_CODE_DISABLE_CRON: "1", CLAUDE_CODE_DISABLE_WORKFLOWS: "1", }` |
| `CLAUDE_CODE_LOGIN_CANCELLED` | 22794 | `"Claude sign-in was cancelled."` |
| `CLAUDE_CODE_AUTH_REJECTIONS` | 22853 | `[ /not logged in/i, /please (?:run\|use).*login/i, /authentication[_ ]error/i, /oauth.*(?:expired\|invalid\|revoked)/i, ]` |
| `SESSION_CONTEXT_RECEIPT_SCHEMA` | 22873 | `"videoclaw.session-context-receipt/v1"` |
| `CLAUDE_CODE_SELF_AUTHORIZING_STUDIO_TOOLS` | 22956 | `[ "mcp__studio__project_memory", "mcp__studio__save_account_preference", "mcp__studio__propose_session_plan", "mcp__studio__preview_session_shot", "mcp__studio__character_voice", "mcp__studio__get_wor …(多行，见源文件)` |
| `QUEUED_INPUT_GRACE_MS` | 23059 | `5e3` |
| `SUPPORTED_CODEX_VERSION` | 23381 | `"0.160.1"` |
| `MAX_ACTIVE_CODEX_APP_SERVERS` | 23382 | `4` |
| `CODEX_OPENROUTER_ENV` | 23420 | `"VIDEOCLAW_OPENROUTER_API_KEY"` |
| `CODEX_OPENAI_ENV` | 23421 | `"VIDEOCLAW_OPENAI_API_KEY"` |
| `MAX_TRACKED_PHASE_TURNS` | 23529 | `8` |
| `MAX_TRACKED_PHASE_ITEMS` | 23530 | `64` |
| `MALFORMED_FRAME_SCAN` | 23589 | `4096` |
| `MALFORMED_FRAME_SAMPLE` | 23590 | `200` |
| `MALFORMED_FRAME_AWAITING` | 23591 | `4` |
| `MALFORMED_FRAME_CLIENT_ROWS` | 23592 | `4` |
| `MALFORMED_SAMPLE_BUDGET` | 23593 | `4` |
| `MALFORMED_SAMPLE_WINDOW_MS` | 23594 | `6e4` |
| `MAX_CODEX_MODEL_PAGES` | 24612 | `20` |
| `CODEX_VIDEO_INSTRUCTIONS` | 24690 | ` You are the intelligence layer inside VideoClaw, an agentic video studio. Use normal assistant prose for a concise 3–5 step creative rundown; do not use provider-internal plan artifacts as product U …(多行，见源文件) |
| `CODEX_TOOL_MAPPING` | 24740 | ` ## Codex tool mapping (overrides earlier sections) The shared VideoClaw context above is also used by a harness that has Bash, Read, Write, and Edit tools. This Codex session does not have them. Whe …(多行，见源文件) |
| `DEFAULT_BASH_TIMEOUT_MS` | 25251 | `12e4` |
| `MAX_BASH_TIMEOUT_MS` | 25252 | `6e5` |
| `MAX_OUTPUT_CHARS` | 25253 | `3e4` |
| `OUTPUT_TAIL_CHARS` | 25254 | `8e3` |
| `DEFAULT_READ_LIMIT` | 25255 | `2e3` |
| `MAX_LINE_CHARS` | 25256 | `2e3` |
| `DEVICE_NAME_MAP` | 25459 | `{ mcp__device__bash: "Bash", mcp__device__write: "Write", mcp__device__read: "Read", }` |
| `DEFAULT_BACKOFF` | 25472 | `[500, 1e3, 2e3, 4e3, 8e3]` |
| `DEFAULT_CONTROL_RETRY` | 25473 | `[0, 100, 300, 1e3]` |
| `DEFAULT_AUTHORITY` | 27016 | `spendBudgetAuthority("http://localhost")` |
| `UNMETERED_ACQUISITION_REFUSAL` | 28134 | `"That link is a paid provider’s own file, so pulling it would bring in media whose cost nothing recorded. Videoclaw acquires media only on its priced route: use the original public link, or an uploaded file. Do not fetch it another way, and do not quote a price for it."` |
| `UNMETERED_ACQUISITION_CODE` | 28136 | `"ACQUISITION_NOT_METERED"` |
| `UNKNOWN_COST_APPROVAL_REQUIRED` | 28137 | `"This model’s temporary hold was not authorized for this exact operation. Nothing was sent."` |
| `BILLING_REFUSAL_COPY` | 28172 | `/* @__PURE__ */ new Map([ [ "ACCOUNT_DEBT", "A previous operation has an unpaid balance. Resolve it before starting more paid work; keep the original operation for its result.", ], [ "BILLING_RECONCILIATION_PENDING", "Previous billing is still being confirmed. Wait, then retry this same operation; do not start a replacement purchase.", ], ])` |
| `MEDIA_PULL_REFUSAL_COPY` | 28182 | `/* @__PURE__ */ new Map([ [ "MEDIA_PULL_URL_UNSUPPORTED", "That link is not a single YouTube video (it looks like a playlist or channel). Nothing was downloaded or charged. Send the link to one video  …(多行，见源文件)` |
| `PROVIDER_CREDENTIAL_CODE` | 28204 | `"PROVIDER_CREDENTIAL_MISCONFIGURED"` |
| `PROVIDER_CREDENTIAL_COPY` | 28205 | `"VideoClaw’s own provider key was refused, so this could not be priced or started. This is a VideoClaw configuration problem, not a problem with this model or request. Nothing was submitted or charged."` |
| `AGENT_TEXT_SPACE` | 28207 | `/[\t-\r\x1c-\x20\x85\xa0\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}]+/gu` |
| `MEDIA_PULL_METADATA_LASTING_COPY` | 28228 | `"Videoclaw can’t read YouTube video details right now, and retrying soon won’t help. Nothing was downloaded or charged. Upload the video file instead, or try the link again later."` |
| `SPEND_QUOTE_REFRESH_MESSAGE` | 28331 | `"The previous price estimate is no longer valid. Ask for an updated estimate to continue."` |
| `SPEND_POLICY_CONFLICT_MESSAGE` | 28333 | `"This video has different saved spending settings. Paid work is paused; no saved limit was changed. Set a spending limit in OUTPUT before requesting paid work again."` |
| `GATEWAY_CANCEL_REASON` | 28335 | `"videoclaw:gateway-requests-cancelled"` |
| `SPEND_APPROVAL_PENDING_MESSAGE` | 28336 | `"This step needs your spending approval. Nothing was sent to the model; the approval is waiting in the chat."` |
| `SPEND_AUTHORITY_REQUIRED_MESSAGE` | 28338 | `"This step needs more spending authority than this video currently allows, so it was not sent to the model. Set a spending limit for this video in OUTPUT, then continue."` |
| `NON_RETRYABLE_REFUSAL_CODES` | 28340 | `/* @__PURE__ */ new Set([ "SPEND_POLICY_CHANGED", "ACCOUNT_DEBT", PROVIDER_CREDENTIAL_CODE, SPEND_APPROVAL_PENDING_CODE, SPEND_AUTHORITY_REQUIRED_CODE, ])` |
| `ESTIMATED_SETTLEMENT_POLICY` | 28347 | `"estimated_actual_v1"` |
| `UNKNOWN_COST_POLICY` | 28348 | `"unknown_actual_v1"` |
| `UNKNOWN_COST_HOLD_USD` | 28349 | `10` |
| `SETTLEMENT_POLICY_HEADER` | 28350 | `"x-videoclaw-settlement-policy"` |
| `UNKNOWN_COST_HEADER` | 28351 | `"x-videoclaw-unknown-cost"` |
| `QUOTE_ID_HEADER` | 28352 | `"x-videoclaw-quote-id"` |
| `ESTIMATED_QUOTE_V4` | 28353 | `/^vsq_4\.[A-Za-z0-9_-]+\.[a-f0-9]{64}$/` |
| `HARNESS_REVIEW_PURPOSE_HEADER` | 28355 | `"x-videoclaw-purpose"` |
| `HARNESS_REVIEW_PURPOSE` | 28356 | `"harness-review"` |
| `HARNESS_REVIEW_PATH` | 28357 | `"/v1/harness/review"` |
| `HARNESS_REVIEW_SKIPPED_CODE` | 28358 | `"HARNESS_REVIEW_SKIPPED"` |
| `UNKNOWN_REQUEST_PURPOSE_CODE` | 28359 | `"UNKNOWN_REQUEST_PURPOSE"` |
| `HARNESS_REVIEW_FORBIDDEN_HEADERS` | 28360 | `[ "x-videoclaw-operation-id", "x-videoclaw-project-id", "x-videoclaw-spend-permit", "x-videoclaw-settlement-policy", "x-videoclaw-local-admission", "x-videoclaw-quote-id", ]` |
| `HARNESS_REVIEW_CREDENTIAL_TTL_MS` | 28368 | `11 * 6e4` |
| `HARNESS_REVIEW_UPLOADS_PER_CREDENTIAL` | 28369 | `4` |
| `SCOPED_CAPABILITY_REFUSAL` | 28370 | `"This command can’t use that VideoClaw service; nothing was submitted or charged."` |
| `FOREIGN_JOB_REFUSAL` | 28372 | `"gateway job does not belong to this runtime"` |
| `JOB_READ_RE` | 28373 | `/^\/v1\/jobs\/([A-Za-z0-9._-]{1,128})$/` |
| `HARNESS_REVIEW_UPLOAD_MAX_BYTES` | 28374 | `24 * 1024 * 1024` |
| `MD5_BASE64_RE` | 28375 | `/^[A-Za-z0-9+/]{21}[AQgw]==$/` |
| `UPLOAD_ID_RE` | 28406 | `/^[A-Za-z0-9._-]{1,128}$/` |
| `TOOL_RE` | 28489 | `/^[a-z][a-z0-9_.-]{0,63}$/` |
| `OPERATION_LOOKUP_RE` | 28490 | `/^\/v1\/operations\/([A-Za-z0-9._-]{1,128})(\/cancel)?$/` |
| `CONTROL_TOOLS` | 28491 | `/* @__PURE__ */ new Set([ "app", "budgets", "feedback", "keys", "me", "operation-context", "operations", "project", "telemetry", "topup", ])` |
| `MAX_BODY_BYTES` | 28503 | `16 * 1024 * 1024` |
| `EXACT_OPERATION_MEDIA_TYPE` | 28504 | `"application/vnd.videoclaw.spend-operation"` |
| `CONVERSATION_TOO_LARGE_MESSAGE` | 28505 | `"This conversation contains too much media history to continue."` |
| `SCOPED_PRODUCTION_PATHS` | 28507 | `/* @__PURE__ */ new Set(["/v1/audio/enhance", "/v1/media/pull"])` |
| `QUOTE_RETRY_WAIT_S` | 28529 | `120` |
| `PERMIT_RETRY_WAIT_S` | 28530 | `600` |
| `REARMED_ADMISSION_LEASE_MS` | 28531 | `13e4` |
| `QUICKSTART_RENDERER_LATENCY_STAGES` | 30375 | `[ "gallery_ready", "category_switch", "destination_ready", ]` |
| `RENDERER_STAGES` | 30380 | `new Set(QUICKSTART_RENDERER_LATENCY_STAGES)` |
| `JOURNEY` | 30381 | `/^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i` |
| `RING_LIMIT` | 30382 | `400` |
| `MAX_DURATION_MS` | 30383 | `6e5` |
| `SHA256$1` | 30508 | `/^[a-f0-9]{64}$/` |
| `KEY_ID` | 30509 | `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/` |
| `ED25519_SPKI_PREFIX` | 30510 | `Buffer.from("302a300506032b6570032100", "hex")` |
| `MAX_CATALOG_BYTES` | 30511 | `8 * 1024 * 1024` |
| `CLOUD_RUN_GATEWAY` | 30563 | `/^videoclaw-gw-[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app$/` |
| `PREVIEW_RENEWAL_BUFFER_MS` | 30771 | `5 * 60 * 1e3` |
| `EXTENSIONS` | 31374 | `{ "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/mp4": ".m4a", "audio/aac": ".aac", "audio/ogg": ".ogg", "audio/flac": ".flac", }` |
| `MAX_BYTES` | 31389 | `256 * 1024 * 1024` |
| `MAX_PROMISE_BYTES` | 31469 | `256 * 1024` |
| `MAX_BRIEF_CHARS` | 31470 | `64 * 1024` |
| `BINDING_PREAMBLE_END` | 31545 | `"Run prepare_production for this id before planning or paid work.\n\n"` |
| `STREAM_FLAGS` | 31582 | `["--output-format", "stream-json", "--input-format"]` |
| `ENGINE_CHILD_KILL_GRACE_MS` | 31583 | `1500` |
| `CLAIM_TTL_MS` | 31600 | `15e3` |
| `WORKFLOW_INDEX_TOKEN_BUDGET` | 31932 | `2e3` |
| `HOUSE_FOOTER_HEADING` | 31985 | `"House rules (app-owned for this app version; they win over anything in a card):"` |
| `HOUSE_FOOTER_REVIEW_LINE` | 31987 | `"- After the final render, run review_render (tools/review_render.py) once. If it prints fixes, make them once, then present. If it says there's nothing to fix, or it can't run, present the draft as it is. Never hold a draft or a version back waiting for review."` |
| `HOUSE_FOOTER_PLAN_LINE` | 31989 | `"- Planning is optional and your call. Propose a short plan (propose_session_plan) before substantial production only when the work is big or ambiguous enough to need the user's agreement first: a new video with more than one shot; an unstated format, voice, music or shot structure; a substantial edit; larger spend. Simple requests (a single asset, or a small edit with clear inputs) go straight to …(截断)` |
| `HOUSE_FOOTER_BYPASS_PLAN_LINE` | 31991 | `"- Planning: this video is in Bypass, so go straight to work with reasonable creative assumptions; no plan or Build click."` |
| `STOPWORDS` | 32008 | `/* @__PURE__ */ new Set([ "a", "about", "above", "after", "again", "all", "also", "am", "an", "and", "any", "are", "as", "at", …(多行，见源文件)` |
| `FIELD_WEIGHT` | 32158 | `{ name: 3, purpose: 2, recipes: 2, library: 1.5, needs: 0.75, body: 1, }` |
| `FIELD_LENGTH_NORM` | 32166 | `{ name: 0.3, purpose: 0.5, recipes: 0.3, library: 0.3, needs: 0.5, body: 0.75, }` |
| `FIELD_LABEL` | 32174 | `{ name: "name", purpose: "use-when", recipes: "recipe", library: "library", needs: "needs", body: "card", }` |
| `LIBRARY_MIN_HITS` | 32185 | `2` |
| `K1` | 32201 | `1.2` |
| `NEGATION_CUES` | 32207 | `/* @__PURE__ */ new Set([ "without", "no", "not", "never", "nor", "don", "dont", "avoid", "skip", "except", ])` |
| `SCOPE_BREAKS` | 32219 | `/* @__PURE__ */ new Set(["and", "but", "then", "instead", "while", "so"])` |
| `NEGATION_SCOPE` | 32220 | `4` |
| `MAX_INDEX_BYTES` | 32466 | `4 * 1024 * 1024` |
| `MAX_BUNDLE_MANIFEST_BYTES` | 32467 | `1024 * 1024` |
| `MAX_CAPABILITIES_BYTES` | 32468 | `1024 * 1024` |
| `MAX_METHOD_BYTES` | 32469 | `16 * 1024` |
| `MAX_RECIPE_BYTES` | 32470 | `16 * 1024` |
| `MAX_EXAMPLE_BYTES` | 32471 | `8 * 1024` |
| `MAX_TEMPLATE_FILE_BYTES` | 32472 | `96 * 1024` |
| `MAX_INLINE_TEMPLATE_BYTES` | 32473 | `12 * 1024` |
| `MAX_RESPONSE_BYTES` | 32474 | `128 * 1024` |
| `MAX_INDEX_TEXT_BYTES` | 32475 | `16 * 1024` |
| `MAX_LIBRARY_FILE_BYTES` | 32476 | `16 * 1024` |
| `MAX_INLINE_LIBRARY_BYTES` | 32477 | `12 * 1024` |
| `SHA256` | 32478 | `/^[a-f0-9]{64}$/` |
| `WORKFLOW_ID` | 32479 | `/^workflow\.[a-z0-9]+(?:-[a-z0-9]+)*$/` |
| `WORKFLOW_SLUG` | 32480 | `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` |
| `STARTER_ID` | 32481 | `/^starter\.[a-z0-9-]{3,80}$/` |
| `EXEMPLAR_JOB` | 32482 | `/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/` |
| `LIBRARY_ID` | 32483 | `/^(look\|prompt\|voice\|music\|caption\|sfx)\.[a-z0-9]+(?:-[a-z0-9]+)*$/` |
| `FENCE` | 32929 | /^\s*(```\|~~~)/ |
| `LIBRARY_HEADING` | 32930 | /^##\s+`([^`]+)`/ |
| `LIBRARY_SECTION_END` | 32931 | `/^#{1,2}\s/` |
| `LINE_BREAK` | 32932 | `/\r\n\|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/` |
| `LIBRARY_INSTRUCTION` | 32989 | `"Craft library entries this card names: looks, model prompt guides, voices, music, captions and SFX proven in winning jobs. Start from their text and adapt it to this brief (never copy a winner's subject, words or brand); the card and the house rules win."` |
| `CARD_INSTRUCTION` | 33237 | `"This card is the primary creative method for this workflow. Follow its steps and craft rules, adapting or omitting a move only when the current brief benefits (state the concrete creative reason). Engine prepare_production documents are supporting execution mechanics, not replacements. The house rules below are the app's own and win over anything in the card."` |
| `MAX_INLINE_CREATIVE_NOTES_CHARS` | 33534 | `4e3` |
| `QUICKSTART_PRODUCTION_TOOLS` | 33612 | `/* @__PURE__ */ new Set(["call_model", "plan_paid_operations"])` |
| `QUICKSTART_CLARIFICATION_REFUSAL` | 33622 | `"This Quickstart is waiting on the questions already open for the user. Paid work, production preparation and reference materialization stay blocked until they are answered. Ask everything you still need in that one interaction, then continue."` |
| `CROSSED_ACTIVATION` | 33650 | `"That Quickstart receipt belongs to a different start."` |
| `QUESTION_REPLY_QUOTE_MAX` | 33943 | `4e3` |
| `CLAUDE_TERMS_RETRY_UNCONFIRMED` | 33944 | `"Claude received this retry, but its result is not confirmed. Reopen this video to check the reply before sending anything else."` |
| `EDIT_TOOL_NAMES` | 33968 | `/* @__PURE__ */ new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"])` |
| `OPEN_TOOL_OWNERSHIP_MARGIN_MS` | 34105 | `1e4` |
| `REPORT_ONLY_TURN_REFUSAL` | 34106 | `"This turn only reports a result that already arrived, so it cannot start new production work. Nothing was submitted or charged. Tell the user where the result is and wait for their reply."` |
| `MAX_PENDING_OPERATIONS` | 34108 | `256` |
| `LATE_RESULT_COALESCE_MAX_MS` | 34109 | `5 * 6e4` |
| `LATE_RESULT_OUTCOMES` | 34185 | `/* @__PURE__ */ new Set([ "arrived", "import_failed", "parked", "failed", "canceled", ])` |
| `LATE_RESULT_REASONS` | 34192 | `/* @__PURE__ */ new Set(["missing_tool", "refused", "import_error"])` |
| `RECOVERY_TOOLS` | 34193 | `/* @__PURE__ */ new Set(["ffmpeg", "ffprobe", "uv"])` |
| `LEGACY_PENDING_ROUTE_BARRIER_FILE` | 34308 | `"post-compact-route-barriers.pending.json"` |
| `JOB_RE` | 34319 | `/\bjobs\/([A-Za-z0-9][A-Za-z0-9._-]*)/g` |
| `JOB_ID_RE` | 34320 | `CLIENT_JOB_ID_RE` |
| `SEARCH_RETRY_WAIT_S` | 34321 | `120` |
| `MODEL_CALL_BATCH_MAX` | 34322 | `6` |
| `PRIOR_WORK_REFERENCE` | 34341 | String.raw`(?:my\|our\|that\|the\|this\|earlier\|existing\|old\|previous\|last\|yesterday(?:['’]s)?)` |
| `PRIOR_WORK_NOUN` | 34342 | String.raw`(?:videos?\|reels?\|projects?\|jobs?\|cuts?\|work\|footage\|assets?\|stills?\|renders?)` |
| `TRANSFER_PRIOR_WORK_REFERENCE` | 34343 | String.raw`(?:my\|our\|that\|this\|earlier\|existing\|old\|previous\|last\|yesterday(?:['’]s)?)` |
| `SAME_SENTENCE_CHAR` | 34344 | String.raw`(?:[^.!?\n]\|[.!?](?=\S))` |
| `CONTINUE_PRIOR_WORK_RE` | 34345 | new RegExp( String.raw`\b(?:continue\|resume)\s+${PRIOR_WORK_REFERENCE}(?:[\s-]+${PRIOR_WORK_REFERENCE})*[\s-]+${PRIOR_WORK_NOUN}\b` + String.raw`\|\b(?:finish\|complete)\s+(?:the\s+)?${TRANSFER_PRIOR_WORK_REFERENCE}(?:[\s-]+${TRANSFER_PRIOR_WORK_REFERENCE})*[\s-]+${PRIOR_WORK_NOUN}\b` + String.raw`\|\bpick\s+up\s+${PRIOR_WORK_REFERENCE}(?:[\s-]+${PRIOR_WORK_REFERENCE})*[\s-]+${PRIOR_WORK_NOUN}\b` …(截断) |
| `REJECT_PRIOR_WORK_RE` | 34353 | new RegExp( String.raw`\b(?:do\s+not\|don['’]?t\|dont\|never)\s+(?:use\|reuse\|continue\|resume\|finish\|complete\|pick\s+up\|bring\|copy\|move\|transfer)\b.{0,80}\b${PRIOR_WORK_NOUN}\b` + String.raw`\|\bno\s+${PRIOR_WORK_REFERENCE}\b.{0,40}\b${PRIOR_WORK_NOUN}\b` + String.raw`\|\bignore\b.{0,60}\b${PRIOR_WORK_REFERENCE}\b.{0,60}\b${PRIOR_WORK_NOUN}\b` + String.raw`\|\b(?:start\|make\|create\|begi …(截断) |
| `SESSION_PLAN_JOB_MISSING` | 34372 | `"This video has no production job yet. If the user wants an earlier video, find its job; the app offers them the choice to move it here, so wait for that choice. Otherwise start this video's own production job normally, then call propose_session_plan again. This never approves production."` |
| `DEFAULT_CLIENTS` | 34377 | `[{ clientId: "personal", name: "Personal" }]` |
| `FALLBACK_EVIDENCE_MARKERS` | 34378 | `[ "supersedes", "retractedMessageUuids", "retracted_message_uuids", ]` |
| `NEW_VIDEO_MODEL` | 34383 | `"claude-opus-5-5"` |
| `CODEX_CATALOG_TTL_MS` | 34384 | `5 * 6e4` |
| `CLAUDE_CATALOG_TTL_MS` | 34385 | `5 * 6e4` |
| `CLAUDE_CATALOG_TIMEOUT_MS` | 34386 | `15e3` |
| `CLAUDE_BOUNDARY_READ_WAIT_MS` | 34387 | `5e3` |
| `CLAUDE_BOUNDARY_MISS_WINDOW_MS` | 34388 | `6e4` |
| `CLAUDE_SIGN_IN_CHANGED` | 34389 | `{ ok: false, reason: "failed", message: "Your Claude Code sign-in changed while VideoClaw was reading its models. Try again.", }` |
| `CODEX_DISCONNECT_STOP_TIMEOUT_MS` | 34394 | `1e4` |
| `DEV_FALLBACK_CWD` | 34407 | `"~/projects/videoclaw"` |
| `INPUT_BOUND_PLAN_TIMEOUT_MS` | 34576 | `3e4` |
| `PLAN_DECLINED_INSTRUCTION` | 34586 | `"Do not ask for a budget again. Continue under this video’s current spending policy; paid work still requires a valid quote."` |
| `UNKNOWN_COST_BUDGET_REFUSAL` | 34588 | `"Answer this temporary-hold card with Allow hold or Deny. To change the video’s spending policy, use its budget settings and retry."` |
| `PLAN_FIRST_REFUSAL` | 34590 | `"Before the first paid operation in this video, call mcp__studio__plan_paid_operations once with the paid operations you currently intend to run (tool/role/count, never amounts). The app prices them and may offer the user a single video budget so the rest of the work does not need an approval per operation. Then retry this command."` |
| `LEGACY_SEEDED_CLIENTS` | 34780 | `/* @__PURE__ */ new Set(["josephchin", "docuask", "khailee"])` |
| `IDLE_ENGINE_CHILD_TTL_MS` | 34781 | `6e4` |
| `IDLE_ENGINE_CHILD_SWEEP_MS` | 34782 | `15e3` |
| `LOST_BOOKEND_GRACE_MS` | 34783 | `5e3` |
| `PAID_GENERATION_TIMEOUT_MS` | 52904 | `6e5` |
| `HELPER_SYSTEM` | 52905 | `'You write ONE short status line (max 6 words) describing what a video producer is quietly doing, for a non-technical creator watching their video get made. Present continuous, warm and plain (e.g. "Trimming the intro", "Lining up the b-roll"). NEVER mention file paths, filenames, flags, commands, code, tool names, or any technical term. Output only the line — no quotes, no trailing punctuation. I …(截断)` |
| `DISPLAY_ASK_VERSION` | 52942 | `3` |
| `DISPLAY_STOP_VERSION` | 52943 | `4` |
| `DISPLAY_MEMORY_VERSION` | 52944 | `7` |
| `DISPLAY_LATE_RESULT_VERSION` | 52945 | `8` |
| `DISPLAY_PREFERENCE_VERSION` | 52946 | `9` |
| `DISPLAY_ROW_VERSION_LIST` | 52947 | `[ 1, 2, DISPLAY_ASK_VERSION, DISPLAY_STOP_VERSION, 5, 6, DISPLAY_MEMORY_VERSION, DISPLAY_LATE_RESULT_VERSION, DISPLAY_PREFERENCE_VERSION, ]` |
| `DISPLAY_ROW_VERSIONS` | 52958 | `new Set(DISPLAY_ROW_VERSION_LIST)` |
| `BACKGROUNDED_RESULT` | 53224 | `/^Command (?:did not complete within its \d+s timeout and was moved to the background \(ID: \|was moved to the background \(ID: \|was manually backgrounded by user with ID: \|running in background with ID: )([\w-]+)/` |
| `CAST_PREAMBLE_PREFIX` | 53261 | `"[Cast referenced in this message. Each person below has an APPROVED character sheet (face, body, outfits) at the path shown — use it as the identity reference whenever you generate an image or video of them, so the likeness stays consistent:\n"` |
| `DROP_PREAMBLE_PREFIX` | 53263 | `"[The user added these files to this video:\n"` |
| `DROP_PREAMBLE_SUFFIX` | 53264 | `"\nUse them as source material where relevant.]\n\n"` |
| `COMPOSER_ATTACHMENT_PREAMBLE_PREFIX` | 53265 | `"[APP-OWNED COMPOSER ATTACHMENTS — ordered]\n"` |
| `COMPOSER_ATTACHMENT_PREAMBLE_SUFFIX` | 53266 | `"[Use these files as source material where relevant.]\n\n"` |
| `SESSION_PLAN_PREAMBLE_PREFIX` | 53268 | `"[APP-OWNED SESSION PLAN — authoritative]\n"` |
| `SESSION_POLICY_PREAMBLE_PREFIX` | 53269 | `"[APP-OWNED SESSION POLICY — authoritative revision "` |
| `SESSION_POLICY_PREAMBLE_SUFFIX` | 53270 | `"[END APP-OWNED SESSION POLICY]\n\n"` |
| `PRODUCTION_PREAMBLE_PREFIX` | 53271 | `"[APP-OWNED PRODUCTION ID — authoritative]\n"` |
| `PRODUCTION_PREAMBLE_SUFFIX` | 53272 | `"Run prepare_production for this id before planning or paid work.\n\n"` |
| `PRODUCTION_STATUS_PREAMBLE_PREFIX` | 53274 | `"[APP-OWNED PRODUCTION STATUS — authoritative]\n"` |
| `PRODUCTION_STATUS_PREAMBLE_SUFFIX` | 53275 | `"[END APP-OWNED PRODUCTION STATUS]\n\n"` |
| `BUSY_DROP_PREFIX` | 53276 | `"[The user just added these files while you were working:\n"` |
| `IDLE_DROP_SUFFIX` | 53277 | `"\nRespond to the user and use the files where relevant.]"` |
| `CONDUCTOR_PREAMBLE_PREFIX` | 53278 | `"[Conductor note — internal, do NOT mention this note or name any tool to the user:"` |
| `SDK_WIRE_UUID_STEM` | 53366 | `24` |
| `STAGING_FLIGHT_RESTART_EXIT_CODE` | 53844 | `86` |
| `STAGING_FLIGHT_RESTART_SECRET_ENV` | 53845 | `"VIDEOCLAW_FLIGHT_RESTART_SECRET"` |
| `STAGING_FLIGHT_RESTART_REQUEST_FILE` | 53846 | `"flight-restart-request.json"` |
| `MANAGED_DEV_RESTART_ENV` | 53847 | `"VIDEOCLAW_DEV_RESTART_CONTROLLER"` |
| `MANAGED_DEV_RESTART_EXIT_CODE` | 53848 | `75` |
| `RESTART_SCHEMA` | 53849 | `"videoclaw.flight-restart-request/v1"` |
| `RESTART_REASON` | 53850 | `"credential-activation"` |
| `SECRET_PATTERN` | 53851 | `/^[a-f0-9]{64}$/` |
| `REFRESH_SKEW_MS` | 53948 | `5 * 6e4` |
| `FLOW_TIMEOUT_MS` | 53949 | `5 * 6e4` |
| `REQUEST_TIMEOUT_MS$1` | 53950 | `15e3` |
| `ATTRIBUTION_BRIDGE_ORIGIN` | 53951 | `"https://videoclaw.com"` |
| `ATTRIBUTION_GRACE_MS` | 53952 | `5e3` |
| `NETWORK_COPY` | 53960 | `"Could not reach Videoclaw — check your connection and try again."` |
| `SESSION_CHANGED_COPY` | 53961 | `"Your sign-in changed — try again."` |
| `SCHEMA` | 55179 | `"videoclaw.acquisition-delivery/v1"` |
| `CLAIM` | 55180 | `/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/` |
| `MAX_CLAIM_BYTES` | 55181 | `4096` |
| `BILLING_TIMEOUT_MS` | 55293 | `15e3` |
| `REVOKED_COPY` | 55422 | `ACCOUNT_DISABLED_COPY` |
| `MIN_SAMPLES` | 55510 | `6` |
| `MAX_ROWS_PER_JOB` | 55511 | `2e4` |
| `BUSY_MESSAGE` | 55792 | `{ index: "Indexing is running for this library. It will finish first — try again when it is done.", remove: "A folder is being removed from this library. Try again in a moment.", }` |
| `TITLE_MODEL` | 55810 | `"claude-haiku-4-5-20251001"` |
| `MAX_BATCH` | 55811 | `40` |
| `TITLE_SYSTEM` | 55812 | `'You title saved preferences for a non-technical video creator. For EACH numbered rule you receive, write ONE short plain-English title of 3 to 6 words that says what the rule locks in (e.g. "Always use my real voice", "Bold captions, no music"). Plain words only: NEVER file paths, filenames, code, commands, quotes, or any technical or internal term — in particular never the words workflow, molecu …(截断)` |
| `RECHECK_MS` | 55918 | `4 * 60 * 60 * 1e3` |
| `UPDATE_RETRY_MS` | 55919 | `6e4` |
| `REQUEST_TIMEOUT_MS` | 55920 | `15e3` |
| `RENDER_SCRIPT_REL` | 56020 | `"tools/hyperframes_render.py"` |
| `OUTPUT_NAME` | 56021 | `"final_hyperframes.mp4"` |
| `RUN_LOG_NAME` | 56022 | `"run.log.jsonl"` |
| `DEFAULT_CANCEL_TIMEOUT_MS` | 56023 | `8e3` |
| `ERROR_COPY` | 56024 | `{ "invalid-request": { message: "That render request wasn't valid.", retryable: false }, "unknown-session": { message: "That video isn't available.", retryable: false }, "job-mismatch": { message: "Th …(多行，见源文件)` |
| `INTERRUPTING` | 56302 | `/* @__PURE__ */ new Set([ "agent-turn", "pending-interaction", "render", "preview", "voice-recording", "voice-transcription", "attachment-copy", ])` |
| `QUIT_BUTTON_INDEX` | 56406 | `1` |
| `START_TIMEOUT_MS` | 56508 | `1e4` |
| `PREVIEW_ERROR` | 56509 | `{ "invalid-request": "That preview request wasn't valid.", "unknown-session": "That video isn't available.", "job-mismatch": "That video isn't linked to this preview.", "job-not-found": "This video's files couldn't be found.", "composition-not-found": "There's no editable composition for this video yet.", "composition-invalid": "This video's composition couldn't be read.", "engine-unavailable": "Y …(截断)` |
| `EDIT_ERROR` | 56519 | `{ "invalid-request": "That edit wasn't valid.", "unknown-session": "That video isn't available.", "job-mismatch": "That video isn't linked to this edit.", "job-not-found": "This video's files couldn't be found.", "composition-not-found": "There's no composition to edit for this video.", "element-not-found": "That part of the composition couldn't be found — reload the editor.", "invalid-text": "Tha …(截断)` |
| `POLICY_TIMEOUT_MS` | 56848 | `5e3` |
| `PDFKIT_READER_SCRIPT` | 56880 | ` ObjC.import('Foundation') |
| `PDF_READ_TIMEOUT_MS` | 56908 | `3e4` |
| `MAX_STDOUT_BYTES` | 56909 | `PDF_MAX_TEXT_CHARS * 6 + 64 * 1024` |
| `MAX_STDERR_BYTES` | 56910 | `64 * 1024` |
| `PDF_READ_CONCURRENCY` | 56953 | `2` |
| `FEEDBACK_LIMITS` | 57059 | `{ stateBytes: 2e6, logsBytes: 2e7, screenshotBytes: 1e7, }` |
| `FEEDBACK_BLOCKED_LIMITS` | 57064 | `{ stateBytes: 1e5, logsBytes: 2e5, }` |
| `TRUNCATED_MARKER` | 57068 | `"[truncated for size]"` |
| `MESSAGE_MAX` | 57069 | `4e3` |
| `CONTACT_MAX` | 57070 | `200` |
| `JOB_LOG_TAIL_LINES` | 57146 | `200` |
| `JOB_LOG_LINE_MAX` | 57147 | `2e3` |
| `SCREENSHOT_MAX_BYTES` | 57148 | `1e7` |
| `FAILURE_EVIDENCE_KINDS` | 57546 | `/* @__PURE__ */ new Set([ "turn-error-result", "turn-error", "engine-spawn-failed", "deliver-failed", "claude-code-access-failed", "error", ])` |
| `EVIDENCE_DETAIL_MAX` | 57554 | `1e3` |
| `EVIDENCE_LAST_ERROR_MAX` | 57555 | `200` |
| `MAX_ITEMS` | 57556 | `1e3` |
| `DROP_AFTER_ATTEMPTS` | 57557 | `8` |
| `DEAD_LETTER_MAX_ITEMS` | 57558 | `200` |
| `DELIVERY_STATS_INTERVAL_MS` | 57559 | `24 * 60 * 60 * 1e3` |
| `BACKOFF_MS` | 57560 | `[5e3, 3e4, 12e4, 6e5, 36e5]` |
| `MAX_EMBEDDED_BYTES` | 57561 | `262144` |
| `SAVE_DEBOUNCE_MS` | 57562 | `500` |
| `DEFAULT_DELIVERY_TIMEOUT_MS` | 57563 | `3e4` |
| `DEFAULT_SHUTDOWN_DEADLINE_MS` | 57564 | `2e3` |
| `KEY_ID_RE` | 57565 | `/^[a-f0-9]{64}$/` |
| `MAX_AUTHORITY_EVIDENCE_ROWS` | 57566 | `32` |
| `OUTBOX_KINDS` | 57567 | `/* @__PURE__ */ new Set([ "job-log", "job-final", "beacon", "session-entries", "session-index", "feedback", ])` |
| `CONSENT_KEY_ID_RE` | 57575 | `/^[a-f0-9]{64}$/` |
| `CONSENT_OUTBOX_ID_RE` | 57576 | `/^alpha-consent:([a-f0-9]{64})$/` |
| `CONSENT_DATA_KEYS` | 57577 | `/* @__PURE__ */ new Set([ "kind", "detail", "scopeKeyId", "scopeGatewayUrl", "durable", "outboxId", ])` |
| `DEAD_LETTER_REASONS` | 57585 | `/* @__PURE__ */ new Set([ "attempt-limit", "capacity", "invalid-payload", ])` |
| `POLYNOMIAL` | 58717 | `2197175160` |
| `TABLE` | 58718 | `(() => { const table = new Int32Array(256)` |
| `DENIED_SEGMENTS` | 58758 | `/* @__PURE__ */ new Set([ ".git", ".hg", ".svn", ".venv", "venv", "node_modules", "__pycache__", ".cache", "cache", ".npm", ".yarn", ".pnpm-store", ".ssh", ".gnupg", …(多行，见源文件)` |
| `DENIED_NAME` | 58780 | `/(?:^\.env(?:\..*)?$\|^\.netrc$\|^\.npmrc$\|^\.pypirc$\|^\.git-credentials$\|(?:^\|[._-])(?:secret\|secrets\|credential\|credentials\|token\|tokens\|password\|passwd\|apikey\|api[_-]key\|private[_-]key\|keychain\|session\|cookies?)(?:[._-]\|$)\|\.(?:pem\|key\|p12\|pfx\|keystore\|jks\|crt\|cer\|kdbx)$)/i` |
| `SECRET_CONTENT` | 58782 | `[ /vc_[A-Za-z0-9]{6,}/, /sk-[A-Za-z0-9_-]{16,}/, /AIza[A-Za-z0-9_-]{20,}/, /gh[pousr]_[A-Za-z0-9]{16,}/, /xox[abprs]-[A-Za-z0-9-]{10,}/, /Bearer\s+[A-Za-z0-9._~+/-]{16,}=*/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /(?:api[_-]?key\|apikey\|access[_-]?token\|refresh[_-]?token\|client[_-]?secret\|gatewaykey\|gateway[_-]key)["']?\s*[:=]\s*["']?[A-Za-z0-9_\-./+]{12,}/i, /[Xx]-[Gg]oog-[Ss]ignature=/, /[?& …(截断)` |
| `PROVENANCE_FILES` | 58797 | `/* @__PURE__ */ new Set([ "route-receipt.json", "route-receipt-history.jsonl", "review_output.json", "adaptation_notes.md", ])` |
| `CONFIG_FILES` | 58803 | `/* @__PURE__ */ new Set(["edl.json", "timeline.json", "workflow.json"])` |
| `TEMPLATE_DIRS` | 58804 | `/* @__PURE__ */ new Set(["hyperframes", "remotion", "template", "templates"])` |
| `OUTPUT_FILE` | 58805 | `/^final[A-Za-z0-9._-]*\.(?:mp4\|mov\|mp3\|wav\|png\|jpg\|jpeg)$/` |
| `TEXTUAL_EXT` | 58806 | `/\.(?:py\|mjs\|cjs\|js\|jsx\|ts\|tsx\|html\|css\|json\|jsonl\|ya?ml\|toml\|md\|txt)$/` |
| `DROP_ORDER` | 58828 | `["output", "reference"]` |
| `GALLERY_VIDEO` | 59229 | `/\.(?:mp4\|mov)$/i` |
| `REFERENCE_VIDEO` | 59230 | `/\.(?:mp4\|mov)$/i` |
| `PLATFORM_BY_HOST` | 59231 | `[ [/(?:^\|\.)instagram\.com$/i, "instagram"], [/(?:^\|\.)tiktok\.com$/i, "tiktok"], [/(?:^\|\.)(?:youtube\.com\|youtu\.be)$/i, "youtube"], [/(?:^\|\.)(?:x\.com\|twitter\.com)$/i, "x"], ]` |
| `MIME_BY_EXT` | 59339 | `[ [/\.mp4$/i, "video/mp4"], [/\.mov$/i, "video/quicktime"], [/\.jpe?g$/i, "image/jpeg"], [/\.png$/i, "image/png"], ]` |
| `ELIGIBILITY_PATH` | 59387 | `"/v1/workflow-submissions/eligibility"` |
| `SUBMISSION_PATH` | 59388 | `"/v1/workflow-submissions"` |
| `MUTATING_STATUSES` | 59389 | `/* @__PURE__ */ new Set(["running", "awaiting_permission"])` |
| `ARCHIVE_PREFIX` | 59390 | `"job"` |
| `CHANNEL` | 60297 | `applicationChannel()` |
| `LOCAL_RESET_CODEX_STOP_TIMEOUT_MS` | 60754 | `1e4` |
| `LOCAL_RESET_FLUSH_DEADLINE_MS` | 60755 | `1e4` |

## `preload/index.mjs`

| 常量 | 行 | 值 |
|---|---|---|
| `IPC` | 2 | `{ readSessionPlan: "sessionPlan:read", chooseSessionPlan: "sessionPlan:choose", retrySessionPlan: "sessionPlan:retry", sessionPlanChanged: "sessionPlan:changed", readProjectMemory: "memory:read", upda …(多行，见源文件)` |
| `ENGINE_LINES` | 246 | { // JC-specified lines (verbatim from the chunk spec) ─────────────────────── mint_image: (s) => (s ? `Creating a still — ${s}` : "Creating a still"), mint_video: (s) => (s ? `Generating footage — ${ …(多行，见源文件) |
| `SYNTH_VOICE_MODE_LINES` | 295 | `{ tts: "Creating the voiceover", reference_tts: "Creating the approved voiceover", design: "Creating the voiceover", voice_change: "Re-voicing your recording", transcribe: "Transcribing your recording", list_voices: "Choosing a voice", }` |
| `SYNTH_VOICE_GENERATION_MODES` | 303 | `["tts", "reference_tts", "design", "voice_change"]` |
| `ENGINE_ALIASES` | 304 | `{ lipsync: "lipsync_footage", }` |
| `GENERATION_TOOLS` | 316 | `[ "mint_image", // a still "mint_video", // a video clip "synth_voice", // the voiceover "lipsync_footage", // voice + avatar work "perform_avatar", "cast_avatar", "sam3", // effect work (cutouts) "bu …(多行，见源文件)` |
| `CODEX_PACKAGED_0_153_4_SMOKE` | 344 | `[ "historical packaged-app smoke on 0.153.4; native UI smoke pending for 0.160.1", "streaming", "tool execution (VideoClaw dynamic tool + provider command)", "image/frame understanding from a project file", "commentary/final-answer classification", "payer labelling", "persistence and default isolation", ]` |
| `CODEX_QUALIFIED_RESIDUAL_GAPS` | 367 | [ "perceptual/rubric scoring and human calibration", "monetary cost and token accounting (not exposed by Codex subscription mode)", "a LIVE file-change approval event — precluded by the intentional read-only production sandbox, and covered deterministically rather than by weakening that sandbox", `evidence at any reasoning effort other than the recommended one — the model's other supported depths  …(截断) |
| `AGENT_ROUTE_EVIDENCE` | 373 | [ { routeId: agentRouteId("codex-app-server", "chatgpt", "gpt-5.6-terra"), harness: "codex-app-server", provider: "chatgpt", modelId: "gpt-5.6-terra", // PROMOTED from `smoke-validated`. The same suite Astra cleared was run // against this exact route, re-established on 0.160.1: 28/28 conformance and a // 3/3 VideoClaw Bench record. It is the reason an account that cannot // address Astra still ha …(截断) |
| `CLAUDE_CLI_TURN` | 442 | `["live turn on the bundled CLI returned a completed result"]` |
| `CLAUDE_BENCH_RUN` | 443 | `"three isolated rollouts on the bundled CLI — one fresh SDK session in a fresh workspace each, no resume, all terminating on a normal result"` |
| `CLAUDE_BENCH_WIRE_IDENTITY` | 445 | "the requested model id was the session model reported by `system/init` on every rollout; `modelUsage` additionally lists the CLI's own internal helper model, recorded as concurrent side usage and NOT as a fallback of the requested model" |
| `CLAUDE_BENCH_PAYER` | 447 | `"payer observed per rollout: signed-in claude.ai, apiProvider firstParty, Team subscription, no gateway credentials injected"` |
| `CLAUDE_BENCH_NOT_COVERED` | 449 | [ "protocol/capability conformance on this harness — there is no Claude equivalent of the 28-check Codex conformance manifest, so structured output, interrupt/resume and approval semantics are not separately graded here", "perceptual/rubric scoring and human calibration", "monetary cost accounting — the manifests record the SDK's own `total_cost_usd` estimate for a subscription-route turn, which i …(截断) |
| `CLAUDE_CLI_TURN_NOT_COVERED` | 455 | `[ "a VideoClaw Bench record of any kind — this row rests on one completed turn, which is why it is no longer the id a new video starts on", ...CLAUDE_BENCH_NOT_COVERED, ]` |
| `CLAUDE_MODEL_EVIDENCE` | 490 | [ // The row that shows why the binary is the authority and a string search // over it is NOT: `claude-opus-5` occurs nowhere in this CLI's string table // and runs anyway. That table is a pricing/ali …(多行，见源文件) |
| `FREE_GEN_TOOLS` | 615 | `[ "assemble", "assemble_plate", "check_layout", "check_promise", "chunk_boundaries", // compose_render is NOT here: --mode episode shells out to synth_voice, // lipsync_footage, and mint_image as chil …(多行，见源文件)` |
| `CURL_HEADS` | 666 | `["curl", "curlie"]` |
| `NESTED_CURL_LAUNCHERS` | 667 | `[ "exec", "find", "parallel", "setsid", "stdbuf", "timeout", "watch", "xargs", ]` |
| `PROVIDER_READ_ONLY_HEADS` | 677 | `[ "awk", "basename", "cat", "column", "comm", "cut", "diff", "dirname", "du", "echo", "false", "ffprobe", "file", "find", …(多行，见源文件)` |
| `CURL_BODY_FLAGS` | 720 | `[ "--data", "--data-ascii", "--data-binary", "--data-raw", "--data-urlencode", "--form", "--form-string", "--json", "--upload-file", "-F", "-T", "-d", ]` |
| `CURL_METHOD_FLAGS` | 734 | `["--request", "-X"]` |
| `CURL_FORCE_GET_FLAGS` | 735 | `["--get", "-G"]` |
| `CURL_VALUE_SHORT_OPTIONS` | 736 | `[ "A", "C", "D", "E", "F", "H", "K", "P", "Q", "T", "U", "X", "Y", "b", …(多行，见源文件)` |
| `CURL_LONG_WITH_VALUE` | 764 | `[ "--aws-sigv4", "--cacert", "--capath", "--cert", "--config", "--connect-timeout", "--connect-to", "--continue-at", "--cookie", "--cookie-jar", "--data", "--data-ascii", "--data-binary", "--data-raw" …(多行，见源文件)` |
| `CURL_READ_METHODS` | 807 | `["GET", "HEAD", "OPTIONS"]` |
| `BILLED_MEDIA_BY_KEY` | 814 | `{ lipsync_footage: "--audio", "mint_video:edit": "--video", "mint_video:reenact": "--driver-video", // videoclaw#272 / backend#302: Higgsfield Genjutsu bills whole seconds of the // INPUT clip at the --resolution tier; the gateway re-measures the upload. "mint_video:genjutsu": "--video", }` |
| `CLAUDE_CODE_INTERNAL_PLAN_TOOLS` | 828 | `["EnterPlanMode", "ExitPlanMode"]` |

## `main/workbookWorker.js`

| 常量 | 行 | 值 |
|---|---|---|
| `ZIP_MAGIC` | 26 | `Buffer.from([80, 75, 3, 4])` |
| `CFB_MAGIC` | 27 | `Buffer.from([208, 207, 17, 224, 161, 177, 26, 225])` |
| `ODS_MIMETYPE` | 28 | `"application/vnd.oasis.opendocument.spreadsheet"` |
| `MAX_FORMULA_CHARS` | 29 | `8192` |
| `MAX_SHEET_NAME_CHARS` | 30 | `100` |
| `PARSE_OPTIONS` | 31 | `{ type: "buffer", dense: true, cellFormula: true, cellText: true, cellDates: true, UTC: true, cellHTML: false, cellNF: false, cellStyles: false, sheetStubs: false, bookVBA: false, bookFiles: false, bo …(多行，见源文件)` |

## `main/hyperframesPolicyWorker.js`

| 常量 | 行 | 值 |
|---|---|---|
| `TEXT_EXTENSIONS` | 4 | `/* @__PURE__ */ new Set([".html", ".htm", ".js", ".mjs", ".css"])` |
| `NETWORK_API` | 5 | `/\b(?:fetch\s*\(\|new\s+(?:XMLHttpRequest\|WebSocket\|EventSource)\b\|(?:XMLHttpRequest\|WebSocket\|EventSource)\s*\()/i` |
| `ATTRIBUTE_REF` | 7 | `/\b(?:src\|href)\s*=\s*(?:(["'])(.*?)\1\|([^\s>]+))/gi` |
| `CSS_REF` | 8 | `/url\(\s*(?:(["'])(.*?)\1\|([^\s)]+))\s*\)/gi` |
| `MODULE_REF` | 9 | `/\b(?:import\|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gi` |
| `DYNAMIC_IMPORT_REF` | 10 | `/\bimport\s*\(\s*["']([^"']+)["']\s*\)/gi` |
| `MAX_POLICY_FILE_BYTES` | 11 | `8 * 1024 * 1024` |
| `MAX_POLICY_FILES` | 12 | `128` |
| `MAX_POLICY_TOTAL_BYTES` | 13 | `16 * 1024 * 1024` |
| `MAX_RUNTIME_FILES` | 14 | `256` |
| `MAX_RUNTIME_TOTAL_BYTES` | 15 | `32 * 1024 * 1024` |
| `REQUIRED_RUNTIME_FILES` | 16 | `["gsap.min.js", "fonts/fonts.css"]` |

## `main/hyperframesPreviewWorker.js`

| 常量 | 行 | 值 |
|---|---|---|
| `MIME` | 5 | `{ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", …(多行，见源文件)` |
| `HTML_CSP` | 26 | `[ "default-src 'none'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "media-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'none'", "frame-src 'self'", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "form-action 'none'", ].join("; ")` |

## `main/editorRenderWorker.js`

| 常量 | 行 | 值 |
|---|---|---|
| `CANCEL_GRACE_MS` | 2 | `4e3` |

## `main/chunks/rangeMedia-848zXGXe.js`

| 常量 | 行 | 值 |
|---|---|---|
| `MIME` | 2 | `{ ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/web …(多行，见源文件)` |
| `VCMEDIA_SCHEME` | 18 | `{ scheme: "vcmedia", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true, }, }` |
