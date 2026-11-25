// Prontuário de acesso restrito (F8, 03-PEP L93): o pedido de acesso de quem não está autorizado, a decisão de quem
// pode autorizar (pela configuração do estabelecimento), a concessão pelo próprio paciente com a senha dele, e a
// contagem das aberturas contra o limite de cada autorização. Regra pura: sem banco, sem relógio, sem criptografia
// (a senha chega aqui só para conferir a força; o resumo com sal é da porta, LGPD art. 46 e SBIS NGS1).
// Nada se apaga: o pedido muda de situação (pendente -> aprovado/negado/cancelado/expirado), a autorização é revogada
// com motivo e cada abertura fica numerada.

export type Autorizador = 'paciente' | 'medico_responsavel' | 'diretoria_clinica' | 'papel';
export type TipoPedido = 'regular' | 'emergencial';
export type SituacaoPedido = 'pendente' | 'aprovado' | 'negado' | 'expirado' | 'cancelado' | 'revogado';
export type ConcedidaPor = 'equipe_responsavel' | 'paciente' | 'responsavel_legal' | 'administrador';

export interface ConfiguracaoProntuarioRestrito {
  readonly autorizador: Autorizador;
  readonly papelId: number | null;
  readonly validadeHoras: number;
  readonly exigeSenhaPaciente: boolean;
  readonly limiteAcessos: number | null;
  readonly exigeMotivo: boolean;
  readonly avisaResponsavel: boolean;
}

/** Sem configuração gravada: o médico responsável autoriza, por 24 horas, sem limite de aberturas. */
export const CONFIGURACAO_RESTRITO_PADRAO: ConfiguracaoProntuarioRestrito = {
  autorizador: 'medico_responsavel',
  papelId: null,
  validadeHoras: 24,
  exigeSenhaPaciente: false,
  limiteAcessos: null,
  exigeMotivo: true,
  avisaResponsavel: true,
};

export const AUTORIZADORES: readonly Autorizador[] = [
  'paciente',
  'medico_responsavel',
  'diretoria_clinica',
  'papel',
];

export type Erros = Record<string, string>;

export function validarConfiguracaoRestrito(c: ConfiguracaoProntuarioRestrito): Erros {
  const e: Erros = {};
  if (!AUTORIZADORES.includes(c.autorizador)) e['autorizador'] = 'Escolha quem autoriza o acesso.';
  if (c.autorizador === 'papel' && !c.papelId) e['papelId'] = 'Escolha o papel que autoriza o acesso.';
  if (!Number.isInteger(c.validadeHoras) || c.validadeHoras < 1 || c.validadeHoras > 8760)
    e['validadeHoras'] = 'A validade da autorização vai de 1 hora a 1 ano (8760 horas).';
  if (
    c.limiteAcessos !== null &&
    (!Number.isInteger(c.limiteAcessos) || c.limiteAcessos < 1 || c.limiteAcessos > 999)
  )
    e['limiteAcessos'] = 'O limite de aberturas vai de 1 a 999 (ou sem limite).';
  if (c.autorizador === 'paciente' && !c.exigeSenhaPaciente)
    e['exigeSenhaPaciente'] = 'Quando o paciente autoriza, a senha dele é exigida.';
  return e;
}

export const JUSTIFICATIVA_MINIMA = 15;

export interface PedidoNovo {
  readonly tipo: TipoPedido;
  readonly justificativa: string;
  readonly motivoExigeComplemento: boolean;
  readonly motivoAtivo: boolean;
  readonly motivoTipo: string;
  /** O solicitante já tem autorização vigente com aberturas restantes. */
  readonly jaAutorizado: boolean;
  /** Já existe pedido pendente do mesmo solicitante para o paciente. */
  readonly pendenteDoMesmo: boolean;
}

export function validarPedidoAcesso(p: PedidoNovo, c: ConfiguracaoProntuarioRestrito): Erros {
  const e: Erros = {};
  if (!p.motivoAtivo || p.motivoTipo !== 'solicitacao')
    e['motivo'] = 'Escolha um motivo de pedido de acesso ativo.';
  const j = p.justificativa.trim();
  const exige = c.exigeMotivo || p.motivoExigeComplemento || p.tipo === 'emergencial';
  if (exige && j.length < JUSTIFICATIVA_MINIMA)
    e['justificativa'] = `Descreva a justificativa (pelo menos ${JUSTIFICATIVA_MINIMA} caracteres).`;
  if (j.length > 2000) e['justificativa'] = 'A justificativa passa de 2000 caracteres.';
  if (p.jaAutorizado) e['pedido'] = 'Você já tem autorização vigente para este prontuário.';
  if (p.pendenteDoMesmo) e['pedido'] = 'Você já tem um pedido pendente para este paciente.';
  return e;
}

export interface QuemDecide {
  readonly usuarioId: number;
  readonly solicitanteUsuarioId: number;
  /** O profissional de quem decide é o responsável por atendimento do paciente. */
  readonly ehMedicoResponsavel: boolean;
  /** Quem decide tem o papel configurado (vigente). */
  readonly temPapel: boolean;
  /** Administrador da plataforma (pode tudo, ADR 0002). */
  readonly administrador: boolean;
}

/** Quem pode decidir o pedido, pela configuração. Nunca o próprio solicitante. */
export function podeDecidirPedido(
  q: QuemDecide,
  c: ConfiguracaoProntuarioRestrito,
): { ok: true; concedidaPor: ConcedidaPor } | { ok: false; motivo: string } {
  if (q.usuarioId === q.solicitanteUsuarioId)
    return { ok: false, motivo: 'Quem pediu o acesso não decide o próprio pedido.' };
  if (q.administrador) return { ok: true, concedidaPor: 'administrador' };
  switch (c.autorizador) {
    case 'medico_responsavel':
      return q.ehMedicoResponsavel
        ? { ok: true, concedidaPor: 'equipe_responsavel' }
        : { ok: false, motivo: 'Só o médico responsável pelo paciente autoriza este acesso.' };
    case 'papel':
      return q.temPapel
        ? { ok: true, concedidaPor: 'equipe_responsavel' }
        : { ok: false, motivo: 'Só quem tem o papel autorizador configurado decide este pedido.' };
    case 'diretoria_clinica':
      return { ok: true, concedidaPor: 'equipe_responsavel' };
    case 'paciente':
      return { ok: false, motivo: 'Neste estabelecimento quem autoriza é o paciente, com a senha dele.' };
  }
}

export interface DecisaoPedido {
  readonly situacao: SituacaoPedido;
  readonly aprovar: boolean;
  readonly motivoDecisao: string;
}

export function validarDecisaoPedido(d: DecisaoPedido): Erros {
  const e: Erros = {};
  if (d.situacao !== 'pendente') e['situacao'] = 'O pedido já foi decidido ou encerrado.';
  if (!d.aprovar && d.motivoDecisao.trim().length < 5)
    e['motivoDecisao'] = 'Informe o motivo da negativa (pelo menos 5 caracteres).';
  return e;
}

const HORA = 3_600_000;
/** O fim do acesso concedido: o início mais a validade da configuração (instantes ISO locais AAAA-MM-DDTHH:MM:SS). */
export function fimDoAcesso(inicio: string, c: ConfiguracaoProntuarioRestrito): string {
  const t = Date.parse(`${inicio.slice(0, 19)}Z`) + c.validadeHoras * HORA;
  return new Date(t).toISOString().slice(0, 19);
}

/** Pedido pendente além da validade da configuração expira (não decide mais). */
export function pedidoExpirado(
  solicitadoEm: string,
  agora: string,
  c: ConfiguracaoProntuarioRestrito,
): boolean {
  return fimDoAcesso(solicitadoEm, c) <= agora.slice(0, 19);
}

// Senha do paciente: 6 a 12 dígitos, sem repetição nem sequência óbvia. O paciente a define na recepção ou no
// consultório; a porta guarda só o resumo com sal. Cinco erros seguidos bloqueiam por 30 minutos.
export const SENHA_MINIMA = 6;
export const SENHA_MAXIMA = 12;
export const TENTATIVAS_ANTES_DO_BLOQUEIO = 5;
export const BLOQUEIO_MINUTOS = 30;

export function validarSenhaPaciente(senha: string): Erros {
  const e: Erros = {};
  if (!/^\d+$/.test(senha) || senha.length < SENHA_MINIMA || senha.length > SENHA_MAXIMA) {
    e['senha'] = `A senha do paciente tem de ${SENHA_MINIMA} a ${SENHA_MAXIMA} números.`;
    return e;
  }
  const todosIguais = /^(\d)\1+$/.test(senha);
  const dig = [...senha].map(Number);
  const passo = dig[1]! - dig[0]!;
  const sequencia = Math.abs(passo) === 1 && dig.every((d, i) => i === 0 || d - dig[i - 1]! === passo);
  if (todosIguais || sequencia) e['senha'] = 'A senha não pode ser número repetido nem sequência (123456).';
  return e;
}

export interface EstadoSenha {
  readonly tentativasFalhas: number;
  readonly bloqueadaAte: string | null;
}

export function senhaBloqueada(s: EstadoSenha, agora: string): boolean {
  return s.bloqueadaAte !== null && s.bloqueadaAte > agora.slice(0, 19);
}

/** Depois de uma conferência: zera no acerto; no erro conta e bloqueia ao chegar no limite. */
export function aposConferencia(s: EstadoSenha, acertou: boolean, agora: string): EstadoSenha {
  if (acertou) return { tentativasFalhas: 0, bloqueadaAte: null };
  const n = s.tentativasFalhas + 1;
  if (n < TENTATIVAS_ANTES_DO_BLOQUEIO) return { tentativasFalhas: n, bloqueadaAte: null };
  const ate = new Date(Date.parse(`${agora.slice(0, 19)}Z`) + BLOQUEIO_MINUTOS * 60_000)
    .toISOString()
    .slice(0, 19);
  return { tentativasFalhas: 0, bloqueadaAte: ate };
}

export interface AutorizacaoVigente {
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly revogadaEm: string | null;
  readonly acessosRealizados: number;
  readonly limiteAcessos: number | null;
}

export type ResultadoAcesso =
  | { readonly permitido: true; readonly numero: number; readonly restantes: number | null }
  | {
      readonly permitido: false;
      readonly motivo: 'sem-autorizacao' | 'fora-da-vigencia' | 'revogada' | 'limite-atingido';
      readonly mensagem: string;
    };

/** A abertura do prontuário restrito pela autorização: vigente, não revogada e dentro do limite de aberturas. */
export function avaliarAbertura(a: AutorizacaoVigente | null, agora: string): ResultadoAcesso {
  const t = agora.slice(0, 19);
  if (!a)
    return {
      permitido: false,
      motivo: 'sem-autorizacao',
      mensagem: 'Prontuário restrito: peça o acesso e aguarde a autorização.',
    };
  if (a.revogadaEm !== null)
    return { permitido: false, motivo: 'revogada', mensagem: 'A autorização foi revogada.' };
  if (a.vigenciaInicio.slice(0, 19) > t || (a.vigenciaFim !== null && a.vigenciaFim.slice(0, 19) <= t))
    return { permitido: false, motivo: 'fora-da-vigencia', mensagem: 'A autorização não está vigente.' };
  if (a.limiteAcessos !== null && a.acessosRealizados >= a.limiteAcessos)
    return {
      permitido: false,
      motivo: 'limite-atingido',
      mensagem: `O limite de ${a.limiteAcessos} aberturas desta autorização foi atingido: peça novo acesso.`,
    };
  const numero = a.acessosRealizados + 1;
  return {
    permitido: true,
    numero,
    restantes: a.limiteAcessos === null ? null : a.limiteAcessos - numero,
  };
}
