// Comunicação com o paciente pela Hal-AI (F3.9, linha 08-INTG L133), parte dos EVENTOS: o disparo automático do pedido
// pelos acontecimentos do hospital (marcação criada, véspera da marcação, resultado liberado, alta), o efeito da
// resposta interpretada na marcação ligada e a conferência da credencial da Hal-AI. Tudo puro: a porta lê e grava.
import type { GatilhoEnvio, RespostaInterpretada } from './mensagens-paciente.js';

/** O escopo que a credencial da Hal-AI precisa para ler os pendentes e devolver o "enviado" e os retornos. */
export const ESCOPO_MENSAGENS_PACIENTE = 'mensagem.paciente';

/** A entidade de cada evento (gravada no pedido para o efeito da resposta e para não pedir duas vezes). */
export const ENTIDADE_DO_EVENTO = {
  marcacao: 'marcacao_horario',
  resultado: 'resultado_exame',
  alta: 'alta_hospitalar',
} as const;
export type TipoEvento = keyof typeof ENTIDADE_DO_EVENTO;

/** Um acontecimento lido do banco que pode gerar aviso ao paciente. */
export interface EventoMensagem {
  readonly tipo: TipoEvento;
  readonly entidadeId: number;
  readonly pacienteId: number;
  /** Quando aconteceu (marcação feita, resultado liberado, alta). */
  readonly ocorridoEm: Date;
  /** O horário do evento futuro (o início da consulta); nulo no resultado e na alta. */
  readonly referenciaEm: Date | null;
  /** Os valores do modelo já montados (data, hora, profissional, serviço, local, paciente_nome). */
  readonly valores: Readonly<Record<string, string>>;
}

export interface RegraParaDisparo {
  readonly id: number;
  readonly gatilho: GatilhoEnvio;
  readonly antecedenciaMinutos: number | null;
}

export interface PedidoDeEvento {
  readonly regraId: number;
  readonly pacienteId: number;
  readonly entidade: string;
  readonly entidadeId: number;
  readonly referenciaEm: Date | null;
  readonly valores: Readonly<Record<string, string>>;
}

/** Que evento cada gatilho automático acompanha (os outros gatilhos são manuais ou de campanha). */
export const EVENTO_DO_GATILHO: Readonly<Partial<Record<GatilhoEnvio, TipoEvento>>> = {
  agendamento_criado: 'marcacao',
  lembrete_agendamento: 'marcacao',
  confirmacao_agendamento: 'marcacao',
  resultado_liberado: 'resultado',
  alta: 'alta',
};

/** Quanto tempo depois do acontecimento ainda vale avisar (marcação criada, resultado e alta): 2 dias. */
export const PRAZO_AVISO_EVENTO_MIN = 2 * 24 * 60;
/** Lembrete e confirmação só são pedidos quando faltam até 3 dias (a marcação ainda pode mudar antes disso). */
export const HORIZONTE_VESPERA_MIN = 3 * 24 * 60;

const MIN = 60_000;

/**
 * Os pedidos que os eventos geram: para cada regra ativa de gatilho automático, cada evento do tipo dela ainda dentro do
 * prazo, que ainda não tem pedido da mesma regra para a mesma entidade (`jaPedidos` traz "regra:entidade:id").
 * - marcação criada, resultado liberado e alta: o evento aconteceu há no máximo 2 dias e não está no futuro;
 * - lembrete e confirmação: a consulta é futura e começa em até 3 dias mais a antecedência da regra (a véspera).
 */
export function pedidosDosEventos(
  regras: readonly RegraParaDisparo[],
  eventos: readonly EventoMensagem[],
  jaPedidos: ReadonlySet<string>,
  agora: Date,
): PedidoDeEvento[] {
  const out: PedidoDeEvento[] = [];
  const t = agora.getTime();
  for (const r of regras) {
    const tipo = EVENTO_DO_GATILHO[r.gatilho];
    if (!tipo) continue;
    const entidade = ENTIDADE_DO_EVENTO[tipo];
    const vespera = r.gatilho === 'lembrete_agendamento' || r.gatilho === 'confirmacao_agendamento';
    for (const e of eventos) {
      if (e.tipo !== tipo) continue;
      if (jaPedidos.has(`${r.id}:${entidade}:${e.entidadeId}`)) continue;
      if (vespera) {
        if (!e.referenciaEm) continue;
        const falta = (e.referenciaEm.getTime() - t) / MIN;
        if (falta <= 0 || falta > HORIZONTE_VESPERA_MIN + Math.max(0, r.antecedenciaMinutos ?? 0)) continue;
      } else {
        const desde = (t - e.ocorridoEm.getTime()) / MIN;
        if (desde < 0 || desde > PRAZO_AVISO_EVENTO_MIN) continue;
        // A marcação criada para uma consulta que já passou não gera aviso.
        if (e.referenciaEm && e.referenciaEm.getTime() <= t) continue;
      }
      out.push({
        regraId: r.id,
        pacienteId: e.pacienteId,
        entidade,
        entidadeId: e.entidadeId,
        // O aviso do acontecimento sai já (no horário de envio); só a véspera conta a partir da consulta.
        referenciaEm: vespera ? e.referenciaEm : null,
        valores: e.valores,
      });
    }
  }
  return out;
}

export type EfeitoResposta =
  | { readonly acao: 'confirmar_presenca' }
  | { readonly acao: 'pedir_cancelamento' | 'pedir_reagendamento'; readonly observacao: string }
  | { readonly acao: 'nenhum'; readonly motivo: string };

/**
 * O efeito da resposta interpretada na marcação ligada ao pedido. A resposta do paciente nunca cancela nem remarca
 * sozinha (a vaga e a remarcação são decisão da equipe da agenda): ela confirma a presença da marcação aguardando ou
 * abre o pedido de cancelamento ou de reagendamento (confirmação recusada com a observação), para a equipe tratar.
 */
export function efeitoDaResposta(p: {
  readonly entidade: string | null;
  readonly interpretada: RespostaInterpretada | null;
  /** O significado da situação atual da marcação (aguardando, confirmada, cancelada...). */
  readonly significadoMarcacao: string | null;
  readonly consultaJaPassou: boolean;
}): EfeitoResposta {
  if (p.entidade !== ENTIDADE_DO_EVENTO.marcacao)
    return { acao: 'nenhum', motivo: 'O pedido não é de uma marcação.' };
  if (!p.interpretada || p.interpretada === 'outro')
    return { acao: 'nenhum', motivo: 'A resposta não foi reconhecida: fica para a equipe ler.' };
  if (p.significadoMarcacao === null) return { acao: 'nenhum', motivo: 'A marcação não existe mais.' };
  if (p.consultaJaPassou) return { acao: 'nenhum', motivo: 'A consulta já passou.' };
  if (!['aguardando', 'confirmada'].includes(p.significadoMarcacao))
    return { acao: 'nenhum', motivo: 'A marcação já tem outra situação.' };
  if (p.interpretada === 'confirmado')
    return p.significadoMarcacao === 'aguardando'
      ? { acao: 'confirmar_presenca' }
      : { acao: 'nenhum', motivo: 'A marcação já estava confirmada.' };
  return p.interpretada === 'cancelado'
    ? { acao: 'pedir_cancelamento', observacao: 'Paciente pediu o cancelamento pela mensagem.' }
    : { acao: 'pedir_reagendamento', observacao: 'Paciente pediu para remarcar pela mensagem.' };
}

export interface CredencialMensageria {
  readonly categoriaSistema: string | null;
  readonly sistemaAtivo: boolean;
  readonly situacaoCliente: string;
  readonly restritoA: number | null;
  readonly estabelecimento: number;
  readonly usuarioTecnico: number | null;
  readonly escopos: readonly string[];
}

/** A credencial da Hal-AI: cliente da API ativo de um sistema de mensageria, no estabelecimento, com usuário técnico. */
export function conferirCredencialMensageria(
  c: CredencialMensageria,
): { campo: string; codigo: string; mensagem: string }[] {
  const e: { campo: string; codigo: string; mensagem: string }[] = [];
  const erro = (codigo: string, mensagem: string) => e.push({ campo: 'credencial', codigo, mensagem });
  if (c.categoriaSistema !== 'mensageria' || !c.sistemaAtivo)
    erro('nao-e-mensageria', 'A credencial não é de um sistema de mensageria ativo.');
  if (c.situacaoCliente !== 'ativo') erro('credencial-inativa', 'A credencial não está ativa.');
  if (c.restritoA !== null && c.restritoA !== c.estabelecimento)
    erro('outro-estabelecimento', 'A credencial não vale neste estabelecimento.');
  if (c.usuarioTecnico === null)
    erro('sem-usuario-tecnico', 'A credencial não tem o usuário técnico que assina a trilha.');
  if (!c.escopos.includes(ESCOPO_MENSAGENS_PACIENTE))
    erro('fora-do-escopo', `A credencial não tem o escopo ${ESCOPO_MENSAGENS_PACIENTE}.`);
  return e;
}
