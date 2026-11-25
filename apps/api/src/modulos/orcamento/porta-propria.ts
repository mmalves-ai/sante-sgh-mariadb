// Porta PRÓPRIA do orçamento empresarial (M54, etapa 7) sobre o MariaDB do cliente, pelo @sgh/nucleo: versao_orcamento
// e linha_orcamento (gravadas pelo Executor, com a trilha, o outbox e a idempotência na mesma transação); o apoio vem de
// centro_custo (do estabelecimento) e do plano gerencial (grupo_natureza_financeira, subgrupo_natureza_financeira e
// natureza_financeira, da rede inteira: o plano é do cliente, não do estabelecimento); o realizado, de titulo_pagar e
// titulo_receber (com rateio_lancamento por centro) e de consumo_centro_custo.
// Toda leitura de versão filtra o estabelecimento da sessão e `excluido_em IS NULL`.
// Melhoria: a chave do item gerencial é a do plano próprio (ids de grupo, subgrupo e natureza financeira); o centro
// "sem centro" é NULL no banco (nunca 0).
// Melhoria: o realizado já vem apropriado por centro pelo rateio do título (valor do rateio), sem repartir no servidor.
// Melhoria: a aprovação marca a versão como oficial e desmarca a substituída na mesma transação, com a trava
// otimista pela `versao` (o rascunho mudou: 409 conflito-versao).
// Melhoria: base da versão estruturada (tipo_base, versão copiada e percentual de ajuste) e vigência do ano.
// Gravação das linhas: a inclusão vai em INSERT de várias linhas (até 5.000 por versão, em lotes de 500), com
// criado_em/criado_por em cada linha e a contagem na trilha do cabeçalho — uma escrita registrada por linha incharia a
// trilha (o JSON das escritas) sem dar informação nova. A alteração e a remoção são linha a linha, por `tx.alterar`
// (trava otimista pela `versao` da linha, cada uma nas escritas registradas da trilha), e a remoção é lógica
// (`excluido_em`/`excluido_por`), nunca DELETE físico.
// Melhoria: o realizado não conta o título renegociado (o valor segue no título novo da renegociação).
// A linha de consumo por centro grava sem o item de estoque (a migração 14_FIN/11 retirou ck_linha_orcamento_consumo:
// o orçamento de consumo é o total valorizado do centro). Pendente: os parâmetros do orçamento.
import {
  type CentroOrcamento,
  type ItemGerencialOrcamento,
  type LinhaOrcamento,
  MESES_ORCAMENTO,
  type NaturezaOrcamento,
  type OrcamentoVersao,
  type SituacaoVersaoOrcamento,
} from '@sgh/contratos';
import type { RealizadoBruto } from '@sgh/dominio-financeiro';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Escritor,
  type Executor,
  type Leitor,
  recusa,
  restricaoUnicaViolada,
  travarEConferir,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import {
  type ApoioOrcamentoDados,
  type ContextoOrcamento,
  type GravacaoOrcamento,
  type LinhaOrcamentoParaGravar,
  type PlanoLinhasOrcamento,
  type PortaOrcamento,
  type RealizadoAno,
  rotuloBaseOrcamento,
  type VersaoOrcamentoNova,
} from './porta.js';

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoOrcamento {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

const TETO_CENTROS = 2000;
const TETO_ITENS = 5000;
const TETO_VERSOES = 500;
const TETO_LINHAS = 5000;
const TETO_REALIZADO = 50_000;
/** Linhas por INSERT de várias linhas (a versão nova pode ter até 5000). */
const LOTE_INSERCAO = 500;
/** A versão do orçamento é do estabelecimento: uma só "empresa" no contrato da tela. */
const EMPRESA_UNICA = 1;

const MESES = Array.from(
  { length: MESES_ORCAMENTO },
  (_, i) => `valor_mes_${String(i + 1).padStart(2, '0')}`,
);

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};
const inteiro = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
/** DECIMAL(15,2) do banco (texto ou número) em centavos, sem erro de ponto flutuante. */
export function centavosDe(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const t = String(v).trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,2})\d*)?$/.exec(t);
  if (!m) return Math.round(Number(t) * 100);
  const c = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -c : c;
}
/** Centavos em DECIMAL(15,2) (texto exato). */
export function decimalDe(centavos: number): string {
  const neg = centavos < 0;
  const a = Math.abs(centavos);
  return `${neg ? '-' : ''}${Math.trunc(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}
const instanteIso = (v: unknown): string | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'string' && v) {
    const d = new Date(`${v.replace(' ', 'T')}Z`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
};
const dataIso = (v: unknown): string | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const t = texto(v);
  return t ? t.slice(0, 10) : null;
};

const SITUACOES: Readonly<Record<string, SituacaoVersaoOrcamento>> = {
  rascunho: 'rascunho',
  em_aprovacao: 'rascunho',
  aprovado: 'aprovado',
  substituido: 'substituido',
  descartado: 'descartado',
};

const COLUNAS_VERSAO = `v.id, v.ano, v.numero_versao, v.descricao, v.situacao, v.tipo_base, v.percentual_ajuste_base,
  b.ano AS base_ano, b.numero_versao AS base_numero, v.versao, v.criado_em, v.alterado_em, v.aprovado_em, v.observacao,
  v.motivo_descarte, uc.login AS criado_login, ua.login AS alterado_login, up.login AS aprovador_login,
  (SELECT COUNT(*) FROM linha_orcamento l WHERE l.versao_orcamento_id = v.id AND l.excluido_em IS NULL) AS n_linhas,
  (SELECT COALESCE(SUM(l.valor_total), 0) FROM linha_orcamento l
    WHERE l.versao_orcamento_id = v.id AND l.excluido_em IS NULL AND l.natureza = 'despesa') AS t_despesa,
  (SELECT COALESCE(SUM(l.valor_total), 0) FROM linha_orcamento l
    WHERE l.versao_orcamento_id = v.id AND l.excluido_em IS NULL AND l.natureza = 'receita') AS t_receita,
  (SELECT COALESCE(SUM(l.valor_total), 0) FROM linha_orcamento l
    WHERE l.versao_orcamento_id = v.id AND l.excluido_em IS NULL AND l.natureza = 'consumo') AS t_consumo`;

const DE_VERSAO = `versao_orcamento v
  LEFT JOIN versao_orcamento b ON b.id = v.base_versao_orcamento_id
  LEFT JOIN usuario uc ON uc.id = v.criado_por
  LEFT JOIN usuario ua ON ua.id = v.alterado_por
  LEFT JOIN usuario up ON up.id = v.aprovador_usuario_id`;

function versaoDaLinha(x: Record<string, unknown>): OrcamentoVersao {
  const porNatureza: Record<NaturezaOrcamento, number> = {
    despesa: centavosDe(x['t_despesa']),
    receita: centavosDe(x['t_receita']),
    consumo: centavosDe(x['t_consumo']),
  };
  const situacao = SITUACOES[String(x['situacao'])] ?? 'rascunho';
  const ano = inteiro(x['ano']);
  const tipoBase = String(x['tipo_base']) as 'vazio' | 'copia_versao' | 'realizado';
  const copia =
    x['base_ano'] == null ? null : { ano: inteiro(x['base_ano']), numero: inteiro(x['base_numero']) };
  const ajuste = Math.round(Number(x['percentual_ajuste_base'] ?? 0) * 100);
  const criadoEm = instanteIso(x['criado_em']) ?? '';
  return {
    id: inteiro(x['id']),
    empresa: EMPRESA_UNICA,
    ano,
    numero: inteiro(x['numero_versao']),
    descricao: texto(x['descricao']) ?? '',
    situacao,
    base: rotuloBaseOrcamento(tipoBase, ano, copia, ajuste),
    linhas: inteiro(x['n_linhas']),
    totalCentavos: porNatureza.despesa + porNatureza.receita + porNatureza.consumo,
    totaisPorNatureza: porNatureza,
    versao: inteiro(x['versao']),
    criadoPor: texto(x['criado_login']) ?? '',
    criadoEm,
    alteradoPor: texto(x['alterado_login']) ?? texto(x['criado_login']) ?? '',
    alteradoEm: instanteIso(x['alterado_em']) ?? criadoEm,
    aprovadoPor: situacao === 'aprovado' || situacao === 'substituido' ? texto(x['aprovador_login']) : null,
    aprovadoEm: instanteIso(x['aprovado_em']),
    observacaoAprovacao:
      situacao === 'aprovado' || situacao === 'substituido' ? texto(x['observacao']) : null,
    // O descarte é a última alteração da versão: quem descartou é o último que alterou.
    descartadoPor: situacao === 'descartado' ? texto(x['alterado_login']) : null,
    motivoDescarte: texto(x['motivo_descarte']),
  };
}

function linhaDaLinha(x: Record<string, unknown>): LinhaOrcamento {
  const meses = MESES.map((m) => centavosDe(x[m]));
  return {
    centro: x['centro_custo_id'] == null ? 0 : inteiro(x['centro_custo_id']),
    natureza: String(x['natureza']) as NaturezaOrcamento,
    grupo: inteiro(x['grupo_natureza_financeira_id']),
    subgrupo: inteiro(x['subgrupo_natureza_financeira_id']),
    item: inteiro(x['natureza_financeira_id']),
    meses,
    totalCentavos: meses.reduce((s, v) => s + v, 0),
    observacao: texto(x['observacao']),
  };
}

// ── Entradas das operações (Zod) ──────────────────────────────────────────────────────────────────────────────────

const chaveZ = z.object({
  centro: z.number().int().min(0),
  natureza: z.enum(['despesa', 'receita', 'consumo']),
  grupo: z.number().int().min(0),
  subgrupo: z.number().int().min(0),
  item: z.number().int().min(0),
});
const linhaZ = chaveZ.extend({
  meses: z.array(z.number().int().min(0).max(9_999_999_999_999)).length(MESES_ORCAMENTO),
  observacao: z.string().max(200).nullable(),
});
const criarZ = z.object({
  estabelecimento: z.number().int().positive(),
  ano: z.number().int().min(2000).max(2099),
  descricao: z.string().trim().min(3).max(150),
  base: z.discriminatedUnion('tipo', [
    z.object({ tipo: z.literal('vazio') }),
    z.object({ tipo: z.literal('versao'), id: z.number().int().positive() }),
    z.object({ tipo: z.literal('realizado'), ajusteCentesimos: z.number().int().min(-10_000).max(99_999) }),
  ]),
  linhas: z.array(linhaZ).max(TETO_LINHAS),
  dados: z.unknown(),
});
const linhasZ = z.object({
  id: z.number().int().positive(),
  versao: z.number().int().min(0),
  incluir: z.array(linhaZ).max(TETO_LINHAS),
  alterar: z.array(linhaZ).max(TETO_LINHAS),
  remover: z.array(chaveZ).max(TETO_LINHAS),
  dados: z.unknown(),
});
const aprovarZ = z.object({
  id: z.number().int().positive(),
  versao: z.number().int().min(0),
  observacao: z.string().max(400).nullable(),
  dados: z.unknown(),
});
const descartarZ = z.object({
  id: z.number().int().positive(),
  versao: z.number().int().min(0),
  motivo: z.string().trim().min(5).max(400),
  dados: z.unknown(),
});

/** A versão mudou depois que a tela leu (outra pessoa gravou, aprovou ou descartou). */
const desatualizado = () =>
  recusa(
    'desatualizado',
    'O orçamento mudou depois que você abriu (outra pessoa gravou, aprovou ou descartou). Abra de novo para ver a versão atual.',
  );

/** Os dados da tela para a trilha, como objeto (o que não for objeto vai em `tela`). */
const asObjetoDados = (d: unknown): Record<string, unknown> =>
  d !== null && typeof d === 'object' && !Array.isArray(d)
    ? (d as Record<string, unknown>)
    : { tela: d ?? null };

const ONDE_CHAVE = `versao_orcamento_id = ? AND natureza = ? AND centro_custo_id <=> ? AND grupo_natureza_financeira_id <=> ?
  AND subgrupo_natureza_financeira_id <=> ? AND natureza_financeira_id <=> ? AND excluido_em IS NULL`;
const paramsChave = (id: number, l: z.infer<typeof chaveZ>) => [
  id,
  l.natureza,
  l.centro === 0 ? null : l.centro,
  l.grupo === 0 ? null : l.grupo,
  l.subgrupo === 0 ? null : l.subgrupo,
  l.item === 0 ? null : l.item,
];

/** Inclui as linhas (INSERT de várias linhas, em lotes), a partir da sequência dada. */
async function incluirLinhas(
  tx: TxOperacao,
  versaoId: number,
  linhas: readonly z.infer<typeof linhaZ>[],
  desde: number,
): Promise<void> {
  const colunas = [
    'versao_orcamento_id',
    'sequencia',
    'centro_custo_id',
    'natureza',
    'grupo_natureza_financeira_id',
    'subgrupo_natureza_financeira_id',
    'natureza_financeira_id',
    ...MESES,
    'observacao',
    'criado_em',
    'criado_por',
  ];
  const agora = new Date();
  for (let i = 0; i < linhas.length; i += LOTE_INSERCAO) {
    const lote = linhas.slice(i, i + LOTE_INSERCAO);
    const params: unknown[] = [];
    lote.forEach((l, k) => {
      params.push(
        versaoId,
        desde + i + k,
        l.centro === 0 ? null : l.centro,
        l.natureza,
        l.grupo === 0 ? null : l.grupo,
        l.subgrupo === 0 ? null : l.subgrupo,
        l.item === 0 ? null : l.item,
        ...l.meses.map(decimalDe),
        l.observacao ? l.observacao.slice(0, 200) : null,
        agora,
        tx.contexto.usuario,
      );
    });
    const marcas = `(${colunas.map(() => '?').join(', ')})`;
    try {
      await tx.executar(
        `INSERT INTO linha_orcamento (${colunas.join(', ')}) VALUES ${lote.map(() => marcas).join(', ')}`,
        params,
      );
    } catch (e) {
      if (restricaoUnicaViolada(e)) throw desatualizado();
      throw e;
    }
  }
}

/** Trava a versão do estabelecimento e confere a versão lida e o rascunho. */
async function travarRascunho(tx: TxOperacao, id: number, versao: number): Promise<Record<string, unknown>> {
  const relido = await travarEConferir(tx, {
    tabela: 'versao_orcamento',
    id,
    versaoEsperada: versao,
    colunas: ['estabelecimento_id', 'situacao', 'ano', 'excluido_em'],
  });
  if (Number(relido['estabelecimento_id']) !== tx.contexto.estabelecimento || relido['excluido_em'] != null)
    throw new ErroOperacao(
      404,
      'nao-encontrado',
      'Orçamento não encontrado',
      'A versão não existe neste estabelecimento.',
    );
  if (relido['situacao'] !== 'rascunho') throw desatualizado();
  return relido;
}

const opCriar = definirOperacao({
  nome: 'orcamento.versao.criar',
  tabelas: ['versao_orcamento', 'linha_orcamento'],
  entrada: criarZ,
  async gravar(tx, x) {
    const est = x.estabelecimento;
    // A numeração do ano: trava as versões do ano do estabelecimento (a UNIQUE barra a corrida que sobrar).
    const atuais = await tx.consultarParaAtualizar<{ numero_versao: unknown }>(
      'SELECT numero_versao FROM versao_orcamento WHERE estabelecimento_id = ? AND ano = ?',
      [est, x.ano],
      { teto: 40_000 },
    );
    const numero = atuais.reduce((m, r) => Math.max(m, inteiro(r.numero_versao)), 0) + 1;
    if (numero > 32_767) throw recusa('limite', 'O ano já tem o número máximo de versões.');
    if (x.base.tipo === 'versao') {
      const b = await tx.uma(
        'SELECT id FROM versao_orcamento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [x.base.id, est],
      );
      if (!b) throw recusa('base-inexistente', 'A versão copiada não existe neste estabelecimento.');
    }
    let id: number;
    try {
      id = await tx.incluir('versao_orcamento', {
        estabelecimento_id: est,
        ano: x.ano,
        numero_versao: numero,
        descricao: x.descricao,
        tipo_versao: numero === 1 ? 'original' : 'revisao',
        tipo_base: x.base.tipo === 'versao' ? 'copia_versao' : x.base.tipo,
        base_versao_orcamento_id: x.base.tipo === 'versao' ? x.base.id : null,
        percentual_ajuste_base:
          x.base.tipo === 'realizado' ? (x.base.ajusteCentesimos / 100).toFixed(4) : null,
        vigencia_inicio: `${x.ano}-01-01`,
        vigencia_fim: `${x.ano}-12-31`,
        situacao: 'rascunho',
        aberto_em: new Date(),
      });
    } catch (e) {
      if (restricaoUnicaViolada(e)) throw desatualizado();
      throw e;
    }
    await incluirLinhas(tx, id, x.linhas, 1);
    return { id, numero, linhas: x.linhas.length };
  },
  alvo: (_x, r) => ({ tabela: 'versao_orcamento', id: r.id }),
  trilha: (x) => ({
    acao: 'inclusao',
    dados: { ...asObjetoDados(x.dados), linhasIncluidas: x.linhas.length },
  }),
});

const opLinhas = definirOperacao({
  nome: 'orcamento.linhas.gravar',
  tabelas: ['versao_orcamento', 'linha_orcamento'],
  entrada: linhasZ,
  async gravar(tx, x) {
    const relido = await travarRascunho(tx, x.id, x.versao);
    const agora = new Date();
    /** A linha viva da chave, travada (a chave some ou repete: a tela leu uma versão velha). */
    const linhaDaChave = async (l: z.infer<typeof chaveZ>): Promise<{ id: number; versao: number }> => {
      const rs = await tx.consultarParaAtualizar<{ id: unknown; versao: unknown }>(
        `SELECT id, versao FROM linha_orcamento WHERE ${ONDE_CHAVE}`,
        paramsChave(x.id, l),
      );
      const [r] = rs;
      if (rs.length !== 1 || !r) throw desatualizado();
      return { id: inteiro(r.id), versao: inteiro(r.versao) };
    };
    for (const l of x.remover) {
      const r = await linhaDaChave(l);
      await tx.alterar('linha_orcamento', r.id, r.versao, {
        excluido_em: agora,
        excluido_por: tx.contexto.usuario,
      });
    }
    for (const l of x.alterar) {
      const r = await linhaDaChave(l);
      await tx.alterar('linha_orcamento', r.id, r.versao, {
        ...Object.fromEntries(MESES.map((m, i) => [m, decimalDe(l.meses[i] ?? 0)])),
        observacao: l.observacao ? l.observacao.slice(0, 200) : null,
      });
    }
    if (x.incluir.length) {
      const m = await tx.uma<{ m: unknown }>(
        'SELECT COALESCE(MAX(sequencia), 0) AS m FROM linha_orcamento WHERE versao_orcamento_id = ?',
        [x.id],
      );
      for (const l of x.incluir) {
        const ja = await tx.uma(`SELECT id FROM linha_orcamento WHERE ${ONDE_CHAVE}`, paramsChave(x.id, l));
        if (ja) throw desatualizado();
      }
      await incluirLinhas(tx, x.id, x.incluir, inteiro(m?.m) + 1);
    }
    // O cabeçalho registra a alteração (versão nova, quem e quando), sem mudar o conteúdo.
    const versao = await tx.alterar('versao_orcamento', x.id, x.versao, { situacao: relido['situacao'] });
    return { versao };
  },
  alvo: (x) => ({ tabela: 'versao_orcamento', id: x.id }),
  trilha: (x) => ({
    acao: 'alteracao',
    dados: {
      ...asObjetoDados(x.dados),
      linhasIncluidas: x.incluir.length,
      linhasAlteradas: x.alterar.length,
      linhasRemovidas: x.remover.length,
    },
  }),
});

const opAprovar = definirOperacao({
  nome: 'orcamento.versao.aprovar',
  tabelas: ['versao_orcamento'],
  entrada: aprovarZ,
  async gravar(tx, x) {
    const relido = await travarRascunho(tx, x.id, x.versao);
    const anteriores = await tx.consultarParaAtualizar<{ id: unknown; versao: unknown }>(
      `SELECT id, versao FROM versao_orcamento
        WHERE estabelecimento_id = ? AND ano = ? AND situacao = 'aprovado' AND id <> ? AND excluido_em IS NULL`,
      [tx.contexto.estabelecimento, relido['ano'], x.id],
      { teto: 10 },
    );
    for (const a of anteriores)
      await tx.alterar('versao_orcamento', inteiro(a.id), inteiro(a.versao), {
        situacao: 'substituido',
        oficial: false,
      });
    const versao = await tx.alterar('versao_orcamento', x.id, x.versao, {
      situacao: 'aprovado',
      oficial: true,
      aprovado_em: new Date(),
      aprovador_usuario_id: tx.contexto.usuario,
      observacao: x.observacao ? x.observacao.slice(0, 400) : null,
    });
    return { substituida: anteriores.length ? inteiro(anteriores[0]!.id) : null, versao };
  },
  alvo: (x) => ({ tabela: 'versao_orcamento', id: x.id }),
  trilha: (x) => ({ acao: 'alteracao', dados: x.dados }),
});

const opDescartar = definirOperacao({
  nome: 'orcamento.versao.descartar',
  tabelas: ['versao_orcamento'],
  entrada: descartarZ,
  async gravar(tx, x) {
    await travarRascunho(tx, x.id, x.versao);
    const versao = await tx.alterar('versao_orcamento', x.id, x.versao, {
      situacao: 'descartado',
      descartado_em: new Date(),
      motivo_descarte: x.motivo.slice(0, 400),
    });
    return { versao };
  },
  alvo: (x) => ({ tabela: 'versao_orcamento', id: x.id }),
  trilha: (x) => ({ acao: 'alteracao', motivo: x.motivo, dados: x.dados }),
});

export class PortaOrcamentoPropria implements PortaOrcamento {
  readonly destino = 'banco' as const;
  /** O consumo por centro grava sem o insumo (a restrição saiu na migração 14_FIN/11). */
  readonly gravaConsumoPorCentro = true;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoOrcamento,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoOrcamento, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'orcamento' }, fn);
  }

  /** O estabelecimento da sessão (pelo id, ou pelo código quando o mapa ainda não o tinha); sem ele, recusa. */
  private async estabelecimento(c: ContextoOrcamento, l: Leitor): Promise<number> {
    if (c.estabelecimento !== null) return c.estabelecimento;
    const x = await l.uma<{ id: unknown }>(
      'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
      [c.hospital],
    );
    if (!x)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Estabelecimento desconhecido',
        'O estabelecimento da sessão não existe.',
      );
    return Number(x.id);
  }

  private async gravar<E, S extends Record<string, unknown>>(
    c: ContextoOrcamento,
    op: Parameters<Executor['executar']>[0] & { nome: string },
    entrada: (est: number) => E,
    g: GravacaoOrcamento,
  ): Promise<S> {
    const est = await this.ler(c, (l) => this.estabelecimento(c, l));
    const contexto: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: c.usuario,
      correlacao: g.trilha.correlacao ?? c.correlacao,
      chaveIdempotencia: g.chaveIdempotencia,
    };
    const r = await this.executor.executar(op, this.cliente, entrada(est), contexto);
    return r.resultado as S;
  }

  apoio(c: ContextoOrcamento): Promise<ApoioOrcamentoDados> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const centros = await l.consultar(
        `SELECT id, codigo, nome, ativo FROM centro_custo
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND analitico = TRUE ORDER BY codigo`,
        [est],
        { teto: TETO_CENTROS },
      );
      // O plano gerencial é do cliente (rede inteira): sem estabelecimento.
      const itens = await l.consultar(
        `SELECT n.id, n.subgrupo_natureza_financeira_id AS sub, s.grupo_natureza_financeira_id AS grp, n.descricao,
                g.nome AS gnome, n.tipo, (n.ativo AND s.ativo AND g.ativo) AS ativo
           FROM natureza_financeira n
           JOIN subgrupo_natureza_financeira s ON s.id = n.subgrupo_natureza_financeira_id
           JOIN grupo_natureza_financeira g ON g.id = s.grupo_natureza_financeira_id
          WHERE n.excluido_em IS NULL AND s.excluido_em IS NULL AND g.excluido_em IS NULL
            AND n.tipo IN ('receita', 'despesa')
          ORDER BY g.codigo, s.codigo, n.codigo`,
        [],
        { teto: TETO_ITENS },
      );
      return {
        centros: centros.map((x): CentroOrcamento => ({
          id: inteiro(x['id']),
          codigo: /^\d{1,15}$/.test(String(x['codigo'] ?? '')) ? Number(x['codigo']) : inteiro(x['id']),
          nome: texto(x['nome']) ?? '',
          ativo: Boolean(Number(x['ativo'])),
        })),
        itens: itens.map((x): ItemGerencialOrcamento => ({
          grupo: inteiro(x['grp']),
          subgrupo: inteiro(x['sub']),
          item: inteiro(x['id']),
          nome: texto(x['descricao']) ?? '',
          grupoNome: texto(x['gnome']) ?? '',
          natureza: x['tipo'] === 'receita' ? 'receita' : 'despesa',
          ativo: Boolean(Number(x['ativo'])),
        })),
        empresas: [EMPRESA_UNICA],
        // Os parâmetros do orçamento ainda não têm lugar no modelo (pedido ao orquestrador): nada a mostrar.
        parametros: { anoInicial: null, mesInicial: null, digitaCentro: null, regime: null },
      };
    });
  }

  versoes(c: ContextoOrcamento, ano: number | null): Promise<OrcamentoVersao[]> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const ls = await l.consultar(
        `SELECT ${COLUNAS_VERSAO} FROM ${DE_VERSAO}
          WHERE v.estabelecimento_id = ? AND v.excluido_em IS NULL AND (? IS NULL OR v.ano = ?)
          ORDER BY v.ano DESC, v.numero_versao DESC LIMIT ${TETO_VERSOES}`,
        [est, ano, ano],
        { teto: TETO_VERSOES },
      );
      return ls.map(versaoDaLinha);
    });
  }

  versao(c: ContextoOrcamento, id: number): Promise<OrcamentoVersao | null> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const x = await l.uma(
        `SELECT ${COLUNAS_VERSAO} FROM ${DE_VERSAO} WHERE v.id = ? AND v.estabelecimento_id = ? AND v.excluido_em IS NULL`,
        [id, est],
      );
      return x ? versaoDaLinha(x) : null;
    });
  }

  linhas(c: ContextoOrcamento, id: number): Promise<LinhaOrcamento[]> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const ls = await l.consultar(
        `SELECT l.centro_custo_id, l.natureza, l.grupo_natureza_financeira_id, l.subgrupo_natureza_financeira_id,
                l.natureza_financeira_id, ${MESES.map((m) => `l.${m}`).join(', ')}, l.observacao
           FROM linha_orcamento l JOIN versao_orcamento v ON v.id = l.versao_orcamento_id
          WHERE l.versao_orcamento_id = ? AND v.estabelecimento_id = ? AND v.excluido_em IS NULL
            AND l.excluido_em IS NULL
          ORDER BY l.sequencia`,
        [id, est],
        { teto: TETO_LINHAS },
      );
      return ls.map(linhaDaLinha);
    });
  }

  realizado(c: ContextoOrcamento, _empresa: number, ano: number): Promise<RealizadoAno> {
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const inicio = `${ano}-01-01`;
      const fim = `${ano}-12-31`;
      // O título com rateio entra pelo rateio (natureza, centro e valor de cada parcela); sem rateio, pelo próprio
      // título (centro do documento; sem centro, NULL). Previsão e cancelado não são realizado; o renegociado também não
      // (o valor segue no título novo da renegociação: contá-lo seria contar duas vezes).
      const pagar = await l.consultar(
        `SELECT COALESCE(r.centro_custo_id, t.centro_custo_id) AS centro, n.id AS item,
                n.subgrupo_natureza_financeira_id AS sub, s.grupo_natureza_financeira_id AS grp,
                MONTH(t.data_lancamento) AS mes,
                SUM(COALESCE(r.valor, t.valor_bruto - t.valor_desconto + t.valor_acrescimo)) AS valor,
                MAX(t.data_lancamento) AS ultimo
           FROM titulo_pagar t
           LEFT JOIN rateio_lancamento r ON r.titulo_pagar_id = t.id AND r.excluido_em IS NULL
           JOIN natureza_financeira n ON n.id = COALESCE(r.natureza_financeira_id, t.natureza_financeira_id)
           JOIN subgrupo_natureza_financeira s ON s.id = n.subgrupo_natureza_financeira_id
          WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND t.situacao NOT IN ('cancelado', 'renegociado')
            AND t.tipo_titulo <> 'previsao' AND t.data_lancamento BETWEEN ? AND ?
          GROUP BY centro, item, sub, grp, mes`,
        [est, inicio, fim],
        { teto: TETO_REALIZADO },
      );
      const receber = await l.consultar(
        `SELECT COALESCE(r.centro_custo_id, t.centro_custo_id) AS centro, n.id AS item,
                n.subgrupo_natureza_financeira_id AS sub, s.grupo_natureza_financeira_id AS grp,
                MONTH(COALESCE(t.competencia, t.data_lancamento)) AS mes,
                SUM(COALESCE(r.valor, t.valor_bruto - t.valor_desconto + t.valor_acrescimo)) AS valor,
                MAX(COALESCE(t.competencia, t.data_lancamento)) AS ultimo
           FROM titulo_receber t
           LEFT JOIN rateio_lancamento r ON r.titulo_receber_id = t.id AND r.excluido_em IS NULL
           JOIN natureza_financeira n ON n.id = COALESCE(r.natureza_financeira_id, t.natureza_financeira_id)
           JOIN subgrupo_natureza_financeira s ON s.id = n.subgrupo_natureza_financeira_id
          WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND t.situacao NOT IN ('cancelado', 'renegociado')
            AND COALESCE(t.competencia, t.data_lancamento) BETWEEN ? AND ?
          GROUP BY centro, item, sub, grp, mes`,
        [est, inicio, fim],
        { teto: TETO_REALIZADO },
      );
      const consumo = await l.consultar(
        `SELECT centro_custo_id AS centro, mes, SUM(valor_liquido) AS valor FROM consumo_centro_custo
          WHERE estabelecimento_id = ? AND ano = ? AND operacao <> 'exclusao'
          GROUP BY centro_custo_id, mes`,
        [est, ano],
        { teto: TETO_REALIZADO },
      );
      const agregado: RealizadoBruto[] = [];
      const ultimos: string[] = [];
      for (const [natureza, ls] of [
        ['despesa', pagar],
        ['receita', receber],
      ] as const)
        for (const x of ls) {
          agregado.push({
            natureza,
            codigoCentro: x['centro'] == null ? null : inteiro(x['centro']),
            grupo: inteiro(x['grp']),
            subgrupo: inteiro(x['sub']),
            item: inteiro(x['item']),
            mes: inteiro(x['mes']),
            centavos: centavosDe(x['valor']),
          });
          const u = dataIso(x['ultimo']);
          if (u) ultimos.push(u);
        }
      for (const x of consumo)
        agregado.push({
          natureza: 'consumo',
          codigoCentro: inteiro(x['centro']),
          grupo: 0,
          subgrupo: 0,
          item: 0,
          mes: inteiro(x['mes']),
          centavos: centavosDe(x['valor']),
        });
      const meses = consumo.map((x) => inteiro(x['mes']));
      return {
        agregado,
        rateados: [],
        ultimoMovimento: ultimos.length ? ultimos.sort().at(-1)! : null,
        ultimoMesConsumo: meses.length ? Math.max(...meses) : null,
      };
    });
  }

  criar(
    c: ContextoOrcamento,
    x: VersaoOrcamentoNova,
    g: GravacaoOrcamento,
  ): Promise<{ id: number; numero: number; linhas: number }> {
    return this.gravar(
      c,
      opCriar,
      (est) => ({
        estabelecimento: est,
        ano: x.ano,
        descricao: x.descricao,
        base: x.base,
        linhas: x.linhas.map(paraEntrada),
        dados: g.trilha.dadosDepois,
      }),
      g,
    );
  }

  async gravarLinhas(
    c: ContextoOrcamento,
    id: number,
    versao: number,
    plano: PlanoLinhasOrcamento,
    g: GravacaoOrcamento,
  ): Promise<{ versao: number }> {
    const r = await this.gravar<unknown, { versao: number }>(
      c,
      opLinhas,
      () => ({
        id,
        versao,
        incluir: plano.incluir.map(paraEntrada),
        alterar: plano.alterar.map(paraEntrada),
        remover: plano.remover.map((k) => ({
          centro: k.centro,
          natureza: k.natureza,
          grupo: k.grupo,
          subgrupo: k.subgrupo,
          item: k.item,
        })),
        dados: g.trilha.dadosDepois,
      }),
      g,
    );
    return { versao: r.versao };
  }

  async aprovar(
    c: ContextoOrcamento,
    x: { readonly id: number; readonly versao: number; readonly empresa: number; readonly ano: number },
    observacao: string | null,
    g: GravacaoOrcamento,
  ): Promise<{ substituida: number | null }> {
    const r = await this.gravar<unknown, { substituida: number | null }>(
      c,
      opAprovar,
      () => ({ id: x.id, versao: x.versao, observacao, dados: g.trilha.dadosDepois }),
      g,
    );
    return { substituida: r.substituida };
  }

  async descartar(
    c: ContextoOrcamento,
    id: number,
    versao: number,
    motivo: string,
    g: GravacaoOrcamento,
  ): Promise<void> {
    await this.gravar(c, opDescartar, () => ({ id, versao, motivo, dados: g.trilha.dadosDepois }), g);
  }
}

const paraEntrada = (l: LinhaOrcamentoParaGravar): z.infer<typeof linhaZ> => ({
  centro: l.centro,
  natureza: l.natureza,
  grupo: l.grupo,
  subgrupo: l.subgrupo,
  item: l.item,
  meses: [...l.meses],
  observacao: l.observacao ?? null,
});

/** Contagens das tabelas do orçamento no estabelecimento (prova da integração; só números). */
export async function contagensOrcamento(
  e: Escritor | Leitor,
  estabelecimento: number,
): Promise<Record<string, number>> {
  const v = await e.uma<{ n: unknown }>(
    'SELECT COUNT(*) AS n FROM versao_orcamento WHERE estabelecimento_id = ?',
    [estabelecimento],
  );
  const l = await e.uma<{ n: unknown }>(
    `SELECT COUNT(*) AS n FROM linha_orcamento l JOIN versao_orcamento v ON v.id = l.versao_orcamento_id
      WHERE v.estabelecimento_id = ?`,
    [estabelecimento],
  );
  return { versao_orcamento: inteiro(v?.n), linha_orcamento: inteiro(l?.n) };
}
