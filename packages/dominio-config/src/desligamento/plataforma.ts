// Regras 5, 6 e 7 do M58 (cap-10 §10.2, §10.7 e §10.13; BRIEF §4.2): a plataforma do banco de cada estabelecimento,
// para o cartão "Plataforma do banco" e para a partida do adaptador.
// - O charset efetivo vem do parâmetro `legado.charset` e tem de casar com o catálogo do banco: NONE (texto CP1252)
//   pede CP1252; UTF8 pede UTF8. O desencontro é recusado na partida (gravar CP1252 num banco UTF-8, ou o contrário,
//   corromperia o texto dos dois sistemas).
// - A entrada sem restrição (`entrada.utf8`) só vale com o banco e o parâmetro em UTF8.
// - Do Firebird 4 em diante as funções externas vêm desligadas (`UdfAccess = None`): cada uma tem de estar habilitada
//   por configuração ou substituída antes da troca do motor.
import {
  FUNCOES_EXTERNAS_ESPERADAS,
  VERSAO_MAIOR_SEM_UDF,
  type CharsetLegado,
  type ResolucaoFuncaoExterna,
} from '@sgh/contratos';

/** "3.0.14" → 3; "5.0.1.1469" → 5; texto fora do formato → erro (nunca adivinhado). */
export function versaoMaior(versaoMotor: string): number {
  const m = /^(\d+)\.\d+/.exec(versaoMotor.trim());
  if (!m) throw new Error(`Versão do motor fora do formato: ${versaoMotor}.`);
  return Number(m[1]);
}

/** O charset do parâmetro que casa com o charset declarado do banco (RDB$DATABASE). */
export function charsetEsperado(charsetBanco: string): CharsetLegado | null {
  const c = charsetBanco.trim().toUpperCase();
  if (c === 'NONE' || c === 'WIN1252') return 'CP1252';
  if (c === 'UTF8' || c === 'UTF-8') return 'UTF8';
  return null;
}

export function charsetConfere(charsetBanco: string, parametro: CharsetLegado): boolean {
  return charsetEsperado(charsetBanco) === parametro;
}

/** A chave `entrada.utf8` pode ligar (regra 6): banco e parâmetro em UTF8. */
export function entradaUtf8Pode(charsetBanco: string, parametro: CharsetLegado): boolean {
  return parametro === 'UTF8' && charsetConfere(charsetBanco, parametro);
}

/**
 * O limite de entrada vale em caracteres (CP1252: 1 byte por caractere) até a conversão; depois, em UTF-8 a coluna
 * guarda o mesmo número de CARACTERES, mas a chave de índice cresce até 4 bytes por caractere (relatório da F3).
 */
export function restricaoEntrada(parametro: CharsetLegado, chaveLigada: boolean): 'cp1252' | 'livre' {
  return parametro === 'UTF8' && chaveLigada ? 'livre' : 'cp1252';
}

export interface FuncaoExternaLida {
  readonly nome: string;
  /** Biblioteca (RDB$MODULE_NAME); null nas funções PSQL. */
  readonly modulo: string | null;
  readonly dependentes: number;
}

export interface FuncaoExternaAvaliada {
  readonly nome: string;
  readonly modulo: string;
  readonly dependentes: number;
  /** Está na lista medida na cópia (uma nova é achado do ensaio). */
  readonly esperada: boolean;
}

/** Só as externas (com biblioteca), em ordem, marcadas contra a lista esperada. */
export function funcoesExternas(lidas: readonly FuncaoExternaLida[]): FuncaoExternaAvaliada[] {
  const esperadas = new Set(FUNCOES_EXTERNAS_ESPERADAS.map((f) => `${f.nome}|${f.modulo}`));
  return lidas
    .filter((f): f is FuncaoExternaLida & { modulo: string } => !!f.modulo)
    .map((f) => ({
      nome: f.nome,
      modulo: f.modulo,
      dependentes: f.dependentes,
      esperada: esperadas.has(`${f.nome}|${f.modulo}`),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

/**
 * As funções que bloqueiam a troca para `versaoAlvo` (regra 5): com o alvo em 4 ou mais, toda externa sem resolução
 * (ou com resolução `pendente`). Abaixo de 4, nenhuma bloqueia.
 */
export function funcoesExternasPendentes(
  externas: readonly FuncaoExternaAvaliada[],
  resolucoes: Readonly<Record<string, ResolucaoFuncaoExterna>>,
  versaoAlvo: number,
): string[] {
  if (versaoAlvo < VERSAO_MAIOR_SEM_UDF) return [];
  return externas.filter((f) => (resolucoes[f.nome] ?? 'pendente') === 'pendente').map((f) => f.nome);
}
