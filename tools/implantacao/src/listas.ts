// M60, etapa 1 (entrega 2), refeito sobre o banco próprio: o anexo do manual de implantação com as MIGRAÇÕES do banco
// do cliente, geradas do repositório na hora do pacote (nunca desatualiza): arquivo, etapa, sha256 e comandos, na
// ordem em que o comando "criar novo cliente" (tools/db/criar_cliente.py) as aplica: todas as tabelas, depois todas as
// chaves, cada etapa pela ordem do caminho.
// Melhoria: a lista sai das migrações do banco próprio (db/migracoes), não dos scripts de convivência com o sistema de
//   origem; a etapa (tabelas ou chaves) vai no anexo, e a contagem de comandos ignora os comentários.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const PASTA_MIGRACOES = 'db/migracoes';
export type EtapaMigracao = 'tabelas' | 'chaves';
const ETAPAS: readonly EtapaMigracao[] = ['tabelas', 'chaves'];
const ARQUIVO_MIGRACAO = /_(tabelas|chaves)\.sql$/;

export interface MigracaoBanco {
  /** Caminho relativo a db/migracoes (ex.: `12_FAT/01_tabelas.sql`). */
  readonly arquivo: string;
  readonly etapa: EtapaMigracao;
  readonly hash: string;
  readonly comandos: number;
}

export interface ItemListaMigracoes {
  /** Posição na ordem de aplicação, a partir de 1. */
  readonly ordem: number;
  readonly arquivo: string;
  readonly etapa: EtapaMigracao;
  readonly sha256: string;
  readonly comandos: number;
}

/** Comandos SQL de um arquivo: o que termina em `;` no fim da linha, sem as linhas de comentário. */
export function contarComandos(sql: string): number {
  const semComentario = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  return semComentario.split(/;[ \t]*(?:\r?\n|$)/).filter((x) => x.trim() !== '').length;
}

/** Lê as migrações do repositório (`<raiz>/db/migracoes/<pasta>/<nn>_*tabelas|chaves.sql`). */
export function lerMigracoes(raiz: string): MigracaoBanco[] {
  const base = join(raiz, PASTA_MIGRACOES);
  const r: MigracaoBanco[] = [];
  for (const pasta of readdirSync(base).sort()) {
    if (!statSync(join(base, pasta)).isDirectory()) continue;
    for (const nome of readdirSync(join(base, pasta)).sort()) {
      const m = ARQUIVO_MIGRACAO.exec(nome);
      if (!m) continue;
      const texto = readFileSync(join(base, pasta, nome), 'utf8');
      r.push({
        arquivo: `${pasta}/${nome}`,
        etapa: m[1] as EtapaMigracao,
        hash: createHash('sha256').update(texto).digest('hex'),
        comandos: contarComandos(texto),
      });
    }
  }
  return r;
}

const porCaminho = (a: MigracaoBanco, b: MigracaoBanco) =>
  a.arquivo < b.arquivo ? -1 : a.arquivo > b.arquivo ? 1 : 0;

/** A ordem do "criar novo cliente": todas as tabelas, depois todas as chaves; em cada etapa, pelo caminho. */
export function ordemDeAplicacao(migracoes: readonly MigracaoBanco[]): MigracaoBanco[] {
  return ETAPAS.flatMap((e) => migracoes.filter((m) => m.etapa === e).sort(porCaminho));
}

export function listaDeMigracoes(migracoes: readonly MigracaoBanco[]): ItemListaMigracoes[] {
  return ordemDeAplicacao(migracoes).map((m, k) => ({
    ordem: k + 1,
    arquivo: m.arquivo,
    etapa: m.etapa,
    sha256: m.hash,
    comandos: m.comandos,
  }));
}

/** Anexo em Markdown: ordem, arquivo (em db/migracoes/), etapa, sha256 completo e comandos. */
export function anexoDeMigracoes(itens: readonly ItemListaMigracoes[]): string {
  return [
    '# Anexo: migrações do banco do cliente',
    '',
    '<!-- Gerado por `pnpm implantacao:listas`; não edite à mão. -->',
    '',
    `São ${itens.length} arquivos de \`db/migracoes/\`, na ordem em que o comando "criar novo cliente" os aplica:`,
    'primeiro todas as tabelas, depois todas as chaves estrangeiras, cada etapa pela ordem do caminho. Um arquivo com',
    'hash diferente do listado não é o do pacote homologado.',
    '',
    '| ordem | arquivo | etapa | sha256 | comandos |',
    '|---:|---|---|---|---:|',
    ...itens.map((i) => `| ${i.ordem} | \`${i.arquivo}\` | ${i.etapa} | \`${i.sha256}\` | ${i.comandos} |`),
    '',
  ].join('\n');
}

/** Migrações do repositório que o anexo não cita, e hashes do anexo que não batem. */
export function conferirAnexo(
  texto: string,
  itens: readonly ItemListaMigracoes[],
): { faltam: string[]; hashDivergente: string[] } {
  const faltam = itens.filter((i) => !texto.includes(`\`${i.arquivo}\``)).map((i) => i.arquivo);
  const hashDivergente = itens
    .filter((i) => texto.includes(`\`${i.arquivo}\``) && !texto.includes(i.sha256))
    .map((i) => i.arquivo);
  return { faltam, hashDivergente };
}
