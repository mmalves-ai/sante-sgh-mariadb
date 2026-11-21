// Tipos de negócio da SAE, da prescrição de enfermagem, da receita do enfermeiro e da vacina aplicada (M45, etapa 4):
// o que a porta (própria ou memória) entrega e recebe. Vocabulário neutro: booleano, data ISO, id numérico.
// Melhoria: os tipos são do módulo (antes vinham do pacote do sistema de origem); a montagem do processo foi ao domínio.
import type {
  AtividadeSaeLida,
  DoseVacina,
  ItemReceitaEnfermeiro,
  SistemaTerminologiaSae,
} from '@sgh/contratos';
import type { ItemSae } from '@sgh/dominio-enfermagem';
import type { AtendimentoDaConsulta } from './tipos.js';

export type { ItemSae };

/** Evento do envio da vacina aplicada cancelada (estorno) para a rede nacional. */
export const EVENTO_VACINA_CANCELADA = 'fato.vacina.cancelada';
/** Evento do envio da vacina aplicada substituída (retificação). */
export const EVENTO_VACINA_SUBSTITUIDA = 'fato.vacina.substituida';


export interface AtividadeVigente extends AtividadeSaeLida {
  readonly atendimento: number;
  readonly sae: number;
}

/** O atendimento da consulta de enfermagem (o tipo da porta da enfermagem). */
export type ConsultaDeEnfermagem = AtendimentoDaConsulta;

export interface CabecalhoReceita {
  readonly instituicao: string;
  readonly cnpj: string | null;
  readonly paciente: string;
  readonly nascimento: string | null;
  readonly cpf: string | null;
  readonly prescritor: string;
  readonly conselho: string | null;
  readonly categoria: string | null;
}

export interface ReceitaDoEnfermeiro {
  readonly id: number;
  readonly protocolo: string;
  readonly ano: number;
  readonly tipoProtocolo: 'institucional' | 'programa';
  readonly modelo: 'simples' | 'retencao';
  readonly listaVersao: string;
  readonly segundoIdentificador: 'cpf' | 'nascimento';
  readonly coren: string;
  readonly categoria: string;
  readonly itens: ItemReceitaEnfermeiro[];
  readonly impressao: string;
  readonly assinadaEm: string;
  readonly vinculo: number;
  readonly usuario: string;
  /** W0-03: a receita que esta reemite, a que a reemitiu e a suspensão ou o cancelamento. */
  readonly anterior: number | null;
  readonly reemitidaEm: number | null;
  readonly inativacao: {
    readonly tipo: 'suspensao' | 'cancelamento';
    readonly motivo: string;
    readonly usuario: string;
    readonly em: string;
  } | null;
}

export interface RecusaEnvioVacina {
  readonly envio: number;
  readonly evento: 'aplicada' | 'substituida' | 'cancelada';
  readonly vacina: number | null;
  readonly versao: number;
  readonly situacao: 'pendente' | 'morto';
  readonly tentativas: number;
  readonly motivo: string;
  readonly proximaTentativaEm: string | null;
  readonly mortoEm: string | null;
  readonly criadoEm: string;
}

export interface TermoTerminologiaSae {
  readonly sistema: 'NNN' | 'CIPE';
  readonly versao: string;
  readonly licenca: string;
  readonly tipo: string;
  readonly codigo: string;
  readonly pai: string | null;
  readonly descricao: string;
  readonly risco: boolean;
}

export interface CorrecaoVacina {
  readonly versao: number;
  readonly tipo: 'estorno' | 'retificacao';
  readonly motivo: string;
  /** Os campos corrigidos (só na retificação). */
  readonly dados: Readonly<Record<string, string | null>> | null;
  readonly usuario: string;
  readonly em: string;
  /** A situação do evento RIA de cancelamento ou substituição na fila de saída e da entrega do conector. */
  readonly evento: 'pendente' | 'publicado' | 'morto' | null;
  readonly entrega: 'pendente' | 'enviado' | 'morto' | 'descartado' | null;
}

export interface VacinaAplicada {
  readonly id: number;
  readonly imunobiologico: string;
  readonly nome: string;
  readonly lote: string;
  readonly fabricante: string | null;
  readonly validadeLote: string;
  readonly dose: DoseVacina;
  readonly via: string;
  readonly local: string;
  readonly aplicadaEm: string;
  readonly prazoEnvio: string;
  readonly evento: 'pendente' | 'publicado' | 'morto' | null;
  readonly entrega: 'pendente' | 'enviado' | 'morto' | 'descartado' | null;
  readonly usuario: string;
  readonly em: string;
  /** W0-03: os estornos e as retificações, na ordem da versão (o registro local nunca muda). */
  readonly correcoes: readonly CorrecaoVacina[];
}

export interface RetificacaoVacina {
  readonly lote?: string | undefined;
  readonly fabricante?: string | null | undefined;
  readonly validadeLote?: string | undefined;
  readonly dose?: DoseVacina | undefined;
  readonly via?: string | undefined;
  readonly local?: string | undefined;
  readonly aplicadaEm?: string | undefined;
}

export interface DiagnosticoSaeNovo {
  readonly codigo: string;
  readonly descricao: string;
  readonly caracteristicas: readonly string[];
  readonly fatores: readonly string[];
  readonly resultados: readonly {
    readonly codigo: string;
    readonly descricao: string;
    readonly escalaAtual: number;
    readonly meta: number;
    readonly escalaMeta: number;
  }[];
  readonly intervencoes: readonly { readonly codigo: string; readonly descricao: string }[];
}

export interface AtividadeSaeNova {
  readonly intervencao: number;
  readonly codigo: string | null;
  readonly descricao: string;
  readonly frequenciaDia: number;
  readonly horarios: readonly string[];
  readonly inicio: string;
  readonly fim: string | null;
}

export interface ChecagemCuidadoNova {
  readonly atividade: number;
  readonly atendimento: number;
  readonly previsto: string;
  readonly feita: boolean;
  readonly motivo: string | null;
  readonly horaReal: string;
  readonly origemOffline: boolean;
  readonly categoria: 'enfermeiro' | 'tecnico';
  readonly vinculo: number;
  readonly usuario: string;
  readonly chave: string | null;
}

export interface ReceitaEnfermeiroNova {
  readonly paciente: number;
  readonly atendimento: number;
  readonly protocolo: string;
  readonly ano: number;
  readonly tipoProtocolo: 'institucional' | 'programa';
  readonly modelo: 'simples' | 'retencao';
  readonly listaVersao: string;
  readonly segundoIdentificador: 'cpf' | 'nascimento';
  readonly coren: string;
  readonly categoria: string;
  readonly itens: readonly ItemReceitaEnfermeiro[];
  readonly impressao: string;
  readonly assinadaEm: string;
  readonly vinculo: number;
  readonly usuario: string;
  readonly chave: string | null;
  /** W0-03: a reemissão aponta a receita anterior (do mesmo atendimento, já suspensa ou cancelada). */
  readonly anterior?: number | null | undefined;
}

export interface VacinaNova {
  readonly paciente: number;
  readonly atendimento: number;
  readonly imunobiologico: string;
  readonly nome: string;
  readonly lote: string;
  readonly fabricante: string | null;
  readonly validadeLote: string;
  readonly dose: DoseVacina;
  readonly via: string;
  readonly local: string;
  readonly aplicadaEm: string;
  readonly prazoEnvio: string;
  /** A chave da dose (nula no reforço): a mesma dose do mesmo imunobiológico uma vez só por paciente. */
  readonly chaveDose: string | null;
  readonly vinculo: number;
  readonly usuario: string;
  readonly chave: string | null;
}

/** Versão do processo de enfermagem do atendimento. */
export interface SaeDoAtendimento {
  readonly versoes: readonly VersaoSae[];
  readonly cabecalho: {
    readonly id: number;
    readonly versao: number;
    readonly avaliacao: string;
    readonly sistema: SistemaTerminologiaSae;
    readonly versaoTerminologia: string;
    readonly usuario: string;
    readonly em: string;
    readonly registroProntuario: number | null;
  } | null;
  readonly itens: readonly ItemSae[];
}


/** Versão do processo de enfermagem do atendimento. */
export interface VersaoSae {
  readonly id: number;
  readonly versao: number;
  readonly usuario: string;
  readonly em: string;
}
