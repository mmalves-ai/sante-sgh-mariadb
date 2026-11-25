// Transferência da conta inteira, por lote e estorno, com a cobertura no destino e a sugestão vinda da troca de
// convênio da internação (F3.7, 06-FAT linha 14), sobre o banco do cliente. As regras são do @sgh/dominio-faturamento
// (conta/transferencia e conta/movimentos); aqui só se lê, confere pelo domínio e grava. A transferência de cada conta
// usa a mesma gravação da transferência de itens (faturamento.transferir-itens-conta), na mesma transação.
// Contrato de efeito (conta-transferencia-propria.int.spec.ts):
// - conta inteira: com destino novo, nasce a conta_hospitalar na nova fonte (e plano), no mesmo atendimento
//   (atendimento_conta), com número do atendimento e a ordem; os itens transferíveis (desde o dia, quando dado) vão
//   para ela; item sem preço no destino só com o aceite e a justificativa (gravada na observação da transferência);
// - lote: várias contas do paciente numa só transação (tudo ou nada);
// - estorno: o item de destino fica "estornado", o de origem volta a "lancado", a equipe da origem volta e a do
//   destino é encerrada pela transferência; a transferência fica "estornada" com autor, data e motivo; nada se apaga.
import {
  competenciaDaConta,
  contaEditavel,
  itensDaContaInteira,
  numeroDaConta,
  sugerirTransferenciaPorTroca,
  validarDestinoNovo,
  validarEstornoTransferencia,
  validarLote,
} from '@sgh/dominio-faturamento';
import { type ContextoOperacao, definirOperacao, type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  type AcessoLeitura,
  diaDe,
  type DestinoDoPreco,
  opTransferir,
  podeNoEstabelecimento,
  precosNoDestino,
} from './conta-movimentos-propria.js';
import { totalDosItens } from './operacoes.js';

type Linha = Record<string, unknown>;
type Consulta = Pick<Leitor, 'consultar' | 'uma'>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const r2 = (x: number) => Math.round(x * 100) / 100;

function exigirValido(erros: Record<string, string>) {
  const campos = Object.keys(erros);
  if (campos.length) throw recusa('invalido', Object.values(erros).join(' '), { campos });
}
function estDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.', { campos: [] });
  return ctx.estabelecimento;
}

interface Conta {
  id: number;
  estabelecimento: number;
  numero: string;
  situacao: string;
  atendimento: number;
  paciente: number;
  fontePagadora: number;
  plano: number | null;
  tabela: number | null;
  tipoConta: number;
  natureza: string;
  categoriaAcomodacao: number | null;
  inicio: unknown;
  fim: unknown;
}
const SQL_CONTA = `SELECT id, estabelecimento_id, numero, situacao, atendimento_id, paciente_id, fonte_pagadora_id,
  plano_fonte_pagadora_id, tabela_preco_id, tipo_conta_id, natureza, categoria_acomodacao_id, inicio_em, fim_em
  FROM conta_hospitalar WHERE id = ? AND excluido_em IS NULL`;
async function contaDe(l: Consulta, id: number, est: number | null): Promise<Conta> {
  const c = await l.uma<Linha>(
    `${SQL_CONTA}${est === null ? '' : ' AND estabelecimento_id = ?'}`,
    est === null ? [id] : [id, est],
  );
  if (!c)
    throw recusa('nao-encontrado', 'A conta não existe neste estabelecimento.', { campos: ['contaId'] });
  return {
    id: n(c['id']),
    estabelecimento: n(c['estabelecimento_id']),
    numero: txt(c['numero']),
    situacao: txt(c['situacao']),
    atendimento: n(c['atendimento_id']),
    paciente: n(c['paciente_id']),
    fontePagadora: n(c['fonte_pagadora_id']),
    plano: nn(c['plano_fonte_pagadora_id']),
    tabela: nn(c['tabela_preco_id']),
    tipoConta: n(c['tipo_conta_id']),
    natureza: txt(c['natureza']),
    categoriaAcomodacao: nn(c['categoria_acomodacao_id']),
    inicio: c['inicio_em'],
    fim: c['fim_em'],
  };
}

async function itensDe(l: Consulta, conta: number) {
  const r = await l.consultar<Linha>(
    `SELECT id, situacao, realizado_em, item_faturavel_id, quantidade, valor_total FROM conta_hospitalar_item
      WHERE conta_hospitalar_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
    [conta],
    { teto: 5000 },
  );
  return r.map((i) => ({
    id: n(i['id']),
    situacao: txt(i['situacao']),
    realizado: diaDe(i['realizado_em']),
    realizadoEm: i['realizado_em'],
    itemFaturavel: n(i['item_faturavel_id']),
    quantidade: n(i['quantidade']),
    valor: n(i['valor_total']),
  }));
}

/**
 * A prévia da cobertura: o preço de cada item no destino pela mesma busca da gravação (precosNoDestino, no
 * estabelecimento da conta de destino e no dia do item), para que o que o painel mostra seja o que se grava.
 */
async function coberturaNoDestino(
  l: Consulta,
  destino: DestinoDoPreco,
  itens: Awaited<ReturnType<typeof itensDe>>,
) {
  const precos = await precosNoDestino(l, destino, itens);
  return itens.map((i) => {
    const p = precos.get(i.id) ?? null;
    return { id: i.id, precoNoDestino: Boolean(p), valorDestino: p ? r2(p.unitario * i.quantidade) : null };
  });
}

async function lerDestinoNovo(l: Consulta, fonte: number, plano: number | null) {
  const f = await l.uma<Linha>(
    'SELECT id, situacao FROM fonte_pagadora WHERE id = ? AND excluido_em IS NULL',
    [fonte],
  );
  const p =
    plano === null
      ? null
      : await l.uma<Linha>('SELECT fonte_pagadora_id, situacao FROM plano_fonte_pagadora WHERE id = ?', [
          plano,
        ]);
  return {
    fontePagadora: fonte,
    plano,
    fonteDoPlano: p ? n(p['fonte_pagadora_id']) : null,
    fonteAtiva: txt(f?.['situacao']) === 'ativa',
    planoAtivo: p ? txt(p['situacao']) === 'ativo' : false,
  };
}

// ── Gravações ─────────────────────────────────────────────────────────────────────────────────────────

const id = z.number().int().positive();
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data AAAA-MM-DD.');
const destinoNovoZ = z.object({ fontePagadoraId: id, planoId: id.nullable().default(null) });
const comum = {
  desde: dia.nullable().default(null),
  motivo: z.string().trim().max(500),
  observacao: z.string().trim().max(500).nullable().default(null),
  aceitarSemCobertura: z.boolean().default(false),
  justificativaCobertura: z.string().trim().max(400).nullable().default(null),
};
export const esquemaTransferirConta = z
  .object({
    contaOrigemId: id,
    contaDestinoId: id.nullable().default(null),
    destinoNovo: destinoNovoZ.nullable().default(null),
    ...comum,
  })
  .refine((e) => (e.contaDestinoId === null) !== (e.destinoNovo === null), {
    message: 'Escolha uma conta de destino ou a nova fonte pagadora (um dos dois).',
    path: ['contaDestinoId'],
  });
type TransferirConta = z.infer<typeof esquemaTransferirConta>;

const TABELAS = [...new Set([...opTransferir.tabelas, 'conta_hospitalar', 'atendimento_conta'])];

async function transferirUmaConta(tx: TxOperacao, e: TransferirConta, ctx: ContextoOperacao) {
  const est = estDe(ctx);
  await tx.consultarParaAtualizar('SELECT id FROM conta_hospitalar WHERE id = ?', [e.contaOrigemId]);
  const origem = await contaDe(tx, e.contaOrigemId, est);
  let destino: {
    id: number;
    fontePagadora: number;
    plano: number | null;
    tabela: number | null;
    numero: string;
  };
  let aberta = false;
  if (e.destinoNovo) {
    const d = await lerDestinoNovo(tx, e.destinoNovo.fontePagadoraId, e.destinoNovo.planoId);
    exigirValido(validarDestinoNovo(origem, d));
    const at = await tx.uma<Linha>('SELECT numero FROM atendimento WHERE id = ?', [origem.atendimento]);
    const ordem = await tx.uma<Linha>('SELECT COUNT(*) AS n FROM conta_hospitalar WHERE atendimento_id = ?', [
      origem.atendimento,
    ]);
    const inicio = e.desde ? `${e.desde} 00:00:00` : origem.inicio;
    const numero = numeroDaConta(txt(at?.['numero']), n(ordem?.['n']) + 1);
    const nova = await tx.incluir('conta_hospitalar', {
      estabelecimento_id: origem.estabelecimento,
      numero,
      atendimento_id: origem.atendimento,
      paciente_id: origem.paciente,
      fonte_pagadora_id: d.fontePagadora,
      plano_fonte_pagadora_id: d.plano,
      tabela_preco_id: null,
      tipo_conta_id: origem.tipoConta,
      categoria_acomodacao_id: origem.categoriaAcomodacao,
      natureza: origem.natureza,
      tipo_cobranca: 'total',
      competencia: competenciaDaConta(
        e.desde ?? diaDe(origem.inicio) ?? new Date().toISOString().slice(0, 10),
      ),
      inicio_em: inicio,
      fim_em: origem.fim ?? null,
      situacao: 'aberta',
      origem: 'sistema',
    });
    await tx.incluir('atendimento_conta', { atendimento_id: origem.atendimento, conta_hospitalar_id: nova });
    destino = { id: nova, fontePagadora: d.fontePagadora, plano: d.plano, tabela: null, numero };
    aberta = true;
  } else {
    const c = await contaDe(tx, e.contaDestinoId!, null);
    destino = {
      id: c.id,
      fontePagadora: c.fontePagadora,
      plano: c.plano,
      tabela: c.tabela,
      numero: c.numero,
    };
  }
  const itens = await itensDe(tx, origem.id);
  const levar = itensDaContaInteira(itens, e.desde);
  if (!levar.length)
    throw recusa(
      'sem-itens',
      'A conta não tem item lançado ou conferido para transferir (desde o dia dado).',
      {
        campos: ['contaOrigemId'],
      },
    );
  // A cobertura no destino (preço no estabelecimento, fonte, plano e tabela da conta de destino; aceite e
  // justificativa) é conferida dentro da transferência dos itens, o ponto único de toda transferência.
  const r = await opTransferir.gravar(
    tx,
    {
      contaOrigemId: origem.id,
      contaDestinoId: destino.id,
      itens: levar,
      motivo: e.motivo,
      observacao: e.observacao,
      aceitarSemCobertura: e.aceitarSemCobertura,
      justificativaCobertura: e.justificativaCobertura,
    },
    ctx,
  );
  return {
    ...r,
    contaOrigemId: origem.id,
    contaDestinoId: destino.id,
    contaDestinoNumero: destino.numero,
    contaAberta: aberta,
    semCobertura: r.semPreco,
  };
}

export const opTransferirConta = definirOperacao({
  nome: 'faturamento.transferir-conta',
  tabelas: TABELAS,
  entrada: esquemaTransferirConta,
  async gravar(tx, e, ctx) {
    return transferirUmaConta(tx, e, ctx);
  },
  alvo: (_e, r) => ({ tabela: 'transferencia_conta', id: r.id }),
  trilha: (e) => ({ motivo: e.motivo, justificativaCobertura: e.justificativaCobertura }),
});

export const esquemaTransferirLote = z.object({
  contas: z.array(z.object({ contaOrigemId: id, contaDestinoId: id.nullable().default(null) })).max(200),
  destinoNovo: destinoNovoZ.nullable().default(null),
  ...comum,
});

export const opTransferirLote = definirOperacao({
  nome: 'faturamento.transferir-contas-lote',
  tabelas: TABELAS,
  entrada: esquemaTransferirLote,
  async gravar(tx, e, ctx) {
    exigirValido(
      validarLote(
        e.contas.map((c) => c.contaOrigemId),
        e.motivo,
      ),
    );
    // Trava todas as contas de origem na ordem do id antes de mexer em qualquer uma (sem impasse entre lotes).
    for (const c of [...e.contas.map((x) => x.contaOrigemId)].sort((a, b) => a - b))
      await tx.consultarParaAtualizar('SELECT id FROM conta_hospitalar WHERE id = ?', [c]);
    const feitas = [];
    for (const c of e.contas) {
      if (c.contaDestinoId === null && e.destinoNovo === null)
        throw recusa(
          'invalido',
          'Cada conta do lote precisa de uma conta de destino ou da nova fonte pagadora.',
          {
            campos: ['destinoNovo'],
          },
        );
      feitas.push(
        await transferirUmaConta(
          tx,
          esquemaTransferirConta.parse({
            contaOrigemId: c.contaOrigemId,
            contaDestinoId: c.contaDestinoId,
            destinoNovo: c.contaDestinoId === null ? e.destinoNovo : null,
            desde: e.desde,
            motivo: e.motivo,
            observacao: e.observacao,
            aceitarSemCobertura: e.aceitarSemCobertura,
            justificativaCobertura: e.justificativaCobertura,
          }),
          ctx,
        ),
      );
    }
    return {
      id: feitas[0]!.id,
      contas: feitas.length,
      itens: feitas.reduce((s, f) => s + f.itens, 0),
      valorOrigem: r2(feitas.reduce((s, f) => s + f.valorOrigem, 0)),
      valorDestino: r2(feitas.reduce((s, f) => s + f.valorDestino, 0)),
      semPreco: feitas.reduce((s, f) => s + f.semPreco, 0),
      // Resultado plano (o executor guarda escalares): as transferências e as contas de destino, na ordem do lote.
      transferencias: feitas.map((f) => f.numero).join(', '),
      contasDestino: feitas.map((f) => f.contaDestinoId).join(','),
      contaDestinoNumero: feitas.map((f) => f.contaDestinoNumero).join(', '),
    };
  },
  alvo: (_e, r) => ({ tabela: 'transferencia_conta', id: r.id }),
  trilha: (e) => ({ motivo: e.motivo, contas: e.contas.length }),
});

export const esquemaEstornarTransferencia = z.object({
  transferenciaId: id,
  motivo: z.string().trim().max(500),
});

export const opEstornarTransferencia = definirOperacao({
  nome: 'faturamento.estornar-transferencia',
  tabelas: [
    'transferencia_conta',
    'conta_hospitalar_item',
    'conta_hospitalar_item_participante',
    'conta_hospitalar_item_memoria',
    'conta_hospitalar',
  ],
  entrada: esquemaEstornarTransferencia,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    if (ctx.usuario === null)
      throw recusa('sem-usuario', 'O estorno exige o usuário da sessão (autor).', { campos: [] });
    const t = await tx.uma<Linha>(
      `SELECT id, versao, numero, situacao, conta_origem_id, conta_destino_id FROM transferencia_conta
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [e.transferenciaId, est],
    );
    if (!t)
      throw recusa('nao-encontrado', 'A transferência não existe neste estabelecimento.', {
        campos: ['transferenciaId'],
      });
    const co = n(t['conta_origem_id']);
    const cd = n(t['conta_destino_id']);
    for (const x of [co, cd].sort((a, b) => a - b))
      await tx.consultarParaAtualizar('SELECT id FROM conta_hospitalar WHERE id = ?', [x]);
    const origem = await contaDe(tx, co, est);
    const destino = await contaDe(tx, cd, null);
    if (
      destino.estabelecimento !== est &&
      !(await podeNoEstabelecimento(
        tx,
        ctx.usuario,
        destino.estabelecimento,
        'faturamento.auditoria.ajustar',
      ))
    )
      throw recusa(
        'sem-permissao-estabelecimento',
        'Você não tem acesso ao faturamento do estabelecimento da conta de destino.',
        { campos: ['transferenciaId'] },
      );
    const pares = await tx.consultar<Linha>(
      `SELECT ti.item_origem_id, ti.item_destino_id, o.versao AS vo, o.situacao AS so, d.versao AS vd,
              d.situacao AS sd, d.valor_total AS valor_destino, o.valor_total AS valor_origem
         FROM transferencia_conta_item ti
         JOIN conta_hospitalar_item o ON o.id = ti.item_origem_id
         LEFT JOIN conta_hospitalar_item d ON d.id = ti.item_destino_id
        WHERE ti.transferencia_conta_id = ? AND ti.excluido_em IS NULL ORDER BY ti.sequencia`,
      [e.transferenciaId],
      { teto: 2000 },
    );
    exigirValido(
      validarEstornoTransferencia(
        {
          situacao: txt(t['situacao']),
          contaOrigemSituacao: origem.situacao,
          contaDestinoSituacao: destino.situacao,
          itensDestino: pares.map((p) => txt(p['sd'])),
          itensOrigem: pares.map((p) => txt(p['so'])),
        },
        e.motivo,
      ),
    );
    const agora = new Date();
    const memoria = (item: number, valor: number, dados: Record<string, unknown>) =>
      tx.incluir('conta_hospitalar_item_memoria', {
        conta_hospitalar_item_id: item,
        tabela_preco_id: null,
        valor_unitario_calculado: null,
        valor_total_calculado: valor,
        preco_manual: 0,
        operacao: 'alteracao',
        dados: JSON.stringify({ origem: 'estorno_transferencia', transferencia: txt(t['numero']), ...dados }),
        ocorrido_em: agora,
        usuario_id: ctx.usuario,
      });
    for (const p of pares) {
      const io = n(p['item_origem_id']);
      const idd = nn(p['item_destino_id']);
      if (idd !== null) {
        await tx.alterar('conta_hospitalar_item', idd, n(p['vd']), { situacao: 'estornado' });
        await memoria(idd, n(p['valor_destino']), { situacao: 'estornado', itemOrigem: io });
        const eqd = await tx.consultar<Linha>(
          `SELECT id, versao FROM conta_hospitalar_item_participante
            WHERE conta_hospitalar_item_id = ? AND excluido_em IS NULL`,
          [idd],
          { teto: 100 },
        );
        for (const q of eqd)
          await tx.alterar('conta_hospitalar_item_participante', n(q['id']), n(q['versao']), {
            excluido_em: agora,
            excluido_por: ctx.usuario,
            transferencia_conta_id: e.transferenciaId,
          });
      }
      await tx.alterar('conta_hospitalar_item', io, n(p['vo']), { situacao: 'lancado' });
      await memoria(io, n(p['valor_origem']), { situacao: 'lancado', itemDestino: idd });
      // A equipe encerrada pela transferência volta na mesma linha.
      const eqo = await tx.consultar<Linha>(
        `SELECT id, versao FROM conta_hospitalar_item_participante
          WHERE conta_hospitalar_item_id = ? AND transferencia_conta_id = ? AND excluido_em IS NOT NULL`,
        [io, e.transferenciaId],
        { teto: 100 },
      );
      for (const q of eqo)
        await tx.alterar('conta_hospitalar_item_participante', n(q['id']), n(q['versao']), {
          excluido_em: null,
          excluido_por: null,
          transferencia_conta_id: null,
        });
    }
    for (const c of [origem.id, destino.id]) {
      const v = await tx.uma<Linha>('SELECT versao FROM conta_hospitalar WHERE id = ?', [c]);
      await tx.alterar('conta_hospitalar', c, n(v?.['versao']), await totalDosItens(tx, c));
    }
    await tx.alterar('transferencia_conta', e.transferenciaId, n(t['versao']), {
      situacao: 'estornada',
      estornado_em: agora,
      estorno_usuario_id: ctx.usuario,
      motivo_estorno: e.motivo,
    });
    return { id: e.transferenciaId, numero: txt(t['numero']), itens: pares.length };
  },
  alvo: (e) => ({ tabela: 'transferencia_conta', id: e.transferenciaId }),
  trilha: (e) => ({ motivo: e.motivo }),
});

export const OPERACOES_TRANSFERENCIA = {
  conta: opTransferirConta,
  lote: opTransferirLote,
  estorno: opEstornarTransferencia,
} as const;
export type NomeOperacaoTransferencia = keyof typeof OPERACOES_TRANSFERENCIA;

// ── Leitura: o painel da transferência da conta ───────────────────────────────────────────────────────

export interface DestinoPrevia {
  contaDestinoId?: number | null;
  fontePagadoraId?: number | null;
  planoId?: number | null;
  desde?: string | null;
}

/**
 * O painel: a conta, as fontes e os planos ativos, as outras contas abertas do paciente (para o lote), a sugestão pela
 * troca de convênio da internação, as transferências da conta (com o estorno) e, com um destino dado, a prévia da
 * cobertura de cada item lá.
 */
export async function painelTransferenciaPropria(
  l: Consulta,
  est: number,
  contaId: number,
  acesso: AcessoLeitura,
  previa: DestinoPrevia = {},
) {
  const conta = await contaDe(l, contaId, est);
  const itens = await itensDe(l, conta.id);
  const fontes = await l.consultar<Linha>(
    "SELECT id, nome FROM fonte_pagadora WHERE situacao = 'ativa' AND excluido_em IS NULL ORDER BY nome",
    [],
    { teto: 2000 },
  );
  const planos = await l.consultar<Linha>(
    "SELECT id, fonte_pagadora_id, descricao FROM plano_fonte_pagadora WHERE situacao = 'ativo' ORDER BY descricao",
    [],
    { teto: 5000 },
  );
  const outras = await l.consultar<Linha>(
    `SELECT c.id, c.numero, c.situacao, f.nome AS fonte,
            (SELECT COUNT(*) FROM conta_hospitalar_item i WHERE i.conta_hospitalar_id = c.id AND i.excluido_em IS NULL
                AND i.situacao IN ('lancado','conferido')) AS transferiveis
       FROM conta_hospitalar c JOIN fonte_pagadora f ON f.id = c.fonte_pagadora_id
      WHERE c.paciente_id = ? AND c.estabelecimento_id = ? AND c.excluido_em IS NULL AND c.id <> ?
        AND c.fonte_pagadora_id = ? ORDER BY c.inicio_em`,
    [conta.paciente, est, conta.id, conta.fontePagadora],
    { teto: 200 },
  );
  const trocas = await l.consultar<Linha>(
    `SELECT t.ocorrido_em, t.nova_fonte_pagadora_id, t.novo_plano_fonte_pagadora_id
       FROM troca_internacao t
       JOIN tipo_troca_internacao tt ON tt.id = t.tipo_troca_internacao_id
       JOIN internacao i ON i.id = t.internacao_id
      WHERE i.atendimento_id = ? AND i.excluido_em IS NULL AND tt.dado_trocado IN ('fonte_pagadora','plano')
        AND (t.nova_fonte_pagadora_id IS NOT NULL OR t.novo_plano_fonte_pagadora_id IS NOT NULL)
      ORDER BY t.ocorrido_em`,
    [conta.atendimento],
    { teto: 200 },
  );
  const sugestao = sugerirTransferenciaPorTroca(
    conta,
    trocas.map((x) => ({
      dia: diaDe(x['ocorrido_em']) ?? '',
      // Troca só de plano: a fonte continua a da conta.
      novaFonte: nn(x['nova_fonte_pagadora_id']) ?? conta.fontePagadora,
      novoPlano: nn(x['novo_plano_fonte_pagadora_id']),
    })),
    itens,
  );
  const transferencias = await l.consultar<Linha>(
    `SELECT t.id, t.numero, t.tipo, t.situacao, t.conta_origem_id, t.conta_destino_id, t.transferido_em, t.motivo,
            t.motivo_estorno, t.estornado_em, co.numero AS origem_numero, cd.numero AS destino_numero
       FROM transferencia_conta t
       JOIN conta_hospitalar co ON co.id = t.conta_origem_id
       JOIN conta_hospitalar cd ON cd.id = t.conta_destino_id
      WHERE (t.conta_origem_id = ? OR t.conta_destino_id = ?) AND t.excluido_em IS NULL
      ORDER BY t.transferido_em DESC`,
    [conta.id, conta.id],
    { teto: 500 },
  );
  let previaItens: { id: number; precoNoDestino: boolean; valorDestino: number | null }[] = [];
  if (previa.contaDestinoId || previa.fontePagadoraId) {
    let destino: DestinoDoPreco;
    if (previa.contaDestinoId) {
      const d = await contaDe(l, previa.contaDestinoId, null);
      if (d.paciente !== conta.paciente)
        throw recusa('invalido', 'A conta de destino é de outro paciente.', { campos: ['contaDestinoId'] });
      if (
        d.estabelecimento !== est &&
        !acesso.total &&
        !(await podeNoEstabelecimento(l, acesso.usuario, d.estabelecimento, 'faturamento.conta.ler'))
      )
        throw recusa('sem-permissao-estabelecimento', 'Você não tem acesso ao faturamento de lá.', {
          campos: ['contaDestinoId'],
        });
      destino = {
        estabelecimento: d.estabelecimento,
        fontePagadora: d.fontePagadora,
        plano: d.plano,
        tabela: d.tabela,
      };
    } else
      // Conta nova: nasce no estabelecimento da conta de origem, sem tabela própria.
      destino = {
        estabelecimento: conta.estabelecimento,
        fontePagadora: previa.fontePagadoraId!,
        plano: previa.planoId ?? null,
        tabela: null,
      };
    const levar = itensDaContaInteira(itens, previa.desde ?? null);
    previaItens = await coberturaNoDestino(
      l,
      destino,
      itens.filter((i) => levar.includes(i.id)),
    );
  }
  const nomeFonte = new Map(fontes.map((f) => [n(f['id']), txt(f['nome'])]));
  return {
    contaId: conta.id,
    numero: conta.numero,
    situacao: conta.situacao,
    editavel: contaEditavel(conta.situacao),
    fontePagadoraId: conta.fontePagadora,
    planoId: conta.plano,
    fontes: fontes.map((f) => ({ id: n(f['id']), nome: txt(f['nome']) })),
    planos: planos.map((p) => ({
      id: n(p['id']),
      fonteId: n(p['fonte_pagadora_id']),
      descricao: txt(p['descricao']),
    })),
    outrasContas: outras.map((c) => ({
      id: n(c['id']),
      numero: txt(c['numero']),
      fonte: txt(c['fonte']),
      aberta: contaEditavel(txt(c['situacao'])),
      transferiveis: n(c['transferiveis']),
    })),
    transferiveis: itensDaContaInteira(itens).length,
    sugestao: sugestao ? { ...sugestao, fonte: nomeFonte.get(sugestao.fontePagadora) ?? '' } : null,
    transferencias: transferencias.map((t) => ({
      id: n(t['id']),
      numero: txt(t['numero']),
      tipo: txt(t['tipo']),
      situacao: txt(t['situacao']),
      saiu: n(t['conta_origem_id']) === conta.id,
      origem: txt(t['origem_numero']),
      destino: txt(t['destino_numero']),
      em:
        t['transferido_em'] instanceof Date
          ? (t['transferido_em'] as Date).toISOString()
          : txt(t['transferido_em']),
      motivo: txt(t['motivo']),
      motivoEstorno: t['motivo_estorno'] === null ? null : txt(t['motivo_estorno']),
    })),
    previa: previaItens.map((p) => {
      const i = itens.find((x) => x.id === p.id)!;
      return { ...p, valorOrigem: i.valor, realizado: i.realizado };
    }),
  };
}
