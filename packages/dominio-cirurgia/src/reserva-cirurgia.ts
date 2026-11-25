// Reserva de equipamentos e hemocomponentes para a cirurgia (F8, 04-CC linha 103). Ao montar o pedido da cirurgia, o
// bloco reserva os equipamentos (arco cirúrgico, microscópio, torre de vídeo) no horário da cirurgia e o sangue que a
// equipe quer disponível. Regras puras:
//   - o período padrão da reserva é a janela da própria cirurgia (início e duração previstos): zero digitação;
//   - um equipamento não fica reservado para duas cirurgias que se cruzam no tempo (qualquer sala): o conflito é
//     recusado com o número das cirurgias que já o ocupam;
//   - o hemocomponente pedido nasce com a prova cruzada solicitada quando o tipo a exige (ou dispensada), e se liga ao
//     item da requisição transfusional do mesmo paciente e do mesmo tipo de hemocomponente, que a agência atende;
//   - nada se apaga: a reserva desfeita fica com a situação cancelada;
//   - a cirurgia cancelada, suspensa, reprovada ou realizada não prende mais o equipamento (a ocupação dela não conta
//     no conflito), e a reserva aberta da cirurgia cancelada, suspensa ou reprovada pode ser liberada (cancelada);
//   - o item da requisição transfusional atende uma reserva vigente só: a mesma bolsa não conta duas vezes, e a
//     reserva já ligada não troca de item;
//   - ligada, a reserva só passa a "reservada" com ao menos uma bolsa liberada pela agência.
// A porta reconfere tudo no banco, com o equipamento travado na transação (duas reservas simultâneas passam uma de
// cada vez).
import { listaMaterialAberta } from './kit-agendamento.js';
import { instanteValido, minutosAbsolutos, somarMinutos } from './tempo.js';

export interface ProblemaReservaCirurgia {
  readonly campo: string;
  readonly mensagem: string;
}

/** Situações da reserva de equipamento que ocupam o equipamento no período. */
export const SITUACOES_EQUIPAMENTO_OCUPADO = ['reservado', 'confirmado', 'em_uso'] as const;
/** Situações em que a reserva de equipamento ainda pode ser cancelada (antes do uso). */
export const SITUACOES_EQUIPAMENTO_CANCELAVEL = ['reservado', 'confirmado'] as const;
/** Situações da reserva de hemocomponente que ainda podem ser ligadas à requisição ou canceladas. */
export const SITUACOES_HEMOCOMPONENTE_ABERTA = ['solicitada', 'reservada'] as const;
/** Situações da cirurgia que soltam o equipamento: a reserva dela não ocupa mais o horário. */
export const SITUACOES_AGENDAMENTO_SOLTA_RESERVA = [
  'cancelado',
  'suspenso',
  'reprovado',
  'realizado',
] as const;
/** Situações da cirurgia em que a reserva ainda aberta pode ser liberada (a cirurgia não vai acontecer como marcada). */
export const SITUACOES_AGENDAMENTO_LIBERA_RESERVA = ['cancelado', 'suspenso', 'reprovado'] as const;
/** Duração máxima de uma reserva de equipamento (uma cirurgia longa cabe; um dia inteiro não). */
export const RESERVA_EQUIPAMENTO_MAXIMA_MINUTOS = 24 * 60;
export const QUANTIDADE_MAXIMA_EQUIPAMENTO = 20;
export const QUANTIDADE_MAXIMA_BOLSAS = 20;

const inclui = (lista: readonly string[], v: string) => lista.includes(v);

/** O período da cirurgia ("AAAA-MM-DD HH:MM"), padrão da reserva; sem início ou duração previstos, null. */
export function periodoDaCirurgia(
  inicio: string | null,
  duracaoMin: number | null,
): { readonly inicio: string; readonly fim: string } | null {
  if (!inicio || !instanteValido(inicio) || !duracaoMin || duracaoMin <= 0) return null;
  return { inicio, fim: somarMinutos(inicio, duracaoMin) };
}

/** Uma reserva vigente de outro agendamento sobre o mesmo equipamento. */
export interface OcupacaoEquipamento {
  readonly agendamento: number;
  readonly numero: string;
  readonly inicio: string;
  readonly fim: string;
  readonly situacao: string;
  /** Situação da cirurgia dona da reserva; cancelada, suspensa, reprovada ou realizada não ocupa. */
  readonly situacaoAgendamento?: string;
}

/** Se a reserva aberta pode ser cancelada: com as reservas abertas ou para liberar a cirurgia que não vai acontecer. */
export function reservaLiberavel(situacaoAgendamento: string): boolean {
  return (
    listaMaterialAberta(situacaoAgendamento) ||
    inclui(SITUACOES_AGENDAMENTO_LIBERA_RESERVA, situacaoAgendamento)
  );
}

/** As ocupações de outras cirurgias que cruzam o período pedido (só as que ocupam o equipamento). */
export function conflitosEquipamento(
  agendamento: number,
  periodo: { readonly inicio: string; readonly fim: string },
  ocupacoes: readonly OcupacaoEquipamento[],
): OcupacaoEquipamento[] {
  const de = minutosAbsolutos(periodo.inicio);
  const ate = minutosAbsolutos(periodo.fim);
  return ocupacoes.filter(
    (o) =>
      o.agendamento !== agendamento &&
      inclui(SITUACOES_EQUIPAMENTO_OCUPADO, o.situacao) &&
      !inclui(SITUACOES_AGENDAMENTO_SOLTA_RESERVA, o.situacaoAgendamento ?? '') &&
      minutosAbsolutos(o.inicio) < ate &&
      de < minutosAbsolutos(o.fim),
  );
}

export interface EntradaReservaEquipamento {
  readonly inicio: string;
  readonly fim: string;
  readonly quantidade: number;
}

/** As recusas da reserva de equipamento (vazio: pode gravar). */
export function conferirReservaEquipamento(
  agendamento: { readonly id: number; readonly situacao: string },
  entrada: EntradaReservaEquipamento,
  equipamento: { readonly situacao: string } | null,
  ocupacoes: readonly OcupacaoEquipamento[],
): ProblemaReservaCirurgia[] {
  const p: ProblemaReservaCirurgia[] = [];
  if (!listaMaterialAberta(agendamento.situacao))
    p.push({
      campo: 'situacao',
      mensagem:
        'As reservas desta cirurgia estão fechadas: a cirurgia já começou, terminou ou foi cancelada.',
    });
  if (!equipamento) p.push({ campo: 'equipamento', mensagem: 'Equipamento não encontrado neste hospital.' });
  else if (equipamento.situacao === 'desativado')
    p.push({ campo: 'equipamento', mensagem: 'O equipamento está desativado e não pode ser reservado.' });
  if (
    !Number.isInteger(entrada.quantidade) ||
    entrada.quantidade < 1 ||
    entrada.quantidade > QUANTIDADE_MAXIMA_EQUIPAMENTO
  )
    p.push({
      campo: 'quantidade',
      mensagem: `A quantidade vai de 1 a ${QUANTIDADE_MAXIMA_EQUIPAMENTO}.`,
    });
  if (!instanteValido(entrada.inicio) || !instanteValido(entrada.fim)) {
    p.push({ campo: 'inicio', mensagem: 'Informe o início e o fim da reserva (data e hora).' });
    return p;
  }
  const minutos = minutosAbsolutos(entrada.fim) - minutosAbsolutos(entrada.inicio);
  if (minutos <= 0) p.push({ campo: 'fim', mensagem: 'O fim da reserva tem de ser depois do início.' });
  else if (minutos > RESERVA_EQUIPAMENTO_MAXIMA_MINUTOS)
    p.push({ campo: 'fim', mensagem: 'A reserva de equipamento vai até 24 horas.' });
  if (minutos > 0 && equipamento) {
    const conflitos = conflitosEquipamento(agendamento.id, entrada, ocupacoes);
    if (conflitos.length)
      p.push({
        campo: 'equipamento',
        mensagem: `O equipamento já está reservado nesse horário para a cirurgia ${conflitos
          .map((c) => `${c.numero} (${c.inicio} a ${c.fim.slice(11)})`)
          .join(', ')}.`,
      });
  }
  return p;
}

/** As recusas do cancelamento da reserva de equipamento. */
export function conferirCancelamentoEquipamento(
  situacaoAgendamento: string,
  situacaoReserva: string,
): ProblemaReservaCirurgia[] {
  const p: ProblemaReservaCirurgia[] = [];
  if (!reservaLiberavel(situacaoAgendamento))
    p.push({ campo: 'situacao', mensagem: 'As reservas desta cirurgia estão fechadas.' });
  if (!inclui(SITUACOES_EQUIPAMENTO_CANCELAVEL, situacaoReserva))
    p.push({ campo: 'reserva', mensagem: 'Só a reserva ainda não usada pode ser cancelada.' });
  return p;
}

/** A prova cruzada nasce pedida quando o tipo de hemocomponente a exige; senão, dispensada. */
export function provaCruzadaInicial(exigeProva: boolean): 'solicitada' | 'dispensada' {
  return exigeProva ? 'solicitada' : 'dispensada';
}

/** As recusas do pedido de hemocomponente para a cirurgia. */
export function conferirReservaHemocomponente(
  situacaoAgendamento: string,
  quantidade: number,
  hemocomponente: { readonly ativo: boolean } | null,
): ProblemaReservaCirurgia[] {
  const p: ProblemaReservaCirurgia[] = [];
  if (!listaMaterialAberta(situacaoAgendamento))
    p.push({
      campo: 'situacao',
      mensagem:
        'As reservas desta cirurgia estão fechadas: a cirurgia já começou, terminou ou foi cancelada.',
    });
  if (!hemocomponente) p.push({ campo: 'hemocomponente', mensagem: 'Hemocomponente não encontrado.' });
  else if (!hemocomponente.ativo)
    p.push({ campo: 'hemocomponente', mensagem: 'O hemocomponente está fora de uso.' });
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > QUANTIDADE_MAXIMA_BOLSAS)
    p.push({ campo: 'quantidade', mensagem: `A quantidade vai de 1 a ${QUANTIDADE_MAXIMA_BOLSAS} bolsas.` });
  return p;
}

/** O item da requisição transfusional como o vínculo o confere. */
export interface ItemRequisicaoParaReserva {
  readonly hemocomponente: number;
  readonly paciente: number;
  /** Cirurgia à qual a requisição já está ligada (null: requisição sem cirurgia). */
  readonly agendamento: number | null;
  readonly situacaoRequisicao: string;
  readonly situacaoItem: string;
  readonly quantidadeBolsas: number;
  readonly quantidadeAtendida: number;
}

/** As recusas do vínculo da reserva de hemocomponente com o item da requisição transfusional. */
export function conferirVinculoRequisicao(
  agendamento: { readonly id: number; readonly paciente: number; readonly situacao: string },
  reserva: {
    readonly hemocomponente: number;
    readonly situacao: string;
    /** Item da requisição já ligado a esta reserva (null: ainda sem vínculo). */
    readonly requisicaoItem?: number | null;
  },
  item: ItemRequisicaoParaReserva | null,
  /** Quantas outras reservas vigentes (solicitada ou reservada) já estão ligadas a este item. */
  outrasReservasDoItem = 0,
): ProblemaReservaCirurgia[] {
  const p: ProblemaReservaCirurgia[] = [];
  if (!listaMaterialAberta(agendamento.situacao))
    p.push({ campo: 'situacao', mensagem: 'As reservas desta cirurgia estão fechadas.' });
  if (!inclui(SITUACOES_HEMOCOMPONENTE_ABERTA, reserva.situacao))
    p.push({ campo: 'reserva', mensagem: 'A reserva já foi usada, devolvida ou cancelada.' });
  if (reserva.requisicaoItem != null)
    p.push({
      campo: 'reserva',
      mensagem: 'A reserva já está ligada a um item da requisição transfusional: cancele e peça de novo.',
    });
  if (!item) {
    p.push({
      campo: 'requisicao',
      mensagem: 'Item da requisição transfusional não encontrado neste hospital.',
    });
    return p;
  }
  if (item.paciente !== agendamento.paciente)
    p.push({ campo: 'requisicao', mensagem: 'A requisição transfusional é de outro paciente.' });
  if (item.agendamento !== null && item.agendamento !== agendamento.id)
    p.push({ campo: 'requisicao', mensagem: 'A requisição transfusional já é de outra cirurgia.' });
  if (item.hemocomponente !== reserva.hemocomponente)
    p.push({
      campo: 'requisicao',
      mensagem: 'O item da requisição é de outro tipo de hemocomponente.',
    });
  if (item.situacaoRequisicao === 'cancelada' || item.situacaoItem === 'cancelado')
    p.push({ campo: 'requisicao', mensagem: 'A requisição transfusional foi cancelada.' });
  if (outrasReservasDoItem > 0)
    p.push({
      campo: 'requisicao',
      mensagem:
        'Este item da requisição já atende outra reserva de hemocomponente: as bolsas não contam duas vezes.',
    });
  return p;
}

/**
 * Ligada à requisição, a reserva guarda as bolsas que a agência já liberou (até o pedido) e só passa a "reservada"
 * com ao menos uma bolsa; sem bolsa liberada, segue "solicitada" (o vínculo fica gravado).
 */
export function reservaPeloVinculo(
  quantidadeSolicitada: number,
  item: Pick<ItemRequisicaoParaReserva, 'quantidadeAtendida'>,
): { readonly situacao: 'solicitada' | 'reservada'; readonly quantidadeReservada: number } {
  const quantidadeReservada = Math.max(0, Math.min(quantidadeSolicitada, item.quantidadeAtendida));
  return { situacao: quantidadeReservada > 0 ? 'reservada' : 'solicitada', quantidadeReservada };
}

/** As recusas do cancelamento da reserva de hemocomponente. */
export function conferirCancelamentoHemocomponente(
  situacaoAgendamento: string,
  situacaoReserva: string,
): ProblemaReservaCirurgia[] {
  const p: ProblemaReservaCirurgia[] = [];
  if (!reservaLiberavel(situacaoAgendamento))
    p.push({ campo: 'situacao', mensagem: 'As reservas desta cirurgia estão fechadas.' });
  if (!inclui(SITUACOES_HEMOCOMPONENTE_ABERTA, situacaoReserva))
    p.push({ campo: 'reserva', mensagem: 'A reserva já foi usada, devolvida ou cancelada.' });
  return p;
}
