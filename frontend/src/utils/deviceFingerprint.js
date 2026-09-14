const FINGERPRINT_VERSION = 'balanced-v1';

let cachedFingerprintPromise = null;

function safeString(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function parseMajorVersion(value) {
  const parsed = Number.parseInt(String(value || '').split('.')[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeWindowsVersionFromUa(ntVersion) {
  const version = safeString(ntVersion);
  if (!version) return null;

  if (version === '10.0') {
    return null;
  }

  return {
    '6.3': '8.1',
    '6.2': '8',
    '6.1': '7',
    '6.0': 'Vista',
    '5.2': 'XP',
    '5.1': 'XP',
  }[version] || version;
}

function getWindowsVersionFromClientHints(clientHints = {}) {
  if (String(clientHints.platform || '').toLowerCase() !== 'windows') {
    return null;
  }

  const majorVersion = parseMajorVersion(clientHints.platformVersion);
  if (majorVersion === null || majorVersion <= 0) {
    return null;
  }

  return majorVersion >= 13 ? '11' : '10';
}

function normalizeOsSummary(osMatch, clientHints = {}) {
  if (!osMatch) {
    return { osName: 'Unknown OS', osVersion: null };
  }

  const osVersion = osMatch.match?.[1]?.replace(/_/g, '.') || null;
  if (osMatch.name === 'Windows') {
    return {
      osName: 'Windows',
      osVersion: getWindowsVersionFromClientHints(clientHints) || normalizeWindowsVersionFromUa(osVersion),
    };
  }

  return {
    osName: osMatch.name,
    osVersion,
  };
}

function parseUserAgent(userAgent = '', clientHints = {}) {
  const browserMatchers = [
    ['Edge', /\bEdg\/([\d.]+)/],
    ['Chrome', /\bChrome\/([\d.]+)/],
    ['Firefox', /\bFirefox\/([\d.]+)/],
    ['Safari', /\bVersion\/([\d.]+).*Safari\//],
  ];
  const osMatchers = [
    ['Windows', /Windows NT ([\d.]+)/],
    ['macOS', /Mac OS X ([\d_]+)/],
    ['iOS', /(?:iPhone|iPad).*OS ([\d_]+)/],
    ['Android', /Android ([\d.]+)/],
    ['Linux', /\bLinux\b/],
  ];

  const browserMatch = browserMatchers
    .map(([name, pattern]) => ({ name, match: userAgent.match(pattern) }))
    .find((entry) => entry.match);
  const osMatch = osMatchers
    .map(([name, pattern]) => ({ name, match: userAgent.match(pattern) }))
    .find((entry) => entry.match);
  const osSummary = normalizeOsSummary(osMatch, clientHints);

  return {
    browserName: browserMatch?.name || 'Unknown browser',
    browserVersion: browserMatch?.match?.[1]?.replace(/_/g, '.') || null,
    ...osSummary,
  };
}

async function getUserAgentHints() {
  const userAgentData = navigator.userAgentData;
  const platform = safeString(userAgentData?.platform);

  if (!userAgentData || typeof userAgentData.getHighEntropyValues !== 'function') {
    return { uaPlatform: platform, uaPlatformVersion: null };
  }

  try {
    const hints = await userAgentData.getHighEntropyValues(['platform', 'platformVersion']);
    return {
      uaPlatform: safeString(hints.platform) || platform,
      uaPlatformVersion: safeString(hints.platformVersion),
    };
  } catch {
    return { uaPlatform: platform, uaPlatformVersion: null };
  }
}

function getCanvasSignature() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.textBaseline = 'top';
    ctx.font = '16px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(0, 0, 100, 40);
    ctx.fillStyle = '#069';
    ctx.fillText('DoseFinder fingerprint', 6, 8);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(0, 128, 255, 0.65)';
    ctx.beginPath();
    ctx.arc(120, 35, 28, 0, Math.PI * 2, true);
    ctx.fill();

    return canvas.toDataURL();
  } catch {
    return null;
  }
}

function getGpuInfo() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      return { gpuVendor: null, gpuRenderer: null, webglSignature: null };
    }

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const gpuVendor = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
      : gl.getParameter(gl.VENDOR);
    const gpuRenderer = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);

    return {
      gpuVendor: safeString(gpuVendor),
      gpuRenderer: safeString(gpuRenderer),
      webglSignature: [
        gl.getParameter(gl.VERSION),
        gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        gpuVendor,
        gpuRenderer,
      ].filter(Boolean).join('|') || null,
    };
  } catch {
    return { gpuVendor: null, gpuRenderer: null, webglSignature: null };
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }

  return JSON.stringify(value);
}

async function sha256Hex(value) {
  if (!window.crypto?.subtle || typeof TextEncoder === 'undefined') {
    return null;
  }

  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function buildDeviceFingerprint() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  const userAgentHints = await getUserAgentHints();
  const userAgentSummary = parseUserAgent(navigator.userAgent || '', {
    platform: userAgentHints.uaPlatform,
    platformVersion: userAgentHints.uaPlatformVersion,
  });
  const gpuInfo = getGpuInfo();
  const screenResolution = window.screen
    ? `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio || 1}`
    : null;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  const language = navigator.language || (navigator.languages || [])[0] || null;
  const hardwareConcurrency = navigator.hardwareConcurrency || null;

  const summary = {
    ...userAgentSummary,
    screenResolution,
    timezone,
    language,
    hardwareConcurrency,
    ...userAgentHints,
    gpuVendor: gpuInfo.gpuVendor,
    gpuRenderer: gpuInfo.gpuRenderer,
  };

  const components = {
    version: FINGERPRINT_VERSION,
    userAgent: navigator.userAgent || null,
    platform: navigator.platform || null,
    screenResolution,
    colorDepth: window.screen?.colorDepth || null,
    pixelDepth: window.screen?.pixelDepth || null,
    timezone,
    language,
    languages: Array.isArray(navigator.languages) ? navigator.languages.join('|') : null,
    hardwareConcurrency,
    deviceMemory: navigator.deviceMemory || null,
    gpuVendor: gpuInfo.gpuVendor,
    gpuRenderer: gpuInfo.gpuRenderer,
    webglSignature: gpuInfo.webglSignature,
    canvasSignature: getCanvasSignature(),
  };

  const fingerprintHash = await sha256Hex(stableStringify(components));

  return {
    version: FINGERPRINT_VERSION,
    ...(fingerprintHash ? { fingerprintHash } : {}),
    summary,
  };
}

export function collectDeviceFingerprint() {
  if (!cachedFingerprintPromise) {
    cachedFingerprintPromise = buildDeviceFingerprint().catch(() => null);
  }

  return cachedFingerprintPromise;
}
