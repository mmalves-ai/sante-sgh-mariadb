// Comuns das telas do cálculo mensal da folha (M53.3, etapa F2): percentuais em centésimos de ponto e valores em
// centavos lidos do campo da tela (formato do Brasil), a quantidade da linha do cálculo no formato da unidade, o filtro e
// a ordem da grade de colaboradores (local: a resposta do cálculo já vem inteira, com teto no servidor), as rubricas que
// servem a cada papel (a mesma regra que o servidor confere) e o rascunho dos parâmetros a partir da vigência em vigor.
import type {
  ColaboradorCalculado,
  LinhaCalculoFolha,
  ParametrosFolhaLidos,
  PapelCalculoFolha,
  RegistrarParametrosFolhaEntrada,
  RubricaFolha,
  TipoLinhaFolha,
} from '@sgh/contratos';
import { PAPEIS_CALCULO_FOLHA } from '@sgh/contratos';
import { horas, reais } from '../comum-folha.js';

const NUMERO = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** 5000 → "50%"; 3333 → "33,33%". */
export const percentualBr = (centesimos: number) => `${NUMERO.format(centesimos / 100)}%`;

/** "50", "33,33" ou "33.33" → 5000 / 3333; nulo se não for número (no máximo duas casas). */
export function lerCentesimos(texto: string): number | null {
  const t = texto.trim().replace('%', '').trim().replace(',', '.');
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/** 5000 → "50"; 3333 → "33,33" (o texto do campo). */
export const textoCentesimos = (c: number) => NUMERO.format(c / 100).replace(/\./g, '');

/** "1.234,56", "1234,56" ou "1234" → 123456 centavos; nulo se não for valor. */
export function lerCentavos(texto: string): number | null {
  const t = texto.trim().replace(/^R\$\s*/, '');
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(t)) return null;
  const [inteiro, frac = ''] = t.replace(/\./g, '').split(',');
  return Number(inteiro) * 100 + Number(frac.padEnd(2, '0'));
}

/** A quantidade da linha no formato da unidade (dias, horas, dependentes, percentual); vazio quando é só valor. */
export function quantidadeDaLinha(l: Pick<LinhaCalculoFolha, 'quantidade' | 'unidade'>): string {
  switch (l.unidade) {
    case 'dias':
      return `${l.quantidade} d`;
    case 'minutos':
      return `${horas(l.quantidade)} h`;
    case 'dependentes':
      return String(l.quantidade);
    case 'percentual':
      return percentualBr(l.quantidade);
    default:
      return '';
  }
}

/** Soma dos valores das linhas de um tipo (a prova impressa no holerite e na memória). */
export const somaDoTipo = (ls: readonly LinhaCalculoFolha[], tipo: TipoLinhaFolha) =>
  ls.filter((l) => l.tipo === tipo).reduce((a, l) => a + l.valor, 0);

export type CampoGrade = 'vinculo' | 'proventos' | 'descontos' | 'liquido' | 'encargos';

/** Filtro (matrícula, vínculo ou centro de custo) e ordem da grade de colaboradores. */
export function filtrarColaboradores(
  cs: readonly ColaboradorCalculado[],
  termo: string,
  ordem: { campo: CampoGrade; direcao: 'asc' | 'desc' },
): ColaboradorCalculado[] {
  const t = termo.trim().toLowerCase();
  const r = t
    ? cs.filter(
        (c) =>
          String(c.vinculo).includes(t) ||
          (c.matricula ?? '').toLowerCase().includes(t) ||
          String(c.centroCusto) === t,
      )
    : [...cs];
  const s = ordem.direcao === 'asc' ? 1 : -1;
  return r.sort((a, b) => (a[ordem.campo] - b[ordem.campo]) * s || a.vinculo - b.vinculo);
}

/** As rubricas da empresa que servem a um papel do cálculo (a mesma regra do servidor). */
export function rubricasDoPapel(rs: readonly RubricaFolha[], tipo: TipoLinhaFolha): RubricaFolha[] {
  return rs.filter((r) =>
    tipo === 'provento'
      ? r.tipo === 'provento'
      : tipo === 'desconto'
        ? r.tipo === 'desconto'
        : r.tipo === 'base' || r.tipo === 'informativa' || r.tipo === 'informativaDedutora',
  );
}

/** Valores de partida de uma nova vigência dos parâmetros: os em vigor, ou os da lei (CLT e regra geral). */
export function rascunhoParametros(
  empresa: number,
  inicio: string,
  atual: ParametrosFolhaLidos | null,
): RegistrarParametrosFolhaEntrada {
  if (atual)
    return {
      empresa,
      inicio,
      percentuais: { ...atual.percentuais },
      encargos: { ...atual.encargos },
      divisorHoras: atual.divisorHoras,
      rubricas: { ...atual.rubricas },
    };
  return {
    empresa,
    inicio,
    percentuais: {
      horaExtra50: 5000,
      horaExtra100: 10000,
      adicionalNoturno: 2000,
      sobreaviso: 3333,
      periculosidade: 3000,
    },
    encargos: { inssPatronal: 2000, ratAjustado: 200, terceiros: 580, fgts: 800 },
    divisorHoras: 220,
    rubricas: Object.fromEntries(PAPEIS_CALCULO_FOLHA.map((p) => [p, null])) as Record<
      PapelCalculoFolha,
      number | null
    >,
  };
}

/** A vigência em vigor numa data (a de início mais recente até a data). */
export function vigenteEm<T extends { inicio: string }>(itens: readonly T[], data: string): T | null {
  let r: T | null = null;
  for (const i of itens) if (i.inicio <= data && (!r || i.inicio > r.inicio)) r = i;
  return r;
}

/** Último dia da competência (AAAA-MM → AAAA-MM-DD). */
export function ultimoDia(competencia: string): string {
  const a = Number(competencia.slice(0, 4));
  const m = Number(competencia.slice(5, 7));
  const d = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${competencia}-${String(d).padStart(2, '0')}`;
}

export { horas, reais };
