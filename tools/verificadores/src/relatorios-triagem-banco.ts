// Triagem dos relatórios de origem no banco próprio (ficha do M34, regra 2): grava a proposta de destino de cada
// relatório do inventário (só metadado: nome, módulo, tipo, quantidade de parâmetros e acesso restrito; o texto da
// consulta nunca é lido) em triagem_relatorio_legado, pelo Executor (trilha, idempotência e versão na mesma transação).
// A decisão já confirmada pela área fica como está. A regra de proposta é do domínio (@sgh/dominio-relatorio).
// Melhoria: a proposta sem destino fica "pendente" e a com destino fica "proposta" com quem e quando decidiu, conferido
//   pela restrição ck_triagem_relatorio_legado_decisao; a confirmada só muda pela tela da área.
// Melhoria: a área dona é gravada pela CHAVE de negócio curta do domínio (PAPEIS_TRIAGEM: 'faturamento', 'bloco', 'pep'...,
//   até 30 caracteres) na coluna `area`, nunca pelo rótulo livre; rótulo fora do domínio é ERRO (nunca grava NULL).
//   dono_papel_seguranca_id fica NULL de propósito: papel_seguranca é o papel da certificação, não a área dona (DDL
//   da área dona pedido no saida/05-11.json).
// Melhoria: relatório excluído logicamente pela área e que volta no inventário fica excluído (contado como
//   "excluída preservada", sem quebrar a chave única); relatório que sumiu do inventário é contado e listado ("ausente"),
//   e a área decide (nada é apagado sozinho).
// Melhoria: a linha que não mudou não ganha versão nova (antes toda proposta era regravada a cada execução).
// Melhoria: entrada validada (destino do contrato, marco Mnn, onda até 4, tamanhos das colunas) antes de gravar.
import { DESTINOS_TRIAGEM } from '@sgh/contratos';
import { PAPEIS_TRIAGEM, proporTriagem } from '@sgh/dominio-relatorio';
import { definirOperacao, type ContextoOperacao, type Executor, type NucleoProprio } from '@sgh/nucleo';
import { z } from 'zod';

export const TABELA_TRIAGEM = 'triagem_relatorio_legado';

/** Inventário dos relatórios de origem, exportado pelo conector (só metadado, nunca o texto da consulta). */
export const esquemaInventario = z.object({
  formato: z.literal(1),
  estabelecimento: z.string().min(1).max(30),
  relatorios: z.array(
    z.object({
      id: z.number().int().positive(),
      nome: z.string().min(1).max(150),
      modulo: z.number().int(),
      tipo: z.number().int(),
      quantidadeParametros: z.number().int().min(0).max(65535).default(0),
      acessoRestrito: z.boolean().default(false),
    }),
  ),
});
export type InventarioRelatorios = z.infer<typeof esquemaInventario>;
export type RelatorioInventario = InventarioRelatorios['relatorios'][number];

/** Chaves de negócio das áreas donas (as chaves de PAPEIS_TRIAGEM do domínio). */
export const AREAS_TRIAGEM = Object.keys(PAPEIS_TRIAGEM) as [
  keyof typeof PAPEIS_TRIAGEM,
  ...(keyof typeof PAPEIS_TRIAGEM)[],
];
export type AreaTriagem = keyof typeof PAPEIS_TRIAGEM;

/** A chave da área a partir do rótulo do papel dono que o domínio propõe; rótulo desconhecido é erro, nunca nulo. */
export function areaDoPapelDono(rotulo: string): AreaTriagem {
  const r = rotulo.trim();
  const achada = (Object.entries(PAPEIS_TRIAGEM) as [AreaTriagem, string][]).find(([, v]) => v === r);
  if (!achada) throw new Error(`Papel dono fora das áreas do domínio: "${r}" (PAPEIS_TRIAGEM).`);
  return achada[0];
}

export const esquemaProposta = z.object({
  codigo: z.string().min(1).max(30),
  nome: z.string().min(1).max(150),
  quantidadeParametros: z.number().int().min(0).max(65535),
  acessoRestrito: z.boolean(),
  destino: z.enum(DESTINOS_TRIAGEM).nullable(),
  marco: z
    .string()
    .regex(/^M[0-9]{2}$/)
    .nullable(),
  artefato: z.string().max(120).nullable(),
  areaDona: z.enum(AREAS_TRIAGEM),
  onda: z.number().int().min(0).max(4).nullable(),
  regra: z.string().min(1).max(200),
  motivo: z.string().min(1).max(200),
});
export type PropostaGravavel = z.infer<typeof esquemaProposta>;

const entrada = z
  .object({ propostas: z.array(esquemaProposta).min(1).max(5000) })
  .refine((e) => new Set(e.propostas.map((p) => p.codigo)).size === e.propostas.length, {
    message: 'Código de relatório repetido na mesma triagem.',
  });

const vazioNulo = (x: string | null | undefined) => (x && x.trim() !== '' ? x.trim() : null);

/** A proposta do domínio para um relatório do inventário, no formato que a tabela guarda (puro). */
export function propostaDoRelatorio(r: RelatorioInventario): PropostaGravavel {
  const p = proporTriagem({ id: r.id, nome: r.nome, modulo: r.modulo, tipo: r.tipo });
  return {
    codigo: String(r.id),
    nome: r.nome,
    quantidadeParametros: r.quantidadeParametros,
    acessoRestrito: r.acessoRestrito,
    destino: p.destino ?? null,
    marco: vazioNulo(p.marco),
    artefato: vazioNulo(p.artefato),
    areaDona: areaDoPapelDono(p.papelDono),
    onda: p.onda ?? null,
    regra: p.regra,
    motivo: p.motivo,
  };
}

const norma = (x: unknown) =>
  x === null || x === undefined ? '' : typeof x === 'boolean' ? (x ? '1' : '0') : String(x);

const COMPARADAS = [
  'nome',
  'quantidade_parametros',
  'acesso_restrito',
  'destino',
  'marco',
  'artefato',
  'area',
  'onda',
  'regra',
  'motivo',
] as const;

export const OPERACAO_PROPOR_TRIAGEM = definirOperacao({
  nome: 'relatorio.triagem.propor',
  tabelas: [TABELA_TRIAGEM],
  entrada,
  async gravar(tx, e, ctx) {
    const est = ctx.estabelecimento;
    if (est === null || est === undefined)
      throw new Error('A triagem é por estabelecimento: escolha o estabelecimento da sessão.');
    const existentes = new Map<string, Record<string, unknown>>();
    // Inclusive as excluídas: a chave única (estabelecimento, código) vale para elas também.
    for (const l of await tx.consultar<Record<string, unknown>>(
      `SELECT id, codigo, situacao, versao, excluido_em, ${COMPARADAS.join(', ')}
         FROM triagem_relatorio_legado
        WHERE estabelecimento_id = ?`,
      [est],
    ))
      existentes.set(String(l['codigo']), l);
    const noInventario = new Set(e.propostas.map((p) => p.codigo));
    const ausentes = [...existentes.values()]
      .filter((l) => l['excluido_em'] === null && !noInventario.has(String(l['codigo'])))
      .map((l) => String(l['codigo']))
      .sort();
    const agora = new Date();
    let incluidas = 0;
    let atualizadas = 0;
    let preservadas = 0;
    let inalteradas = 0;
    let excluidasPreservadas = 0;
    for (const p of e.propostas) {
      const dados = {
        nome: p.nome,
        quantidade_parametros: p.quantidadeParametros,
        acesso_restrito: p.acessoRestrito,
        destino: p.destino,
        marco: p.marco,
        artefato: p.artefato,
        area: p.areaDona,
        onda: p.onda,
        regra: p.regra,
        motivo: p.motivo,
      };
      const decisao = {
        situacao: p.destino ? 'proposta' : 'pendente',
        decidido_por_usuario_id: p.destino ? ctx.usuario : null,
        decidido_em: p.destino ? agora : null,
      };
      const atual = existentes.get(p.codigo);
      if (!atual) {
        await tx.incluir(TABELA_TRIAGEM, {
          estabelecimento_id: est,
          codigo: p.codigo,
          ...dados,
          ...decisao,
          origem: 'migracao',
        });
        incluidas++;
      } else if (atual['excluido_em'] !== null) excluidasPreservadas++;
      else if (atual['situacao'] === 'confirmada') preservadas++;
      else if (
        COMPARADAS.every((c) => norma(atual[c]) === norma(dados[c])) &&
        norma(atual['situacao']) === decisao.situacao
      )
        inalteradas++;
      else {
        await tx.alterar(TABELA_TRIAGEM, Number(atual['id']), Number(atual['versao']), {
          ...dados,
          ...decisao,
        });
        atualizadas++;
      }
    }
    return {
      incluidas,
      atualizadas,
      preservadas,
      inalteradas,
      excluidasPreservadas,
      ausentes: ausentes.length,
      codigosAusentes: ausentes.slice(0, 200).join(','),
    };
  },
  alvo: () => ({ tabela: TABELA_TRIAGEM, id: null }),
});

/** Grava as propostas no estabelecimento do contexto; devolve a saída do executor (resultado e id da trilha). */
export function gravarPropostasTriagem(
  executor: Pick<Executor, 'executar'>,
  cliente: string,
  contexto: ContextoOperacao,
  propostas: readonly PropostaGravavel[],
) {
  return executor.executar(OPERACAO_PROPOR_TRIAGEM, cliente, { propostas: [...propostas] }, contexto);
}

export interface ResumoGravado {
  readonly total: number;
  readonly semDono: number;
  readonly confirmadas: number;
}

/** O que está gravado no estabelecimento (só contagens). */
export async function resumoTriagemGravada(
  nucleo: Pick<NucleoProprio, 'lerSomente'>,
  cliente: string,
  estabelecimento: number,
): Promise<ResumoGravado> {
  const l = await nucleo.lerSomente({ cliente, estabelecimento, correlacao: 'relatorios-triagem' }, (x) =>
    x.uma<Record<string, unknown>>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(area IS NULL), 0) AS sem_dono,
              COALESCE(SUM(situacao = 'confirmada'), 0) AS confirmadas
         FROM triagem_relatorio_legado
        WHERE estabelecimento_id = ? AND excluido_em IS NULL`,
      [estabelecimento],
    ),
  );
  return {
    total: Number(l?.['total'] ?? 0),
    semDono: Number(l?.['sem_dono'] ?? 0),
    confirmadas: Number(l?.['confirmadas'] ?? 0),
  };
}
