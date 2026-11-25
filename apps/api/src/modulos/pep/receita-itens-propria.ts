// Receita médica com itens estruturados no banco próprio (03-PEP L121, C2-021). Cada medicamento da receita vira uma
// linha de receita_medica_item na mesma transação da receita: o texto como sai impresso (medicamento, concentração,
// forma, via, posologia, quantidade) e, ao lado, o que a farmácia confere e escritura (quantidade e duração em número,
// a unidade da duração pelo cadastro e o item do catálogo quando o nome é o de um item prescritível). O receituário é
// conferido pela classe do medicamento no catálogo (controlado só no de controle especial, Portaria 344/98;
// antimicrobiano nunca na receita simples, RDC 471/2021) antes de gravar; a recusa não grava nada.
// A leitura devolve os itens de volta ao formato da receita, para o documento impresso em vias (receita.ts do domínio).
// Tabelas: receita_medica_item, item_prescritivel, unidade_duracao_tratamento.
import type { ItemReceita, TipoReceita } from '@sgh/contratos';
import {
  conferirItensDoTipo,
  DIAS_DA_UNIDADE,
  itemDaLinha,
  itensEstruturados,
  type ClasseDoMedicamento,
} from '@sgh/dominio-pep';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';

const marcadores = (n: number): string => Array.from({ length: n }, () => '?').join(', ');
const verdadeiro = (v: unknown): boolean => v === true || Number(v) === 1;

/** Grava os itens estruturados da receita (sequência 1..n); devolve quantos gravou. */
export async function gravarItensReceita(
  tx: TxOperacao,
  receita: number,
  tipo: TipoReceita,
  itens: readonly ItemReceita[],
): Promise<number> {
  const es = itensEstruturados(itens);
  const nomes = [...new Set(es.map((e) => e.medicamento.toUpperCase()))];
  const catalogo = await tx.consultar(
    `SELECT id, UPPER(descricao) AS nome, controlado, antimicrobiano FROM item_prescritivel
      WHERE excluido_em IS NULL AND UPPER(descricao) IN (${marcadores(nomes.length)})`,
    nomes,
  );
  // O item do catálogo só é ligado quando o nome é de um item só (nome repetido no cadastro fica sem ligação).
  const porNome = new Map<string, Record<string, unknown> | null>();
  for (const c of catalogo) {
    const n = String(c['nome']);
    porNome.set(n, porNome.has(n) ? null : c);
  }
  const classes: ClasseDoMedicamento[] = [];
  for (const e of es) {
    const c = porNome.get(e.medicamento.toUpperCase());
    if (c)
      classes.push({
        sequencia: e.sequencia,
        controlado: verdadeiro(c['controlado']),
        antimicrobiano: verdadeiro(c['antimicrobiano']),
      });
  }
  const problemas = conferirItensDoTipo(tipo, itens, classes);
  if (problemas.length > 0)
    throw new ErroOperacao(
      422,
      'receituario-incompativel',
      'Receita recusada',
      problemas.map((p) => p.motivo).join(' '),
    );
  const unidades = await tx.consultar(
    `SELECT id, dias_equivalentes FROM unidade_duracao_tratamento
      WHERE ativo = TRUE AND dias_equivalentes IN (1, 7, 30) ORDER BY id`,
  );
  const unidadeDe = new Map<number, number>();
  for (const u of unidades) {
    const d = Number(u['dias_equivalentes']);
    if (!unidadeDe.has(d)) unidadeDe.set(d, Number(u['id']));
  }
  for (const e of es) {
    const c = porNome.get(e.medicamento.toUpperCase());
    const unidade = e.duracao ? (unidadeDe.get(DIAS_DA_UNIDADE[e.duracao.unidade]) ?? null) : null;
    await tx.incluir('receita_medica_item', {
      receita_medica_id: receita,
      sequencia: e.sequencia,
      item_prescritivel_id: c ? Number(c['id']) : null,
      medicamento: e.medicamento,
      concentracao: e.concentracao,
      forma_farmaceutica: e.forma,
      via_descricao: e.via,
      posologia: e.posologia,
      quantidade: e.quantidade,
      quantidade_descricao: e.quantidadeDescricao,
      // Duração sem a unidade no cadastro não é gravada em número (fica no texto impresso).
      duracao_tratamento: unidade === null ? null : e.duracao!.valor,
      duracao_unidade_duracao_tratamento_id: unidade,
      uso_continuo: e.usoContinuo,
      origem: 'sistema',
    });
  }
  return es.length;
}

/** Itens gravados da receita, no formato da receita (vazio nas receitas sem itens estruturados). */
export async function lerItensReceita(l: Leitor, receita: number): Promise<ItemReceita[]> {
  const ls = await l.consultar(
    `SELECT i.medicamento, i.concentracao, i.forma_farmaceutica, i.via_descricao, i.posologia,
            i.quantidade_descricao, i.duracao_tratamento, u.dias_equivalentes, i.uso_continuo
       FROM receita_medica_item i
       LEFT JOIN unidade_duracao_tratamento u ON u.id = i.duracao_unidade_duracao_tratamento_id
      WHERE i.receita_medica_id = ? AND i.excluido_em IS NULL
      ORDER BY i.sequencia`,
    [receita],
  );
  const ou = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
  return ls
    .filter((x) => typeof x['medicamento'] === 'string' && typeof x['posologia'] === 'string')
    .map((x) =>
      itemDaLinha({
        medicamento: String(x['medicamento']),
        concentracao: ou(x['concentracao']),
        forma: ou(x['forma_farmaceutica']),
        via: ou(x['via_descricao']),
        posologia: String(x['posologia']),
        quantidadeDescricao: String(x['quantidade_descricao'] ?? ''),
        duracao:
          x['duracao_tratamento'] === null || x['duracao_tratamento'] === undefined
            ? null
            : Number(x['duracao_tratamento']),
        diasDaUnidade:
          x['dias_equivalentes'] === null || x['dias_equivalentes'] === undefined
            ? null
            : Number(x['dias_equivalentes']),
        usoContinuo: verdadeiro(x['uso_continuo']),
      }),
    );
}
