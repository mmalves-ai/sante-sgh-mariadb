// Promoção da saúde e gestão de crônicos da operadora (08-SGO L115, C2-102; F8), conforme a RN ANS 264/2011 (programas
// de promoção da saúde e prevenção de riscos e doenças) e a RN ANS 265/2011 (bonificação e premiação pela participação).
// Regras puras, sem banco:
// - o programa: código, nome, tipo, vigência e registro na ANS (o número é obrigatório quando registrado);
// - o critério de elegibilidade: por CID ou grupo de doenças com ocorrências mínimas na janela, procedimento, idade,
//   internação, pronto-socorro, custo do período ou escore da avaliação de risco. A idade é um recorte do público (todas
//   as de idade valem juntas); os demais são gatilhos (basta um) — com só critérios de idade, o recorte já elege;
// - a entrada e a saída do participante (programa ativo e vigente, beneficiário ativo, sem participação aberta, saída
//   com motivo e nunca antes da entrada; o registro nunca é apagado);
// - o acompanhamento (contato agendado ou realizado, transições e a agenda de visitas com os atrasados);
// - o questionário de risco (pontos por resposta, escore e classificação pela fração do máximo);
// - a bonificação (adesão mínima às atividades, RN 265) e o custo do crônico antes e depois da entrada no programa.

export const TIPOS_PROGRAMA_SAUDE = [
  'promocao_saude',
  'prevencao_risco',
  'gestao_cronicos',
  'gestacao',
  'envelhecimento_ativo',
  'saude_mental',
  'outro',
] as const;
export type TipoProgramaSaude = (typeof TIPOS_PROGRAMA_SAUDE)[number];
export const SITUACOES_PROGRAMA_SAUDE = ['planejado', 'ativo', 'suspenso', 'encerrado'] as const;
export type SituacaoProgramaSaude = (typeof SITUACOES_PROGRAMA_SAUDE)[number];
export const TIPOS_CRITERIO_PROGRAMA = [
  'cid',
  'procedimento',
  'idade',
  'internacao',
  'pronto_socorro',
  'custo',
  'escore',
] as const;
export type TipoCriterioPrograma = (typeof TIPOS_CRITERIO_PROGRAMA)[number];
export const FORMAS_ALERTA_PROGRAMA = ['sugerir', 'incluir_automaticamente', 'apenas_alertar'] as const;
export type FormaAlertaPrograma = (typeof FORMAS_ALERTA_PROGRAMA)[number];
export const MOTIVOS_SAIDA_PROGRAMA = [
  'alta_programa',
  'abandono',
  'obito',
  'exclusao_plano',
  'transferencia',
  'outro',
] as const;
export type MotivoSaidaPrograma = (typeof MOTIVOS_SAIDA_PROGRAMA)[number];
export const TIPOS_CONTATO_PROGRAMA = [
  'telefone',
  'visita_domiciliar',
  'consulta',
  'teleconsulta',
  'mensagem',
  'atividade_grupo',
] as const;
export type TipoContatoPrograma = (typeof TIPOS_CONTATO_PROGRAMA)[number];
export const SITUACOES_CONTATO_PROGRAMA = ['agendado', 'realizado', 'cancelado', 'nao_localizado'] as const;
export type SituacaoContatoPrograma = (typeof SITUACOES_CONTATO_PROGRAMA)[number];
export const CLASSES_RISCO = ['baixo', 'moderado', 'alto', 'muito_alto'] as const;
export type ClasseRisco = (typeof CLASSES_RISCO)[number];
export const TIPOS_BENEFICIO_PROGRAMA = [
  'desconto_mensalidade',
  'bonus',
  'isencao_coparticipacao',
  'fornecimento_medicamento',
  'outro',
] as const;
export type TipoBeneficioPrograma = (typeof TIPOS_BENEFICIO_PROGRAMA)[number];

export interface ProblemaProgramaSaude {
  readonly codigo: string;
  readonly campo: string;
  readonly detalhe: string;
}
const prob = (codigo: string, campo: string, detalhe: string): ProblemaProgramaSaude => ({
  codigo,
  campo,
  detalhe,
});
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const vazio = (v: string | null | undefined) => !v || !v.trim();

// ---- programa ----
export interface ProgramaSaude {
  codigo: string;
  nome: string;
  tipo: string;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  registradoAns: boolean;
  numeroRegistroAns: string | null;
  situacao: string;
}

export function problemasDoPrograma(p: ProgramaSaude): ProblemaProgramaSaude[] {
  const r: ProblemaProgramaSaude[] = [];
  if (vazio(p.codigo) || p.codigo.trim().length > 30)
    r.push(prob('programa-codigo', 'codigo', 'Informe o código do programa (até 30 letras).'));
  if (vazio(p.nome) || p.nome.trim().length > 150)
    r.push(prob('programa-nome', 'nome', 'Informe o nome do programa (até 150 letras).'));
  if (!(TIPOS_PROGRAMA_SAUDE as readonly string[]).includes(p.tipo))
    r.push(prob('programa-tipo', 'tipo', 'Escolha o tipo do programa.'));
  if (!(SITUACOES_PROGRAMA_SAUDE as readonly string[]).includes(p.situacao))
    r.push(prob('programa-situacao', 'situacao', 'Situação do programa inválida.'));
  if (!DATA.test(p.vigenciaInicio))
    r.push(prob('programa-vigencia', 'vigenciaInicio', 'Informe o início da vigência.'));
  else if (p.vigenciaFim !== null && (!DATA.test(p.vigenciaFim) || p.vigenciaFim < p.vigenciaInicio))
    r.push(prob('programa-vigencia', 'vigenciaFim', 'O fim da vigência não pode ser antes do início.'));
  if (p.registradoAns && vazio(p.numeroRegistroAns))
    r.push(
      prob(
        'programa-registro-ans',
        'numeroRegistroAns',
        'Programa registrado na ANS exige o número do registro (RN ANS 264/2011).',
      ),
    );
  return r;
}

export function programaVigente(
  p: Pick<ProgramaSaude, 'situacao' | 'vigenciaInicio' | 'vigenciaFim'>,
  hoje: string,
): boolean {
  return (
    p.situacao === 'ativo' && p.vigenciaInicio <= hoje && (p.vigenciaFim === null || p.vigenciaFim >= hoje)
  );
}

// ---- critério de elegibilidade ----
export interface CriterioElegibilidade {
  id?: number;
  tipo: string;
  termo: number | null;
  grupoPatologia: number | null;
  ocorrenciasMinimas: number | null;
  periodoMeses: number | null;
  idadeMinima: number | null;
  idadeMaxima: number | null;
  custoMensalMinimo: number | null;
  custoPeriodoMinimo: number | null;
  escoreMinimo: number | null;
  formaAlerta: string;
  ativo: boolean;
}

export function problemasDoCriterio(c: CriterioElegibilidade): ProblemaProgramaSaude[] {
  const r: ProblemaProgramaSaude[] = [];
  if (!(TIPOS_CRITERIO_PROGRAMA as readonly string[]).includes(c.tipo)) {
    r.push(prob('criterio-tipo', 'tipo', 'Escolha o tipo do critério.'));
    return r;
  }
  if (!(FORMAS_ALERTA_PROGRAMA as readonly string[]).includes(c.formaAlerta))
    r.push(prob('criterio-alerta', 'formaAlerta', 'Escolha o que fazer com o elegível.'));
  if ((c.tipo === 'cid' || c.tipo === 'procedimento') && c.termo === null && c.grupoPatologia === null)
    r.push(
      prob(
        'criterio-termo',
        'termo',
        c.tipo === 'cid' ? 'Informe o CID-10 ou o grupo de doenças.' : 'Informe o procedimento (TUSS).',
      ),
    );
  if (c.tipo === 'procedimento' && c.termo === null && c.grupoPatologia !== null)
    r.push(prob('criterio-termo', 'termo', 'O critério de procedimento exige o código TUSS.'));
  if (c.tipo === 'idade') {
    if (c.idadeMinima === null && c.idadeMaxima === null)
      r.push(prob('criterio-idade', 'idadeMinima', 'Informe a idade mínima, a máxima ou as duas.'));
    else if (c.idadeMinima !== null && c.idadeMaxima !== null && c.idadeMaxima < c.idadeMinima)
      r.push(prob('criterio-idade', 'idadeMaxima', 'A idade máxima não pode ser menor que a mínima.'));
  }
  if (c.tipo === 'custo' && c.custoMensalMinimo === null && c.custoPeriodoMinimo === null)
    r.push(prob('criterio-custo', 'custoPeriodoMinimo', 'Informe o custo mínimo mensal ou do período.'));
  if ((c.custoMensalMinimo ?? 0) < 0 || (c.custoPeriodoMinimo ?? 0) < 0)
    r.push(prob('criterio-custo', 'custoPeriodoMinimo', 'O custo mínimo não pode ser negativo.'));
  if (c.tipo === 'escore' && c.escoreMinimo === null)
    r.push(prob('criterio-escore', 'escoreMinimo', 'Informe o escore mínimo da avaliação de risco.'));
  const pedeJanela = ['cid', 'procedimento', 'internacao', 'pronto_socorro', 'custo'].includes(c.tipo);
  if (pedeJanela && (c.periodoMeses === null || c.periodoMeses < 1 || c.periodoMeses > 60))
    r.push(prob('criterio-periodo', 'periodoMeses', 'Informe a janela de apuração, de 1 a 60 meses.'));
  if (c.ocorrenciasMinimas !== null && c.ocorrenciasMinimas < 1)
    r.push(prob('criterio-ocorrencias', 'ocorrenciasMinimas', 'As ocorrências mínimas começam em 1.'));
  return r;
}

/** O que se sabe do beneficiário na janela de cada critério (apurado das contas pela porta). */
export interface PerfilElegibilidade {
  idade: number | null;
  /** Ocorrências (guias distintas) por id de CID ou de grupo de doenças: `cid:<id>` ou `grupo:<id>`. */
  ocorrencias: Readonly<Record<string, number>>;
  internacoes: number;
  prontoSocorro: number;
  custoPeriodo: number;
  meses: number;
  escore: number | null;
}

export interface ResultadoElegibilidade {
  elegivel: boolean;
  motivos: string[];
  forma: FormaAlertaPrograma | null;
}

const ORDEM_FORMA: Readonly<Record<FormaAlertaPrograma, number>> = {
  apenas_alertar: 0,
  sugerir: 1,
  incluir_automaticamente: 2,
};

function atende(c: CriterioElegibilidade, p: PerfilElegibilidade): string | null {
  const min = c.ocorrenciasMinimas ?? 1;
  switch (c.tipo) {
    case 'idade': {
      if (p.idade === null) return null;
      if (c.idadeMinima !== null && p.idade < c.idadeMinima) return null;
      if (c.idadeMaxima !== null && p.idade > c.idadeMaxima) return null;
      return `idade ${p.idade} anos`;
    }
    case 'cid':
    case 'procedimento': {
      const chave =
        c.termo !== null ? `${c.tipo === 'cid' ? 'cid' : 'proc'}:${c.termo}` : `grupo:${c.grupoPatologia}`;
      const n = p.ocorrencias[chave] ?? 0;
      return n >= min ? `${c.tipo === 'cid' ? 'diagnóstico' : 'procedimento'} em ${n} conta(s)` : null;
    }
    case 'internacao':
      return p.internacoes >= min ? `${p.internacoes} internação(ões)` : null;
    case 'pronto_socorro':
      return p.prontoSocorro >= min ? `${p.prontoSocorro} atendimento(s) de urgência` : null;
    case 'custo': {
      const mensal = p.meses > 0 ? p.custoPeriodo / p.meses : 0;
      if (c.custoPeriodoMinimo !== null && p.custoPeriodo < c.custoPeriodoMinimo) return null;
      if (c.custoMensalMinimo !== null && mensal < c.custoMensalMinimo) return null;
      return `custo de ${p.custoPeriodo.toFixed(2)} no período`;
    }
    case 'escore':
      return p.escore !== null && c.escoreMinimo !== null && p.escore >= c.escoreMinimo
        ? `escore ${p.escore}`
        : null;
    default:
      return null;
  }
}

/** A idade é recorte (todas juntas); os demais critérios são gatilhos (basta um). Inativos não contam. */
export function avaliarElegibilidade(
  criterios: readonly CriterioElegibilidade[],
  perfil: PerfilElegibilidade,
): ResultadoElegibilidade {
  const ativos = criterios.filter((c) => c.ativo);
  const idades = ativos.filter((c) => c.tipo === 'idade');
  const gatilhos = ativos.filter((c) => c.tipo !== 'idade');
  const nao: ResultadoElegibilidade = { elegivel: false, motivos: [], forma: null };
  if (!ativos.length) return nao;
  const motivos: string[] = [];
  for (const c of idades) {
    const m = atende(c, perfil);
    if (m === null) return nao;
    if (!motivos.includes(m)) motivos.push(m);
  }
  let forma: FormaAlertaPrograma | null = null;
  const pesar = (f: string) => {
    const ff = (FORMAS_ALERTA_PROGRAMA as readonly string[]).includes(f)
      ? (f as FormaAlertaPrograma)
      : 'sugerir';
    if (forma === null || ORDEM_FORMA[ff] > ORDEM_FORMA[forma]) forma = ff;
  };
  if (gatilhos.length) {
    let algum = false;
    for (const c of gatilhos) {
      const m = atende(c, perfil);
      if (m !== null) {
        algum = true;
        motivos.push(m);
        pesar(c.formaAlerta);
      }
    }
    if (!algum) return nao;
  } else for (const c of idades) pesar(c.formaAlerta);
  return { elegivel: true, motivos, forma };
}

/** Idade em anos completos na data. */
export function idadeEm(nascimento: string | null, data: string): number | null {
  if (!nascimento || !DATA.test(nascimento) || !DATA.test(data)) return null;
  let a = Number(data.slice(0, 4)) - Number(nascimento.slice(0, 4));
  if (data.slice(5) < nascimento.slice(5)) a -= 1;
  return a < 0 ? null : a;
}

/** Início da janela de `meses` que termina em `hoje` (inclusive). */
export function inicioDaJanela(hoje: string, meses: number): string {
  const d = new Date(`${hoje}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - meses);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ---- participante ----
export interface EntradaParticipante {
  programa: Pick<ProgramaSaude, 'situacao' | 'vigenciaInicio' | 'vigenciaFim'>;
  beneficiarioSituacao: string;
  entrada: string;
  hoje: string;
  participacaoAberta: boolean;
}

export function problemasDaEntrada(e: EntradaParticipante): ProblemaProgramaSaude[] {
  const r: ProblemaProgramaSaude[] = [];
  if (!DATA.test(e.entrada)) r.push(prob('entrada-data', 'entrada', 'Informe a data de entrada.'));
  else {
    if (e.entrada > e.hoje)
      r.push(prob('entrada-futura', 'entrada', 'A entrada não pode ser depois de hoje.'));
    if (
      e.programa.vigenciaInicio > e.entrada ||
      (e.programa.vigenciaFim !== null && e.programa.vigenciaFim < e.entrada)
    )
      r.push(prob('entrada-fora-vigencia', 'entrada', 'A entrada fica fora da vigência do programa.'));
  }
  if (e.programa.situacao !== 'ativo')
    r.push(prob('programa-inativo', 'programa', 'O programa não está ativo para receber participantes.'));
  if (e.beneficiarioSituacao !== 'ativo')
    r.push(prob('beneficiario-inativo', 'beneficiario', 'Só o beneficiário ativo entra no programa.'));
  if (e.participacaoAberta)
    r.push(prob('participacao-aberta', 'beneficiario', 'O beneficiário já participa deste programa.'));
  return r;
}

export function problemasDaSaida(e: {
  situacao: string;
  entrada: string;
  saida: string;
  motivo: string;
  hoje: string;
}): ProblemaProgramaSaude[] {
  const r: ProblemaProgramaSaude[] = [];
  if (e.situacao === 'encerrado')
    r.push(prob('participacao-encerrada', 'situacao', 'A participação já está encerrada.'));
  if (!(MOTIVOS_SAIDA_PROGRAMA as readonly string[]).includes(e.motivo))
    r.push(prob('saida-motivo', 'motivo', 'Escolha o motivo da saída.'));
  if (!DATA.test(e.saida)) r.push(prob('saida-data', 'saida', 'Informe a data de saída.'));
  else if (e.saida < e.entrada)
    r.push(prob('saida-antes-entrada', 'saida', 'A saída não pode ser antes da entrada.'));
  else if (e.saida > e.hoje) r.push(prob('saida-futura', 'saida', 'A saída não pode ser depois de hoje.'));
  return r;
}

// ---- acompanhamento ----
export interface ContatoPrograma {
  tipo: string;
  agendadoPara: string | null;
  realizadoEm: string | null;
  situacao: string;
}

export function problemasDoContato(c: ContatoPrograma, agora: string): ProblemaProgramaSaude[] {
  const r: ProblemaProgramaSaude[] = [];
  if (!(TIPOS_CONTATO_PROGRAMA as readonly string[]).includes(c.tipo))
    r.push(prob('contato-tipo', 'tipo', 'Escolha o tipo do contato.'));
  if (c.situacao === 'agendado') {
    if (!c.agendadoPara)
      r.push(prob('contato-agenda', 'agendadoPara', 'Informe quando o contato será feito.'));
    else if (c.agendadoPara.slice(0, 10) < agora.slice(0, 10))
      r.push(prob('contato-agenda-passada', 'agendadoPara', 'O agendamento não pode ficar no passado.'));
  } else if (c.situacao === 'realizado') {
    if (!c.realizadoEm)
      r.push(prob('contato-realizado', 'realizadoEm', 'Informe quando o contato foi feito.'));
    else if (c.realizadoEm > agora)
      r.push(prob('contato-realizado-futuro', 'realizadoEm', 'O contato realizado não pode ser no futuro.'));
  } else r.push(prob('contato-situacao', 'situacao', 'Um contato novo é agendado ou realizado.'));
  return r;
}

const TRANSICOES_CONTATO: Readonly<Record<string, readonly string[]>> = {
  agendado: ['realizado', 'cancelado', 'nao_localizado'],
  realizado: [],
  cancelado: [],
  nao_localizado: [],
};

export function problemasDaBaixaDoContato(
  de: string,
  para: string,
  realizadoEm: string | null,
  agora: string,
): ProblemaProgramaSaude[] {
  if (!(TRANSICOES_CONTATO[de] ?? []).includes(para))
    return [
      prob(
        'contato-transicao',
        'situacao',
        `O contato ${de.replace('_', ' ')} não pode virar ${para.replace('_', ' ')}.`,
      ),
    ];
  if (para === 'realizado' && !realizadoEm)
    return [prob('contato-realizado', 'realizadoEm', 'Informe quando o contato foi feito.')];
  if (para === 'realizado' && realizadoEm && realizadoEm > agora)
    return [prob('contato-realizado-futuro', 'realizadoEm', 'O contato realizado não pode ser no futuro.')];
  return [];
}

export interface ItemAgenda {
  id: number;
  agendadoPara: string | null;
  situacao: string;
}

/** A agenda de visitas: os agendados atrasados (antes de hoje), os de hoje e os próximos. */
export function agendaDeVisitas<T extends ItemAgenda>(
  itens: readonly T[],
  hoje: string,
): { atrasados: T[]; hoje: T[]; proximos: T[] } {
  const ag = itens
    .filter((i) => i.situacao === 'agendado' && i.agendadoPara)
    .sort((a, b) => (a.agendadoPara! < b.agendadoPara! ? -1 : 1));
  return {
    atrasados: ag.filter((i) => i.agendadoPara!.slice(0, 10) < hoje),
    hoje: ag.filter((i) => i.agendadoPara!.slice(0, 10) === hoje),
    proximos: ag.filter((i) => i.agendadoPara!.slice(0, 10) > hoje),
  };
}

// ---- questionário de risco ----
export interface OpcaoPergunta {
  codigo: string;
  descricao: string;
  pontos?: number;
}
export interface PerguntaQuestionario {
  id: number;
  sequencia: number;
  tipoResposta: string;
  obrigatoria: boolean;
  opcoes: readonly OpcaoPergunta[];
  respostaIndicativa: string | null;
}
export interface RespostaQuestionario {
  pergunta: number;
  opcao?: string | null;
  numero?: number | null;
  data?: string | null;
  texto?: string | null;
}
export interface ResultadoQuestionario {
  escore: number;
  maximo: number;
  classificacao: ClasseRisco | null;
  pontos: Record<number, number>;
  problemas: ProblemaProgramaSaude[];
}

/** Classe pela fração do escore sobre o máximo possível: até 25% baixo, até 50% moderado, até 75% alto, acima muito alto. */
export function classificarRisco(escore: number, maximo: number): ClasseRisco {
  if (maximo <= 0) return 'baixo';
  const f = escore / maximo;
  if (f <= 0.25) return 'baixo';
  if (f <= 0.5) return 'moderado';
  if (f <= 0.75) return 'alto';
  return 'muito_alto';
}

const pontosSimNao = (p: PerguntaQuestionario, opcao: string) => {
  const o = p.opcoes.find((x) => x.codigo === opcao);
  if (o?.pontos !== undefined) return o.pontos;
  return p.respostaIndicativa !== null && opcao === p.respostaIndicativa ? 1 : 0;
};

export function pontuarQuestionario(
  perguntas: readonly PerguntaQuestionario[],
  respostas: readonly RespostaQuestionario[],
  exigeTodas: boolean,
): ResultadoQuestionario {
  const problemas: ProblemaProgramaSaude[] = [];
  const pontos: Record<number, number> = {};
  let escore = 0;
  let maximo = 0;
  const porPergunta = new Map(respostas.map((r) => [r.pergunta, r]));
  for (const r of respostas)
    if (!perguntas.some((p) => p.id === r.pergunta))
      problemas.push(
        prob('resposta-pergunta', `pergunta-${r.pergunta}`, 'Resposta de pergunta fora do questionário.'),
      );
  for (const p of [...perguntas].sort((a, b) => a.sequencia - b.sequencia)) {
    const opcoesPontuadas = p.opcoes.map((o) => o.pontos ?? 0);
    const maxP =
      p.tipoResposta === 'multipla_escolha'
        ? opcoesPontuadas.reduce((s, v) => s + Math.max(0, v), 0)
        : p.opcoes.length
          ? Math.max(0, ...opcoesPontuadas, p.respostaIndicativa !== null ? 1 : 0)
          : p.respostaIndicativa !== null
            ? 1
            : 0;
    maximo += maxP;
    const r = porPergunta.get(p.id);
    const respondida =
      r &&
      ((r.opcao ?? '') !== '' || r.numero != null || (r.data ?? '') !== '' || (r.texto ?? '').trim() !== '');
    if (!respondida) {
      if (p.obrigatoria || exigeTodas)
        problemas.push(
          prob('resposta-obrigatoria', `pergunta-${p.id}`, `Responda a pergunta ${p.sequencia}.`),
        );
      continue;
    }
    let pts = 0;
    if (p.tipoResposta === 'sim_nao' || p.tipoResposta === 'escolha_unica') {
      const op = r.opcao ?? '';
      if (p.tipoResposta === 'escolha_unica' && !p.opcoes.some((o) => o.codigo === op)) {
        problemas.push(
          prob('resposta-opcao', `pergunta-${p.id}`, `Opção inválida na pergunta ${p.sequencia}.`),
        );
        continue;
      }
      if (p.tipoResposta === 'sim_nao' && op !== 'sim' && op !== 'nao') {
        problemas.push(
          prob('resposta-opcao', `pergunta-${p.id}`, `Responda sim ou não na pergunta ${p.sequencia}.`),
        );
        continue;
      }
      pts = pontosSimNao(p, op);
    } else if (p.tipoResposta === 'multipla_escolha') {
      const cods = (r.opcao ?? '').split(',').filter(Boolean);
      if (cods.some((c) => !p.opcoes.some((o) => o.codigo === c))) {
        problemas.push(
          prob('resposta-opcao', `pergunta-${p.id}`, `Opção inválida na pergunta ${p.sequencia}.`),
        );
        continue;
      }
      pts = cods.reduce((s, c) => s + (p.opcoes.find((o) => o.codigo === c)?.pontos ?? 0), 0);
    } else if (p.tipoResposta === 'numero' && (r.numero == null || !Number.isFinite(r.numero))) {
      problemas.push(
        prob('resposta-numero', `pergunta-${p.id}`, `Informe um número na pergunta ${p.sequencia}.`),
      );
      continue;
    } else if (p.tipoResposta === 'data' && !DATA.test(r.data ?? '')) {
      problemas.push(
        prob('resposta-data', `pergunta-${p.id}`, `Informe uma data na pergunta ${p.sequencia}.`),
      );
      continue;
    }
    pontos[p.id] = pts;
    escore += pts;
  }
  return {
    escore,
    maximo,
    classificacao: problemas.length ? null : classificarRisco(escore, maximo),
    pontos,
    problemas,
  };
}

// ---- bonificação (RN ANS 265/2011) ----
export interface RegraBonificacao {
  tipoBeneficio: string;
  percentualDesconto: number | null;
  valorBonus: number | null;
  adesaoMinimaPercentual: number | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  ativo: boolean;
}

export function problemasDaBonificacao(
  b: RegraBonificacao & { codigo: string; descricao: string },
): ProblemaProgramaSaude[] {
  const r: ProblemaProgramaSaude[] = [];
  if (vazio(b.codigo)) r.push(prob('bonificacao-codigo', 'codigo', 'Informe o código da bonificação.'));
  if (vazio(b.descricao)) r.push(prob('bonificacao-descricao', 'descricao', 'Informe a descrição.'));
  if (!(TIPOS_BENEFICIO_PROGRAMA as readonly string[]).includes(b.tipoBeneficio))
    r.push(prob('bonificacao-tipo', 'tipoBeneficio', 'Escolha o tipo do benefício.'));
  else if (
    b.percentualDesconto === null &&
    b.valorBonus === null &&
    !['fornecimento_medicamento', 'outro'].includes(b.tipoBeneficio)
  )
    r.push(
      prob(
        'bonificacao-valor',
        'percentualDesconto',
        'Informe o percentual de desconto ou o valor do bônus.',
      ),
    );
  if (b.percentualDesconto !== null && (b.percentualDesconto < 0 || b.percentualDesconto > 100))
    r.push(prob('bonificacao-percentual', 'percentualDesconto', 'O desconto vai de 0 a 100%.'));
  if (b.adesaoMinimaPercentual !== null && (b.adesaoMinimaPercentual < 0 || b.adesaoMinimaPercentual > 100))
    r.push(prob('bonificacao-adesao', 'adesaoMinimaPercentual', 'A adesão mínima vai de 0 a 100%.'));
  if (b.valorBonus !== null && b.valorBonus < 0)
    r.push(prob('bonificacao-bonus', 'valorBonus', 'O bônus não pode ser negativo.'));
  if (!DATA.test(b.vigenciaInicio))
    r.push(prob('bonificacao-vigencia', 'vigenciaInicio', 'Informe o início da vigência.'));
  else if (b.vigenciaFim !== null && b.vigenciaFim < b.vigenciaInicio)
    r.push(prob('bonificacao-vigencia', 'vigenciaFim', 'O fim da vigência não pode ser antes do início.'));
  return r;
}

/** Adesão às atividades: realizados sobre os contatos que deveriam ter acontecido (realizados, não localizados e agendados vencidos). */
export function adesaoAsAtividades(
  contatos: readonly { situacao: string; agendadoPara: string | null }[],
  hoje: string,
): { realizados: number; devidos: number; percentual: number | null } {
  let realizados = 0;
  let devidos = 0;
  for (const c of contatos) {
    if (c.situacao === 'realizado') {
      realizados += 1;
      devidos += 1;
    } else if (c.situacao === 'nao_localizado') devidos += 1;
    else if (c.situacao === 'agendado' && c.agendadoPara && c.agendadoPara.slice(0, 10) < hoje) devidos += 1;
  }
  return {
    realizados,
    devidos,
    percentual: devidos ? Math.round((realizados / devidos) * 10000) / 100 : null,
  };
}

export function direitoABonificacao(
  b: RegraBonificacao,
  adesaoPercentual: number | null,
  hoje: string,
): { direito: boolean; motivo: string } {
  if (!b.ativo || b.vigenciaInicio > hoje || (b.vigenciaFim !== null && b.vigenciaFim < hoje))
    return { direito: false, motivo: 'bonificação fora da vigência' };
  if (b.adesaoMinimaPercentual === null) return { direito: true, motivo: 'sem adesão mínima' };
  if (adesaoPercentual === null) return { direito: false, motivo: 'sem atividades devidas no período' };
  return adesaoPercentual >= b.adesaoMinimaPercentual
    ? { direito: true, motivo: `adesão de ${adesaoPercentual}% (mínima ${b.adesaoMinimaPercentual}%)` }
    : {
        direito: false,
        motivo: `adesão de ${adesaoPercentual}% abaixo da mínima de ${b.adesaoMinimaPercentual}%`,
      };
}

// ---- custo do crônico ----
export interface DespesaMensal {
  competencia: string; // AAAA-MM
  valor: number;
}
export interface CustoDoParticipante {
  antes: { total: number; meses: number; media: number };
  depois: { total: number; meses: number; media: number };
  variacaoPercentual: number | null;
}

const arred = (v: number) => Math.round(v * 100) / 100;
function mesesEntre(de: string, ate: string): number {
  const a = Number(de.slice(0, 4)) * 12 + Number(de.slice(5, 7));
  const b = Number(ate.slice(0, 4)) * 12 + Number(ate.slice(5, 7));
  return Math.max(0, b - a + 1);
}

/**
 * O custo assistencial do participante nos `janela` meses antes da competência de entrada e da entrada até a competência
 * final (ou `janela` meses, o que vier antes), com a média mensal de cada lado e a variação da média.
 */
export function custoDoParticipante(
  despesas: readonly DespesaMensal[],
  entrada: string,
  ate: string,
  janela: number,
): CustoDoParticipante {
  const ce = entrada.slice(0, 7);
  const ca = ate.slice(0, 7);
  const ini = (() => {
    const d = new Date(`${ce}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - janela);
    return d.toISOString().slice(0, 7);
  })();
  const fim = (() => {
    const d = new Date(`${ce}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + janela - 1);
    const f = d.toISOString().slice(0, 7);
    return f < ca ? f : ca;
  })();
  let ta = 0;
  let td = 0;
  for (const d of despesas) {
    if (d.competencia >= ini && d.competencia < ce) ta += d.valor;
    else if (d.competencia >= ce && d.competencia <= fim) td += d.valor;
  }
  const ma = janela;
  const md = fim >= ce ? mesesEntre(ce, fim) : 0;
  const mediaA = ma ? arred(ta / ma) : 0;
  const mediaD = md ? arred(td / md) : 0;
  return {
    antes: { total: arred(ta), meses: ma, media: mediaA },
    depois: { total: arred(td), meses: md, media: mediaD },
    variacaoPercentual: mediaA > 0 && md > 0 ? arred(((mediaD - mediaA) / mediaA) * 100) : null,
  };
}
