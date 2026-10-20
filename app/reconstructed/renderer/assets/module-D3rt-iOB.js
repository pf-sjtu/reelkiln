var t = "undefined" != typeof window ? window : void 0,
  e = "undefined" != typeof globalThis ? globalThis : t,
  i = null == e ? void 0 : e.navigator,
  r = null == e ? void 0 : e.document,
  s = null == e ? void 0 : e.location,
  n = null == e ? void 0 : e.fetch,
  o =
    null != e && e.XMLHttpRequest && "withCredentials" in new e.XMLHttpRequest()
      ? e.XMLHttpRequest
      : void 0,
  a = null == e ? void 0 : e.AbortController,
  l = null == e ? void 0 : e.CompressionStream,
  u = null == i ? void 0 : i.userAgent;
function h() {
  return !(!t || false === t.navigator.onLine);
}
var d = "undefined" != typeof globalThis ? globalThis : t;
(d && "undefined" == typeof self && (d.self = d),
  d && "undefined" == typeof File && (d.File = function () {}));
var v = null != t ? t : {},
  c = { DEBUG: false, LIB_VERSION: "0.5.0", LIB_NAME: "browser-common" };
function f(t2, e2, i2, r2, s2, n2, o2) {
  try {
    var a2 = t2[n2](o2),
      l2 = a2.value;
  } catch (t3) {
    return void i2(t3);
  }
  a2.done ? e2(l2) : Promise.resolve(l2).then(r2, s2);
}
function p(t2) {
  return function () {
    var e2 = this,
      i2 = arguments;
    return new Promise(function (r2, s2) {
      var n2 = t2.apply(e2, i2);
      function o2(t3) {
        f(n2, r2, s2, o2, a2, "next", t3);
      }
      function a2(t3) {
        f(n2, r2, s2, o2, a2, "throw", t3);
      }
      o2(void 0);
    });
  };
}
function _() {
  return (
    (_ = Object.assign
      ? Object.assign.bind()
      : function (t2) {
          for (var e2 = 1; arguments.length > e2; e2++) {
            var i2 = arguments[e2];
            for (var r2 in i2) ({}).hasOwnProperty.call(i2, r2) && (t2[r2] = i2[r2]);
          }
          return t2;
        }),
    _.apply(null, arguments)
  );
}
function g(t2, e2) {
  if (null == t2) return {};
  var i2 = {};
  for (var r2 in t2)
    if ({}.hasOwnProperty.call(t2, r2)) {
      if (-1 !== e2.indexOf(r2)) continue;
      i2[r2] = t2[r2];
    }
  return i2;
}
var m = (t2) => {
  if ("string" != typeof t2) return t2;
  try {
    return JSON.parse(t2);
  } catch (e2) {
    return t2;
  }
};
function y(t2) {
  return "string" == typeof t2 || t2;
}
function b(t2) {
  return "string" == typeof t2 ? t2 : void 0;
}
var w,
  E = [
    "$feature_flag",
    "$feature_flag_response",
    "$feature_flag_has_experiment",
    "$feature_flag_id",
    "$feature_flag_version",
    "$feature_flag_reason",
    "$feature_flag_request_id",
    "$feature_flag_evaluated_at",
    "$feature_flag_error",
    "locally_evaluated",
    "$groups",
    "$process_person_profile",
    "$geoip_disable",
    "$current_url",
    "$pathname",
    "$referring_domain",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "gad_source",
    "mc_cid",
    "gclid",
    "gclsrc",
    "dclid",
    "gbraid",
    "wbraid",
    "fbclid",
    "msclkid",
    "twclid",
    "li_fat_id",
    "igshid",
    "ttclid",
    "rdt_cid",
    "epik",
    "qclid",
    "sccid",
    "irclid",
    "_kx",
    "$session_id",
    "$window_id",
    "$lib",
    "$lib_version",
    "$device_id",
    "$is_server",
  ],
  x = (function (t2) {
    return (
      (t2.AnonymousId = "anonymous_id"),
      (t2.DistinctId = "distinct_id"),
      (t2.Props = "props"),
      (t2.EnablePersonProcessing = "enable_person_processing"),
      (t2.PersonMode = "person_mode"),
      (t2.FeatureFlagDetails = "feature_flag_details"),
      (t2.FeatureFlags = "feature_flags"),
      (t2.FeatureFlagPayloads = "feature_flag_payloads"),
      (t2.BootstrapFeatureFlagDetails = "bootstrap_feature_flag_details"),
      (t2.BootstrapFeatureFlags = "bootstrap_feature_flags"),
      (t2.BootstrapFeatureFlagPayloads = "bootstrap_feature_flag_payloads"),
      (t2.OverrideFeatureFlags = "override_feature_flags"),
      (t2.Queue = "queue"),
      (t2.AiQueue = "ai_queue"),
      (t2.AiCaptureQueue = "ai_capture_queue"),
      (t2.LogsQueue = "logs_queue"),
      (t2.OptedOut = "opted_out"),
      (t2.SessionId = "session_id"),
      (t2.SessionStartTimestamp = "session_start_timestamp"),
      (t2.SessionLastTimestamp = "session_timestamp"),
      (t2.PersonProperties = "person_properties"),
      (t2.GroupProperties = "group_properties"),
      (t2.InstalledAppBuild = "installed_app_build"),
      (t2.InstalledAppVersion = "installed_app_version"),
      (t2.SessionReplay = "session_replay"),
      (t2.PushRegistered = "push_registered"),
      (t2.SessionReplayEventTriggerActivatedSession =
        "session_replay_event_trigger_activated_session"),
      (t2.SurveyLastSeenDate = "survey_last_seen_date"),
      (t2.SurveysSeen = "surveys_seen"),
      (t2.Surveys = "surveys"),
      (t2.RemoteConfig = "remote_config"),
      (t2.FlagsEndpointWasHit = "flags_endpoint_was_hit"),
      (t2.DeviceId = "device_id"),
      t2
    );
  })({}),
  S = (function (t2) {
    return ((t2.GZipJS = "gzip-js"), (t2.Base64 = "base64"), t2);
  })({}),
  k = [
    "$snapshot",
    "$pageview",
    "$pageleave",
    "$set",
    "survey dismissed",
    "survey sent",
    "survey shown",
    "$identify",
    "$groupidentify",
    "$create_alias",
    "$$client_ingestion_warning",
    "$web_experiment_applied",
    "$feature_enrollment_update",
    "$feature_flag_called",
  ],
  T = ["token"],
  R = "NativeGzipValidationError",
  P = (t2) => t2.length >= 2 && 31 === t2[0] && 139 === t2[1],
  O = (t2, e2) => t2 === S.GZipJS || e2 === S.GZipJS || "gzip" === e2,
  C = (t2) =>
    !(!t2 || "object" != typeof t2) && "NotReadableError" === ("name" in t2 ? String(t2.name) : ""),
  I = (t2) => {
    var e2 = new Error("Native gzip produced invalid output: " + t2);
    throw ((e2.name = R), e2);
  },
  A = (function () {
    var t2 = p(function* (t3, e2) {
      18 > t3.size && I("too-short");
      var i2 = new Uint8Array(yield t3.slice(0, 10).arrayBuffer());
      (P(i2) && 8 === i2[2]) || I("invalid-header");
      var r2 = new DataView(yield t3.slice(t3.size - 8).arrayBuffer());
      r2.getUint32(0, true) !==
        ((t4) => {
          for (
            var e3 = (() => {
                if (w) return w;
                w = [];
                for (var t5 = 0; 256 > t5; t5++) {
                  for (var e4 = t5, i4 = 0; 8 > i4; i4++)
                    e4 = 1 & e4 ? 3988292384 ^ (e4 >>> 1) : e4 >>> 1;
                  w[t5] = e4 >>> 0;
                }
                return w;
              })(),
              i3 = 4294967295,
              r3 = 0;
            t4.length > r3;
            r3++
          )
            i3 = e3[255 & (i3 ^ t4[r3])] ^ (i3 >>> 8);
          return (4294967295 ^ i3) >>> 0;
        })(e2) && I("invalid-crc");
      var s2 = e2.length >>> 0;
      r2.getUint32(4, true) !== s2 && I("invalid-size");
    });
    return function (e2, i2) {
      return t2.apply(this, arguments);
    };
  })();
function F() {
  return (
    (F = p(function* (t2, e2, i2) {
      void 0 === e2 && (e2 = true);
      try {
        var r2 = new TextEncoder().encode(t2),
          s2 = new globalThis.CompressionStream("gzip"),
          n2 = s2.writable.getWriter(),
          o2 = n2
            .write(r2)
            .then(() => n2.close())
            .catch(
              (function () {
                var t3 = p(function* (t4) {
                  try {
                    yield n2.abort(t4);
                  } catch (t5) {}
                  throw t4;
                });
                return function (e3) {
                  return t3.apply(this, arguments);
                };
              })(),
            ),
          a2 = new Response(s2.readable).blob(),
          l2 = (yield Promise.all([a2, o2]))[0];
        return (yield A(l2, r2), l2);
      } catch (t3) {
        if (null != i2 && i2.rethrow) throw t3;
        return (e2 && console.error("Failed to gzip compress data", t3), null);
      }
    })),
    F.apply(this, arguments)
  );
}
var M = [
    "amazonbot",
    "amazonproductbot",
    "app.hypefactors.com",
    "applebot",
    "archive.org_bot",
    "awariobot",
    "backlinksextendedbot",
    "baiduspider",
    "bingbot",
    "bingpreview",
    "chrome-lighthouse",
    "dataforseobot",
    "deepscan",
    "duckduckbot",
    "facebookexternal",
    "facebookcatalog",
    "http://yandex.com/bots",
    "hubspot",
    "ia_archiver",
    "leikibot",
    "linkedinbot",
    "meta-externalagent",
    "mj12bot",
    "msnbot",
    "nessus",
    "petalbot",
    "pinterest",
    "prerender",
    "rogerbot",
    "screaming frog",
    "sebot-wa",
    "sitebulb",
    "slackbot",
    "slurp",
    "trendictionbot",
    "turnitin",
    "twitterbot",
    "vercel-screenshot",
    "vercelbot",
    "yahoo! slurp",
    "yandexbot",
    "zoombot",
    "bot.htm",
    "bot.php",
    "(bot;",
    "bot/",
    "crawler",
    "ahrefsbot",
    "ahrefssiteaudit",
    "semrushbot",
    "siteauditbot",
    "splitsignalbot",
    "gptbot",
    "oai-searchbot",
    "chatgpt-user",
    "perplexitybot",
    "better uptime bot",
    "sentryuptimebot",
    "uptimerobot",
    "headlesschrome",
    "cypress",
    "google-hoteladsverifier",
    "adsbot-google",
    "apis-google",
    "duplexweb-google",
    "feedfetcher-google",
    "google favicon",
    "google web preview",
    "google-read-aloud",
    "googlebot",
    "googleother",
    "google-cloudvertexbot",
    "googleweblight",
    "mediapartners-google",
    "storebot-google",
    "google-inspectiontool",
    "bytespider",
  ],
  D = function (t2, e2) {
    if ((void 0 === e2 && (e2 = []), !t2)) return false;
    var i2 = t2.toLowerCase();
    return M.concat(e2).some((t3) => {
      var e3 = t3.toLowerCase();
      return -1 !== i2.indexOf(e3);
    });
  };
function N(t2, e2) {
  return -1 !== t2.indexOf(e2);
}
var U = function (t2) {
    return t2.trim();
  },
  L = function (t2) {
    return t2.replace(/^\$/, "");
  };
function j(t2) {
  var e2,
    i2 = [];
  return null !==
    (e2 = JSON.stringify(t2, function (t3, e3) {
      if ("bigint" == typeof e3) return e3.toString();
      if ("function" != typeof e3 && "symbol" != typeof e3) {
        if (e3 instanceof Error) return { name: e3.name, message: e3.message, stack: e3.stack };
        if (e3 && "object" == typeof e3) {
          for (; i2.length > 0 && i2[i2.length - 1] !== this;) i2.pop();
          if (i2.includes(e3)) return "[Circular]";
          i2.push(e3);
        }
        return e3;
      }
    })) && void 0 !== e2
    ? e2
    : "null";
}
var B = Object.prototype,
  z = B.hasOwnProperty,
  q = B.toString,
  H =
    Array.isArray ||
    function (t2) {
      return "[object Array]" === q.call(t2);
    },
  V = (t2) => "function" == typeof t2,
  W = (t2) => t2 === Object(t2) && !H(t2),
  G = (t2) => {
    if (W(t2)) {
      for (var e2 in t2) if (z.call(t2, e2)) return false;
      return true;
    }
    return false;
  },
  K = (t2) => void 0 === t2,
  J = (t2) => "[object String]" == q.call(t2),
  Y = (t2) => J(t2) && 0 === t2.trim().length,
  Q = (t2) => null === t2,
  X = (t2) => K(t2) || Q(t2),
  Z = (t2) => "[object Number]" == q.call(t2) && t2 == t2,
  tt = (t2) => Z(t2) && t2 > 0,
  et = (t2) => "[object Boolean]" === q.call(t2),
  it = (t2) => t2 instanceof FormData,
  rt = (t2) => N(k, t2),
  st = (t2) => N(T, t2);
function nt(t2) {
  return null === t2 || "object" != typeof t2;
}
function ot(t2, e2) {
  return {}.toString.call(t2) === "[object " + e2 + "]";
}
function at(t2) {
  switch ({}.toString.call(t2)) {
    case "[object Error]":
    case "[object Exception]":
    case "[object DOMException]":
    case "[object DOMError]":
    case "[object WebAssembly.Exception]":
      return true;
    default:
      return ut(t2, Error);
  }
}
function lt(t2) {
  return "undefined" != typeof Event && ut(t2, Event);
}
function ut(t2, e2) {
  try {
    return t2 instanceof e2;
  } catch (t3) {
    return false;
  }
}
var ht = [true, "true", 1, "1", "yes"],
  dt = (t2) => N(ht, t2),
  vt = [false, "false", 0, "0", "no"];
function ct(t2, e2, i2, r2, s2) {
  return (
    e2 > i2 && (r2.warn("min cannot be greater than max."), (e2 = i2)),
    Z(t2)
      ? t2 > i2
        ? (r2.warn(" cannot be  greater than max: " + i2 + ". Using max value instead."), i2)
        : e2 > t2
          ? (r2.warn(" cannot be less than min: " + e2 + ". Using min value instead."), e2)
          : t2
      : (r2.warn(" must be a number. using max or fallback. max: " + i2 + ", fallback: " + s2),
        ct(s2 || i2, e2, i2, r2))
  );
}
class ft {
  constructor(t2) {
    ((this.it = {}),
      (this.rt = t2.rt),
      (this.nt = ct(t2.bucketSize, 0, 100, t2.st)),
      (this.ot = ct(t2.refillRate, 0, this.nt, t2.st)),
      (this.ut = ct(t2.refillInterval, 0, 864e5, t2.st)));
  }
  ht(t2, e2) {
    var i2 = Math.floor((e2 - t2.lastAccess) / this.ut);
    i2 > 0 &&
      ((t2.tokens = Math.min(t2.tokens + i2 * this.ot, this.nt)),
      (t2.lastAccess = t2.lastAccess + i2 * this.ut));
  }
  consumeRateLimit(t2) {
    var e2,
      i2 = Date.now(),
      r2 = String(t2),
      s2 = this.it[r2];
    return (
      s2 ? this.ht(s2, i2) : (this.it[r2] = s2 = { tokens: this.nt, lastAccess: i2 }),
      0 === s2.tokens ||
        (s2.tokens--,
        0 === s2.tokens && (null == (e2 = this.rt) || e2.call(this, t2)),
        0 === s2.tokens)
    );
  }
  stop() {
    this.it = {};
  }
}
var pt = "Mobile",
  _t = "iOS",
  gt = "Android",
  mt = "Tablet",
  yt = gt + " " + mt,
  bt = "iPad",
  wt = "Apple",
  Et = wt + " Watch",
  xt = "Safari",
  St = "BlackBerry",
  $t = "Samsung",
  kt = $t + "Browser",
  Tt = $t + " Internet",
  Rt = "Chrome",
  Pt = Rt + " OS",
  Ot = Rt + " " + _t,
  Ct = "Internet Explorer",
  It = Ct + " " + pt,
  At = "Opera",
  Ft = At + " Mini",
  Mt = "Edge",
  Dt = "Microsoft " + Mt,
  Nt = "Firefox",
  Ut = Nt + " " + _t,
  Lt = "Nintendo",
  jt = "PlayStation",
  Bt = "Xbox",
  zt = gt + " " + pt,
  qt = pt + " " + xt,
  Ht = "Windows",
  Vt = Ht + " Phone",
  Wt = "Nokia",
  Gt = "Ouya",
  Kt = "Generic",
  Jt = Kt + " " + pt.toLowerCase(),
  Yt = Kt + " " + mt.toLowerCase(),
  Qt = "Konqueror",
  Xt = "Oculus Browser",
  Zt = "Vivaldi",
  te = "Yandex",
  ee = "Whale",
  ie = "DuckDuckGo",
  re = "Pale Moon",
  se = "Waterfox",
  ne = "Brave",
  oe = "Google Search App",
  ae = "(\\d+(\\.\\d+)?)",
  le = new RegExp("Version/" + ae),
  ue = new RegExp(Bt, "i"),
  he = new RegExp(jt + " \\w+", "i"),
  de = new RegExp(Lt + " \\w+", "i"),
  ve = new RegExp(St + "|PlayBook|BB10", "i"),
  ce = {
    "NT3.51": "NT 3.11",
    "NT4.0": "NT 4.0",
    "5.0": "2000",
    5.1: "XP",
    5.2: "XP",
    "6.0": "Vista",
    6.1: "7",
    6.2: "8",
    6.3: "8.1",
    6.4: "10",
    "10.0": "10",
  },
  fe = function (t2, e2, i2, r2) {
    e2 = e2 || "";
    var s2 = (function (t3) {
      return null != t3 && t3.brave ? ne : null;
    })(i2);
    return (
      s2 ||
      (null != r2 && r2.detectGoogleSearchApp && N(t2, "GSA/")
        ? oe
        : N(t2, " OPR/") && N(t2, "Mini")
          ? Ft
          : N(t2, " OPR/")
            ? At
            : ve.test(t2)
              ? St
              : N(t2, "IE" + pt) || N(t2, "WPDesktop")
                ? It
                : N(t2, "OculusBrowser")
                  ? Xt
                  : N(t2, kt)
                    ? Tt
                    : N(t2, Mt) || N(t2, "Edg/")
                      ? Dt
                      : N(t2, Zt + "/")
                        ? Zt
                        : N(t2, "YaBrowser/")
                          ? te
                          : N(t2, ee + "/")
                            ? ee
                            : N(t2, ie + "/") || N(t2, "Ddg/")
                              ? ie
                              : N(t2, "FBIOS")
                                ? "Facebook " + pt
                                : N(t2, "UCWEB") || N(t2, "UCBrowser")
                                  ? "UC Browser"
                                  : N(t2, "CriOS")
                                    ? Ot
                                    : N(t2, "CrMo") || N(t2, Rt)
                                      ? Rt
                                      : N(t2, gt) && N(t2, xt)
                                        ? zt
                                        : N(t2, "FxiOS")
                                          ? Ut
                                          : N(t2.toLowerCase(), Qt.toLowerCase())
                                            ? Qt
                                            : N(t2, ne + "/")
                                              ? ne
                                              : ((t3, e3) =>
                                                    (e3 && N(e3, wt)) ||
                                                    (function (t4) {
                                                      return N(t4, xt) && !N(t4, Rt) && !N(t4, gt);
                                                    })(t3))(t2, e2)
                                                ? N(t2, pt)
                                                  ? qt
                                                  : xt
                                                : N(t2, "PaleMoon/")
                                                  ? re
                                                  : N(t2, se + "/")
                                                    ? se
                                                    : N(t2, Nt)
                                                      ? Nt
                                                      : N(t2, "MSIE") || N(t2, "Trident/")
                                                        ? Ct
                                                        : N(t2, "Gecko")
                                                          ? Nt
                                                          : "")
    );
  },
  pe = {
    [It]: [new RegExp("rv:" + ae)],
    [Dt]: [new RegExp(Mt + "?\\/" + ae)],
    [Rt]: [new RegExp("(" + Rt + "|CrMo)\\/" + ae)],
    [Ot]: [new RegExp("CriOS\\/" + ae)],
    "UC Browser": [new RegExp("(UCBrowser|UCWEB)\\/" + ae)],
    [xt]: [le],
    [qt]: [le],
    [At]: [new RegExp("(Opera|OPR)\\/" + ae)],
    [Nt]: [new RegExp(Nt + "\\/" + ae)],
    [Ut]: [new RegExp("FxiOS\\/" + ae)],
    [Qt]: [new RegExp("Konqueror[:/]?" + ae, "i")],
    [St]: [new RegExp(St + " " + ae), le],
    [zt]: [new RegExp("android\\s" + ae, "i")],
    [Tt]: [new RegExp(kt + "\\/" + ae)],
    [Xt]: [new RegExp("OculusBrowser\\/" + ae)],
    [Zt]: [new RegExp(Zt + "\\/" + ae)],
    [te]: [new RegExp("YaBrowser\\/" + ae)],
    [ee]: [new RegExp(ee + "\\/" + ae)],
    [ne]: [new RegExp(ne + "\\/" + ae)],
    [ie]: [new RegExp("(DuckDuckGo|Ddg)\\/" + ae)],
    [re]: [new RegExp("PaleMoon\\/" + ae)],
    [se]: [new RegExp(se + "\\/" + ae)],
    [oe]: [new RegExp("GSA\\/" + ae)],
    [Ct]: [new RegExp("(rv:|MSIE )" + ae)],
    Mozilla: [new RegExp("rv:" + ae)],
  },
  _e = function (t2, e2, i2, r2) {
    var s2 = fe(t2, e2, i2, r2),
      n2 = pe[s2];
    if (K(n2)) return null;
    for (var o2 = 0; n2.length > o2; o2++) {
      var a2 = t2.match(n2[o2]);
      if (a2) return parseFloat(a2[a2.length - 2]);
    }
    return null;
  },
  ge = [
    [new RegExp(Bt + "; " + Bt + " (.*?)[);]", "i"), (t2) => [Bt, (t2 && t2[1]) || ""]],
    [new RegExp(Lt, "i"), [Lt, ""]],
    [new RegExp(jt, "i"), [jt, ""]],
    [ve, [St, ""]],
    [
      new RegExp(Ht, "i"),
      (t2, e2) => {
        if (/Phone/.test(e2) || /WPDesktop/.test(e2)) return [Vt, ""];
        if (new RegExp(pt).test(e2) && !/IEMobile\b/.test(e2)) return [Ht + " " + pt, ""];
        var i2 = /Windows NT ([0-9.]+)/i.exec(e2);
        if (i2 && i2[1]) {
          var r2 = ce[i2[1]] || "";
          return (/arm/i.test(e2) && (r2 = "RT"), [Ht, r2]);
        }
        return [Ht, ""];
      },
    ],
    [
      /((iPhone|iPad|iPod).*?OS (\d+)_(\d+)_?(\d+)?|iPhone)/,
      (t2) => (t2 && t2[3] ? [_t, [t2[3], t2[4], t2[5] || "0"].join(".")] : [_t, ""]),
    ],
    [
      /(watch.*\/(\d+\.\d+\.\d+)|watch os,(\d+\.\d+),)/i,
      (t2) => {
        var e2 = "";
        return (t2 && t2.length >= 3 && (e2 = K(t2[2]) ? t2[3] : t2[2]), ["watchOS", e2]);
      },
    ],
    [
      new RegExp("(" + gt + " (\\d+)\\.(\\d+)\\.?(\\d+)?|" + gt + ")", "i"),
      (t2) => (t2 && t2[2] ? [gt, [t2[2], t2[3], t2[4] || "0"].join(".")] : [gt, ""]),
    ],
    [
      /Mac OS X (\d+)[_.](\d+)[_.]?(\d+)?/i,
      (t2) => {
        var e2 = ["Mac OS X", ""];
        return (t2 && t2[1] && (e2[1] = [t2[1], t2[2], t2[3] || "0"].join(".")), e2);
      },
    ],
    [/Mac/i, ["Mac OS X", ""]],
    [/CrOS/, [Pt, ""]],
    [/Linux|debian/i, ["Linux", ""]],
  ],
  me = function (t2) {
    return de.test(t2)
      ? Lt
      : he.test(t2)
        ? jt
        : ue.test(t2)
          ? Bt
          : new RegExp(Gt, "i").test(t2)
            ? Gt
            : new RegExp("(" + Vt + "|WPDesktop)", "i").test(t2)
              ? Vt
              : /iPad/.test(t2)
                ? bt
                : /iPod/.test(t2)
                  ? "iPod Touch"
                  : /iPhone/.test(t2)
                    ? "iPhone"
                    : /(watch)(?: ?os[,/]|\d,\d\/)[\d.]+/i.test(t2)
                      ? Et
                      : ve.test(t2)
                        ? St
                        : /(kobo)\s(ereader|touch)/i.test(t2)
                          ? "Kobo"
                          : new RegExp(Wt, "i").test(t2)
                            ? Wt
                            : /(kf[a-z]{2}wi|aeo[c-r]{2})( bui|\))/i.test(t2) ||
                                /(kf[a-z]+)( bui|\)).+silk\//i.test(t2)
                              ? "Kindle Fire"
                              : /(Android|ZTE)/i.test(t2)
                                ? (new RegExp(pt).test(t2) &&
                                    !/(9138B|TB782B|Nexus [97]|pixel c|HUAWEISHT|BTV|noble nook|smart ultra 6)/i.test(
                                      t2,
                                    )) ||
                                  (/pixel[\daxl ]{1,6}/i.test(t2) && !/pixel c/i.test(t2)) ||
                                  /(huaweimed-al00|tah-|APA|SM-G92|i980|zte|U304AA)/i.test(t2) ||
                                  (/lmy47v/i.test(t2) && !/QTAQZ3/i.test(t2))
                                  ? gt
                                  : yt
                                : new RegExp("(pda|" + pt + ")", "i").test(t2)
                                  ? Jt
                                  : new RegExp(mt, "i").test(t2) &&
                                      !new RegExp(mt + " pc", "i").test(t2)
                                    ? Yt
                                    : "";
  },
  ye = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function be(t2, e2) {
  return "string" == typeof (i2 = t2) && ye.test(i2) ? t2 : e2();
  var i2;
}
function we(t2) {
  return t2 ? t2.split("#")[0] : t2;
}
function Ee(t2, e2) {
  var i2 = setTimeout(t2, e2);
  return ((null == i2 ? void 0 : i2.unref) && (null == i2 || i2.unref()), i2);
}
function xe(t2, e2, i2) {
  return Se.apply(this, arguments);
}
function Se() {
  return (Se = p(function* (t2, e2, i2) {
    var r2;
    try {
      return yield Promise.race([
        t2,
        new Promise((t3, s2) => {
          r2 = Ee(() => {
            try {
              (null == i2 || i2(), t3());
            } catch (t4) {
              s2(t4);
            }
          }, e2);
        }),
      ]);
    } finally {
      clearTimeout(r2);
    }
  })).apply(this, arguments);
}
var $e = {
    trace: { text: "TRACE", number: 1 },
    debug: { text: "DEBUG", number: 5 },
    info: { text: "INFO", number: 9 },
    warn: { text: "WARN", number: 13 },
    error: { text: "ERROR", number: 17 },
    fatal: { text: "FATAL", number: 21 },
  },
  ke = $e.info;
function Te(t2) {
  if (et(t2)) return { boolValue: t2 };
  if ("number" == typeof t2)
    return Number.isFinite(t2)
      ? Number.isInteger(t2)
        ? { intValue: t2 }
        : { doubleValue: t2 }
      : { stringValue: String(t2) };
  if ("string" == typeof t2) return { stringValue: t2 };
  if (H(t2)) return { arrayValue: { values: t2.map((t3) => Te(t3)) } };
  try {
    return { stringValue: JSON.stringify(t2) };
  } catch (e2) {
    return { stringValue: String(t2) };
  }
}
function Re(t2) {
  var e2 = [];
  for (var i2 in t2) {
    var r2 = t2[i2];
    Q(r2) || K(r2) || e2.push({ key: i2, value: Te(r2) });
  }
  return e2;
}
function Pe(t2, e2) {
  var i2 = $e[t2.level || "info"] || ke,
    r2 = i2.text,
    s2 = i2.number,
    n2 = String(Date.now()) + "000000",
    o2 = {};
  (e2.distinctId && (o2.posthogDistinctId = e2.distinctId),
    e2.sessionId && (o2.sessionId = e2.sessionId),
    e2.windowId && (o2["window.id"] = e2.windowId),
    X(e2.sessionStartTimestamp) || (o2.sessionStartTimestamp = String(e2.sessionStartTimestamp)),
    X(e2.lastActivityTimestamp) || (o2.lastActivityTimestamp = String(e2.lastActivityTimestamp)),
    e2.currentUrl && (o2["url.full"] = e2.currentUrl),
    e2.screenName && (o2["screen.name"] = e2.screenName),
    e2.appState && (o2["app.state"] = e2.appState),
    e2.activeFeatureFlags &&
      e2.activeFeatureFlags.length > 0 &&
      (o2.feature_flags = e2.activeFeatureFlags));
  var a2 = _({}, o2, t2.attributes || {}),
    l2 = {
      timeUnixNano: n2,
      observedTimeUnixNano: n2,
      severityNumber: s2,
      severityText: r2,
      body: { stringValue: t2.body },
      attributes: Re(a2),
    };
  return (
    t2.trace_id && (l2.traceId = t2.trace_id),
    t2.span_id && (l2.spanId = t2.span_id),
    K(t2.trace_flags) || (l2.flags = t2.trace_flags),
    l2
  );
}
function Oe(t2, e2, i2) {
  return _(
    {},
    t2.resourceAttributes,
    { "service.name": t2.serviceName || "unknown_service" },
    t2.environment && { "deployment.environment": t2.environment },
    t2.serviceVersion && { "service.version": t2.serviceVersion },
    { "telemetry.sdk.name": e2, "telemetry.sdk.version": i2 },
  );
}
function Ce(t2, e2, i2, r2) {
  return {
    resourceLogs: [
      {
        resource: { attributes: Re(e2) },
        scopeLogs: [{ scope: { name: i2, version: r2 }, logRecords: t2 }],
      },
    ],
  };
}
let Ie = class {
  constructor(t2, e2, i2, r2, s2, n2, o2) {
    var a2;
    (void 0 === n2 && (n2 = () => Promise.resolve()),
      (this._instance = t2),
      (this.qe = e2),
      (this.st = i2),
      (this.dt = r2),
      (this.vt = s2),
      (this.ct = n2),
      (this.ft = o2),
      (this.yt = null),
      (this.bt = 0),
      (this._t = 0),
      (this.wt = 0),
      (this.kt = 0),
      (this.xt = false),
      (this.St = e2.maxBufferSize),
      (this.Ct = Math.max(
        null !== (a2 = e2.maxQueueSize) && void 0 !== a2 ? a2 : e2.maxBufferSize,
        e2.maxBufferSize,
      )),
      (this.Mt = e2.flushIntervalMs),
      (this.Tt = e2.maxBatchRecordsPerPost),
      (this.Et = e2.rateCapWindowMs),
      (this.It = e2.maxLogsPerInterval));
  }
  reset() {
    (this.Pt(),
      (this.yt = null),
      (this.wt = 0),
      (this.kt = 0),
      (this.xt = false),
      (this.bt = 0),
      (this._t = 0),
      (this.Tt = this.qe.maxBatchRecordsPerPost));
  }
  onReconnect() {
    ((this._t = 0), this.Rt());
  }
  captureLog(t2) {
    if (!this._instance.isDisabled && !this._instance.optedOut && null != t2 && t2.body) {
      var e2 = this.At(t2);
      if (null !== e2)
        if (e2.body) {
          if (this.Ft()) {
            var i2 = { record: Pe(e2, this.dt()) };
            this.vt(() => this.Lt(i2));
          }
        } else this.st.info("Log was rejected in beforeSend function");
    }
  }
  At(t2) {
    var e2 = this.qe.beforeSend;
    if (!e2) return t2;
    var i2 = H(e2) ? e2 : [e2],
      r2 = t2;
    for (var s2 of i2)
      try {
        var n2 = s2(r2);
        if (!n2) return (this.st.info("Log was rejected in beforeSend function"), null);
        r2 = n2;
      } catch (t3) {
        return (this.st.error("Error in beforeSend function for log:", t3), null);
      }
    return r2;
  }
  Ft() {
    if (void 0 === this.It) return true;
    var t2 = Date.now(),
      e2 = t2 - this.wt;
    return (
      (this.Et > e2 && e2 >= 0) || ((this.wt = t2), (this.kt = 0), (this.xt = false)),
      this.It > this.kt
        ? (this.kt++, true)
        : (this.xt ||
            (this.st.warn(
              "captureLog dropping logs: exceeded " + this.It + " logs per " + this.Et + "ms",
            ),
            (this.xt = true)),
          false)
    );
  }
  flush() {
    var t2 = this;
    return p(function* () {
      if (!t2._instance.isDisabled)
        return (
          t2.yt ||
            (t2.yt = t2.Ot().finally(() => {
              t2.yt = null;
            })),
          t2.yt
        );
    })();
  }
  Ot() {
    var t2 = this;
    return p(function* () {
      var e2;
      t2.Pt();
      var i2 =
        null !== (e2 = t2._instance.getPersistedProperty(x.LogsQueue)) && void 0 !== e2 ? e2 : [];
      if (0 !== i2.length)
        for (var r2 = i2.length, s2 = 0; i2.length > 0 && r2 > s2;) {
          var n2, o2;
          t2.bt = 0;
          var a2 = Math.min(i2.length, t2.Tt),
            l2 = i2.slice(0, a2),
            u2 = Ce(
              l2.map((t3) => t3.record),
              t2.Dt(),
              null !== (n2 = t2.ft) && void 0 !== n2 ? n2 : t2._instance.getLibraryId(),
              t2._instance.getLibraryVersion(),
            ),
            h2 = yield t2._instance.$t(u2);
          if ("too-large" === h2.kind && l2.length > 1)
            ((t2.Tt = Math.max(1, Math.floor(l2.length / 2))),
              t2.st.warn(
                "Received 413 when sending logs batch of size " +
                  l2.length +
                  ", reducing batch size to " +
                  t2.Tt,
              ));
          else {
            if ("retry-later" === h2.kind) throw h2.error;
            if (
              ("too-large" === h2.kind
                ? t2.st.warn(
                    "Dropping a single log record after 413 with batch size 1 — the record is larger than the server cap and cannot be split further.",
                  )
                : "ok" === h2.kind &&
                  t2.qe.maxBatchRecordsPerPost > t2.Tt &&
                  (t2.Tt = Math.min(t2.qe.maxBatchRecordsPerPost, t2.Tt + 1)),
              yield t2.Nt(l2.length),
              (i2 =
                null !== (o2 = t2._instance.getPersistedProperty(x.LogsQueue)) && void 0 !== o2
                  ? o2
                  : []),
              (s2 += l2.length),
              "fatal" === h2.kind)
            )
              throw h2.error;
          }
        }
    })();
  }
  Nt(t2) {
    var e2 = this;
    return p(function* () {
      var i2,
        r2 = Math.max(0, t2 - e2.bt),
        s2 =
          null !== (i2 = e2._instance.getPersistedProperty(x.LogsQueue)) && void 0 !== i2 ? i2 : [];
      (e2._instance.setPersistedProperty(x.LogsQueue, s2.slice(r2)), yield e2.ct());
    })();
  }
  Dt() {
    return Oe(this.qe, this._instance.getLibraryId(), this._instance.getLibraryVersion());
  }
  Lt(t2) {
    var e2;
    if (!this._instance.optedOut) {
      var i2 =
        null !== (e2 = this._instance.getPersistedProperty(x.LogsQueue)) && void 0 !== e2 ? e2 : [];
      (this.Ct > i2.length ||
        (i2.shift(), this.bt++, this.st.info("Logs queue is full, dropping oldest record.")),
        i2.push(t2),
        this._instance.setPersistedProperty(x.LogsQueue, i2),
        this.St > i2.length ? this.qt() : this.Rt());
    }
  }
  qt(t2) {
    (void 0 === t2 && (t2 = this.Mt),
      this.jt ||
        (this.jt = Ee(() => {
          ((this.jt = void 0), this.Rt());
        }, t2)));
  }
  Bt() {
    var t2 = Math.min(Math.max(0, this._t - 1), 6);
    return this.Mt * Math.pow(2, t2);
  }
  Ht() {
    var t2 = this._instance.getPersistedProperty(x.LogsQueue);
    return !!t2 && t2.length > 0;
  }
  shutdown(t2) {
    var e2 = this;
    return p(function* () {
      e2.Pt();
      var i2 = e2.flush().catch(() => {});
      void 0 !== t2 ? yield xe(i2, t2) : yield i2;
    })();
  }
  flushWithTimeout(t2) {
    var e2 = this;
    return p(function* () {
      var i2 = e2.flush();
      yield xe(i2, t2, () => {
        i2.catch(() => {});
      });
    })();
  }
  Rt() {
    this.flush()
      .then(
        () => {
          this._t = 0;
        },
        (t2) => {
          (this._t++, this.st.error("PostHog logs flush failed:", t2));
        },
      )
      .finally(() => {
        !this._instance.isDisabled && this.Ht() && this.qt(this.Bt());
      });
  }
  Pt() {
    this.jt && (clearTimeout(this.jt), (this.jt = void 0));
  }
};
var Ae = [0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1e3, 2500, 5e3, 7500, 1e4];
function Fe(t2) {
  return String(t2) + "000000";
}
function Me(t2, e2, i2, r2) {
  var s2 = "";
  return (
    r2 &&
      (s2 = Object.keys(r2)
        .sort()
        .map((t3) => JSON.stringify(t3) + ":" + JSON.stringify(r2[t3]))
        .join(",")),
    t2 + "\0" + e2 + "\0" + (null != i2 ? i2 : "") + "\0" + s2
  );
}
let De = class {
  constructor(t2, e2, i2) {
    ((this._instance = t2),
      (this.qe = e2),
      (this.st = i2),
      (this.Ut = /* @__PURE__ */ new Map()),
      (this.yt = null),
      (this.zt = false),
      (this.Wt = /* @__PURE__ */ new Map()),
      (this.Vt = /* @__PURE__ */ new Set()),
      (this.Zt = 0));
  }
  count(t2, e2, i2) {
    (void 0 === e2 && (e2 = 1),
      this.Gt({
        name: t2,
        type: "count",
        value: e2,
        unit: null == i2 ? void 0 : i2.unit,
        attributes: null == i2 ? void 0 : i2.attributes,
      }));
  }
  gauge(t2, e2, i2) {
    this.Gt({
      name: t2,
      type: "gauge",
      value: e2,
      unit: null == i2 ? void 0 : i2.unit,
      attributes: null == i2 ? void 0 : i2.attributes,
    });
  }
  histogram(t2, e2, i2) {
    this.Gt({
      name: t2,
      type: "histogram",
      value: e2,
      unit: null == i2 ? void 0 : i2.unit,
      attributes: null == i2 ? void 0 : i2.attributes,
    });
  }
  flush() {
    var t2 = this,
      e2 = this.yt,
      i2 = (function () {
        var i3 = p(function* () {
          (e2 && (yield e2.catch(() => {})), yield t2.Qt());
        });
        return function () {
          return i3.apply(this, arguments);
        };
      })(),
      r2 = i2().finally(() => {
        this.yt === r2 && (this.yt = null);
      });
    return ((this.yt = r2), r2);
  }
  drainWindow() {
    if (0 === this.Ut.size) return null;
    var t2 = this.Ut;
    return (
      (this.Ut = /* @__PURE__ */ new Map()),
      (this.zt = false),
      (this.Wt = /* @__PURE__ */ new Map()),
      (this.Vt = /* @__PURE__ */ new Set()),
      this.Kt(t2)
    );
  }
  reset() {
    (this.Zt++,
      this.Pt(),
      (this.Ut = /* @__PURE__ */ new Map()),
      (this.yt = null),
      (this.zt = false),
      (this.Wt = /* @__PURE__ */ new Map()),
      (this.Vt = /* @__PURE__ */ new Set()));
  }
  Gt(t2) {
    if (!this._instance.isDisabled && !this._instance.optedOut) {
      var e2 = this.At(t2);
      if (null !== e2)
        if (e2.name && "string" == typeof e2.name)
          if ("number" == typeof e2.value && Number.isFinite(e2.value))
            if ("count" === e2.type && 0 > e2.value)
              this.st.warn(
                "Dropping count '" + e2.name + "': counters are monotonic, value must be >= 0",
              );
            else {
              var i2, r2;
              try {
                ((i2 = e2.attributes ? _({}, e2.attributes) : void 0),
                  (r2 = Me(e2.type, e2.name, e2.unit, i2)));
              } catch (t3) {
                return void this.st.warn(
                  "Dropping metric '" + e2.name + "': attributes could not be serialized",
                  t3,
                );
              }
              var s2 = this.Ut.get(r2);
              if (!s2) {
                if (!this.Jt()) return;
                ((s2 = {
                  name: e2.name,
                  type: e2.type,
                  unit: e2.unit,
                  attributes: i2,
                  windowStartMs: Date.now(),
                }),
                  this.Ut.set(r2, s2));
              }
              var n2 = this.Wt.get(e2.name);
              (void 0 === n2
                ? this.Wt.set(e2.name, e2.type)
                : n2 === e2.type ||
                  this.Vt.has(e2.name) ||
                  (this.Vt.add(e2.name),
                  this.st.warn(
                    "Metric name '" +
                      e2.name +
                      "' is already used as a " +
                      n2 +
                      "; recording it as a " +
                      e2.type +
                      " too will blend both series in charts. Use a distinct name.",
                  )),
                this.Yt(s2, e2.value),
                this.qt());
            }
          else this.st.warn("Dropping metric '" + e2.name + "': value must be a finite number");
        else this.st.warn("Dropping metric with empty name");
    }
  }
  Jt() {
    return (
      this.qe.maxSeriesPerFlush > this.Ut.size ||
      (this.zt ||
        ((this.zt = true),
        this.st.warn(
          "Metric series cap reached (" +
            this.qe.maxSeriesPerFlush +
            " per flush window); dropping new series until the next flush. Reduce attribute cardinality.",
        )),
      false)
    );
  }
  Yt(t2, e2) {
    var i2;
    switch (t2.type) {
      case "count":
        t2.total = (null !== (i2 = t2.total) && void 0 !== i2 ? i2 : 0) + e2;
        break;
      case "gauge":
        t2.last = e2;
        break;
      case "histogram":
        t2.hist ||
          (t2.hist = {
            count: 0,
            sum: 0,
            min: e2,
            max: e2,
            bucketCounts: new Array(Ae.length + 1).fill(0),
          });
        var r2 = t2.hist;
        ((r2.count += 1),
          (r2.sum += e2),
          (r2.min = Math.min(r2.min, e2)),
          (r2.max = Math.max(r2.max, e2)),
          (r2.bucketCounts[
            (function (t3, e3) {
              for (var i3 = 0; e3.length > i3; i3++) if (e3[i3] >= t3) return i3;
              return e3.length;
            })(e2, Ae)
          ] += 1));
    }
  }
  At(t2) {
    var e2 = this.qe.beforeSend;
    if (!e2) return t2;
    var i2 = H(e2) ? e2 : [e2],
      r2 = t2;
    for (var s2 of i2)
      try {
        var n2 = s2(r2);
        if (!n2) return (this.st.info("Metric was rejected in beforeSend function"), null);
        r2 = n2;
      } catch (t3) {
        return (this.st.error("Error in beforeSend function for metric:", t3), null);
      }
    return r2;
  }
  qt() {
    this.jt ||
      (this.jt = Ee(() => {
        ((this.jt = void 0),
          this.flush().catch((t2) => {
            this.st.error("Metrics flush failed:", t2);
          }));
      }, this.qe.flushIntervalMs));
  }
  Pt() {
    this.jt && (clearTimeout(this.jt), (this.jt = void 0));
  }
  Qt() {
    var t2 = this;
    return p(function* () {
      if (0 !== t2.Ut.size) {
        var e2 = t2.Ut;
        ((t2.Ut = /* @__PURE__ */ new Map()),
          (t2.zt = false),
          (t2.Wt = /* @__PURE__ */ new Map()),
          (t2.Vt = /* @__PURE__ */ new Set()));
        var i2 = t2.Zt,
          r2 = yield t2._instance.Xt(t2.Kt(e2));
        if (i2 === t2.Zt)
          switch (r2.kind) {
            case "ok":
              return;
            case "retry-later":
              return (t2.ti(e2), void t2.qt());
            case "too-large":
              return void t2.st.warn(
                "Metrics batch exceeded the server size limit and was dropped",
              );
            case "fatal":
              return void t2.st.error("Failed to send metrics batch:", r2.error);
          }
      }
    })();
  }
  Kt(t2) {
    return (
      (e2 = this.ei(t2)),
      (i2 = (function (t3, e3, i3) {
        return _(
          {},
          t3.resourceAttributes,
          { "service.name": t3.serviceName || "unknown_service" },
          t3.environment && { "deployment.environment": t3.environment },
          t3.serviceVersion && { "service.version": t3.serviceVersion },
          { "telemetry.sdk.name": e3, "telemetry.sdk.version": i3 },
        );
      })(this.qe, this._instance.getLibraryId(), this._instance.getLibraryVersion())),
      (r2 = this._instance.getLibraryId()),
      (s2 = this._instance.getLibraryVersion()),
      {
        resourceMetrics: [
          {
            resource: { attributes: Re(i2) },
            scopeMetrics: [{ scope: { name: r2, version: s2 }, metrics: e2 }],
          },
        ],
      }
    );
    var e2, i2, r2, s2;
  }
  ei(t2) {
    var e2 = Fe(Date.now()),
      i2 = /* @__PURE__ */ new Map();
    for (var r2 of t2.values()) {
      var s2,
        n2 = Me(r2.type, r2.name, r2.unit, void 0),
        o2 = i2.get(n2);
      o2 ||
        ((o2 = _({ name: r2.name }, r2.unit && { unit: r2.unit })),
        "count" === r2.type
          ? (o2.sum = { aggregationTemporality: 1, isMonotonic: true, dataPoints: [] })
          : "gauge" === r2.type
            ? (o2.gauge = { dataPoints: [] })
            : (o2.histogram = { aggregationTemporality: 1, dataPoints: [] }),
        i2.set(n2, o2));
      var a2 = Re(null !== (s2 = r2.attributes) && void 0 !== s2 ? s2 : {}),
        l2 = Fe(r2.windowStartMs);
      if ("count" === r2.type) {
        var u2,
          h2 = {
            attributes: a2,
            startTimeUnixNano: l2,
            timeUnixNano: e2,
            asDouble: null !== (u2 = r2.total) && void 0 !== u2 ? u2 : 0,
          };
        o2.sum.dataPoints.push(h2);
      } else if ("gauge" === r2.type) {
        var d2,
          v2 = {
            attributes: a2,
            timeUnixNano: e2,
            asDouble: null !== (d2 = r2.last) && void 0 !== d2 ? d2 : 0,
          };
        o2.gauge.dataPoints.push(v2);
      } else
        r2.hist &&
          o2.histogram.dataPoints.push({
            attributes: a2,
            startTimeUnixNano: l2,
            timeUnixNano: e2,
            count: r2.hist.count,
            sum: r2.hist.sum,
            min: r2.hist.min,
            max: r2.hist.max,
            bucketCounts: r2.hist.bucketCounts,
            explicitBounds: Ae,
          });
    }
    return Array.from(i2.values());
  }
  ti(t2) {
    var e2, i2;
    for (var r2 of t2) {
      var s2 = r2[0],
        n2 = r2[1],
        o2 = this.Ut.get(s2);
      if (o2)
        switch (((o2.windowStartMs = Math.min(o2.windowStartMs, n2.windowStartMs)), o2.type)) {
          case "count":
            o2.total =
              (null !== (e2 = o2.total) && void 0 !== e2 ? e2 : 0) +
              (null !== (i2 = n2.total) && void 0 !== i2 ? i2 : 0);
            break;
          case "gauge":
            break;
          case "histogram":
            if (n2.hist)
              if (o2.hist) {
                ((o2.hist.count += n2.hist.count),
                  (o2.hist.sum += n2.hist.sum),
                  (o2.hist.min = Math.min(o2.hist.min, n2.hist.min)),
                  (o2.hist.max = Math.max(o2.hist.max, n2.hist.max)));
                for (var a2 = 0; o2.hist.bucketCounts.length > a2; a2++)
                  o2.hist.bucketCounts[a2] += n2.hist.bucketCounts[a2];
              } else o2.hist = n2.hist;
        }
      else this.Jt() && this.Ut.set(s2, n2);
    }
  }
};
var Ne, Ue, Le;
function je(t2) {
  var e2 = globalThis._posthogChunkIds;
  if (e2) {
    var i2 = Object.keys(e2);
    return (
      (Le && i2.length === Ue) ||
        ((Ue = i2.length),
        (Le = i2.reduce((i3, r2) => {
          Ne || (Ne = {});
          var s2 = Ne[r2];
          if (s2) i3[s2[0]] = s2[1];
          else
            for (var n2 = t2(r2), o2 = n2.length - 1; o2 >= 0; o2--) {
              var a2 = n2[o2],
                l2 = null == a2 ? void 0 : a2.filename,
                u2 = e2[r2];
              if (l2 && u2) {
                ((i3[l2] = u2), (Ne[r2] = [l2, u2]));
                break;
              }
            }
          return i3;
        }, {}))),
      Le
    );
  }
}
class Be {
  constructor(t2, e2, i2) {
    (void 0 === i2 && (i2 = []),
      (this.coercers = t2),
      (this.stackParser = e2),
      (this.modifiers = i2));
  }
  buildFromUnknown(t2, e2) {
    void 0 === e2 && (e2 = {});
    var i2 = (e2 && e2.mechanism) || { handled: true, type: "generic" },
      r2 = this.buildCoercingContext(i2, e2, 0).apply(t2),
      s2 = this.buildParsingContext(e2),
      n2 = this.parseStacktrace(r2, s2);
    return { $exception_list: this.convertToExceptionList(n2, i2), $exception_level: "error" };
  }
  modifyFrames(t2) {
    var e2 = this;
    return p(function* () {
      for (var i2 of t2)
        i2.stacktrace &&
          i2.stacktrace.frames &&
          H(i2.stacktrace.frames) &&
          (i2.stacktrace.frames = yield e2.applyModifiers(i2.stacktrace.frames));
      return t2;
    })();
  }
  coerceFallback(t2) {
    var e2;
    return {
      type: "Error",
      value: "Unknown error",
      stack: null == (e2 = t2.syntheticException) ? void 0 : e2.stack,
      synthetic: true,
    };
  }
  parseStacktrace(t2, e2) {
    var i2, r2;
    return (
      null != t2.cause && (i2 = this.parseStacktrace(t2.cause, e2)),
      "" != t2.stack &&
        null != t2.stack &&
        (r2 = this.applyChunkIds(
          this.stackParser(t2.stack, t2.synthetic ? e2.skipFirstLines : 0),
          e2.chunkIdMap,
        )),
      _({}, t2, { cause: i2, stack: r2 })
    );
  }
  applyChunkIds(t2, e2) {
    return t2.map((t3) => (t3.filename && e2 && (t3.chunk_id = e2[t3.filename]), t3));
  }
  applyCoercers(t2, e2) {
    for (var i2 of this.coercers) if (i2.match(t2)) return i2.coerce(t2, e2);
    return this.coerceFallback(e2);
  }
  applyModifiers(t2) {
    var e2 = this;
    return p(function* () {
      var i2 = t2;
      for (var r2 of e2.modifiers) i2 = yield r2(i2);
      return i2;
    })();
  }
  convertToExceptionList(t2, e2) {
    var i2,
      r2,
      s2,
      n2 = {
        type: t2.type,
        value: t2.value,
        mechanism: {
          type: null !== (i2 = e2.type) && void 0 !== i2 ? i2 : "generic",
          handled: null === (r2 = e2.handled) || void 0 === r2 || r2,
          synthetic: null !== (s2 = t2.synthetic) && void 0 !== s2 && s2,
        },
      };
    t2.stack && (n2.stacktrace = { type: "raw", frames: t2.stack });
    var o2 = [n2];
    return (
      null != t2.cause &&
        o2.push(...this.convertToExceptionList(t2.cause, _({}, e2, { handled: true }))),
      o2
    );
  }
  buildParsingContext(t2) {
    var e2;
    return {
      chunkIdMap: je(this.stackParser),
      skipFirstLines: null !== (e2 = t2.skipFirstLines) && void 0 !== e2 ? e2 : 1,
    };
  }
  buildCoercingContext(t2, e2, i2) {
    void 0 === i2 && (i2 = 0);
    var r2 = (i3, r3) => {
      if (4 >= r3) {
        var s2 = this.buildCoercingContext(t2, e2, r3);
        return this.applyCoercers(i3, s2);
      }
    };
    return _({}, e2, {
      syntheticException: 0 == i2 ? e2.syntheticException : void 0,
      mechanism: t2,
      apply: (t3) => r2(t3, i2),
      next: (t3) => r2(t3, i2 + 1),
    });
  }
}
var ze = "?";
function qe(t2, e2, i2, r2, s2) {
  var n2 = { platform: t2, filename: e2, function: "<anonymous>" === i2 ? ze : i2, in_app: true };
  return (K(r2) || (n2.lineno = r2), K(s2) || (n2.colno = s2), n2);
}
var He = (t2, e2) => {
    var i2 = -1 !== t2.indexOf("safari-extension"),
      r2 = -1 !== t2.indexOf("safari-web-extension");
    return i2 || r2
      ? [
          -1 !== t2.indexOf("@") ? t2.split("@")[0] : ze,
          i2 ? "safari-extension:" + e2 : "safari-web-extension:" + e2,
        ]
      : [t2, e2];
  },
  Ve = /^\s*at (\S+?)(?::(\d+))(?::(\d+))\s*$/i,
  We =
    /^\s*at (?:(.+?\)(?: \[.+\])?|.*?) ?\((?:address at )?)?(?:async )?((?:<anonymous>|[-a-z]+:|.*bundle|\/)?.*?)(?::(\d+))?(?::(\d+))?\)?\s*$/i,
  Ge = /\((\S*)(?::(\d+))(?::(\d+))\)/,
  Ke = (t2, e2) => {
    var i2 = Ve.exec(t2);
    if (i2) return qe(e2, i2[1], ze, +i2[2], +i2[3]);
    var r2 = We.exec(t2);
    if (r2) {
      if (r2[2] && 0 === r2[2].indexOf("eval")) {
        var s2 = Ge.exec(r2[2]);
        s2 && ((r2[2] = s2[1]), (r2[3] = s2[2]), (r2[4] = s2[3]));
      }
      var n2 = He(r2[1] || ze, r2[2]);
      return qe(e2, n2[1], n2[0], r2[3] ? +r2[3] : void 0, r2[4] ? +r2[4] : void 0);
    }
  },
  Je =
    /^\s*(.*?)(?:\((.*?)\))?(?:^|@)?((?:[-a-z]+)?:\/.*?|\[native code\]|[^@]*(?:bundle|\d+\.js)|\/[\w\-. /=]+)(?::(\d+))?(?::(\d+))?\s*$/i,
  Ye = /(\S+) line (\d+)(?: > eval line \d+)* > eval/i,
  Qe = (t2, e2) => {
    var i2 = Je.exec(t2);
    if (i2) {
      if (i2[3] && i2[3].indexOf(" > eval") > -1) {
        var r2 = Ye.exec(i2[3]);
        r2 && ((i2[1] = i2[1] || "eval"), (i2[3] = r2[1]), (i2[4] = r2[2]), (i2[5] = ""));
      }
      var s2 = i2[3],
        n2 = i2[1] || ze,
        o2 = He(n2, s2);
      return qe(e2, (s2 = o2[1]), (n2 = o2[0]), i2[4] ? +i2[4] : void 0, i2[5] ? +i2[5] : void 0);
    }
  },
  Xe = /\(error: (.*)\)/;
class Ze {
  match(t2) {
    return this.isDOMException(t2) || this.isDOMError(t2);
  }
  coerce(t2, e2) {
    var i2 = J(t2.stack);
    return {
      type: this.getType(t2),
      value: this.getValue(t2),
      stack: i2 ? t2.stack : void 0,
      cause: t2.cause ? e2.next(t2.cause) : void 0,
      synthetic: false,
    };
  }
  getType(t2) {
    return this.isDOMError(t2) ? "DOMError" : "DOMException";
  }
  getValue(t2) {
    var e2 = t2.name || (this.isDOMError(t2) ? "DOMError" : "DOMException");
    return t2.message ? e2 + ": " + t2.message : e2;
  }
  isDOMException(t2) {
    return ot(t2, "DOMException");
  }
  isDOMError(t2) {
    return ot(t2, "DOMError");
  }
}
class ti {
  match(t2) {
    return at(t2);
  }
  coerce(t2, e2) {
    return {
      type: this.getType(t2),
      value: this.getMessage(t2, e2),
      stack: this.getStack(t2),
      cause: t2.cause ? e2.next(t2.cause) : void 0,
      synthetic: false,
    };
  }
  getType(t2) {
    return t2.name || t2.constructor.name;
  }
  getMessage(t2, e2) {
    var i2 = t2.message;
    return String(i2.error && "string" == typeof i2.error.message ? i2.error.message : i2);
  }
  getStack(t2) {
    return t2.stacktrace || t2.stack || void 0;
  }
}
class ei {
  constructor() {}
  match(t2) {
    return !!ot(t2, "ErrorEvent") && (null != t2.error || this.fe(t2));
  }
  coerce(t2, e2) {
    var i2;
    if (null != t2.error) return e2.apply(t2.error);
    var r2 = e2.apply(t2.message);
    return _({}, r2, {
      stack: null !== (i2 = this.pe(t2)) && void 0 !== i2 ? i2 : r2.stack,
      synthetic: true,
    });
  }
  fe(t2) {
    return J(t2.message) && t2.message.length > 0;
  }
  pe(t2) {
    var e2 = t2;
    if (J(e2.filename) && e2.filename.length > 0) {
      var i2,
        r2,
        s2 = null !== (i2 = e2.lineno) && void 0 !== i2 ? i2 : 0,
        n2 = null !== (r2 = e2.colno) && void 0 !== r2 ? r2 : 0;
      return "Error\n    at " + e2.filename + ":" + s2 + ":" + n2;
    }
  }
}
var ii =
  /^(?:[Uu]ncaught (?:exception: )?)?(?:((?:Eval|Internal|Range|Reference|Syntax|Type|URI|)Error): )?(.*)$/i;
class ri {
  match(t2) {
    return "string" == typeof t2;
  }
  coerce(t2, e2) {
    var i2,
      r2 = this.getInfos(t2),
      s2 = r2[0],
      n2 = r2[1];
    return {
      type: null != s2 ? s2 : "Error",
      value: null != n2 ? n2 : t2,
      stack: null == (i2 = e2.syntheticException) ? void 0 : i2.stack,
      synthetic: true,
    };
  }
  getInfos(t2) {
    var e2 = "Error",
      i2 = t2,
      r2 = t2.match(ii);
    return (r2 && ((e2 = r2[1]), (i2 = r2[2])), [e2, i2]);
  }
}
var si = ["fatal", "error", "warning", "log", "info", "debug"];
function ni(t2, e2) {
  void 0 === e2 && (e2 = 40);
  var i2 = Object.keys(t2);
  if ((i2.sort(), !i2.length)) return "[object has no keys]";
  for (var r2 = i2.length; r2 > 0; r2--) {
    var s2 = i2.slice(0, r2).join(", ");
    if (e2 >= s2.length)
      return r2 === i2.length ? s2 : s2.length > e2 ? s2.slice(0, e2) + "..." : s2;
  }
  return "";
}
class oi {
  match(t2) {
    return "object" == typeof t2 && null !== t2;
  }
  coerce(t2, e2) {
    var i2,
      r2,
      s2 = this.getErrorPropertyFromObject(t2);
    return s2
      ? e2.apply(s2)
      : {
          type: this.getType(t2),
          value: this.getValue(t2),
          stack:
            null !== (i2 = this.getStack(t2)) && void 0 !== i2
              ? i2
              : null == (r2 = e2.syntheticException)
                ? void 0
                : r2.stack,
          level: this.isSeverityLevel(t2.level) ? t2.level : "error",
          synthetic: true,
        };
  }
  getType(t2) {
    if (lt(t2)) return t2.constructor.name;
    var e2 = "name" in t2 ? t2.name : void 0;
    return J(e2) && !Y(e2) ? e2 : "Error";
  }
  getValue(t2) {
    if ("name" in t2 && "string" == typeof t2.name) {
      var e2 = "'" + t2.name + "' captured as exception";
      return (
        "message" in t2 &&
          "string" == typeof t2.message &&
          (e2 += " with message: '" + t2.message + "'"),
        e2
      );
    }
    if ("message" in t2 && "string" == typeof t2.message) return t2.message;
    var i2 = this.getObjectClassName(t2);
    return (
      (i2 && "Object" !== i2 ? "'" + i2 + "'" : "Object") +
      " captured as exception with keys: " +
      ni(t2)
    );
  }
  isSeverityLevel(t2) {
    return J(t2) && !Y(t2) && si.indexOf(t2) >= 0;
  }
  getStack(t2) {
    try {
      return J(t2.stacktrace) && t2.stacktrace.length > 0
        ? t2.stacktrace
        : J(t2.stack) && t2.stack.length > 0
          ? t2.stack
          : void 0;
    } catch (t3) {
      return;
    }
  }
  getErrorPropertyFromObject(t2) {
    for (var e2 in t2)
      if ({}.hasOwnProperty.call(t2, e2)) {
        var i2 = t2[e2];
        if (at(i2)) return i2;
      }
  }
  getObjectClassName(t2) {
    try {
      var e2 = Object.getPrototypeOf(t2);
      return e2 ? e2.constructor.name : void 0;
    } catch (t3) {
      return;
    }
  }
}
class ai {
  match(t2) {
    return lt(t2);
  }
  coerce(t2, e2) {
    var i2,
      r2 = t2.constructor.name;
    return {
      type: r2,
      value: r2 + " captured as exception with keys: " + ni(t2),
      stack: null == (i2 = e2.syntheticException) ? void 0 : i2.stack,
      synthetic: true,
    };
  }
}
class li {
  match(t2) {
    return nt(t2);
  }
  coerce(t2, e2) {
    var i2;
    return {
      type: "Error",
      value: "Primitive value captured as exception: " + String(t2),
      stack: null == (i2 = e2.syntheticException) ? void 0 : i2.stack,
      synthetic: true,
    };
  }
}
class ui {
  match(t2) {
    return ot(t2, "PromiseRejectionEvent") || this.isCustomEventWrappingRejection(t2);
  }
  isCustomEventWrappingRejection(t2) {
    if (!lt(t2)) return false;
    try {
      var e2 = t2.detail;
      return null != e2 && "object" == typeof e2 && "reason" in e2;
    } catch (t3) {
      return false;
    }
  }
  coerce(t2, e2) {
    var i2,
      r2 = this.getUnhandledRejectionReason(t2);
    return nt(r2)
      ? {
          type: "UnhandledRejection",
          value: "Non-Error promise rejection captured with value: " + String(r2),
          stack: null == (i2 = e2.syntheticException) ? void 0 : i2.stack,
          synthetic: true,
        }
      : e2.apply(r2);
  }
  getUnhandledRejectionReason(t2) {
    try {
      if ("reason" in t2) return t2.reason;
      if (
        "detail" in t2 &&
        null != t2.detail &&
        "object" == typeof t2.detail &&
        "reason" in t2.detail
      )
        return t2.detail.reason;
    } catch (t3) {}
    return t2;
  }
}
var hi = "$message",
  di = "$timestamp",
  vi = /* @__PURE__ */ new Set([hi, di]),
  ci = { enabled: true, max_bytes: 32768 };
function fi(t2) {
  var e2;
  return t2
    ? {
        enabled: null !== (e2 = t2.enabled) && void 0 !== e2 ? e2 : ci.enabled,
        max_bytes: _i(t2.max_bytes, ci.max_bytes),
      }
    : _({}, ci);
}
class pi {
  constructor(t2) {
    ((this.ii = []), (this.ri = 0), (this.qe = fi(t2)));
  }
  setConfig(t2) {
    ((this.qe = fi(t2)), this.ni());
  }
  add(t2) {
    var e2 = (function (t3) {
      var e3;
      try {
        e3 = j(t3);
      } catch (t4) {
        return;
      }
      try {
        var i3 = JSON.parse(e3);
        if (!W(i3)) return;
        var r2 = i3,
          s2 = r2[hi],
          n2 = r2[di];
        if (!J(s2) || 0 === s2.trim().length) return;
        if (!J(n2) && !Z(n2)) return;
        return { step: r2, json: e3 };
      } catch (t4) {
        return;
      }
    })(t2);
    if (e2) {
      var i2 = (function (t3) {
        if ("undefined" != typeof TextEncoder) return new TextEncoder().encode(t3).length;
        for (var e3 = encodeURIComponent(t3), i3 = 0, r2 = 0; e3.length > r2; r2++)
          "%" === e3[r2] ? ((i3 += 1), (r2 += 2)) : (i3 += 1);
        return i3;
      })(e2.json);
      i2 > this.qe.max_bytes ||
        (this.ii.push({ step: e2.step, bytes: i2 }), (this.ri += i2), this.ni());
    }
  }
  getAttachable() {
    return this.ii.map((t2) => t2.step);
  }
  clear() {
    ((this.ii = []), (this.ri = 0));
  }
  size() {
    return this.ii.length;
  }
  ni() {
    for (; this.ri > this.qe.max_bytes && this.ii.length > 0;) {
      var t2 = this.ii.shift();
      t2 && (this.ri -= t2.bytes);
    }
  }
}
function _i(t2, e2) {
  if (!Z(t2) || t2 === 1 / 0 || t2 === -1 / 0) return e2;
  var i2 = Math.floor(t2);
  return 0 > i2 ? e2 : i2;
}
var gi = function (e2, i2) {
    var r2 = (void 0 === i2 ? {} : i2).debugEnabled,
      s2 = {
        k(i3) {
          if (t && (c.DEBUG || t.POSTHOG_DEBUG || r2) && !K(t.console) && t.console) {
            for (
              var s3 =
                  ("__rrweb_original__" in t.console[i3])
                    ? t.console[i3].__rrweb_original__
                    : t.console[i3],
                n2 = arguments.length,
                o2 = new Array(n2 > 1 ? n2 - 1 : 0),
                a2 = 1;
              n2 > a2;
              a2++
            )
              o2[a2 - 1] = arguments[a2];
            s3(e2, ...o2);
          }
        },
        debug() {
          for (var t2 = arguments.length, e3 = new Array(t2), i3 = 0; t2 > i3; i3++)
            e3[i3] = arguments[i3];
          s2.k("debug", ...e3);
        },
        info() {
          for (var t2 = arguments.length, e3 = new Array(t2), i3 = 0; t2 > i3; i3++)
            e3[i3] = arguments[i3];
          s2.k("log", ...e3);
        },
        warn() {
          for (var t2 = arguments.length, e3 = new Array(t2), i3 = 0; t2 > i3; i3++)
            e3[i3] = arguments[i3];
          s2.k("warn", ...e3);
        },
        error() {
          for (var t2 = arguments.length, e3 = new Array(t2), i3 = 0; t2 > i3; i3++)
            e3[i3] = arguments[i3];
          s2.k("error", ...e3);
        },
        critical() {
          for (var t2 = arguments.length, i3 = new Array(t2), r3 = 0; t2 > r3; r3++)
            i3[r3] = arguments[r3];
          console.error(e2, ...i3);
        },
        uninitializedWarning(t2) {
          s2.error("You must initialize PostHog before calling " + t2);
        },
        createLogger: (t2, i3) => gi(e2 + " " + t2, i3),
      };
    return s2;
  },
  mi = gi("[PostHog.js]"),
  yi = mi.createLogger,
  bi = yi("[ExternalScriptsLoader]"),
  wi = (t2) => {
    var e2 = null == r ? void 0 : r.querySelectorAll("script");
    if (e2) {
      for (var i2 = 0; e2.length > i2; i2++) if (e2[i2].src === t2) return e2[i2];
    }
  },
  Ei = (t2, e2, i2) => {
    if (t2.config.disable_external_dependency_loading)
      return (
        bi.warn(e2 + " was requested but loading of external scripts is disabled."),
        i2("Loading of external scripts is disabled")
      );
    var s2 = wi(e2);
    if (s2) {
      if (s2.__posthog_loading_callback_fired) return i2();
      var n2 = s2.__posthog_loading_error;
      return n2
        ? i2(n2)
        : (s2.addEventListener("load", (t3) => {
            ((s2.__posthog_loading_callback_fired = true), i2(void 0, t3));
          }),
          void s2.addEventListener("error", (t3) => {
            ((s2.__posthog_loading_error = t3), i2(t3));
          }));
    }
    var o2 = () => {
      if (!r) return i2("document not found");
      if (wi(e2)) return Ei(t2, e2, i2);
      var s3 = r.createElement("script");
      if (
        ((s3.type = "text/javascript"),
        (s3.crossOrigin = "anonymous"),
        (s3.src = e2),
        (s3.onload = (t3) => {
          ((s3.__posthog_loading_callback_fired = true), i2(void 0, t3));
        }),
        (s3.onerror = (t3) => {
          ((s3.__posthog_loading_error = t3), i2(t3));
        }),
        t2.config.prepare_external_dependency_script &&
          (s3 = t2.config.prepare_external_dependency_script(s3)),
        !s3)
      )
        return i2("prepare_external_dependency_script returned null");
      if ("head" === t2.config.external_scripts_inject_target) r.head.appendChild(s3);
      else {
        var n3,
          o3 = r.querySelectorAll("body > script");
        o3.length > 0
          ? null == (n3 = o3[0].parentNode) || n3.insertBefore(s3, o3[0])
          : r.body.appendChild(s3);
      }
    };
    null != r && r.body ? o2() : null == r || r.addEventListener("DOMContentLoaded", o2);
  },
  xi = {},
  Si = (t2, e2) => {
    var i2 = "/static/" + e2 + ".js?v=" + t2.version;
    if ("toolbar" === e2) {
      var r2 = 3e5;
      i2 = i2 + "&t=" + Math.floor(Date.now() / r2) * r2;
    }
    return t2.requestRouter.endpointFor("assets", i2);
  };
((v.__PosthogExtensions__ = v.__PosthogExtensions__ || {}),
  (v.__PosthogExtensions__.loadExternalDependency = (t2, e2, i2) => {
    if ("remote-config" !== e2) {
      var r2 = t2.config.strict_script_versioning;
      if (r2) {
        var s2 = t2.requestRouter.endpointFor("assets", "/static/" + t2.version + "/" + e2 + ".js"),
          n2 = xi[s2];
        if ("fallback" === r2 && n2) {
          if (wi(n2)) return void Ei(t2, n2, i2);
          delete xi[s2];
        }
        Ei(
          t2,
          s2,
          "fallback" === r2
            ? (r3, n3) => {
                if (r3)
                  if ("string" == typeof r3) i2(r3);
                  else {
                    var o3,
                      a2 = Si(t2, e2);
                    xi[s2] = a2;
                    var l2 = wi(s2);
                    (null == l2 || null == (o3 = l2.parentNode) || o3.removeChild(l2),
                      Ei(t2, a2, i2));
                  }
                else i2(void 0, n3);
              }
            : i2,
        );
      } else Ei(t2, Si(t2, e2), i2);
    } else {
      var o2 = t2.requestRouter.endpointFor("assets", "/array/" + t2.config.token + "/config.js");
      Ei(t2, o2, i2);
    }
  }),
  (v.__PosthogExtensions__.loadSiteApp = (t2, e2, i2) => {
    var r2 = t2.requestRouter.endpointFor("api", e2);
    Ei(t2, r2, i2);
  }));
((c.DEBUG = false), (c.LIB_VERSION = "1.417.3"), (c.LIB_NAME = "web"));
var $i = "$people_distinct_id",
  ki = "$device_id",
  Ti = "$device_model",
  Ri = "__alias",
  Pi = "__timers",
  Oi = "$autocapture_disabled_server_side",
  Ci = "$heatmaps_enabled_server_side",
  Ii = "$exception_capture_enabled_server_side",
  Ai = "$error_tracking_suppression_rules",
  Fi = "$error_tracking_capture_extension_exceptions",
  Mi = "$web_vitals_enabled_server_side",
  Di = "$dead_clicks_enabled_server_side",
  Ni = "$product_tours_enabled_server_side",
  Ui = "$web_vitals_allowed_metrics",
  Li = "$session_recording_remote_config",
  ji = "$replay_sample_rate",
  Bi = "$replay_override_sampling",
  zi = "$replay_override_linked_flag",
  qi = "$replay_override_url_trigger",
  Hi = "$replay_override_event_trigger",
  Vi = "$sesid",
  Wi = "$session_is_sampled",
  Gi = "$enabled_feature_flags",
  Ki = "$active_feature_flags",
  Ji = "$early_access_features",
  Yi = "$feature_flag_details",
  Qi = "$feature_flag_payloads",
  Xi = "$feature_flag_request_id",
  Zi = "$minimal_flag_called_events",
  tr = "$override_feature_flags",
  er = "$override_feature_flag_payloads",
  ir = "$stored_person_properties",
  rr = "$stored_group_properties",
  sr = "$surveys",
  nr = "$surveys_loaded_at",
  or = "$surveys_activated",
  ar = "$surveys_activated_session",
  lr = "$surveys_activated_timestamps",
  ur = "ph_product_tours",
  hr = "$flag_call_reported",
  dr = "$flag_call_reported_session_id",
  vr = "$feature_flag_errors",
  cr = "$feature_flag_evaluated_at",
  fr = "$user_state",
  pr = "$client_session_props",
  _r = "$capture_rate_limit",
  gr = "$initial_campaign_params",
  mr = "$initial_referrer_info",
  yr = "$initial_person_info",
  br = "$epp",
  wr = "$posthog_cookieless",
  Er = "$cookieless_mode",
  xr = "$sdk_debug_extensions_init_method",
  Sr = "$sdk_debug_extensions_init_time_ms",
  $r = "$sdk_debug_recording_script_not_loaded",
  kr = "PostHog loadExternalDependency extension not found.",
  Tr = "on_reject",
  Rr = "always",
  Pr = "anonymous",
  Or = "identified",
  Cr = "identified_only",
  Ir = "visibilitychange",
  Ar = "beforeunload",
  Fr = "$pageview",
  Mr = "$pageleave",
  Dr = "$identify",
  Nr = "$groupidentify";
function Ur(t2, e2) {
  H(t2) && t2.forEach(e2);
}
function Lr(t2, e2) {
  if (!X(t2))
    if (H(t2)) t2.forEach(e2);
    else if (it(t2)) t2.forEach((t3, i3) => e2(t3, i3));
    else for (var i2 in t2) z.call(t2, i2) && e2(t2[i2], i2);
}
var jr = function (t2) {
  for (var e2 = arguments.length, i2 = new Array(e2 > 1 ? e2 - 1 : 0), r2 = 1; e2 > r2; r2++)
    i2[r2 - 1] = arguments[r2];
  for (var s2 of i2) for (var n2 in s2) void 0 !== s2[n2] && (t2[n2] = s2[n2]);
  return t2;
};
function Br(t2) {
  for (var e2 = Object.keys(t2), i2 = e2.length, r2 = new Array(i2); i2--;)
    r2[i2] = [e2[i2], t2[e2[i2]]];
  return r2;
}
var zr = function (t2) {
    try {
      return t2();
    } catch (t3) {
      return;
    }
  },
  qr = function (t2) {
    return function () {
      try {
        for (var e2 = arguments.length, i2 = new Array(e2), r2 = 0; e2 > r2; r2++)
          i2[r2] = arguments[r2];
        return t2.apply(this, i2);
      } catch (t3) {
        (mi.critical(
          "Implementation error. Please turn on debug mode and open a ticket on https://app.posthog.com/home#panel=support%3Asupport%3A.",
        ),
          mi.critical(t3));
      }
    };
  },
  Hr = function (t2) {
    var e2 = {};
    return (
      Lr(t2, function (t3, i2) {
        ((J(t3) && t3.length > 0) || Z(t3)) && (e2[i2] = t3);
      }),
      e2
    );
  };
var Vr = ["herokuapp.com", "vercel.app", "netlify.app"];
function Wr(t2) {
  var e2 = null == t2 ? void 0 : t2.hostname;
  if (!J(e2)) return false;
  var i2 = e2.split(".").slice(-2).join(".");
  for (var r2 of Vr) if (i2 === r2) return false;
  return true;
}
function Gr(t2, e2, i2, r2) {
  var s2 = null != r2 ? r2 : {},
    n2 = s2.capture,
    o2 = s2.passive;
  null == t2 ||
    t2.addEventListener(e2, i2, { capture: void 0 !== n2 && n2, passive: void 0 === o2 || o2 });
}
function Kr(t2) {
  return "ph_toolbar_internal" === t2.name;
}
var Jr = (t2) => {
  if (r) {
    try {
      for (
        var e2 = t2 + "=", i2 = r.cookie.split(";").filter((t3) => t3.length), s2 = 0;
        i2.length > s2;
        s2++
      ) {
        for (var n2 = i2[s2]; " " == n2.charAt(0);) n2 = n2.substring(1, n2.length);
        if (0 === n2.indexOf(e2)) return decodeURIComponent(n2.substring(e2.length, n2.length));
      }
    } catch (t3) {}
    return null;
  }
};
(Math.trunc ||
  (Math.trunc = function (t2) {
    return 0 > t2 ? Math.ceil(t2) : Math.floor(t2);
  }),
  Number.isInteger ||
    (Number.isInteger = function (t2) {
      return Z(t2) && isFinite(t2) && Math.floor(t2) === t2;
    }));
class Yr {
  constructor(t2) {
    if (((this.bytes = t2), 16 !== t2.length)) throw new TypeError("not 128-bit length");
  }
  static fromFieldsV7(t2, e2, i2, r2) {
    if (
      !Number.isInteger(t2) ||
      !Number.isInteger(e2) ||
      !Number.isInteger(i2) ||
      !Number.isInteger(r2) ||
      0 > t2 ||
      0 > e2 ||
      0 > i2 ||
      0 > r2 ||
      t2 > 281474976710655 ||
      e2 > 4095 ||
      i2 > 1073741823 ||
      r2 > 4294967295
    )
      throw new RangeError("invalid field value");
    var s2 = new Uint8Array(16);
    return (
      (s2[0] = t2 / Math.pow(2, 40)),
      (s2[1] = t2 / Math.pow(2, 32)),
      (s2[2] = t2 / Math.pow(2, 24)),
      (s2[3] = t2 / Math.pow(2, 16)),
      (s2[4] = t2 / 256),
      (s2[5] = t2),
      (s2[6] = 112 | (e2 >>> 8)),
      (s2[7] = e2),
      (s2[8] = 128 | (i2 >>> 24)),
      (s2[9] = i2 >>> 16),
      (s2[10] = i2 >>> 8),
      (s2[11] = i2),
      (s2[12] = r2 >>> 24),
      (s2[13] = r2 >>> 16),
      (s2[14] = r2 >>> 8),
      (s2[15] = r2),
      new Yr(s2)
    );
  }
  toString() {
    for (var t2 = "", e2 = 0; this.bytes.length > e2; e2++)
      ((t2 = t2 + (this.bytes[e2] >>> 4).toString(16) + (15 & this.bytes[e2]).toString(16)),
        (3 !== e2 && 5 !== e2 && 7 !== e2 && 9 !== e2) || (t2 += "-"));
    if (36 !== t2.length) throw new Error("Invalid UUIDv7 was generated");
    return t2;
  }
  clone() {
    return new Yr(this.bytes.slice(0));
  }
  equals(t2) {
    return 0 === this.compareTo(t2);
  }
  compareTo(t2) {
    for (var e2 = 0; 16 > e2; e2++) {
      var i2 = this.bytes[e2] - t2.bytes[e2];
      if (0 !== i2) return Math.sign(i2);
    }
    return 0;
  }
}
class Qr {
  generate() {
    var t2 = this.generateOrAbort();
    if (!K(t2)) return t2;
    this.S = 0;
    var e2 = this.generateOrAbort();
    if (K(e2)) throw new Error("Could not generate UUID after timestamp reset");
    return e2;
  }
  generateOrAbort() {
    var t2 = Date.now();
    if (t2 > this.S) ((this.S = t2), this.C());
    else {
      if (this.S >= t2 + 1e4) return;
      (this.I++, this.I > 4398046511103 && (this.S++, this.C()));
    }
    return Yr.fromFieldsV7(
      this.S,
      Math.trunc(this.I / Math.pow(2, 30)),
      this.I & (Math.pow(2, 30) - 1),
      this.A.nextUint32(),
    );
  }
  C() {
    this.I = 1024 * this.A.nextUint32() + (1023 & this.A.nextUint32());
  }
  constructor() {
    ((this.S = 0), (this.I = 0), (this.A = new ts()));
  }
}
var Xr,
  Zr = (t2) => {
    if ("undefined" != typeof UUIDV7_DENY_WEAK_RNG && UUIDV7_DENY_WEAK_RNG)
      throw new Error("no cryptographically strong RNG available");
    for (var e2 = 0; t2.length > e2; e2++)
      t2[e2] = 65536 * Math.trunc(65536 * Math.random()) + Math.trunc(65536 * Math.random());
    return t2;
  };
t && !K(t.crypto) && crypto.getRandomValues && (Zr = (t2) => crypto.getRandomValues(t2));
class ts {
  nextUint32() {
    return (this.R.length > this.O || (Zr(this.R), (this.O = 0)), this.R[this.O++]);
  }
  constructor() {
    ((this.R = new Uint32Array(8)), (this.O = 1 / 0));
  }
}
var es = () => is().toString(),
  is = () => (Xr || (Xr = new Qr())).generate(),
  rs = "",
  ss = /[a-z0-9][a-z0-9-]+\.[a-z]{2,}$/i;
var ns = {
    N: () => !!r,
    j(t2) {
      mi.error("cookieStore error: " + t2);
    },
    P: Jr,
    H(t2) {
      var e2;
      try {
        e2 = JSON.parse(ns.P(t2)) || {};
      } catch (t3) {}
      return e2;
    },
    F(t2, e2, i2, s2, n2) {
      if (!r) return false;
      try {
        var o2 = "",
          a2 = "",
          l2 = (function (t3, e3) {
            if (e3) {
              var i3 = (function (t4, e4) {
                if ((void 0 === e4 && (e4 = r), rs)) return rs;
                if (!e4) return "";
                if (["localhost", "127.0.0.1"].includes(t4)) return "";
                for (
                  var i4 = t4.split("."), s4 = Math.min(i4.length, 8), n3 = "dmn_chk_" + es();
                  !rs && s4--;
                ) {
                  var o3 = i4.slice(s4).join("."),
                    a3 = n3 + "=1;domain=." + o3 + ";path=/";
                  ((e4.cookie = a3 + ";max-age=3"),
                    e4.cookie.includes(n3) && ((e4.cookie = a3 + ";max-age=0"), (rs = o3)));
                }
                return rs;
              })(t3);
              if (!i3) {
                var s3 = ((t4) => {
                  var e4 = t4.match(ss);
                  return e4 ? e4[0] : "";
                })(t3);
                (s3 !== i3 && mi.info("Warning: cookie subdomain discovery mismatch", s3, i3),
                  (i3 = s3));
              }
              return i3 ? "; domain=." + i3 : "";
            }
            return "";
          })(r.location.hostname, s2);
        if (i2) {
          var u2 = /* @__PURE__ */ new Date();
          (u2.setTime(u2.getTime() + 864e5 * i2), (o2 = "; expires=" + u2.toUTCString()));
        }
        n2 && (a2 = "; secure");
        var h2 =
          t2 +
          "=" +
          encodeURIComponent(JSON.stringify(e2)) +
          o2 +
          "; SameSite=Lax; path=/" +
          l2 +
          a2;
        return (
          h2.length > 3686.4 && mi.warn("cookieStore warning: large cookie, len=" + h2.length),
          (r.cookie = h2),
          true
        );
      } catch (t3) {
        return false;
      }
    },
    q(t2, e2) {
      if (null != r && r.cookie)
        try {
          ns.F(t2, "", -1, e2);
        } catch (t3) {
          return;
        }
    },
  },
  os = null,
  as = {
    N() {
      if (!Q(os)) return os;
      var e2 = true;
      if (K(t)) e2 = false;
      else
        try {
          var i2 = "__mplssupport__";
          (as.F(i2, "xyz"), '"xyz"' !== as.P(i2) && (e2 = false), as.q(i2));
        } catch (t2) {
          e2 = false;
        }
      return (
        e2 || mi.error("localStorage unsupported; falling back to cookie store"),
        (os = e2),
        e2
      );
    },
    j(t2) {
      mi.error("localStorage error: " + t2);
    },
    P(e2) {
      try {
        return null == t ? void 0 : t.localStorage.getItem(e2);
      } catch (t2) {
        as.j(t2);
      }
      return null;
    },
    H(t2) {
      try {
        return JSON.parse(as.P(t2)) || {};
      } catch (t3) {}
      return null;
    },
    F(e2, i2) {
      try {
        return (null == t || t.localStorage.setItem(e2, JSON.stringify(i2)), true);
      } catch (t2) {
        as.j(t2);
      }
      return false;
    },
    q(e2) {
      try {
        null == t || t.localStorage.removeItem(e2);
      } catch (t2) {
        as.j(t2);
      }
    },
  },
  ls = [ki, "distinct_id", Vi, Wi, br, yr, fr],
  us = {},
  hs = {
    N: () => true,
    j(t2) {
      mi.error("memoryStorage error: " + t2);
    },
    P: (t2) => us[t2] || null,
    H: (t2) => us[t2] || null,
    F: (t2, e2) => ((us[t2] = e2), true),
    q(t2) {
      delete us[t2];
    },
  },
  ds = null,
  vs = {
    N() {
      if (!Q(ds)) return ds;
      if (((ds = true), K(t))) ds = false;
      else
        try {
          var e2 = "__support__";
          (vs.F(e2, "xyz"), '"xyz"' !== vs.P(e2) && (ds = false), vs.q(e2));
        } catch (t2) {
          ds = false;
        }
      return ds;
    },
    j(t2) {
      mi.error("sessionStorage error: ", t2);
    },
    P(e2) {
      try {
        return null == t ? void 0 : t.sessionStorage.getItem(e2);
      } catch (t2) {
        vs.j(t2);
      }
      return null;
    },
    H(t2) {
      try {
        return JSON.parse(vs.P(t2)) || null;
      } catch (t3) {}
      return null;
    },
    F(e2, i2) {
      try {
        return (null == t || t.sessionStorage.setItem(e2, JSON.stringify(i2)), true);
      } catch (t2) {
        vs.j(t2);
      }
      return false;
    },
    q(e2) {
      try {
        null == t || t.sessionStorage.removeItem(e2);
      } catch (t2) {
        vs.j(t2);
      }
    },
  };
class cs {
  constructor(t2) {
    this._instance = t2;
  }
  get qe() {
    return this._instance.config;
  }
  get consent() {
    return this.si() ? 0 : this.ai;
  }
  isOptedOut() {
    return (
      this.qe.cookieless_mode === Rr ||
      this.isRejected() ||
      (-1 === this.consent && this.qe.cookieless_mode === Tr)
    );
  }
  isOptedIn() {
    return !this.isOptedOut();
  }
  isExplicitlyOptedOut() {
    return 0 === this.consent;
  }
  isRejected() {
    return 0 === this.consent || (-1 === this.consent && this.qe.opt_out_capturing_by_default);
  }
  optInOut(t2) {
    this.oi.F(
      this.li,
      t2 ? 1 : 0,
      this.qe.cookie_expiration,
      this.qe.cross_subdomain_cookie,
      this.qe.secure_cookie,
    );
  }
  reset() {
    this.oi.q(this.li, this.qe.cross_subdomain_cookie);
  }
  get li() {
    var t2 = this._instance.config,
      e2 = t2.token,
      i2 = t2.opt_out_capturing_cookie_prefix;
    return t2.consent_persistence_name || (i2 ? i2 + e2 : "__ph_opt_in_out_" + e2);
  }
  get ai() {
    var t2 = this.oi.P(this.li);
    return dt(t2) ? 1 : N(vt, t2) ? 0 : -1;
  }
  get oi() {
    var t2 = this.qe.opt_out_capturing_persistence_type,
      e2 = "localStorage" === t2 ? as : ns;
    if (!this.ui || this.ui !== e2) {
      this.ui = e2;
      var i2 = "localStorage" === t2 ? ns : as;
      i2.P(this.li) &&
        (this.ui.P(this.li) || this.optInOut(dt(i2.P(this.li))),
        i2.q(this.li, this.qe.cross_subdomain_cookie));
    }
    return this.ui;
  }
  si() {
    return (
      !!this.qe.respect_dnt &&
      [null == i ? void 0 : i.doNotTrack, null == i ? void 0 : i.msDoNotTrack, v.doNotTrack].some(
        (t2) => dt(t2),
      )
    );
  }
}
function fs(t2, e2) {
  var i2,
    r2 = null == t2 || null == (i2 = t2.config) ? void 0 : i2.get_current_url;
  if (!V(r2)) return e2;
  try {
    var s2 = r2(e2);
    return J(s2) && s2 ? s2 : e2;
  } catch (t3) {
    return (mi.error("Error in get_current_url, falling back to window.location.href", t3), e2);
  }
}
var ps = "__POSTHOG_TOOLBAR__",
  _s = 1,
  gs = 3,
  ms = 11;
function ys(t2) {
  return (
    t2 instanceof Element &&
    (t2.id === ps || !(null == t2.closest || !t2.closest(".toolbar-global-fade-container")))
  );
}
function bs(t2) {
  return !!t2 && t2.nodeType === _s;
}
function ws(t2, e2) {
  return !!t2 && !!t2.tagName && t2.tagName.toLowerCase() === e2.toLowerCase();
}
function Es(t2) {
  return !!t2 && t2.nodeType === gs;
}
function xs(t2) {
  return !!t2 && t2.nodeType === ms && bs(t2.host);
}
var Ss = 1e3;
function $s(t2) {
  return t2 ? U(t2).split(/\s+/) : [];
}
function ks(e2, i2) {
  var r2 = (function (e3) {
    var i3,
      r3 = null == t || null == (i3 = t.location) ? void 0 : i3.href;
    return K(r3) ? void 0 : fs(e3, r3);
  })(i2);
  return !!(r2 && e2 && e2.some((t2) => r2.match(t2)));
}
function Ts(t2) {
  var e2 = "";
  switch (typeof t2.className) {
    case "string":
      e2 = t2.className;
      break;
    case "object":
      e2 =
        (t2.className && "baseVal" in t2.className ? t2.className.baseVal : null) ||
        t2.getAttribute("class") ||
        "";
      break;
    default:
      e2 = "";
  }
  return $s(e2);
}
function Rs(t2) {
  return X(t2)
    ? null
    : U(t2)
        .split(/(\s+)/)
        .filter((t3) => Xs(t3))
        .join("")
        .replace(/[\r\n]/g, " ")
        .replace(/[ ]+/g, " ")
        .substring(0, 255);
}
function Ps(t2) {
  var e2 = "";
  return (
    qs(t2) &&
      !Hs(t2) &&
      t2.childNodes &&
      t2.childNodes.length &&
      Lr(t2.childNodes, function (t3) {
        var i2;
        Es(t3) &&
          t3.textContent &&
          (e2 += null !== (i2 = Rs(t3.textContent)) && void 0 !== i2 ? i2 : "");
      }),
    U(e2)
  );
}
function Os(t2) {
  var e2;
  return K(t2.target)
    ? t2.srcElement || null
    : null != (e2 = t2.target) && e2.shadowRoot
      ? t2.composedPath()[0] || null
      : t2.target || null;
}
var Cs = ["a", "button", "form", "input", "select", "textarea", "label"];
function Is(t2, e2) {
  if (K(e2)) return true;
  var i2,
    r2 = function (t3) {
      if (
        e2.some((e3) =>
          (function (t4, e4) {
            var i3 =
              t4.matches ||
              t4.matchesSelector ||
              t4.msMatchesSelector ||
              t4.mozMatchesSelector ||
              t4.webkitMatchesSelector ||
              t4.oMatchesSelector;
            try {
              return !!i3 && i3.call(t4, e4);
            } catch (t5) {
              return false;
            }
          })(t3, e3),
        )
      )
        return { v: true };
    };
  for (var s2 of t2) if ((i2 = r2(s2))) return i2.v;
  return false;
}
function As(t2) {
  var e2 = t2.parentNode;
  return !(!e2 || !bs(e2)) && e2;
}
var Fs = [".ph-no-autocapture", "[data-ph-no-autocapture]"],
  Ms = ["next", "previous", "prev", ">", "<"],
  Ds = [...Ms, "+", "-", "−", "–"],
  Ns = (t2, e2) => (/[a-z0-9]/i.test(e2) ? t2.includes(e2) : t2 === e2),
  Us = [".ph-no-rageclick", ".ph-no-capture"],
  Ls = ["", "text", "search", "email", "password", "url", "tel", "number"];
function js(e2, i2) {
  if (!t || Bs(e2)) return false;
  var r2, s2, n2, o2, a2;
  if (
    (et(i2)
      ? ((r2 = !!i2 && Us), (s2 = void 0), (n2 = false))
      : ((r2 =
          null !== (o2 = null == i2 ? void 0 : i2.css_selector_ignorelist) && void 0 !== o2
            ? o2
            : Us),
        (s2 = null == i2 ? void 0 : i2.content_ignorelist),
        (n2 =
          null !== (a2 = null == i2 ? void 0 : i2.ignore_text_selection) && void 0 !== a2 && a2)),
    false === r2)
  )
    return false;
  if (
    n2 &&
    (function (t2) {
      return (
        !(!t2 || !bs(t2)) &&
        (!!ws(t2, "textarea") ||
          (ws(t2, "input")
            ? N(Ls, (t2.getAttribute("type") || "").toLowerCase())
            : (function (t3) {
                if (t3.isContentEditable) return true;
                var e3 = null == t3.getAttribute ? void 0 : t3.getAttribute("contenteditable");
                return "true" === e3 || "" === e3;
              })(t2)))
      );
    })(e2)
  )
    return false;
  var l2 = zs(e2, false).targetElementList;
  return (
    !(function (t2, e3) {
      if (false === t2 || K(t2)) return false;
      var i3;
      if (true === t2) i3 = Ms;
      else {
        if (!H(t2)) return false;
        if (t2.length > 10)
          return (
            mi.error(
              "[PostHog] content_ignorelist array cannot exceed 10 items. Use css_selector_ignorelist for more complex matching.",
            ),
            false
          );
        i3 = t2.map((t3) => t3.toLowerCase());
      }
      return e3.some((t3) => {
        var e4 = t3.safeText,
          r3 = t3.ariaLabel;
        return i3.some((t4) => Ns(e4, t4) || Ns(r3, t4));
      });
    })(
      s2,
      l2.map((t2) => {
        var e3;
        return {
          safeText: Ps(t2).toLowerCase(),
          ariaLabel:
            (null == (e3 = t2.getAttribute("aria-label")) ? void 0 : e3.toLowerCase().trim()) || "",
        };
      }),
    ) && !Is(l2, r2)
  );
}
var Bs = (t2) => !t2 || ws(t2, "html") || !bs(t2),
  zs = (e2, i2) => {
    if (!t || Bs(e2)) return { parentIsUsefulElement: false, targetElementList: [] };
    for (var r2 = false, s2 = [e2], n2 = e2; n2.parentNode && !ws(n2, "body");)
      if (xs(n2.parentNode)) (s2.push(n2.parentNode.host), (n2 = n2.parentNode.host));
      else {
        var o2 = As(n2);
        if (!o2) break;
        if (i2 || Cs.indexOf(o2.tagName.toLowerCase()) > -1) r2 = true;
        else
          try {
            var a2 = t.getComputedStyle(o2);
            a2 && "pointer" === a2.getPropertyValue("cursor") && (r2 = true);
          } catch (t2) {}
        (s2.push(o2), (n2 = o2));
      }
    return { parentIsUsefulElement: r2, targetElementList: s2 };
  };
function qs(t2) {
  for (
    var e2 = /* @__PURE__ */ new Set(), i2 = 0, r2 = t2;
    r2.parentNode && !ws(r2, "body");
    r2 = r2.parentNode
  ) {
    if (i2++ >= Ss || e2.has(r2)) return false;
    e2.add(r2);
    var s2 = Ts(r2);
    if (N(s2, "ph-sensitive") || N(s2, "ph-no-capture")) return false;
  }
  if (N(Ts(t2), "ph-include")) return true;
  var n2 = t2.type || "";
  if (J(n2))
    switch (n2.toLowerCase()) {
      case "hidden":
      case "password":
        return false;
    }
  var o2 = t2.name || t2.id || "";
  return (
    !J(o2) ||
    !/^cc|cardnum|ccnum|creditcard|csc|cvc|cvv|exp|pass|pwd|routing|seccode|securitycode|securitynum|socialsec|socsec|ssn/i.test(
      o2.replace(/[^a-zA-Z0-9]/g, ""),
    )
  );
}
function Hs(t2) {
  return !!(
    (ws(t2, "input") && !["button", "checkbox", "submit", "reset"].includes(t2.type)) ||
    ws(t2, "select") ||
    ws(t2, "textarea") ||
    "true" === t2.getAttribute("contenteditable")
  );
}
var Vs = new RegExp(
    "^(?:(4[0-9]{12}(?:[0-9]{3})?)|(5[1-5][0-9]{14})|(6(?:011|5[0-9]{2})[0-9]{12})|(3[47][0-9]{13})|(3(?:0[0-5]|[68][0-9])[0-9]{11})|((?:2131|1800|35[0-9]{3})[0-9]{11}))$",
  ),
  Ws = /(^|[^0-9A-Za-z_])([0-9][0-9 -]*[0-9])(?=$|[^0-9A-Za-z_])/g,
  Gs = [16, 15, 14, 13],
  Ks = new RegExp("^(\\d{3}-?\\d{2}-?\\d{4})$"),
  Js = new RegExp(
    "(^|[^0-9])((?!000|666)[0-9]{3}-?(?!00)[0-9]{2}-?(?!0000)[0-9]{4})(?=$|([^0-9]))",
    "g",
  ),
  Ys = /[0-9A-Za-z_]/;
function Qs(t2) {
  for (var e2 = 0, i2 = false, r2 = t2.length - 1; r2 >= 0; r2--) {
    var s2 = t2.charCodeAt(r2) - 48;
    (i2 && (s2 *= 2) > 9 && (s2 -= 9), (e2 += s2), (i2 = !i2));
  }
  return e2 % 10 == 0;
}
function Xs(t2, e2) {
  if ((void 0 === e2 && (e2 = true), X(t2))) return false;
  if (J(t2)) {
    t2 = U(t2);
    var i2 = e2
      ? Vs.test((t2 || "").replace(/[- ]/g, ""))
      : (function (t3) {
          var e3;
          for (Ws.lastIndex = 0; (e3 = Ws.exec(t3));) {
            var i3 = e3[2];
            if (i3)
              for (var r3 = i3.replace(/[- ]/g, ""), s2 = 0; r3.length > s2; s2++)
                for (var n2 of Gs) {
                  var o2 = s2 + n2;
                  if (r3.length >= o2) {
                    var a2 = r3.slice(s2, o2);
                    if (Vs.test(a2) && Qs(a2)) return true;
                  }
                }
          }
          return false;
        })(t2);
    if (i2) return false;
    var r2 = e2
      ? Ks.test(t2)
      : (function (t3) {
          var e3;
          for (Js.lastIndex = 0; (e3 = Js.exec(t3));) {
            var i3 = e3[1],
              r3 = e3[3];
            if (!(i3 && r3 && Ys.test(i3) && Ys.test(r3))) return true;
          }
          return false;
        })(t2);
    if (r2) return false;
  }
  return true;
}
function Zs(t2) {
  var e2 = Ps(t2);
  return Xs((e2 = (e2 + " " + tn(t2)).trim())) ? e2 : "";
}
function tn(t2) {
  var e2 = "";
  return (
    t2 &&
      t2.childNodes &&
      t2.childNodes.length &&
      Lr(t2.childNodes, function (t3) {
        var i2;
        if (t3 && "span" === (null == (i2 = t3.tagName) ? void 0 : i2.toLowerCase()))
          try {
            var r2 = Ps(t3);
            ((e2 = (e2 + " " + r2).trim()),
              t3.childNodes && t3.childNodes.length && (e2 = (e2 + " " + tn(t3)).trim()));
          } catch (t4) {
            mi.error("[AutoCapture]", t4);
          }
      }),
    e2
  );
}
function en(t2) {
  return t2.replace(/"|\\"/g, '\\"');
}
function rn(t2) {
  var e2 = t2.attr__class;
  if (e2) return H(e2) ? e2 : $s(e2);
}
var sn = yi("[Dead Clicks]"),
  nn = () => true,
  on = (t2) => {
    var e2,
      i2 = !(null == (e2 = t2.instance.persistence) || !e2.get_property(Di)),
      r2 = t2.instance.config.capture_dead_clicks;
    return et(r2) ? r2 : !!W(r2) || i2;
  };
class an {
  get lazyLoadedDeadClicksAutocapture() {
    return this.hi;
  }
  constructor(t2, e2, i2) {
    ((this.instance = t2),
      (this.isEnabled = e2),
      (this.onCapture = i2),
      this.startIfEnabledOrStop());
  }
  onRemoteConfig(t2) {
    if (t2.ok) {
      var e2 = t2.config;
      "captureDeadClicks" in e2 &&
        (this.instance.persistence &&
          this.instance.persistence.register({ [Di]: e2.captureDeadClicks }),
        this.startIfEnabledOrStop());
    }
  }
  startIfEnabledOrStop() {
    this.isEnabled(this)
      ? this.di(() => {
          this.vi();
        })
      : this.stop();
  }
  di(t2) {
    var e2, i2;
    null != (e2 = v.__PosthogExtensions__) && e2.initDeadClicksAutocapture
      ? t2()
      : null == (i2 = v.__PosthogExtensions__) ||
        null == i2.loadExternalDependency ||
        i2.loadExternalDependency(this.instance, "dead-clicks-autocapture", (e3) => {
          e3 ? sn.error("failed to load script", e3) : t2();
        });
  }
  vi() {
    var t2;
    if (r) {
      if (!this.hi && null != (t2 = v.__PosthogExtensions__) && t2.initDeadClicksAutocapture) {
        var e2 = W(this.instance.config.capture_dead_clicks)
          ? _({}, this.instance.config.capture_dead_clicks)
          : {};
        ((e2.__onCapture = this.onCapture),
          this.onCapture && (e2.capture_dead_swipes = false),
          (this.hi = v.__PosthogExtensions__.initDeadClicksAutocapture(this.instance, e2)),
          this.hi.start(r),
          sn.info("starting..."));
      }
    } else sn.error("`document` not found. Cannot start.");
  }
  stop() {
    this.hi && (this.hi.stop(), (this.hi = void 0), sn.info("stopping..."));
  }
}
var ln = yi("[SegmentIntegration]");
var un = "posthog-js";
function hn(t2, e2) {
  var i2 = void 0 === e2 ? {} : e2,
    r2 = i2.organization,
    s2 = i2.projectId,
    n2 = i2.prefix,
    o2 = i2.severityAllowList,
    a2 = void 0 === o2 ? ["error"] : o2,
    l2 = i2.sendExceptionsToPostHog,
    u2 = void 0 === l2 || l2;
  return (e3) => {
    var i3, o3, l3, h2, d2;
    if (("*" !== a2 && !a2.includes(e3.level)) || !t2.__loaded) return e3;
    e3.tags || (e3.tags = {});
    var v2 = t2.requestRouter.endpointFor(
      "ui",
      "/project/" + t2.config.token + "/person/" + t2.get_distinct_id(),
    );
    ((e3.tags["PostHog Person URL"] = v2),
      t2.sessionRecordingStarted() &&
        (e3.tags["PostHog Recording URL"] = t2.get_session_replay_url({ withTimestamp: true })));
    var c2,
      f2 = (null == (i3 = e3.exception) ? void 0 : i3.values) || [],
      p2 = f2.map((t3) =>
        _({}, t3, {
          stacktrace: t3.stacktrace
            ? _({}, t3.stacktrace, {
                type: "raw",
                frames: (t3.stacktrace.frames || []).map((t4) =>
                  _({}, t4, { platform: "web:javascript" }),
                ),
              })
            : void 0,
        }),
      ),
      g2 = {
        $exception_message: (null == (o3 = f2[0]) ? void 0 : o3.value) || e3.message,
        $exception_type: null == (l3 = f2[0]) ? void 0 : l3.type,
        $exception_level: e3.level,
        $exception_list: p2,
        $sentry_event_id: e3.event_id,
        $sentry_exception: e3.exception,
        $sentry_exception_message: (null == (h2 = f2[0]) ? void 0 : h2.value) || e3.message,
        $sentry_exception_type: null == (d2 = f2[0]) ? void 0 : d2.type,
        $sentry_tags: e3.tags,
      };
    return (
      r2 &&
        s2 &&
        (g2.$sentry_url =
          (n2 || "https://sentry.io/organizations/") +
          r2 +
          "/issues/?project=" +
          s2 +
          "&query=" +
          e3.event_id),
      u2 && (null == (c2 = t2.exceptions) || c2.sendExceptionEvent(g2)),
      e3
    );
  };
}
class dn {
  constructor(t2, e2, i2, r2, s2, n2) {
    ((this.name = un),
      (this.setupOnce = function (o2) {
        o2(
          hn(t2, {
            organization: e2,
            projectId: i2,
            prefix: r2,
            severityAllowList: s2,
            sendExceptionsToPostHog: null == n2 || n2,
          }),
        );
      }));
  }
}
class vn {
  constructor(t2) {
    ((this.ci = (t3, e2, i2) => {
      i2 &&
        (i2.noSessionId ||
          i2.activityTimeout ||
          i2.sessionPastMaximumLength ||
          i2.crossTabAdoption) &&
        (mi.info("[PageViewManager] Session rotated, clearing pageview state", {
          sessionId: t3,
          changeReason: i2,
        }),
        (this.fi = void 0),
        this._instance.scrollManager.resetContext());
    }),
      (this._instance = t2),
      this.pi());
  }
  pi() {
    var t2;
    this.gi = null == (t2 = this._instance.sessionManager) ? void 0 : t2.onSessionId(this.ci);
  }
  destroy() {
    var t2;
    (null == (t2 = this.gi) || t2.call(this), (this.gi = void 0));
  }
  doPageView(e2, i2) {
    var r2,
      s2 = this.mi(e2, i2);
    return (
      (this.fi = {
        pathname:
          null !== (r2 = null == t ? void 0 : t.location.pathname) && void 0 !== r2 ? r2 : "",
        pageViewId: i2,
        timestamp: e2,
      }),
      this._instance.scrollManager.resetContext(),
      s2
    );
  }
  doPageLeave(t2) {
    var e2;
    return this.mi(t2, null == (e2 = this.fi) ? void 0 : e2.pageViewId);
  }
  doEvent() {
    var t2;
    return { $pageview_id: null == (t2 = this.fi) ? void 0 : t2.pageViewId };
  }
  mi(t2, e2) {
    var i2 = this.fi;
    if (!i2) return { $pageview_id: e2 };
    var r2 = { $pageview_id: e2, $prev_pageview_id: i2.pageViewId },
      s2 = this._instance.scrollManager.getContext();
    if (s2 && !this._instance.config.disable_scroll_properties) {
      var n2 = s2.maxScrollHeight,
        o2 = s2.lastScrollY,
        a2 = s2.maxScrollY,
        l2 = s2.maxContentHeight,
        u2 = s2.lastContentY,
        h2 = s2.maxContentY;
      if (!(K(n2) || K(o2) || K(a2) || K(l2) || K(u2) || K(h2))) {
        ((n2 = Math.ceil(n2)),
          (o2 = Math.ceil(o2)),
          (a2 = Math.ceil(a2)),
          (l2 = Math.ceil(l2)),
          (u2 = Math.ceil(u2)),
          (h2 = Math.ceil(h2)));
        var d2 = n2 > 1 ? ct(o2 / n2, 0, 1, mi) : 1,
          v2 = n2 > 1 ? ct(a2 / n2, 0, 1, mi) : 1,
          c2 = l2 > 1 ? ct(u2 / l2, 0, 1, mi) : 1,
          f2 = l2 > 1 ? ct(h2 / l2, 0, 1, mi) : 1;
        r2 = jr(r2, {
          $prev_pageview_last_scroll: o2,
          $prev_pageview_last_scroll_percentage: d2,
          $prev_pageview_max_scroll: a2,
          $prev_pageview_max_scroll_percentage: v2,
          $prev_pageview_last_content: u2,
          $prev_pageview_last_content_percentage: c2,
          $prev_pageview_max_content: h2,
          $prev_pageview_max_content_percentage: f2,
        });
      }
    }
    return (
      i2.pathname && (r2.$prev_pageview_pathname = i2.pathname),
      i2.timestamp && (r2.$prev_pageview_duration = (t2.getTime() - i2.timestamp.getTime()) / 1e3),
      r2
    );
  }
}
var cn = ["flags", "surveys"],
  fn = {
    [$i]: { exposure: "hidden" },
    [Ri]: { exposure: "hidden" },
    __cmpns: { exposure: "hidden" },
    [Pi]: { exposure: "hidden" },
    [Oi]: { exposure: "event" },
    [Ci]: { exposure: "hidden" },
    [Ii]: { exposure: "event" },
    [Ai]: { exposure: "hidden" },
    [Fi]: { exposure: "event" },
    [Mi]: { exposure: "event" },
    [Di]: { exposure: "event" },
    [Ni]: { exposure: "hidden" },
    [Ui]: { exposure: "event" },
    [Li]: { exposure: "hidden" },
    $session_recording_enabled_server_side: { exposure: "hidden" },
    [Vi]: { exposure: "hidden" },
    [Wi]: { exposure: "event" },
    [ji]: { exposure: "event", shouldSkipFromEventProperties: (t2) => Q(t2) },
    $session_past_minimum_duration: { exposure: "event" },
    $session_recording_url_trigger_activated_session: { exposure: "event" },
    $session_recording_event_trigger_activated_session: { exposure: "event" },
    $debug_first_full_snapshot_timestamp: { exposure: "event" },
    $sess_rec_flush_size: { exposure: "hidden" },
    [Gi]: { exposure: "hidden", storageGroup: "flags" },
    [Ki]: { exposure: "hidden", storageGroup: "flags" },
    [Ji]: { exposure: "hidden" },
    [Yi]: { exposure: "hidden", storageGroup: "flags" },
    [Qi]: { exposure: "hidden", storageGroup: "flags" },
    [Xi]: { exposure: "hidden", storageGroup: "flags", volatile: true },
    [Zi]: { exposure: "hidden", storageGroup: "flags" },
    [tr]: { exposure: "hidden" },
    [er]: { exposure: "hidden" },
    [ir]: { exposure: "hidden" },
    [rr]: { exposure: "hidden" },
    [sr]: { exposure: "hidden", storageGroup: "surveys" },
    [nr]: { exposure: "hidden", storageGroup: "surveys", volatile: true },
    [or]: { exposure: "event" },
    [ar]: { exposure: "hidden" },
    [lr]: { exposure: "hidden" },
    [ur]: { exposure: "hidden" },
    $product_tours_activated: { exposure: "hidden" },
    $product_tours_activated_session: { exposure: "hidden" },
    $conversations_widget_session_id: { exposure: "event" },
    $conversations_ticket_id: { exposure: "event" },
    $conversations_widget_state: { exposure: "event" },
    $conversations_user_traits: { exposure: "event" },
    [hr]: { exposure: "hidden" },
    [dr]: { exposure: "hidden" },
    [vr]: { exposure: "hidden" },
    [cr]: { exposure: "hidden", storageGroup: "flags", volatile: true },
    [fr]: { exposure: "hidden" },
    [pr]: { exposure: "hidden" },
    [_r]: { exposure: "hidden" },
    [gr]: { exposure: "hidden" },
    [mr]: { exposure: "hidden" },
    [yr]: { exposure: "hidden" },
    [br]: { exposure: "hidden" },
    [Bi]: { exposure: "event" },
    [zi]: { exposure: "event" },
    [qi]: { exposure: "event" },
    [Hi]: { exposure: "event" },
    [xr]: { exposure: "event" },
    [Sr]: { exposure: "event" },
    [$r]: { exposure: "event" },
    $sdk_debug_replay_event_trigger_status: { exposure: "event" },
    $sdk_debug_replay_linked_flag_trigger_status: { exposure: "event" },
    $sdk_debug_replay_matched_recording_trigger_groups: { exposure: "event" },
    $sdk_debug_replay_remote_trigger_matching_config: { exposure: "event" },
    $sdk_debug_replay_trigger_groups_count: { exposure: "event" },
    $sdk_debug_replay_url_trigger_status: { exposure: "event" },
    $session_recording_start_reason: { exposure: "event" },
  },
  pn = [
    ["$posthog_sr_group_event_trigger_", { exposure: "hidden" }],
    ["$posthog_sr_group_url_trigger_", { exposure: "hidden" }],
    ["$posthog_sr_group_sampling_", { exposure: "hidden" }],
  ],
  _n = (t2) => {
    var e2 = fn[t2];
    if (e2) return e2;
    for (var i2 of pn) {
      var r2 = i2[1];
      if (0 === t2.indexOf(i2[0])) return r2;
    }
  },
  gn = (t2, e2) => {
    try {
      return JSON.stringify(t2, (t3, e3) => ("bigint" == typeof e3 ? e3.toString() : e3), e2);
    } catch (e3) {
      return j(t2);
    }
  },
  mn = (t2) => {
    var e2 = null == r ? void 0 : r.createElement("a");
    return K(e2) ? null : ((e2.href = t2), e2);
  },
  yn = function (t2, e2) {
    for (
      var i2,
        r2 = ((t2.split("#")[0] || "").split(/\?(.*)/)[1] || "").replace(/^\?+/g, "").split("&"),
        s2 = 0;
      r2.length > s2;
      s2++
    ) {
      var n2 = r2[s2].split("=");
      if (n2[0] === e2) {
        i2 = n2;
        break;
      }
    }
    if (!H(i2) || 2 > i2.length) return "";
    var o2 = i2[1];
    try {
      o2 = decodeURIComponent(o2);
    } catch (t3) {
      mi.error("Skipping decoding for malformed query param: " + o2);
    }
    return o2.replace(/\+/g, " ");
  },
  bn = function (t2, e2, i2) {
    if (!t2 || !e2 || !e2.length) return t2;
    for (
      var r2 = t2.split("#"),
        s2 = r2[1],
        n2 = (r2[0] || "").split("?"),
        o2 = n2[1],
        a2 = n2[0],
        l2 = (o2 || "").split("&"),
        u2 = [],
        h2 = 0;
      l2.length > h2;
      h2++
    ) {
      var d2 = l2[h2].split("=");
      H(d2) && (e2.includes(d2[0]) ? u2.push(d2[0] + "=" + i2) : u2.push(l2[h2]));
    }
    var v2 = a2;
    return (null != o2 && (v2 += "?" + u2.join("&")), null != s2 && (v2 += "#" + s2), v2);
  },
  wn = function (t2, e2) {
    var i2 = t2.match(new RegExp(e2 + "=([^&]*)"));
    return i2 ? i2[1] : null;
  },
  En = (t2, e2) => t2 >= e2 && h(),
  xn = (t2, e2, i2, r2) => {
    if (0 === t2) {
      if (h()) {
        var s2 = e2 + 1;
        return (s2 === i2 && r2(), s2);
      }
      return e2;
    }
    return 0;
  },
  Sn = "https?://(.*)",
  $n = [
    "gclid",
    "gclsrc",
    "dclid",
    "gbraid",
    "wbraid",
    "fbclid",
    "msclkid",
    "twclid",
    "li_fat_id",
    "igshid",
    "ttclid",
    "rdt_cid",
    "epik",
    "qclid",
    "sccid",
    "irclid",
    "_kx",
  ],
  kn = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "gad_source",
    "mc_cid",
    ...$n,
  ],
  Tn = "<masked>",
  Rn = ["li_fat_id"];
function Pn(t2, e2, i2) {
  if (!r) return {};
  var s2,
    n2 = e2 ? [...$n, ...(i2 || [])] : [],
    o2 = On(bn(r.URL, n2, Tn), t2),
    a2 =
      ((s2 = {}),
      Lr(Rn, function (t3) {
        var e3 = Jr(t3);
        s2[t3] = e3 || null;
      }),
      s2);
  return jr(a2, o2);
}
function On(t2, e2) {
  var i2 = kn.concat(e2 || []),
    r2 = {};
  return (
    Lr(i2, function (e3) {
      var i3 = yn(t2, e3);
      r2[e3] = i3 || null;
    }),
    r2
  );
}
function Cn(t2) {
  var e2 = (function (t3) {
      return t3
        ? 0 === t3.search(Sn + "google.([^/?]*)")
          ? "google"
          : 0 === t3.search(Sn + "bing.com")
            ? "bing"
            : 0 === t3.search(Sn + "yahoo.com")
              ? "yahoo"
              : 0 === t3.search(Sn + "duckduckgo.com")
                ? "duckduckgo"
                : null
        : null;
    })(t2),
    i2 = "yahoo" != e2 ? "q" : "p",
    s2 = {};
  if (!Q(e2)) {
    s2.$search_engine = e2;
    var n2 = r ? yn(r.referrer, i2) : "";
    n2.length && (s2.ph_keyword = n2);
  }
  return s2;
}
function In() {
  return navigator.language || navigator.userLanguage;
}
var An = "$direct";
function Fn() {
  return (null == r ? void 0 : r.referrer) || An;
}
function Mn(t2, e2, i2) {
  void 0 === i2 && (i2 = false);
  var r2 = t2 ? [...$n, ...(e2 || [])] : [],
    n2 = i2 ? we(null == s ? void 0 : s.href) : null == s ? void 0 : s.href,
    o2 = null == n2 ? void 0 : n2.substring(0, 1e3);
  return { r: Fn().substring(0, 1e3), u: o2 ? bn(o2, r2, Tn) : void 0 };
}
function Dn(t2, e2) {
  var i2;
  void 0 === e2 && (e2 = false);
  var r2 = t2.r,
    s2 = t2.u,
    n2 = e2 ? we(s2) : s2,
    o2 = {
      $referrer: r2,
      $referring_domain:
        null == r2 ? void 0 : r2 == An ? An : null == (i2 = mn(r2)) ? void 0 : i2.host,
    };
  if (n2) {
    o2.$current_url = n2;
    var a2 = mn(n2);
    ((o2.$host = null == a2 ? void 0 : a2.host),
      (o2.$pathname = null == a2 ? void 0 : a2.pathname));
    var l2 = On(n2);
    jr(o2, l2);
  }
  if (r2) {
    var u2 = Cn(r2);
    jr(o2, u2);
  }
  return o2;
}
function Nn() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (t2) {
    return;
  }
}
function Un() {
  try {
    return /* @__PURE__ */ new Date().getTimezoneOffset();
  } catch (t2) {
    return;
  }
}
var Ln = { flags: cr, surveys: nr },
  jn = ["cookie", "localstorage", "localstorage+cookie", "sessionstorage", "memory"],
  Bn = "main";
class zn {
  constructor(e2, i2, r2) {
    if (
      (void 0 === r2 && (r2 = true),
      (this.yi = {}),
      (this.bi = false),
      (this.wi = false),
      (this.qe = e2),
      (this.ki = r2),
      (this.props = {}),
      (this.xi = void 0),
      (this.Si = ((t2) => {
        var e3 = "";
        return (
          t2.token && (e3 = t2.token.replace(/\+/g, "PL").replace(/\//g, "SL").replace(/=/g, "EQ")),
          t2.persistence_name ? "ph_" + t2.persistence_name : "ph_" + e3 + "_posthog"
        );
      })(e2)),
      (this.oi = this.Ci(e2)),
      (this.wi = this.Mi(e2)),
      this.load(),
      e2.debug && mi.info("Persistence loaded", e2.persistence, _({}, this.props)),
      this.update_config(e2, e2, i2),
      this.save(),
      t)
    ) {
      var s2 = () => this.flush();
      (Gr(t, "beforeunload", s2, { capture: false }), Gr(t, "pagehide", s2, { capture: false }));
    }
  }
  Ti() {
    var t2,
      e2 = null == (t2 = this.qe) ? void 0 : t2.persistence_save_debounce_ms;
    return Z(e2) && e2 > 0 ? e2 : 0;
  }
  isDisabled() {
    return !!this.Ei;
  }
  Ci(e2) {
    -1 === jn.indexOf(e2.persistence.toLowerCase()) &&
      (mi.critical(
        "Unknown persistence type " + e2.persistence + "; falling back to localStorage+cookie",
      ),
      (e2.persistence = "localStorage+cookie"));
    var i2,
      r2 = (function (e3, i3) {
        (void 0 === e3 && (e3 = []), void 0 === i3 && (i3 = false));
        var r3 = [...ls, ...e3];
        return _({}, as, {
          H(t2) {
            try {
              var e4 = {};
              try {
                e4 = ns.H(t2) || {};
              } catch (t3) {}
              var r4,
                s3 = JSON.parse(as.P(t2) || "{}");
              if (i3) {
                var n3 = {};
                for (var o2 in e4) {
                  var a2 = e4[o2];
                  Q(a2) || "" === a2 || (n3[o2] = a2);
                }
                r4 = jr(s3, n3);
              } else r4 = jr(e4, s3);
              return (as.F(t2, r4), r4);
            } catch (t3) {}
            return null;
          },
          F(t2, e4, i4, s3, n3, o2) {
            var a2 = as.F(t2, e4, void 0, void 0, o2);
            try {
              var l2 = {};
              (r3.forEach((t3) => {
                e4[t3] && (l2[t3] = e4[t3]);
              }),
                Object.keys(l2).length && ns.F(t2, l2, i4, s3, n3, o2));
            } catch (t3) {
              as.j(t3);
            }
            return a2;
          },
          q(e4, i4) {
            try {
              (null == t || t.localStorage.removeItem(e4), ns.q(e4, i4));
            } catch (t2) {
              as.j(t2);
            }
          },
        });
      })(e2.cookie_persisted_properties || [], e2.__preview_cookie_wins_on_conflict || false),
      s2 = false,
      n2 = e2.persistence.toLowerCase();
    return (
      "localstorage" === n2 && as.N()
        ? ((i2 = as), (s2 = true))
        : "localstorage+cookie" === n2 && r2.N()
          ? ((i2 = r2), (s2 = true))
          : "sessionstorage" === n2 && vs.N()
            ? (i2 = vs)
            : "memory" === n2
              ? (i2 = hs)
              : "cookie" === n2
                ? (i2 = ns)
                : r2.N()
                  ? ((i2 = r2), (s2 = true))
                  : (i2 = ns),
      (this.bi = s2),
      i2
    );
  }
  Ii(t2) {
    return this.Si + "__" + t2;
  }
  Mi(t2) {
    return this.bi && !!t2.split_storage;
  }
  properties() {
    var t2 = {};
    return (
      Lr(this.props, (e2, i2) => {
        var r2 = _n(i2);
        if (!r2 || "event" === r2.exposure) {
          if (
            null != r2 &&
            null != r2.shouldSkipFromEventProperties &&
            r2.shouldSkipFromEventProperties(e2)
          )
            return;
          t2[i2] = e2;
        }
      }),
      t2
    );
  }
  load() {
    if (!this.Ei) {
      var t2 = this.oi.H(this.Si);
      (t2 && (this.props = jr({}, t2)), this.wi && this.Pi());
    }
  }
  Pi() {
    for (var t2 of cn) {
      var e2 = as.H(this.Ii(t2));
      if (e2 && !G(e2)) {
        var i2 = this.Ri(t2);
        ((i2.persisted = true),
          this.Ai(t2) || (i2.fingerprint = this.Fi(e2, t2)),
          this.Li(t2, e2) || jr(this.props, e2));
      }
    }
  }
  Ai(t2) {
    return Object.keys(this.props).some((e2) => {
      var i2;
      return (null == (i2 = _n(e2)) ? void 0 : i2.storageGroup) === t2;
    });
  }
  Li(t2, e2) {
    var i2 = Ln[t2];
    if (!i2) return false;
    var r2 = e2[i2],
      s2 = this.props[i2];
    return Z(r2) && Z(s2) && s2 > r2;
  }
  refreshKey(t2) {
    var e2;
    if (!this.Ei) {
      var i2 = this.wi ? (null == (e2 = _n(t2)) ? void 0 : e2.storageGroup) : void 0,
        r2 = i2 ? as.H(this.Ii(i2)) : this.oi.H(this.Si);
      if (r2 && t2 in r2) this.Oi(t2, r2[t2]);
      else {
        if (i2) {
          var s2 = this.oi.H(this.Si);
          if (s2 && t2 in s2) return void this.Oi(t2, s2[t2]);
        }
        this.Di(t2);
      }
    }
  }
  save() {
    if (!this.Ei) {
      var t2 = this.Ti();
      t2 > 0
        ? K(this.$i) &&
          (this.$i = setTimeout(() => {
            ((this.$i = void 0), this.Ni());
          }, t2))
        : this.Ni();
    }
  }
  flush() {
    K(this.$i) || (clearTimeout(this.$i), (this.$i = void 0), this.Ni());
  }
  Ni() {
    this.Ei || (this.wi ? this.qi() : this.ji(this.oi, this.Si, this.props, Bn));
  }
  qi() {
    var t2 = this.Bi(),
      e2 = t2.main,
      i2 = t2.groups;
    for (var r2 of (this.ji(this.oi, this.Si, e2, Bn), cn)) {
      var s2,
        n2 = i2[r2];
      (!G(n2) || (null != (s2 = this.yi[r2]) && s2.persisted)) && this.ji(as, this.Ii(r2), n2, r2);
    }
  }
  Bi() {
    var t2 = {},
      e2 = { flags: {}, surveys: {} };
    return (
      Lr(this.props, (i2, r2) => {
        var s2,
          n2 = null == (s2 = _n(r2)) ? void 0 : s2.storageGroup;
        n2 ? (e2[n2][r2] = i2) : (t2[r2] = i2);
      }),
      { main: t2, groups: e2 }
    );
  }
  Fi(t2, e2) {
    if (e2 === Bn) return JSON.stringify(t2) + "|" + this.Hi + "|" + this.Ui + "|" + this.zi;
    var i2 = {};
    return (
      Lr(t2, (t3, e3) => {
        var r2;
        i2[e3] = null != (r2 = _n(e3)) && r2.volatile ? "__volatile__" : t3;
      }),
      JSON.stringify(i2)
    );
  }
  ji(t2, e2, i2, r2) {
    var s2 = this.Ri(r2);
    if (r2 === Bn || s2.dirty || K(s2.fingerprint)) {
      var n2;
      try {
        if ((n2 = this.Fi(i2, r2)) === s2.fingerprint) return void (s2.dirty = false);
      } catch (t3) {
        n2 = void 0;
      }
      t2.F(e2, i2, this.Hi, this.Ui, this.zi, this.qe.debug)
        ? ((s2.dirty = false), r2 !== Bn && (s2.persisted = true), K(n2) || (s2.fingerprint = n2))
        : this.qe.debug &&
          mi.warn('failed to persist storage entry "' + e2 + '"; will retry on next save');
    }
  }
  remove(t2) {
    var e2 = (void 0 === t2 ? {} : t2).keepGroupEntries,
      i2 = void 0 !== e2 && e2;
    if (
      (K(this.$i) || (clearTimeout(this.$i), (this.$i = void 0)),
      this.oi.q(this.Si, false),
      this.oi.q(this.Si, true),
      !i2 && this.ki)
    )
      for (var r2 of cn) as.q(this.Ii(r2));
    i2 ? delete this.yi[Bn] : (this.yi = {});
  }
  clear() {
    (this.remove(), (this.props = {}));
  }
  register_once(t2, e2, i2) {
    if (W(t2)) {
      (K(e2) && (e2 = "None"), (this.Hi = K(i2) ? this.Wi : i2));
      var r2 = false;
      if (
        (Lr(t2, (t3, i3) => {
          (this.props.hasOwnProperty(i3) && this.props[i3] !== e2) ||
            (this.Oi(i3, t3), (r2 = true));
        }),
        r2)
      )
        return (this.save(), true);
    }
    return false;
  }
  register(t2, e2) {
    if (W(t2)) {
      this.Hi = K(e2) ? this.Wi : e2;
      var i2 = false;
      if (
        (Lr(t2, (e3, r2) => {
          t2.hasOwnProperty(r2) &&
            (this.props[r2] !== e3 || W(e3) || H(e3)) &&
            (this.Oi(r2, e3), (i2 = true));
        }),
        i2)
      )
        return (this.save(), true);
    }
    return false;
  }
  unregister(t2) {
    var e2 = "string" == typeof t2 ? [t2] : t2,
      i2 = false;
    for (var r2 of e2) r2 in this.props && (this.Di(r2), (i2 = true));
    i2 && this.save();
  }
  update_campaign_params() {
    var t2 = null == r ? void 0 : r.URL;
    if (t2 !== this.xi) {
      var e2 = Pn(
        this.qe.custom_campaign_params,
        this.qe.mask_personal_data_properties,
        this.qe.custom_personal_data_properties,
      );
      (G(Hr(e2)) || this.register(e2), (this.xi = t2));
    }
  }
  update_search_keyword() {
    var t2;
    this.register((t2 = null == r ? void 0 : r.referrer) ? Cn(t2) : {});
  }
  update_referrer_info() {
    var t2;
    this.register_once(
      {
        $referrer: Fn(),
        $referring_domain:
          (null != r && r.referrer && (null == (t2 = mn(r.referrer)) ? void 0 : t2.host)) || An,
      },
      void 0,
    );
  }
  set_initial_person_info() {
    this.props[gr] ||
      this.props[mr] ||
      this.register_once(
        {
          [yr]: Mn(
            this.qe.mask_personal_data_properties,
            this.qe.custom_personal_data_properties,
            this.qe.disable_capture_url_hashes,
          ),
        },
        void 0,
      );
  }
  get_initial_props() {
    var t2 = {};
    Lr([mr, gr], (e3) => {
      var i3 = this.props[e3];
      i3 &&
        Lr(i3, function (e4, i4) {
          t2["$initial_" + L(i4)] = e4;
        });
    });
    var e2 = this.props[yr];
    if (e2) {
      var i2 = (function (t3, e3) {
        void 0 === e3 && (e3 = false);
        var i3 = Dn(t3, e3),
          r2 = {};
        return (
          Lr(i3, function (t4, e4) {
            r2["$initial_" + L(e4)] = t4;
          }),
          r2
        );
      })(e2, this.qe.disable_capture_url_hashes);
      jr(t2, i2);
    }
    return t2;
  }
  safe_merge(t2) {
    return (
      Lr(this.props, function (e2, i2) {
        i2 in t2 || (t2[i2] = e2);
      }),
      t2
    );
  }
  update_config(t2, e2, i2) {
    ((this.Wi = this.Hi = t2.cookie_expiration),
      this.set_disabled(t2.disable_persistence || !!i2),
      this.set_cross_subdomain(t2.cross_subdomain_cookie),
      this.set_secure(t2.secure_cookie));
    var r2 =
        t2.persistence !== e2.persistence ||
        !((t3, e3) => {
          if (t3.length !== e3.length) return false;
          var i3 = [...t3].sort(),
            r3 = [...e3].sort();
          return i3.every((t4, e4) => t4 === r3[e4]);
        })(t2.cookie_persisted_properties || [], e2.cookie_persisted_properties || []),
      s2 = r2 ? this.Ci(t2) : this.oi,
      n2 = this.Mi(t2);
    if (r2 || n2 !== this.wi) {
      var o2 = this.props;
      (this.clear(), (this.oi = s2), (this.wi = n2), (this.props = o2), this.save());
    }
  }
  set_disabled(t2) {
    ((this.Ei = t2), this.Ei ? this.remove() : this.save());
  }
  set_cross_subdomain(t2) {
    t2 !== this.Ui && ((this.Ui = t2), this.remove({ keepGroupEntries: true }), this.save());
  }
  set_secure(t2) {
    t2 !== this.zi && ((this.zi = t2), this.remove({ keepGroupEntries: true }), this.save());
  }
  set_event_timer(t2, e2) {
    var i2 = this.props[Pi] || {};
    ((i2[t2] = e2), this.Oi(Pi, i2), this.save());
  }
  remove_event_timer(t2) {
    var e2 = this.props[Pi] || {},
      i2 = e2[t2];
    return (K(i2) || (delete e2[t2], this.Oi(Pi, e2), this.save()), i2);
  }
  get_property(t2) {
    return this.props[t2];
  }
  set_property(t2, e2) {
    (this.Oi(t2, e2), this.save());
  }
  Oi(t2, e2) {
    var i2;
    ((this.props[t2] = e2), (null != (i2 = _n(t2)) && i2.volatile) || this.Vi(t2));
  }
  Di(t2) {
    (delete this.props[t2], this.Vi(t2));
  }
  Vi(t2) {
    var e2,
      i2 = null == (e2 = _n(t2)) ? void 0 : e2.storageGroup;
    i2 && (this.Ri(i2).dirty = true);
  }
  Ri(t2) {
    return this.yi[t2] || (this.yi[t2] = {});
  }
}
function qn(t2) {
  var e2 = true;
  return {
    dispose() {
      if (e2) {
        e2 = false;
        var i2 = t2();
        i2 && V(i2.then) && i2.then(void 0, () => {});
      }
    },
  };
}
var Hn = { GZipJS: "gzip-js", Base64: "base64" },
  Vn = { Activation: "events", Cancellation: "cancelEvents" },
  Jn = { Popover: "popover", API: "api", Widget: "widget" },
  Zn = { SHOWN: "survey shown", DISMISSED: "survey dismissed", SENT: "survey sent" },
  to = {
    SURVEY_ID: "$survey_id",
    SURVEY_ITERATION: "$survey_iteration",
    SURVEY_LAST_SEEN_DATE: "$survey_last_seen_date",
  },
  eo = { Popover: "popover", Inline: "inline" },
  ro = { SHOWN: "product tour shown" },
  so = { TOUR_LAST_SEEN_DATE: "$product_tour_last_seen_date", TOUR_TYPE: "$product_tour_type" },
  no = yi("[RateLimiter]");
class oo {
  constructor(t2) {
    ((this.serverLimits = {}),
      (this.lastEventRateLimited = false),
      (this.checkForLimiting = (t3) => {
        var e2 = t3.text;
        if (e2 && e2.length)
          try {
            (JSON.parse(e2).quota_limited || []).forEach((t4) => {
              (no.info((t4 || "events") + " is quota limited."),
                (this.serverLimits[t4] = /* @__PURE__ */ new Date().getTime() + 6e4));
            });
          } catch (t4) {
            return void no.warn(
              'could not rate limit - continuing. Error: "' +
                (null == t4 ? void 0 : t4.message) +
                '"',
              { text: e2 },
            );
          }
      }),
      (this.instance = t2),
      (this.lastEventRateLimited = this.clientRateLimitContext(true).isRateLimited));
  }
  get captureEventsPerSecond() {
    var t2;
    return (
      (null == (t2 = this.instance.config.rate_limiting) ? void 0 : t2.events_per_second) || 10
    );
  }
  get captureEventsBurstLimit() {
    var t2;
    return Math.max(
      (null == (t2 = this.instance.config.rate_limiting) ? void 0 : t2.events_burst_limit) ||
        10 * this.captureEventsPerSecond,
      this.captureEventsPerSecond,
    );
  }
  clientRateLimitContext(t2) {
    var e2, i2, r2;
    void 0 === t2 && (t2 = false);
    var s2 = this.captureEventsBurstLimit,
      n2 = this.captureEventsPerSecond,
      o2 = /* @__PURE__ */ new Date().getTime(),
      a2 =
        null !== (e2 = null == (i2 = this.instance.persistence) ? void 0 : i2.get_property(_r)) &&
        void 0 !== e2
          ? e2
          : { tokens: s2, last: o2 };
    ((a2.tokens += ((o2 - a2.last) / 1e3) * n2),
      (a2.last = o2),
      a2.tokens > s2 && (a2.tokens = s2));
    var l2 = 1 > a2.tokens;
    if ((l2 || t2 || (a2.tokens = Math.max(0, a2.tokens - 1)), l2 && !t2)) {
      var u2 = (Z(a2.dropped) ? a2.dropped : 0) + 1;
      ((a2.dropped = u2), !this.lastEventRateLimited && this.Zi(u2) && (a2.dropped = 0));
    }
    return (
      (this.lastEventRateLimited = l2),
      null == (r2 = this.instance.persistence) || r2.set_property(_r, a2),
      { isRateLimited: l2, remainingTokens: a2.tokens }
    );
  }
  Gi(t2) {
    var e2 = this.instance.config.property_denylist;
    return !H(e2) || !e2.includes(t2);
  }
  Qi() {
    var t2;
    if (this.Gi("$current_url") && this.Gi("$pathname") && null != s && s.pathname)
      return "" + (null !== (t2 = s.origin) && void 0 !== t2 ? t2 : "") + s.pathname;
  }
  Zi(t2) {
    var e2,
      i2,
      r2 = this.captureEventsBurstLimit,
      s2 = this.captureEventsPerSecond,
      n2 = this.Qi(),
      o2 = this.Gi("$session_id")
        ? null == (e2 = (i2 = this.instance).get_session_id)
          ? void 0
          : e2.call(i2)
        : void 0,
      a2 = [
        t2 + " event(s) dropped since the last warning",
        n2 ? "triggered on " + n2 : void 0,
        o2 ? "session " + o2 : void 0,
      ]
        .filter(Boolean)
        .join(", ");
    return !!this.instance.capture(
      "$$client_ingestion_warning",
      {
        $$client_ingestion_warning_message:
          "posthog-js client rate limited: " +
          a2 +
          ". Config is set to " +
          s2 +
          " events per second and " +
          r2 +
          " events burst limit.",
      },
      { skip_client_rate_limiting: true },
    );
  }
  isServerRateLimited(t2) {
    var e2 = this.serverLimits[t2 || "events"] || false;
    return false !== e2 && /* @__PURE__ */ new Date().getTime() < e2;
  }
}
var ao = yi("[RemoteConfig]");
class lo {
  constructor(t2) {
    this._instance = t2;
  }
  get remoteConfig() {
    var t2;
    return null == (t2 = v._POSTHOG_REMOTE_CONFIG) || null == (t2 = t2[this._instance.config.token])
      ? void 0
      : t2.config;
  }
  Ki(t2) {
    var e2, i2;
    null != (e2 = v.__PosthogExtensions__) && e2.loadExternalDependency
      ? null == (i2 = v.__PosthogExtensions__) ||
        null == i2.loadExternalDependency ||
        i2.loadExternalDependency(this._instance, "remote-config", () => t2(this.remoteConfig))
      : t2();
  }
  Ji(t2) {
    this._instance._send_request({
      method: "GET",
      url: this._instance.requestRouter.endpointFor(
        "assets",
        "/array/" + this._instance.config.token + "/config",
      ),
      callback: t2,
    });
  }
  load() {
    try {
      if (this.remoteConfig)
        return (
          ao.info("Using preloaded remote config", this.remoteConfig),
          this.Yi(this.remoteConfig),
          void this.Xi()
        );
      if (this._instance.tr())
        return void ao.warn("Remote config is disabled. Falling back to local config.");
      this.Ki((t2) => {
        if (!t2)
          return (
            ao.info("No config found after loading remote JS config. Falling back to JSON."),
            void this.Ji((t3) => {
              (this.Yi(t3.json, t3), this.Xi());
            })
          );
        (this.Yi(t2), this.Xi());
      });
    } catch (t2) {
      (ao.error("Error loading remote config", t2), this.Yi());
    }
  }
  stop() {
    this.er && (clearInterval(this.er), (this.er = void 0));
  }
  refresh() {
    !this._instance.tr() &&
      r &&
      "hidden" !== r.visibilityState &&
      this._instance.reloadFeatureFlags();
  }
  Xi() {
    var t2;
    if (!this.er) {
      var e2 =
        null !== (t2 = this._instance.config.remote_config_refresh_interval_ms) && void 0 !== t2
          ? t2
          : 3e5;
      0 !== e2 &&
        (this.er = setInterval(() => {
          this.refresh();
        }, e2));
    }
  }
  Yi(t2, e2) {
    !t2 &&
      e2 &&
      (0 === e2.statusCode
        ? e2.error || ao.warn("Failed to fetch remote config from PostHog.")
        : ao.error("Failed to fetch remote config from PostHog."));
    try {
      this._instance.Yi(t2 ? { ok: true, config: t2 } : { ok: false });
    } catch (t3) {
      ao.error("Error applying remote config", t3);
    }
    if (
      false !== (null == t2 ? void 0 : t2.hasFeatureFlags) &&
      !this._instance.config.advanced_disable_feature_flags_on_first_load
    )
      try {
        var i2;
        null == (i2 = this._instance.featureFlags) || i2.ensureFlagsLoaded();
      } catch (t3) {
        ao.error("Error loading feature flags", t3);
      }
  }
}
var ho = Uint8Array,
  vo = Uint16Array,
  co = Uint32Array,
  fo = new ho([
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 0, 0, 0,
  ]),
  po = new ho([
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
    13, 0, 0,
  ]),
  _o = new ho([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]),
  go = function (t2, e2) {
    for (var i2 = new vo(31), r2 = 0; 31 > r2; ++r2) i2[r2] = e2 += 1 << t2[r2 - 1];
    var s2 = new co(i2[30]);
    for (r2 = 1; 30 > r2; ++r2)
      for (var n2 = i2[r2]; i2[r2 + 1] > n2; ++n2) s2[n2] = ((n2 - i2[r2]) << 5) | r2;
    return [i2, s2];
  },
  mo = go(fo, 2),
  yo = mo[1];
((mo[0][28] = 258), (yo[258] = 28));
for (var bo = go(po, 0)[1], wo = new vo(32768), Eo = 0; 32768 > Eo; ++Eo) {
  var xo = ((43690 & Eo) >>> 1) | ((21845 & Eo) << 1);
  wo[Eo] =
    (((65280 &
      (xo =
        ((61680 & (xo = ((52428 & xo) >>> 2) | ((13107 & xo) << 2))) >>> 4) |
        ((3855 & xo) << 4))) >>>
      8) |
      ((255 & xo) << 8)) >>>
    1;
}
var So = function (t2, e2, i2) {
    for (var r2 = t2.length, s2 = 0, n2 = new vo(e2); r2 > s2; ++s2) ++n2[t2[s2] - 1];
    var o2,
      a2 = new vo(e2);
    for (s2 = 0; e2 > s2; ++s2) a2[s2] = (a2[s2 - 1] + n2[s2 - 1]) << 1;
    for (o2 = new vo(r2), s2 = 0; r2 > s2; ++s2) o2[s2] = wo[a2[t2[s2] - 1]++] >>> (15 - t2[s2]);
    return o2;
  },
  $o = new ho(288);
for (Eo = 0; 144 > Eo; ++Eo) $o[Eo] = 8;
for (Eo = 144; 256 > Eo; ++Eo) $o[Eo] = 9;
for (Eo = 256; 280 > Eo; ++Eo) $o[Eo] = 7;
for (Eo = 280; 288 > Eo; ++Eo) $o[Eo] = 8;
var ko = new ho(32);
for (Eo = 0; 32 > Eo; ++Eo) ko[Eo] = 5;
var To = So($o, 9),
  Ro = So(ko, 5),
  Po = function (t2) {
    return ((t2 / 8) >> 0) + (7 & t2 && 1);
  },
  Oo = function (t2, e2, i2) {
    (null == i2 || i2 > t2.length) && (i2 = t2.length);
    var r2 = new (t2 instanceof vo ? vo : t2 instanceof co ? co : ho)(i2 - e2);
    return (r2.set(t2.subarray(e2, i2)), r2);
  },
  Co = function (t2, e2, i2) {
    var r2 = (e2 / 8) >> 0;
    ((t2[r2] |= i2 <<= 7 & e2), (t2[r2 + 1] |= i2 >>> 8));
  },
  Io = function (t2, e2, i2) {
    var r2 = (e2 / 8) >> 0;
    ((t2[r2] |= i2 <<= 7 & e2), (t2[r2 + 1] |= i2 >>> 8), (t2[r2 + 2] |= i2 >>> 16));
  },
  Ao = function (t2, e2) {
    for (var i2 = [], r2 = 0; t2.length > r2; ++r2) t2[r2] && i2.push({ s: r2, f: t2[r2] });
    var s2 = i2.length,
      n2 = i2.slice();
    if (!s2) return [new ho(0), 0];
    if (1 == s2) {
      var o2 = new ho(i2[0].s + 1);
      return ((o2[i2[0].s] = 1), [o2, 1]);
    }
    (i2.sort(function (t3, e3) {
      return t3.f - e3.f;
    }),
      i2.push({ s: -1, f: 25001 }));
    var a2 = i2[0],
      l2 = i2[1],
      u2 = 0,
      h2 = 1,
      d2 = 2;
    for (i2[0] = { s: -1, f: a2.f + l2.f, l: a2, r: l2 }; h2 != s2 - 1;)
      ((a2 = i2[i2[d2].f > i2[u2].f ? u2++ : d2++]),
        (l2 = i2[u2 != h2 && i2[d2].f > i2[u2].f ? u2++ : d2++]),
        (i2[h2++] = { s: -1, f: a2.f + l2.f, l: a2, r: l2 }));
    var v2 = n2[0].s;
    for (r2 = 1; s2 > r2; ++r2) n2[r2].s > v2 && (v2 = n2[r2].s);
    var c2 = new vo(v2 + 1),
      f2 = Fo(i2[h2 - 1], c2, 0);
    if (f2 > e2) {
      r2 = 0;
      var p2 = 0,
        _2 = f2 - e2,
        g2 = 1 << _2;
      for (
        n2.sort(function (t3, e3) {
          return c2[e3.s] - c2[t3.s] || t3.f - e3.f;
        });
        s2 > r2;
        ++r2
      ) {
        var m2 = n2[r2].s;
        if (e2 >= c2[m2]) break;
        ((p2 += g2 - (1 << (f2 - c2[m2]))), (c2[m2] = e2));
      }
      for (p2 >>>= _2; p2 > 0;) {
        var y2 = n2[r2].s;
        e2 > c2[y2] ? (p2 -= 1 << (e2 - c2[y2]++ - 1)) : ++r2;
      }
      for (; r2 >= 0 && p2; --r2) {
        var b2 = n2[r2].s;
        c2[b2] == e2 && (--c2[b2], ++p2);
      }
      f2 = e2;
    }
    return [new ho(c2), f2];
  },
  Fo = function (t2, e2, i2) {
    return -1 == t2.s ? Math.max(Fo(t2.l, e2, i2 + 1), Fo(t2.r, e2, i2 + 1)) : (e2[t2.s] = i2);
  },
  Mo = function (t2) {
    for (var e2 = t2.length; e2 && !t2[--e2];);
    for (
      var i2 = new vo(++e2),
        r2 = 0,
        s2 = t2[0],
        n2 = 1,
        o2 = function (t3) {
          i2[r2++] = t3;
        },
        a2 = 1;
      e2 >= a2;
      ++a2
    )
      if (t2[a2] == s2 && a2 != e2) ++n2;
      else {
        if (!s2 && n2 > 2) {
          for (; n2 > 138; n2 -= 138) o2(32754);
          n2 > 2 && (o2(n2 > 10 ? ((n2 - 11) << 5) | 28690 : ((n2 - 3) << 5) | 12305), (n2 = 0));
        } else if (n2 > 3) {
          for (o2(s2), --n2; n2 > 6; n2 -= 6) o2(8304);
          n2 > 2 && (o2(((n2 - 3) << 5) | 8208), (n2 = 0));
        }
        for (; n2--;) o2(s2);
        ((n2 = 1), (s2 = t2[a2]));
      }
    return [i2.subarray(0, r2), e2];
  },
  Do = function (t2, e2) {
    for (var i2 = 0, r2 = 0; e2.length > r2; ++r2) i2 += t2[r2] * e2[r2];
    return i2;
  },
  No = function (t2, e2, i2) {
    var r2 = i2.length,
      s2 = Po(e2 + 2);
    ((t2[s2] = 255 & r2),
      (t2[s2 + 1] = r2 >>> 8),
      (t2[s2 + 2] = 255 ^ t2[s2]),
      (t2[s2 + 3] = 255 ^ t2[s2 + 1]));
    for (var n2 = 0; r2 > n2; ++n2) t2[s2 + n2 + 4] = i2[n2];
    return 8 * (s2 + 4 + r2);
  },
  Uo = function (t2, e2, i2, r2, s2, n2, o2, a2, l2, u2, h2) {
    (Co(e2, h2++, i2), ++s2[256]);
    for (
      var d2 = Ao(s2, 15),
        v2 = d2[0],
        c2 = d2[1],
        f2 = Ao(n2, 15),
        p2 = f2[0],
        _2 = f2[1],
        g2 = Mo(v2),
        m2 = g2[0],
        y2 = g2[1],
        b2 = Mo(p2),
        w2 = b2[0],
        E2 = b2[1],
        x2 = new vo(19),
        S2 = 0;
      m2.length > S2;
      ++S2
    )
      x2[31 & m2[S2]]++;
    for (S2 = 0; w2.length > S2; ++S2) x2[31 & w2[S2]]++;
    for (var k2 = Ao(x2, 7), T2 = k2[0], R2 = k2[1], P2 = 19; P2 > 4 && !T2[_o[P2 - 1]]; --P2);
    var O2,
      C2,
      I2,
      A2,
      F2 = (u2 + 5) << 3,
      M2 = Do(s2, $o) + Do(n2, ko) + o2,
      D2 =
        Do(s2, v2) +
        Do(n2, p2) +
        o2 +
        14 +
        3 * P2 +
        Do(x2, T2) +
        (2 * x2[16] + 3 * x2[17] + 7 * x2[18]);
    if (M2 >= F2 && D2 >= F2) return No(e2, h2, t2.subarray(l2, l2 + u2));
    if ((Co(e2, h2, 1 + (M2 > D2)), (h2 += 2), M2 > D2)) {
      ((O2 = So(v2, c2)), (C2 = v2), (I2 = So(p2, _2)), (A2 = p2));
      var N2 = So(T2, R2);
      for (
        Co(e2, h2, y2 - 257), Co(e2, h2 + 5, E2 - 1), Co(e2, h2 + 10, P2 - 4), h2 += 14, S2 = 0;
        P2 > S2;
        ++S2
      )
        Co(e2, h2 + 3 * S2, T2[_o[S2]]);
      h2 += 3 * P2;
      for (var U2 = [m2, w2], L2 = 0; 2 > L2; ++L2) {
        var j2 = U2[L2];
        for (S2 = 0; j2.length > S2; ++S2)
          (Co(e2, h2, N2[(B2 = 31 & j2[S2])]),
            (h2 += T2[B2]),
            B2 > 15 && (Co(e2, h2, (j2[S2] >>> 5) & 127), (h2 += j2[S2] >>> 12)));
      }
    } else ((O2 = To), (C2 = $o), (I2 = Ro), (A2 = ko));
    for (S2 = 0; a2 > S2; ++S2)
      if (r2[S2] > 255) {
        var B2;
        (Io(e2, h2, O2[257 + (B2 = (r2[S2] >>> 18) & 31)]),
          (h2 += C2[B2 + 257]),
          B2 > 7 && (Co(e2, h2, (r2[S2] >>> 23) & 31), (h2 += fo[B2])));
        var z2 = 31 & r2[S2];
        (Io(e2, h2, I2[z2]),
          (h2 += A2[z2]),
          z2 > 3 && (Io(e2, h2, (r2[S2] >>> 5) & 8191), (h2 += po[z2])));
      } else (Io(e2, h2, O2[r2[S2]]), (h2 += C2[r2[S2]]));
    return (Io(e2, h2, O2[256]), h2 + C2[256]);
  },
  Lo = new co([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]),
  jo = (function () {
    for (var t2 = new co(256), e2 = 0; 256 > e2; ++e2) {
      for (var i2 = e2, r2 = 9; --r2;) i2 = (1 & i2 && 3988292384) ^ (i2 >>> 1);
      t2[e2] = i2;
    }
    return t2;
  })(),
  Bo = function (t2, e2, i2) {
    for (; i2; ++e2) ((t2[e2] = i2), (i2 >>>= 8));
  };
function zo(t2, e2) {
  void 0 === e2 && (e2 = {});
  var i2 = /* @__PURE__ */ (function () {
      var t3 = 4294967295;
      return {
        p(e3) {
          for (var i3 = t3, r3 = 0; e3.length > r3; ++r3) i3 = jo[(255 & i3) ^ e3[r3]] ^ (i3 >>> 8);
          t3 = i3;
        },
        d() {
          return 4294967295 ^ t3;
        },
      };
    })(),
    r2 = t2.length;
  i2.p(t2);
  var s2,
    n2,
    o2,
    a2,
    l2,
    u2 =
      ((a2 = 10 + (((s2 = e2).filename && s2.filename.length + 1) || 0)),
      (l2 = 8),
      (function (t3, e3, i3, r3, s3, n3) {
        var o3 = t3.length,
          a3 = new ho(r3 + o3 + 5 * (1 + Math.floor(o3 / 7e3)) + s3),
          l3 = a3.subarray(r3, a3.length - s3),
          u3 = 0;
        if (!e3 || 8 > o3)
          for (var h3 = 0; o3 >= h3; h3 += 65535) {
            var d2 = h3 + 65535;
            o3 > d2
              ? (u3 = No(l3, u3, t3.subarray(h3, d2)))
              : ((l3[h3] = true), (u3 = No(l3, u3, t3.subarray(h3, o3))));
          }
        else {
          for (
            var v2 = Lo[e3 - 1],
              c2 = v2 >>> 13,
              f2 = 8191 & v2,
              p2 = (1 << i3) - 1,
              _2 = new vo(32768),
              g2 = new vo(p2 + 1),
              m2 = Math.ceil(i3 / 3),
              y2 = 2 * m2,
              b2 = function (e4) {
                return (t3[e4] ^ (t3[e4 + 1] << m2) ^ (t3[e4 + 2] << y2)) & p2;
              },
              w2 = new co(25e3),
              E2 = new vo(288),
              x2 = new vo(32),
              S2 = 0,
              k2 = 0,
              T2 = ((h3 = 0), 0),
              R2 = 0,
              P2 = 0;
            o3 > h3;
            ++h3
          ) {
            var O2 = b2(h3),
              C2 = 32767 & h3,
              I2 = g2[O2];
            if (((_2[C2] = I2), (g2[O2] = C2), h3 >= R2)) {
              var A2 = o3 - h3;
              if ((S2 > 7e3 || T2 > 24576) && A2 > 423) {
                ((u3 = Uo(t3, l3, 0, w2, E2, x2, k2, T2, P2, h3 - P2, u3)),
                  (T2 = S2 = k2 = 0),
                  (P2 = h3));
                for (var F2 = 0; 286 > F2; ++F2) E2[F2] = 0;
                for (F2 = 0; 30 > F2; ++F2) x2[F2] = 0;
              }
              var M2 = 2,
                D2 = 0,
                N2 = f2,
                U2 = (C2 - I2) & 32767;
              if (A2 > 2 && O2 == b2(h3 - U2))
                for (
                  var L2 = Math.min(c2, A2) - 1, j2 = Math.min(32767, h3), B2 = Math.min(258, A2);
                  j2 >= U2 && --N2 && C2 != I2;
                ) {
                  if (t3[h3 + M2] == t3[h3 + M2 - U2]) {
                    for (var z2 = 0; B2 > z2 && t3[h3 + z2] == t3[h3 + z2 - U2]; ++z2);
                    if (z2 > M2) {
                      if (((M2 = z2), (D2 = U2), z2 > L2)) break;
                      var q2 = Math.min(U2, z2 - 2),
                        H2 = 0;
                      for (F2 = 0; q2 > F2; ++F2) {
                        var V2 = (h3 - U2 + F2 + 32768) & 32767,
                          W2 = (V2 - _2[V2] + 32768) & 32767;
                        W2 > H2 && ((H2 = W2), (I2 = V2));
                      }
                    }
                  }
                  U2 += ((C2 = I2) - (I2 = _2[C2]) + 32768) & 32767;
                }
              if (D2) {
                w2[T2++] = 268435456 | (yo[M2] << 18) | bo[D2];
                var G2 = 31 & yo[M2],
                  K2 = 31 & bo[D2];
                ((k2 += fo[G2] + po[K2]), ++E2[257 + G2], ++x2[K2], (R2 = h3 + M2), ++S2);
              } else ((w2[T2++] = t3[h3]), ++E2[t3[h3]]);
            }
          }
          u3 = Uo(t3, l3, true, w2, E2, x2, k2, T2, P2, h3 - P2, u3);
        }
        return Oo(a3, 0, r3 + Po(u3) + s3);
      })(
        (n2 = t2),
        null == (o2 = e2).level ? 6 : o2.level,
        null == o2.mem
          ? Math.ceil(1.5 * Math.max(8, Math.min(13, Math.log(n2.length))))
          : 12 + o2.mem,
        a2,
        l2,
      )),
    h2 = u2.length;
  return (
    (function (t3, e3) {
      var i3 = e3.filename;
      if (
        ((t3[0] = 31),
        (t3[1] = 139),
        (t3[2] = 8),
        (t3[8] = 2 > e3.level ? 4 : 9 == e3.level ? 2 : 0),
        (t3[9] = 3),
        0 != e3.mtime && Bo(t3, 4, Math.floor(new Date(e3.mtime || Date.now()) / 1e3)),
        i3)
      ) {
        t3[3] = 8;
        for (var r3 = 0; i3.length >= r3; ++r3) t3[r3 + 10] = i3.charCodeAt(r3);
      }
    })(u2, e2),
    Bo(u2, h2 - 8, i2.d()),
    Bo(u2, h2 - 4, r2),
    u2
  );
}
var qo = !!o || !!n,
  Ho = "text/plain",
  Vo = false,
  Wo = (t2, e2) => {
    var i2 = t2.split("#"),
      r2 = i2[1],
      s2 = i2[0].split("?"),
      n2 = s2[0],
      o2 = s2[1];
    if (!o2) return t2;
    var a2 = o2
      .split("&")
      .filter((t3) => t3.split("=")[0] !== e2)
      .join("&");
    return n2 + (a2 ? "?" + a2 : "") + (r2 ? "#" + r2 : "");
  },
  Go = function (t2, e2, i2) {
    var r2;
    void 0 === i2 && (i2 = true);
    var s2 = t2.split("?"),
      n2 = s2[0],
      o2 = s2[1],
      a2 = _({}, e2),
      l2 =
        null !==
          (r2 =
            null == o2
              ? void 0
              : o2.split("&").map((t3) => {
                  var e3,
                    r3 = t3.split("="),
                    s3 = r3[0],
                    n3 = i2 && null !== (e3 = a2[s3]) && void 0 !== e3 ? e3 : r3[1];
                  return (delete a2[s3], s3 + "=" + n3);
                })) && void 0 !== r2
          ? r2
          : [],
      u2 = (function (t3, e3) {
        var i3, r3;
        void 0 === e3 && (e3 = "&");
        var s3 = [];
        return (
          Lr(t3, function (t4, e4) {
            K(t4) ||
              K(e4) ||
              "undefined" === e4 ||
              ((i3 = encodeURIComponent(
                ((t5) => t5 instanceof File)(t4) ? t4.name : t4.toString(),
              )),
              (r3 = encodeURIComponent(e4)),
              (s3[s3.length] = r3 + "=" + i3));
          }),
          s3.join(e3)
        );
      })(a2);
    return (u2 && l2.push(u2), l2.length > 0 ? n2 + "?" + l2.join("&") : n2);
  },
  Ko = (t2) => {
    if (t2.ir) return t2.ir;
    var e2 = t2.data,
      i2 = t2.compression;
    if (e2) {
      if (i2 === Hn.GZipJS) {
        var r2 = zo(
          (function (t3, e3) {
            var i3 = t3.length;
            if ("undefined" != typeof TextEncoder) return new TextEncoder().encode(t3);
            for (
              var r3 = new ho(t3.length + (t3.length >>> 1)),
                s3 = 0,
                n3 = function (t4) {
                  r3[s3++] = t4;
                },
                o3 = 0;
              i3 > o3;
              ++o3
            ) {
              if (s3 + 5 > r3.length) {
                var a2 = new ho(s3 + 8 + ((i3 - o3) << 1));
                (a2.set(r3), (r3 = a2));
              }
              var l2 = t3.charCodeAt(o3);
              128 > l2
                ? n3(l2)
                : 2048 > l2
                  ? (n3(192 | (l2 >>> 6)), n3(128 | (63 & l2)))
                  : l2 > 55295 && 57344 > l2
                    ? (n3(
                        240 |
                          ((l2 = (65536 + (1047552 & l2)) | (1023 & t3.charCodeAt(++o3))) >>> 18),
                      ),
                      n3(128 | ((l2 >>> 12) & 63)),
                      n3(128 | ((l2 >>> 6) & 63)),
                      n3(128 | (63 & l2)))
                    : (n3(224 | (l2 >>> 12)), n3(128 | ((l2 >>> 6) & 63)), n3(128 | (63 & l2)));
            }
            return Oo(r3, 0, s3);
          })(gn(e2)),
          { mtime: 0 },
        );
        return {
          contentType: Ho,
          body: r2.buffer.slice(r2.byteOffset, r2.byteOffset + r2.byteLength),
          estimatedSize: r2.byteLength,
        };
      }
      if (i2 === Hn.Base64) {
        var s2 = (function (t3) {
            return t3
              ? btoa(
                  encodeURIComponent(t3).replace(/%([0-9A-F]{2})/g, (t4, e3) =>
                    String.fromCharCode(parseInt(e3, 16)),
                  ),
                )
              : t3;
          })(gn(e2)),
          n2 = ((t3) => "data=" + encodeURIComponent("string" == typeof t3 ? t3 : gn(t3)))(s2);
        return {
          contentType: "application/x-www-form-urlencoded",
          body: n2,
          estimatedSize: new Blob([n2]).size,
        };
      }
      var o2 = gn(e2);
      return { contentType: "application/json", body: o2, estimatedSize: new Blob([o2]).size };
    }
  },
  Jo = (t2) => {
    var e2,
      i2,
      r2 = () =>
        "sendBeacon" === t2.transport
          ? {
              url: Go(t2.url, { compression: Hn.Base64 }),
              encodedBody: Ko(_({}, t2, { compression: Hn.Base64, ir: void 0 })),
            }
          : {
              url: Wo(t2.url, "compression"),
              encodedBody: Ko(_({}, t2, { compression: void 0, ir: void 0 })),
            };
    try {
      e2 = Ko(t2);
    } catch (e3) {
      if (O(t2.compression, yn(t2.url, "compression")))
        return (mi.error("Failed to gzip request body, sending uncompressed payload", e3), r2());
      throw e3;
    }
    return e2 &&
      O(t2.compression, yn(t2.url, "compression")) &&
      !((i2 = e2.body) instanceof ArrayBuffer
        ? P(new Uint8Array(i2))
        : ArrayBuffer.isView(i2) && P(new Uint8Array(i2.buffer, i2.byteOffset, i2.byteLength)))
      ? ((Vo = true), r2())
      : { url: t2.url, encodedBody: e2 };
  },
  Yo = (t2) => {
    try {
      return Jo(t2);
    } catch (e2) {
      return (
        mi.error(e2),
        void (null == t2.callback || t2.callback({ statusCode: 0, error: e2 }))
      );
    }
  },
  Qo = (function () {
    var t2 = p(function* (t3) {
      var e2 = gn(t3.data),
        i2 = yield (function (t4, e3, i3) {
          return F.apply(this, arguments);
        })(e2, c.DEBUG, { rethrow: true });
      if (!i2) return t3;
      var r2 = yield i2.arrayBuffer();
      return _({}, t3, { ir: { contentType: Ho, body: r2, estimatedSize: r2.byteLength } });
    });
    return function (e2) {
      return t2.apply(this, arguments);
    };
  })(),
  Xo = /Failed to fetch|NetworkError|Load failed/i,
  Zo = (t2) =>
    "TypeError" === (null == t2 ? void 0 : t2.name) &&
    Xo.test((null == t2 ? void 0 : t2.message) || ""),
  ta = (t2) => {
    var e2 = Yo(t2);
    if (e2) {
      var i2 = e2.url,
        r2 = e2.encodedBody,
        s2 = null != r2 ? r2 : {},
        o2 = s2.contentType,
        l2 = s2.body,
        u2 = s2.estimatedSize,
        h2 = new Headers();
      (Lr(t2.headers, function (t3, e3) {
        h2.append(e3, t3);
      }),
        o2 && h2.append("Content-Type", o2));
      var d2 = null,
        v2 = false;
      if (a) {
        var c2 = new a();
        d2 = {
          signal: c2.signal,
          timeout: setTimeout(() => {
            var e3, i3;
            ((v2 = true),
              c2.abort(
                ((e3 = t2.timeout),
                ((i3 = new Error(
                  "PostHog request timed out" + (e3 ? " after " + e3 + "ms" : ""),
                )).name = "AbortError"),
                i3),
              ));
          }, t2.timeout),
        };
      }
      var f2 = (e3) => {
        ((v2 && "AbortError" === (null == e3 ? void 0 : e3.name)) || Zo(e3)
          ? mi.warn(e3)
          : mi.error(e3),
          null == t2.callback || t2.callback({ statusCode: 0, error: e3 }));
      };
      try {
        var p2;
        n(
          i2,
          _(
            {
              method: (null == t2 ? void 0 : t2.method) || "GET",
              headers: h2,
              keepalive: "POST" === t2.method && !t2.rr && 52428.8 > (u2 || 0),
              body: l2,
              signal: null == (p2 = d2) ? void 0 : p2.signal,
            },
            t2.fetchOptions,
          ),
        )
          .then((e3) =>
            e3.text().then((i3) => {
              var r3 = { statusCode: e3.status, text: i3 };
              if (200 === e3.status)
                try {
                  r3.json = JSON.parse(i3);
                } catch (t3) {
                  mi.error(t3);
                }
              null == t2.callback || t2.callback(r3);
            }),
          )
          .catch(f2)
          .finally(() => (d2 ? clearTimeout(d2.timeout) : null));
      } catch (t3) {
        (d2 && clearTimeout(d2.timeout), f2(t3));
      }
    }
  },
  ea = (t2) => {
    try {
      var e2,
        r2 = Jo(t2),
        s2 = r2.url,
        n2 = r2.encodedBody,
        o2 = null != n2 ? n2 : {},
        a2 = o2.body,
        l2 = o2.estimatedSize;
      if (!a2) return;
      var u2 = a2 instanceof Blob ? a2 : new Blob([a2], { type: o2.contentType });
      if (i.sendBeacon(s2, u2)) return;
      var h2 = H(t2.data) ? t2.data : null == (e2 = t2.data) ? void 0 : e2.batch;
      if (H(h2) && h2.length > 1 && (null != l2 ? l2 : 0) > 16384) {
        var d2 = Math.ceil(h2.length / 2),
          v2 = (e3) => (H(t2.data) ? e3 : _({}, t2.data, { batch: e3 }));
        return (
          ea(_({}, t2, { data: v2(h2.slice(0, d2)) })),
          void ea(_({}, t2, { data: v2(h2.slice(d2)) }))
        );
      }
      (mi.warn(
        "Beacon of ~" +
          (null != l2 ? l2 : 0) +
          " bytes was rejected by the browser, falling back to fetch",
      ),
        ta(_({}, t2, { rr: true })));
    } catch (t3) {
      mi.warn("Beacon send failed", t3);
    }
  },
  ia = (t2, e2, i2, r2) => {
    var s2 = "query" === r2 ? ("POST" === e2 ? "sent_at" : "_") : void 0;
    return Go(
      i2 === Hn.GZipJS ? Wo(t2, "compression") : t2,
      _({}, s2 ? { [s2]: Date.now().toString() } : {}, i2 === Hn.GZipJS ? {} : { compression: i2 }),
    );
  },
  ra = [];
(n && ra.push({ transport: "fetch", method: ta }),
  o &&
    ra.push({
      transport: "XHR",
      method(t2) {
        var e2 = Yo(t2);
        if (e2) {
          var i2 = new o(),
            r2 = e2.encodedBody;
          i2.open(t2.method || "GET", e2.url, true);
          var s2 = null != r2 ? r2 : {},
            n2 = s2.contentType,
            a2 = s2.body;
          (Lr(t2.headers, function (t3, e3) {
            i2.setRequestHeader(e3, t3);
          }),
            n2 && i2.setRequestHeader("Content-Type", n2),
            t2.timeout && (i2.timeout = t2.timeout),
            (i2.onreadystatechange = () => {
              if (4 === i2.readyState) {
                var e3 = { statusCode: i2.status, text: i2.responseText };
                if (200 === i2.status)
                  try {
                    e3.json = JSON.parse(i2.responseText);
                  } catch (t3) {}
                null == t2.callback || t2.callback(e3);
              }
            }),
            i2.send(a2));
        }
      },
    }),
  null != i && i.sendBeacon && ra.push({ transport: "sendBeacon", method: ea }));
var sa = 3e3;
class na {
  constructor(t2, e2) {
    ((this.nr = true),
      (this.sr = []),
      (this.ar = ct(
        (null == e2 ? void 0 : e2.flush_interval_ms) || sa,
        250,
        5e3,
        mi.createLogger("flush interval"),
        sa,
      )),
      (this.lr = t2));
  }
  enqueue(t2) {
    (this.sr.push(t2), this.ur || this.hr());
  }
  unload() {
    this.dr();
    var t2 = this.sr.length > 0 ? this.vr() : {},
      e2 = Object.values(t2);
    [
      ...e2.filter((t3) => 0 === t3.url.indexOf("/e")),
      ...e2.filter((t3) => 0 !== t3.url.indexOf("/e")),
    ].map((t3) => {
      this.cr(_({}, t3, { transport: "sendBeacon" }));
    });
  }
  enable() {
    ((this.nr = false), this.hr());
  }
  hr() {
    var t2 = this;
    this.nr ||
      (this.ur = setTimeout(() => {
        if ((this.dr(), this.sr.length > 0)) {
          var e2 = this.vr(),
            i2 = function () {
              var i3 = e2[r2],
                s2 = /* @__PURE__ */ new Date().getTime();
              (i3.data &&
                H(i3.data) &&
                Lr(i3.data, (t3) => {
                  ((t3.offset = Math.abs(t3.timestamp - s2)), delete t3.timestamp);
                }),
                t2.cr(i3));
            };
          for (var r2 in e2) i2();
        }
      }, this.ar));
  }
  cr(t2) {
    try {
      this.lr(t2);
    } catch (t3) {
      mi.error(t3);
    }
  }
  dr() {
    (clearTimeout(this.ur), (this.ur = void 0));
  }
  vr() {
    var t2 = {};
    return (
      Lr(this.sr, (e2) => {
        var i2,
          r2 = e2,
          s2 = (r2 ? r2.batchKey : null) || r2.url;
        (K(t2[s2]) && (t2[s2] = _({}, r2, { data: [] })),
          null == (i2 = t2[s2].data) || i2.push(r2.data));
      }),
      (this.sr = []),
      t2
    );
  }
}
var oa = ["retriesPerformedSoFar"];
class aa {
  constructor(e2) {
    ((this.pr = false),
      (this.gr = 3e3),
      (this.sr = []),
      (this._instance = e2),
      (this.sr = []),
      (this.mr = true),
      !K(t) &&
        "onLine" in t.navigator &&
        ((this.mr = t.navigator.onLine),
        (this.yr = () => {
          ((this.mr = true), this.br());
        }),
        (this._r = () => {
          this.mr = false;
        }),
        Gr(t, "online", this.yr),
        Gr(t, "offline", this._r)));
  }
  get length() {
    return this.sr.length;
  }
  retriableRequest(t2) {
    var e2 = t2.retriesPerformedSoFar,
      i2 = g(t2, oa);
    (tt(e2) && (i2.url = Go(i2.url, { retry_count: e2 })),
      this._instance._send_request(
        _({}, i2, {
          callback: (t3) => {
            if (200 !== t3.statusCode && (400 > t3.statusCode || t3.statusCode >= 500)) {
              if ((0 === t3.statusCode ? 3 : 10) > (null != e2 ? e2 : 0))
                return void this.Lt(_({ retriesPerformedSoFar: e2 }, i2));
              0 === t3.statusCode &&
                mi.warn(
                  "Request failed before receiving an HTTP response; this can happen due to network issues, CORS, browser blocking, or ad blockers. Stopped retrying after " +
                    (null != e2 ? e2 : 0) +
                    " retries.",
                );
            }
            null == i2.callback || i2.callback(t3);
          },
        }),
      ));
  }
  Lt(t2) {
    var e2 = t2.retriesPerformedSoFar || 0;
    t2.retriesPerformedSoFar = e2 + 1;
    var i2 = (function (t3) {
        var e3 = 3e3 * Math.pow(2, t3),
          i3 = e3 / 2,
          r3 = Math.min(18e5, e3),
          s3 = Math.random() - 0.5;
        return Math.ceil(r3 + s3 * (r3 - i3));
      })(e2),
      r2 = Date.now() + i2;
    this.sr.push({ retryAt: r2, requestOptions: t2 });
    var s2 = "Enqueued failed request for retry in " + i2;
    (navigator.onLine || (s2 += " (Browser is offline)"),
      mi.warn(s2),
      this.pr || ((this.pr = true), this.wr()));
  }
  wr() {
    if ((this.kr && clearTimeout(this.kr), 0 === this.sr.length))
      return ((this.pr = false), void (this.kr = void 0));
    this.kr = setTimeout(() => {
      (this.mr && this.sr.length > 0 && this.br(), this.wr());
    }, this.gr);
  }
  br() {
    var t2 = Date.now(),
      e2 = [],
      i2 = this.sr.filter((i3) => t2 > i3.retryAt || (e2.push(i3), false));
    if (((this.sr = e2), i2.length > 0))
      for (var r2 of i2) this.retriableRequest(r2.requestOptions);
  }
  unload() {
    for (var e2 of (this.kr && (clearTimeout(this.kr), (this.kr = void 0)),
    (this.pr = false),
    K(t) ||
      (this.yr && (t.removeEventListener("online", this.yr), (this.yr = void 0)),
      this._r && (t.removeEventListener("offline", this._r), (this._r = void 0))),
    this.sr)) {
      var i2 = e2.requestOptions;
      try {
        this._instance._send_request(_({}, i2, { transport: "sendBeacon" }));
      } catch (t2) {
        mi.error(t2);
      }
    }
    this.sr = [];
  }
}
class la {
  constructor(t2) {
    ((this.Sr = () => {
      var t3, e2, i2, r2;
      this.Cr || (this.Cr = {});
      var s2 = this.scrollElement(),
        n2 = this.scrollY(),
        o2 = s2 ? Math.max(0, s2.scrollHeight - s2.clientHeight) : 0,
        a2 = n2 + ((null == s2 ? void 0 : s2.clientHeight) || 0),
        l2 = (null == s2 ? void 0 : s2.scrollHeight) || 0;
      ((this.Cr.lastScrollY = Math.ceil(n2)),
        (this.Cr.maxScrollY = Math.max(
          n2,
          null !== (t3 = this.Cr.maxScrollY) && void 0 !== t3 ? t3 : 0,
        )),
        (this.Cr.maxScrollHeight = Math.max(
          o2,
          null !== (e2 = this.Cr.maxScrollHeight) && void 0 !== e2 ? e2 : 0,
        )),
        (this.Cr.lastContentY = a2),
        (this.Cr.maxContentY = Math.max(
          a2,
          null !== (i2 = this.Cr.maxContentY) && void 0 !== i2 ? i2 : 0,
        )),
        (this.Cr.maxContentHeight = Math.max(
          l2,
          null !== (r2 = this.Cr.maxContentHeight) && void 0 !== r2 ? r2 : 0,
        )));
    }),
      (this._instance = t2));
  }
  get Mr() {
    return this._instance.config.scroll_root_selector;
  }
  getContext() {
    return this.Cr;
  }
  resetContext() {
    var t2 = this.Cr;
    return (setTimeout(this.Sr, 0), t2);
  }
  startMeasuringScrollPosition() {
    (Gr(t, "scroll", this.Sr, { capture: true }),
      Gr(t, "scrollend", this.Sr, { capture: true }),
      Gr(t, "resize", this.Sr));
  }
  scrollElement() {
    if (!this.Mr) return null == t ? void 0 : t.document.documentElement;
    var e2 = H(this.Mr) ? this.Mr : [this.Mr];
    for (var i2 of e2) {
      var r2 = null == t ? void 0 : t.document.querySelector(i2);
      if (r2) return r2;
    }
  }
  Tr(e2) {
    var i2 = "y" === e2 ? "scrollTop" : "scrollLeft";
    if (this.Mr) {
      var r2 = this.scrollElement();
      return (r2 && r2[i2]) || 0;
    }
    return t
      ? "y" === e2
        ? t.scrollY || t.pageYOffset || t.document.documentElement.scrollTop || 0
        : t.scrollX || t.pageXOffset || t.document.documentElement.scrollLeft || 0
      : 0;
  }
  scrollY() {
    return this.Tr("y");
  }
  scrollX() {
    return this.Tr("x");
  }
}
var ua = (t2) =>
  Mn(
    null == t2 ? void 0 : t2.config.mask_personal_data_properties,
    null == t2 ? void 0 : t2.config.custom_personal_data_properties,
    null == t2 ? void 0 : t2.config.disable_capture_url_hashes,
  );
class ha {
  constructor(t2, e2, i2, r2) {
    ((this.Er = (t3) => {
      var e3 = this.Ir();
      if (!e3 || e3.sessionId !== t3) {
        var i3 = { sessionId: t3, props: this.Pr(this._instance) };
        this.Rr.register({ [pr]: i3 });
      }
    }),
      (this._instance = t2),
      (this.Ar = e2),
      (this.Rr = i2),
      (this.Pr = r2 || ua),
      this.Ar.onSessionId(this.Er));
  }
  Ir() {
    return this.Rr.props[pr];
  }
  getSetOnceProps() {
    var t2,
      e2 = null == (t2 = this.Ir()) ? void 0 : t2.props;
    return e2
      ? "r" in e2
        ? Dn(e2, this._instance.config.disable_capture_url_hashes)
        : {
            $referring_domain: e2.referringDomain,
            $pathname: e2.initialPathName,
            utm_source: e2.utm_source,
            utm_campaign: e2.utm_campaign,
            utm_medium: e2.utm_medium,
            utm_content: e2.utm_content,
            utm_term: e2.utm_term,
          }
      : {};
  }
  getSessionProps() {
    var t2 = {};
    return (
      Lr(Hr(this.getSetOnceProps()), (e2, i2) => {
        ("$current_url" === i2 && (i2 = "url"), (t2["$session_entry_" + L(i2)] = e2));
      }),
      t2
    );
  }
}
class da {
  on(t2, e2) {
    return (
      this.Fr[t2] || (this.Fr[t2] = []),
      this.Fr[t2].push(e2),
      () => {
        this.Fr[t2] = this.Fr[t2].filter((t3) => t3 !== e2);
      }
    );
  }
  emit(t2, e2) {
    for (var i2 of this.Fr[t2] || []) i2(e2);
    for (var r2 of this.Fr["*"] || []) r2(t2, e2);
  }
  constructor() {
    this.Fr = {};
  }
}
var va = yi("[SessionId]"),
  ca = 864e5;
class fa {
  on(t2, e2) {
    return this.Lr.on(t2, e2);
  }
  constructor(t2, e2, i2) {
    var r2;
    if (
      ((this.Or = null),
      (this.Dr = []),
      (this.$r = void 0),
      (this.Nr = false),
      (this.Lr = new da()),
      (this.qr = (t3, e3) => !(!tt(t3) || !tt(e3)) && Math.abs(t3 - e3) > this.sessionTimeoutMs),
      !t2.persistence)
    )
      throw new Error("SessionIdManager requires a PostHogPersistence instance");
    if (t2.config.cookieless_mode === Rr)
      throw new Error('SessionIdManager cannot be used with cookieless_mode="always"');
    ((this.qe = t2.config),
      (this.Rr = t2.persistence),
      (this.jr = void 0),
      (this.Br = void 0),
      (this._sessionStartTimestamp = null),
      (this.Hr = void 0),
      (this._sessionActivityTimestamp = null),
      (this.Ur = e2 || es),
      (this.zr = i2 || es));
    var s2 = this.qe.persistence_name || this.qe.token;
    if (
      ((this._sessionTimeoutMs =
        1e3 *
        ct(
          this.qe.session_idle_timeout_seconds || 1800,
          60,
          36e3,
          va.createLogger("session_idle_timeout_seconds"),
          1800,
        )),
      t2.register({ $configured_session_timeout_ms: this._sessionTimeoutMs }),
      this.Wr(),
      (this.Vr = "ph_" + s2 + "_window_id"),
      (this.Zr = "ph_" + s2 + "_primary_window_exists"),
      this.Gr())
    ) {
      var n2 = vs.H(this.Vr),
        o2 = vs.H(this.Zr);
      (n2 && !o2 ? (this.jr = n2) : vs.q(this.Vr), vs.F(this.Zr, true));
    }
    (null != (r2 = this.qe.bootstrap) &&
      r2.sessionID &&
      this.setBootstrapSessionId(this.qe.bootstrap.sessionID),
      this.Qr());
  }
  get sessionTimeoutMs() {
    return this._sessionTimeoutMs;
  }
  onSessionId(t2) {
    return (
      K(this.Dr) && (this.Dr = []),
      this.Dr.push(t2),
      this.Br && t2(this.Br, this.jr),
      () => {
        this.Dr = this.Dr.filter((e2) => e2 !== t2);
      }
    );
  }
  Gr() {
    return "memory" !== this.qe.persistence && !this.Rr.Ei && vs.N();
  }
  Kr(t2) {
    t2 !== this.jr && ((this.jr = t2), this.Gr() && vs.F(this.Vr, t2));
  }
  Jr() {
    return this.jr ? this.jr : this.Gr() ? vs.H(this.Vr) : null;
  }
  Yr(t2) {
    var e2 = this.Or;
    return !Q(e2) && !Q(t2) && 5e3 > Math.abs(t2 - e2);
  }
  Xr(t2, e2, i2) {
    var r2 = e2 !== this._sessionActivityTimestamp,
      s2 = !(t2 !== this.Br || i2 !== this._sessionStartTimestamp);
    ((this._sessionStartTimestamp = i2),
      (this._sessionActivityTimestamp = e2),
      (this.Br = t2),
      (s2 && !r2) ||
        (s2 && this.Yr(e2)) ||
        ((this.Or = e2), this.Rr.register({ [Vi]: [e2, t2, i2] })));
  }
  tn() {
    var t2,
      e2 = null == (t2 = this.qe) ? void 0 : t2.persistence_save_debounce_ms;
    return tt(e2) && e2 > 0;
  }
  en() {
    this.tn() ? this.Rr.refreshKey(Vi) : (this.Rr.flush(), this.Rr.load());
  }
  rn() {
    var t2;
    if (!Q(this._sessionActivityTimestamp) && this._sessionActivityTimestamp !== this.Or) {
      this.en();
      var e2 = this.nn();
      e2[1] === this.Br &&
        e2[2] === this._sessionStartTimestamp &&
        ((this.Or = this._sessionActivityTimestamp),
        this.Rr.register({
          [Vi]: [
            this._sessionActivityTimestamp,
            null !== (t2 = this.Br) && void 0 !== t2 ? t2 : null,
            this._sessionStartTimestamp,
          ],
        }),
        this.Rr.flush());
    }
  }
  sn() {
    var t2 = this.nn()[0],
      e2 = tt(t2) ? t2 : 0,
      i2 = tt(this._sessionActivityTimestamp) ? this._sessionActivityTimestamp : 0;
    return Math.max(e2, i2);
  }
  an(t2) {
    return (this.en(), this.qr(t2, this.sn()));
  }
  nn() {
    var t2 = this.Rr.props[Vi];
    return (H(t2) && 2 === t2.length && t2.push(t2[0]), t2 || [0, null, 0]);
  }
  resetSessionId() {
    ((this.Or = null),
      (this.Hr = void 0),
      clearTimeout(this.ln),
      (this.ln = void 0),
      this.Xr(null, null, null));
  }
  setBootstrapSessionId(t2, e2) {
    void 0 === e2 && (e2 = false);
    var i2 = (function (t3, e3) {
      void 0 === e3 && (e3 = /* @__PURE__ */ new Date().getTime());
      try {
        var i3 = ((t4) => {
          var e4 = t4.replace(/-/g, "");
          if (32 !== e4.length) throw new Error("Not a valid UUID");
          if ("7" !== e4[12]) throw new Error("Not a UUIDv7");
          return parseInt(e4.substring(0, 12), 16);
        })(t3);
        return i3 > e3 + 6e4 ? void va.error("Bootstrap sessionID cannot be in the future") : i3;
      } catch (t4) {
        return void va.error("Invalid sessionID in bootstrap", t4);
      }
    })(t2);
    return (
      !K(i2) &&
      (e2
        ? (this.Hr = { sessionId: t2, sessionStartTimestamp: i2 })
        : this.Xr(t2, /* @__PURE__ */ new Date().getTime(), i2),
      true)
    );
  }
  destroy() {
    ((this.Nr = true),
      this.rn(),
      clearTimeout(this.ln),
      (this.ln = void 0),
      this.$r && t && (t.removeEventListener(Ar, this.$r, { capture: false }), (this.$r = void 0)),
      (this.Dr = []));
  }
  Qr() {
    ((this.$r = () => {
      (this.rn(), this.Gr() && vs.q(this.Zr));
    }),
      Gr(t, Ar, this.$r, { capture: false }));
  }
  checkAndGetSessionAndWindowId(t2, e2) {
    if (
      (void 0 === t2 && (t2 = false), void 0 === e2 && (e2 = null), this.qe.cookieless_mode === Rr)
    )
      throw new Error(
        'checkAndGetSessionAndWindowId should not be called with cookieless_mode="always"',
      );
    var i2 = e2 || /* @__PURE__ */ new Date().getTime(),
      r2 = this.nn(),
      s2 = r2[1],
      n2 = r2[2],
      o2 = this.sn(),
      a2 = this.Jr(),
      l2 = this.Hr,
      u2 = !!l2 && (l2.sessionStartTimestamp > i2 + 6e4 || i2 - l2.sessionStartTimestamp > ca),
      h2 = l2 ? u2 : tt(n2) && Math.abs(i2 - n2) > ca,
      d2 = false,
      v2 = false,
      c2 = !s2 || !!l2,
      f2 = s2,
      p2 = !c2 && !t2 && this.qr(i2, o2);
    if (p2) {
      (p2 = this.an(i2)) || va.info("cross-tab refresh kept the session alive", { sessionId: s2 });
      var _2 = this.nn();
      ((s2 = _2[1]), (n2 = _2[2]));
    }
    if (c2 || p2 || h2) {
      var g2 = l2 && !u2;
      ((s2 = g2 ? l2.sessionId : this.Ur()),
        (a2 = this.zr()),
        va.info("new session ID assigned", {
          sessionId: s2,
          windowId: a2,
          bootstrapped: !!g2,
          changeReason: { noSessionId: c2, activityTimeout: p2, sessionPastMaximumLength: h2 },
        }),
        (n2 = g2 ? l2.sessionStartTimestamp : i2),
        (this.Hr = void 0),
        (d2 = true));
    } else
      (a2 || ((a2 = this.zr()), (d2 = true)),
        (v2 = s2 !== f2) &&
          (va.info("adopted cross-tab session id", { sessionId: s2, windowId: a2 }), (d2 = true)));
    var m2 = tt(o2) && t2 && !h2 ? o2 : i2,
      y2 = tt(n2) ? n2 : /* @__PURE__ */ new Date().getTime();
    (this.Kr(a2), this.Xr(s2, m2, y2), t2 || this.Wr());
    var b2 = {
      noSessionId: c2,
      activityTimeout: p2,
      sessionPastMaximumLength: h2,
      crossTabAdoption: v2,
    };
    return (
      d2 && this.Dr.forEach((t3) => t3(s2, a2, b2)),
      {
        sessionId: s2,
        windowId: a2,
        sessionStartTimestamp: y2,
        changeReason: d2 ? b2 : void 0,
        lastActivityTimestamp: o2,
      }
    );
  }
  Wr() {
    this.Nr ||
      (clearTimeout(this.ln),
      (this.ln = setTimeout(() => {
        if (!this.Nr)
          if (this.an(/* @__PURE__ */ new Date().getTime())) {
            var t2 = this.Br;
            (this.resetSessionId(), this.Lr.emit("forcedIdleReset", { idleSessionId: t2 }));
          } else this.Wr();
      }, 1.1 * this.sessionTimeoutMs)));
  }
}
var pa = function (t2, e2) {
  if (!t2) return false;
  var i2 = t2.userAgent;
  if (i2 && D(i2, e2)) return true;
  try {
    var r2 = null == t2 ? void 0 : t2.userAgentData;
    if (null != r2 && r2.brands && r2.brands.some((t3) => D(null == t3 ? void 0 : t3.brand, e2)))
      return true;
  } catch (t3) {}
  return !!t2.webdriver;
};
function _a() {
  return (_a = p(function* () {
    var t2 = null == i ? void 0 : i.userAgentData;
    if (null != t2 && t2.getHighEntropyValues)
      try {
        var e2 = yield t2.getHighEntropyValues(["model"]),
          r2 = null == e2 ? void 0 : e2.model;
        return J(r2) && r2.length > 0 ? r2 : void 0;
      } catch (t3) {
        return void mi.info(
          "Unable to resolve $device_model from userAgentData.getHighEntropyValues",
          t3,
        );
      }
  })).apply(this, arguments);
}
var ga = function (t2, e2) {
  if (
    !(function (t3) {
      try {
        new RegExp(t3);
      } catch (t4) {
        return false;
      }
      return true;
    })(e2)
  )
    return false;
  try {
    return new RegExp(e2).test(t2);
  } catch (t3) {
    return false;
  }
};
function ma(t2, e2, i2) {
  return gn({ distinct_id: t2, userPropertiesToSet: e2, userPropertiesToSetOnce: i2 });
}
var ya = {
    exact: (t2, e2) => e2.some((e3) => t2.some((t3) => e3 === t3)),
    is_not: (t2, e2) => e2.every((e3) => t2.every((t3) => e3 !== t3)),
    regex: (t2, e2) => e2.some((e3) => t2.some((t3) => ga(e3, t3))),
    not_regex: (t2, e2) => e2.every((e3) => t2.every((t3) => !ga(e3, t3))),
    icontains: (t2, e2) => e2.map(ba).some((e3) => t2.map(ba).some((t3) => e3.includes(t3))),
    not_icontains: (t2, e2) => e2.map(ba).every((e3) => t2.map(ba).every((t3) => !e3.includes(t3))),
    gt: (t2, e2) =>
      e2.some((e3) => {
        var i2 = parseFloat(e3);
        return !isNaN(i2) && t2.some((t3) => i2 > parseFloat(t3));
      }),
    lt: (t2, e2) =>
      e2.some((e3) => {
        var i2 = parseFloat(e3);
        return !isNaN(i2) && t2.some((t3) => i2 < parseFloat(t3));
      }),
  },
  ba = (t2) => t2.toLowerCase();
function wa(t2, e2) {
  return (
    !t2 ||
    Object.entries(t2).every((t3) => {
      var i2 = t3[1],
        r2 = null == e2 ? void 0 : e2[t3[0]];
      if (K(r2) || Q(r2)) return false;
      var s2 = [String(r2)],
        n2 = ya[i2.operator];
      return !!n2 && n2(i2.values, s2);
    })
  );
}
var Ea = "custom",
  xa = "i.posthog.com",
  Sa = /^\/static\//,
  $a = ["/s/", "/e/", "/i/"];
class ka {
  constructor(t2) {
    ((this.un = {}), (this.instance = t2));
  }
  get apiHost() {
    var t2 = this.instance.config.api_host.trim().replace(/\/$/, "");
    return "https://app.posthog.com" === t2 ? "https://us.i.posthog.com" : t2;
  }
  get flagsApiHost() {
    var t2 = this.instance.config.flags_api_host;
    return t2 ? t2.trim().replace(/\/$/, "") : this.apiHost;
  }
  get uiHost() {
    var t2,
      e2 = null == (t2 = this.instance.config.ui_host) ? void 0 : t2.replace(/\/$/, "");
    return (
      e2 || (e2 = this.apiHost.replace("." + xa, ".posthog.com")),
      "https://app.posthog.com" === e2 ? "https://us.posthog.com" : e2
    );
  }
  get region() {
    return (
      this.un[this.apiHost] ||
        (this.un[this.apiHost] = /https:\/\/(app|us|us-assets)(\.i)?\.posthog\.com/i.test(
          this.apiHost,
        )
          ? "us"
          : /https:\/\/(eu|eu-assets)(\.i)?\.posthog\.com/i.test(this.apiHost)
            ? "eu"
            : Ea),
      this.un[this.apiHost]
    );
  }
  hn(t2) {
    if (Sa.test(t2)) {
      var e2 = this.instance.config.asset_host;
      if ("string" == typeof e2) return e2.trim().replace(/\/$/, "") || void 0;
    }
  }
  dn(t2) {
    var e2 = mn(t2);
    return e2 ? e2.protocol + "//" + e2.host + e2.pathname : void 0;
  }
  vn(t2, e2, i2) {
    if ("ui" === t2) return i2;
    var r2 = i2,
      s2 = this.instance.config.rewriteRequestPath;
    if (s2) {
      var n2,
        o2 = (null == (n2 = mn(i2)) ? void 0 : n2.href) || i2;
      r2 = s2(new URL(o2)).toString();
    }
    if (s2 && "api" === t2 && $a.some((t3) => 0 === e2.indexOf(t3))) {
      var a2 = this.dn(r2);
      if (a2) {
        var l2,
          u2 = this.apiHost,
          h2 = this.cn;
        (((null == (l2 = h2) ? void 0 : l2.apiHost) === u2 && h2.rewriteRequestPath === s2) ||
          ((h2 = { apiHost: u2, rewriteRequestPath: s2, urls: /* @__PURE__ */ new Set() }),
          (this.cn = h2)),
          h2.urls.add(a2));
      }
    }
    return r2;
  }
  isIngestionEndpoint(t2) {
    var e2 = this.cn,
      i2 = this.dn(t2);
    return (
      (null == e2 ? void 0 : e2.apiHost) === this.apiHost &&
      e2.rewriteRequestPath === this.instance.config.rewriteRequestPath &&
      !!i2 &&
      e2.urls.has(i2)
    );
  }
  endpointFor(t2, e2) {
    if ((void 0 === e2 && (e2 = ""), e2 && (e2 = "/" === e2[0] ? e2 : "/" + e2), "ui" === t2))
      return this.vn(t2, e2, this.uiHost + e2);
    if ("flags" === t2) return this.vn(t2, e2, this.flagsApiHost + e2);
    if ("assets" === t2) {
      var i2 = this.hn(e2);
      if (i2) return this.vn(t2, e2, "" + i2 + e2);
    }
    if (this.region === Ea) return this.vn(t2, e2, this.apiHost + e2);
    var r2 = xa + e2;
    switch (t2) {
      case "assets":
        return this.vn(t2, e2, "https://" + this.region + "-assets." + r2);
      case "api":
        return this.vn(t2, e2, "https://" + this.region + "." + r2);
    }
  }
}
function Ta(t2) {
  var e2;
  return !(
    null == (e2 = t2.conditions) ||
    null == (e2 = e2.events) ||
    null == (e2 = e2.values) ||
    !e2.length
  );
}
var Ra = yi("[Surveys]"),
  Pa = "seenSurvey_",
  Oa = (t2) => {
    try {
      var e2 = ((t3) =>
        ((t4, e3) =>
          "" +
          Pa +
          (function (t5) {
            return t5.current_iteration && t5.current_iteration > 0
              ? t5.id + "_" + t5.current_iteration
              : t5.id;
          })(e3))(0, t3))(t2);
      if (localStorage.getItem(e2)) return;
      localStorage.setItem(e2, "true");
    } catch (t3) {
      Ra.error("Failed to persist survey seen state", t3);
    }
  },
  Ca = [Jn.Popover, Jn.Widget, Jn.API],
  Ia = { ignoreConditions: false, ignoreDelay: false, displayType: eo.Popover },
  Aa = yi("[PostHog ExternalIntegrations]"),
  Fa = { intercom: "intercom-integration", crispChat: "crisp-chat-integration" };
class Ma {
  constructor(t2) {
    this._instance = t2;
  }
  di(t2, e2) {
    var i2;
    null == (i2 = v.__PosthogExtensions__) ||
      null == i2.loadExternalDependency ||
      i2.loadExternalDependency(this._instance, t2, (t3) => {
        if (t3) return Aa.error("failed to load script", t3);
        e2();
      });
  }
  startIfEnabledOrStop() {
    var t2 = this,
      e2 = function () {
        var e3,
          r3,
          s2,
          n2 = i2[0],
          o2 = i2[1];
        (!o2 ||
          (null != (e3 = v.__PosthogExtensions__) && null != (e3 = e3.integrations) && e3[n2]) ||
          t2.di(Fa[n2], () => {
            var e4;
            null == (e4 = v.__PosthogExtensions__) ||
              null == (e4 = e4.integrations) ||
              null == (e4 = e4[n2]) ||
              e4.start(t2._instance);
          }),
          !o2 &&
            null != (r3 = v.__PosthogExtensions__) &&
            null != (r3 = r3.integrations) &&
            r3[n2] &&
            (null == (s2 = v.__PosthogExtensions__) ||
              null == (s2 = s2.integrations) ||
              null == (s2 = s2[n2]) ||
              s2.stop()));
      };
    for (var i2 of Object.entries(
      null !== (r2 = this._instance.config.integrations) && void 0 !== r2 ? r2 : {},
    )) {
      var r2;
      e2();
    }
  }
}
class Da {
  constructor(t2, e2) {
    ((this.st = t2), (this.fn = e2), (this.pn = /* @__PURE__ */ new Map()), (this.gn = false));
  }
  add(t2) {
    var e2 = this;
    return p(function* () {
      if (e2.gn) throw new Error("Cannot add an extension to a disposed ExtensionRuntime");
      if (e2.pn.has(t2.name))
        throw new Error('Browser extension "' + t2.name + '" is already registered');
      e2.pn.set(t2.name, t2);
      try {
        var i2 = t2.setup(e2.fn);
        i2 && (yield i2);
      } catch (i3) {
        var r2 = e2.pn.get(t2.name) === t2;
        (r2 && e2.pn.delete(t2.name),
          e2.st.error('Failed to set up browser extension "' + t2.name + '"', i3),
          r2 && e2.mn(t2));
      }
    })();
  }
  dispose() {
    if (!this.gn) {
      this.gn = true;
      var t2 = Array.from(this.pn.values()).reverse();
      for (var e2 of (this.pn.clear(), t2)) this.mn(e2);
    }
  }
  mn(t2) {
    try {
      var e2 = null == t2.dispose ? void 0 : t2.dispose();
      e2 &&
        V(e2.then) &&
        e2.then(void 0, (e3) => {
          this.st.error('Failed to dispose browser extension "' + t2.name + '"', e3);
        });
    } catch (e3) {
      this.st.error('Failed to dispose browser extension "' + t2.name + '"', e3);
    }
  }
}
class Na {
  constructor(t2) {
    this._instance = t2;
  }
  initialize() {}
  get(t2) {
    var e2 = this._instance.persistence;
    if ("string" == typeof t2) return null == e2 ? void 0 : e2.get_property(t2);
    var i2 = {};
    for (var r2 of t2) {
      var s2 = null == e2 ? void 0 : e2.get_property(r2);
      K(s2) || (i2[r2] = s2);
    }
    return i2;
  }
  set(t2, e2) {
    var i2;
    null == (i2 = this._instance.persistence) ||
      i2.register("string" == typeof t2 ? { [t2]: e2 } : t2);
  }
  remove(t2) {
    var e2;
    null == (e2 = this._instance.persistence) || e2.unregister(t2);
  }
}
var Ua = "extensionsRemoteConfig";
class La {
  constructor(t2) {
    ((this.gn = false),
      (this.instance = t2),
      (this.st = mi),
      (this.yn = t2.bn),
      (this.kv = new Na(t2)),
      (this.onEvent = (t3) =>
        qn(
          this.instance.on("eventCaptured", (e2) => {
            try {
              t3({ event: e2.event, properties: e2.properties });
            } catch (t4) {
              this.st.error("Browser extension event listener failed", t4);
            }
          }),
        )),
      (this.onRemoteConfig = (t3) => {
        if (this.gn) return qn(() => {});
        var e2 = (e3) => {
            try {
              t3(e3);
            } catch (t4) {
              this.st.error("Browser extension remote config listener failed", t4);
            }
          },
          i2 = this.instance._n.on(Ua, e2);
        return (this.yn && e2(this.yn), qn(i2));
      }),
      (this.wn = new Da(mi.createLogger("[BrowserExtensions]"), this)));
  }
  get logger() {
    return this.st;
  }
  get distinctId() {
    return this.instance.get_distinct_id();
  }
  get anonymousId() {
    var t2;
    return null !== (t2 = this.instance.get_property(ki)) && void 0 !== t2 ? t2 : this.distinctId;
  }
  get deviceId() {
    var t2 = this.instance.get_property(ki);
    return "string" == typeof t2 ? t2 : void 0;
  }
  get library() {
    return { name: c.LIB_NAME, version: c.LIB_VERSION };
  }
  get initialPersonProperties() {
    var t2, e2;
    return null !==
      (t2 = null == (e2 = this.instance.persistence) ? void 0 : e2.get_initial_props()) &&
      void 0 !== t2
      ? t2
      : {};
  }
  get groups() {
    return this.instance.getGroups();
  }
  get session() {
    try {
      var t2,
        e2,
        i2,
        r2,
        s2 =
          null == (t2 = this.instance.sessionManager)
            ? void 0
            : t2.checkAndGetSessionAndWindowId(true);
      return {
        sessionId: null !== (e2 = null == s2 ? void 0 : s2.sessionId) && void 0 !== e2 ? e2 : "",
        windowId: null !== (i2 = null == s2 ? void 0 : s2.windowId) && void 0 !== i2 ? i2 : "",
        sessionStartTimestamp:
          null !== (r2 = null == s2 ? void 0 : s2.sessionStartTimestamp) && void 0 !== r2 ? r2 : 0,
      };
    } catch (t3) {
      return { sessionId: "", windowId: "", sessionStartTimestamp: 0 };
    }
  }
  get projectToken() {
    return this.instance.config.token;
  }
  add(t2) {
    return this.wn.add(t2);
  }
  capture(t2, e2, i2) {
    var r2 = this;
    return p(function* () {
      i2
        ? r2.instance.capture(t2, e2, {
            timestamp: i2.timestamp,
            uuid: i2.uuid,
            $set: i2.set,
            $set_once: i2.setOnce,
          })
        : r2.instance.capture(t2, e2);
    })();
  }
  registerDynamicEventProperties(t2) {
    return qn(this.instance.kn(t2));
  }
  handleRemoteConfig(t2) {
    this.gn || ((this.yn = t2), this.instance._n.emit(Ua, t2));
  }
  sendRequest(t2, e2) {
    var i2 = this;
    return p(function* () {
      var r2;
      void 0 === e2 && (e2 = {});
      var s2 = i2.instance.requestRouter.endpointFor(
          null !== (r2 = e2.target) && void 0 !== r2 ? r2 : "api",
          t2,
        ),
        n2 = {
          method: e2.method,
          url: e2.query ? Go(s2, e2.query) : s2,
          data: e2.body,
          headers: e2.headers,
          timeout: e2.timeoutMs,
          fireCallbackOnDrop: true,
          transport: e2.transport,
          compression: e2.compression,
          timestampMode: e2.sentAt,
        };
      return "sendBeacon" === e2.transport
        ? (i2.instance._send_request(n2), { statusCode: 202 })
        : new Promise((t3) => {
            ((n2.callback = t3), i2.instance._send_request(n2));
          });
    })();
  }
  dispose() {
    this.gn || ((this.gn = true), this.wn.dispose());
  }
}
var ja = {},
  Ba = 0,
  za = () => {},
  qa = 'Consent opt in/out is not valid with cookieless_mode="always" and will be ignored',
  Ha = "Surveys module not available",
  Va = "sanitize_properties is deprecated. Use before_send instead",
  Wa = "Invalid value for property_denylist config: ",
  Ga = ["token", "distinct_id", Er],
  Ka = "posthog",
  Ja =
    !qo &&
    -1 === (null == u ? void 0 : u.indexOf("MSIE")) &&
    -1 === (null == u ? void 0 : u.indexOf("Mozilla")),
  Ya = (e2) => {
    var i2;
    return _(
      {
        api_host: "https://us.i.posthog.com",
        flags_api_host: null,
        ui_host: null,
        asset_host: null,
        token: "",
        autocapture: true,
        cross_subdomain_cookie: Wr(null == r ? void 0 : r.location),
        persistence: "localStorage+cookie",
        persistence_name: "",
        cookie_persisted_properties: [],
        loaded: za,
        save_campaign_params: true,
        custom_campaign_params: [],
        custom_blocked_useragents: [],
        save_referrer: true,
        capture_pageleave: "if_capture_pageview",
        defaults: null != e2 ? e2 : "unset",
        __preview_deferred_init_extensions: false,
        __preview_external_dependency_versioned_paths: false,
        __preview_cookie_wins_on_conflict: false,
        debug:
          (s &&
            J(null == s ? void 0 : s.search) &&
            -1 !== s.search.indexOf("__posthog_debug=true")) ||
          false,
        cookie_expiration: 365,
        upgrade: false,
        disable_session_recording: false,
        disable_persistence: false,
        disable_web_experiments: true,
        disable_surveys: false,
        disable_surveys_automatic_display: false,
        disable_conversations: false,
        disable_product_tours: false,
        disableDeviceModel: false,
        disable_external_dependency_loading: false,
        strict_script_versioning: "fallback",
        enable_recording_console_log: void 0,
        secure_cookie: "https:" === (null == t || null == (i2 = t.location) ? void 0 : i2.protocol),
        ip: false,
        opt_out_capturing_by_default: false,
        opt_out_persistence_by_default: false,
        opt_out_useragent_filter: false,
        opt_out_capturing_persistence_type: "localStorage",
        consent_persistence_name: null,
        opt_out_capturing_cookie_prefix: null,
        opt_in_site_apps: false,
        property_denylist: [],
        respect_dnt: false,
        sanitize_properties: null,
        request_headers: {},
        request_batching: true,
        properties_string_max_length: 65535,
        mask_all_element_attributes: false,
        mask_all_text: false,
        mask_personal_data_properties: false,
        custom_personal_data_properties: [],
        advanced_disable_flags: false,
        advanced_disable_decide: false,
        advanced_disable_feature_flags: false,
        advanced_disable_feature_flags_on_first_load: false,
        advanced_only_evaluate_survey_feature_flags: false,
        advanced_feature_flags_dedup_per_session: false,
        advanced_enable_surveys: false,
        advanced_disable_toolbar_metrics: false,
        feature_flag_request_timeout_ms: 3e3,
        surveys_request_timeout_ms: 1e4,
        on_request_error(t2) {
          mi.error("Bad HTTP status: " + t2.statusCode + " " + t2.text);
        },
        get_device_id: (t2) => t2,
        capture_performance: void 0,
        name: "posthog",
        bootstrap: {},
        disable_compression: false,
        session_idle_timeout_seconds: 1800,
        person_profiles: Cr,
        before_send: void 0,
        get_current_url: void 0,
        request_queue_config: { flush_interval_ms: sa },
        error_tracking: {},
        _onCapture: za,
      },
      ((t2) => ({
        rageclick:
          t2 && t2 >= "2026-05-30"
            ? { content_ignorelist: Ds, ignore_text_selection: true }
            : !t2 || "2025-11-30" > t2 || { content_ignorelist: true },
        capture_pageview: !t2 || "2025-05-24" > t2 || "history_change",
        session_recording:
          t2 && t2 >= "2026-06-25"
            ? {
                strictMinimumDuration: true,
                canvasCapture: { resolutionScale: 0.6 },
                streamNetworkBody: true,
              }
            : t2 && t2 >= "2026-05-30"
              ? { strictMinimumDuration: true, canvasCapture: { resolutionScale: 0.6 } }
              : t2 && t2 >= "2025-11-30"
                ? { strictMinimumDuration: true }
                : {},
        external_scripts_inject_target: t2 && t2 >= "2026-01-30" ? "head" : "body",
        internal_or_test_user_hostname:
          t2 && t2 >= "2026-01-30" ? /^(localhost|127\.0\.0\.1)$/ : void 0,
        persistence_save_debounce_ms: t2 && t2 >= "2026-05-30" ? 250 : 0,
        split_storage: !(!t2 || "2026-05-30" > t2),
        detect_google_search_app: !(!t2 || "2026-05-30" > t2),
        disable_capture_url_hashes: !(!t2 || "2026-06-25" > t2),
      }))(e2),
    );
  },
  Qa = [
    ["process_person", "person_profiles"],
    ["xhr_headers", "request_headers"],
    ["cookie_name", "persistence_name"],
    ["disable_cookie", "disable_persistence"],
    ["__preview_disable_beacon", "disable_beacon"],
    ["store_google", "save_campaign_params"],
    ["verbose", "debug"],
  ],
  Xa = (t2) => {
    var e2 = {};
    for (var i2 of Qa) {
      var r2 = i2[0],
        s2 = i2[1];
      K(t2[r2]) || (e2[s2] = t2[r2]);
    }
    var n2 = jr({}, e2, t2),
      o2 = t2.__preview_external_dependency_versioned_paths;
    return (
      K(o2) ||
        (K(t2.strict_script_versioning) && (n2.strict_script_versioning = !!o2),
        J(o2) && K(t2.asset_host) && (n2.asset_host = o2)),
      H(t2.property_blacklist) &&
        (K(t2.property_denylist)
          ? (n2.property_denylist = t2.property_blacklist)
          : H(t2.property_denylist)
            ? (n2.property_denylist = [...t2.property_blacklist, ...t2.property_denylist])
            : mi.error(Wa + t2.property_denylist)),
      n2
    );
  };
class Za {
  constructor() {
    this.__forceAllowLocalhost = false;
  }
  get xn() {
    return this.__forceAllowLocalhost;
  }
  set xn(t2) {
    (mi.error(
      "WebPerformanceObserver is deprecated and has no impact on network capture. Use `_forceAllowLocalhostNetworkCapture` on `posthog.sessionRecording`",
    ),
      (this.__forceAllowLocalhost = t2));
  }
}
class tl {
  Sn(t2, e2) {
    if (t2) {
      var i2 = this.pn.indexOf(t2);
      -1 !== i2 && this.pn.splice(i2, 1);
    }
    return (this.pn.push(e2), null == e2.initialize || e2.initialize(), e2);
  }
  Cn() {
    return (
      this.config.cookieless_mode === Rr ||
      (this.config.cookieless_mode === Tr && this.consent.isRejected())
    );
  }
  get decideEndpointWasHit() {
    var t2, e2;
    return (
      null !== (t2 = null == (e2 = this.featureFlags) ? void 0 : e2.hasLoadedFlags) &&
      void 0 !== t2 &&
      t2
    );
  }
  get flagsEndpointWasHit() {
    var t2, e2;
    return (
      null !== (t2 = null == (e2 = this.featureFlags) ? void 0 : e2.hasLoadedFlags) &&
      void 0 !== t2 &&
      t2
    );
  }
  constructor() {
    var t2;
    ((this.webPerformance = new Za()),
      (this.Mn = false),
      (this.version = c.LIB_VERSION),
      (this.Tn = /* @__PURE__ */ new Set()),
      (this.En = ""),
      (this._n = new da()),
      (this.pn = []),
      (this.In = []),
      (this._calculate_event_properties = this.calculateEventProperties.bind(this)),
      (this.config = Ya()),
      (this.SentryIntegration = dn),
      (this.sentryIntegration = (t3) =>
        (function (t4, e3) {
          var i2 = hn(t4, e3);
          return { name: un, processEvent: (t5) => i2(t5) };
        })(this, t3)),
      (this.__request_queue = []),
      (this.__loaded = false),
      (this.analyticsDefaultEndpoint = "/e/"),
      (this.Pn = false),
      (this.Rn = null),
      (this.An = null),
      (this.Fn = null),
      (this.scrollManager = new la(this)),
      (this.pageViewManager = new vn(this)),
      (this.rateLimiter = new oo(this)),
      (this.requestRouter = new ka(this)),
      (this.consent = new cs(this)),
      (this.externalIntegrations = new Ma(this)));
    var e2 = null !== (t2 = tl.__defaultExtensionClasses) && void 0 !== t2 ? t2 : {};
    ((this.featureFlags = e2.featureFlags && new e2.featureFlags(this)),
      (this.toolbar = e2.toolbar && new e2.toolbar(this)),
      (this.surveys = e2.surveys && new e2.surveys(this)),
      (this.conversations = e2.conversations && new e2.conversations(this)),
      (this.logs = e2.logs && new e2.logs(this)),
      (this.metrics = e2.metrics && new e2.metrics(this)),
      (this.experiments = e2.experiments && new e2.experiments(this)),
      (this.exceptions = e2.exceptions && new e2.exceptions(this)),
      (this.people = {
        set: (t3, e3, i2) => {
          var r2 = J(t3) ? { [t3]: e3 } : t3;
          (this.setPersonProperties(r2), null == i2 || i2({}));
        },
        set_once: (t3, e3, i2) => {
          var r2 = J(t3) ? { [t3]: e3 } : t3;
          (this.setPersonProperties(void 0, r2), null == i2 || i2({}));
        },
      }),
      this.on("eventCaptured", (t3) =>
        mi.info('send "' + (null == t3 ? void 0 : t3.event) + '"', t3),
      ));
  }
  init(t2, e2, i2) {
    if (i2 && i2 !== Ka) {
      var r2,
        s2 = null !== (r2 = ja[i2]) && void 0 !== r2 ? r2 : new tl();
      return (s2._init(t2, e2, i2), (ja[i2] = s2), (ja[Ka][i2] = s2), s2);
    }
    return this._init(t2, e2, i2);
  }
  _init(e2, i2, r2) {
    var s2, n2;
    void 0 === i2 && (i2 = {});
    var o2,
      a2 = J(e2) ? e2.trim() : "";
    if (!a2)
      return (
        mi.critical(
          "PostHog was initialized without a token. This likely indicates a misconfiguration. Please check the first argument passed to posthog.init()",
        ),
        this
      );
    if (this.__loaded)
      return (
        a2 !== (null == (o2 = this.config) ? void 0 : o2.token)
          ? console.warn(
              "[PostHog.js]",
              "You have already initialized PostHog with a different project token! Re-initializing is a no-op, so events will keep going to the project this instance was initialized with. To capture into a second project, load PostHog once, then initialize a named instance after the SDK has loaded, e.g. posthog.init('" +
                a2 +
                "', { ... }, 'project2')",
            )
          : console.warn(
              "[PostHog.js]",
              "You have already initialized PostHog! Re-initializing is a no-op",
            ),
        this
      );
    ((this.__loaded = true),
      (this.config = Ya(i2.defaults)),
      (i2.debug = this.Ln(i2.debug)),
      (this.On = i2),
      (this.Dn = []),
      i2.person_profiles
        ? (this.An = i2.person_profiles)
        : i2.process_person && (this.An = i2.process_person));
    var l2 = Ya(i2.defaults),
      u2 = Xa(i2),
      h2 = jr({}, l2, u2, { name: r2, token: a2 });
    (W(l2.rageclick) && W(u2.rageclick) && (h2.rageclick = jr({}, l2.rageclick, u2.rageclick)),
      W(l2.session_recording) &&
        W(u2.session_recording) &&
        (h2.session_recording = jr({}, l2.session_recording, u2.session_recording)),
      this.set_config(h2),
      this.config.on_xhr_error &&
        mi.error("on_xhr_error is deprecated. Use on_request_error instead"),
      (this.compression = i2.disable_compression ? void 0 : Hn.GZipJS));
    var d2 = this.$n();
    if (
      ((this.persistence = new zn(this.config, d2)),
      (this.sessionPersistence =
        "sessionStorage" === this.config.persistence || "memory" === this.config.persistence
          ? this.persistence
          : new zn(_({}, this.config, { persistence: "sessionStorage" }), d2, false)),
      (this.En =
        "ph_" +
        (this.config.persistence_name || this.config.token) +
        "_session_registered_properties"),
      "memory" !== this.config.persistence && !d2 && vs.N())
    ) {
      var v2 = vs.H(this.En);
      H(v2) &&
        v2.forEach((t2) => {
          J(t2) && this.Tn.add(t2);
        });
    } else vs.q(this.En);
    var f2 = _({}, this.persistence.props),
      p2 = _({}, this.sessionPersistence.props);
    (this.register({ $initialization_time: /* @__PURE__ */ new Date().toISOString() }),
      (this.Nn = new na((t2) => this.qn(t2), this.config.request_queue_config)),
      (this.jn = new aa(this)),
      (this.__request_queue = []));
    var g2 = this.Cn();
    if (
      (g2 ||
        ((this.sessionManager = new fa(this)),
        (this.sessionPropsManager = new ha(this, this.sessionManager, this.persistence)),
        this.sessionManager.onSessionId((t2, e3, i3) => {
          ((null != i3 && i3.activityTimeout) ||
            (null != i3 && i3.sessionPastMaximumLength) ||
            (null != i3 && i3.crossTabAdoption)) &&
            this.Bn();
        })),
      this.Hn(),
      this.config.__preview_deferred_init_extensions
        ? (mi.info("Deferring extension initialization to improve startup performance"),
          setTimeout(() => {
            this.Un(g2);
          }, 0))
        : (mi.info("Initializing extensions synchronously"), this.Un(g2)),
      (c.DEBUG = c.DEBUG || this.config.debug),
      c.DEBUG &&
        mi.info("Starting in debug mode", {
          this: this,
          config: i2,
          thisC: _({}, this.config),
          p: f2,
          s: p2,
        }),
      !this.config.identity_distinct_id ||
        (null != (s2 = i2.bootstrap) && s2.distinctID) ||
        (i2.bootstrap = _({}, i2.bootstrap, {
          distinctID: this.config.identity_distinct_id,
          isIdentifiedID: true,
        })),
      void 0 !== (null == (n2 = i2.bootstrap) ? void 0 : n2.distinctID))
    ) {
      var m2 = i2.bootstrap.distinctID,
        y2 = this.get_distinct_id(),
        b2 = this.persistence.get_property(fr);
      if (i2.bootstrap.isIdentifiedID && null != y2 && y2 !== m2 && b2 === Pr) this.identify(m2);
      else if (i2.bootstrap.isIdentifiedID && null != y2 && y2 !== m2 && b2 === Or)
        mi.warn(
          "Bootstrap distinctID differs from an already-identified user. The existing identity is preserved. Call reset() before reinitializing if you intend to switch users.",
        );
      else {
        var w2 = this.config.get_device_id(es()),
          E2 = i2.bootstrap.isIdentifiedID ? w2 : m2;
        (this.persistence.set_property(fr, i2.bootstrap.isIdentifiedID ? Or : Pr),
          this.register({ distinct_id: m2, $device_id: E2 }));
      }
    }
    if (g2) this.register_once({ distinct_id: wr, $device_id: null }, "");
    else if (!this.get_distinct_id()) {
      var x2 = this.config.get_device_id(es());
      (this.register_once({ distinct_id: x2, $device_id: x2 }, ""),
        this.persistence.set_property(fr, Pr));
    }
    return (
      Gr(t, "onpagehide" in self ? "pagehide" : "unload", this._handle_unload.bind(this), {
        passive: false,
      }),
      i2.segment
        ? (function (t2, e3) {
            var i3 = t2.config.segment;
            if (!i3) return e3();
            !(function (t3, e4) {
              var i4 = t3.config.segment;
              if (!i4) return e4();
              var r3 = (i5) => {
                  var r4 = () => i5.anonymousId() || es();
                  ((t3.config.get_device_id = r4),
                    i5.id() &&
                      (t3.register({ distinct_id: i5.id(), $device_id: r4() }),
                      t3.persistence.set_property(fr, Or)),
                    e4());
                },
                s3 = i4.user();
              "then" in s3 && V(s3.then) ? s3.then(r3) : r3(s3);
            })(t2, () => {
              i3.register(
                ((t3) => {
                  ("undefined" != typeof Promise && Promise.resolve) ||
                    ln.warn(
                      "This browser does not have Promise support, and can not use the segment integration",
                    );
                  var e4 = (e5, i4) => {
                    if (!i4) return e5;
                    (e5.event.userId ||
                      e5.event.anonymousId === t3.get_distinct_id() ||
                      (ln.info("No userId set, resetting PostHog"), t3.reset()),
                      e5.event.userId &&
                        e5.event.userId !== t3.get_distinct_id() &&
                        (ln.info("UserId set, identifying with PostHog"),
                        t3.identify(e5.event.userId)));
                    var r3 = t3.calculateEventProperties(i4, e5.event.properties);
                    return ((e5.event.properties = Object.assign({}, r3, e5.event.properties)), e5);
                  };
                  return {
                    name: "PostHog JS",
                    type: "enrichment",
                    version: "1.0.0",
                    isLoaded: () => true,
                    load: () => Promise.resolve(),
                    track: (t4) => e4(t4, t4.event.event),
                    page: (t4) => e4(t4, Fr),
                    identify: (t4) => e4(t4, Dr),
                    screen: (t4) => e4(t4, "$screen"),
                  };
                })(t2),
              ).then(() => {
                e3();
              });
            });
          })(this, () => this.zn())
        : this.zn(),
      V(this.config._onCapture) &&
        this.config._onCapture !== za &&
        (mi.warn("onCapture is deprecated. Please use `before_send` instead"),
        this.on("eventCaptured", (t2) => this.config._onCapture(t2.event, t2))),
      this.config.ip &&
        mi.warn(
          'The `ip` config option has NO EFFECT AT ALL and has been deprecated. Use a custom transformation or "Discard IP data" project setting instead. See https://posthog.com/tutorials/web-redact-properties#hiding-customer-ip-address for more information.',
        ),
      this.config.disableDeviceModel ||
        (function () {
          return _a.apply(this, arguments);
        })()
          .then((t2) => {
            t2 && this.register({ [Ti]: t2 });
          })
          .catch(za),
      this
    );
  }
  Hn() {
    var t2,
      e2,
      i2,
      r2,
      s2,
      n2,
      o2 =
        null !== (t2 = null == (e2 = this.config.__extensionClasses) ? void 0 : e2.featureFlags) &&
        void 0 !== t2
          ? t2
          : null == (i2 = tl.__defaultExtensionClasses)
            ? void 0
            : i2.featureFlags;
    o2 &&
      ((this.featureFlags && this.featureFlags instanceof o2) ||
        (null == (r2 = this.Wn) || r2.call(this),
        (this.Wn = void 0),
        (this.featureFlags = new o2(this))),
      V(this.featureFlags.onReloading) && V(this.featureFlags.setup)
        ? this.Wn ||
          ((this.Wn = this.featureFlags.onReloading(() => {
            this._n.emit("featureFlagsReloading", true);
          })),
          this.Vn().add(this.featureFlags))
        : null == (s2 = (n2 = this.featureFlags).initialize) || s2.call(n2));
  }
  Un(t2) {
    var e2,
      i2,
      r2,
      s2,
      n2,
      o2,
      a2,
      l2 = performance.now(),
      u2 = _({}, tl.__defaultExtensionClasses, this.config.__extensionClasses),
      h2 = [];
    (u2.exceptions &&
      this.pn.push(
        (this.exceptions =
          null !== (e2 = this.exceptions) && void 0 !== e2 ? e2 : new u2.exceptions(this)),
      ),
      u2.historyAutocapture &&
        this.pn.push((this.historyAutocapture = new u2.historyAutocapture(this))),
      u2.tracingHeaders && this.pn.push((this.tracingHeaders = new u2.tracingHeaders(this))),
      u2.siteApps && this.pn.push((this.siteApps = new u2.siteApps(this))),
      u2.sessionRecording &&
        !t2 &&
        this.pn.push((this.sessionRecording = new u2.sessionRecording(this))),
      this.config.disable_scroll_properties ||
        h2.push(() => {
          this.scrollManager.startMeasuringScrollPosition();
        }),
      u2.autocapture && this.pn.push((this.autocapture = new u2.autocapture(this))),
      u2.surveys &&
        this.pn.push(
          (this.surveys =
            null !== (i2 = this.surveys) && void 0 !== i2 ? i2 : new u2.surveys(this)),
        ),
      u2.logs &&
        this.pn.push(
          (this.logs = null !== (r2 = this.logs) && void 0 !== r2 ? r2 : new u2.logs(this)),
        ),
      u2.metrics &&
        this.pn.push(
          (this.metrics =
            null !== (s2 = this.metrics) && void 0 !== s2 ? s2 : new u2.metrics(this)),
        ),
      u2.conversations &&
        this.pn.push(
          (this.conversations =
            null !== (n2 = this.conversations) && void 0 !== n2 ? n2 : new u2.conversations(this)),
        ),
      u2.productTours && this.pn.push((this.productTours = new u2.productTours(this))),
      u2.heatmaps && this.pn.push((this.heatmaps = new u2.heatmaps(this))),
      u2.webVitalsAutocapture &&
        this.pn.push((this.webVitalsAutocapture = new u2.webVitalsAutocapture(this))),
      u2.exceptionObserver &&
        this.pn.push((this.exceptionObserver = new u2.exceptionObserver(this))),
      u2.deadClicksAutocapture &&
        this.pn.push((this.deadClicksAutocapture = new u2.deadClicksAutocapture(this, on))),
      u2.toolbar &&
        this.pn.push(
          (this.toolbar =
            null !== (o2 = this.toolbar) && void 0 !== o2 ? o2 : new u2.toolbar(this)),
        ),
      u2.experiments &&
        this.pn.push(
          (this.experiments =
            null !== (a2 = this.experiments) && void 0 !== a2 ? a2 : new u2.experiments(this)),
        ),
      this.pn.forEach((t3) => {
        t3.initialize &&
          h2.push(() => {
            null == t3.initialize || t3.initialize();
          });
      }),
      h2.push(() => {
        if (this.Zn) {
          var t3 = this.Zn;
          ((this.Zn = void 0),
            this.pn.forEach((e3) => (null == e3.onRemoteConfig ? void 0 : e3.onRemoteConfig(t3))));
        }
      }),
      this.Gn(h2, l2));
  }
  Gn(t2, e2) {
    for (; t2.length > 0;) {
      if (
        this.config.__preview_deferred_init_extensions &&
        performance.now() - e2 >= 30 &&
        t2.length > 0
      )
        return void setTimeout(() => {
          this.Gn(t2, e2);
        }, 0);
      var i2 = t2.shift();
      if (i2)
        try {
          i2();
        } catch (t3) {
          mi.error("Error initializing extension:", t3);
        }
    }
    var r2 = Math.round(performance.now() - e2);
    (this.register_for_session({
      [xr]: this.config.__preview_deferred_init_extensions ? "deferred" : "synchronous",
      [Sr]: r2,
    }),
      this.config.__preview_deferred_init_extensions &&
        mi.info("PostHog extensions initialized (" + r2 + "ms)"));
  }
  Yi(t2) {
    var e2;
    if (!r || !r.body)
      return (
        mi.info("document not ready yet, trying again in 500 milliseconds..."),
        void setTimeout(() => {
          this.Yi(t2);
        }, 500)
      );
    if (
      (this.config.__preview_deferred_init_extensions && (this.Zn = t2),
      (this.bn = t2),
      (this.compression = void 0),
      t2.ok)
    ) {
      var i2,
        s2 = t2.config;
      (s2.supportedCompression &&
        !this.config.disable_compression &&
        (this.compression = N(s2.supportedCompression, Hn.GZipJS)
          ? Hn.GZipJS
          : N(s2.supportedCompression, Hn.Base64)
            ? Hn.Base64
            : void 0),
        null != (i2 = s2.analytics) &&
          i2.endpoint &&
          (this.analyticsDefaultEndpoint = s2.analytics.endpoint));
    }
    (this.set_config({ person_profiles: this.An ? this.An : Cr }),
      null == (e2 = this.Qn) || e2.handleRemoteConfig(t2),
      this.pn.forEach((e3) => (null == e3.onRemoteConfig ? void 0 : e3.onRemoteConfig(t2))));
  }
  zn() {
    try {
      this.config.loaded(this);
    } catch (t3) {
      mi.critical("`loaded` function failed", t3);
    }
    if ((this.Kn(), this.config.internal_or_test_user_hostname && null != s && s.hostname)) {
      var t2 = s.hostname,
        e2 = this.config.internal_or_test_user_hostname;
      ("string" == typeof e2 ? t2 === e2 : e2.test(t2)) && this.setInternalOrTestUser();
    }
    (this.config.capture_pageview &&
      setTimeout(() => {
        (this.consent.isOptedIn() || this.Cn()) && this.Jn();
      }, 1),
      (this.Yn = new lo(this)),
      this.Yn.load());
  }
  Kn() {
    var t2;
    this.is_capturing() && this.config.request_batching && (null == (t2 = this.Nn) || t2.enable());
  }
  _dom_loaded() {
    (this.is_capturing() && Ur(this.__request_queue, (t2) => this.qn(t2)),
      (this.__request_queue = []),
      this.Kn());
  }
  _handle_unload() {
    var t2, e2, i2, r2, s2;
    (null == (t2 = this.surveys) || null == t2.handlePageUnload || t2.handlePageUnload(),
      null == (e2 = this.metrics) || e2.flush("sendBeacon"),
      this.config.request_batching
        ? (this.Xn() && this.capture(Mr),
          null == (i2 = this.logs) || i2.flushLogs("sendBeacon"),
          null == (r2 = this.Nn) || r2.unload(),
          null == (s2 = this.jn) || s2.unload())
        : this.Xn() && this.capture(Mr, null, { transport: "sendBeacon" }));
  }
  _send_request(t2) {
    this.__loaded
      ? Ja
        ? this.__request_queue.push(t2)
        : this.rateLimiter.isServerRateLimited(t2.batchKey)
          ? t2.fireCallbackOnDrop && (null == t2.callback || t2.callback({ statusCode: 429 }))
          : ((t2.transport = t2.transport || this.config.api_transport),
            (t2.headers = _({}, this.config.request_headers, t2.headers)),
            (t2.compression =
              "best-available" === t2.compression ? this.compression : t2.compression),
            (K(this.config.disable_beacon)
              ? this.config.__preview_disable_beacon
              : this.config.disable_beacon) && (t2.disableTransport = ["sendBeacon"]),
            (t2.fetchOptions = t2.fetchOptions || this.config.fetch_options),
            ((t3) => {
              var e2,
                i2,
                r2,
                s2 = _({}, t3);
              s2.timeout = s2.timeout || 6e4;
              var n2,
                o2,
                a2,
                u2,
                h2,
                d2 = null !== (e2 = s2.transport) && void 0 !== e2 ? e2 : "fetch";
              ("sendBeacon" === d2 && K(s2.compression) && s2.data && (s2.compression = Hn.Base64),
                "POST" === s2.method &&
                  s2.data &&
                  ("capture-body" === s2.timestampMode
                    ? (s2.data = {
                        api_key:
                          null !==
                            (o2 =
                              null ==
                                (h2 = (u2 = (H((n2 = s2.data)) ? n2 : [n2]).map((t4) =>
                                  _(
                                    {},
                                    t4,
                                    t4.timestamp instanceof Date && !isNaN(t4.timestamp.getTime())
                                      ? { timestamp: t4.timestamp.toISOString() }
                                      : {},
                                  ),
                                ))[0]) || null == (a2 = h2.properties)
                                ? void 0
                                : a2.token) && void 0 !== o2
                            ? o2
                            : null == h2
                              ? void 0
                              : h2.token,
                        batch: u2,
                        sent_at: /* @__PURE__ */ new Date().toISOString(),
                      })
                    : "body" === s2.timestampMode &&
                      (s2.data = (function (t4, e3) {
                        return (
                          void 0 === e3 && (e3 = /* @__PURE__ */ new Date().toISOString()),
                          H(t4)
                            ? t4.map((t5) => _({}, t5, { sent_at: e3 }))
                            : _({}, t4, { sent_at: e3 })
                        );
                      })(s2.data))),
                (s2.url = ia(s2.url, s2.method, s2.compression, s2.timestampMode)));
              var v2 = ra.filter(
                  (t4) =>
                    !s2.disableTransport ||
                    !t4.transport ||
                    !s2.disableTransport.includes(t4.transport),
                ),
                c2 =
                  null !==
                    (i2 =
                      null ==
                      (r2 = (function (t4, e3) {
                        for (var i3 = 0; t4.length > i3; i3++)
                          if (t4[i3].transport === d2) return t4[i3];
                      })(v2))
                        ? void 0
                        : r2.method) && void 0 !== i2
                    ? i2
                    : v2[0].method;
              if (!c2) throw new Error("No available transport method");
              var f2 = (t4) => {
                try {
                  c2(t4);
                } catch (t5) {
                  (Zo(t5) ? mi.warn(t5) : mi.error(t5),
                    null == s2.callback || s2.callback({ statusCode: 0, error: t5 }));
                }
              };
              "sendBeacon" !== d2 &&
              s2.data &&
              s2.compression === Hn.GZipJS &&
              l &&
              "undefined" != typeof Promise &&
              !Vo
                ? Qo(s2)
                    .then((t4) => {
                      f2(t4);
                    })
                    .catch((e3) => {
                      if (C(e3))
                        return (
                          (Vo = true),
                          void f2(
                            _({}, s2, {
                              compression: void 0,
                              url: ia(t3.url, t3.method, void 0, t3.timestampMode),
                            }),
                          )
                        );
                      (((t4) => {
                        if (!t4 || "object" != typeof t4) return false;
                        var e4 = "name" in t4 ? String(t4.name) : "";
                        return C(t4) || e4 === R;
                      })(e3) && (Vo = true),
                        f2(s2));
                    })
                : c2(s2);
            })(
              _({}, t2, {
                callback: (e2) => {
                  var i2, r2;
                  (this.rateLimiter.checkForLimiting(e2),
                    400 > e2.statusCode ||
                      null == (i2 = (r2 = this.config).on_request_error) ||
                      i2.call(r2, e2),
                    null == t2.callback || t2.callback(e2));
                },
              }),
            ))
      : t2.fireCallbackOnDrop && (null == t2.callback || t2.callback({ statusCode: 0 }));
  }
  qn(t2) {
    this.jn ? this.jn.retriableRequest(t2) : this._send_request(t2);
  }
  _execute_array(t2) {
    Ba++;
    try {
      var e2,
        i2 = [],
        r2 = [],
        s2 = [];
      Ur(t2, (t3) => {
        if (t3)
          if (H((e2 = t3[0]))) s2.push(t3);
          else if (V(t3))
            try {
              t3.call(this);
            } catch (e3) {
              mi.error("Error executing queued PostHog call", t3, e3);
            }
          else
            H(t3) && "alias" === e2
              ? i2.push(t3)
              : H(t3) && -1 !== e2.indexOf("capture") && V(this[e2])
                ? s2.push(t3)
                : r2.push(t3);
      });
      var n2 = function (t3, e3) {
        Ur(t3, function (t4) {
          try {
            if (H(t4[0])) {
              var i3 = e3;
              Lr(t4, function (t5) {
                i3 = i3[t5[0]].apply(i3, t5.slice(1));
              });
            } else e3[t4[0]].apply(e3, t4.slice(1));
          } catch (e4) {
            mi.error("Error executing queued PostHog call", t4, e4);
          }
        });
      };
      (n2(i2, this), n2(r2, this), n2(s2, this));
    } finally {
      Ba--;
    }
  }
  push(t2) {
    if (Ba > 0 && H(t2) && J(t2[0])) {
      var e2 = tl.prototype[t2[0]];
      V(e2) && e2.apply(this, t2.slice(1));
    } else this._execute_array([t2]);
  }
  capture(t2, e2, i2) {
    var r2, s2, n2, o2, a2;
    if (this.__loaded && this.persistence && this.sessionPersistence && this.Nn) {
      if (this.is_capturing())
        if (!K(t2) && J(t2)) {
          var l2 = !this.config.opt_out_useragent_filter && this._is_bot();
          if (!l2 || this.config.__preview_capture_bot_pageviews) {
            var u2 =
              null != i2 && i2.skip_client_rate_limiting
                ? void 0
                : this.rateLimiter.clientRateLimitContext();
            if (null == u2 || !u2.isRateLimited) {
              (null != e2 &&
                e2.$current_url &&
                !J(null == e2 ? void 0 : e2.$current_url) &&
                (mi.error(
                  "Invalid `$current_url` property provided to `posthog.capture`. Input must be a string. Ignoring provided value.",
                ),
                null == e2 || delete e2.$current_url),
                "$exception" !== t2 ||
                  (null != i2 && i2.ts) ||
                  mi.warn(
                    "Using `posthog.capture('$exception')` is unreliable because it does not attach required metadata. Use `posthog.captureException(error)` instead, which attaches required metadata automatically.",
                  ),
                this.sessionPersistence.update_search_keyword(),
                this.config.save_campaign_params &&
                  this.sessionPersistence.update_campaign_params(),
                this.config.save_referrer && this.sessionPersistence.update_referrer_info(),
                (this.config.save_campaign_params || this.config.save_referrer) &&
                  this.persistence.set_initial_person_info());
              var h2 = /* @__PURE__ */ new Date(),
                d2 = (null == i2 ? void 0 : i2.timestamp) || h2,
                v2 = be(null == i2 ? void 0 : i2.uuid, es),
                c2 = {
                  uuid: v2,
                  event: t2,
                  properties: this.calculateEventProperties(t2, e2 || {}, d2, v2),
                };
              (t2 === Fr &&
                this.config.__preview_capture_bot_pageviews &&
                l2 &&
                ((c2.event = "$bot_pageview"), (c2.properties.$browser_type = "bot")),
                u2 && (c2.properties.$lib_rate_limit_remaining_tokens = u2.remainingTokens));
              var f2 =
                "$feature_flag_called" === t2 &&
                false === c2.properties.$feature_flag_has_experiment &&
                true === this.get_property(Zi);
              (null == i2 ? void 0 : i2.$set) && !f2 && (c2.$set = null == i2 ? void 0 : i2.$set);
              var p2 = null == i2 ? void 0 : i2.$unset;
              p2 && (c2.$unset = p2);
              var g2,
                m2,
                y2,
                b2 = f2
                  ? void 0
                  : this.es(null == i2 ? void 0 : i2.$set_once, t2 !== Nr, t2 === Dr);
              if (
                (b2 && (c2.$set_once = b2),
                (null != i2 && i2._noTruncate) ||
                  ((s2 = this.config.properties_string_max_length),
                  (n2 = c2),
                  (o2 = (t3) => (J(t3) ? t3.slice(0, s2) : t3)),
                  (a2 = /* @__PURE__ */ new Set()),
                  (c2 = (function t3(e3, i3) {
                    if (e3 !== Object(e3)) return o2 ? o2(e3) : e3;
                    if (!a2.has(e3)) {
                      var r3;
                      if ((a2.add(e3), H(e3)))
                        ((r3 = []),
                          Ur(e3, (e4) => {
                            r3.push(t3(e4));
                          }));
                      else {
                        var s3 = {};
                        (Lr(e3, (e4, i4) => {
                          a2.has(e4) || (s3[i4] = t3(e4));
                        }),
                          (r3 = s3));
                      }
                      return r3;
                    }
                  })(n2))),
                (c2.timestamp = d2),
                K(null == i2 ? void 0 : i2.timestamp) ||
                  ((c2.properties.$event_time_override_provided = true),
                  (c2.properties.$event_time_override_system_time = h2)),
                f2 &&
                  (c2.properties = (function (t3, e3) {
                    void 0 === e3 && (e3 = []);
                    var i3 = {},
                      r3 = (e4) => {
                        void 0 !== t3[e4] && (i3[e4] = t3[e4]);
                      };
                    return (E.forEach(r3), e3.forEach(r3), i3);
                  })(c2.properties, Ga)),
                t2 === Zn.DISMISSED || t2 === Zn.SENT)
              ) {
                var w2 = null == e2 ? void 0 : e2[to.SURVEY_ID],
                  x2 = null == e2 ? void 0 : e2[to.SURVEY_ITERATION];
                (Oa({ id: w2, current_iteration: x2 }),
                  (c2.$set = _({}, c2.$set, {
                    [((g2 = { id: w2, current_iteration: x2 }),
                    (m2 = t2 === Zn.SENT ? "responded" : "dismissed"),
                    (y2 = "$survey_" + m2 + "/" + g2.id),
                    g2.current_iteration &&
                      g2.current_iteration > 0 &&
                      (y2 = "$survey_" + m2 + "/" + g2.id + "/" + g2.current_iteration),
                    y2)]: true,
                  })));
              } else
                t2 === Zn.SHOWN &&
                  (c2.$set = _({}, c2.$set, {
                    [to.SURVEY_LAST_SEEN_DATE]: /* @__PURE__ */ new Date().toISOString(),
                  }));
              if (t2 === ro.SHOWN) {
                var S2 = null == e2 ? void 0 : e2[so.TOUR_TYPE];
                S2 &&
                  (c2.$set = _({}, c2.$set, {
                    [so.TOUR_LAST_SEEN_DATE + "/" + S2]: /* @__PURE__ */ new Date().toISOString(),
                  }));
              }
              var k2 = _({}, c2.properties.$set, c2.$set);
              if ((G(k2) || this.setPersonPropertiesForFlags(k2), !X(this.config.before_send))) {
                var T2 = this.At(c2);
                if (!T2) return;
                (c2 = T2).uuid = be(c2.uuid, es);
              }
              this._n.emit("eventCaptured", c2);
              var R2 =
                  null !== (r2 = null == i2 ? void 0 : i2._url) && void 0 !== r2
                    ? r2
                    : this.requestRouter.endpointFor("api", this.analyticsDefaultEndpoint),
                P2 = {
                  method: "POST",
                  url: R2,
                  data: c2,
                  compression: "best-available",
                  timestampMode:
                    "recordings" === (null == i2 ? void 0 : i2._batchKey) ||
                    /\/s\/(?:\?|$)/.test(R2)
                      ? "body"
                      : "capture-body",
                  batchKey: null == i2 ? void 0 : i2._batchKey,
                  transport: null == i2 ? void 0 : i2.transport,
                };
              return (
                !this.config.request_batching ||
                (i2 && (null == i2 || !i2._batchKey)) ||
                (null != i2 && i2.send_instantly)
                  ? this.qn(P2)
                  : this.Nn.enqueue(P2),
                c2
              );
            }
            mi.critical("This capture call is ignored due to client rate limiting.");
          }
        } else mi.error("No event name provided to posthog.capture");
    } else mi.uninitializedWarning("posthog.capture");
  }
  _addCaptureHook(t2) {
    return this.on("eventCaptured", (e2) => t2(e2.event, e2));
  }
  Vn() {
    var t2;
    return null !== (t2 = this.Qn) && void 0 !== t2 ? t2 : (this.Qn = new La(this));
  }
  kn(t2) {
    this.In.push(t2);
    var e2 = true;
    return () => {
      if (e2) {
        e2 = false;
        var i2 = this.In.indexOf(t2);
        -1 !== i2 && this.In.splice(i2, 1);
      }
    };
  }
  calculateEventProperties(e2, i2, n2, o2, a2) {
    if (((n2 = n2 || /* @__PURE__ */ new Date()), !this.persistence || !this.sessionPersistence))
      return i2;
    var l2 = a2 ? void 0 : this.persistence.remove_event_timer(e2),
      h2 = _({}, i2);
    if (
      ((h2.token = this.config.token),
      (h2.$config_defaults = this.config.defaults),
      this.Cn() && (h2[Er] = true),
      "$snapshot" === e2)
    ) {
      var d2 = _({}, this.persistence.properties(), this.sessionPersistence.properties());
      return (
        (h2.distinct_id = d2.distinct_id),
        ((!J(h2.distinct_id) && !Z(h2.distinct_id)) || Y(h2.distinct_id)) &&
          mi.error(
            "Invalid distinct_id for replay event. This indicates a bug in your implementation",
          ),
        h2
      );
    }
    var v2,
      f2 = (function (e3, i3, r2, n3) {
        var o3, a3, l3, h3;
        if ((void 0 === n3 && (n3 = false), !u)) return {};
        var d3,
          v3 = e3 ? [...$n, ...(i3 || [])] : [],
          f3 = (function (t2) {
            for (var e4 = 0; ge.length > e4; e4++) {
              var i4 = ge[e4],
                r3 = i4[1],
                s2 = i4[0].exec(t2),
                n4 = s2 && (V(r3) ? r3(s2, t2) : r3);
              if (n4) return n4;
            }
            return ["", ""];
          })(u),
          p3 = f3[0],
          _2 = f3[1],
          g3 =
            null != (d3 = "undefined" != typeof navigator ? navigator : void 0) && d3.brave
              ? { brave: true }
              : {},
          m3 = {};
        K(r2) || (m3.detectGoogleSearchApp = r2);
        var y3 = {},
          b3 = null == (o3 = navigator) || null == (o3 = o3.userAgentData) ? void 0 : o3.platform,
          w3 = null == (a3 = navigator) ? void 0 : a3.maxTouchPoints,
          E3 = null == t || null == (l3 = t.screen) ? void 0 : l3.width,
          x3 = null == t || null == (h3 = t.screen) ? void 0 : h3.height,
          S3 = null == t ? void 0 : t.devicePixelRatio;
        (K(b3) || (y3.userAgentDataPlatform = b3),
          K(w3) || (y3.maxTouchPoints = w3),
          K(E3) || (y3.screenWidth = E3),
          K(x3) || (y3.screenHeight = x3),
          K(S3) || (y3.devicePixelRatio = S3));
        var k3,
          T2,
          R2,
          P2,
          O2,
          C2,
          I2,
          A2,
          F2 = jr(
            Hr({
              $os: p3,
              $os_version: _2,
              $browser: fe(u, navigator.vendor, g3, m3),
              $device: me(u),
              $device_type:
                ((T2 = u),
                (R2 = y3),
                (A2 = me(T2)),
                A2 === bt || A2 === yt || "Kobo" === A2 || "Kindle Fire" === A2 || A2 === Yt
                  ? mt
                  : A2 === Lt || A2 === Bt || A2 === jt || A2 === Gt
                    ? "Console"
                    : A2 === Et
                      ? "Wearable"
                      : A2
                        ? pt
                        : "Android" === (null == R2 ? void 0 : R2.userAgentDataPlatform) &&
                            (null !== (P2 = null == R2 ? void 0 : R2.maxTouchPoints) &&
                            void 0 !== P2
                              ? P2
                              : 0) > 0
                          ? 600 >
                            Math.min(
                              null !== (O2 = null == R2 ? void 0 : R2.screenWidth) && void 0 !== O2
                                ? O2
                                : 0,
                              null !== (C2 = null == R2 ? void 0 : R2.screenHeight) && void 0 !== C2
                                ? C2
                                : 0,
                            ) /
                              (null !== (I2 = null == R2 ? void 0 : R2.devicePixelRatio) &&
                              void 0 !== I2
                                ? I2
                                : 1)
                            ? pt
                            : mt
                          : "Desktop"),
              $timezone: Nn(),
              $timezone_offset: Un(),
            }),
            {
              $current_url: bn(
                n3 ? we(null == s ? void 0 : s.href) : null == s ? void 0 : s.href,
                v3,
                Tn,
              ),
              $host: null == s ? void 0 : s.host,
              $pathname: null == s ? void 0 : s.pathname,
              $raw_user_agent: u.length > 1e3 ? u.substring(0, 997) + "..." : u,
              $browser_version: _e(u, navigator.vendor, g3, m3),
              $browser_language: In(),
              $browser_language_prefix:
                ((k3 = In()), "string" == typeof k3 ? k3.split("-")[0] : void 0),
              $screen_height: null == t ? void 0 : t.screen.height,
              $screen_width: null == t ? void 0 : t.screen.width,
              $viewport_height: null == t ? void 0 : t.innerHeight,
              $viewport_width: null == t ? void 0 : t.innerWidth,
              $lib: c.LIB_NAME,
              $lib_version: c.LIB_VERSION,
              $insert_id:
                Math.random().toString(36).substring(2, 10) +
                Math.random().toString(36).substring(2, 10),
              $time: Date.now() / 1e3,
            },
          );
        return (c.SDK_DIST_CHANNEL && (F2.$sdk_dist_channel = c.SDK_DIST_CHANNEL), F2);
      })(
        this.config.mask_personal_data_properties,
        this.config.custom_personal_data_properties,
        this.config.detect_google_search_app,
        this.config.disable_capture_url_hashes,
      );
    if (this.sessionManager) {
      var p2 = this.sessionManager.checkAndGetSessionAndWindowId(a2, n2.getTime()),
        g2 = p2.windowId;
      ((h2.$session_id = p2.sessionId), (h2.$window_id = g2));
    }
    this.sessionPropsManager && jr(h2, this.sessionPropsManager.getSessionProps());
    try {
      var m2;
      (this.sessionRecording && jr(h2, this.sessionRecording.sdkDebugProperties),
        (h2.$sdk_debug_retry_queue_size = null == (m2 = this.jn) ? void 0 : m2.length));
    } catch (t2) {
      h2.$sdk_debug_error_capturing_properties = String(t2);
    }
    if (
      (this.requestRouter.region === Ea && (h2.$lib_custom_api_host = this.config.api_host),
      (v2 =
        e2 !== Fr || a2
          ? e2 !== Mr || a2
            ? this.pageViewManager.doEvent()
            : this.pageViewManager.doPageLeave(n2)
          : this.pageViewManager.doPageView(n2, o2)),
      (h2 = jr(h2, v2)),
      e2 === Fr && r && (h2.title = r.title),
      !K(l2))
    ) {
      var y2 = n2.getTime() - l2;
      h2.$duration = parseFloat((y2 / 1e3).toFixed(3));
    }
    u &&
      this.config.opt_out_useragent_filter &&
      (h2.$browser_type = this._is_bot() ? "bot" : "browser");
    var b2 = this.persistence.properties(),
      w2 = this.sessionPersistence.properties();
    Lr(["$referrer", "$referring_domain"], (t2) => {
      t2 in b2 && delete w2[t2];
    });
    var E2 = {};
    if (this.In.length > 0)
      for (var x2 of this.In.slice())
        try {
          jr(E2, x2());
        } catch (t2) {
          mi.error("Failed to produce browser extension event properties", t2);
        }
    (((h2 = jr({}, f2, b2, w2, _({}, E2, h2))).$is_identified = this._isIdentified()),
      H(this.config.property_denylist)
        ? Lr(this.config.property_denylist, function (t2) {
            delete h2[t2];
          })
        : mi.error(
            Wa +
              this.config.property_denylist +
              " or property_blacklist config: " +
              this.config.property_blacklist,
          ));
    var S2 = this.config.sanitize_properties;
    S2 && (mi.error(Va), (h2 = S2(h2, e2)));
    var k2 = this.rs();
    return (
      (h2.$process_person_profile = k2),
      k2 && !a2 && this.ns("_calculate_event_properties"),
      h2
    );
  }
  es(t2, e2, i2) {
    var r2;
    if (
      (void 0 === e2 && (e2 = true), void 0 === i2 && (i2 = false), !this.persistence || !this.rs())
    )
      return t2;
    if (this.Mn && !i2) return t2;
    var s2 = this.persistence.get_initial_props(),
      n2 = null == (r2 = this.sessionPropsManager) ? void 0 : r2.getSetOnceProps(),
      o2 = jr({}, s2, n2 || {}, t2 || {}),
      a2 = this.config.sanitize_properties;
    return (
      a2 && (mi.error(Va), (o2 = a2(o2, "$set_once"))),
      e2 && (this.Mn = true),
      G(o2) ? void 0 : o2
    );
  }
  register(t2, e2) {
    var i2;
    null == (i2 = this.persistence) || i2.register(t2, e2);
  }
  register_once(t2, e2, i2) {
    var r2;
    null == (r2 = this.persistence) || r2.register_once(t2, e2, i2);
  }
  register_for_session(t2) {
    var e2;
    (null == (e2 = this.sessionPersistence) || e2.register(t2),
      Object.keys(t2).forEach((t3) => this.Tn.add(t3)),
      this.ss());
  }
  unregister(t2) {
    var e2;
    null == (e2 = this.persistence) || e2.unregister(t2);
  }
  unregister_for_session(t2) {
    var e2;
    (null == (e2 = this.sessionPersistence) || e2.unregister(t2), this.Tn.delete(t2), this.ss());
  }
  os(t2, e2) {
    this.register({ [t2]: e2 });
  }
  Bn() {
    (this.Tn.forEach((t2) => {
      var e2;
      null == (e2 = this.sessionPersistence) || e2.unregister(t2);
    }),
      this.Tn.clear(),
      this.ss());
  }
  ss() {
    var t2;
    if (this.En)
      if (
        "memory" === this.config.persistence ||
        (null != (t2 = this.sessionPersistence) && t2.Ei) ||
        !vs.N()
      )
        vs.q(this.En);
      else {
        var e2 = [];
        (this.Tn.forEach((t3) => e2.push(t3)), e2.length > 0 ? vs.F(this.En, e2) : vs.q(this.En));
      }
  }
  getFeatureFlag(t2, e2) {
    var i2;
    return null == (i2 = this.featureFlags) ? void 0 : i2.getFeatureFlag(t2, e2);
  }
  getFeatureFlagPayload(t2) {
    var e2;
    return null == (e2 = this.featureFlags) ? void 0 : e2.getFeatureFlagPayload(t2);
  }
  getFeatureFlagResult(t2, e2) {
    var i2;
    return null == (i2 = this.featureFlags) ? void 0 : i2.getFeatureFlagResult(t2, e2);
  }
  getAllFeatureFlags() {
    var t2, e2;
    return null !== (t2 = null == (e2 = this.featureFlags) ? void 0 : e2.getAllFeatureFlags()) &&
      void 0 !== t2
      ? t2
      : [];
  }
  isFeatureEnabled(t2, e2) {
    var i2, r2;
    return null !==
      (i2 = null == (r2 = this.featureFlags) ? void 0 : r2.isFeatureEnabled(t2, e2)) &&
      void 0 !== i2
      ? i2
      : null == e2
        ? void 0
        : e2.defaultValue;
  }
  reloadFeatureFlags() {
    var t2;
    null == (t2 = this.featureFlags) || t2.reloadFeatureFlags();
  }
  updateFlags(t2, e2, i2) {
    var r2;
    null == (r2 = this.featureFlags) || r2.updateFlags(t2, e2, i2);
  }
  updateEarlyAccessFeatureEnrollment(t2, e2, i2) {
    var r2;
    null == (r2 = this.featureFlags) || r2.updateEarlyAccessFeatureEnrollment(t2, e2, i2);
  }
  getEarlyAccessFeatures(t2, e2, i2) {
    var r2;
    return (
      void 0 === e2 && (e2 = false),
      null == (r2 = this.featureFlags) ? void 0 : r2.getEarlyAccessFeatures(t2, e2, i2)
    );
  }
  on(t2, e2) {
    return this._n.on(t2, e2);
  }
  onFeatureFlags(t2) {
    return this.featureFlags
      ? this.featureFlags.onFeatureFlags(t2)
      : (t2([], {}, { errorsLoading: true }), () => {});
  }
  onSurveysLoaded(t2) {
    return this.surveys
      ? this.surveys.onSurveysLoaded(t2)
      : (t2([], { isLoaded: false, error: Ha }), () => {});
  }
  onSessionId(t2) {
    var e2, i2;
    return null !== (e2 = null == (i2 = this.sessionManager) ? void 0 : i2.onSessionId(t2)) &&
      void 0 !== e2
      ? e2
      : () => {};
  }
  getSurveys(t2, e2) {
    (void 0 === e2 && (e2 = false),
      this.surveys ? this.surveys.getSurveys(t2, e2) : t2([], { isLoaded: false, error: Ha }));
  }
  getActiveMatchingSurveys(t2, e2) {
    (void 0 === e2 && (e2 = false),
      this.surveys
        ? this.surveys.getActiveMatchingSurveys(t2, e2)
        : t2([], { isLoaded: false, error: Ha }));
  }
  renderSurvey(t2, e2) {
    var i2;
    null == (i2 = this.surveys) || i2.renderSurvey(t2, e2);
  }
  displaySurvey(t2, e2) {
    var i2;
    (void 0 === e2 && (e2 = Ia), null == (i2 = this.surveys) || i2.displaySurvey(t2, e2));
  }
  cancelPendingSurvey(t2) {
    var e2;
    null == (e2 = this.surveys) || e2.cancelPendingSurvey(t2);
  }
  canRenderSurvey(t2) {
    var e2, i2;
    return null !== (e2 = null == (i2 = this.surveys) ? void 0 : i2.canRenderSurvey(t2)) &&
      void 0 !== e2
      ? e2
      : { visible: false, disabledReason: Ha };
  }
  canRenderSurveyAsync(t2, e2) {
    var i2, r2;
    return (
      void 0 === e2 && (e2 = false),
      null !== (i2 = null == (r2 = this.surveys) ? void 0 : r2.canRenderSurveyAsync(t2, e2)) &&
      void 0 !== i2
        ? i2
        : Promise.resolve({ visible: false, disabledReason: Ha })
    );
  }
  ls(t2) {
    return !t2 || Y(t2)
      ? (mi.critical("Unique user id has not been set in posthog.identify"), false)
      : t2 === wr
        ? (mi.critical(
            'The string "' +
              t2 +
              '" was set in posthog.identify which indicates an error. This ID is only used as a sentinel value.',
          ),
          false)
        : (!["distinct_id", "distinctid"].includes(t2.toLowerCase()) &&
            !["undefined", "null"].includes(t2.toLowerCase())) ||
          (mi.critical(
            'The string "' +
              t2 +
              '" was set in posthog.identify which indicates an error. This ID should be unique to the user and not a hardcoded string.',
          ),
          false);
  }
  identify(t2, e2, i2) {
    if (!this.__loaded || !this.persistence) return mi.uninitializedWarning("posthog.identify");
    if (
      (Z(t2) &&
        ((t2 = t2.toString()),
        mi.warn(
          "The first argument to posthog.identify was a number, but it should be a string. It has been converted to a string.",
        )),
      this.ls(t2) && this.ns("posthog.identify"))
    ) {
      var r2 = this.get_distinct_id();
      (this.register({ $user_id: t2 }),
        this.get_property(ki) ||
          this.register_once({ $had_persisted_distinct_id: true, $device_id: r2 }, ""),
        t2 !== r2 &&
          t2 !== this.get_property(Ri) &&
          (this.unregister(Ri), this.register({ distinct_id: t2 })));
      var s2,
        n2 = (this.persistence.get_property(fr) || Pr) === Pr,
        o2 = t2 !== r2,
        a2 = !o2 && n2;
      if (o2 && n2)
        (this.persistence.set_property(fr, Or),
          this.setPersonPropertiesForFlags({ $set: e2 || {}, $set_once: i2 || {} }, false),
          this.capture(
            Dr,
            { distinct_id: t2, $anon_distinct_id: r2 },
            { $set: e2 || {}, $set_once: i2 || {} },
          ),
          (this.Fn = ma(t2, e2, i2)),
          null == (s2 = this.featureFlags) || s2.setAnonymousDistinctId(r2));
      else if (a2) {
        this.persistence.set_property(fr, Or);
        var l2 = e2 || {},
          u2 = i2 || {};
        (this.setPersonPropertiesForFlags({ $set: l2, $set_once: u2 }, false),
          this.capture("$set", { $set: l2, $set_once: u2 }),
          (this.Fn = ma(t2, e2, i2)));
      } else (e2 || i2) && this.setPersonProperties(e2, i2);
      o2
        ? (this.reloadFeatureFlags(),
          this.featureFlags ? this.featureFlags.resetFlagCallReported() : this.unregister(hr))
        : a2 && (e2 || i2) && this.reloadFeatureFlags();
    }
  }
  setPersonProperties(t2, e2) {
    if ((t2 || e2) && this.ns("posthog.setPersonProperties")) {
      var i2 = ma(this.get_distinct_id(), t2, e2);
      this.Fn !== i2
        ? (this.setPersonPropertiesForFlags({ $set: t2 || {}, $set_once: e2 || {} }, true),
          this.capture("$set", { $set: t2 || {}, $set_once: e2 || {} }),
          (this.Fn = i2))
        : mi.info(
            "A duplicate setPersonProperties call was made with the same properties. It has been ignored.",
          );
    }
  }
  unsetPersonProperties(t2) {
    var e2,
      i2 = (H(t2) ? t2 : [t2]).filter((t3) => J(t3) && t3.length > 0);
    0 !== i2.length &&
      this.ns("posthog.unsetPersonProperties") &&
      (null == (e2 = this.featureFlags) || e2.unsetPersonPropertiesForFlags(i2, true),
      this.capture("$set", { $unset: i2 }),
      (this.Fn = null));
  }
  group(t2, e2, i2) {
    if (t2 && e2) {
      var r2 = this.getGroups(),
        s2 = r2[t2] !== e2;
      if (
        (s2 && this.resetGroupPropertiesForFlags(t2),
        this.register({ $groups: _({}, r2, { [t2]: e2 }) }),
        s2 || i2)
      ) {
        var n2 = { $group_type: t2, $group_key: e2 };
        (i2 && (n2.$group_set = i2), this.capture(Nr, n2));
      }
      (i2 && this.setGroupPropertiesForFlags({ [t2]: i2 }), s2 && !i2 && this.reloadFeatureFlags());
    } else mi.error("posthog.group requires a group type and group key");
  }
  resetGroups() {
    (this.register({ $groups: {} }),
      this.resetGroupPropertiesForFlags(),
      this.reloadFeatureFlags());
  }
  setPersonPropertiesForFlags(t2, e2) {
    var i2;
    (void 0 === e2 && (e2 = true),
      null == (i2 = this.featureFlags) || i2.setPersonPropertiesForFlags(t2, e2));
  }
  resetPersonPropertiesForFlags(t2) {
    var e2;
    (void 0 === t2 && (t2 = true),
      null == (e2 = this.featureFlags) || e2.resetPersonPropertiesForFlags(t2));
  }
  setGroupPropertiesForFlags(t2, e2) {
    var i2;
    (void 0 === e2 && (e2 = true),
      this.ns("posthog.setGroupPropertiesForFlags") &&
        (null == (i2 = this.featureFlags) || i2.setGroupPropertiesForFlags(t2, e2)));
  }
  resetGroupPropertiesForFlags(t2) {
    var e2;
    null == (e2 = this.featureFlags) || e2.resetGroupPropertiesForFlags(t2);
  }
  reset(t2) {
    var e2 = et(t2) ? t2 : null == t2 ? void 0 : t2.resetDeviceID,
      i2 = et(t2) || null == t2 ? void 0 : t2.bootstrap;
    this.us(e2, false, i2);
  }
  us(t2, e2, i2) {
    var r2, s2, n2, o2, a2, l2, u2, h2, d2, v2, c2, f2;
    if ((void 0 === e2 && (e2 = false), mi.info("reset"), !this.__loaded))
      return mi.uninitializedWarning("posthog.reset");
    var p2 = null == i2 ? void 0 : i2.sessionID;
    ((this.config.bootstrap = i2 || (null == (r2 = this.On) ? void 0 : r2.bootstrap) || {}),
      null == (s2 = this.featureFlags) ||
        null == s2.updateConfig ||
        s2.updateConfig(this.config, this.tr()));
    var g2,
      m2,
      y2,
      b2,
      w2 = this.get_property(ki),
      E2 = this.get_property(Ti),
      x2 = this.get_property(Li),
      S2 = this.is_capturing();
    if (
      (this.consent.reset(),
      e2 ||
        !S2 ||
        this.is_capturing() ||
        console.warn(
          "[PostHog.js]",
          "reset() cleared the stored consent, and capturing is now off because of `opt_out_capturing_by_default`. Call opt_in_capturing() again, and prefer calling reset() before opting in rather than after.",
        ),
      null == (n2 = this.persistence) || n2.clear(),
      null == (o2 = this.sessionPersistence) || o2.clear(),
      this.Tn.clear(),
      this.ss(),
      K(x2) || null == (g2 = this.persistence) || g2.register({ [Li]: x2 }),
      null == (a2 = this.surveys) || a2.reset(),
      null == (l2 = this.Yn) || l2.stop(),
      null == (u2 = this.featureFlags) || u2.reset(),
      null == (h2 = this.conversations) || h2.reset(),
      null == (d2 = this.logs) || d2.reset(),
      null == (v2 = this.metrics) || v2.reset(),
      null == (c2 = this.persistence) || c2.set_property(fr, Pr),
      null == (f2 = this.sessionManager) || f2.resetSessionId(),
      (this.Fn = null),
      this.config.cookieless_mode === Rr)
    )
      this.register_once({ distinct_id: wr, $device_id: null }, "");
    else {
      var k2 = this.config.get_device_id(es());
      (this.register_once({ distinct_id: k2, $device_id: t2 ? k2 : w2 }, ""),
        t2 || K(E2) || this.register({ [Ti]: E2 }));
    }
    if (
      (this.register({ $last_posthog_reset: /* @__PURE__ */ new Date().toISOString() }, 1), i2) &&
      (void 0 === i2.distinctID ||
        this.Cn() ||
        (null == (b2 = this.persistence) || b2.set_property(fr, i2.isIdentifiedID ? Or : Pr),
        this.register({ distinct_id: i2.distinctID })),
      null == (m2 = this.featureFlags) || m2.initialize(),
      !(K(p2) || (null != (y2 = this.sessionManager) && y2.setBootstrapSessionId(p2, true))))
    ) {
      var T2 = _({}, i2);
      (delete T2.sessionID, (this.config.bootstrap = T2));
    }
    (delete this.config.identity_distinct_id,
      delete this.config.identity_hash,
      this.reloadFeatureFlags());
  }
  shutdown(t2) {
    var e2 = this;
    return p(function* () {
      var t3, i2, r2, s2, n2, o2, a2;
      if (e2.__loaded) {
        (null == (t3 = e2.Yn) || t3.stop(),
          null == (i2 = e2.Qn) || i2.dispose(),
          null == (r2 = e2.sessionRecording) || r2.dispose(),
          null == (s2 = e2.logs) || s2.flushLogs("sendBeacon"),
          null == (n2 = e2.metrics) || n2.flush("sendBeacon"),
          null == (o2 = e2.Nn) || o2.unload(),
          null == (a2 = e2.jn) || a2.unload());
        try {
          var l2;
          null == (l2 = e2.featureFlags) || l2.destroy();
        } catch (t4) {
          mi.error("Error while destroying feature flags", t4);
        }
      } else mi.uninitializedWarning("posthog.shutdown");
    })();
  }
  setIdentity(t2, e2) {
    var i2;
    ((this.config.identity_distinct_id = t2),
      (this.config.identity_hash = e2),
      this.alias(t2),
      null == (i2 = this.conversations) || i2.hs());
  }
  clearIdentity() {
    var t2;
    (delete this.config.identity_distinct_id,
      delete this.config.identity_hash,
      null == (t2 = this.conversations) || t2.ds());
  }
  get_distinct_id() {
    return this.get_property("distinct_id");
  }
  getGroups() {
    return this.get_property("$groups") || {};
  }
  get_session_id() {
    var t2, e2;
    return null !==
      (t2 =
        null == (e2 = this.sessionManager)
          ? void 0
          : e2.checkAndGetSessionAndWindowId(true).sessionId) && void 0 !== t2
      ? t2
      : "";
  }
  get_session_replay_url(t2) {
    if (!this.sessionManager) return "";
    var e2 = this.sessionManager.checkAndGetSessionAndWindowId(true),
      i2 = e2.sessionStartTimestamp,
      r2 = this.requestRouter.endpointFor(
        "ui",
        "/project/" + this.config.token + "/replay/" + e2.sessionId,
      );
    if (null != t2 && t2.withTimestamp && i2) {
      var s2,
        n2 = null !== (s2 = t2.timestampLookBack) && void 0 !== s2 ? s2 : 10;
      if (!i2) return r2;
      r2 += "?t=" + Math.max(Math.floor((/* @__PURE__ */ new Date().getTime() - i2) / 1e3) - n2, 0);
    }
    return r2;
  }
  alias(t2, e2) {
    return t2 === this.get_property($i)
      ? (mi.critical("Attempting to create alias for existing People user - aborting."), -2)
      : this.ns("posthog.alias")
        ? (K(e2) && (e2 = this.get_distinct_id()),
          t2 !== e2
            ? (this.os(Ri, t2), this.capture("$create_alias", { alias: t2, distinct_id: e2 }))
            : (mi.warn("alias matches current distinct_id - skipping api call."),
              this.identify(t2),
              -1))
        : void 0;
  }
  set_config(t2) {
    var e2 = _({}, this.config);
    if (W(t2)) {
      var i2, r2, s2, n2, o2, a2, l2, u2, h2, d2, v2, f2;
      jr(this.config, Xa(t2));
      var p2 = this.$n();
      (null == (i2 = this.persistence) || i2.update_config(this.config, e2, p2),
        (this.sessionPersistence =
          "sessionStorage" === this.config.persistence || "memory" === this.config.persistence
            ? this.persistence
            : new zn(_({}, this.config, { persistence: "sessionStorage" }), p2, false)));
      var g2 = this.Ln(this.config.debug);
      (et(g2) && (this.config.debug = g2),
        et(this.config.debug) &&
          (this.config.debug
            ? ((c.DEBUG = true),
              as.N() && as.F("ph_debug", true),
              mi.info("set_config", { config: t2, oldConfig: e2, newConfig: _({}, this.config) }))
            : ((c.DEBUG = false), as.N() && as.q("ph_debug"))),
        null == (r2 = this.featureFlags) ||
          null == r2.updateConfig ||
          r2.updateConfig(this.config, this.tr()),
        null == (s2 = this.exceptionObserver) || s2.onConfigChange(),
        null == (n2 = this.exceptions) || n2.onConfigChange(),
        null == (o2 = this.sessionRecording) || o2.startIfEnabledOrStop(),
        null == (a2 = this.tracingHeaders) || a2.startIfEnabledOrStop(),
        null == (l2 = this.autocapture) || l2.startIfEnabled(),
        null == (u2 = this.heatmaps) || u2.startIfEnabled(),
        null == (h2 = this.exceptionObserver) || h2.startIfEnabledOrStop(),
        null == (d2 = this.deadClicksAutocapture) || d2.startIfEnabledOrStop(),
        null == (v2 = this.surveys) || v2.loadIfEnabled(),
        this.vs(),
        null == (f2 = this.externalIntegrations) || f2.startIfEnabledOrStop());
    }
  }
  _overrideSDKInfo(t2, e2) {
    ((c.LIB_NAME = t2), (c.LIB_VERSION = e2));
  }
  startSessionRecording(t2) {
    var e2,
      i2,
      r2,
      s2,
      n2,
      o2 = true === t2,
      a2 = {
        sampling: o2 || !(null == t2 || !t2.sampling),
        linked_flag: o2 || !(null == t2 || !t2.linked_flag),
        url_trigger: o2 || !(null == t2 || !t2.url_trigger),
        event_trigger: o2 || !(null == t2 || !t2.event_trigger),
      };
    Object.values(a2).some(Boolean) &&
      (null == (e2 = this.sessionManager) || e2.checkAndGetSessionAndWindowId(),
      a2.sampling && (null == (i2 = this.sessionRecording) || i2.overrideSampling()),
      a2.linked_flag && (null == (r2 = this.sessionRecording) || r2.overrideLinkedFlag()),
      a2.url_trigger && (null == (s2 = this.sessionRecording) || s2.overrideTrigger("url")),
      a2.event_trigger && (null == (n2 = this.sessionRecording) || n2.overrideTrigger("event")));
    this.set_config({ disable_session_recording: false });
  }
  stopSessionRecording() {
    this.set_config({ disable_session_recording: true });
  }
  sessionRecordingStarted() {
    var t2;
    return !(null == (t2 = this.sessionRecording) || !t2.started);
  }
  captureException(t2, e2) {
    if (this.exceptions) {
      var i2 = new Error("PostHog syntheticException"),
        r2 = this.exceptions.buildProperties(t2, { handled: true, syntheticException: i2 });
      return this.exceptions.sendExceptionEvent(_({}, r2, e2));
    }
  }
  addExceptionStep(t2, e2) {
    var i2;
    null == (i2 = this.exceptions) || i2.addExceptionStep(t2, e2);
  }
  captureLog(t2) {
    var e2;
    null == (e2 = this.logs) || e2.captureLog(t2);
  }
  get logger() {
    var t2, e2;
    return null !== (t2 = null == (e2 = this.logs) ? void 0 : e2.logger) && void 0 !== t2
      ? t2
      : tl.cs;
  }
  startExceptionAutocapture(t2) {
    this.set_config({ capture_exceptions: null == t2 || t2 });
  }
  stopExceptionAutocapture() {
    this.set_config({ capture_exceptions: false });
  }
  loadToolbar(t2) {
    var e2, i2;
    return (
      null !== (e2 = null == (i2 = this.toolbar) ? void 0 : i2.loadToolbar(t2)) &&
      void 0 !== e2 &&
      e2
    );
  }
  get_property(t2) {
    var e2;
    return null == (e2 = this.persistence) ? void 0 : e2.props[t2];
  }
  getSessionProperty(t2) {
    var e2;
    return null == (e2 = this.sessionPersistence) ? void 0 : e2.props[t2];
  }
  toString() {
    var t2,
      e2 = null !== (t2 = this.config.name) && void 0 !== t2 ? t2 : Ka;
    return (e2 !== Ka && (e2 = Ka + "." + e2), e2);
  }
  _isIdentified() {
    var t2, e2;
    return (
      (null == (t2 = this.persistence) ? void 0 : t2.get_property(fr)) === Or ||
      (null == (e2 = this.sessionPersistence) ? void 0 : e2.get_property(fr)) === Or
    );
  }
  rs() {
    var t2, e2;
    return !(
      "never" === this.config.person_profiles ||
      (this.config.person_profiles === Cr &&
        !this._isIdentified() &&
        G(this.getGroups()) &&
        (null == (t2 = this.persistence) || null == (t2 = t2.props) || !t2[Ri]) &&
        (null == (e2 = this.persistence) || null == (e2 = e2.props) || !e2[br]))
    );
  }
  Xn() {
    return (
      true === this.config.capture_pageleave ||
      ("if_capture_pageview" === this.config.capture_pageleave &&
        (true === this.config.capture_pageview ||
          "history_change" === this.config.capture_pageview))
    );
  }
  createPersonProfile() {
    this.rs() || (this.ns("posthog.createPersonProfile") && this.setPersonProperties({}, {}));
  }
  setInternalOrTestUser() {
    this.ns("posthog.setInternalOrTestUser") &&
      this.setPersonProperties({ $internal_or_test_user: true });
  }
  ns(t2) {
    return "never" === this.config.person_profiles
      ? (mi.error(
          t2 + ' was called, but process_person is set to "never". This call will be ignored.',
        ),
        false)
      : (this.os(br, true), true);
  }
  $n() {
    if ("always" === this.config.cookieless_mode) return true;
    var t2 = this.consent.isOptedOut();
    return (
      this.config.disable_persistence ||
      (t2 && !(!this.config.opt_out_persistence_by_default && this.config.cookieless_mode !== Tr))
    );
  }
  vs() {
    var t2,
      e2,
      i2,
      r2,
      s2 = this.$n();
    return (
      (null == (t2 = this.persistence) ? void 0 : t2.Ei) !== s2 &&
        (null == (i2 = this.persistence) || i2.set_disabled(s2)),
      (null == (e2 = this.sessionPersistence) ? void 0 : e2.Ei) !== s2 &&
        (null == (r2 = this.sessionPersistence) || r2.set_disabled(s2)),
      s2 && (this.Tn.clear(), this.ss()),
      s2
    );
  }
  opt_in_capturing(t2) {
    var e2;
    if (this.config.cookieless_mode !== Rr) {
      if (this.Cn()) {
        var i2, r2, s2, n2, o2;
        (this.us(true, true),
          null == (i2 = this.sessionManager) || i2.destroy(),
          null == (r2 = this.pageViewManager) || r2.destroy(),
          (this.sessionManager = new fa(this)),
          (this.pageViewManager = new vn(this)),
          this.persistence &&
            (this.sessionPropsManager = new ha(this, this.sessionManager, this.persistence)));
        var a2,
          l2 =
            null !==
              (s2 = null == (n2 = this.config.__extensionClasses) ? void 0 : n2.sessionRecording) &&
            void 0 !== s2
              ? s2
              : null == (o2 = tl.__defaultExtensionClasses)
                ? void 0
                : o2.sessionRecording;
        l2 &&
          ((this.sessionRecording = this.Sn(this.sessionRecording, new l2(this))),
          this.bn &&
            (null == (a2 = this.sessionRecording) ||
              null == a2.onRemoteConfig ||
              a2.onRemoteConfig(this.bn)));
      }
      var u2, h2;
      (this.consent.optInOut(true),
        this.vs(),
        this.Kn(),
        null == (e2 = this.sessionRecording) || e2.startIfEnabledOrStop(),
        this.config.cookieless_mode == Tr && (null == (u2 = this.surveys) || u2.loadIfEnabled()),
        (K(null == t2 ? void 0 : t2.captureEventName) || (null != t2 && t2.captureEventName)) &&
          this.capture(
            null !== (h2 = null == t2 ? void 0 : t2.captureEventName) && void 0 !== h2
              ? h2
              : "$opt_in",
            null == t2 ? void 0 : t2.captureProperties,
            { send_instantly: true },
          ),
        this.config.capture_pageview && this.Jn());
    } else mi.warn(qa);
  }
  opt_out_capturing() {
    var t2, e2, i2;
    this.config.cookieless_mode !== Rr
      ? (this.config.cookieless_mode === Tr && this.consent.isOptedIn() && this.us(true, true),
        this.consent.optInOut(false),
        this.vs(),
        this.config.cookieless_mode === Tr &&
          (this.register({ distinct_id: wr, $device_id: null }),
          null == (t2 = this.sessionRecording) || t2.stopRecording(),
          (this.sessionRecording = void 0),
          null == (e2 = this.sessionManager) || e2.destroy(),
          null == (i2 = this.pageViewManager) || i2.destroy(),
          (this.sessionManager = void 0),
          (this.sessionPropsManager = void 0),
          this.config.capture_pageview && this.Jn(),
          this.Kn()))
      : mi.warn(qa);
  }
  has_opted_in_capturing() {
    return this.consent.isOptedIn();
  }
  has_opted_out_capturing() {
    return this.consent.isOptedOut();
  }
  get_explicit_consent_status() {
    var t2 = this.consent.consent;
    return 1 === t2 ? "granted" : 0 === t2 ? "denied" : "pending";
  }
  is_capturing() {
    return (
      this.config.cookieless_mode === Rr ||
      (this.config.cookieless_mode === Tr
        ? this.consent.isRejected() || this.consent.isOptedIn()
        : !this.has_opted_out_capturing())
    );
  }
  clear_opt_in_out_capturing() {
    (this.consent.reset(), this.vs());
  }
  _is_bot() {
    return i ? pa(i, this.config.custom_blocked_useragents) : void 0;
  }
  Jn() {
    r &&
      ("visible" === r.visibilityState
        ? this.Pn ||
          ((this.Pn = true),
          this.capture(Fr, { title: r.title }, { send_instantly: true }),
          this.Rn && (r.removeEventListener(Ir, this.Rn), (this.Rn = null)))
        : this.Rn || ((this.Rn = this.Jn.bind(this)), Gr(r, Ir, this.Rn)));
  }
  debug(e2) {
    false === e2
      ? (null == t || t.console.log("You've disabled debug mode."),
        this.set_config({ debug: false }))
      : (null == t ||
          t.console.log(
            "You're now in debug mode. All calls to PostHog will be logged in your console.\nYou can disable this with `posthog.debug(false)`.",
          ),
        this.set_config({ debug: true }));
  }
  tr() {
    var t2 = this.On || {};
    return "advanced_disable_flags" in t2
      ? !!t2.advanced_disable_flags
      : false !== this.config.advanced_disable_flags
        ? !!this.config.advanced_disable_flags
        : true === this.config.advanced_disable_decide
          ? (mi.warn(
              "Config field 'advanced_disable_decide' is deprecated. Please use 'advanced_disable_flags' instead. The old field will be removed in a future major version.",
            ),
            true)
          : (function (t3, e2, i2, r2, s2) {
              var n2 = e2 in t3 && !X(t3[e2]),
                o2 = i2 in t3 && !X(t3[i2]);
              return n2
                ? t3[e2]
                : !!o2 &&
                    (s2 &&
                      s2.warn(
                        "Config field '" +
                          i2 +
                          "' is deprecated. Please use '" +
                          e2 +
                          "' instead. The old field will be removed in a future major version.",
                      ),
                    t3[i2]);
            })(t2, "advanced_disable_flags", "advanced_disable_decide", 0, mi);
  }
  At(t2) {
    var e2;
    if (X(this.config.before_send)) return t2;
    var i2 = Object.keys(null !== (e2 = t2.properties) && void 0 !== e2 ? e2 : {}).filter(st),
      r2 = H(this.config.before_send) ? this.config.before_send : [this.config.before_send],
      s2 = t2;
    for (var n2 of r2) {
      if (((s2 = n2(s2)), X(s2))) {
        var o2 = "Event '" + t2.event + "' was rejected in beforeSend function";
        return (
          rt(t2.event) ? mi.warn(o2 + ". This can cause unexpected behavior.") : mi.info(o2),
          null
        );
      }
      (s2.properties && !G(s2.properties)) ||
        mi.warn(
          "Event '" +
            t2.event +
            "' has no properties after beforeSend function, this is likely an error.",
        );
    }
    for (var a2 of i2)
      if (s2.properties && X(s2.properties[a2]))
        return (
          mi.warn(
            "Event '" +
              t2.event +
              "' had its '" +
              a2 +
              "' property removed in a beforeSend function. This property is required for ingestion, so the event will be dropped.",
          ),
          null
        );
    return s2;
  }
  getPageViewId() {
    var t2;
    return null == (t2 = this.pageViewManager.fi) ? void 0 : t2.pageViewId;
  }
  captureTraceFeedback(t2, e2) {
    this.capture("$ai_feedback", { $ai_trace_id: String(t2), $ai_feedback_text: e2 });
  }
  captureTraceMetric(t2, e2, i2) {
    this.capture("$ai_metric", {
      $ai_trace_id: String(t2),
      $ai_metric_name: e2,
      $ai_metric_value: String(i2),
    });
  }
  Ln(t2) {
    var e2 = et(t2) && !t2,
      i2 = as.N() && "true" === as.P("ph_debug");
    return !e2 && (!!i2 || t2);
  }
}
((tl.__defaultExtensionClasses = {}),
  (tl.cs = /* @__PURE__ */ (() => {
    var t2 = () => {};
    return { trace: t2, debug: t2, info: t2, warn: t2, error: t2, fatal: t2 };
  })()),
  (function (t2, e2) {
    for (var i2 = 0; e2.length > i2; i2++) t2.prototype[e2[i2]] = qr(t2.prototype[e2[i2]]);
  })(tl, ["identify"]));
class el {
  constructor(t2) {
    this.disabled = false === t2;
    var e2 = W(t2) ? t2 : {};
    ((this.thresholdPx = e2.threshold_px || 30),
      (this.timeoutMs = e2.timeout_ms || 1e3),
      (this.clickCount = e2.click_count || 3),
      (this.clicks = []));
  }
  isRageClick(t2, e2, i2) {
    if (this.disabled) return false;
    var r2 = this.clicks[this.clicks.length - 1];
    if (
      r2 &&
      Math.abs(t2 - r2.x) + Math.abs(e2 - r2.y) < this.thresholdPx &&
      this.timeoutMs > i2 - r2.timestamp
    ) {
      if (
        (this.clicks.push({ x: t2, y: e2, timestamp: i2 }), this.clicks.length === this.clickCount)
      )
        return true;
    } else this.clicks = [{ x: t2, y: e2, timestamp: i2 }];
    return false;
  }
}
var il = "$copy_autocapture",
  rl = yi("[AutoCapture]");
function sl(t2, e2) {
  return e2.length > t2 ? e2.slice(0, t2) + "..." : e2;
}
function nl(t2) {
  if (t2.previousElementSibling) return t2.previousElementSibling;
  var e2 = t2;
  do {
    e2 = e2.previousSibling;
  } while (e2 && !bs(e2));
  return e2;
}
function ol(e2, i2) {
  var r2,
    s2,
    n2 = i2.e,
    o2 = i2.maskAllElementAttributes,
    a2 = i2.maskAllText,
    l2 = i2.elementAttributeIgnoreList,
    u2 = i2.elementsChainAsString,
    h2 = i2.disableCaptureUrlHashes;
  if (!bs(e2)) return { props: {} };
  for (
    var d2 = [e2], v2 = /* @__PURE__ */ new Set([e2]), c2 = e2;
    c2.parentNode && !ws(c2, "body") && Ss > d2.length;
  )
    if (xs(c2.parentNode)) {
      var f2 = c2.parentNode.host;
      if (v2.has(f2)) break;
      (v2.add(f2), d2.push(f2), (c2 = f2));
    } else {
      if (!bs(c2.parentNode)) break;
      if (v2.has(c2.parentNode)) break;
      (v2.add(c2.parentNode), d2.push(c2.parentNode), (c2 = c2.parentNode));
    }
  var p2,
    g2,
    m2 = [],
    y2 = {},
    b2 = false,
    w2 = false;
  if (
    (Lr(d2, (t2) => {
      var e3 = qs(t2);
      if (ws(t2, "a")) {
        var i3 = t2.getAttribute("href");
        b2 = !!(e3 && i3 && Xs(i3)) && (h2 ? we(i3) : i3);
      }
      (N(Ts(t2), "ph-no-capture") && (w2 = true),
        m2.push(
          (function (t3, e4, i4, r4, s3) {
            void 0 === s3 && (s3 = false);
            var n3 = t3.tagName.toLowerCase(),
              o3 = { tag_name: n3 };
            Cs.indexOf(n3) > -1 &&
              !i4 &&
              (o3.$el_text =
                "a" === n3.toLowerCase() || "button" === n3.toLowerCase()
                  ? sl(1024, Zs(t3))
                  : sl(1024, Ps(t3)));
            var a3 = Ts(t3);
            (a3.length > 0 &&
              (o3.classes = a3.filter(function (t4) {
                return "" !== t4;
              })),
              Lr(t3.attributes, function (i5) {
                var n4;
                if (
                  (!Hs(t3) || -1 !== ["name", "id", "class", "aria-label"].indexOf(i5.name)) &&
                  (null == r4 || !r4.includes(i5.name)) &&
                  !e4 &&
                  Xs(i5.value) &&
                  (!J((n4 = i5.name)) ||
                    ("_ngcontent" !== n4.substring(0, 10) && "_nghost" !== n4.substring(0, 7)))
                ) {
                  var a4 = i5.value;
                  ("class" === i5.name && (a4 = $s(a4).join(" ")),
                    (o3["attr__" + i5.name] = sl(1024, "href" === i5.name && s3 ? we(a4) : a4)));
                }
              }));
            for (var l3 = 1, u3 = 1, h3 = t3; (h3 = nl(h3));)
              (l3++, h3.tagName === t3.tagName && u3++);
            return ((o3.nth_child = l3), (o3.nth_of_type = u3), o3);
          })(t2, o2, a2, l2, h2),
        ));
      var r3 = (function (t3) {
        if (!qs(t3)) return {};
        var e4 = {};
        return (
          Lr(t3.attributes, function (t4) {
            if (t4.name && 0 === t4.name.indexOf("data-ph-capture-attribute")) {
              var i4 = t4.name.replace("data-ph-capture-attribute-", ""),
                r4 = t4.value;
              i4 && r4 && Xs(r4) && (e4[i4] = r4);
            }
          }),
          e4
        );
      })(t2);
      jr(y2, r3);
    }),
    w2)
  )
    return { props: {}, explicitNoCapture: w2 };
  if ((a2 || (m2[0].$el_text = ws(e2, "a") || ws(e2, "button") ? Zs(e2) : Ps(e2)), b2)) {
    var E2, x2;
    m2[0].attr__href = b2;
    var S2 = null == (E2 = mn(b2)) ? void 0 : E2.host,
      k2 = null == t || null == (x2 = t.location) ? void 0 : x2.host;
    S2 && k2 && S2 !== k2 && (p2 = b2);
  }
  return {
    props: jr(
      { $event_type: n2.type, $ce_version: 1 },
      u2 ? {} : { $elements: m2 },
      {
        $elements_chain:
          ((g2 = m2),
          (function (t2) {
            return t2
              .map((t3) => {
                var e3,
                  i3,
                  r3 = "";
                if ((t3.tag_name && (r3 += t3.tag_name), t3.attr_class))
                  for (var s3 of (t3.attr_class.sort(), t3.attr_class))
                    r3 += "." + s3.replace(/"/g, "");
                var n3 = _(
                    {},
                    t3.text ? { text: t3.text } : {},
                    {
                      "nth-child": null !== (e3 = t3.nth_child) && void 0 !== e3 ? e3 : 0,
                      "nth-of-type": null !== (i3 = t3.nth_of_type) && void 0 !== i3 ? i3 : 0,
                    },
                    t3.href ? { href: t3.href } : {},
                    t3.attr_id ? { attr_id: t3.attr_id } : {},
                    t3.attributes,
                  ),
                  o3 = {};
                return (
                  Br(n3)
                    .sort((t4, e4) => t4[0].localeCompare(e4[0]))
                    .forEach((t4) => {
                      var e4 = t4[1];
                      return (o3[en(t4[0].toString())] = en(e4.toString()));
                    }),
                  (r3 += ":") +
                    Br(o3)
                      .map((t4) => t4[0] + '="' + t4[1] + '"')
                      .join("")
                );
              })
              .join(";");
          })(
            (function (t2) {
              return t2.map((t3) => {
                var e3,
                  i3,
                  r3 = {
                    text: null == (e3 = t3.$el_text) ? void 0 : e3.slice(0, 400),
                    tag_name: t3.tag_name,
                    href: null == (i3 = t3.attr__href) ? void 0 : i3.slice(0, 2048),
                    attr_class: rn(t3),
                    attr_id: t3.attr__id,
                    nth_child: t3.nth_child,
                    nth_of_type: t3.nth_of_type,
                    attributes: {},
                  };
                return (
                  Br(t3)
                    .filter((t4) => 0 === t4[0].indexOf("attr__"))
                    .forEach((t4) => (r3.attributes[t4[0]] = t4[1])),
                  r3
                );
              });
            })(g2),
          )),
      },
      null != (r2 = m2[0]) && r2.$el_text
        ? { $el_text: null == (s2 = m2[0]) ? void 0 : s2.$el_text }
        : {},
      p2 && "click" === n2.type ? { $external_click_url: p2 } : {},
      y2,
    ),
  };
}
var al = yi("[ExceptionAutocapture]"),
  ll = () => {},
  ul = yi("[TracingHeaders]"),
  hl = yi("[Web Vitals]"),
  dl = 9e5,
  vl = "disabled",
  cl = "lazy_loading",
  fl = "awaiting_config",
  pl = "missing_config";
(yi("[SessionRecording]"), yi("[SessionRecording]"));
var _l = "[SessionRecording]",
  gl = yi(_l),
  ml = yi("[Heatmaps]");
function yl(t2) {
  return W(t2) && "clientX" in t2 && "clientY" in t2 && Z(t2.clientX) && Z(t2.clientY);
}
var bl = yi("[Product Tours]"),
  wl = (t2) => {
    var e2;
    return (
      !t2.config.disable_product_tours && !(null == (e2 = t2.persistence) || !e2.get_property(Ni))
    );
  },
  El = ["$set_once", "$set"],
  xl = yi("[SiteApps]"),
  Sl = "Error while initializing PostHog app with config id ";
function $l(t2, e2, i2) {
  if (X(t2)) return false;
  switch (i2) {
    case "exact":
      return t2 === e2;
    case "contains":
      var r2 = e2
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/_/g, ".")
        .replace(/%/g, ".*");
      return new RegExp(r2, "i").test(t2);
    case "regex":
      try {
        return new RegExp(e2).test(t2);
      } catch (t3) {
        return false;
      }
    default:
      return false;
  }
}
class kl {
  constructor(t2) {
    ((this.fs = new da()),
      (this.ps = (t3, e2) =>
        this.gs(t3, e2) && this.ys(t3, e2) && this.bs(t3, e2) && this._s(t3, e2)),
      (this.gs = (t3, e2) =>
        null == e2 ||
        !e2.event ||
        (null == t3 ? void 0 : t3.event) === (null == e2 ? void 0 : e2.event)),
      (this._instance = t2),
      (this.ws = /* @__PURE__ */ new Set()),
      (this.ks = /* @__PURE__ */ new Set()));
  }
  init() {
    var t2, e2;
    K(null == (t2 = this._instance) ? void 0 : t2._addCaptureHook) ||
      null == (e2 = this._instance) ||
      e2._addCaptureHook((t3, e3) => {
        this.on(t3, e3);
      });
  }
  register(t2) {
    var e2, i2;
    if (
      !K(null == (e2 = this._instance) ? void 0 : e2._addCaptureHook) &&
      (t2.forEach((t3) => {
        var e3, i3;
        (null == (e3 = this.ks) || e3.add(t3),
          null == (i3 = t3.steps) ||
            i3.forEach((t4) => {
              var e4;
              null == (e4 = this.ws) || e4.add((null == t4 ? void 0 : t4.event) || "");
            }));
      }),
      null != (i2 = this._instance) && i2.autocapture)
    ) {
      var r2,
        s2 = /* @__PURE__ */ new Set();
      (t2.forEach((t3) => {
        var e3;
        null == (e3 = t3.steps) ||
          e3.forEach((t4) => {
            null != t4 && t4.selector && s2.add(null == t4 ? void 0 : t4.selector);
          });
      }),
        null == (r2 = this._instance) || r2.autocapture.setElementSelectors(s2));
    }
  }
  on(t2, e2) {
    var i2;
    null != e2 &&
      0 != t2.length &&
      (this.ws.has(t2) || this.ws.has(e2.event)) &&
      this.ks &&
      (null == (i2 = this.ks) ? void 0 : i2.size) > 0 &&
      this.ks.forEach((t3) => {
        this.xs(e2, t3) && this.fs.emit("actionCaptured", t3.name);
      });
  }
  Ss(t2) {
    this.onAction("actionCaptured", (e2) => t2(e2));
  }
  xs(t2, e2) {
    if (null == (null == e2 ? void 0 : e2.steps)) return false;
    for (var i2 of e2.steps) if (this.ps(t2, i2)) return true;
    return false;
  }
  onAction(t2, e2) {
    return this.fs.on(t2, e2);
  }
  ys(t2, e2) {
    if (null != e2 && e2.url) {
      var i2,
        r2 = null == t2 || null == (i2 = t2.properties) ? void 0 : i2.$current_url;
      if (!r2 || "string" != typeof r2) return false;
      if (!$l(r2, e2.url, e2.url_matching || "contains")) return false;
    }
    return true;
  }
  bs(t2, e2) {
    return !!this.Cs(t2, e2) && !!this.Ms(t2, e2) && !!this.Ts(t2, e2);
  }
  Cs(t2, e2) {
    var i2;
    if (null == e2 || !e2.href) return true;
    var r2 = this.Es(t2);
    if (r2.length > 0) return r2.some((t3) => $l(t3.href, e2.href, e2.href_matching || "exact"));
    var s2,
      n2 = (null == t2 || null == (i2 = t2.properties) ? void 0 : i2.$elements_chain) || "";
    return (
      !!n2 &&
      $l((s2 = n2.match(/(?::|")href="(.*?)"/)) ? s2[1] : "", e2.href, e2.href_matching || "exact")
    );
  }
  Ms(t2, e2) {
    var i2;
    if (null == e2 || !e2.text) return true;
    var r2 = this.Es(t2);
    if (r2.length > 0)
      return r2.some(
        (t3) =>
          $l(t3.text, e2.text, e2.text_matching || "exact") ||
          $l(t3.$el_text, e2.text, e2.text_matching || "exact"),
      );
    var s2,
      n2,
      o2,
      a2 = (null == t2 || null == (i2 = t2.properties) ? void 0 : i2.$elements_chain) || "";
    return (
      !!a2 &&
      ((s2 = (function (t3) {
        for (var e3, i3 = [], r3 = /(?::|")text="(.*?)"/g; !X((e3 = r3.exec(t3)));)
          i3.includes(e3[1]) || i3.push(e3[1]);
        return i3;
      })(a2)),
      (n2 = e2.text),
      (o2 = e2.text_matching || "exact"),
      s2.some((t3) => $l(t3, n2, o2)))
    );
  }
  Ts(t2, e2) {
    var i2, r2;
    if (null == e2 || !e2.selector) return true;
    var s2 = null == t2 || null == (i2 = t2.properties) ? void 0 : i2.$element_selectors;
    if (null != s2 && s2.includes(e2.selector)) return true;
    var n2 = (null == t2 || null == (r2 = t2.properties) ? void 0 : r2.$elements_chain) || "";
    if (e2.selector_regex && n2)
      try {
        return new RegExp(e2.selector_regex).test(n2);
      } catch (t3) {
        return false;
      }
    return false;
  }
  Es(t2) {
    var e2;
    return null == (null == t2 || null == (e2 = t2.properties) ? void 0 : e2.$elements)
      ? []
      : null == t2
        ? void 0
        : t2.properties.$elements;
  }
  _s(t2, e2) {
    return (
      null == e2 ||
      !e2.properties ||
      0 === e2.properties.length ||
      wa(
        e2.properties.reduce((t3, e3) => {
          var i2 = H(e3.value) ? e3.value.map(String) : null != e3.value ? [String(e3.value)] : [];
          return ((t3[e3.key] = { values: i2, operator: e3.operator || "exact" }), t3);
        }, {}),
        null == t2 ? void 0 : t2.properties,
      )
    );
  }
}
class Tl {
  constructor(t2) {
    var e2;
    ((this.Is = []),
      (this._instance = t2),
      (this.Ps = /* @__PURE__ */ new Map()),
      (this.Rs = /* @__PURE__ */ new Map()),
      (this.As = /* @__PURE__ */ new Map()),
      null == (e2 = this._instance) ||
        null == e2.onSessionId ||
        e2.onSessionId((t3) => this.Fs(t3)));
  }
  Ls(t2) {
    return false;
  }
  Os() {
    return null;
  }
  Ds(t2) {}
  $s() {}
  Ns(t2, e2) {
    return !!t2 && wa(t2.propertyFilters, null == e2 ? void 0 : e2.properties);
  }
  qs(t2, e2) {
    var i2 = /* @__PURE__ */ new Map();
    return (
      t2.forEach((t3) => {
        var r2;
        null == (r2 = t3.conditions) ||
          null == (r2 = r2[e2]) ||
          null == (r2 = r2.values) ||
          r2.forEach((e3) => {
            if (null != e3 && e3.name) {
              var r3 = i2.get(e3.name) || [];
              (r3.push(t3.id), i2.set(e3.name, r3));
            }
          });
      }),
      i2
    );
  }
  js(t2, e2, i2) {
    var r2 = (i2 === Vn.Activation ? this.Ps : this.Rs).get(t2),
      s2 = [];
    return (
      this.Bs((t3) => {
        s2 = t3.filter((t4) => (null == r2 ? void 0 : r2.includes(t4.id)));
      }),
      s2.filter((r3) => {
        var s3,
          n2 =
            null == (s3 = r3.conditions) || null == (s3 = s3[i2]) || null == (s3 = s3.values)
              ? void 0
              : s3.find((e3) => e3.name === t2);
        return this.Ns(n2, e2);
      })
    );
  }
  register(t2) {
    var e2;
    K(null == (e2 = this._instance) ? void 0 : e2._addCaptureHook) || (this.Hs(t2), this.Us(t2));
  }
  Us(t2) {
    var e2 = t2.filter((t3) => {
      var e3, i2;
      return (
        (null == (e3 = t3.conditions) ? void 0 : e3.actions) &&
        (null == (i2 = t3.conditions) || null == (i2 = i2.actions) || null == (i2 = i2.values)
          ? void 0
          : i2.length) > 0
      );
    });
    0 !== e2.length &&
      (null == this.zs &&
        ((this.zs = new kl(this._instance)),
        this.zs.init(),
        this.zs.Ss((t3) => {
          this.onAction(t3);
        })),
      e2.forEach((t3) => {
        var e3, i2, r2, s2, n2;
        t3.conditions &&
          null != (e3 = t3.conditions) &&
          e3.actions &&
          null != (i2 = t3.conditions) &&
          null != (i2 = i2.actions) &&
          i2.values &&
          (null == (r2 = t3.conditions) || null == (r2 = r2.actions) || null == (r2 = r2.values)
            ? void 0
            : r2.length) > 0 &&
          (null == (s2 = this.zs) || s2.register(t3.conditions.actions.values),
          null == (n2 = t3.conditions) ||
            null == (n2 = n2.actions) ||
            null == (n2 = n2.values) ||
            n2.forEach((e4) => {
              if (e4 && e4.name) {
                var i3 = this.As.get(e4.name);
                (i3 && i3.push(t3.id), this.As.set(e4.name, i3 || [t3.id]));
              }
            }));
      }));
  }
  Hs(t2) {
    var e2,
      i2 = t2.filter((t3) => {
        var e3, i3;
        return (
          (null == (e3 = t3.conditions) ? void 0 : e3.events) &&
          (null == (i3 = t3.conditions) || null == (i3 = i3.events) || null == (i3 = i3.values)
            ? void 0
            : i3.length) > 0
        );
      }),
      r2 = t2.filter((t3) => {
        var e3, i3;
        return (
          (null == (e3 = t3.conditions) ? void 0 : e3.cancelEvents) &&
          (null == (i3 = t3.conditions) ||
          null == (i3 = i3.cancelEvents) ||
          null == (i3 = i3.values)
            ? void 0
            : i3.length) > 0
        );
      });
    (0 === i2.length && 0 === r2.length) ||
      (null == (e2 = this._instance) ||
        e2._addCaptureHook((t3, e3) => {
          this.onEvent(t3, e3);
        }),
      (this.Ps = this.qs(t2, Vn.Activation)),
      (this.Rs = this.qs(t2, Vn.Cancellation)));
  }
  onEvent(t2, e2) {
    var i2,
      r2,
      s2 = this.Ws(),
      n2 =
        (null == e2 || null == (i2 = e2.properties) ? void 0 : i2.$survey_id) ||
        (null == e2 || null == (r2 = e2.properties) ? void 0 : r2.$product_tour_id);
    if (n2 && this.getActivatedIds().includes(n2)) {
      var o2 = this.Vs(t2, n2);
      if ("consume" === o2)
        return (
          s2.info("event consumed activated item, removing it", { event: t2, itemId: n2 }),
          void this.Zs([n2])
        );
      if ("persist" === o2)
        return (
          s2.info("shown item promoted to persisted activation", { event: t2, itemId: n2 }),
          this.Gs(n2),
          void this.Qs([n2])
        );
    }
    if (this.Rs.has(t2)) {
      var a2 = this.js(t2, e2, Vn.Cancellation);
      a2.length > 0 &&
        (s2.info("cancel event matched, cancelling items", {
          event: t2,
          itemsToCancel: a2.map((t3) => t3.id),
        }),
        this.Zs(a2.map((t3) => t3.id)),
        a2.forEach((t3) => this.Ks(t3.id)));
    }
    if (this.Ps.has(t2)) {
      s2.info("event name matched", { event: t2, eventPayload: e2, items: this.Ps.get(t2) });
      var l2 = this.js(t2, e2, Vn.Activation);
      this.Js(l2.map((t3) => t3.id));
    }
  }
  onAction(t2) {
    this.As.has(t2) && this.Js(this.As.get(t2) || []);
  }
  Js(t2) {
    var e2;
    if (0 !== t2.length) {
      var i2 = !(
          null == (e2 = this._instance) ||
          null == e2.get_session_id ||
          !e2.get_session_id()
        ),
        r2 = [];
      for (var s2 of t2) i2 && this.Ls(s2) ? this.Gs(s2) && this.Ys(s2) : r2.push(s2);
      (r2.length > 0 && (this.Is = [.../* @__PURE__ */ new Set([...this.Is, ...r2])]),
        this.Ws().info("updating activated items", { activatedItems: this.getActivatedIds() }));
    }
  }
  Gs(t2) {
    this.Is = this.Is.filter((e3) => e3 !== t2);
    var e2 = this.Xs();
    return !e2.includes(t2) && (this.ta([...e2, t2]), this.ea(), true);
  }
  Zs(t2) {
    var e2 = new Set(t2);
    this.Is = this.Is.filter((t3) => !e2.has(t3));
    var i2 = this.ia(),
      r2 = i2.filter((t3) => !e2.has(t3));
    (r2.length !== i2.length && (this.ta(r2), 0 === r2.length && this.ra()), this.Qs(t2));
  }
  na() {
    var t2,
      e2 = this.Os();
    if (!e2) return {};
    var i2 = null == (t2 = this._instance) || null == (t2 = t2.persistence) ? void 0 : t2.props[e2];
    return i2 && "object" == typeof i2 ? i2 : {};
  }
  Ys(t2) {
    if (this.Os()) {
      var e2 = this.na();
      this.Ds(_({}, e2, { [t2]: Date.now() }));
    }
  }
  Qs(t2) {
    if (this.Os()) {
      var e2 = this.na(),
        i2 = {},
        r2 = false;
      for (var s2 of Object.entries(e2)) {
        var n2 = s2[0],
          o2 = s2[1];
        t2.includes(n2) ? (r2 = true) : (i2[n2] = o2);
      }
      r2 && (G(i2) ? this.$s() : this.Ds(i2));
    }
  }
  sa() {
    this.Os() && this.$s();
  }
  getActivationTimestamp(t2) {
    if (this.Xs().includes(t2)) {
      var e2 = this.na()[t2];
      return Z(e2) ? e2 : void 0;
    }
  }
  ia() {
    var t2,
      e2 = this.aa();
    return (
      (null == (t2 = this._instance) || null == (t2 = t2.persistence) ? void 0 : t2.props[e2]) || []
    );
  }
  Xs() {
    var t2,
      e2,
      i2 = this.ia();
    if (0 === i2.length) return [];
    var r2 =
        null == (t2 = this._instance) || null == (t2 = t2.persistence)
          ? void 0
          : t2.props[this.oa()],
      s2 =
        null == (e2 = this._instance) || null == e2.get_session_id ? void 0 : e2.get_session_id();
    return s2 && r2 === s2 ? i2 : [];
  }
  ea() {
    var t2,
      e2 =
        null == (t2 = this._instance) || null == t2.get_session_id ? void 0 : t2.get_session_id();
    e2 && this.la(e2);
  }
  ra() {
    this.ua();
  }
  Fs(t2) {
    var e2,
      i2 =
        null == (e2 = this._instance) || null == (e2 = e2.persistence)
          ? void 0
          : e2.props[this.oa()];
    if (i2 && i2 !== t2) {
      var r2 = this.ia(),
        s2 = this.na();
      (r2.length > 0 && (this.ta([]), r2.filter((t3) => Z(s2[t3])).forEach((t3) => this.Ks(t3))),
        this.ra(),
        this.sa());
    }
  }
  getActivatedIds() {
    return [.../* @__PURE__ */ new Set([...this.Xs(), ...this.Is])].filter((t2) => !this.ha(t2));
  }
  reset() {
    ((this.Is = []), this.ia().length > 0 && this.ta([]), this.ra(), this.sa());
  }
  getEventToItemsMap() {
    return this.Ps;
  }
  da() {
    return this.zs;
  }
}
class Rl extends Tl {
  constructor(t2) {
    super(t2);
  }
  aa() {
    return or;
  }
  oa() {
    return ar;
  }
  Os() {
    return lr;
  }
  Ds(t2) {
    var e2;
    null == (e2 = this._instance) || null == (e2 = e2.persistence) || e2.register({ [lr]: t2 });
  }
  $s() {
    var t2;
    null == (t2 = this._instance) || null == (t2 = t2.persistence) || t2.unregister(lr);
  }
  Ls(t2) {
    var e2, i2;
    this.Bs((e3) => {
      i2 = e3.find((e4) => e4.id === t2);
    });
    var r2 =
      null == (e2 = i2) || null == (e2 = e2.appearance) ? void 0 : e2.surveyPopupDelaySeconds;
    return Z(r2) && r2 > 0;
  }
  va() {
    return Zn.SHOWN;
  }
  Bs(t2) {
    var e2;
    null == (e2 = this._instance) || e2.getSurveys(t2);
  }
  Ks(t2) {
    var e2;
    null == (e2 = this._instance) || e2.cancelPendingSurvey(t2);
  }
  Ws() {
    return Ra;
  }
  ta(t2) {
    var e2;
    null == (e2 = this._instance) || null == (e2 = e2.persistence) || e2.register({ [or]: t2 });
  }
  la(t2) {
    var e2;
    null == (e2 = this._instance) || null == (e2 = e2.persistence) || e2.register({ [ar]: t2 });
  }
  ua() {
    var t2;
    null == (t2 = this._instance) || null == (t2 = t2.persistence) || t2.unregister(ar);
  }
  ha() {
    return false;
  }
  Vs(t2, e2) {
    var i2;
    this.Bs((t3) => {
      i2 = t3.find((t4) => t4.id === e2);
    });
    var r2 =
      !i2 ||
      (function (t3) {
        var e3;
        return (
          (Ta(t3) &&
            !(
              null == (e3 = t3.conditions) ||
              null == (e3 = e3.events) ||
              !e3.repeatedActivation
            )) ||
          "always" === t3.schedule
        );
      })(i2);
    return r2
      ? t2 === Zn.SHOWN
        ? "consume"
        : "ignore"
      : t2 === Zn.SHOWN
        ? "persist"
        : t2 === Zn.DISMISSED || t2 === Zn.SENT
          ? "consume"
          : "ignore";
  }
  getSurveys() {
    return this.getActivatedIds();
  }
  getEventToSurveys() {
    return this.getEventToItemsMap();
  }
}
var Pl = "SDK is not enabled or survey functionality is not yet loaded",
  Ol = "Disabled. Not loading surveys.",
  Cl =
    null != t && t.location ? wn(t.location.hash, "__posthog") || wn(location.hash, "state") : null,
  Il = "_postHogToolbarParams",
  Al = yi("[Toolbar]"),
  Fl = yi("[FeatureFlags]");
class Ml {
  constructor(t2, e2) {
    (void 0 === e2 && (e2 = false), (this.ca = false), this.update(t2, e2));
  }
  update(t2, e2) {
    ((this.fa = ((t3, e3) => {
      var i2, r2, s2, n2;
      return {
        bootstrap: {
          featureFlags: null == (i2 = t3.bootstrap) ? void 0 : i2.featureFlags,
          featureFlagPayloads: null == (r2 = t3.bootstrap) ? void 0 : r2.featureFlagPayloads,
        },
        remoteRequestsDisabled: e3,
        featureFlagsDisabled: !!t3.advanced_disable_feature_flags,
        onlyEvaluateSurveyFeatureFlags: !!t3.advanced_only_evaluate_survey_feature_flags,
        deduplicateCallsPerSession: !!t3.advanced_feature_flags_dedup_per_session,
        cacheTtlMs: t3.feature_flag_cache_ttl_ms,
        requestTimeoutMs: t3.feature_flag_request_timeout_ms,
        compression: t3.disable_compression ? "none" : "base64",
        evaluationContexts:
          null !==
            (s2 =
              null !== (n2 = t3.evaluation_contexts) && void 0 !== n2
                ? n2
                : t3.evaluation_environments) && void 0 !== s2
            ? s2
            : [],
        flagKeys: H(t3.flag_keys) ? t3.flag_keys : void 0,
      };
    })(t2, e2)),
      !t2.evaluation_environments ||
        t2.evaluation_contexts ||
        this.ca ||
        (Fl.warn(
          "evaluation_environments is deprecated. Use evaluation_contexts instead. evaluation_environments will be removed in a future version.",
        ),
        (this.ca = true)),
      K(t2.flag_keys) ||
        H(t2.flag_keys) ||
        Fl.error("Invalid flag_keys found:", t2.flag_keys, "Expected array of non-empty strings"));
  }
  get() {
    return this.fa;
  }
}
var Dl = yi("[FeatureFlags]"),
  Nl = yi("[FeatureFlags]", { debugEnabled: true }),
  Ul = `" failed. Feature flags didn't load in time.`,
  Ll = "connection_error",
  jl = (t2) => {
    for (var e2 = {}, i2 = 0; t2.length > i2; i2++) e2[t2[i2]] = true;
    return e2;
  },
  Bl = (t2) => {
    var e2 = {};
    for (var i2 of Br(t2 || {})) {
      var r2 = i2[1];
      r2 && (e2[i2[0]] = r2);
    }
    return e2;
  },
  zl = yi("[Error tracking]"),
  ql = "Refusing to render web experiment since the viewer is a likely bot",
  Hl = {
    icontains: (t2, e2) => e2.toLowerCase().indexOf(t2.toLowerCase()) > -1,
    not_icontains: (t2, e2) => -1 === e2.toLowerCase().indexOf(t2.toLowerCase()),
    regex: (t2, e2) => ga(e2, t2),
    not_regex: (t2, e2) => !ga(e2, t2),
    exact: (t2, e2) => e2 === t2,
    is_not: (t2, e2) => e2 !== t2,
  };
class Vl {
  get qe() {
    return this._instance.config;
  }
  constructor(t2) {
    var e2 = this;
    ((this.getWebExperimentsAndEvaluateDisplayLogic = function (t3) {
      (void 0 === t3 && (t3 = false),
        e2.getWebExperiments((t4) => {
          (Vl.pa("retrieved web experiments from the server"),
            (e2.ga = /* @__PURE__ */ new Map()),
            t4.forEach((t5) => {
              if (t5.feature_flag_key) {
                var i2;
                e2.ga &&
                  (Vl.pa("setting flag key ", t5.feature_flag_key, " to web experiment ", t5),
                  null == (i2 = e2.ga) || i2.set(t5.feature_flag_key, t5));
                var r2 = e2._instance.getFeatureFlag(t5.feature_flag_key);
                J(r2) && t5.variants[r2] && e2.ma(t5.name, r2, t5.variants[r2].transforms);
              } else if (t5.variants)
                for (var s2 in t5.variants) {
                  var n2 = t5.variants[s2];
                  Vl.ya(n2, e2._instance) && e2.ma(t5.name, s2, n2.transforms);
                }
            }));
        }, t3));
    }),
      (this._instance = t2),
      this._instance.onFeatureFlags((t3) => {
        this.onFeatureFlags(t3);
      }));
  }
  initialize() {}
  onFeatureFlags(t2) {
    if (this._is_bot()) Vl.pa(ql);
    else if (!this.qe.disable_web_experiments) {
      if (X(this.ga))
        return (
          (this.ga = /* @__PURE__ */ new Map()),
          this.loadIfEnabled(),
          void this.previewWebExperiment()
        );
      (Vl.pa("applying feature flags", t2),
        t2.forEach((t3) => {
          var e2;
          if (this.ga && null != (e2 = this.ga) && e2.has(t3)) {
            var i2,
              r2 = this._instance.getFeatureFlag(t3),
              s2 = null == (i2 = this.ga) ? void 0 : i2.get(t3);
            r2 && null != s2 && s2.variants[r2] && this.ma(s2.name, r2, s2.variants[r2].transforms);
          }
        }));
    }
  }
  previewWebExperiment() {
    var t2 = Vl.getWindowLocation();
    if (null != t2 && t2.search) {
      var e2 = yn(null == t2 ? void 0 : t2.search, "__experiment_id"),
        i2 = yn(null == t2 ? void 0 : t2.search, "__experiment_variant");
      e2 &&
        i2 &&
        (Vl.pa("previewing web experiments " + e2 + " && " + i2),
        this.getWebExperiments(
          (t3) => {
            this.ba(parseInt(e2), i2, t3);
          },
          false,
          true,
        ));
    }
  }
  loadIfEnabled() {
    this.qe.disable_web_experiments || this.getWebExperimentsAndEvaluateDisplayLogic();
  }
  getWebExperiments(t2, e2, i2) {
    if (this.qe.disable_web_experiments && !i2) return t2([]);
    var r2 = this._instance.get_property("$web_experiments");
    if (r2 && !e2) return t2(r2);
    this._instance._send_request({
      url: this._instance.requestRouter.endpointFor(
        "api",
        "/api/web_experiments/?token=" + this.qe.token,
      ),
      method: "GET",
      timestampMode: "query",
      callback: (e3) => t2((200 === e3.statusCode && e3.json && e3.json.experiments) || []),
    });
  }
  ba(t2, e2, i2) {
    var r2 = i2.filter((e3) => e3.id === t2);
    r2 &&
      r2.length > 0 &&
      (Vl.pa("Previewing web experiment [" + r2[0].name + "] with variant [" + e2 + "]"),
      this.ma(r2[0].name, e2, r2[0].variants[e2].transforms));
  }
  static ya(t2, e2) {
    return !X(t2.conditions) && Vl._a(t2, e2) && Vl.wa(t2);
  }
  static _a(t2, e2) {
    var i2;
    if (X(t2.conditions) || X(null == (i2 = t2.conditions) ? void 0 : i2.url)) return true;
    var r2 = Vl.getWindowLocation();
    if (r2) {
      var s2,
        n2,
        o2,
        a2 = fs(e2, r2.href);
      return (
        null == (s2 = t2.conditions) ||
        !s2.url ||
        Hl[
          null !== (n2 = null == (o2 = t2.conditions) ? void 0 : o2.urlMatchType) && void 0 !== n2
            ? n2
            : "icontains"
        ](t2.conditions.url, a2)
      );
    }
    return false;
  }
  static getWindowLocation() {
    return null == t ? void 0 : t.location;
  }
  static wa(t2) {
    var e2;
    if (X(t2.conditions) || X(null == (e2 = t2.conditions) ? void 0 : e2.utm)) return true;
    var i2 = Pn();
    if (i2.utm_source) {
      var r2,
        s2,
        n2,
        o2,
        a2,
        l2,
        u2,
        h2,
        d2 =
          null == (r2 = t2.conditions) ||
          null == (r2 = r2.utm) ||
          !r2.utm_campaign ||
          (null == (s2 = t2.conditions) || null == (s2 = s2.utm) ? void 0 : s2.utm_campaign) ==
            i2.utm_campaign,
        v2 =
          null == (n2 = t2.conditions) ||
          null == (n2 = n2.utm) ||
          !n2.utm_source ||
          (null == (o2 = t2.conditions) || null == (o2 = o2.utm) ? void 0 : o2.utm_source) ==
            i2.utm_source,
        c2 =
          null == (a2 = t2.conditions) ||
          null == (a2 = a2.utm) ||
          !a2.utm_medium ||
          (null == (l2 = t2.conditions) || null == (l2 = l2.utm) ? void 0 : l2.utm_medium) ==
            i2.utm_medium,
        f2 =
          null == (u2 = t2.conditions) ||
          null == (u2 = u2.utm) ||
          !u2.utm_term ||
          (null == (h2 = t2.conditions) || null == (h2 = h2.utm) ? void 0 : h2.utm_term) ==
            i2.utm_term;
      return d2 && c2 && f2 && v2;
    }
    return false;
  }
  static pa(t2) {
    for (var e2 = arguments.length, i2 = new Array(e2 > 1 ? e2 - 1 : 0), r2 = 1; e2 > r2; r2++)
      i2[r2 - 1] = arguments[r2];
    mi.info("[WebExperiments] " + t2, i2);
  }
  ma(t2, e2, i2) {
    this._is_bot()
      ? Vl.pa(ql)
      : "control" !== e2
        ? i2.forEach((i3) => {
            if (i3.selector) {
              var r2;
              Vl.pa("applying transform of variant " + e2 + " for experiment " + t2 + " ", i3);
              var s2 = null == (r2 = document) ? void 0 : r2.querySelectorAll(i3.selector);
              null == s2 ||
                s2.forEach((t3) => {
                  var e3 = t3;
                  (i3.html && (e3.innerHTML = i3.html), i3.css && e3.setAttribute("style", i3.css));
                });
            }
          })
        : Vl.pa("Control variants leave the page unmodified.");
  }
  _is_bot() {
    return i && this._instance ? pa(i, this.qe.custom_blocked_useragents) : void 0;
  }
}
var Wl = yi("[Conversations]"),
  Gl = "Conversations not available yet.",
  Kl = "console",
  Jl = "__posthogHandledLogsRequestError",
  Yl = (t2, e2) => {
    var i2 = t2 instanceof Error ? t2 : new Error(e2);
    return ((i2[Jl] = true), i2);
  },
  Ql = (t2) => !!t2 && "object" == typeof t2 && true === t2[Jl],
  Xl = {
    featureFlags: class {
      constructor(t2) {
        ((this.name = "featureFlags"),
          (this.ka = false),
          (this.featureFlagEventHandlers = []),
          (this.st = Dl),
          (this.xa = {}),
          (this.Sa = {}),
          (this.Ca = []),
          (this.Ma = false),
          (this.Ta = false),
          (this.Ea = 0),
          (this.Ia = false),
          (this.Pa = false),
          (this.Ra = false),
          (this.Aa = false),
          (this.Fa = 0),
          (this.La = () => {
            var t3 = this.Oa();
            ((this.Fa = 0), t3 && this.reloadFeatureFlags());
          }),
          "get" in t2
            ? (this.Da = t2)
            : ((this.$a = new Ml(t2.config, t2.tr())), (this.Da = this.$a)));
      }
      updateConfig(t2, e2) {
        var i2;
        null == (i2 = this.$a) || i2.update(t2, e2);
      }
      setup(t2) {
        return (
          (this.Na = t2),
          (this.st = t2.logger.createLogger("[FeatureFlags]")),
          (i2 = () => {
            this.Na === t2 && ((this.Na = void 0), (this.fn = t2), this.qa(t2));
          }),
          null != (e2 = t2.kv.initialize()) && e2.then ? e2.then(i2) : i2()
        );
        var e2, i2;
      }
      qa(e2) {
        if (this.fn === e2)
          return (
            t && Gr(t, "online", this.La),
            (this.ja = e2.registerDynamicEventProperties(() => (this.Ba() ? this.xa : this.Sa))),
            this.Ha(),
            this.initialize()
          );
      }
      destroy() {
        null == t || t.removeEventListener("online", this.La);
      }
      dispose() {
        var e2;
        (this.Ea++,
          (this.Pa = false),
          (this.Na = void 0),
          this.fn &&
            (this.Ua(),
            null == (e2 = this.ja) || e2.dispose(),
            (this.ja = void 0),
            (this.Ca = []),
            null == t || t.removeEventListener("online", this.La),
            (this.fn = void 0)));
      }
      get qe() {
        return this.Da.get();
      }
      za(t2) {
        var e2;
        return null == (e2 = this.fn) ? void 0 : e2.kv.get(t2);
      }
      F(t2) {
        this.Wa(() => {
          var e2;
          return null == (e2 = this.fn) ? void 0 : e2.kv.set(t2);
        });
      }
      q(t2) {
        this.Wa(() => {
          var e2;
          return null == (e2 = this.fn) ? void 0 : e2.kv.remove(t2);
        });
      }
      Wa(t2) {
        try {
          t2();
        } catch (t3) {
          this.st.error("Failed to update feature flag persistence", t3);
        }
      }
      Ha() {
        var t2 = {};
        for (var e2 of [Ki, Qi, Xi, tr]) {
          var i2 = this.za(e2);
          K(i2) || (t2[e2] = i2);
        }
        this.xa = t2;
        var r2 = _({}, t2),
          s2 = this.za(Gi);
        if (s2) for (var n2 of Object.entries(s2)) r2["$feature/" + n2[0]] = n2[1];
        this.Sa = r2;
      }
      Ba() {
        var t2 = this.qe.cacheTtlMs;
        if (!t2 || 0 >= t2) return false;
        var e2 = this.za(cr);
        return "number" != typeof e2 || Date.now() - e2 > t2;
      }
      Va() {
        return (
          !!this.Ba() &&
          (this.Aa ||
            this.Ta ||
            ((this.Aa = true),
            this.st.warn("Feature flag cache is stale, triggering refresh..."),
            this.reloadFeatureFlags()),
          true)
        );
      }
      Za() {
        var t2 = this.qe.evaluationContexts;
        return null != t2 && t2.length
          ? t2.filter((t3) => {
              var e2 = t3 && "string" == typeof t3 && t3.trim().length > 0;
              return (
                e2 ||
                  this.st.error(
                    "Invalid evaluation context found:",
                    t3,
                    "Expected non-empty string",
                  ),
                e2
              );
            })
          : [];
      }
      Ga() {
        var t2 = this.qe.flagKeys;
        if (!K(t2))
          return t2.filter((t3) => {
            var e2 = t3 && "string" == typeof t3 && t3.trim().length > 0;
            return (
              e2 || this.st.error("Invalid flag key found:", t3, "Expected non-empty string"),
              e2
            );
          });
      }
      initialize() {
        var t2,
          e2,
          i2 = this.qe,
          r2 =
            null !== (t2 = null == (e2 = i2.bootstrap) ? void 0 : e2.featureFlags) && void 0 !== t2
              ? t2
              : {};
        if (Object.keys(r2).length) {
          var s2,
            n2,
            o2 =
              null !== (s2 = null == (n2 = i2.bootstrap) ? void 0 : n2.featureFlagPayloads) &&
              void 0 !== s2
                ? s2
                : {},
            a2 = Object.keys(r2)
              .filter((t3) => !!r2[t3])
              .reduce((t3, e3) => ((t3[e3] = r2[e3] || false), t3), {}),
            l2 = Object.keys(o2)
              .filter((t3) => a2[t3])
              .reduce((t3, e3) => ((t3[e3] = o2[e3]), t3), {});
          return this.Qa({ featureFlags: a2, featureFlagPayloads: l2 });
        }
      }
      updateFlags(t2, e2, i2) {
        var r2,
          s2,
          n2 = null != i2 && i2.merge && null !== (r2 = this.za(Gi)) && void 0 !== r2 ? r2 : {},
          o2 = null != i2 && i2.merge && null !== (s2 = this.za(Qi)) && void 0 !== s2 ? s2 : {},
          a2 = _({}, n2, t2),
          l2 = _({}, o2, e2),
          u2 = {};
        for (var h2 of Object.entries(a2)) {
          var d2 = h2[0],
            v2 = h2[1];
          u2[d2] = {
            key: d2,
            enabled: y(v2),
            variant: b(v2),
            reason: void 0,
            metadata: K(null == l2 ? void 0 : l2[d2])
              ? void 0
              : { id: 0, version: void 0, description: void 0, payload: l2[d2] },
          };
        }
        this.Qa({ flags: u2 });
      }
      get hasLoadedFlags() {
        return this.Ma;
      }
      getFlags() {
        return Object.keys(this.getFlagVariants());
      }
      getFlagsWithDetails() {
        var t2 = this.za(Yi),
          e2 = this.za(tr),
          i2 = this.za(er);
        if (!i2 && !e2) return t2 || {};
        var r2 = jr({}, t2 || {}),
          s2 = [.../* @__PURE__ */ new Set([...Object.keys(i2 || {}), ...Object.keys(e2 || {})])];
        for (var n2 of s2) {
          var o2,
            a2,
            l2 = r2[n2],
            u2 = null == e2 ? void 0 : e2[n2],
            h2 = K(u2)
              ? null !== (o2 = null == l2 ? void 0 : l2.enabled) && void 0 !== o2 && o2
              : !!u2,
            d2 = K(u2) ? (null == l2 ? void 0 : l2.variant) : "string" == typeof u2 ? u2 : void 0,
            v2 = null == i2 ? void 0 : i2[n2],
            c2 = _({}, l2, {
              enabled: h2,
              variant: h2 ? (null != d2 ? d2 : null == l2 ? void 0 : l2.variant) : void 0,
            });
          (h2 !== (null == l2 ? void 0 : l2.enabled) &&
            (c2.original_enabled = null == l2 ? void 0 : l2.enabled),
            d2 !== (null == l2 ? void 0 : l2.variant) &&
              (c2.original_variant = null == l2 ? void 0 : l2.variant),
            v2 &&
              (c2.metadata = _({}, null == l2 ? void 0 : l2.metadata, {
                payload: v2,
                original_payload: null == l2 || null == (a2 = l2.metadata) ? void 0 : a2.payload,
              })),
            (r2[n2] = c2));
        }
        return (
          this.ka ||
            (this.st.warn(" Overriding feature flag details!", {
              flagDetails: t2,
              overriddenPayloads: i2,
              finalDetails: r2,
            }),
            (this.ka = true)),
          r2
        );
      }
      getAllFeatureFlags() {
        var t2 = this.getFlagVariants(),
          e2 = this.getFlagPayloads();
        return Object.keys(t2).map((i2) => {
          var r2 = t2[i2];
          return { key: i2, enabled: y(r2), variant: b(r2), payload: m(e2[i2]) };
        });
      }
      getFlagVariants() {
        var t2 = this.za(Gi),
          e2 = this.za(tr);
        if (!e2) return t2 || {};
        for (var i2 = jr({}, t2 || {}), r2 = Object.keys(e2), s2 = 0; r2.length > s2; s2++)
          i2[r2[s2]] = e2[r2[s2]];
        return (
          this.ka ||
            (this.st.warn(" Overriding feature flags!", {
              enabledFlags: t2,
              overriddenFlags: e2,
              finalFlags: i2,
            }),
            (this.ka = true)),
          i2
        );
      }
      getFlagPayloads() {
        var t2 = this.za(Qi),
          e2 = this.za(er);
        if (!e2) return t2 || {};
        for (var i2 = jr({}, t2 || {}), r2 = Object.keys(e2), s2 = 0; r2.length > s2; s2++)
          i2[r2[s2]] = e2[r2[s2]];
        return (
          this.ka ||
            (this.st.warn(" Overriding feature flag payloads!", {
              flagPayloads: t2,
              overriddenPayloads: e2,
              finalPayloads: i2,
            }),
            (this.ka = true)),
          i2
        );
      }
      reloadFeatureFlags() {
        this.Ia ||
          this.qe.featureFlagsDisabled ||
          this.Oa() ||
          this.Ka ||
          (this.Ca.slice().forEach((t2) => {
            try {
              t2();
            } catch (t3) {
              this.st.error("Error while running feature flags reloading callback", t3);
            }
          }),
          (this.Ka = setTimeout(() => {
            this.Ja();
          }, 5)));
      }
      Ua() {
        (clearTimeout(this.Ka), (this.Ka = void 0));
      }
      onReloading(t2) {
        return (
          this.Ca.push(t2),
          () => {
            this.Ca = this.Ca.filter((e2) => e2 !== t2);
          }
        );
      }
      ensureFlagsLoaded() {
        this.Ma || this.Ta || this.Ka || this.reloadFeatureFlags();
      }
      setAnonymousDistinctId(t2) {
        this.$anon_distinct_id = t2;
      }
      setReloadingPaused(t2) {
        this.Ia = t2;
      }
      resetFlagCallReported() {
        this.q(hr);
      }
      Ja(t2) {
        this.Ua();
        var e2 = this.fn;
        if (e2 && !this.qe.remoteRequestsDisabled && !this.Oa())
          if (this.Ta) this.Pa = true;
          else {
            var i2 = {
              token: e2.projectToken,
              distinct_id: e2.distinctId,
              groups: e2.groups,
              $anon_distinct_id: this.$anon_distinct_id,
              person_properties: _({}, e2.initialPersonProperties, this.za(ir) || {}, {
                $lib: e2.library.name,
                $lib_version: e2.library.version,
              }),
              group_properties: this.za(rr),
              timezone: Nn(),
            };
            (K(e2.deviceId) || (i2.$device_id = e2.deviceId),
              ((null != t2 && t2.disableFlags) || this.qe.featureFlagsDisabled) &&
                (i2.disable_flags = true));
            var r2 = this.Za();
            r2.length && (i2.evaluation_contexts = r2);
            var s2 = this.Ga();
            K(s2) || (i2.flag_keys = s2);
            var n2 = this.qe.onlyEvaluateSurveyFeatureFlags,
              o2 = "/flags/?v=2" + (n2 ? "&only_evaluate_survey_feature_flags=true" : ""),
              a2 = this.Ea;
            this.Ta = true;
            var l2 = () => {
                this.Pa && ((this.Pa = false), this.Ja());
              },
              u2 = (t3) => {
                ((this.Ta = false),
                  a2 === this.Ea
                    ? (this.F({ [vr]: [Ll] }),
                      this.st.error("Feature flag request failed", t3),
                      l2())
                    : l2());
              };
            try {
              e2.sendRequest(o2, {
                target: "flags",
                method: "POST",
                body: i2,
                compression: "base64" === this.qe.compression ? Hn.Base64 : void 0,
                sentAt: "body",
                timeoutMs: this.qe.requestTimeoutMs,
              })
                .then((t3) => {
                  var e3,
                    r3,
                    s3 = null !== (e3 = t3.json) && void 0 !== e3 ? e3 : {},
                    o3 = 200 !== t3.statusCode;
                  if (((this.Ta = false), a2 === this.Ea)) {
                    if (
                      (this.Ya(t3.statusCode),
                      o3 || this.Pa || (this.$anon_distinct_id = void 0),
                      !i2.disable_flags || this.Pa)
                    ) {
                      this.Ra = !o3;
                      var u3 = [];
                      (t3.error
                        ? u3.push(
                            t3.error instanceof Error && "AbortError" === t3.error.name
                              ? "timeout"
                              : t3.error instanceof Error
                                ? Ll
                                : "unknown_error",
                          )
                        : 200 !== t3.statusCode && u3.push("api_error_" + t3.statusCode),
                        s3.errorsWhileComputingFlags && u3.push("errors_while_computing_flags"));
                      var h2 = !(null == (r3 = s3.quotaLimited) || !r3.includes("feature_flags"));
                      (h2 && u3.push("quota_limited"),
                        this.F({ [vr]: u3 }),
                        h2
                          ? this.st.warn(
                              "You have hit your feature flags quota limit, and will not be able to load feature flags until the quota is reset.  Please visit https://posthog.com/docs/billing/limits-alerts to learn more.",
                            )
                          : i2.disable_flags || this.Qa(s3, o3, { partialResponse: n2 }),
                        l2());
                    }
                  } else l2();
                })
                .catch(u2);
            } catch (t3) {
              u2(t3);
            }
          }
      }
      Oa() {
        return En(this.Fa, 3);
      }
      Ya(t2) {
        this.Fa = xn(t2, this.Fa, 3, () =>
          this.st.warn(
            "Feature flag requests are failing before receiving an HTTP response; this can happen due to network issues, CORS, browser blocking, or ad blockers. Stopped refreshing feature flags; will try again when connectivity changes.",
          ),
        );
      }
      getFeatureFlag(t2, e2) {
        var i2;
        if ((void 0 === e2 && (e2 = {}), !e2.fresh || this.Ra))
          if (this.Ma || (this.getFlags() && this.getFlags().length > 0)) {
            if (!this.Va()) {
              var r2 = this.getFeatureFlagResult(t2, e2);
              return null !== (i2 = null == r2 ? void 0 : r2.variant) && void 0 !== i2
                ? i2
                : null == r2
                  ? void 0
                  : r2.enabled;
            }
          } else this.st.warn('getFeatureFlag for key "' + t2 + Ul);
      }
      getFeatureFlagDetails(t2) {
        return this.getFlagsWithDetails()[t2];
      }
      getFeatureFlagPayload(t2) {
        var e2 = this.getFeatureFlagResult(t2, { send_event: false });
        return null == e2 ? void 0 : e2.payload;
      }
      getFeatureFlagResult(t2, e2) {
        if ((void 0 === e2 && (e2 = {}), !e2.fresh || this.Ra))
          if (this.Ma || (this.getFlags() && this.getFlags().length > 0)) {
            if (!this.Va()) {
              var i2,
                r2 = this.getFlagVariants(),
                s2 = t2 in r2,
                n2 = r2[t2],
                o2 = this.getFlagPayloads()[t2],
                a2 = String(n2),
                l2 = this.za(Xi) || void 0,
                u2 = this.za(cr) || void 0,
                h2 = this.za(hr) || {};
              if (this.qe.deduplicateCallsPerSession) {
                var d2,
                  v2 = null == (d2 = this.fn) ? void 0 : d2.session.sessionId,
                  c2 = this.za(dr);
                v2 && v2 !== c2 && ((h2 = {}), (i2 = v2));
              }
              if (e2.send_event || !("send_event" in e2))
                if (t2 in h2 && h2[t2].includes(a2)) i2 && this.F({ [hr]: h2, [dr]: i2 });
                else {
                  var f2, p2, g2, y2, b2, w2, E2, x2, S2, k2, T2, R2;
                  (H(h2[t2]) ? h2[t2].push(a2) : (h2[t2] = [a2]),
                    this.F(_({ [hr]: h2 }, i2 ? { [dr]: i2 } : {})));
                  var P2 = this.getFeatureFlagDetails(t2),
                    O2 = [...(null !== (f2 = this.za(vr)) && void 0 !== f2 ? f2 : [])];
                  K(n2) && O2.push("flag_missing");
                  var C2 = {
                    $feature_flag: t2,
                    $feature_flag_response: n2,
                    $feature_flag_payload: null != o2 ? o2 : null,
                    $feature_flag_request_id: l2,
                    $feature_flag_evaluated_at: u2,
                    $feature_flag_bootstrapped_response:
                      null !==
                        (p2 =
                          null == (g2 = this.qe.bootstrap) || null == (g2 = g2.featureFlags)
                            ? void 0
                            : g2[t2]) && void 0 !== p2
                        ? p2
                        : null,
                    $feature_flag_bootstrapped_payload:
                      null !==
                        (y2 =
                          null == (b2 = this.qe.bootstrap) || null == (b2 = b2.featureFlagPayloads)
                            ? void 0
                            : b2[t2]) && void 0 !== y2
                        ? y2
                        : null,
                    $used_bootstrap_value: !this.Ra,
                  };
                  (K(null == P2 || null == (w2 = P2.metadata) ? void 0 : w2.has_experiment) ||
                    (C2.$feature_flag_has_experiment = P2.metadata.has_experiment),
                    K(null == P2 || null == (E2 = P2.metadata) ? void 0 : E2.version) ||
                      (C2.$feature_flag_version = P2.metadata.version));
                  var I2,
                    A2 =
                      null !==
                        (x2 = null == P2 || null == (S2 = P2.reason) ? void 0 : S2.description) &&
                      void 0 !== x2
                        ? x2
                        : null == P2 || null == (k2 = P2.reason)
                          ? void 0
                          : k2.code;
                  (A2 && (C2.$feature_flag_reason = A2),
                    null != P2 &&
                      null != (T2 = P2.metadata) &&
                      T2.id &&
                      (C2.$feature_flag_id = P2.metadata.id),
                    (K(null == P2 ? void 0 : P2.original_variant) &&
                      K(null == P2 ? void 0 : P2.original_enabled)) ||
                      (C2.$feature_flag_original_response = K(P2.original_variant)
                        ? P2.original_enabled
                        : P2.original_variant),
                    null != P2 &&
                      null != (R2 = P2.metadata) &&
                      R2.original_payload &&
                      (C2.$feature_flag_original_payload =
                        null == P2 || null == (I2 = P2.metadata) ? void 0 : I2.original_payload),
                    O2.length && (C2.$feature_flag_error = O2.join(",")),
                    this.Xa(C2));
                }
              else i2 && this.F({ [hr]: h2, [dr]: i2 });
              if (s2)
                return {
                  key: t2,
                  enabled: !!n2,
                  variant: "string" == typeof n2 ? n2 : void 0,
                  payload: m(o2),
                };
            }
          } else this.st.warn('getFeatureFlagResult for key "' + t2 + Ul);
      }
      Xa(t2) {
        try {
          var e2;
          null == (e2 = this.fn) ||
            e2.capture("$feature_flag_called", t2).catch((t3) => {
              this.st.error("Failed to capture feature flag call", t3);
            });
        } catch (t3) {
          this.st.error("Failed to capture feature flag call", t3);
        }
      }
      getRemoteConfigPayload(t2, e2) {
        this.eo(t2, e2);
      }
      eo(t2, e2) {
        var i2 = this;
        return p(function* () {
          var r2 = i2.fn;
          if (r2) {
            var s2 = {
                distinct_id: r2.distinctId,
                token: r2.projectToken,
                person_properties: { $lib: r2.library.name, $lib_version: r2.library.version },
              },
              n2 = i2.Za();
            n2.length && (s2.evaluation_contexts = n2);
            var o2,
              a2 = i2.Ga();
            K(a2) || (s2.flag_keys = a2);
            try {
              var l2,
                u2 =
                  null ==
                  (l2 = (yield r2.sendRequest("/flags/?v=2", {
                    target: "flags",
                    method: "POST",
                    body: s2,
                    compression: "base64" === i2.qe.compression ? Hn.Base64 : void 0,
                    sentAt: "body",
                    timeoutMs: i2.qe.requestTimeoutMs,
                  })).json)
                    ? void 0
                    : l2.featureFlagPayloads;
              o2 = (null == u2 ? void 0 : u2[t2]) || void 0;
            } catch (t3) {
              return void i2.st.error("Remote config feature flag request failed", t3);
            }
            try {
              e2(o2);
            } catch (t3) {
              i2.st.error("Remote config feature flag callback failed", t3);
            }
          }
        })();
      }
      isFeatureEnabled(t2, e2) {
        if ((void 0 === e2 && (e2 = {}), e2.fresh && !this.Ra)) return e2.defaultValue;
        if (!(this.Ma || (this.getFlags() && this.getFlags().length > 0)))
          return (this.st.warn('isFeatureEnabled for key "' + t2 + Ul), e2.defaultValue);
        var i2 = this.getFeatureFlag(t2, e2);
        return K(i2) ? e2.defaultValue : !!i2;
      }
      addFeatureFlagsHandler(t2) {
        this.featureFlagEventHandlers.push(t2);
      }
      removeFeatureFlagsHandler(t2) {
        this.featureFlagEventHandlers = this.featureFlagEventHandlers.filter((e2) => e2 !== t2);
      }
      receivedFeatureFlags(t2, e2, i2) {
        this.Qa(t2, e2, i2);
      }
      Qa(t2, e2, i2) {
        if (this.fn) {
          this.Ma = true;
          var r2 = (function (t3, e3, i3, r3, s2, n2) {
            (void 0 === e3 && (e3 = {}),
              void 0 === i3 && (i3 = {}),
              void 0 === r3 && (r3 = {}),
              void 0 === n2 && (n2 = Dl));
            var o2 = ((t4, e4) => {
                var i4 = t4.flags;
                return i4
                  ? _({}, t4, {
                      featureFlags: Object.fromEntries(
                        Object.keys(i4).map((t5) => {
                          var e5;
                          return [
                            t5,
                            null !== (e5 = i4[t5].variant) && void 0 !== e5 ? e5 : i4[t5].enabled,
                          ];
                        }),
                      ),
                      featureFlagPayloads: Object.fromEntries(
                        Object.keys(i4)
                          .filter((t5) => i4[t5].enabled)
                          .filter((t5) => {
                            var e5;
                            return null == (e5 = i4[t5].metadata) ? void 0 : e5.payload;
                          })
                          .map((t5) => {
                            var e5;
                            return [t5, null == (e5 = i4[t5].metadata) ? void 0 : e5.payload];
                          }),
                      ),
                    })
                  : (t4.featureFlags &&
                      e4.warn(
                        "Using an older version of the feature flags endpoint. Please upgrade your PostHog server to the latest version",
                      ),
                    t4);
              })(t3, n2),
              a2 = o2.flags,
              l2 = o2.featureFlags,
              u2 = o2.featureFlagPayloads;
            if (l2) {
              var h2 = t3.requestId,
                d2 = t3.evaluatedAt;
              if (H(l2)) {
                n2.warn(
                  "v1 of the feature flags endpoint is deprecated. Please use the latest version.",
                );
                var v2 = {};
                if (l2) for (var c2 = 0; l2.length > c2; c2++) v2[l2[c2]] = true;
                return { [Ki]: l2, [Gi]: v2, [Zi]: false };
              }
              var f2 = l2,
                p2 = u2,
                g2 = a2;
              if (null != s2 && s2.partialResponse)
                ((f2 = _({}, e3, f2)), (p2 = _({}, i3, p2)), (g2 = _({}, r3, g2)));
              else if (t3.errorsWhileComputingFlags)
                if (a2) {
                  var m2 = new Set(
                    Object.keys(a2).filter((t4) => {
                      var e4;
                      return !(null != (e4 = a2[t4]) && e4.failed);
                    }),
                  );
                  ((f2 = _(
                    {},
                    e3,
                    Object.fromEntries(Object.entries(f2).filter((t4) => m2.has(t4[0]))),
                  )),
                    (p2 = _(
                      {},
                      i3,
                      Object.fromEntries(Object.entries(p2 || {}).filter((t4) => m2.has(t4[0]))),
                    )),
                    (g2 = _(
                      {},
                      r3,
                      Object.fromEntries(Object.entries(g2 || {}).filter((t4) => m2.has(t4[0]))),
                    )));
                } else ((f2 = _({}, e3, f2)), (p2 = _({}, i3, p2)), (g2 = _({}, r3, g2)));
              return _(
                {
                  [Ki]: Object.keys(Bl(f2)),
                  [Gi]: f2 || {},
                  [Qi]: p2 || {},
                  [Yi]: g2 || {},
                  [Zi]: true === t3.minimalFlagCalledEvents,
                },
                h2 ? { [Xi]: h2 } : {},
                d2 ? { [cr]: d2 } : {},
              );
            }
          })(
            t2,
            this.getFlagVariants(),
            this.getFlagPayloads(),
            this.getFlagsWithDetails(),
            i2,
            this.st,
          );
          (r2 && this.F(r2), e2 || (this.Aa = false), this.io(e2));
        }
      }
      override(t2, e2) {
        (void 0 === e2 && (e2 = false),
          this.st.warn("override is deprecated. Please use overrideFeatureFlags instead."),
          this.overrideFeatureFlags({ flags: t2, suppressWarning: e2 }));
      }
      overrideFeatureFlags(t2) {
        this.ro(t2);
      }
      ro(t2) {
        if (this.fn) {
          if (false === t2)
            return (this.q([tr, er]), this.io(), void Nl.info("All overrides cleared"));
          if (H(t2))
            return (
              this.F({ [tr]: jl(t2) }),
              this.io(),
              void Nl.info("Flag overrides set", { flags: t2 })
            );
          if (t2 && "object" == typeof t2 && ("flags" in t2 || "payloads" in t2)) {
            var e2,
              i2 = t2;
            this.ka = Boolean(null !== (e2 = i2.suppressWarning) && void 0 !== e2 && e2);
            var r2 = {},
              s2 = i2.flags,
              n2 = i2.payloads;
            return (
              s2 && (r2[tr] = H(s2) ? jl(s2) : s2),
              n2 && (r2[er] = n2),
              Object.keys(r2).length && this.F(r2),
              false === s2 && false === n2
                ? this.q([tr, er])
                : false === s2
                  ? this.q(tr)
                  : false === n2 && this.q(er),
              this.io(),
              false === s2
                ? Nl.info("Flag overrides cleared")
                : s2 && Nl.info("Flag overrides set", { flags: s2 }),
              void (false === n2
                ? Nl.info("Payload overrides cleared")
                : n2 && Nl.info("Payload overrides set", { payloads: n2 }))
            );
          }
          if (t2 && "object" == typeof t2)
            return (
              this.F({ [tr]: t2 }),
              this.io(),
              void Nl.info("Flag overrides set", { flags: t2 })
            );
          this.st.warn("Invalid overrideOptions provided to overrideFeatureFlags", {
            overrideOptions: t2,
          });
        } else
          this.st.warn(
            "posthog.featureFlags.overrideFeatureFlags called before feature flags were ready",
          );
      }
      onFeatureFlags(t2) {
        if ((this.addFeatureFlagsHandler(t2), this.Ma)) {
          var e2 = this.no(),
            i2 = e2.flags,
            r2 = e2.flagVariants;
          try {
            t2(i2, r2);
          } catch (t3) {
            this.st.error("Error while running feature flags callback", t3);
          }
        }
        return () => this.removeFeatureFlagsHandler(t2);
      }
      updateEarlyAccessFeatureEnrollment(t2, e2, i2) {
        var r2 = (this.za(Ji) || []).find((e3) => e3.flagKey === t2),
          s2 = { ["$feature_enrollment/" + t2]: e2 },
          n2 = { $feature_flag: t2, $feature_enrollment: e2, $set: s2 };
        (r2 && (n2.$early_access_feature_name = r2.name),
          i2 && (n2.$feature_enrollment_stage = i2));
        var o2 = _({}, this.getFlagVariants(), { [t2]: e2 });
        (this.F({ [Ki]: Object.keys(Bl(o2)), [Gi]: o2, [ir]: _({}, this.za(ir) || {}, s2) }),
          this.io());
        try {
          var a2;
          null == (a2 = this.fn) ||
            a2.capture("$feature_enrollment_update", n2).catch((t3) => {
              this.st.error("Failed to capture early access feature enrollment", t3);
            });
        } catch (t3) {
          this.st.error("Failed to capture early access feature enrollment", t3);
        }
      }
      getEarlyAccessFeatures(t2, e2, i2) {
        void 0 === e2 && (e2 = false);
        var r2 = this.za(Ji);
        !r2 || e2 ? this.so(t2, i2) : t2(r2);
      }
      so(t2, e2) {
        var i2 = this;
        return p(function* () {
          var r2 = i2.fn;
          if (r2) {
            var s2,
              n2 = e2 ? "&" + e2.map((t3) => "stage=" + t3).join("&") : "";
            try {
              var o2 = yield r2.sendRequest(
                "/api/early_access_features/?token=" + r2.projectToken + n2,
                { target: "api", method: "GET", sentAt: "query" },
              );
              if (!o2.json) return;
              i2.F({ [Ji]: (s2 = o2.json.earlyAccessFeatures) });
            } catch (t3) {
              return void i2.st.error("Early access feature request failed", t3);
            }
            try {
              t2(s2);
            } catch (t3) {
              i2.st.error("Early access feature callback failed", t3);
            }
          }
        })();
      }
      no() {
        var t2 = this.getFlags(),
          e2 = this.getFlagVariants();
        return {
          flags: t2.filter((t3) => e2[t3]),
          flagVariants: Object.keys(e2)
            .filter((t3) => e2[t3])
            .reduce((t3, i2) => ((t3[i2] = e2[i2]), t3), {}),
        };
      }
      io(t2) {
        this.Ha();
        var e2 = this.no(),
          i2 = e2.flags,
          r2 = e2.flagVariants;
        this.featureFlagEventHandlers.forEach((e3) => {
          try {
            e3(i2, r2, { errorsLoading: t2 });
          } catch (t3) {
            this.st.error("Error while running feature flags callback", t3);
          }
        });
      }
      setPersonPropertiesForFlags(t2, e2) {
        (void 0 === e2 && (e2 = true), this.ao(t2, e2));
      }
      ao(t2, e2) {
        void 0 === e2 && (e2 = true);
        var i2 = this.za(ir) || {},
          r2 = (null == t2 ? void 0 : t2.$set) || (null != t2 && t2.$set_once ? {} : t2),
          s2 = null == t2 ? void 0 : t2.$set_once,
          n2 = {};
        if (s2)
          for (var o2 in s2) ({}).hasOwnProperty.call(s2, o2) && (o2 in i2 || (n2[o2] = s2[o2]));
        (this.F({ [ir]: _({}, i2, n2, r2) }), e2 && this.reloadFeatureFlags());
      }
      unsetPersonPropertiesForFlags(t2, e2) {
        void 0 === e2 && (e2 = true);
        var i2 = _({}, this.za(ir) || {});
        (t2.forEach((t3) => {
          delete i2[t3];
        }),
          this.F({ [ir]: i2 }),
          e2 && this.reloadFeatureFlags());
      }
      resetPersonPropertiesForFlags(t2) {
        (void 0 === t2 && (t2 = true), this.q(ir), t2 && this.reloadFeatureFlags());
      }
      setGroupPropertiesForFlags(t2, e2) {
        void 0 === e2 && (e2 = true);
        var i2 = this.za(rr) || {},
          r2 = _({}, i2);
        for (var s2 of Object.keys(t2)) r2[s2] = _({}, i2[s2], t2[s2]);
        (this.F({ [rr]: r2 }), e2 && this.reloadFeatureFlags());
      }
      resetGroupPropertiesForFlags(t2) {
        if (t2) {
          var e2 = this.za(rr) || {};
          this.F({ [rr]: _({}, e2, { [t2]: {} }) });
        } else this.q(rr);
      }
      reset() {
        (this.Ea++,
          (this.Pa = false),
          this.Ha(),
          (this.Ma = false),
          (this.Ia = false),
          (this.Ra = false),
          (this.$anon_distinct_id = void 0),
          this.Ua(),
          (this.ka = false),
          (this.Fa = 0));
      }
    },
  },
  Zl = {
    sessionRecording: class {
      get qe() {
        return this._instance.config;
      }
      get Rr() {
        return this._instance.persistence;
      }
      get started() {
        var t2;
        return !(null == (t2 = this.oo) || !t2.isStarted);
      }
      get status() {
        var t2, e2;
        return this.lo === fl || this.lo === pl
          ? this.lo
          : null !== (t2 = null == (e2 = this.oo) ? void 0 : e2.status) && void 0 !== t2
            ? t2
            : this.lo;
      }
      constructor(e2) {
        if (
          ((this._forceAllowLocalhostNetworkCapture = false),
          (this.lo = vl),
          (this.uo = void 0),
          (this.ho = false),
          (this.do = (() => {
            var e3;
            if (null == r || !r.visibilityState || "visible" === r.visibilityState) return true;
            var i2 =
              null == t || null == (e3 = t.performance) || null == e3.getEntriesByType
                ? void 0
                : e3.getEntriesByType("visibility-state");
            return !(null != i2 && i2.length) || i2.some((t2) => "visible" === t2.name);
          })()),
          (this.Ee = () => {
            var t2;
            "visible" === (null == r ? void 0 : r.visibilityState) &&
              ((this.do = true),
              null == (t2 = this.oo) ||
                null == t2.setDocumentWasEverVisible ||
                t2.setDocumentWasEverVisible(true));
          }),
          (this._instance = e2),
          !this._instance.sessionManager)
        )
          throw (
            gl.error("started without valid sessionManager"),
            new Error(_l + " started without valid sessionManager. This is a bug.")
          );
        if (this.qe.cookieless_mode === Rr)
          throw new Error(_l + ' cannot be used with cookieless_mode="always"');
        null != r && r.addEventListener && Gr(r, "visibilitychange", this.Ee);
      }
      initialize() {
        this.startIfEnabledOrStop();
      }
      dispose() {
        ((this.ho = true),
          null == r ||
            null == r.removeEventListener ||
            r.removeEventListener("visibilitychange", this.Ee),
          this.stopRecording());
      }
      get vo() {
        var e2,
          i2 = !(null == (e2 = this._instance.get_property(Li)) || !e2.enabled),
          r2 = !this.qe.disable_session_recording,
          s2 = this.qe.disable_session_recording || this._instance.consent.isOptedOut();
        return t && i2 && r2 && !s2;
      }
      startIfEnabledOrStop(t2) {
        var e2;
        if (!(this.ho || (this.vo && null != (e2 = this.oo) && e2.isStarted))) {
          var i2 = !K(Object.assign) && !K(Array.from);
          this.vo && i2
            ? (this.co(t2), gl.info("starting"))
            : ((this.lo = vl), this.stopRecording());
        }
      }
      co(t2) {
        var e2, i2, r2;
        this.vo &&
          (this.lo !== fl && this.lo !== pl && (this.lo = cl),
          null != v &&
          null != (e2 = v.__PosthogExtensions__) &&
          null != (e2 = e2.rrweb) &&
          e2.record &&
          null != (i2 = v.__PosthogExtensions__) &&
          i2.initSessionRecording
            ? this.fo(t2)
            : null == (r2 = v.__PosthogExtensions__) ||
              null == r2.loadExternalDependency ||
              r2.loadExternalDependency(this._instance, this.po, (e3) => {
                if (e3) return gl.error("could not load recorder", e3);
                this.fo(t2);
              }));
      }
      stopRecording() {
        var t2, e2;
        (null == (t2 = this.uo) || t2.call(this),
          (this.uo = void 0),
          null == (e2 = this.oo) || e2.stop());
      }
      mo() {
        var t2, e2;
        (null == (t2 = this.uo) || t2.call(this),
          (this.uo = void 0),
          null == (e2 = this.oo) || e2.discard());
      }
      yo() {
        var t2, e2;
        (null == (t2 = this.Rr) || t2.unregister(Wi), null == (e2 = this.Rr) || e2.unregister(ji));
      }
      bo(t2, e2) {
        if (X(t2)) return null;
        var i2,
          r2 = Z(t2) ? t2 : parseFloat(t2);
        return "number" != typeof (i2 = r2) || !Number.isFinite(i2) || 0 > i2 || i2 > 1
          ? (gl.warn(e2 + " must be between 0 and 1. Ignoring invalid value:", t2), null)
          : r2;
      }
      _o(t2) {
        if (this.Rr) {
          var e2,
            i2,
            r2 = this.Rr,
            s2 = () => {
              var e3,
                i3 = false === t2.sessionRecording ? void 0 : t2.sessionRecording,
                s3 = this.bo(
                  null == (e3 = this.qe.session_recording) ? void 0 : e3.sampleRate,
                  "session_recording.sampleRate",
                ),
                n2 = this.bo(null == i3 ? void 0 : i3.sampleRate, "remote config sampleRate"),
                o2 = null != s3 ? s3 : n2;
              X(o2) && this.yo();
              var a2 = null == i3 ? void 0 : i3.minimumDurationMilliseconds;
              r2.register({
                [Li]: _({ cache_timestamp: Date.now(), enabled: !!i3 }, i3, {
                  networkPayloadCapture: _(
                    { capturePerformance: t2.capturePerformance },
                    null == i3 ? void 0 : i3.networkPayloadCapture,
                  ),
                  canvasRecording: {
                    enabled: null == i3 ? void 0 : i3.recordCanvas,
                    fps: null == i3 ? void 0 : i3.canvasFps,
                    quality: null == i3 ? void 0 : i3.canvasQuality,
                  },
                  sampleRate: o2,
                  minimumDurationMilliseconds: K(a2) ? null : a2,
                  endpoint: null == i3 ? void 0 : i3.endpoint,
                  triggerMatchType: null == i3 ? void 0 : i3.triggerMatchType,
                  masking: null == i3 ? void 0 : i3.masking,
                  urlTriggers: null == i3 ? void 0 : i3.urlTriggers,
                  version: null == i3 ? void 0 : i3.version,
                  triggerGroups: null == i3 ? void 0 : i3.triggerGroups,
                }),
              });
            };
          (s2(),
            null == (e2 = this.uo) || e2.call(this),
            (this.uo = null == (i2 = this._instance.sessionManager) ? void 0 : i2.onSessionId(s2)));
        }
      }
      onRemoteConfig(t2) {
        var e2 = t2.ok ? t2.config : void 0;
        return e2 && "sessionRecording" in e2
          ? false === e2.sessionRecording
            ? (this._o(e2), void this.mo())
            : (this._o(e2), void this.startIfEnabledOrStop())
          : (this.lo === fl &&
              ((this.lo = pl),
              gl.warn("config refresh failed, recording will not start until page reload")),
            void this.startIfEnabledOrStop());
      }
      log(t2, e2) {
        var i2;
        (void 0 === e2 && (e2 = "log"),
          null != (i2 = this.oo) && i2.log
            ? this.oo.log(t2, e2)
            : gl.warn("log called before recorder was ready"));
      }
      get po() {
        var t2,
          e2,
          i2 =
            null == (t2 = this._instance) || null == (t2 = t2.persistence)
              ? void 0
              : t2.get_property(Li);
        return (
          (null == i2 || null == (e2 = i2.scriptConfig) ? void 0 : e2.script) || "lazy-recorder"
        );
      }
      wo() {
        var t2,
          e2 = this._instance.get_property(Li);
        if (!e2) return false;
        try {
          t2 = "object" == typeof e2 ? e2 : JSON.parse(e2);
        } catch (t3) {
          return (
            gl.warn(
              "persisted remote config for session recording is invalid and will be ignored",
              t3,
            ),
            false
          );
        }
        return !X(t2.cache_timestamp) && 36e5 >= Date.now() - t2.cache_timestamp;
      }
      fo(t2) {
        var e2, i2, r2;
        if (!this.ho) {
          if (null == (e2 = v.__PosthogExtensions__) || !e2.initSessionRecording)
            return (
              gl.warn(
                "Called on script loaded before session recording is available. This can be caused by adblockers.",
              ),
              void this._instance.register_for_session({ [$r]: true })
            );
          var s2;
          if (
            (this.oo ||
              ((this.oo =
                null == (s2 = v.__PosthogExtensions__)
                  ? void 0
                  : s2.initSessionRecording(this._instance, this.do)),
              (this.oo._forceAllowLocalhostNetworkCapture =
                this._forceAllowLocalhostNetworkCapture)),
            !this.wo())
          ) {
            if (this.lo === pl || this.lo === fl) return;
            return (
              (this.lo = fl),
              gl.info("persisted remote config is stale, requesting fresh config before starting"),
              void new lo(this._instance).load()
            );
          }
          ((this.lo = cl),
            null == (i2 = (r2 = this.oo).setDocumentWasEverVisible) || i2.call(r2, this.do),
            this.oo.start(t2));
        }
      }
      onRRwebEmit(t2) {
        var e2;
        null == (e2 = this.oo) || null == e2.onRRwebEmit || e2.onRRwebEmit(t2);
      }
      overrideLinkedFlag() {
        var t2, e2;
        (this.oo || null == (e2 = this.Rr) || e2.register({ [zi]: true }),
          null == (t2 = this.oo) || t2.overrideLinkedFlag());
      }
      overrideSampling() {
        var t2, e2;
        (this.oo || null == (e2 = this.Rr) || e2.register({ [Bi]: true }),
          null == (t2 = this.oo) || t2.overrideSampling());
      }
      overrideTrigger(t2) {
        var e2, i2;
        (this.oo || null == (i2 = this.Rr) || i2.register({ ["url" === t2 ? qi : Hi]: true }),
          null == (e2 = this.oo) || e2.overrideTrigger(t2));
      }
      get sdkDebugProperties() {
        var t2;
        return (
          (null == (t2 = this.oo) ? void 0 : t2.sdkDebugProperties) || {
            $recording_status: this.status,
          }
        );
      }
      tryAddCustomEvent(t2, e2) {
        var i2;
        return !(null == (i2 = this.oo) || !i2.tryAddCustomEvent(t2, e2));
      }
    },
  },
  tu = {
    autocapture: class {
      constructor(t2) {
        ((this.ko = false),
          (this.xo = null),
          (this.So = false),
          (this.Co = false),
          (this.instance = t2),
          (this.rageclicks = new el(t2.config.rageclick)),
          (this.Mo = null));
      }
      initialize() {
        this.startIfEnabled();
      }
      get qe() {
        var t2,
          e2,
          i2 = W(this.instance.config.autocapture) ? this.instance.config.autocapture : {};
        return (
          (i2.url_allowlist =
            null == (t2 = i2.url_allowlist) ? void 0 : t2.map((t3) => new RegExp(t3))),
          (i2.url_ignorelist =
            null == (e2 = i2.url_ignorelist) ? void 0 : e2.map((t3) => new RegExp(t3))),
          i2
        );
      }
      To() {
        if (this.isBrowserSupported()) {
          if (t && r) {
            var e2 = (e3) => {
              e3 = e3 || (null == t ? void 0 : t.event);
              try {
                this.Eo(e3);
              } catch (t2) {
                rl.error("Failed to capture event", t2);
              }
            };
            if (
              (Gr(r, "submit", e2, { capture: true }),
              Gr(r, "change", e2, { capture: true }),
              Gr(r, "click", e2, { capture: true }),
              this.qe.capture_copied_text)
            ) {
              var i2 = (e3) => {
                e3 = e3 || (null == t ? void 0 : t.event);
                try {
                  this.Eo(e3, il);
                } catch (t2) {
                  rl.error("Failed to capture copy/cut event", t2);
                }
              };
              (Gr(r, "copy", i2, { capture: true }), Gr(r, "cut", i2, { capture: true }));
            }
          }
        } else
          rl.info("Disabling Automatic Event Collection because this browser is not supported");
      }
      startIfEnabled() {
        this.isEnabled && !this.ko && (this.To(), (this.ko = true));
      }
      onRemoteConfig(t2) {
        if (((this.So = true), t2.ok)) {
          var e2 = t2.config;
          e2.elementsChainAsString && (this.Co = e2.elementsChainAsString);
          var i2 = e2.autocapture_opt_out;
          (et(i2) &&
            (this.instance.persistence && this.instance.persistence.register({ [Oi]: i2 }),
            (this.xo = i2)),
            this.startIfEnabled());
        } else this.startIfEnabled();
      }
      setElementSelectors(t2) {
        this.Mo = t2;
      }
      getElementSelectors(t2) {
        var e2,
          i2 = [];
        return (
          null == (e2 = this.Mo) ||
            e2.forEach((e3) => {
              var s2 = null == r ? void 0 : r.querySelectorAll(e3);
              null == s2 ||
                s2.forEach((r2) => {
                  t2 === r2 && i2.push(e3);
                });
            }),
          i2
        );
      }
      get isEnabled() {
        var t2,
          e2,
          i2 = null == (t2 = this.instance.persistence) ? void 0 : t2.props[Oi],
          r2 = this.xo,
          s2 = this.instance.tr() && !this.So;
        if (Q(r2) && !et(i2) && !s2) return false;
        var n2 = null !== (e2 = this.xo) && void 0 !== e2 ? e2 : !!i2;
        return !!this.instance.config.autocapture && !n2;
      }
      Eo(e2, i2) {
        if ((void 0 === i2 && (i2 = "$autocapture"), this.isEnabled)) {
          var r2,
            s2 = Os(e2);
          (Es(s2) && (s2 = s2.parentNode || null),
            "$autocapture" === i2 &&
              "click" === e2.type &&
              e2 instanceof MouseEvent &&
              this.instance.config.rageclick &&
              null != (r2 = this.rageclicks) &&
              r2.isRageClick(
                e2.clientX,
                e2.clientY,
                e2.timeStamp || /* @__PURE__ */ new Date().getTime(),
              ) &&
              js(s2, this.instance.config.rageclick) &&
              this.Eo(e2, "$rageclick"));
          var n2 = i2 === il;
          if (
            s2 &&
            (function (e3, i3, r3, s3, n3, o3) {
              var a3;
              if (!t || Bs(e3)) return false;
              if (null != r3 && r3.url_allowlist && !ks(r3.url_allowlist, o3)) return false;
              if (null != r3 && r3.url_ignorelist && ks(r3.url_ignorelist, o3)) return false;
              if (null != r3 && r3.dom_event_allowlist) {
                var l3 = r3.dom_event_allowlist;
                if (l3 && !l3.some((t2) => i3.type === t2)) return false;
              }
              var u3 = zs(e3, s3),
                h3 = u3.parentIsUsefulElement,
                d3 = u3.targetElementList;
              if (
                !(function (t2, e4) {
                  var i4 = null == e4 ? void 0 : e4.element_allowlist;
                  if (K(i4)) return true;
                  var r4,
                    s4 = function (t3) {
                      if (i4.some((e5) => t3.tagName.toLowerCase() === e5)) return { v: true };
                    };
                  for (var n4 of t2) if ((r4 = s4(n4))) return r4.v;
                  return false;
                })(d3, r3)
              )
                return false;
              if (!Is(d3, null == r3 ? void 0 : r3.css_selector_allowlist)) return false;
              if (
                Is(
                  d3,
                  null !== (a3 = null == r3 ? void 0 : r3.css_selector_ignorelist) && void 0 !== a3
                    ? a3
                    : Fs,
                )
              )
                return false;
              try {
                var v2 = t.getComputedStyle(e3);
                if (v2 && "pointer" === v2.getPropertyValue("cursor") && "click" === i3.type)
                  return true;
              } catch (t2) {}
              var c2 = e3.tagName.toLowerCase();
              switch (c2) {
                case "html":
                  return false;
                case "form":
                  return (n3 || ["submit"]).indexOf(i3.type) >= 0;
                case "input":
                case "select":
                case "textarea":
                  return (n3 || ["change", "click"]).indexOf(i3.type) >= 0;
                default:
                  return h3
                    ? (n3 || ["click"]).indexOf(i3.type) >= 0
                    : (n3 || ["click"]).indexOf(i3.type) >= 0 &&
                        (Cs.indexOf(c2) > -1 || "true" === e3.getAttribute("contenteditable"));
              }
            })(s2, e2, this.qe, n2, n2 ? ["copy", "cut"] : void 0, this.instance)
          ) {
            var o2 = ol(s2, {
                e: e2,
                maskAllElementAttributes: this.instance.config.mask_all_element_attributes,
                maskAllText: this.instance.config.mask_all_text,
                elementAttributeIgnoreList: this.qe.element_attribute_ignorelist,
                elementsChainAsString: this.Co,
                disableCaptureUrlHashes: this.instance.config.disable_capture_url_hashes,
              }),
              a2 = o2.props;
            if (o2.explicitNoCapture) return false;
            var l2 = this.getElementSelectors(s2);
            if ((l2 && l2.length > 0 && (a2.$element_selectors = l2), i2 === il)) {
              var u2,
                h2 = Rs(null == t || null == (u2 = t.getSelection()) ? void 0 : u2.toString()),
                d2 = e2.type || "clipboard";
              if (!h2) return false;
              ((a2.$selected_content = h2), (a2.$copy_type = d2));
            }
            return (this.instance.capture(i2, a2), true);
          }
        }
      }
      isBrowserSupported() {
        return V(null == r ? void 0 : r.querySelectorAll);
      }
    },
    historyAutocapture: class {
      constructor(e2) {
        var i2;
        ((this._instance = e2),
          (this.Io = (null == t || null == (i2 = t.location) ? void 0 : i2.pathname) || ""));
      }
      initialize() {
        this.startIfEnabled();
      }
      get isEnabled() {
        return "history_change" === this._instance.config.capture_pageview;
      }
      startIfEnabled() {
        this.isEnabled &&
          (mi.info("History API monitoring enabled, starting..."), this.monitorHistoryChanges());
      }
      stop() {
        (this.Po && this.Po(), (this.Po = void 0), mi.info("History API monitoring stopped"));
      }
      monitorHistoryChanges() {
        t && t.history && (this.Ro("pushState"), this.Ro("replaceState"), this.Ao());
      }
      Ro(e2) {
        var i2;
        if (t && (null == (i2 = t.history[e2]) || !i2.__posthog_wrapped__)) {
          var r2 = this;
          !(function (t2, e3, i3) {
            try {
              if (!(e3 in t2)) return ll;
              var r3 = { next: t2[e3] },
                s2 = i3(function () {
                  for (var t3 = arguments.length, e4 = new Array(t3), i4 = 0; t3 > i4; i4++)
                    e4[i4] = arguments[i4];
                  return r3.next.apply(this, e4);
                });
              return (
                V(s2) &&
                  ((s2.prototype = s2.prototype || {}),
                  Object.defineProperties(s2, {
                    __posthog_wrapped__: { enumerable: false, value: true },
                    __posthog_layer__: { enumerable: false, value: r3 },
                  })),
                (t2[e3] = s2),
                () => {
                  if (t2[e3] !== s2)
                    for (var i4 = t2[e3]; V(i4) && i4.__posthog_layer__;) {
                      var n2 = i4.__posthog_layer__;
                      if (n2.next === s2) return void (n2.next = r3.next);
                      i4 = n2.next;
                    }
                  else t2[e3] = r3.next;
                }
              );
            } catch (t3) {
              return ll;
            }
          })(
            t.history,
            e2,
            (t2) =>
              function (i3, s2, n2) {
                (t2.call(this, i3, s2, n2), r2.Fo(e2));
              },
          );
        }
      }
      Fo(e2) {
        try {
          var i2,
            r2 = null == t || null == (i2 = t.location) ? void 0 : i2.pathname;
          if (!r2) return;
          (r2 !== this.Io && this.isEnabled && this._instance.capture(Fr, { navigation_type: e2 }),
            (this.Io = r2));
        } catch (t2) {
          mi.error("Error capturing " + e2 + " pageview", t2);
        }
      }
      Ao() {
        if (!this.Po) {
          var e2 = () => {
            this.Fo("popstate");
          };
          (Gr(t, "popstate", e2),
            (this.Po = () => {
              t && t.removeEventListener("popstate", e2);
            }));
        }
      }
    },
    heatmaps: class {
      get qe() {
        return this.instance.config;
      }
      constructor(t2) {
        var e2;
        ((this.Lo = false),
          (this.ko = false),
          (this.Oo = null),
          (this.instance = t2),
          (this.Lo = !(null == (e2 = this.instance.persistence) || !e2.props[Ci])),
          (this.rageclicks = new el(t2.config.rageclick)));
      }
      initialize() {
        this.startIfEnabled();
      }
      get flushIntervalMilliseconds() {
        var t2 = 5e3;
        return (
          W(this.qe.capture_heatmaps) &&
            this.qe.capture_heatmaps.flush_interval_milliseconds &&
            (t2 = this.qe.capture_heatmaps.flush_interval_milliseconds),
          t2
        );
      }
      get isEnabled() {
        return X(this.qe.capture_heatmaps)
          ? X(this.qe.enable_heatmaps)
            ? this.Lo
            : this.qe.enable_heatmaps
          : false !== this.qe.capture_heatmaps;
      }
      startIfEnabled() {
        if (this.isEnabled) {
          if (this.ko) return;
          (ml.info("starting..."), this.Do(), this.Ee());
        } else {
          var t2;
          (clearInterval(null !== (t2 = this.Oo) && void 0 !== t2 ? t2 : void 0),
            this.$o(),
            this.getAndClearBuffer());
        }
      }
      onRemoteConfig(t2) {
        if (t2.ok) {
          var e2 = t2.config;
          if ("heatmaps" in e2) {
            var i2 = !!e2.heatmaps;
            (this.instance.persistence && this.instance.persistence.register({ [Ci]: i2 }),
              (this.Lo = i2),
              this.startIfEnabled());
          }
        }
      }
      getAndClearBuffer() {
        var t2 = this.R;
        return ((this.R = void 0), t2);
      }
      No(t2) {
        yl(t2.originalEvent) && this.ke(t2.originalEvent, "deadclick");
      }
      Ee() {
        (this.Oo && clearInterval(this.Oo),
          (this.Oo =
            "visible" === (null == r ? void 0 : r.visibilityState)
              ? setInterval(this.br.bind(this), this.flushIntervalMilliseconds)
              : null));
      }
      Do() {
        t &&
          r &&
          ((this.qo = this.br.bind(this)),
          Gr(t, Ar, this.qo),
          (this.jo = (e2) => this.ke(e2 || (null == t ? void 0 : t.event))),
          Gr(r, "click", this.jo, { capture: true }),
          (this.Bo = (e2) => this.Ho(e2 || (null == t ? void 0 : t.event))),
          Gr(r, "mousemove", this.Bo, { capture: true }),
          (this.Uo = new an(this.instance, nn, this.No.bind(this))),
          this.Uo.startIfEnabledOrStop(),
          (this.zo = this.Ee.bind(this)),
          Gr(r, Ir, this.zo),
          (this.ko = true));
      }
      $o() {
        var e2;
        t &&
          r &&
          (this.qo && t.removeEventListener(Ar, this.qo),
          this.jo && r.removeEventListener("click", this.jo, { capture: true }),
          this.Bo && r.removeEventListener("mousemove", this.Bo, { capture: true }),
          this.zo && r.removeEventListener(Ir, this.zo),
          clearTimeout(this.Wo),
          null == (e2 = this.Uo) || e2.stop(),
          (this.ko = false));
      }
      Vo(e2, i2) {
        var r2 = this.instance.scrollManager.scrollY(),
          s2 = this.instance.scrollManager.scrollX(),
          n2 = this.instance.scrollManager.scrollElement(),
          o2 = (function (e3, i3, r3) {
            for (var s3 = e3; s3 && bs(s3) && !ws(s3, "body");) {
              if (s3 === r3) return false;
              var n3 = void 0;
              try {
                var o3, a2, l2;
                n3 =
                  null ==
                  (o3 =
                    null !== (a2 = null == (l2 = s3.ownerDocument) ? void 0 : l2.defaultView) &&
                    void 0 !== a2
                      ? a2
                      : t)
                    ? void 0
                    : o3.getComputedStyle(s3).position;
              } catch (t2) {
                return false;
              }
              if (N(i3, n3)) return true;
              s3 = As(s3);
            }
            return false;
          })(Os(e2), ["fixed", "sticky"], n2);
        return {
          x: e2.clientX + (o2 ? 0 : s2),
          y: e2.clientY + (o2 ? 0 : r2),
          target_fixed: o2,
          type: i2,
        };
      }
      ke(t2, e2) {
        var i2;
        if ((void 0 === e2 && (e2 = "click"), !ys(t2.target) && yl(t2))) {
          var r2 = this.Vo(t2, e2);
          (null != (i2 = this.rageclicks) &&
            i2.isRageClick(t2.clientX, t2.clientY, /* @__PURE__ */ new Date().getTime()) &&
            js(Os(t2), this.instance.config.rageclick) &&
            this.Gt(_({}, r2, { type: "rageclick" })),
            this.Gt(r2));
        }
      }
      Ho(t2) {
        !ys(t2.target) &&
          yl(t2) &&
          (clearTimeout(this.Wo),
          (this.Wo = setTimeout(() => {
            this.Gt(this.Vo(t2, "mousemove"));
          }, 500)));
      }
      Gt(e2) {
        if (t) {
          var i2 = this.qe.disable_capture_url_hashes ? we(t.location.href) : t.location.href,
            r2 = this.qe.custom_personal_data_properties,
            s2 = this.qe.mask_personal_data_properties ? [...$n, ...(r2 || [])] : [],
            n2 = bn(i2, s2, Tn);
          ((this.R = this.R || {}), this.R[n2] || (this.R[n2] = []), this.R[n2].push(e2));
        }
      }
      br() {
        this.R &&
          !G(this.R) &&
          this.instance.capture("$$heatmap", { $heatmap_data: this.getAndClearBuffer() });
      }
    },
    deadClicksAutocapture: an,
    webVitalsAutocapture: class {
      constructor(t2) {
        var e2;
        ((this.Lo = false),
          (this.ko = false),
          (this.R = {
            navigationKey: void 0,
            url: void 0,
            metrics: [],
            firstMetricTimestamp: void 0,
          }),
          (this.Zo = () => {
            (clearTimeout(this.Go),
              (this.Go = void 0),
              0 !== this.R.metrics.length &&
                (this._instance.capture(
                  "$web_vitals",
                  _(
                    { $current_url: this.R.url },
                    this.R.metrics.reduce(
                      (t3, e3) =>
                        _({}, t3, {
                          ["$web_vitals_" + e3.name + "_event"]: _({}, e3),
                          ["$web_vitals_" + e3.name + "_value"]: e3.value,
                        }),
                      {},
                    ),
                  ),
                ),
                (this.R = {
                  navigationKey: void 0,
                  url: void 0,
                  metrics: [],
                  firstMetricTimestamp: void 0,
                })));
          }),
          (this.Qo = (t3) => {
            var e3;
            if (
              ((this.R = this.R || {
                navigationKey: void 0,
                url: void 0,
                metrics: [],
                firstMetricTimestamp: void 0,
              }),
              X(null == t3 ? void 0 : t3.name) || X(null == t3 ? void 0 : t3.value))
            )
              hl.error("Invalid metric received", t3);
            else {
              var i2 = "string" == typeof t3.navigationURL ? t3.navigationURL : void 0,
                r2 = this.Ko(i2);
              if (!K(r2)) {
                var s2 =
                  Z(t3.navigationId) || "string" == typeof t3.navigationId
                    ? "navigation:" + t3.navigationId
                    : "url:" + r2;
                if (!this.Jo || this.Jo > t3.value) {
                  (this.R.navigationKey !== s2 &&
                    (this.Zo(), (this.Go = setTimeout(this.Zo, this.flushToCaptureTimeoutMs))),
                    K(this.R.navigationKey) && ((this.R.navigationKey = s2), (this.R.url = r2)),
                    (this.R.firstMetricTimestamp = K(this.R.firstMetricTimestamp)
                      ? Date.now()
                      : this.R.firstMetricTimestamp),
                    t3.attribution &&
                      t3.attribution.interactionTargetElement &&
                      (t3.attribution.interactionTargetElement = void 0));
                  var n2 =
                      null == (e3 = this._instance.sessionManager)
                        ? void 0
                        : e3.checkAndGetSessionAndWindowId(true),
                    o2 = _({}, t3, i2 ? { navigationURL: r2 } : {}, {
                      $current_url: r2,
                      timestamp: Date.now(),
                    });
                  (K(n2) || ((o2.$session_id = n2.sessionId), (o2.$window_id = n2.windowId)),
                    this.R.metrics.push(o2),
                    this.R.metrics.length === this.allowedMetrics.length && this.Zo());
                } else hl.error("Ignoring metric with value >= " + this.Jo, t3);
              }
            }
          }),
          (this.Yo = () => {
            if (!this.ko) {
              var t3,
                e3,
                i2,
                r2,
                s2 = v.__PosthogExtensions__,
                n2 = null == s2 ? void 0 : s2.postHogWebVitalsCallbacksByFlavor,
                o2 =
                  (null == n2 ? void 0 : n2[this.Xo]) ||
                  ("web-vitals" === this.Xo && K(n2)
                    ? null == s2
                      ? void 0
                      : s2.postHogWebVitalsCallbacks
                    : void 0);
              if (
                (K(o2) || ((t3 = o2.onLCP), (e3 = o2.onCLS), (i2 = o2.onFCP), (r2 = o2.onINP)),
                t3 && e3 && i2 && r2)
              ) {
                var a2 = { reportSoftNavs: this.useSoftNavs };
                (this.allowedMetrics.indexOf("LCP") > -1 && t3(this.Qo.bind(this), a2),
                  this.allowedMetrics.indexOf("CLS") > -1 && e3(this.Qo.bind(this), a2),
                  this.allowedMetrics.indexOf("FCP") > -1 && i2(this.Qo.bind(this), a2),
                  this.allowedMetrics.indexOf("INP") > -1 && r2(this.Qo.bind(this), a2),
                  (this.ko = true));
              } else hl.error("web vitals callbacks not loaded - not starting");
            }
          }),
          (this._instance = t2),
          (this.Lo = !(null == (e2 = this._instance.persistence) || !e2.props[Mi])),
          this.startIfEnabled());
      }
      get tl() {
        return this._instance.config.capture_performance;
      }
      get allowedMetrics() {
        var t2,
          e2,
          i2 = W(this.tl)
            ? null == (t2 = this.tl)
              ? void 0
              : t2.web_vitals_allowed_metrics
            : void 0;
        return X(i2)
          ? (null == (e2 = this._instance.persistence) ? void 0 : e2.props[Ui]) || [
              "CLS",
              "FCP",
              "INP",
              "LCP",
            ]
          : i2;
      }
      get flushToCaptureTimeoutMs() {
        return (W(this.tl) ? this.tl.web_vitals_delayed_flush_ms : void 0) || 5e3;
      }
      get useAttribution() {
        var t2 = W(this.tl) ? this.tl.web_vitals_attribution : void 0;
        return null != t2 && t2;
      }
      get useSoftNavs() {
        var t2 = W(this.tl) ? this.tl.__preview_web_vitals_soft_navs : void 0;
        return null != t2 && t2;
      }
      get Jo() {
        var t2 =
          W(this.tl) && Z(this.tl.__web_vitals_max_value) ? this.tl.__web_vitals_max_value : dl;
        return t2 > 0 && 6e4 >= t2 ? dl : t2;
      }
      get isEnabled() {
        var t2 = null == s ? void 0 : s.protocol;
        if ("http:" !== t2 && "https:" !== t2)
          return (hl.info("Web Vitals are disabled on non-http/https protocols"), false);
        var e2 = W(this.tl) ? this.tl.web_vitals : et(this.tl) ? this.tl : void 0;
        return et(e2) ? e2 : this.Lo;
      }
      startIfEnabled() {
        this.isEnabled && !this.ko && (hl.info("enabled, starting..."), this.di(this.Yo));
      }
      onRemoteConfig(t2) {
        if (t2.ok) {
          var e2 = t2.config;
          if ("capturePerformance" in e2) {
            var i2 = W(e2.capturePerformance) && !!e2.capturePerformance.web_vitals,
              r2 = W(e2.capturePerformance)
                ? e2.capturePerformance.web_vitals_allowed_metrics
                : void 0;
            (this._instance.persistence &&
              (this._instance.persistence.register({ [Mi]: i2 }),
              this._instance.persistence.register({ [Ui]: r2 })),
              (this.Lo = i2),
              this.startIfEnabled());
          }
        }
      }
      get Xo() {
        return this.useSoftNavs
          ? this.useAttribution
            ? "web-vitals-with-attribution-soft-navs"
            : "web-vitals-soft-navs"
          : this.useAttribution
            ? "web-vitals-with-attribution"
            : "web-vitals";
      }
      di(t2) {
        var e2 = v.__PosthogExtensions__,
          i2 = this.Xo,
          r2 = null == e2 ? void 0 : e2.postHogWebVitalsCallbacksByFlavor;
        (null != r2 && r2[i2]) ||
        ("web-vitals" === i2 && K(r2) && null != e2 && e2.postHogWebVitalsCallbacks)
          ? t2()
          : null == e2 ||
            null == e2.loadExternalDependency ||
            e2.loadExternalDependency(this._instance, i2, (e3) => {
              e3 ? hl.error("failed to load script", e3) : t2();
            });
      }
      Ko(e2) {
        var i2 = e2 || (null == t ? void 0 : t.location.href);
        if (i2) {
          var r2 = this._instance.config.disable_capture_url_hashes ? we(i2) : i2,
            s2 = this._instance.config.custom_personal_data_properties,
            n2 = this._instance.config.mask_personal_data_properties ? [...$n, ...(s2 || [])] : [];
          return bn(r2, n2, Tn);
        }
        hl.error("Could not determine current URL");
      }
    },
  },
  eu = {
    exceptionObserver: class {
      constructor(e2) {
        var i2;
        ((this.Yo = () => {
          var e3;
          if (
            t &&
            this.isEnabled &&
            null != (e3 = v.__PosthogExtensions__) &&
            e3.errorWrappingFunctions
          ) {
            var i3 = v.__PosthogExtensions__.errorWrappingFunctions.wrapOnError,
              r2 = v.__PosthogExtensions__.errorWrappingFunctions.wrapUnhandledRejection,
              s2 = v.__PosthogExtensions__.errorWrappingFunctions.wrapConsoleError;
            try {
              (!this.el &&
                this.qe.capture_unhandled_errors &&
                (this.el = i3(this.captureException.bind(this))),
                !this.il &&
                  this.qe.capture_unhandled_rejections &&
                  (this.il = r2(this.captureException.bind(this))),
                !this.rl &&
                  this.qe.capture_console_errors &&
                  (this.rl = s2(this.captureException.bind(this))));
            } catch (t2) {
              (al.error("failed to start", t2), this.nl());
            }
          }
        }),
          (this._instance = e2),
          (this.sl = !(null == (i2 = this._instance.persistence) || !i2.props[Ii])),
          (this.al = new ft(
            _(
              {},
              (function (t2) {
                var e3, i3, r2, s2;
                return (
                  void 0 === t2 && (t2 = {}),
                  {
                    refillRate:
                      null !==
                        (e3 =
                          null !== (i3 = t2.exceptionRateLimiterRefillRate) && void 0 !== i3
                            ? i3
                            : t2.__exceptionRateLimiterRefillRate) && void 0 !== e3
                        ? e3
                        : 1,
                    bucketSize:
                      null !==
                        (r2 =
                          null !== (s2 = t2.exceptionRateLimiterBucketSize) && void 0 !== s2
                            ? s2
                            : t2.__exceptionRateLimiterBucketSize) && void 0 !== r2
                        ? r2
                        : 10,
                  }
                );
              })(this._instance.config.error_tracking),
              { refillInterval: 1e4, st: al },
            ),
          )),
          (this.qe = this.ol()),
          this.startIfEnabledOrStop());
      }
      ol() {
        var t2 = this._instance.config.capture_exceptions,
          e2 = {
            capture_unhandled_errors: false,
            capture_unhandled_rejections: false,
            capture_console_errors: false,
          };
        return (
          W(t2)
            ? (e2 = _({}, e2, t2))
            : (K(t2) ? this.sl : t2) &&
              (e2 = _({}, e2, {
                capture_unhandled_errors: true,
                capture_unhandled_rejections: true,
              })),
          e2
        );
      }
      get isEnabled() {
        return (
          this.qe.capture_console_errors ||
          this.qe.capture_unhandled_errors ||
          this.qe.capture_unhandled_rejections
        );
      }
      startIfEnabledOrStop() {
        this.isEnabled ? (al.info("enabled"), this.nl(), this.di(this.Yo)) : this.nl();
      }
      di(t2) {
        var e2, i2;
        null != (e2 = v.__PosthogExtensions__) && e2.errorWrappingFunctions
          ? t2()
          : null == (i2 = v.__PosthogExtensions__) ||
            null == i2.loadExternalDependency ||
            i2.loadExternalDependency(this._instance, "exception-autocapture", (e3) => {
              if (e3) return al.error("failed to load script", e3);
              t2();
            });
      }
      nl() {
        var t2, e2, i2;
        (null == (t2 = this.el) || t2.call(this),
          (this.el = void 0),
          null == (e2 = this.il) || e2.call(this),
          (this.il = void 0),
          null == (i2 = this.rl) || i2.call(this),
          (this.rl = void 0));
      }
      onRemoteConfig(t2) {
        if (t2.ok) {
          var e2 = t2.config;
          "autocaptureExceptions" in e2 &&
            ((this.sl = !!e2.autocaptureExceptions || false),
            this._instance.persistence && this._instance.persistence.register({ [Ii]: this.sl }),
            (this.qe = this.ol()),
            this.startIfEnabledOrStop());
        }
      }
      onConfigChange() {
        this.qe = this.ol();
      }
      captureException(t2) {
        var e2,
          i2,
          r2,
          s2 =
            null !==
              (e2 =
                null == t2 || null == (i2 = t2.$exception_list) || null == (i2 = i2[0])
                  ? void 0
                  : i2.type) && void 0 !== e2
              ? e2
              : "Exception";
        this.al.consumeRateLimit(s2)
          ? al.info("Skipping exception capture because of client rate limiting.", {
              exception: s2,
            })
          : null == (r2 = this._instance.exceptions) || r2.sendExceptionEvent(t2);
      }
    },
    exceptions: class {
      constructor(t2) {
        var e2, i2;
        ((this.ll = []),
          (this.ul = new Be(
            [new Ze(), new ui(), new ei(), new ti(), new ai(), new oi(), new ri(), new li()],
            (function (t3) {
              for (
                var e3 = arguments.length, i3 = new Array(e3 > 1 ? e3 - 1 : 0), r2 = 1;
                e3 > r2;
                r2++
              )
                i3[r2 - 1] = arguments[r2];
              return function (e4, r3) {
                void 0 === r3 && (r3 = 0);
                for (var s2 = [], n2 = e4.split("\n"), o2 = r3; n2.length > o2; o2++) {
                  var a2 = n2[o2];
                  if (1024 >= a2.length) {
                    var l2 = Xe.test(a2) ? a2.replace(Xe, "$1") : a2;
                    if (!l2.match(/\S*Error: /)) {
                      for (var u2 of i3) {
                        var h2 = u2(l2, t3);
                        if (h2) {
                          s2.push(h2);
                          break;
                        }
                      }
                      if (s2.length >= 50) break;
                    }
                  }
                }
                return (function (t4) {
                  if (!t4.length) return [];
                  var e5 = Array.from(t4);
                  return (
                    e5.reverse(),
                    e5.slice(0, 50).map((t5) => {
                      return _({}, t5, {
                        filename: t5.filename || ((i4 = e5), i4[i4.length - 1] || {}).filename,
                        function: t5.function || ze,
                      });
                      var i4;
                    })
                  );
                })(s2);
              };
            })("web:javascript", Ke, Qe),
          )),
          (this._instance = t2),
          (this.ll =
            null !==
              (e2 = null == (i2 = this._instance.persistence) ? void 0 : i2.get_property(Ai)) &&
            void 0 !== e2
              ? e2
              : []),
          (this.hl = fi(this.dl())),
          (this.vl = new pi(this.hl)));
      }
      onConfigChange() {
        ((this.hl = fi(this.dl())), this.vl.setConfig(this.hl));
      }
      onRemoteConfig(t2) {
        var e2, i2, r2;
        if (t2.ok) {
          var s2 = t2.config;
          if ("errorTracking" in s2) {
            var n2 =
                null !== (e2 = null == (i2 = s2.errorTracking) ? void 0 : i2.suppressionRules) &&
                void 0 !== e2
                  ? e2
                  : [],
              o2 = null == (r2 = s2.errorTracking) ? void 0 : r2.captureExtensionExceptions;
            ((this.ll = n2),
              this._instance.persistence &&
                this._instance.persistence.register({ [Ai]: this.ll, [Fi]: o2 }));
          }
        }
      }
      get cl() {
        var t2,
          e2 = !!this._instance.get_property(Fi),
          i2 = this._instance.config.error_tracking.captureExtensionExceptions;
        return null !== (t2 = null != i2 ? i2 : e2) && void 0 !== t2 && t2;
      }
      buildProperties(t2, e2) {
        return this.ul.buildFromUnknown(t2, {
          syntheticException: null == e2 ? void 0 : e2.syntheticException,
          mechanism: { handled: null == e2 ? void 0 : e2.handled },
        });
      }
      addExceptionStep(t2, e2) {
        if (this.hl.enabled)
          try {
            if (!J(t2) || 0 === t2.trim().length)
              return void zl.warn(
                "Ignoring exception step because message must be a non-empty string",
              );
            var i2 = (function (t3) {
                if (!t3) return { sanitizedProperties: {}, droppedKeys: [] };
                var e3 = [];
                return {
                  sanitizedProperties: Object.keys(t3).reduce(
                    (i3, r3) => (vi.has(r3) ? (e3.push(r3), i3) : ((i3[r3] = t3[r3]), i3)),
                    {},
                  ),
                  droppedKeys: e3,
                };
              })(this.fl(e2)),
              r2 = i2.sanitizedProperties,
              s2 = i2.droppedKeys;
            (s2.length > 0 &&
              zl.warn("Ignoring reserved exception step fields", { droppedKeys: s2 }),
              this.vl.add(_({ [hi]: t2, [di]: /* @__PURE__ */ new Date().toISOString() }, r2)));
          } catch (t3) {
            zl.error("Failed to add exception step. Ignoring breadcrumb.", t3);
          }
      }
      sendExceptionEvent(t2) {
        try {
          var e2 = t2.$exception_list;
          if (this.pl(e2)) {
            if (this.gl(e2))
              return (
                this.ml("Exception dropped: matched a suppression rule"),
                void zl.info("Skipping exception capture because a suppression rule matched")
              );
            if (!this.cl && this.yl(e2))
              return (
                this.ml("Exception dropped: thrown by a browser extension"),
                void zl.info("Skipping exception capture because it was thrown by an extension")
              );
            if (!this._instance.config.error_tracking.__capturePostHogExceptions && this.bl(e2))
              return (
                this.ml("Exception dropped: thrown by the PostHog SDK"),
                void zl.info("Skipping exception capture because it was thrown by the PostHog SDK")
              );
          }
          var i2 = this.hl.enabled && X(t2.$exception_steps) ? this._l(t2) : t2,
            r2 =
              "string" == typeof (n2 = globalThis._posthogReleaseId) && n2.length > 0 ? n2 : void 0;
          r2 && (i2.$release_id = r2);
          try {
            var s2 = this._instance.capture("$exception", i2, {
              _noTruncate: true,
              _batchKey: "exceptionEvent",
              ts: true,
            });
            return (s2 && this.vl.clear(), s2);
          } catch (t3) {
            return (
              zl.error("Failed to capture exception event. Dropping this exception.", t3),
              void this.vl.clear()
            );
          }
        } catch (t3) {
          return void zl.error("Failed to process exception event. Ignoring this exception.", t3);
        }
        var n2;
      }
      _l(t2) {
        try {
          var e2 = this.vl.getAttachable();
          return 0 === e2.length ? t2 : _({}, t2, { $exception_steps: e2 });
        } catch (e3) {
          return (
            zl.error(
              "Failed to read buffered exception steps. Capturing exception without steps.",
              e3,
            ),
            t2
          );
        }
      }
      ml(t2) {
        this.hl.enabled &&
          this.vl.add({ [hi]: t2, [di]: /* @__PURE__ */ new Date().toISOString() });
      }
      fl(t2) {
        return W(t2) ? _({}, t2) : {};
      }
      dl() {
        var t2, e2;
        return null !==
          (t2 =
            null == (e2 = this._instance.config.error_tracking) ? void 0 : e2.exception_steps) &&
          void 0 !== t2
          ? t2
          : {};
      }
      gl(t2) {
        if (0 === t2.length) return false;
        try {
          var e2 = t2.reduce(
            (t3, e3) => {
              var i2 = e3.type,
                r2 = e3.value;
              return (
                J(i2) && i2.length > 0 && t3.$exception_types.push(i2),
                J(r2) && r2.length > 0 && t3.$exception_values.push(r2),
                t3
              );
            },
            { $exception_types: [], $exception_values: [] },
          );
          return this.ll.some((t3) => {
            var i2 = t3.values.map((t4) => {
              var i3 = ya[t4.operator],
                r2 = e2[t4.key];
              if (!i3 || !r2) return false;
              var s2 = H(t4.value) ? t4.value : [t4.value];
              return s2.length > 0 && i3(s2, r2);
            });
            return "OR" === t3.type ? i2.some(Boolean) : i2.every(Boolean);
          });
        } catch (t3) {
          return (
            zl.warn("Failed to evaluate suppression rules. Capturing the exception.", t3),
            false
          );
        }
      }
      yl(t2) {
        return t2
          .flatMap((t3) => {
            var e2, i2;
            return null !== (e2 = null == (i2 = t3.stacktrace) ? void 0 : i2.frames) &&
              void 0 !== e2
              ? e2
              : [];
          })
          .some((t3) => t3.filename && t3.filename.startsWith("chrome-extension://"));
      }
      bl(t2) {
        if (t2.length > 0) {
          var e2,
            i2,
            r2,
            s2,
            n2 =
              null !== (e2 = null == (i2 = t2[0].stacktrace) ? void 0 : i2.frames) && void 0 !== e2
                ? e2
                : [],
            o2 = n2[n2.length - 1];
          return (
            null !==
              (r2 =
                null == o2 || null == (s2 = o2.filename)
                  ? void 0
                  : s2.includes("posthog.com/static")) &&
            void 0 !== r2 &&
            r2
          );
        }
        return false;
      }
      pl(t2) {
        return !X(t2) && H(t2);
      }
    },
  },
  iu = _(
    {
      productTours: class {
        get Rr() {
          return this._instance.persistence;
        }
        constructor(t2) {
          ((this.wl = null), (this.kl = null), (this._instance = t2));
        }
        initialize() {
          this.loadIfEnabled();
        }
        onRemoteConfig(t2) {
          if (t2.ok) {
            var e2 = t2.config;
            if ("productTours" in e2) {
              var i2, r2;
              if ((this.Rr && this.Rr.register({ [Ni]: !!e2.productTours }), !wl(this._instance)))
                return (
                  (!this.wl && X(null == (i2 = this.Rr) ? void 0 : i2.props[ur])) ||
                    bl.info("product tours disabled; stopping and clearing cached tours"),
                  null == (r2 = this.wl) || r2.stop(),
                  (this.wl = null),
                  void this.clearCache()
                );
              this.loadIfEnabled();
            }
          }
        }
        loadIfEnabled() {
          !this.wl && wl(this._instance) && this.di(() => this.xl());
        }
        di(t2) {
          var e2, i2;
          null != (e2 = v.__PosthogExtensions__) && e2.generateProductTours
            ? t2()
            : null == (i2 = v.__PosthogExtensions__) ||
              null == i2.loadExternalDependency ||
              i2.loadExternalDependency(this._instance, "product-tours", (e3) => {
                e3 ? bl.error("Could not load product tours script", e3) : t2();
              });
        }
        xl() {
          var t2;
          !this.wl &&
            null != (t2 = v.__PosthogExtensions__) &&
            t2.generateProductTours &&
            (this.wl = v.__PosthogExtensions__.generateProductTours(this._instance, true));
        }
        getProductTours(t2, e2) {
          if ((void 0 === e2 && (e2 = false), !H(this.kl) || e2)) {
            var i2 = this.Rr;
            if (i2) {
              var r2 = i2.props[ur];
              if (H(r2) && !e2) return ((this.kl = r2), void t2(r2, { isLoaded: true }));
            }
            this._instance._send_request({
              url: this._instance.requestRouter.endpointFor(
                "api",
                "/api/product_tours/?token=" + this._instance.config.token,
              ),
              method: "GET",
              timestampMode: "query",
              callback: (e3) => {
                if (wl(this._instance)) {
                  var r3 = e3.statusCode;
                  if (200 !== r3 || !e3.json) {
                    var s2 = "Product Tours API could not be loaded, status: " + r3;
                    return (
                      0 === r3 ? e3.error || bl.warn(s2) : bl.error(s2),
                      void t2([], { isLoaded: false, error: s2 })
                    );
                  }
                  var n2 = H(e3.json.product_tours) ? e3.json.product_tours : [];
                  ((this.kl = n2), i2 && i2.register({ [ur]: n2 }), t2(n2, { isLoaded: true }));
                } else t2([], { isLoaded: true });
              },
            });
          } else t2(this.kl, { isLoaded: true });
        }
        getActiveProductTours(t2) {
          X(this.wl)
            ? t2([], { isLoaded: false, error: "Product tours not loaded" })
            : this.wl.getActiveProductTours(t2);
        }
        showProductTour(t2) {
          var e2;
          null == (e2 = this.wl) || e2.showTourById(t2);
        }
        previewTour(t2) {
          this.wl
            ? this.wl.previewTour(t2)
            : this.di(() => {
                var e2;
                (this.xl(), null == (e2 = this.wl) || e2.previewTour(t2));
              });
        }
        dismissProductTour() {
          var t2;
          null == (t2 = this.wl) || t2.dismissTour("user_clicked_skip");
        }
        nextStep() {
          var t2;
          null == (t2 = this.wl) || t2.nextStep();
        }
        previousStep() {
          var t2;
          null == (t2 = this.wl) || t2.previousStep();
        }
        clearCache() {
          var t2;
          ((this.kl = null), null == (t2 = this.Rr) || t2.unregister(ur));
        }
        resetTour(t2) {
          var e2;
          null == (e2 = this.wl) || e2.resetTour(t2);
        }
        resetAllTours() {
          var t2;
          null == (t2 = this.wl) || t2.resetAllTours();
        }
        cancelPendingTour(t2) {
          var e2;
          null == (e2 = this.wl) || e2.cancelPendingTour(t2);
        }
      },
    },
    Xl,
  ),
  ru = {
    siteApps: class {
      constructor(t2) {
        ((this.Sl = 0), (this._instance = t2), (this.Cl = []), (this.apps = {}));
      }
      get isEnabled() {
        return !!this._instance.config.opt_in_site_apps;
      }
      Ml(t2, e2) {
        if (e2) {
          var i2 = this.globalsForEvent(e2);
          (this.Cl.push(i2), this.Cl.length > 1e3 && (this.Cl = this.Cl.slice(10)));
        }
      }
      get siteAppLoaders() {
        var t2;
        return null == (t2 = v._POSTHOG_REMOTE_CONFIG) ||
          null == (t2 = t2[this._instance.config.token])
          ? void 0
          : t2.siteApps;
      }
      initialize() {
        if (this.isEnabled) {
          var t2 = this._instance._addCaptureHook(this.Ml.bind(this));
          this.Tl = () => {
            (t2(), (this.Cl = []), (this.Tl = void 0));
          };
        }
      }
      globalsForEvent(t2) {
        var e2, i2, r2, s2, n2, o2, a2;
        if (!t2) throw new Error("Event payload is required");
        var l2 = {},
          u2 = this._instance.get_property("$groups") || [],
          h2 = this._instance.get_property("$stored_group_properties") || {};
        for (var d2 of Object.entries(h2)) {
          var v2 = d2[0];
          l2[v2] = { id: u2[v2], type: v2, properties: d2[1] };
        }
        var c2 = t2.$set_once,
          f2 = t2.$set;
        return {
          event: _({}, g(t2, El), {
            properties: _(
              {},
              t2.properties,
              f2
                ? {
                    $set: _(
                      {},
                      null !== (e2 = null == (i2 = t2.properties) ? void 0 : i2.$set) &&
                        void 0 !== e2
                        ? e2
                        : {},
                      f2,
                    ),
                  }
                : {},
              c2
                ? {
                    $set_once: _(
                      {},
                      null !== (r2 = null == (s2 = t2.properties) ? void 0 : s2.$set_once) &&
                        void 0 !== r2
                        ? r2
                        : {},
                      c2,
                    ),
                  }
                : {},
            ),
            elements_chain:
              null !== (n2 = null == (o2 = t2.properties) ? void 0 : o2.$elements_chain) &&
              void 0 !== n2
                ? n2
                : "",
            distinct_id: null == (a2 = t2.properties) ? void 0 : a2.distinct_id,
          }),
          person: { properties: this._instance.get_property("$stored_person_properties") },
          groups: l2,
        };
      }
      El(t2) {
        var e2,
          i2 = null == (e2 = t2.tagName) ? void 0 : e2.toLowerCase();
        return "style" === i2 && this._instance.config.prepare_external_dependency_stylesheet
          ? this._instance.config.prepare_external_dependency_stylesheet(t2) ||
              (xl.error("prepare_external_dependency_stylesheet returned null"), null)
          : "script" === i2 && this._instance.config.prepare_external_dependency_script
            ? this._instance.config.prepare_external_dependency_script(t2) ||
              (xl.error("prepare_external_dependency_script returned null"), null)
            : t2;
      }
      Il() {
        var t2, e2, i2, s2, n2, o2, a2, l2;
        if (
          !this._instance.config.prepare_external_dependency_stylesheet &&
          !this._instance.config.prepare_external_dependency_script
        )
          return () => {};
        var u2 = null == r ? void 0 : r.defaultView,
          h2 = null == u2 || null == (t2 = u2.Node) ? void 0 : t2.prototype;
        if (!u2 || !h2) return () => {};
        if ((this.Sl++, this.Pl)) return this.Rl();
        var d2 = [],
          v2 = this,
          c2 = /* @__PURE__ */ new WeakSet(),
          f2 = (t3, e3, i3) => {
            if (null != t3 && t3[e3]) {
              var r2 = t3[e3];
              ((t3[e3] = i3(r2)),
                d2.push(() => {
                  t3[e3] = r2;
                }));
            }
          },
          p2 = (t3) => {
            if (c2.has(t3)) return t3;
            var e3 = v2.El(t3);
            return (e3 && c2.add(e3), e3);
          },
          _2 = (t3) => t3.map((t4) => ("string" == typeof t4 ? t4 : p2(t4))).filter((t4) => !Q(t4));
        return (
          f2(
            h2,
            "appendChild",
            (t3) =>
              function (e3) {
                var i3 = p2(e3);
                return i3 ? t3.call(this, i3) : e3;
              },
          ),
          f2(
            h2,
            "insertBefore",
            (t3) =>
              function (e3, i3) {
                var r2 = p2(e3);
                return r2 ? t3.call(this, r2, i3) : e3;
              },
          ),
          f2(
            h2,
            "replaceChild",
            (t3) =>
              function (e3, i3) {
                var r2 = p2(e3);
                return r2 ? t3.call(this, r2, i3) : i3;
              },
          ),
          [
            null == (e2 = u2.Element) ? void 0 : e2.prototype,
            null == (i2 = u2.Document) ? void 0 : i2.prototype,
            null == (s2 = u2.DocumentFragment) ? void 0 : s2.prototype,
          ].forEach((t3) => {
            (f2(
              t3,
              "append",
              (t4) =>
                function () {
                  for (var e3 = arguments.length, i3 = new Array(e3), r2 = 0; e3 > r2; r2++)
                    i3[r2] = arguments[r2];
                  return t4.apply(this, _2(i3));
                },
            ),
              f2(
                t3,
                "prepend",
                (t4) =>
                  function () {
                    for (var e3 = arguments.length, i3 = new Array(e3), r2 = 0; e3 > r2; r2++)
                      i3[r2] = arguments[r2];
                    return t4.apply(this, _2(i3));
                  },
              ));
          }),
          [
            null == (n2 = u2.Element) ? void 0 : n2.prototype,
            null == (o2 = u2.CharacterData) ? void 0 : o2.prototype,
            null == (a2 = u2.DocumentType) ? void 0 : a2.prototype,
          ].forEach((t3) => {
            (f2(
              t3,
              "before",
              (t4) =>
                function () {
                  for (var e3 = arguments.length, i3 = new Array(e3), r2 = 0; e3 > r2; r2++)
                    i3[r2] = arguments[r2];
                  return t4.apply(this, _2(i3));
                },
            ),
              f2(
                t3,
                "after",
                (t4) =>
                  function () {
                    for (var e3 = arguments.length, i3 = new Array(e3), r2 = 0; e3 > r2; r2++)
                      i3[r2] = arguments[r2];
                    return t4.apply(this, _2(i3));
                  },
              ),
              f2(
                t3,
                "replaceWith",
                (t4) =>
                  function () {
                    for (var e3 = arguments.length, i3 = new Array(e3), r2 = 0; e3 > r2; r2++)
                      i3[r2] = arguments[r2];
                    var s3 = _2(i3);
                    return i3.length && !s3.length ? void 0 : t4.apply(this, s3);
                  },
              ));
          }),
          f2(
            null == (l2 = u2.Element) ? void 0 : l2.prototype,
            "insertAdjacentElement",
            (t3) =>
              function (e3, i3) {
                var r2 = p2(i3);
                return r2 ? t3.call(this, e3, r2) : null;
              },
          ),
          (this.Pl = () => {
            (d2.forEach((t3) => t3()), (this.Pl = void 0));
          }),
          this.Rl()
        );
      }
      Rl() {
        var t2 = false;
        return () => {
          var e2;
          t2 ||
            ((t2 = true), this.Sl--, 0 === this.Sl && (null == (e2 = this.Pl) || e2.call(this)));
        };
      }
      Al(t2, e2) {
        void 0 === e2 && (e2 = true);
        var i2 = this.Il();
        try {
          var r2 = t2(i2);
          return (e2 && i2(), r2);
        } catch (t3) {
          throw (i2(), t3);
        }
      }
      setupSiteApp(t2) {
        var e2 = this.apps[t2.id],
          i2 = () => {
            var i3;
            (!e2.errored &&
              this.Cl.length &&
              (xl.info("Processing " + this.Cl.length + " events for site app with id " + t2.id),
              this.Cl.forEach((t3) =>
                this.Al(() => (null == e2.processEvent ? void 0 : e2.processEvent(t3))),
              ),
              (e2.processedBuffer = true)),
              Object.values(this.apps).every((t3) => t3.processedBuffer || t3.errored) &&
                (null == (i3 = this.Tl) || i3.call(this)));
          },
          r2 = false,
          s2 = (s3) => {
            ((e2.errored = !s3),
              (e2.loaded = true),
              xl.info("Site app with id " + t2.id + " " + (s3 ? "loaded" : "errored")),
              r2 && i2());
          };
        try {
          var n2 = this.Al(
            (e3) =>
              t2.init({
                posthog: this._instance,
                callback(t3) {
                  (e3(), s2(t3));
                },
              }),
            false,
          ).processEvent;
          (n2 && (e2.processEvent = n2), (r2 = true));
        } catch (e3) {
          (xl.error(Sl + t2.id, e3), s2(false));
        }
        if (r2 && e2.loaded)
          try {
            i2();
          } catch (i3) {
            (xl.error(
              "Error while processing buffered events PostHog app with config id " + t2.id,
              i3,
            ),
              (e2.errored = true));
          }
      }
      Fl() {
        var t2 = this.siteAppLoaders || [];
        for (var e2 of t2)
          this.apps[e2.id] = { id: e2.id, loaded: false, errored: false, processedBuffer: false };
        for (var i2 of t2) this.setupSiteApp(i2);
      }
      Ll(t2) {
        var e2 = this;
        if (0 !== Object.keys(this.apps).length) {
          var i2 = this.globalsForEvent(t2),
            r2 = function (r3) {
              try {
                e2.Al(() => (null == r3.processEvent ? void 0 : r3.processEvent(i2)));
              } catch (e3) {
                xl.error("Error while processing event " + t2.event + " for site app " + r3.id, e3);
              }
            };
          for (var s2 of Object.values(this.apps)) r2(s2);
        }
      }
      onRemoteConfig(t2) {
        var e2,
          i2,
          r2,
          s2 = this;
        if (null != (e2 = this.siteAppLoaders) && e2.length)
          return this.isEnabled
            ? (this.Fl(), void this._instance.on("eventCaptured", (t3) => this.Ll(t3)))
            : void xl.error(
                'PostHog site apps are disabled. Enable the "opt_in_site_apps" config to proceed.',
              );
        if ((null == (i2 = this.Tl) || i2.call(this), t2.ok)) {
          var n2 = t2.config;
          if (null != (r2 = n2.siteApps) && r2.length)
            if (this.isEnabled) {
              var o2 = function () {
                var t3,
                  e3 = a2.id,
                  i3 = a2.url;
                ((v["__$$ph_site_app_" + e3] = s2._instance),
                  null == (t3 = v.__PosthogExtensions__) ||
                    null == t3.loadSiteApp ||
                    t3.loadSiteApp(s2._instance, i3, (t4) => {
                      if (t4) return xl.error(Sl + e3, t4);
                    }));
              };
              for (var a2 of n2.siteApps) o2();
            } else
              xl.error(
                'PostHog site apps are disabled. Enable the "opt_in_site_apps" config to proceed.',
              );
        }
      }
    },
  },
  su = {
    tracingHeaders: class {
      constructor(t2) {
        ((this.Ol = void 0),
          (this.Dl = void 0),
          (this.$l = void 0),
          (this.Yo = () => {
            var t3,
              e2,
              i2 = this.Nl();
            i2
              ? (K(this.Ol) &&
                  (this.Ol =
                    null == (t3 = v.__PosthogExtensions__) ||
                    null == (t3 = t3.tracingHeadersPatchFns)
                      ? void 0
                      : t3._patchXHR(
                          i2,
                          () => this._instance.get_distinct_id(),
                          this._instance.sessionManager,
                        )),
                K(this.Dl) &&
                  (this.Dl =
                    null == (e2 = v.__PosthogExtensions__) ||
                    null == (e2 = e2.tracingHeadersPatchFns)
                      ? void 0
                      : e2._patchFetch(
                          i2,
                          () => this._instance.get_distinct_id(),
                          this._instance.sessionManager,
                        )))
              : this.nl();
          }),
          (this._instance = t2));
      }
      initialize() {
        this.startIfEnabledOrStop();
      }
      di(t2) {
        var e2, i2;
        null != (e2 = v.__PosthogExtensions__) && e2.tracingHeadersPatchFns
          ? t2()
          : null == (i2 = v.__PosthogExtensions__) ||
            null == i2.loadExternalDependency ||
            i2.loadExternalDependency(this._instance, "tracing-headers", (e3) => {
              if (e3) return ul.error("failed to load script", e3);
              t2();
            });
      }
      ql() {
        var t2, e2;
        return null !==
          (t2 =
            null !== (e2 = this._instance.config.tracing_headers) && void 0 !== e2
              ? e2
              : this._instance.config.addTracingHeaders) && void 0 !== t2
          ? t2
          : this._instance.config.__add_tracing_headers;
      }
      Nl() {
        var t2 = this.ql();
        return H(t2)
          ? (H(this.$l) ? this.$l.splice(0, this.$l.length, ...t2) : (this.$l = [...t2]),
            t2.length > 0 ? this.$l : void 0)
          : (H(this.$l) && this.$l.splice(0), (this.$l = t2 || void 0), this.$l);
      }
      nl() {
        var t2, e2;
        (null == (t2 = this.Ol) || t2.call(this),
          null == (e2 = this.Dl) || e2.call(this),
          (this.Ol = void 0),
          (this.Dl = void 0));
      }
      startIfEnabledOrStop() {
        this.Nl() ? this.di(this.Yo) : this.nl();
      }
    },
  },
  nu = _(
    {
      surveys: class {
        get qe() {
          return this._instance.config;
        }
        constructor(t2) {
          ((this.jl = void 0),
            (this._surveyManager = null),
            (this.Bl = false),
            (this.Hl = []),
            (this.Ul = null),
            (this.zl = null),
            (this._instance = t2),
            (this._surveyEventReceiver = null));
        }
        initialize() {
          this.loadIfEnabled();
        }
        onRemoteConfig(t2) {
          if (!this.qe.disable_surveys) {
            if (!t2.ok) return Ra.warn("Remote config unavailable. Not loading surveys.");
            var e2 = t2.config.surveys;
            if (X(e2)) return Ra.warn("Flags not loaded yet. Not loading surveys.");
            var i2 = H(e2);
            ((this.jl = i2 ? e2.length > 0 : e2),
              Ra.info("flags response received, isSurveysEnabled: " + this.jl),
              this.loadIfEnabled());
          }
        }
        reset() {
          try {
            var t2;
            (null == (t2 = this._surveyEventReceiver) || t2.reset(),
              localStorage.removeItem("lastSeenSurveyDate"));
            for (var e2 = [], i2 = 0; i2 < localStorage.length; i2++) {
              var r2 = localStorage.key(i2);
              ((null != r2 && r2.startsWith(Pa)) ||
                (null != r2 && r2.startsWith("inProgressSurvey_"))) &&
                e2.push(r2);
            }
            e2.forEach((t3) => localStorage.removeItem(t3));
          } catch (t3) {}
        }
        loadIfEnabled() {
          if (!this._surveyManager)
            if (this.Bl) Ra.info("Already initializing surveys, skipping...");
            else if (this.qe.disable_surveys) Ra.info(Ol);
            else if (this.qe.cookieless_mode && this._instance.consent.isOptedOut())
              Ra.info("Not loading surveys in cookieless mode without consent.");
            else {
              var t2 = null == v ? void 0 : v.__PosthogExtensions__;
              if (t2) {
                if (!K(this.jl) || this.qe.advanced_enable_surveys) {
                  var e2 = this.jl || this.qe.advanced_enable_surveys;
                  this.Bl = true;
                  try {
                    var i2 = t2.generateSurveys;
                    if (i2) return void this.Wl(i2, e2);
                    var r2 = t2.loadExternalDependency;
                    if (!r2) return void this.Vl(kr);
                    r2(this._instance, "surveys", (i3) => {
                      i3 || !t2.generateSurveys
                        ? this.Vl("Could not load surveys script", i3)
                        : this.Wl(t2.generateSurveys, e2);
                    });
                  } catch (t3) {
                    throw (this.Vl("Error initializing surveys", t3), t3);
                  } finally {
                    this.Bl = false;
                  }
                }
              } else Ra.error("PostHog Extensions not found.");
            }
        }
        Wl(t2, e2) {
          ((this._surveyManager = t2(this._instance, e2)),
            (this._surveyEventReceiver = new Rl(this._instance)),
            Ra.info("Surveys loaded successfully"),
            this.Zl({ isLoaded: true }));
        }
        Vl(t2, e2) {
          (Ra.error(t2, e2), this.Zl({ isLoaded: false, error: t2 }));
        }
        onSurveysLoaded(t2) {
          return (
            this.Hl.push(t2),
            this._surveyManager && this.Zl({ isLoaded: true }),
            () => {
              this.Hl = this.Hl.filter((e2) => e2 !== t2);
            }
          );
        }
        getSurveys(t2, e2) {
          if ((void 0 === e2 && (e2 = false), this.qe.disable_surveys))
            return (Ra.info(Ol), t2([]));
          var i2,
            r2 = this._instance.get_property(sr);
          if (r2 && !e2)
            return (
              t2(r2, { isLoaded: true }),
              void (this.Gl() && this.getSurveys(() => {}, true))
            );
          "undefined" != typeof Promise && this.Ul
            ? this.Ul.then((e3) => t2(e3.surveys, e3.context))
            : ("undefined" != typeof Promise &&
                (this.Ul = new Promise((t3) => {
                  i2 = t3;
                })),
              this._instance._send_request({
                url: this._instance.requestRouter.endpointFor(
                  "api",
                  "/api/surveys/?token=" + this.qe.token,
                ),
                method: "GET",
                timestampMode: "query",
                timeout: this.qe.surveys_request_timeout_ms,
                callback: (e3) => {
                  var r3;
                  this.Ul = null;
                  var s2 = e3.statusCode;
                  if (200 !== s2 || !e3.json) {
                    var n2 = "Surveys API could not be loaded, status: " + s2;
                    (0 !== s2 ? Ra.error(n2) : e3.error || Ra.warn(n2), (this.zl = Date.now()));
                    var o2 = { isLoaded: false, error: n2 };
                    return (t2([], o2), void (null == i2 || i2({ surveys: [], context: o2 })));
                  }
                  this.zl = null;
                  var a2,
                    l2 = e3.json.surveys || [],
                    u2 = l2.filter(
                      (t3) =>
                        (function (t4) {
                          return !(!t4.start_date || t4.end_date);
                        })(t3) &&
                        (Ta(t3) ||
                          (function (t4) {
                            var e4;
                            return !(
                              null == (e4 = t4.conditions) ||
                              null == (e4 = e4.actions) ||
                              null == (e4 = e4.values) ||
                              !e4.length
                            );
                          })(t3)),
                    );
                  (u2.length > 0 && (null == (a2 = this._surveyEventReceiver) || a2.register(u2)),
                    null == (r3 = this._instance.persistence) ||
                      r3.register({ [sr]: l2, [nr]: Date.now() }));
                  var h2 = { isLoaded: true };
                  (t2(l2, h2), null == i2 || i2({ surveys: l2, context: h2 }));
                },
              }));
        }
        Gl() {
          return this.Ql() && !this.Ul && !this.Kl();
        }
        Ql() {
          var t2 = this._instance.get_property(nr);
          return Z(t2) && Date.now() - t2 > 3e5;
        }
        Kl() {
          return Z(this.zl) && 3e5 > Date.now() - this.zl;
        }
        markSurveyAsSeen(t2, e2) {
          var i2,
            r2 = {
              id: t2,
              current_iteration:
                null !== (i2 = null == e2 ? void 0 : e2.iteration) && void 0 !== i2 ? i2 : null,
            };
          Oa(r2);
          try {
            localStorage.setItem("lastSeenSurveyDate", /* @__PURE__ */ new Date().toISOString());
          } catch (t3) {}
        }
        Zl(t2) {
          for (var e2 of this.Hl)
            try {
              if (!t2.isLoaded) return e2([], t2);
              this.getSurveys(e2);
            } catch (t3) {
              Ra.error("Error in survey callback", t3);
            }
        }
        getActiveMatchingSurveys(t2, e2) {
          if ((void 0 === e2 && (e2 = false), !X(this._surveyManager)))
            return this._surveyManager.getActiveMatchingSurveys(t2, e2);
          Ra.warn("init was not called");
        }
        Jl(t2) {
          var e2 = null;
          return (
            this.getSurveys((i2) => {
              var r2;
              e2 = null !== (r2 = i2.find((e3) => e3.id === t2)) && void 0 !== r2 ? r2 : null;
            }),
            e2
          );
        }
        Yl(t2) {
          if (X(this._surveyManager)) return { eligible: false, reason: Pl };
          var e2 = "string" == typeof t2 ? this.Jl(t2) : t2;
          return e2
            ? this._surveyManager.checkSurveyEligibility(e2)
            : { eligible: false, reason: "Survey not found" };
        }
        Xl(t2) {
          if (X(this._surveyManager)) return { eligible: false, reason: Pl };
          var e2 = "string" == typeof t2 ? this.Jl(t2) : t2;
          return e2
            ? this._surveyManager.checkSurveyRenderability(e2)
            : { eligible: false, reason: "Survey not found" };
        }
        canRenderSurvey(t2) {
          if (X(this._surveyManager))
            return (Ra.warn("init was not called"), { visible: false, disabledReason: Pl });
          var e2 = this.Xl(t2);
          return { visible: e2.eligible, disabledReason: e2.reason };
        }
        canRenderSurveyAsync(t2, e2) {
          return X(this._surveyManager)
            ? (Ra.warn("init was not called"),
              Promise.resolve({ visible: false, disabledReason: Pl }))
            : new Promise((i2) => {
                this.getSurveys((e3) => {
                  var r2,
                    s2 = null !== (r2 = e3.find((e4) => e4.id === t2)) && void 0 !== r2 ? r2 : null;
                  if (s2) {
                    var n2 = this.Xl(s2);
                    i2({ visible: n2.eligible, disabledReason: n2.reason });
                  } else i2({ visible: false, disabledReason: "Survey not found" });
                }, e2);
              });
        }
        renderSurvey(t2, e2, i2) {
          var s2;
          if (X(this._surveyManager)) Ra.warn("init was not called");
          else {
            var n2 = "string" == typeof t2 ? this.Jl(t2) : t2;
            if (null != n2 && n2.id)
              if (Ca.includes(n2.type)) {
                var o2 = null == r ? void 0 : r.querySelector(e2);
                if (o2)
                  return null != (s2 = n2.appearance) && s2.surveyPopupDelaySeconds
                    ? (Ra.info(
                        "Rendering survey " +
                          n2.id +
                          " with delay of " +
                          n2.appearance.surveyPopupDelaySeconds +
                          " seconds",
                      ),
                      void setTimeout(() => {
                        var t3, e3;
                        (Ra.info(
                          "Rendering survey " +
                            n2.id +
                            " with delay of " +
                            (null == (t3 = n2.appearance) ? void 0 : t3.surveyPopupDelaySeconds) +
                            " seconds",
                        ),
                          null == (e3 = this._surveyManager) || e3.renderSurvey(n2, o2, i2),
                          Ra.info("Survey " + n2.id + " rendered"));
                      }, 1e3 * n2.appearance.surveyPopupDelaySeconds))
                    : void this._surveyManager.renderSurvey(n2, o2, i2);
                Ra.warn("Survey element not found");
              } else Ra.warn("Surveys of type " + n2.type + " cannot be rendered in the app");
            else Ra.warn("Survey not found");
          }
        }
        displaySurvey(t2, e2) {
          var i2;
          if (X(this._surveyManager)) Ra.warn("init was not called");
          else {
            var r2 = this.Jl(t2);
            if (r2) {
              var s2 = r2;
              if (
                (null != (i2 = r2.appearance) &&
                  i2.surveyPopupDelaySeconds &&
                  e2.ignoreDelay &&
                  (s2 = _({}, r2, {
                    appearance: _({}, r2.appearance, { surveyPopupDelaySeconds: 0 }),
                  })),
                e2.displayType !== eo.Popover &&
                  e2.initialResponses &&
                  Ra.warn(
                    "initialResponses is only supported for popover surveys. prefill will not be applied.",
                  ),
                false === e2.ignoreConditions)
              ) {
                var n2 = this.Yl(r2);
                if (!n2.eligible)
                  return void Ra.warn("Survey is not eligible to be displayed: ", n2.reason);
              }
              e2.displayType !== eo.Inline
                ? this._surveyManager.handlePopoverSurvey(s2, e2)
                : this.renderSurvey(s2, e2.selector, e2.properties);
            } else Ra.warn("Survey not found");
          }
        }
        cancelPendingSurvey(t2) {
          X(this._surveyManager)
            ? Ra.warn("init was not called")
            : this._surveyManager.cancelSurvey(t2);
        }
        handlePageUnload() {
          var t2;
          null == (t2 = this._surveyManager) ||
            null == t2.handlePageUnload ||
            t2.handlePageUnload();
        }
      },
    },
    Xl,
  ),
  ou = {
    toolbar: class {
      constructor(t2) {
        this.instance = t2;
      }
      tu(t2) {
        v.ph_toolbar_state = t2;
      }
      eu() {
        var t2;
        return null !== (t2 = v.ph_toolbar_state) && void 0 !== t2 ? t2 : 0;
      }
      initialize() {
        return this.maybeLoadToolbar();
      }
      maybeLoadToolbar(e2, i2, s2) {
        if (
          (void 0 === e2 && (e2 = void 0),
          void 0 === i2 && (i2 = void 0),
          void 0 === s2 && (s2 = void 0),
          Kr(this.instance.config))
        )
          return false;
        if (!t || !r) return false;
        ((e2 = null != e2 ? e2 : t.location), (s2 = null != s2 ? s2 : t.history));
        try {
          if (!i2) {
            try {
              (t.localStorage.setItem("test", "test"), t.localStorage.removeItem("test"));
            } catch (t2) {
              return false;
            }
            i2 = null == t ? void 0 : t.localStorage;
          }
          var n2,
            o2 = Cl || wn(e2.hash, "__posthog") || wn(e2.hash, "state"),
            a2 = o2
              ? zr(() => JSON.parse(atob(decodeURIComponent(o2)))) ||
                zr(() => JSON.parse(decodeURIComponent(o2)))
              : null;
          return (
            a2 && "ph_authorize" === a2.action
              ? (((n2 = a2).source = "url"),
                n2 &&
                  Object.keys(n2).length > 0 &&
                  (a2.desiredHash
                    ? (e2.hash = a2.desiredHash)
                    : s2
                      ? s2.replaceState(s2.state, "", e2.pathname + e2.search)
                      : (e2.hash = "")))
              : (((n2 = JSON.parse(i2.getItem(Il) || "{}")).source = "localstorage"),
                delete n2.userIntent),
            !(!n2.token || this.instance.config.token !== n2.token || (this.loadToolbar(n2), 0))
          );
        } catch (t2) {
          return false;
        }
      }
      iu(t2) {
        var e2 = v.ph_load_toolbar || v.ph_load_editor;
        !X(e2) && V(e2) ? e2(t2, this.instance) : Al.warn("No toolbar load function found");
      }
      loadToolbar(e2) {
        var i2 = !(null == r || !r.getElementById(ps));
        if (!t || i2) return false;
        var s2 =
            "custom" === this.instance.requestRouter.region &&
            this.instance.config.advanced_disable_toolbar_metrics,
          n2 = _(
            { token: this.instance.config.token },
            e2,
            { apiURL: this.instance.requestRouter.endpointFor("ui") },
            s2 ? { instrument: false } : {},
          );
        if (
          (t.localStorage.setItem(Il, JSON.stringify(_({}, n2, { source: void 0 }))),
          2 === this.eu())
        )
          this.iu(n2);
        else if (0 === this.eu()) {
          var o2;
          (this.tu(1),
            null == (o2 = v.__PosthogExtensions__) ||
              null == o2.loadExternalDependency ||
              o2.loadExternalDependency(this.instance, "toolbar", (t2) => {
                if (t2) return (Al.error("[Toolbar] Failed to load", t2), void this.tu(0));
                (this.tu(2), this.iu(n2));
              }),
            Gr(t, "turbolinks:load", () => {
              (this.tu(0), this.loadToolbar(n2));
            }));
        }
        return true;
      }
      ru(t2) {
        return this.loadToolbar(t2);
      }
      maybeLoadEditor(t2, e2, i2) {
        return (
          void 0 === t2 && (t2 = void 0),
          void 0 === e2 && (e2 = void 0),
          void 0 === i2 && (i2 = void 0),
          this.maybeLoadToolbar(t2, e2, i2)
        );
      }
    },
  },
  au = _({ experiments: Vl }, Xl),
  lu = {
    conversations: class {
      constructor(t2) {
        ((this.nu = void 0),
          (this._conversationsManager = null),
          (this.su = false),
          (this.au = null),
          (this.ou = false),
          (this._instance = t2));
      }
      initialize() {
        this.loadIfEnabled();
      }
      onRemoteConfig(t2) {
        if (!this._instance.config.disable_conversations && ((this.lu = t2.ok), t2.ok)) {
          var e2 = t2.config.conversations;
          X(e2) ||
            (et(e2) ? (this.nu = e2) : ((this.nu = e2.enabled), (this.au = e2)),
            this.loadIfEnabled());
        }
      }
      reset() {
        var t2;
        (null == (t2 = this._conversationsManager) || t2.reset(),
          (this._conversationsManager = null),
          (this.nu = void 0),
          (this.au = null),
          (this.lu = void 0),
          (this.ou = false));
      }
      loadIfEnabled() {
        if (!(
          this._conversationsManager ||
          this.su ||
          this._instance.config.disable_conversations ||
          Kr(this._instance.config) ||
          (this._instance.config.cookieless_mode && this._instance.consent.isOptedOut())
        )) {
          var t2 = null == v ? void 0 : v.__PosthogExtensions__;
          if (t2 && !K(this.nu) && this.nu)
            if (this.au && this.au.token) {
              this.su = true;
              try {
                var e2 = t2.initConversations;
                if (e2) return (this.uu(e2), void (this.su = false));
                var i2 = t2.loadExternalDependency;
                if (!i2) return void this.hu(kr);
                i2(this._instance, "conversations", (e3) => {
                  (e3 || !t2.initConversations
                    ? this.hu("Could not load conversations script", e3)
                    : this.uu(t2.initConversations),
                    (this.su = false));
                });
              } catch (t3) {
                (this.hu("Error initializing conversations", t3), (this.su = false));
              }
            } else Wl.error("Conversations enabled but missing token in remote config.");
        }
      }
      uu(t2) {
        if (this.au)
          try {
            ((this._conversationsManager = t2(this.au, this._instance)),
              (this.ou = false),
              Wl.info("Conversations loaded successfully"));
          } catch (t3) {
            this.hu("Error completing conversations initialization", t3);
          }
        else Wl.error("Cannot complete initialization: remote config is null");
      }
      hu(t2, e2) {
        (Wl.error(t2, e2),
          (this._conversationsManager = null),
          (this.su = false),
          (this.ou = true));
      }
      show() {
        this._conversationsManager
          ? this._conversationsManager.show()
          : Wl.warn("Conversations not loaded yet.");
      }
      hide() {
        this._conversationsManager && this._conversationsManager.hide();
      }
      isAvailable() {
        return true === this.nu && !Q(this._conversationsManager);
      }
      getUnavailableReason() {
        return this.isAvailable()
          ? null
          : this._instance.config.disable_conversations
            ? "disabled_by_config"
            : Kr(this._instance.config)
              ? "disabled_for_toolbar"
              : this._instance.config.cookieless_mode && this._instance.consent.isOptedOut()
                ? "consent_opted_out"
                : false === this.lu
                  ? "remote_config_failed"
                  : K(this.nu)
                    ? this.lu
                      ? "disabled_in_project"
                      : "remote_config_pending"
                    : this.nu
                      ? X(this.au) || !this.au.token
                        ? "missing_token"
                        : null != v && v.__PosthogExtensions__
                          ? this.su
                            ? "initializing"
                            : this.ou
                              ? "load_failed"
                              : "not_loaded"
                          : "extensions_unavailable"
                      : "disabled_in_project";
      }
      isVisible() {
        var t2, e2;
        return (
          null !== (t2 = null == (e2 = this._conversationsManager) ? void 0 : e2.isVisible()) &&
          void 0 !== t2 &&
          t2
        );
      }
      sendMessage(t2, e2, i2) {
        var r2 = this;
        return p(function* () {
          return r2._conversationsManager
            ? r2._conversationsManager.sendMessage(t2, e2, i2)
            : (Wl.warn(Gl), null);
        })();
      }
      getMessages(t2, e2) {
        var i2 = this;
        return p(function* () {
          return i2._conversationsManager
            ? i2._conversationsManager.getMessages(t2, e2)
            : (Wl.warn(Gl), null);
        })();
      }
      markAsRead(t2) {
        var e2 = this;
        return p(function* () {
          return e2._conversationsManager
            ? e2._conversationsManager.markAsRead(t2)
            : (Wl.warn(Gl), null);
        })();
      }
      getTickets(t2) {
        var e2 = this;
        return p(function* () {
          return e2._conversationsManager
            ? e2._conversationsManager.getTickets(t2)
            : (Wl.warn(Gl), null);
        })();
      }
      requestRestoreLink(t2) {
        var e2 = this;
        return p(function* () {
          return e2._conversationsManager
            ? e2._conversationsManager.requestRestoreLink(t2)
            : (Wl.warn(Gl), null);
        })();
      }
      restoreFromToken(t2) {
        var e2 = this;
        return p(function* () {
          return e2._conversationsManager
            ? e2._conversationsManager.restoreFromToken(t2)
            : (Wl.warn(Gl), null);
        })();
      }
      restoreFromUrlToken() {
        var t2 = this;
        return p(function* () {
          return t2._conversationsManager
            ? t2._conversationsManager.restoreFromUrlToken()
            : (Wl.warn(Gl), null);
        })();
      }
      getCurrentTicketId() {
        var t2, e2;
        return null !==
          (t2 = null == (e2 = this._conversationsManager) ? void 0 : e2.getCurrentTicketId()) &&
          void 0 !== t2
          ? t2
          : null;
      }
      getWidgetSessionId() {
        var t2, e2;
        return null !==
          (t2 = null == (e2 = this._conversationsManager) ? void 0 : e2.getWidgetSessionId()) &&
          void 0 !== t2
          ? t2
          : null;
      }
      hs() {
        var t2;
        null == (t2 = this._conversationsManager) || t2.setIdentity();
      }
      ds() {
        var t2;
        null == (t2 = this._conversationsManager) || t2.clearIdentity();
      }
    },
  },
  uu = {
    logs: class {
      constructor(e2) {
        var i2,
          r2 = this;
        ((this.du = false),
          (this.vu = false),
          (this.st = yi("[logs]")),
          (this.cu = _({}, this.st, {
            error() {
              for (var t2 = arguments.length, e3 = new Array(t2), i3 = 0; t2 > i3; i3++)
                e3[i3] = arguments[i3];
              e3.some(Ql) || r2.st.error(...e3);
            },
          })),
          (this.sr = []),
          (this.fu = []),
          (this.Fa = 0),
          (this.pu = () => {
            var t2, e3;
            ((this.Fa = 0),
              null == (t2 = this.gu) || t2.onReconnect(),
              null == (e3 = this.mu) || e3.onReconnect());
          }),
          (this._instance = e2),
          this._instance &&
            null != (i2 = this._instance.config.logs) &&
            i2.captureConsoleLogs &&
            (this.du = true),
          t && Gr(t, "online", this.pu));
      }
      yu(t2, e2, i2, r2) {
        var s2,
          n2 = (function (t3, e3) {
            var i3,
              r3,
              s3,
              n3,
              o2,
              a2,
              l2,
              u2 =
                null !== (i3 = null == t3 ? void 0 : t3.flushIntervalMs) && void 0 !== i3
                  ? i3
                  : 3e3,
              h2 =
                null !== (r3 = null == t3 ? void 0 : t3.maxBufferSize) && void 0 !== r3 ? r3 : 100,
              d2 =
                null != e3 && e3.consoleCapture
                  ? void 0
                  : null !== (s3 = null == t3 ? void 0 : t3.maxLogsPerInterval) && void 0 !== s3
                    ? s3
                    : 1e3,
              v2 = K(d2) ? Math.max(h2, 2048) : Math.max(h2, d2),
              c2 = null == t3 ? void 0 : t3.resourceAttributes;
            return {
              serviceName:
                null !==
                  (n3 =
                    null !== (o2 = null == c2 ? void 0 : c2["service.name"]) && void 0 !== o2
                      ? o2
                      : null == t3
                        ? void 0
                        : t3.serviceName) && void 0 !== n3
                  ? n3
                  : null == e3
                    ? void 0
                    : e3.serviceNameDefault,
              serviceVersion:
                null !== (a2 = null == c2 ? void 0 : c2["service.version"]) && void 0 !== a2
                  ? a2
                  : null == t3
                    ? void 0
                    : t3.serviceVersion,
              environment:
                null !== (l2 = null == c2 ? void 0 : c2["deployment.environment"]) && void 0 !== l2
                  ? l2
                  : null == t3
                    ? void 0
                    : t3.environment,
              resourceAttributes: c2,
              beforeSend: null == t3 ? void 0 : t3.beforeSend,
              flushIntervalMs: u2,
              maxBufferSize: h2,
              maxQueueSize: v2,
              maxBatchRecordsPerPost: 100,
              rateCapWindowMs: u2,
              maxLogsPerInterval: d2,
              backgroundFlushBudgetMs: 0,
              terminationFlushBudgetMs: 0,
            };
          })(null == (s2 = this._instance) || null == (s2 = s2.config) ? void 0 : s2.logs, i2);
        return [
          new Ie(
            this.bu(t2, e2),
            n2,
            this.cu,
            () => this._u(),
            (t3) => t3(),
            void 0,
            r2,
          ),
          n2,
        ];
      }
      wu() {
        var t2,
          e2 = null == (t2 = this._instance) || null == (t2 = t2.config) ? void 0 : t2.logs;
        if (!this.gu || this.ku !== e2) {
          var i2;
          (null == (i2 = this.gu) || i2.reset(), (this.ku = e2));
          var r2 = this.yu(
            () => this.sr,
            (t3) => {
              this.sr = t3;
            },
          );
          ((this.gu = r2[0]), (this.xu = r2[1]));
        }
        return this.gu;
      }
      Su() {
        var t2,
          e2 = null == (t2 = this._instance) || null == (t2 = t2.config) ? void 0 : t2.logs;
        if (!this.mu || this.Cu !== e2) {
          var i2;
          (null == (i2 = this.mu) || i2.reset(), (this.Cu = e2));
          var r2 = this.yu(
            () => this.fu,
            (t3) => {
              this.fu = t3;
            },
            { serviceNameDefault: "posthog-browser-logs", consoleCapture: true },
            Kl,
          );
          ((this.mu = r2[0]), (this.Mu = r2[1]));
        }
        return this.mu;
      }
      initialize() {
        this.loadIfEnabled();
      }
      onRemoteConfig(t2) {
        var e2;
        if (t2.ok) {
          var i2 = null == (e2 = t2.config.logs) ? void 0 : e2.captureConsoleLogs;
          !X(i2) && i2 && ((this.du = true), this.loadIfEnabled());
        }
      }
      reset() {
        var t2, e2;
        ((this.sr = []),
          null == (t2 = this.gu) || t2.reset(),
          (this.fu = []),
          null == (e2 = this.mu) || e2.reset(),
          (this.Fa = 0));
      }
      captureLog(t2) {
        this.wu().captureLog(t2);
      }
      he(t2) {
        this.Su().captureLog(t2);
      }
      get logger() {
        return (
          this.Tu ||
            (this.Tu = {
              trace: (t2, e2) => this.captureLog({ body: t2, level: "trace", attributes: e2 }),
              debug: (t2, e2) => this.captureLog({ body: t2, level: "debug", attributes: e2 }),
              info: (t2, e2) => this.captureLog({ body: t2, level: "info", attributes: e2 }),
              warn: (t2, e2) => this.captureLog({ body: t2, level: "warn", attributes: e2 }),
              error: (t2, e2) => this.captureLog({ body: t2, level: "error", attributes: e2 }),
              fatal: (t2, e2) => this.captureLog({ body: t2, level: "fatal", attributes: e2 }),
            }),
          this.Tu
        );
      }
      flushLogs(t2) {
        t2
          ? this.Eu(t2)
          : (this.gu && this.gu.flush().catch((t3) => this.Iu(t3)),
            this.mu && this.mu.flush().catch((t3) => this.Iu(t3)));
      }
      Iu(t2) {
        Ql(t2) || this.st.error("PostHog logs flush failed:", t2);
      }
      loadIfEnabled() {
        if (this.du && !this.vu) {
          var t2 = null == v ? void 0 : v.__PosthogExtensions__;
          if (t2) {
            var e2 = t2.loadExternalDependency;
            e2
              ? e2(this._instance, "logs", (e3) => {
                  var i2;
                  e3 || null == (i2 = t2.logs) || !i2.initializeLogs
                    ? this.st.error("Could not load logs script", e3)
                    : (t2.logs.initializeLogs(this._instance), (this.vu = true));
                })
              : this.st.error(kr);
          } else this.st.error("PostHog Extensions not found.");
        }
      }
      bu(t2, e2) {
        var i2 = this._instance;
        return {
          get isDisabled() {
            return false;
          },
          get optedOut() {
            return !i2.is_capturing();
          },
          getPersistedProperty: (e3) => (e3 === x.LogsQueue ? t2() : void 0),
          setPersistedProperty(t3, i3) {
            var r2;
            t3 === x.LogsQueue && e2(null !== (r2 = i3) && void 0 !== r2 ? r2 : []);
          },
          $t: (t3) => this.$t(t3),
          getLibraryId: () => c.LIB_NAME,
          getLibraryVersion: () => c.LIB_VERSION,
        };
      }
      $t(t2) {
        return new Promise((e2) => {
          if (En(this.Fa, 3))
            e2({
              kind: "fatal",
              error: Yl(void 0, "logs endpoint is unreachable, dropping batch"),
            });
          else {
            var i2 = false,
              r2 = (t3) => {
                i2 || ((i2 = true), clearTimeout(s2), e2(t3));
              },
              s2 = setTimeout(() => {
                (this.st.warn("Logs request timed out before receiving a response"),
                  r2({ kind: "retry-later", error: Yl(void 0, "logs request timed out") }));
              }, 9e4);
            this._instance._send_request({
              method: "POST",
              url: this.Pu(),
              data: t2,
              compression: "best-available",
              batchKey: "logs",
              fireCallbackOnDrop: true,
              callback: (t3) => {
                var e3 = t3.statusCode;
                if ((this.Ru(e3), e3 >= 200 && 300 > e3)) r2({ kind: "ok" });
                else if (413 === e3) r2({ kind: "too-large" });
                else if (0 !== e3 && 429 !== e3 && 500 > e3)
                  r2({ kind: "fatal", error: new Error("logs request failed with status " + e3) });
                else {
                  var i3;
                  0 === e3
                    ? (t3.error ||
                        this.st.warn("Logs request failed before receiving an HTTP response"),
                      r2({
                        kind: "retry-later",
                        error: Yl(
                          t3.error,
                          "logs request failed before receiving an HTTP response",
                        ),
                      }))
                    : r2({
                        kind: "retry-later",
                        error:
                          null !== (i3 = t3.error) && void 0 !== i3
                            ? i3
                            : new Error("logs request failed with status " + e3),
                      });
                }
              },
            });
          }
        });
      }
      Ru(t2) {
        (0 !== t2 || this._instance.__loaded) &&
          (this.Fa = xn(t2, this.Fa, 3, () =>
            this.st.warn(
              "Log requests are failing before receiving an HTTP response; this can happen due to network issues, CORS, browser blocking, or ad blockers. Stopped sending logs; will try again when connectivity changes.",
            ),
          ));
      }
      Eu(t2) {
        (this.sr.length > 0 &&
          this.Au(t2, this.sr, this.xu, c.LIB_NAME, (t3) => {
            this.sr = t3;
          }),
          this.fu.length > 0 &&
            this.Au(t2, this.fu, this.Mu, Kl, (t3) => {
              this.fu = t3;
            }));
      }
      Au(t2, e2, i2, r2, s2) {
        if (0 !== e2.length) {
          var n2 = e2.map((t3) => t3.record);
          s2([]);
          var o2 = Ce(n2, Oe(i2, c.LIB_NAME, c.LIB_VERSION), r2, c.LIB_VERSION);
          this._instance._send_request({
            method: "POST",
            url: this.Pu(),
            data: o2,
            compression: "best-available",
            batchKey: "logs",
            transport: t2,
          });
        }
      }
      Pu() {
        return (
          this._instance.requestRouter.endpointFor("api", "/i/v1/logs") +
          "?token=" +
          encodeURIComponent(this._instance.config.token)
        );
      }
      _u() {
        var t2,
          e2 = {};
        if (((e2.distinctId = this._instance.get_distinct_id()), this._instance.sessionManager)) {
          var i2 = this._instance.sessionManager.checkAndGetSessionAndWindowId(true),
            r2 = i2.windowId,
            s2 = i2.sessionStartTimestamp,
            n2 = i2.lastActivityTimestamp;
          ((e2.sessionId = i2.sessionId),
            (e2.windowId = r2),
            X(s2) || (e2.sessionStartTimestamp = s2),
            X(n2) || (e2.lastActivityTimestamp = n2));
        }
        if (
          (null != v &&
            null != (t2 = v.location) &&
            t2.href &&
            (e2.currentUrl = this._instance.config.disable_capture_url_hashes
              ? we(v.location.href)
              : v.location.href),
          this._instance.featureFlags)
        ) {
          var o2 = this._instance.featureFlags.getFlags();
          o2 && o2.length > 0 && (e2.activeFeatureFlags = o2);
        }
        return e2;
      }
    },
  },
  hu = {
    metrics: class {
      constructor(t2) {
        ((this.st = yi("[metrics]")), (this._instance = t2));
      }
      initialize() {}
      wu() {
        var t2,
          e2,
          i2 = null == (t2 = this._instance) || null == (t2 = t2.config) ? void 0 : t2.metrics;
        return (
          (this.gu && this.ku === i2) ||
            (null == (e2 = this.gu) || e2.reset(),
            (this.ku = i2),
            (this.gu = new De(
              this.bu(),
              (function (t3) {
                var e3,
                  i3,
                  r2,
                  s2,
                  n2,
                  o2 = null == t3 ? void 0 : t3.resourceAttributes;
                return {
                  serviceName:
                    null !== (e3 = null == o2 ? void 0 : o2["service.name"]) && void 0 !== e3
                      ? e3
                      : null == t3
                        ? void 0
                        : t3.serviceName,
                  serviceVersion:
                    null !== (i3 = null == o2 ? void 0 : o2["service.version"]) && void 0 !== i3
                      ? i3
                      : null == t3
                        ? void 0
                        : t3.serviceVersion,
                  environment:
                    null !== (r2 = null == o2 ? void 0 : o2["deployment.environment"]) &&
                    void 0 !== r2
                      ? r2
                      : null == t3
                        ? void 0
                        : t3.environment,
                  resourceAttributes: o2,
                  beforeSend: null == t3 ? void 0 : t3.beforeSend,
                  flushIntervalMs:
                    null !== (s2 = null == t3 ? void 0 : t3.flushIntervalMs) && void 0 !== s2
                      ? s2
                      : 1e4,
                  maxSeriesPerFlush:
                    null !== (n2 = null == t3 ? void 0 : t3.maxSeriesPerFlush) && void 0 !== n2
                      ? n2
                      : 1e3,
                };
              })(i2),
              this.st,
            ))),
          this.gu
        );
      }
      count(t2, e2, i2) {
        (void 0 === e2 && (e2 = 1), this.wu().count(t2, e2, i2));
      }
      gauge(t2, e2, i2) {
        this.wu().gauge(t2, e2, i2);
      }
      histogram(t2, e2, i2) {
        this.wu().histogram(t2, e2, i2);
      }
      flush(t2) {
        if (!this.gu) return Promise.resolve();
        if (t2) {
          var e2 = this.gu.drainWindow();
          return (e2 && this.Xt(e2, t2), Promise.resolve());
        }
        return this.gu.flush().catch((t3) => this.st.error("PostHog metrics flush failed:", t3));
      }
      reset() {
        var t2;
        null == (t2 = this.gu) || t2.reset();
      }
      bu() {
        var t2 = this._instance,
          e2 = this;
        return {
          get isDisabled() {
            return false;
          },
          get optedOut() {
            return !t2.is_capturing();
          },
          Xt: (t3) => e2.Xt(t3),
          getLibraryId: () => c.LIB_NAME,
          getLibraryVersion: () => c.LIB_VERSION,
        };
      }
      Xt(t2, e2) {
        return new Promise((i2) => {
          var r2 = false,
            s2 = (t3) => {
              r2 || ((r2 = true), clearTimeout(n2), i2(t3));
            },
            n2 = setTimeout(
              () => s2({ kind: "retry-later", error: new Error("metrics request timed out") }),
              9e4,
            );
          this._instance._send_request(
            _(
              {
                method: "POST",
                url: this.Fu(),
                data: t2,
                compression: "best-available",
                batchKey: "metrics",
              },
              e2 && { transport: e2 },
              {
                fireCallbackOnDrop: true,
                callback(t3) {
                  var e3 = t3.statusCode;
                  if (e3 >= 200 && 300 > e3) s2({ kind: "ok" });
                  else if (413 === e3) s2({ kind: "too-large" });
                  else if (0 !== e3 && 429 !== e3 && 500 > e3)
                    s2({
                      kind: "fatal",
                      error: new Error("metrics request failed with status " + e3),
                    });
                  else {
                    var i3;
                    s2({
                      kind: "retry-later",
                      error:
                        null !== (i3 = t3.error) && void 0 !== i3
                          ? i3
                          : new Error("metrics request failed with status " + e3),
                    });
                  }
                },
              },
            ),
          );
        });
      }
      Fu() {
        return (
          this._instance.requestRouter.endpointFor("api", "/i/v1/metrics") +
          "?token=" +
          encodeURIComponent(this._instance.config.token)
        );
      }
    },
  },
  du = _({}, Xl, Zl, tu, eu, iu, ru, nu, su, ou, au, lu, uu, hu);
tl.__defaultExtensionClasses = _({}, du);
var vu = (function () {
  c.SDK_DIST_CHANNEL = "npm";
  var e2 = (ja[Ka] = new tl());
  return (
    (function () {
      function e3() {
        e3.done ||
          ((e3.done = true),
          (Ja = false),
          Lr(ja, function (t2) {
            t2._dom_loaded();
          }));
      }
      null != r && r.addEventListener
        ? "complete" === r.readyState
          ? e3()
          : Gr(r, "DOMContentLoaded", e3, { capture: false })
        : t &&
          mi.error(
            "Browser doesn't support `document.addEventListener` so PostHog couldn't be initialized",
          );
    })(),
    e2
  );
})();
export {
  Hn as Compression,
  eo as DisplaySurveyType,
  tl as PostHog,
  ro as ProductTourEventName,
  so as ProductTourEventProperties,
  Zn as SurveyEventName,
  to as SurveyEventProperties,
  Vn as SurveyEventType,
  Jn as SurveyType,
  vu as default,
  vu as posthog,
};
