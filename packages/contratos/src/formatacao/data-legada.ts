// Datas no contrato (regra 7 do M07; cap-10 §10.2, sentinelas).
// O contrato trafega data vazia como null; quem converte para 1899-12-30 na gravação é o adaptador.
// Datas fora da faixa de sanidade (o legado tem, por exemplo, anos 5202) são mostradas com alerta de
// dado inválido, nunca "corrigidas".
import { z } from 'zod';
import { ErroValidacao } from '../validacao/erro.js';

/** Faixa de sanidade (parâmetro; padrão de mercado, POL-1). */
export const FAIXA_SANIDADE_PADRAO = { menorAno: 1900, maiorAno: 2100 } as const;

export type FaixaSanidade = { readonly menorAno: number; readonly maiorAno: number };

/** Data de calendário AAAA-MM-DD, ou null para "vazio". */
export const esquemaDataLegada = z.iso.date().nullable();

export type SituacaoData =
  | { readonly tipo: 'vazia' }
  | { readonly tipo: 'valida'; readonly ano: number; readonly mes: number; readonly dia: number }
  | { readonly tipo: 'fora-da-faixa'; readonly ano: number; readonly mes: number; readonly dia: number }
  | { readonly tipo: 'malformada'; readonly bruto: string };

export function classificarData(
  valor: string | null | undefined,
  faixa: FaixaSanidade = FAIXA_SANIDADE_PADRAO,
): SituacaoData {
  if (valor === null || valor === undefined || valor.trim() === '') return { tipo: 'vazia' };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim());
  if (!m) return { tipo: 'malformada', bruto: valor };
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  // setUTCFullYear e não Date.UTC: Date.UTC trata os anos 0 a 99 como 1900 a 1999 ("0005" viraria 1905).
  const d = new Date(0);
  d.setUTCFullYear(ano, mes - 1, dia);
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    return { tipo: 'malformada', bruto: valor };
  }
  if (ano < faixa.menorAno || ano > faixa.maiorAno) return { tipo: 'fora-da-faixa', ano, mes, dia };
  return { tipo: 'valida', ano, mes, dia };
}

/** dd/mm/aaaa sem conversão de fuso (data de calendário). */
export function formatarDataCalendario(s: { ano: number; mes: number; dia: number }): string {
  return `${String(s.dia).padStart(2, '0')}/${String(s.mes).padStart(2, '0')}/${String(s.ano).padStart(4, '0')}`;
}

/** "dd/mm/aaaa" digitado na tela → "AAAA-MM-DD"; vazio → null; inválido lança. */
export function lerDataDigitada(
  entrada: string,
  faixa: FaixaSanidade = FAIXA_SANIDADE_PADRAO,
): string | null {
  const t = entrada.trim();
  if (t === '') return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (!m)
    throw new ErroValidacao('data.formato', { entrada }, `Data inválida: "${entrada}". Use dd/mm/aaaa.`);
  const iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  const s = classificarData(iso, faixa);
  if (s.tipo === 'malformada') {
    throw new ErroValidacao('data.inexistente', { entrada }, `Data inexistente: "${entrada}".`);
  }
  if (s.tipo === 'fora-da-faixa') {
    throw new ErroValidacao(
      'data.fora-da-faixa',
      { entrada, menorAno: faixa.menorAno, maiorAno: faixa.maiorAno },
      `Ano fora da faixa aceita (${faixa.menorAno} a ${faixa.maiorAno}): "${entrada}".`,
    );
  }
  return iso;
}
