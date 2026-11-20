// Verificador `treino-sem-dado-real` (M37, regra 5; cap-09 §9.12; cap-15 §15.4.2): o ambiente de treino é usado por
// terceiros e não pode ter dado de pessoa real. Procura CPF, CNS e telefone VÁLIDOS (dígitos verificadores do CPF,
// soma do CNS, DDD e formato do telefone brasileiro) fora da lista sintética (tools/verificadores/dados/
// treino-sinteticos.txt) e falha se achar. Modos:
//   - padrão: o material e a massa do treino versionados (guias e roteiros gerados das jornadas, as portas em memória
//     da sessão sintética, a massa sintética dos testes e as jornadas E2E): é a massa do treino até o dono registrar o
//     método de mascaramento (DP-41; ficha do M37, seção 14);
//   - `--textos=<arquivo>`: um arquivo de texto (uma linha por valor) extraído do banco de treino pelo `pnpm
//     treino:reiniciar` (só as colunas pessoais declaradas, na infraestrutura da Rede; o arquivo é apagado depois).
// A saída só diz o arquivo, a linha e o tipo do achado; nunca o valor.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export type TipoAchado = 'CPF' | 'CNS' | 'telefone';
export interface AchadoTreino {
  readonly arquivo: string;
  readonly linha: number;
  readonly tipo: TipoAchado;
}

const digitos = (s: string) => s.replace(/\D/g, '');

export function cpfValido(valor: string): boolean {
  const c = digitos(valor);
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (b: string) => {
    let soma = 0;
    for (let i = 0; i < b.length; i++) soma += Number(b[i]) * (b.length + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(c.slice(0, 9)) === Number(c[9]) && dv(c.slice(0, 10)) === Number(c[10]);
}

/** CNS (Cartão Nacional de Saúde): 15 dígitos; definitivo começa com 1 ou 2, provisório com 7, 8 ou 9; soma ponderada múltipla de 11. */
export function cnsValido(valor: string): boolean {
  const c = digitos(valor);
  if (!/^[12789]\d{14}$/.test(c) || /^(\d)\1{14}$/.test(c)) return false;
  let soma = 0;
  for (let i = 0; i < 15; i++) soma += Number(c[i]) * (15 - i);
  return soma % 11 === 0;
}

/** DDDs em uso no Brasil (Anatel). */
const DDD = new Set(
  [
    11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45,
    46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83,
    84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
  ].map(String),
);

/** Telefone brasileiro com DDD: celular (9 + 8 dígitos) ou fixo (2 a 5 + 7 dígitos); repetidos não contam. */
export function telefoneValido(valor: string): boolean {
  let c = digitos(valor);
  if (c.startsWith('55') && (c.length === 12 || c.length === 13)) c = c.slice(2);
  if (c.length !== 10 && c.length !== 11) return false;
  if (!DDD.has(c.slice(0, 2))) return false;
  const n = c.slice(2);
  if (/^(\d)\1+$/.test(n)) return false;
  return n.length === 9 ? n[0] === '9' : /^[2-5]/.test(n);
}

const CANDIDATOS: readonly (readonly [RegExp, TipoAchado, (v: string) => boolean])[] = [
  [/(?<![\d.\-/])\d{3}\.\d{3}\.\d{3}-\d{2}(?![\d])|(?<![\d.\-/])\d{11}(?![\d.\-/])/g, 'CPF', cpfValido],
  [/(?<![\d.\-/])[12789]\d{2}\s?\d{4}\s?\d{4}\s?\d{4}(?![\d])/g, 'CNS', cnsValido],
  [
    /\(\d{2}\)\s?9?\d{4}-?\d{4}|(?<![\d.])\+?55\s?\d{2}\s?9?\d{4}-?\d{4}(?![\d])|(?<![\d.])\d{2}\s9?\d{4}-\d{4}(?![\d])/g,
    'telefone',
    telefoneValido,
  ],
];

/** Os achados de um texto (fora da lista sintética). */
export function procurarDadoReal(
  texto: string,
  arquivo: string,
  sinteticos: ReadonlySet<string> = new Set(),
): AchadoTreino[] {
  const r: AchadoTreino[] = [];
  texto.split('\n').forEach((linha, i) => {
    for (const [re, tipo, valido] of CANDIDATOS)
      for (const m of linha.matchAll(re)) {
        const v = digitos(m[0]);
        if (valido(m[0]) && !sinteticos.has(v)) r.push({ arquivo, linha: i + 1, tipo });
      }
  });
  return r;
}

export function lerSinteticos(arquivo: string): Set<string> {
  if (!existsSync(arquivo)) return new Set();
  return new Set(
    readFileSync(arquivo, 'utf8')
      .split('\n')
      .map((l) => l.replace(/#.*$/, '').trim())
      .filter(Boolean)
      .map(digitos),
  );
}

/** Os arquivos da massa e do material do treino (modo padrão). */
export const PASTAS_DO_TREINO = [
  'docs/prontidao/treinamento',
  'packages/testes/src/massa',
  'apps/web/e2e',
] as const;
const ARQUIVOS_DO_TREINO = /(?:porta-memoria|fonte-sintetica|estado-sintetico|memoria)\.ts$/;

function listar(pasta: string): string[] {
  if (!existsSync(pasta)) return [];
  const r: string[] = [];
  for (const n of readdirSync(pasta)) {
    const c = join(pasta, n);
    if (statSync(c).isDirectory()) r.push(...listar(c));
    else if (/\.(ts|md|json|txt|csv)$/.test(n)) r.push(c);
  }
  return r;
}

export function arquivosDoTreino(raiz: string): string[] {
  const r = PASTAS_DO_TREINO.flatMap((p) => listar(resolve(raiz, p)));
  r.push(...listar(resolve(raiz, 'apps/api/src/modulos')).filter((a) => ARQUIVOS_DO_TREINO.test(a)));
  return [...new Set(r)].filter((a) => !a.endsWith('.spec.ts')).sort();
}

function principal(): number {
  const raiz = resolve(import.meta.dirname, '../../..');
  const arg = process.argv.slice(2).find((a) => a.startsWith('--textos='));
  const sinteticos = lerSinteticos(resolve(raiz, 'tools/verificadores/dados/treino-sinteticos.txt'));
  const arquivos = arg ? [resolve(arg.slice(9))] : arquivosDoTreino(raiz);
  const achados = arquivos.flatMap((a) =>
    procurarDadoReal(readFileSync(a, 'utf8'), relative(raiz, a), sinteticos),
  );
  for (const a of achados)
    console.error(`  ${a.arquivo}:${a.linha}: ${a.tipo} válido fora da lista sintética`);
  console.log(
    `[treino-sem-dado-real] ${arquivos.length} arquivo(s); ${achados.length} achado(s) → ${achados.length === 0 ? 'verde' : 'vermelho'}`,
  );
  return achados.length === 0 ? 0 : 1;
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) process.exit(principal());
