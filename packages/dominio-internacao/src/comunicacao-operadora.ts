// Comunicação da internação e da alta à operadora (F78.04-2, 04-INT linha 80). Regras puras: quando cada comunicação
// pode nascer, as transições da situação (pendente, enviada, confirmada, rejeitada, erro, cancelada) e a mensagem de
// conferência da comunicação de beneficiário do padrão de troca da saúde suplementar (internação ou alta, carteira,
// data do evento, tipo de internação no início e motivo de encerramento na alta); a serialização no XSD e o hash são do
// montador do faturamento. Sem banco e sem relógio.
// Melhoria: a comunicação nasce da própria internação (nada redigitado), uma só ativa por tipo, a alta só depois da
// alta registrada, o óbito exige alta por óbito, e a resposta da operadora fica guardada com a situação; nada se apaga
// (cancelar guarda o motivo).

export const TIPOS_COMUNICACAO_OPERADORA = [
  'internacao',
  'alta',
  'prorrogacao',
  'transferencia',
  'obito',
] as const;
export type TipoComunicacaoOperadora = (typeof TIPOS_COMUNICACAO_OPERADORA)[number];

export const SITUACOES_COMUNICACAO_OPERADORA = [
  'pendente',
  'enviada',
  'confirmada',
  'rejeitada',
  'erro',
  'cancelada',
] as const;
export type SituacaoComunicacaoOperadora = (typeof SITUACOES_COMUNICACAO_OPERADORA)[number];

/** Situações que contam como comunicação viva do tipo (impedem outra igual). */
export const SITUACOES_COMUNICACAO_VIVAS: readonly SituacaoComunicacaoOperadora[] = [
  'pendente',
  'enviada',
  'confirmada',
  'erro',
];

export interface ProblemaComunicacao {
  readonly campo: string;
  readonly mensagem: string;
}

/** Fontes pagadoras que recebem comunicação de beneficiário (saúde suplementar). */
export const TIPOS_FONTE_COM_COMUNICACAO = [
  'operadora',
  'seguradora',
  'autogestao',
  'cooperativa',
  'medicina_grupo',
] as const;

export interface ContextoNovaComunicacao {
  readonly tipo: TipoComunicacaoOperadora;
  readonly tipoFonte: string;
  readonly registroAns: string | null;
  readonly numeroCarteira: string | null;
  readonly altaRegistrada: boolean;
  readonly altaPorObito: boolean;
  /** Tipos com comunicação viva nesta internação. */
  readonly vivas: readonly TipoComunicacaoOperadora[];
}

/** Confere se a comunicação pode nascer. Prorrogação e transferência podem repetir; os demais, uma viva por tipo. */
export function conferirNovaComunicacao(c: ContextoNovaComunicacao): ProblemaComunicacao[] {
  const p: ProblemaComunicacao[] = [];
  if (!TIPOS_COMUNICACAO_OPERADORA.includes(c.tipo))
    return [{ campo: 'tipo', mensagem: 'Tipo de comunicação desconhecido.' }];
  if (!(TIPOS_FONTE_COM_COMUNICACAO as readonly string[]).includes(c.tipoFonte))
    p.push({
      campo: 'fonte',
      mensagem: 'A fonte pagadora da internação não é operadora de saúde suplementar.',
    });
  if (!c.registroAns?.trim())
    p.push({ campo: 'fonte', mensagem: 'A operadora não tem o registro na agência de saúde suplementar.' });
  if (!c.numeroCarteira?.trim())
    p.push({ campo: 'carteira', mensagem: 'A internação não tem o número da carteira do beneficiário.' });
  if ((c.tipo === 'alta' || c.tipo === 'obito') && !c.altaRegistrada)
    p.push({ campo: 'tipo', mensagem: 'A alta ainda não foi registrada nesta internação.' });
  if (c.tipo === 'obito' && c.altaRegistrada && !c.altaPorObito)
    p.push({ campo: 'tipo', mensagem: 'A alta registrada não é por óbito.' });
  if (c.tipo === 'alta' && c.altaPorObito)
    p.push({ campo: 'tipo', mensagem: 'A alta foi por óbito: comunique o óbito.' });
  if (c.tipo !== 'internacao' && !c.vivas.includes('internacao'))
    p.push({ campo: 'tipo', mensagem: 'Comunique primeiro a internação.' });
  const unica = c.tipo === 'internacao' || c.tipo === 'alta' || c.tipo === 'obito';
  if (unica && c.vivas.includes(c.tipo))
    p.push({ campo: 'tipo', mensagem: 'Já existe comunicação deste tipo em andamento nesta internação.' });
  if ((c.tipo === 'alta' && c.vivas.includes('obito')) || (c.tipo === 'obito' && c.vivas.includes('alta')))
    p.push({ campo: 'tipo', mensagem: 'A saída do paciente já foi comunicada.' });
  return p;
}

export type AcaoComunicacao = 'enviar' | 'confirmar' | 'rejeitar' | 'falhar' | 'reenviar' | 'cancelar';

const TRANSICOES: Record<
  AcaoComunicacao,
  { de: readonly SituacaoComunicacaoOperadora[]; para: SituacaoComunicacaoOperadora }
> = {
  enviar: { de: ['pendente'], para: 'enviada' },
  confirmar: { de: ['enviada'], para: 'confirmada' },
  rejeitar: { de: ['enviada'], para: 'rejeitada' },
  falhar: { de: ['pendente', 'enviada'], para: 'erro' },
  reenviar: { de: ['erro', 'rejeitada'], para: 'pendente' },
  cancelar: { de: ['pendente', 'erro', 'rejeitada'], para: 'cancelada' },
};

/** A transição da situação: recusa o que a situação atual não admite e exige o que cada ação precisa. */
export function transicaoComunicacao(entrada: {
  readonly situacao: SituacaoComunicacaoOperadora;
  readonly acao: AcaoComunicacao;
  readonly protocolo: string | null;
  readonly resposta: string | null;
}): { para: SituacaoComunicacaoOperadora | null; problemas: ProblemaComunicacao[] } {
  const t = TRANSICOES[entrada.acao];
  if (!t) return { para: null, problemas: [{ campo: 'acao', mensagem: 'Ação desconhecida.' }] };
  const p: ProblemaComunicacao[] = [];
  if (!t.de.includes(entrada.situacao))
    p.push({ campo: 'situacao', mensagem: `A comunicação ${entrada.situacao} não admite ${entrada.acao}.` });
  if (entrada.acao === 'confirmar' && !entrada.protocolo?.trim())
    p.push({ campo: 'protocolo', mensagem: 'Informe o protocolo da operadora.' });
  if (
    (entrada.acao === 'rejeitar' || entrada.acao === 'falhar' || entrada.acao === 'cancelar') &&
    !entrada.resposta?.trim()
  )
    p.push({ campo: 'resposta', mensagem: 'Informe o motivo.' });
  return { para: p.length ? null : t.para, problemas: p };
}

export interface DadosMensagemComunicacao {
  readonly tipo: TipoComunicacaoOperadora;
  readonly registroAns: string;
  readonly numeroCarteira: string;
  /** Recém-nascido atendido pela carteira da mãe (atendimentoRN do padrão de troca). */
  readonly recemNascido: boolean;
  /** Data e hora do evento em ISO (entrada na internação; saída na alta e no óbito). */
  readonly eventoEm: string;
  /** Tipo de internação do padrão de troca (1 a 5), obrigatório na comunicação da internação. */
  readonly tipoInternacao: string | null;
  /** Motivo de encerramento da terminologia de troca (2 dígitos), obrigatório na alta e no óbito. */
  readonly motivoEncerramento: string | null;
}

/** O que a mensagem leva, já conferido: o montador do padrão de troca (faturamento) serializa e assina com o hash. */
export interface MensagemComunicacaoConferida {
  readonly numeroCarteira: string;
  readonly recemNascido: boolean;
  /** AAAA-MM-DD */
  readonly dataEvento: string;
  readonly tipoEvento: 'I' | 'A';
  readonly tipoInternacao: string | null;
  readonly motivoEncerramento: string | null;
}

/** Tipo do evento na mensagem: a comunicação de beneficiário só conhece internação e alta (óbito sai como alta). */
export function eventoDaMensagem(tipo: TipoComunicacaoOperadora): 'internacao' | 'alta' | null {
  if (tipo === 'internacao') return 'internacao';
  if (tipo === 'alta' || tipo === 'obito') return 'alta';
  return null;
}

const CLASSIFICACAO_TIPO_INTERNACAO: Readonly<Record<string, string>> = {
  clinica: '1',
  cirurgica: '2',
  obstetrica: '3',
  pediatrica: '4',
  psiquiatrica: '5',
};

/**
 * O tipo de internação do padrão de troca (1 clínica, 2 cirúrgica, 3 obstétrica, 4 pediátrica, 5 psiquiátrica): o
 * código informado no cadastro da modalidade, se válido; senão, a classificação da modalidade; 'outra' fica sem tipo.
 */
export function tipoInternacaoDaModalidade(
  codigoInformado: string | null,
  classificacao: string | null,
): string | null {
  const c = codigoInformado?.trim() ?? '';
  if (/^[1-5]$/.test(c)) return c;
  return (classificacao && CLASSIFICACAO_TIPO_INTERNACAO[classificacao]) ?? null;
}

/**
 * Confere os dados da comunicação de beneficiário (internação ou alta) antes da montagem: o registro da operadora, a
 * carteira, a data do evento, o tipo de internação no início e o motivo de encerramento na alta. Prorrogação e
 * transferência não têm mensagem própria (seguem pela guia de prorrogação).
 */
export function conferirMensagemComunicacao(d: DadosMensagemComunicacao): {
  dados: MensagemComunicacaoConferida | null;
  problemas: ProblemaComunicacao[];
} {
  const evento = eventoDaMensagem(d.tipo);
  const p: ProblemaComunicacao[] = [];
  if (!evento)
    p.push({ campo: 'tipo', mensagem: 'Este tipo segue pela guia de prorrogação, sem mensagem própria.' });
  if (evento === 'internacao' && !/^[1-5]$/.test(d.tipoInternacao?.trim() ?? ''))
    p.push({
      campo: 'tipoInternacao',
      mensagem: 'A internação precisa do tipo (clínica, cirúrgica, obstétrica, pediátrica ou psiquiátrica).',
    });
  if (evento === 'alta' && !/^\d{2}$/.test(d.motivoEncerramento?.trim() ?? ''))
    p.push({ campo: 'motivoEncerramento', mensagem: 'A alta precisa do motivo de encerramento.' });
  if (!/^\d{6}$/.test(d.registroAns))
    p.push({ campo: 'fonte', mensagem: 'O registro da operadora tem 6 dígitos.' });
  if (!d.numeroCarteira.trim())
    p.push({ campo: 'carteira', mensagem: 'A internação não tem o número da carteira do beneficiário.' });
  if (Number.isNaN(Date.parse(d.eventoEm)))
    p.push({ campo: 'eventoEm', mensagem: 'Data do evento inválida.' });
  if (p.length) return { dados: null, problemas: p };
  return {
    dados: {
      numeroCarteira: d.numeroCarteira.trim(),
      recemNascido: d.recemNascido,
      dataEvento: d.eventoEm.slice(0, 10),
      tipoEvento: evento === 'internacao' ? 'I' : 'A',
      tipoInternacao: evento === 'internacao' ? d.tipoInternacao!.trim() : null,
      motivoEncerramento: evento === 'alta' ? d.motivoEncerramento!.trim() : null,
    },
    problemas: [],
  };
}
