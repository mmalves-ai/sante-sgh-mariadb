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
// Melhoria: quem finalizou, quem deu ou registrou a ciência, o modo e a observação ficam nas colunas da avaliação
// (finalizada_por_usuario_id, ciencia_por_usuario_id, ciencia_modo, ciencia_observacao) e também no evento anotado na
// trilha da operação; a leitura usa a coluna e, no registro antigo sem coluna, o evento da trilha.
// Melhoria: as competências são cadastro do estabelecimento (competencia_avaliacao), ligadas ao cargo
// (cargo_competencia) e ao PDI (plano_desenvolvimento). Ao abrir a avaliação, cada competência vira o critério do modelo
// do ciclo de código `competencia-<id>` (criado na primeira vez, na mesma transação): a nota fica por critério, como o
// modelo prevê, e a leitura devolve a competência de cada critério. Item sem competência (registro antigo) é lido pelo
// próprio critério.
// Melhoria: a correção é uma versão nova da avaliação (avaliacao_anterior_id, motivo_correcao), com as notas copiadas;
// o número da versão para a tela é a profundidade da cadeia de correções. A exclusão do rascunho de correção solta a
// anterior (avaliacao_anterior_id volta a nulo; o retrato vai na trilha), que pode ser corrigida de novo.
import { ErroOperacao, recusa, type TxOperacao } from '@sgh/nucleo';
import { type AnotacaoGravacao, gravacaoDireta } from '../../enfermagem/gravacao-direta.js';
import type { GravacaoFeita, TrilhaDaGravacao } from '../../exames/public-api.js';
import {
  dataIso,
  exigirUsuario,
  instante,
  instanteN,
  type L,
  lerNoEstabelecimento,
  type Linha,
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
  SituacaoPdi,
  TipoCiclo,
  VinculoEmExperiencia,
} from './tipos.js';

/** As tabelas que a gravação da avaliação escreve (a transação recusa as outras). */
export const TABELAS_AVALIACAO = [
  'ciclo_avaliacao',
  'avaliacao_desempenho',
  'avaliacao_desempenho_item',
  'competencia_avaliacao',
  'cargo_competencia',
  'criterio_avaliacao',
  'plano_desenvolvimento',
] as const;

/** O código do critério do modelo que recebe a nota de uma competência do estabelecimento. */
const CODIGO_CRITERIO = (competencia: number) => `competencia-${competencia}`;

/** O tipo do ciclo na tela e o tipo do modelo de avaliação no banco. */
const TIPO_DO_MODELO: Readonly<Record<TipoCiclo, string>> = {
  periodico: 'desempenho',
  experiencia: 'experiencia',
};
const tipoDoCiclo = (modelo: unknown): TipoCiclo =>
  (Object.entries(TIPO_DO_MODELO).find(([, m]) => m === modelo)?.[0] ?? 'periodico') as TipoCiclo;

const desatualizado = (o: string) =>
  new ErroOperacao(
    409,
    'desatualizado',
    'Operação recusada',
    `${o} mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.`,
  );

const SQL_CICLO = `
  SELECT ca.id, ca.nome, m.tipo AS tipo_modelo, ca.periodo_inicio, ca.periodo_fim, ca.prazo_avaliacao, m.escala_maxima,
         ca.situacao, ca.motivo_situacao, ca.versao, COALESCE(ca.alterado_em, ca.criado_em) AS alterado_em,
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
    motivoSituacao: textoN(r['motivo_situacao']),
    versao: n(r['versao']),
    alteradoPor: texto(r['alterado_por']),
    alteradoEm: instante(r['alterado_em']),
  };
}

// O vínculo de trabalho do colaborador avaliado no estabelecimento (o mais recente).
// O número da versão é a profundidade na cadeia de correções (a primeira é 1). Parâmetros: estabelecimento (cadeia) e
// estabelecimento (filtro).
const SQL_AVALIACAO = `
  WITH RECURSIVE cadeia AS (
    SELECT id, 1 AS numero FROM avaliacao_desempenho WHERE estabelecimento_id = ? AND avaliacao_anterior_id IS NULL
    UNION ALL
    SELECT f.id, cd.numero + 1 FROM avaliacao_desempenho f JOIN cadeia cd ON f.avaliacao_anterior_id = cd.id
  )
  SELECT a.id, a.ciclo_avaliacao_id, a.situacao, a.comentario, a.concluida_em, a.ciencia_colaborador_em, a.versao,
         a.criado_em, a.marco_experiencia_dias, a.avaliacao_anterior_id, a.motivo_correcao, a.cargo_id AS cargo_avaliado,
         COALESCE(cd.numero, 1) AS numero, c.nome AS colaborador, COALESCE(uav.login, av.nome) AS avaliador,
         uc.login AS criado_por, COALESCE(ufc.login, uf.login) AS finalizada_por,
         COALESCE(ucc.login, ucn.login) AS ciencia_por,
         COALESCE(a.ciencia_modo, JSON_VALUE(tc.dados_depois, '$.dados.cienciaModo')) AS ciencia_modo,
         COALESCE(a.ciencia_observacao, JSON_VALUE(tc.dados_depois, '$.dados.cienciaObservacao')) AS ciencia_observacao,
         EXISTS (SELECT 1 FROM avaliacao_desempenho s WHERE s.avaliacao_anterior_id = a.id AND s.excluido_em IS NULL)
           AS substituida,
         vt.id AS vinculo, vt.cargo_id
    FROM avaliacao_desempenho a
    LEFT JOIN cadeia cd ON cd.id = a.id
    JOIN colaborador c ON c.id = a.colaborador_id
    JOIN colaborador av ON av.id = a.avaliador_colaborador_id
    LEFT JOIN usuario uav ON uav.id = av.usuario_id
    LEFT JOIN usuario uc ON uc.id = a.criado_por
    LEFT JOIN usuario ufc ON ufc.id = a.finalizada_por_usuario_id
    LEFT JOIN usuario ucc ON ucc.id = a.ciencia_por_usuario_id
    LEFT JOIN trilha_auditoria tf ON a.finalizada_por_usuario_id IS NULL AND tf.id = (
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

const marcoDe = (v: unknown): 45 | 90 | null => (Number(v) === 45 ? 45 : Number(v) === 90 ? 90 : null);
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
    cargo: nn(r['cargo_avaliado']) ?? nn(r['cargo_id']),
    marco: marcoDe(r['marco_experiencia_dias']),
    avaliador: texto(r['avaliador']),
    numero: n(r['numero']),
    anterior: nn(r['avaliacao_anterior_id']),
    motivoCorrecao: textoN(r['motivo_correcao']),
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
    substituida: verdadeiro(r['substituida']),
  } as AvaliacaoRegistrada;
}

const SQL_COMPETENCIA = `
  SELECT k.id, k.nome, k.descricao, k.ativo, k.motivo_situacao, k.versao,
         COALESCE(k.alterado_em, k.criado_em) AS alterado_em, COALESCE(ua.login, uc.login) AS alterado_por
    FROM competencia_avaliacao k
    LEFT JOIN usuario ua ON ua.id = k.alterado_por
    LEFT JOIN usuario uc ON uc.id = k.criado_por
   WHERE k.estabelecimento_id = ? AND k.excluido_em IS NULL`;

// A conclusão do curso pelo colaborador (aprovado ou sem avaliação), a mesma regra da porta do treinamento.
const SQL_PDI = `
  SELECT p.id, p.vinculo_trabalho_id, p.avaliacao_desempenho_id, p.competencia_avaliacao_id, p.curso_id, p.acao,
         p.prazo, p.situacao, p.concluida_em, p.motivo_situacao, p.versao,
         COALESCE(p.alterado_em, p.criado_em) AS alterado_em, COALESCE(ua.login, uc.login) AS alterado_por,
         k.nome AS competencia_nome, cu.nome AS curso_titulo,
         (SELECT MAX(t.data_fim) FROM presenca_treinamento pt
            JOIN turma_treinamento t ON t.id = pt.turma_treinamento_id
           WHERE t.curso_id = p.curso_id AND t.estabelecimento_id = p.estabelecimento_id
             AND pt.colaborador_id = vt.colaborador_id AND pt.excluido_em IS NULL AND t.excluido_em IS NULL
             AND t.situacao <> 'cancelada' AND pt.situacao = 'presente' AND pt.minutos_cumpridos > 0
             AND pt.aproveitamento IN ('aprovado','nao_avaliado')) AS curso_concluido_em
    FROM plano_desenvolvimento p
    JOIN vinculo_trabalho vt ON vt.id = p.vinculo_trabalho_id
    LEFT JOIN competencia_avaliacao k ON k.id = p.competencia_avaliacao_id
    LEFT JOIN curso cu ON cu.id = p.curso_id
    LEFT JOIN usuario ua ON ua.id = p.alterado_por
    LEFT JOIN usuario uc ON uc.id = p.criado_por
   WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL`;

function pdiDe(r: Linha): PdiRegistrado {
  return {
    id: n(r['id']),
    vinculo: n(r['vinculo_trabalho_id']),
    avaliacao: nn(r['avaliacao_desempenho_id']),
    competencia: nn(r['competencia_avaliacao_id']),
    competenciaNome: textoN(r['competencia_nome']),
    curso: nn(r['curso_id']),
    cursoTitulo: textoN(r['curso_titulo']),
    cursoConcluidoEm: dataIso(r['curso_concluido_em']),
    acao: texto(r['acao']),
    prazo: dataIso(r['prazo']) ?? '',
    situacao: texto(r['situacao']) as SituacaoPdi,
    concluidaEm: dataIso(r['concluida_em']),
    motivoSituacao: textoN(r['motivo_situacao']),
    versao: n(r['versao']),
    alteradoPor: texto(r['alterado_por']),
    alteradoEm: instante(r['alterado_em']),
  };
}

function competenciaDe(r: Linha): CompetenciaRegistrada {
  return {
    id: n(r['id']),
    nome: texto(r['nome']),
    descricao: textoN(r['descricao']),
    ativo: verdadeiro(r['ativo']),
    motivoSituacao: textoN(r['motivo_situacao']),
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

async function competenciaTravada(
  tx: TxOperacao,
  est: number,
  id: number,
  versao: number | null,
): Promise<Linha> {
  const [r] = await tx.consultarParaAtualizar<Linha>(
    'SELECT * FROM competencia_avaliacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [id, est],
    { teto: 1 },
  );
  if (!r || (versao !== null && n(r['versao']) !== versao)) throw desatualizado('A competência');
  return r;
}

async function competenciaSemNomeRepetido(
  l: L,
  est: number,
  nome: string,
  outro: number | null,
): Promise<void> {
  // A chave única do banco conta a competência excluída: o nome dela continua reservado.
  const r = await l.uma<{ id: number }>(
    'SELECT id FROM competencia_avaliacao WHERE estabelecimento_id = ? AND nome = ? AND id <> ?',
    [est, nome, outro ?? 0],
  );
  if (r)
    throw recusa(
      'competencia-nome-em-uso',
      'Já existe uma competência com este nome neste estabelecimento.',
      {
        campos: ['nome'],
      },
    );
}

/** O colaborador avaliador pela conta (login): a avaliação guarda o colaborador, não o login solto. */
async function colaboradorDoLogin(tx: TxOperacao, login: string): Promise<number> {
  const u = await exigirUsuario(tx, login);
  const r = await tx.uma<{ id: number }>(
    'SELECT id FROM colaborador WHERE usuario_id = ? AND excluido_em IS NULL ORDER BY id LIMIT 1',
    [u],
  );
  if (!r)
    throw recusa(
      'avaliador-sem-cadastro',
      'A conta do avaliador não está ligada a um colaborador do cadastro de pessoas. Ligue a conta ao colaborador antes.',
      { campos: ['avaliador'] },
    );
  return Number(r.id);
}

/** O número livre da versão no grupo da chave única (ciclo, colaborador, avaliador e tipo). */
async function proximaVersao(
  tx: TxOperacao,
  ciclo: number,
  colaborador: number,
  avaliador: number,
  tipo: string,
) {
  const r = await tx.uma<{ q: number }>(
    `SELECT COALESCE(MAX(numero_versao), 0) + 1 AS q FROM avaliacao_desempenho
      WHERE ciclo_avaliacao_id = ? AND colaborador_id = ? AND avaliador_colaborador_id = ? AND tipo = ?`,
    [ciclo, colaborador, avaliador, tipo],
  );
  return n(r?.q);
}

/** O critério do modelo do ciclo que recebe a nota da competência (criado na primeira vez, na mesma transação). */
async function criterioDaCompetencia(
  tx: TxOperacao,
  est: number,
  modelo: number,
  competencia: number,
): Promise<number> {
  const k = await competenciaTravada(tx, est, competencia, null);
  if (!verdadeiro(k['ativo']))
    throw recusa(
      'competencia-inativa',
      'Uma competência do cargo está inativa. Reative-a ou desligue-a do cargo.',
      {
        campos: ['competencias'],
      },
    );
  const codigo = CODIGO_CRITERIO(competencia);
  const achado = await tx.uma<{ id: number }>(
    'SELECT id FROM criterio_avaliacao WHERE modelo_avaliacao_id = ? AND codigo = ?',
    [modelo, codigo],
  );
  let criterio = achado ? Number(achado.id) : 0;
  if (!achado) {
    const m = await tx.uma<{ escala_minima: number; escala_maxima: number; seq: number }>(
      `SELECT m.escala_minima, m.escala_maxima,
              (SELECT COALESCE(MAX(c.sequencia), 0) + 1 FROM criterio_avaliacao c WHERE c.modelo_avaliacao_id = m.id) AS seq
         FROM modelo_avaliacao m WHERE m.id = ?`,
      [modelo],
    );
    criterio = await tx.incluir('criterio_avaliacao', {
      modelo_avaliacao_id: modelo,
      sequencia: n(m?.seq),
      codigo,
      nome: texto(k['nome']),
      descricao: textoN(k['descricao']),
      tipo: 'competencia',
      nota_minima: n(m?.escala_minima),
      nota_maxima: n(m?.escala_maxima),
    });
  }
  if (k['criterio_avaliacao_id'] === null || k['criterio_avaliacao_id'] === undefined)
    await tx.alterar('competencia_avaliacao', competencia, n(k['versao']), {
      criterio_avaliacao_id: criterio,
    });
  return criterio;
}

async function pdiTravado(tx: TxOperacao, est: number, id: number, versao: number): Promise<Linha> {
  const [r] = await tx.consultarParaAtualizar<Linha>(
    'SELECT * FROM plano_desenvolvimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [id, est],
    { teto: 1 },
  );
  if (!r || n(r['versao']) !== versao) throw desatualizado('A ação do PDI');
  return r;
}

function gravador(tx: TxOperacao, est: number, anotacao: AnotacaoGravacao): GravadorAvaliacao {
  const agora = async () => paraBanco(await relogioDoEstabelecimento(tx, est));
  const anotar = (motivo: string | null, dados: Record<string, unknown>) => {
    if (motivo) anotacao.motivo = motivo;
    anotacao.dados = { ...(anotacao.dados ?? {}), ...dados };
  };
  return {
    async incluirCompetencia(x) {
      await competenciaSemNomeRepetido(tx, est, x.nome, null);
      return tx.incluir('competencia_avaliacao', {
        estabelecimento_id: est,
        nome: x.nome,
        descricao: x.descricao,
        ativo: true,
      });
    },
    async alterarCompetencia(x) {
      await competenciaTravada(tx, est, x.id, x.versao);
      await competenciaSemNomeRepetido(tx, est, x.nome, x.id);
      await tx.alterar('competencia_avaliacao', x.id, x.versao, { nome: x.nome, descricao: x.descricao });
    },
    async situacaoCompetencia(x) {
      const atual = await competenciaTravada(tx, est, x.id, x.versao);
      if (verdadeiro(atual['ativo']) === x.ativo) throw desatualizado('A competência');
      anotar(x.motivo, { ativoAnterior: verdadeiro(atual['ativo']), ativoNovo: x.ativo });
      await tx.alterar('competencia_avaliacao', x.id, x.versao, {
        ativo: x.ativo,
        motivo_situacao: x.motivo,
      });
    },
    async excluirCompetencia(x) {
      const atual = await competenciaTravada(tx, est, x.id, x.versao);
      const uso = await tx.uma<{ q: number }>(
        `SELECT (SELECT COUNT(*) FROM cargo_competencia WHERE competencia_avaliacao_id = ? AND excluido_em IS NULL)
              + (SELECT COUNT(*) FROM plano_desenvolvimento WHERE competencia_avaliacao_id = ? AND excluido_em IS NULL)
              + (SELECT COUNT(*) FROM avaliacao_desempenho_item i JOIN criterio_avaliacao c ON c.id = i.criterio_avaliacao_id
                  WHERE c.codigo = ? AND i.excluido_em IS NULL) AS q`,
        [x.id, x.id, CODIGO_CRITERIO(x.id)],
      );
      if (n(uso?.q) > 0)
        throw recusa('competencia-com-vinculos', 'A competência está em uso: inative-a com o motivo.');
      anotar(x.motivo, { retrato: JSON.parse(JSON.stringify(atual)) as unknown });
      await tx.alterar('competencia_avaliacao', x.id, x.versao, {
        excluido_em: await agora(),
        excluido_por: tx.contexto.usuario,
      });
    },
    async ligarCompetenciaCargo(x) {
      const k = await competenciaTravada(tx, est, x.competencia, null);
      if (!verdadeiro(k['ativo']))
        throw recusa(
          'competencia-inativa',
          'A competência está inativa ou não existe. Reative antes de ligar ao cargo.',
          { campos: ['competencia'] },
        );
      // A chave única conta a ligação desfeita: religar reaproveita a linha (o desligamento fica na trilha).
      const [l] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, versao, excluido_em FROM cargo_competencia WHERE cargo_id = ? AND competencia_avaliacao_id = ?',
        [x.cargo, x.competencia],
        { teto: 1 },
      );
      if (l && (l['excluido_em'] === null || l['excluido_em'] === undefined))
        throw recusa('competencia-ja-no-cargo', 'A competência já está no cargo.', {
          campos: ['competencia'],
        });
      if (l) {
        await tx.alterar('cargo_competencia', n(l['id']), n(l['versao']), {
          excluido_em: null,
          excluido_por: null,
        });
        return n(l['id']);
      }
      return tx.incluir('cargo_competencia', { cargo_id: x.cargo, competencia_avaliacao_id: x.competencia });
    },
    async desligarCompetenciaCargo(x) {
      const [l] = await tx.consultarParaAtualizar<Linha>(
        `SELECT cc.* FROM cargo_competencia cc
           JOIN competencia_avaliacao k ON k.id = cc.competencia_avaliacao_id AND k.estabelecimento_id = ?
          WHERE cc.cargo_id = ? AND cc.competencia_avaliacao_id = ? AND cc.excluido_em IS NULL`,
        [est, x.cargo, x.competencia],
        { teto: 1 },
      );
      if (!l) throw desatualizado('A competência do cargo');
      anotar(x.motivo, { retrato: JSON.parse(JSON.stringify(l)) as unknown });
      await tx.alterar('cargo_competencia', n(l['id']), n(l['versao']), {
        excluido_em: await agora(),
        excluido_por: tx.contexto.usuario,
      });
    },
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
      await tx.alterar('ciclo_avaliacao', x.id, x.versao, {
        situacao: x.situacao,
        motivo_situacao: x.motivo,
      });
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
    async incluirAvaliacao(x) {
      if (x.competencias.length === 0)
        throw recusa(
          'avaliacao-sem-competencias',
          'O cargo do colaborador não tem competências. Ligue as competências ao cargo antes de avaliar.',
        );
      const [ciclo] = await tx.consultarParaAtualizar<Linha>(
        `SELECT id, modelo_avaliacao_id, situacao FROM ciclo_avaliacao
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [x.ciclo, est],
        { teto: 1 },
      );
      if (!ciclo || (ciclo['situacao'] !== 'aberto' && ciclo['situacao'] !== 'planejado'))
        throw recusa('ciclo-fechado', 'O ciclo não está aberto: não recebe avaliação nova.');
      const v = await tx.uma<{ colaborador_id: number }>(
        'SELECT colaborador_id FROM vinculo_trabalho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [x.vinculo, est],
      );
      if (!v)
        throw recusa('vinculo-inexistente', 'O colaborador não existe neste estabelecimento.', {
          campos: ['vinculo'],
        });
      const colaborador = Number(v.colaborador_id);
      const avaliador = await colaboradorDoLogin(tx, x.avaliador);
      const tipo = avaliador === colaborador ? 'autoavaliacao' : 'gestor';
      const id = await tx.incluir('avaliacao_desempenho', {
        estabelecimento_id: est,
        ciclo_avaliacao_id: x.ciclo,
        colaborador_id: colaborador,
        avaliador_colaborador_id: avaliador,
        tipo,
        situacao: 'pendente',
        numero_versao: await proximaVersao(tx, x.ciclo, colaborador, avaliador, tipo),
        cargo_id: x.cargo,
        marco_experiencia_dias: x.marco,
      });
      const modelo = n(ciclo['modelo_avaliacao_id']);
      for (const [i, k] of [...new Set(x.competencias)].entries())
        await tx.incluir('avaliacao_desempenho_item', {
          avaliacao_desempenho_id: id,
          sequencia: i + 1,
          criterio_avaliacao_id: await criterioDaCompetencia(tx, est, modelo, k),
        });
      return id;
    },
    async lancarNotas(x) {
      await avaliacaoTravada(tx, est, x.id, x.versao, ['pendente', 'em_andamento']);
      for (const y of x.notas) {
        const [i] = await tx.consultarParaAtualizar<{ id: number; versao: number }>(
          `SELECT i.id, i.versao FROM avaliacao_desempenho_item i
             JOIN criterio_avaliacao cr ON cr.id = i.criterio_avaliacao_id
            WHERE i.avaliacao_desempenho_id = ? AND i.excluido_em IS NULL
              AND (cr.codigo = ? OR (cr.codigo NOT LIKE 'competencia-%' AND cr.id = ?))`,
          [x.id, CODIGO_CRITERIO(y.competencia), y.competencia],
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
      // Quem finalizou fica na coluna e no evento da trilha desta operação.
      anotar(null, { avaliacaoEvento: 'finalizacao' });
      await tx.alterar('avaliacao_desempenho', x.id, x.versao, {
        situacao: 'concluida',
        concluida_em: await agora(),
        finalizada_por_usuario_id: tx.contexto.usuario,
      });
    },
    async ciencia(x) {
      const a = await avaliacaoTravada(tx, est, x.id, x.versao, ['concluida']);
      if (a['ciencia_colaborador_em'] !== null && a['ciencia_colaborador_em'] !== undefined)
        throw desatualizado('A avaliação');
      const corrigida = await tx.uma<{ id: number }>(
        'SELECT id FROM avaliacao_desempenho WHERE avaliacao_anterior_id = ? AND excluido_em IS NULL',
        [x.id],
      );
      if (corrigida) throw desatualizado('A avaliação');
      // Quem deu ou registrou, o modo e a observação ficam nas colunas e no evento da trilha desta operação.
      anotar(x.observacao, {
        avaliacaoEvento: 'ciencia',
        cienciaModo: x.modo,
        cienciaObservacao: x.observacao,
      });
      await tx.alterar('avaliacao_desempenho', x.id, x.versao, {
        ciencia_colaborador_em: await agora(),
        ciencia_por_usuario_id: tx.contexto.usuario,
        ciencia_modo: x.modo,
        ciencia_observacao: x.observacao,
      });
    },
    async corrigirAvaliacao(x) {
      const a = await avaliacaoTravada(tx, est, x.anterior, x.versao, ['concluida']);
      const ja = await tx.uma<{ id: number }>(
        'SELECT id FROM avaliacao_desempenho WHERE avaliacao_anterior_id = ? AND excluido_em IS NULL',
        [x.anterior],
      );
      if (ja) throw desatualizado('A avaliação');
      const colaborador = n(a['colaborador_id']);
      const avaliador = await colaboradorDoLogin(tx, x.avaliador);
      const tipo = avaliador === colaborador ? 'autoavaliacao' : 'gestor';
      anotar(x.motivo, { avaliacaoEvento: 'correcao', anterior: x.anterior });
      const id = await tx.incluir('avaliacao_desempenho', {
        estabelecimento_id: est,
        ciclo_avaliacao_id: n(a['ciclo_avaliacao_id']),
        colaborador_id: colaborador,
        avaliador_colaborador_id: avaliador,
        tipo,
        situacao: 'pendente',
        comentario: textoN(a['comentario']),
        numero_versao: await proximaVersao(tx, n(a['ciclo_avaliacao_id']), colaborador, avaliador, tipo),
        cargo_id: nn(a['cargo_id']),
        marco_experiencia_dias: nn(a['marco_experiencia_dias']),
        avaliacao_anterior_id: x.anterior,
        motivo_correcao: x.motivo,
      });
      const itens = await tx.consultar<Linha>(
        `SELECT sequencia, criterio_avaliacao_id, nota, comentario FROM avaliacao_desempenho_item
          WHERE avaliacao_desempenho_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
        [x.anterior],
        { teto: 500 },
      );
      for (const i of itens)
        await tx.incluir('avaliacao_desempenho_item', {
          avaliacao_desempenho_id: id,
          sequencia: n(i['sequencia']),
          criterio_avaliacao_id: n(i['criterio_avaliacao_id']),
          nota: i['nota'] ?? null,
          comentario: textoN(i['comentario']),
        });
      return id;
    },
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
      // O rascunho de correção excluído solta a anterior (a ligação fica no retrato da trilha).
      await tx.alterar('avaliacao_desempenho', x.id, x.versao, {
        excluido_em: em,
        excluido_por: tx.contexto.usuario,
        avaliacao_anterior_id: null,
        motivo_correcao: null,
      });
    },
    async incluirPdi(x) {
      const v = await tx.uma<{ id: number }>(
        'SELECT id FROM vinculo_trabalho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [x.vinculo, est],
      );
      if (!v)
        throw recusa('vinculo-inexistente', 'O colaborador não existe neste estabelecimento.', {
          campos: ['vinculo'],
        });
      return tx.incluir('plano_desenvolvimento', {
        estabelecimento_id: est,
        vinculo_trabalho_id: x.vinculo,
        avaliacao_desempenho_id: x.avaliacao,
        competencia_avaliacao_id: x.competencia,
        curso_id: x.curso,
        acao: x.acao,
        prazo: x.prazo,
        situacao: 'aberta',
      });
    },
    async alterarPdi(x) {
      const p = await pdiTravado(tx, est, x.id, x.versao);
      if (p['situacao'] !== 'aberta') throw desatualizado('A ação do PDI');
      await tx.alterar('plano_desenvolvimento', x.id, x.versao, {
        avaliacao_desempenho_id: x.avaliacao,
        competencia_avaliacao_id: x.competencia,
        curso_id: x.curso,
        acao: x.acao,
        prazo: x.prazo,
      });
    },
    async situacaoPdi(x) {
      const p = await pdiTravado(tx, est, x.id, x.versao);
      if (p['situacao'] === x.situacao) throw desatualizado('A ação do PDI');
      anotar(x.motivo, { situacaoAnterior: p['situacao'], situacaoNova: x.situacao });
      await tx.alterar('plano_desenvolvimento', x.id, x.versao, {
        situacao: x.situacao,
        concluida_em: x.situacao === 'concluida' ? x.concluidaEm : null,
        motivo_situacao: x.motivo,
      });
    },
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
  /** As competências do cadastro do estabelecimento da sessão. */
  competencias(c: ContextoAvaliacao): Promise<CompetenciaRegistrada[]> {
    return this.ler(c, async (l, est) =>
      (await l.consultar<Linha>(`${SQL_COMPETENCIA} ORDER BY k.nome, k.id`, [est], { teto: 2000 })).map(
        competenciaDe,
      ),
    );
  }
  competencia(c: ContextoAvaliacao, id: number): Promise<CompetenciaRegistrada | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<Linha>(`${SQL_COMPETENCIA} AND k.id = ?`, [est, id]);
      return r ? competenciaDe(r) : null;
    });
  }
  /** As competências do estabelecimento ligadas a um cargo (ou a todos, cargo nulo). */
  competenciasDoCargo(c: ContextoAvaliacao, cargo: number | null): Promise<CompetenciaDoCargo[]> {
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar<Linha>(
        `SELECT cc.id, cc.cargo_id, k.id AS competencia, k.nome, k.ativo
           FROM cargo_competencia cc
           JOIN competencia_avaliacao k ON k.id = cc.competencia_avaliacao_id
          WHERE k.estabelecimento_id = ? AND k.excluido_em IS NULL AND cc.excluido_em IS NULL
            AND (? IS NULL OR cc.cargo_id = ?)
          ORDER BY k.nome, cc.id`,
        [est, cargo, cargo],
        { teto: 5000 },
      );
      return rs.map((r) => ({
        id: n(r['id']),
        cargo: n(r['cargo_id']),
        competencia: n(r['competencia']),
        nome: texto(r['nome']),
        ativa: verdadeiro(r['ativo']),
      }));
    });
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
      const rs = await l.consultar<Linha>(`${SQL_AVALIACAO}${filtro} ORDER BY a.id DESC`, [est, est, p], {
        teto: 2000,
      });
      return rs.map(avaliacaoDe);
    });
  }
  avaliacao(c: ContextoAvaliacao, id: number): Promise<AvaliacaoRegistrada | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<Linha>(`${SQL_AVALIACAO} AND a.id = ?`, [est, est, id]);
      return r ? avaliacaoDe(r) : null;
    });
  }
  notas(c: ContextoAvaliacao, avaliacao: number): Promise<NotaAvaliacao[]> {
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar<Linha>(
        `SELECT COALESCE(k.id, i.criterio_avaliacao_id) AS criterio_avaliacao_id, COALESCE(k.nome, cr.nome) AS nome,
                i.nota, i.comentario
           FROM avaliacao_desempenho_item i
           JOIN avaliacao_desempenho a ON a.id = i.avaliacao_desempenho_id AND a.estabelecimento_id = ?
           JOIN criterio_avaliacao cr ON cr.id = i.criterio_avaliacao_id
           LEFT JOIN competencia_avaliacao k ON cr.codigo = CONCAT('competencia-', k.id)
                                            AND k.estabelecimento_id = a.estabelecimento_id
          WHERE i.avaliacao_desempenho_id = ? AND i.excluido_em IS NULL
          ORDER BY nome, i.sequencia`,
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
  pdiDoColaborador(c: ContextoAvaliacao, vinculo: number): Promise<PdiRegistrado[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar<Linha>(
          `${SQL_PDI} AND p.vinculo_trabalho_id = ? ORDER BY p.prazo, p.id`,
          [est, vinculo],
          {
            teto: 2000,
          },
        )
      ).map(pdiDe),
    );
  }
  pdi(c: ContextoAvaliacao, id: number): Promise<PdiRegistrado | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<Linha>(`${SQL_PDI} AND p.id = ?`, [est, id]);
      return r ? pdiDe(r) : null;
    });
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
      if (alvo === 'competencia') {
        await somar(
          'Notas de avaliação',
          'avaliacao_desempenho_item',
          'criterio_avaliacao_id',
          `SELECT COUNT(*) AS q FROM avaliacao_desempenho_item i JOIN criterio_avaliacao c ON c.id = i.criterio_avaliacao_id
            WHERE c.codigo = ? AND i.excluido_em IS NULL`,
          [CODIGO_CRITERIO(id)],
        );
        await somar(
          'Cargos ligados',
          'cargo_competencia',
          'competencia_avaliacao_id',
          'SELECT COUNT(*) AS q FROM cargo_competencia WHERE competencia_avaliacao_id = ? AND excluido_em IS NULL',
          [id],
        );
        await somar(
          'Ações do PDI',
          'plano_desenvolvimento',
          'competencia_avaliacao_id',
          'SELECT COUNT(*) AS q FROM plano_desenvolvimento WHERE competencia_avaliacao_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [id, est],
        );
      } else if (alvo === 'ciclo-avaliacao')
        await somar(
          'Avaliações do ciclo',
          'avaliacao_desempenho',
          'ciclo_avaliacao_id',
          'SELECT COUNT(*) AS q FROM avaliacao_desempenho WHERE ciclo_avaliacao_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [id, est],
        );
      else
        await somar(
          'Ações do PDI',
          'plano_desenvolvimento',
          'avaliacao_desempenho_id',
          'SELECT COUNT(*) AS q FROM plano_desenvolvimento WHERE avaliacao_desempenho_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
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
