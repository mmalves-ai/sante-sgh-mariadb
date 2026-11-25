// Competência de trabalho do faturista (F3.7, 06-FAT linha 32): cada usuário escolhe, por módulo do faturamento, o mês
// em que está trabalhando (e, se quiser, um período dentro dele). As telas usam essa escolha como padrão dos filtros,
// e não o mês do relógio: quem fecha outubro em novembro não precisa trocar o mês a cada tela. A regra fica aqui; a
// gravação é a operação faturamento.definir-competencia-trabalho (apps/api, tiss/competencia-trabalho-propria.ts).

/** Os módulos do faturamento que têm competência própria de trabalho. */
export const MODULOS_COMPETENCIA_TRABALHO = [
  'fonte_pagadora',
  'sus_ambulatorial',
  'sus_internacao',
  'repasse',
  'rpa',
] as const;
export type ModuloCompetenciaTrabalho = (typeof MODULOS_COMPETENCIA_TRABALHO)[number];

/** Quantos anos para trás a competência de trabalho pode ir (prazo de cobrança de 5 anos). */
export const ANOS_COMPETENCIA_TRABALHO = 5;

export interface PedidoCompetenciaTrabalho {
  readonly modulo: string;
  /** AAAA-MM. */
  readonly competencia: string;
  /** AAAA-MM-DD, opcional: o período de trabalho dentro da competência. */
  readonly periodoInicio?: string | null;
  readonly periodoFim?: string | null;
  /** AAAA-MM-DD de hoje, no fuso do estabelecimento. */
  readonly hoje: string;
}

export interface RecusaCompetenciaTrabalho {
  readonly codigo:
    | 'modulo-invalido'
    | 'competencia-invalida'
    | 'competencia-futura'
    | 'competencia-antiga'
    | 'periodo-fora-da-competencia'
    | 'periodo-invertido';
  readonly mensagem: string;
  readonly campos: readonly string[];
}

const MES = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

const indiceMes = (aaaaMm: string): number => {
  const [a, m] = aaaaMm.split('-').map(Number);
  return a! * 12 + (m! - 1);
};

function dataValida(d: string): boolean {
  if (!DIA.test(d)) return false;
  const dt = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d;
}

export function conferirCompetenciaTrabalho(p: PedidoCompetenciaTrabalho): RecusaCompetenciaTrabalho | null {
  if (!(MODULOS_COMPETENCIA_TRABALHO as readonly string[]).includes(p.modulo))
    return { codigo: 'modulo-invalido', mensagem: 'Módulo do faturamento desconhecido.', campos: ['modulo'] };
  if (!MES.test(p.competencia))
    return {
      codigo: 'competencia-invalida',
      mensagem: 'Informe a competência no formato mês/ano.',
      campos: ['competencia'],
    };
  const atual = indiceMes(p.hoje.slice(0, 7));
  const escolhida = indiceMes(p.competencia);
  if (escolhida > atual)
    return {
      codigo: 'competencia-futura',
      mensagem:
        'A competência de trabalho não pode ser posterior ao mês corrente: ainda não há produção para faturar.',
      campos: ['competencia'],
    };
  if (escolhida < atual - ANOS_COMPETENCIA_TRABALHO * 12)
    return {
      codigo: 'competencia-antiga',
      mensagem: `A competência de trabalho não pode ser anterior a ${ANOS_COMPETENCIA_TRABALHO} anos.`,
      campos: ['competencia'],
    };
  const inicio = p.periodoInicio || null;
  const fim = p.periodoFim || null;
  for (const [campo, d] of [
    ['periodoInicio', inicio],
    ['periodoFim', fim],
  ] as const) {
    if (d !== null && (!dataValida(d) || d.slice(0, 7) !== p.competencia))
      return {
        codigo: 'periodo-fora-da-competencia',
        mensagem: 'O período de trabalho tem de estar dentro do mês da competência.',
        campos: [campo],
      };
  }
  if (inicio !== null && fim !== null && fim < inicio)
    return {
      codigo: 'periodo-invertido',
      mensagem: 'O fim do período não pode ser antes do início.',
      campos: ['periodoFim'],
    };
  return null;
}

/** A competência que as telas usam como padrão: a de trabalho do usuário, ou o mês corrente sem ela. */
export function competenciaPadrao(trabalho: string | null | undefined, hoje: string): string {
  return trabalho && MES.test(trabalho) ? trabalho : hoje.slice(0, 7);
}
