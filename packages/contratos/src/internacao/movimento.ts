// Formas do movimento de internação lido do banco (M16): o que o adaptador (@sgh/legado) entrega e o motor da
// internação (@sgh/dominio-internacao) consome, sem nome de tabela. Datas de calendário vêm como `Date` à
// meia-noite UTC (o processo roda em TZ=UTC e o banco guarda a data sem fuso) e as horas como texto "HH:MM"
// no fuso do estabelecimento; a data sentinela da origem já chega como null. O paciente (prontuário) só serve à
// reinternação calculada (regra 9) e nunca sai do motor.

import type { GrupoMotivoAlta } from '../legendas/legendas.js';

/** Chave natural de uma unidade (bloco + acomodação) ou de um leito (… + leito). */
export interface PosicaoLeito {
  readonly bloco: string;
  readonly acomodacao: string;
  readonly leito: string;
}

export interface InternacaoMovimento extends PosicaoLeito {
  readonly reg: number;
  /** Prontuário do paciente (reinternação); nunca vai a tela, log nem trilha. */
  readonly paciente: number;
  readonly entrada: Date;
  readonly horaEntrada: string | null;
  /** null = internado (alta sentinela). */
  readonly alta: Date | null;
  readonly horaAlta: string | null;
  readonly motivo: number | null;
  /**
   * Grupo do motivo de saída quando a fonte já o conhece pelo tipo de saída do cadastro (banco próprio); prevalece
   * sobre o código em `motivo`, que só a fonte em memória ainda entrega (a classificação por código fica no conector).
   */
  readonly grupoSaida?: GrupoMotivoAlta | null;
  /** Caráter: '1' eletiva, '2' urgência (como o legado grava). */
  readonly carater: string | null;
  /** Clínica: 'M' médica, 'C' cirúrgica (e outras letras do legado). */
  readonly clinica: string | null;
  /** Diárias faturáveis (régua do faturamento; regra 6). */
  readonly permanencia: number | null;
}

export interface TrechoMovimento extends PosicaoLeito {
  readonly reg: number;
  readonly cod: number;
  readonly entrada: Date;
  readonly horaEntrada: string | null;
  /** null = trecho em aberto. */
  readonly saida: Date | null;
  readonly horaSaida: string | null;
  /** Tipo de acomodação do trecho (regra 4). */
  readonly tipo: number;
}

export interface TransferenciaMovimento {
  readonly reg: number;
  readonly data: Date;
  readonly hora: string | null;
  readonly origem: PosicaoLeito;
  readonly destino: PosicaoLeito;
}

export interface UnidadeMovimento {
  readonly bloco: string;
  readonly acomodacao: string;
  readonly nome: string;
  /** Tipo atual da acomodação (cadastro). */
  readonly tipo: number | null;
  readonly leitos: number;
  /** Leitos com situação ativa hoje (leito-dia operacional com limitação declarada; regra 10). */
  readonly leitosAtivos: number;
}

export interface MovimentoInternacao {
  readonly internacoes: readonly InternacaoMovimento[];
  readonly trechos: readonly TrechoMovimento[];
  readonly transferencias: readonly TransferenciaMovimento[];
  readonly unidades: readonly UnidadeMovimento[];
  readonly tipos: ReadonlyMap<number, string>;
  /** Maior data de movimento vista (data da cópia ou o agora; "dados até", regra 14). */
  readonly dadosAte: Date;
}

// ── Painel de leitos (o que a leitura ao vivo entrega; regra 16: as iniciais já calculadas, nunca o nome) ──

export interface BlocoPainelLido {
  readonly bloco: string;
  readonly nome: string;
}

export interface AcomodacaoPainelLida {
  readonly bloco: string;
  readonly acomodacao: string;
  readonly nome: string;
  readonly tipo: number | null;
}

export interface LeitoPainelLido extends PosicaoLeito {
  readonly id: number;
  /** 'A' ativo, 'I' inativo (vazio conta como ativo). */
  readonly status: string;
  /** Internação que ocupa o leito (0 = livre), como o legado marca. */
  readonly reg: number;
  readonly ramal: number | null;
}

export interface InternacaoAbertaLida extends PosicaoLeito {
  readonly reg: number;
  readonly entrada: Date;
  readonly iniciais: string;
  readonly nascimento: Date | null;
  readonly sexo: string | null;
  readonly convenio: string | null;
  /** Tipo de acomodação do trecho em aberto (null sem trecho em aberto). */
  readonly tipoTrecho: number | null;
}

export interface LeiturasPainel {
  readonly blocos: readonly BlocoPainelLido[];
  readonly acomodacoes: readonly AcomodacaoPainelLida[];
  readonly leitos: readonly LeitoPainelLido[];
  readonly abertas: readonly InternacaoAbertaLida[];
  readonly tipos: ReadonlyMap<number, string>;
}

/** Iniciais do nome (regra 16): primeira letra das palavras com 3 letras ou mais (sem "da", "de"…); até 4. */
export function iniciaisDoNome(nome: string | null | undefined): string {
  const letras = (nome ?? '')
    .normalize('NFC')
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}]/gu, ''))
    .filter((p) => p.length >= 3)
    .map((p) => p.charAt(0).toLocaleUpperCase('pt-BR'));
  if (letras.length <= 4) return letras.join('');
  return [letras[0], letras[1], letras[letras.length - 2], letras[letras.length - 1]].join('');
}
