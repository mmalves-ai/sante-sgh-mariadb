// Partida dos testes de integração do lote 05-13 (publicador de catálogos e glosa do financeiro) contra o MariaDB
// real, no cliente de teste f22_o5. Massa sintética (códigos fo513*, f22o513*); nenhuma pessoa real.
// SGH_NUCLEO_SEM_BANCO=1 pula os arquivos.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { conferirNome, type Escritor, type NucleoProprio } from '@sgh/nucleo';

export const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
export const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
export const raiz = resolve(import.meta.dirname, '../../../..');

/** Cria o cliente de teste se faltar (o criador recusa cliente existente: consulta antes). */
export function garantirCliente(): void {
  const lista = execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', '--listar'], { cwd: raiz, encoding: 'utf8' });
  if (!new RegExp(`\\b${CLIENTE}\\b`).test(lista))
    execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', CLIENTE, 'Teste F2.2 onda 5'], { cwd: raiz });
}

export function escrever<T>(n: NucleoProprio, fn: (e: Escritor) => Promise<T>): Promise<T> {
  return n.escrever({ cliente: CLIENTE, correlacao: 'teste-f22-0513' }, fn);
}

export const sha = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

/** Id do estabelecimento sintético (criado na primeira vez; fica para as rodadas seguintes). */
export async function garantirEstabelecimento(e: Escritor, codigo: string): Promise<number> {
  const r = await e.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ?', [codigo]);
  if (r) return Number(r.id);
  return e.inserir('INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)', [
    codigo,
    'Teste F2.2 lote 05-13',
    'Teste F2.2 lote 05-13',
    new Date(),
  ]);
}

/** Id do usuário sintético de serviço (criado na primeira vez). */
export async function garantirUsuario(e: Escritor, login: string): Promise<number> {
  const r = await e.uma<{ id: unknown }>('SELECT id FROM usuario WHERE login = ?', [login]);
  if (r) return Number(r.id);
  return e.inserir(
    "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, 'Usuário sintético do teste 05-13', 'servico', ?)",
    [login, new Date()],
  );
}

/** Valor sintético para a coluna obrigatória sem padrão, pelo tipo. */
function valorSintetico(tipo: string): unknown {
  if (/int$/.test(tipo)) return tipo === 'tinyint' ? 0 : 1;
  if (['decimal', 'double', 'float'].includes(tipo)) return 1;
  if (tipo === 'date') return '2026-01-01';
  if (['datetime', 'timestamp'].includes(tipo)) return new Date();
  if (tipo === 'time') return '00:00:00';
  if (tipo === 'json' || tipo === 'longtext') return '{}';
  return 's';
}

/**
 * Linha de massa sintética: preenche as colunas obrigatórias sem padrão que o teste não deu (o chamador desliga as
 * chaves estrangeiras). Só para massa de teste; a tabela e as colunas são conferidas por conferirNome.
 */
export async function inserirSintetico(e: Escritor, tabela: string, valores: Record<string, unknown>): Promise<number> {
  const obrigatorias = await e.consultar<{ c: string; t: string }>(
    `SELECT COLUMN_NAME AS c, DATA_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT IS NULL
        AND EXTRA NOT LIKE '%auto_increment%' AND EXTRA NOT LIKE '%GENERATED%'`,
    [tabela],
  );
  const linha: Record<string, unknown> = {};
  for (const o of obrigatorias) linha[o.c] = valorSintetico(String(o.t).toLowerCase());
  Object.assign(linha, valores);
  const cols = Object.keys(linha).map(conferirNome);
  return e.inserir(
    `INSERT INTO ${conferirNome(tabela)} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => linha[c]),
  );
}

export interface LinhaSintetica {
  readonly entidade: string;
  readonly chave: string;
  readonly comparacao: 'novo' | 'alterado';
  readonly depois: Record<string, string | number | null>;
  readonly antes?: Record<string, string | number | null>;
  readonly lote: number;
}

/** Carga aprovada (área de preparação) com as linhas dadas. */
export async function cargaAprovada(
  e: Escritor,
  p: { estabelecimento: number; aprovador: number; catalogo: string; edicao?: string | null; linhas: readonly LinhaSintetica[] },
): Promise<number> {
  const agora = new Date();
  const n = p.linhas.length;
  const lotes = Math.max(...p.linhas.map((l) => l.lote));
  const novos = p.linhas.filter((l) => l.comparacao === 'novo').length;
  const id = await e.inserir(
    `INSERT INTO carga_catalogo (estabelecimento_id, catalogo, arquivo_nome, arquivo_sha256, arquivo_bytes, situacao, edicao,
       total_linhas, linhas_validas, linhas_erro, itens_novos, itens_alterados, lotes_total, lotes_publicados, tamanho_lote,
       aprovada_em, aprovada_por_usuario_id, criado_em, criado_por, versao)
     VALUES (?, ?, 'teste-05-13.csv', ?, 1, 'aprovada', ?, ?, ?, 0, ?, ?, ?, 0, 500, ?, ?, ?, ?, 1)`,
    [
      p.estabelecimento,
      p.catalogo,
      sha(`${p.catalogo}-${Date.now()}-${Math.random()}`),
      p.edicao ?? null,
      n,
      n,
      novos,
      n - novos,
      lotes,
      agora,
      p.aprovador,
      agora,
      p.aprovador,
    ],
  );
  for (const [i, l] of p.linhas.entries())
    await e.executar(
      `INSERT INTO carga_catalogo_linha (carga_catalogo_id, linha, entidade, chave, resultado, comparacao, valores,
         valores_antes, lote, criado_em, criado_por, versao) VALUES (?, ?, ?, ?, 'valida', ?, ?, ?, ?, ?, ?, 1)`,
      [id, i + 1, l.entidade, l.chave, l.comparacao, JSON.stringify(l.depois), l.antes ? JSON.stringify(l.antes) : null, l.lote, agora, p.aprovador],
    );
  return id;
}

/** Apaga as cargas do estabelecimento (linhas primeiro). */
export async function limparCargas(e: Escritor, estabelecimentos: readonly number[]): Promise<void> {
  if (estabelecimentos.length === 0) return;
  const m = estabelecimentos.map(() => '?').join(', ');
  await e.executar(
    `DELETE x FROM carga_catalogo_linha x JOIN carga_catalogo c ON c.id = x.carga_catalogo_id WHERE c.estabelecimento_id IN (${m})`,
    [...estabelecimentos],
  );
  await e.executar(`DELETE FROM carga_catalogo WHERE estabelecimento_id IN (${m})`, [...estabelecimentos]);
}
