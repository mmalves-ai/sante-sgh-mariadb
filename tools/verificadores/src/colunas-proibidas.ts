// Guarda de colunas proibidas (regra 8 da ficha do M09; cap-08 §8.11): credencial de prestador e de
// webservice nunca é lida pelo Sante SGH. Recusa, em SQL de qualquer arquivo versionado de código, as
// colunas de senha, login e certificado de TBTISS, TBTISSWEBSERV e TBCONVEN, e `SELECT *` (ou `t.*`)
// (no código, o SQL das strings; num arquivo `.sql`, cada comando do arquivo inteiro, sem exigir string)
// sobre essas tabelas (que traria as colunas sem nomeá-las). Roda no `pnpm verificar`; o `pnpm
// guardas:legado` do M04 incorpora esta regra (pendência registrada no M09).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Colunas que guardam credencial (conferidas no catálogo RDB$ da cópia `pc` em 2026-10-19). */
export const COLUNAS_PROIBIDAS: Readonly<Record<string, readonly string[]>> = {
  TBTISS: ['SENHA_CERTIFICADO_DIG_WS_TISS', 'CERTIFICADO_DIG_WS_TISS'],
  TBTISSWEBSERV: ['SENHA_PRESTADOR', 'LOGIN_PRESTADOR'],
  TBCONVEN: ['SENHA', 'CPF_RESPONSAVEL_CONVENIO'],
  // M12 (regra 8): login e senha de portal da operadora (códigos de prestador) nunca no SELECT.
  TBCODATI: ['SENHA_PRESTADOR', 'LOGIN_PRESTADOR'],
  // M26 (regra 10): os segredos dos parâmetros do diagnóstico (senha gerencial do laboratório, senha de alterar
  // resultado, o token e o cabeçalho do envio de laudo), a senha do autocadastro do portal antigo e a senha do portal
  // antigo por atendimento: nunca lidos (a tela de parâmetros mostra só o nome do campo oculto).
  SIPARLAB: ['SENHAGERENCIAL'],
  SIPARGER: ['SENHAALTRES'],
  SIPARAMENVIO: ['TOKEN', 'HEADER_WS'],
  TBMEDSOLWEBCAD: ['SENHA'],
  SICADATE: ['SENHA_WEB_PACIENTE'],
  // M34 (seção 5 e cap-12 §12.3): as credenciais das interfaces de equipamento e de laboratório de apoio, do
  // estabelecimento (proxy, assinatura, chaves das integrações Axreg e D4H) e dos bancos externos nunca são lidas nem
  // copiadas: a consulta das interfaces não as declara.
  SITPEQV: ['SENHA_EXPORTACAO', 'USUARIO_FTP', 'SENHA_FTP'],
  TBHOSPIT: [
    'SENHAPROV',
    'USUARIO_PROXY',
    'SENHA_PROXY',
    'AXREG_INSTITUTION_KEY',
    'D4H_API_KEY',
    'SENHA_ASSINATURA',
  ],
  TBINFBANCO: ['SENHA'],
};

/** Nomes genéricos (aparecem noutras tabelas): só proibidos quando a tabela está no mesmo SQL. */
const GENERICAS = new Set(['SENHA', 'TOKEN']);

/**
 * Exceções revisadas: arquivo e motivo. Só consulta de contagem que nunca devolve o valor da coluna.
 * - neutralizacao.ts (M01): confere na cópia, por COUNT(*), que login e senha de prestador foram apagados.
 */
export const EXCECOES: readonly { readonly arquivo: string; readonly motivo: string }[] = [
  {
    arquivo: 'packages/legado/src/copia/neutralizacao.ts',
    motivo: 'M01: conferência da neutralização da cópia só por COUNT(*), sem ler o valor',
  },
];

export interface AchadoColuna {
  readonly arquivo: string;
  readonly linha: number;
  readonly motivo: string;
}

/** Nomes inconfundíveis: proibidos em qualquer SQL, com ou sem a tabela no mesmo texto. */
const SEMPRE = [...new Set(Object.values(COLUNAS_PROIBIDAS).flat())].filter((c) => !GENERICAS.has(c));

// Literais de texto do código (aspas simples, duplas e template), onde vive o SQL.
const LITERAL = /`(?:\\[\s\S]|\$\{[^}]*\}|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g;
const PARECE_SQL = /\b(SELECT|FROM|JOIN|WHERE|UPDATE|INSERT)\b/i;

function linhaDe(conteudo: string, indice: number): number {
  return conteudo.slice(0, indice).split('\n').length;
}

/** Trechos de SQL do arquivo: os literais do código ou, num `.sql`, cada comando separado por `;`. */
function* trechosSql(conteudo: string, arquivo: string): Generator<{ sql: string; indice: number }> {
  if (/\.sql$/i.test(arquivo)) {
    let indice = 0;
    for (const parte of conteudo.split(';')) {
      const ini = indice + (parte.length - parte.trimStart().length);
      if (parte.trim()) yield { sql: parte.trim(), indice: ini };
      indice += parte.length + 1;
    }
    return;
  }
  for (const m of conteudo.matchAll(LITERAL)) yield { sql: m[0], indice: m.index };
}

export function procurarColunasProibidas(conteudo: string, arquivo: string): AchadoColuna[] {
  const achados: AchadoColuna[] = [];
  for (const { sql, indice } of trechosSql(conteudo, arquivo)) {
    if (!PARECE_SQL.test(sql)) continue;
    const excecao =
      EXCECOES.some((e) => e.arquivo === arquivo) &&
      /^.\s*SELECT\s+'[a-z_]+='\s*\|\|\s*COUNT\(\*\)\s+FROM\b/i.test(sql);
    if (excecao) continue;
    const linha = linhaDe(conteudo, indice);
    for (const c of SEMPRE) {
      if (new RegExp(`\\b${c}\\b`, 'i').test(sql))
        achados.push({ arquivo, linha, motivo: `coluna de credencial ${c}` });
    }
    for (const [tabela, colunas] of Object.entries(COLUNAS_PROIBIDAS)) {
      if (!new RegExp(`\\b${tabela}\\b`, 'i').test(sql)) continue;
      if (/\bSELECT\s+(?:FIRST\s+\d+\s+)?(?:DISTINCT\s+)?\*/i.test(sql) || /\b\w+\.\*/.test(sql)) {
        achados.push({
          arquivo,
          linha,
          motivo: `SELECT * sobre ${tabela} (traria as colunas de credencial)`,
        });
      }
      for (const g of colunas.filter((c) => GENERICAS.has(c)))
        if (new RegExp(`(?<![\\w.])(?:\\w+\\.)?${g}\\b(?!_)`, 'i').test(sql))
          achados.push({ arquivo, linha, motivo: `coluna de credencial ${tabela}.${g}` });
    }
  }
  return achados;
}

/** Arquivos de código versionados (a própria guarda e seus testes ficam de fora). */
export function arquivosDeCodigo(raiz: string): string[] {
  const saida = execFileSync('git', ['ls-files', '-z', '--', '*.ts', '*.js', '*.mjs', '*.vue', '*.sql'], {
    cwd: raiz,
    encoding: 'utf8',
  });
  return saida
    .split('\0')
    .filter(Boolean)
    .filter((f) => !/tools\/verificadores\/src\/colunas-proibidas(\.spec)?\.ts$/.test(f))
    .filter((f) => !f.startsWith('packages/legado/src/tipos/'))
    .filter((f) => !f.startsWith('tools/verificadores/src/__fixtures__/guardas/'));
}

function principal(): number {
  const raiz = resolve(import.meta.dirname, '../../..');
  const arquivos = arquivosDeCodigo(raiz);
  const achados = arquivos.flatMap((f) =>
    procurarColunasProibidas(readFileSync(resolve(raiz, f), 'utf8'), f),
  );
  for (const a of achados) console.error(`[colunas-proibidas] ${a.arquivo}:${a.linha}: ${a.motivo}`);
  console.log(
    `[colunas-proibidas] ${arquivos.length} arquivo(s) de código; ${achados.length} uso(s) de coluna de credencial ` +
      `(TBTISS, TBTISSWEBSERV, TBCONVEN) → ${achados.length === 0 ? 'verde' : 'VERMELHO'}`,
  );
  return achados.length === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(principal());
