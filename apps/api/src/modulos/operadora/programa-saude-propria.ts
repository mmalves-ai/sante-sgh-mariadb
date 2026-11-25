// Porta própria da promoção da saúde e gestão de crônicos da operadora (08-SGO L115, C2-102; F8) sobre o banco do
// cliente (RN ANS 264 e 265/2011):
// - o programa (programa_saude) com os critérios de elegibilidade (criterio_elegibilidade_programa) e as bonificações
//   (bonificacao_programa); os grupos de risco (grupo_risco_saude) e os questionários de risco (modelo_questionario_saude
//   e as perguntas);
// - os elegíveis: os beneficiários ativos do estabelecimento apurados das contas recebidas (diagnóstico, procedimento,
//   internação, urgência e custo liberado na janela do critério; a janela de cada tipo é a maior entre os critérios do
//   tipo), da idade e do escore da última avaliação concluída, julgados pelo domínio (avaliarElegibilidadePrograma);
// - o participante (participante_programa): entrada e saída com motivo, nunca apagado; a visão por beneficiário;
// - o acompanhamento (acompanhamento_programa): contato agendado ou realizado, baixa e a agenda de visitas;
// - a avaliação de risco (avaliacao_risco_participante e as respostas) pontuada pelo domínio, que atualiza o grupo de
//   risco do participante quando o questionário o indica;
// - o custo do crônico antes e depois da entrada e a apuração da bonificação pela adesão às atividades.
// A regra vem do domínio (programa-saude.ts); o banco só guarda. Cada gravação é uma operação do Executor (trilha na
// mesma transação). O escopo é o estabelecimento da sessão (fora, 404).
import {
  adesaoAsAtividades,
  agendaDeVisitas,
  avaliarElegibilidadePrograma,
  type CriterioElegibilidade,
  custoDoParticipante,
  direitoABonificacao,
  idadeNoPrograma,
  inicioDaJanela,
  type OpcaoPergunta,
  type PerfilElegibilidade,
  type PerguntaQuestionario,
  type ProblemaProgramaSaude,
  problemasDaBaixaDoContato,
  problemasDaBonificacao,
  problemasDaEntrada,
  problemasDaSaida,
  problemasDoContato,
  problemasDoCriterio,
  problemasDoPrograma,
  pontuarQuestionario,
  type RegraBonificacao,
  type RespostaQuestionario,
} from '@sgh/dominio-operadora';
import {
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  booleano,
  contextoDireto,
  dataIso,
  estabelecimentoDaSessao,
  instanteIso,
  inteiro,
  marcadores,
  type NucleoOperadora,
  numero,
  semEstabelecimento,
  texto,
  textoObrigatorio,
} from './apoio-banco.js';

export const PORTA_PROGRAMA_SAUDE = Symbol('PORTA_PROGRAMA_SAUDE_OPERADORA');

export const TABELAS_PROGRAMA_SAUDE = [
  'programa_saude',
  'criterio_elegibilidade_programa',
  'bonificacao_programa',
  'grupo_risco_saude',
  'participante_programa',
  'acompanhamento_programa',
  'modelo_questionario_saude',
  'modelo_questionario_saude_pergunta',
  'avaliacao_risco_participante',
  'avaliacao_risco_participante_resposta',
] as const;

export type Gravado = { readonly id: number; readonly versao: number } & Readonly<
  Record<string, string | number | boolean | null>
>;
type Trilha = (r: Gravado) => RegistroTrilhaTela;

const naoEncontrado = () =>
  new ErroOperacao(
    404,
    'nao-encontrado',
    'Registro não encontrado',
    'O registro não existe neste estabelecimento.',
  );
function exigir(problemas: readonly ProblemaProgramaSaude[]): void {
  const p = problemas[0];
  if (p) throw recusa(p.codigo, p.detalhe, { campos: [...new Set(problemas.map((x) => x.campo))] });
}
const sqlData = (v: string) => v.replace('T', ' ').slice(0, 19);

// ---- formas de entrada (validadas no controller) ----
export interface EntradaPrograma {
  codigo: string;
  nome: string;
  tipo: string;
  objetivo: string | null;
  publicoAlvo: string | null;
  metas: string | null;
  grupoRisco: number | null;
  registradoAns: boolean;
  numeroRegistroAns: string | null;
  isentaCoparticipacao: boolean;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  situacao: string;
}
export type EntradaCriterio = Omit<CriterioElegibilidade, 'id' | 'ativo'>;
export interface EntradaBonificacao extends Omit<RegraBonificacao, 'ativo'> {
  codigo: string;
  descricao: string;
  validadeMeses: number | null;
  criterio: string | null;
}
export interface EntradaQuestionario {
  codigo: string;
  nome: string;
  vigenciaInicio: string;
  exigeTodas: boolean;
  perguntas: {
    enunciado: string;
    tipoResposta: string;
    obrigatoria: boolean;
    opcoes: OpcaoPergunta[] | null;
    respostaIndicativa: string | null;
  }[];
}

// ---- leituras ----
export interface ProgramaLido extends EntradaPrograma {
  id: number;
  versao: number;
  grupoRiscoDescricao: string | null;
  participantesAtivos: number;
  criterios: (CriterioElegibilidade & { id: number; versao: number })[];
  bonificacoes: (RegraBonificacao & { id: number; versao: number; codigo: string; descricao: string })[];
}
export interface ElegivelLido {
  beneficiario: number;
  matricula: string;
  nome: string;
  idade: number | null;
  motivos: string[];
  forma: string | null;
}
export interface ParticipanteLido {
  id: number;
  versao: number;
  programa: number;
  programaNome: string;
  beneficiario: number;
  matricula: string;
  nome: string;
  grupoRisco: number | null;
  grupoRiscoDescricao: string | null;
  entrada: string;
  saida: string | null;
  motivoSaida: string | null;
  situacao: string;
  ultimaClassificacao: string | null;
  proximoContato: string | null;
}
export interface ContatoLido {
  id: number;
  versao: number;
  participante: number;
  nome: string;
  programaNome: string;
  tipo: string;
  agendadoPara: string | null;
  realizadoEm: string | null;
  situacao: string;
  resultado: string | null;
  proximoContato: string | null;
}

const esquemaEntrada = z.record(z.string(), z.unknown());

export class PortaProgramaSaudePropria {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoOperadora & Pick<NucleoProprio, 'escrever'>,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor, est: number, hoje: string) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: c.correlacao || 'operadora-programa-saude' },
      async (l) => {
        const est = await estabelecimentoDaSessao(c, l);
        if (est === null) throw semEstabelecimento();
        const h = await l.uma<{ hoje: unknown }>('SELECT CURRENT_DATE AS hoje');
        return fn(l, est, dataIso(h?.['hoje']) ?? new Date().toISOString().slice(0, 10));
      },
    );
  }

  private async gravar(
    c: ContextoPorta,
    nome: string,
    tabela: string,
    trilha: Trilha,
    fn: (tx: TxOperacao, est: number, hoje: string, agora: string) => Promise<Gravado>,
  ): Promise<Gravado> {
    const est = await this.ler(c, async (_l, e) => e);
    const operacao = definirOperacao<Record<string, unknown>, Gravado>({
      nome,
      tabelas: TABELAS_PROGRAMA_SAUDE,
      entrada: esquemaEntrada,
      acao: 'operacao',
      gravar: async (tx) => {
        const h = await tx.uma<{ hoje: unknown; agora: unknown }>(
          'SELECT CURRENT_DATE AS hoje, CURRENT_TIMESTAMP(3) AS agora',
        );
        const hoje = dataIso(h?.['hoje']) ?? new Date().toISOString().slice(0, 10);
        const agora = (instanteIso(h?.['agora']) ?? new Date().toISOString()).slice(0, 19);
        return fn(tx, est, hoje, agora);
      },
      alvo: (_e, r) => ({ tabela, id: r.id }),
      trilha: (_e, r) => {
        const l = trilha(r);
        return { dados: l.dadosDepois, motivo: l.motivo ?? null };
      },
    });
    const ctx = contextoDireto(this.cliente, est, c, null);
    const r = await this.executor.executar(operacao, this.cliente, {}, ctx);
    return r.resultado;
  }

  // ======== programas ========
  programas(c: ContextoPorta): Promise<ProgramaLido[]> {
    return this.ler(c, (l, est) => lerProgramas(l, est, null));
  }
  async programa(c: ContextoPorta, id: number): Promise<ProgramaLido> {
    const [p] = await this.ler(c, (l, est) => lerProgramas(l, est, id));
    if (!p) throw naoEncontrado();
    return p;
  }

  gravarPrograma(
    c: ContextoPorta,
    id: number | null,
    versao: number | null,
    e: EntradaPrograma,
    trilha: Trilha,
  ) {
    return this.gravar(c, 'operadora.programa-saude.gravar', 'programa_saude', trilha, async (tx, est) => {
      exigir(problemasDoPrograma(e));
      if (
        e.grupoRisco !== null &&
        !(await tx.uma('SELECT 1 AS ok FROM grupo_risco_saude WHERE id = ?', [e.grupoRisco]))
      )
        throw recusa('grupo-risco-inexistente', 'O grupo de risco não existe.', { campos: ['grupoRisco'] });
      const dados = {
        codigo: e.codigo.trim(),
        nome: e.nome.trim(),
        tipo: e.tipo,
        objetivo: e.objetivo,
        publico_alvo: e.publicoAlvo,
        metas: e.metas,
        grupo_risco_saude_id: e.grupoRisco,
        registrado_ans: e.registradoAns,
        numero_registro_ans: e.registradoAns ? e.numeroRegistroAns : null,
        isenta_coparticipacao: e.isentaCoparticipacao,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
        situacao: e.situacao,
      };
      const dup = await tx.uma(
        'SELECT id FROM programa_saude WHERE estabelecimento_id = ? AND codigo = ? AND excluido_em IS NULL',
        [est, dados.codigo],
      );
      if (dup && Number(dup['id']) !== id)
        throw recusa('programa-codigo-repetido', 'Já existe programa com este código.', {
          campos: ['codigo'],
        });
      if (id === null) {
        const novo = await tx.incluir('programa_saude', { estabelecimento_id: est, ...dados });
        return { id: novo, versao: 1 };
      }
      if (
        !(await tx.uma('SELECT 1 AS ok FROM programa_saude WHERE id = ? AND estabelecimento_id = ?', [
          id,
          est,
        ]))
      )
        throw naoEncontrado();
      return { id, versao: await tx.alterar('programa_saude', id, versao ?? 0, dados) };
    });
  }

  incluirCriterio(c: ContextoPorta, programa: number, e: EntradaCriterio, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.programa-saude.criterio.incluir',
      'criterio_elegibilidade_programa',
      trilha,
      async (tx, est) => {
        await programaDoEst(tx, est, programa);
        exigir(problemasDoCriterio({ ...e, ativo: true }));
        const id = await tx.incluir('criterio_elegibilidade_programa', {
          programa_saude_id: programa,
          tipo_criterio: e.tipo,
          termo_terminologia_id: e.termo,
          grupo_patologia_id: e.grupoPatologia,
          ocorrencias_minimas: e.ocorrenciasMinimas,
          periodo_meses: e.periodoMeses,
          idade_minima: e.idadeMinima,
          idade_maxima: e.idadeMaxima,
          custo_mensal_minimo: e.custoMensalMinimo,
          custo_periodo_minimo: e.custoPeriodoMinimo,
          escore_minimo: e.escoreMinimo,
          forma_alerta: e.formaAlerta,
          ativo: true,
        });
        return { id, versao: 1 };
      },
    );
  }

  /** O critério não é apagado: fica inativo e deixa de contar na elegibilidade. */
  desativarCriterio(c: ContextoPorta, id: number, versao: number, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.programa-saude.criterio.desativar',
      'criterio_elegibilidade_programa',
      trilha,
      async (tx, est) => {
        const r = await tx.uma(
          `SELECT k.ativo FROM criterio_elegibilidade_programa k JOIN programa_saude p ON p.id = k.programa_saude_id
            WHERE k.id = ? AND p.estabelecimento_id = ?`,
          [id, est],
        );
        if (!r) throw naoEncontrado();
        if (!booleano(r['ativo'])) throw recusa('criterio-inativo', 'O critério já está inativo.');
        return {
          id,
          versao: await tx.alterar('criterio_elegibilidade_programa', id, versao, { ativo: false }),
        };
      },
    );
  }

  incluirBonificacao(c: ContextoPorta, programa: number, e: EntradaBonificacao, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.programa-saude.bonificacao.incluir',
      'bonificacao_programa',
      trilha,
      async (tx, est) => {
        await programaDoEst(tx, est, programa);
        exigir(problemasDaBonificacao({ ...e, ativo: true }));
        if (
          await tx.uma(
            'SELECT 1 AS ok FROM bonificacao_programa WHERE programa_saude_id = ? AND codigo = ?',
            [programa, e.codigo.trim()],
          )
        )
          throw recusa('bonificacao-codigo-repetido', 'Já existe bonificação com este código.', {
            campos: ['codigo'],
          });
        const id = await tx.incluir('bonificacao_programa', {
          programa_saude_id: programa,
          codigo: e.codigo.trim(),
          descricao: e.descricao.trim(),
          tipo_beneficio: e.tipoBeneficio,
          percentual_desconto: e.percentualDesconto,
          valor_bonus: e.valorBonus,
          adesao_minima_percentual: e.adesaoMinimaPercentual,
          validade_meses: e.validadeMeses,
          criterio: e.criterio,
          vigencia_inicio: e.vigenciaInicio,
          vigencia_fim: e.vigenciaFim,
          ativo: true,
        });
        return { id, versao: 1 };
      },
    );
  }

  // ======== grupos de risco e questionários ========
  gruposRisco(c: ContextoPorta) {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          'SELECT id, versao, codigo, descricao, prioridade, ativo FROM grupo_risco_saude ORDER BY prioridade, descricao',
          [],
          { teto: 500 },
        )
      ).map((r) => ({
        id: Number(r['id']),
        versao: Number(r['versao']),
        codigo: textoObrigatorio(r['codigo']),
        descricao: textoObrigatorio(r['descricao']),
        prioridade: inteiro(r['prioridade']),
        ativo: booleano(r['ativo']),
      })),
    );
  }

  gravarGrupoRisco(
    c: ContextoPorta,
    e: { codigo: string; descricao: string; prioridade: number | null },
    trilha: Trilha,
  ) {
    return this.gravar(
      c,
      'operadora.programa-saude.grupo-risco.incluir',
      'grupo_risco_saude',
      trilha,
      async (tx) => {
        if (!e.codigo.trim() || !e.descricao.trim())
          throw recusa('grupo-risco-incompleto', 'Informe o código e a descrição do grupo de risco.', {
            campos: ['codigo', 'descricao'],
          });
        if (await tx.uma('SELECT 1 AS ok FROM grupo_risco_saude WHERE codigo = ?', [e.codigo.trim()]))
          throw recusa('grupo-risco-repetido', 'Já existe grupo de risco com este código.', {
            campos: ['codigo'],
          });
        const id = await tx.incluir('grupo_risco_saude', {
          codigo: e.codigo.trim(),
          descricao: e.descricao.trim(),
          prioridade: e.prioridade,
          ativo: true,
        });
        return { id, versao: 1 };
      },
    );
  }

  questionarios(c: ContextoPorta) {
    return this.ler(c, async (l, _est, hoje) => {
      const ms = await l.consultar(
        `SELECT id, codigo, nome, numero_versao, exige_todas_respostas FROM modelo_questionario_saude
          WHERE ativo = TRUE AND finalidade IN ('avaliacao_risco','programa_saude')
            AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
          ORDER BY nome`,
        [hoje, hoje],
        { teto: 200 },
      );
      const out = [];
      for (const m of ms) {
        const perguntas = await lerPerguntas(l, Number(m['id']));
        out.push({
          id: Number(m['id']),
          codigo: textoObrigatorio(m['codigo']),
          nome: textoObrigatorio(m['nome']),
          numeroVersao: Number(m['numero_versao']),
          exigeTodas: booleano(m['exige_todas_respostas']),
          perguntas: perguntas.map((p) => ({ ...p, enunciado: p.enunciado })),
        });
      }
      return out;
    });
  }

  gravarQuestionario(c: ContextoPorta, e: EntradaQuestionario, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.programa-saude.questionario.incluir',
      'modelo_questionario_saude',
      trilha,
      async (tx) => {
        if (!e.perguntas.length)
          throw recusa('questionario-sem-pergunta', 'O questionário precisa de ao menos uma pergunta.', {
            campos: ['perguntas'],
          });
        for (const [i, p] of e.perguntas.entries())
          if (['escolha_unica', 'multipla_escolha'].includes(p.tipoResposta) && !p.opcoes?.length)
            throw recusa('pergunta-sem-opcao', `A pergunta ${i + 1} é fechada e precisa das opções.`, {
              campos: [`pergunta-${i + 1}`],
            });
        const v = await tx.uma(
          'SELECT MAX(numero_versao) AS v FROM modelo_questionario_saude WHERE codigo = ?',
          [e.codigo.trim()],
        );
        const numeroVersao = (inteiro(v?.['v']) ?? 0) + 1;
        const id = await tx.incluir('modelo_questionario_saude', {
          codigo: e.codigo.trim(),
          nome: e.nome.trim(),
          finalidade: 'programa_saude',
          numero_versao: numeroVersao,
          vigencia_inicio: e.vigenciaInicio,
          exige_todas_respostas: e.exigeTodas,
          ativo: true,
        });
        for (const [i, p] of e.perguntas.entries())
          await tx.incluir('modelo_questionario_saude_pergunta', {
            modelo_questionario_saude_id: id,
            sequencia: i + 1,
            enunciado: p.enunciado.trim(),
            tipo_resposta: p.tipoResposta,
            opcoes_resposta: p.opcoes?.length ? JSON.stringify(p.opcoes) : null,
            obrigatoria: p.obrigatoria,
            resposta_indicativa: p.respostaIndicativa,
          });
        return { id, versao: 1, numeroVersao, perguntas: e.perguntas.length };
      },
    );
  }

  // ======== elegíveis ========
  elegiveis(c: ContextoPorta, programa: number): Promise<ElegivelLido[]> {
    return this.ler(c, async (l, est, hoje) => {
      const [p] = await lerProgramas(l, est, programa);
      if (!p) throw naoEncontrado();
      const criterios = p.criterios.filter((k) => k.ativo);
      if (!criterios.length) return [];
      const bens = await l.consultar(
        `SELECT b.id, b.matricula, f.nome, f.data_nascimento FROM beneficiario_plano b
           JOIN contrato_plano k ON k.id = b.contrato_plano_id
           JOIN pessoa_fisica f ON f.id = b.pessoa_fisica_id
          WHERE k.estabelecimento_id = ? AND b.situacao = 'ativo' AND b.excluido_em IS NULL
            AND NOT EXISTS (SELECT 1 FROM participante_programa x WHERE x.beneficiario_plano_id = b.id
                              AND x.programa_saude_id = ? AND x.situacao <> 'encerrado' AND x.excluido_em IS NULL)
          ORDER BY f.nome`,
        [est, programa],
        { teto: 5000 },
      );
      const janela = (tipo: string) =>
        Math.max(0, ...criterios.filter((k) => k.tipo === tipo).map((k) => k.periodoMeses ?? 12));
      const conta = async (sql: string, ps: unknown[]) => {
        const m = new Map<number, number>();
        for (const r of await l.consultar(sql, ps, { teto: 20000 }))
          m.set(Number(r['b']), numero(r['n']) ?? 0);
        return m;
      };
      const ocorr = new Map<string, Map<number, number>>();
      for (const k of criterios) {
        const desde = inicioDaJanela(hoje, k.periodoMeses ?? 12);
        if (k.tipo === 'cid' && k.termo !== null)
          ocorr.set(
            `cid:${k.termo}`,
            await conta(
              `SELECT g.beneficiario_plano_id AS b, COUNT(DISTINCT g.id) AS n FROM guia_conta_recebida g
                 JOIN guia_conta_recebida_diagnostico d ON d.guia_conta_recebida_id = g.id
                WHERE g.estabelecimento_id = ? AND g.situacao <> 'cancelada' AND g.excluido_em IS NULL
                  AND g.inicio_atendimento >= ? AND d.cid_termo_terminologia_id = ? GROUP BY g.beneficiario_plano_id`,
              [est, desde, k.termo],
            ),
          );
        else if (k.tipo === 'cid' && k.grupoPatologia !== null)
          ocorr.set(
            `grupo:${k.grupoPatologia}`,
            await conta(
              `SELECT g.beneficiario_plano_id AS b, COUNT(DISTINCT g.id) AS n FROM guia_conta_recebida g
                 JOIN guia_conta_recebida_diagnostico d ON d.guia_conta_recebida_id = g.id
                 JOIN grupo_patologia_cid gc ON gc.cid_termo_terminologia_id = d.cid_termo_terminologia_id
                WHERE g.estabelecimento_id = ? AND g.situacao <> 'cancelada' AND g.excluido_em IS NULL
                  AND g.inicio_atendimento >= ? AND gc.grupo_patologia_id = ? GROUP BY g.beneficiario_plano_id`,
              [est, desde, k.grupoPatologia],
            ),
          );
        else if (k.tipo === 'procedimento' && k.termo !== null)
          ocorr.set(
            `proc:${k.termo}`,
            await conta(
              `SELECT g.beneficiario_plano_id AS b, COUNT(DISTINCT g.id) AS n FROM guia_conta_recebida g
                 JOIN guia_conta_recebida_item i ON i.guia_conta_recebida_id = g.id
                WHERE g.estabelecimento_id = ? AND g.situacao <> 'cancelada' AND g.excluido_em IS NULL
                  AND g.inicio_atendimento >= ? AND i.procedimento_termo_terminologia_id = ? GROUP BY g.beneficiario_plano_id`,
              [est, desde, k.termo],
            ),
          );
      }
      const vazio = new Map<number, number>();
      const internacoes = janela('internacao')
        ? await conta(
            `SELECT g.beneficiario_plano_id AS b, COUNT(*) AS n FROM guia_conta_recebida g
              WHERE g.estabelecimento_id = ? AND g.situacao <> 'cancelada' AND g.excluido_em IS NULL
                AND g.regime_atendimento_internacao_id IS NOT NULL AND g.inicio_atendimento >= ?
              GROUP BY g.beneficiario_plano_id`,
            [est, inicioDaJanela(hoje, janela('internacao'))],
          )
        : vazio;
      const urgencias = janela('pronto_socorro')
        ? await conta(
            `SELECT g.beneficiario_plano_id AS b, COUNT(*) AS n FROM guia_conta_recebida g
               JOIN carater_atendimento_tiss t ON t.id = g.carater_atendimento_tiss_id
              WHERE g.estabelecimento_id = ? AND g.situacao <> 'cancelada' AND g.excluido_em IS NULL
                AND t.codigo_tiss IN ('2','U') AND g.inicio_atendimento >= ?
              GROUP BY g.beneficiario_plano_id`,
            [est, inicioDaJanela(hoje, janela('pronto_socorro'))],
          )
        : vazio;
      const mesesCusto = janela('custo');
      const custos = mesesCusto
        ? await conta(
            `SELECT g.beneficiario_plano_id AS b, SUM(COALESCE(g.valor_liberado, g.valor_apresentado - g.valor_glosado)) AS n
               FROM guia_conta_recebida g
              WHERE g.estabelecimento_id = ? AND g.situacao <> 'cancelada' AND g.excluido_em IS NULL
                AND g.inicio_atendimento >= ? GROUP BY g.beneficiario_plano_id`,
            [est, inicioDaJanela(hoje, mesesCusto)],
          )
        : vazio;
      const escores = criterios.some((k) => k.tipo === 'escore')
        ? await conta(
            `SELECT x.beneficiario_plano_id AS b, a.escore AS n FROM avaliacao_risco_participante a
               JOIN participante_programa x ON x.id = a.participante_programa_id
              WHERE a.estabelecimento_id = ? AND a.situacao = 'concluida' AND a.excluido_em IS NULL
              ORDER BY a.aplicado_em`,
            [est],
          )
        : vazio;
      const out: ElegivelLido[] = [];
      for (const b of bens) {
        const id = Number(b['id']);
        const idade = idadeNoPrograma(dataIso(b['data_nascimento']), hoje);
        const ocorrencias: Record<string, number> = {};
        for (const [k, m] of ocorr) ocorrencias[k] = m.get(id) ?? 0;
        const perfil: PerfilElegibilidade = {
          idade,
          ocorrencias,
          internacoes: internacoes.get(id) ?? 0,
          prontoSocorro: urgencias.get(id) ?? 0,
          custoPeriodo: custos.get(id) ?? 0,
          meses: mesesCusto || 12,
          escore: escores.has(id) ? (escores.get(id) ?? null) : null,
        };
        const r = avaliarElegibilidadePrograma(criterios, perfil);
        if (r.elegivel)
          out.push({
            beneficiario: id,
            matricula: textoObrigatorio(b['matricula']),
            nome: textoObrigatorio(b['nome']),
            idade,
            motivos: r.motivos,
            forma: r.forma,
          });
      }
      return out;
    });
  }

  // ======== participantes ========
  participantes(
    c: ContextoPorta,
    filtro: { programa?: number; beneficiario?: number },
  ): Promise<ParticipanteLido[]> {
    return this.ler(c, (l, est) => lerParticipantes(l, est, filtro));
  }

  /** Visão por beneficiário: as participações, os contatos e as avaliações, numa leitura. */
  async doBeneficiario(c: ContextoPorta, beneficiario: number) {
    return this.ler(c, async (l, est) => {
      const participacoes = await lerParticipantes(l, est, { beneficiario });
      const ids = participacoes.map((p) => p.id);
      const contatos = ids.length ? await lerContatos(l, est, { participantes: ids }) : [];
      const avaliacoes = ids.length
        ? (
            await l.consultar(
              `SELECT a.id, a.participante_programa_id, a.aplicado_em, a.escore, a.classificacao_risco, m.nome
                 FROM avaliacao_risco_participante a JOIN modelo_questionario_saude m ON m.id = a.modelo_questionario_saude_id
                WHERE a.estabelecimento_id = ? AND a.participante_programa_id IN (${marcadores(ids.length)})
                  AND a.excluido_em IS NULL ORDER BY a.aplicado_em DESC`,
              [est, ...ids],
              { teto: 500 },
            )
          ).map((r) => ({
            id: Number(r['id']),
            participante: Number(r['participante_programa_id']),
            aplicadoEm: instanteIso(r['aplicado_em']),
            escore: numero(r['escore']),
            classificacao: texto(r['classificacao_risco']),
            questionario: textoObrigatorio(r['nome']),
          }))
        : [];
      return { participacoes, contatos, avaliacoes };
    });
  }

  incluirParticipante(
    c: ContextoPorta,
    programa: number,
    e: {
      beneficiario: number;
      entrada: string;
      grupoRisco: number | null;
      responsavel: number | null;
      observacao: string | null;
    },
    trilha: Trilha,
  ) {
    return this.gravar(
      c,
      'operadora.programa-saude.participante.incluir',
      'participante_programa',
      trilha,
      async (tx, est, hoje) => {
        const p = await programaDoEst(tx, est, programa);
        const b = await tx.uma(
          `SELECT b.situacao FROM beneficiario_plano b JOIN contrato_plano k ON k.id = b.contrato_plano_id
            WHERE b.id = ? AND k.estabelecimento_id = ? AND b.excluido_em IS NULL`,
          [e.beneficiario, est],
        );
        if (!b) throw naoEncontrado();
        const aberta = await tx.uma(
          `SELECT 1 AS ok FROM participante_programa WHERE programa_saude_id = ? AND beneficiario_plano_id = ?
              AND situacao <> 'encerrado' AND excluido_em IS NULL`,
          [programa, e.beneficiario],
        );
        exigir(
          problemasDaEntrada({
            programa: p,
            beneficiarioSituacao: textoObrigatorio(b['situacao']),
            entrada: e.entrada,
            hoje,
            participacaoAberta: !!aberta,
          }),
        );
        const id = await tx.incluir('participante_programa', {
          programa_saude_id: programa,
          beneficiario_plano_id: e.beneficiario,
          grupo_risco_saude_id: e.grupoRisco ?? p.grupoRisco,
          responsavel_prestador_rede_id: e.responsavel,
          entrada_em: e.entrada,
          situacao: 'ativo',
          observacao: e.observacao,
        });
        return { id, versao: 1 };
      },
    );
  }

  /** A saída encerra a participação com a data e o motivo; o registro fica (nunca é apagado). */
  encerrarParticipante(
    c: ContextoPorta,
    id: number,
    versao: number,
    e: { saida: string; motivo: string; observacao: string | null },
    trilha: Trilha,
  ) {
    return this.gravar(
      c,
      'operadora.programa-saude.participante.encerrar',
      'participante_programa',
      trilha,
      async (tx, est, hoje) => {
        const p = await participanteDoEst(tx, est, id);
        exigir(
          problemasDaSaida({
            situacao: p.situacao,
            entrada: p.entrada,
            saida: e.saida,
            motivo: e.motivo,
            hoje,
          }),
        );
        const nova = await tx.alterar('participante_programa', id, versao, {
          situacao: 'encerrado',
          saida_em: e.saida,
          motivo_saida: e.motivo,
          ...(e.observacao ? { observacao: e.observacao } : {}),
        });
        // Os contatos ainda agendados da participação encerrada ficam cancelados (o histórico fica).
        for (const r of await tx.consultar(
          `SELECT id, versao FROM acompanhamento_programa WHERE participante_programa_id = ? AND situacao = 'agendado'
              AND excluido_em IS NULL`,
          [id],
          { teto: 1000 },
        ))
          await tx.alterar('acompanhamento_programa', Number(r['id']), Number(r['versao']), {
            situacao: 'cancelado',
            observacao: 'Cancelado pela saída do programa',
          });
        return { id, versao: nova };
      },
    );
  }

  // ======== acompanhamento ========
  agenda(c: ContextoPorta, filtro: { programa?: number }) {
    return this.ler(c, async (l, est, hoje) => {
      const itens = await lerContatos(l, est, { programa: filtro.programa, somenteAgendados: true });
      return agendaDeVisitas(itens, hoje);
    });
  }

  registrarContato(
    c: ContextoPorta,
    participante: number,
    e: {
      tipo: string;
      situacao: 'agendado' | 'realizado';
      agendadoPara: string | null;
      realizadoEm: string | null;
      resultado: string | null;
      proximoContato: string | null;
    },
    trilha: Trilha,
  ) {
    return this.gravar(
      c,
      'operadora.programa-saude.contato.registrar',
      'acompanhamento_programa',
      trilha,
      async (tx, est, _hoje, agora) => {
        const p = await participanteDoEst(tx, est, participante);
        if (p.situacao !== 'ativo')
          throw recusa('participante-inativo', 'Só o participante ativo recebe contato novo.', {
            campos: ['participante'],
          });
        exigir(problemasDoContato(e, agora));
        const id = await tx.incluir('acompanhamento_programa', {
          estabelecimento_id: est,
          participante_programa_id: participante,
          tipo_contato: e.tipo,
          agendado_para: e.agendadoPara ? sqlData(e.agendadoPara) : null,
          realizado_em: e.situacao === 'realizado' && e.realizadoEm ? sqlData(e.realizadoEm) : null,
          situacao: e.situacao,
          resultado: e.resultado,
          proximo_contato: e.proximoContato,
        });
        return { id, versao: 1 };
      },
    );
  }

  baixarContato(
    c: ContextoPorta,
    id: number,
    versao: number,
    e: {
      situacao: string;
      realizadoEm: string | null;
      resultado: string | null;
      proximoContato: string | null;
    },
    trilha: Trilha,
  ) {
    return this.gravar(
      c,
      'operadora.programa-saude.contato.baixar',
      'acompanhamento_programa',
      trilha,
      async (tx, est, _hoje, agora) => {
        const r = await tx.uma(
          'SELECT situacao FROM acompanhamento_programa WHERE id = ? AND estabelecimento_id = ?',
          [id, est],
        );
        if (!r) throw naoEncontrado();
        exigir(problemasDaBaixaDoContato(textoObrigatorio(r['situacao']), e.situacao, e.realizadoEm, agora));
        const nova = await tx.alterar('acompanhamento_programa', id, versao, {
          situacao: e.situacao,
          realizado_em: e.situacao === 'realizado' && e.realizadoEm ? sqlData(e.realizadoEm) : null,
          resultado: e.resultado,
          proximo_contato: e.proximoContato,
        });
        return { id, versao: nova };
      },
    );
  }

  // ======== avaliação de risco ========
  aplicarQuestionario(
    c: ContextoPorta,
    participante: number,
    e: { questionario: number; canal: string; respostas: RespostaQuestionario[]; observacao: string | null },
    trilha: Trilha,
  ) {
    return this.gravar(
      c,
      'operadora.programa-saude.avaliacao.aplicar',
      'avaliacao_risco_participante',
      trilha,
      async (tx, est, _hoje, agora) => {
        const p = await participanteDoEst(tx, est, participante);
        if (p.situacao !== 'ativo')
          throw recusa('participante-inativo', 'Só o participante ativo é avaliado.', {
            campos: ['participante'],
          });
        const m = await tx.uma(
          'SELECT exige_todas_respostas FROM modelo_questionario_saude WHERE id = ? AND ativo = TRUE',
          [e.questionario],
        );
        if (!m) throw naoEncontrado();
        const perguntas = await lerPerguntas(tx, e.questionario);
        const r = pontuarQuestionario(perguntas, e.respostas, booleano(m['exige_todas_respostas']));
        exigir(r.problemas);
        // O grupo de risco do programa vale para quem sai da avaliação com risco alto ou muito alto.
        const grupo =
          r.classificacao === 'alto' || r.classificacao === 'muito_alto' ? p.grupoRiscoPrograma : null;
        const id = await tx.incluir('avaliacao_risco_participante', {
          estabelecimento_id: est,
          participante_programa_id: participante,
          modelo_questionario_saude_id: e.questionario,
          aplicado_em: sqlData(agora),
          canal: e.canal,
          escore: r.escore,
          classificacao_risco: r.classificacao,
          grupo_risco_saude_id: grupo,
          situacao: 'concluida',
          observacao: e.observacao,
        });
        let seq = 0;
        for (const pq of [...perguntas].sort((a, b) => a.sequencia - b.sequencia)) {
          const resp = e.respostas.find((x) => x.pergunta === pq.id);
          if (!resp || r.pontos[pq.id] === undefined) continue;
          seq += 1;
          await tx.incluir('avaliacao_risco_participante_resposta', {
            avaliacao_risco_participante_id: id,
            sequencia: seq,
            modelo_questionario_saude_pergunta_id: pq.id,
            resposta_opcao: resp.opcao || null,
            resposta_numero: resp.numero ?? null,
            resposta_data: resp.data || null,
            resposta_texto: resp.texto?.trim() || null,
            pontos: r.pontos[pq.id],
          });
        }
        if (grupo !== null && grupo !== p.grupoRisco)
          await tx.alterar('participante_programa', participante, p.versao, { grupo_risco_saude_id: grupo });
        return { id, versao: 1, escore: r.escore, maximo: r.maximo, classificacao: r.classificacao };
      },
    );
  }

  // ======== custo do crônico e bonificação ========
  custo(c: ContextoPorta, programa: number, janela: number) {
    return this.ler(c, async (l, est, hoje) => {
      const ps = await lerParticipantes(l, est, { programa });
      if (!ps.length) return { participantes: [], antes: 0, depois: 0, variacaoPercentual: null, janela };
      const ids = [...new Set(ps.map((p) => p.beneficiario))];
      const rs = await l.consultar(
        `SELECT g.beneficiario_plano_id AS b, DATE_FORMAT(g.inicio_atendimento, '%Y-%m') AS comp,
                SUM(COALESCE(g.valor_liberado, g.valor_apresentado - g.valor_glosado)) AS v
           FROM guia_conta_recebida g
          WHERE g.estabelecimento_id = ? AND g.situacao <> 'cancelada' AND g.excluido_em IS NULL
            AND g.beneficiario_plano_id IN (${marcadores(ids.length)})
          GROUP BY g.beneficiario_plano_id, DATE_FORMAT(g.inicio_atendimento, '%Y-%m')`,
        [est, ...ids],
        { teto: 50000 },
      );
      const porBen = new Map<number, { competencia: string; valor: number }[]>();
      for (const r of rs) {
        const b = Number(r['b']);
        const lista = porBen.get(b) ?? [];
        lista.push({ competencia: textoObrigatorio(r['comp']), valor: numero(r['v']) ?? 0 });
        porBen.set(b, lista);
      }
      const participantes = ps.map((p) => ({
        participante: p.id,
        nome: p.nome,
        matricula: p.matricula,
        entrada: p.entrada,
        situacao: p.situacao,
        ...custoDoParticipante(porBen.get(p.beneficiario) ?? [], p.entrada, p.saida ?? hoje, janela),
      }));
      const somaMedia = (lado: 'antes' | 'depois') =>
        Math.round(participantes.reduce((s, p) => s + p[lado].media, 0) * 100) / 100;
      const antes = somaMedia('antes');
      const depois = somaMedia('depois');
      return {
        participantes,
        antes,
        depois,
        variacaoPercentual: antes > 0 ? Math.round(((depois - antes) / antes) * 10000) / 100 : null,
        janela,
      };
    });
  }

  bonificacao(c: ContextoPorta, programa: number) {
    return this.ler(c, async (l, est, hoje) => {
      const [p] = await lerProgramas(l, est, programa);
      if (!p) throw naoEncontrado();
      const ps = (await lerParticipantes(l, est, { programa })).filter((x) => x.situacao === 'ativo');
      const contatos = ps.length ? await lerContatos(l, est, { participantes: ps.map((x) => x.id) }) : [];
      const regras = p.bonificacoes.filter((b) => b.ativo);
      return ps.map((x) => {
        const adesao = adesaoAsAtividades(
          contatos.filter((k) => k.participante === x.id),
          hoje,
        );
        return {
          participante: x.id,
          nome: x.nome,
          matricula: x.matricula,
          adesao,
          bonificacoes: regras.map((b) => ({
            codigo: b.codigo,
            descricao: b.descricao,
            ...direitoABonificacao(b, adesao.percentual, hoje),
          })),
        };
      });
    });
  }
}

export const METODOS_PROGRAMA_SAUDE: ReadonlySet<string> = new Set([
  'programas',
  'programa',
  'gravarPrograma',
  'incluirCriterio',
  'desativarCriterio',
  'incluirBonificacao',
  'gruposRisco',
  'gravarGrupoRisco',
  'questionarios',
  'gravarQuestionario',
  'elegiveis',
  'participantes',
  'doBeneficiario',
  'incluirParticipante',
  'encerrarParticipante',
  'agenda',
  'registrarContato',
  'baixarContato',
  'aplicarQuestionario',
  'custo',
  'bonificacao',
]);

// ---- apoio ----
async function programaDoEst(l: Leitor, est: number, id: number) {
  const r = await l.uma(
    `SELECT situacao, vigencia_inicio, vigencia_fim, grupo_risco_saude_id FROM programa_saude
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est],
  );
  if (!r) throw naoEncontrado();
  return {
    situacao: textoObrigatorio(r['situacao']),
    vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '',
    vigenciaFim: dataIso(r['vigencia_fim']),
    grupoRisco: inteiro(r['grupo_risco_saude_id']),
  };
}

async function participanteDoEst(l: Leitor, est: number, id: number) {
  const r = await l.uma(
    `SELECT x.situacao, x.entrada_em, x.versao, x.grupo_risco_saude_id, p.grupo_risco_saude_id AS grupo_programa
       FROM participante_programa x JOIN programa_saude p ON p.id = x.programa_saude_id
      WHERE x.id = ? AND p.estabelecimento_id = ? AND x.excluido_em IS NULL`,
    [id, est],
  );
  if (!r) throw naoEncontrado();
  return {
    situacao: textoObrigatorio(r['situacao']),
    entrada: dataIso(r['entrada_em']) ?? '',
    versao: Number(r['versao']),
    grupoRisco: inteiro(r['grupo_risco_saude_id']),
    grupoRiscoPrograma: inteiro(r['grupo_programa']),
  };
}

async function lerPerguntas(
  l: Leitor,
  modelo: number,
): Promise<(PerguntaQuestionario & { enunciado: string })[]> {
  const rs = await l.consultar(
    `SELECT id, sequencia, enunciado, tipo_resposta, opcoes_resposta, obrigatoria, resposta_indicativa
       FROM modelo_questionario_saude_pergunta WHERE modelo_questionario_saude_id = ? AND excluido_em IS NULL
      ORDER BY sequencia`,
    [modelo],
    { teto: 500 },
  );
  return rs.map((r) => {
    const bruto = r['opcoes_resposta'];
    let opcoes: OpcaoPergunta[] = [];
    try {
      const v: unknown = typeof bruto === 'string' ? JSON.parse(bruto) : bruto;
      if (Array.isArray(v)) opcoes = v as OpcaoPergunta[];
    } catch {
      opcoes = [];
    }
    return {
      id: Number(r['id']),
      sequencia: Number(r['sequencia']),
      enunciado: textoObrigatorio(r['enunciado']),
      tipoResposta: textoObrigatorio(r['tipo_resposta']),
      obrigatoria: booleano(r['obrigatoria']),
      opcoes,
      respostaIndicativa: texto(r['resposta_indicativa']),
    };
  });
}

async function lerProgramas(l: Leitor, est: number, id: number | null): Promise<ProgramaLido[]> {
  const rs = await l.consultar(
    `SELECT p.*, g.descricao AS grupo_descricao,
            (SELECT COUNT(*) FROM participante_programa x WHERE x.programa_saude_id = p.id AND x.situacao = 'ativo'
                AND x.excluido_em IS NULL) AS ativos
       FROM programa_saude p LEFT JOIN grupo_risco_saude g ON g.id = p.grupo_risco_saude_id
      WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL ${id === null ? '' : 'AND p.id = ?'}
      ORDER BY p.nome`,
    id === null ? [est] : [est, id],
    { teto: 500 },
  );
  if (!rs.length) return [];
  const ids = rs.map((r) => Number(r['id']));
  const m = marcadores(ids.length);
  const crits = await l.consultar(
    `SELECT * FROM criterio_elegibilidade_programa WHERE programa_saude_id IN (${m}) ORDER BY id`,
    ids,
    { teto: 2000 },
  );
  const bons = await l.consultar(
    `SELECT * FROM bonificacao_programa WHERE programa_saude_id IN (${m}) ORDER BY codigo`,
    ids,
    { teto: 2000 },
  );
  return rs.map((r) => {
    const pid = Number(r['id']);
    return {
      id: pid,
      versao: Number(r['versao']),
      codigo: textoObrigatorio(r['codigo']),
      nome: textoObrigatorio(r['nome']),
      tipo: textoObrigatorio(r['tipo']),
      objetivo: texto(r['objetivo']),
      publicoAlvo: texto(r['publico_alvo']),
      metas: texto(r['metas']),
      grupoRisco: inteiro(r['grupo_risco_saude_id']),
      grupoRiscoDescricao: texto(r['grupo_descricao']),
      registradoAns: booleano(r['registrado_ans']),
      numeroRegistroAns: texto(r['numero_registro_ans']),
      isentaCoparticipacao: booleano(r['isenta_coparticipacao']),
      vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '',
      vigenciaFim: dataIso(r['vigencia_fim']),
      situacao: textoObrigatorio(r['situacao']),
      participantesAtivos: Number(r['ativos'] ?? 0),
      criterios: crits
        .filter((k) => Number(k['programa_saude_id']) === pid)
        .map((k) => ({
          id: Number(k['id']),
          versao: Number(k['versao']),
          tipo: textoObrigatorio(k['tipo_criterio']),
          termo: inteiro(k['termo_terminologia_id']),
          grupoPatologia: inteiro(k['grupo_patologia_id']),
          ocorrenciasMinimas: inteiro(k['ocorrencias_minimas']),
          periodoMeses: inteiro(k['periodo_meses']),
          idadeMinima: inteiro(k['idade_minima']),
          idadeMaxima: inteiro(k['idade_maxima']),
          custoMensalMinimo: numero(k['custo_mensal_minimo']),
          custoPeriodoMinimo: numero(k['custo_periodo_minimo']),
          escoreMinimo: numero(k['escore_minimo']),
          formaAlerta: textoObrigatorio(k['forma_alerta']),
          ativo: booleano(k['ativo']),
        })),
      bonificacoes: bons
        .filter((b) => Number(b['programa_saude_id']) === pid)
        .map((b) => ({
          id: Number(b['id']),
          versao: Number(b['versao']),
          codigo: textoObrigatorio(b['codigo']),
          descricao: textoObrigatorio(b['descricao']),
          tipoBeneficio: textoObrigatorio(b['tipo_beneficio']),
          percentualDesconto: numero(b['percentual_desconto']),
          valorBonus: numero(b['valor_bonus']),
          adesaoMinimaPercentual: numero(b['adesao_minima_percentual']),
          vigenciaInicio: dataIso(b['vigencia_inicio']) ?? '',
          vigenciaFim: dataIso(b['vigencia_fim']),
          ativo: booleano(b['ativo']),
        })),
    };
  });
}

async function lerParticipantes(
  l: Leitor,
  est: number,
  f: { programa?: number; beneficiario?: number },
): Promise<ParticipanteLido[]> {
  const conds = ['p.estabelecimento_id = ?', 'x.excluido_em IS NULL'];
  const ps: unknown[] = [est];
  if (f.programa !== undefined) {
    conds.push('x.programa_saude_id = ?');
    ps.push(f.programa);
  }
  if (f.beneficiario !== undefined) {
    conds.push('x.beneficiario_plano_id = ?');
    ps.push(f.beneficiario);
  }
  const rs = await l.consultar(
    `SELECT x.id, x.versao, x.programa_saude_id, p.nome AS programa_nome, x.beneficiario_plano_id, b.matricula,
            f.nome, x.grupo_risco_saude_id, g.descricao AS grupo_descricao, x.entrada_em, x.saida_em, x.motivo_saida,
            x.situacao,
            (SELECT a.classificacao_risco FROM avaliacao_risco_participante a WHERE a.participante_programa_id = x.id
                AND a.situacao = 'concluida' AND a.excluido_em IS NULL ORDER BY a.aplicado_em DESC, a.id DESC LIMIT 1)
              AS classificacao,
            (SELECT MIN(c.agendado_para) FROM acompanhamento_programa c WHERE c.participante_programa_id = x.id
                AND c.situacao = 'agendado' AND c.excluido_em IS NULL) AS proximo
       FROM participante_programa x
       JOIN programa_saude p ON p.id = x.programa_saude_id
       JOIN beneficiario_plano b ON b.id = x.beneficiario_plano_id
       JOIN pessoa_fisica f ON f.id = b.pessoa_fisica_id
       LEFT JOIN grupo_risco_saude g ON g.id = x.grupo_risco_saude_id
      WHERE ${conds.join(' AND ')}
      ORDER BY x.situacao = 'encerrado', f.nome, x.entrada_em DESC`,
    ps,
    { teto: 5000 },
  );
  return rs.map((r) => ({
    id: Number(r['id']),
    versao: Number(r['versao']),
    programa: Number(r['programa_saude_id']),
    programaNome: textoObrigatorio(r['programa_nome']),
    beneficiario: Number(r['beneficiario_plano_id']),
    matricula: textoObrigatorio(r['matricula']),
    nome: textoObrigatorio(r['nome']),
    grupoRisco: inteiro(r['grupo_risco_saude_id']),
    grupoRiscoDescricao: texto(r['grupo_descricao']),
    entrada: dataIso(r['entrada_em']) ?? '',
    saida: dataIso(r['saida_em']),
    motivoSaida: texto(r['motivo_saida']),
    situacao: textoObrigatorio(r['situacao']),
    ultimaClassificacao: texto(r['classificacao']),
    proximoContato: instanteIso(r['proximo']),
  }));
}

async function lerContatos(
  l: Leitor,
  est: number,
  f: { programa?: number; participantes?: readonly number[]; somenteAgendados?: boolean },
): Promise<ContatoLido[]> {
  const conds = ['c.estabelecimento_id = ?', 'c.excluido_em IS NULL'];
  const ps: unknown[] = [est];
  if (f.programa !== undefined) {
    conds.push('x.programa_saude_id = ?');
    ps.push(f.programa);
  }
  if (f.participantes) {
    if (!f.participantes.length) return [];
    conds.push(`c.participante_programa_id IN (${marcadores(f.participantes.length)})`);
    ps.push(...f.participantes);
  }
  if (f.somenteAgendados) conds.push("c.situacao = 'agendado'");
  const rs = await l.consultar(
    `SELECT c.id, c.versao, c.participante_programa_id, f.nome, p.nome AS programa_nome, c.tipo_contato,
            c.agendado_para, c.realizado_em, c.situacao, c.resultado, c.proximo_contato
       FROM acompanhamento_programa c
       JOIN participante_programa x ON x.id = c.participante_programa_id
       JOIN programa_saude p ON p.id = x.programa_saude_id
       JOIN beneficiario_plano b ON b.id = x.beneficiario_plano_id
       JOIN pessoa_fisica f ON f.id = b.pessoa_fisica_id
      WHERE ${conds.join(' AND ')}
      ORDER BY COALESCE(c.agendado_para, c.realizado_em) DESC`,
    ps,
    { teto: 5000 },
  );
  return rs.map((r) => ({
    id: Number(r['id']),
    versao: Number(r['versao']),
    participante: Number(r['participante_programa_id']),
    nome: textoObrigatorio(r['nome']),
    programaNome: textoObrigatorio(r['programa_nome']),
    tipo: textoObrigatorio(r['tipo_contato']),
    agendadoPara: instanteIso(r['agendado_para']),
    realizadoEm: instanteIso(r['realizado_em']),
    situacao: textoObrigatorio(r['situacao']),
    resultado: texto(r['resultado']),
    proximoContato: dataIso(r['proximo_contato']),
  }));
}
