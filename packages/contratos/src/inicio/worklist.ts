// Página inicial por perfil e as filas de trabalho do M27 (ficha, seções 4 e 7; regras 1 a 5): a casca escolhe o
// perfil ativo de quem acumula; cada componente exige a permissão do módulo de origem e a funcionalidade ligada no
// estabelecimento (SGH_CFG_LIBERACAO; recolher o módulo esconde o componente). As worklists só leem: as ações são as
// telas dos módulos de origem (prontuário, prescrição, resultados, recepção, atendimento).
import type { SituacaoAlergias } from '../pep/documentos.js';
import type { PrioridadeSenha } from '../recepcao/vocabulario.js';

// ── Componentes da página inicial ─────────────────────────────────────────────────────────────────────

export const COMPONENTES_INICIO = [
  'medico',
  'recepcao',
  'enfermagem',
  'higienizacao',
  'assinaturas',
  'mensagens',
  'pa',
  'nir',
  'nutricao',
  'qualidade',
  'ccih',
  'agravos',
] as const;
export type ComponenteInicio = (typeof COMPONENTES_INICIO)[number];

export interface DefinicaoComponenteInicio {
  readonly id: ComponenteInicio;
  readonly titulo: string;
  /** Rota da fila (a tela do componente). */
  readonly rota: string;
  /** Permissão de leitura do módulo de origem. */
  readonly permissao: string;
  /** Chaves de liberação (tipo `recurso`) que precisam estar ligadas: a do componente e a do módulo de origem. */
  readonly chaves: readonly string[];
  /** Marco que entrega a fila (enfermagem e higienização: M25 e M21). */
  readonly marco: string;
  /** Ordem padrão (menor primeiro) quando o perfil não diz outra coisa. */
  readonly ordem: number;
  /** A fila existe (marco entregue). Falso: o componente não aparece (regra 1). */
  readonly entregue: boolean;
}

/** Chaves de liberação próprias dos componentes da página inicial (ficha, seção 12). */
export const CHAVES_INICIO = {
  medico: 'inicio.worklistMedico',
  recepcao: 'inicio.worklistRecepcao',
  avisos: 'inicio.avisos',
  mensagens: 'inicio.mensagens',
  dicionario: 'inicio.dicionario',
} as const;

export const DEFINICOES_COMPONENTES_INICIO: readonly DefinicaoComponenteInicio[] = [
  {
    id: 'medico',
    titulo: 'Médico: meus pacientes',
    rota: '/inicio/medico',
    permissao: 'pep.worklist.ler',
    chaves: [CHAVES_INICIO.medico],
    marco: 'M27',
    ordem: 10,
    entregue: true,
  },
  {
    id: 'recepcao',
    titulo: 'Recepção: senhas e guias pendentes',
    rota: '/inicio/recepcao',
    permissao: 'recepcao.worklist.ler',
    chaves: [CHAVES_INICIO.recepcao],
    marco: 'M27',
    ordem: 20,
    entregue: true,
  },
  {
    id: 'enfermagem',
    titulo: 'Enfermagem: linha do tempo do turno',
    rota: '/inicio/enfermagem',
    permissao: 'pep.checagem.ler',
    chaves: [],
    marco: 'M25',
    ordem: 30,
    entregue: false,
  },
  {
    id: 'higienizacao',
    titulo: 'Higienização: fila por prazo',
    rota: '/m/higienizacao',
    permissao: 'hotelaria.limpeza.executar',
    chaves: ['hotelaria.limpeza'],
    marco: 'M21',
    ordem: 40,
    entregue: true,
  },
  {
    id: 'assinaturas',
    titulo: 'Pendências de assinatura',
    rota: '/inicio/assinaturas',
    permissao: 'documento.documento.ler',
    chaves: [],
    marco: 'M23',
    ordem: 50,
    entregue: true,
  },
  {
    id: 'mensagens',
    titulo: 'Mensagens internas e avisos',
    rota: '/mensagens',
    permissao: 'acesso.mensagem.ler',
    chaves: [CHAVES_INICIO.mensagens],
    marco: 'M27',
    ordem: 60,
    entregue: true,
  },
  // M44 (etapa 3; ficha, seção 7): os dois cartões da fila de trabalho. O do PA abre o quadro com a cor (o resumo: os
  // classificados com o prazo vencido e os aguardando a classificação); o do NIR abre a fila (solicitações abertas,
  // prazos estourados, conflitos e barreiras de alta vencidas). Cada um exige a permissão e a chave do módulo de origem.
  {
    id: 'pa',
    titulo: 'PA: quadro de acompanhamento por cor de risco',
    rota: '/pa/quadro',
    permissao: 'pa.quadro.ler',
    chaves: ['pa.classificacao'],
    marco: 'M44',
    ordem: 15,
    entregue: true,
  },
  {
    id: 'nir',
    titulo: 'NIR: solicitações de leito e barreiras de alta',
    rota: '/internacao/nir/fila',
    permissao: 'internacao.solicitacaoLeito.ler',
    chaves: ['nir'],
    marco: 'M44',
    ordem: 25,
    entregue: true,
  },
  // M45 (etapa 5; ficha, seção 7): o cartão da nutrição abre a fila de pacientes a triar (vencidos em vermelho, os de
  // atenção e as reavaliações) e leva ao mapa de dietas; exige a permissão da fila e a chave da nutrição.
  {
    id: 'nutricao',
    titulo: 'Nutrição: pacientes a triar e mapa de dietas',
    rota: '/nutricao/triagem',
    permissao: 'pep.nutricao.ler',
    chaves: ['nutricao'],
    marco: 'M45',
    ordem: 35,
    entregue: true,
  },
  // M48 (etapa 1; ficha, seção 7): o cartão do NSP com as notificações por prazo regulatório (vencidos, que vencem em
  // breve e no prazo), que abre a fila de prazos e a exportação Notivisa; exige a permissão e a chave da notificação.
  {
    id: 'qualidade',
    titulo: 'Qualidade: notificações por prazo regulatório',
    rota: '/qualidade/nsp/prazos',
    permissao: 'qualidade.notivisa.exportar',
    chaves: ['qualidade.notificacao'],
    marco: 'M48',
    ordem: 40,
    entregue: true,
  },
  // M48 (etapa 3; ficha, seção 7): o cartão da CCIH com os pacientes em vigilância (e os restritos sem liberação), que
  // abre a vigilância ativa; exige a permissão e a chave da CCIH. O resumo traz só contagens (sem nome de paciente).
  {
    id: 'ccih',
    titulo: 'CCIH: pacientes em vigilância',
    rota: '/qualidade/ccih/vigilancia',
    permissao: 'qualidade.ccih.ler',
    chaves: ['qualidade.ccih'],
    marco: 'M48',
    ordem: 45,
    entregue: true,
  },
  // M48 (etapa 4; ficha, seção 7): o cartão da notificação compulsória com os casos aguardando notificação, os vencidos e
  // as sugestões sem caso, que abre a fila da vigilância; exige a permissão e a chave. O resumo traz só contagens.
  {
    id: 'agravos',
    titulo: 'Vigilância: notificação compulsória',
    rota: '/qualidade/vigilancia/agravos',
    permissao: 'qualidade.agravo.ler',
    chaves: ['qualidade.agravos'],
    marco: 'M48',
    ordem: 46,
    entregue: true,
  },
];

/** O componente na resposta de GET /api/acesso/inicio: o que a sessão pode ver e o resumo da fila. */
export interface ComponenteDaInicio {
  readonly id: ComponenteInicio;
  readonly titulo: string;
  readonly rota: string;
  /** Itens pendentes (para o selo); null quando a fila não informa. */
  readonly pendentes: number | null;
  /** Prioridade do topo da fila (maior = mais urgente) e o prazo mais próximo (ISO local). */
  readonly prioridade: number;
  readonly prazo: string | null;
}

export interface PaginaInicio {
  /** Perfis de trabalho da sessão (quem acumula escolhe o ativo). */
  readonly perfis: readonly { id: ComponenteInicio; titulo: string }[];
  readonly componentes: readonly ComponenteDaInicio[];
}

// ── Worklist do médico ───────────────────────────────────────────────────────────────────────────────────

export const TIPOS_PENDENCIA_MEDICO = [
  'critico-nao-visto',
  'sem-evolucao-24h',
  'prescricao-a-renovar',
  'parecer-atrasado',
  'resultado-novo',
  'assinatura-pendente',
  'parecer-pendente',
] as const;
export type TipoPendenciaMedico = (typeof TIPOS_PENDENCIA_MEDICO)[number];

export interface PendenciaMedico {
  readonly tipo: TipoPendenciaMedico;
  readonly quantidade: number;
  /** Prazo (ISO local), quando a pendência tem (a prescrição vence; o parecer tem prazo). */
  readonly prazo: string | null;
  readonly texto: string;
  /** Tela que resolve (o prontuário do paciente na aba certa). */
  readonly link: string;
}

export interface LinhaWorklistMedico {
  readonly paciente: number;
  readonly nome: string;
  readonly idade: string | null;
  readonly sexo: string | null;
  readonly prontuario: string;
  readonly atendimento: number;
  readonly registro: number;
  readonly tipo: 'internacao' | 'externo' | 'urgencia';
  readonly unidade: string | null;
  readonly leito: string | null;
  readonly dias: number | null;
  /** Previsão de alta registrada na internação (DPA), quando há. */
  readonly previsaoAlta: string | null;
  readonly alergias: SituacaoAlergias;
  readonly pendencias: readonly PendenciaMedico[];
  /** Maior = mais urgente (regra 1: ordenada por prioridade e prazo). */
  readonly prioridade: number;
  readonly prazo: string | null;
}

export interface WorklistMedico {
  readonly pacientes: readonly LinhaWorklistMedico[];
  readonly total: number;
  /** Teto da lista (ficha, seção 4: 100 pacientes). */
  readonly teto: number;
  readonly limitado: boolean;
  /** Sem ocupação no cadastro de profissionais: nenhum vínculo, a lista fica vazia (regra 2). */
  readonly semVinculo: boolean;
  readonly geradaEm: string;
}

export const TETO_WORKLIST_MEDICO = 100;

// ── Worklist da recepção ─────────────────────────────────────────────────────────────────────────────────

export interface SenhaDaWorklist {
  readonly id: number;
  readonly senha: string;
  readonly prioridade: PrioridadeSenha;
  /** Grupo legal de prioridade, quando o novo o registrou; null nas que o outro sistema emitiu. */
  readonly grupo: number | null;
  readonly grupoDescricao: string;
  readonly emitidaEm: string;
  readonly esperaMinutos: number;
  readonly situacao: string;
  readonly gerador: string;
}

export interface ChegadaDoDia {
  readonly marcacao: number;
  readonly hora: string;
  readonly paciente: string;
  readonly agenda: string;
  readonly chegou: boolean;
}

export interface GuiaPendente {
  readonly reg: number;
  readonly paciente: string;
  readonly convenio: string;
  readonly abertoEm: string;
  readonly esperaMinutos: number;
}

export interface WorklistRecepcao {
  readonly senhas: readonly SenhaDaWorklist[];
  readonly chegadas: readonly ChegadaDoDia[];
  readonly guias: readonly GuiaPendente[];
  /** Teto da lista (ficha, seção 4: 300 linhas). */
  readonly teto: number;
  readonly cortada: boolean;
  readonly geradaEm: string;
}

export const TETO_WORKLIST_RECEPCAO = 300;
