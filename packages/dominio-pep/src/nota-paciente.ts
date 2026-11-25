// Notas e lembretes livres sobre o paciente (03-PEP L102). Regras puras: o que uma nota nova precisa ter, quem a vê,
// quando ela está em vigor e quais passos ela aceita. A nota é registro do prontuário: nunca é apagada nem tem o texto
// reescrito; corrigir é cancelar com motivo (só o autor) e escrever outra. O lembrete cumprido é encerrado por quem o
// vê; a validade (data em que deixa de aparecer) só o autor muda, e só para a frente.
//
// Visibilidade: 'autor' só o profissional que escreveu; 'equipe' quem atende no mesmo estabelecimento; 'todos' toda a
// rede do cliente. O tipo pode marcar a nota como alerta ao abrir o prontuário (só enquanto em vigor).
import type { FalhaRegra } from './farmacovigilancia.js';

export const VISIBILIDADES_NOTA = ['autor', 'equipe', 'todos'] as const;
export type VisibilidadeNota = (typeof VISIBILIDADES_NOTA)[number];
export type SituacaoNota = 'ativa' | 'encerrada' | 'cancelada';
/** A situação mostrada: a nota ativa com a validade passada aparece como vencida (o banco segue 'ativa'). */
export type SituacaoExibidaNota = SituacaoNota | 'vencida';
export const ACOES_NOTA = ['encerrar', 'cancelar', 'prorrogar'] as const;
export type AcaoNota = (typeof ACOES_NOTA)[number];

export const TEXTO_NOTA_MAXIMO = 4000;
/** Validade mais longa aceita para um lembrete (dois anos): além disso, a nota fica sem validade. */
export const VALIDADE_MAXIMA_DIAS = 730;
export const MOTIVO_CANCELAMENTO_MINIMO = 5;
/** Onde o texto pronto pode ser usado como base de uma nota do paciente. */
export const APLICACOES_TEXTO_NOTA = ['nota_paciente', 'geral'] as const;

const falha = (codigo: string, mensagem: string): FalhaRegra => ({ codigo, mensagem });
const DIA = 86_400_000;

export interface TextoProntoNota {
  readonly ativo: boolean;
  readonly aplicacao: string;
  /** Nulo = vale para toda a rede. */
  readonly estabelecimentoId: number | null;
  /** Nulo = texto geral; preenchido = texto pessoal do profissional. */
  readonly profissionalId: number | null;
}

export interface NovaNota {
  readonly texto: string;
  readonly validaAte: Date | null;
  readonly tipoAtivo: boolean | null;
  readonly predefinida: TextoProntoNota | null;
  readonly estabelecimento: number;
  readonly autor: number | null;
}

/** O que a nota nova precisa ter: autor profissional, tipo ativo, texto, validade futura e texto pronto utilizável. */
export function validarNovaNota(n: NovaNota, agora: Date): FalhaRegra[] {
  const f: FalhaRegra[] = [];
  if (n.autor === null)
    f.push(falha('usuario-sem-profissional', 'A nota exige um profissional ligado à conta da sessão.'));
  if (n.tipoAtivo === null)
    f.push(falha('tipo-invalido', 'O tipo de nota escolhido não existe no cadastro.'));
  else if (!n.tipoAtivo) f.push(falha('tipo-inativo', 'O tipo de nota escolhido está inativo.'));
  const texto = n.texto.trim();
  if (!texto) f.push(falha('texto-obrigatorio', 'Escreva o texto da nota.'));
  else if (texto.length > TEXTO_NOTA_MAXIMO)
    f.push(falha('texto-longo', `O texto da nota passa de ${TEXTO_NOTA_MAXIMO} caracteres.`));
  f.push(...validarValidade(n.validaAte, agora));
  if (n.predefinida) f.push(...validarTextoPronto(n.predefinida, n.estabelecimento, n.autor));
  return f;
}

/** A validade, quando informada, fica no futuro e até o limite de dois anos. */
export function validarValidade(validaAte: Date | null, agora: Date): FalhaRegra[] {
  if (!validaAte) return [];
  if (Number.isNaN(validaAte.getTime())) return [falha('validade-invalida', 'A validade não é uma data.')];
  if (validaAte.getTime() <= agora.getTime())
    return [falha('validade-passada', 'A validade do lembrete precisa ser uma data futura.')];
  if (validaAte.getTime() > agora.getTime() + VALIDADE_MAXIMA_DIAS * DIA)
    return [
      falha(
        'validade-longa',
        `A validade passa de ${VALIDADE_MAXIMA_DIAS} dias: deixe a nota sem validade se ela vale sempre.`,
      ),
    ];
  return [];
}

/** O texto pronto precisa estar ativo, servir para nota do paciente, ser do estabelecimento (ou da rede) e, se pessoal, do autor. */
export function validarTextoPronto(
  t: TextoProntoNota,
  estabelecimento: number,
  autor: number | null,
): FalhaRegra[] {
  if (!t.ativo) return [falha('texto-pronto-inativo', 'O texto pronto escolhido está inativo.')];
  if (!(APLICACOES_TEXTO_NOTA as readonly string[]).includes(t.aplicacao))
    return [falha('texto-pronto-outra-aplicacao', 'O texto pronto escolhido não é para notas do paciente.')];
  if (t.estabelecimentoId !== null && t.estabelecimentoId !== estabelecimento)
    return [falha('texto-pronto-outro-estabelecimento', 'O texto pronto é de outro estabelecimento.')];
  if (t.profissionalId !== null && t.profissionalId !== autor)
    return [falha('texto-pronto-de-outro-profissional', 'O texto pronto é pessoal de outro profissional.')];
  return [];
}

export interface NotaParaLeitura {
  readonly visibilidade: VisibilidadeNota | string;
  readonly autorProfissionalId: number;
  readonly estabelecimentoId: number;
}
export interface LeitorNota {
  readonly profissional: number | null;
  readonly estabelecimento: number;
}

/** Quem vê a nota: o autor sempre; 'equipe' quem está no mesmo estabelecimento; 'todos' toda a rede do cliente. */
export function notaVisivel(n: NotaParaLeitura, l: LeitorNota): boolean {
  if (l.profissional !== null && l.profissional === n.autorProfissionalId) return true;
  if (n.visibilidade === 'todos') return true;
  if (n.visibilidade === 'equipe') return n.estabelecimentoId === l.estabelecimento;
  return false;
}

/** A situação que a tela mostra: a ativa com a validade passada é 'vencida'. */
export function situacaoExibidaNota(
  n: { situacao: SituacaoNota | string; validaAte: Date | null },
  agora: Date,
): SituacaoExibidaNota {
  if (n.situacao === 'ativa' && n.validaAte && n.validaAte.getTime() <= agora.getTime()) return 'vencida';
  return n.situacao as SituacaoNota;
}

/** A nota do tipo marcado como alerta aparece ao abrir o prontuário só enquanto em vigor. */
export function notaAlerta(
  n: { situacao: SituacaoNota | string; validaAte: Date | null; exibeComoAlerta: boolean },
  agora: Date,
): boolean {
  return n.exibeComoAlerta && situacaoExibidaNota(n, agora) === 'ativa';
}

export interface PassoNota {
  readonly acao: AcaoNota;
  readonly situacao: SituacaoNota | string;
  readonly ehAutor: boolean;
  readonly motivo?: string | null;
  readonly validaAte?: Date | null;
}

/**
 * Os passos da nota: encerrar (lembrete cumprido; quem vê a nota, só a ativa), cancelar (só o autor, com motivo; a
 * ativa ou a encerrada) e prorrogar (só o autor, só a ativa, validade nova no futuro ou sem validade).
 */
export function passoNota(p: PassoNota, agora: Date): { falhas: FalhaRegra[]; situacaoNova: SituacaoNota } {
  const atual = p.situacao as SituacaoNota;
  if (atual === 'cancelada')
    return { falhas: [falha('nota-cancelada', 'A nota já foi cancelada.')], situacaoNova: atual };
  if (p.acao === 'encerrar') {
    if (atual !== 'ativa')
      return { falhas: [falha('nota-encerrada', 'A nota já está encerrada.')], situacaoNova: atual };
    return { falhas: [], situacaoNova: 'encerrada' };
  }
  if (!p.ehAutor)
    return {
      falhas: [
        falha(
          'nota-de-outro-autor',
          p.acao === 'cancelar' ? 'Só o autor cancela a nota.' : 'Só o autor muda a validade da nota.',
        ),
      ],
      situacaoNova: atual,
    };
  if (p.acao === 'cancelar') {
    if ((p.motivo ?? '').trim().length < MOTIVO_CANCELAMENTO_MINIMO)
      return {
        falhas: [
          falha(
            'motivo-obrigatorio',
            `Informe o motivo do cancelamento (pelo menos ${MOTIVO_CANCELAMENTO_MINIMO} caracteres).`,
          ),
        ],
        situacaoNova: atual,
      };
    return { falhas: [], situacaoNova: 'cancelada' };
  }
  if (atual !== 'ativa')
    return {
      falhas: [falha('nota-encerrada', 'Só a nota ativa tem a validade mudada.')],
      situacaoNova: atual,
    };
  return { falhas: validarValidade(p.validaAte ?? null, agora), situacaoNova: 'ativa' };
}
