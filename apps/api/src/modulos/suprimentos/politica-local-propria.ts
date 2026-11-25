// F3.6 (05-SUP linha 3): a política do local de estoque e a concessão do usuário por classificação, lidas do cadastro
// no MariaDB e aplicadas às gravações do estoque (requisição, saída que atende, transferência, entrada de nota e
// pedido de compra). A decisão é do domínio (`@sgh/contratos/regras-suprimentos`, política do local); aqui só a leitura.
import {
  classificacoesDoGrupo,
  conferirAtendimentoParcial,
  conferirClassificacaoDoUsuario,
  conferirItensDoLocal,
  conferirSetorAtendido,
  conferirTipoDePedido,
  conferirUrgencia,
  type AcaoClassificada,
  type ConcessaoClassificacao,
  type ItemClassificado,
  type ItemEmAtendimento,
  type PoliticaLocal,
  type RecusaSuprimentos,
  type TipoPedidoAoLocal,
} from '@sgh/dominio-suprimentos';
import type { Leitor } from '@sgh/nucleo';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const sim = (v: unknown) => v === true || v === 1 || v === '1' || v === 1n;

/** A política do local (o chamador já conferiu que o local existe e é do estabelecimento). */
export async function politicaDoLocal(l: Leitor, est: number, local: number): Promise<PoliticaLocal> {
  const r = await l.uma<Linha>(
    `SELECT nome, atende_solicitacao_setor, atende_solicitacao_paciente, atende_transferencia,
            permite_atendimento_parcial, apenas_urgente
       FROM local_estoque WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [local, est],
  );
  const setores = await l.consultar<Linha>(
    `SELECT setor_funcional_id FROM local_estoque_setor
      WHERE local_estoque_id = ? AND excluido_em IS NULL AND tipo_atendimento IN ('requisicao', 'ambos')
        AND (vigencia_inicio IS NULL OR vigencia_inicio <= CURRENT_DATE)
        AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)`,
    [local],
  );
  const classes = await l.consultar<Linha>(
    `SELECT grupo_insumo_id, subgrupo_insumo_id, insumo_id, permite_movimentar
       FROM local_estoque_classificacao WHERE local_estoque_id = ? AND excluido_em IS NULL`,
    [local],
  );
  return {
    nome: String(r?.['nome'] ?? ''),
    atendeSetor: sim(r?.['atende_solicitacao_setor']),
    atendePaciente: sim(r?.['atende_solicitacao_paciente']),
    atendeTransferencia: sim(r?.['atende_transferencia']),
    permiteAtendimentoParcial: r ? sim(r['permite_atendimento_parcial']) : true,
    apenasUrgente: sim(r?.['apenas_urgente']),
    setores: setores.map((s) => n(s['setor_funcional_id'])),
    // A linha que não deixa movimentar conta como restrição cadastrada e não cobre item nenhum.
    classificacao: classes.map((c) =>
      sim(c['permite_movimentar'])
        ? {
            grupo: nn(c['grupo_insumo_id']),
            subgrupo: nn(c['subgrupo_insumo_id']),
            item: nn(c['insumo_id']),
          }
        : {},
    ),
  };
}

/**
 * Os itens com grupo, subgrupo e a classificação de despesa (que vem do grupo do item) do cadastro (rede inteira),
 * na ordem pedida e sem repetir.
 */
export async function itensClassificados(l: Leitor, itens: readonly number[]): Promise<ItemClassificado[]> {
  const ids = [...new Set(itens)];
  if (ids.length === 0) return [];
  const linhas = await l.consultar<Linha>(
    `SELECT i.id, i.nome, i.grupo_insumo_id, i.subgrupo_insumo_id, g.classificacao_despesa_id
       FROM insumo i LEFT JOIN grupo_insumo g ON g.id = i.grupo_insumo_id
      WHERE i.id IN (${ids.map(() => '?').join(', ')})`,
    ids,
  );
  return ids.flatMap((id) => {
    const r = linhas.find((x) => n(x['id']) === id);
    return r
      ? [
          {
            item: id,
            nome: String(r['nome']),
            grupo: nn(r['grupo_insumo_id']),
            subgrupo: nn(r['subgrupo_insumo_id']),
            classificacoesDespesa: classificacoesDoGrupo(nn(r['classificacao_despesa_id'])),
          },
        ]
      : [];
  });
}

/**
 * As concessões do usuário por grupo e subgrupo e por classificação de despesa no estabelecimento, vigentes ou não (a
 * história conta: retirar a última não abre todos os itens). A classificação de despesa do item vem do seu grupo.
 */
export async function concessoesDeClassificacao(
  l: Leitor,
  est: number,
  usuario: number,
): Promise<ConcessaoClassificacao[]> {
  const linhas = await l.consultar<Linha>(
    `SELECT grupo_insumo_id, subgrupo_insumo_id, classificacao_despesa_id, permite_requisitar, permite_movimentar,
            permite_comprar, (excluido_em IS NULL AND vigencia_inicio <= CURRENT_DATE
              AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)) AS vigente
       FROM usuario_estoque_classificacao
      WHERE estabelecimento_id = ? AND usuario_id = ?
        AND (grupo_insumo_id IS NOT NULL OR classificacao_despesa_id IS NOT NULL)`,
    [est, usuario],
  );
  return linhas.map((r) => ({
    grupo: nn(r['grupo_insumo_id']),
    subgrupo: nn(r['subgrupo_insumo_id']),
    classificacaoDespesa: nn(r['classificacao_despesa_id']),
    requisitar: sim(r['permite_requisitar']),
    movimentar: sim(r['permite_movimentar']),
    comprar: sim(r['permite_comprar']),
    vigente: sim(r['vigente']),
  }));
}

/** Os setores ativos do centro de custo (quem pede, na requisição de setor). */
async function setoresDoCentro(l: Leitor, est: number, centro: number): Promise<number[]> {
  const linhas = await l.consultar<Linha>(
    'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND centro_custo_id = ? AND excluido_em IS NULL',
    [est, centro],
  );
  return linhas.map((r) => n(r['id']));
}

export interface ConferenciaPolitica {
  readonly est: number;
  readonly usuario: number;
  /** Os itens da gravação (ids do cadastro). */
  readonly itens: readonly number[];
  /** O que o usuário faz com os itens. */
  readonly acao: AcaoClassificada;
  /** Locais que têm de guardar os itens (requisição e saída: o que atende; transferência: o destino; nota: o local). */
  readonly locaisQueGuardam?: readonly number[];
  /** O pedido ao local: o tipo, a urgência e, na requisição de setor, o centro de custo de quem pede. */
  readonly pedido?: {
    readonly local: number;
    readonly tipo: TipoPedidoAoLocal;
    readonly urgente?: boolean;
    readonly centroCusto?: number;
  };
}

/** A primeira recusa da política do local e da concessão do usuário para a gravação (null: pode gravar). */
export async function conferirPolitica(l: Leitor, c: ConferenciaPolitica): Promise<RecusaSuprimentos | null> {
  const politicas = new Map<number, PoliticaLocal>();
  const politica = async (local: number) => {
    if (!politicas.has(local)) politicas.set(local, await politicaDoLocal(l, c.est, local));
    return politicas.get(local)!;
  };
  if (c.pedido) {
    const p = await politica(c.pedido.local);
    const tipo = conferirTipoDePedido(p, c.pedido.tipo);
    if (tipo) return tipo;
    if (c.pedido.tipo !== 'transferencia') {
      const urgencia = conferirUrgencia(p, c.pedido.urgente ?? false);
      if (urgencia) return urgencia;
    }
    if (c.pedido.tipo === 'setor' && p.setores.length > 0 && c.pedido.centroCusto) {
      const setor = conferirSetorAtendido(p, await setoresDoCentro(l, c.est, c.pedido.centroCusto));
      if (setor) return setor;
    }
  }
  const itens = await itensClassificados(l, c.itens);
  for (const local of c.locaisQueGuardam ?? []) {
    const fora = conferirItensDoLocal(await politica(local), itens)[0];
    if (fora) return fora;
  }
  return (
    conferirClassificacaoDoUsuario(await concessoesDeClassificacao(l, c.est, c.usuario), itens, c.acao)[0] ??
    null
  );
}

/** A saída que atende a requisição: o local que não atende em parte exige tudo o que está pendente. */
export async function conferirParcialDoLocal(
  l: Leitor,
  est: number,
  local: number,
  itens: readonly ItemEmAtendimento[],
): Promise<RecusaSuprimentos | null> {
  return conferirAtendimentoParcial(await politicaDoLocal(l, est, local), itens);
}
