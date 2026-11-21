// Tipos de negócio da portaria e dos visitantes (M50, etapa 5): o que a porta lê e grava, independente de onde (banco
// do cliente ou memória sintética). Vocabulário neutro: ids numéricos, datas e instantes locais do estabelecimento
// ("AAAA-MM-DD" e "AAAA-MM-DDTHH:mm"), booleanos; nada de letras de situação nem sentinela.
// Melhoria: os domínios trazem o significado de cada linha (identificação biométrica, tipo de destino "paciente"), e
// não códigos fixos combinados com o sistema de origem.
import type {
  AbrangenciaBloqueio,
  FundamentoAcompanhante,
  IsolamentoRegra,
  MotivoBloqueioVisita,
  PapelVisita,
  ResultadoCatraca,
  SentidoCatraca,
  SentidoTerminal,
  TipoDocumentoVisitante,
} from '@sgh/contratos';

export const TETO_INTERNADOS_PORTARIA = 2_000;
export const TETO_VISITAS_ABERTAS = 1_000;
export const TETO_VISITAS_PERIODO = 5_000;
export const TETO_BUSCA_VISITANTE = 30;

/** Os domínios do controle de acesso, com o significado de cada linha. */
export interface DominiosDaPortaria {
  readonly tiposVisitante: { codigo: number; nome: string; ativo: boolean }[];
  /** `paciente`: o destino é um paciente internado (a visita vai pelo paciente). */
  readonly tiposVisitado: { codigo: number; nome: string; paciente: boolean }[];
  /** `biometrica`: digital ou face (só com a identificação biométrica liberada). */
  readonly identificacoes: { codigo: number; nome: string; biometrica: boolean }[];
  readonly situacoesAcesso: { codigo: number; nome: string }[];
  readonly tiposTerminal: {
    codigo: number;
    nome: string;
    fabricante: number;
    fabricanteNome: string;
    ativo: boolean;
  }[];
}

export interface InternadoPortaria {
  readonly internacao: number;
  readonly paciente: number;
  readonly nome: string;
  readonly nascimento: string | null;
  /** Código da unidade de internação. */
  readonly unidade: string;
  readonly unidadeNome: string;
  readonly acomod: string;
  readonly leitoCodigo: string;
  /** Acomodação-leito, como o mapa mostra. */
  readonly leito: string;
  readonly isolamento: boolean;
}

export interface RegraVisitaRegistrada {
  readonly id: number;
  readonly unidade: string;
  readonly horaInicio: string;
  readonly horaFim: string;
  readonly maxSimultaneos: number;
  readonly idadeMinima: number;
  readonly uti: boolean;
  readonly isolamento: IsolamentoRegra;
  readonly duracaoMaxMin: number;
  readonly observacao: string | null;
  readonly versao: number;
  readonly atualizadoPor: string;
  readonly atualizadoEm: string;
}

export interface BloqueioVisitaRegistrado {
  readonly id: number;
  readonly internacao: number;
  readonly paciente: number;
  readonly motivo: MotivoBloqueioVisita;
  readonly abrangencia: AbrangenciaBloqueio;
  readonly visitante: number | null;
  readonly visitanteNome: string | null;
  readonly limite: number | null;
  readonly incluiAcompanhante: boolean;
  readonly justificativa: string;
  readonly documento: string | null;
  readonly inicio: string;
  readonly fim: string | null;
  readonly revogado: boolean;
  readonly criadoPor: string;
}

export interface VisitanteRegistrado {
  readonly id: number;
  readonly nome: string;
  readonly tipoDocumento: TipoDocumentoVisitante;
  readonly documento: string;
  readonly nascimento: string | null;
  readonly telefone: string | null;
  readonly tipoVisitante: number;
  readonly fotoChave: string | null;
  readonly reterAte: string;
  readonly ultimaVisita: string | null;
}

export interface VisitaRegistrada {
  readonly id: number;
  readonly visitante: number;
  readonly visitanteNome: string;
  readonly documento: string;
  readonly tipoDocumento: string;
  readonly telefone: string | null;
  readonly temFoto: boolean;
  readonly papel: PapelVisita;
  readonly internacao: number | null;
  readonly paciente: number | null;
  /** Código da unidade do paciente visitado. */
  readonly bloco: string | null;
  readonly acomod: string | null;
  readonly leito: string | null;
  readonly tipoVisitado: number;
  readonly local: string | null;
  readonly identificacao: number;
  readonly cracha: string;
  readonly entrada: string;
  readonly validoAte: string;
  readonly saida: string | null;
  readonly excecao: string | null;
  readonly usuario: string;
}

export interface AcompanhanteRegistrado {
  readonly id: number;
  readonly internacao: number;
  readonly paciente: number;
  /** Código da unidade do paciente. */
  readonly bloco: string;
  readonly visitante: number;
  readonly visitanteNome: string;
  readonly fundamento: FundamentoAcompanhante;
  readonly refeicao: boolean;
  readonly pernoite: boolean;
  readonly observacao: string | null;
  readonly inicio: string;
  readonly fim: string | null;
  readonly substitui: number | null;
  readonly criadoPor: string;
}

export interface TerminalRegistrado {
  readonly id: number;
  readonly nome: string;
  readonly tipoTerminal: number;
  readonly fabricante: number;
  readonly local: string;
  readonly sentido: SentidoTerminal;
  readonly ativo: boolean;
  readonly versao: number;
}

export interface EventoCatracaRegistrado {
  readonly id: number;
  readonly terminal: number;
  readonly cracha: string;
  readonly sentido: SentidoCatraca;
  readonly resultado: ResultadoCatraca;
  readonly motivo: string | null;
  readonly ocorridoEm: string;
  readonly visita: number | null;
}

// ── Gravações ───────────────────────────────────────────────────────────────────────────────────────

/** A foto guardada no armazenamento de objetos (o banco guarda só o metadado). */
export interface FotoGuardada {
  readonly chave: string;
  readonly tipoMime: string;
  readonly tamanho: number;
  readonly hash: string;
}

export interface NovoVisitante {
  readonly nome: string;
  readonly nomeBusca: string;
  readonly tipoDocumento: TipoDocumentoVisitante;
  readonly documento: string;
  readonly nascimento: string | null;
  readonly telefone: string | null;
  readonly tipoVisitante: number;
  /** A foto nova (nula: mantém a que já existe). */
  readonly foto: FotoGuardada | null;
  readonly reterAte: string;
  readonly usuario: string;
}

export interface BloqueioRelido {
  readonly id: number;
  readonly motivo: MotivoBloqueioVisita;
  readonly abrangencia: AbrangenciaBloqueio;
  readonly visitante: number | null;
  readonly limite: number | null;
  readonly incluiAcompanhante: boolean;
  readonly inicio: string;
  readonly fim: string | null;
  readonly revogado: boolean;
}

/** O paciente relido na transação da visita (depois da trava): a avaliação é refeita com isto. */
export interface SituacaoDoPaciente {
  readonly internado: boolean;
  readonly bloqueios: readonly BloqueioRelido[];
  readonly abertas: number;
  readonly acompanhante: number | null;
  /** O fundamento do acompanhante vigente (o "autorizado" segue a regra da unidade). */
  readonly acompanhanteFundamento: FundamentoAcompanhante | null;
  readonly visitanteEmVisita: boolean;
}

export type AvaliacaoDaVisita =
  | { readonly permitida: true; readonly papel: PapelVisita }
  | { readonly permitida: false; readonly recusa: string; readonly mensagem: string };

export interface NovaVisita {
  readonly visitante: number;
  readonly destino:
    | {
        readonly tipo: 'paciente';
        readonly internacao: number;
        readonly paciente: number;
        readonly bloco: string;
        readonly acomod: string;
        readonly leito: string;
      }
    | { readonly tipo: 'outro'; readonly local: string };
  readonly tipoVisitado: number;
  readonly identificacao: number;
  readonly cracha: string;
  readonly entrada: string;
  readonly validoAte: string;
  readonly excecao: string | null;
  readonly reterAte: string;
  readonly usuario: string;
  /** A chave do ato (Idempotency-Key): o mesmo pedido reenviado devolve a visita já gravada. */
  readonly chave: string | null;
}

export interface NovaRegraVisita {
  readonly unidade: string;
  readonly horaInicio: string;
  readonly horaFim: string;
  readonly maxSimultaneos: number;
  readonly idadeMinima: number;
  readonly uti: boolean;
  readonly isolamento: IsolamentoRegra;
  readonly duracaoMaxMin: number;
  readonly observacao: string | null;
  /** A versão lida (nula: a primeira regra da unidade). */
  readonly versao: number | null;
  readonly usuario: string;
}

export interface NovoBloqueioVisita {
  readonly internacao: number;
  readonly paciente: number;
  readonly motivo: MotivoBloqueioVisita;
  readonly abrangencia: AbrangenciaBloqueio;
  readonly visitante: number | null;
  readonly limite: number | null;
  readonly incluiAcompanhante: boolean;
  readonly justificativa: string;
  readonly documento: string | null;
  readonly inicio: string;
  readonly fim: string | null;
  readonly usuario: string;
}

export interface NovoAcompanhante {
  readonly internacao: number;
  readonly paciente: number;
  readonly bloco: string;
  readonly visitante: number;
  readonly fundamento: FundamentoAcompanhante;
  readonly refeicao: boolean;
  readonly pernoite: boolean;
  readonly observacao: string | null;
  readonly inicio: string;
  readonly usuario: string;
}

export interface NovoTerminal {
  /** Nulo: um terminal novo. */
  readonly id: number | null;
  readonly versao: number | null;
  readonly nome: string;
  readonly tipoTerminal: number;
  readonly fabricante: number;
  readonly local: string;
  readonly sentido: SentidoTerminal;
  readonly ativo: boolean;
  readonly usuario: string;
}

export interface TerminalDaCatraca {
  readonly id: number;
  readonly tipoTerminal: number;
  readonly fabricante: number;
  readonly sentido: SentidoTerminal;
  readonly ativo: boolean;
}

export interface VisitaDoCracha {
  readonly id: number;
  readonly validoAte: string;
  readonly saida: string | null;
}
