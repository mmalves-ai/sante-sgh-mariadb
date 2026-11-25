// Regulação de entrada (C1-080, 02-REC linha 38): o pedido que a central de regulação manda para este hospital
// (paciente regulado para cá). Regras puras:
//   - o recebimento: número como a central emite, prioridade e tipo do pedido, data do pedido não futura e, na
//     emergência e na urgência, o resumo clínico que a central mandou (a equipe decide sobre ele);
//   - a resposta: só sobre o pedido ainda não respondido (recebido ou em análise); aceitar autoriza e, no pedido de
//     consulta, exame ou cirurgia, põe o paciente na lista de espera da especialidade; recusar exige o motivo
//     padronizado (e o complemento quando o motivo é "outro"), e a recusa encerra o pedido; aceitar internação ou
//     transferência abre o pedido de leito do NIR ligado ao pedido da central;
//   - o encerramento: o cancelamento (pela central, outro destino, não comparecimento) com motivo padronizado, que
//     cancela junto a lista de espera e o pedido de leito ainda sem reserva; a conclusão do aceito na chegada do
//     paciente (na internação e na transferência, ligada à internação);
//   - a fila dos recebidos: emergência primeiro, depois urgência, prioridade e eletivo; dentro da prioridade, o mais
//     antigo primeiro;
//   - a devolução à central leva só IDs e códigos (nunca nome, documento ou texto clínico).
// Prática das centrais (SISREG e centrais estaduais): registro manual do número da central e motivo padronizado.
import { FORMATO_NUMERO_REGULACAO } from '@sgh/contratos';

export const PRIORIDADES_REGULACAO_ENTRADA = ['emergencia', 'urgente', 'prioritario', 'eletivo'] as const;
export type PrioridadeRegulacaoEntrada = (typeof PRIORIDADES_REGULACAO_ENTRADA)[number];

export const TIPOS_REGULACAO_ENTRADA = [
  'internacao',
  'transferencia',
  'consulta',
  'exame',
  'cirurgia',
] as const;
export type TipoRegulacaoEntrada = (typeof TIPOS_REGULACAO_ENTRADA)[number];

/** Pedidos que, aceitos, entram na lista de espera da especialidade. */
export const TIPOS_COM_LISTA_ESPERA: readonly TipoRegulacaoEntrada[] = ['consulta', 'exame', 'cirurgia'];
/** Pedidos que, aceitos, abrem o pedido de leito no NIR ligado ao pedido da central (a vaga segue pela fila de leitos). */
export const TIPOS_COM_PEDIDO_LEITO: readonly TipoRegulacaoEntrada[] = ['internacao', 'transferencia'];

export const MOTIVOS_RECUSA_REGULACAO = [
  { codigo: 'sem_leito_compativel', rotulo: 'Sem leito compatível disponível', exigeComplemento: false },
  { codigo: 'sem_especialidade', rotulo: 'Especialidade não atendida no hospital', exigeComplemento: false },
  { codigo: 'sem_recurso', rotulo: 'Sem equipamento ou recurso necessário', exigeComplemento: false },
  {
    codigo: 'perfil_incompativel',
    rotulo: 'Perfil clínico fora do perfil do hospital',
    exigeComplemento: false,
  },
  { codigo: 'informacao_insuficiente', rotulo: 'Informação clínica insuficiente', exigeComplemento: true },
  { codigo: 'paciente_ja_atendido', rotulo: 'Paciente já atendido ou internado', exigeComplemento: false },
  { codigo: 'outro', rotulo: 'Outro motivo', exigeComplemento: true },
] as const;
export type MotivoRecusaRegulacao = (typeof MOTIVOS_RECUSA_REGULACAO)[number]['codigo'];
export const CODIGOS_MOTIVO_RECUSA_REGULACAO = MOTIVOS_RECUSA_REGULACAO.map((m) => m.codigo) as [
  MotivoRecusaRegulacao,
  ...MotivoRecusaRegulacao[],
];

/** Situações do pedido recebido que ainda pedem resposta. */
export const SITUACOES_A_RESPONDER = ['solicitada', 'em_analise'] as const;

export interface ProblemaRegulacaoEntrada {
  readonly campo: string;
  readonly mensagem: string;
}

const COMPLEMENTO_MINIMO = 10;
const RESUMO_MINIMO = 10;
const TOLERANCIA_FUTURO_MS = 5 * 60_000;

export interface RecebimentoRegulacao {
  readonly numero: string;
  readonly tipo: string;
  readonly prioridade: string;
  readonly solicitadoEm: Date;
  readonly agora: Date;
  readonly resumoClinico: string | null;
}

/** O pedido recebido da central: o que falta ou está errado (lista vazia: pode gravar). */
export function conferirRecebimentoRegulacao(r: RecebimentoRegulacao): ProblemaRegulacaoEntrada[] {
  const p: ProblemaRegulacaoEntrada[] = [];
  if (!FORMATO_NUMERO_REGULACAO.test(r.numero.trim().toUpperCase()))
    p.push({
      campo: 'numero',
      mensagem: 'Número da central de 4 a 30 letras, dígitos, ponto, barra ou hífen.',
    });
  if (!(TIPOS_REGULACAO_ENTRADA as readonly string[]).includes(r.tipo))
    p.push({ campo: 'tipo', mensagem: 'Escolha o tipo do pedido.' });
  if (!(PRIORIDADES_REGULACAO_ENTRADA as readonly string[]).includes(r.prioridade))
    p.push({ campo: 'prioridade', mensagem: 'Escolha a prioridade que a central deu.' });
  if (Number.isNaN(r.solicitadoEm.getTime()))
    p.push({ campo: 'solicitadoEm', mensagem: 'Informe quando a central fez o pedido.' });
  else if (r.solicitadoEm.getTime() > r.agora.getTime() + TOLERANCIA_FUTURO_MS)
    p.push({ campo: 'solicitadoEm', mensagem: 'O pedido da central não pode estar no futuro.' });
  if (
    (r.prioridade === 'emergencia' || r.prioridade === 'urgente') &&
    (r.resumoClinico ?? '').trim().length < RESUMO_MINIMO
  )
    p.push({
      campo: 'resumoClinico',
      mensagem: 'Na emergência e na urgência, registre o resumo clínico que a central mandou.',
    });
  return p;
}

export interface RespostaRegulacao {
  readonly situacao: string;
  readonly tipo: string;
  readonly decisao: 'aceitar' | 'recusar';
  readonly motivo: string | null;
  readonly complemento: string | null;
  readonly especialidade: number | null;
}

export type ResultadoRespostaRegulacao =
  | {
      readonly ok: true;
      readonly situacao: 'autorizada' | 'negada';
      readonly listaEspera: boolean;
      readonly pedidoLeito: boolean;
      readonly encerra: boolean;
      readonly texto: string;
    }
  | { readonly ok: false; readonly problemas: readonly ProblemaRegulacaoEntrada[] };

export function motivoRecusaDe(codigo: string | null) {
  return MOTIVOS_RECUSA_REGULACAO.find((m) => m.codigo === codigo) ?? null;
}

/** A resposta do hospital ao pedido recebido: a situação nova, se entra na lista de espera e o texto à central. */
export function conferirRespostaRegulacao(r: RespostaRegulacao): ResultadoRespostaRegulacao {
  const p: ProblemaRegulacaoEntrada[] = [];
  if (!(SITUACOES_A_RESPONDER as readonly string[]).includes(r.situacao))
    return {
      ok: false,
      problemas: [{ campo: 'situacao', mensagem: 'Este pedido já foi respondido ou encerrado.' }],
    };
  const complemento = (r.complemento ?? '').trim();
  if (r.decisao === 'recusar') {
    const m = motivoRecusaDe(r.motivo);
    if (!m) p.push({ campo: 'motivo', mensagem: 'Escolha o motivo da recusa.' });
    else if (m.exigeComplemento && complemento.length < COMPLEMENTO_MINIMO)
      p.push({
        campo: 'complemento',
        mensagem: `Detalhe o motivo da recusa (mínimo de ${COMPLEMENTO_MINIMO} caracteres).`,
      });
    if (p.length) return { ok: false, problemas: p };
    return {
      ok: true,
      situacao: 'negada',
      listaEspera: false,
      pedidoLeito: false,
      encerra: true,
      texto: complemento ? `${m!.rotulo}: ${complemento}` : m!.rotulo,
    };
  }
  if (r.motivo !== null) p.push({ campo: 'motivo', mensagem: 'O motivo padronizado é só da recusa.' });
  const lista = (TIPOS_COM_LISTA_ESPERA as readonly string[]).includes(r.tipo);
  if (lista && r.especialidade === null)
    p.push({
      campo: 'especialidade',
      mensagem: 'Escolha a especialidade da lista de espera em que o paciente entra.',
    });
  if (p.length) return { ok: false, problemas: p };
  return {
    ok: true,
    situacao: 'autorizada',
    listaEspera: lista,
    pedidoLeito: (TIPOS_COM_PEDIDO_LEITO as readonly string[]).includes(r.tipo),
    encerra: false,
    texto: complemento ? `Pedido aceito: ${complemento}` : 'Pedido aceito',
  };
}

/** A prioridade da lista de espera que corresponde à prioridade dada pela central. */
export function prioridadeListaEsperaDe(p: string | null): 'urgente' | 'preferencial' | 'normal' {
  if (p === 'emergencia' || p === 'urgente') return 'urgente';
  if (p === 'prioritario') return 'preferencial';
  return 'normal';
}

/** A fila dos recebidos: os que pedem resposta primeiro, por prioridade e, dentro dela, o mais antigo. */
export function ordenarRecebidosRegulacao<
  T extends { readonly situacao: string; readonly prioridade: string | null; readonly solicitadoEm: string },
>(itens: readonly T[]): T[] {
  const aberto = (s: string) => ((SITUACOES_A_RESPONDER as readonly string[]).includes(s) ? 0 : 1);
  const rank = (p: string | null) => {
    const i = (PRIORIDADES_REGULACAO_ENTRADA as readonly string[]).indexOf(p ?? '');
    return i < 0 ? PRIORIDADES_REGULACAO_ENTRADA.length : i;
  };
  return [...itens].sort(
    (a, b) =>
      aberto(a.situacao) - aberto(b.situacao) ||
      (aberto(a.situacao) === 0 ? rank(a.prioridade) - rank(b.prioridade) : 0) ||
      (aberto(a.situacao) === 0
        ? a.solicitadoEm.localeCompare(b.solicitadoEm)
        : b.solicitadoEm.localeCompare(a.solicitadoEm)),
  );
}

/** A carga da devolução à central: só IDs e códigos. */
export function cargaDevolucaoRegulacao(x: {
  readonly solicitacao: number;
  readonly numero: string;
  readonly situacao: 'autorizada' | 'negada';
  readonly motivo: string | null;
}): Record<string, string | number | null> {
  return {
    solicitacao: x.solicitacao,
    numero: x.numero,
    resposta: x.situacao === 'autorizada' ? 'aceito' : 'recusado',
    motivo: x.motivo,
  };
}

// ---- Encerramento do pedido recebido (C1-080, correção): cancelamento pela central e conclusão na chegada. ----

/** A prioridade do pedido de leito do NIR que corresponde à prioridade dada pela central. */
export function prioridadePedidoLeitoDe(p: string | null): 'emergencia' | 'alta' | 'media' | 'baixa' {
  if (p === 'emergencia') return 'emergencia';
  if (p === 'urgente') return 'alta';
  if (p === 'prioritario') return 'media';
  return 'baixa';
}

export const MOTIVOS_CANCELAMENTO_REGULACAO = [
  {
    codigo: 'cancelado_pela_central',
    rotulo: 'Cancelado pela central de regulação',
    exigeComplemento: false,
  },
  { codigo: 'outro_destino', rotulo: 'Paciente regulado para outro hospital', exigeComplemento: false },
  { codigo: 'nao_compareceu', rotulo: 'Paciente não compareceu', exigeComplemento: false },
  { codigo: 'desistencia', rotulo: 'Desistência do paciente ou da família', exigeComplemento: false },
  { codigo: 'obito', rotulo: 'Óbito antes da chegada', exigeComplemento: false },
  { codigo: 'outro', rotulo: 'Outro motivo', exigeComplemento: true },
] as const;
export type MotivoCancelamentoRegulacao = (typeof MOTIVOS_CANCELAMENTO_REGULACAO)[number]['codigo'];
export const CODIGOS_MOTIVO_CANCELAMENTO_REGULACAO = MOTIVOS_CANCELAMENTO_REGULACAO.map((m) => m.codigo) as [
  MotivoCancelamentoRegulacao,
  ...MotivoCancelamentoRegulacao[],
];

/** Situações do pedido recebido que ainda podem ser canceladas (antes de responder ou aceito sem chegada). */
export const SITUACOES_CANCELAVEIS = ['solicitada', 'em_analise', 'autorizada'] as const;
/** Estados do pedido de leito ligado que o cancelamento encerra junto (sem reserva nem leito). */
export const ESTADOS_PEDIDO_LEITO_CANCELAVEIS = ['solicitado', 'em_analise'] as const;

export interface CancelamentoRegulacao {
  readonly situacao: string;
  readonly motivo: string | null;
  readonly complemento: string | null;
  /** Estado do pedido de leito ligado (null: não há). */
  readonly estadoPedidoLeito: string | null;
}

export type ResultadoCancelamentoRegulacao =
  | { readonly ok: true; readonly cancelaPedidoLeito: boolean; readonly texto: string }
  | { readonly ok: false; readonly problemas: readonly ProblemaRegulacaoEntrada[] };

/**
 * O cancelamento do pedido recebido: a central cancelou, o paciente foi para outro destino ou não veio. Encerra o pedido
 * (nada se apaga) e cancela junto a lista de espera aberta e o pedido de leito que ainda não tem reserva; com leito
 * reservado ou paciente a caminho, o NIR libera a reserva primeiro; com o paciente internado, o pedido se conclui.
 */
export function conferirCancelamentoRegulacao(c: CancelamentoRegulacao): ResultadoCancelamentoRegulacao {
  if (!(SITUACOES_CANCELAVEIS as readonly string[]).includes(c.situacao))
    return {
      ok: false,
      problemas: [{ campo: 'situacao', mensagem: 'Este pedido já foi recusado, cancelado ou concluído.' }],
    };
  const p: ProblemaRegulacaoEntrada[] = [];
  const m = MOTIVOS_CANCELAMENTO_REGULACAO.find((x) => x.codigo === c.motivo) ?? null;
  const complemento = (c.complemento ?? '').trim();
  if (!m) p.push({ campo: 'motivo', mensagem: 'Escolha o motivo do cancelamento.' });
  else if (m.exigeComplemento && complemento.length < COMPLEMENTO_MINIMO)
    p.push({
      campo: 'complemento',
      mensagem: `Detalhe o motivo do cancelamento (mínimo de ${COMPLEMENTO_MINIMO} caracteres).`,
    });
  const estado = c.estadoPedidoLeito;
  const leitoAberto =
    estado !== null && (ESTADOS_PEDIDO_LEITO_CANCELAVEIS as readonly string[]).includes(estado);
  if (estado === 'internado')
    p.push({
      campo: 'pedidoLeito',
      mensagem:
        'O paciente já foi internado pelo pedido de leito: registre a chegada (conclusão), não o cancelamento.',
    });
  else if (estado === 'reservado' || estado === 'em_transito')
    p.push({
      campo: 'pedidoLeito',
      mensagem: 'O pedido de leito ligado tem leito reservado: libere a reserva no NIR antes de cancelar.',
    });
  if (p.length) return { ok: false, problemas: p };
  return {
    ok: true,
    cancelaPedidoLeito: leitoAberto,
    texto: complemento ? `${m!.rotulo}: ${complemento}` : m!.rotulo,
  };
}

export interface ConclusaoRegulacao {
  readonly situacao: string;
  readonly tipo: string;
  readonly chegadaEm: Date;
  readonly reguladoEm: Date | null;
  readonly agora: Date;
  /** A internação em que o paciente entrou (exigida na internação e na transferência). */
  readonly internacao: number | null;
}

export type ResultadoConclusaoRegulacao =
  | { readonly ok: true; readonly texto: string }
  | { readonly ok: false; readonly problemas: readonly ProblemaRegulacaoEntrada[] };

/** A conclusão do pedido aceito: o paciente chegou (na internação e na transferência, ligada à internação). */
export function conferirConclusaoRegulacao(c: ConclusaoRegulacao): ResultadoConclusaoRegulacao {
  if (c.situacao !== 'autorizada')
    return {
      ok: false,
      problemas: [
        { campo: 'situacao', mensagem: 'Só o pedido aceito, ainda aberto, se conclui com a chegada.' },
      ],
    };
  const p: ProblemaRegulacaoEntrada[] = [];
  if (Number.isNaN(c.chegadaEm.getTime()))
    p.push({ campo: 'chegadaEm', mensagem: 'Informe quando o paciente chegou.' });
  else if (c.chegadaEm.getTime() > c.agora.getTime() + TOLERANCIA_FUTURO_MS)
    p.push({ campo: 'chegadaEm', mensagem: 'A chegada não pode estar no futuro.' });
  else if (c.reguladoEm && c.chegadaEm.getTime() < c.reguladoEm.getTime() - TOLERANCIA_FUTURO_MS)
    p.push({ campo: 'chegadaEm', mensagem: 'A chegada não pode ser anterior ao aceite do pedido.' });
  if ((TIPOS_COM_PEDIDO_LEITO as readonly string[]).includes(c.tipo) && c.internacao === null)
    p.push({
      campo: 'internacao',
      mensagem: 'Na internação e na transferência, a chegada se liga à internação do paciente.',
    });
  if (p.length) return { ok: false, problemas: p };
  return {
    ok: true,
    texto: c.internacao !== null ? 'Paciente chegou e foi internado' : 'Paciente chegou ao hospital',
  };
}
