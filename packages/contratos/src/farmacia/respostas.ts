// Respostas das telas da farmácia (M29; ficha, seções 4 e 7). Paciente só pelo leito, pelo atendimento e pelas
// iniciais nas filas (a tela do prontuário ao lado é a leitura auditada do M15); nenhum documento de pessoa.

export interface UnidadeFarmacia {
  readonly unidade: string;
  readonly nome: string;
  readonly internados: number;
  /** Janela da fila da unidade (horas; parâmetro SGH_). */
  readonly janelaHoras: number;
}

export interface DoseFila {
  readonly horario: number;
  readonly item: number;
  readonly descricao: string;
  readonly previsto: string;
  readonly quantidade: number | null;
  readonly unidadeDose: string | null;
  readonly via: string | null;
  readonly classe: 'alto-risco' | 'antimicrobiano' | 'controlado' | 'comum' | 'material';
  readonly urgente: boolean;
  readonly agora: boolean;
  readonly validada: boolean;
  readonly rastreavel: boolean;
  readonly controlado: string | null;
  /** O motivo de a dose não poder sair agora (política), ou null. */
  readonly bloqueio: string | null;
}

export interface PacienteFila {
  readonly atendimento: number;
  readonly paciente: number;
  readonly leito: string;
  readonly iniciais: string;
  readonly alergia: boolean;
  readonly horarios: readonly { previsto: string; doses: readonly DoseFila[] }[];
}

export interface FilaDispensacao {
  readonly unidade: string;
  readonly inicio: string;
  readonly fim: string;
  readonly total: number;
  readonly cortada: boolean;
  readonly pacientes: readonly PacienteFila[];
}

export interface DispensacaoLida {
  readonly id: number;
  readonly doc: number;
  readonly ano: number;
  readonly mes: number;
  readonly data: string;
  readonly atendimento: number;
  readonly prescricao: number;
  readonly local: number;
  readonly usuario: string;
  readonly itens: number;
  readonly doses: number;
}

export interface DoseDispensadaLida {
  readonly dose: number;
  readonly horario: number | null;
  readonly item: number;
  readonly descricao: string;
  readonly quantidade: number;
  readonly dispensadaEm: string;
  readonly etiquetaEmitida: boolean;
  readonly saida: { id: number; ano: number; mes: number; doc: number } | null;
  readonly lote: string | null;
  readonly validade: string | null;
  readonly situacaoEntrega: number | null;
}

export interface EntregaSetor {
  readonly controle: number;
  readonly situacao: number;
  readonly situacaoNome: string;
  readonly desde: string;
  readonly documento: { id: number; ano: number; mes: number; doc: number } | null;
  readonly atendimento: number;
  readonly leito: string;
  readonly centroCusto: number;
  readonly itens: number;
  readonly usuario: string;
  readonly doses: readonly { dose: number; descricao: string; quantidade: number; serie: string }[];
  readonly aceite: { autor: string; em: string; modo: string } | null;
}

/** O apoio da dispensação: os locais de estoque e os centros de custo com integração. */
export interface ApoioFarmacia {
  readonly locais: readonly { codigo: number; nome: string }[];
  readonly centros: readonly { codigo: number; nome: string }[];
}

/** Um lote com saldo do item no local (a dose rastreável escolhe dele). */
export interface LoteFarmacia {
  readonly id: number;
  readonly lote: string;
  readonly validade: string;
  readonly quantidade: number;
}

/** O recorte da fila de entregas (desde quando ela olha) e os setores do filtro. */
export interface JanelaEntregas {
  readonly desde: string | null;
  readonly setores: readonly { codigo: number; nome: string }[];
}

export interface ItemAvaliacao {
  readonly item: number;
  readonly horario: number | null;
  readonly prescricao: number;
  readonly atendimento: number;
  /** O cadastro do paciente (o prontuário ao lado abre por ele, com a leitura auditada do M15). */
  readonly paciente: number;
  readonly leito: string;
  readonly iniciais: string;
  readonly descricao: string;
  readonly classe: DoseFila['classe'];
  readonly dose: number | null;
  readonly unidadeDose: string | null;
  readonly via: string | null;
  readonly situacao: number | null;
  readonly situacaoNome: string;
  readonly grupo: string | null;
  readonly destino: 'automatica' | 'humana';
  readonly prioridade: number;
  readonly achados: readonly string[];
  readonly estado: 'pendente' | 'decidido' | 'automatico';
  readonly decisao: string | null;
  readonly desde: string;
  readonly intervencoesAbertas: number;
}

export interface FilaAvaliacao {
  readonly resumo: Readonly<Record<string, number>>;
  readonly itens: readonly ItemAvaliacao[];
  readonly cortada: boolean;
}

export interface IntervencaoLida {
  readonly id: number;
  readonly avaliacao: number | null;
  readonly item: number;
  readonly tipo: string;
  readonly texto: string;
  readonly autor: string;
  readonly criadaEm: string;
  readonly estado: 'aberta' | 'respondida';
  readonly resposta: 'aceita' | 'recusada' | null;
  readonly justificativa: string | null;
  readonly respondente: string | null;
  readonly respondidaEm: string | null;
}

export interface SubstituicaoLida {
  readonly id: number;
  readonly horario: number | null;
  readonly item: number;
  readonly descricao: string;
  readonly quantidade: number;
  readonly unidade: string;
  readonly usuario: string;
  readonly em: string;
}

export interface SaldoControlado {
  readonly item: number;
  readonly nome: string;
  readonly lista: string;
  readonly livro: number | null;
  readonly saldoEmpresa: number;
  readonly saldoLocal: number | null;
  readonly anterior: number;
  readonly entradas: number;
  readonly saidas: number;
  readonly final: number;
  readonly conferencias: number;
}

export interface MovimentoControladoLido {
  readonly item: number;
  readonly data: string;
  readonly tipo:
    'entrada' | 'saida' | 'devolucao' | 'perda' | 'transferencia-entrada' | 'transferencia-saida';
  readonly quantidade: number;
  readonly documento: string;
  readonly prescritor: number | null;
  readonly conferido: boolean;
}

export interface ParametrosIntegracaoFarmacia {
  readonly centros: readonly {
    centroCusto: number;
    nome: string;
    tipoPrescricao: number;
    tipoIntegracao: number;
    momento: number;
    tipoEnvioAvaliacao: number;
    tipoEnvioAvaliacaoNome: string;
  }[];
  readonly horarios: readonly { codigo: string; valor: number }[];
  readonly validacaoFarmaceuticaLigada: boolean;
}

export interface TipoEnvioAvaliacao {
  readonly id: number;
  readonly nome: string;
  readonly ativo: boolean;
  readonly centros: number;
}

export interface LivroControladosLido {
  readonly livro: number;
  readonly titulo: string;
  readonly inicio: string;
  readonly fim: string;
  readonly modo: 'conferencia' | 'oficial';
  readonly termoAbertura: string;
  readonly termoEncerramento: string;
  readonly paginas: readonly {
    pagina: number;
    item: number;
    nome: string;
    lista: string;
    anterior: number;
    entradas: number;
    saidas: number;
    final: number;
    movimentos: readonly { data: string; tipo: string; quantidade: number; documento: string }[];
  }[];
  readonly fechado: { em: string; por: string; guardaAte: string; hash: string } | null;
}

export interface DispensacaoAmbulatorialLida {
  readonly id: number;
  readonly paciente: number;
  readonly item: number;
  readonly lote: string;
  readonly quantidade: number;
  readonly em: string;
  readonly escriturada: boolean;
}

export interface ResultadoFarmacia {
  readonly mensagem: string;
  readonly repetida: boolean;
  readonly ids: Readonly<Record<string, number | string>>;
  readonly avisos: readonly string[];
  /** A etiqueta ZPL foi para a fila da impressora (ou a tela oferece o arquivo). */
  readonly etiquetas?: { naFila: boolean; zpl: readonly string[] };
}

export interface GravacaoFarmacia {
  readonly funcionalidades: Readonly<Record<string, { ligada: boolean; motivo: string | null }>>;
  readonly operacoes: Readonly<Record<string, { ligada: boolean; motivo: string | null }>>;
}

export interface WorklistFarmaceutico {
  readonly aValidar: number;
  readonly altoRisco: number;
  readonly antimicrobianos: number;
  readonly intervencoesAbertas: number;
  readonly itens: readonly Pick<
    ItemAvaliacao,
    'item' | 'leito' | 'descricao' | 'prioridade' | 'classe' | 'desde'
  >[];
}

// ── F3.6 (05-SUP linha 7): regras de integração e horários padrão, lidos do banco ─────────────────────────────

export interface RegraIntegracaoLida {
  readonly regra: number;
  readonly versao: number;
  readonly centroCusto: number | null;
  readonly setor: number | null;
  readonly unidade: number | null;
  readonly tipoItem: number | null;
  readonly grupo: number | null;
  readonly subgrupo: number | null;
  readonly item: number | null;
  readonly localAtendente: number;
  readonly localSubstituto: number | null;
  readonly tipoIntegracao: 'requisicao_automatica' | 'dispensacao_direta' | 'sem_integracao';
  readonly momento: 'na_prescricao' | 'na_liberacao_farmaceutica' | 'no_aprazamento' | 'antes_do_horario';
  readonly antecedenciaMinutos: number | null;
  readonly forma: 'dose_individualizada' | 'dose_unitaria' | 'dose_coletiva' | 'kit';
  readonly geraManipulacao: boolean;
  readonly prioridade: number;
  readonly ativo: boolean;
  /** O escopo e o local em texto, para a lista. */
  readonly escopoNome: string;
  readonly localNome: string;
}

export interface GradeHorarioPadrao {
  readonly frequencia: number;
  readonly frequenciaNome: string;
  readonly dosesPorDia: number | null;
  readonly setor: number | null;
  readonly setorNome: string | null;
  readonly horarios: readonly { hora: string; dias: readonly number[] }[];
}

export interface OpcaoParametro {
  readonly id: number;
  readonly nome: string;
  readonly dosesPorDia?: number | null;
}

export interface ParametrosIntegracaoEditaveis {
  readonly regras: readonly RegraIntegracaoLida[];
  readonly grades: readonly GradeHorarioPadrao[];
  readonly opcoes: {
    readonly centros: readonly OpcaoParametro[];
    readonly setores: readonly OpcaoParametro[];
    readonly unidades: readonly OpcaoParametro[];
    readonly locais: readonly OpcaoParametro[];
    readonly tiposItem: readonly OpcaoParametro[];
    readonly grupos: readonly OpcaoParametro[];
    readonly frequencias: readonly OpcaoParametro[];
  };
}
