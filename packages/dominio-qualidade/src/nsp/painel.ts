// Painel do plano de segurança do paciente, etapa 2 do M48 (ficha, seção 7: "Adesão a protocolos e painel do PSP";
// RDC 36/2013, art. 8º; metas internacionais de segurança do paciente; cap-05b §5.11, Indicadores): cada indicador sai
// com o numerador e o denominador impressos (nunca só o percentual), e o período é de no máximo 12 meses.
import type { ContagemPainel, IndicadorPainel, PeriodoPainel } from '@sgh/contratos';

/** Dias do período padrão (os últimos 30, hoje incluído). */
export const DIAS_PERIODO_PADRAO = 30;
/** Período máximo do painel (dias). */
export const DIAS_PERIODO_MAXIMO = 366;

const dia = (d: string) => Date.parse(`${d}T00:00:00Z`);
const somaDias = (d: string, n: number) => new Date(dia(d) + n * 86_400_000).toISOString().slice(0, 10);

/** O período pedido, com os padrões; recusa o fim no futuro e o período maior que 12 meses. */
export function periodoDoPainel(
  p: PeriodoPainel,
  hoje: string,
):
  | { ok: true; de: string; ate: string; fimExclusivo: string }
  | { ok: false; motivo: 'periodo-longo' | 'fim-futuro' } {
  const ate = p.ate ?? hoje;
  if (ate > hoje) return { ok: false, motivo: 'fim-futuro' };
  const de = p.de ?? somaDias(ate, -(DIAS_PERIODO_PADRAO - 1));
  if ((dia(ate) - dia(de)) / 86_400_000 + 1 > DIAS_PERIODO_MAXIMO)
    return { ok: false, motivo: 'periodo-longo' };
  return { ok: true, de, ate, fimExclusivo: somaDias(ate, 1) };
}

/** Percentual com uma casa (null sem denominador). */
export function percentual(numerador: number, denominador: number): number | null {
  if (denominador <= 0) return null;
  return Math.round((numerador / denominador) * 1000) / 10;
}

export function indicador(
  codigo: string,
  titulo: string,
  numerador: number,
  denominador: number,
  fonte: string,
  meta: number | null = null,
): IndicadorPainel {
  return {
    codigo,
    titulo,
    numerador,
    denominador,
    percentual: percentual(numerador, denominador),
    meta,
    fonte,
  };
}

/** As contagens de um vocabulário inteiro (os códigos sem linha saem com zero), na ordem do vocabulário. */
export function contagensDoVocabulario(
  vocabulario: readonly { readonly codigo: string; readonly rotulo: string }[],
  linhas: readonly { readonly codigo: string; readonly quantidade: number }[],
): ContagemPainel[] {
  const m = new Map<string, number>();
  for (const l of linhas) m.set(l.codigo, (m.get(l.codigo) ?? 0) + l.quantidade);
  return vocabulario.map((v) => ({ codigo: v.codigo, rotulo: v.rotulo, quantidade: m.get(v.codigo) ?? 0 }));
}

export interface ContagensAdesao {
  /** Checagens do período e quantas com a pulseira lida (meta 1: identificação). */
  readonly checagens: number;
  readonly checagensComPulseira: number;
  /** Checklists de cirurgia segura do período, concluídos e com a pausa cirúrgica (meta 4). */
  readonly checklists: number;
  readonly checklistsConcluidos: number;
  readonly checklistsComPausa: number;
  /** Reavaliações devidas no período (prazo já vencido ou cumpridas) e cumpridas no prazo, por escala (metas 6 e LPP). */
  readonly reavaliacoes: readonly {
    readonly escala: 'morse' | 'braden';
    readonly devidas: number;
    readonly cumpridasNoPrazo: number;
  }[];
}

/** Os indicadores de adesão às metas internacionais com as parcelas (as fontes vêm dos registros do novo). */
export function indicadoresDeAdesao(c: ContagensAdesao): IndicadorPainel[] {
  const r = [
    indicador(
      'meta1-pulseira',
      'Meta 1 (identificação): checagens com a pulseira lida',
      c.checagensComPulseira,
      c.checagens,
      'Checagem à beira do leito',
    ),
    indicador(
      'meta4-checklist',
      'Meta 4 (cirurgia segura): checklists concluídos nos três momentos',
      c.checklistsConcluidos,
      c.checklists,
      'Checklist de cirurgia segura',
    ),
    indicador(
      'meta4-pausa',
      'Meta 4 (cirurgia segura): pausa cirúrgica feita antes da incisão',
      c.checklistsComPausa,
      c.checklists,
      'Checklist de cirurgia segura',
    ),
  ];
  for (const e of ['morse', 'braden'] as const) {
    const x = c.reavaliacoes.find((y) => y.escala === e) ?? { devidas: 0, cumpridasNoPrazo: 0 };
    r.push(
      indicador(
        e === 'morse' ? 'meta6-morse' : 'lpp-braden',
        e === 'morse'
          ? 'Meta 6 (quedas): reavaliações de risco de queda (Morse) no prazo'
          : 'Lesão por pressão: reavaliações de risco (Braden) no prazo',
        x.cumpridasNoPrazo,
        x.devidas,
        'Escores de enfermagem',
      ),
    );
  }
  return r;
}
