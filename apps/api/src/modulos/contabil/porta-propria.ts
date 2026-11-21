// Porta da contabilidade sobre o banco do cliente (F2.2, lote 04-01), pelo @sgh/nucleo: leituras somente leitura no
// modelo próprio (plano_contas/conta_contabil com conta_referencial, fato_contabil com evento_contabil,
// lancamento_contabil/partida_contabil por periodo_contabil, conciliacao_conta_contabil, arquivo_sped_contabil e o
// de-para em regra_contabil_receita) e as gravações numa operação de gravação direta do Executor, com trilha, outbox e
// idempotência na mesma transação. A "empresa" das telas é o estabelecimento da sessão; toda leitura filtra o
// estabelecimento e os registros excluídos. O plano de contas é da rede inteira (plano_contas sem estabelecimento): o
// do período mais recente do estabelecimento ou, sem período, o plano contábil vigente sem grupo de consolidação.
// Melhoria: competência, período e número do lançamento no modelo (periodo_contabil, sequencia_negocio); o lançamento
// de estorno marca o estornado (situacao, estornado_em) e o banco garante um único estorno por lançamento.
// Melhoria: chave idempotente do lançamento única no banco (uq_lancamento_contabil_idempotencia, hash da chave do
// domínio) e período encerrado recusado na mesma transação que trava o período.
// Melhoria: a situação do fato só muda se ainda for a lida (corrida entre o worker e a tela), com versão e auditoria.
// Melhoria: conciliação com responsável e situação do modelo; desfazer exige justificativa e libera as partidas.
// Melhoria: as fontes de fatos são as entidades que publicam fato_contabil (sem varredura de tabelas de outro sistema).
// Melhoria: período bloqueado (situacao 'bloqueado' e bloqueado_ate) e conta que não aceita lançamento manual recusados
// na transação que trava o período (regra pura em bloqueio-periodo.ts).
// Melhoria: o plano de contas é da rede: incluir e alterar conta exige a permissão do plano da rede, salvo quando o
// plano é só deste estabelecimento (nenhum período de outro o usa).
// Melhoria: cada gravação é uma operação própria do Executor (contabil.incluirConta etc.), com a Idempotency-Key da tela
// e o hash do pedido na entrada: o reenvio devolve o resultado gravado e a chave reaproveitada com outro pedido é
// recusada; a trilha aponta para a tabela gravada (conta_contabil, lancamento_contabil...).
// Melhoria: o fato marcado como contabilizado tem de terminar a transação com o lançamento automático ativo, e o fato
// que sai de contabilizado não pode ficar com lançamento automático ativo (estorne antes).
// Regras de contabilização: cada versão publicada é uma linha de versao_regra_contabil (só inclusão; a anterior fica),
// com a forma canônica e a impressão; a versão aplicada fica no fato e no lançamento automático
// (versao_regra_contabil_id). O tipo de fato da regra é o evento_contabil do mesmo código (o evento nativo é criado na
// primeira publicação, se o catálogo ainda não o tiver).
// Arquivo SPED: o registro em arquivo_sped_contabil (leiaute, linhas, parâmetros, substituição) e o conteúdo cifrado no
// armazém de arquivos, ligado pela tabela arquivo. Sem armazém configurado, gravar e ler o conteúdo recusam com 503
// (armazem-indisponivel): nunca um arquivo gerado sem guarda. Ainda fora do modelo: a observação do encerramento (só na
// trilha) e o NIRE do estabelecimento.
import { createHash, randomUUID } from 'node:crypto';
import { planejarEnvioSped } from '@sgh/dominio-contabil';
import {
  bool,
  CENTAVOS,
  contaDe,
  corta,
  diaUm,
  fatoDe,
  INSTANTE,
  ladoDe,
  lerDePara,
  lerIdDoPlano,
  lerParaContabilizar,
  lerPartidas,
  lerPeriodos,
  lerPlano,
  lerRegras,
  type Linha,
  lista,
  NATUREZA_DO_GRUPO,
  num,
  numOuNulo,
  origemDoTipo,
  periodoDe,
  reais,
  SITUACAO_FATO_MODELO,
  situacaoFatoDe,
  SQL_CONTAS,
  SQL_FATOS,
  SQL_PERIODOS,
  texto,
  textoOuNulo,
  tiposDaOrigem,
  gravacaoDosFatos,
} from '@sgh/persistencia-contabil';
import {
  type PartidaGerada,
  type SituacaoArquivoSped,
  type SituacaoFato,
  TIPOS_FATO,
  type TipoArquivoSped,
  type TipoFato,
  type TipoLancamento,
} from '@sgh/contratos';
import {
  type ContextoNucleo,
  definirOperacao,
  erroConflitoVersao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  restricaoViolada,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';
import {
  type ContextoContabil,
  type GravadorContabil,
  type LeituraParaContabilizar,
  METODOS_PORTA_CONTABIL,
  type PedidoDeGravacao,
  type PortaContabil,
  type RazaoLido,
} from './porta.js';
import type {
  ArquivoSpedRegistrado,
  ConciliacaoRegistrada,
  ContaPlanoVersionada,
  DadosDoEncerramento,
  DiarioPorta,
  EmpresaSped,
  EstadoFonteFatos,
  FatoRegistrado,
  FiltroFatosPorta,
  FiltroLancamentosPorta,
  FiltroRazaoPorta,
  FiltroRegrasPorta,
  FiltroSomasPorta,
  ItemDePara,
  LancamentoDoDiario,
  LancamentoParaGravar,
  LancamentoRegistrado,
  PartidaParaConciliacao,
  PartidaPendente,
  PartidaRegistrada,
  PeriodoRegistrado,
  ReferenciasContabeis,
  RegraPublicada,
  ResumoFonteFatos,
  SomaConta,
} from './tipos.js';

/** A chave idempotente do lançamento (do pacote comum; os testes a conferem). */
export { chaveDoLancamento } from '@sgh/persistencia-contabil';

/** O mínimo do núcleo que a porta usa. */
export type NucleoContabil = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

/** Tabelas da gravação direta da contabilidade (a operação só grava nelas). */
const TABELAS_GRAVACAO = [
  'conta_contabil',
  'fato_contabil',
  'lancamento_contabil',
  'partida_contabil',
  'periodo_contabil',
  'conciliacao_conta_contabil',
  'arquivo_sped_contabil',
  'arquivo',
  'versao_regra_contabil',
  'evento_contabil',
  'sequencia_negocio',
];

/**
 * Armazém do conteúdo do arquivo SPED (o texto já cifrado pela API). A chave é única e o conteúdo guardado não é
 * reescrito; no banco fica só a chave, o tamanho e o hash (tabela arquivo).
 */
export interface ArmazemArquivoSped {
  guardar(chave: string, conteudo: Uint8Array): Promise<void>;
  ler(chave: string): Promise<Uint8Array | null>;
}

/** Módulo que publica o fato, pela origem do lançamento (evento_contabil.modulo). */
const MODULO_DA_ORIGEM: Readonly<Record<number, string>> = {
  1: 'financeiro',
  2: 'faturamento',
  3: 'faturamento',
  4: 'faturamento',
  5: 'faturamento',
  6: 'faturamento',
  7: 'patrimonio',
  8: 'folha',
  9: 'estoque',
  10: 'financeiro',
  11: 'contabilidade',
};

const armazemIndisponivel = () =>
  new ErroOperacao(
    503,
    'armazem-indisponivel',
    'Armazém de arquivos indisponível',
    'O armazém de arquivos do ambiente não está configurado: o arquivo SPED não pode ser guardado nem lido.',
  );

function contextoDe(c: ContextoContabil): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: (c.correlacao || 'contabil').slice(0, 64),
  };
}

function repetidaDe<T>(bruto: unknown): T {
  return (typeof bruto === 'string' ? JSON.parse(bruto) : null) as T;
}

const SQL_LANCAMENTOS = `SELECT l.id, l.estabelecimento_id, l.chave_idempotencia, l.numero, l.tipo,
    DATE_FORMAT(l.data_lancamento, '%Y-%m-%d') AS data_lancamento, DATE_FORMAT(pe.competencia, '%Y-%m') AS competencia,
    l.historico, l.complemento, l.fato_contabil_id, l.estornado_lancamento_contabil_id,
    (SELECT a.tipo FROM lancamento_contabil a WHERE a.id = l.estornado_lancamento_contabil_id) AS tipo_estornado,
    (SELECT e.id FROM lancamento_contabil e WHERE e.estornado_lancamento_contabil_id = l.id AND e.excluido_em IS NULL
      LIMIT 1) AS estornado_por,
    COALESCE(u.login, '') AS criado_por, DATE_FORMAT(l.criado_em, ${INSTANTE}) AS criado_em,
    (SELECT ${CENTAVOS('SUM(p.valor)')} FROM partida_contabil p
      WHERE p.lancamento_contabil_id = l.id AND p.lado = 'debito' AND p.excluido_em IS NULL) AS debitos,
    (SELECT ${CENTAVOS('SUM(p.valor)')} FROM partida_contabil p
      WHERE p.lancamento_contabil_id = l.id AND p.lado = 'credito' AND p.excluido_em IS NULL) AS creditos,
    f.entidade_origem AS fato_tabela, ev.codigo AS fato_tipo, f.documento AS fato_documento,
    DATE_FORMAT(f.data_fato, '%Y-%m-%d') AS fato_data,
    l.versao_regra_contabil_id, vr.nome AS regra_nome, vr.numero_versao AS regra_versao
  FROM lancamento_contabil l
  JOIN periodo_contabil pe ON pe.id = l.periodo_contabil_id
  LEFT JOIN usuario u ON u.id = l.criado_por
  LEFT JOIN fato_contabil f ON f.id = l.fato_contabil_id
  LEFT JOIN evento_contabil ev ON ev.id = f.evento_contabil_id
  LEFT JOIN versao_regra_contabil vr ON vr.id = l.versao_regra_contabil_id
  WHERE l.estabelecimento_id = ? AND l.excluido_em IS NULL`;

const SQL_CONCILIACOES = `SELECT k.id, c.classificacao, k.situacao, ${CENTAVOS('k.saldo_composicao')} AS centavos,
    k.justificativa, COALESCE(uc.login, '') AS criada_por, DATE_FORMAT(k.criado_em, ${INSTANTE}) AS criada_em,
    ua.login AS desfeita_por, DATE_FORMAT(k.alterado_em, ${INSTANTE}) AS desfeita_em,
    (SELECT COUNT(*) FROM partida_contabil p WHERE p.conciliacao_conta_contabil_id = k.id AND p.excluido_em IS NULL) AS partidas
  FROM conciliacao_conta_contabil k
  JOIN conta_contabil c ON c.id = k.conta_contabil_id
  LEFT JOIN usuario uc ON uc.id = k.criado_por
  LEFT JOIN usuario ua ON ua.id = k.alterado_por
  WHERE k.estabelecimento_id = ? AND k.excluido_em IS NULL`;

const SQL_ARQUIVOS_SPED = `SELECT s.id, s.tipo_escrituracao, s.exercicio, s.sequencia_envio, s.situacao, s.finalidade,
    s.hash_sha256, s.recibo, DATE_FORMAT(s.transmitido_em, ${INSTANTE}) AS transmitido_em, s.mensagem_validacao,
    DATE_FORMAT(s.gerado_em, ${INSTANTE}) AS gerado_em, COALESCE(u.login, '') AS gerado_por,
    s.leiaute, s.leiaute_conferido, s.quantidade_linhas, s.parametros,
    a.nome_original, a.tamanho_bytes, a.chave_armazenamento,
    (SELECT COUNT(*) FROM arquivo_sped_contabil n WHERE n.arquivo_substituido_id = s.id AND n.excluido_em IS NULL
      AND n.situacao <> 'cancelado') AS substituido
  FROM arquivo_sped_contabil s
  LEFT JOIN arquivo a ON a.id = s.arquivo_id
  LEFT JOIN usuario u ON u.id = s.gerador_usuario_id
  WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL`;

const parametrosDe = (v: unknown): string =>
  v === null || v === undefined ? '{}' : typeof v === 'string' ? v : JSON.stringify(v);

function lancamentoDe(r: Linha): LancamentoRegistrado {
  const fatoTipo = textoOuNulo(r['fato_tipo']);
  return {
    id: num(r['id']),
    empresa: num(r['estabelecimento_id']),
    chave: texto(r['chave_idempotencia'] ?? r['numero']),
    tipo: texto(r['tipo']) as TipoLancamento,
    data: texto(r['data_lancamento']),
    competencia: texto(r['competencia']),
    historico: texto(r['historico']),
    debitos: num(r['debitos']),
    creditos: num(r['creditos']),
    fatoId: numOuNulo(r['fato_contabil_id']),
    regraId: numOuNulo(r['versao_regra_contabil_id']),
    regra: r['regra_nome'] == null ? null : { nome: texto(r['regra_nome']), versao: num(r['regra_versao']) },
    estornaId: numOuNulo(r['estornado_lancamento_contabil_id']),
    estornadoPor: numOuNulo(r['estornado_por']),
    justificativa: textoOuNulo(r['complemento']),
    criadoPor: texto(r['criado_por']),
    criadoEm: texto(r['criado_em']),
    fato:
      fatoTipo === null
        ? null
        : {
            tabela: texto(r['fato_tabela']),
            tipo: fatoTipo as TipoFato,
            origem: origemDoTipo(fatoTipo),
            documento: texto(r['fato_documento']),
            data: texto(r['fato_data']),
          },
  };
}

function conciliacaoDe(r: Linha, est: number): ConciliacaoRegistrada {
  const desfeita = r['situacao'] === 'reaberta';
  return {
    id: num(r['id']),
    empresa: est,
    conta: texto(r['classificacao']),
    situacao: desfeita ? 'desfeita' : 'ativa',
    partidas: num(r['partidas']),
    valorCentavos: num(r['centavos']),
    observacao: textoOuNulo(r['justificativa']),
    criadaPor: texto(r['criada_por']),
    criadaEm: texto(r['criada_em']),
    desfeitaPor: desfeita ? textoOuNulo(r['desfeita_por']) : null,
    desfeitaEm: desfeita ? textoOuNulo(r['desfeita_em']) : null,
  };
}

function arquivoSpedDe(r: Linha, est: number): ArquivoSpedRegistrado {
  const s = texto(r['situacao']);
  const situacao: SituacaoArquivoSped =
    s === 'cancelado'
      ? 'cancelado'
      : s === 'transmitido'
        ? 'transmitido'
        : num(r['substituido']) > 0
          ? 'substituido'
          : 'gerado';
  return {
    id: num(r['id']),
    empresa: est,
    tipo: texto(r['tipo_escrituracao']) as TipoArquivoSped,
    exercicio: num(r['exercicio']),
    numero: num(r['sequencia_envio']),
    situacao,
    leiaute: texto(r['leiaute']),
    leiauteConferido: bool(r['leiaute_conferido']),
    substituta: r['finalidade'] === 'substituta',
    nomeArquivo: texto(r['nome_original']),
    tamanho: num(r['tamanho_bytes']),
    linhas: num(r['quantidade_linhas']),
    hash: texto(r['hash_sha256']),
    parametros: parametrosDe(r['parametros']),
    geradoPor: texto(r['gerado_por']),
    geradoEm: texto(r['gerado_em']),
    recibo: textoOuNulo(r['recibo']),
    transmitidoEm: textoOuNulo(r['transmitido_em']),
    motivo: textoOuNulo(r['mensagem_validacao']),
  };
}

const competenciaAnterior = (c: string) => {
  const ano = Number(c.slice(0, 4));
  const mes = Number(c.slice(5, 7));
  return mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, '0')}`;
};

export class PortaContabilPropria implements PortaContabil {
  readonly destino = 'banco' as const;
  private executorCriado: Executor | null = null;

  constructor(
    private readonly nucleo: NucleoContabil,
    /** Onde fica o conteúdo do arquivo SPED; null: gravar e ler o conteúdo recusam com 503. */
    private readonly armazemSped: ArmazemArquivoSped | null = null,
  ) {}

  private get executor(): Executor {
    return (this.executorCriado ??= this.nucleo.criarExecutor());
  }

  private ler<T>(c: ContextoContabil, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente({ cliente: c.cliente, correlacao: contextoDe(c).correlacao }, (l) =>
      fn(l, est),
    );
  }

  /** Leitura de uma "empresa": só a do estabelecimento da sessão (outra empresa não vê nada). */
  private lerEmpresa<T>(
    c: ContextoContabil,
    empresa: number,
    vazio: T,
    fn: (l: Leitor, est: number) => Promise<T>,
  ) {
    return this.ler(c, (l, est) => (empresa === est ? fn(l, est) : Promise.resolve(vazio)));
  }

  private static plano(l: Leitor, est: number): Promise<number | null> {
    return lerIdDoPlano(l, est);
  }

  private static partidasDe(l: Leitor, ids: readonly number[]): Promise<Map<number, PartidaRegistrada[]>> {
    return lerPartidas(l, ids);
  }

  hoje(c: ContextoContabil): Promise<string> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<{ fuso_horario: string | null }>(
        'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
        [est],
      );
      return new Intl.DateTimeFormat('en-CA', { timeZone: r?.fuso_horario || 'America/Sao_Paulo' }).format(
        new Date(),
      );
    });
  }

  referencias(c: ContextoContabil): Promise<ReferenciasContabeis> {
    // Planos referenciais da Receita: catálogo da rede inteira (sem estabelecimento; a tabela não tem exclusão lógica,
    // o fim da vigência tira o plano da lista).
    return this.ler(c, async (l) => {
      const tipos = await l.consultar(
        `SELECT id, codigo_receita_federal, descricao, uso_ecf FROM plano_referencial
          WHERE (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE) ORDER BY codigo_receita_federal`,
      );
      const origens = Object.entries(TIPOS_FATO as Readonly<Record<string, { origem: number }>>)
        .map(([, v]) => v.origem)
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort((a, b) => a - b);
      const { ORIGENS_LANCAMENTO } = await import('@sgh/contratos');
      const rotulos = ORIGENS_LANCAMENTO as Readonly<Record<number, string>>;
      return {
        origens: [...new Set([...origens, ...Object.keys(rotulos).map(Number)])]
          .sort((a, b) => a - b)
          .map((id) => ({ id, descricao: rotulos[id] ?? String(id) })),
        tiposPlanoReferencial: tipos.map((r) => ({
          id: num(r['id']),
          codigo: texto(r['codigo_receita_federal']),
          descricao: texto(r['descricao']),
          ecf: bool(r['uso_ecf']),
        })),
      };
    });
  }

  dePara(c: ContextoContabil, empresa: number): Promise<ItemDePara[]> {
    return this.lerEmpresa(c, empresa, [], (l, est) => lerDePara(l, est));
  }

  empresas(c: ContextoContabil): Promise<number[]> {
    return this.ler(c, async (l, est) => ((await PortaContabilPropria.plano(l, est)) === null ? [] : [est]));
  }

  centrosCusto(c: ContextoContabil): Promise<{ codigo: number; nome: string; ativo: boolean }[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          'SELECT id, nome, ativo FROM centro_custo WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome',
          [est],
        )
      ).map((r) => ({ codigo: num(r['id']), nome: texto(r['nome']), ativo: bool(r['ativo']) })),
    );
  }

  plano(c: ContextoContabil, empresa: number): Promise<ContaPlanoVersionada[]> {
    return this.lerEmpresa(c, empresa, [], (l, est) => lerPlano(l, est));
  }

  /** Versões publicadas das regras (todas, para o domínio conferir a versão seguinte e a vigência). */
  regras(c: ContextoContabil, empresa: number, f: FiltroRegrasPorta): Promise<RegraPublicada[]> {
    return this.lerEmpresa(c, empresa, [] as RegraPublicada[], (l, est) => lerRegras(l, est, f));
  }

  fontes(c: ContextoContabil): Promise<EstadoFonteFatos[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT entidade_origem, COUNT(*) AS n, MAX(entidade_origem_id) AS marca, SUM(estorno) AS estornos,
                  DATE_FORMAT(MAX(criado_em), ${INSTANTE}) AS ultima
             FROM fato_contabil WHERE estabelecimento_id = ? AND excluido_em IS NULL
            GROUP BY entidade_origem ORDER BY entidade_origem`,
          [est],
        )
      ).map((r) => ({
        tabela: texto(r['entidade_origem']),
        marca: num(r['marca']),
        varredura: 0,
        ultimaLeitura: textoOuNulo(r['ultima']),
        lidosNovos: num(r['n']) - num(r['estornos']),
        lidosAlterados: num(r['estornos']),
        fatosGravados: num(r['n']),
        versao: 1,
      })),
    );
  }

  resumoFatos(c: ContextoContabil): Promise<ResumoFonteFatos[]> {
    return this.ler(c, async (l, est) => {
      const m = new Map<string, Partial<Record<SituacaoFato, number>>>();
      for (const r of await l.consultar(
        `SELECT entidade_origem, situacao, COUNT(*) AS n FROM fato_contabil
          WHERE estabelecimento_id = ? AND excluido_em IS NULL GROUP BY entidade_origem, situacao`,
        [est],
      )) {
        const t = texto(r['entidade_origem']);
        const x = m.get(t) ?? {};
        x[situacaoFatoDe(r['situacao'])] = num(r['n']);
        m.set(t, x);
      }
      return [...m.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tabela, porSituacao]) => ({ tabela, porSituacao }));
    });
  }

  fatos(c: ContextoContabil, f: FiltroFatosPorta, pagina: number, tamanho: number) {
    return this.ler(c, async (l, est) => {
      if (f.empresa !== undefined && f.empresa !== est) return { itens: [], total: 0 };
      let where = '';
      const p: unknown[] = [est];
      if (f.competencia) {
        where += ' AND f.competencia = ?';
        p.push(diaUm(f.competencia));
      }
      if (f.tipoFato) {
        where += ' AND ev.codigo = ?';
        p.push(f.tipoFato);
      }
      if (f.origem !== undefined) {
        const tipos = tiposDaOrigem(f.origem);
        if (tipos.length === 0) return { itens: [], total: 0 };
        where += ` AND ev.codigo IN (${lista(tipos.length)})`;
        p.push(...tipos);
      }
      if (f.situacao) {
        where += ' AND f.situacao = ?';
        p.push(SITUACAO_FATO_MODELO[f.situacao]);
      }
      const total = num(
        (
          await l.uma(
            `SELECT COUNT(*) AS n FROM fato_contabil f JOIN evento_contabil ev ON ev.id = f.evento_contabil_id
              WHERE f.estabelecimento_id = ? AND f.excluido_em IS NULL${where}`,
            p,
          )
        )?.['n'],
      );
      const itens = (
        await l.consultar(`${SQL_FATOS}${where} ORDER BY f.competencia DESC, f.id DESC LIMIT ? OFFSET ?`, [
          ...p,
          tamanho,
          (Math.max(1, pagina) - 1) * tamanho,
        ])
      ).map(fatoDe);
      return { itens, total };
    });
  }

  fatosDaCompetencia(c: ContextoContabil, empresa: number, competencia: string, teto: number) {
    return this.lerEmpresa(c, empresa, [] as FatoRegistrado[], async (l, est) =>
      (
        await l.consultar(`${SQL_FATOS} AND f.competencia = ? ORDER BY f.id LIMIT ?`, [
          est,
          diaUm(competencia),
          teto,
        ])
      ).map(fatoDe),
    );
  }

  periodos(c: ContextoContabil, empresa: number): Promise<PeriodoRegistrado[]> {
    return this.lerEmpresa(c, empresa, [], (l, est) => lerPeriodos(l, est));
  }

  movimentoPorCompetencia(c: ContextoContabil, empresa: number) {
    return this.lerEmpresa(
      c,
      empresa,
      [] as { competencia: string; lancamentos: number; debitos: number; creditos: number }[],
      async (l, est) =>
        (
          await l.consultar(
            `SELECT DATE_FORMAT(pe.competencia, '%Y-%m') AS competencia, COUNT(DISTINCT l.id) AS n,
                  ${CENTAVOS("SUM(CASE WHEN p.lado = 'debito' THEN p.valor ELSE 0 END)")} AS debitos,
                  ${CENTAVOS("SUM(CASE WHEN p.lado = 'credito' THEN p.valor ELSE 0 END)")} AS creditos
             FROM lancamento_contabil l
             JOIN periodo_contabil pe ON pe.id = l.periodo_contabil_id
             JOIN partida_contabil p ON p.lancamento_contabil_id = l.id AND p.excluido_em IS NULL
            WHERE l.estabelecimento_id = ? AND l.excluido_em IS NULL
            GROUP BY pe.competencia ORDER BY pe.competencia`,
            [est],
          )
        ).map((r) => ({
          competencia: texto(r['competencia']),
          lancamentos: num(r['n']),
          debitos: num(r['debitos']),
          creditos: num(r['creditos']),
        })),
    );
  }

  totaisDoPeriodo(c: ContextoContabil, empresa: number, competencia: string) {
    return this.lerEmpresa(
      c,
      empresa,
      [] as { tipo: TipoLancamento; lancamentos: number; debitos: number; creditos: number }[],
      (l, est) => PortaContabilPropria.totaisPorTipo(l, est, competencia),
    );
  }

  private static async totaisPorTipo(l: Leitor, est: number, competencia: string) {
    return (
      await l.consultar(
        `SELECT l.tipo, COUNT(DISTINCT l.id) AS n,
                ${CENTAVOS("SUM(CASE WHEN p.lado = 'debito' THEN p.valor ELSE 0 END)")} AS debitos,
                ${CENTAVOS("SUM(CASE WHEN p.lado = 'credito' THEN p.valor ELSE 0 END)")} AS creditos
           FROM lancamento_contabil l
           JOIN periodo_contabil pe ON pe.id = l.periodo_contabil_id
           JOIN partida_contabil p ON p.lancamento_contabil_id = l.id AND p.excluido_em IS NULL
          WHERE l.estabelecimento_id = ? AND l.excluido_em IS NULL AND pe.competencia = ?
          GROUP BY l.tipo ORDER BY l.tipo`,
        [est, diaUm(competencia)],
      )
    ).map((r) => ({
      tipo: texto(r['tipo']) as TipoLancamento,
      lancamentos: num(r['n']),
      debitos: num(r['debitos']),
      creditos: num(r['creditos']),
    }));
  }

  fatosDoPeriodo(c: ContextoContabil, empresa: number, competencia: string) {
    return this.lerEmpresa(c, empresa, {} as Partial<Record<SituacaoFato, number>>, (l, est) =>
      PortaContabilPropria.fatosPorSituacao(l, est, competencia),
    );
  }

  private static async fatosPorSituacao(l: Leitor, est: number, competencia: string) {
    const r: Partial<Record<SituacaoFato, number>> = {};
    for (const x of await l.consultar(
      `SELECT situacao, COUNT(*) AS n FROM fato_contabil
        WHERE estabelecimento_id = ? AND competencia = ? AND excluido_em IS NULL GROUP BY situacao`,
      [est, diaUm(competencia)],
    ))
      r[situacaoFatoDe(x['situacao'])] = num(x['n']);
    return r;
  }

  lancamentos(c: ContextoContabil, f: FiltroLancamentosPorta, pagina: number, tamanho: number) {
    return this.lerEmpresa(
      c,
      f.empresa,
      { itens: [] as LancamentoRegistrado[], total: 0 },
      async (l, est) => {
        let where = '';
        const p: unknown[] = [est];
        if (f.competencia) {
          where += ' AND pe.competencia = ?';
          p.push(diaUm(f.competencia));
        }
        if (f.tipo) {
          where += ' AND l.tipo = ?';
          p.push(f.tipo);
        }
        if (f.conta) {
          where += ` AND EXISTS (SELECT 1 FROM partida_contabil x JOIN conta_contabil cc ON cc.id = x.conta_contabil_id
                    WHERE x.lancamento_contabil_id = l.id AND x.excluido_em IS NULL AND cc.classificacao = ?)`;
          p.push(f.conta);
        }
        const total = num(
          (
            await l.uma(
              `SELECT COUNT(*) AS n FROM lancamento_contabil l JOIN periodo_contabil pe ON pe.id = l.periodo_contabil_id
              WHERE l.estabelecimento_id = ? AND l.excluido_em IS NULL${where}`,
              p,
            )
          )?.['n'],
        );
        const itens = (
          await l.consultar(
            `${SQL_LANCAMENTOS}${where} ORDER BY l.data_lancamento DESC, l.id DESC LIMIT ? OFFSET ?`,
            [...p, tamanho, (Math.max(1, pagina) - 1) * tamanho],
          )
        ).map(lancamentoDe);
        return { itens, total };
      },
    );
  }

  lancamento(c: ContextoContabil, id: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_LANCAMENTOS} AND l.id = ?`, [est, id]);
      if (!r) return null;
      const partidas = (await PortaContabilPropria.partidasDe(l, [id])).get(id) ?? [];
      return { ...lancamentoDe(r), partidas };
    });
  }

  lancamentosDosFatos(c: ContextoContabil, idsFato: readonly number[]) {
    return this.ler(c, async (l, est) => {
      const m = new Map<number, { readonly partidas: readonly PartidaGerada[] }>();
      if (idsFato.length === 0) return m;
      const ls = await l.consultar(
        `SELECT id, fato_contabil_id FROM lancamento_contabil
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND tipo = 'automatico' AND situacao = 'ativo'
            AND fato_contabil_id IN (${lista(idsFato.length)}) ORDER BY id`,
        [est, ...idsFato],
      );
      const partidas = await PortaContabilPropria.partidasDe(
        l,
        ls.map((x) => num(x['id'])),
      );
      for (const x of ls)
        m.set(num(x['fato_contabil_id']), {
          partidas: (partidas.get(num(x['id'])) ?? []).map((p) => ({
            lado: p.lado,
            conta: p.conta,
            valorCentavos: p.valorCentavos,
            historico: p.historico,
            centroCusto: p.centroCusto,
          })),
        });
      return m;
    });
  }

  razao(c: ContextoContabil, f: FiltroRazaoPorta, teto: number, pagina = 1): Promise<RazaoLido> {
    const zero = { debitos: 0, creditos: 0 };
    const vazio: RazaoLido = { anterior: zero, totais: zero, antesDaPagina: zero, movimentos: [] };
    return this.lerEmpresa(c, f.empresa, vazio, async (l, est) => {
      const plano = await PortaContabilPropria.plano(l, est);
      const conta =
        plano === null
          ? null
          : await l.uma('SELECT id FROM conta_contabil WHERE plano_contas_id = ? AND classificacao = ?', [
              plano,
              f.conta,
            ]);
      if (!conta) return vazio;
      const base = `FROM partida_contabil p JOIN lancamento_contabil l ON l.id = p.lancamento_contabil_id
        WHERE p.conta_contabil_id = ? AND p.excluido_em IS NULL AND l.estabelecimento_id = ? AND l.excluido_em IS NULL${
          f.centroCusto !== undefined ? ' AND p.centro_custo_id = ?' : ''
        }`;
      const pb: unknown[] = [num(conta['id']), est, ...(f.centroCusto !== undefined ? [f.centroCusto] : [])];
      const somas = `${CENTAVOS("SUM(CASE WHEN p.lado = 'debito' THEN p.valor ELSE 0 END)")} AS debitos,
        ${CENTAVOS("SUM(CASE WHEN p.lado = 'credito' THEN p.valor ELSE 0 END)")} AS creditos`;
      const par = (r: Linha | null) => ({ debitos: num(r?.['debitos']), creditos: num(r?.['creditos']) });
      const anterior = par(await l.uma(`SELECT ${somas} ${base} AND l.data_lancamento < ?`, [...pb, f.de]));
      const totais = par(
        await l.uma(`SELECT ${somas} ${base} AND l.data_lancamento BETWEEN ? AND ?`, [...pb, f.de, f.ate]),
      );
      const pular = (Math.max(1, pagina) - 1) * teto;
      const ordem = 'ORDER BY l.data_lancamento, l.id, p.sequencia';
      const antesDaPagina =
        pular === 0
          ? zero
          : par(
              await l.uma(
                `SELECT ${CENTAVOS("SUM(CASE WHEN t.lado = 'debito' THEN t.valor ELSE 0 END)")} AS debitos,
                        ${CENTAVOS("SUM(CASE WHEN t.lado = 'credito' THEN t.valor ELSE 0 END)")} AS creditos
                   FROM (SELECT p.lado, p.valor ${base} AND l.data_lancamento BETWEEN ? AND ? ${ordem} LIMIT ?) t`,
                [...pb, f.de, f.ate, pular],
              ),
            );
      const movimentos = (
        await l.consultar(
          `SELECT l.id AS lancamento, p.id AS partida, DATE_FORMAT(l.data_lancamento, '%Y-%m-%d') AS data, l.tipo,
                  COALESCE(p.complemento, l.historico) AS historico, p.centro_custo_id, p.lado,
                  ${CENTAVOS('p.valor')} AS centavos, p.conciliacao_conta_contabil_id
             ${base} AND l.data_lancamento BETWEEN ? AND ? ${ordem} LIMIT ? OFFSET ?`,
          [...pb, f.de, f.ate, teto + 1, pular],
          { teto: teto + 1 },
        )
      ).map((r) => ({
        lancamento: num(r['lancamento']),
        partida: num(r['partida']),
        data: texto(r['data']),
        tipo: texto(r['tipo']) as TipoLancamento,
        historico: texto(r['historico']),
        centroCusto: numOuNulo(r['centro_custo_id']),
        lado: ladoDe(r['lado']),
        valorCentavos: num(r['centavos']),
        conciliado:
          r['conciliacao_conta_contabil_id'] !== null && r['conciliacao_conta_contabil_id'] !== undefined,
      }));
      return { anterior, totais, antesDaPagina, movimentos };
    });
  }

  pendentesConciliacao(
    c: ContextoContabil,
    empresa: number,
    conta: string,
    ate: string | null,
    teto: number,
  ) {
    return this.lerEmpresa(c, empresa, [] as PartidaPendente[], async (l, est) => {
      const plano = await PortaContabilPropria.plano(l, est);
      if (plano === null) return [];
      return (
        await l.consultar(
          `SELECT p.id, p.lancamento_contabil_id, DATE_FORMAT(l.data_lancamento, '%Y-%m-%d') AS data, p.lado,
                  ${CENTAVOS('p.valor')} AS centavos, COALESCE(p.complemento, l.historico) AS historico, p.centro_custo_id
             FROM partida_contabil p
             JOIN lancamento_contabil l ON l.id = p.lancamento_contabil_id
             JOIN conta_contabil cc ON cc.id = p.conta_contabil_id
            WHERE l.estabelecimento_id = ? AND l.excluido_em IS NULL AND p.excluido_em IS NULL
              AND cc.plano_contas_id = ? AND cc.classificacao = ? AND p.conciliacao_conta_contabil_id IS NULL
              ${ate ? 'AND l.data_lancamento <= ?' : ''}
            ORDER BY l.data_lancamento, p.id LIMIT ?`,
          [est, plano, conta, ...(ate ? [ate] : []), teto],
        )
      ).map((r) => ({
        id: num(r['id']),
        lancamento: num(r['lancamento_contabil_id']),
        data: texto(r['data']),
        lado: ladoDe(r['lado']),
        valorCentavos: num(r['centavos']),
        historico: texto(r['historico']),
        centroCusto: numOuNulo(r['centro_custo_id']),
      }));
    });
  }

  conciliacoes(c: ContextoContabil, empresa: number, conta: string, teto: number) {
    return this.lerEmpresa(c, empresa, [] as ConciliacaoRegistrada[], async (l, est) =>
      (
        await l.consultar(`${SQL_CONCILIACOES} AND c.classificacao = ? ORDER BY k.id DESC LIMIT ?`, [
          est,
          conta,
          teto,
        ])
      ).map((r) => conciliacaoDe(r, est)),
    );
  }

  paraContabilizar(
    c: ContextoContabil,
    empresa: number,
    situacoes: readonly SituacaoFato[],
    competencia: string | null,
    lote: number,
  ): Promise<LeituraParaContabilizar> {
    const vazio: LeituraParaContabilizar = {
      candidatos: [],
      registrados: [],
      lancamentos: new Map(),
      restam: false,
    };
    return this.lerEmpresa(c, empresa, vazio, (l, est) =>
      lerParaContabilizar(l, est, situacoes, competencia, lote),
    );
  }

  somas(c: ContextoContabil, f: FiltroSomasPorta, teto: number) {
    return this.lerEmpresa(c, f.empresa, { itens: [] as SomaConta[], parcial: false }, async (l, est) => {
      const p: unknown[] = [est, f.ate];
      let where = '';
      if (f.de) {
        where += ' AND l.data_lancamento >= ?';
        p.push(f.de);
      }
      if (f.centroCusto !== undefined && f.centroCusto !== null) {
        where += ' AND p.centro_custo_id = ?';
        p.push(f.centroCusto);
      }
      if (f.semApuracao)
        where += ` AND l.tipo <> 'apuracao' AND NOT EXISTS (SELECT 1 FROM lancamento_contabil a
                    WHERE a.id = l.estornado_lancamento_contabil_id AND a.tipo = 'apuracao')`;
      const centro = f.porCentro ? 'p.centro_custo_id' : 'NULL';
      const linhas = await l.consultar(
        `SELECT cc.classificacao AS conta, ${centro} AS centro,
                ${CENTAVOS("SUM(CASE WHEN p.lado = 'debito' THEN p.valor ELSE 0 END)")} AS debitos,
                ${CENTAVOS("SUM(CASE WHEN p.lado = 'credito' THEN p.valor ELSE 0 END)")} AS creditos
           FROM partida_contabil p
           JOIN lancamento_contabil l ON l.id = p.lancamento_contabil_id
           JOIN conta_contabil cc ON cc.id = p.conta_contabil_id
          WHERE l.estabelecimento_id = ? AND l.excluido_em IS NULL AND p.excluido_em IS NULL AND l.data_lancamento <= ?${where}
          GROUP BY cc.classificacao${f.porCentro ? ', p.centro_custo_id' : ''}
          ORDER BY cc.classificacao LIMIT ?`,
        [...p, teto + 1],
        { teto: teto + 1 },
      );
      return {
        itens: linhas.slice(0, teto).map((r) => ({
          conta: texto(r['conta']),
          centroCusto: numOuNulo(r['centro']),
          debitos: num(r['debitos']),
          creditos: num(r['creditos']),
        })),
        parcial: linhas.length > teto,
      };
    });
  }

  apuracoes(c: ContextoContabil, empresa: number, exercicio: number) {
    return this.lerEmpresa(c, empresa, { ativa: null as number | null, quantidade: 0 }, async (l, est) => {
      const r = await l.consultar(
        `SELECT l.id, (SELECT e.id FROM lancamento_contabil e WHERE e.estornado_lancamento_contabil_id = l.id
                         AND e.excluido_em IS NULL LIMIT 1) AS estorno
           FROM lancamento_contabil l
          WHERE l.estabelecimento_id = ? AND l.excluido_em IS NULL AND l.tipo = 'apuracao' AND YEAR(l.data_lancamento) = ?
          ORDER BY l.id`,
        [est, exercicio],
      );
      const ativa = [...r].reverse().find((x) => x['estorno'] === null || x['estorno'] === undefined);
      return { ativa: ativa ? num(ativa['id']) : null, quantidade: r.length };
    });
  }

  private static async doDiario(l: Leitor, linhas: Linha[]): Promise<LancamentoDoDiario[]> {
    const partidas = await PortaContabilPropria.partidasDe(
      l,
      linhas.map((r) => num(r['id'])),
    );
    return linhas.map((r) => {
      const x = lancamentoDe(r);
      return {
        id: x.id,
        data: x.data,
        tipo: x.tipo,
        historico: x.historico,
        debitos: x.debitos,
        creditos: x.creditos,
        estornaId: x.estornaId,
        encerramento: x.tipo === 'apuracao' || (x.tipo === 'estorno' && r['tipo_estornado'] === 'apuracao'),
        partidas: (partidas.get(x.id) ?? []).map((p) => ({
          lancamento: p.lancamento,
          lado: p.lado,
          conta: p.conta,
          valorCentavos: p.valorCentavos,
          centroCusto: p.centroCusto,
          historico: p.historico,
        })),
      };
    });
  }

  diario(
    c: ContextoContabil,
    empresa: number,
    de: string,
    ate: string,
    teto: number,
    pagina: number,
  ): Promise<DiarioPorta> {
    return this.lerEmpresa(
      c,
      empresa,
      { lancamentos: [], porTipo: [], parcial: false } as DiarioPorta,
      async (l, est) => {
        const linhas = await l.consultar(
          `${SQL_LANCAMENTOS} AND l.data_lancamento BETWEEN ? AND ? ORDER BY l.data_lancamento, l.id LIMIT ? OFFSET ?`,
          [est, de, ate, teto + 1, (Math.max(1, pagina) - 1) * teto],
          { teto: teto + 1 },
        );
        const porTipo = (
          await l.consultar(
            `SELECT l.tipo, COUNT(DISTINCT l.id) AS n,
                  ${CENTAVOS("SUM(CASE WHEN p.lado = 'debito' THEN p.valor ELSE 0 END)")} AS debitos,
                  ${CENTAVOS("SUM(CASE WHEN p.lado = 'credito' THEN p.valor ELSE 0 END)")} AS creditos
             FROM lancamento_contabil l JOIN partida_contabil p ON p.lancamento_contabil_id = l.id AND p.excluido_em IS NULL
            WHERE l.estabelecimento_id = ? AND l.excluido_em IS NULL AND l.data_lancamento BETWEEN ? AND ?
            GROUP BY l.tipo ORDER BY l.tipo`,
            [est, de, ate],
          )
        ).map((r) => ({
          tipo: texto(r['tipo']) as TipoLancamento,
          lancamentos: num(r['n']),
          debitos: num(r['debitos']),
          creditos: num(r['creditos']),
        }));
        return {
          lancamentos: await PortaContabilPropria.doDiario(l, linhas.slice(0, teto)),
          porTipo,
          parcial: linhas.length > teto,
        };
      },
    );
  }

  lancamentosDoExercicio(c: ContextoContabil, empresa: number, exercicio: number, tetoPartidas: number) {
    return this.lerEmpresa(
      c,
      empresa,
      { lancamentos: [] as LancamentoDoDiario[], parcial: false },
      async (l, est) => {
        const n = num(
          (
            await l.uma(
              `SELECT COUNT(*) AS n FROM partida_contabil p JOIN lancamento_contabil l ON l.id = p.lancamento_contabil_id
              WHERE l.estabelecimento_id = ? AND l.excluido_em IS NULL AND p.excluido_em IS NULL AND YEAR(l.data_lancamento) = ?`,
              [est, exercicio],
            )
          )?.['n'],
        );
        // Acima do teto, nada é cortado: a parte que chama recusa (o arquivo sai inteiro ou não sai).
        if (n > tetoPartidas) return { lancamentos: [], parcial: true };
        const linhas = await l.consultar(
          `${SQL_LANCAMENTOS} AND YEAR(l.data_lancamento) = ? ORDER BY l.data_lancamento, l.id`,
          [est, exercicio],
          { teto: Math.max(1, tetoPartidas) },
        );
        return { lancamentos: await PortaContabilPropria.doDiario(l, linhas), parcial: false };
      },
    );
  }

  empresaSped(c: ContextoContabil, empresa: number): Promise<EmpresaSped | null> {
    return this.lerEmpresa(c, empresa, null as EmpresaSped | null, async (l, est) => {
      const r = await l.uma(
        `SELECT e.id, e.razao_social, e.cnpj, e.inscricao_estadual, e.inscricao_municipal, e.logradouro, e.numero,
                e.complemento, e.bairro_nome, e.cep, e.telefone, e.email, m.codigo_ibge, m.nome AS municipio, uf.sigla AS uf
           FROM estabelecimento e
           LEFT JOIN municipio_ibge m ON m.id = e.municipio_ibge_id
           LEFT JOIN unidade_federativa uf ON uf.id = m.unidade_federativa_id
          WHERE e.id = ? AND e.excluido_em IS NULL`,
        [est],
      );
      if (!r) return null;
      return {
        codigo: est,
        nome: texto(r['razao_social']),
        cnpj: textoOuNulo(r['cnpj']),
        uf: textoOuNulo(r['uf']),
        inscricaoEstadual: textoOuNulo(r['inscricao_estadual']),
        codigoMunicipio: textoOuNulo(r['codigo_ibge']),
        municipio: textoOuNulo(r['municipio']),
        inscricaoMunicipal: textoOuNulo(r['inscricao_municipal']),
        nire: null,
        dataNire: null,
        endereco: textoOuNulo(r['logradouro']),
        numero: textoOuNulo(r['numero']),
        complemento: textoOuNulo(r['complemento']),
        bairro: textoOuNulo(r['bairro_nome']),
        cep: textoOuNulo(r['cep']),
        telefone: textoOuNulo(r['telefone']),
        email: textoOuNulo(r['email']),
        cnae: null,
      };
    });
  }

  arquivosSped(c: ContextoContabil, empresa: number, teto: number) {
    return this.lerEmpresa(c, empresa, [] as ArquivoSpedRegistrado[], async (l, est) =>
      (
        await l.consultar(`${SQL_ARQUIVOS_SPED} ORDER BY s.exercicio DESC, s.id DESC LIMIT ?`, [est, teto])
      ).map((r) => arquivoSpedDe(r, est)),
    );
  }

  /** O conteúdo cifrado do arquivo SPED, lido do armazém pela chave guardada na tabela arquivo. */
  conteudoSped(
    c: ContextoContabil,
    empresa: number,
    id: number,
  ): Promise<(ArquivoSpedRegistrado & { conteudoCifrado: string }) | null> {
    return this.lerEmpresa(c, empresa, null, async (l, est) => {
      const r = await l.uma(`${SQL_ARQUIVOS_SPED} AND s.id = ?`, [est, id]);
      if (!r) return null;
      const armazem = this.armazemSped;
      if (!armazem) throw armazemIndisponivel();
      const chave = textoOuNulo(r['chave_armazenamento']);
      const bytes = chave === null ? null : await armazem.ler(chave);
      if (bytes === null)
        throw new ErroOperacao(
          410,
          'arquivo-ausente',
          'Arquivo ausente',
          'O conteúdo do arquivo SPED não está no armazém.',
        );
      return { ...arquivoSpedDe(r, est), conteudoCifrado: Buffer.from(bytes).toString('utf8') };
    });
  }

  async gravar<T>(
    c: ContextoContabil,
    pedido: PedidoDeGravacao,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorContabil) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    if (!/^contabil\.[A-Za-z]{3,60}$/.test(pedido.operacao))
      throw new Error(
        `Operação de gravação da contabilidade sem nome válido: ${pedido.operacao.slice(0, 80)}.`,
      );
    // contabil.incluirConta → contabil.incluir_conta (o nome da operação no banco é minúsculo).
    const nome = pedido.operacao.replace(/[A-Z]/g, (x) => `_${x.toLowerCase()}`);
    let saida: { valor: T } | null = null;
    const linha = (): TrilhaDaGravacao => {
      if (typeof trilha !== 'function') return trilha;
      if (!saida) throw new Error('Gravação da contabilidade sem resultado para a trilha.');
      return trilha(saida.valor);
    };
    const armazemSped = this.armazemSped;
    const op = definirOperacao({
      nome,
      tabelas: TABELAS_GRAVACAO,
      // O hash do pedido: a mesma chave com outro pedido é recusada pelo Executor (idempotencia-divergente).
      entrada: z.object({ pedido: z.string().regex(/^[0-9a-f]{64}$/) }),
      async gravar(tx) {
        try {
          const { gravador, concluir } = gravadorSobre(tx, est, c.gravaPlanoDaRede === true, armazemSped);
          const valor = await fn(gravador);
          await concluir();
          saida = { valor };
          return { valor: JSON.stringify(valor ?? null) } as ResultadoOperacao;
        } catch (e) {
          const v = restricaoViolada(e);
          if (v) throw recusa('restricao-violada', mensagemDaRestricao(v.nome));
          throw e;
        }
      },
      alvo: () => {
        const l = linha();
        return { tabela: l.entidade, id: l.entidadeId ?? null };
      },
      trilha: () => ({ dados: linha().dadosDepois ?? null, motivo: linha().motivo ?? null }),
    });
    // Sem a Idempotency-Key da tela, uma chave nova por pedido (o lançamento tem a própria chave idempotente).
    const chave = c.chaveIdempotencia ?? `contabil:${randomUUID()}`;
    const entrada = { pedido: createHash('sha256').update(jsonCanonico(pedido.pedido)).digest('hex') };
    const r = await this.executor.executar(op, c.cliente, entrada, {
      ...contextoDe(c),
      chaveIdempotencia: chave,
    });
    if (!r.repetida) {
      if (!saida) throw new Error('Gravação da contabilidade sem resultado.');
      return (saida as { valor: T }).valor;
    }
    return repetidaDe<T>(r.resultado['valor']);
  }
}

/** JSON com as chaves em ordem (o mesmo pedido dá o mesmo hash). */
function jsonCanonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${jsonCanonico((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** Restrição do banco → mensagem de negócio (sem nome de coluna). */
function mensagemDaRestricao(nome: string | null): string {
  const n = nome ?? '';
  if (n.includes('conta_contabil_plano')) return 'Já existe uma conta com este código no plano.';
  if (n.includes('conciliacao_conta_contabil_conta_periodo'))
    return 'A conta já tem uma conciliação ativa nesta competência: desfaça-a para conciliar de novo.';
  if (n.includes('lancamento_contabil_estornado')) return 'O lançamento já foi estornado.';
  if (n.includes('periodo_contabil')) return 'Período contábil inconsistente: confira a competência.';
  return 'A gravação viola uma regra do cadastro contábil.';
}

/** As gravações da contabilidade dentro da transação da operação. */
function gravadorSobre(
  tx: TxOperacao,
  est: number,
  gravaPlanoDaRede: boolean,
  armazemSped: ArmazemArquivoSped | null,
): { gravador: GravadorContabil; concluir: () => Promise<void> } {
  const usuario = tx.contexto.usuario;
  // O núcleo comum da gravação contábil (o mesmo do worker): plano vigente, período travado, situação do fato e
  // lançamento, com a conferência final de que todo fato marcado como contabilizado ganhou o lançamento automático.
  const base = gravacaoDosFatos(tx, est);
  const { plano, travarPeriodo, exigirEmpresa, concluir } = base;
  /** O plano é da rede: sem a permissão do plano da rede, só grava no plano usado apenas por este estabelecimento. */
  const exigirPlanoGravavel = async (p: number) => {
    if (gravaPlanoDaRede) return;
    const r = await tx.uma(
      `SELECT (SELECT COUNT(*) FROM periodo_contabil WHERE plano_contas_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL) AS proprios,
              (SELECT COUNT(*) FROM periodo_contabil WHERE plano_contas_id = ? AND estabelecimento_id <> ? AND excluido_em IS NULL) AS outros`,
      [p, est, p, est],
    );
    if (num(r?.['proprios']) === 0 || num(r?.['outros']) > 0)
      throw new ErroOperacao(
        403,
        'plano-da-rede',
        'Sem permissão',
        'O plano de contas é compartilhado pela rede: incluir ou alterar conta exige a permissão do plano da rede.',
      );
  };
  const exigirUsuario = () => {
    if (usuario === null) throw recusa('sem-usuario', 'A operação exige um usuário identificado.');
    return usuario;
  };
  const contaPorCodigo = async (p: number, codigo: string, travar = false) => {
    const sql = `${SQL_CONTAS} AND c.classificacao = ?`;
    const [r] = travar
      ? await tx.consultarParaAtualizar(sql, [p, codigo], { teto: 1 })
      : await tx.consultar(sql, [p, codigo], { teto: 1 });
    return r ?? null;
  };
  const referencial = async (tipo: number | null, codigo: string | null) => {
    if (codigo === null) return null;
    const r = await tx.uma(
      // conta_referencial é catálogo da Receita, sem exclusão lógica: vale a vigência.
      `SELECT id FROM conta_referencial WHERE codigo_referencial = ? AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
         ${tipo !== null ? 'AND plano_referencial_id = ?' : ''} ORDER BY vigencia_inicio DESC LIMIT 1`,
      [codigo, ...(tipo !== null ? [tipo] : [])],
    );
    if (!r)
      throw recusa(
        'conta-referencial-inexistente',
        'A conta referencial informada não existe no plano referencial.',
      );
    return num(r['id']);
  };
  const periodosLidos = async () =>
    (await tx.consultar(`${SQL_PERIODOS} ORDER BY p.competencia`, [est])).map((r) => periodoDe(r, est));
  const conciliacaoLida = async (id: number) => {
    const r = await tx.uma(`${SQL_CONCILIACOES} AND k.id = ?`, [est, id]);
    if (!r) throw recusa('conciliacao-inexistente', 'A conciliação não existe neste estabelecimento.');
    return conciliacaoDe(r, est);
  };
  const arquivoLido = async (id: number) => {
    const r = await tx.uma(`${SQL_ARQUIVOS_SPED} AND s.id = ?`, [est, id]);
    if (!r) throw recusa('arquivo-inexistente', 'O arquivo SPED não existe neste estabelecimento.');
    return arquivoSpedDe(r, est);
  };

  /** O evento do tipo de fato (catálogo da rede); o evento nativo é criado na primeira regra publicada para o tipo. */
  const eventoDoTipo = async (tipo: string): Promise<number> => {
    const e = await tx.uma('SELECT id FROM evento_contabil WHERE codigo = ?', [tipo]);
    if (e) return num(e['id']);
    const def = (TIPOS_FATO as Readonly<Record<string, { origem: number; rotulo: string }>>)[tipo];
    if (!def) throw recusa('tipo-fato-inexistente', 'O tipo de fato da regra não existe.');
    return tx.incluir('evento_contabil', {
      codigo: tipo,
      descricao: def.rotulo,
      modulo: MODULO_DA_ORIGEM[def.origem] ?? 'contabilidade',
      nativo: true,
    });
  };

  const gravador: GravadorContabil = {
    marcarSituacao: (x) => base.marcarSituacao(x),
    gravarLancamento: (l: LancamentoParaGravar) => base.gravarLancamento(l),
    async incluirConta(x) {
      exigirEmpresa(x.conta.empresa);
      const p = await plano();
      await exigirPlanoGravavel(p);
      if (await contaPorCodigo(p, x.conta.codigo))
        throw recusa('conta-ja-existe', 'Já existe uma conta com este código no plano.');
      const partes = x.conta.codigo.split('.');
      const codigoPai = partes.slice(0, -1).join('.');
      const pai = codigoPai ? await contaPorCodigo(p, codigoPai) : null;
      if (codigoPai && !pai)
        throw recusa('conta-sem-superior', `A conta superior ${codigoPai} não existe no plano.`);
      if (pai && pai['tipo'] !== 'sintetica')
        throw recusa('superior-analitica', 'A conta superior é analítica: não aceita contas abaixo.');
      const id = await tx.incluir('conta_contabil', {
        plano_contas_id: p,
        classificacao: x.conta.codigo,
        codigo_reduzido: x.conta.codigo.replace(/\./g, '').slice(-15),
        descricao: x.conta.nome,
        conta_pai_id: pai ? num(pai['id']) : null,
        nivel: partes.length,
        natureza: NATUREZA_DO_GRUPO[x.conta.grupo],
        natureza_saldo: x.conta.natureza,
        tipo: x.conta.tipo,
        conta_referencial_id: await referencial(x.conta.referencialTipo, x.conta.referencialConta),
        exige_centro_custo: x.conta.exigeCentroCusto,
        ativo: x.conta.ativa,
      });
      return { id, versao: 1 };
    },
    async alterarConta(x) {
      exigirEmpresa(x.empresa);
      const p = await plano();
      await exigirPlanoGravavel(p);
      const r = await contaPorCodigo(p, x.codigo, true);
      if (!r) throw recusa('conta-inexistente', 'A conta não existe no plano.');
      const antes = contaDe(r, est);
      if (antes.versao !== x.versao) throw erroConflitoVersao(['versao']);
      const versao = await tx.alterar('conta_contabil', num(r['id']), antes.versao, {
        descricao: x.depois.nome,
        conta_referencial_id: await referencial(x.depois.referencialTipo, x.depois.referencialConta),
        exige_centro_custo: x.depois.exigeCentroCusto,
        ativo: x.depois.ativa,
      });
      return { antes, versao };
    },
    async publicarRegra(x) {
      const r = x.regra;
      exigirEmpresa(r.empresa);
      const publicador = exigirUsuario();
      const evento = await eventoDoTipo(r.tipoFato);
      const repetida = await tx.uma(
        `SELECT id FROM versao_regra_contabil WHERE estabelecimento_id = ? AND evento_contabil_id = ? AND nome = ?
           AND numero_versao = ?`,
        [est, evento, r.nome, r.versao],
      );
      if (repetida)
        throw recusa(
          'versao-concorrente',
          'Outra versão desta regra foi publicada agora. Abra de novo e confira antes de publicar.',
        );
      const id = await tx.incluir('versao_regra_contabil', {
        estabelecimento_id: est,
        evento_contabil_id: evento,
        nome: r.nome,
        numero_versao: r.versao,
        prioridade: r.prioridade,
        vigencia_inicio: r.vigenciaInicio,
        vigencia_fim: r.vigenciaFim,
        conteudo: x.conteudo,
        impressao: x.impressao,
        justificativa: x.justificativa.slice(0, 500),
        situacao: 'publicada',
        publicada_em: new Date(),
        publicador_usuario_id: publicador,
      });
      return { id, versao: r.versao };
    },
    async encerrarPeriodo(x) {
      exigirEmpresa(x.empresa);
      const encerrante = exigirUsuario();
      const periodo = await travarPeriodo(x.competencia, false);
      const [lido] = (await tx.consultar(`${SQL_PERIODOS} AND p.id = ?`, [est, periodo.id])).map((r) =>
        periodoDe(r, est),
      );
      const fatos = await PortaContabilPropria['fatosPorSituacao'](tx, est, x.competencia);
      const tipos = await PortaContabilPropria['totaisPorTipo'](tx, est, x.competencia);
      const anterior = competenciaAnterior(x.competencia);
      const pa = await tx.uma(
        `SELECT p.situacao,
                (SELECT COUNT(*) FROM lancamento_contabil l WHERE l.periodo_contabil_id = p.id AND l.excluido_em IS NULL) +
                (SELECT COUNT(*) FROM fato_contabil f WHERE f.estabelecimento_id = p.estabelecimento_id
                   AND f.competencia = p.competencia AND f.excluido_em IS NULL) AS movimento
           FROM periodo_contabil p WHERE p.estabelecimento_id = ? AND p.competencia = ? AND p.excluido_em IS NULL`,
        [est, diaUm(anterior)],
      );
      const d: DadosDoEncerramento = {
        periodo: lido!,
        fatos,
        lancamentos: tipos.reduce((s, t) => s + t.lancamentos, 0),
        debitos: tipos.reduce((s, t) => s + t.debitos, 0),
        creditos: tipos.reduce((s, t) => s + t.creditos, 0),
        anteriorAbertaComMovimento:
          pa && pa['situacao'] !== 'encerrado' && num(pa['movimento']) > 0 ? anterior : null,
      };
      const impedimentos = x.conferir(d);
      if (impedimentos.length)
        throw recusa(
          'encerramento-impedido',
          `O período não pode ser encerrado: ${impedimentos.map((i) => (typeof i === 'string' ? i : JSON.stringify(i))).join(' ')}`,
        );
      if (lido!.situacao === 'encerrado') throw recusa('periodo-encerrado', 'O período já está encerrado.');
      await tx.alterar('periodo_contabil', periodo.id, periodo.versao, {
        situacao: 'encerrado',
        encerrado_em: new Date(),
        encerrante_usuario_id: encerrante,
      });
      return d;
    },
    async reabrirPeriodo(x) {
      exigirEmpresa(x.empresa);
      const quem = exigirUsuario();
      const periodo = await travarPeriodo(x.competencia, false);
      const periodos = await periodosLidos();
      const motivo = x.conferir(periodos);
      if (motivo) throw recusa('reabertura-recusada', motivo);
      const antes = periodos.find((p) => p.competencia === x.competencia.slice(0, 7))!;
      await tx.alterar('periodo_contabil', periodo.id, periodo.versao, {
        situacao: 'aberto',
        reaberto_em: new Date(),
        reabertura_usuario_id: quem,
        justificativa_reabertura: x.justificativa.slice(0, 500),
      });
      return antes;
    },
    async conciliar(x) {
      exigirEmpresa(x.empresa);
      const responsavel = exigirUsuario();
      if (x.partidas.length === 0) throw recusa('conciliacao-vazia', 'Escolha as partidas a conciliar.');
      const p = await plano();
      const achadas = await tx.consultarParaAtualizar(
        `SELECT p.id, cc.classificacao, cc.id AS conta_id, p.lado, ${CENTAVOS('p.valor')} AS centavos,
                p.conciliacao_conta_contabil_id, l.periodo_contabil_id, l.data_lancamento
           FROM partida_contabil p
           JOIN lancamento_contabil l ON l.id = p.lancamento_contabil_id
           JOIN conta_contabil cc ON cc.id = p.conta_contabil_id
          WHERE p.id IN (${lista(x.partidas.length)}) AND l.estabelecimento_id = ? AND cc.plano_contas_id = ?
            AND p.excluido_em IS NULL AND l.excluido_em IS NULL
          ORDER BY p.id`,
        [...x.partidas, est, p],
        { teto: x.partidas.length },
      );
      const lidas: PartidaParaConciliacao[] = achadas.map((r) => ({
        id: num(r['id']),
        empresa: est,
        conta: texto(r['classificacao']),
        lado: ladoDe(r['lado']),
        valorCentavos: num(r['centavos']),
        conciliacao: numOuNulo(r['conciliacao_conta_contabil_id']),
      }));
      const problemas = x.conferir(lidas);
      if (problemas.length) throw recusa('conciliacao-recusada', problemas.join(' '));
      const conta = await contaPorCodigo(p, x.conta);
      if (!conta) throw recusa('conta-inexistente', 'A conta não existe no plano.');
      const ultima = [...achadas]
        .sort((a, b) => String(a['data_lancamento']).localeCompare(String(b['data_lancamento'])))
        .pop()!;
      const valor = lidas.filter((y) => y.lado === 'D').reduce((s, y) => s + y.valorCentavos, 0);
      const valores = {
        saldo_contabil: reais(valor),
        saldo_composicao: reais(valor),
        diferenca: '0.00',
        situacao: 'conciliada',
        responsavel_usuario_id: responsavel,
        concluido_em: new Date(),
        justificativa: corta(x.observacao, 1000),
      };
      const reaberta = await tx.uma(
        `SELECT id, versao FROM conciliacao_conta_contabil WHERE estabelecimento_id = ? AND conta_contabil_id = ?
            AND periodo_contabil_id = ? AND situacao = 'reaberta' AND excluido_em IS NULL`,
        [est, num(conta['id']), num(ultima['periodo_contabil_id'])],
      );
      let id: number;
      if (reaberta) {
        id = num(reaberta['id']);
        await tx.alterar('conciliacao_conta_contabil', id, num(reaberta['versao']), valores);
      } else
        id = await tx.incluir('conciliacao_conta_contabil', {
          estabelecimento_id: est,
          conta_contabil_id: num(conta['id']),
          periodo_contabil_id: num(ultima['periodo_contabil_id']),
          ...valores,
        });
      await tx.executar(
        `UPDATE partida_contabil SET conciliacao_conta_contabil_id = ?, versao = versao + 1, alterado_em = ?, alterado_por = ?
          WHERE id IN (${lista(x.partidas.length)})`,
        [id, new Date(), usuario, ...x.partidas],
      );
      return { id, valor };
    },
    async desfazerConciliacao(x) {
      exigirEmpresa(x.empresa);
      exigirUsuario();
      const antes = await conciliacaoLida(x.id);
      if (antes.situacao === 'desfeita')
        throw recusa('conciliacao-desfeita', 'A conciliação já foi desfeita.');
      const v = await tx.uma('SELECT versao FROM conciliacao_conta_contabil WHERE id = ?', [x.id]);
      await tx.executar(
        `UPDATE partida_contabil SET conciliacao_conta_contabil_id = NULL, versao = versao + 1, alterado_em = ?, alterado_por = ?
          WHERE conciliacao_conta_contabil_id = ?`,
        [new Date(), usuario, x.id],
      );
      await tx.alterar('conciliacao_conta_contabil', x.id, num(v?.['versao']), {
        situacao: 'reaberta',
        justificativa: x.justificativa.slice(0, 1000),
      });
      return conciliacaoLida(x.id);
    },
    async gravarArquivoSped(x) {
      exigirEmpresa(x.empresa);
      const gerador = exigirUsuario();
      if (!armazemSped) throw armazemIndisponivel();
      if (x.parametros.length > 400)
        throw recusa('parametros-longos', 'Os parâmetros da geração não cabem no registro.');
      const inicio = `${x.exercicio}-01-01`;
      // Os envios do mesmo exercício, travados: o número do envio e a substituição saem da mesma leitura.
      const envios = await tx.consultarParaAtualizar(
        `SELECT s.id, s.sequencia_envio, s.situacao,
                (SELECT COUNT(*) FROM arquivo_sped_contabil n WHERE n.arquivo_substituido_id = s.id AND n.excluido_em IS NULL
                   AND n.situacao <> 'cancelado') AS substituido
           FROM arquivo_sped_contabil s
          WHERE s.estabelecimento_id = ? AND s.tipo_escrituracao = ? AND s.exercicio = ? AND s.excluido_em IS NULL
          ORDER BY s.sequencia_envio DESC`,
        [est, x.tipo, x.exercicio],
        { teto: 1000 },
      );
      // O número do envio e a substituição saem da regra do domínio (a mesma da porta de memória).
      const plano = planejarEnvioSped(
        envios.map((e) => ({
          id: num(e['id']),
          numero: num(e['sequencia_envio']),
          situacao: texto(e['situacao']) as 'gerado' | 'transmitido' | 'cancelado',
          substituido: num(e['substituido']) > 0,
        })),
        x.substituta,
      );
      if (!plano.ok)
        throw recusa(plano.motivo, 'A escrituração substituta exige um envio anterior do mesmo exercício.');
      const numero = plano.numero;
      const id = await tx.incluir('arquivo_sped_contabil', {
        estabelecimento_id: est,
        tipo_escrituracao: x.tipo,
        exercicio: x.exercicio,
        periodo_inicio: inicio,
        periodo_fim: `${x.exercicio}-12-31`,
        sequencia_envio: numero,
        finalidade: x.substituta ? 'substituta' : 'original',
        leiaute: x.leiaute.slice(0, 10),
        quantidade_linhas: x.linhas,
        parametros: x.parametros,
        arquivo_substituido_id: plano.substituidoId,
        hash_sha256: x.hash,
        situacao: 'gerado',
        gerado_em: new Date(),
        gerador_usuario_id: gerador,
      });
      const bytes = Buffer.from(x.conteudoCifrado, 'utf8');
      const hashGuardado = createHash('sha256').update(bytes).digest('hex');
      const chave = `contabil/sped/estabelecimento-${est}/${x.exercicio}/${x.tipo}-${numero}-${id}-${hashGuardado.slice(0, 16)}.txt`;
      await armazemSped.guardar(chave, bytes);
      const arquivo = await tx.incluir('arquivo', {
        estabelecimento_id: est,
        entidade: 'arquivo_sped_contabil',
        entidade_id: id,
        finalidade: 'escrituracao_sped',
        nome_original: x.nomeArquivo.slice(0, 255),
        tipo_mime: 'text/plain',
        tamanho_bytes: bytes.length,
        hash_sha256: hashGuardado,
        chave_armazenamento: chave,
        imutavel: true,
      });
      await tx.executar('UPDATE arquivo_sped_contabil SET arquivo_id = ? WHERE id = ?', [arquivo, id]);
      return { id, numero, substituidos: plano.substituiPendente ? 1 : 0 };
    },
    async situacaoArquivoSped(x) {
      exigirEmpresa(x.empresa);
      const antes = await arquivoLido(x.id);
      if (antes.situacao === 'cancelado') throw recusa('arquivo-cancelado', 'O arquivo já está cancelado.');
      const v = await tx.uma('SELECT versao FROM arquivo_sped_contabil WHERE id = ?', [x.id]);
      await tx.alterar(
        'arquivo_sped_contabil',
        x.id,
        num(v?.['versao']),
        x.acao === 'recibo'
          ? {
              situacao: 'transmitido',
              recibo: x.recibo,
              transmitido_em: x.transmitidoEm ? new Date(x.transmitidoEm) : new Date(),
            }
          : { situacao: 'cancelado', mensagem_validacao: x.motivo },
      );
      return arquivoLido(x.id);
    },
  };
  return { gravador, concluir };
}

/** Fora de dev/ci sem o núcleo: 503 em tudo (falha fechada). */
export function portaContabilIndisponivel(): PortaContabil {
  return portaIndisponivel<PortaContabil>(METODOS_PORTA_CONTABIL);
}
