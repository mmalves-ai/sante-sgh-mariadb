// Layout fluido em grade de 12 colunas a partir da largura do DFM (regra 4 da ficha do M09; cap-11 §11.1):
// largura ≥ 700 → 12; ~350 → 6; ~160 → 3. A ordem é a da árvore de perguntas (ORDEM do vínculo), não a
// posição em pixels. Na apresentação: a sentinela 1899-12-30 vira vazio e a hora sai em HH:MM pelo leitor neutro de
// @sgh/contratos (que também aceita a hora de quatro dígitos das linhas já gravadas; quem grava é o adaptador).
import { ErroHoraInvalida, lerHoraDigitada } from '@sgh/contratos';

/** Largura de referência do formulário no Delphi (grupo principal ≈ 744 a 750 px). */
export const LARGURA_REFERENCIA = 750;
export const COLUNAS_GRADE = 12;

export function colunasDaLargura(largura: number | undefined): number {
  if (largura === undefined || !Number.isFinite(largura) || largura <= 0) return COLUNAS_GRADE;
  if (largura >= 700) return COLUNAS_GRADE;
  return Math.min(COLUNAS_GRADE, Math.max(1, Math.round((largura * COLUNAS_GRADE) / LARGURA_REFERENCIA)));
}

/** `010102` → `01.01.02` (2 dígitos por nível, até 6 níveis). */
export function linkIdDaOrdem(ordem: string): string {
  const limpa = ordem.trim();
  if (!/^\d+$/.test(limpa) || limpa.length % 2 !== 0) {
    throw new Error(`Ordem "${ordem}" fora do formato do legado (pares de dígitos).`);
  }
  if (limpa.length > 12) throw new Error(`Ordem "${ordem}" com mais de 6 níveis.`);
  return limpa.match(/\d{2}/g)!.join('.');
}

/** Nível na árvore (1 a 6). */
export function nivelDaOrdem(ordem: string): number {
  return linkIdDaOrdem(ordem).split('.').length;
}

/** linkId do pai, ou null no nível 1. */
export function linkIdPai(linkId: string): string | null {
  const partes = linkId.split('.');
  return partes.length > 1 ? partes.slice(0, -1).join('.') : null;
}

/** Comparação da ordem da árvore (`01.02` antes de `01.10`, pai antes do filho). */
export function compararLinkId(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x !== y) return x - y;
  }
  return 0;
}

const SENTINELA = /^(1899-12-30|30\/12\/1899)/;

/** Data para a tela: a sentinela do Delphi vira vazio; ISO `AAAA-MM-DD` vira `DD/MM/AAAA`. */
export function apresentarData(valor: string | null | undefined): string {
  if (!valor) return '';
  const v = valor.trim();
  if (SENTINELA.test(v)) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

/** Hora gravada para `HH:MM` (só na apresentação, pelo leitor neutro). Valor fora do formato volta como está. */
export function apresentarHora(valor: string | null | undefined): string {
  if (!valor) return '';
  const v = valor.trim();
  try {
    return lerHoraDigitada(v) ?? '';
  } catch (e) {
    if (e instanceof ErroHoraInvalida) return v;
    throw e;
  }
}
