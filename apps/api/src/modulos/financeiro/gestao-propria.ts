// F3.8, 07-FIN linhas 98 e 99: reclassificação gerencial de lançamento já gravado e manutenção das permissões do
// financeiro (escopo de contas por usuário e tipos de lançamento por perfil), no banco próprio, pelo executor do
// @sgh/nucleo (trilha, outbox e idempotência na mesma transação). As regras são as do @sgh/dominio-financeiro
// (reclassificacao.ts, permissao-financeiro.ts); aqui ficam a leitura sob a trava e a gravação.
// Reclassificar: a natureza e o centro principal do cabeçalho mudam; as linhas de rateio anteriores ficam no banco,
// marcadas como substituídas (quem e quando), e as novas entram com sequência seguinte; o antes, o depois e o motivo
// vão à trilha. Escopo de contas: a linha por usuário e conta é mantida (nunca apagada: retirar é desligar as marcas).
// Tipos de lançamento: a lista branca por perfil e estabelecimento (operação "banco"), com a marca de restrito em linha
// própria (retirar o último tipo deixa o perfil restrito sem nada), conferida perfil a perfil no lançamento do movimento.
import {
  conferirEscopoConta,
  conferirTipoLancamento,
  type PerfilNoTipoLancamento,
  planejarReclassificacao,
  type RateioGravado,
  type RecusaFinanceiro,
} from '@sgh/dominio-financeiro';
import {
  type ContextoOperacao,
  definirOperacao,
  type Leitor,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { situacaoDaCompetencia } from './periodo-propria.js';
import { dataIso, numero } from './vocabulario.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const id = z.number().int().positive();
const hojeIso = () => new Date().toISOString().slice(0, 10);

/** Recusa de negócio do domínio → erro da operação (409, com os campos). Local: sem ciclo com operacoes.ts. */
function recusar(r: RecusaFinanceiro | null): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
}
function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}
function usuarioDe(ctx: ContextoOperacao): number {
  if (ctx.usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  return ctx.usuario;
}

// ── Reclassificação ────────────────────────────────────────────────────────────────────────────────────────────

export const ALVOS_RECLASSIFICACAO = ['titulo_pagar', 'titulo_receber', 'movimento_bancario'] as const;
export type AlvoReclassificacao = (typeof ALVOS_RECLASSIFICACAO)[number];

/** Lista branca: a tabela e as colunas vêm do alvo, nunca da entrada. */
const ALVO: Record<
  AlvoReclassificacao,
  { readonly coluna: string; readonly valor: string; readonly data: string; readonly cancelado: string }
> = {
  titulo_pagar: {
    coluna: 'titulo_pagar_id',
    valor: 'valor_bruto',
    data: 'data_emissao',
    cancelado: "(excluido_em IS NOT NULL OR situacao = 'cancelado')",
  },
  titulo_receber: {
    coluna: 'titulo_receber_id',
    valor: 'valor_bruto',
    data: 'data_emissao',
    cancelado: "(excluido_em IS NOT NULL OR situacao IN ('cancelado','renegociado'))",
  },
  movimento_bancario: {
    coluna: 'movimento_bancario_id',
    valor: 'valor',
    data: 'data_movimento',
    cancelado: "(excluido_em IS NOT NULL OR situacao <> 'ativo')",
  },
};

export const esquemaReclassificar = z
  .object({
    alvo: z.enum(ALVOS_RECLASSIFICACAO),
    id,
    classificacao: z
      .object({
        grupo: z.number().int().positive().max(32_767),
        subgrupo: z.number().int().min(0).max(32_767),
        item: z.number().int().min(0).max(32_767),
      })
      .strict(),
    rateio: z
      .array(z.object({ centroCusto: id, percentual: z.number().positive().max(100) }).strict())
      .min(1)
      .max(30),
    motivo: z.string().max(500),
  })
  .strict();
export type ReclassificarEntrada = z.infer<typeof esquemaReclassificar>;

async function naturezaPorCodigo(l: Leitor, c: ReclassificarEntrada['classificacao']) {
  const r = await l.uma(
    'SELECT id, tipo FROM natureza_financeira WHERE codigo = ? AND ativo = TRUE AND excluido_em IS NULL',
    [`${c.grupo}.${c.subgrupo}.${c.item}`],
  );
  if (!r)
    throw recusa('classificacao-inexistente', 'A classificação gerencial não existe no cadastro.', {
      campos: ['classificacao'],
    });
  return { id: numero(r['id']), tipo: String(r['tipo']) };
}

/** O rateio vigente do lançamento (sem linhas: o centro do cabeçalho vale 100%). */
async function rateioVigente(
  l: Leitor,
  alvo: AlvoReclassificacao,
  lancamento: number,
  centroCabecalho: unknown,
  valor: number,
): Promise<RateioGravado[]> {
  const linhas = await l.consultar(
    `SELECT centro_custo_id, percentual, valor FROM rateio_lancamento
      WHERE ${ALVO[alvo].coluna} = ? AND excluido_em IS NULL ORDER BY sequencia`,
    [lancamento],
  );
  if (linhas.length > 0)
    return linhas.map((r) => ({
      centroCusto: numero(r['centro_custo_id']),
      percentual: numero(r['percentual']),
      valor: numero(r['valor']),
    }));
  return centroCabecalho === null || centroCabecalho === undefined
    ? []
    : [{ centroCusto: numero(centroCabecalho), percentual: 100, valor }];
}

const reclassificarLancamento = definirOperacao<ReclassificarEntrada, ResultadoOperacao>({
  nome: 'financeiro.reclassificar_lancamento',
  tabelas: ['rateio_lancamento', 'titulo_pagar', 'titulo_receber', 'movimento_bancario'],
  entrada: esquemaReclassificar as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const a = ALVO[e.alvo];
    const [l] = await tx.consultarParaAtualizar(
      `SELECT id, versao, natureza_financeira_id, centro_custo_id, ${a.valor} AS valor, ${a.data} AS data,
              ${a.cancelado} AS cancelado
         FROM ${e.alvo} WHERE id = ? AND estabelecimento_id = ?`,
      [e.id, est],
      { teto: 1 },
    );
    if (!l) throw recusa('lancamento-inexistente', 'O lançamento não existe neste estabelecimento.');
    const valor = numero(l['valor']);
    const data = dataIso(l['data']) ?? hojeIso();
    const naturezaAntes = l['natureza_financeira_id'] === null ? 0 : numero(l['natureza_financeira_id']);
    const tipoAntes = naturezaAntes
      ? String(
          (await tx.uma('SELECT tipo FROM natureza_financeira WHERE id = ?', [naturezaAntes]))?.['tipo'] ??
            '',
        )
      : null;
    const nova = await naturezaPorCodigo(tx, e.classificacao);
    const centros = [...new Set(e.rateio.map((r) => r.centroCusto))];
    const achados = await tx.consultar(
      `SELECT id FROM centro_custo WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL
          AND id IN (${centros.map(() => '?').join(',')})`,
      [est, ...centros],
    );
    if (achados.length !== centros.length)
      throw recusa('centro-inexistente', 'Um centro de custo do rateio não existe ou está inativo.', {
        campos: ['rateio'],
      });
    const antes = {
      natureza: naturezaAntes,
      rateio: await rateioVigente(tx, e.alvo, e.id, l['centro_custo_id'], valor),
    };
    const plano = planejarReclassificacao({
      cancelado: Number(l['cancelado'] ?? 0) === 1,
      competenciaFechada: (await situacaoDaCompetencia(tx, est, data)) === 'fechado',
      valor,
      antes,
      natureza: nova.id,
      rateio: e.rateio,
      motivo: e.motivo,
      tipoNaturezaAntes: tipoAntes,
      tipoNaturezaNova: nova.tipo,
    });
    if (!plano.ok) {
      recusar(plano.recusa);
      throw new Error('inalcançável');
    }
    const agora = new Date();
    // As linhas que esta reclassificação substitui (os ids vão à trilha: liga cada rateio antigo à sua reclassificação).
    const substituidas = (
      await tx.consultar(
        `SELECT id FROM rateio_lancamento WHERE ${a.coluna} = ? AND excluido_em IS NULL ORDER BY sequencia`,
        [e.id],
      )
    ).map((r) => numero(r['id']));
    await tx.executar(
      `UPDATE rateio_lancamento SET excluido_em = ?, excluido_por = ?, versao = versao + 1
        WHERE ${a.coluna} = ? AND excluido_em IS NULL`,
      [agora, usuario, e.id],
    );
    const max = await tx.uma(
      `SELECT COALESCE(MAX(sequencia), 0) AS n FROM rateio_lancamento WHERE ${a.coluna} = ?`,
      [e.id],
    );
    const ids: number[] = [];
    for (const [i, r] of plano.depois.rateio.entries())
      ids.push(
        await tx.incluir('rateio_lancamento', {
          [a.coluna]: e.id,
          sequencia: numero(max?.['n']) + i + 1,
          natureza_financeira_id: nova.id,
          centro_custo_id: r.centroCusto,
          competencia: `${data.slice(0, 7)}-01`,
          percentual: r.percentual,
          valor: r.valor,
          descricao: 'Reclassificação gerencial',
        }),
      );
    await tx.alterar(e.alvo, e.id, numero(l['versao']), {
      natureza_financeira_id: nova.id,
      centro_custo_id: plano.centroPrincipal,
    });
    return {
      lancamento: e.id,
      alvo: e.alvo,
      natureza: nova.id,
      naturezaAntes,
      centros: plano.depois.rateio.length,
      centrosAntes: antes.rateio.length,
      ids: ids.join(','),
      // O antes e o depois completos (centro, percentual e valor em centavos calculados), com os ids das linhas.
      rateios: JSON.stringify({
        antes: antes.rateio,
        depois: plano.depois.rateio,
        linhasSubstituidas: substituidas,
        linhasNovas: ids,
      }),
    };
  },
  alvo: (e) => ({ tabela: e.alvo, id: e.id }),
  trilha: (e, r) => ({
    acao: 'alteracao',
    motivo: e.motivo.trim(),
    dados: {
      reclassificacao: {
        naturezaAntes: numero(r['naturezaAntes']),
        naturezaDepois: numero(r['natureza']),
        ...(JSON.parse(String(r['rateios'])) as Record<string, unknown>),
      },
    },
  }),
  eventos: (e, r) => [
    {
      tipo: 'financeiro.lancamento.reclassificado',
      carga: { alvo: e.alvo, lancamento: e.id, natureza: numero(r['natureza']) },
    },
  ],
});

/** A classificação atual de um lançamento e o histórico das linhas substituídas (para a tela). */
export interface ClassificacaoAtualResposta {
  readonly alvo: AlvoReclassificacao;
  readonly id: number;
  readonly valor: number;
  readonly data: string;
  readonly natureza: { readonly codigo: string; readonly descricao: string; readonly tipo: string } | null;
  readonly rateio: readonly {
    readonly centroCusto: number;
    readonly centro: string;
    readonly percentual: number;
    readonly valor: number;
  }[];
  readonly substituidas: number;
  readonly reclassificacoes: readonly {
    readonly em: string;
    readonly por: string;
    readonly motivo: string;
  }[];
}

export async function classificacaoAtual(
  l: Leitor,
  est: number,
  alvo: AlvoReclassificacao,
  lancamento: number,
): Promise<ClassificacaoAtualResposta | null> {
  const a = ALVO[alvo];
  const c = await l.uma(
    `SELECT x.id, x.${a.valor} AS valor, x.${a.data} AS data, x.centro_custo_id, n.codigo, n.descricao, n.tipo
       FROM ${alvo} x LEFT JOIN natureza_financeira n ON n.id = x.natureza_financeira_id
      WHERE x.id = ? AND x.estabelecimento_id = ?`,
    [lancamento, est],
  );
  if (!c) return null;
  const valor = numero(c['valor']);
  const vigente = await rateioVigente(l, alvo, lancamento, c['centro_custo_id'], valor);
  const nomes = vigente.length
    ? await l.consultar(
        `SELECT id, codigo, nome FROM centro_custo WHERE id IN (${vigente.map(() => '?').join(',')})`,
        vigente.map((r) => r.centroCusto),
      )
    : [];
  const nome = (idc: number) => {
    const n = nomes.find((x) => numero(x['id']) === idc);
    return n ? `${String(n['codigo'])} ${String(n['nome'])}` : String(idc);
  };
  const sub = await l.uma(
    `SELECT COUNT(*) AS n FROM rateio_lancamento WHERE ${a.coluna} = ? AND excluido_em IS NOT NULL`,
    [lancamento],
  );
  const hist = await l.consultar(
    `SELECT t.ocorrido_em, t.motivo, u.nome FROM trilha_auditoria t LEFT JOIN usuario u ON u.id = t.usuario_id
      WHERE t.entidade = ? AND t.entidade_id = ? AND t.estabelecimento_id = ?
        AND JSON_EXTRACT(t.dados_depois, '$.operacao') = 'financeiro.reclassificar_lancamento'
      ORDER BY t.id DESC LIMIT 20`,
    [alvo, lancamento, est],
  );
  return {
    alvo,
    id: lancamento,
    valor,
    data: dataIso(c['data']) ?? '',
    natureza: c['codigo']
      ? { codigo: String(c['codigo']), descricao: String(c['descricao']), tipo: String(c['tipo']) }
      : null,
    rateio: vigente.map((r) => ({ ...r, centro: nome(r.centroCusto) })),
    substituidas: numero(sub?.['n']),
    reclassificacoes: hist.map((h) => ({
      em: h['ocorrido_em'] instanceof Date ? h['ocorrido_em'].toISOString() : String(h['ocorrido_em']),
      por: String(h['nome'] ?? ''),
      motivo: String(h['motivo'] ?? ''),
    })),
  };
}

// ── Escopo de contas por usuário ─────────────────────────────────────────────────────────────────────────────

const dataOuNulo = z.string().regex(DATA).nullable();

export const esquemaEscopoConta = z
  .object({
    usuario: id,
    conta: id,
    consultar: z.boolean(),
    movimentar: z.boolean(),
    vigenciaInicio: dataOuNulo,
    vigenciaFim: dataOuNulo,
  })
  .strict();
export type EscopoContaEntrada = z.infer<typeof esquemaEscopoConta>;

const manterEscopoConta = definirOperacao<EscopoContaEntrada, ResultadoOperacao>({
  nome: 'financeiro.manter_escopo_conta',
  tabelas: ['permissao_conta_bancaria'],
  entrada: esquemaEscopoConta as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const quem = usuarioDe(ctx);
    recusar(conferirEscopoConta({ ...e, quemMantem: quem }));
    const conta = await tx.uma(
      'SELECT id FROM conta_bancaria WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.conta, est],
    );
    if (!conta) throw recusa('conta-inexistente', 'A conta bancária não existe neste estabelecimento.');
    const usuario = await tx.uma('SELECT id FROM usuario WHERE id = ? AND excluido_em IS NULL', [e.usuario]);
    if (!usuario) throw recusa('usuario-inexistente', 'O usuário não existe.', { campos: ['usuario'] });
    const [atual] = await tx.consultarParaAtualizar(
      `SELECT id, versao, pode_consultar, pode_movimentar, vigencia_inicio, vigencia_fim, excluido_em
         FROM permissao_conta_bancaria WHERE usuario_id = ? AND conta_bancaria_id = ?`,
      [e.usuario, e.conta],
      { teto: 1 },
    );
    const valores = {
      estabelecimento_id: est,
      pode_consultar: e.consultar,
      pode_movimentar: e.movimentar,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
    };
    const antes = atual
      ? {
          consultar: Number(atual['pode_consultar']) === 1 && atual['excluido_em'] === null,
          movimentar: Number(atual['pode_movimentar']) === 1 && atual['excluido_em'] === null,
          vigenciaInicio: dataIso(atual['vigencia_inicio']),
          vigenciaFim: dataIso(atual['vigencia_fim']),
        }
      : null;
    const linha = atual
      ? (await tx.alterar('permissao_conta_bancaria', numero(atual['id']), numero(atual['versao']), {
          ...valores,
          excluido_em: null,
          excluido_por: null,
        }),
        numero(atual['id']))
      : await tx.incluir('permissao_conta_bancaria', {
          usuario_id: e.usuario,
          conta_bancaria_id: e.conta,
          ...valores,
        });
    return {
      permissao: linha,
      usuario: e.usuario,
      conta: e.conta,
      antes: antes ? JSON.stringify(antes) : '',
    };
  },
  alvo: (_e, r) => ({ tabela: 'permissao_conta_bancaria', id: numero(r['permissao']) || null }),
  trilha: (e, r) => ({
    dados: {
      antes: r['antes'] ? JSON.parse(String(r['antes'])) : null,
      depois: {
        consultar: e.consultar,
        movimentar: e.movimentar,
        vigenciaInicio: e.vigenciaInicio,
        vigenciaFim: e.vigenciaFim,
      },
    },
  }),
});

export interface EscopoContaResposta {
  readonly conta: number;
  readonly nome: string;
  readonly consultar: boolean;
  readonly movimentar: boolean;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
  readonly temLinha: boolean;
}

/** As contas do estabelecimento com o escopo do usuário (sem nenhuma linha: o usuário vê todas). */
export async function escopoDoUsuario(
  l: Leitor,
  est: number,
  usuario: number,
): Promise<{ restrito: boolean; contas: EscopoContaResposta[] }> {
  const linhas = await l.consultar(
    `SELECT c.id, c.descricao, p.id AS pid, p.pode_consultar, p.pode_movimentar, p.vigencia_inicio, p.vigencia_fim
       FROM conta_bancaria c
       LEFT JOIN permissao_conta_bancaria p
         ON p.conta_bancaria_id = c.id AND p.usuario_id = ? AND p.excluido_em IS NULL
      WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL AND c.situacao = 'ativa'
      ORDER BY c.descricao, c.id LIMIT 500`,
    [usuario, est],
  );
  const restrito = linhas.some((r) => r['pid'] !== null);
  return {
    restrito,
    contas: linhas.map((r) => ({
      conta: numero(r['id']),
      nome: String(r['descricao'] ?? r['id']),
      consultar: restrito ? Number(r['pode_consultar'] ?? 0) === 1 : true,
      movimentar: restrito ? Number(r['pode_movimentar'] ?? 0) === 1 : true,
      vigenciaInicio: dataIso(r['vigencia_inicio']),
      vigenciaFim: dataIso(r['vigencia_fim']),
      temLinha: r['pid'] !== null,
    })),
  };
}

/** Os usuários com perfil no estabelecimento (para escolher na tela). */
export async function usuariosDoEstabelecimento(l: Leitor, est: number) {
  const linhas = await l.consultar(
    `SELECT DISTINCT u.id, u.nome, u.login FROM usuario u JOIN usuario_perfil up ON up.usuario_id = u.id
      WHERE up.estabelecimento_id = ? AND up.excluido_em IS NULL AND u.excluido_em IS NULL AND u.situacao = 'ativo'
      ORDER BY u.nome LIMIT 1000`,
    [est],
  );
  return linhas.map((r) => ({ id: numero(r['id']), nome: String(r['nome']), login: String(r['login']) }));
}

// ── Tipos de lançamento por perfil ────────────────────────────────────────────────────────────────────────────

export const esquemaTipoLancamentoPerfil = z.object({ perfil: id, tipo: id, liberado: z.boolean() }).strict();
export type TipoLancamentoPerfilEntrada = z.infer<typeof esquemaTipoLancamentoPerfil>;

/** O perfil tem de valer no estabelecimento da sessão (dele ou global): a lista é gravada por estabelecimento. */
async function perfilDoEstabelecimento(tx: Leitor, perfil: number, est: number): Promise<void> {
  const r = await tx.uma(
    `SELECT id FROM perfil_acesso WHERE id = ? AND excluido_em IS NULL
        AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`,
    [perfil, est],
  );
  if (!r)
    throw recusa('perfil-inexistente', 'O perfil de acesso não existe neste estabelecimento.', {
      campos: ['perfil'],
    });
}

/** Liga ou desliga a marca de restrito do perfil na operação "banco" no estabelecimento (a linha nunca é apagada). */
async function marcarRestrito(
  tx: TxOperacao,
  perfil: number,
  est: number,
  restrito: boolean,
  usuario: number,
): Promise<{ id: number; mudou: boolean }> {
  const [atual] = await tx.consultarParaAtualizar(
    `SELECT id, versao, excluido_em FROM restricao_tipo_lancamento_perfil
      WHERE perfil_acesso_id = ? AND estabelecimento_id = ? AND operacao = 'banco'`,
    [perfil, est],
    { teto: 1 },
  );
  const vale = atual ? atual['excluido_em'] === null : false;
  if (vale === restrito) return { id: atual ? numero(atual['id']) : 0, mudou: false };
  if (!atual)
    return {
      id: await tx.incluir('restricao_tipo_lancamento_perfil', {
        perfil_acesso_id: perfil,
        estabelecimento_id: est,
        operacao: 'banco',
      }),
      mudou: true,
    };
  await tx.alterar(
    'restricao_tipo_lancamento_perfil',
    numero(atual['id']),
    numero(atual['versao']),
    restrito ? { excluido_em: null, excluido_por: null } : { excluido_em: new Date(), excluido_por: usuario },
  );
  return { id: numero(atual['id']), mudou: true };
}

const manterTipoLancamento = definirOperacao<TipoLancamentoPerfilEntrada, ResultadoOperacao>({
  nome: 'financeiro.manter_tipo_lancamento',
  tabelas: ['permissao_tipo_lancamento', 'restricao_tipo_lancamento_perfil'],
  entrada: esquemaTipoLancamentoPerfil as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    await perfilDoEstabelecimento(tx, e.perfil, est);
    const tipo = await tx.uma('SELECT id FROM tipo_lancamento_bancario WHERE id = ? AND ativo = TRUE', [
      e.tipo,
    ]);
    if (!tipo) throw recusa('tipo-inexistente', 'O tipo de lançamento não existe.', { campos: ['tipo'] });
    const [atual] = await tx.consultarParaAtualizar(
      `SELECT id, versao, excluido_em FROM permissao_tipo_lancamento
        WHERE perfil_acesso_id = ? AND estabelecimento_id = ? AND operacao = 'banco' AND tipo_lancamento_bancario_id = ?
        ORDER BY id LIMIT 1`,
      [e.perfil, est, e.tipo],
      { teto: 1 },
    );
    const vale = atual ? atual['excluido_em'] === null : false;
    if (vale === e.liberado)
      throw recusa('sem-mudanca', e.liberado ? 'O tipo já está liberado.' : 'O tipo já não está liberado.');
    // Liberar um tipo restringe o perfil (a primeira liberação liga a marca); retirar nunca desliga a marca.
    const restricao = e.liberado ? await marcarRestrito(tx, e.perfil, est, true, usuario) : null;
    const linha = atual
      ? (await tx.alterar(
          'permissao_tipo_lancamento',
          numero(atual['id']),
          numero(atual['versao']),
          e.liberado
            ? { excluido_em: null, excluido_por: null }
            : { excluido_em: new Date(), excluido_por: usuario },
        ),
        numero(atual['id']))
      : await tx.incluir('permissao_tipo_lancamento', {
          perfil_acesso_id: e.perfil,
          estabelecimento_id: est,
          operacao: 'banco',
          tipo_lancamento_bancario_id: e.tipo,
        });
    return {
      permissao: linha,
      perfil: e.perfil,
      tipo: e.tipo,
      liberado: e.liberado,
      restringiu: restricao?.mudou ?? false,
    };
  },
  alvo: (_e, r) => ({ tabela: 'permissao_tipo_lancamento', id: numero(r['permissao']) || null }),
});

export const esquemaRestricaoTipoLancamento = z.object({ perfil: id, restrito: z.boolean() }).strict();
export type RestricaoTipoLancamentoEntrada = z.infer<typeof esquemaRestricaoTipoLancamento>;

/** Restringir o perfil (mesmo sem nenhum tipo: nada passa) ou desfazer a restrição (volta a valer a operação). */
const manterRestricaoTipoLancamento = definirOperacao<RestricaoTipoLancamentoEntrada, ResultadoOperacao>({
  nome: 'financeiro.manter_restricao_tipo_lancamento',
  tabelas: ['restricao_tipo_lancamento_perfil'],
  entrada: esquemaRestricaoTipoLancamento as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    await perfilDoEstabelecimento(tx, e.perfil, est);
    const r = await marcarRestrito(tx, e.perfil, est, e.restrito, usuario);
    if (!r.mudou)
      throw recusa(
        'sem-mudanca',
        e.restrito ? 'O perfil já está restrito.' : 'O perfil já não está restrito.',
      );
    return { restricao: r.id, perfil: e.perfil, restrito: e.restrito };
  },
  alvo: (_e, r) => ({ tabela: 'restricao_tipo_lancamento_perfil', id: numero(r['restricao']) || null }),
});

/** A ação que dá a operação "banco" (lançar o movimento): o perfil livre só abre o tipo se a der. */
const ACAO_BANCO = 'financeiro.movimento.criar';

/** Os perfis vigentes do usuário no estabelecimento, cada um com a marca de restrito, a operação e a lista. */
export async function perfisNoTipoLancamento(
  l: Leitor,
  est: number,
  usuario: number,
): Promise<PerfilNoTipoLancamento[]> {
  const hoje = hojeIso();
  const linhas = await l.consultar(
    `SELECT a.id,
            EXISTS (SELECT 1 FROM restricao_tipo_lancamento_perfil r WHERE r.perfil_acesso_id = a.id
                       AND r.estabelecimento_id = ? AND r.operacao = 'banco' AND r.excluido_em IS NULL) AS restrito,
            (a.administrador OR EXISTS (SELECT 1 FROM perfil_acao pa JOIN acao_sistema s ON s.id = pa.acao_sistema_id
                       WHERE pa.perfil_acesso_id = a.id AND pa.excluido_em IS NULL AND pa.permitido
                         AND s.ativo AND s.codigo = ?)) AS concede,
            (SELECT GROUP_CONCAT(p.tipo_lancamento_bancario_id) FROM permissao_tipo_lancamento p
               WHERE p.perfil_acesso_id = a.id AND p.estabelecimento_id = ? AND p.operacao = 'banco'
                 AND p.excluido_em IS NULL AND p.tipo_lancamento_bancario_id IS NOT NULL) AS liberados
       FROM usuario_perfil up JOIN perfil_acesso a ON a.id = up.perfil_acesso_id AND a.excluido_em IS NULL
      WHERE up.usuario_id = ? AND up.estabelecimento_id = ? AND up.excluido_em IS NULL
        AND up.vigencia_inicio <= ? AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= ?)`,
    [est, ACAO_BANCO, est, usuario, est, hoje, hoje],
  );
  return linhas.map((r) => ({
    restrito: Number(r['restrito'] ?? 0) === 1,
    concedeOperacao: Number(r['concede'] ?? 0) === 1,
    liberados: r['liberados'] ? String(r['liberados']).split(',').map(Number) : [],
  }));
}

/** A trava do lançamento do movimento: o tipo, avaliado perfil a perfil (regra do domínio). */
export async function exigirTipoLancamentoLiberado(
  l: Leitor,
  est: number,
  usuario: number,
  tipo: number,
): Promise<void> {
  const perfis = await perfisNoTipoLancamento(l, est, usuario);
  if (conferirTipoLancamento(perfis, tipo, '') === null) return;
  const d = await l.uma('SELECT descricao FROM tipo_lancamento_bancario WHERE id = ?', [tipo]);
  recusar(conferirTipoLancamento(perfis, tipo, String(d?.['descricao'] ?? tipo)));
}

/** Os tipos de lançamento ativos com a marca de liberado ao perfil neste estabelecimento (para a tela). */
export async function tiposDoPerfil(l: Leitor, est: number, perfil: number) {
  const linhas = await l.consultar(
    `SELECT t.id, t.codigo, t.descricao, p.id AS pid FROM tipo_lancamento_bancario t
       LEFT JOIN permissao_tipo_lancamento p ON p.tipo_lancamento_bancario_id = t.id AND p.perfil_acesso_id = ?
            AND p.estabelecimento_id = ? AND p.operacao = 'banco' AND p.excluido_em IS NULL
      WHERE t.ativo = TRUE ORDER BY t.descricao LIMIT 300`,
    [perfil, est],
  );
  const marca = await l.uma(
    `SELECT id FROM restricao_tipo_lancamento_perfil WHERE perfil_acesso_id = ? AND estabelecimento_id = ?
        AND operacao = 'banco' AND excluido_em IS NULL`,
    [perfil, est],
  );
  return {
    restrito: !!marca,
    tipos: linhas.map((r) => ({
      tipo: numero(r['id']),
      codigo: String(r['codigo']),
      descricao: String(r['descricao']),
      liberado: r['pid'] !== null,
    })),
  };
}

export async function perfisDoEstabelecimento(l: Leitor, est: number) {
  const linhas = await l.consultar(
    `SELECT id, codigo, nome FROM perfil_acesso WHERE (estabelecimento_id IS NULL OR estabelecimento_id = ?)
        AND ativo = TRUE AND excluido_em IS NULL ORDER BY nome LIMIT 500`,
    [est],
  );
  return linhas.map((r) => ({ id: numero(r['id']), codigo: String(r['codigo']), nome: String(r['nome']) }));
}

/** Os centros de custo ativos do estabelecimento (para o rateio na tela). */
export async function centrosDoEstabelecimento(l: Leitor, est: number) {
  const linhas = await l.consultar(
    `SELECT id, codigo, nome FROM centro_custo WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL
      ORDER BY codigo LIMIT 2000`,
    [est],
  );
  return linhas.map((r) => ({ id: numero(r['id']), codigo: String(r['codigo']), nome: String(r['nome']) }));
}

/** As operações desta parte, pelo nome da tela. */
export const OPERACOES_GESTAO = {
  'financeiro.reclassificarLancamento': reclassificarLancamento,
  'financeiro.manterEscopoConta': manterEscopoConta,
  'financeiro.manterTipoLancamento': manterTipoLancamento,
  'financeiro.manterRestricaoTipoLancamento': manterRestricaoTipoLancamento,
} as const;

/** Busca do lançamento pelo número de negócio do título (ou do documento) e, no movimento, pelo documento ou histórico. */
export async function buscarLancamentos(l: Leitor, est: number, alvo: AlvoReclassificacao, termo: string) {
  const t = termo.trim().slice(0, 60);
  if (t.length < 2) return [];
  const a = ALVO[alvo];
  const filtro =
    alvo === 'movimento_bancario'
      ? '(x.numero_documento = ? OR x.historico LIKE ?)'
      : '(x.numero = ? OR x.numero_documento = ? OR x.numero LIKE ?)';
  const parametros = alvo === 'movimento_bancario' ? [t, `%${t}%`] : [t, t, `${t}%`];
  const linhas = await l.consultar(
    `SELECT x.id, x.${a.valor} AS valor, x.${a.data} AS data,
            ${alvo === 'movimento_bancario' ? 'x.historico' : "CONCAT(x.numero, ' / ', x.numero_documento)"} AS rotulo,
            n.codigo AS natureza
       FROM ${alvo} x LEFT JOIN natureza_financeira n ON n.id = x.natureza_financeira_id
      WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL AND ${filtro}
      ORDER BY x.${a.data} DESC, x.id DESC LIMIT 20`,
    [est, ...parametros],
  );
  return linhas.map((r) => ({
    id: numero(r['id']),
    rotulo: String(r['rotulo'] ?? ''),
    data: dataIso(r['data']) ?? '',
    valor: numero(r['valor']),
    natureza: r['natureza'] === null || r['natureza'] === undefined ? null : String(r['natureza']),
  }));
}
