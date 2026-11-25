// Envio mensal dos indicadores de infecção e de resistência ao órgão sanitário (F7, 09-AREA linha 68): cada formulário
// da competência fechada (UTI adulto, pediátrica, neonatal, cirurgia, diálise, resistência microbiana, consumo de
// antimicrobiano e de preparação alcoólica) tem o registro do envio, com a data, o protocolo e o retorno do órgão.
// A regra decide, na hora e sem banco, o que o registro pode gravar.
// Melhoria: o tipo do envio não é escolhido: o primeiro do formulário é o inicial e o seguinte é a retificação, que
// exige o motivo (menos cliques e nenhum envio duplicado por engano).
// Melhoria: o prazo da notificação (dia 15 do mês seguinte à competência, como pede a Anvisa para os indicadores de
// IRAS) é calculado e o formulário sem envio transmitido depois do prazo aparece como atrasado.
// Melhoria: as situações seguem um caminho único (pendente → transcrita ou enviada → aceita ou rejeitada); a rejeição
// exige a mensagem de retorno e o envio transmitido exige a data, que não pode ser futura nem anterior ao fim da
// competência. Nada é apagado: a retificação é um registro novo e cada mudança guarda o retrato no próprio registro.

export const FORMULARIOS_IRAS = [
  'uti_adulto',
  'uti_pediatrica',
  'uti_neonatal',
  'cirurgia',
  'dialise',
  'resistencia_microbiana',
  'consumo_antimicrobiano',
  'consumo_preparacao_alcoolica',
  'outro',
] as const;
export type FormularioIras = (typeof FORMULARIOS_IRAS)[number];

export const SITUACOES_ENVIO_IRAS = ['pendente', 'enviada', 'transcrita', 'aceita', 'rejeitada'] as const;
export type SituacaoEnvioIras = (typeof SITUACOES_ENVIO_IRAS)[number];
export type TipoEnvioIras = 'inicial' | 'retificacao';

/** As situações em que o formulário já chegou ao órgão (com data de envio). */
const TRANSMITIDAS: readonly SituacaoEnvioIras[] = ['enviada', 'transcrita', 'aceita'];

export const MENSAGENS_NOTIFICACAO_IRAS = {
  'competencia-nao-fechada': 'Feche a competência antes de registrar o envio ao órgão sanitário.',
  'formulario-invalido': 'Escolha o formulário do envio.',
  'motivo-retificacao': 'O formulário já tem envio: informe o motivo da retificação (ao menos 5 caracteres).',
  'envio-pendente-aberto': 'Já há um envio pendente deste formulário: registre o andamento dele.',
  'data-envio-obrigatoria': 'Informe a data em que o formulário foi enviado.',
  'data-envio-futura': 'A data do envio não pode ser futura.',
  'data-envio-antes-da-competencia': 'A data do envio deve ser posterior ao último dia da competência.',
  'retorno-sem-mensagem': 'A rejeição exige a mensagem de retorno do órgão.',
  'transicao-invalida': 'Esta mudança de situação não é permitida para o envio.',
} as const;
export type RecusaNotificacaoIras = keyof typeof MENSAGENS_NOTIFICACAO_IRAS;

/** O último dia da competência (AAAA-MM-DD). */
export function fimDaCompetencia(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m, 0));
  return d.toISOString().slice(0, 10);
}

/** O prazo do envio: dia 15 do mês seguinte à competência (AAAA-MM-DD). */
export function prazoDoEnvio(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m, 15));
  return d.toISOString().slice(0, 10);
}

export interface EnvioAnterior {
  readonly formulario: string;
  readonly situacao: SituacaoEnvioIras;
}

export interface EntradaEnvioIras {
  readonly formulario: string;
  /** Pendente (a enviar) ou transcrita (enviado pela pessoa no formulário do órgão). */
  readonly situacao: 'pendente' | 'transcrita';
  readonly enviadoEm: string | null;
  readonly protocolo: string | null;
  readonly motivoRetificacao: string | null;
}

export interface AvaliacaoEnvioIras {
  readonly recusa: RecusaNotificacaoIras | null;
  readonly tipo: TipoEnvioIras;
}

const dia = (v: string) => v.slice(0, 10);

function conferirData(
  enviadoEm: string | null,
  competencia: string,
  hoje: string,
): RecusaNotificacaoIras | null {
  if (!enviadoEm) return 'data-envio-obrigatoria';
  if (dia(enviadoEm) > dia(hoje)) return 'data-envio-futura';
  if (dia(enviadoEm) <= fimDaCompetencia(competencia)) return 'data-envio-antes-da-competencia';
  return null;
}

/** Decide se o envio do formulário pode ser registrado e qual o tipo (inicial ou retificação). */
export function avaliarEnvioIras(
  e: EntradaEnvioIras,
  ctx: {
    readonly competencia: string;
    readonly situacaoCompetencia: string;
    readonly anteriores: readonly EnvioAnterior[];
    readonly hoje: string;
  },
): AvaliacaoEnvioIras {
  const doFormulario = ctx.anteriores.filter((x) => x.formulario === e.formulario);
  const tipo: TipoEnvioIras = doFormulario.length ? 'retificacao' : 'inicial';
  const r = (recusa: RecusaNotificacaoIras | null) => ({ recusa, tipo });
  if (!['fechada', 'enviada'].includes(ctx.situacaoCompetencia)) return r('competencia-nao-fechada');
  if (!(FORMULARIOS_IRAS as readonly string[]).includes(e.formulario)) return r('formulario-invalido');
  if (doFormulario.some((x) => x.situacao === 'pendente')) return r('envio-pendente-aberto');
  if (tipo === 'retificacao' && (e.motivoRetificacao ?? '').trim().length < 5) return r('motivo-retificacao');
  if (e.situacao === 'transcrita') return r(conferirData(e.enviadoEm, ctx.competencia, ctx.hoje));
  return r(null);
}

/** As mudanças de situação permitidas. */
const CAMINHO: Record<SituacaoEnvioIras, readonly SituacaoEnvioIras[]> = {
  pendente: ['transcrita', 'enviada'],
  enviada: ['aceita', 'rejeitada'],
  transcrita: ['aceita', 'rejeitada'],
  aceita: [],
  rejeitada: [],
};

export interface AndamentoEnvioIras {
  readonly situacao: SituacaoEnvioIras;
  readonly enviadoEm: string | null;
  readonly mensagemRetorno: string | null;
}

/** Decide se o envio pode passar à nova situação (com a data, quando transmitido, e a mensagem, quando rejeitado). */
export function avaliarAndamentoIras(
  atual: SituacaoEnvioIras,
  a: AndamentoEnvioIras,
  ctx: { readonly competencia: string; readonly hoje: string; readonly enviadoAntes: string | null },
): RecusaNotificacaoIras | null {
  if (!CAMINHO[atual].includes(a.situacao)) return 'transicao-invalida';
  if (a.situacao === 'transcrita' || a.situacao === 'enviada')
    return conferirData(a.enviadoEm, ctx.competencia, ctx.hoje);
  if (a.situacao === 'rejeitada' && !(a.mensagemRetorno ?? '').trim()) return 'retorno-sem-mensagem';
  if (!ctx.enviadoAntes) return 'data-envio-obrigatoria';
  return null;
}

/** O envio já chegou ao órgão. */
export const transmitido = (s: SituacaoEnvioIras): boolean => TRANSMITIDAS.includes(s);

/**
 * O formulário está atrasado: passou o prazo da competência e o último envio dele não foi transmitido (ou foi
 * rejeitado sem retificação depois).
 */
export function envioAtrasado(competencia: string, hoje: string, ultima: SituacaoEnvioIras | null): boolean {
  if (dia(hoje) <= prazoDoEnvio(competencia)) return false;
  return ultima === null || !transmitido(ultima);
}
