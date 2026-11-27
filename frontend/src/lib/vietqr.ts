import { VietQR } from 'vietqr';

export interface VietQrBank {
  id: number;
  name: string;
  code: string;
  bin: string;
  shortName: string;
  logo: string;
}

export interface VietQrApp {
  appId: string;
  appName: string;
  bankName: string;
  deeplink: string;
  autofill?: number;
}

let cachedBanks: VietQrBank[] | null = null;
let inflightBanks: Promise<VietQrBank[]> | null = null;
const cachedApps: Partial<Record<'ios' | 'android', VietQrApp[]>> = {};

export function detectMobileOs(): 'ios' | 'android' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

export async function fetchVietQrBankApps(platform?: 'ios' | 'android'): Promise<VietQrApp[]> {
  const os = platform ?? (detectMobileOs() === 'ios' ? 'ios' : 'android');
  if (cachedApps[os]) return cachedApps[os]!;
  const url =
    os === 'ios'
      ? 'https://api.vietqr.io/v2/ios-app-deeplinks'
      : 'https://api.vietqr.io/v2/android-app-deeplinks';
  try {
    const res = await fetch(url);
    const json = (await res.json()) as { apps?: VietQrApp[] };
    const list = Array.isArray(json?.apps) ? json.apps : [];
    cachedApps[os] = list;
    return list;
  } catch {
    return [];
  }
}

export function buildVietQrDeeplink(params: {
  appId: string;
  accountNumber: string;
  bankCode: string;
  amountVnd: number;
  memo?: string;
  accountName?: string;
}): string {
  const q = new URLSearchParams({
    app: params.appId,
    ba: `${params.accountNumber}@${params.bankCode.toLowerCase()}`,
    am: String(Math.max(0, Math.round(params.amountVnd))),
    tn: (params.memo || 'PulsePlan Split Bill').slice(0, 50),
  });
  if (params.accountName?.trim()) {
    q.set('bn', params.accountName.trim().slice(0, 50));
  }
  return `https://dl.vietqr.io/pay?${q.toString()}`;
}

export async function fetchVietQrBanks(): Promise<VietQrBank[]> {
  if (cachedBanks) return cachedBanks;
  if (inflightBanks) return inflightBanks;

  inflightBanks = fetch('https://api.vietqr.io/v2/banks')
    .then((r) => r.json())
    .then((json: { data?: VietQrBank[] }) => {
      cachedBanks = Array.isArray(json?.data) ? json.data : [];
      return cachedBanks;
    })
    .catch(() => {
      inflightBanks = null;
      return [];
    });

  return inflightBanks;
}

export function formatVnd(amount: number): string {
  return `${Math.round(amount).toLocaleString('en-US')} ₫`;
}

export async function generateVietQrDataUrl(params: {
  bankBin: string;
  accountNumber: string;
  accountName: string;
  amountVnd: number;
  memo?: string;
}): Promise<string> {
  const qr = new VietQR();
  const cleanName = (params.accountName || 'PULSEPLAN USER').trim() || 'PULSEPLAN USER';
  const res = (await qr.genQRCodeBase64({
    bank: params.bankBin,
    accountNumber: params.accountNumber,
    accountName: cleanName,
    amount: String(Math.max(0, Math.round(params.amountVnd))),
    memo: (params.memo || 'PulsePlan Split Bill').slice(0, 50),
  })) as { data?: { code?: string; desc?: string; data?: { qrDataURL?: string } } };

  const url = res?.data?.data?.qrDataURL;
  if (!url || !url.startsWith('data:image/')) {
    throw new Error(res?.data?.desc || 'Failed to generate VietQR code');
  }
  return url;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header = '', b64 = ''] = dataUrl.split(',');
  const mimeMatch = header.match(/data:([^;]+)/);
  const mime = mimeMatch?.[1] || 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Save a QR data URL as a PNG image.
 * On iOS/iPadOS Safari & PWAs, `<a download>` on `data:` URLs fails silently or cannot
 * save to Photos, so we invoke the native Share Sheet (`navigator.share({ files })` ->
 * "Save Image") synchronously within the user gesture.
 */
export async function saveQrImage(dataUrl: string, filename: string): Promise<void> {
  const blob = dataUrlToBlob(dataUrl);
  const isIos =
    typeof navigator !== 'undefined' &&
    (/iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

  if (isIos && typeof navigator.share === 'function' && typeof File === 'function') {
    const file = new File([blob], filename, { type: blob.type || 'image/png' });
    if (!navigator.canShare || navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'VietQR' });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
  }

  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
}
