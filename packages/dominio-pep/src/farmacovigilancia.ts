// Farmacovigilância no prontuário (03-PEP L103) e lista de uso contínuo do paciente com a reconciliação que parte
// dela (03-PEP L104). Regras puras: o adaptador do banco só grava o que estas funções aceitam.
//
// Reação adversa a medicamento (RAM): registrada por quem atende, avaliada pela farmácia clínica (causalidade),
// notificada à vigilância (Notivisa, RDC 36/2013 e RDC 4/2009 da farmacovigilância) e encerrada com o desfecho. A
// reação grave (nível de gravidade a partir do limiar) ou com óbito só encerra depois de notificada. Nada se apaga:
// a inativação (registro feito por engano) pede justificativa e cada passo fica no histórico da reação.
//
// Uso contínuo: a lista de medicamentos de casa atravessa os atendimentos do paciente; a reconciliação (admissão,
// transferência, alta) parte dela e a atualiza — suspender tira o medicamento da lista ativa (com justificativa e
// autor), manter, ajustar e substituir mantêm o medicamento com a conduta da última reconciliação.

export const SITUACOES_REACAO = [
  'registrada',
  'em_avaliacao',
  'avaliada',
  'notificada',
  'encerrada',
  'inativa',
] as const;
export type SituacaoReacao = (typeof SITUACOES_REACAO)[number];

export const DESFECHOS_REACAO = [
  'recuperado',
  'recuperado_com_sequela',
  'em_recuperacao',
  'nao_recuperado',
  'obito',
  'desconhecido',
] as const;
export type DesfechoReacao = (typeof DESFECHOS_REACAO)[number];

export const REEXPOSICOES = [
  'nao_realizada',
  'reacao_reapareceu',
  'reacao_nao_reapareceu',
  'desconhecida',
] as const;

export type EtapaReacao = 'avaliacao_farmacia' | 'notificacao' | 'encerramento' | 'reabertura' | 'inativacao';

/** Nível de gravidade a partir do qual a reação é grave (a notificação é obrigatória antes de encerrar). */
export const NIVEL_GRAVE_PADRAO = 3;

export interface FalhaRegra {
  readonly codigo: string;
  readonly mensagem: string;
}

const falha = (codigo: string, mensagem: string): FalhaRegra => ({ codigo, mensagem });

export interface NovaReacao {
  readonly prescricaoItem: number | null;
  readonly itemPrescritivel: number | null;
  readonly medicamentoDescricao: string | null;
  readonly descricao: string;
  readonly inicio: Date;
  readonly fim: Date | null;
}

/** Confere o registro novo da reação: medicamento suspeito, manifestação e período coerente (nada no futuro). */
export function validarNovaReacao(r: NovaReacao, agora: Date): FalhaRegra[] {
  const f: FalhaRegra[] = [];
  if (r.prescricaoItem === null && r.itemPrescritivel === null && !r.medicamentoDescricao?.trim())
    f.push(
      falha('medicamento-obrigatorio', 'Informe o medicamento suspeito (item prescrito, cadastro ou nome).'),
    );
  if (r.descricao.trim().length < 3)
    f.push(falha('descricao-obrigatoria', 'Descreva a manifestação observada.'));
  if (r.inicio.getTime() > agora.getTime() + 60_000)
    f.push(falha('inicio-futuro', 'O início da reação não pode estar no futuro.'));
  if (r.fim) {
    if (r.fim.getTime() < r.inicio.getTime())
      f.push(falha('periodo-invalido', 'O fim da reação é anterior ao início.'));
    if (r.fim.getTime() > agora.getTime() + 60_000)
      f.push(falha('fim-futuro', 'O fim da reação não pode estar no futuro.'));
  }
  return f;
}

const DESTINO: Readonly<Record<EtapaReacao, SituacaoReacao>> = {
  avaliacao_farmacia: 'avaliada',
  notificacao: 'notificada',
  encerramento: 'encerrada',
  reabertura: 'em_avaliacao',
  inativacao: 'inativa',
};

const ORIGENS: Readonly<Record<EtapaReacao, readonly SituacaoReacao[]>> = {
  avaliacao_farmacia: ['registrada', 'em_avaliacao', 'avaliada'],
  notificacao: ['registrada', 'em_avaliacao', 'avaliada'],
  encerramento: ['registrada', 'em_avaliacao', 'avaliada', 'notificada'],
  reabertura: ['encerrada'],
  inativacao: ['registrada', 'em_avaliacao'],
};

export interface PassoReacao {
  readonly etapa: EtapaReacao;
  readonly situacaoAtual: SituacaoReacao;
  /** Nível da gravidade da reação (1 = menor). */
  readonly nivelGravidade: number;
  readonly nivelGrave?: number;
  readonly jaNotificada: boolean;
  readonly causalidade?: number | null;
  readonly desfecho?: string | null;
  readonly justificativa?: string | null;
}

/** Situação nova do passo (avaliação, notificação, encerramento, reabertura, inativação) ou a recusa. */
export function passoReacao(p: PassoReacao): { situacao: SituacaoReacao } | { falha: FalhaRegra } {
  if (!ORIGENS[p.etapa].includes(p.situacaoAtual))
    return {
      falha: falha(
        'transicao-invalida',
        `A reação ${p.situacaoAtual.replace('_', ' ')} não aceita este passo.`,
      ),
    };
  if (p.etapa === 'avaliacao_farmacia' && !p.causalidade)
    return { falha: falha('causalidade-obrigatoria', 'A avaliação da farmácia pede a causalidade.') };
  if (p.etapa === 'encerramento') {
    if (!p.desfecho || !(DESFECHOS_REACAO as readonly string[]).includes(p.desfecho))
      return { falha: falha('desfecho-obrigatorio', 'Encerrar pede o desfecho da reação.') };
    if (exigeNotificacao(p.nivelGravidade, p.desfecho, p.nivelGrave) && !p.jaNotificada)
      return {
        falha: falha(
          'notificacao-obrigatoria',
          'Reação grave ou com óbito: notifique à vigilância (Notivisa) antes de encerrar.',
        ),
      };
  }
  if ((p.etapa === 'inativacao' || p.etapa === 'reabertura') && (p.justificativa?.trim().length ?? 0) < 10)
    return { falha: falha('justificativa-obrigatoria', 'Justifique com pelo menos 10 caracteres.') };
  return { situacao: DESTINO[p.etapa] };
}

/** A reação grave ou com óbito tem notificação obrigatória à vigilância. */
export function exigeNotificacao(
  nivelGravidade: number,
  desfecho: string | null | undefined,
  nivelGrave = NIVEL_GRAVE_PADRAO,
): boolean {
  return nivelGravidade >= nivelGrave || desfecho === 'obito';
}

/** A reação que ainda alerta na prescrição: tudo menos a inativada (registro feito por engano). */
export function reacaoAlertaNaPrescricao(situacao: string): boolean {
  return situacao !== 'inativa';
}

// ---------------------------------------------------------------- uso contínuo e reconciliação

export const FONTES_USO_CONTINUO = [
  'paciente',
  'familiar',
  'receita',
  'prontuario_anterior',
  'farmacia',
  'outro_servico',
  'outro',
] as const;
export type FonteUsoContinuo = (typeof FONTES_USO_CONTINUO)[number];

export const CONDUTAS_RECONCILIACAO_LISTA = ['manter', 'suspender', 'substituir', 'ajustar'] as const;
export type CondutaReconciliacaoLista = (typeof CONDUTAS_RECONCILIACAO_LISTA)[number];

export interface UsoContinuoNovo {
  readonly itemPrescritivel: number | null;
  readonly descricaoLivre: string | null;
  readonly dose: number | null;
  readonly unidade: number | null;
  readonly inicioUso: Date | null;
  readonly ultimaTomada: Date | null;
}

/** Confere o medicamento de uso contínuo: produto (cadastro ou nome), dose com unidade e datas não futuras. */
export function validarUsoContinuo(u: UsoContinuoNovo, agora: Date): FalhaRegra[] {
  const f: FalhaRegra[] = [];
  if (u.itemPrescritivel === null && !u.descricaoLivre?.trim())
    f.push(falha('medicamento-obrigatorio', 'Escolha o medicamento do cadastro ou informe o nome.'));
  if (u.dose !== null && (!(u.dose > 0) || u.unidade === null))
    f.push(falha('dose-invalida', 'A dose precisa ser maior que zero e ter unidade.'));
  if (u.inicioUso && u.inicioUso.getTime() > agora.getTime())
    f.push(falha('inicio-futuro', 'O início do uso não pode estar no futuro.'));
  if (u.ultimaTomada && u.ultimaTomada.getTime() > agora.getTime() + 60_000)
    f.push(falha('ultima-tomada-futura', 'A última tomada não pode estar no futuro.'));
  return f;
}

/** Conduta da lista (coluna do uso contínuo) a partir da conduta da reconciliação. */
export function condutaNaLista(
  c: CondutaReconciliacaoLista,
): 'manter' | 'suspender' | 'substituir' | 'ajustar_dose' {
  return c === 'ajustar' ? 'ajustar_dose' : c;
}

/** Fonte da linha da reconciliação a partir da fonte do uso contínuo (a linha tem lista mais curta). */
export function fonteNaReconciliacao(
  f: string,
): 'paciente' | 'familiar' | 'receita' | 'prontuario' | 'outro' {
  if (f === 'paciente' || f === 'familiar' || f === 'receita') return f;
  if (f === 'prontuario_anterior') return 'prontuario';
  return 'outro';
}

export interface DecisaoReconciliacao {
  readonly usoContinuo: number;
  readonly conduta: CondutaReconciliacaoLista;
  readonly justificativa: string | null;
}

/**
 * Confere as decisões da reconciliação contra a lista ativa: cada medicamento ativo decidido uma vez só (nada fica
 * sem decisão), só medicamentos da lista ativa do paciente, e justificativa em toda conduta diferente de manter.
 */
export function validarReconciliacaoDaLista(
  ativos: readonly number[],
  decisoes: readonly DecisaoReconciliacao[],
): FalhaRegra[] {
  const f: FalhaRegra[] = [];
  const vistos = new Set<number>();
  for (const d of decisoes) {
    if (!ativos.includes(d.usoContinuo))
      f.push(falha('fora-da-lista', `O medicamento ${d.usoContinuo} não está na lista ativa do paciente.`));
    if (vistos.has(d.usoContinuo))
      f.push(falha('decisao-repetida', `O medicamento ${d.usoContinuo} foi decidido duas vezes.`));
    vistos.add(d.usoContinuo);
    if (d.conduta !== 'manter' && (d.justificativa?.trim().length ?? 0) < 5)
      f.push(falha('justificativa-obrigatoria', 'Conduta diferente de manter pede justificativa.'));
  }
  const faltam = ativos.filter((a) => !vistos.has(a));
  if (faltam.length > 0)
    f.push(
      falha('lista-incompleta', `Faltam decidir ${faltam.length} medicamento(s) da lista de uso contínuo.`),
    );
  return f;
}
