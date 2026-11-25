// Livro de registro de controlados (Portaria SVS/MS 344/1998, arts. 62 a 64; ficha do M29, regra 9; cap-13 CTRL-04;
// DP-47.14): 4 livros, uma página por substância, termos de abertura e de encerramento, guarda de 2 anos, fechado pelo
// farmacêutico responsável; montado das movimentações do estoque feitas em QUALQUER dos dois sistemas. Só substitui o
// livro de hoje depois da aprovação prévia da Vigilância Sanitária (art. 63 §1º): até lá, é relatório de conferência
// (a chave do livro oficial tem esse pré-requisito e não liga sem ele, POL-3). Escrituração semanal (art. 64).
import { saldoPorSubstancia, type ListaPortaria, type MovimentoControlado } from './farmacia-controlado.js';
import { recusa, type RecusaSuprimentos } from './recusa.js';

/**
 * Os 4 livros (D-LIVRO-29, a confirmar com o farmacêutico responsável): entorpecentes (listas A1, A2 e A3),
 * psicotrópicos (B1 e B2), outras de controle especial (C1, C4 e C5) e retinoides e imunossupressores (C2 e C3).
 */
export const LIVROS_CONTROLADOS = [
  { id: 1, titulo: 'Entorpecentes (listas A1, A2 e A3)', listas: ['A1', 'A2', 'A3'] },
  { id: 2, titulo: 'Psicotrópicos (listas B1 e B2)', listas: ['B1', 'B2'] },
  {
    id: 3,
    titulo: 'Outras substâncias de controle especial (listas C1, C4 e C5)',
    listas: ['C1', 'C4', 'C5'],
  },
  { id: 4, titulo: 'Retinoides e imunossupressores (listas C2 e C3)', listas: ['C2', 'C3'] },
] as const satisfies readonly { id: number; titulo: string; listas: readonly ListaPortaria[] }[];

export type IdLivro = (typeof LIVROS_CONTROLADOS)[number]['id'];

/** Guarda mínima do livro e dos documentos (Portaria 344, art. 67: 2 anos). */
export const GUARDA_LIVRO_ANOS = 2;
/** Escrituração semanal (art. 64): o período de uma página fechada não passa de 7 dias. */
export const PERIODO_ESCRITURACAO_DIAS = 7;

export function livroDaLista(lista: ListaPortaria | null): IdLivro | null {
  if (!lista) return null;
  return LIVROS_CONTROLADOS.find((l) => (l.listas as readonly string[]).includes(lista))?.id ?? null;
}

export interface SubstanciaDoLivro {
  readonly item: number;
  readonly nome: string;
  readonly lista: ListaPortaria;
  readonly saldoAnterior: number;
}

export interface PaginaLivro {
  readonly pagina: number;
  readonly item: number;
  readonly nome: string;
  readonly lista: ListaPortaria;
  readonly anterior: number;
  readonly entradas: number;
  readonly saidas: number;
  readonly final: number;
  readonly movimentos: readonly MovimentoControlado[];
}

export interface LivroMontado {
  readonly livro: IdLivro;
  readonly titulo: string;
  readonly inicio: string;
  readonly fim: string;
  readonly termoAbertura: string;
  readonly termoEncerramento: string;
  readonly paginas: readonly PaginaLivro[];
  /** Modo do livro: conferência até a aprovação da VISA (o livro de hoje continua o oficial). */
  readonly modo: 'conferencia' | 'oficial';
}

/** Monta o livro do período: uma página por substância (ordem do nome), com o saldo e os movimentos em ordem. */
export function montarLivro(c: {
  livro: IdLivro;
  inicio: string;
  fim: string;
  substancias: readonly SubstanciaDoLivro[];
  movimentos: readonly MovimentoControlado[];
  estabelecimento: string;
  oficial: boolean;
}): LivroMontado {
  const def = LIVROS_CONTROLADOS.find((l) => l.id === c.livro)!;
  const doLivro = c.substancias
    .filter((s) => (def.listas as readonly string[]).includes(s.lista))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.item - b.item);
  const paginas = doLivro.map((s, k): PaginaLivro => {
    const movs = c.movimentos
      .filter((m) => m.item === s.item && m.data >= c.inicio && m.data <= c.fim)
      .sort((a, b) => a.data.localeCompare(b.data) || a.documento.localeCompare(b.documento));
    const t = saldoPorSubstancia(s.saldoAnterior, movs);
    return { pagina: k + 1, item: s.item, nome: s.nome, lista: s.lista, ...t, movimentos: movs };
  });
  const modo = c.oficial ? 'oficial' : 'conferencia';
  return {
    livro: c.livro,
    titulo: def.titulo,
    inicio: c.inicio,
    fim: c.fim,
    termoAbertura: `Termo de abertura: este livro, de ${paginas.length} página(s) numerada(s), destina-se à escrituração de ${def.titulo.toLowerCase()} de ${c.estabelecimento}, no período de ${c.inicio} a ${c.fim}.${modo === 'conferencia' ? ' Relatório de conferência: não substitui o livro oficial.' : ''}`,
    termoEncerramento: `Termo de encerramento: contém ${paginas.length} página(s), escrituradas de ${c.inicio} a ${c.fim}.`,
    paginas,
    modo,
  };
}

/** Fechar o livro: só o farmacêutico responsável, período até 7 dias, e o oficial só com a chave da VISA. */
export function conferirFechamentoLivro(c: {
  responsavelTecnico: boolean;
  inicio: string;
  fim: string;
  oficial: boolean;
  chaveOficialLigada: boolean;
  jaFechado: boolean;
}): RecusaSuprimentos | null {
  if (!c.responsavelTecnico)
    return recusa('so-responsavel-tecnico', 'Só o farmacêutico responsável fecha o livro de controlados.', [
      'usuario',
    ]);
  if (c.fim < c.inicio) return recusa('periodo-invalido', 'O fim do período é antes do início.', ['fim']);
  const dias = (Date.parse(`${c.fim}T00:00:00Z`) - Date.parse(`${c.inicio}T00:00:00Z`)) / 86_400_000 + 1;
  if (dias > PERIODO_ESCRITURACAO_DIAS)
    return recusa(
      'periodo-maior-que-semana',
      'A escrituração é semanal: feche períodos de até 7 dias (Portaria 344, art. 64).',
      ['fim'],
    );
  if (c.oficial && !c.chaveOficialLigada)
    return recusa(
      'livro-oficial-desligado',
      'O livro informatizado só vale como oficial depois da aprovação prévia da Vigilância Sanitária: feche em modo conferência.',
      ['oficial'],
    );
  if (c.jaFechado) return recusa('livro-fechado', 'Este período já está fechado neste livro.', ['inicio']);
  return null;
}

/** A data até quando o livro fechado é guardado (2 anos depois do fim). */
export function guardaAte(fim: string): string {
  const [a, m, d] = fim.split('-').map(Number) as [number, number, number];
  return `${a + GUARDA_LIVRO_ANOS}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Termo de abertura ou de encerramento do livro fechado (Portaria 344, art. 62): páginas numeradas e emitente. */
export interface TermoDoLivro {
  readonly tipo: 'abertura' | 'encerramento';
  readonly sequencia: 1 | 2;
  readonly paginaInicial: number;
  readonly paginaFinal: number;
}

/**
 * O emitente dos termos: a razão social e o CNPJ do estabelecimento. O livro oficial não fecha sem eles (o termo é
 * peça legal); o de conferência grava os termos quando o cadastro os tem.
 */
export function conferirEmitenteDoLivro(c: {
  razaoSocial: string | null;
  cnpj: string | null;
  oficial: boolean;
}): RecusaSuprimentos | null {
  const completo = !!c.razaoSocial?.trim() && /^\d{14}$/.test(c.cnpj ?? '');
  if (c.oficial && !completo)
    return recusa(
      'estabelecimento-sem-cnpj',
      'O livro oficial leva nos termos a razão social e o CNPJ do estabelecimento: complete o cadastro do estabelecimento.',
      ['estabelecimento'],
    );
  return null;
}

/** Os dois termos do livro fechado: a abertura (sequência 1) e o encerramento (2), da página 1 à última (mínimo 1). */
export function termosDoLivro(paginas: number): readonly [TermoDoLivro, TermoDoLivro] {
  const ultima = Math.max(1, Math.trunc(paginas));
  return [
    { tipo: 'abertura', sequencia: 1, paginaInicial: 1, paginaFinal: ultima },
    { tipo: 'encerramento', sequencia: 2, paginaInicial: 1, paginaFinal: ultima },
  ];
}

/** O termo como ficou gravado no fechamento: é ele, e não o texto montado na hora, que a leitura do livro mostra. */
export interface TermoGravado {
  readonly tipo: 'abertura' | 'encerramento';
  readonly paginaInicial: number;
  readonly paginaFinal: number;
  readonly razaoSocial: string;
  readonly cnpj: string;
  /** Nome do farmacêutico responsável técnico que fechou. */
  readonly responsavel: string;
  /** Data e hora civil da emissão ("AAAA-MM-DDTHH:MM"). */
  readonly emitidoEm: string;
  /** O termo de encerramento do livro oficial cita o conteúdo guardado no arquivo. */
  readonly conteudoGuardado: boolean;
}

/** CNPJ de 14 dígitos com a máscara; outro formato sai como veio. */
export function cnpjFormatado(cnpj: string): string {
  const m = /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/.exec(cnpj);
  return m ? `${m[1]}.${m[2]}.${m[3]}/${m[4]}-${m[5]}` : cnpj;
}

/**
 * O texto do termo gravado (Portaria 344, art. 62): quantas páginas numeradas, de quem é o livro (razão social e
 * CNPJ), o período escriturado, quem responde e quando foi emitido. O de conferência diz que não substitui o oficial.
 */
export function textoDoTermo(
  t: TermoGravado,
  livro: { titulo: string; inicio: string; fim: string; oficial: boolean },
): string {
  const paginas = Math.max(1, t.paginaFinal - t.paginaInicial + 1);
  const br = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
  const emitente = `${t.razaoSocial}, CNPJ ${cnpjFormatado(t.cnpj)}`;
  const assinatura = `Responsável técnico: ${t.responsavel || 'não identificado'}. Emitido em ${br(t.emitidoEm)}.`;
  const corpo =
    t.tipo === 'abertura'
      ? `Termo de abertura: este livro contém ${paginas} página(s), numeradas de ${t.paginaInicial} a ${t.paginaFinal}, e destina-se à escrituração de ${livro.titulo.toLowerCase()} de ${emitente}, no período de ${br(livro.inicio)} a ${br(livro.fim)}.`
      : `Termo de encerramento: este livro, de ${emitente}, contém ${paginas} página(s), numeradas de ${t.paginaInicial} a ${t.paginaFinal}, escrituradas de ${br(livro.inicio)} a ${br(livro.fim)}.${t.conteudoGuardado ? ' O conteúdo fechado está guardado no arquivo do livro.' : ''}`;
  return `${corpo} ${assinatura}${livro.oficial ? '' : ' Relatório de conferência: não substitui o livro oficial.'}`;
}

/** Os termos gravados na ordem do livro: a abertura antes do encerramento. */
export function ordenarTermos<T extends { tipo: string }>(termos: readonly T[]): T[] {
  return [...termos].sort((a, b) => Number(a.tipo !== 'abertura') - Number(b.tipo !== 'abertura'));
}
