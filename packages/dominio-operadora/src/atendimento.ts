// Regras puras do atendimento ao beneficiário com protocolo da operadora própria (M56, etapa 8 de 8, fatia F7; ficha,
// seções 1, 6 e 7; cap-07 §7.4; normas da ANS sobre o atendimento das solicitações dos beneficiários, a ouvidoria e a
// notificação de intermediação preliminar):
//   - o protocolo é dado na hora do contato, com a mesma montagem e a mesma sequência da autorização de guias
//     (`protocoloAtendimento`): o número não se repete entre os dois;
//   - o prazo da resposta conclusiva pela instância e pela classe da demanda, em dias úteis (parâmetros que a diretoria
//     da operadora confirma, D-PRAZO-PROT-568): imediato na urgência e no pedido de cancelamento do contrato; a ouvidoria
//     prorroga uma vez, até o limite, com o motivo acordado;
//   - a conferência do registro (beneficiário, quem fez o contato, canal e instância, NIP, ligação com o pedido de
//     autorização e com o protocolo de origem da reanálise);
//   - a resposta (a demanda assistencial tem resposta conclusiva; negar no todo ou em parte pede o fundamento), a resposta
//     por escrito no prazo em horas, o encerramento e as ações que valem em cada situação;
//   - o texto da resposta por escrito e as regras puras do acesso ao portal do prestador (funções liberáveis, tentativas,
//     bloqueio e validade do código de ativação).
import {
  type AcaoProtocolo,
  type CanalProtocolo,
  type ClasseProtocolo,
  type ConclusaoProtocolo,
  FUNCAO_PORTAL,
  FUNCOES_PORTAL_LIBERAVEIS,
  type InstanciaProtocolo,
  NATUREZAS_ASSISTENCIAIS,
  type NaturezaProtocolo,
  ROTULOS_CONCLUSAO_PROTOCOLO,
  ROTULOS_INSTANCIA_PROTOCOLO,
  ROTULOS_NATUREZA_PROTOCOLO,
  type SituacaoProtocoloOpe,
  SITUACOES_PROTOCOLO_OPE_EM_ABERTO,
  type SolicitanteProtocolo,
  type TipoPrazoProtocolo,
  protocoloLegivel,
} from '@sgh/contratos';
import { type Problema, somarDiasUteis } from './autorizacao.js';

/** Parâmetros dos prazos (a diretoria da operadora confirma; D-PRAZO-PROT-568). */
export const PARAMETROS_PROTOCOLO = {
  /** Dias úteis da resposta à demanda assistencial (cobertura, reembolso, reclamação à saúde). */
  diasUteisAssistencial: 5,
  /** Dias úteis da resposta ao pedido de cobertura de alta complexidade. */
  diasUteisComplexo: 10,
  /** Dias úteis da resposta à demanda não assistencial. */
  diasUteisNaoAssistencial: 7,
  /** Dias úteis da resposta da ouvidoria. */
  diasUteisOuvidoria: 7,
  /** Limite, em dias úteis do registro, da prorrogação acordada na ouvidoria. */
  diasUteisOuvidoriaMaximo: 30,
  /** Dias úteis da resposta à NIP assistencial e à não assistencial. */
  diasUteisNipAssistencial: 5,
  diasUteisNipNaoAssistencial: 10,
  /** Horas para a resposta por escrito, contadas da resposta (ou do pedido, se vier depois). */
  horasEscrita: 24,
} as const;
export type ParametrosProtocolo = { readonly [K in keyof typeof PARAMETROS_PROTOCOLO]: number };

const instante = (v: string): string => v.slice(0, 19).replace(' ', 'T');
const fimDoDia = (d: string): string => `${d.slice(0, 10)}T23:59:59`;

/** A classe da demanda (dá o prazo). */
export const classeDaNatureza = (n: NaturezaProtocolo): ClasseProtocolo =>
  NATUREZAS_ASSISTENCIAIS.includes(n) ? 'assistencial' : 'nao-assistencial';

/**
 * O prazo da resposta conclusiva: a NIP pelo prazo da ANS; a ouvidoria pelo dela; no atendimento, imediato na urgência
 * e no cancelamento do contrato, e em dias úteis nas demais (até o fim do N-ésimo dia útil).
 */
export function prazoDoProtocolo(
  p: {
    readonly instancia: InstanciaProtocolo;
    readonly natureza: NaturezaProtocolo;
    readonly urgente: boolean;
    readonly altaComplexidade: boolean;
  },
  agora: string,
  parametros: ParametrosProtocolo = PARAMETROS_PROTOCOLO,
): { tipo: TipoPrazoProtocolo; prazoEm: string } {
  const em = instante(agora);
  const classe = classeDaNatureza(p.natureza);
  const uteis = (tipo: TipoPrazoProtocolo, dias: number) => ({
    tipo,
    prazoEm: fimDoDia(somarDiasUteis(em, dias)),
  });
  if (p.instancia === 'nip')
    return classe === 'assistencial'
      ? uteis('nip-assistencial', parametros.diasUteisNipAssistencial)
      : uteis('nip-nao-assistencial', parametros.diasUteisNipNaoAssistencial);
  if (p.instancia === 'ouvidoria') return uteis('ouvidoria', parametros.diasUteisOuvidoria);
  if ((p.urgente && classe === 'assistencial') || p.natureza === 'cancelamento')
    return { tipo: 'imediato', prazoEm: em };
  if (classe === 'assistencial')
    return p.altaComplexidade && p.natureza === 'cobertura'
      ? uteis('complexo', parametros.diasUteisComplexo)
      : uteis('assistencial', parametros.diasUteisAssistencial);
  return uteis('nao-assistencial', parametros.diasUteisNaoAssistencial);
}

/** O prazo que vale: o prorrogado, se houver. */
export const prazoVigente = (p: {
  readonly prazoEm: string;
  readonly prorrogadoAte: string | null;
}): string => p.prorrogadoAte ?? p.prazoEm;

/** Em aberto e com o prazo vencido no instante. */
export function protocoloVencido(
  p: {
    readonly situacao: SituacaoProtocoloOpe;
    readonly prazoEm: string;
    readonly prorrogadoAte: string | null;
  },
  agora: string,
): boolean {
  return (
    SITUACOES_PROTOCOLO_OPE_EM_ABERTO.includes(p.situacao) && instante(agora) > instante(prazoVigente(p))
  );
}

// ── Registro ─────────────────────────────────────────────────────────────────────────────────────

export interface RegistroProtocoloConferir {
  readonly instancia: InstanciaProtocolo;
  readonly natureza: NaturezaProtocolo;
  readonly canal: CanalProtocolo;
  readonly solicitante: SolicitanteProtocolo;
  readonly carteirinha: string | null;
  readonly solicitanteNome: string | null;
  readonly numeroNip: string | null;
  readonly urgente: boolean;
  readonly altaComplexidade: boolean;
  readonly temAutorizacao: boolean;
  readonly temOrigemProtocolo: boolean;
}

/** As recusas do registro que não dependem do banco (o banco confere beneficiário, guia e origem depois). */
export function conferirRegistroProtocolo(r: RegistroProtocoloConferir): Problema[] {
  const p: Problema[] = [];
  const classe = classeDaNatureza(r.natureza);
  if (!r.carteirinha) {
    if (r.natureza !== 'informacao' || r.solicitante !== 'outro')
      p.push({
        codigo: r.natureza === 'informacao' ? 'sem-beneficiario-so-informacao' : 'carteirinha-obrigatoria',
        campo: 'carteirinha',
      });
  }
  if (r.solicitante !== 'beneficiario' && r.solicitante !== 'ans' && !r.solicitanteNome)
    p.push({ codigo: 'solicitante-nome-obrigatorio', campo: 'solicitanteNome' });
  if (r.instancia === 'nip') {
    if (r.canal !== 'ans' || r.solicitante !== 'ans') p.push({ codigo: 'canal-da-ans', campo: 'canal' });
    if (!r.numeroNip) p.push({ codigo: 'nip-sem-numero', campo: 'numeroNip' });
  } else {
    if (r.canal === 'ans' || r.solicitante === 'ans') p.push({ codigo: 'ans-so-na-nip', campo: 'canal' });
    if (r.numeroNip) p.push({ codigo: 'numero-nip-so-na-nip', campo: 'numeroNip' });
  }
  if ((r.canal === 'portal-prestador') !== (r.solicitante === 'prestador'))
    p.push({ codigo: 'portal-so-prestador', campo: 'canal' });
  if (r.urgente && classe !== 'assistencial') p.push({ codigo: 'urgente-so-assistencial', campo: 'urgente' });
  if (r.altaComplexidade && r.natureza !== 'cobertura')
    p.push({ codigo: 'complexidade-so-cobertura', campo: 'altaComplexidade' });
  if (r.temAutorizacao && r.natureza !== 'cobertura')
    p.push({ codigo: 'autorizacao-so-cobertura', campo: 'autorizacao' });
  if (r.temOrigemProtocolo && r.instancia !== 'ouvidoria')
    p.push({ codigo: 'origem-so-ouvidoria', campo: 'origemProtocolo' });
  return p;
}

/** O protocolo de origem da reanálise: respondido ou encerrado, do atendimento, sem outra reanálise em aberto. */
export function conferirOrigemDaReanalise(o: {
  readonly instancia: InstanciaProtocolo;
  readonly situacao: SituacaoProtocoloOpe;
  readonly reanaliseEmAberto: boolean;
}): Problema[] {
  if (o.instancia === 'ouvidoria') return [{ codigo: 'reanalise-da-ouvidoria' }];
  if (o.situacao !== 'respondido' && o.situacao !== 'encerrado')
    return [{ codigo: 'origem-protocolo-sem-resposta' }];
  if (o.reanaliseEmAberto) return [{ codigo: 'reanalise-ja-aberta' }];
  return [];
}

// ── Prorrogação, resposta e escrita ──────────────────────────────────────────────────────────────

/** Até quando a ouvidoria pode prorrogar (null quando não pode). */
export function prorrogavelAte(
  p: {
    readonly instancia: InstanciaProtocolo;
    readonly situacao: SituacaoProtocoloOpe;
    readonly abertoEm: string;
    readonly prorrogadoAte: string | null;
  },
  parametros: ParametrosProtocolo = PARAMETROS_PROTOCOLO,
): string | null {
  if (
    p.instancia !== 'ouvidoria' ||
    p.prorrogadoAte ||
    !SITUACOES_PROTOCOLO_OPE_EM_ABERTO.includes(p.situacao)
  )
    return null;
  return fimDoDia(somarDiasUteis(instante(p.abertoEm), parametros.diasUteisOuvidoriaMaximo));
}

export function conferirProrrogacao(
  p: {
    readonly instancia: InstanciaProtocolo;
    readonly situacao: SituacaoProtocoloOpe;
    readonly abertoEm: string;
    readonly prazoEm: string;
    readonly prorrogadoAte: string | null;
  },
  ate: string,
  parametros: ParametrosProtocolo = PARAMETROS_PROTOCOLO,
): { problemas: Problema[]; prorrogadoAte: string } {
  const novo = fimDoDia(ate);
  if (p.instancia !== 'ouvidoria')
    return { problemas: [{ codigo: 'prorrogacao-so-ouvidoria' }], prorrogadoAte: novo };
  if (p.prorrogadoAte) return { problemas: [{ codigo: 'prorrogacao-ja-feita' }], prorrogadoAte: novo };
  if (!SITUACOES_PROTOCOLO_OPE_EM_ABERTO.includes(p.situacao))
    return { problemas: [{ codigo: 'situacao-nao-permite' }], prorrogadoAte: novo };
  const limite = prorrogavelAte(p, parametros) as string;
  if (novo <= instante(p.prazoEm))
    return { problemas: [{ codigo: 'prorrogacao-antes-do-prazo', campo: 'ate' }], prorrogadoAte: novo };
  if (novo > limite)
    return { problemas: [{ codigo: 'prorrogacao-acima-do-limite', campo: 'ate' }], prorrogadoAte: novo };
  return { problemas: [], prorrogadoAte: novo };
}

export function conferirResposta(r: {
  readonly natureza: NaturezaProtocolo;
  readonly conclusao: ConclusaoProtocolo;
  readonly fundamento: string | null;
}): Problema[] {
  const p: Problema[] = [];
  if (r.conclusao === 'informativa' && classeDaNatureza(r.natureza) === 'assistencial')
    p.push({ codigo: 'informativa-so-nao-assistencial', campo: 'conclusao' });
  if ((r.conclusao === 'desfavoravel' || r.conclusao === 'parcial') && !r.fundamento)
    p.push({ codigo: 'fundamento-obrigatorio', campo: 'fundamento' });
  return p;
}

const somarHoras = (em: string, horas: number): string => {
  const d = new Date(`${instante(em)}Z`);
  d.setUTCHours(d.getUTCHours() + horas);
  return d.toISOString().slice(0, 19);
};

/** O prazo da resposta por escrito: N horas da resposta, ou do pedido, se o pedido vier depois. */
export function prazoDaEscrita(
  respondidoEm: string,
  pedidaEm: string,
  parametros: ParametrosProtocolo = PARAMETROS_PROTOCOLO,
): string {
  const base = instante(pedidaEm) > instante(respondidoEm) ? pedidaEm : respondidoEm;
  return somarHoras(base, parametros.horasEscrita);
}

export interface ProtocoloParaAcoes {
  readonly instancia: InstanciaProtocolo;
  readonly situacao: SituacaoProtocoloOpe;
  readonly conclusao: ConclusaoProtocolo | null;
  readonly abertoEm: string;
  readonly prazoEm: string;
  readonly prorrogadoAte: string | null;
  readonly escritaPedida: boolean;
  readonly escritaPrazoEm: string | null;
  readonly escritaEnviadaEm: string | null;
  readonly reanaliseEmAberto: boolean;
}

export const escritaPendente = (p: Pick<ProtocoloParaAcoes, 'escritaPedida' | 'escritaEnviadaEm'>): boolean =>
  p.escritaPedida && !p.escritaEnviadaEm;

export function escritaVencida(
  p: Pick<ProtocoloParaAcoes, 'escritaPedida' | 'escritaEnviadaEm' | 'escritaPrazoEm'>,
  agora: string,
): boolean {
  return escritaPendente(p) && !!p.escritaPrazoEm && instante(agora) > instante(p.escritaPrazoEm);
}

/** As situações de partida de cada ação (o banco confere de novo na gravação). */
export const PARTIDA_DA_ACAO: Readonly<Record<AcaoProtocolo, readonly SituacaoProtocoloOpe[]>> = {
  analisar: ['aberto'],
  interagir: ['aberto', 'em-analise', 'respondido'],
  prorrogar: ['aberto', 'em-analise'],
  responder: ['aberto', 'em-analise'],
  pedirEscrita: ['aberto', 'em-analise', 'respondido'],
  enviarEscrita: ['respondido'],
  encerrar: ['respondido'],
  cancelar: ['aberto', 'em-analise'],
  reanalise: ['respondido', 'encerrado'],
};

/** As ações que valem agora, na ordem da tela. */
export function acoesDoProtocolo(
  p: ProtocoloParaAcoes,
  parametros: ParametrosProtocolo = PARAMETROS_PROTOCOLO,
): AcaoProtocolo[] {
  const a: AcaoProtocolo[] = [];
  const vale = (x: AcaoProtocolo) => PARTIDA_DA_ACAO[x].includes(p.situacao);
  if (vale('analisar')) a.push('analisar');
  if (vale('interagir')) a.push('interagir');
  if (vale('prorrogar') && prorrogavelAte(p, parametros)) a.push('prorrogar');
  if (vale('responder')) a.push('responder');
  if (vale('pedirEscrita') && !p.escritaPedida) a.push('pedirEscrita');
  if (vale('enviarEscrita') && escritaPendente(p)) a.push('enviarEscrita');
  if (vale('encerrar') && !escritaPendente(p)) a.push('encerrar');
  if (vale('cancelar')) a.push('cancelar');
  if (
    vale('reanalise') &&
    p.instancia === 'atendimento' &&
    (p.conclusao === 'desfavoravel' || p.conclusao === 'parcial') &&
    !p.reanaliseEmAberto
  )
    a.push('reanalise');
  return a;
}

/** A ação vale na situação (e no estado da escrita)? Senão, o código da recusa. */
export function recusaDaAcao(p: ProtocoloParaAcoes, acao: AcaoProtocolo): string | null {
  if (acoesDoProtocolo(p).includes(acao)) return null;
  if (acao === 'prorrogar') {
    if (p.instancia !== 'ouvidoria') return 'prorrogacao-so-ouvidoria';
    if (p.prorrogadoAte) return 'prorrogacao-ja-feita';
  }
  if (acao === 'pedirEscrita' && p.escritaPedida) return 'escrita-ja-pedida';
  if (acao === 'enviarEscrita' && p.situacao === 'respondido') return 'escrita-nao-pedida';
  if (acao === 'enviarEscrita' && SITUACOES_PROTOCOLO_OPE_EM_ABERTO.includes(p.situacao))
    return 'escrita-antes-da-resposta';
  if (acao === 'encerrar' && p.situacao === 'respondido') return 'escrita-pendente';
  if (acao === 'reanalise') {
    if (p.instancia !== 'atendimento') return 'reanalise-da-ouvidoria';
    if (p.reanaliseEmAberto) return 'reanalise-ja-aberta';
  }
  return 'situacao-nao-permite';
}

const dataBr = (v: string): string => `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;

/**
 * O texto da resposta por escrito, em linguagem clara: o protocolo, a demanda, a data, a conclusão, o fundamento e, na
 * resposta desfavorável ou parcial do atendimento, o direito à reanálise pela ouvidoria.
 */
export function textoDaRespostaEscrita(x: {
  readonly operadoraNome: string;
  readonly registroAns: string;
  readonly protocolo: string;
  readonly instancia: InstanciaProtocolo;
  readonly natureza: NaturezaProtocolo;
  readonly abertoEm: string;
  readonly assunto: string;
  readonly conclusao: ConclusaoProtocolo;
  readonly resposta: string;
  readonly fundamento: string | null;
  readonly respondidoEm: string;
}): string {
  const linhas = [
    `${x.operadoraNome} (registro na ANS ${x.registroAns})`,
    `${ROTULOS_INSTANCIA_PROTOCOLO[x.instancia]}: protocolo ${protocoloLegivel(x.protocolo)}, aberto em ${dataBr(x.abertoEm)}.`,
    `Demanda: ${ROTULOS_NATUREZA_PROTOCOLO[x.natureza]}. Assunto: ${x.assunto}.`,
    `Resposta de ${dataBr(x.respondidoEm)}: ${ROTULOS_CONCLUSAO_PROTOCOLO[x.conclusao]}.`,
    x.resposta,
  ];
  if (x.fundamento) linhas.push(`Fundamento: ${x.fundamento.replace(/[.\s]+$/, '')}.`);
  if (x.instancia === 'atendimento' && (x.conclusao === 'desfavoravel' || x.conclusao === 'parcial'))
    linhas.push(
      'Se não concordar, você pode pedir a reanálise desta resposta à ouvidoria da operadora, informando este protocolo.',
    );
  return linhas.join('\n');
}

// ── Portal do prestador ──────────────────────────────────────────────────────────────────────────

/** Parâmetros do acesso ao portal (D-PORTAL-ACESSO-568). */
export const PARAMETROS_PORTAL_PRESTADOR = {
  /** Horas de validade do código de ativação. */
  horasAtivacao: 72,
  /** Tentativas erradas seguidas antes do bloqueio. */
  tentativas: 5,
  /** Minutos de bloqueio depois das tentativas erradas. */
  minutosBloqueio: 15,
  /** Minutos da sessão do portal. */
  minutosSessao: 20,
} as const;

/** As funções liberadas: só as liberáveis, que existam no domínio do banco; cancelar exige solicitar. */
export function conferirFuncoesPortal(funcoes: readonly number[], doDominio: readonly number[]): Problema[] {
  const p: Problema[] = [];
  if (funcoes.some((f) => !doDominio.includes(f))) p.push({ codigo: 'funcao-inexistente', campo: 'funcoes' });
  else if (funcoes.some((f) => !(FUNCOES_PORTAL_LIBERAVEIS as readonly number[]).includes(f)))
    p.push({ codigo: 'funcao-nao-liberavel', campo: 'funcoes' });
  if (funcoes.includes(FUNCAO_PORTAL.cancelar) && !funcoes.includes(FUNCAO_PORTAL.solicitar))
    p.push({ codigo: 'cancelar-sem-solicitar', campo: 'funcoes' });
  return p;
}

/** As funções em ordem e sem repetição (o texto guardado: "1,3,7"). */
export const funcoesNormalizadas = (funcoes: readonly number[]): number[] =>
  [...new Set(funcoes)].sort((a, b) => a - b);
export const funcoesDoTexto = (t: string | null): number[] =>
  (t ?? '')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isInteger(x) && x > 0);

export const validadeDaAtivacao = (
  agora: string,
  horas: number = PARAMETROS_PORTAL_PRESTADOR.horasAtivacao,
) => somarHoras(agora, horas);

/** Bloqueado agora? */
export const acessoBloqueado = (bloqueadoAte: string | null, agora: string): boolean =>
  !!bloqueadoAte && instante(bloqueadoAte) > instante(agora);

/** O efeito da tentativa: o acerto zera; o erro soma e, no limite, bloqueia (e zera a conta). */
export function depoisDaTentativaPortal(
  tentativas: number,
  acertou: boolean,
  agora: string,
  parametros: { readonly tentativas: number; readonly minutosBloqueio: number } = PARAMETROS_PORTAL_PRESTADOR,
): { tentativas: number; bloqueadoAte: string | null } {
  if (acertou) return { tentativas: 0, bloqueadoAte: null };
  const t = tentativas + 1;
  if (t < parametros.tentativas) return { tentativas: t, bloqueadoAte: null };
  const d = new Date(`${instante(agora)}Z`);
  d.setUTCMinutes(d.getUTCMinutes() + parametros.minutosBloqueio);
  return { tentativas: 0, bloqueadoAte: d.toISOString().slice(0, 19) };
}

/** As iniciais do nome (o portal mostra só isto do beneficiário). */
export const iniciaisDoNome = (nome: string): string =>
  nome
    .trim()
    .split(/\s+/)
    .filter((x) => x && !/^(da|de|do|das|dos|e)$/i.test(x))
    .map((x) => `${x[0]?.toUpperCase() ?? ''}.`)
    .join(' ');
