// Regras do acordo com a fonte pagadora (06-FAT linha 1), lidas do banco do cliente numa visão só: percentual ou
// valor fixo sobre honorário, custo operacional, anestesia, filme e mat/med (regra_percentual_cobranca); desconto
// ou acréscimo por grupo de despesa (regra_desconto_grupo); percentual por via de acesso na cirurgia múltipla
// (regra_via_acesso, a regra da fonte pagadora e a padrão de todas); itens isentos (item_isento_cobranca) e tetos
// de cobrança com a ação no excedente (teto_cobranca). Cada regra vem com a vigência e a marca "vigente na data".
// Escopo: o estabelecimento da sessão (as regras com estabelecimento nulo valem para todos); nada de outro
// estabelecimento. Somente leitura.
import type { Leitor, NucleoProprio } from '@sgh/nucleo';
import { recusa } from '@sgh/nucleo';
import type { CtxPrecos } from './fonte.js';

type Linha = Record<string, unknown>;

const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const sim = (v: unknown) => v === true || v === 1 || v === '1';

export interface VigenciaRegra {
  readonly inicio: string;
  readonly fim: string | null;
  readonly vigente: boolean;
}

export interface RegrasDoAcordo {
  readonly data: string;
  readonly percentuais: readonly (VigenciaRegra & {
    readonly id: number;
    readonly tabela: number;
    readonly componente: string;
    readonly tipoPaciente: string;
    readonly plano: string | null;
    readonly grupo: string | null;
    readonly item: string | null;
    readonly percentual: number | null;
    readonly valorFixo: number | null;
    readonly quantidadeFixa: number | null;
  })[];
  readonly descontosGrupo: readonly (VigenciaRegra & {
    readonly id: number;
    readonly grupo: string;
    readonly subgrupo: string | null;
    readonly acrescimo: number;
    readonly desconto: number;
    readonly sobre: readonly string[];
    readonly regimes: readonly string[];
    readonly destacaNaFatura: boolean;
  })[];
  readonly viasAcesso: readonly (VigenciaRegra & {
    readonly id: number;
    readonly descricao: string;
    readonly via: string;
    readonly ordem: number;
    readonly percentual: number;
    readonly criterio: string;
    readonly padraoDeTodas: boolean;
  })[];
  readonly isentos: readonly (VigenciaRegra & {
    readonly id: number;
    readonly item: string | null;
    readonly grupo: string | null;
    readonly plano: string | null;
    readonly motivo: string;
  })[];
  readonly tetos: readonly (VigenciaRegra & {
    readonly id: number;
    readonly abrangencia: string;
    readonly item: string | null;
    readonly grupo: string | null;
    readonly valorTeto: number | null;
    readonly quantidadeMaxima: number | null;
    readonly ocorrenciasMaximas: number | null;
    readonly acao: string;
  })[];
}

/** A regra vale na data quando começou até ela e não terminou antes (fim nulo: sem término). */
export function vigenteNaData(inicio: string, fim: string | null, data: string): boolean {
  return inicio <= data && (fim === null || fim >= data);
}

function vig(r: Linha, data: string, ativo = true): VigenciaRegra {
  const inicio = dataIso(r['vigencia_inicio']) ?? '';
  const fim = dataIso(r['vigencia_fim']);
  return { inicio, fim, vigente: ativo && vigenteNaData(inicio, fim, data) };
}

const DO_ESTAB = (a: string) => `(${a}.estabelecimento_id IS NULL OR ${a}.estabelecimento_id = ?)`;

export async function regrasDoAcordoPropria(
  l: Leitor,
  est: number,
  conv: number,
  data: string,
): Promise<RegrasDoAcordo> {
  const percentuais = await l.consultar(
    `SELECT r.*, p.descricao AS plano, g.descricao AS grupo, i.descricao AS item
       FROM regra_percentual_cobranca r
       JOIN tabela_preco t ON t.id = r.tabela_preco_id AND t.estabelecimento_id = ?
       LEFT JOIN plano_fonte_pagadora p ON p.id = r.plano_fonte_pagadora_id
       LEFT JOIN grupo_faturamento g ON g.id = r.grupo_faturamento_id
       LEFT JOIN item_faturavel i ON i.id = r.item_faturavel_id
      WHERE r.fonte_pagadora_id = ? AND ${DO_ESTAB('r')}
      ORDER BY r.componente, r.vigencia_inicio DESC, r.id DESC`,
    [est, conv, est],
    { teto: 2_000 },
  );
  const descontos = await l.consultar(
    `SELECT r.*, g.descricao AS grupo, sg.descricao AS subgrupo
       FROM regra_desconto_grupo r
       JOIN contrato_fonte_pagadora k ON k.id = r.contrato_fonte_pagadora_id
       JOIN grupo_faturamento g ON g.id = r.grupo_faturamento_id
       LEFT JOIN subgrupo_faturamento sg ON sg.id = r.subgrupo_faturamento_id
      WHERE k.fonte_pagadora_id = ? AND k.estabelecimento_id = ? AND k.excluido_em IS NULL
      ORDER BY g.descricao, r.vigencia_inicio DESC, r.id DESC`,
    [conv, est],
    { teto: 2_000 },
  );
  const vias = await l.consultar(
    `SELECT r.*, v.descricao AS via
       FROM regra_via_acesso r JOIN via_acesso_cirurgico v ON v.id = r.via_acesso_cirurgico_id
      WHERE (r.fonte_pagadora_id = ? OR r.fonte_pagadora_id IS NULL) AND ${DO_ESTAB('r')}
      ORDER BY (r.fonte_pagadora_id IS NULL), v.descricao, r.ordem_procedimento, r.vigencia_inicio DESC, r.id DESC`,
    [conv, est],
    { teto: 2_000 },
  );
  const isentos = await l.consultar(
    `SELECT r.*, i.descricao AS item, g.descricao AS grupo, p.descricao AS plano
       FROM item_isento_cobranca r
       LEFT JOIN item_faturavel i ON i.id = r.item_faturavel_id
       LEFT JOIN grupo_faturamento g ON g.id = r.grupo_faturamento_id
       LEFT JOIN plano_fonte_pagadora p ON p.id = r.plano_fonte_pagadora_id
      WHERE r.fonte_pagadora_id = ? AND ${DO_ESTAB('r')}
      ORDER BY r.vigencia_inicio DESC, r.id DESC`,
    [conv, est],
    { teto: 2_000 },
  );
  const tetos = await l.consultar(
    `SELECT r.*, i.descricao AS item, g.descricao AS grupo
       FROM teto_cobranca r
       LEFT JOIN item_faturavel i ON i.id = r.item_faturavel_id
       LEFT JOIN grupo_faturamento g ON g.id = r.grupo_faturamento_id
      WHERE r.fonte_pagadora_id = ? AND ${DO_ESTAB('r')}
      ORDER BY r.abrangencia, r.vigencia_inicio DESC, r.id DESC`,
    [conv, est],
    { teto: 2_000 },
  );
  return {
    data,
    percentuais: percentuais.map((r) => ({
      id: Number(r['id']),
      tabela: Number(r['tabela_preco_id']),
      componente: String(r['componente']),
      tipoPaciente: String(r['tipo_paciente']),
      plano: txt(r['plano']),
      grupo: txt(r['grupo']),
      item: txt(r['item']),
      percentual: num(r['percentual']),
      valorFixo: num(r['valor_fixo']),
      quantidadeFixa: num(r['quantidade_fixa']),
      ...vig(r, data, sim(r['ativo'])),
    })),
    descontosGrupo: descontos.map((r) => ({
      id: Number(r['id']),
      grupo: String(r['grupo']),
      subgrupo: txt(r['subgrupo']),
      acrescimo: Number(r['percentual_acrescimo']),
      desconto: Number(r['percentual_desconto']),
      sobre: (
        [
          ['sobre_honorario', 'honorario'],
          ['sobre_custo_operacional', 'custo_operacional'],
          ['sobre_filme', 'filme'],
        ] as const
      )
        .filter(([c]) => sim(r[c]))
        .map(([, n]) => n),
      regimes: (
        [
          ['aplica_ambulatorial', 'ambulatorial'],
          ['aplica_externo', 'externo'],
          ['aplica_internacao', 'internacao'],
          ['aplica_urgencia', 'urgencia'],
          ['aplica_domiciliar', 'domiciliar'],
        ] as const
      )
        .filter(([c]) => sim(r[c]))
        .map(([, n]) => n),
      destacaNaFatura: sim(r['destaca_na_fatura']),
      ...vig(r, data),
    })),
    viasAcesso: vias.map((r) => ({
      id: Number(r['id']),
      descricao: String(r['descricao']),
      via: String(r['via']),
      ordem: Number(r['ordem_procedimento']),
      percentual: Number(r['percentual']),
      criterio: String(r['criterio_ordem']),
      padraoDeTodas: r['fonte_pagadora_id'] === null || r['fonte_pagadora_id'] === undefined,
      ...vig(r, data, sim(r['ativo'])),
    })),
    isentos: isentos.map((r) => ({
      id: Number(r['id']),
      item: txt(r['item']),
      grupo: txt(r['grupo']),
      plano: txt(r['plano']),
      motivo: String(r['motivo']),
      ...vig(r, data),
    })),
    tetos: tetos.map((r) => ({
      id: Number(r['id']),
      abrangencia: String(r['abrangencia']),
      item: txt(r['item']),
      grupo: txt(r['grupo']),
      valorTeto: num(r['valor_teto']),
      quantidadeMaxima: num(r['quantidade_maxima']),
      ocorrenciasMaximas: num(r['ocorrencias_maximas']),
      acao: String(r['acao']),
      ...vig(r, data, sim(r['ativo'])),
    })),
  };
}

/** Leitura das regras do acordo pelo núcleo, no estabelecimento da sessão. */
export class LeitorRegrasAcordo {
  constructor(private readonly nucleo: Pick<NucleoProprio, 'lerSomente'>) {}

  regras(c: CtxPrecos, conv: number, data: string): Promise<RegrasDoAcordo> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    const ctx = {
      cliente: c.cliente,
      estabelecimento: est,
      usuario: c.usuario,
      correlacao: (c.correlacao || c.traceId || 'precos').slice(0, 64),
    };
    return this.nucleo.lerSomente(ctx, (l) => regrasDoAcordoPropria(l, est, conv, data));
  }
}
