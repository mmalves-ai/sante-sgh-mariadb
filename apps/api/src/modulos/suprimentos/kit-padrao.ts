// Kit padrão de insumos (F3.6, 05-SUP linha 13): a gravação do kit inteiro numa operação do Executor (trilha, outbox,
// idempotência e trava de versão na mesma transação) e as leituras do cadastro. As regras puras moram em
// `regras/kit-padrao.ts`; aqui ficam só a conferência das referências no banco e a escrita. Nada é apagado: o kit se
// inativa, e o item ou o vínculo que sai da composição recebe a marca de exclusão (volta ao entrar de novo), para que
// o kit montado, a lista do procedimento e o pacote esterilizado que já o citaram continuem explicáveis.
import {
  chaveProcedimentoKit,
  conferirKitDoPedido,
  conferirKitPadrao,
  diferencaItensKit,
  type GravarKitPadraoEntrada,
  type KitPadraoDoProcedimento,
  type KitPadraoCadastro,
  type KitPadraoSugerido,
  type ProcedimentoKitBusca,
  type TipoKitPadrao,
} from '@sgh/contratos';
import type { RecusaSuprimentos } from '@sgh/contratos/regras-suprimentos';
import { recusa, type Leitor, type ResultadoOperacao, type TxOperacao } from '@sgh/nucleo';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const idOuNulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';

export const OPERACAO_KIT_PADRAO = 'suprimentos.gravarKitPadrao';
export const TABELAS_KIT_PADRAO = ['kit_material', 'kit_material_item', 'kit_material_procedimento'] as const;

function recusarTodas(rs: readonly RecusaSuprimentos[]): void {
  const [r] = rs;
  if (r)
    throw recusa(r.codigo, rs.map((x) => x.mensagem).join(' '), {
      campos: [...new Set(rs.flatMap((x) => x.campos ?? []))],
    });
}

/**
 * O banco recusa a leitura com trava de uma linha que outra transação confirmou depois do instantâneo desta
 * (isolamento por instantâneo, erro 1020): é o que acontece com a gravação que esperou a trava do procedimento. A
 * transação inteira é desfeita com este código e a porta a refaz (`executar`), já enxergando o que a outra gravou.
 */
export const GRAVACAO_CONCORRENTE = 'gravacao-concorrente';
const ERRNO_LINHA_MUDOU = 1020;

/** A gravação do kit padrão (inclui sem `kit`; altera com `kit` e `versao`). */
export async function gravarKitPadrao(
  tx: TxOperacao,
  est: number,
  e: GravarKitPadraoEntrada,
): Promise<ResultadoOperacao> {
  try {
    return await gravarKitPadraoNaTransacao(tx, est, e);
  } catch (erro) {
    if ((erro as { errno?: unknown } | null)?.errno === ERRNO_LINHA_MUDOU)
      throw recusa(
        GRAVACAO_CONCORRENTE,
        'Outra gravação mudou este cadastro ao mesmo tempo. Nada foi gravado: confira e grave de novo.',
      );
    throw erro;
  }
}

async function gravarKitPadraoNaTransacao(
  tx: TxOperacao,
  est: number,
  e: GravarKitPadraoEntrada,
): Promise<ResultadoOperacao> {
  recusarTodas(conferirKitPadrao(e));
  const agora = new Date();
  const usuario = tx.contexto.usuario ?? null;
  // A linha de cada procedimento é travada ANTES de qualquer escrita, sempre na mesma ordem: duas gravações do padrão
  // do mesmo procedimento passam uma de cada vez desde o começo (a segunda espera sem segurar nada e enxerga o padrão
  // que a primeira gravou), e dois kits com os mesmos procedimentos nunca se travam em ordem cruzada.
  const referencias = new Map<string, boolean>();
  const emOrdem = [...e.procedimentos].sort((a, b) =>
    chaveProcedimentoKit(a).localeCompare(chaveProcedimentoKit(b)),
  );
  for (const p of emOrdem) {
    const [ref] =
      p.procedimentoCirurgico !== null
        ? await tx.consultarParaAtualizar<Linha>(
            'SELECT id, ativo AS vale FROM procedimento_cirurgico WHERE id = ?',
            [p.procedimentoCirurgico],
          )
        : await tx.consultarParaAtualizar<Linha>(
            "SELECT id, situacao = 'ativo' AS vale FROM item_faturavel WHERE id = ?",
            [p.itemFaturavel],
          );
    referencias.set(chaveProcedimentoKit(p), Boolean(ref && verdadeiro(ref['vale'])));
  }
  const outro = await tx.uma<Linha>(
    'SELECT id FROM kit_material WHERE estabelecimento_id = ? AND codigo = ? AND id <> ?',
    [est, e.codigo, e.kit ?? 0],
  );
  if (outro)
    throw recusa('kit-codigo-duplicado', `O código ${e.codigo} já é de outro kit deste estabelecimento.`, {
      campos: ['codigo'],
    });
  const valores = {
    codigo: e.codigo,
    nome: e.nome,
    tipo: e.tipo,
    permite_quantidade_acima: e.permiteQuantidadeAcima,
    permite_similar: e.permiteSimilar,
    observacao: e.observacao,
    ativo: e.ativo,
  };
  let kit: number;
  const novo = e.kit === undefined;
  if (e.kit === undefined) kit = await tx.incluir('kit_material', { estabelecimento_id: est, ...valores });
  else {
    const [atual] = await tx.consultarParaAtualizar<Linha>(
      'SELECT id FROM kit_material WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.kit, est],
    );
    if (!atual)
      throw recusa('kit-inexistente', 'O kit não existe neste estabelecimento.', { campos: ['kit'] });
    kit = e.kit;
    await tx.alterar('kit_material', kit, e.versao ?? 0, valores);
  }

  // Composição: só o que mudou é escrito; o insumo que entra precisa estar ativo, e a unidade é a do estoque dele.
  // O kit recém-incluído não tem linha a travar (e a leitura com trava de uma faixa vazia seguraria o intervalo do
  // índice, atravessando a inclusão de outro kit novo na mesma hora).
  const linhas = novo
    ? []
    : await tx.consultarParaAtualizar<Linha>(
        `SELECT id, versao, sequencia, insumo_id, quantidade, obrigatorio_kit_rastreavel, permite_substituto, excluido_em
           FROM kit_material_item WHERE kit_material_id = ?`,
        [kit],
      );
  const porInsumo = new Map(linhas.map((r) => [n(r['insumo_id']), r]));
  const vigentes = linhas
    .filter((r) => r['excluido_em'] === null)
    .map((r) => ({
      insumo: n(r['insumo_id']),
      quantidade: n(r['quantidade']),
      obrigatorioRastreavel: verdadeiro(r['obrigatorio_kit_rastreavel']),
      permiteSubstituto: verdadeiro(r['permite_substituto']),
    }));
  const d = diferencaItensKit(vigentes, e.itens);
  let sequencia = Math.max(0, ...linhas.map((r) => n(r['sequencia'])));
  for (const x of d.entram) {
    const ins = await tx.uma<Linha>(
      "SELECT id, estoque_unidade_medida_id FROM insumo WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
      [x.insumo],
    );
    const linha = e.itens.findIndex((i) => i.insumo === x.insumo);
    if (!ins)
      throw recusa('referencia-inexistente', `O item da linha ${linha + 1} não está ativo no estoque.`, {
        campos: [`itens.${linha}.insumo`],
      });
    const campos = {
      unidade_medida_id: n(ins['estoque_unidade_medida_id']),
      quantidade: x.quantidade,
      obrigatorio_kit_rastreavel: x.obrigatorioRastreavel,
      permite_substituto: x.permiteSubstituto,
    };
    const antigo = porInsumo.get(x.insumo);
    if (antigo)
      await tx.alterar('kit_material_item', n(antigo['id']), n(antigo['versao']), {
        ...campos,
        excluido_em: null,
        excluido_por: null,
      });
    else {
      sequencia += 1;
      await tx.incluir('kit_material_item', {
        kit_material_id: kit,
        sequencia,
        insumo_id: x.insumo,
        ...campos,
      });
    }
  }
  for (const x of d.mudam) {
    const r = porInsumo.get(x.insumo) as Linha;
    await tx.alterar('kit_material_item', n(r['id']), n(r['versao']), {
      quantidade: x.quantidade,
      obrigatorio_kit_rastreavel: x.obrigatorioRastreavel,
      permite_substituto: x.permiteSubstituto,
    });
  }
  for (const x of d.saem) {
    const r = porInsumo.get(x.insumo) as Linha;
    await tx.alterar('kit_material_item', n(r['id']), n(r['versao']), {
      excluido_em: agora,
      excluido_por: usuario,
    });
  }

  // Vínculo aos procedimentos: um kit padrão por procedimento entre os kits ativos do estabelecimento.
  const vinculos = novo
    ? []
    : await tx.consultarParaAtualizar<Linha>(
        `SELECT id, versao, procedimento_cirurgico_id, item_faturavel_id, quantidade_kits, padrao, excluido_em
           FROM kit_material_procedimento WHERE kit_material_id = ?`,
        [kit],
      );
  const porAlvo = new Map(
    vinculos.map((r) => [
      chaveProcedimentoKit({
        procedimentoCirurgico: idOuNulo(r['procedimento_cirurgico_id']),
        itemFaturavel: idOuNulo(r['item_faturavel_id']),
      }),
      r,
    ]),
  );
  const novos = new Set<string>();
  let vinculados = 0;
  for (const [i, p] of e.procedimentos.entries()) {
    const chave = chaveProcedimentoKit(p);
    novos.add(chave);
    // O procedimento já está travado (acima); o conflito do padrão é lido com trava, para enxergar o que a gravação
    // anterior do mesmo procedimento confirmou.
    const antigo = porAlvo.get(chave);
    if (!referencias.get(chave) && !(antigo && antigo['excluido_em'] === null))
      throw recusa('referencia-inexistente', `O procedimento da linha ${i + 1} não está ativo.`, {
        campos: [`procedimentos.${i}`],
      });
    if (p.padrao && e.ativo) {
      const [conflito] = await tx.consultarParaAtualizar<Linha>(
        `SELECT k.codigo FROM kit_material_procedimento kp
           JOIN kit_material k ON k.id = kp.kit_material_id
          WHERE k.estabelecimento_id = ? AND k.ativo AND k.excluido_em IS NULL AND k.id <> ?
            AND kp.padrao AND kp.excluido_em IS NULL
            AND kp.procedimento_cirurgico_id <=> ? AND kp.item_faturavel_id <=> ?
          LIMIT 1`,
        [est, kit, p.procedimentoCirurgico, p.itemFaturavel],
      );
      if (conflito)
        throw recusa(
          'kit-padrao-duplicado',
          `O procedimento da linha ${i + 1} já tem o kit ${String(conflito['codigo'])} como padrão: desmarque um dos dois.`,
          { campos: [`procedimentos.${i}.padrao`] },
        );
    }
    const campos = { quantidade_kits: p.quantidadeKits, padrao: p.padrao };
    if (!antigo) {
      await tx.incluir('kit_material_procedimento', {
        kit_material_id: kit,
        procedimento_cirurgico_id: p.procedimentoCirurgico,
        item_faturavel_id: p.itemFaturavel,
        ...campos,
      });
      vinculados += 1;
    } else if (
      antigo['excluido_em'] !== null ||
      n(antigo['quantidade_kits']) !== p.quantidadeKits ||
      verdadeiro(antigo['padrao']) !== p.padrao
    ) {
      await tx.alterar('kit_material_procedimento', n(antigo['id']), n(antigo['versao']), {
        ...campos,
        excluido_em: null,
        excluido_por: null,
      });
      vinculados += 1;
    }
  }
  let desvinculados = 0;
  for (const [chave, r] of porAlvo)
    if (!novos.has(chave) && r['excluido_em'] === null) {
      await tx.alterar('kit_material_procedimento', n(r['id']), n(r['versao']), {
        excluido_em: agora,
        excluido_por: usuario,
      });
      desvinculados += 1;
    }
  return {
    id: kit,
    kit,
    entram: d.entram.length,
    mudam: d.mudam.length,
    saem: d.saem.length,
    vinculados,
    desvinculados,
  };
}

/** Os kits padrão do estabelecimento para o cadastro (ativos e inativos), com a composição e os procedimentos. */
export async function lerKitsPadraoCadastro(l: Leitor, est: number): Promise<KitPadraoCadastro[]> {
  const kits = await l.consultar<Linha>(
    `SELECT id, versao, codigo, nome, tipo, permite_quantidade_acima, permite_similar, observacao, ativo
       FROM kit_material WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY ativo DESC, nome, id`,
    [est],
  );
  const itens = await l.consultar<Linha>(
    `SELECT ki.kit_material_id, ki.insumo_id, i.nome, u.sigla, ki.quantidade, ki.obrigatorio_kit_rastreavel,
            ki.permite_substituto
       FROM kit_material_item ki
       JOIN kit_material k ON k.id = ki.kit_material_id
       JOIN insumo i ON i.id = ki.insumo_id
       JOIN unidade_medida u ON u.id = ki.unidade_medida_id
      WHERE k.estabelecimento_id = ? AND ki.excluido_em IS NULL
      ORDER BY ki.kit_material_id, ki.sequencia`,
    [est],
  );
  const procs = await l.consultar<Linha>(
    `SELECT kp.kit_material_id, kp.procedimento_cirurgico_id, kp.item_faturavel_id, kp.quantidade_kits, kp.padrao,
            COALESCE(pc.codigo, f.codigo) AS codigo, COALESCE(pc.descricao, f.descricao) AS nome
       FROM kit_material_procedimento kp
       JOIN kit_material k ON k.id = kp.kit_material_id
       LEFT JOIN procedimento_cirurgico pc ON pc.id = kp.procedimento_cirurgico_id
       LEFT JOIN item_faturavel f ON f.id = kp.item_faturavel_id
      WHERE k.estabelecimento_id = ? AND kp.excluido_em IS NULL
      ORDER BY kp.kit_material_id, kp.id`,
    [est],
  );
  return kits.map((k) => ({
    id: n(k['id']),
    versao: n(k['versao']),
    codigo: String(k['codigo']),
    nome: String(k['nome']),
    tipo: String(k['tipo']) as TipoKitPadrao,
    permiteQuantidadeAcima: verdadeiro(k['permite_quantidade_acima']),
    permiteSimilar: verdadeiro(k['permite_similar']),
    observacao: k['observacao'] === null ? null : String(k['observacao']),
    ativo: verdadeiro(k['ativo']),
    itens: itens
      .filter((i) => n(i['kit_material_id']) === n(k['id']))
      .map((i) => ({
        insumo: n(i['insumo_id']),
        nome: String(i['nome']),
        unidade: String(i['sigla']),
        quantidade: n(i['quantidade']),
        obrigatorioRastreavel: verdadeiro(i['obrigatorio_kit_rastreavel']),
        permiteSubstituto: verdadeiro(i['permite_substituto']),
      })),
    procedimentos: procs
      .filter((p) => n(p['kit_material_id']) === n(k['id']))
      .map((p) => ({
        procedimentoCirurgico: idOuNulo(p['procedimento_cirurgico_id']),
        itemFaturavel: idOuNulo(p['item_faturavel_id']),
        codigo: String(p['codigo'] ?? ''),
        nome: String(p['nome'] ?? ''),
        quantidadeKits: n(p['quantidade_kits']),
        padrao: verdadeiro(p['padrao']),
      })),
  }));
}

/** A busca da cirurgia ou do procedimento faturável (código ou nome) para o vínculo do kit. */
export async function buscarProcedimentosKit(l: Leitor, termo: string): Promise<ProcedimentoKitBusca[]> {
  const t = termo.trim();
  if (t.length < 2) return [];
  const como = `%${t.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const cir = await l.consultar<Linha>(
    `SELECT id, codigo, descricao FROM procedimento_cirurgico
      WHERE ativo AND (codigo = ? OR descricao LIKE ?) ORDER BY descricao LIMIT 20`,
    [t, como],
  );
  const fat = await l.consultar<Linha>(
    `SELECT id, codigo, descricao FROM item_faturavel
      WHERE situacao = 'ativo' AND (codigo = ? OR descricao LIKE ?) ORDER BY descricao LIMIT 20`,
    [t, como],
  );
  return [
    ...cir.map((r) => ({
      procedimentoCirurgico: n(r['id']),
      itemFaturavel: null,
      codigo: String(r['codigo']),
      nome: String(r['descricao']),
    })),
    ...fat.map((r) => ({
      procedimentoCirurgico: null,
      itemFaturavel: n(r['id']),
      codigo: String(r['codigo']),
      nome: String(r['descricao']),
    })),
  ];
}

/**
 * Os kits padrão ativos das cirurgias (vínculo ativo, marcado como padrão, de kit ativo do estabelecimento): a
 * sugestão do gasto de sala do ato os soma à lista padrão de material (regra `linhasDoKitPadrao`).
 */
export async function lerKitsPadraoDosProcedimentos(
  l: Leitor,
  est: number,
  procedimentos: readonly number[],
): Promise<KitPadraoDoProcedimento[]> {
  if (!procedimentos.length) return [];
  return (
    await l.consultar<Linha>(
      `SELECT kp.id, kp.procedimento_cirurgico_id, kp.kit_material_id, kp.quantidade_kits
         FROM kit_material_procedimento kp
         JOIN kit_material k ON k.id = kp.kit_material_id
        WHERE k.estabelecimento_id = ? AND k.ativo AND k.excluido_em IS NULL
          AND kp.padrao AND kp.excluido_em IS NULL
          AND kp.procedimento_cirurgico_id IN (${procedimentos.map(() => '?').join(', ')})
        ORDER BY kp.id`,
      [est, ...procedimentos],
    )
  ).map((r) => ({
    vinculo: n(r['id']),
    procedimento: n(r['procedimento_cirurgico_id']),
    kit: n(r['kit_material_id']),
    quantidadeKits: n(r['quantidade_kits']),
  }));
}

/**
 * O kit padrão das cirurgias e dos procedimentos achados pelo termo (código exato ou parte do nome), com a
 * composição vigente: é o que a tela do pedido de material soma de uma vez (regra `somarKitAoPedido`). Só o vínculo
 * marcado como padrão de kit ativo do estabelecimento.
 */
export async function lerKitsPadraoSugeridos(
  l: Leitor,
  est: number,
  termo: string,
): Promise<KitPadraoSugerido[]> {
  const t = termo.trim();
  if (t.length < 2) return [];
  const como = `%${t.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const vinculos = await l.consultar<Linha>(
    `SELECT kp.procedimento_cirurgico_id, kp.item_faturavel_id, kp.quantidade_kits,
            COALESCE(pc.codigo, f.codigo) AS proc_codigo, COALESCE(pc.descricao, f.descricao) AS proc_nome,
            k.id, k.codigo, k.nome
       FROM kit_material_procedimento kp
       JOIN kit_material k ON k.id = kp.kit_material_id
       LEFT JOIN procedimento_cirurgico pc ON pc.id = kp.procedimento_cirurgico_id
       LEFT JOIN item_faturavel f ON f.id = kp.item_faturavel_id
      WHERE k.estabelecimento_id = ? AND k.ativo AND k.excluido_em IS NULL
        AND kp.padrao AND kp.excluido_em IS NULL
        AND (COALESCE(pc.codigo, f.codigo) = ? OR COALESCE(pc.descricao, f.descricao) LIKE ?)
      ORDER BY proc_nome, kp.id LIMIT 20`,
    [est, t, como],
  );
  if (!vinculos.length) return [];
  const kits = [...new Set(vinculos.map((v) => n(v['id'])))];
  const itens = await l.consultar<Linha>(
    `SELECT ki.kit_material_id, ki.insumo_id, i.nome, u.sigla, ki.quantidade
       FROM kit_material_item ki
       JOIN insumo i ON i.id = ki.insumo_id
       JOIN unidade_medida u ON u.id = ki.unidade_medida_id
      WHERE ki.excluido_em IS NULL AND ki.kit_material_id IN (${kits.map(() => '?').join(', ')})
      ORDER BY ki.kit_material_id, ki.sequencia`,
    kits,
  );
  return vinculos.map((v) => ({
    procedimentoCirurgico: idOuNulo(v['procedimento_cirurgico_id']),
    itemFaturavel: idOuNulo(v['item_faturavel_id']),
    procedimentoCodigo: String(v['proc_codigo'] ?? ''),
    procedimentoNome: String(v['proc_nome'] ?? ''),
    kit: n(v['id']),
    codigo: String(v['codigo']),
    nome: String(v['nome']),
    quantidadeKits: n(v['quantidade_kits']),
    itens: itens
      .filter((i) => n(i['kit_material_id']) === n(v['id']))
      .map((i) => ({
        insumo: n(i['insumo_id']),
        nome: String(i['nome']),
        unidade: String(i['sigla']),
        quantidade: n(i['quantidade']),
      })),
  }));
}

/**
 * As linhas do pedido de material que citam um kit (a marca fica gravada na linha): o kit é do estabelecimento, está
 * ativo e o item faz parte da composição vigente dele. Todas as recusas voltam juntas, antes de qualquer escrita.
 */
export async function conferirKitsDoPedido(
  tx: TxOperacao,
  est: number,
  itens: readonly { readonly item: number; readonly kit?: number | undefined }[],
): Promise<void> {
  const citados = [...new Set(itens.flatMap((i) => (i.kit === undefined ? [] : [i.kit])))];
  if (!citados.length) return;
  const marcas = citados.map(() => '?').join(', ');
  const kits = await tx.consultar<Linha>(
    `SELECT id, ativo FROM kit_material WHERE estabelecimento_id = ? AND excluido_em IS NULL AND id IN (${marcas})`,
    [est, ...citados],
  );
  const composicao = await tx.consultar<Linha>(
    `SELECT kit_material_id, insumo_id FROM kit_material_item
      WHERE excluido_em IS NULL AND kit_material_id IN (${marcas})`,
    citados,
  );
  const porKit = new Map(
    kits.map((k) => [
      n(k['id']),
      {
        ativo: verdadeiro(k['ativo']),
        insumos: composicao
          .filter((x) => n(x['kit_material_id']) === n(k['id']))
          .map((x) => n(x['insumo_id'])),
      },
    ]),
  );
  recusarTodas(
    itens.flatMap((i, linha) =>
      i.kit === undefined ? [] : conferirKitDoPedido(porKit.get(i.kit) ?? null, i.item, linha),
    ),
  );
}
