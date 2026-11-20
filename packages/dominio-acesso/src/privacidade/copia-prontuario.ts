// W0-10 (M2, cópia do prontuário; LGPD art. 18 II e art. 19; Código de Ética Médica, art. 88; Resolução CFM
// 1.821/2007; Recomendação CFM 3/2014 para o pedido de familiar do falecido): a cópia é um pedido do titular do tipo
// 'acesso' (SGH_AUD_PEDIDO_TITULAR, protocolo e prazo de 15 dias) com a sua fila de atos, cada um um FATO NOVO só de
// inclusão: a solicitação (quem pede: o titular, o representante com vínculo vigente e escopo 'documentos', ou o
// familiar do falecido só no balcão e com a prova), a conferência da legitimidade (o pedido passa a 'identidade-
// verificada'), cada geração do PDF com marca d'água (o hash vai para a trilha) e a entrega (o pedido passa a
// 'atendido'). Nada se edita: a segunda cópia é um pedido novo.
import type { SituacaoPedido } from './pedido-titular.js';

export const SOLICITANTES_COPIA = ['titular', 'representante', 'herdeiro'] as const;
export type SolicitanteCopia = (typeof SOLICITANTES_COPIA)[number];

export const ATOS_COPIA = ['solicitacao', 'legitimidade', 'geracao', 'entrega'] as const;
export type AtoCopia = (typeof ATOS_COPIA)[number];

export const MEIOS_ENTREGA_COPIA = ['portal', 'balcao', 'correio'] as const;
export type MeioEntregaCopia = (typeof MEIOS_ENTREGA_COPIA)[number];

export const ETAPAS_COPIA = [
  'aguardando-conferencia',
  'legitimidade-conferida',
  'gerada',
  'entregue',
] as const;
export type EtapaCopia = (typeof ETAPAS_COPIA)[number];

/** A etapa da cópia a partir dos atos já registrados (a ordem não importa: a fila é só de inclusão). */
export function etapaDaCopia(atos: readonly { readonly ato: AtoCopia }[]): EtapaCopia {
  const tem = (a: AtoCopia) => atos.some((x) => x.ato === a);
  if (tem('entrega')) return 'entregue';
  if (tem('geracao')) return 'gerada';
  if (tem('legitimidade')) return 'legitimidade-conferida';
  return 'aguardando-conferencia';
}

/** O vínculo do representante, como a sessão ou o balcão o conhece hoje. */
export interface VinculoParaCopia {
  /** O titular do vínculo é o paciente do pedido. */
  readonly doPaciente: boolean;
  /** Vigente hoje (dominio-acesso, vigenciaDoVinculo). */
  readonly vigente: boolean;
  readonly escopos: readonly string[];
}

export interface SolicitacaoCopia {
  readonly solicitante: SolicitanteCopia;
  readonly canal: 'portal' | 'balcao';
  readonly vinculo: VinculoParaCopia | null;
  /** A descrição do documento conferido (certidão de óbito e parentesco, procuração...). */
  readonly prova: string | null;
}

export type RecusaCopia =
  | 'representante-sem-vinculo'
  | 'vinculo-de-outro-paciente'
  | 'vinculo-sem-vigencia'
  | 'vinculo-sem-escopo'
  | 'herdeiro-so-no-balcao'
  | 'prova-obrigatoria'
  | 'pedido-encerrado'
  | 'ja-solicitada'
  | 'sem-solicitacao'
  | 'ja-conferida'
  | 'legitimidade-primeiro'
  | 'ja-entregue'
  | 'gere-antes-de-entregar'
  | 'recebedor-obrigatorio';

const PROVA_MINIMA = 5;
const provaValida = (p: string | null) => p !== null && p.trim().length >= PROVA_MINIMA;

/** Quem pode pedir a cópia: o titular, o representante com vínculo vigente e escopo 'documentos', o familiar no balcão. */
export function conferirSolicitacaoCopia(s: SolicitacaoCopia): RecusaCopia | null {
  if (s.solicitante === 'representante') {
    if (s.vinculo === null) return 'representante-sem-vinculo';
    if (!s.vinculo.doPaciente) return 'vinculo-de-outro-paciente';
    if (!s.vinculo.vigente) return 'vinculo-sem-vigencia';
    if (!s.vinculo.escopos.includes('documentos')) return 'vinculo-sem-escopo';
  }
  if (s.solicitante === 'herdeiro') {
    if (s.canal !== 'balcao') return 'herdeiro-so-no-balcao';
    if (!provaValida(s.prova)) return 'prova-obrigatoria';
  }
  return null;
}

/** Estado do pedido e da cópia sobre a linha travada. */
export interface CopiaParaAto {
  readonly situacaoPedido: SituacaoPedido;
  readonly atos: readonly { readonly ato: AtoCopia }[];
}

export type NovoAtoCopia =
  | { readonly ato: 'solicitacao' }
  | {
      readonly ato: 'legitimidade';
      readonly solicitante: SolicitanteCopia;
      /** Representante: o vínculo de novo no momento da conferência (pode ter vencido desde o pedido). */
      readonly vinculo: VinculoParaCopia | null;
      readonly prova: string | null;
    }
  | { readonly ato: 'geracao' }
  | { readonly ato: 'entrega'; readonly meio: MeioEntregaCopia; readonly recebedor: string | null };

/** Confere o próximo ato da fila (solicitação → legitimidade → geração, quantas vezes for preciso → entrega). */
export function conferirAtoCopia(c: CopiaParaAto, novo: NovoAtoCopia): RecusaCopia | null {
  const etapa = etapaDaCopia(c.atos);
  const solicitada = c.atos.some((x) => x.ato === 'solicitacao');
  if (etapa === 'entregue') return 'ja-entregue';
  if (c.situacaoPedido === 'atendido' || c.situacaoPedido === 'negado' || c.situacaoPedido === 'cancelado')
    return 'pedido-encerrado';
  switch (novo.ato) {
    case 'solicitacao':
      return solicitada ? 'ja-solicitada' : null;
    case 'legitimidade': {
      if (!solicitada) return 'sem-solicitacao';
      if (etapa !== 'aguardando-conferencia') return 'ja-conferida';
      return conferirSolicitacaoCopia({
        solicitante: novo.solicitante,
        canal: 'balcao',
        vinculo: novo.vinculo,
        prova: novo.prova,
      });
    }
    case 'geracao':
      return etapa === 'aguardando-conferencia' ? 'legitimidade-primeiro' : null;
    case 'entrega':
      if (etapa === 'aguardando-conferencia') return 'legitimidade-primeiro';
      if (etapa !== 'gerada') return 'gere-antes-de-entregar';
      if (novo.meio !== 'portal' && (novo.recebedor === null || novo.recebedor.trim().length < 3))
        return 'recebedor-obrigatorio';
      return null;
  }
}

export function mensagemCopia(r: RecusaCopia): string {
  switch (r) {
    case 'representante-sem-vinculo':
      return 'O representante precisa de vínculo aprovado com o paciente para pedir a cópia.';
    case 'vinculo-de-outro-paciente':
      return 'O vínculo informado é de outro paciente.';
    case 'vinculo-sem-vigencia':
      return 'O vínculo do representante não está vigente (encerrado, vencido ou pela maioridade do paciente).';
    case 'vinculo-sem-escopo':
      return 'O vínculo do representante não inclui documentos: a cópia do prontuário não pode ser pedida por ele.';
    case 'herdeiro-so-no-balcao':
      return 'O pedido de familiar do paciente falecido é feito no balcão, com os documentos originais.';
    case 'prova-obrigatoria':
      return 'Descreva o documento conferido (certidão de óbito e de parentesco, ou procuração).';
    case 'pedido-encerrado':
      return 'O pedido já foi respondido ou cancelado: abra um pedido novo.';
    case 'ja-solicitada':
      return 'A cópia deste pedido já foi solicitada.';
    case 'sem-solicitacao':
      return 'Este pedido não é de cópia do prontuário.';
    case 'ja-conferida':
      return 'A legitimidade já foi conferida.';
    case 'legitimidade-primeiro':
      return 'Confira a legitimidade de quem pede antes de gerar ou entregar a cópia.';
    case 'ja-entregue':
      return 'A cópia já foi entregue: uma nova cópia é um pedido novo.';
    case 'gere-antes-de-entregar':
      return 'Gere o PDF da cópia antes de registrar a entrega.';
    case 'recebedor-obrigatorio':
      return 'Informe quem recebeu a cópia.';
  }
}

/** A situação do pedido que o ato produz (null: o pedido não muda). */
export function situacaoAposAto(ato: AtoCopia): SituacaoPedido | null {
  if (ato === 'legitimidade') return 'identidade-verificada';
  if (ato === 'entrega') return 'atendido';
  return null;
}

/**
 * O texto da marca d'água de cada página: o protocolo, quem pediu (o papel, nunca o nome) e o instante da geração.
 * A cópia é rastreável sem pôr dado do titular na marca.
 */
export function marcaDaguaCopia(protocolo: string, solicitante: SolicitanteCopia, geradaEm: Date): string {
  const quando = geradaEm.toISOString().slice(0, 16).replace('T', ' ');
  const papel = { titular: 'titular', representante: 'representante legal', herdeiro: 'familiar' }[
    solicitante
  ];
  return `CÓPIA ${protocolo} · ${papel} · ${quando} UTC`;
}
