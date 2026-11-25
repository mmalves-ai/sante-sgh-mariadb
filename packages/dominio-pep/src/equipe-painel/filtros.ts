// Filtros salvos do painel de pacientes do profissional (F3.3, linha 03-PEP L90 da análise): vários por usuário e
// estabelecimento, com nome, um só padrão (o que abre o painel), recortes por unidade, setor, acomodação, leito,
// especialidade, situação e "apenas meus pacientes"; colunas e largura por filtro. Regras puras, sem banco.
import type { ErroRegraPainel } from './regras.js';

export type TipoAtendimentoFiltro =
  'todos' | 'internacao' | 'ambulatorio' | 'urgencia' | 'externo' | 'domiciliar';
export const TIPOS_ATENDIMENTO_FILTRO: readonly TipoAtendimentoFiltro[] = [
  'todos',
  'internacao',
  'ambulatorio',
  'urgencia',
  'externo',
  'domiciliar',
];

export type SituacaoPacienteFiltro = 'em_atendimento' | 'aguardando' | 'alta_prevista' | 'alta' | 'todos';
export const SITUACOES_PACIENTE_FILTRO: readonly SituacaoPacienteFiltro[] = [
  'em_atendimento',
  'aguardando',
  'alta_prevista',
  'alta',
  'todos',
];

export interface FiltroPainel {
  readonly nome: string;
  readonly padrao: boolean;
  readonly tipoAtendimento: TipoAtendimentoFiltro;
  readonly unidade: number | null;
  readonly setor: number | null;
  readonly acomodacao: number | null;
  readonly leito: number | null;
  readonly especialidade: number | null;
  readonly situacao: SituacaoPacienteFiltro | null;
  readonly apenasMeusPacientes: boolean;
}

/** Filtro já gravado do mesmo usuário e estabelecimento (para nome repetido e o padrão único). */
export interface FiltroExistente {
  readonly id: number;
  readonly nome: string;
  readonly padrao: boolean;
}

export const NOME_FILTRO_MAX = 60;

const chaveNome = (n: string) => n.trim().toLocaleLowerCase('pt-BR');

/**
 * Valida o filtro a gravar: nome de 1 a 60 caracteres e único entre os filtros do usuário no estabelecimento (sem
 * diferença de maiúsculas), tipo e situação do catálogo, ids positivos e o leito só com a unidade escolhida (o leito
 * pertence a uma unidade; sem ela o recorte fica ambíguo). `proprio` é o id do filtro alterado (fora da comparação).
 */
export function validarFiltroPainel(
  f: FiltroPainel,
  existentes: readonly FiltroExistente[],
  proprio: number | null,
): ErroRegraPainel[] {
  const erros: ErroRegraPainel[] = [];
  const nome = f.nome.trim();
  if (!nome) erros.push({ campo: 'nome', codigo: 'nome-vazio', mensagem: 'Dê um nome ao filtro.' });
  else if (nome.length > NOME_FILTRO_MAX)
    erros.push({
      campo: 'nome',
      codigo: 'nome-longo',
      mensagem: `O nome passa de ${NOME_FILTRO_MAX} caracteres.`,
    });
  else if (existentes.some((e) => e.id !== proprio && chaveNome(e.nome) === chaveNome(nome)))
    erros.push({ campo: 'nome', codigo: 'nome-repetido', mensagem: 'Você já tem um filtro com esse nome.' });
  if (!TIPOS_ATENDIMENTO_FILTRO.includes(f.tipoAtendimento))
    erros.push({
      campo: 'tipoAtendimento',
      codigo: 'tipo-invalido',
      mensagem: 'Tipo de atendimento inválido.',
    });
  if (f.situacao !== null && !SITUACOES_PACIENTE_FILTRO.includes(f.situacao))
    erros.push({
      campo: 'situacao',
      codigo: 'situacao-invalida',
      mensagem: 'Situação do paciente inválida.',
    });
  for (const campo of ['unidade', 'setor', 'acomodacao', 'leito', 'especialidade'] as const) {
    const v = f[campo];
    if (v !== null && (!Number.isSafeInteger(v) || v <= 0))
      erros.push({ campo, codigo: 'id-invalido', mensagem: 'Escolha um item da lista.' });
  }
  if (f.leito !== null && f.unidade === null)
    erros.push({
      campo: 'leito',
      codigo: 'leito-sem-unidade',
      mensagem: 'Escolha a unidade antes do leito.',
    });
  return erros;
}

/**
 * Quem deixa de ser padrão quando o filtro `escolhido` passa a ser o padrão: os demais marcados. Também serve ao
 * primeiro filtro do usuário, que nasce padrão (`nasceComoPadrao`).
 */
export function filtrosQueDeixamDeSerPadrao(
  existentes: readonly FiltroExistente[],
  escolhido: number,
): number[] {
  return existentes.filter((e) => e.padrao && e.id !== escolhido).map((e) => e.id);
}

export const nasceComoPadrao = (existentes: readonly FiltroExistente[], pedido: boolean): boolean =>
  pedido || !existentes.length;

export interface ColunaDoFiltro {
  readonly coluna: string;
  readonly largura: number | null;
}

export const LARGURA_COLUNA_MIN = 20;
export const LARGURA_COLUNA_MAX = 2000;

/** Colunas de um filtro: do catálogo, sem repetição, no mínimo duas, largura inteira entre 20 e 2000 pixels. */
export function validarColunasDoFiltro(
  colunas: readonly ColunaDoFiltro[],
  catalogo: readonly string[],
): ErroRegraPainel[] {
  const erros: ErroRegraPainel[] = [];
  const ids = colunas.map((c) => c.coluna);
  const fora = ids.filter((c) => !catalogo.includes(c));
  if (fora.length)
    erros.push({
      campo: 'colunas',
      codigo: 'coluna-desconhecida',
      mensagem: `Coluna desconhecida: ${fora.join(', ')}.`,
    });
  if (new Set(ids).size !== ids.length)
    erros.push({ campo: 'colunas', codigo: 'coluna-repetida', mensagem: 'Há coluna repetida.' });
  if (ids.length < 2)
    erros.push({ campo: 'colunas', codigo: 'colunas-minimas', mensagem: 'Escolha pelo menos duas colunas.' });
  const larguraRuim = colunas.filter(
    (c) =>
      c.largura !== null &&
      (!Number.isInteger(c.largura) || c.largura < LARGURA_COLUNA_MIN || c.largura > LARGURA_COLUNA_MAX),
  );
  if (larguraRuim.length)
    erros.push({
      campo: 'colunas',
      codigo: 'largura-invalida',
      mensagem: `Largura entre ${LARGURA_COLUNA_MIN} e ${LARGURA_COLUNA_MAX} pixels: ${larguraRuim.map((c) => c.coluna).join(', ')}.`,
    });
  return erros;
}

/** Linha da lista de pacientes vista pelo filtro (o que a tela tem de cada paciente). */
export interface PacienteDoPainel {
  readonly tipoAtendimento: TipoAtendimentoFiltro | null;
  readonly unidade: number | null;
  readonly setor: number | null;
  readonly acomodacao: number | null;
  readonly leito: number | null;
  readonly especialidade: number | null;
  readonly situacao: SituacaoPacienteFiltro | null;
  /** O usuário é o responsável, está na equipe ou acompanha o paciente. */
  readonly doUsuario: boolean;
}

/** O paciente entra na lista do filtro: cada recorte preenchido precisa bater; nulo e "todos" não recortam. */
export function pacienteNoFiltro(p: PacienteDoPainel, f: FiltroPainel): boolean {
  if (f.tipoAtendimento !== 'todos' && p.tipoAtendimento !== f.tipoAtendimento) return false;
  if (f.situacao !== null && f.situacao !== 'todos' && p.situacao !== f.situacao) return false;
  if (f.apenasMeusPacientes && !p.doUsuario) return false;
  for (const campo of ['unidade', 'setor', 'acomodacao', 'leito', 'especialidade'] as const)
    if (f[campo] !== null && p[campo] !== f[campo]) return false;
  return true;
}
