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
// Coleta: as fontes agregadas no banco por centro de custo do movimento (censo, ocupação dos leitos, atos cirúrgicos,
// exames das contas, requisições ao estoque, vínculos e leitos), gravadas em coleta_estatistica_custo e
// estatistica_centro_mes. Apuração: apuracao_custo (versão, situação e substituição), apuracao_custo_centro (linha por
// centro) e custo_conta_paciente (custo por conta), com as fontes do custeio lidas do estoque, do financeiro, da folha e
// das contas fechadas da competência.
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
import {
  type ApuracaoCustosRegistrada,
  type ApuracaoParaGravar,
  type CentroCustoCadastrado,
  type ClassificacaoParaGravar,
  type CodigosExportacao,
  type ColetaParaGravar,
  type ColetaRegistrada,
  type ContextoCustos,
  type CustoContaApuracao,
  type DominiosCustos,
  type EstatisticaRegistrada,
  type FiltroContasCusto,
  type FontesCusteio,
  type FontesEstatistica,
  type GrupoCusteio,
  type GrupoFonteEstatistica,
  type GrupoResultadoApurado,
  type LancamentoEstatisticaParaGravar,
  type LinhaCentroApuracao,
  type PeriodoCusteio,
  TAMANHO_PAGINA_CONTAS,
  type TrilhaCustos,
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
export const codigoEstatisticaNoBanco = (codigo: string) =>
  codigo.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
export const codigoEstatisticaDaTela = (codigo: string) =>
  codigo.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
/** "AAAA-MM" ↔ DATE do primeiro dia do mês. */
const diaDaCompetencia = (competencia: string) => `${competencia}-01`;

/** As estatísticas de referência (tipo 2): valem para as competências seguintes enquanto não há outra. */
const CODIGOS_REFERENCIA = ESTATISTICAS_CUSTO.filter(
  (e) => e.tipoDado === TIPOS_DADO_ESTATISTICA.referencia,
).map((e) => codigoEstatisticaNoBanco(e.codigo));

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

const SQL_ESTATISTICA = `SELECT s.id, s.competencia, s.centro_custo_id, s.quantidade, s.forma_coleta, s.estimada, s.coleta_estatistica_custo_id,
    s.observacao, s.criado_em, s.alterado_em,
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
    estimada: bool(x['estimada']),
    tipoDado: def?.tipoDado === TIPOS_DADO_ESTATISTICA.referencia ? 2 : 1,
    idColeta: numOuNull(x['coleta_estatistica_custo_id']),
    observacao: txtOuNull(x['observacao']),
    registradoPor: txt(x['por_login']),
    registradoEm: instanteIso(x['alterado_em'] ?? x['criado_em']) ?? '',
  };
}

const TETO_GRUPOS = 20_000;
const TETO_ITENS_CONTA = 100_000;
const TETO_APURACOES = 100;

/** O código do centro como a coleta e a apuração o usam: o código do cadastro quando é só dígitos, senão o id. */
const cdcDe = (id: unknown, codigo: unknown): number | null =>
  id === null || id === undefined ? null : /^\d{1,15}$/.test(txt(codigo)) ? Number(txt(codigo)) : num(id);
/** O número de negócio da conta (texto no cadastro) como número; senão, o id. */
const numeroDe = (numero: unknown, id: unknown): number =>
  /^\d{1,15}$/.test(txt(numero)) ? Number(txt(numero)) : num(id);
/** DECIMAL em reais ↔ centavos inteiros. */
const centavos = (v: unknown): number => Math.round(Number(v ?? 0) * 100);
const reais = (c: number): string => (Math.round(c) / 100).toFixed(2);
/** Centésimos (quantidade, base ou custo unitário) ↔ DECIMAL(15,4). */
const decimalOuNull = (c: number | null): string | null => (c === null ? null : (c / 100).toFixed(4));
const centesimosOuNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Math.round(Number(v) * 10_000) / 100;
const jsonTexto = (v: unknown): string | null =>
  v === null || v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v);

const desatualizadoApuracao = () =>
  recusa(
    'desatualizado',
    'A apuração desta competência mudou depois que você abriu (outra pessoa apurou ou aprovou). Abra de novo para ver a versão atual.',
  );

const SQL_APURACAO = `SELECT a.*, uc.login AS apurada_por, ua.login AS aprovada_por
  FROM apuracao_custo a
  LEFT JOIN usuario uc ON uc.id = a.criado_por
  LEFT JOIN usuario ua ON ua.id = a.aprovador_usuario_id
 WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL`;

function apuracaoDe(x: Linha): ApuracaoCustosRegistrada {
  const substituida =
    x['substituida_por_apuracao_custo_id'] !== null && x['substituida_por_apuracao_custo_id'] !== undefined;
  return {
    id: num(x['id']),
    competencia: (dataIso(x['competencia']) ?? '').slice(0, 7),
    situacao: substituida ? 'substituida' : txt(x['situacao']) === 'fechada' ? 'aprovada' : 'apurada',
    versao: num(x['versao']),
    parcial: txtOuNull(x['rotulo_parcial']) !== null,
    rotuloParcial: txtOuNull(x['rotulo_parcial']),
    limiteLinha: num(x['limite_linha_centavos']),
    custoProdutivos: centavos(x['custo_produtivos']),
    totais: jsonTexto(x['totais']) ?? '{}',
    completude: jsonTexto(x['completude']) ?? '{}',
    pendencias: jsonTexto(x['pendencias']) ?? '[]',
    impressao: txt(x['impressao']),
    justificativa: txtOuNull(x['justificativa']),
    duracaoMs: num(x['duracao_ms']),
    apuradaPor: txt(x['apurada_por']),
    apuradaEm: instanteIso(x['apurado_em'] ?? x['criado_em']) ?? '',
    aprovadaPor: x['aprovado_em'] ? txt(x['aprovada_por']) : null,
    aprovadaEm: instanteIso(x['aprovado_em']),
  };
}

async function lerApuracao(l: Leitor, est: number, id: number): Promise<ApuracaoCustosRegistrada | null> {
  const x = await l.uma(`${SQL_APURACAO} AND a.id = ?`, [est, id]);
  return x ? apuracaoDe(x) : null;
}

/** O custo por conta de uma apuração, com o que a conta diz hoje (número, tipo, procedimento e prontuário). */
const SQL_CONTAS_APURACAO = `SELECT k.conta_hospitalar_id AS conta, ch.numero, tc.codigo AS tipo, k.fonte_pagadora_id AS convenio,
    (SELECT ifa.codigo FROM internacao it JOIN item_faturavel ifa ON ifa.id = it.procedimento_solicitado_item_faturavel_id
      WHERE it.atendimento_id = k.atendimento_id ORDER BY it.id LIMIT 1) AS procedimento,
    p.numero_prontuario AS prontuario, k.valor_receita, k.valor_glosa, k.valor_recurso, k.receita_liquida, k.custo_total,
    (k.receita_liquida - k.custo_total) AS margem, k.parcelas
  FROM custo_conta_paciente k
  JOIN apuracao_custo a ON a.id = k.apuracao_custo_id
  JOIN conta_hospitalar ch ON ch.id = k.conta_hospitalar_id
  LEFT JOIN tipo_conta tc ON tc.id = ch.tipo_conta_id
  LEFT JOIN paciente p ON p.id = ch.paciente_id
 WHERE k.apuracao_custo_id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL AND k.excluido_em IS NULL`;

function hojeNoFuso(fuso: string | null): string {
  const f = (z: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: z,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  try {
    return f(fuso || 'America/Sao_Paulo');
  } catch {
    return f('America/Sao_Paulo');
  }
}

async function hojeDoEstabelecimento(l: Leitor, est: number): Promise<string> {
  return hojeNoFuso(
    txtOuNull(
      (await l.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]))?.['fuso_horario'],
    ),
  );
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
      const grupos = await l.consultar(
        'SELECT id, nome, ativo FROM grupo_exportacao_custo ORDER BY ordem_exibicao, id',
        [],
        {
          teto: TETO_DOMINIO,
        },
      );
      return {
        tiposDado: [
          { id: TIPOS_DADO_ESTATISTICA.lancamento, nome: 'Lançamento do mês' },
          { id: TIPOS_DADO_ESTATISTICA.referencia, nome: 'Referência (vale até a próxima)' },
        ],
        unidades: unidades.map((x) => ({ codigo: num(x['id']), nome: txt(x['descricao']) })),
        gruposExportacao: grupos.map((x) => ({
          id: num(x['id']),
          nome: txt(x['nome']),
          ativo: bool(x['ativo']),
        })),
      };
    });
  }

  /** As fontes da coleta da competência, agregadas no banco por centro de custo do movimento (READ ONLY). */
  fontes(
    c: ContextoCustos,
    intervalo: { readonly inicio: string; readonly fim: string; readonly seguinte: string },
  ): Promise<FontesEstatistica> {
    const { inicio, seguinte } = intervalo;
    return this.ler(c, async (l, est) => {
      const grupos = async (sql: string, p: unknown[]): Promise<GrupoFonteEstatistica[]> =>
        (await l.consultar(`${sql} LIMIT ${TETO_GRUPOS}`, p, { teto: TETO_GRUPOS })).map((x) => ({
          cdc: cdcDe(x['cid'], x['ccod']),
          quantidade: num(x['q']),
        }));
      const censo = await grupos(
        `SELECT cc.id AS cid, cc.codigo AS ccod, SUM(f.pacientes_dia) AS q
           FROM fechamento_censo f
           JOIN unidade_internacao u ON u.id = f.unidade_internacao_id
           LEFT JOIN centro_custo cc ON cc.id = u.centro_custo_id
          WHERE f.estabelecimento_id = ? AND f.situacao = 'fechado' AND f.data_referencia >= ? AND f.data_referencia < ?
          GROUP BY cc.id, cc.codigo`,
        [est, inicio, seguinte],
      );
      const dias = await l.uma(
        `SELECT COUNT(DISTINCT f.data_referencia) AS n FROM fechamento_censo f
          WHERE f.estabelecimento_id = ? AND f.situacao = 'fechado' AND f.data_referencia >= ? AND f.data_referencia < ?`,
        [est, inicio, seguinte],
      );
      // Paciente-dia estimado pela ocupação dos leitos: o dia da entrada conta, o da saída não.
      const internacoes = await grupos(
        `SELECT cc.id AS cid, cc.codigo AS ccod,
                SUM(GREATEST(0, DATEDIFF(LEAST(COALESCE(o.data_hora_fim, ?), ?), GREATEST(o.data_hora_inicio, ?)))) AS q
           FROM ocupacao_leito o
           JOIN leito_hospitalar lh ON lh.id = o.leito_hospitalar_id
           LEFT JOIN unidade_internacao u ON u.id = o.unidade_internacao_id
           LEFT JOIN centro_custo cc ON cc.id = COALESCE(lh.centro_custo_id, u.centro_custo_id)
          WHERE o.estabelecimento_id = ? AND o.excluido_em IS NULL AND o.data_hora_inicio < ?
            AND (o.data_hora_fim IS NULL OR o.data_hora_fim >= ?)
          GROUP BY cc.id, cc.codigo`,
        [seguinte, seguinte, inicio, est, seguinte, inicio],
      );
      // Cirurgias realizadas no mês pelo centro da sala; a duração é a do ato (incisão ao fim), em minutos.
      const cirurgias = (
        await l.consultar(
          `SELECT cc.id AS cid, cc.codigo AS ccod, TIMESTAMPDIFF(MINUTE, a.inicio_cirurgia_em, a.fim_cirurgia_em) AS minutos,
                  COUNT(*) AS n
             FROM ato_cirurgico a
             JOIN sala_cirurgica s ON s.id = a.sala_cirurgica_id
             LEFT JOIN centro_custo cc ON cc.id = s.centro_custo_id
            WHERE a.estabelecimento_id = ? AND a.situacao = 'realizado' AND a.excluido_em IS NULL
              AND a.fim_cirurgia_em >= ? AND a.fim_cirurgia_em < ?
            GROUP BY cc.id, cc.codigo, minutos LIMIT ${TETO_GRUPOS}`,
          [est, inicio, seguinte],
          { teto: TETO_GRUPOS },
        )
      ).map((x) => ({ cdc: cdcDe(x['cid'], x['ccod']), minutos: numOuNull(x['minutos']), n: num(x['n']) }));
      // Exames lançados nas contas do mês (item faturável de um exame do cadastro), pelo centro do item.
      const exames = await grupos(
        `SELECT cc.id AS cid, cc.codigo AS ccod, SUM(chi.quantidade) AS q
           FROM conta_hospitalar_item chi
           JOIN conta_hospitalar ch ON ch.id = chi.conta_hospitalar_id
           LEFT JOIN centro_custo cc ON cc.id = chi.centro_custo_id
          WHERE ch.estabelecimento_id = ? AND ch.situacao <> 'cancelada' AND ch.excluido_em IS NULL
            AND chi.excluido_em IS NULL AND chi.realizado_em >= ? AND chi.realizado_em < ?
            AND EXISTS (SELECT 1 FROM exame e WHERE e.item_faturavel_id = chi.item_faturavel_id)
          GROUP BY cc.id, cc.codigo`,
        [est, inicio, seguinte],
      );
      // Requisições ao estoque com saída no mês, pelo centro da saída.
      const requisicoes = await grupos(
        `SELECT cc.id AS cid, cc.codigo AS ccod, COUNT(DISTINCT ri.requisicao_material_id) AS q
           FROM movimento_estoque m
           JOIN requisicao_material_item ri ON ri.id = m.requisicao_material_item_id
           LEFT JOIN centro_custo cc ON cc.id = m.centro_custo_id
          WHERE m.estabelecimento_id = ? AND m.natureza = 'saida' AND m.ocorrido_em >= ? AND m.ocorrido_em < ?
            AND m.estorno_movimento_estoque_id IS NULL
          GROUP BY cc.id, cc.codigo`,
        [est, inicio, seguinte],
      );
      // Vínculos ativos em algum dia do mês, pela lotação vigente (senão, a do vínculo); horas pela carga mensal.
      const colaboradores = (
        await l.consultar(
          `SELECT x.centro, COUNT(*) AS n, SUM(x.minutos) AS minutos FROM (
             SELECT COALESCE((SELECT lo.centro_custo_id FROM lotacao lo
                               WHERE lo.vinculo_trabalho_id = vt.id AND lo.data_inicio < ?
                                 AND (lo.data_fim IS NULL OR lo.data_fim >= ?)
                               ORDER BY lo.data_inicio DESC, lo.id DESC LIMIT 1), vt.centro_custo_id) AS centro,
                    COALESCE(rj.carga_mensal_minutos, 0) AS minutos
               FROM vinculo_trabalho vt
               LEFT JOIN regime_jornada rj ON rj.id = vt.regime_jornada_id
              WHERE vt.estabelecimento_id = ? AND vt.excluido_em IS NULL AND vt.data_admissao < ?
                AND (vt.data_desligamento IS NULL OR vt.data_desligamento >= ?)
           ) x GROUP BY x.centro LIMIT ${TETO_GRUPOS}`,
          [seguinte, inicio, est, seguinte, inicio],
          { teto: TETO_GRUPOS },
        )
      ).map((x) => ({
        // Sem centro: 0, que nenhum centro tem (a coleta conta como "sem centro").
        centro: x['centro'] === null || x['centro'] === undefined ? 0 : num(x['centro']),
        n: num(x['n']),
        horas: num(x['minutos']) / 60,
      }));
      const leitos = await grupos(
        `SELECT cc.id AS cid, cc.codigo AS ccod, COUNT(*) AS q
           FROM leito_hospitalar lh
           LEFT JOIN unidade_internacao u ON u.id = lh.unidade_internacao_id
           LEFT JOIN centro_custo cc ON cc.id = COALESCE(lh.centro_custo_id, u.centro_custo_id)
          WHERE lh.estabelecimento_id = ? AND lh.ativo AND NOT lh.virtual AND lh.excluido_em IS NULL
          GROUP BY cc.id, cc.codigo`,
        [est],
      );
      return {
        censo: { grupos: censo, diasFechados: num(dias?.['n']) },
        internacoes,
        cirurgias,
        exames,
        requisicoes,
        colaboradores,
        leitos,
      };
    });
  }

  estatisticas(c: ContextoCustos, competencia: string) {
    return this.ler(c, async (l, est) => {
      const dia = diaDaCompetencia(competencia);
      const ls = await l.consultar(
        `${SQL_ESTATISTICA} AND (s.competencia = ?${
          CODIGOS_REFERENCIA.length
            ? ` OR (s.competencia < ? AND td.codigo IN (${marcas(CODIGOS_REFERENCIA.length)}))`
            : ''
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

  async ultimaColeta(c: ContextoCustos, competencia: string): Promise<ColetaRegistrada | null> {
    return this.ler(c, async (l, est) => {
      const x = await l.uma(
        `SELECT k.id, k.competencia, k.resumo, k.linhas, k.duracao_ms, k.coletada_em, u.login
           FROM coleta_estatistica_custo k LEFT JOIN usuario u ON u.id = k.criado_por
          WHERE k.estabelecimento_id = ? AND k.competencia = ? ORDER BY k.coletada_em DESC, k.id DESC LIMIT 1`,
        [est, diaDaCompetencia(competencia)],
      );
      return x
        ? {
            id: num(x['id']),
            competencia: (dataIso(x['competencia']) ?? '').slice(0, 7),
            resumo: jsonTexto(x['resumo']) ?? '{}',
            linhas: num(x['linhas']),
            duracaoMs: num(x['duracao_ms']),
            coletadaPor: txt(x['login']),
            coletadaEm: instanteIso(x['coletada_em']) ?? '',
          }
        : null;
    });
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

  /**
   * Grava a coleta: o registro da coleta e uma linha coletada por centro × estatística. A coletada anterior da mesma
   * chave é excluída (a manual fica e prevalece no custeio); a que já entrou numa apuração recusa a coleta inteira.
   */
  gravarColeta(c: ContextoCustos, x: ColetaParaGravar, _por: string, trilha: TrilhaCustos) {
    return this.gravar(
      c,
      'custos.coletar-estatisticas',
      ['coleta_estatistica_custo', 'estatistica_centro_mes'],
      trilha,
      async (tx, est) => {
        const dia = diaDaCompetencia(x.competencia);
        const centros = new Set(
          (
            await tx.consultar<{ id: unknown }>(
              'SELECT id FROM centro_custo WHERE estabelecimento_id = ? AND excluido_em IS NULL',
              [est],
              { teto: TETO_CENTROS },
            )
          ).map((r) => num(r.id)),
        );
        const id = await tx.incluir('coleta_estatistica_custo', {
          estabelecimento_id: est,
          competencia: dia,
          resumo: x.resumo,
          linhas: x.linhas.length,
          duracao_ms: Math.max(0, Math.round(x.duracaoMs)),
          coletada_em: new Date(),
        });
        const tipos = new Map<string, number>();
        let substituidas = 0;
        for (const linha of x.linhas) {
          if (!centros.has(linha.centro))
            throw recusa(
              'centro-inexistente',
              'O centro de custo da coleta não existe neste estabelecimento.',
            );
          let tipo = tipos.get(linha.codigo);
          if (tipo === undefined) tipos.set(linha.codigo, (tipo = await idTipoEstatistica(tx, linha.codigo)));
          const anteriores = await tx.consultarParaAtualizar<{
            id: unknown;
            versao: unknown;
            apuracao_custo_id: unknown;
          }>(
            `SELECT id, versao, apuracao_custo_id FROM estatistica_centro_mes
              WHERE centro_custo_id = ? AND tipo_dado_estatistico_id = ? AND competencia = ? AND forma_coleta <> 'manual'
                AND destino_setor_funcional_id IS NULL AND item_faturavel_id IS NULL AND excluido_em IS NULL`,
            [linha.centro, tipo, dia],
            { teto: 10 },
          );
          for (const a of anteriores) {
            if (a.apuracao_custo_id !== null && a.apuracao_custo_id !== undefined)
              throw recusa(
                'estatistica-apurada',
                'A competência já tem estatística coletada que entrou numa apuração de custos: refaça a apuração antes de coletar de novo.',
              );
            await tx.excluir('estatistica_centro_mes', num(a.id), num(a.versao));
            substituidas += 1;
          }
          await tx.incluir('estatistica_centro_mes', {
            centro_custo_id: linha.centro,
            tipo_dado_estatistico_id: tipo,
            competencia: dia,
            quantidade: (Math.round(linha.cent) / 100).toFixed(2),
            forma_coleta: 'automatica',
            estimada: linha.estimada,
            coleta_estatistica_custo_id: id,
          });
        }
        return { valor: { id, gravadas: x.linhas.length, substituidas }, id };
      },
    );
  }

  lancar(c: ContextoCustos, x: LancamentoEstatisticaParaGravar, _por: string, trilha: TrilhaCustos) {
    return this.gravar(
      c,
      'custos.lancar-estatistica',
      ['estatistica_centro_mes'],
      trilha,
      async (tx, est) => {
        const centro = await tx.uma(
          'SELECT id FROM centro_custo WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [x.centro, est],
        );
        if (!centro)
          throw recusa('centro-inexistente', 'O centro de custo não existe neste estabelecimento.');
        const tipo = await idTipoEstatistica(tx, x.codigo);
        const dia = diaDaCompetencia(x.competencia);
        const quantidade = (Math.round(x.cent) / 100).toFixed(2);
        // Só o lançamento manual anterior é substituído; a coletada (automática ou importação) fica.
        const [anterior] = await tx.consultarParaAtualizar<{
          id: unknown;
          versao: unknown;
          apuracao_custo_id: unknown;
        }>(
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
      },
    );
  }

  // ── Apuração ──

  /** As fontes do custeio da competência, agregadas no banco por centro de custo (READ ONLY). */
  fontesCusteio(c: ContextoCustos, p: PeriodoCusteio): Promise<FontesCusteio> {
    const inicio = p.inicio;
    const fim = p.fim;
    const limite = (Math.max(0, Math.round(p.limiteLinhaCentavos)) / 100).toFixed(2);
    return this.ler(c, async (l, est) => {
      const grupos = async (sql: string, ps: unknown[]) =>
        (await l.consultar(`${sql} LIMIT ${TETO_GRUPOS}`, ps, { teto: TETO_GRUPOS })).map((x) => ({
          atipica: bool(x['atipica']),
          g: { cdc: cdcDe(x['cid'], x['ccod']), centavos: centavos(x['v']), linhas: num(x['n']) },
        }));
      // Saídas e devoluções do estoque (sem transferência entre locais e sem estorno); acima do limite por linha: atípica.
      const estoque = (natureza: 'saida' | 'entrada') =>
        grupos(
          `SELECT cc.id AS cid, cc.codigo AS ccod, (m.valor_total > ?) AS atipica, SUM(m.valor_total) AS v, COUNT(*) AS n
             FROM movimento_estoque m
             LEFT JOIN centro_custo cc ON cc.id = m.centro_custo_id
            WHERE m.estabelecimento_id = ? AND m.natureza = ? AND m.ocorrido_em >= ? AND m.ocorrido_em < DATE_ADD(?, INTERVAL 1 DAY)
              AND m.contrapartida_local_estoque_id IS NULL AND m.estorno_movimento_estoque_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM movimento_estoque e WHERE e.estorno_movimento_estoque_id = m.id)
              ${natureza === 'entrada' ? 'AND (m.motivo_devolucao_estoque_id IS NOT NULL OR m.devolucao_dispensacao_item_id IS NOT NULL)' : ''}
            GROUP BY cc.id, cc.codigo, atipica`,
          [limite, est, natureza, inicio, fim],
        );
      const saidas = await estoque('saida');
      const devolucoes = await estoque('entrada');
      // Despesas do financeiro (sem as notas de entrada do estoque e sem a folha): pelo rateio, senão pelo título.
      const filtroTitulo = `t.estabelecimento_id = ? AND t.excluido_em IS NULL AND t.situacao <> 'cancelado'
              AND t.modulo_origem NOT IN ('estoque', 'folha') AND t.nota_entrada_id IS NULL
              AND t.data_lancamento >= ? AND t.data_lancamento <= ?`;
      const despesas = await grupos(
        `SELECT cc.id AS cid, cc.codigo AS ccod, 0 AS atipica, SUM(x.v) AS v, COUNT(*) AS n FROM (
           SELECT r.centro_custo_id AS cid, r.valor AS v FROM rateio_lancamento r JOIN titulo_pagar t ON t.id = r.titulo_pagar_id
            WHERE ${filtroTitulo} AND r.excluido_em IS NULL
           UNION ALL
           SELECT t.centro_custo_id, t.valor_bruto FROM titulo_pagar t
            WHERE ${filtroTitulo}
              AND NOT EXISTS (SELECT 1 FROM rateio_lancamento r WHERE r.titulo_pagar_id = t.id AND r.excluido_em IS NULL)
         ) x LEFT JOIN centro_custo cc ON cc.id = x.cid GROUP BY cc.id, cc.codigo`,
        [est, inicio, fim, est, inicio, fim],
      );
      // Proventos da folha da competência pelo centro do item, senão do cálculo, senão do vínculo.
      const pessoal = (
        await l.consultar(
          `SELECT COALESCE(i.centro_custo_id, f.centro_custo_id, vt.centro_custo_id) AS centro, SUM(i.valor) AS v, COUNT(*) AS n
             FROM calculo_folha_item i
             JOIN calculo_folha f ON f.id = i.calculo_folha_id
             JOIN competencia_folha k ON k.id = f.competencia_folha_id
             LEFT JOIN vinculo_trabalho vt ON vt.id = f.vinculo_trabalho_id
            WHERE f.estabelecimento_id = ? AND k.ano = ? AND k.mes = ? AND i.natureza = 'provento'
            GROUP BY centro LIMIT ${TETO_GRUPOS}`,
          [est, p.ano, p.mes],
          { teto: TETO_GRUPOS },
        )
      ).map((x) => ({ centro: numOuNull(x['centro']), centavos: centavos(x['v']), linhas: num(x['n']) }));
      // O que cada conta fechada no mês faturou por centro do item, com a glosa e o recurso acatado do item.
      const filtroConta = `ch.estabelecimento_id = ? AND ch.excluido_em IS NULL
              AND ch.situacao IN ('fechada', 'faturada', 'enviada', 'paga')
              AND ch.fechada_em >= ? AND ch.fechada_em < DATE_ADD(?, INTERVAL 1 DAY)`;
      const itens = await l.consultar(
        `SELECT ch.id AS conta, ch.numero, tc.codigo AS tipo, ch.fonte_pagadora_id AS convenio,
                (SELECT ifa.codigo FROM internacao it JOIN item_faturavel ifa ON ifa.id = it.procedimento_solicitado_item_faturavel_id
                  WHERE it.atendimento_id = ch.atendimento_id ORDER BY it.id LIMIT 1) AS procedimento,
                cc.id AS cid, cc.codigo AS ccod, SUM(chi.valor_total) AS bruta,
                SUM((SELECT COALESCE(SUM(gi.valor_glosado), 0) FROM glosa_item gi WHERE gi.conta_hospitalar_item_id = chi.id)) AS glosa,
                SUM((SELECT COALESCE(SUM(ri.valor_acatado), 0) FROM recurso_glosa_item ri WHERE ri.conta_hospitalar_item_id = chi.id)) AS recurso
           FROM conta_hospitalar ch
           JOIN conta_hospitalar_item chi ON chi.conta_hospitalar_id = ch.id AND chi.excluido_em IS NULL
           LEFT JOIN tipo_conta tc ON tc.id = ch.tipo_conta_id
           LEFT JOIN centro_custo cc ON cc.id = chi.centro_custo_id
          WHERE ${filtroConta}
          GROUP BY ch.id, ch.numero, tc.codigo, ch.fonte_pagadora_id, cc.id, cc.codigo
          ORDER BY ch.id LIMIT ${TETO_ITENS_CONTA + 1}`,
        [est, inicio, fim],
        { teto: TETO_ITENS_CONTA + 1 },
      );
      const contas = await l.uma(`SELECT COUNT(*) AS n FROM conta_hospitalar ch WHERE ${filtroConta}`, [
        est,
        inicio,
        fim,
      ]);
      const de = (atipica: boolean, xs: { atipica: boolean; g: GrupoCusteio }[]) =>
        xs.filter((x) => x.atipica === atipica).map((x) => x.g);
      return {
        materiais: de(false, saidas),
        atipicas: de(true, saidas),
        devolucoes: de(false, devolucoes),
        devolucoesAtipicas: de(true, devolucoes),
        despesas: despesas.map((x) => x.g),
        pessoal,
        itensConta: itens.slice(0, TETO_ITENS_CONTA).map((x) => ({
          conta: num(x['conta']),
          numero: numeroDe(x['numero'], x['conta']),
          tipoConta: txtOuNull(x['tipo']),
          convenio: numOuNull(x['convenio']),
          procedimento: txtOuNull(x['procedimento']),
          cdc: cdcDe(x['cid'], x['ccod']),
          bruta: centavos(x['bruta']),
          glosa: centavos(x['glosa']),
          recurso: centavos(x['recurso']),
        })),
        contasFechadas: num(contas?.['n']),
        truncado: itens.length > TETO_ITENS_CONTA,
      };
    });
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
        unidades: us.map((x) => ({
          codigo: num(x['id']),
          codigoApurasus: txtOuNull(x['codigo_programa_nacional']),
        })),
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

  apuracoes(c: ContextoCustos, competencia: string): Promise<ApuracaoCustosRegistrada[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `${SQL_APURACAO} AND a.competencia = ? ORDER BY a.id DESC LIMIT ${TETO_APURACOES}`,
          [est, diaDaCompetencia(competencia)],
          { teto: TETO_APURACOES },
        )
      ).map(apuracaoDe),
    );
  }

  apuracao(c: ContextoCustos, id: number): Promise<ApuracaoCustosRegistrada | null> {
    return this.ler(c, (l, est) => lerApuracao(l, est, id));
  }

  linhasApuracao(c: ContextoCustos, id: number): Promise<LinhaCentroApuracao[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT x.*, cc.codigo AS ccod, cc.nome AS cnome, td.codigo AS criterio
             FROM apuracao_custo_centro x
             JOIN apuracao_custo a ON a.id = x.apuracao_custo_id
             JOIN centro_custo cc ON cc.id = x.centro_custo_id
             LEFT JOIN tipo_dado_estatistico td ON td.id = x.criterio_tipo_dado_estatistico_id
            WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL
            ORDER BY x.id LIMIT ${TETO_CENTROS}`,
          [id, est],
          { teto: TETO_CENTROS },
        )
      ).map((x): LinhaCentroApuracao => ({
        centro: num(x['centro_custo_id']),
        codigo: cdcDe(x['centro_custo_id'], x['ccod']) ?? 0,
        nome: txt(x['cnome']),
        classe: txt(x['classe']),
        ordemRateio: numOuNull(x['ordem_rateio']),
        criterio: x['criterio'] ? codigoEstatisticaDaTela(txt(x['criterio'])) : null,
        pessoal: centavos(x['custo_pessoal']),
        materiais: centavos(x['custo_materiais']),
        despesas: centavos(x['custo_despesas']),
        despesasGerais: centavos(x['custo_despesas_gerais']),
        diretoTotal: centavos(x['custo_direto']),
        recebidoTotal: centavos(x['custo_recebido']),
        recebidos: jsonTexto(x['recebidos']) ?? '[]',
        repassado: centavos(x['custo_repassado']),
        naoRateado: centavos(x['custo_nao_rateado']),
        custoFinal: centavos(x['custo_final']),
        baseCriterioCent: centesimosOuNull(x['base_criterio']),
        producaoCodigo: txtOuNull(x['producao_codigo']),
        producaoCent: centesimosOuNull(x['producao_quantidade']),
        custoUnitario: centesimosOuNull(x['custo_unitario']),
        receita: centavos(x['valor_receita']),
      })),
    );
  }

  contasApuracao(
    c: ContextoCustos,
    id: number,
    f: FiltroContasCusto,
  ): Promise<{ total: number; contas: CustoContaApuracao[] }> {
    return this.ler(c, async (l, est) => {
      const cond: string[] = [];
      const ps: unknown[] = [id, est];
      if (f.convenio !== undefined) {
        cond.push('x.convenio = ?');
        ps.push(f.convenio);
      }
      if (f.procedimento !== undefined) {
        cond.push('x.procedimento = ?');
        ps.push(f.procedimento);
      }
      if (f.numero !== undefined) {
        cond.push('x.numero = ?');
        ps.push(String(f.numero));
      }
      if (f.prontuario !== undefined) {
        cond.push('x.prontuario = ?');
        ps.push(f.prontuario);
      }
      if (f.negativas) cond.push('x.margem < 0');
      const onde = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
      const total = await l.uma(`SELECT COUNT(*) AS n FROM (${SQL_CONTAS_APURACAO}) x ${onde}`, ps);
      const pagina = Math.max(1, f.pagina);
      const ls = await l.consultar(
        `SELECT x.* FROM (${SQL_CONTAS_APURACAO}) x ${onde} ORDER BY x.margem, x.conta
          LIMIT ${TAMANHO_PAGINA_CONTAS} OFFSET ${(pagina - 1) * TAMANHO_PAGINA_CONTAS}`,
        ps,
        { teto: TAMANHO_PAGINA_CONTAS },
      );
      return {
        total: num(total?.['n']),
        contas: ls.map((x): CustoContaApuracao => ({
          conta: num(x['conta']),
          numero: numeroDe(x['numero'], x['conta']),
          tipoConta: txtOuNull(x['tipo']),
          convenio: numOuNull(x['convenio']),
          procedimento: txtOuNull(x['procedimento']),
          receitaBruta: centavos(x['valor_receita']),
          glosa: centavos(x['valor_glosa']),
          recurso: centavos(x['valor_recurso']),
          receitaLiquida: centavos(x['receita_liquida']),
          custo: centavos(x['custo_total']),
          margem: centavos(x['margem']),
          parcelas: jsonTexto(x['parcelas']) ?? '[]',
          prontuario: numOuNull(x['prontuario']),
        })),
      };
    });
  }

  resultadoAgrupado(
    c: ContextoCustos,
    id: number,
    agrupamento: 'convenio' | 'procedimento' | 'tipoConta' | 'paciente',
  ): Promise<GrupoResultadoApurado[]> {
    const chave = {
      convenio: 'x.convenio',
      procedimento: 'x.procedimento',
      tipoConta: 'x.tipo',
      paciente: 'x.prontuario',
    }[agrupamento];
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT ${chave} AS chave, COUNT(*) AS contas, SUM(x.valor_receita) AS bruta, SUM(x.valor_glosa) AS glosa,
                  SUM(x.valor_recurso) AS recurso, SUM(x.receita_liquida) AS liquida, SUM(x.custo_total) AS custo,
                  SUM(x.margem) AS margem
             FROM (${SQL_CONTAS_APURACAO}) x GROUP BY ${chave} ORDER BY ${chave} LIMIT ${TETO_GRUPOS}`,
          [id, est],
          { teto: TETO_GRUPOS },
        )
      ).map((x) => ({
        chave: x['chave'] === null || x['chave'] === undefined ? null : String(x['chave']),
        contas: num(x['contas']),
        receitaBruta: centavos(x['bruta']),
        glosa: centavos(x['glosa']),
        recurso: centavos(x['recurso']),
        receitaLiquida: centavos(x['liquida']),
        custo: centavos(x['custo']),
        margem: centavos(x['margem']),
      })),
    );
  }

  /** Grava a apuração: a nova (apurada) com as linhas por centro e o custo por conta; a vigente lida vira substituída. */
  gravarApuracao(c: ContextoCustos, x: ApuracaoParaGravar, _por: string, trilha: TrilhaCustos) {
    return this.gravar(
      c,
      'custos.apurar',
      ['apuracao_custo', 'apuracao_custo_centro', 'custo_conta_paciente'],
      trilha,
      async (tx, est) => {
        const dia = diaDaCompetencia(x.competencia);
        const vigentes = await tx.consultarParaAtualizar<{ id: unknown; versao: unknown }>(
          `SELECT id, versao FROM apuracao_custo
            WHERE estabelecimento_id = ? AND competencia = ? AND excluido_em IS NULL
              AND substituida_por_apuracao_custo_id IS NULL AND situacao <> 'cancelada'`,
          [est, dia],
          { teto: 10 },
        );
        const alvo = x.substitui;
        if (
          alvo === null
            ? vigentes.length > 0
            : !vigentes.some((v) => num(v.id) === alvo.id && num(v.versao) === alvo.versao)
        )
          throw desatualizadoApuracao();
        const ultima = await tx.uma<{ n: unknown }>(
          'SELECT COALESCE(MAX(numero_versao), 0) AS n FROM apuracao_custo WHERE estabelecimento_id = ? AND competencia = ?',
          [est, dia],
        );
        const agora = new Date();
        const id = await tx.incluir('apuracao_custo', {
          estabelecimento_id: est,
          competencia: dia,
          numero_versao: num(ultima?.n) + 1,
          situacao: 'apurada',
          rotulo_parcial: x.rotuloParcial,
          limite_linha_centavos: Math.round(x.limiteLinha),
          custo_produtivos: reais(x.custoProdutivos),
          valor_custo_total: reais(x.linhas.reduce((s, l) => s + l.custoFinal, 0)),
          valor_receita_total: reais(x.linhas.reduce((s, l) => s + l.receita, 0)),
          totais: x.totais,
          completude: x.completude,
          pendencias: x.pendencias,
          impressao: x.impressao,
          justificativa: x.justificativa,
          duracao_ms: Math.max(0, Math.round(x.duracaoMs)),
          iniciado_em: agora,
          apurado_em: agora,
        });
        const tipos = new Map<string, number>();
        for (const l of x.linhas) {
          let criterio: number | null = null;
          if (l.criterio) {
            criterio = tipos.get(l.criterio) ?? null;
            if (criterio === null)
              tipos.set(l.criterio, (criterio = await idTipoEstatistica(tx, l.criterio)));
          }
          await tx.incluir('apuracao_custo_centro', {
            apuracao_custo_id: id,
            centro_custo_id: l.centro,
            classe: l.classe,
            ordem_rateio: l.ordemRateio,
            criterio_tipo_dado_estatistico_id: criterio,
            custo_pessoal: reais(l.pessoal),
            custo_materiais: reais(l.materiais),
            custo_despesas: reais(l.despesas),
            custo_despesas_gerais: reais(l.despesasGerais),
            custo_direto: reais(l.diretoTotal),
            custo_recebido: reais(l.recebidoTotal),
            recebidos: JSON.stringify(l.recebidos),
            custo_repassado: reais(l.repassado),
            custo_nao_rateado: reais(l.naoRateado),
            custo_final: reais(l.custoFinal),
            base_criterio: decimalOuNull(l.baseCriterioCent),
            producao_codigo: l.producaoCodigo,
            producao_quantidade: decimalOuNull(l.producaoCent),
            custo_unitario: decimalOuNull(l.custoUnitario),
            valor_receita: reais(l.receita),
          });
        }
        for (const k of x.contas) {
          const conta = await tx.uma(
            `SELECT ch.atendimento_id, at.entrada_em FROM conta_hospitalar ch JOIN atendimento at ON at.id = ch.atendimento_id
              WHERE ch.id = ? AND ch.estabelecimento_id = ? AND ch.excluido_em IS NULL`,
            [k.conta, est],
          );
          if (!conta)
            throw recusa('conta-inexistente', 'Uma conta da apuração não existe neste estabelecimento.');
          await tx.incluir('custo_conta_paciente', {
            apuracao_custo_id: id,
            conta_hospitalar_id: k.conta,
            atendimento_id: num(conta['atendimento_id']),
            fonte_pagadora_id: k.convenio,
            data_atendimento: dataIso(conta['entrada_em']),
            valor_receita: reais(k.receitaBruta),
            valor_glosa: reais(k.glosa),
            valor_recurso: reais(k.recurso),
            receita_liquida: reais(k.receitaLiquida),
            custo_total: reais(k.custo),
            margem_percentual:
              k.receitaLiquida === 0 ? null : ((k.margem / k.receitaLiquida) * 100).toFixed(4),
            parcelas: JSON.stringify(k.parcelas),
          });
        }
        if (alvo)
          await tx.alterar('apuracao_custo', alvo.id, alvo.versao, {
            situacao: 'cancelada',
            substituida_por_apuracao_custo_id: id,
          });
        const apuracao = await lerApuracao(tx, est, id);
        if (!apuracao) throw new Error('A apuração gravada não foi relida.');
        return { valor: { apuracao, substituida: alvo?.id ?? null }, id, motivo: x.justificativa };
      },
    );
  }

  /** Aprova a apuração (fecha a competência): só a apurada, na versão lida. */
  async aprovarApuracao(c: ContextoCustos, id: number, versao: number, _por: string, trilha: TrilhaCustos) {
    const antes = await this.apuracao(c, id);
    if (!antes) return null;
    if (antes.versao !== versao || antes.situacao !== 'apurada') throw desatualizadoApuracao();
    return this.gravar(c, 'custos.aprovar-apuracao', ['apuracao_custo'], trilha, async (tx, est) => {
      const agora = new Date();
      await tx.alterar('apuracao_custo', id, versao, {
        situacao: 'fechada',
        fechado_em: agora,
        fechador_usuario_id: c.usuario ?? null,
        aprovado_em: agora,
        aprovador_usuario_id: c.usuario ?? null,
      });
      const depois = await lerApuracao(tx, est, id);
      if (!depois) throw new Error('A apuração aprovada não foi relida.');
      return { valor: { antes, depois }, id };
    });
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
