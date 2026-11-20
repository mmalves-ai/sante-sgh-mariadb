// Vocabulário do centro cirúrgico que o novo decide sozinho (POL-1: padrão de mercado como parâmetro; ajustar com a
// resposta da secretaria e da coordenação do bloco, DP-3): motivos codificados do cancelamento e da suspensão (o
// legado não guarda motivo do cancelamento: CCAGENDA_EXC_CANC.JUSTIF vazia em 100%), quem pediu, pendências
// pré-operatórias e os recursos da sala que a agenda marca (as colunas T/F de CCAGENDA: CTI, microscópio,
// intensificador de imagem, furadeira, câmara, vídeo, torre, ortopedia, eletrocautério, UCO, arco, congelação e
// raio X; o rótulo é do novo e a coluna é a do legado).

export interface MotivoCirurgia {
  readonly codigo: string;
  readonly texto: string;
  readonly solicitante: 'paciente' | 'hospital' | 'equipe' | 'convenio';
}

export const MOTIVOS_CANCELAMENTO_CIRURGIA: readonly MotivoCirurgia[] = [
  { codigo: 'PAC-DESISTIU', texto: 'Paciente desistiu da cirurgia', solicitante: 'paciente' },
  { codigo: 'PAC-CLINICO', texto: 'Condição clínica do paciente', solicitante: 'equipe' },
  { codigo: 'PAC-JEJUM', texto: 'Jejum não cumprido', solicitante: 'equipe' },
  { codigo: 'PAC-AUSENTE', texto: 'Paciente não compareceu', solicitante: 'paciente' },
  { codigo: 'EQUIPE-INDISPONIVEL', texto: 'Equipe cirúrgica indisponível', solicitante: 'equipe' },
  { codigo: 'SALA-INDISPONIVEL', texto: 'Sala indisponível', solicitante: 'hospital' },
  { codigo: 'MATERIAL', texto: 'Falta de material ou equipamento', solicitante: 'hospital' },
  { codigo: 'LEITO-UTI', texto: 'Sem leito de UTI reservado', solicitante: 'hospital' },
  { codigo: 'CONV-NAO-AUTORIZOU', texto: 'Convênio não autorizou', solicitante: 'convenio' },
  { codigo: 'URGENCIA', texto: 'Sala cedida a uma urgência', solicitante: 'hospital' },
  { codigo: 'ERRO-AGENDAMENTO', texto: 'Agendamento feito por engano', solicitante: 'hospital' },
  { codigo: 'OUTRO', texto: 'Outro motivo', solicitante: 'hospital' },
];

export function motivoCirurgia(codigo: string): MotivoCirurgia | null {
  return MOTIVOS_CANCELAMENTO_CIRURGIA.find((m) => m.codigo === codigo) ?? null;
}

export const SOLICITANTES_CIRURGIA = ['paciente', 'hospital', 'equipe', 'convenio'] as const;

export const TIPOS_PENDENCIA = [
  { codigo: 'autorizacao', rotulo: 'Autorização do convênio' },
  { codigo: 'apa', rotulo: 'Avaliação pré-anestésica' },
  { codigo: 'termo', rotulo: 'Termo de consentimento' },
  { codigo: 'asa', rotulo: 'Classificação ASA' },
  { codigo: 'jejum', rotulo: 'Orientação de jejum' },
  { codigo: 'exames', rotulo: 'Exames pré-operatórios' },
  { codigo: 'sangue', rotulo: 'Reserva de sangue' },
  { codigo: 'leito-uti', rotulo: 'Leito de UTI' },
] as const;
export type TipoPendencia = (typeof TIPOS_PENDENCIA)[number]['codigo'];

export const SITUACOES_PENDENCIA = [
  { codigo: 'pendente', rotulo: 'Pendente' },
  { codigo: 'ok', rotulo: 'Resolvida' },
  { codigo: 'dispensada', rotulo: 'Dispensada' },
] as const;

/** Recursos da sala marcados no agendamento (coluna T/F do legado → rótulo do novo). */
export const RECURSOS_SALA = [
  { campo: 'cti', coluna: 'CTI', rotulo: 'Vaga de CTI' },
  { campo: 'microscopio', coluna: 'MIC', rotulo: 'Microscópio' },
  { campo: 'imagem', coluna: 'IMA', rotulo: 'Intensificador de imagem' },
  { campo: 'furadeira', coluna: 'FUR', rotulo: 'Furadeira' },
  { campo: 'camara', coluna: 'CAN', rotulo: 'Câmara' },
  { campo: 'video', coluna: 'VID', rotulo: 'Vídeo' },
  { campo: 'torre', coluna: 'TOR', rotulo: 'Torre' },
  { campo: 'ortopedia', coluna: 'ORT', rotulo: 'Material de ortopedia' },
  { campo: 'eletrocauterio', coluna: 'ELE', rotulo: 'Eletrocautério' },
  { campo: 'uco', coluna: 'UCO', rotulo: 'Vaga de unidade coronariana' },
  { campo: 'arco', coluna: 'ARCO', rotulo: 'Arco cirúrgico' },
  { campo: 'congelacao', coluna: 'CONGEL', rotulo: 'Congelação (biópsia)' },
  { campo: 'raioX', coluna: 'RX', rotulo: 'Raio X' },
] as const;
export type RecursoSala = (typeof RECURSOS_SALA)[number]['campo'];

/** Caráter da cirurgia (CCTPURGENCIA na cópia pc: 1 Urgência, 2 Eletiva, 3 Acidente; a tela lê a tabela). */
export const CARATERES_CIRURGIA = [
  { codigo: 2, rotulo: 'Eletiva' },
  { codigo: 1, rotulo: 'Urgência' },
  { codigo: 3, rotulo: 'Acidente' },
] as const;

/** CCAGENDA.ATEND: I paciente internado (820 de 821), E externo. */
export const ATENDIMENTOS_CIRURGIA = [
  { codigo: 'I', rotulo: 'Paciente internado' },
  { codigo: 'E', rotulo: 'Paciente externo' },
] as const;
