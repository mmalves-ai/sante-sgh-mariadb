// M59-F3 (ficha do M59, regra 6; cap-08 §8.16; SBIS-26): a imutabilidade clínica imposta por privilégio. Daqui saem:
//   - a lista gerada das tabelas clínicas do legado (packages/contratos/src/acesso/tabelas-clinicas.gerado.ts), a
//     partir da matriz de cobertura (módulo PEP, naturezas de registro); o spec confere que o arquivo está em dia;
//   - a conferência do repositório: nenhum `DELETE FROM` de tabela clínica no código das portas e serviços (apps e
//     packages) fora das exceções, e nenhum GRANT de DELETE em tabela clínica nas migrações (db/migracoes).
// Melhoria: as operações vêm do próprio código (SQL das portas), não de um catálogo do núcleo antigo.
// Melhoria: os scripts conferidos são as migrações do banco próprio.
// Melhoria: a lista clínica que decide sai do próprio DDL (tabelasClinicasDoModelo: tabelas de registro do paciente
//   dos módulos PEP, INT, CC e SADT, mais a trilha de auditoria); lista vazia é recusa explícita, nunca verde.
// Melhoria: os utilitários de massa de teste (*.spec-util.ts) e o pacote de testes ficam fora da conferência do código.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  CRITERIOS_CLINICOS_MATRIZ,
  EXCECOES_DELETE_CLINICO,
  MODULOS_CLINICOS_MATRIZ,
  NATUREZAS_REGISTRO_CLINICO,
  deleteClinicoProibido,
  telaClinica,
} from '@sgh/contratos';
import { RAIZ } from './privilegios.ts';

export const CAMINHO_MATRIZ = 'planejamento/referencias/matriz-cobertura-1503-tabelas.tsv';
export const CAMINHO_TABELAS_CLINICAS = 'packages/contratos/src/acesso/tabelas-clinicas.gerado.ts';
export const NOME_PASSO_IMUTABILIDADE = '0002_imutabilidade_clinica';

/** Tabelas clínicas do legado pela matriz (módulo clínico, tela do registro e natureza de registro), em ordem. */
export function tabelasClinicasDaMatriz(tsv: string): string[] {
  const [cab, ...linhas] = tsv.split('\n');
  const col = (cab ?? '').split('\t');
  const iT = col.indexOf('tabela');
  const iM = col.indexOf('modulo');
  const iN = col.indexOf('natureza');
  const iF = col.indexOf('tela_funcao');
  if (iT < 0 || iM < 0 || iN < 0 || iF < 0)
    throw new Error(`${CAMINHO_MATRIZ}: cabeçalho sem tabela, modulo, tela_funcao ou natureza.`);
  const criterios = new Map(CRITERIOS_CLINICOS_MATRIZ.map((c) => [c.modulo, c]));
  const naturezas = new Set<string>(NATUREZAS_REGISTRO_CLINICO);
  const saida = new Set<string>();
  for (const l of linhas) {
    const c = l.split('\t');
    const t = c[iT]?.trim();
    const criterio = criterios.get(c[iM]?.trim() ?? '');
    if (t && criterio && naturezas.has(c[iN]?.trim() ?? '') && telaClinica(criterio, c[iF] ?? ''))
      saida.add(t);
  }
  return [...saida].sort();
}

/** O texto exato do arquivo gerado (o spec compara byte a byte). */
export function textoTabelasClinicas(tabelas: readonly string[]): string {
  return [
    '// Gerado por tools/verificadores/src/imutabilidade.ts a partir da matriz de cobertura (M59-F3, regra 6).',
    `// Tabelas dos módulos ${MODULOS_CLINICOS_MATRIZ.join(', ')} (telas do registro) de natureza ${NATUREZAS_REGISTRO_CLINICO.join(', ')}. Não edite à mão:`,
    '// ./pnpm imutabilidade:gerar regrava.',
    'export const TABELAS_CLINICAS_LEGADO: readonly string[] = [',
    ...tabelas.map((t) => `  '${t}',`),
    '];',
    '',
  ].join('\n');
}

export function gerarTabelasClinicas(raiz = RAIZ): string {
  return textoTabelasClinicas(tabelasClinicasDaMatriz(readFileSync(resolve(raiz, CAMINHO_MATRIZ), 'utf8')));
}

export interface AchadoImutabilidade {
  readonly origem: 'operacao' | 'script-sgh';
  readonly onde: string;
  readonly tabela: string;
}

/** Operações a conferir: cada uma com os passos (tabela e ação) que executa. */
export type CatalogoOperacoes = Readonly<
  Record<
    string,
    {
      readonly receita: {
        readonly nome: string;
        readonly passos: readonly { readonly tabela: string; readonly acao: string }[];
      };
    }
  >
>;

const PASTAS_DE_CODIGO = ['apps/api/src', 'apps/worker/src', 'packages'];
const FORA = new Set(['node_modules', 'dist', '.tmp', '__fixtures__', 'testes']);

function arquivosDe(pasta: string, ext: string): string[] {
  let entradas;
  try {
    entradas = readdirSync(pasta, { withFileTypes: true });
  } catch {
    return [];
  }
  return entradas.flatMap((e) =>
    e.isDirectory()
      ? FORA.has(e.name)
        ? []
        : arquivosDe(join(pasta, e.name), ext)
      : e.name.endsWith(ext) && !/\.(spec|test|spec-util)\.ts$/.test(e.name)
        ? [join(pasta, e.name)]
        : [],
  );
}

const DELETE_SQL = /\bDELETE\s+FROM\s+`?([A-Za-z_][A-Za-z0-9_]*)`?/gi;

/** As operações do código: cada arquivo de apps e packages com os `DELETE FROM <tabela>` que o SQL dele contém. */
export function operacoesDoRepositorio(raiz = RAIZ): CatalogoOperacoes {
  const r: Record<string, CatalogoOperacoes[string]> = {};
  for (const pasta of PASTAS_DE_CODIGO)
    for (const arq of arquivosDe(resolve(raiz, pasta), '.ts')) {
      const passos = [...readFileSync(arq, 'utf8').matchAll(DELETE_SQL)].map((m) => ({
        tabela: m[1] ?? '',
        acao: 'DELETE',
      }));
      if (passos.length === 0) continue;
      const nome = relative(raiz, arq);
      r[nome] = { receita: { nome, passos } };
    }
  return r;
}

// ---- tabelas clínicas do modelo próprio (derivadas do DDL) ----

/** Pastas de migração dos módulos clínicos: prontuário (com a enfermagem), internação, centro cirúrgico e SADT. */
export const MODULOS_CLINICOS_DDL = ['06_PEP', '07_INT', '08_CC', '10_SADT'] as const;
/** Colunas que fazem da tabela um registro do paciente (o fato pertence a ele, à passagem ou à internação). */
export const COLUNAS_DO_PACIENTE = ['paciente_id', 'atendimento_id', 'internacao_id'] as const;
/** Tabelas fora dos módulos clínicos que também são imutáveis (o registro de quem fez o quê). */
export const IMUTAVEIS_DO_NUCLEO = ['trilha_auditoria'] as const;
/**
 * Tabelas do modelo com DELETE legítimo, com o motivo (o que se apaga não é registro do paciente). Toda exceção nova
 * entra aqui com o motivo (pedido do lote 05-10: levar a lista para packages/contratos/src/acesso).
 */
export const EXCECOES_DELETE_CLINICO_MODELO: readonly { readonly tabela: string; readonly motivo: string }[] =
  [];

const CRIAR_TABELA = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-z][a-z0-9_]*)`?\s*\(([\s\S]*?)\n\)/gi;

/** As tabelas clínicas declaradas num texto de DDL (registro do paciente), em ordem. */
export function tabelasClinicasDoDdl(sql: string): string[] {
  const saida = new Set<string>();
  for (const m of sql.matchAll(CRIAR_TABELA)) {
    const corpo = m[2] ?? '';
    if (COLUNAS_DO_PACIENTE.some((c) => new RegExp(`^\\s*\`?${c}\`?\\s`, 'm').test(corpo)))
      saida.add((m[1] ?? '').toLowerCase());
  }
  return [...saida].sort();
}

/** As tabelas clínicas do modelo próprio: o DDL dos módulos clínicos em db/migracoes, mais as do núcleo. */
export function tabelasClinicasDoModelo(raiz = RAIZ): string[] {
  const t = new Set<string>(IMUTAVEIS_DO_NUCLEO);
  for (const mod of MODULOS_CLINICOS_DDL)
    for (const arq of arquivosDe(resolve(raiz, 'db/migracoes', mod), '.sql'))
      for (const x of tabelasClinicasDoDdl(readFileSync(arq, 'utf8'))) t.add(x);
  return [...t].sort();
}

/** Recusa explícita: a conferência nunca passa sem tabela clínica reconhecida no modelo. */
export class ErroSemTabelasClinicas extends Error {
  constructor() {
    super(
      `0 tabelas clínicas reconhecidas no modelo (db/migracoes/{${MODULOS_CLINICOS_DDL.join(',')}}): ` +
        'a conferência da imutabilidade recusa em vez de passar vazia.',
    );
    this.name = 'ErroSemTabelasClinicas';
  }
}

/** A decisão por tabela: clínica do modelo (fora das exceções) ou clínica pelo critério do contrato. */
export function decisorDeleteClinico(
  clinicas: readonly string[] = tabelasClinicasDoModelo(),
): (t: string) => boolean {
  const modelo = new Set(clinicas.map((x) => x.toLowerCase()));
  if (modelo.size <= IMUTAVEIS_DO_NUCLEO.length) throw new ErroSemTabelasClinicas();
  const excecoes = new Set(EXCECOES_DELETE_CLINICO_MODELO.map((e) => e.tabela));
  return (tabela) => {
    const t = tabela.trim();
    return (modelo.has(t.toLowerCase()) && !excecoes.has(t.toLowerCase())) || deleteClinicoProibido(t);
  };
}

/** Operações com DELETE em tabela clínica fora das exceções. */
export function operacoesComDeleteClinico(
  ops: CatalogoOperacoes = operacoesDoRepositorio(),
  proibido: (t: string) => boolean = decisorDeleteClinico(),
): AchadoImutabilidade[] {
  return Object.values(ops).flatMap((o) =>
    o.receita.passos
      .filter((p) => p.acao.toUpperCase() === 'DELETE' && proibido(p.tabela))
      .map((p) => ({ origem: 'operacao' as const, onde: o.receita.nome, tabela: p.tabela })),
  );
}

const GRANT =
  /GRANT\s+([^;]*?)\s+ON\s+(?:TABLE\s+)?[`"]?(?:[A-Za-z0-9_]+[`"]?\.[`"]?)?([A-Za-z0-9_]+)[`"]?\s+TO\s+(?:ROLE\s+)?[`"']?[A-Za-z0-9_]+/gi;

/** GRANT de DELETE (ou ALL) em tabela clínica nos scripts (fora das exceções). */
export function grantsDeleteClinicoSgh(
  scripts: readonly { arquivo: string; sql: string }[],
  proibido: (t: string) => boolean = decisorDeleteClinico(),
): AchadoImutabilidade[] {
  const r: AchadoImutabilidade[] = [];
  for (const s of scripts) {
    for (const m of s.sql.matchAll(GRANT)) {
      const acoes = (m[1] ?? '').toUpperCase();
      const tabela = m[2] ?? '';
      if ((/\bDELETE\b/.test(acoes) || /\bALL\b/.test(acoes)) && proibido(tabela))
        r.push({ origem: 'script-sgh', onde: s.arquivo, tabela });
    }
  }
  return r;
}

/** As migrações do banco próprio (db/migracoes/**.sql). */
export function scriptsSghDoRepositorio(raiz = RAIZ): { arquivo: string; sql: string }[] {
  return arquivosDe(resolve(raiz, 'db/migracoes'), '.sql').map((arq) => ({
    arquivo: relative(raiz, arq),
    sql: readFileSync(arq, 'utf8'),
  }));
}

export { EXCECOES_DELETE_CLINICO };
