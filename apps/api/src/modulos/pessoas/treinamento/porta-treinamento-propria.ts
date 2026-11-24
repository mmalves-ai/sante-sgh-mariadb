// Porta PRÓPRIA dos treinamentos e da ciência de POP (fatia F6) sobre o MariaDB do cliente, pelo @sgh/nucleo:
// curso e treinamento_obrigatorio_funcao (o catálogo e o público obrigatório), turma_treinamento e presenca_treinamento
// (a turma e a lista de presença), documento_qualidade e documento_qualidade_versao (o POP versionado, do tipo de
// documento "procedimento operacional") e ciencia_procedimento (a ciência do colaborador), com as leituras de
// vinculo_trabalho, colaborador, cargo, funcao e setor_funcional. Leituras somente leitura no estabelecimento da sessão;
// gravações diretas numa operação do Executor (gravacaoDireta: trilha, outbox e idempotência na mesma transação).
// O catálogo de cursos é da rede inteira (a tabela curso não tem estabelecimento): o público obrigatório e tudo o mais
// filtram pelo estabelecimento da sessão.
// Melhoria: a turma ganha número de negócio (sequencia_negocio por estabelecimento, prefixo TR-).
// Melhoria: o POP é o documento controlado da qualidade (uma versão por publicação, com vigência, conteúdo e o
// responsável), não uma tabela à parte; a versão substituída fica obsoleta e a revogada, cancelada.
// Melhoria: o público obrigatório do curso é pela função cadastrada (FK), não por texto solto.
// Melhoria: a retirada da inscrição é exclusão lógica (excluido_em/por): a própria linha é o retrato, e o motivo vai à
// trilha; a reinscrição reaproveita a linha.
// Melhoria: a alteração da turma e a correção da presença vão à trilha_auditoria do núcleo, com o valor anterior e o
// novo em JSON, não a uma tabela de correções à parte.
// Melhoria: o nome do colaborador é o nome social quando houver.
// Pendente (pedido de DDL em docs/obra/fatias/f22/saida/03-11.json):
//   - presenca_treinamento não tem a data da conclusão nem a observação: a conclusão é marcada pelos minutos cumpridos
//     (a carga da turma); a data informada vai à trilha_auditoria da gravação (dados_depois.concluido_em) e é lida de
//     lá (a data de fim da turma só para linha sem trilha); a observação vai em justificativa_ausencia;
//   - presenca_treinamento liga o colaborador, não o vínculo: o vínculo lido é o do colaborador no estabelecimento
//     (o ativo mais recente);
//   - turma_treinamento guarda o documento do POP, não a versão: a versão escolhida vai à trilha_auditoria da inclusão e
//     da alteração da turma (dados_depois.pop_versao) e é lida de lá; nenhuma gravação posterior (outra alteração,
//     encerramento, cancelamento, nova versão do POP) muda a versão da turma, e a ciência pela conclusão é a da versão
//     trabalhada (só para turma sem trilha: a versão publicada até a criação, nunca a revogada depois);
// O público do curso: o obrigatório por função fica em treinamento_obrigatorio_funcao (com vigência); o público por
// unidade (setor funcional), o obrigatório para todo o estabelecimento (linha sem setor nem função) e o público do curso
// não obrigatório ficam em curso_publico_alvo, por estabelecimento. A categoria do contrato é o tipo do curso
// (modelo-curso.ts, a mesma tradução da porta em memória).
// Melhoria: o POP publicado pela tela de treinamento respeita o tipo de documento da qualidade: o tipo que exige o fluxo
// completo (elaboração, verificação e aprovação) recusa com `fluxo-da-qualidade`, o documento em fluxo na qualidade
// recusa com `pop-em-fluxo`, a aprovação não é forjada (aprovador e aprovado_em ficam nulos) e a próxima revisão sai do
// prazo do tipo.
import {
  type AproveitamentoTreinamentoCodigo,
  type CategoriaCurso,
  type ModalidadeTurma,
  type PresencaTreinamentoCodigo,
  type SituacaoPopCodigo,
  type SituacaoTurma,
} from '@sgh/contratos';
import { chaveFuncao } from '@sgh/dominio-pessoas';
import {
  ErroOperacao,
  type Executor,
  garantirSequencia,
  gravarTrilha,
  type Leitor,
  type Linha,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import {
  booleano,
  civilDe,
  dataDe,
  estabelecimentoDe,
  fusoDe,
  LOGIN_DE,
  localNoFuso,
  marcadores,
  num,
  numOuNulo,
  texto,
  textoOuNulo,
} from '../../enfermagem/banco-apoio.js';
import { gravacaoDireta } from '../../enfermagem/gravacao-direta.js';
import { type GravacaoFeita, portaIndisponivel, type TrilhaDaGravacao } from '../../exames/public-api.js';
import {
  type ContextoTreinamento,
  type GravadorTreinamento,
  METODOS_PORTA_TREINAMENTO,
  type PortaTreinamento,
} from './porta-treinamento.js';
import {
  type AlvoCursoTreinamento,
  type CamposCurso,
  type CienciaPop,
  type ConclusaoTreinamento,
  type CorrecaoTreinamento,
  type CursoTreinamento,
  type FiltroTurmas,
  type ParticipacaoDoVinculo,
  type ParticipanteTreinamento,
  TABELAS_CORRECAO,
  type TurmaTreinamento,
  type UnidadeTreinamento,
  type VersaoPop,
  type VinculoAtivoTreinamento,
  type VinculoResumoTreinamento,
} from './tipos-treinamento.js';
import { conferirModeloDoCurso } from './modelo-curso.js';

/** O que a porta usa do núcleo. */
export type NucleoTreinamento = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

/** As tabelas que as gravações do treinamento tocam (a operação do Executor recusa as outras). */
export const TABELAS_TREINAMENTO = [
  'curso',
  'treinamento_obrigatorio_funcao',
  'curso_publico_alvo',
  'turma_treinamento',
  'presenca_treinamento',
  'documento_qualidade',
  'documento_qualidade_versao',
  'ciencia_procedimento',
  'sequencia_negocio',
  // A trilha gravada pela própria gravação (gravarTrilha): a linha, a cadeia do dia e o fecho do dia anterior (SBIS-16).
  'trilha_auditoria',
  'trilha_cadeia',
  'trilha_auditoria_fecho',
] as const;

const TETO = 20_000;

// ── Vocabulário: contrato ↔ modelo ──────────────────────────────────────────────────────────────────────────────

const CATEGORIA_DO_TIPO: Readonly<Record<string, CategoriaCurso>> = {
  norma_regulamentadora: 'nr32',
  integracao: 'integracao',
  capacitacao: 'assistencial',
  educacao_continuada: 'assistencial',
  procedimento_operacional: 'pop',
  gestao: 'gestao',
  reciclagem: 'outro',
  outro: 'outro',
};
const MODALIDADE_DO_CONTRATO: Readonly<Record<ModalidadeTurma, string>> = {
  presencial: 'presencial',
  distancia: 'distancia',
  'em-servico': 'em_servico',
};
const MODALIDADE_DO_MODELO: Readonly<Record<string, ModalidadeTurma>> = {
  presencial: 'presencial',
  distancia: 'distancia',
  em_servico: 'em-servico',
};
const SITUACAO_TURMA: Readonly<Record<string, SituacaoTurma>> = {
  aberta: 'aberta',
  em_andamento: 'aberta',
  concluida: 'encerrada',
  cancelada: 'cancelada',
};
const SITUACOES_DA_TURMA: Readonly<Record<SituacaoTurma, readonly string[]>> = {
  aberta: ['aberta', 'em_andamento'],
  encerrada: ['concluida'],
  cancelada: ['cancelada'],
};
const SITUACAO_POP: Readonly<Record<string, SituacaoPopCodigo>> = {
  vigente: 'vigente',
  obsoleta: 'substituido',
  cancelada: 'revogado',
};
const PRESENCA: Readonly<Record<string, PresencaTreinamentoCodigo>> = {
  inscrito: 'inscrito',
  presente: 'presente',
  ausente: 'ausente',
  justificado: 'ausente',
  cancelado: 'ausente',
};

const desatualizado = () =>
  new ErroOperacao(
    409,
    'desatualizado',
    'Operação recusada',
    'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
  );

const json = (v: unknown): Record<string, unknown> => {
  if (v === null || v === undefined) return {};
  if (typeof v === 'string') {
    try {
      const x: unknown = JSON.parse(v);
      return x && typeof x === 'object' ? (x as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof v === 'object' ? (v as Record<string, unknown>) : {};
};

/** O vínculo do colaborador no estabelecimento: o não desligado mais recente. */
const VINCULO_DO_COLABORADOR = (colaborador: string, estabelecimento: string) =>
  `(SELECT v.id FROM vinculo_trabalho v WHERE v.colaborador_id = ${colaborador} AND v.estabelecimento_id = ${estabelecimento}
     AND v.excluido_em IS NULL ORDER BY v.data_desligamento IS NULL DESC, v.data_admissao DESC, v.id DESC LIMIT 1)`;

// ── SQL ─────────────────────────────────────────────────────────────────────────────────────────────────────

const SQL_CURSO = `SELECT c.id, c.codigo, c.nome, c.conteudo, c.tipo, c.carga_minutos, c.validade_meses, c.ativo, c.versao
  FROM curso c WHERE c.excluido_em IS NULL`;

const CONCLUIDO = `p.situacao = 'presente' AND p.minutos_cumpridos > 0 AND p.aproveitamento IN ('aprovado','nao_avaliado')`;

const SQL_TURMA = `SELECT t.id, t.curso_id, t.data_inicio, t.data_fim, t.carga_horaria_minutos, t.instrutor_nome, t.modalidade,
    t.local_descricao, t.observacao, t.situacao, t.motivo_alteracao, t.versao,
    CASE WHEN t.documento_qualidade_id IS NULL THEN NULL ELSE COALESCE(
      (SELECT CAST(JSON_VALUE(a.dados_depois, '$.pop_versao') AS UNSIGNED) FROM trilha_auditoria a
        WHERE a.estabelecimento_id = t.estabelecimento_id AND a.entidade = 'turma_treinamento' AND a.entidade_id = t.id
          AND JSON_EXISTS(a.dados_depois, '$.pop_versao') ORDER BY a.id DESC LIMIT 1),
      (SELECT v.id FROM documento_qualidade_versao v WHERE v.documento_qualidade_id = t.documento_qualidade_id
         AND v.situacao IN ('vigente','obsoleta','cancelada') AND v.publicado_em <= t.criado_em
         ORDER BY v.publicado_em DESC, v.id DESC LIMIT 1)) END AS pop_id,
    (SELECT COUNT(*) FROM presenca_treinamento p WHERE p.turma_treinamento_id = t.id AND p.excluido_em IS NULL) AS participantes,
    (SELECT COUNT(*) FROM presenca_treinamento p WHERE p.turma_treinamento_id = t.id AND p.excluido_em IS NULL AND ${CONCLUIDO}) AS concluintes
  FROM turma_treinamento t WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL`;

const SQL_PARTICIPANTE = `SELECT p.id, p.turma_treinamento_id, p.colaborador_id, p.situacao, p.aproveitamento, p.minutos_cumpridos,
    p.certificado_valido_ate, p.justificativa_ausencia, p.versao, t.curso_id, t.data_inicio, t.data_fim,
    t.carga_horaria_minutos, t.instrutor_nome, t.situacao AS turma_situacao,
    COALESCE((SELECT JSON_VALUE(a.dados_depois, '$.concluido_em') FROM trilha_auditoria a
       WHERE a.estabelecimento_id = t.estabelecimento_id AND a.entidade = 'presenca_treinamento' AND a.entidade_id = p.id
         AND JSON_EXISTS(a.dados_depois, '$.concluido_em') ORDER BY a.id DESC LIMIT 1), t.data_fim) AS concluido_em,
    ${VINCULO_DO_COLABORADOR('p.colaborador_id', 't.estabelecimento_id')} AS vinculo_id
  FROM presenca_treinamento p JOIN turma_treinamento t ON t.id = p.turma_treinamento_id
  WHERE t.estabelecimento_id = ? AND p.excluido_em IS NULL AND t.excluido_em IS NULL`;

const SQL_POP = `SELECT v.id, d.codigo, v.numero_versao, d.titulo, d.setor_funcional_id, v.vigencia_inicio, v.conteudo, v.dados,
    v.motivo_alteracao, v.situacao, v.publicado_em, ${LOGIN_DE('v.elaborador_usuario_id')} AS publicado_por
  FROM documento_qualidade_versao v JOIN documento_qualidade d ON d.id = v.documento_qualidade_id
  JOIN tipo_documento_qualidade td ON td.id = d.tipo_documento_qualidade_id
  WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL AND td.categoria = 'procedimento_operacional'
    AND v.situacao IN ('vigente','obsoleta','cancelada')`;

const SQL_CIENCIA = `SELECT c.id, c.documento_qualidade_versao_id, c.forma, c.turma_treinamento_id, c.ciente_em,
    ${LOGIN_DE('c.criado_por')} AS registrado_por, ${VINCULO_DO_COLABORADOR('c.colaborador_id', 'd.estabelecimento_id')} AS vinculo_id
  FROM ciencia_procedimento c JOIN documento_qualidade d ON d.id = c.documento_qualidade_id
  WHERE d.estabelecimento_id = ? AND c.excluido_em IS NULL`;

const SQL_VINCULO = `SELECT v.id, COALESCE(c.nome_social, c.nome) AS nome, v.matricula, cg.nome AS cargo, f.nome AS funcao,
    v.setor_funcional_id, v.data_admissao, v.data_desligamento
  FROM vinculo_trabalho v JOIN colaborador c ON c.id = v.colaborador_id JOIN cargo cg ON cg.id = v.cargo_id
  LEFT JOIN funcao f ON f.id = v.funcao_id
  WHERE v.estabelecimento_id = ? AND v.excluido_em IS NULL`;

// ── Leituras (no leitor somente leitura ou na transação da gravação) ─────────────────────────────────────────

class Leituras {
  private fuso: string | null = null;
  constructor(
    readonly l: Leitor,
    readonly est: number,
  ) {}

  async fusoDoEstabelecimento(): Promise<string> {
    if (this.fuso === null) this.fuso = await fusoDe(this.l, this.est);
    return this.fuso;
  }

  async relogio(): Promise<{ hoje: string; agora: string }> {
    const agora = localNoFuso(new Date(), await this.fusoDoEstabelecimento()).slice(0, 16);
    return { hoje: agora.slice(0, 10), agora };
  }

  async unidades(): Promise<UnidadeTreinamento[]> {
    const ls = await this.l.consultar(
      'SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND ativo = TRUE ORDER BY nome, id',
      [this.est],
      { teto: TETO },
    );
    return ls.map((x) => ({ codigo: num(x['id']), nome: texto(x['nome']) }));
  }

  async cursos(id: number | null = null): Promise<CursoTreinamento[]> {
    const ls = await this.l.consultar(
      `${SQL_CURSO}${id !== null ? ' AND c.id = ?' : ''} ORDER BY c.codigo`,
      id !== null ? [id] : [],
      { teto: TETO },
    );
    if (ls.length === 0) return [];
    const ids = ls.map((x) => num(x['id']));
    const alvos = await this.l.consultar(
      `SELECT o.curso_id, f.nome FROM treinamento_obrigatorio_funcao o JOIN funcao f ON f.id = o.funcao_id
        WHERE f.estabelecimento_id = ? AND o.curso_id IN (${marcadores(ids.length)})
          AND o.excluido_em IS NULL AND o.vigencia_fim IS NULL AND f.excluido_em IS NULL ORDER BY f.nome`,
      [this.est, ...ids],
      { teto: TETO },
    );
    const outros = await this.l.consultar(
      `SELECT p.curso_id, p.setor_funcional_id, f.nome AS funcao, p.obrigatorio FROM curso_publico_alvo p
         LEFT JOIN funcao f ON f.id = p.funcao_id
        WHERE p.estabelecimento_id = ? AND p.curso_id IN (${marcadores(ids.length)}) AND p.excluido_em IS NULL
        ORDER BY p.id`,
      [this.est, ...ids],
      { teto: TETO },
    );
    const porCurso = new Map<number, AlvoCursoTreinamento[]>();
    const obrigatorios = new Set<number>();
    for (const a of alvos) {
      const k = num(a['curso_id']);
      obrigatorios.add(k);
      porCurso.set(k, [...(porCurso.get(k) ?? []), { tipo: 'funcao', valor: chaveFuncao(texto(a['nome'])) }]);
    }
    for (const a of outros) {
      const k = num(a['curso_id']);
      if (booleano(a['obrigatorio'])) obrigatorios.add(k);
      const alvo: AlvoCursoTreinamento | null =
        a['setor_funcional_id'] !== null
          ? { tipo: 'unidade', valor: String(num(a['setor_funcional_id'])) }
          : a['funcao'] !== null
            ? { tipo: 'funcao', valor: chaveFuncao(texto(a['funcao'])) }
            : null;
      porCurso.set(k, [...(porCurso.get(k) ?? []), ...(alvo ? [alvo] : [])]);
    }
    return ls.map((x) => {
      const publico = porCurso.get(num(x['id'])) ?? [];
      return {
        id: num(x['id']),
        codigo: texto(x['codigo']),
        titulo: texto(x['nome']),
        conteudo: texto(x['conteudo']),
        categoria: CATEGORIA_DO_TIPO[texto(x['tipo'])] ?? 'outro',
        cargaMinimaMin: num(x['carga_minutos']),
        validadeMeses: num(x['validade_meses']),
        obrigatorio: obrigatorios.has(num(x['id'])),
        ativo: booleano(x['ativo']),
        alvos: publico,
        versao: num(x['versao']),
      };
    });
  }

  private turmaDe(x: Linha): TurmaTreinamento {
    return {
      id: num(x['id']),
      curso: num(x['curso_id']),
      inicio: dataDe(x['data_inicio']) ?? '',
      fim: dataDe(x['data_fim']) ?? '',
      cargaMin: num(x['carga_horaria_minutos']),
      instrutor: texto(x['instrutor_nome']),
      modalidade: MODALIDADE_DO_MODELO[texto(x['modalidade'])] ?? 'presencial',
      local: textoOuNulo(x['local_descricao']),
      pop: numOuNulo(x['pop_id']),
      observacao: textoOuNulo(x['observacao']),
      situacao: SITUACAO_TURMA[texto(x['situacao'])] ?? 'aberta',
      motivo: textoOuNulo(x['motivo_alteracao']),
      versao: num(x['versao']),
      participantes: num(x['participantes']),
      concluintes: num(x['concluintes']),
    };
  }

  async turmas(f: FiltroTurmas): Promise<TurmaTreinamento[]> {
    const conds: string[] = [];
    const ps: unknown[] = [this.est];
    if (f.situacao) {
      const ss = SITUACOES_DA_TURMA[f.situacao];
      conds.push(`t.situacao IN (${marcadores(ss.length)})`);
      ps.push(...ss);
    }
    if (f.curso) {
      conds.push('t.curso_id = ?');
      ps.push(f.curso);
    }
    if (f.de) {
      conds.push('t.data_inicio >= ?');
      ps.push(f.de);
    }
    if (f.ate) {
      conds.push('t.data_inicio <= ?');
      ps.push(f.ate);
    }
    const ls = await this.l.consultar(
      `${SQL_TURMA}${conds.map((c) => ` AND ${c}`).join('')} ORDER BY t.data_inicio DESC, t.id DESC`,
      ps,
      { teto: TETO },
    );
    return ls.map((x) => this.turmaDe(x));
  }

  async turma(id: number): Promise<TurmaTreinamento | null> {
    const [x] = await this.l.consultar(`${SQL_TURMA} AND t.id = ?`, [this.est, id], { teto: 1 });
    return x ? this.turmaDe(x) : null;
  }

  private participanteDe(x: Linha, vinculo?: number): ParticipanteTreinamento {
    const concluido = texto(x['situacao']) === 'presente' && num(x['minutos_cumpridos']) > 0;
    const ap = texto(x['aproveitamento']);
    const aproveitamento: AproveitamentoTreinamentoCodigo | null =
      ap === 'aprovado' || ap === 'reprovado' ? ap : concluido ? 'sem-avaliacao' : null;
    return {
      id: num(x['id']),
      treinamento: num(x['turma_treinamento_id']),
      vinculo: vinculo ?? num(x['vinculo_id']),
      presenca: PRESENCA[texto(x['situacao'])] ?? 'inscrito',
      aproveitamento,
      conclusao: num(x['minutos_cumpridos']) > 0 ? dataDe(x['concluido_em']) : null,
      validoAte: dataDe(x['certificado_valido_ate']),
      observacao: textoOuNulo(x['justificativa_ausencia']),
      versao: num(x['versao']),
    };
  }

  async participantes(turma: number): Promise<ParticipanteTreinamento[]> {
    const ls = await this.l.consultar(
      `${SQL_PARTICIPANTE} AND p.turma_treinamento_id = ? ORDER BY p.sequencia`,
      [this.est, turma],
      { teto: TETO },
    );
    return ls.map((x) => this.participanteDe(x));
  }

  async participacoes(vinculo: number): Promise<ParticipacaoDoVinculo[]> {
    const ls = await this.l.consultar(
      `${SQL_PARTICIPANTE} AND p.colaborador_id = (SELECT colaborador_id FROM vinculo_trabalho WHERE id = ? AND estabelecimento_id = ?)
        ORDER BY t.data_inicio DESC, p.id DESC`,
      [this.est, vinculo, this.est],
      { teto: TETO },
    );
    return ls.map((x) => ({
      ...this.participanteDe(x, vinculo),
      curso: num(x['curso_id']),
      inicio: dataDe(x['data_inicio']) ?? '',
      fim: dataDe(x['data_fim']) ?? '',
      cargaMin: num(x['carga_horaria_minutos']),
      instrutor: texto(x['instrutor_nome']),
      turmaSituacao: SITUACAO_TURMA[texto(x['turma_situacao'])] ?? 'aberta',
    }));
  }

  /** Os pares vínculo → colaborador dos vínculos pedidos (só os do estabelecimento). */
  private async colaboradores(vinculos: readonly number[]): Promise<Map<number, number[]>> {
    const m = new Map<number, number[]>();
    if (vinculos.length === 0) return m;
    const ls = await this.l.consultar(
      `SELECT id, colaborador_id FROM vinculo_trabalho WHERE estabelecimento_id = ? AND id IN (${marcadores(vinculos.length)})
         AND excluido_em IS NULL`,
      [this.est, ...vinculos],
      { teto: TETO },
    );
    for (const x of ls) {
      const col = num(x['colaborador_id']);
      m.set(col, [...(m.get(col) ?? []), num(x['id'])]);
    }
    return m;
  }

  async conclusoes(vinculos: readonly number[] | null): Promise<ConclusaoTreinamento[]> {
    const base = `${SQL_PARTICIPANTE} AND ${CONCLUIDO} AND t.situacao <> 'cancelada'`;
    if (vinculos === null) {
      const ls = await this.l.consultar(base, [this.est], { teto: 200_000 });
      return ls.map((x) => ({
        vinculo: num(x['vinculo_id']),
        curso: num(x['curso_id']),
        conclusao: dataDe(x['concluido_em']) ?? '',
        validoAte: dataDe(x['certificado_valido_ate']),
      }));
    }
    const cols = await this.colaboradores(vinculos);
    if (cols.size === 0) return [];
    const ls = await this.l.consultar(
      `${base} AND p.colaborador_id IN (${marcadores(cols.size)})`,
      [this.est, ...cols.keys()],
      { teto: TETO },
    );
    return ls.flatMap((x) =>
      (cols.get(num(x['colaborador_id'])) ?? []).map((v) => ({
        vinculo: v,
        curso: num(x['curso_id']),
        conclusao: dataDe(x['concluido_em']) ?? '',
        validoAte: dataDe(x['certificado_valido_ate']),
      })),
    );
  }

  private async popDe(x: Linha): Promise<VersaoPop> {
    const d = json(x['dados']);
    const unidade = 'unidade' in d ? numOuNulo(d['unidade']) : numOuNulo(x['setor_funcional_id']);
    return {
      id: num(x['id']),
      codigo: texto(x['codigo']),
      versao: num(x['numero_versao']),
      titulo: typeof d['titulo'] === 'string' ? d['titulo'] : texto(x['titulo']),
      unidade,
      vigencia: dataDe(x['vigencia_inicio']) ?? '',
      resumo: texto(x['conteudo']),
      referencia: typeof d['referencia'] === 'string' ? d['referencia'] : null,
      alteracoes: textoOuNulo(x['motivo_alteracao']),
      situacao: SITUACAO_POP[texto(x['situacao'])] ?? 'revogado',
      motivo: typeof d['motivo'] === 'string' ? d['motivo'] : null,
      publicadoPor: texto(x['publicado_por']),
      publicadoEm: (civilDe(x['publicado_em'], await this.fusoDoEstabelecimento()) ?? '').slice(0, 16),
    };
  }

  async pops(f: { vigentes?: boolean; codigo?: string; id?: number }): Promise<VersaoPop[]> {
    const conds: string[] = [];
    const ps: unknown[] = [this.est];
    if (f.vigentes) conds.push("v.situacao = 'vigente'");
    if (f.codigo) {
      conds.push('d.codigo = ?');
      ps.push(f.codigo);
    }
    if (f.id !== undefined) {
      conds.push('v.id = ?');
      ps.push(f.id);
    }
    const ls = await this.l.consultar(
      `${SQL_POP}${conds.map((c) => ` AND ${c}`).join('')} ORDER BY d.codigo, CAST(v.numero_versao AS UNSIGNED) DESC, v.id DESC`,
      ps,
      { teto: TETO },
    );
    const r: VersaoPop[] = [];
    for (const x of ls) r.push(await this.popDe(x));
    return r;
  }

  async ciencias(f: { vinculo?: number; pops?: readonly number[] }): Promise<CienciaPop[]> {
    if (f.pops && f.pops.length === 0) return [];
    const conds: string[] = [];
    const ps: unknown[] = [this.est];
    if (f.vinculo !== undefined) {
      conds.push(
        'c.colaborador_id = (SELECT colaborador_id FROM vinculo_trabalho WHERE id = ? AND estabelecimento_id = ?)',
      );
      ps.push(f.vinculo, this.est);
    }
    if (f.pops) {
      conds.push(`c.documento_qualidade_versao_id IN (${marcadores(f.pops.length)})`);
      ps.push(...f.pops);
    }
    const ls = await this.l.consultar(
      `${SQL_CIENCIA}${conds.map((c) => ` AND ${c}`).join('')} ORDER BY c.id`,
      ps,
      {
        teto: 200_000,
      },
    );
    const fuso = await this.fusoDoEstabelecimento();
    return ls.map((x) => ({
      id: num(x['id']),
      pop: num(x['documento_qualidade_versao_id']),
      vinculo: f.vinculo ?? num(x['vinculo_id']),
      origem: texto(x['forma']) === 'treinamento' ? 'treinamento' : 'proprio',
      treinamento: numOuNulo(x['turma_treinamento_id']),
      registradoPor: texto(x['registrado_por']),
      registradoEm: (civilDe(x['ciente_em'], fuso) ?? '').slice(0, 16),
    }));
  }

  private vinculoDe(x: Linha): VinculoResumoTreinamento {
    return {
      id: num(x['id']),
      nome: texto(x['nome']),
      matricula: textoOuNulo(x['matricula']),
      cargo: texto(x['cargo']),
      funcao: textoOuNulo(x['funcao']),
      unidade: numOuNulo(x['setor_funcional_id']),
      admissao: dataDe(x['data_admissao']) ?? '',
      desligamento: dataDe(x['data_desligamento']),
    };
  }

  async ativos(unidade: number | null): Promise<VinculoAtivoTreinamento[]> {
    const ls = await this.l.consultar(
      `${SQL_VINCULO} AND v.data_desligamento IS NULL AND v.situacao IN ('ativo','afastado')${unidade !== null ? ' AND v.setor_funcional_id = ?' : ''}
        ORDER BY nome, v.id`,
      unidade !== null ? [this.est, unidade] : [this.est],
      { teto: 200_000 },
    );
    return ls.map((x) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- o campo é descartado de propósito
      const { desligamento: _d, ...v } = this.vinculoDe(x);
      return v;
    });
  }

  async vinculos(ids: readonly number[]): Promise<VinculoResumoTreinamento[]> {
    const unicos = [...new Set(ids)];
    if (unicos.length === 0) return [];
    const ls = await this.l.consultar(
      `${SQL_VINCULO} AND v.id IN (${marcadores(unicos.length)})`,
      [this.est, ...unicos],
      {
        teto: TETO,
      },
    );
    return ls.map((x) => this.vinculoDe(x));
  }

  async correcoes(tabela: string, registros: readonly number[]): Promise<CorrecaoTreinamento[]> {
    if (registros.length === 0 || !(TABELAS_CORRECAO as readonly string[]).includes(tabela)) return [];
    const ls = await this.l.consultar(
      `SELECT a.id, a.entidade, a.entidade_id, a.dados_antes, a.dados_depois, a.motivo, a.ocorrido_em,
          ${LOGIN_DE('a.usuario_id')} AS por
        FROM trilha_auditoria a
        WHERE a.estabelecimento_id = ? AND a.entidade = ? AND a.entidade_id IN (${marcadores(registros.length)})
          AND a.acao = 'alteracao' AND JSON_VALUE(a.dados_depois, '$.correcao') IS NOT NULL
        ORDER BY a.id DESC`,
      [this.est, tabela, ...registros],
      { teto: TETO },
    );
    const fuso = await this.fusoDoEstabelecimento();
    return ls.map((x) => {
      const depois = json(x['dados_depois']);
      return {
        id: num(x['id']),
        tabela: texto(x['entidade']),
        registro: num(x['entidade_id']),
        operacao: texto(depois['correcao']),
        antes: json(x['dados_antes']),
        depois: json(depois['valores']),
        motivo: texto(x['motivo']),
        por: texto(x['por']),
        em: (civilDe(x['ocorrido_em'], fuso) ?? '').slice(0, 16),
      };
    });
  }
}

// ── Gravações (dentro da operação do Executor) ──────────────────────────────────────────────────────────────

class Gravacoes implements GravadorTreinamento {
  private readonly ler: Leituras;
  constructor(
    private readonly tx: TxOperacao,
    private readonly est: number,
    private readonly c: ContextoTreinamento,
  ) {
    this.ler = new Leituras(tx, est);
  }

  private get usuario(): number | null {
    return this.c.usuario ?? null;
  }
  private carimbo() {
    return { usuario: this.usuario, agora: new Date() };
  }
  private async hoje(): Promise<string> {
    return (await this.ler.relogio()).hoje;
  }

  curso(id: number) {
    return this.ler.cursos(id).then((r) => r[0] ?? null);
  }
  turma(id: number) {
    return this.ler.turma(id);
  }
  participantes(t: number) {
    return this.ler.participantes(t);
  }
  pop(id: number) {
    return this.ler.pops({ id }).then((r) => r[0] ?? null);
  }
  versoesPop(codigo: string) {
    return this.ler.pops({ codigo });
  }
  ciencias(f: { vinculo?: number; pops?: readonly number[] }) {
    return this.ler.ciencias(f);
  }

  private valoresCurso(x: CamposCurso, tipo: string) {
    return {
      codigo: x.codigo.trim(),
      nome: x.titulo.trim(),
      tipo,
      norma_regulamentadora: x.categoria === 'nr32' ? 'NR-32' : null,
      carga_minutos: x.cargaMinimaMin,
      conteudo: x.conteudo,
      validade_meses: x.validadeMeses > 0 ? x.validadeMeses : null,
    };
  }

  private async codigoLivre(codigo: string, outro: number | null): Promise<void> {
    const r = await this.tx.uma<{ id: number }>(
      'SELECT id FROM curso WHERE codigo = ? AND excluido_em IS NULL',
      [codigo.trim()],
    );
    if (r && Number(r.id) !== outro) throw recusa('codigo-repetido', 'Já existe um curso com este código.');
  }

  /**
   * O público do curso neste estabelecimento. O obrigatório por função vai a treinamento_obrigatorio_funcao; o resto
   * (unidade, "todo o estabelecimento" do obrigatório sem alvo e o público do não obrigatório) a curso_publico_alvo.
   */
  private async sincronizarPublico(
    curso: number,
    obrigatorio: boolean,
    alvos: readonly AlvoCursoTreinamento[],
  ): Promise<void> {
    const porFuncao = obrigatorio ? alvos.filter((a) => a.tipo === 'funcao') : [];
    await this.sincronizarObrigatorioFuncao(curso, porFuncao);
    const setores = await this.tx.consultar(
      'SELECT id FROM setor_funcional WHERE estabelecimento_id = ?',
      [this.est],
      {
        teto: TETO,
      },
    );
    const setorExiste = new Set(setores.map((s) => num(s['id'])));
    const quer = new Map<string, { setor: number | null; funcao: number | null }>();
    for (const a of alvos) {
      if (a.tipo === 'unidade') {
        const id = /^\d+$/.test(a.valor) ? Number(a.valor) : NaN;
        if (!setorExiste.has(id))
          throw recusa('unidade-inexistente', `A unidade ${a.valor} não existe neste estabelecimento.`, {
            campos: ['alvos'],
          });
        quer.set(`s${id}`, { setor: id, funcao: null });
      } else if (!obrigatorio) {
        quer.set(`f${a.valor}`, { setor: null, funcao: await this.funcaoPorChave(a.valor) });
      }
    }
    if (obrigatorio && alvos.length === 0) quer.set('todos', { setor: null, funcao: null });
    const agora = new Date();
    const atuais = await this.tx.consultar(
      `SELECT id, setor_funcional_id, funcao_id, obrigatorio, excluido_em, versao FROM curso_publico_alvo
        WHERE curso_id = ? AND estabelecimento_id = ?`,
      [curso, this.est],
      { teto: TETO },
    );
    const vistos = new Set<string>();
    for (const o of atuais) {
      const setor = o['setor_funcional_id'] === null ? null : num(o['setor_funcional_id']);
      const funcao = o['funcao_id'] === null ? null : num(o['funcao_id']);
      const chave =
        setor !== null
          ? `s${setor}`
          : funcao !== null
            ? [...quer].find(([, v]) => v.funcao === funcao)?.[0]
            : 'todos';
      const ativo = o['excluido_em'] === null;
      if (chave !== undefined && quer.has(chave)) {
        vistos.add(chave);
        if (!ativo || booleano(o['obrigatorio']) !== obrigatorio)
          await this.tx.executar(
            `UPDATE curso_publico_alvo SET excluido_em = NULL, excluido_por = NULL, obrigatorio = ?, alterado_em = ?,
               alterado_por = ?, versao = versao + 1 WHERE id = ?`,
            [obrigatorio, agora, this.usuario, num(o['id'])],
          );
      } else if (ativo)
        await this.tx.executar(
          `UPDATE curso_publico_alvo SET excluido_em = ?, excluido_por = ?, alterado_em = ?, alterado_por = ?,
             versao = versao + 1 WHERE id = ?`,
          [agora, this.usuario, agora, this.usuario, num(o['id'])],
        );
    }
    for (const [chave, v] of quer) {
      if (vistos.has(chave)) continue;
      await this.tx.incluir('curso_publico_alvo', {
        curso_id: curso,
        estabelecimento_id: this.est,
        setor_funcional_id: v.setor,
        funcao_id: v.funcao,
        obrigatorio,
      });
    }
  }

  /** A função do estabelecimento pela chave (sem acento, maiúsculas); recusa se não existir. */
  private async funcaoPorChave(chave: string): Promise<number> {
    const funcoes = await this.tx.consultar(
      'SELECT id, nome FROM funcao WHERE estabelecimento_id = ? AND excluido_em IS NULL',
      [this.est],
      { teto: TETO },
    );
    const f = funcoes.find((x) => chaveFuncao(texto(x['nome'])) === chave);
    if (!f)
      throw recusa('funcao-inexistente', `A função ${chave} não existe neste estabelecimento.`, {
        campos: ['alvos'],
      });
    return num(f['id']);
  }

  /** O curso obrigatório por função: as funções pedidas ficam; as outras saem (exclusão lógica). */
  private async sincronizarObrigatorioFuncao(
    curso: number,
    alvos: readonly AlvoCursoTreinamento[],
  ): Promise<void> {
    const funcoes = await this.tx.consultar(
      'SELECT id, nome FROM funcao WHERE estabelecimento_id = ? AND excluido_em IS NULL',
      [this.est],
      { teto: TETO },
    );
    const porChave = new Map(funcoes.map((f) => [chaveFuncao(texto(f['nome'])), num(f['id'])]));
    const quer = new Set<number>();
    for (const a of alvos) {
      const id = porChave.get(a.valor);
      if (id === undefined)
        throw recusa('funcao-inexistente', `A função ${a.valor} não existe neste estabelecimento.`, {
          campos: ['alvos'],
        });
      quer.add(id);
    }
    const agora = new Date();
    const atuais = await this.tx.consultar(
      `SELECT o.id, o.funcao_id FROM treinamento_obrigatorio_funcao o JOIN funcao f ON f.id = o.funcao_id
        WHERE o.curso_id = ? AND f.estabelecimento_id = ? AND o.excluido_em IS NULL AND o.vigencia_fim IS NULL`,
      [curso, this.est],
      { teto: TETO },
    );
    const tem = new Set<number>();
    for (const o of atuais) {
      const f = num(o['funcao_id']);
      if (quer.has(f)) tem.add(f);
      else
        await this.tx.executar(
          `UPDATE treinamento_obrigatorio_funcao SET excluido_em = ?, excluido_por = ?, alterado_em = ?, alterado_por = ?,
             versao = versao + 1 WHERE id = ?`,
          [agora, this.usuario, agora, this.usuario, num(o['id'])],
        );
    }
    const hoje = await this.hoje();
    for (const f of quer) {
      if (tem.has(f)) continue;
      const antiga = await this.tx.uma<{ id: number }>(
        'SELECT id FROM treinamento_obrigatorio_funcao WHERE funcao_id = ? AND curso_id = ? AND vigencia_inicio = ?',
        [f, curso, hoje],
      );
      if (antiga)
        await this.tx.executar(
          `UPDATE treinamento_obrigatorio_funcao SET excluido_em = NULL, excluido_por = NULL, vigencia_fim = NULL,
             alterado_em = ?, alterado_por = ?, versao = versao + 1 WHERE id = ?`,
          [agora, this.usuario, Number(antiga.id)],
        );
      else
        await this.tx.incluir('treinamento_obrigatorio_funcao', {
          funcao_id: f,
          curso_id: curso,
          vigencia_inicio: hoje,
        });
    }
  }

  async incluirCurso(x: CamposCurso & { readonly por: string }): Promise<number> {
    const tipo = conferirModeloDoCurso(x);
    await this.codigoLivre(x.codigo, null);
    const id = await this.tx.incluir('curso', { ...this.valoresCurso(x, tipo), ativo: true });
    await this.sincronizarPublico(id, x.obrigatorio, x.alvos);
    return id;
  }

  async alterarCurso(
    x: CamposCurso & { id: number; versao: number; ativo: boolean; por: string },
  ): Promise<void> {
    const tipo = conferirModeloDoCurso(x);
    await this.codigoLivre(x.codigo, x.id);
    await this.tx.alterar('curso', x.id, x.versao, { ...this.valoresCurso(x, tipo), ativo: x.ativo });
    await this.sincronizarPublico(x.id, x.obrigatorio, x.alvos);
  }

  /** O documento do POP pela versão (só do estabelecimento). */
  private async documentoDaVersao(versao: number): Promise<number> {
    const r = await this.tx.uma<{ documento_qualidade_id: number }>(
      `SELECT v.documento_qualidade_id FROM documento_qualidade_versao v
         JOIN documento_qualidade d ON d.id = v.documento_qualidade_id
        WHERE v.id = ? AND d.estabelecimento_id = ? AND d.excluido_em IS NULL`,
      [versao, this.est],
    );
    if (!r) throw recusa('pop-inexistente', 'O POP não existe neste estabelecimento.', { campos: ['pop'] });
    return Number(r.documento_qualidade_id);
  }

  private async valoresTurma(x: {
    inicio: string;
    fim: string;
    cargaMin: number;
    instrutor: string;
    modalidade: ModalidadeTurma;
    local: string | null;
    pop: number | null;
    observacao: string | null;
  }) {
    return {
      data_inicio: x.inicio,
      data_fim: x.fim,
      carga_horaria_minutos: x.cargaMin,
      modalidade: MODALIDADE_DO_CONTRATO[x.modalidade],
      instrutor_nome: x.instrutor.trim(),
      local_descricao: x.local,
      documento_qualidade_id: x.pop !== null ? await this.documentoDaVersao(x.pop) : null,
      observacao: x.observacao,
    };
  }

  async incluirTurma(x: Parameters<GravadorTreinamento['incluirTurma']>[0]): Promise<number> {
    const curso = await this.tx.uma('SELECT id FROM curso WHERE id = ? AND excluido_em IS NULL', [x.curso]);
    if (!curso) throw recusa('curso-inexistente', 'O curso não existe.', { campos: ['curso'] });
    await garantirSequencia(
      this.tx,
      { tipo: 'turma_treinamento', estabelecimento: this.est, prefixo: 'TR-' },
      this.carimbo(),
    );
    const numero = await this.tx.proximoNumero('turma_treinamento');
    const id = await this.tx.incluir('turma_treinamento', {
      estabelecimento_id: this.est,
      numero: numero.formatado,
      curso_id: x.curso,
      ...(await this.valoresTurma(x)),
      situacao: 'aberta',
    });
    await this.guardarNaTrilha('inclusao', 'turma_treinamento', id, { pop_versao: x.pop });
    return id;
  }

  /** Até o DDL pedido (versão do POP na turma, data da conclusão), o dado vai à trilha da gravação e é lido de lá. */
  private async guardarNaTrilha(
    acao: 'inclusao' | 'alteracao',
    entidade: 'turma_treinamento' | 'presenca_treinamento',
    id: number,
    dados: Record<string, unknown>,
  ): Promise<void> {
    await gravarTrilha(this.tx, {
      estabelecimento: this.est,
      usuario: this.usuario,
      acao,
      entidade,
      entidadeId: id,
      dadosDepois: dados,
      correlacao: this.c.correlacao || null,
      ocorridoEm: new Date(),
    });
  }

  /** A turma travada (FOR UPDATE), conferida pela versão e aberta. */
  private async turmaAbertaTravada(id: number, versao: number): Promise<void> {
    const [t] = await this.tx.consultarParaAtualizar(
      'SELECT id, versao, situacao FROM turma_treinamento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [id, this.est],
      { teto: 1 },
    );
    if (!t || num(t['versao']) !== versao || !SITUACOES_DA_TURMA.aberta.includes(texto(t['situacao'])))
      throw desatualizado();
  }

  async situacaoTurma(x: Parameters<GravadorTreinamento['situacaoTurma']>[0]): Promise<void> {
    await this.turmaAbertaTravada(x.id, x.versao);
    await this.tx.alterar('turma_treinamento', x.id, x.versao, {
      situacao: x.situacao === 'encerrada' ? 'concluida' : 'cancelada',
      motivo_alteracao: x.motivo,
    });
  }

  async alterarTurma(x: Parameters<GravadorTreinamento['alterarTurma']>[0]): Promise<void> {
    await this.turmaAbertaTravada(x.id, x.versao);
    const antes = await this.ler.turma(x.id);
    await this.tx.alterar('turma_treinamento', x.id, x.versao, await this.valoresTurma(x));
    if (antes?.pop !== x.pop)
      await this.guardarNaTrilha('alteracao', 'turma_treinamento', x.id, { pop_versao: x.pop });
  }

  private async colaboradorDoVinculo(vinculo: number): Promise<number> {
    const r = await this.tx.uma<{ colaborador_id: number }>(
      'SELECT colaborador_id FROM vinculo_trabalho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [vinculo, this.est],
    );
    if (!r)
      throw recusa('vinculo-inexistente', 'O colaborador não tem vínculo neste estabelecimento.', {
        campos: ['vinculo'],
      });
    return Number(r.colaborador_id);
  }

  async incluirParticipante(x: { treinamento: number; vinculo: number; por: string }): Promise<number> {
    const colaborador = await this.colaboradorDoVinculo(x.vinculo);
    const [t] = await this.tx.consultarParaAtualizar(
      'SELECT id FROM turma_treinamento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [x.treinamento, this.est],
      { teto: 1 },
    );
    if (!t) throw recusa('turma-inexistente', 'A turma não existe neste estabelecimento.');
    const [ja] = await this.tx.consultar(
      'SELECT id, excluido_em FROM presenca_treinamento WHERE turma_treinamento_id = ? AND colaborador_id = ?',
      [x.treinamento, colaborador],
      { teto: 1 },
    );
    if (ja && (ja['excluido_em'] === null || ja['excluido_em'] === undefined))
      throw recusa('ja-inscrito', 'O colaborador já está inscrito nesta turma.');
    if (ja) {
      const agora = new Date();
      await this.tx.executar(
        `UPDATE presenca_treinamento SET excluido_em = NULL, excluido_por = NULL, situacao = 'inscrito',
           aproveitamento = 'nao_avaliado', minutos_cumpridos = 0, nota = NULL, certificado_valido_ate = NULL,
           justificativa_ausencia = NULL, alterado_em = ?, alterado_por = ?, versao = versao + 1 WHERE id = ?`,
        [agora, this.usuario, num(ja['id'])],
      );
      return num(ja['id']);
    }
    const s = await this.tx.uma<{ s: number }>(
      'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM presenca_treinamento WHERE turma_treinamento_id = ?',
      [x.treinamento],
    );
    return this.tx.incluir('presenca_treinamento', {
      turma_treinamento_id: x.treinamento,
      sequencia: Number(s?.s ?? 1),
      colaborador_id: colaborador,
      situacao: 'inscrito',
    });
  }

  async registrarParticipacao(x: Parameters<GravadorTreinamento['registrarParticipacao']>[0]): Promise<void> {
    const [p] = await this.tx.consultarParaAtualizar(
      `SELECT p.id, p.versao, t.carga_horaria_minutos FROM presenca_treinamento p
         JOIN turma_treinamento t ON t.id = p.turma_treinamento_id
        WHERE p.id = ? AND t.estabelecimento_id = ? AND p.excluido_em IS NULL`,
      [x.id, this.est],
      { teto: 1 },
    );
    if (!p || num(p['versao']) !== x.versao) throw desatualizado();
    await this.tx.alterar('presenca_treinamento', x.id, x.versao, {
      situacao: x.presenca,
      aproveitamento:
        x.aproveitamento === 'aprovado' || x.aproveitamento === 'reprovado'
          ? x.aproveitamento
          : 'nao_avaliado',
      minutos_cumpridos: x.conclusao !== null ? num(p['carga_horaria_minutos']) : 0,
      certificado_valido_ate: x.validoAte,
      justificativa_ausencia: x.observacao,
    });
    if (x.conclusao !== null)
      await this.guardarNaTrilha('alteracao', 'presenca_treinamento', x.id, { concluido_em: x.conclusao });
  }

  async retirarInscricao(x: { id: number; versao: number; motivo: string; por: string }): Promise<boolean> {
    const [p] = await this.tx.consultarParaAtualizar(
      `SELECT p.id, p.versao, p.situacao, p.aproveitamento, p.minutos_cumpridos, p.colaborador_id, p.turma_treinamento_id,
          p.sequencia
        FROM presenca_treinamento p JOIN turma_treinamento t ON t.id = p.turma_treinamento_id
        WHERE p.id = ? AND t.estabelecimento_id = ? AND p.excluido_em IS NULL`,
      [x.id, this.est],
      { teto: 1 },
    );
    if (!p || num(p['versao']) !== x.versao) throw desatualizado();
    const ciencia = await this.tx.uma(
      'SELECT id FROM ciencia_procedimento WHERE turma_treinamento_id = ? AND colaborador_id = ? AND excluido_em IS NULL',
      [num(p['turma_treinamento_id']), num(p['colaborador_id'])],
    );
    if (
      texto(p['situacao']) !== 'inscrito' ||
      texto(p['aproveitamento']) !== 'nao_avaliado' ||
      num(p['minutos_cumpridos']) > 0 ||
      ciencia
    )
      return false;
    const agora = new Date();
    const n = await this.tx.executar(
      'UPDATE presenca_treinamento SET excluido_em = ?, excluido_por = ?, versao = versao + 1 WHERE id = ? AND versao = ?',
      [agora, this.usuario, x.id, x.versao],
    );
    if (n === 0) throw desatualizado();
    await gravarTrilha(this.tx, {
      estabelecimento: this.est,
      usuario: this.usuario,
      acao: 'exclusao',
      entidade: 'presenca_treinamento',
      entidadeId: x.id,
      dadosAntes: {
        turma: num(p['turma_treinamento_id']),
        sequencia: num(p['sequencia']),
        situacao: texto(p['situacao']),
      },
      motivo: x.motivo,
      correlacao: this.c.correlacao || null,
      ocorridoEm: agora,
    });
    return true;
  }

  async registrarCorrecao(x: Parameters<GravadorTreinamento['registrarCorrecao']>[0]): Promise<void> {
    if (!(TABELAS_CORRECAO as readonly string[]).includes(x.tabela))
      throw new Error('Tabela de correção inválida.');
    await gravarTrilha(this.tx, {
      estabelecimento: this.est,
      usuario: this.usuario,
      acao: 'alteracao',
      entidade: x.tabela,
      entidadeId: x.registro,
      dadosAntes: x.antes,
      dadosDepois: { correcao: x.operacao, valores: x.depois },
      motivo: x.motivo,
      correlacao: this.c.correlacao || null,
      ocorridoEm: new Date(),
    });
  }

  async incluirPop(x: Parameters<GravadorTreinamento['incluirPop']>[0]): Promise<number> {
    const usuario = this.usuario;
    if (usuario === null)
      throw recusa(
        'usuario-obrigatorio',
        'A publicação do POP pede o usuário da sessão (o responsável pelo documento).',
      );
    const agora = new Date();
    const [doc] = await this.tx.consultarParaAtualizar(
      `SELECT d.id, d.situacao, td.categoria, td.exige_fluxo_completo, td.prazo_revisao_meses
         FROM documento_qualidade d JOIN tipo_documento_qualidade td ON td.id = d.tipo_documento_qualidade_id
        WHERE d.estabelecimento_id = ? AND d.codigo = ? AND d.excluido_em IS NULL`,
      [this.est, x.codigo],
      { teto: 1 },
    );
    if (doc && texto(doc['categoria']) !== 'procedimento_operacional')
      throw recusa('codigo-de-outro-documento', 'O código é de outro documento da qualidade (não é POP).', {
        campos: ['codigo'],
      });
    // O tipo: o do documento, ou (POP novo) o tipo ativo de POP, o de publicação direta primeiro.
    const tipo = doc
      ? doc
      : await this.tx.uma<Linha>(
          `SELECT id, exige_fluxo_completo, prazo_revisao_meses FROM tipo_documento_qualidade
            WHERE categoria = 'procedimento_operacional' AND ativo = TRUE ORDER BY exige_fluxo_completo, id LIMIT 1`,
          [],
        );
    if (!tipo)
      throw recusa(
        'cadastro-pendente',
        'Cadastre na qualidade o tipo de documento de procedimento operacional (POP) antes de publicar.',
      );
    if (booleano(tipo['exige_fluxo_completo']))
      throw recusa(
        'fluxo-da-qualidade',
        'O tipo de documento do POP exige elaboração, verificação e aprovação: publique a versão pelo controle de documentos da qualidade.',
      );
    if (doc && ['em_elaboracao', 'em_revisao', 'em_aprovacao'].includes(texto(doc['situacao'])))
      throw recusa(
        'pop-em-fluxo',
        'O POP está em elaboração ou aprovação na qualidade: conclua lá antes de publicar outra versão.',
      );
    if (doc) {
      const v = await this.tx.uma<Linha>(
        `SELECT MAX(CAST(numero_versao AS DECIMAL(10,2))) AS maior,
            SUM(situacao IN ('rascunho','em_revisao','em_aprovacao','aprovada')) AS em_fluxo
           FROM documento_qualidade_versao WHERE documento_qualidade_id = ?`,
        [num(doc['id'])],
      );
      if (num(v?.['em_fluxo'] ?? 0) > 0)
        throw recusa(
          'pop-em-fluxo',
          'Há versão do POP em elaboração ou aprovação na qualidade: conclua lá antes de publicar.',
        );
      const maior = Number(v?.['maior'] ?? 0);
      if (x.versao <= maior)
        throw recusa(
          'versao-repetida',
          `O POP já tem a versão ${maior} na qualidade (publicada agora por outra pessoa ou lançada lá): abra de novo.`,
        );
    }
    const prazo = numOuNulo(tipo['prazo_revisao_meses']);
    const proxima = prazo
      ? (await this.tx.uma<Linha>('SELECT DATE_ADD(?, INTERVAL ? MONTH) AS d', [x.vigencia, prazo]))?.['d']
      : null;
    const proximaRevisao = proxima ? dataDe(proxima) : null;
    const docId = doc
      ? num(doc['id'])
      : await this.tx.incluir('documento_qualidade', {
          estabelecimento_id: this.est,
          codigo: x.codigo,
          titulo: x.titulo,
          tipo_documento_qualidade_id: num(tipo['id']),
          procedencia: 'interno',
          dono_usuario_id: usuario,
          setor_funcional_id: x.unidade,
          periodicidade_revisao_meses: prazo,
          exige_ciencia: true,
          situacao: 'vigente',
        });
    // Sem aprovação forjada: o tipo dispensa o fluxo, então aprovador e aprovado_em ficam nulos.
    const id = await this.tx.incluir('documento_qualidade_versao', {
      documento_qualidade_id: docId,
      operacao: 'inclusao',
      dados: JSON.stringify({ titulo: x.titulo, referencia: x.referencia, unidade: x.unidade }),
      ocorrido_em: agora,
      usuario_id: usuario,
      numero_versao: String(x.versao),
      situacao: 'vigente',
      formato: 'texto',
      conteudo: x.resumo,
      motivo_alteracao: x.alteracoes,
      elaborador_usuario_id: usuario,
      publicado_em: agora,
      vigencia_inicio: x.vigencia,
      proxima_revisao: proximaRevisao,
    });
    await this.tx.executar(
      `UPDATE documento_qualidade SET documento_qualidade_versao_id = ?, titulo = ?, setor_funcional_id = ?, situacao = 'vigente',
         exige_ciencia = TRUE, ultima_revisao = ?, proxima_revisao = ?, alterado_em = ?, alterado_por = ?, versao = versao + 1
        WHERE id = ?`,
      [id, x.titulo, x.unidade, await this.hoje(), proximaRevisao, agora, usuario, docId],
    );
    return id;
  }

  async situacaoPop(x: Parameters<GravadorTreinamento['situacaoPop']>[0]): Promise<void> {
    const [v] = await this.tx.consultarParaAtualizar(
      `SELECT v.id, v.situacao, v.documento_qualidade_id, v.dados FROM documento_qualidade_versao v
         JOIN documento_qualidade d ON d.id = v.documento_qualidade_id
        WHERE v.id = ? AND d.estabelecimento_id = ? AND d.excluido_em IS NULL`,
      [x.id, this.est],
      { teto: 1 },
    );
    if (!v || texto(v['situacao']) !== 'vigente') throw desatualizado();
    const agora = new Date();
    await this.tx.executar(
      `UPDATE documento_qualidade_versao SET situacao = ?, dados = ?, operacao = 'alteracao', ocorrido_em = ?, usuario_id = ?,
         alterado_em = ?, alterado_por = ?, versao = versao + 1 WHERE id = ?`,
      [
        x.situacao === 'substituido' ? 'obsoleta' : 'cancelada',
        JSON.stringify({ ...json(v['dados']), motivo: x.motivo }),
        agora,
        this.usuario,
        agora,
        this.usuario,
        x.id,
      ],
    );
    if (x.situacao === 'revogado')
      await this.tx.executar(
        `UPDATE documento_qualidade SET situacao = 'cancelado', alterado_em = ?, alterado_por = ?, versao = versao + 1
          WHERE id = ?`,
        [agora, this.usuario, num(v['documento_qualidade_id'])],
      );
  }

  async incluirCiencia(x: {
    pop: number;
    vinculo: number;
    treinamento: number | null;
    por: string;
  }): Promise<number> {
    const colaborador = await this.colaboradorDoVinculo(x.vinculo);
    const documento = await this.documentoDaVersao(x.pop);
    const ja = await this.tx.uma(
      'SELECT id FROM ciencia_procedimento WHERE colaborador_id = ? AND documento_qualidade_versao_id = ?',
      [colaborador, x.pop],
    );
    if (ja) throw recusa('ja-ciente', 'A ciência nesta versão do POP já foi registrada.');
    const s = await this.tx.uma<{ s: number }>(
      'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM ciencia_procedimento WHERE colaborador_id = ?',
      [colaborador],
    );
    return this.tx.incluir('ciencia_procedimento', {
      colaborador_id: colaborador,
      sequencia: Number(s?.s ?? 1),
      documento_qualidade_id: documento,
      documento_qualidade_versao_id: x.pop,
      ciente_em: new Date(),
      forma: x.treinamento !== null ? 'treinamento' : 'assinatura_eletronica',
      turma_treinamento_id: x.treinamento,
    });
  }
}

// ── A porta ─────────────────────────────────────────────────────────────────────────────────────────────────

export class PortaTreinamentoPropria implements PortaTreinamento {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoTreinamento,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoTreinamento, fn: (l: Leituras) => Promise<T>): Promise<T> {
    const est = estabelecimentoDe(c);
    return this.nucleo.lerSomente(c, (l) => fn(new Leituras(l, est)));
  }

  /** Os treinamentos não usam receita do executor: as gravações são diretas (a liberação é a da chave). */
  podeGravar() {
    return Promise.resolve({ pode: true, codigo: null, motivo: null });
  }

  executar(_c: ContextoTreinamento, op: string): Promise<GravacaoFeita> {
    return Promise.reject(
      recusa('operacao-desconhecida', `Operação ${op} sem receita do executor nos treinamentos.`),
    );
  }

  gravarSgh<T>(
    c: ContextoTreinamento,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorTreinamento) => Promise<T>,
  ): Promise<T> {
    // A recusa de negócio do serviço (ErroProblema) dentro da transação desfaz tudo e volta como foi lançada: o Executor
    // a trataria como erro inesperado (500).
    let doServico: { erro: unknown } | null = null;
    return gravacaoDireta(this.executor, c, {
      nome: 'pessoas.treinamento',
      tabelas: TABELAS_TREINAMENTO,
      trilha,
      gravador: (tx, est) => new Gravacoes(tx, est, c),
      fn: (g) =>
        fn(g).catch((e: unknown) => {
          if (!(e instanceof ErroOperacao)) doServico = { erro: e };
          throw e;
        }),
    }).catch((e: unknown) => {
      throw doServico ? doServico.erro : e;
    });
  }

  relogio(c: ContextoTreinamento) {
    return this.ler(c, (l) => l.relogio());
  }
  unidades(c: ContextoTreinamento) {
    return this.ler(c, (l) => l.unidades());
  }
  cursos(c: ContextoTreinamento) {
    return this.ler(c, (l) => l.cursos());
  }
  curso(c: ContextoTreinamento, id: number) {
    return this.ler(c, (l) => l.cursos(id)).then((r) => r[0] ?? null);
  }
  turmas(c: ContextoTreinamento, f: FiltroTurmas) {
    return this.ler(c, (l) => l.turmas(f));
  }
  turma(c: ContextoTreinamento, id: number) {
    return this.ler(c, (l) => l.turma(id));
  }
  participantes(c: ContextoTreinamento, turma: number) {
    return this.ler(c, (l) => l.participantes(turma));
  }
  participacoes(c: ContextoTreinamento, vinculo: number) {
    return this.ler(c, (l) => l.participacoes(vinculo));
  }
  conclusoes(c: ContextoTreinamento, vinculos: readonly number[] | null) {
    return this.ler(c, (l) => l.conclusoes(vinculos));
  }
  pops(c: ContextoTreinamento, f: { vigentes?: boolean; codigo?: string }) {
    return this.ler(c, (l) => l.pops(f));
  }
  pop(c: ContextoTreinamento, id: number) {
    return this.ler(c, (l) => l.pops({ id })).then((r) => r[0] ?? null);
  }
  ciencias(c: ContextoTreinamento, f: { vinculo?: number; pops?: readonly number[] }) {
    return this.ler(c, (l) => l.ciencias(f));
  }
  ativos(c: ContextoTreinamento, unidade: number | null) {
    return this.ler(c, (l) => l.ativos(unidade));
  }
  vinculos(c: ContextoTreinamento, ids: readonly number[]) {
    return ids.length === 0 ? Promise.resolve([]) : this.ler(c, (l) => l.vinculos(ids));
  }
  correcoes(c: ContextoTreinamento, tabela: string, registros: readonly number[]) {
    return this.ler(c, (l) => l.correcoes(tabela, registros));
  }
}

export function portaTreinamentoIndisponivel(): PortaTreinamento {
  return portaIndisponivel<PortaTreinamento>(METODOS_PORTA_TREINAMENTO);
}
