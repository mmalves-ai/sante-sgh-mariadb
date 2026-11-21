// Peças comuns dos serviços do worker sobre o banco próprio de cada cliente (MariaDB, @sgh/nucleo), lote F2.2 05-16:
// os clientes do ciclo (a lista do ambiente ou os clientes em uso na plataforma), o estabelecimento pelo código, o dia
// civil do fuso e o valor vigente de um parâmetro (a regra de precedência é a do domínio, resolverParametro).
// Melhoria: o worker passa por todos os clientes da plataforma (um banco por cliente), em vez de uma lista fixa de
// bancos de hospitais no ambiente; o cliente de código fora do formato é recusado.
import { definicaoParametro, type ValorParametro } from '@sgh/contratos';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';
import { FORMATO_CLIENTE, type Leitor } from '@sgh/nucleo';

/** O que os serviços usam do NucleoProprio para achar os clientes (os testes trocam). */
export interface NucleoClientes {
  lerPlataforma<T>(correlacao: string, fn: (l: Leitor) => Promise<T>): Promise<T>;
}

/** Os clientes de uma lista separada por vírgulas (WORKER_CLIENTES); os fora do formato ficam de fora. */
export function clientesDaLista(valor: string | undefined): string[] {
  return [
    ...new Set(
      (valor ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter((x) => FORMATO_CLIENTE.test(x)),
    ),
  ];
}

/** Os clientes do ciclo: WORKER_CLIENTES (ou INTEGRACAO_CLIENTES), senão os clientes em uso na plataforma. */
export async function clientesDoWorker(
  nucleo: NucleoClientes,
  env: NodeJS.ProcessEnv,
  correlacao: string,
): Promise<string[]> {
  const lista = clientesDaLista(env['WORKER_CLIENTES'] ?? env['INTEGRACAO_CLIENTES']);
  if (lista.length > 0) return lista;
  const linhas = await nucleo.lerPlataforma(correlacao.slice(0, 64), (l) =>
    l.consultar(
      "SELECT codigo FROM cliente WHERE situacao IN ('implantacao', 'homologacao', 'producao') ORDER BY codigo",
      [],
      { teto: 10_000 },
    ),
  );
  return linhas.map((x) => String(x['codigo'])).filter((c) => FORMATO_CLIENTE.test(c));
}

/** Os códigos dos estabelecimentos ativos do cliente. */
export async function codigosDosEstabelecimentos(l: Leitor): Promise<string[]> {
  return (
    await l.consultar('SELECT codigo FROM estabelecimento WHERE excluido_em IS NULL ORDER BY codigo', [], { teto: 1000 })
  ).map((x) => String(x['codigo']));
}

/** O id do estabelecimento ativo pelo código (null: não cadastrado). */
export async function idDoEstabelecimento(l: Leitor, codigo: string): Promise<number | null> {
  const r = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [codigo]);
  return r ? Number(r['id']) : null;
}

/** O estabelecimento sede do cliente (o primeiro cadastrado): contexto das gravações do cliente inteiro. */
export async function idDaSede(l: Leitor): Promise<number | null> {
  const r = await l.uma('SELECT MIN(id) AS id FROM estabelecimento WHERE excluido_em IS NULL', []);
  return r && r['id'] !== null && r['id'] !== undefined ? Number(r['id']) : null;
}

/** O dia civil (AAAA-MM-DD) no fuso dado. */
export function diaCivil(agora: Date, fuso = 'America/Sao_Paulo'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    agora,
  );
}

const iso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * O valor vigente do parâmetro no estabelecimento (ou no cliente inteiro, com `estabelecimento` null), tipado pela
 * definição; os níveis de unidade, perfil e usuário não se aplicam a processo automático. Sem definição: null.
 */
export async function valorDoParametro(
  l: Leitor,
  chave: string,
  alvo: { readonly cliente: string; readonly estabelecimento: { readonly id: number; readonly codigo: string } | null },
  agora: Date,
): Promise<number | boolean | string | null> {
  const def = definicaoParametro(chave);
  if (!def) return null;
  const linhas = await l.consultar(
    `SELECT pv.id, pv.nivel, pv.valor, pv.vigencia_inicio, pv.vigencia_fim, pv.motivo
       FROM parametro_valor pv JOIN parametro_definicao d ON d.id = pv.parametro_definicao_id
      WHERE d.chave = ? AND (pv.nivel = 'rede' OR (pv.nivel = 'estabelecimento' AND pv.estabelecimento_id = ?))`,
    [chave, alvo.estabelecimento?.id ?? null],
    { teto: 1000 },
  );
  const valores: ValorParametro[] = linhas.map((x) => ({
    id: String(x['id']),
    chave,
    nivel: x['nivel'] === 'rede' ? 'rede' : 'estabelecimento',
    alvo: x['nivel'] === 'rede' ? alvo.cliente : (alvo.estabelecimento?.codigo ?? ''),
    valor: String(x['valor']),
    vigenteDesde: iso(x['vigencia_inicio']) ?? new Date(0).toISOString(),
    vigenteAte: iso(x['vigencia_fim']),
    justificativa: String(x['motivo'] ?? ''),
    autor: '',
  }));
  const sujeito = {
    rede: alvo.cliente,
    empresa: null,
    estabelecimento: alvo.estabelecimento?.codigo ?? '',
    unidade: null,
    perfis: [],
    usuario: '',
  };
  return valorTipado(def, resolverParametro(def, valores, sujeito, agora).valor);
}
