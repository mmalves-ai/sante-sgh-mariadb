// Regulação de entrada (C1-080, 02-REC linha 38): o pedido que a central de regulação manda para este hospital
// (paciente regulado para cá). Regras puras:
//   - o recebimento: número como a central emite, prioridade e tipo do pedido, data do pedido não futura e, na
//     emergência e na urgência, o resumo clínico que a central mandou (a equipe decide sobre ele);
//   - a resposta: só sobre o pedido ainda não respondido (recebido ou em análise); aceitar autoriza e, no pedido de
//     consulta, exame ou cirurgia, põe o paciente na lista de espera da especialidade; recusar exige o motivo
//     padronizado (e o complemento quando o motivo é "outro"), e a recusa encerra o pedido;
//   - a fila dos recebidos: emergência primeiro, depois urgência, prioridade e eletivo; dentro da prioridade, o mais
//     antigo primeiro;
//   - a devolução à central leva só IDs e códigos (nunca nome, documento ou texto clínico).
// Prática das centrais (SISREG e centrais estaduais): registro manual do número da central e motivo padronizado.
import { FORMATO_NUMERO_REGULACAO } from '@sgh/contratos';

export const PRIORIDADES_REGULACAO_ENTRADA = ['emergencia', 'urgente', 'prioritario', 'eletivo'] as const;
export type PrioridadeRegulacaoEntrada = (typeof PRIORIDADES_REGULACAO_ENTRADA)[number];

export const TIPOS_REGULACAO_ENTRADA = [
  'internacao',
  'transferencia',
  'consulta',
  'exame',
  'cirurgia',
] as const;
export type TipoRegulacaoEntrada = (typeof TIPOS_REGULACAO_ENTRADA)[number];

/** Pedidos que, aceitos, entram na lista de espera da especialidade (o leito segue pelo NIR). */
export const TIPOS_COM_LISTA_ESPERA: readonly TipoRegulacaoEntrada[] = ['consulta', 'exame', 'cirurgia'];

export const MOTIVOS_RECUSA_REGULACAO = [
  { codigo: 'sem_leito_compativel', rotulo: 'Sem leito compatível disponível', exigeComplemento: false },
  { codigo: 'sem_especialidade', rotulo: 'Especialidade não atendida no hospital', exigeComplemento: false },
  { codigo: 'sem_recurso', rotulo: 'Sem equipamento ou recurso necessário', exigeComplemento: false },
  {
    codigo: 'perfil_incompativel',
    rotulo: 'Perfil clínico fora do perfil do hospital',
    exigeComplemento: false,
  },
  { codigo: 'informacao_insuficiente', rotulo: 'Informação clínica insuficiente', exigeComplemento: true },
  { codigo: 'paciente_ja_atendido', rotulo: 'Paciente já atendido ou internado', exigeComplemento: false },
  { codigo: 'outro', rotulo: 'Outro motivo', exigeComplemento: true },
] as const;
export type MotivoRecusaRegulacao = (typeof MOTIVOS_RECUSA_REGULACAO)[number]['codigo'];
export const CODIGOS_MOTIVO_RECUSA_REGULACAO = MOTIVOS_RECUSA_REGULACAO.map((m) => m.codigo) as [
  MotivoRecusaRegulacao,
  ...MotivoRecusaRegulacao[],
];

/** Situações do pedido recebido que ainda pedem resposta. */
export const SITUACOES_A_RESPONDER = ['solicitada', 'em_analise'] as const;

export interface ProblemaRegulacaoEntrada {
  readonly campo: string;
  readonly mensagem: string;
}

const COMPLEMENTO_MINIMO = 10;
const RESUMO_MINIMO = 10;
const TOLERANCIA_FUTURO_MS = 5 * 60_000;

export interface RecebimentoRegulacao {
  readonly numero: string;
  readonly tipo: string;
  readonly prioridade: string;
  readonly solicitadoEm: Date;
  readonly agora: Date;
  readonly resumoClinico: string | null;
}

/** O pedido recebido da central: o que falta ou está errado (lista vazia: pode gravar). */
export function conferirRecebimentoRegulacao(r: RecebimentoRegulacao): ProblemaRegulacaoEntrada[] {
  const p: ProblemaRegulacaoEntrada[] = [];
  if (!FORMATO_NUMERO_REGULACAO.test(r.numero.trim().toUpperCase()))
    p.push({
      campo: 'numero',
      mensagem: 'Número da central de 4 a 30 letras, dígitos, ponto, barra ou hífen.',
    });
  if (!(TIPOS_REGULACAO_ENTRADA as readonly string[]).includes(r.tipo))
    p.push({ campo: 'tipo', mensagem: 'Escolha o tipo do pedido.' });
  if (!(PRIORIDADES_REGULACAO_ENTRADA as readonly string[]).includes(r.prioridade))
    p.push({ campo: 'prioridade', mensagem: 'Escolha a prioridade que a central deu.' });
  if (Number.isNaN(r.solicitadoEm.getTime()))
    p.push({ campo: 'solicitadoEm', mensagem: 'Informe quando a central fez o pedido.' });
  else if (r.solicitadoEm.getTime() > r.agora.getTime() + TOLERANCIA_FUTURO_MS)
    p.push({ campo: 'solicitadoEm', mensagem: 'O pedido da central não pode estar no futuro.' });
  if (
    (r.prioridade === 'emergencia' || r.prioridade === 'urgente') &&
    (r.resumoClinico ?? '').trim().length < RESUMO_MINIMO
  )
    p.push({
      campo: 'resumoClinico',
      mensagem: 'Na emergência e na urgência, registre o resumo clínico que a central mandou.',
    });
  return p;
}

export interface RespostaRegulacao {
  readonly situacao: string;
  readonly tipo: string;
  readonly decisao: 'aceitar' | 'recusar';
  readonly motivo: string | null;
  readonly complemento: string | null;
  readonly especialidade: number | null;
}

export type ResultadoRespostaRegulacao =
  | {
      readonly ok: true;
      readonly situacao: 'autorizada' | 'negada';
      readonly listaEspera: boolean;
      readonly encerra: boolean;
      readonly texto: string;
    }
  | { readonly ok: false; readonly problemas: readonly ProblemaRegulacaoEntrada[] };

export function motivoRecusaDe(codigo: string | null) {
  return MOTIVOS_RECUSA_REGULACAO.find((m) => m.codigo === codigo) ?? null;
}

/** A resposta do hospital ao pedido recebido: a situação nova, se entra na lista de espera e o texto à central. */
export function conferirRespostaRegulacao(r: RespostaRegulacao): ResultadoRespostaRegulacao {
  const p: ProblemaRegulacaoEntrada[] = [];
  if (!(SITUACOES_A_RESPONDER as readonly string[]).includes(r.situacao))
    return {
      ok: false,
      problemas: [{ campo: 'situacao', mensagem: 'Este pedido já foi respondido ou encerrado.' }],
    };
  const complemento = (r.complemento ?? '').trim();
  if (r.decisao === 'recusar') {
    const m = motivoRecusaDe(r.motivo);
    if (!m) p.push({ campo: 'motivo', mensagem: 'Escolha o motivo da recusa.' });
    else if (m.exigeComplemento && complemento.length < COMPLEMENTO_MINIMO)
      p.push({
        campo: 'complemento',
        mensagem: `Detalhe o motivo da recusa (mínimo de ${COMPLEMENTO_MINIMO} caracteres).`,
      });
    if (p.length) return { ok: false, problemas: p };
    return {
      ok: true,
      situacao: 'negada',
      listaEspera: false,
      encerra: true,
      texto: complemento ? `${m!.rotulo}: ${complemento}` : m!.rotulo,
    };
  }
  if (r.motivo !== null) p.push({ campo: 'motivo', mensagem: 'O motivo padronizado é só da recusa.' });
  const lista = (TIPOS_COM_LISTA_ESPERA as readonly string[]).includes(r.tipo);
  if (lista && r.especialidade === null)
    p.push({
      campo: 'especialidade',
      mensagem: 'Escolha a especialidade da lista de espera em que o paciente entra.',
    });
  if (p.length) return { ok: false, problemas: p };
  return {
    ok: true,
    situacao: 'autorizada',
    listaEspera: lista,
    encerra: false,
    texto: complemento ? `Pedido aceito: ${complemento}` : 'Pedido aceito',
  };
}

/** A prioridade da lista de espera que corresponde à prioridade dada pela central. */
export function prioridadeListaEsperaDe(p: string | null): 'urgente' | 'preferencial' | 'normal' {
  if (p === 'emergencia' || p === 'urgente') return 'urgente';
  if (p === 'prioritario') return 'preferencial';
  return 'normal';
}

/** A fila dos recebidos: os que pedem resposta primeiro, por prioridade e, dentro dela, o mais antigo. */
export function ordenarRecebidosRegulacao<
  T extends { readonly situacao: string; readonly prioridade: string | null; readonly solicitadoEm: string },
>(itens: readonly T[]): T[] {
  const aberto = (s: string) => ((SITUACOES_A_RESPONDER as readonly string[]).includes(s) ? 0 : 1);
  const rank = (p: string | null) => {
    const i = (PRIORIDADES_REGULACAO_ENTRADA as readonly string[]).indexOf(p ?? '');
    return i < 0 ? PRIORIDADES_REGULACAO_ENTRADA.length : i;
  };
  return [...itens].sort(
    (a, b) =>
      aberto(a.situacao) - aberto(b.situacao) ||
      (aberto(a.situacao) === 0 ? rank(a.prioridade) - rank(b.prioridade) : 0) ||
      (aberto(a.situacao) === 0
        ? a.solicitadoEm.localeCompare(b.solicitadoEm)
        : b.solicitadoEm.localeCompare(a.solicitadoEm)),
  );
}

/** A carga da devolução à central: só IDs e códigos. */
export function cargaDevolucaoRegulacao(x: {
  readonly solicitacao: number;
  readonly numero: string;
  readonly situacao: 'autorizada' | 'negada';
  readonly motivo: string | null;
}): Record<string, string | number | null> {
  return {
    solicitacao: x.solicitacao,
    numero: x.numero,
    resposta: x.situacao === 'autorizada' ? 'aceito' : 'recusado',
    motivo: x.motivo,
  };
}
