// Fonte do M12 sobre o banco do cliente, pelo @sgh/nucleo: os convênios são as fontes pagadoras (fonte_pagadora, da
// rede inteira: não têm estabelecimento), o acordo do estabelecimento (contrato_fonte_pagadora, com as tabelas por
// vigência em contrato_tabela_vigencia), os planos (plano_fonte_pagadora e a vigência no estabelecimento em
// plano_fonte_pagadora_estabelecimento), o histórico do nome (fonte_pagadora_versao), as tabelas de preço
// (tabela_preco, preco_procedimento e os valores por vigência em preco_procedimento_valor; diárias e taxas em
// preco_diaria_taxa e preco_diaria_taxa_valor), os lotes de reajuste (lote_reajuste e lote_reajuste_item), as edições
// da referência de mat/med (edicao_referencia_matmed) e os códigos do prestador (codigo_prestador_fonte_pagadora).
// Leituras somente leitura; gravações pelo Executor (trilha, outbox e idempotência na mesma transação). Toda leitura
// de tabela com estabelecimento filtra o da sessão; toda leitura com exclusão lógica filtra os excluídos.
// Melhoria: suspender ou reativar o convênio vale só no estabelecimento da sessão (fonte_pagadora_estabelecimento,
// trava pela versão), com o retrato completo do registro depois da mudança em fonte_pagadora_versao na mesma
// transação; o prazo de retorno é o da unidade (nulo usa o da fonte pagadora); o contrato altera só os campos que o
// modelo tem, pela versão lida.
// Melhoria: a lista de convênios mostra só as fontes pagadoras credenciadas no estabelecimento da sessão.
// Melhoria: a gravação direta (planos) usa a Idempotency-Key do pedido: o reenvio devolve o mesmo resultado.
// Pendência (pedido do lote 02-12): nome, classificação, ANS, contato, e-mail, prazo de pagamento e validade da
// carteira são da rede inteira; hoje a permissão de editar o contrato os altera, falta a permissão própria de rede.
// Pendências (pedidos do lote 02-12, saida/02-12.json): o reajuste e o desfazer pelo lote, a importação de tabela
// (falta a linha da importação), os modificadores, os índices, o credenciamento, o de-para, os portes e as
// referências de terceiros ainda não são lidos do modelo (a tela mostra vazio e as gravações ficam não liberadas).
import { randomUUID } from 'node:crypto';
import type {
  AlterarContratoConvenioEntrada,
  AlterarSituacaoConvenioEntrada,
  DesfazerReajusteEntrada,
  EstadoOperacao,
} from '@sgh/contratos';
import {
  type ContextoNucleo,
  definirOperacao,
  ErroOperacao,
  erroConflitoVersao,
  erroNaoLiberada,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { civil, FUSO_PADRAO, relogioNoFuso } from '../exames/relogio.js';
import { mesmoValor, valorParaGravar } from './campos-contrato.js';
import type {
  ContextoGravacaoPreco,
  CtxPrecos,
  FiltroPagina,
  FontePrecos,
  MudancaCarga,
  TrilhaPreco,
} from './fonte.js';
import { type NomeOperacaoPreco, OPERACOES_PRECO } from './operacoes.js';
import {
  type AlteracaoPlano,
  type CabecalhoTabela,
  type ConvenioPreco,
  ErroPlano,
  type FiltroConvenio,
  type ImpactoSituacaoConvenio,
  type ItemDiariaPreco,
  type ItemHonorarioPreco,
  type ItemParaReajuste,
  type LinhaDoLote,
  type LoteReajuste,
  type NovaCarga,
  type NovoPlano,
  type Pagina,
  type PlanoConvenio,
  type TipoModificador,
  type VigenciaItem,
  type VigenciaTabelaConvenio,
  type VigenciaValor,
} from './tipos.js';

/** O mínimo do núcleo que a fonte usa. */
export type NucleoPrecos = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const textoN = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
const numeroDeTexto = (v: unknown) =>
  v !== null && v !== undefined && /^\d{1,15}$/.test(String(v)) ? Number(v) : null;
/** Situação do convênio no vocabulário do contrato da tela (pedido de contrato: a situação nomeada). */
const situacaoDaTela = (s: unknown) => (texto(s) === 'ativa' ? 'A' : 'I');
const situacaoDaTabela = (s: unknown) => (texto(s) === 'ativa' ? 'A' : 'I');
const paginaVazia = (colunas: [string, string][] = []): Pagina => ({
  colunas: colunas.map(([campo, rotulo]) => ({ campo, rotulo })),
  itens: [],
  total: 0,
});

/** Tipo da tela → tipo do item na regra de tabela do acordo. */
const TIPO_ITEM_VIGENCIA: Readonly<Record<string, VigenciaTabelaConvenio['tipo']>> = {
  honorario_internacao: 'honorariosInternacao',
  honorario_ambulatorial: 'honorariosExterna',
  diaria_taxa: 'diarias',
  matmed: 'matmed',
};
/** Tipo da tela → tipo de item da tabela de preço. */
const TIPOS_TABELA: Readonly<Record<'honorarios' | 'diarias' | 'matmed', readonly string[]>> = {
  honorarios: ['honorario'],
  diarias: ['diaria_taxa'],
  matmed: ['material', 'medicamento'],
};

/** Campo editável do contrato → coluna da fonte pagadora (os demais aguardam o modelo). */
const COLUNA_FONTE: Readonly<Record<string, string>> = {
  nome: 'nome',
  registroAns: 'registro_ans',
  classificacao: 'classe_fonte_pagadora_id',
  contato: 'contato_nome',
  convenioEmail: 'email',
  retornoDias: 'dias_retorno',
  prazoPagamentoDias: 'dias_pagamento_remessa',
  validaCarteira: 'exige_validade_carteira',
  telefone: 'telefone',
  uf: 'unidade_federativa_id',
  nfUf: 'nota_fiscal_unidade_federativa_id',
};
/** Campos de UF: a tela fala a sigla, o banco guarda a unidade federativa (FK). */
const CAMPOS_UF: ReadonlySet<string> = new Set(['uf', 'nfUf']);

// A situação vale por estabelecimento; a fonte inativa na rede fica inativa em todos.
const SQL_CONVENIO = `
  SELECT f.id, f.nome, CASE WHEN f.situacao = 'ativa' THEN fe.situacao ELSE f.situacao END AS situacao, f.registro_ans, f.classe_fonte_pagadora_id, cl.descricao AS classe,
         (SELECT ctv.tabela_preco_id FROM contrato_tabela_vigencia ctv JOIN contrato_fonte_pagadora k
             ON k.id = ctv.contrato_fonte_pagadora_id
           WHERE k.fonte_pagadora_id = f.id AND k.estabelecimento_id = ? AND k.excluido_em IS NULL
             AND ctv.tipo_item = 'honorario_internacao' AND ctv.vigencia_inicio <= CURRENT_DATE
             AND (ctv.vigencia_fim IS NULL OR ctv.vigencia_fim >= CURRENT_DATE)
           ORDER BY ctv.vigencia_inicio DESC LIMIT 1) AS tab_internacao,
         (SELECT ctv.tabela_preco_id FROM contrato_tabela_vigencia ctv JOIN contrato_fonte_pagadora k
             ON k.id = ctv.contrato_fonte_pagadora_id
           WHERE k.fonte_pagadora_id = f.id AND k.estabelecimento_id = ? AND k.excluido_em IS NULL
             AND ctv.tipo_item = 'honorario_ambulatorial' AND ctv.vigencia_inicio <= CURRENT_DATE
             AND (ctv.vigencia_fim IS NULL OR ctv.vigencia_fim >= CURRENT_DATE)
           ORDER BY ctv.vigencia_inicio DESC LIMIT 1) AS tab_externa,
         (SELECT ctv.tabela_preco_id FROM contrato_tabela_vigencia ctv JOIN contrato_fonte_pagadora k
             ON k.id = ctv.contrato_fonte_pagadora_id
           WHERE k.fonte_pagadora_id = f.id AND k.estabelecimento_id = ? AND k.excluido_em IS NULL
             AND ctv.tipo_item = 'diaria_taxa' AND ctv.vigencia_inicio <= CURRENT_DATE
             AND (ctv.vigencia_fim IS NULL OR ctv.vigencia_fim >= CURRENT_DATE)
           ORDER BY ctv.vigencia_inicio DESC LIMIT 1) AS tab_diarias,
         (SELECT ctv.tabela_preco_id FROM contrato_tabela_vigencia ctv JOIN contrato_fonte_pagadora k
             ON k.id = ctv.contrato_fonte_pagadora_id
           WHERE k.fonte_pagadora_id = f.id AND k.estabelecimento_id = ? AND k.excluido_em IS NULL
             AND ctv.tipo_item = 'matmed' AND ctv.vigencia_inicio <= CURRENT_DATE
             AND (ctv.vigencia_fim IS NULL OR ctv.vigencia_fim >= CURRENT_DATE)
           ORDER BY ctv.vigencia_inicio DESC LIMIT 1) AS tab_matmed
    FROM fonte_pagadora f
    JOIN fonte_pagadora_estabelecimento fe
      ON fe.fonte_pagadora_id = f.id AND fe.estabelecimento_id = ? AND fe.excluido_em IS NULL
    LEFT JOIN classe_fonte_pagadora cl ON cl.id = f.classe_fonte_pagadora_id
   WHERE f.excluido_em IS NULL`;

function convenioDe(r: Linha): ConvenioPreco {
  return {
    codigo: n(r['id']),
    nome: texto(r['nome']),
    situacao: situacaoDaTela(r['situacao']),
    classificacao: nn(r['classe_fonte_pagadora_id']),
    classificacaoNome: textoN(r['classe']),
    registroAns: numeroDeTexto(r['registro_ans']),
    honorariosInternacao: nn(r['tab_internacao']),
    honorariosExterna: nn(r['tab_externa']),
    diarias: nn(r['tab_diarias']),
    matmed: nn(r['tab_matmed']),
    porte: null,
  };
}

/** Valor do componente: honorário, custo operacional, filme, anestesia e outros. */
const componentesDe = (r: Linha) => ({
  ch: Number(r['valor_honorario'] ?? 0),
  co: Number(r['valor_custo_operacional'] ?? 0),
  filme: Number(r['valor_filme'] ?? 0),
  anes: Number(r['valor_anestesia'] ?? 0),
  outros: Number(r['valor_outros'] ?? 0),
});

const SQL_ITENS_HONORARIO = `
  SELECT pp.id, COALESCE(pp.descricao_cobranca, it.descricao) AS nome, pp.ativo, pp.quantidade_indice,
         pp.modelo_valor, po.codigo AS porte,
         v.vigencia_inicio, v.valor_honorario, v.valor_custo_operacional, v.valor_filme, v.valor_anestesia,
         v.valor_outros,
         (SELECT COUNT(*) FROM preco_procedimento_valor x WHERE x.preco_procedimento_id = pp.id) AS vigencias,
         (SELECT MAX(x.vigencia_inicio) FROM preco_procedimento_valor x WHERE x.preco_procedimento_id = pp.id) AS ultima,
         EXISTS (SELECT 1 FROM preco_procedimento_valor x WHERE x.preco_procedimento_id = pp.id
                   AND x.vigencia_inicio = ?) AS tem_na_data
    FROM preco_procedimento pp
    JOIN tabela_preco t ON t.id = pp.tabela_preco_id
    LEFT JOIN item_faturavel it ON it.id = pp.item_faturavel_id
    LEFT JOIN porte_procedimento po ON po.id = pp.porte_procedimento_id
    LEFT JOIN preco_procedimento_valor v ON v.id = (
           SELECT x.id FROM preco_procedimento_valor x
            WHERE x.preco_procedimento_id = pp.id AND x.vigencia_inicio <= ? AND x.operacao <> 'exclusao'
            ORDER BY x.vigencia_inicio DESC, x.id DESC LIMIT 1)
   WHERE pp.tabela_preco_id = ? AND t.estabelecimento_id = ? AND pp.excluido_em IS NULL AND t.excluido_em IS NULL`;

function itemHonorarioDe(r: Linha): ItemParaReajuste {
  const vig = dataIso(r['vigencia_inicio']);
  return {
    codigo: n(r['id']),
    nome: texto(r['nome']),
    situacao: verdadeiro(r['ativo']) ? 'A' : 'I',
    ch: texto(r['modelo_valor']) === 'indice' ? Number(r['quantidade_indice'] ?? 0) : 0,
    porte: textoN(r['porte']),
    fracaoPorte: null,
    cope: null,
    filmeM2: null,
    ato: null,
    vigencia: vig,
    valores: vig ? componentesDe(r) : null,
    vigencias: n(r['vigencias']),
    ultimaData: dataIso(r['ultima']),
    temNaData: verdadeiro(r['tem_na_data']),
  };
}

const SQL_ITENS_DIARIA = `
  SELECT d.id, d.codigo, d.nome, d.tipo_item, d.ativo, v.vigencia_inicio, v.valor,
         (SELECT COUNT(*) FROM preco_diaria_taxa_valor x WHERE x.preco_diaria_taxa_id = d.id) AS vigencias
    FROM preco_diaria_taxa d JOIN tabela_preco t ON t.id = d.tabela_preco_id
    LEFT JOIN preco_diaria_taxa_valor v ON v.id = (
           SELECT x.id FROM preco_diaria_taxa_valor x WHERE x.preco_diaria_taxa_id = d.id AND x.vigencia_inicio <= ?
              AND x.operacao <> 'exclusao' ORDER BY x.vigencia_inicio DESC, x.id DESC LIMIT 1)
   WHERE d.tabela_preco_id = ? AND t.estabelecimento_id = ? AND d.excluido_em IS NULL AND t.excluido_em IS NULL`;

function itemDiariaDe(r: Linha): ItemDiariaPreco {
  return {
    id: n(r['id']),
    codigo: textoN(r['codigo']),
    operacao: n(r['id']),
    nome: texto(r['nome']),
    tipo: null,
    subtipo: null,
    situacao: verdadeiro(r['ativo']) ? 'A' : 'I',
    vigencia: dataIso(r['vigencia_inicio']),
    valor: nn(r['valor']),
    vigencias: n(r['vigencias']),
  };
}

const naoLido = <T>(v: T) => Promise.resolve(v);

export class FontePrecosPropria implements FontePrecos {
  readonly destino = 'banco' as const;
  readonly gravacao = { permitida: true, motivo: null };
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoPrecos,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: CtxPrecos, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), (l) => fn(l, est));
  }

  /** Só as operações já escritas sobre o modelo estão liberadas; as demais aguardam (null: não disponível). */
  estado(op: string): EstadoOperacao | null {
    return op === 'convenio.alterarSituacao' || op === 'convenio.alterarContrato' ? 'liberada' : null;
  }

  async executar(nome: NomeOperacaoPreco, c: CtxPrecos, entrada: unknown, ctx: ContextoGravacaoPreco) {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    const op =
      nome === 'convenio.alterarSituacao'
        ? OP_SITUACAO
        : nome === 'convenio.alterarContrato'
          ? OP_CONTRATO
          : null;
    if (!op) throw erroNaoLiberada('o reajuste e o desfazer pelo lote aguardam a fonte própria');
    const r = await this.executor.executar(op as typeof OP_SITUACAO, c.cliente, entrada, {
      ...contextoDe(c),
      chaveIdempotencia: ctx.chaveIdempotencia,
      ...(ctx.reautenticadoEm !== undefined ? { reautenticadoEm: ctx.reautenticadoEm } : {}),
    });
    return { resultado: r.resultado, repetida: r.repetida };
  }

  // ── Convênios e contrato ──────────────────────────────────────────────────────────────────────────

  hoje(c: CtxPrecos): Promise<string> {
    return this.ler(c, async (l, est) => relogioNoFuso(await fusoDe(l, est)).hoje);
  }

  convenios(c: CtxPrecos): Promise<ConvenioPreco[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(`${SQL_CONVENIO} ORDER BY f.nome, f.id`, [est, est, est, est, est], { teto: 5_000 })
      ).map(convenioDe),
    );
  }

  convenio(c: CtxPrecos, cod: number): Promise<ConvenioPreco | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_CONVENIO} AND f.id = ?`, [est, est, est, est, est, cod]);
      return r ? convenioDe(r) : null;
    });
  }

  valoresContrato(c: CtxPrecos, cod: number) {
    return this.ler(c, async (l, est) => {
      const f = await l.uma(
        `SELECT f.nome, f.registro_ans, f.classe_fonte_pagadora_id, f.contato_nome, f.email, f.exige_validade_carteira,
                f.telefone, ufp.sigla AS uf_sigla, ufn.sigla AS nf_uf_sigla,
                COALESCE(fe.dias_retorno, f.dias_retorno) AS dias_retorno, f.dias_pagamento_remessa, pj.cnpj, pj.inscricao_estadual,
                k.situacao AS situacao_acordo, k.vigencia_inicio, k.vigencia_fim, k.prazo_apresentacao_dias,
                k.dia_corte_faturamento, k.exige_guia, k.cobra_insumos, k.fatura_pela_data_alta, k.abate_devolucao,
                k.exige_auditoria_interna, k.iss_retido_pela_fonte AS iss_acordo, k.percentual_iss AS iss_pct,
                k.percentual_ir AS ir_pct, k.percentual_custo_financeiro
           FROM fonte_pagadora f
           JOIN fonte_pagadora_estabelecimento fe
             ON fe.fonte_pagadora_id = f.id AND fe.estabelecimento_id = ? AND fe.excluido_em IS NULL
           LEFT JOIN pessoa_juridica pj ON pj.id = f.pessoa_juridica_id
           LEFT JOIN unidade_federativa ufp ON ufp.id = f.unidade_federativa_id
           LEFT JOIN unidade_federativa ufn ON ufn.id = f.nota_fiscal_unidade_federativa_id
           LEFT JOIN contrato_fonte_pagadora k ON k.id = (
                  SELECT x.id FROM contrato_fonte_pagadora x
                   WHERE x.fonte_pagadora_id = f.id AND x.estabelecimento_id = ? AND x.excluido_em IS NULL
                   ORDER BY x.situacao = 'vigente' DESC, x.vigencia_inicio DESC LIMIT 1)
          WHERE f.id = ? AND f.excluido_em IS NULL`,
        [est, est, cod],
      );
      if (!f) return null;
      const sim = (v: unknown) => (v === null || v === undefined ? null : verdadeiro(v) ? 'sim' : 'não');
      const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      return {
        nome: texto(f['nome']),
        cnpj: numeroDeTexto(f['cnpj']),
        inscricaoEstadual: textoN(f['inscricao_estadual']),
        registroAns: numeroDeTexto(f['registro_ans']),
        classificacao: f['classe_fonte_pagadora_id'] === null ? null : texto(f['classe_fonte_pagadora_id']),
        contato: textoN(f['contato_nome']),
        convenioEmail: textoN(f['email']),
        telefone: textoN(f['telefone']),
        uf: textoN(f['uf_sigla']),
        nfUf: textoN(f['nf_uf_sigla']),
        // O contrato da tela ainda fala "T"/"F" (pedido de contrato: booleano).
        validaCarteira: verdadeiro(f['exige_validade_carteira']) ? 'T' : 'F',
        retornoDias: f['dias_retorno'] === null ? null : texto(f['dias_retorno']),
        prazoPagamentoDias: f['dias_pagamento_remessa'] === null ? null : texto(f['dias_pagamento_remessa']),
        situacaoAcordo: textoN(f['situacao_acordo']),
        vigenciaInicio: dataIso(f['vigencia_inicio']),
        vigenciaFim: dataIso(f['vigencia_fim']),
        prazoApresentacaoDias: num(f['prazo_apresentacao_dias']),
        diaCorteFaturamento: num(f['dia_corte_faturamento']),
        exigeGuia: sim(f['exige_guia']),
        cobraInsumos: sim(f['cobra_insumos']),
        faturaPelaDataAlta: sim(f['fatura_pela_data_alta']),
        abateDevolucao: sim(f['abate_devolucao']),
        exigeAuditoriaInterna: sim(f['exige_auditoria_interna']),
        issRetidoPelaFonte: sim(f['iss_acordo']),
        percentualIss: num(f['iss_pct']),
        percentualIr: num(f['ir_pct']),
        percentualCustoFinanceiro: num(f['percentual_custo_financeiro']),
      } as Record<string, string | number | null>;
    });
  }

  opcoesClassificacao(c: CtxPrecos) {
    // A classificação é da rede inteira (sem estabelecimento).
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          'SELECT id, descricao FROM classe_fonte_pagadora WHERE ativo = TRUE ORDER BY descricao',
          [],
          {
            teto: 500,
          },
        )
      ).map((r) => ({ valor: texto(r['id']), rotulo: texto(r['descricao']) })),
    );
  }

  vigenciasTabelas(c: CtxPrecos, cod: number): Promise<VigenciaTabelaConvenio[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT ctv.tipo_item, ctv.tabela_preco_id, ctv.vigencia_inicio, ctv.vigencia_fim
             FROM contrato_tabela_vigencia ctv JOIN contrato_fonte_pagadora k ON k.id = ctv.contrato_fonte_pagadora_id
            WHERE k.fonte_pagadora_id = ? AND k.estabelecimento_id = ? AND k.excluido_em IS NULL
            ORDER BY ctv.vigencia_inicio DESC, ctv.id`,
          [cod, est],
          { teto: 2_000 },
        )
      ).flatMap((r) => {
        const tipo = TIPO_ITEM_VIGENCIA[texto(r['tipo_item'])];
        return tipo
          ? [
              {
                tipo,
                tabela: n(r['tabela_preco_id']),
                inicio: dataIso(r['vigencia_inicio']) ?? '',
                fim: dataIso(r['vigencia_fim']),
              },
            ]
          : [];
      }),
    );
  }

  indicesConvenio() {
    return naoLido([]);
  }

  tiss(c: CtxPrecos, cod: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT codigo_operadora, codigo_contratado_tiss FROM codigo_prestador_fonte_pagadora
          WHERE fonte_pagadora_id = ? AND estabelecimento_id = ? AND tipo_prestador = 'estabelecimento'
            AND ativo = TRUE AND excluido_em IS NULL ORDER BY vigencia_inicio DESC LIMIT 1`,
        [cod, est],
      );
      return {
        configurado: r !== null,
        valores: r
          ? {
              codigoPrestador: texto(r['codigo_operadora']),
              codigoContratado: textoN(r['codigo_contratado_tiss']),
            }
          : {},
        parametros: [],
      };
    });
  }

  historico(c: CtxPrecos, cod: number) {
    return this.ler(c, async (l, est) => {
      const fuso = await fusoDe(l, est);
      return (
        await l.consultar(
          'SELECT ocorrido_em, nome, classe_fonte_pagadora_id FROM fonte_pagadora_versao WHERE fonte_pagadora_id = ? ORDER BY ocorrido_em DESC, id DESC',
          [cod],
          { teto: 500 },
        )
      ).map((r) => ({
        quando: localDe(r['ocorrido_em'], fuso),
        nome: texto(r['nome']),
        classificacao: nn(r['classe_fonte_pagadora_id']),
      }));
    });
  }

  planos(c: CtxPrecos, cod: number): Promise<PlanoConvenio[] | null> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT pe.id, p.descricao, p.codigo, pe.vigencia_inicio, pe.vigencia_fim, pe.ativo, pe.versao, u.login
             FROM plano_fonte_pagadora_estabelecimento pe
             JOIN plano_fonte_pagadora p ON p.id = pe.plano_fonte_pagadora_id
             LEFT JOIN usuario u ON u.id = pe.criado_por
            WHERE p.fonte_pagadora_id = ? AND pe.estabelecimento_id = ? AND pe.excluido_em IS NULL AND p.excluido_em IS NULL
            ORDER BY pe.vigencia_inicio DESC, pe.id`,
          [cod, est],
          { teto: 500 },
        )
      ).map((r) => ({
        id: n(r['id']),
        nome: texto(r['descricao']),
        planoLegado: numeroDeTexto(r['codigo']),
        inicio: dataIso(r['vigencia_inicio']) ?? '',
        fim: dataIso(r['vigencia_fim']),
        ativo: verdadeiro(r['ativo']),
        criadoPor: texto(r['login']),
        versao: n(r['versao']),
      })),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta
  modificadores(_c: CtxPrecos, _t: TipoModificador) {
    return naoLido({ itens: [], total: 0 });
  }

  impactoSituacao(c: CtxPrecos, cod: number): Promise<ImpactoSituacaoConvenio> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT
           (SELECT COUNT(*) FROM agenda_fonte_pagadora af JOIN agenda_servico a ON a.id = af.agenda_servico_id
              JOIN categoria_agenda ca ON ca.id = a.categoria_agenda_id
             WHERE af.fonte_pagadora_id = ? AND a.estabelecimento_id = ? AND af.excluido_em IS NULL
               AND a.excluido_em IS NULL AND ca.natureza = 'consulta') AS consulta,
           (SELECT COUNT(*) FROM agenda_fonte_pagadora af JOIN agenda_servico a ON a.id = af.agenda_servico_id
              JOIN categoria_agenda ca ON ca.id = a.categoria_agenda_id
             WHERE af.fonte_pagadora_id = ? AND a.estabelecimento_id = ? AND af.excluido_em IS NULL
               AND a.excluido_em IS NULL AND ca.natureza = 'exame') AS exame,
           (SELECT COUNT(*) FROM marcacao_horario m JOIN horario_agenda h ON h.id = m.horario_agenda_id
             WHERE m.fonte_pagadora_id = ? AND m.estabelecimento_id = ? AND m.excluido_em IS NULL
               AND h.inicio_em > CURRENT_TIMESTAMP) AS futuros`,
        [cod, est, cod, est, cod, est],
      );
      return {
        agendasConsulta: n(r?.['consulta']),
        agendasExame: n(r?.['exame']),
        agendamentosFuturos: n(r?.['futuros']),
        // Pendência de leitura: contas abertas e vínculos de profissionais (módulos do faturamento e do cadastro).
        contasAbertas: 0,
        profissionais: 0,
        diariaAcompanhante: null,
      };
    });
  }

  // ── Tabelas de preço ──────────────────────────────────────────────────────────────────────────────

  cabecalhos(c: CtxPrecos, tipo: 'honorarios' | 'diarias' | 'matmed'): Promise<CabecalhoTabela[]> {
    const tipos = TIPOS_TABELA[tipo];
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT id, descricao, situacao, moeda_calculo FROM tabela_preco
            WHERE estabelecimento_id = ? AND excluido_em IS NULL AND tipo_item IN (${tipos.map(() => '?').join(', ')})
            ORDER BY descricao, id`,
          [est, ...tipos],
          { teto: 2_000 },
        )
      ).map((r) => ({
        codigo: n(r['id']),
        nome: texto(r['descricao']),
        situacao: situacaoDaTabela(r['situacao']),
        modo: textoN(r['moeda_calculo']),
      })),
    );
  }

  perfisHonorario(c: CtxPrecos) {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT pp.tabela_preco_id, COUNT(*) AS itens, SUM(pp.modelo_valor = 'indice') AS com_ch,
                SUM(pp.modelo_valor = 'porte') AS com_porte
           FROM preco_procedimento pp JOIN tabela_preco t ON t.id = pp.tabela_preco_id
          WHERE t.estabelecimento_id = ? AND pp.excluido_em IS NULL AND t.excluido_em IS NULL
          GROUP BY pp.tabela_preco_id`,
        [est],
        { teto: 5_000 },
      );
      return new Map(
        ls.map((r) => [
          n(r['tabela_preco_id']),
          { itens: n(r['itens']), comCh: n(r['com_ch']), comPorte: n(r['com_porte']) },
        ]),
      );
    });
  }

  itensHonorario(
    c: CtxPrecos,
    tab: number,
    f: FiltroPagina,
  ): Promise<{ itens: ItemHonorarioPreco[]; total: number }> {
    return this.ler(c, async (l, est) => {
      const busca = f.busca?.trim() ? ` AND COALESCE(pp.descricao_cobranca, it.descricao) LIKE ?` : '';
      const p = [f.data, f.data, tab, est, ...(busca ? [`%${f.busca!.trim().replace(/[%_\\]/g, '')}%`] : [])];
      const total = await l.uma<{ total: unknown }>(
        `SELECT COUNT(*) AS total FROM preco_procedimento pp JOIN tabela_preco t ON t.id = pp.tabela_preco_id
           LEFT JOIN item_faturavel it ON it.id = pp.item_faturavel_id
          WHERE pp.tabela_preco_id = ? AND t.estabelecimento_id = ? AND pp.excluido_em IS NULL
            AND t.excluido_em IS NULL${busca}`,
        p.slice(2),
      );
      const ls = await l.consultar(`${SQL_ITENS_HONORARIO}${busca} ORDER BY nome, pp.id LIMIT ? OFFSET ?`, [
        ...p,
        f.porPagina,
        f.pagina * f.porPagina,
      ]);
      return { itens: ls.map(itemHonorarioDe), total: n(total?.total) };
    });
  }

  itemHonorario(c: CtxPrecos, tab: number, cod: number, data: string): Promise<ItemHonorarioPreco | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_ITENS_HONORARIO} AND pp.id = ?`, [data, data, tab, est, cod]);
      return r ? itemHonorarioDe(r) : null;
    });
  }

  itensParaReajuste(
    c: CtxPrecos,
    tab: number,
    codigos: readonly number[] | null,
    data: string,
    teto: number,
  ) {
    return this.ler(c, async (l, est) => {
      const filtro = codigos && codigos.length ? ` AND pp.id IN (${codigos.map(() => '?').join(', ')})` : '';
      return (
        await l.consultar(`${SQL_ITENS_HONORARIO}${filtro} ORDER BY pp.id LIMIT ?`, [
          data,
          data,
          tab,
          est,
          ...(codigos ?? []),
          teto,
        ])
      ).map(itemHonorarioDe);
    });
  }

  vigenciasDoItem(c: CtxPrecos, tab: number, cod: number): Promise<VigenciaItem[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT v.* FROM preco_procedimento_valor v JOIN preco_procedimento pp ON pp.id = v.preco_procedimento_id
             JOIN tabela_preco t ON t.id = pp.tabela_preco_id
            WHERE pp.id = ? AND pp.tabela_preco_id = ? AND t.estabelecimento_id = ? AND v.operacao <> 'exclusao'
            ORDER BY v.vigencia_inicio DESC, v.id DESC`,
          [cod, tab, est],
          { teto: 1_000 },
        )
      ).map((r) => ({ data: dataIso(r['vigencia_inicio']) ?? '', valores: componentesDe(r) })),
    );
  }

  autoriaDoItem() {
    return naoLido(null);
  }

  lotes(c: CtxPrecos, tab: number | null): Promise<LoteReajuste[] | null> {
    return this.ler(c, async (l, est) => {
      const fuso = await fusoDe(l, est);
      return (
        await l.consultar(
          `SELECT lr.identificador, lr.tabela_preco_id, lr.vigencia_inicio, lr.tipo_lote, lr.quantidade_itens,
                  lr.quantidade_desfeitos, lr.situacao, lr.justificativa, lr.criado_em, u.login
             FROM lote_reajuste lr JOIN tabela_preco t ON t.id = lr.tabela_preco_id
             LEFT JOIN usuario u ON u.id = lr.autor_usuario_id
            WHERE t.estabelecimento_id = ? AND lr.excluido_em IS NULL${tab !== null ? ' AND lr.tabela_preco_id = ?' : ''}
            ORDER BY lr.criado_em DESC, lr.id DESC`,
          tab !== null ? [est, tab] : [est],
          { teto: 1_000 },
        )
      ).map((r) => ({
        lote: texto(r['identificador']),
        tabela: n(r['tabela_preco_id']),
        data: dataIso(r['vigencia_inicio']) ?? '',
        origem: texto(r['tipo_lote']),
        itens: n(r['quantidade_itens']),
        autor: texto(r['login']),
        quando: localDe(r['criado_em'], fuso),
        justificativa: texto(r['justificativa']),
        desfeitos: n(r['quantidade_desfeitos']),
        desfeito: texto(r['situacao']) === 'desfeito',
      }));
    });
  }

  linhasDoLote(c: CtxPrecos, lote: string): Promise<LinhaDoLote[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT lr.tabela_preco_id, i.preco_procedimento_id, i.vigencia_base, lr.vigencia_inicio, i.componentes_novos
             FROM lote_reajuste_item i JOIN lote_reajuste lr ON lr.id = i.lote_reajuste_id
             JOIN tabela_preco t ON t.id = lr.tabela_preco_id
            WHERE lr.identificador = ? AND t.estabelecimento_id = ? AND i.excluido_em IS NULL
            ORDER BY i.sequencia`,
          [lote, est],
          { teto: 20_000 },
        )
      ).map((r) => {
        let comp: Record<string, unknown>;
        try {
          comp =
            typeof r['componentes_novos'] === 'string'
              ? JSON.parse(r['componentes_novos'] as string)
              : ((r['componentes_novos'] as Record<string, unknown>) ?? {});
        } catch {
          comp = {};
        }
        return {
          tabela: n(r['tabela_preco_id']),
          codigo: n(r['preco_procedimento_id']),
          data: dataIso(r['vigencia_inicio']) ?? '',
          valores: {
            ch: Number(comp['ch'] ?? 0),
            co: Number(comp['co'] ?? 0),
            filme: Number(comp['filme'] ?? 0),
            anes: Number(comp['anes'] ?? 0),
            outros: Number(comp['outros'] ?? 0),
          },
        };
      }),
    );
  }

  itensDiaria(
    c: CtxPrecos,
    tab: number,
    f: FiltroPagina,
  ): Promise<{ itens: ItemDiariaPreco[]; total: number }> {
    return this.ler(c, async (l, est) => {
      const total = await l.uma<{ total: unknown }>(
        `SELECT COUNT(*) AS total FROM preco_diaria_taxa d JOIN tabela_preco t ON t.id = d.tabela_preco_id
          WHERE d.tabela_preco_id = ? AND t.estabelecimento_id = ? AND d.excluido_em IS NULL AND t.excluido_em IS NULL`,
        [tab, est],
      );
      const ls = await l.consultar(`${SQL_ITENS_DIARIA} ORDER BY d.nome, d.id LIMIT ? OFFSET ?`, [
        f.data,
        tab,
        est,
        f.porPagina,
        f.pagina * f.porPagina,
      ]);
      return { itens: ls.map(itemDiariaDe), total: n(total?.total) };
    });
  }

  itemDiaria(c: CtxPrecos, tab: number, ope: number, data: string): Promise<ItemDiariaPreco | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_ITENS_DIARIA} AND d.id = ?`, [data, tab, est, ope]);
      return r ? itemDiariaDe(r) : null;
    });
  }

  itensMatmed() {
    return naoLido({ itens: [], total: 0 });
  }

  itemMatmed() {
    return naoLido(null);
  }

  vigenciasDiaria(c: CtxPrecos, tab: number, ope: number): Promise<VigenciaValor[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT v.vigencia_inicio, v.valor FROM preco_diaria_taxa_valor v JOIN preco_diaria_taxa d ON d.id = v.preco_diaria_taxa_id
             JOIN tabela_preco t ON t.id = d.tabela_preco_id
            WHERE d.id = ? AND d.tabela_preco_id = ? AND t.estabelecimento_id = ? AND v.operacao <> 'exclusao'
            ORDER BY v.vigencia_inicio DESC, v.id DESC`,
          [ope, tab, est],
          { teto: 1_000 },
        )
      ).map((r) => ({ data: dataIso(r['vigencia_inicio']) ?? '', valor: nn(r['valor']) })),
    );
  }

  vigenciasMatmed() {
    return naoLido([]);
  }

  edicoes(c: CtxPrecos) {
    // As edições da referência de mat/med são da rede inteira (publicação externa, sem estabelecimento).
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          'SELECT id, numero_edicao FROM edicao_referencia_matmed ORDER BY vigencia_inicio DESC, id DESC',
          [],
          { teto: 500 },
        )
      ).map((r) => ({ id: n(r['id']), versao: Number(String(r['numero_edicao']).replace(/\D/g, '') || 0) })),
    );
  }

  indicesNaData() {
    return naoLido(new Map<number, number>());
  }

  porteNaData() {
    return naoLido(null);
  }

  credenciamento() {
    return naoLido(paginaVazia());
  }

  credenciamentoAtos() {
    return naoLido(paginaVazia());
  }

  credenciamentoComplementar() {
    return naoLido({ unimed: paginaVazia(), auditoras: paginaVazia() });
  }

  codigosPrestador(c: CtxPrecos, conv: FiltroConvenio, pagina: number, porPagina: number): Promise<Pagina> {
    return this.ler(c, async (l, est) => {
      const lista = conv == null ? null : typeof conv === 'number' ? [conv] : [...conv];
      if (lista && lista.length === 0) return paginaVazia(COLUNAS_PRESTADOR);
      const filtro = lista ? ` AND cp.fonte_pagadora_id IN (${lista.map(() => '?').join(', ')})` : '';
      const total = await l.uma<{ total: unknown }>(
        `SELECT COUNT(*) AS total FROM codigo_prestador_fonte_pagadora cp
          WHERE cp.estabelecimento_id = ? AND cp.excluido_em IS NULL AND cp.ativo = TRUE${filtro}`,
        [est, ...(lista ?? [])],
      );
      const itens = await l.consultar(
        `SELECT cp.fonte_pagadora_id AS convenio, f.nome AS convenio_nome, cp.tipo_prestador, cp.codigo_operadora,
                cp.vigencia_inicio, cp.vigencia_fim
           FROM codigo_prestador_fonte_pagadora cp JOIN fonte_pagadora f ON f.id = cp.fonte_pagadora_id
          WHERE cp.estabelecimento_id = ? AND cp.excluido_em IS NULL AND cp.ativo = TRUE${filtro}
          ORDER BY f.nome, cp.id LIMIT ? OFFSET ?`,
        [est, ...(lista ?? []), porPagina, pagina * porPagina],
      );
      return {
        colunas: COLUNAS_PRESTADOR.map(([campo, rotulo]) => ({ campo, rotulo })),
        itens: itens.map((r) => ({
          convenio: n(r['convenio']),
          convenioNome: texto(r['convenio_nome']),
          tipo: texto(r['tipo_prestador']),
          codigo: texto(r['codigo_operadora']),
          inicio: dataIso(r['vigencia_inicio']),
          fim: dataIso(r['vigencia_fim']),
        })),
        total: n(total?.total),
      };
    });
  }

  dePara() {
    return naoLido(paginaVazia());
  }

  portes() {
    return naoLido(paginaVazia());
  }

  terceiros() {
    return naoLido(paginaVazia());
  }

  tabelasTerceiros() {
    return naoLido([]);
  }

  unimed() {
    return naoLido(paginaVazia());
  }

  saneamento() {
    return naoLido([]);
  }

  // ── Importação e planos ───────────────────────────────────────────────────────────────────────────

  cargas() {
    return naoLido(null);
  }

  carga() {
    return naoLido(null);
  }

  linhasDaCarga() {
    return naoLido({ itens: [], total: 0 });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta
  async gravarCarga(_c: CtxPrecos, _n: NovaCarga, _t: TrilhaPreco): Promise<{ id: number }> {
    throw modeloPendente('A importação de tabela (as linhas da carga)');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta
  async mudarSituacaoCarga(_c: CtxPrecos, _m: MudancaCarga, _t: TrilhaPreco): Promise<void> {
    throw modeloPendente('A importação de tabela (as linhas da carga)');
  }

  async gravarPlano(c: CtxPrecos, p: NovoPlano, t: TrilhaPreco): Promise<{ id: number }> {
    const r = await this.direta(
      c,
      'convenio.incluir-plano',
      ['plano_fonte_pagadora', 'plano_fonte_pagadora_estabelecimento'],
      t,
      async (tx, est) => {
        const f = await tx.uma('SELECT id FROM fonte_pagadora WHERE id = ? AND excluido_em IS NULL', [
          p.convenio,
        ]);
        if (!f) throw recusa('nao-encontrado', 'Convênio não encontrado.');
        if (p.fim !== null && p.fim < p.inicio)
          throw recusa('vigencia-invalida', `O fim (${p.fim}) não pode ser antes do início (${p.inicio}).`);
        const codigo = p.planoLegado !== null ? String(p.planoLegado) : null;
        const ja = codigo
          ? await tx.uma<{ id: unknown }>(
              'SELECT id FROM plano_fonte_pagadora WHERE fonte_pagadora_id = ? AND codigo = ? AND excluido_em IS NULL',
              [p.convenio, codigo],
            )
          : null;
        const plano =
          ja !== null
            ? n(ja.id)
            : await tx.incluir('plano_fonte_pagadora', {
                fonte_pagadora_id: p.convenio,
                codigo: codigo ?? `P${Date.now().toString(36).toUpperCase()}`,
                descricao: p.nome.slice(0, 150),
              });
        const id = await tx.incluir('plano_fonte_pagadora_estabelecimento', {
          plano_fonte_pagadora_id: plano,
          estabelecimento_id: est,
          vigencia_inicio: p.inicio,
          vigencia_fim: p.fim,
          observacao: p.justificativa,
        });
        return { id };
      },
    );
    return r;
  }

  async alterarPlano(
    c: CtxPrecos,
    a: AlteracaoPlano,
    t: TrilhaPreco,
  ): Promise<{ id: number; versao: number }> {
    return this.direta(
      c,
      'convenio.alterar-plano',
      ['plano_fonte_pagadora', 'plano_fonte_pagadora_estabelecimento'],
      t,
      async (tx, est) => {
        const [pe] = await tx.consultarParaAtualizar<Linha>(
          `SELECT pe.id, pe.versao, pe.vigencia_inicio, pe.plano_fonte_pagadora_id, p.versao AS versao_plano
           FROM plano_fonte_pagadora_estabelecimento pe JOIN plano_fonte_pagadora p ON p.id = pe.plano_fonte_pagadora_id
          WHERE pe.id = ? AND pe.estabelecimento_id = ? AND p.fonte_pagadora_id = ? AND pe.excluido_em IS NULL`,
          [a.id, est, a.convenio],
        );
        if (!pe) throw recusa('nao-encontrado', 'Plano não encontrado.');
        if (n(pe['versao']) !== a.versao)
          throw recusa('conflito-concorrente', 'O plano mudou depois que você abriu: abra de novo.');
        const inicio = dataIso(pe['vigencia_inicio']) ?? '';
        if (a.fim !== undefined && a.fim !== null && a.fim < inicio)
          throw recusa('vigencia-invalida', `O fim (${a.fim}) não pode ser antes do início (${inicio}).`);
        if (a.nome !== undefined)
          await tx.alterar('plano_fonte_pagadora', n(pe['plano_fonte_pagadora_id']), n(pe['versao_plano']), {
            descricao: a.nome.slice(0, 150),
          });
        const versao = await tx.alterar('plano_fonte_pagadora_estabelecimento', a.id, a.versao, {
          ...(a.fim !== undefined ? { vigencia_fim: a.fim } : {}),
          ...(a.ativo !== undefined ? { ativo: a.ativo } : {}),
        });
        return { id: a.id, versao };
      },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta
  async preConferirDesfazer(_c: CtxPrecos, _p: readonly DesfazerReajusteEntrada[]): Promise<void> {
    throw erroNaoLiberada('o desfazer pelo lote aguarda a fonte própria');
  }

  /** Gravação direta (planos) pelo Executor: trilha e idempotência na mesma transação. */
  private async direta<T extends Record<string, number>>(
    c: CtxPrecos,
    nome: string,
    tabelas: readonly string[],
    t: TrilhaPreco,
    fn: (tx: TxOperacao, est: number) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    const op = definirOperacao<{ chave: string }, T>({
      nome,
      tabelas,
      entrada: zChave,
      gravar: (tx) => fn(tx, est),
      alvo: (_e, r) => ({ tabela: tabelas[tabelas.length - 1]!, id: r['id'] ?? null }),
      trilha: () => ({
        dados: {
          evento: t.evento,
          recurso: t.recurso,
          operacao: t.operacao,
          chave: t.chaveNaturalAlvo,
          estacao: t.estacao,
        },
      }),
    });
    // A chave do pedido (Idempotency-Key): o reenvio devolve o mesmo resultado; sem ela, uma chave nova.
    const chave = t.chaveIdempotencia ?? `${nome.slice(0, 30)}:${randomUUID()}`;
    try {
      const r = await this.executor.executar(
        op,
        c.cliente,
        { chave },
        { ...contextoDe(c), chaveIdempotencia: chave },
      );
      return r.resultado as T;
    } catch (e) {
      // As recusas do plano voltam como o erro do plano (a tela as conhece pelo código).
      const codigo = e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : '';
      if (codigo === 'nao-encontrado' || codigo === 'conflito-concorrente' || codigo === 'vigencia-invalida')
        throw new ErroPlano(codigo, String((e as ErroOperacao).problema.detail ?? ''));
      throw e;
    }
  }
}

const COLUNAS_PRESTADOR: [string, string][] = [
  ['convenio', 'Convênio'],
  ['convenioNome', 'Nome do convênio'],
  ['tipo', 'Prestador'],
  ['codigo', 'Código na operadora'],
  ['inicio', 'Vigência: início'],
  ['fim', 'Vigência: fim'],
];

// ── Operações do Executor ───────────────────────────────────────────────────────────────────────────

const zChave = z.object({ chave: z.string() });

/** Situação do convênio no estabelecimento da sessão: suspender ou reativar, com o retrato em fonte_pagadora_versao. */
const OP_SITUACAO = definirOperacao<
  AlterarSituacaoConvenioEntrada,
  { convenio: number; situacaoAntes: string; situacaoDepois: string }
>({
  nome: 'convenio.alterar-situacao',
  tabelas: ['fonte_pagadora_estabelecimento', 'fonte_pagadora_versao'],
  entrada: OPERACOES_PRECO['convenio.alterarSituacao'].entrada as z.ZodType<AlterarSituacaoConvenioEntrada>,
  critica: true,
  async gravar(tx, e) {
    const { f, fe } = await travarNoEstabelecimento(tx, e.convenio);
    if (texto(f['situacao']) === 'inativa')
      throw recusa('convenio-inativo', 'O convênio está inativo na rede: a situação não muda por aqui.');
    const antes = texto(fe['situacao']);
    const depois = e.operacao === 'suspender' ? 'suspensa' : 'ativa';
    if (antes === depois) throw recusa('sem-efeito', `O convênio ${e.convenio} já está nessa situação.`);
    if (antes === 'inativa')
      throw recusa('convenio-inativo', 'O convênio está inativo: a situação não muda por aqui.');
    await tx.alterar('fonte_pagadora_estabelecimento', n(fe['id']), n(fe['versao']), { situacao: depois });
    await retrato(tx, f, { ...fe, situacao: depois }, 'alteracao');
    return {
      convenio: e.convenio,
      situacaoAntes: situacaoDaTela(antes),
      situacaoDepois: situacaoDaTela(depois),
    };
  },
  alvo: (e) => ({ tabela: 'fonte_pagadora', id: e.convenio }),
  trilha: (e) => ({ motivo: e.justificativa }),
});

/** Campos do contrato que o modelo tem, pela comparação com o que a tela leu. */
const OP_CONTRATO = definirOperacao<AlterarContratoConvenioEntrada, { convenio: number; campos: number }>({
  nome: 'convenio.alterar-contrato',
  tabelas: ['fonte_pagadora', 'fonte_pagadora_estabelecimento', 'fonte_pagadora_versao'],
  entrada: OPERACOES_PRECO['convenio.alterarContrato'].entrada as z.ZodType<AlterarContratoConvenioEntrada>,
  critica: true,
  async gravar(tx, e) {
    const campos = Object.keys(e.valores).sort();
    const semColuna = campos.filter((k) => !COLUNA_FONTE[k]);
    if (semColuna.length) throw modeloPendente(`Os campos ${semColuna.join(', ')} do contrato`);
    const { f, fe } = await travarNoEstabelecimento(tx, e.convenio);
    // As siglas das UFs gravadas (a tela compara e grava pela sigla).
    const siglas = new Map<number, string>();
    for (const k of campos.filter((x) => CAMPOS_UF.has(x))) {
      const idUf = nn(f[COLUNA_FONTE[k]!]);
      if (idUf === null) continue;
      const u = await tx.uma<{ sigla: unknown }>('SELECT sigla FROM unidade_federativa WHERE id = ?', [idUf]);
      if (u) siglas.set(idUf, texto(u.sigla));
    }
    const atual = (k: string) => {
      if (CAMPOS_UF.has(k)) {
        const idUf = nn(f[COLUNA_FONTE[k]!]);
        return idUf === null ? null : (siglas.get(idUf) ?? null);
      }
      // O retorno é o da unidade; nulo usa o da fonte pagadora.
      const v = k === 'retornoDias' ? (fe['dias_retorno'] ?? f['dias_retorno']) : f[COLUNA_FONTE[k]!];
      if (k === 'validaCarteira') return verdadeiro(v) ? 'T' : 'F';
      return v === null || v === undefined ? null : typeof v === 'number' ? v : String(v);
    };
    const mudaram = campos.filter((k) => !mesmoValor(k, atual(k), e.lidos[k]));
    if (mudaram.length) throw erroConflitoVersao(mudaram);
    if (campos.every((k) => mesmoValor(k, atual(k), e.valores[k])))
      throw recusa('sem-efeito', 'Nenhum campo muda de valor.');
    const valores: Record<string, unknown> = {};
    const daUnidade: Record<string, unknown> = {};
    for (const k of campos) {
      const v = valorParaGravar(k, e.valores[k] ?? null);
      const gravar =
        k === 'validaCarteira'
          ? v === 'T'
          : k === 'retornoDias' || k === 'prazoPagamentoDias' || k === 'classificacao'
            ? v === ''
              ? null
              : Number(v)
            : v === ''
              ? null
              : v;
      if (k === 'retornoDias') daUnidade['dias_retorno'] = gravar;
      else if (CAMPOS_UF.has(k))
        valores[COLUNA_FONTE[k]!] = gravar === null ? null : await idDaUf(tx, String(gravar), k);
      else valores[COLUNA_FONTE[k]!] = gravar;
    }
    if (Object.keys(valores).length) await tx.alterar('fonte_pagadora', e.convenio, n(f['versao']), valores);
    if (Object.keys(daUnidade).length)
      await tx.alterar('fonte_pagadora_estabelecimento', n(fe['id']), n(fe['versao']), daUnidade);
    if (campos.includes('nome') || campos.includes('classificacao'))
      await retrato(tx, { ...f, ...valores }, { ...fe, ...daUnidade }, 'alteracao');
    return { convenio: e.convenio, campos: campos.length };
  },
  alvo: (e) => ({ tabela: 'fonte_pagadora', id: e.convenio }),
  trilha: (e) => ({ motivo: e.justificativa, dados: { campos: Object.keys(e.valores).sort() } }),
});

/** A unidade federativa ativa pela sigla (recusa a sigla desconhecida). */
async function idDaUf(tx: TxOperacao, sigla: string, campo: string): Promise<number> {
  const u = await tx.uma<{ id: unknown }>(
    'SELECT id FROM unidade_federativa WHERE sigla = ? AND ativo = TRUE',
    [sigla.trim().toUpperCase()],
  );
  if (!u) throw recusa('uf-invalida', `A UF ${sigla} não está no cadastro.`, { campos: [campo] });
  return n(u.id);
}

async function travarFonte(tx: TxOperacao, id: number): Promise<Linha> {
  const [f] = await tx.consultarParaAtualizar<Linha>(
    'SELECT * FROM fonte_pagadora WHERE id = ? AND excluido_em IS NULL',
    [id],
  );
  if (!f)
    throw new ErroOperacao(404, 'registro-inexistente', 'Registro não encontrado', 'O convênio não existe.');
  return f;
}

/** A fonte pagadora e a linha do estabelecimento da sessão, travadas (o convênio precisa estar credenciado nele). */
async function travarNoEstabelecimento(tx: TxOperacao, id: number): Promise<{ f: Linha; fe: Linha }> {
  const f = await travarFonte(tx, id);
  const [fe] = await tx.consultarParaAtualizar<Linha>(
    `SELECT * FROM fonte_pagadora_estabelecimento
      WHERE fonte_pagadora_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, tx.contexto.estabelecimento],
  );
  if (!fe)
    throw new ErroOperacao(
      404,
      'registro-inexistente',
      'Registro não encontrado',
      'O convênio não está credenciado neste estabelecimento.',
    );
  return { f, fe };
}

/** JSON do registro: data em ISO, inteiro grande como número. */
const jsonDoRegistro = (v: unknown) =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? Number(x) : Buffer.isBuffer(x) ? null : x));

/** Retrato completo do registro depois da operação: a fonte pagadora e a linha do estabelecimento. */
async function retrato(
  tx: TxOperacao,
  f: Linha,
  fe: Linha,
  operacao: 'inclusao' | 'alteracao',
): Promise<void> {
  await tx.incluir('fonte_pagadora_versao', {
    fonte_pagadora_id: n(f['id']),
    operacao,
    ocorrido_em: new Date(),
    usuario_id: tx.contexto.usuario,
    nome: texto(f['nome']),
    classe_fonte_pagadora_id: nn(f['classe_fonte_pagadora_id']),
    dados: jsonDoRegistro({ ...f, estabelecimento: fe }),
  });
}

const modeloPendente = (o: string) =>
  new ErroOperacao(
    409,
    'modelo-pendente',
    'Recurso aguardando o modelo do banco',
    `${o} aguarda a coluna ou tabela no modelo do banco (pedido registrado): nada foi gravado.`,
  );

async function fusoDe(l: Leitor, est: number): Promise<string> {
  const r = await l.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est],
  );
  return r?.fuso_horario || FUSO_PADRAO;
}

function localDe(v: unknown, fuso: string): string {
  if (v === null || v === undefined) return '';
  const d = v instanceof Date ? v : new Date(String(v));
  const c = civil(d, fuso);
  return `${c.data} ${c.hora}`;
}

function contextoDe(c: CtxPrecos): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: (c.correlacao || c.traceId || 'precos').slice(0, 64),
  };
}
