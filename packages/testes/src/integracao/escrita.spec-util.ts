// Partida comum dos testes de integração transversais do núcleo sobre o MariaDB real (cliente de teste f22_o5).
// Substitui a partida antiga sobre a cópia do sistema de origem (trava da cópia, driver nativo, códigos de hospital):
// aqui cada cliente tem o seu banco, o núcleo abre a conexão pelo código do cliente e toda gravação de teste roda em
// transação DESFEITA (escrever(..., confirmar=false)) ou com `desfazer: true` no executor. Nada fica no banco.
// Saída só com contagens, ids e códigos; nenhum dado de pessoa. SGH_NUCLEO_SEM_BANCO=1 pula os specs.
// Melhoria: o cliente de teste é conferido e, se faltar, criado pelo comando oficial (tools/db/criar_cliente.py), em
// vez de depender de uma cópia restaurada à mão e de uma trava de arquivo.
// Melhoria: operações de teste declaradas com definirOperacao (tabelas, entrada Zod, trava otimista, eventos), sem
// operação do catálogo do sistema de origem e sem usuário em texto: o usuário do contexto é um id.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Escritor,
  type Leitor,
  NucleoProprio,
  recusa,
} from '@sgh/nucleo';
import { z } from 'zod';

export const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
/** Segundo cliente de teste, só para provar o isolamento entre clientes (um banco por cliente, ADR 0002). */
export const CLIENTE_B = process.env['SGH_CLIENTE_TESTE_B']?.trim() || 'f22_o5_b';
export const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
/**
 * @deprecated Transição da onda 5 (lotes 05-02 a 05-05): use `!SEM_BANCO`. Não depende da cópia do sistema de origem;
 * sai quando o último spec deixar de importá-lo (pedido em docs/obra/fatias/f22/saida/05-01.json).
 */
export const PODE_ESCREVER = !SEM_BANCO;
export const raiz = resolve(import.meta.dirname, '../../../..');
/** Marca da massa sintética destes specs (código de estabelecimento e nomes). */
export const MARCA = 'SGH INT NUCLEO';

/** Confere o cliente de teste; se faltar, cria-o pelo comando oficial (que recusa cliente já existente). */
export function garantirCliente(cliente = CLIENTE, nome = 'Teste F2.2 onda 5 (integração do núcleo)'): void {
  const comando = resolve(raiz, 'tools/db/criar_cliente.py');
  const lista = execFileSync('python3', ['-I', comando, '--listar'], { cwd: raiz, encoding: 'utf8' });
  if (new RegExp(`(^|\\W)${cliente}(\\W|$)`, 'm').test(lista)) return;
  execFileSync('python3', ['-I', comando, cliente, nome], {
    cwd: raiz,
    stdio: 'ignore',
  });
}

export interface Ambiente {
  readonly nucleo: NucleoProprio;
  readonly executor: ReturnType<NucleoProprio['criarExecutor']>;
  /** Estabelecimento de partida do cliente (o primeiro ativo). */
  readonly estabelecimento: number;
}

export async function prepararAmbiente(): Promise<Ambiente> {
  garantirCliente();
  const nucleo = new NucleoProprio();
  const est = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'int-nucleo-partida' }, (l) =>
    l.uma<{ id: number }>('SELECT id FROM estabelecimento WHERE excluido_em IS NULL ORDER BY id LIMIT 1'),
  );
  if (!est) throw new Error(`O cliente ${CLIENTE} não tem estabelecimento ativo.`);
  return { nucleo, executor: nucleo.criarExecutor(), estabelecimento: Number(est.id) };
}

export const ctx = (a: Ambiente, correlacao = 'int-nucleo'): ContextoNucleo => ({
  cliente: CLIENTE,
  estabelecimento: a.estabelecimento,
  usuario: null,
  correlacao,
});

let seq = 0;
export function chaveNova(prefixo = 'int-nucleo'): string {
  return `${prefixo}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
}

export function ctxOperacao(a: Ambiente, extra: Partial<ContextoOperacao> = {}): ContextoOperacao {
  return { ...ctx(a), chaveIdempotencia: chaveNova(), ...extra };
}

/** Roda e desfaz: nada fica no banco. */
export const desfeito = <T>(a: Ambiente, fn: (e: Escritor) => Promise<T>): Promise<T> =>
  a.nucleo.escrever(ctx(a, 'int-nucleo-desfeito'), fn, false);

export const num = (v: unknown): number => Number(v ?? Number.NaN);

/** Contagem (SELECT COUNT(*) AS n ...). */
export async function contar(l: Leitor, sql: string, p: readonly unknown[] = []): Promise<number> {
  const r = await l.uma<{ n: number }>(sql, p);
  return num(r?.n);
}

/** Código do problema de uma recusa do executor (ou "outro"). */
export const codigoDe = (x: unknown): string =>
  x instanceof ErroOperacao ? String(x.problema.codigo ?? '') : 'outro';

/** Código sintético curto e único (estabelecimento.codigo). */
export const codigoSintetico = (): string =>
  `q${Date.now().toString(36).slice(-6)}${(seq++).toString(36)}`.toUpperCase();

const entradaIncluir = z
  .object({
    codigo: z.string().regex(/^[A-Z0-9_]{3,20}$/),
    nome: z.string().trim().min(1).max(150),
  })
  .strict();

/** Inclusão de estabelecimento sintético, com evento de saída. */
export const incluirEstabelecimento = definirOperacao({
  nome: 'teste.nucleo.incluir',
  tabelas: ['estabelecimento'],
  entrada: entradaIncluir,
  async gravar(tx, e) {
    const id = await tx.incluir('estabelecimento', {
      codigo: e.codigo,
      nome_fantasia: e.nome,
      razao_social: `${e.nome} (fictício)`,
    });
    return { id };
  },
  eventos: (_e, r) => [{ tipo: 'teste.nucleo.incluido', carga: { id: r.id } }],
  alvo: (_e, r) => ({ tabela: 'estabelecimento', id: r.id }),
});

const entradaAlterar = z
  .object({
    id: z.number().int().positive(),
    versao: z.number().int().positive(),
    nome: z.string().trim().min(1).max(150),
  })
  .strict();

/** Alteração com trava e conferência da versão lida (passo 2 do executor). */
export const alterarEstabelecimento = definirOperacao({
  nome: 'teste.nucleo.alterar',
  tabelas: ['estabelecimento'],
  entrada: entradaAlterar,
  travar: (e) => ({ tabela: 'estabelecimento', id: e.id, versaoEsperada: e.versao }),
  async gravar(tx, e) {
    const versao = await tx.alterar('estabelecimento', e.id, e.versao, { nome_fantasia: e.nome });
    return { id: e.id, versao };
  },
  alvo: (e) => ({ tabela: 'estabelecimento', id: e.id }),
});

/** Grava e depois recusa (prova pós-escrita que não se confirma): a operação inteira tem de ser desfeita. */
export const incluirSemEfeito = definirOperacao({
  ...incluirEstabelecimento,
  nome: 'teste.nucleo.semefeito',
  async gravar(tx, e) {
    await tx.incluir('estabelecimento', {
      codigo: e.codigo,
      nome_fantasia: e.nome,
      razao_social: `${e.nome} (fictício)`,
    });
    throw recusa('acao-sem-efeito', 'Efeito inexistente de propósito (teste).');
  },
});

/** Declara só estabelecimento e tenta gravar em outra tabela: a transação da operação recusa. */
export const gravarForaDasTabelas = definirOperacao({
  ...incluirEstabelecimento,
  nome: 'teste.nucleo.foradastabelas',
  async gravar(tx) {
    await tx.inserir(
      `INSERT INTO integracao_mensagem (ponto, direcao, conteudo, criado_em) VALUES ('teste_nucleo', 'entrada', 'x', NOW(3))`,
    );
    return { id: 0 };
  },
});
