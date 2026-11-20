// Inventário das expressões Pascal-script do TExParser embutidas nos componentes do DFM (regra 5 da ficha
// do M09; ref 04 §3.3): ExpressionEnabled (habilitar) e ExpressionValue (calcular). O M09 só inventaria e
// classifica pelos padrões conhecidos; a tradução para JSON Logic com testes dourados é do M22 (regras/): a
// fonte é guardada sem comentários (no DFM eles vão até o fim da linha; a fonte normalizada perde as quebras) e
// cada expressão leva a regra convertida, ou o motivo de não ter convertido.
import { converterExpressao } from '../../regras/conversor.js';
import type { RegraLogica } from '../../regras/json-logic.js';
import { semComentarios } from '../../regras/pascal.js';

export type TipoExpressao = 'habilitar' | 'calcular';

export type PadraoExpressao =
  | 'habilitar-por-resposta'
  | 'dias-desde-data'
  | 'dose-vasoativa'
  | 'escore-soma'
  | 'classificacao-faixa'
  | 'antropometria'
  | 'vazia'
  | 'outro';

export const PADROES_EXPRESSAO: readonly PadraoExpressao[] = [
  'habilitar-por-resposta',
  'dias-desde-data',
  'dose-vasoativa',
  'escore-soma',
  'classificacao-faixa',
  'antropometria',
  'vazia',
  'outro',
];

export interface ExpressaoInventariada {
  readonly tipo: TipoExpressao;
  readonly padrao: PadraoExpressao;
  /** Componentes citados (cmp###), na ordem em que aparecem, sem repetição. */
  readonly referencias: readonly string[];
  /** Variáveis de contexto usadas (PacienteIdade, PacienteSexo, Date). */
  readonly contexto: readonly string[];
  /** Fonte normalizada (sem comentários, espaços colapsados); é definição do formulário, não dado de paciente. */
  readonly fonte: string;
  /** M22: regra em JSON Logic (null quando a expressão não atribui `result` ou não converteu). */
  readonly regra?: RegraLogica;
  /** M22: a conversão automática deu certo (meta da ficha: cerca de 95%). */
  readonly convertida?: boolean;
  readonly motivoConversao?: string | null;
}

export function normalizarExpressao(fonte: string): string {
  return fonte.replace(/\s+/g, ' ').trim();
}

function referencias(fonte: string): string[] {
  const vistas: string[] = [];
  for (const m of fonte.matchAll(/\bcmp\d+/gi)) {
    const r = m[0].toLowerCase();
    if (!vistas.includes(r)) vistas.push(r);
  }
  return vistas;
}

function contexto(fonte: string): string[] {
  const c: string[] = [];
  if (/\bPacienteIdade\b/i.test(fonte)) c.push('PacienteIdade');
  if (/\bPacienteSexo\b/i.test(fonte)) c.push('PacienteSexo');
  if (/\bDate\s*\(\s*\)/i.test(fonte)) c.push('Date');
  return c;
}

/** Classifica pelos padrões da ref 04 §3.3; o que não casar fica "outro" (contado, nunca forçado). */
export function classificarExpressao(tipo: TipoExpressao, fonteBruta: string): ExpressaoInventariada {
  // A classificação olha o texto com os comentários (ex.: "// Concent", "// Vazao" marcam a dose vasoativa);
  // a fonte guardada e convertida é a sem comentários.
  const fonte = normalizarExpressao(semComentarios(fonteBruta));
  const comComentarios = normalizarExpressao(fonteBruta);
  const refs = referencias(fonte);
  const ctx = contexto(fonte);
  let padrao: PadraoExpressao = 'outro';
  const itemIndex = (fonte.match(/ItemIndex/gi) ?? []).length;
  const iniciaisZeradas = (fonte.match(/\b[\p{L}_][\p{L}\p{N}_]*\s*:=\s*0\s*;/gu) ?? []).length;
  const faixas = (fonte.match(/>=\s*\d+\s*\)\s*and\s*\(\s*cmp\d+\s*<=\s*\d+/gi) ?? []).length;
  if (fonte === '') {
    padrao = 'vazia';
  } else if (
    ctx.includes('PacienteIdade') ||
    ctx.includes('PacienteSexo') ||
    /\bIMC\b|altura|peso estimado/i.test(comComentarios) ||
    /cmp(\d+)\s*\/\s*\(\s*cmp(\d+)\s*\*\s*cmp\2\s*\)/i.test(fonte)
  ) {
    padrao = 'antropometria';
  } else if (/Date\s*\(\s*\)\s*-\s*(DateToStr|StrToDate)?\s*\(?\s*cmp\d+/i.test(fonte)) {
    padrao = 'dias-desde-data';
  } else if (/\(\s*cmp\d+\s*\*\s*cmp\d+\s*\)\s*\//i.test(fonte) && /concent|vaz/i.test(comComentarios)) {
    padrao = 'dose-vasoativa';
  } else if (faixas >= 2 || (/result\s*:=\s*'[^']*'/i.test(fonte) && /[<>]=?/.test(fonte))) {
    padrao = 'classificacao-faixa';
  } else if (itemIndex >= 2 && (iniciaisZeradas >= 3 || /\+/.test(fonte))) {
    padrao = 'escore-soma';
  } else if (tipo === 'habilitar' && itemIndex >= 1 && /result\s*:=\s*(true|false)/i.test(fonte)) {
    padrao = 'habilitar-por-resposta';
  }
  const c = converterExpressao(fonte);
  return {
    tipo,
    padrao,
    referencias: refs,
    contexto: ctx,
    fonte,
    regra: c.regra,
    convertida: c.convertida,
    motivoConversao: c.motivo,
  };
}

export interface ResumoExpressoes {
  readonly habilitar: number;
  readonly calcular: number;
  readonly porPadrao: Readonly<Record<PadraoExpressao, number>>;
}

export function resumirExpressoes(lista: readonly ExpressaoInventariada[]): ResumoExpressoes {
  const porPadrao = Object.fromEntries(PADROES_EXPRESSAO.map((p) => [p, 0])) as Record<
    PadraoExpressao,
    number
  >;
  let habilitar = 0;
  let calcular = 0;
  for (const e of lista) {
    porPadrao[e.padrao]++;
    if (e.tipo === 'habilitar') habilitar++;
    else calcular++;
  }
  return { habilitar, calcular, porPadrao };
}
