import { VietQR } from 'vietqr';

export interface VietQrBank {
  id: number;
  name: string;
  code: string;
  bin: string;
  shortName: string;
  logo: string;
}

let cachedBanks: VietQrBank[] | null = null;
let inflightBanks: Promise<VietQrBank[]> | null = null;

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
