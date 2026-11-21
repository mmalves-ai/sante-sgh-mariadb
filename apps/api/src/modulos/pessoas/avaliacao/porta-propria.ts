// Porta PRÓPRIA da avaliação de desempenho (W0-06, parte 5; F2.2 lote 03-02) sobre o MariaDB do cliente, pelo
// @sgh/nucleo: ciclo_avaliacao (com o modelo_avaliacao, que dá o tipo e a escala), avaliacao_desempenho e
// avaliacao_desempenho_item (as notas por critério_avaliacao), mais as leituras de vinculo_trabalho, colaborador,
// setor_funcional e usuario. Leituras somente leitura no estabelecimento da sessão; gravações numa operação do Executor
// (gravacaoDireta: trilha, outbox e idempotência na mesma transação), com o registro travado e conferido pela versão.
// Melhoria: a escala de notas e o tipo do ciclo vêm do modelo de avaliação cadastrado (FK), não de número solto no
// ciclo; sem o modelo com a escala pedida, a gravação recusa com `modelo-avaliacao-ausente`.
// Melhoria: a exclusão é lógica (excluido_em/excluido_por) e o retrato do registro vai na trilha da mesma operação.
// Melhoria: a correção (o valor anterior e o novo) e o motivo de cada mudança de situação vão na trilha da operação.
// Melhoria: o vínculo em experiência é o CLT pelo regime trabalhista do vínculo, sem desligamento.
// Melhoria: o nome do ciclo é único no estabelecimento, contando o excluído (a chave única do banco).
// Melhoria: o modelo do ciclo é escolhido sem ambiguidade (dois modelos vigentes do mesmo tipo e escala recusam com
// `modelo-avaliacao-ambiguo`); alterar o ciclo sem mudar tipo e escala mantém o modelo; mudar a escala de um ciclo que
// já tem avaliações recusa com `escala-com-avaliacoes` (os itens lançados são critérios do modelo atual).
// Melhoria: quem finalizou, quem deu ou registrou a ciência, o modo e a observação da ciência são lidos da trilha da
// própria operação (evento anotado pela porta), nunca deduzidos do último alterador nem do usuário do colaborador.
// Pendente (pedido em saida/03-02.json): as colunas finalizada_por_usuario_id, ciencia_por_usuario_id, ciencia_modo e
// ciencia_observacao em avaliacao_desempenho; até lá a trilha é a fonte (a ficha mostra nulo quando não há trilha).
// Pendente (pedido em docs/obra/fatias/f22/saida/03-02.json): o cadastro de competências por estabelecimento e a
// ligação competência-cargo, a abertura e a correção da avaliação (avaliador, marco de experiência, versão anterior), o
// modo e a observação da ciência, o motivo da situação do ciclo e o PDI. Essas gravações recusam com `modelo-pendente`.
// Como a ligação competência-cargo e o PDI não têm tabela, nada deles pode existir neste banco: a leitura é de fato
// vazia. As competências lidas são os critérios do tipo `competencia` dos modelos de avaliação do cliente.
import { ErroOperacao, recusa, type TxOperacao } from '@sgh/nucleo';
import { type AnotacaoGravacao, gravacaoDireta } from '../../enfermagem/gravacao-direta.js';
import type { GravacaoFeita, TrilhaDaGravacao } from '../../exames/public-api.js';
import {
  dataIso,
  instante,
  instanteN,
  type L,
  lerNoEstabelecimento,
  type Linha,
  modeloPendente,
  n,
  nn,
  type NucleoQualidade,
  paraBanco,
  relogioDoEstabelecimento,
  texto,
  textoN,
  verdadeiro,
} from '../../qualidade/apoio-propria.js';
import type {
  AlvoDependenciaAvaliacao,
  ContextoAvaliacao,
  GravadorAvaliacao,
  PortaAvaliacao,
} from './porta-avaliacao.js';
import type {
  AvaliacaoRegistrada,
  CicloRegistrado,
  CompetenciaDoCargo,
  CompetenciaRegistrada,
  CorrecaoRegistrada,
  DependenciaContada,
  NotaAvaliacao,
  PdiRegistrado,
  SituacaoCiclo,
  TipoCiclo,
  VinculoEmExperiencia,
} from './tipos.js';

/** As tabelas que a gravação da avaliação escreve (a transação recusa as outras). */
export const TABELAS_AVALIACAO = [
  'ciclo_avaliacao',
  'avaliacao_desempenho',
  'avaliacao_desempenho_item',
] as const;

/** O tipo do ciclo na tela e o tipo do modelo de avaliação no banco. */
const TIPO_DO_MODELO: Readonly<Record<TipoCiclo, string>> = {
  periodico: 'desempenho',
  experiencia: 'experiencia',
};
const tipoDoCiclo = (modelo: unknown): TipoCiclo =>
  (Object.entries(TIPO_DO_MODELO).find(([, m]) => m === modelo)?.[0] ?? 'periodico') as TipoCiclo;

const PENDENTE_COMPETENCIA = 'O cadastro de competências do estabelecimento e a ligação delas ao cargo';
const PENDENTE_AVALIACAO =
  'A abertura e a correção da avaliação (avaliador, marco de experiência e versão anterior)';
const PENDENTE_PDI = 'O plano de desenvolvimento individual (PDI)';

const desatualizado = (o: string) =>
  new ErroOperacao(
    409,
    'desatualizado',
    'Operação recusada',
    `${o} mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.`,
  );
const pendente = (o: string) => Promise.reject(modeloPendente(o));

const SQL_CICLO = `
  SELECT ca.id, ca.nome, m.tipo AS tipo_modelo, ca.periodo_inicio, ca.periodo_fim, ca.prazo_avaliacao, m.escala_maxima,
         ca.situacao, ca.versao, COALESCE(ca.alterado_em, ca.criado_em) AS alterado_em,
         COALESCE(ua.login, uc.login) AS alterado_por
    FROM ciclo_avaliacao ca
    JOIN modelo_avaliacao m ON m.id = ca.modelo_avaliacao_id
    LEFT JOIN usuario ua ON ua.id = ca.alterado_por
    LEFT JOIN usuario uc ON uc.id = ca.criado_por
   WHERE ca.estabelecimento_id = ? AND ca.excluido_em IS NULL`;

function cicloDe(r: Linha): CicloRegistrado {
  return {
    id: n(r['id']),
    nome: texto(r['nome']),
    tipo: tipoDoCiclo(r['tipo_modelo']),
    inicio: dataIso(r['periodo_inicio']) ?? '',
    fim: dataIso(r['periodo_fim']) ?? '',
    prazo: dataIso(r['prazo_avaliacao']) as CicloRegistrado['prazo'],
    notaMax: n(r['escala_maxima']),
    // O ciclo planejado (vindo da migração) é o aberto para a tela: ainda recebe avaliação.
    situacao: (r['situacao'] === 'planejado' ? 'aberto' : texto(r['situacao'])) as SituacaoCiclo,
    motivoSituacao: null,
    versao: n(r['versao']),
    alteradoPor: texto(r['alterado_por']),
    alteradoEm: instante(r['alterado_em']),
  };
}

// O vínculo de trabalho do colaborador avaliado no estabelecimento (o mais recente).
const SQL_AVALIACAO = `
  SELECT a.id, a.ciclo_avaliacao_id, a.situacao, a.comentario, a.concluida_em, a.ciencia_colaborador_em, a.versao,
         a.criado_em, c.nome AS colaborador, COALESCE(uav.login, av.nome) AS avaliador, uc.login AS criado_por,
         uf.login AS finalizada_por, ucn.login AS ciencia_por,
         JSON_VALUE(tc.dados_depois, '$.dados.cienciaModo') AS ciencia_modo,
         JSON_VALUE(tc.dados_depois, '$.dados.cienciaObservacao') AS ciencia_observacao, vt.id AS vinculo, vt.cargo_id
    FROM avaliacao_desempenho a
    JOIN colaborador c ON c.id = a.colaborador_id
    JOIN colaborador av ON av.id = a.avaliador_colaborador_id
    LEFT JOIN usuario uav ON uav.id = av.usuario_id
    LEFT JOIN usuario uc ON uc.id = a.criado_por
    LEFT JOIN trilha_auditoria tf ON tf.id = (
      SELECT MAX(t.id) FROM trilha_auditoria t
       WHERE t.entidade = 'avaliacao_desempenho' AND t.entidade_id = a.id AND t.estabelecimento_id = a.estabelecimento_id
         AND JSON_VALUE(t.dados_depois, '$.dados.avaliacaoEvento') = 'finalizacao')
    LEFT JOIN usuario uf ON uf.id = tf.usuario_id
    LEFT JOIN trilha_auditoria tc ON tc.id = (
      SELECT MAX(t.id) FROM trilha_auditoria t
       WHERE t.entidade = 'avaliacao_desempenho' AND t.entidade_id = a.id AND t.estabelecimento_id = a.estabelecimento_id
         AND JSON_VALUE(t.dados_depois, '$.dados.avaliacaoEvento') = 'ciencia')
    LEFT JOIN usuario ucn ON ucn.id = tc.usuario_id
    LEFT JOIN vinculo_trabalho vt ON vt.id = (
      SELECT v2.id FROM vinculo_trabalho v2
       WHERE v2.colaborador_id = a.colaborador_id AND v2.estabelecimento_id = a.estabelecimento_id
         AND v2.excluido_em IS NULL
       ORDER BY v2.data_admissao DESC, v2.id DESC LIMIT 1)
   WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.situacao <> 'cancelada'`;

const modoDaCiencia = (v: unknown): 'proprio' | 'registrada' | null =>
  v === 'proprio' || v === 'registrada' ? v : null;

function avaliacaoDe(r: Linha): AvaliacaoRegistrada {
  const concluida = r['situacao'] === 'concluida';
  const ciente =
    concluida && r['ciencia_colaborador_em'] !== null && r['ciencia_colaborador_em'] !== undefined;
  return {
    id: n(r['id']),
    ciclo: n(r['ciclo_avaliacao_id']),
    vinculo: n(r['vinculo']),
    cargo: nn(r['cargo_id']),
    marco: null,
    avaliador: texto(r['avaliador']),
    numero: 1,
    anterior: null,
    motivoCorrecao: null,
    situacao: ciente ? 'ciente' : concluida ? 'finalizada' : 'rascunho',
    parecer: textoN(r['comentario']),
    // Quem finalizou e a ciência vêm da trilha da operação (nulo sem trilha, por ex. no dado migrado).
    finalizadaPor: concluida ? textoN(r['finalizada_por']) : null,
    finalizadaEm: instanteN(r['concluida_em']),
    cienciaPor: ciente ? textoN(r['ciencia_por']) : null,
    cienciaEm: ciente ? instanteN(r['ciencia_colaborador_em']) : null,
    cienciaModo: ciente ? modoDaCiencia(r['ciencia_modo']) : null,
    cienciaObs: ciente ? textoN(r['ciencia_observacao']) : null,
    versao: n(r['versao']),
    criadoPor: texto(r['criado_por']),
    criadoEm: instante(r['criado_em']),
    colaborador: texto(r['colaborador']),
    substituida: false,
  } as AvaliacaoRegistrada;
}

const SQL_COMPETENCIA = `
  SELECT cr.id, cr.nome, cr.descricao, cr.ativo, cr.versao, COALESCE(cr.alterado_em, cr.criado_em) AS alterado_em,
         COALESCE(ua.login, uc.login) AS alterado_por
    FROM criterio_avaliacao cr
    LEFT JOIN usuario ua ON ua.id = cr.alterado_por
    LEFT JOIN usuario uc ON uc.id = cr.criado_por
   WHERE cr.tipo = 'competencia' AND cr.excluido_em IS NULL`;

function competenciaDe(r: Linha): CompetenciaRegistrada {
  return {
    id: n(r['id']),
    nome: texto(r['nome']),
    descricao: textoN(r['descricao']),
    ativo: verdadeiro(r['ativo']),
    motivoSituacao: null,
    versao: n(r['versao']),
    alteradoPor: texto(r['alterado_por']),
    alteradoEm: instante(r['alterado_em']),
  };
}

/** O modelo de avaliação vigente do tipo do ciclo com a escala pedida (único), ou recusa. */
async function modeloDoCiclo(l: L, tipo: TipoCiclo, notaMax: number, dia: string): Promise<number> {
  const rs = await l.consultar<{ id: number }>(
    `SELECT id FROM modelo_avaliacao
      WHERE tipo = ? AND escala_maxima = ? AND ativo = TRUE AND vigencia_inicio <= ?
        AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
      ORDER BY id LIMIT 2`,
    [TIPO_DO_MODELO[tipo], notaMax, dia, dia],
    { teto: 2 },
  );
  if (rs.length > 1)
    throw recusa(
      'modelo-avaliacao-ambiguo',
      `Há mais de um modelo de avaliação vigente do tipo ${tipo} com a escala até ${notaMax}: peça ao RH que deixe um só vigente.`,
      { campos: ['notaMax'] },
    );
  const r = rs[0];
  if (!r)
    throw recusa(
      'modelo-avaliacao-ausente',
      `Não há modelo de avaliação vigente do tipo ${tipo} com a escala até ${notaMax}: peça ao RH que cadastre o modelo antes de abrir o ciclo.`,
      { campos: ['notaMax'] },
    );
  return Number(r.id);
}

async function semNomeRepetido(l: L, est: number, nome: string, outro: number | null): Promise<void> {
  const r = await l.uma<{ id: number }>(
    'SELECT id FROM ciclo_avaliacao WHERE estabelecimento_id = ? AND nome = ? AND id <> ?',
    [est, nome, outro ?? 0],
  );
  if (r)
    throw recusa(
      'ciclo-nome-em-uso',
      'Já existe um ciclo de avaliação com este nome neste estabelecimento.',
      {
        campos: ['nome'],
      },
    );
}

async function cicloTravado(tx: TxOperacao, est: number, id: number, versao: number): Promise<Linha> {
  const [r] = await tx.consultarParaAtualizar<Linha>(
    'SELECT * FROM ciclo_avaliacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [id, est],
    { teto: 1 },
  );
  if (!r || n(r['versao']) !== versao) throw desatualizado('O ciclo');
  return r;
}

async function avaliacaoTravada(
  tx: TxOperacao,
  est: number,
  id: number,
  versao: number,
  situacoes: readonly string[],
): Promise<Linha> {
  const [r] = await tx.consultarParaAtualizar<Linha>(
    'SELECT * FROM avaliacao_desempenho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [id, est],
    { teto: 1 },
  );
  if (!r || n(r['versao']) !== versao || !situacoes.includes(texto(r['situacao'])))
    throw desatualizado('A avaliação');
  return r;
}

function gravador(tx: TxOperacao, est: number, anotacao: AnotacaoGravacao): GravadorAvaliacao {
  const agora = async () => paraBanco(await relogioDoEstabelecimento(tx, est));
  const anotar = (motivo: string | null, dados: Record<string, unknown>) => {
    if (motivo) anotacao.motivo = motivo;
    anotacao.dados = { ...(anotacao.dados ?? {}), ...dados };
  };
  return {
    incluirCompetencia: () => pendente(PENDENTE_COMPETENCIA),
    alterarCompetencia: () => pendente(PENDENTE_COMPETENCIA),
    situacaoCompetencia: () => pendente(PENDENTE_COMPETENCIA),
    excluirCompetencia: () => pendente(PENDENTE_COMPETENCIA),
    ligarCompetenciaCargo: () => pendente(PENDENTE_COMPETENCIA),
    desligarCompetenciaCargo: () => pendente(PENDENTE_COMPETENCIA),
    async incluirCiclo(x) {
      const dia = (await agora()).slice(0, 10);
      const modelo = await modeloDoCiclo(tx, x.tipo, x.notaMax, dia);
      await semNomeRepetido(tx, est, x.nome, null);
      return tx.incluir('ciclo_avaliacao', {
        estabelecimento_id: est,
        modelo_avaliacao_id: modelo,
        nome: x.nome,
        periodo_inicio: x.inicio,
        periodo_fim: x.fim,
        prazo_avaliacao: x.prazo ?? null,
        situacao: 'aberto',
      });
    },
    async alterarCiclo(x) {
      const atual = await cicloTravado(tx, est, x.id, x.versao);
      if (atual['situacao'] !== 'aberto' && atual['situacao'] !== 'planejado') throw desatualizado('O ciclo');
      await semNomeRepetido(tx, est, x.nome, x.id);
      // O modelo fica quando tipo e escala não mudam (renomear ou mudar o prazo nunca troca o modelo).
      let modelo = n(atual['modelo_avaliacao_id']);
      const m = await tx.uma<{ tipo: string; escala_maxima: number }>(
        'SELECT tipo, escala_maxima FROM modelo_avaliacao WHERE id = ?',
        [modelo],
      );
      if (!m || m.tipo !== TIPO_DO_MODELO[x.tipo] || Number(m.escala_maxima) !== x.notaMax) {
        const avs = await tx.uma<{ q: number }>(
          'SELECT COUNT(*) AS q FROM avaliacao_desempenho WHERE ciclo_avaliacao_id = ? AND excluido_em IS NULL',
          [x.id],
        );
        if (n(avs?.q) > 0)
          throw recusa(
            'escala-com-avaliacoes',
            `O ciclo já tem ${n(avs?.q)} avaliação(ões) lançadas no modelo atual: o tipo e a escala não mudam. Abra outro ciclo.`,
            { campos: ['notaMax'] },
          );
        modelo = await modeloDoCiclo(tx, x.tipo, x.notaMax, (await agora()).slice(0, 10));
      }
      await tx.alterar('ciclo_avaliacao', x.id, x.versao, {
        nome: x.nome,
        modelo_avaliacao_id: modelo,
        periodo_inicio: x.inicio,
        periodo_fim: x.fim,
        prazo_avaliacao: x.prazo ?? null,
      });
    },
    async situacaoCiclo(x) {
      const atual = await cicloTravado(tx, est, x.id, x.versao);
      const hoje = atual['situacao'] === 'planejado' ? 'aberto' : atual['situacao'];
      if (hoje === x.situacao) throw desatualizado('O ciclo');
      anotar(x.motivo, { situacaoAnterior: atual['situacao'], situacaoNova: x.situacao });
      await tx.alterar('ciclo_avaliacao', x.id, x.versao, { situacao: x.situacao });
    },
    async excluirCiclo(x) {
      const atual = await cicloTravado(tx, est, x.id, x.versao);
      const avs = await tx.uma<{ q: number }>(
        'SELECT COUNT(*) AS q FROM avaliacao_desempenho WHERE ciclo_avaliacao_id = ? AND excluido_em IS NULL',
        [x.id],
      );
      if (n(avs?.q) > 0)
        throw recusa('ciclo-com-vinculos', 'O ciclo tem avaliações e não pode ser excluído.');
      anotar(x.motivo, { retrato: JSON.parse(JSON.stringify(atual)) as unknown });
      await tx.alterar('ciclo_avaliacao', x.id, x.versao, {
        excluido_em: await agora(),
        excluido_por: tx.contexto.usuario,
      });
    },
    incluirAvaliacao: () => pendente(PENDENTE_AVALIACAO),
    async lancarNotas(x) {
      await avaliacaoTravada(tx, est, x.id, x.versao, ['pendente', 'em_andamento']);
      for (const y of x.notas) {
        const [i] = await tx.consultarParaAtualizar<{ id: number; versao: number }>(
          `SELECT id, versao FROM avaliacao_desempenho_item
            WHERE avaliacao_desempenho_id = ? AND criterio_avaliacao_id = ? AND excluido_em IS NULL`,
          [x.id, y.competencia],
          { teto: 1 },
        );
        if (!i)
          throw recusa('competencia-fora-da-avaliacao', 'A competência informada não está nesta avaliação.', {
            campos: ['notas'],
          });
        await tx.alterar('avaliacao_desempenho_item', Number(i.id), Number(i.versao), {
          nota: y.nota,
          comentario: y.comentario,
        });
      }
      await tx.alterar('avaliacao_desempenho', x.id, x.versao, {
        comentario: x.parecer,
        situacao: 'em_andamento',
      });
    },
    async finalizarAvaliacao(x) {
      await avaliacaoTravada(tx, est, x.id, x.versao, ['pendente', 'em_andamento']);
      const r = await tx.uma<{ total: number; vazias: number }>(
        `SELECT COUNT(*) AS total, COALESCE(SUM(nota IS NULL), 0) AS vazias FROM avaliacao_desempenho_item
          WHERE avaliacao_desempenho_id = ? AND excluido_em IS NULL`,
        [x.id],
      );
      if (n(r?.total) === 0 || n(r?.vazias) > 0)
        throw recusa(
          'avaliacao-incompleta',
          `Faltam notas em ${n(r?.vazias)} competência(s). Lance todas as notas antes de finalizar.`,
          { campos: ['notas'] },
        );
      // Quem finalizou fica na trilha desta operação (a leitura procura o evento; pedido: finalizada_por_usuario_id).
      anotar(null, { avaliacaoEvento: 'finalizacao' });
      await tx.alterar('avaliacao_desempenho', x.id, x.versao, {
        situacao: 'concluida',
        concluida_em: await agora(),
      });
    },
    async ciencia(x) {
      const a = await avaliacaoTravada(tx, est, x.id, x.versao, ['concluida']);
      if (a['ciencia_colaborador_em'] !== null && a['ciencia_colaborador_em'] !== undefined)
        throw desatualizado('A avaliação');
      // Quem deu ou registrou, o modo e a observação ficam na trilha desta operação (pedido: as colunas da ciência).
      anotar(x.observacao, {
        avaliacaoEvento: 'ciencia',
        cienciaModo: x.modo,
        cienciaObservacao: x.observacao,
      });
      await tx.alterar('avaliacao_desempenho', x.id, x.versao, { ciencia_colaborador_em: await agora() });
    },
    corrigirAvaliacao: () => pendente(PENDENTE_AVALIACAO),
    async excluirAvaliacao(x) {
      const a = await avaliacaoTravada(tx, est, x.id, x.versao, ['pendente', 'em_andamento']);
      const itens = await tx.consultarParaAtualizar<Linha>(
        'SELECT * FROM avaliacao_desempenho_item WHERE avaliacao_desempenho_id = ? AND excluido_em IS NULL',
        [x.id],
        { teto: 500 },
      );
      anotar(x.motivo, { retrato: JSON.parse(JSON.stringify({ avaliacao: a, itens })) as unknown });
      const em = await agora();
      for (const i of itens)
        await tx.alterar('avaliacao_desempenho_item', n(i['id']), n(i['versao']), {
          excluido_em: em,
          excluido_por: tx.contexto.usuario,
        });
      await tx.alterar('avaliacao_desempenho', x.id, x.versao, {
        excluido_em: em,
        excluido_por: tx.contexto.usuario,
      });
    },
    incluirPdi: () => pendente(PENDENTE_PDI),
    alterarPdi: () => pendente(PENDENTE_PDI),
    situacaoPdi: () => pendente(PENDENTE_PDI),
    async registrarCorrecao(x) {
      // O valor anterior e o novo vão na trilha da mesma operação (a trilha é o histórico da correção).
      anotar(x.motivo, {
        correcao: {
          tabela: x.tabela,
          registro: x.registro,
          operacao: x.operacao,
          antes: x.antes,
          depois: x.depois,
        },
      });
    },
  };
}

export class PortaAvaliacaoPropria implements PortaAvaliacao {
  readonly destino = 'banco' as const;
  private executor: ReturnType<NucleoQualidade['criarExecutor']> | null = null;

  constructor(private readonly nucleo: NucleoQualidade) {}

  private ler<T>(c: ContextoAvaliacao, fn: (l: L, est: number) => Promise<T>): Promise<T> {
    return lerNoEstabelecimento(this.nucleo, { ...c, correlacao: c.correlacao || 'avaliacao' }, fn);
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }
  async executar(): Promise<GravacaoFeita> {
    throw recusa('operacao-desconhecida', 'A avaliação de desempenho não usa operação de tela do executor.');
  }
  gravarSgh<T>(
    c: ContextoAvaliacao,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorAvaliacao) => Promise<T>,
  ): Promise<T> {
    this.executor ??= this.nucleo.criarExecutor();
    return gravacaoDireta(this.executor, c, {
      nome: 'pessoas.avaliacao.gravar',
      tabelas: TABELAS_AVALIACAO,
      trilha,
      gravador: (tx, est, anotacao) => gravador(tx, est, anotacao),
      fn,
    });
  }

  hoje(c: ContextoAvaliacao): Promise<string> {
    return this.ler(c, async (l, est) => (await relogioDoEstabelecimento(l, est)).slice(0, 10));
  }
  /** As competências são os critérios do tipo competência dos modelos do cliente (catálogo da rede inteira). */
  competencias(c: ContextoAvaliacao): Promise<CompetenciaRegistrada[]> {
    return this.ler(c, async (l) =>
      (await l.consultar<Linha>(`${SQL_COMPETENCIA} ORDER BY cr.nome, cr.id`, [], { teto: 2000 })).map(
        competenciaDe,
      ),
    );
  }
  competencia(c: ContextoAvaliacao, id: number): Promise<CompetenciaRegistrada | null> {
    return this.ler(c, async (l) => {
      const r = await l.uma<Linha>(`${SQL_COMPETENCIA} AND cr.id = ?`, [id]);
      return r ? competenciaDe(r) : null;
    });
  }
  /** A ligação competência-cargo ainda não tem tabela: nada pode ter sido ligado neste banco. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta; a operação aguarda o modelo
  async competenciasDoCargo(_c: ContextoAvaliacao, _cargo: number | null): Promise<CompetenciaDoCargo[]> {
    return [];
  }
  ciclos(c: ContextoAvaliacao): Promise<CicloRegistrado[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar<Linha>(`${SQL_CICLO} ORDER BY ca.periodo_inicio DESC, ca.id DESC`, [est], {
          teto: 2000,
        })
      ).map(cicloDe),
    );
  }
  ciclo(c: ContextoAvaliacao, id: number): Promise<CicloRegistrado | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<Linha>(`${SQL_CICLO} AND ca.id = ?`, [est, id]);
      return r ? cicloDe(r) : null;
    });
  }
  avaliacoes(
    c: ContextoAvaliacao,
    f: { readonly ciclo: number } | { readonly vinculo: number },
  ): Promise<AvaliacaoRegistrada[]> {
    return this.ler(c, async (l, est) => {
      const [filtro, p] =
        'ciclo' in f
          ? [' AND a.ciclo_avaliacao_id = ?', f.ciclo]
          : [
              ' AND a.colaborador_id = (SELECT v.colaborador_id FROM vinculo_trabalho v WHERE v.id = ? AND v.estabelecimento_id = a.estabelecimento_id)',
              f.vinculo,
            ];
      const rs = await l.consultar<Linha>(`${SQL_AVALIACAO}${filtro} ORDER BY a.id DESC`, [est, p], {
        teto: 2000,
      });
      return rs.map(avaliacaoDe);
    });
  }
  avaliacao(c: ContextoAvaliacao, id: number): Promise<AvaliacaoRegistrada | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<Linha>(`${SQL_AVALIACAO} AND a.id = ?`, [est, id]);
      return r ? avaliacaoDe(r) : null;
    });
  }
  notas(c: ContextoAvaliacao, avaliacao: number): Promise<NotaAvaliacao[]> {
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar<Linha>(
        `SELECT i.criterio_avaliacao_id, cr.nome, i.nota, i.comentario
           FROM avaliacao_desempenho_item i
           JOIN avaliacao_desempenho a ON a.id = i.avaliacao_desempenho_id AND a.estabelecimento_id = ?
           JOIN criterio_avaliacao cr ON cr.id = i.criterio_avaliacao_id
          WHERE i.avaliacao_desempenho_id = ? AND i.excluido_em IS NULL
          ORDER BY cr.nome, i.sequencia`,
        [est, avaliacao],
        { teto: 500 },
      );
      return rs.map((r) => ({
        competencia: n(r['criterio_avaliacao_id']),
        nome: texto(r['nome']),
        nota: r['nota'] === null || r['nota'] === undefined ? null : Number(r['nota']),
        comentario: textoN(r['comentario']),
      }));
    });
  }
  cargoDoVinculo(c: ContextoAvaliacao, vinculo: number): Promise<number | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<Linha>(
        'SELECT cargo_id FROM vinculo_trabalho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [vinculo, est],
      );
      return r ? nn(r['cargo_id']) : null;
    });
  }
  vinculosEmExperiencia(c: ContextoAvaliacao, desde: string): Promise<VinculoEmExperiencia[]> {
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar<Linha>(
        `SELECT vt.id, c.nome, vt.matricula, vt.cargo_id, vt.data_admissao, vt.centro_custo_id, sf.nome AS setor
           FROM vinculo_trabalho vt
           JOIN colaborador c ON c.id = vt.colaborador_id
           LEFT JOIN setor_funcional sf ON sf.id = vt.setor_funcional_id
          WHERE vt.estabelecimento_id = ? AND vt.excluido_em IS NULL AND vt.regime_trabalhista = 'clt'
            AND vt.data_desligamento IS NULL AND vt.situacao IN ('ativo', 'afastado') AND vt.data_admissao >= ?
          ORDER BY vt.data_admissao, c.nome`,
        [est, desde],
        { teto: 2000 },
      );
      return rs.map((r) => ({
        vinculo: n(r['id']),
        nome: texto(r['nome']),
        matricula: textoN(r['matricula']),
        cargo: nn(r['cargo_id']),
        admissao: dataIso(r['data_admissao']) ?? '',
        centroCusto: nn(r['centro_custo_id']),
        setor: textoN(r['setor']),
      }));
    });
  }
  /** O PDI ainda não tem tabela: nada pode ter sido gravado neste banco. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta; a operação aguarda o modelo
  async pdiDoColaborador(_c: ContextoAvaliacao, _vinculo: number): Promise<PdiRegistrado[]> {
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta; a operação aguarda o modelo
  async pdi(_c: ContextoAvaliacao, _id: number): Promise<PdiRegistrado | null> {
    return null;
  }
  dependencias(
    c: ContextoAvaliacao,
    alvo: AlvoDependenciaAvaliacao,
    id: number,
  ): Promise<DependenciaContada[]> {
    return this.ler(c, async (l, est) => {
      const r: DependenciaContada[] = [];
      const somar = async (grupo: string, tabela: string, coluna: string, sql: string, p: unknown[]) => {
        const x = await l.uma<{ q: number }>(sql, p);
        if (n(x?.q) > 0) r.push({ grupo, tabela, coluna, quantidade: n(x?.q) });
      };
      if (alvo === 'competencia')
        await somar(
          'Notas de avaliação',
          'avaliacao_desempenho_item',
          'criterio_avaliacao_id',
          'SELECT COUNT(*) AS q FROM avaliacao_desempenho_item WHERE criterio_avaliacao_id = ? AND excluido_em IS NULL',
          [id],
        );
      else if (alvo === 'ciclo-avaliacao')
        await somar(
          'Avaliações do ciclo',
          'avaliacao_desempenho',
          'ciclo_avaliacao_id',
          'SELECT COUNT(*) AS q FROM avaliacao_desempenho WHERE ciclo_avaliacao_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [id, est],
        );
      return r;
    });
  }
  /** O histórico das correções está na trilha de cada operação (pedido: a leitura dele pela porta da auditoria). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta; a operação aguarda o modelo
  async correcoes(_c: ContextoAvaliacao, _t: string, _r: readonly number[]): Promise<CorrecaoRegistrada[]> {
    return [];
  }
}
