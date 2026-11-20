// QR do cadastro do segundo fator (a URI otpauth:// só aparece à própria pessoa, depois da senha conferida).
import qrcode from 'qrcode-generator';

export interface QrDesenho {
  readonly lado: number;
  readonly caminho: string;
}

export function desenharQr(texto: string, modulo = 4, margem = 4): QrDesenho {
  const qr = qrcode(0, 'M');
  qr.addData(texto, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  let caminho = '';
  for (let l = 0; l < n; l++)
    for (let c = 0; c < n; c++)
      if (qr.isDark(l, c))
        caminho += `M${(c + margem) * modulo},${(l + margem) * modulo}h${modulo}v${modulo}h-${modulo}z`;
  return { lado: (n + margem * 2) * modulo, caminho };
}
