// Conta do portal do paciente (M50 etapa 1; ficha, seção 5 `portal.criarConta` e regras 1 e 5; cap-07 §7.6; cap-08 §8.3):
// identidade própria em SGH_POR_CONTA (nunca o cadastro de usuários do hospital), nascida de um convite do hospital (o código sai impresso: nenhuma
// mensagem ao paciente até a DP-44 a, e toda mensagem só pela Hal-AI), ativada com senha, aceite dos termos e o segundo
// fator do aplicativo autenticador. Abaixo da idade da conta própria o acesso é só pelo responsável legal. Regras puras:
// sem banco, sem relógio (o "agora" vem de fora), sem aleatoriedade (os bytes vêm de fora).
import type { MotivoBloqueioConta, MotivoEncerramentoConta, SituacaoContaPortal } from '@sgh/contratos';

const ALFABETO_CONVITE = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const HORA_MS = 3_600_000;

/** Código do convite: 12 caracteres sem ambiguidade, de bytes aleatórios (o servidor usa randomBytes). */
export function codigoConvite(bytes: Uint8Array): string {
  if (bytes.length < 12) throw new Error('Bytes insuficientes para o código do convite.');
  return [...bytes.slice(0, 12)].map((b) => ALFABETO_CONVITE[b % ALFABETO_CONVITE.length]).join('');
}

/** Como o código aparece impresso: grupos de 4 com hífen. */
export function formatarConvite(codigo: string): string {
  const c = codigo.toUpperCase().replace(/[\s-]/g, '');
  return [c.slice(0, 4), c.slice(4, 8), c.slice(8, 12)].join('-');
}

export function validadeDoConvite(emitidoEm: Date, horas: number): Date {
  return new Date(emitidoEm.getTime() + horas * HORA_MS);
}

/** Idade em anos completos no dia (datas civis AAAA-MM-DD; nascimento sentinela ou futuro: null). */
export function idadeEm(nascimento: string | null, dia: string): number | null {
  if (!nascimento || !/^\d{4}-\d{2}-\d{2}$/.test(nascimento) || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  if (nascimento <= '1900-01-01' || nascimento > dia) return null;
  const [an, mn, dn] = nascimento.split('-').map(Number) as [number, number, number];
  const [ad, md, dd] = dia.split('-').map(Number) as [number, number, number];
  return ad - an - (md < mn || (md === mn && dd < dn) ? 1 : 0);
}

/** Dia em que a pessoa faz `anos` (29/02 vira 01/03 nos anos não bissextos, como no registro civil). */
export function diaEmQueFaz(nascimento: string, anos: number): string {
  const [a, m, d] = nascimento.split('-').map(Number) as [number, number, number];
  const alvo = new Date(Date.UTC(a + anos, m - 1, d));
  return alvo.toISOString().slice(0, 10);
}

/** Paciente que pode ter conta: ativo no cadastro, sem óbito, não unificado em outro e com idade conhecida. */
export interface PacienteParaConta {
  readonly ativo: boolean;
  readonly obito: boolean;
  /** O cadastro foi unificado em outro (o ID que vale é o do destino). */
  readonly unificadoEmOutro: boolean;
  readonly nascimento: string | null;
}

export type RecusaConvite =
  | 'paciente-inativo'
  | 'obito'
  | 'unificado'
  | 'sem-nascimento'
  | 'menor-sem-conta-propria'
  | 'conta-ja-ativa';

/** Pode emitir o convite? (o convite novo substitui o anterior ainda não usado). */
export function conferirConvite(
  p: PacienteParaConta,
  situacaoAtual: SituacaoContaPortal | null,
  dia: string,
  idadeContaPropria: number,
): RecusaConvite | null {
  if (!p.ativo) return 'paciente-inativo';
  if (p.obito) return 'obito';
  if (p.unificadoEmOutro) return 'unificado';
  const idade = idadeEm(p.nascimento, dia);
  if (idade === null) return 'sem-nascimento';
  if (idade < idadeContaPropria) return 'menor-sem-conta-propria';
  if (situacaoAtual === 'ativa' || situacaoAtual === 'bloqueada') return 'conta-ja-ativa';
  return null;
}

export function mensagemConvite(r: RecusaConvite): string {
  switch (r) {
    case 'paciente-inativo':
      return 'O cadastro do paciente está inativo.';
    case 'obito':
      return 'O cadastro tem óbito registrado.';
    case 'unificado':
      return 'Este cadastro foi unificado em outro: emita o convite pelo cadastro que ficou.';
    case 'sem-nascimento':
      return 'Informe a data de nascimento no cadastro antes de emitir o convite.';
    case 'menor-sem-conta-propria':
      return 'Paciente abaixo da idade da conta própria: o acesso é pelo responsável legal.';
    case 'conta-ja-ativa':
      return 'O paciente já tem conta no portal; para outro aparelho, desbloqueie e refaça o segundo fator.';
  }
}

/** Convite como está guardado (só o resumo do código fica no banco). */
export interface ConviteGuardado {
  readonly validoAte: Date;
  readonly usadoEm: Date | null;
  readonly erradas: number;
}

export type RecusaAtivacao = 'convite-invalido' | 'convite-esgotado';

/**
 * Conferência do convite e da data de nascimento. A recusa é sempre a mesma para o portal (não diz se o código existe,
 * se venceu ou se a data não confere); `convite-esgotado` só bloqueia novas tentativas desse convite.
 */
export function conferirAtivacao(
  convite: ConviteGuardado | null,
  nascimentoDoCadastro: string | null,
  nascimentoInformado: string,
  agora: Date,
  limiteTentativas: number,
): RecusaAtivacao | null {
  if (convite === null) return 'convite-invalido';
  if (convite.erradas >= limiteTentativas) return 'convite-esgotado';
  if (convite.usadoEm !== null || agora > convite.validoAte) return 'convite-invalido';
  if (nascimentoDoCadastro === null || nascimentoDoCadastro !== nascimentoInformado)
    return 'convite-invalido';
  return null;
}

export const MENSAGEM_ATIVACAO_GENERICA =
  'Código ou data de nascimento não conferem, ou o convite venceu. Peça um convite novo na recepção.';

// ── Situação da conta ─────────────────────────────────────────────────────────────────────────────────────────────

export interface ContaPortalRegra {
  readonly situacao: SituacaoContaPortal;
  readonly segundoFatorConfirmado: boolean;
  readonly termosAceitos: boolean;
  readonly bloqueadaAte: Date | null;
}

export type TransicaoConta =
  | { readonly para: 'ativa' }
  | { readonly para: 'bloqueada'; readonly motivo: MotivoBloqueioConta; readonly ate: Date | null }
  | { readonly para: 'desbloqueada' }
  | { readonly para: 'encerrada'; readonly motivo: MotivoEncerramentoConta };

export type RecusaTransicaoConta =
  | 'encerrada'
  | 'sem-segundo-fator'
  | 'sem-termos'
  | 'ja-ativa'
  | 'nao-bloqueada'
  | 'ja-bloqueada'
  | 'convidada-nao-bloqueia';

export function conferirTransicaoConta(c: ContaPortalRegra, t: TransicaoConta): RecusaTransicaoConta | null {
  if (c.situacao === 'encerrada') return 'encerrada';
  switch (t.para) {
    case 'ativa':
      if (c.situacao !== 'convidada') return 'ja-ativa';
      if (!c.termosAceitos) return 'sem-termos';
      if (!c.segundoFatorConfirmado) return 'sem-segundo-fator';
      return null;
    case 'bloqueada':
      if (c.situacao === 'convidada') return 'convidada-nao-bloqueia';
      if (c.situacao === 'bloqueada' && c.bloqueadaAte === null) return 'ja-bloqueada';
      return null;
    case 'desbloqueada':
      return c.situacao === 'bloqueada' ? null : 'nao-bloqueada';
    case 'encerrada':
      return null;
  }
}

/** Situação efetiva agora: o bloqueio por tentativas acaba sozinho no prazo; o por decisão (sem prazo), não. */
export function situacaoEfetiva(c: ContaPortalRegra, agora: Date): SituacaoContaPortal {
  if (c.situacao === 'bloqueada' && c.bloqueadaAte !== null && agora >= c.bloqueadaAte) return 'ativa';
  return c.situacao;
}

/** Pode entrar? (a senha e o código do segundo fator são conferidos pelo serviço; aqui só a situação). */
export function podeEntrar(c: ContaPortalRegra, agora: Date): boolean {
  return situacaoEfetiva(c, agora) === 'ativa' && c.segundoFatorConfirmado;
}

/** Depois de uma entrada errada: o bloqueio por tentativas com prazo (minutos). */
export function bloqueioPorTentativas(
  erradas: number,
  limite: number,
  agora: Date,
  minutos: number,
): { readonly bloquear: boolean; readonly ate: Date | null } {
  if (erradas < limite) return { bloquear: false, ate: null };
  return { bloquear: true, ate: new Date(agora.getTime() + minutos * 60_000) };
}

/** E-mail mascarado para a tela interna e para a conferência do titular (`fu***@ex***.test`). */
export function mascararEmail(email: string | null): string | null {
  if (!email) return null;
  const i = email.lastIndexOf('@');
  if (i <= 0) return '***';
  const usuario = email.slice(0, i);
  const dominio = email.slice(i + 1);
  const j = dominio.lastIndexOf('.');
  const nome = j > 0 ? dominio.slice(0, j) : dominio;
  const sufixo = j > 0 ? dominio.slice(j) : '';
  return `${usuario.slice(0, 2)}***@${nome.slice(0, 2)}***${sufixo}`;
}

/** Primeiro nome para a saudação do portal (nunca o nome completo). */
export function primeiroNome(nome: string | null): string {
  const p = (nome ?? '').trim().split(/\s+/)[0] ?? '';
  if (!p) return '';
  return p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1).toLocaleLowerCase('pt-BR');
}
