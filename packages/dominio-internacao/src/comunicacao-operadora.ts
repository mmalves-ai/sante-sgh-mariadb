// Comunicação da internação e da alta à operadora (F78.04-2, 04-INT linha 80). Regras puras: quando cada comunicação
// pode nascer, as transições da situação (pendente, enviada, confirmada, rejeitada, erro, cancelada) e a mensagem de
// comunicação de beneficiário no padrão de troca da saúde suplementar (internação ou alta, carteira, data do evento,
// tipo de internação e motivo de encerramento na alta). Sem banco e sem relógio.
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
  readonly cnesOuCodigoPrestador: string;
  readonly numeroCarteira: string;
  readonly recemNascido: boolean;
  readonly numeroGuia: string | null;
  /** Data e hora do evento em ISO (entrada na internação; saída na alta e no óbito). */
  readonly eventoEm: string;
  readonly tipoInternacao: string | null;
  /** Motivo de encerramento da terminologia de troca, obrigatório na alta e no óbito. */
  readonly motivoEncerramento: string | null;
  readonly sequencial: string;
}

/** Tipo do evento na mensagem: a comunicação de beneficiário só conhece internação e alta (óbito sai como alta). */
export function eventoDaMensagem(tipo: TipoComunicacaoOperadora): 'internacao' | 'alta' | null {
  if (tipo === 'internacao') return 'internacao';
  if (tipo === 'alta' || tipo === 'obito') return 'alta';
  return null;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Monta a mensagem de comunicação de beneficiário (internação ou alta) no padrão de troca: cabeçalho com a
 * transação, a operadora (registro), o prestador e o corpo com a carteira, o evento e, na alta, o motivo de
 * encerramento. Prorrogação e transferência não têm mensagem própria (seguem pela guia de prorrogação).
 */
export function montarMensagemComunicacao(d: DadosMensagemComunicacao): {
  xml: string | null;
  problemas: ProblemaComunicacao[];
} {
  const evento = eventoDaMensagem(d.tipo);
  const p: ProblemaComunicacao[] = [];
  if (!evento)
    p.push({ campo: 'tipo', mensagem: 'Este tipo segue pela guia de prorrogação, sem mensagem própria.' });
  if (evento === 'alta' && !d.motivoEncerramento?.trim())
    p.push({ campo: 'motivoEncerramento', mensagem: 'A alta precisa do motivo de encerramento.' });
  if (!/^\d{6}$/.test(d.registroAns))
    p.push({ campo: 'fonte', mensagem: 'O registro da operadora tem 6 dígitos.' });
  if (Number.isNaN(Date.parse(d.eventoEm)))
    p.push({ campo: 'eventoEm', mensagem: 'Data do evento inválida.' });
  if (p.length) return { xml: null, problemas: p };
  const data = d.eventoEm.slice(0, 10);
  const hora = d.eventoEm.slice(11, 19);
  const linhas = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
    '  <ans:cabecalho>',
    '    <ans:identificacaoTransacao>',
    '      <ans:tipoTransacao>COMUNICACAO_BENEFICIARIO</ans:tipoTransacao>',
    `      <ans:sequencialTransacao>${esc(d.sequencial)}</ans:sequencialTransacao>`,
    '    </ans:identificacaoTransacao>',
    `    <ans:origem><ans:identificacaoPrestador><ans:codigoPrestadorNaOperadora>${esc(d.cnesOuCodigoPrestador)}</ans:codigoPrestadorNaOperadora></ans:identificacaoPrestador></ans:origem>`,
    `    <ans:destino><ans:registroANS>${esc(d.registroAns)}</ans:registroANS></ans:destino>`,
    '  </ans:cabecalho>',
    '  <ans:prestadorParaOperadora>',
    '    <ans:comunicacaoBeneficiario>',
    `      <ans:numeroCarteira>${esc(d.numeroCarteira)}</ans:numeroCarteira>`,
    `      <ans:atendimentoRN>${d.recemNascido ? 'S' : 'N'}</ans:atendimentoRN>`,
    `      <ans:tipoEvento>${evento === 'internacao' ? 'I' : 'A'}</ans:tipoEvento>`,
    `      <ans:dataEvento>${data}</ans:dataEvento>`,
    `      <ans:horaEvento>${hora}</ans:horaEvento>`,
    ...(d.numeroGuia
      ? [`      <ans:numeroGuiaOperadora>${esc(d.numeroGuia)}</ans:numeroGuiaOperadora>`]
      : []),
    ...(evento === 'internacao' && d.tipoInternacao
      ? [`      <ans:tipoInternacao>${esc(d.tipoInternacao)}</ans:tipoInternacao>`]
      : []),
    ...(evento === 'alta'
      ? [`      <ans:motivoEncerramento>${esc(d.motivoEncerramento!)}</ans:motivoEncerramento>`]
      : []),
    '    </ans:comunicacaoBeneficiario>',
    '  </ans:prestadorParaOperadora>',
    '</ans:mensagemTISS>',
  ];
  return { xml: linhas.join('\n'), problemas: [] };
}
