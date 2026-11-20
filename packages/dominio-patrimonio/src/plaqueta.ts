// Plaqueta, QR e etiqueta do bem patrimonial (M54, etapa 6; ficha, seção 7: "etiqueta ZPL com QR").
// D-QR-546: o QR leva `PAT1:<estabelecimento>:<plaqueta>:<dígito>` (sem marca de produto, que é parâmetro; o dígito pega
// leitura truncada ou trocada). Quem lê digita a plaqueta quando o QR não lê: as duas formas valem no inventário.

const FORMATO_PLAQUETA = /^[A-Z0-9-]{1,20}$/;
const ALFABETO = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Plaqueta gerada: o código do estabelecimento em maiúsculas e o número da sequência com 6 dígitos (`PC000123`). */
export function formatarPlaqueta(hospital: string, numero: number): string {
  if (!Number.isInteger(numero) || numero < 1) throw new RangeError('Número de plaqueta inválido.');
  const prefixo = hospital.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const p = `${prefixo}${String(numero).padStart(6, '0')}`;
  if (!FORMATO_PLAQUETA.test(p)) throw new RangeError('Plaqueta longa demais.');
  return p;
}

/** Dígito de conferência (base 36, pesos pela posição). */
export function digitoQr(texto: string): string {
  let soma = 0;
  for (let i = 0; i < texto.length; i++) soma += texto.charCodeAt(i) * (i + 1);
  return ALFABETO[soma % 36] ?? '0';
}

/** O texto que vai no QR da etiqueta. */
export function textoDoQr(hospital: string, plaqueta: string): string {
  const base = `PAT1:${hospital.toLowerCase()}:${plaqueta}`;
  return `${base}:${digitoQr(base)}`;
}

export type CodigoLido =
  | { readonly ok: true; readonly plaqueta: string; readonly pelo: 'qr' | 'digitado' }
  | {
      readonly ok: false;
      readonly motivo: 'qr-invalido' | 'outro-estabelecimento' | 'formato';
      readonly mensagem: string;
    };

/** Lê o código do inventário ou da busca: o texto do QR (conferido) ou a plaqueta digitada. */
export function lerCodigo(texto: string, hospital: string): CodigoLido {
  const t = texto.trim();
  const qr = /^PAT1:([a-z0-9]{1,10}):([A-Z0-9-]{1,20}):([0-9A-Z])$/i.exec(t);
  if (qr) {
    const [, est = '', plaqueta = '', dv = ''] = qr;
    const base = `PAT1:${est.toLowerCase()}:${plaqueta.toUpperCase()}`;
    if (digitoQr(base) !== dv.toUpperCase())
      return {
        ok: false,
        motivo: 'qr-invalido',
        mensagem: 'O QR não confere: leia de novo ou digite a plaqueta.',
      };
    if (est.toLowerCase() !== hospital.toLowerCase())
      return {
        ok: false,
        motivo: 'outro-estabelecimento',
        mensagem: 'O bem é de outro estabelecimento da rede.',
      };
    return { ok: true, plaqueta: plaqueta.toUpperCase(), pelo: 'qr' };
  }
  if (/^PAT1:/i.test(t))
    return {
      ok: false,
      motivo: 'qr-invalido',
      mensagem: 'O QR não confere: leia de novo ou digite a plaqueta.',
    };
  const p = t.toUpperCase();
  if (!FORMATO_PLAQUETA.test(p))
    return { ok: false, motivo: 'formato', mensagem: 'A plaqueta tem até 20 letras, números ou hífen.' };
  return { ok: true, plaqueta: p, pelo: 'digitado' };
}

/** Campo de texto da ZPL: sem os caracteres de comando (^ e ~) e cortado. */
function campoZpl(texto: string, max: number): string {
  return texto
    .replace(/[\^~\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export interface DadosEtiqueta {
  readonly hospital: string;
  readonly plaqueta: string;
  readonly descricao: string;
  /** O nome do estabelecimento ou da marca (parâmetro; nunca fixo no código). */
  readonly titular: string;
}

/**
 * Etiqueta ZPL (50 × 25 mm a 203 dpi): o QR à esquerda (correção de erro M), a plaqueta, a descrição e o titular.
 * UTF-8 (`^CI28`).
 */
export function etiquetaZpl(d: DadosEtiqueta): string {
  const qr = textoDoQr(d.hospital, d.plaqueta);
  return [
    '^XA',
    '^CI28',
    '^PW400',
    '^LL200',
    `^FO16,16^BQN,2,4^FDMA,${qr}^FS`,
    `^FO176,24^A0N,34,34^FD${campoZpl(d.plaqueta, 20)}^FS`,
    `^FO176,72^A0N,20,20^FB216,3,2,L^FD${campoZpl(d.descricao, 72)}^FS`,
    `^FO176,160^A0N,18,18^FD${campoZpl(d.titular, 24)}^FS`,
    '^XZ',
  ].join('\n');
}
