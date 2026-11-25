// Pedido de transporte do paciente na alta, na transferência e entre setores (C1-066, 03-PEP linha 125). Regras puras,
// sem banco:
//   - o pedido é conferido antes de gravar: tipo e prioridade válidos, destino coerente com o tipo (interno e retorno
//     vão a um setor do hospital; alta, transferência, exame externo e remoção saem do hospital), a alta ligada a uma
//     internação, origem diferente do destino, previsão não no passado, o paciente que precisa de oxigênio ou de
//     monitorização só com meio de transporte de ambulância, e um pedido em aberto por internação e tipo;
//   - o ciclo do pedido: solicitado → agendado (previsão e meio) → em andamento (saída) → concluído (chegada e retorno),
//     ou cancelado com motivo antes da saída (depois da saída o transporte é concluído, nunca cancelado); nada se apaga;
//   - a fila é ordenada por prioridade (emergência primeiro) e pela previsão.

export const TIPOS_TRANSPORTE = [
  'interno',
  'alta',
  'transferencia_externa',
  'exame_externo',
  'retorno',
  'remocao',
] as const;
export type TipoTransporte = (typeof TIPOS_TRANSPORTE)[number];
export const PRIORIDADES_TRANSPORTE = ['emergencia', 'urgente', 'rotina'] as const;
export type PrioridadeTransporte = (typeof PRIORIDADES_TRANSPORTE)[number];
export const SITUACOES_TRANSPORTE = [
  'solicitado',
  'agendado',
  'em_andamento',
  'concluido',
  'cancelado',
] as const;
export type SituacaoTransporte = (typeof SITUACOES_TRANSPORTE)[number];
export type AcaoTransporte = 'agendar' | 'iniciar' | 'concluir' | 'cancelar';

export interface ProblemaTransporte {
  readonly campo: string;
  readonly mensagem: string;
}

const MS_MIN = 60_000;
/** Tolerância do relógio entre a estação e o servidor. */
const FOLGA_MS = 5 * MS_MIN;

/** Tipos que levam o paciente a um setor do próprio hospital. */
const VAI_A_SETOR: ReadonlySet<TipoTransporte> = new Set(['interno', 'retorno']);

/** Situações em que o pedido ainda está aberto (conta para a fila e para o pedido repetido). */
export const SITUACOES_ABERTAS_TRANSPORTE: readonly SituacaoTransporte[] = [
  'solicitado',
  'agendado',
  'em_andamento',
];

/** Tipo do transporte sugerido pelo destino da alta: a transferência externa vira transferência; o resto, alta. */
export function tipoTransporteDaAlta(destinoAlta: string | null): TipoTransporte {
  return destinoAlta === 'transferencia_externa' ? 'transferencia_externa' : 'alta';
}

export interface PedidoTransporte {
  readonly tipo: string;
  readonly prioridade: string;
  readonly internacao: number | null;
  readonly atendimento: number | null;
  readonly origemSetor: number | null;
  readonly origemDescricao: string | null;
  readonly destinoSetor: number | null;
  readonly destinoExterno: number | null;
  readonly destinoDescricao: string | null;
  readonly requerOxigenio: boolean;
  readonly requerMonitorizacao: boolean;
  /** Nulo quando o meio ainda não foi escolhido; senão, se o meio exige ambulância. */
  readonly meioExigeAmbulancia: boolean | null;
  readonly previsto: Date | null;
  /** Pedidos em aberto da mesma internação e do mesmo tipo (0 na tela, que não sabe; a API conta no banco). */
  readonly abertosMesmoTipo: number;
  readonly agora: Date;
}

const vazio = (s: string | null) => !s || !s.trim();

/** Confere o pedido de transporte antes de gravar (a tela usa a mesma regra para validar na hora). */
export function conferirPedidoTransporte(e: PedidoTransporte): ProblemaTransporte[] {
  const p: ProblemaTransporte[] = [];
  const tipo = (TIPOS_TRANSPORTE as readonly string[]).includes(e.tipo) ? (e.tipo as TipoTransporte) : null;
  if (!tipo) p.push({ campo: 'tipo', mensagem: 'Escolha o tipo do transporte.' });
  if (!(PRIORIDADES_TRANSPORTE as readonly string[]).includes(e.prioridade))
    p.push({ campo: 'prioridade', mensagem: 'Escolha a prioridade do transporte.' });
  if (e.internacao === null && e.atendimento === null)
    p.push({
      campo: 'internacao',
      mensagem: 'O pedido precisa da internação ou do atendimento do paciente.',
    });
  if (tipo === 'alta' && e.internacao === null)
    p.push({ campo: 'internacao', mensagem: 'O transporte da alta é pedido a partir da internação.' });
  const temExterno = e.destinoExterno !== null || !vazio(e.destinoDescricao);
  if (e.destinoSetor === null && !temExterno)
    p.push({ campo: 'destino', mensagem: 'Informe o destino do transporte.' });
  if (tipo && VAI_A_SETOR.has(tipo) && e.destinoSetor === null)
    p.push({
      campo: 'destinoSetor',
      mensagem: 'Este transporte vai a um setor do hospital: escolha o setor.',
    });
  if (tipo && !VAI_A_SETOR.has(tipo) && e.destinoSetor !== null)
    p.push({
      campo: 'destinoSetor',
      mensagem:
        'Este transporte sai do hospital: o destino é um estabelecimento ou um endereço, não um setor.',
    });
  if (tipo && !VAI_A_SETOR.has(tipo) && !temExterno)
    p.push({ campo: 'destinoExterno', mensagem: 'Informe o estabelecimento de destino ou o endereço.' });
  if (e.origemSetor !== null && e.origemSetor === e.destinoSetor)
    p.push({ campo: 'destinoSetor', mensagem: 'A origem e o destino são o mesmo setor.' });
  if (e.origemSetor === null && vazio(e.origemDescricao))
    p.push({ campo: 'origem', mensagem: 'Informe o local de saída do paciente.' });
  if ((e.requerOxigenio || e.requerMonitorizacao) && e.meioExigeAmbulancia === false)
    p.push({
      campo: 'meio',
      mensagem: 'Paciente com oxigênio ou monitorização vai em meio de transporte com ambulância.',
    });
  if (e.previsto && e.previsto.getTime() < e.agora.getTime() - FOLGA_MS)
    p.push({ campo: 'previsto', mensagem: 'A previsão do transporte não pode estar no passado.' });
  if (e.abertosMesmoTipo > 0)
    p.push({
      campo: 'tipo',
      mensagem: 'Já existe um pedido deste tipo em aberto para a internação: atualize o pedido em aberto.',
    });
  return p;
}

export interface AcaoNoTransporte {
  readonly acao: AcaoTransporte;
  readonly situacao: string;
  /** Meio definido (no pedido ou no agendamento) e se ele exige ambulância. */
  readonly meioDefinido: boolean;
  readonly meioExigeAmbulancia: boolean;
  readonly requerOxigenio: boolean;
  readonly requerMonitorizacao: boolean;
  readonly ambulancia: number | null;
  readonly previsto: Date | null;
  readonly saida: Date | null;
  readonly chegada: Date | null;
  readonly retorno: Date | null;
  readonly distanciaKm: number | null;
  readonly motivoCancelamento: number | null;
  readonly agora: Date;
}

const ORIGENS: Record<AcaoTransporte, readonly SituacaoTransporte[]> = {
  agendar: ['solicitado', 'agendado'],
  iniciar: ['solicitado', 'agendado'],
  concluir: ['em_andamento'],
  cancelar: ['solicitado', 'agendado'],
};
const DESTINO: Record<AcaoTransporte, SituacaoTransporte> = {
  agendar: 'agendado',
  iniciar: 'em_andamento',
  concluir: 'concluido',
  cancelar: 'cancelado',
};

/** Confere a ação no pedido e devolve a situação nova (nula quando há problema). */
export function conferirAcaoTransporte(e: AcaoNoTransporte): {
  situacao: SituacaoTransporte | null;
  problemas: ProblemaTransporte[];
} {
  const p: ProblemaTransporte[] = [];
  const futuro = (d: Date | null) => d !== null && d.getTime() > e.agora.getTime() + FOLGA_MS;
  if (!(ORIGENS[e.acao] as readonly string[]).includes(e.situacao)) {
    const msg =
      e.acao === 'cancelar' && e.situacao === 'em_andamento'
        ? 'O transporte já saiu: registre a chegada em vez de cancelar.'
        : `Não dá para ${
            {
              agendar: 'agendar',
              iniciar: 'registrar a saída de',
              concluir: 'concluir',
              cancelar: 'cancelar',
            }[e.acao]
          } um transporte ${e.situacao.replace('_', ' ')}.`;
    return { situacao: null, problemas: [{ campo: 'situacao', mensagem: msg }] };
  }
  if (e.acao === 'agendar') {
    if (!e.previsto) p.push({ campo: 'previsto', mensagem: 'Informe quando o transporte está previsto.' });
    else if (e.previsto.getTime() < e.agora.getTime() - FOLGA_MS)
      p.push({ campo: 'previsto', mensagem: 'A previsão do transporte não pode estar no passado.' });
    if (!e.meioDefinido) p.push({ campo: 'meio', mensagem: 'Escolha o meio de transporte.' });
  }
  if (e.acao === 'agendar' || e.acao === 'iniciar') {
    if ((e.requerOxigenio || e.requerMonitorizacao) && e.meioDefinido && !e.meioExigeAmbulancia)
      p.push({
        campo: 'meio',
        mensagem: 'Paciente com oxigênio ou monitorização vai em meio de transporte com ambulância.',
      });
  }
  if (e.acao === 'iniciar') {
    if (!e.meioDefinido) p.push({ campo: 'meio', mensagem: 'Escolha o meio de transporte antes da saída.' });
    if (e.meioExigeAmbulancia && e.ambulancia === null)
      p.push({ campo: 'ambulancia', mensagem: 'O meio escolhido exige a ambulância: informe o veículo.' });
    if (!e.saida) p.push({ campo: 'saida', mensagem: 'Informe a hora da saída.' });
    else if (futuro(e.saida)) p.push({ campo: 'saida', mensagem: 'A saída não pode estar no futuro.' });
  }
  if (e.acao === 'concluir') {
    if (!e.chegada) p.push({ campo: 'chegada', mensagem: 'Informe a hora da chegada.' });
    else {
      if (futuro(e.chegada)) p.push({ campo: 'chegada', mensagem: 'A chegada não pode estar no futuro.' });
      if (e.saida && e.chegada.getTime() < e.saida.getTime())
        p.push({ campo: 'chegada', mensagem: 'A chegada não pode ser antes da saída.' });
    }
    if (e.retorno) {
      if (futuro(e.retorno)) p.push({ campo: 'retorno', mensagem: 'O retorno não pode estar no futuro.' });
      if (e.chegada && e.retorno.getTime() < e.chegada.getTime())
        p.push({ campo: 'retorno', mensagem: 'O retorno do veículo não pode ser antes da chegada.' });
    }
    if (e.distanciaKm !== null && !(e.distanciaKm >= 0))
      p.push({ campo: 'distanciaKm', mensagem: 'A distância não pode ser negativa.' });
  }
  if (e.acao === 'cancelar' && e.motivoCancelamento === null)
    p.push({ campo: 'motivo', mensagem: 'Escolha o motivo do cancelamento.' });
  return { situacao: p.length ? null : DESTINO[e.acao], problemas: p };
}

const PESO_PRIORIDADE: Record<string, number> = { emergencia: 0, urgente: 1, rotina: 2 };

/** Ordem da fila: prioridade (emergência primeiro), previsão (sem previsão no fim) e o pedido mais antigo. */
export function ordenarFilaTransporte<
  T extends { prioridade: string; previsto: string | null; solicitado: string; id: number },
>(itens: readonly T[]): T[] {
  return [...itens].sort(
    (a, b) =>
      (PESO_PRIORIDADE[a.prioridade] ?? 9) - (PESO_PRIORIDADE[b.prioridade] ?? 9) ||
      (a.previsto ?? '9999').localeCompare(b.previsto ?? '9999') ||
      a.solicitado.localeCompare(b.solicitado) ||
      a.id - b.id,
  );
}
