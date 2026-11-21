// Porta PRÓPRIA dos custos hospitalares (M54, F2.2): o banco do cliente pelo @sgh/nucleo. Leituras em transação
// somente leitura, sempre no estabelecimento da sessão e sem os registros excluídos; as gravações (classificar o
// centro, lançar a estatística) pelo Executor, com a trilha, o outbox e a idempotência na mesma transação e a trava
// otimista pela versão do centro (`alterarAuditado`).
// Tabelas: centro_custo (com a classificação do custeio: classe, ordem do rateio, critério e unidade de mensuração),
// classificacao_centro_custo, tipo_dado_estatistico (o catálogo das estatísticas, pelo código), unidade_mensuracao_custo,
// grupo_exportacao_custo, estatistica_centro_mes e fonte_pagadora (só o nome, da rede inteira).
// Melhoria: a classificação mora no próprio centro de custo (sem tabela espelho); o critério do rateio é a chave
// estrangeira do tipo de dado estatístico, conferida pelo banco. A versão da classificação é a VERSÃO DO CENTRO: uma
// alteração do cadastro do centro também faz a classificação aberta antes responder "desatualizado". A observação da
// classificação vai só à trilha (motivo), nunca à observação do cadastro do centro (pedido de DDL no 02-03.json).
// Melhoria: o lançamento manual da estatística substitui só o lançamento MANUAL anterior do mesmo centro ×
// estatística × competência; a coletada (automática ou importação) fica, e a manual prevalece no custeio (a mesma
// regra da porta de memória e do serviço). Linha já consumida por uma apuração (apuracao_custo_id) não é alterada.
// A observação do lançamento vai à trilha (motivo).
// Pendências do modelo (pedidos ao integrador, docs/obra/fatias/f22/saida/02-03.json): a coleta automática (registro
// da coleta e o centro de custo dos movimentos de censo, internação, cirurgia, exame, requisição e pessoal), as fontes
// do custeio do mês e a apuração com as linhas por centro e o custo por conta não têm lugar no modelo: a coleta, as
// fontes e a gravação da apuração respondem "modelo-pendente"; as leituras da apuração devolvem vazio, sem contorno.
import { randomUUID } from 'node:crypto';
import { definicaoEstatistica, ESTATISTICAS_CUSTO, TIPOS_DADO_ESTATISTICA } from '@sgh/contratos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { PortaCustos } from './porta.js';
import type {
  CentroCustoCadastrado,
  ClassificacaoParaGravar,
  CodigosExportacao,
  ContextoCustos,
  DominiosCustos,
  EstatisticaRegistrada,
  LancamentoEstatisticaParaGravar,
  TrilhaCustos,
} from './tipos.js';

/** O mínimo do núcleo que a porta usa (os testes trocam). */
export type NucleoCustos = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

const TETO_CENTROS = 2_000;
const TETO_ESTATISTICAS = 20_000;
const TETO_DOMINIO = 1_000;

type Linha = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const numOuNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const txtOuNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const bool = (v: unknown) => v === true || v === 1 || v === '1';
const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
const instanteIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 19) : v ? String(v).replace(' ', 'T').slice(0, 19) : null;
const marcas = (k: number) => Array.from({ length: k }, () => '?').join(', ');

/** Código da estatística do catálogo (camelCase da tela) ↔ tipo_dado_estatistico.codigo (snake_case no banco). */
export const codigoEstatisticaNoBanco = (codigo: string) => codigo.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
export const codigoEstatisticaDaTela = (codigo: string) => codigo.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
/** "AAAA-MM" ↔ DATE do primeiro dia do mês. */
const diaDaCompetencia = (competencia: string) => `${competencia}-01`;

/** As estatísticas de referência (tipo 2): valem para as competências seguintes enquanto não há outra. */
const CODIGOS_REFERENCIA = ESTATISTICAS_CUSTO.filter((e) => e.tipoDado === TIPOS_DADO_ESTATISTICA.referencia).map(
  (e) => codigoEstatisticaNoBanco(e.codigo),
);

export function modeloPendenteCustos(recurso: string): never {
  throw new ErroOperacao(
    501,
    'modelo-pendente',
    'Recurso aguarda o modelo',
    `${recurso} ainda não tem lugar no banco do produto: nada foi lido nem gravado até a migração do modelo.`,
  );
}

const desatualizado = () =>
  recusa(
    'desatualizado',
    'O centro de custo mudou depois que você abriu (outra pessoa classificou). Abra de novo para ver a versão atual.',
  );

const SQL_CENTRO = `SELECT cc.id, cc.codigo, cc.nome, cc.sigla, cc.ativo, cc.vigencia_fim, cc.ordem_rateio,
    cc.unidade_mensuracao_custo_id, cc.observacao, cc.versao, cc.criado_em, cc.alterado_em,
    cc.classificacao_centro_custo_id, cl.classe, td.codigo AS criterio, COALESCE(ua.login, uc.login) AS por_login
  FROM centro_custo cc
  LEFT JOIN classificacao_centro_custo cl ON cl.id = cc.classificacao_centro_custo_id
  LEFT JOIN tipo_dado_estatistico td ON td.id = cc.criterio_tipo_dado_estatistico_id
  LEFT JOIN usuario uc ON uc.id = cc.criado_por
  LEFT JOIN usuario ua ON ua.id = cc.alterado_por
 WHERE cc.estabelecimento_id = ? AND cc.excluido_em IS NULL`;

function centroDe(x: Linha, hoje: string): CentroCustoCadastrado {
  const codigo = txt(x['codigo']);
  const fim = dataIso(x['vigencia_fim']);
  return {
    id: num(x['id']),
    // O código do centro é texto no cadastro; a tela usa o número quando ele é só dígitos (senão, o id).
    codigo: /^\d{1,15}$/.test(codigo) ? Number(codigo) : num(x['id']),
    nome: txt(x['nome']),
    sigla: txtOuNull(x['sigla']),
    ativo: bool(x['ativo']) && (fim === null || fim >= hoje),
    produtivoCadastro: null,
    classificacao:
      x['classificacao_centro_custo_id'] === null || x['classificacao_centro_custo_id'] === undefined
        ? null
        : {
            classe: txt(x['classe']),
            ordemRateio: numOuNull(x['ordem_rateio']),
            criterio: x['criterio'] ? codigoEstatisticaDaTela(txt(x['criterio'])) : null,
            unidadeMensuracao: numOuNull(x['unidade_mensuracao_custo_id']),
            // A observação da classificação fica na trilha; a do cadastro do centro não é dela.
            observacao: null,
            versao: num(x['versao']),
            alteradoPor: txt(x['por_login']),
            alteradoEm: instanteIso(x['alterado_em'] ?? x['criado_em']) ?? '',
          },
  };
}

const SQL_ESTATISTICA = `SELECT s.id, s.competencia, s.centro_custo_id, s.quantidade, s.forma_coleta, s.criado_em, s.alterado_em,
    td.codigo, COALESCE(ua.login, uc.login) AS por_login
  FROM estatistica_centro_mes s
  JOIN centro_custo cc ON cc.id = s.centro_custo_id
  JOIN tipo_dado_estatistico td ON td.id = s.tipo_dado_estatistico_id
  LEFT JOIN usuario uc ON uc.id = s.criado_por
  LEFT JOIN usuario ua ON ua.id = s.alterado_por
 WHERE cc.estabelecimento_id = ? AND s.excluido_em IS NULL AND s.destino_setor_funcional_id IS NULL
   AND s.item_faturavel_id IS NULL`;

function estatisticaDe(x: Linha): EstatisticaRegistrada {
  const codigo = codigoEstatisticaDaTela(txt(x['codigo']));
  const def = definicaoEstatistica(codigo);
  const manual = txt(x['forma_coleta']) === 'manual';
  return {
    id: num(x['id']),
    competencia: (dataIso(x['competencia']) ?? '').slice(0, 7),
    centro: num(x['centro_custo_id']),
    codigo,
    cent: Math.round(num(x['quantidade']) * 100),
    origem: manual ? 'manual' : 'coletada',
    fonte: manual ? 'manual' : (def?.fonte ?? 'manual'),
    estimada: false,
    tipoDado: def?.tipoDado === TIPOS_DADO_ESTATISTICA.referencia ? 2 : 1,
    idColeta: null,
    observacao: null,
    registradoPor: txt(x['por_login']),
    registradoEm: instanteIso(x['alterado_em'] ?? x['criado_em']) ?? '',
  };
}

function hojeNoFuso(fuso: string | null): string {
  const f = (z: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(),
    );
  try {
    return f(fuso || 'America/Sao_Paulo');
  } catch {
    return f('America/Sao_Paulo');
  }
}

async function hojeDoEstabelecimento(l: Leitor, est: number): Promise<string> {
  return hojeNoFuso(txtOuNull((await l.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]))?.['fuso_horario']));
}

async function lerCentro(l: Leitor, est: number, id: number): Promise<CentroCustoCadastrado | null> {
  const x = await l.uma(`${SQL_CENTRO} AND cc.id = ?`, [est, id]);
  return x ? centroDe(x, await hojeDoEstabelecimento(l, est)) : null;
}

async function idCadastro(l: Leitor, sql: string, p: unknown[], oque: string): Promise<number> {
  const r = await l.uma(sql, p);
  if (!r)
    throw new ErroOperacao(
      503,
      'cadastro-incompleto',
      'Cadastro básico incompleto',
      `${oque} não está no cadastro deste cliente: confira a carga dos domínios de custos.`,
    );
  return num(r['id']);
}

const idTipoEstatistica = (l: Leitor, codigo: string) =>
  idCadastro(
    l,
    'SELECT id FROM tipo_dado_estatistico WHERE codigo = ? AND ativo',
    [codigoEstatisticaNoBanco(codigo)],
    `A estatística "${codigo}"`,
  );

/** Mesma classificação lida e pedida (gravar o mesmo não grava). */
function mesmaClassificacao(a: CentroCustoCadastrado['classificacao'], x: ClassificacaoParaGravar): boolean {
  return (
    a !== null &&
    a.classe === x.classe &&
    a.ordemRateio === x.ordemRateio &&
    a.criterio === x.criterio &&
    a.unidadeMensuracao === x.unidadeMensuracao &&
    // A observação não é relida (fica na trilha): uma observação nova é gravada como mudança.
    (x.observacao === null || x.observacao === '')
  );
}

export class PortaCustosPropria implements PortaCustos {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoCustos,
    /** Código do cliente (o banco cliente_<codigo>), da configuração da API (CLIENTE_PADRAO). */
    private readonly cliente: string,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private contexto(c: ContextoCustos, est: number | null): ContextoNucleo {
    return {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: c.usuario ?? null,
      correlacao: (c.correlacao || 'custos').slice(0, 64),
    };
  }

  /** O estabelecimento da sessão (pelo id; sem o mapa, pelo código). Sem ele, nada é lido nem gravado. */
  private async estabelecimento(c: ContextoCustos): Promise<number> {
    if (c.estabelecimento) return c.estabelecimento;
    const r = await this.nucleo.lerSomente(this.contexto(c, null), (l) =>
      l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [c.hospital]),
    );
    if (!r) throw recusa('sem-estabelecimento', 'O estabelecimento da sessão não está no banco do cliente.');
    return num(r['id']);
  }

  private async ler<T>(c: ContextoCustos, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = await this.estabelecimento(c);
    return this.nucleo.lerSomente(this.contexto(c, est), (l) => fn(l, est));
  }

  /** Uma gravação pelo Executor: a operação declara as tabelas; trilha e idempotência na mesma transação. */
  private async gravar<T>(
    c: ContextoCustos,
    nome: string,
    tabelas: readonly string[],
    trilha: TrilhaCustos,
    fn: (tx: TxOperacao, est: number) => Promise<{ valor: T; id: number | null; motivo?: string | null }>,
  ): Promise<T> {
    const est = await this.estabelecimento(c);
    let saida: { valor: T; id: number | null; motivo?: string | null } | null = null;
    const op = definirOperacao({
      nome,
      tabelas,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = await fn(tx, est);
        return { id: saida.id } as ResultadoOperacao;
      },
      alvo: () => ({ tabela: trilha.entidade, id: saida?.id ?? trilha.entidadeId ?? null }),
      trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: saida?.motivo ?? trilha.motivo ?? null }),
    });
    // Cada chamada é uma execução nova do Executor. As gravações dos custos já são idempotentes pelo efeito: a
    // classificação repetida não muda nada (mesmaClassificacao) e o lançamento repetido substitui o manual pelo mesmo
    // valor (uma linha manual só).
    const chave = `custos:${randomUUID()}`;
    const ctx: ContextoOperacao = { ...this.contexto(c, est), chaveIdempotencia: chave };
    await this.executor.executar(op, this.cliente, { chave }, ctx);
    if (!saida) throw new Error('Gravação dos custos sem resultado.');
    return (saida as { valor: T }).valor;
  }

  // ── Estrutura e estatísticas ──

  centros(c: ContextoCustos): Promise<CentroCustoCadastrado[]> {
    return this.ler(c, async (l, est) => {
      const hoje = await hojeDoEstabelecimento(l, est);
      const ls = await l.consultar(`${SQL_CENTRO} ORDER BY cc.codigo, cc.id LIMIT ${TETO_CENTROS}`, [est], {
        teto: TETO_CENTROS,
      });
      return ls.map((x) => centroDe(x, hoje));
    });
  }

  centro(c: ContextoCustos, id: number): Promise<CentroCustoCadastrado | null> {
    return this.ler(c, (l, est) => lerCentro(l, est, id));
  }

  dominios(c: ContextoCustos): Promise<DominiosCustos> {
    // Unidades de mensuração e grupos de exportação são cadastros do cliente inteiro (sem estabelecimento).
    return this.ler(c, async (l) => {
      const unidades = await l.consultar(
        'SELECT id, descricao FROM unidade_mensuracao_custo WHERE ativo ORDER BY codigo, id',
        [],
        { teto: TETO_DOMINIO },
      );
      const grupos = await l.consultar('SELECT id, nome, ativo FROM grupo_exportacao_custo ORDER BY ordem_exibicao, id', [], {
        teto: TETO_DOMINIO,
      });
      return {
        tiposDado: [
          { id: TIPOS_DADO_ESTATISTICA.lancamento, nome: 'Lançamento do mês' },
          { id: TIPOS_DADO_ESTATISTICA.referencia, nome: 'Referência (vale até a próxima)' },
        ],
        unidades: unidades.map((x) => ({ codigo: num(x['id']), nome: txt(x['descricao']) })),
        gruposExportacao: grupos.map((x) => ({ id: num(x['id']), nome: txt(x['nome']), ativo: bool(x['ativo']) })),
      };
    });
  }

  async fontes(): Promise<never> {
    return modeloPendenteCustos('A coleta automática das estatísticas (o centro de custo dos movimentos)');
  }

  estatisticas(c: ContextoCustos, competencia: string) {
    return this.ler(c, async (l, est) => {
      const dia = diaDaCompetencia(competencia);
      const ls = await l.consultar(
        `${SQL_ESTATISTICA} AND (s.competencia = ?${
          CODIGOS_REFERENCIA.length ? ` OR (s.competencia < ? AND td.codigo IN (${marcas(CODIGOS_REFERENCIA.length)}))` : ''
        }) ORDER BY s.competencia DESC, s.id DESC LIMIT ${TETO_ESTATISTICAS + 1}`,
        [est, dia, ...(CODIGOS_REFERENCIA.length ? [dia, ...CODIGOS_REFERENCIA] : [])],
        { teto: TETO_ESTATISTICAS + 1 },
      );
      return {
        registros: ls.slice(0, TETO_ESTATISTICAS).map(estatisticaDe),
        truncado: ls.length > TETO_ESTATISTICAS,
      };
    });
  }

  async ultimaColeta(): Promise<null> {
    // Pendência do modelo: a coleta não tem registro próprio (pedido de DDL); sem coleta gravada, nada a mostrar.
    return null;
  }

  async classificar(c: ContextoCustos, x: ClassificacaoParaGravar, _por: string, trilha: TrilhaCustos) {
    const antes = await this.centro(c, x.centro);
    if (!antes) return null;
    const a = antes.classificacao;
    if (x.versao === null ? a !== null : a === null || a.versao !== x.versao) throw desatualizado();
    if (mesmaClassificacao(a, x)) return { antes, depois: antes, mudou: false };
    return this.gravar(c, 'custos.classificar-centro', ['centro_custo'], trilha, async (tx, est) => {
      const atual = await tx.consultarParaAtualizar<{ versao: unknown }>(
        'SELECT versao FROM centro_custo WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [x.centro, est],
        { teto: 1 },
      );
      const versao = atual[0] ? num(atual[0].versao) : null;
      if (versao === null) throw desatualizado();
      if (x.versao !== null && versao !== x.versao) throw desatualizado();
      const valores = {
        classificacao_centro_custo_id: await idCadastro(
          tx,
          'SELECT id FROM classificacao_centro_custo WHERE classe = ? AND ativo ORDER BY ordem, id LIMIT 1',
          [x.classe],
          `A classe "${x.classe}" do custeio`,
        ),
        ordem_rateio: x.ordemRateio,
        criterio_tipo_dado_estatistico_id: x.criterio ? await idTipoEstatistica(tx, x.criterio) : null,
        unidade_mensuracao_custo_id: x.unidadeMensuracao,
      };
      await tx.alterar('centro_custo', x.centro, versao, valores);
      const depois = await lerCentro(tx, est, x.centro);
      if (!depois?.classificacao) throw new Error('A classificação gravada não foi relida.');
      return { valor: { antes, depois, mudou: true }, id: x.centro, motivo: x.observacao || null };
    });
  }

  async gravarColeta(): Promise<never> {
    return modeloPendenteCustos('O registro da coleta automática das estatísticas');
  }

  lancar(c: ContextoCustos, x: LancamentoEstatisticaParaGravar, _por: string, trilha: TrilhaCustos) {
    return this.gravar(c, 'custos.lancar-estatistica', ['estatistica_centro_mes'], trilha, async (tx, est) => {
      const centro = await tx.uma('SELECT id FROM centro_custo WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL', [
        x.centro,
        est,
      ]);
      if (!centro) throw recusa('centro-inexistente', 'O centro de custo não existe neste estabelecimento.');
      const tipo = await idTipoEstatistica(tx, x.codigo);
      const dia = diaDaCompetencia(x.competencia);
      const quantidade = (Math.round(x.cent) / 100).toFixed(2);
      // Só o lançamento manual anterior é substituído; a coletada (automática ou importação) fica.
      const [anterior] = await tx.consultarParaAtualizar<{ id: unknown; versao: unknown; apuracao_custo_id: unknown }>(
        `SELECT id, versao, apuracao_custo_id FROM estatistica_centro_mes
          WHERE centro_custo_id = ? AND tipo_dado_estatistico_id = ? AND competencia = ? AND forma_coleta = 'manual'
            AND destino_setor_funcional_id IS NULL AND item_faturavel_id IS NULL AND excluido_em IS NULL`,
        [x.centro, tipo, dia],
        { teto: 1 },
      );
      if (anterior && anterior.apuracao_custo_id !== null && anterior.apuracao_custo_id !== undefined)
        throw recusa(
          'estatistica-apurada',
          'Esta estatística já entrou numa apuração de custos: refaça a apuração da competência antes de alterá-la.',
        );
      let id: number;
      if (anterior) {
        id = num(anterior.id);
        await tx.alterar('estatistica_centro_mes', id, num(anterior.versao), { quantidade });
      } else
        id = await tx.incluir('estatistica_centro_mes', {
          centro_custo_id: x.centro,
          tipo_dado_estatistico_id: tipo,
          competencia: dia,
          quantidade,
          forma_coleta: 'manual',
        });
      const lida = await tx.uma(`${SQL_ESTATISTICA} AND s.id = ?`, [est, id]);
      if (!lida) throw new Error('O lançamento gravado não foi relido.');
      return {
        valor: { registro: estatisticaDe(lida), substituidas: anterior ? 1 : 0 },
        id,
        motivo: x.observacao,
      };
    });
  }

  // ── Apuração ──

  async fontesCusteio(): Promise<never> {
    return modeloPendenteCustos('As fontes do custeio do mês (materiais, despesas, pessoal e contas por centro)');
  }

  codigosExportacao(c: ContextoCustos): Promise<CodigosExportacao> {
    return this.ler(c, async (l, est) => {
      const cs = await l.consultar(
        'SELECT id, codigo_externo, unidade_mensuracao_custo_id FROM centro_custo WHERE estabelecimento_id = ? AND excluido_em IS NULL',
        [est],
        { teto: TETO_CENTROS },
      );
      const us = await l.consultar('SELECT id, codigo_programa_nacional FROM unidade_mensuracao_custo', [], {
        teto: TETO_DOMINIO,
      });
      return {
        centros: cs.map((x) => ({
          id: num(x['id']),
          codigoApurasus: txtOuNull(x['codigo_externo']),
          unidade: numOuNull(x['unidade_mensuracao_custo_id']),
        })),
        unidades: us.map((x) => ({ codigo: num(x['id']), codigoApurasus: txtOuNull(x['codigo_programa_nacional']) })),
      };
    });
  }

  nomesConvenios(c: ContextoCustos, codigos: readonly number[]): Promise<Map<number, string>> {
    const ids = [...new Set(codigos)].filter((x) => Number.isSafeInteger(x) && x > 0);
    if (ids.length === 0) return Promise.resolve(new Map());
    // Fonte pagadora: cadastro da rede inteira (sem estabelecimento).
    return this.ler(c, async (l) => {
      const r = new Map<number, string>();
      for (let i = 0; i < ids.length; i += 200) {
        const parte = ids.slice(i, i + 200);
        const ls = await l.consultar(
          `SELECT id, nome FROM fonte_pagadora WHERE id IN (${marcas(parte.length)}) AND excluido_em IS NULL`,
          parte,
          { teto: parte.length },
        );
        for (const x of ls) r.set(num(x['id']), txt(x['nome']));
      }
      return r;
    });
  }

  async apuracoes(): Promise<[]> {
    return [];
  }

  async apuracao(): Promise<null> {
    return null;
  }

  async linhasApuracao(): Promise<[]> {
    return [];
  }

  async contasApuracao(): Promise<{ total: number; contas: [] }> {
    return { total: 0, contas: [] };
  }

  async resultadoAgrupado(): Promise<[]> {
    return [];
  }

  async gravarApuracao(): Promise<never> {
    return modeloPendenteCustos('A apuração do custo do mês (linhas por centro e custo por conta)');
  }

  async aprovarApuracao(): Promise<never> {
    return modeloPendenteCustos('A aprovação da apuração do custo do mês');
  }
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (falha fechada). */
export function portaCustosIndisponivel(): PortaCustos {
  const recusar = (): Promise<never> =>
    Promise.reject(
      new ErroOperacao(
        503,
        'indisponivel',
        'Banco do estabelecimento indisponível',
        'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
      ),
    );
  return new Proxy({} as PortaCustos, {
    get: (_t, chave) => {
      if (chave === 'destino') return 'indisponivel';
      if (typeof chave !== 'string' || chave === 'then' || chave.startsWith('on')) return undefined;
      return recusar;
    },
  });
}
