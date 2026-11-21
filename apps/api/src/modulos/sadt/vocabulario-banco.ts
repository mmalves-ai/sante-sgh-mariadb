// Vocabulário do SADT no banco do cliente: a tradução entre as situações do modelo (exame_item, amostra_biologica,
// setor_diagnostico, modalidade_imagem) e os códigos das telas (setor, ato, estado do exame e da amostra). Puro, sem
// banco: as portas próprias usam, e o teste de unidade confere.
// Melhoria: o estado do exame vem da situação do item pedido e do rastreio da amostra (nada de marcas S/N); o ato da
// tela é derivado do tipo do setor e da modalidade do exame, nunca guardado.
import type { EstadoAmostra, EstadoExame, SetorSadt } from '@sgh/contratos';

/** setor_diagnostico.tipo → setor das telas (null: setor sem tela no SADT). */
export function setorDoTipo(tipo: string): SetorSadt | null {
  switch (tipo) {
    case 'laboratorio':
      return 'laboratorio';
    case 'imagem':
      return 'imagem';
    case 'metodos_graficos':
      return 'metodosGraficos';
    case 'endoscopia':
      return 'endoscopia';
    default:
      return null;
  }
}

/** Setor das telas → tipos de setor_diagnostico. */
export const TIPOS_DO_SETOR: Readonly<Record<SetorSadt, readonly string[]>> = {
  laboratorio: ['laboratorio'],
  imagem: ['imagem'],
  metodosGraficos: ['metodos_graficos'],
  endoscopia: ['endoscopia'],
};

/** Modalidade DICOM (sigla) → ato de imagem das telas. */
const ATO_DA_MODALIDADE: Readonly<Record<string, number>> = {
  CR: 16,
  DX: 16,
  RX: 16,
  MG: 16,
  US: 24,
  CT: 25,
  MR: 26,
};

/** O ato das telas a partir do tipo do setor e da modalidade do exame. */
export function atoDoExame(tipoSetor: string, siglaModalidade: string | null): number {
  switch (tipoSetor) {
    case 'laboratorio':
      return 15;
    case 'endoscopia':
      return 21;
    case 'metodos_graficos':
      return 90;
    case 'imagem':
      return ATO_DA_MODALIDADE[(siglaModalidade ?? '').toUpperCase()] ?? 42;
    default:
      return 42;
  }
}

/** Atos de cada setor (o filtro por ato vira filtro por setor e modalidade). */
export function siglasDoAto(ato: number): readonly string[] | null {
  const s = Object.entries(ATO_DA_MODALIDADE)
    .filter(([, a]) => a === ato)
    .map(([sigla]) => sigla);
  return s.length > 0 ? s : null;
}

/** amostra_biologica.situacao → estado da amostra das telas. */
export function estadoDaAmostra(situacao: string): EstadoAmostra {
  switch (situacao) {
    case 'aguardando_coleta':
      return 'aguardandoColeta';
    case 'coletada':
      return 'coletada';
    case 'em_transporte':
      return 'emTransporte';
    case 'recebida':
    case 'triada':
    case 'aliquotada':
      return 'recebida';
    case 'em_analise':
    case 'analisada':
    case 'armazenada':
      return 'emAnalise';
    case 'cancelada':
      return 'recoleta';
    default:
      return 'rejeitada';
  }
}

/** Estado da amostra das telas → situação no banco (e o evento do rastreio). */
export const SITUACAO_DA_AMOSTRA: Readonly<Record<EstadoAmostra, { situacao: string; evento: string }>> = {
  aguardandoColeta: { situacao: 'aguardando_coleta', evento: 'ocorrencia' },
  coletada: { situacao: 'coletada', evento: 'coletada' },
  emTransporte: { situacao: 'em_transporte', evento: 'enviada' },
  recebida: { situacao: 'recebida', evento: 'recebida' },
  emAnalise: { situacao: 'em_analise', evento: 'em_analise' },
  rejeitada: { situacao: 'rejeitada', evento: 'rejeitada' },
  recoleta: { situacao: 'cancelada', evento: 'cancelada' },
} as Readonly<Record<EstadoAmostra, { situacao: string; evento: string }>>;

/** O estado do exame pela situação do item pedido, pela emissão, pela visualização e pelo rastreio da amostra. */
export function estadoDoItem(m: {
  readonly situacao: string;
  readonly emitido: boolean;
  readonly visualizado: boolean;
  readonly amostra: EstadoAmostra | null;
}): EstadoExame {
  switch (m.situacao) {
    case 'cancelado':
    case 'recusado':
      return 'suspenso';
    case 'liberado':
    case 'entregue':
      if (m.visualizado) return 'visualizado';
      return m.emitido || m.situacao === 'entregue' ? 'emitido' : 'liberado';
    case 'resultado_digitado':
    case 'revisado':
      return 'digitado';
    case 'coletado':
    case 'em_analise':
      // A amostra rejeitada (ou cancelada para recoleta) devolve o exame à coleta.
      if (m.amostra === 'rejeitada' || m.amostra === 'recoleta') return 'solicitado';
      if (m.situacao === 'em_analise') return m.amostra === 'emAnalise' ? 'emAnalise' : 'recebido';
      return m.amostra === 'recebida' ? 'recebido' : m.amostra === 'emAnalise' ? 'emAnalise' : 'coletado';
    default:
      return m.amostra === 'coletada' || m.amostra === 'emTransporte' ? 'coletado' : 'solicitado';
  }
}

/** Filtro de situação das telas → situações de exame_item. */
export const SITUACOES_DO_FILTRO: Readonly<Record<string, readonly string[] | null>> = {
  aReceber: ['solicitado', 'autorizado', 'agendado', 'coletado'],
  recebidos: ['em_analise', 'resultado_digitado', 'revisado', 'liberado', 'entregue'],
  aDigitar: ['em_analise'],
  aLiberar: ['resultado_digitado', 'revisado'],
  liberados: ['liberado', 'entregue'],
  aEmitir: ['liberado'],
  todos: null,
};

/** Situação da mensagem de saída (fila de integração) → entrega do item da lista de trabalho. */
export function entregaDaMensagem(situacao: string): string {
  switch (situacao) {
    case 'pendente':
      return 'pendente';
    case 'enviada':
    case 'processada':
      return 'enviado';
    case 'descartada':
      return 'descartado';
    default:
      return 'morto';
  }
}

/** Status do estudo (contrato) ↔ situação no banco. */
export const SITUACAO_DO_STATUS = {
  'em-andamento': 'em_andamento',
  concluido: 'concluido',
  descontinuado: 'descontinuado',
} as const;
