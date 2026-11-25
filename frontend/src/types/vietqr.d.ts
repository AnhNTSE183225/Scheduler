declare module 'vietqr' {
  export class VietQR {
    genQRCodeBase64(params: {
      bank: string;
      accountNumber: string;
      accountName: string;
      amount?: string;
      memo?: string;
      media?: 'png' | 'jpg' | 'svg';
    }): Promise<{
      data?: {
        code?: string;
        desc?: string;
        data?: {
          qrCode?: string;
          qrDataURL?: string;
        };
      };
    }>;
  }
}
