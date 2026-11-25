// F3.8, 07-FIN linha 76: renegociação de títulos a receber no banco próprio, pelo executor do @sgh/nucleo (trilha,
// outbox e idempotência na mesma transação). A regra é a do domínio (planejarRenegociacao, conferirDesfazerRenegociacao);
// aqui ficam a leitura sob a trava e a gravação.
// Renegociar: as parcelas em aberto dos títulos escolhidos (todos do mesmo devedor) ficam "renegociadas" com saldo zero,
// o acordo guarda o saldo que cada uma levou (com a parte dos juros, da multa e do desconto) e nasce UM título novo de
// origem "acordo", parcelado. O título original sem mais nada em aberto fica "renegociado". Nada é apagado.
// Desfazer: só o acordo sem recebimento; o título novo e as parcelas dele ficam cancelados com o motivo, as parcelas
// originais voltam com o saldo que levaram e o acordo fica cancelado, no histórico.
import {
  conferirDesfazerRenegociacao,
  planejarRenegociacao,
  type RecusaFinanceiro,
} from '@sgh/dominio-financeiro';
import {
  type ContextoOperacao,
  definirOperacao,
  garantirSequencia,
  type Leitor,
  recusa,
  type ResultadoOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { exigirPeriodoAberto } from './periodo-propria.js';
import { dataIso, instanteIso, numero } from './vocabulario.js';

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.number().int().positive();
const dinheiro = z.number().min(0).max(9_999_999_999_999);
const hojeIso = () => new Date().toISOString().slice(0, 10);
const ph = (n: readonly unknown[]) => n.map(() => '?').join(',');
const digitos = (v: unknown, tamanho: number): string | null => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === tamanho ? d : null;
};

function recusar<T extends object>(r: RecusaFinanceiro | T): T {
  if ('codigo' in r && 'mensagem' in r) {
    const x = r as RecusaFinanceiro;
    throw recusa(x.codigo, x.mensagem, x.campos ? { campos: x.campos } : {});
  }
  return r as T;
}
function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}
function usuarioDe(ctx: ContextoOperacao): number {
  if (ctx.usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  return ctx.usuario;
}

export const esquemaRenegociar = z
  .object({
    titulos: z.array(id).min(1).max(100),
    juros: dinheiro.default(0),
    multa: dinheiro.default(0),
    desconto: dinheiro.default(0),
    quantidadeParcelas: z.number().int().min(1).max(360),
    primeiroVencimento: DATA,
    observacao: z.string().trim().max(900).optional(),
  })
  .strict();
export const esquemaDesfazerRenegociacao = z
  .object({ renegociacao: id, motivo: z.string().trim().max(250) })
  .strict();

/** O devedor do título numa chave comparável e os campos que o acordo e o título novo repetem. */
function devedorDe(t: Record<string, unknown>): string {
  return `${String(t['tipo_devedor'])}:${numero(t['fonte_pagadora_id'] ?? t['paciente_id'] ?? t['cliente_financeiro_id'])}`;
}
async function identificacaoDoDevedor(
  l: Leitor,
  t: Record<string, unknown>,
): Promise<{ nome: string; cpf: string | null; cnpj: string | null }> {
  const tipo = String(t['tipo_devedor']);
  const linha =
    tipo === 'fonte_pagadora'
      ? await l.uma('SELECT nome FROM fonte_pagadora WHERE id = ?', [t['fonte_pagadora_id']])
      : tipo === 'paciente'
        ? await l.uma(
            'SELECT f.nome, f.cpf FROM paciente p JOIN pessoa_fisica f ON f.id = p.pessoa_fisica_id WHERE p.id = ?',
            [t['paciente_id']],
          )
        : await l.uma('SELECT nome, cpf, cnpj FROM cliente_financeiro WHERE id = ?', [
            t['cliente_financeiro_id'],
          ]);
  if (!linha) throw recusa('devedor-inexistente', 'O devedor do título não existe mais no cadastro.');
  return {
    nome: String(linha['nome'] ?? '').slice(0, 150),
    cpf: digitos(linha['cpf'], 11),
    cnpj: digitos(linha['cnpj'], 14),
  };
}

const renegociar = definirOperacao<z.infer<typeof esquemaRenegociar>, ResultadoOperacao>({
  nome: 'financeiro.renegociar_titulos_receber',
  tabelas: ['renegociacao', 'titulo_renegociado', 'titulo_receber', 'parcela_receber', 'sequencia_negocio'],
  entrada: esquemaRenegociar as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const hoje = hojeIso();
    const agora = new Date();
    await exigirPeriodoAberto(tx, est, hoje, 'primeiroVencimento');
    if (new Set(e.titulos).size !== e.titulos.length)
      throw recusa('parcela-repetida', 'O mesmo título foi escolhido duas vezes.', { campos: ['titulos'] });
    const titulos = await tx.consultarParaAtualizar(
      `SELECT id, versao, situacao, tipo_devedor, fonte_pagadora_id, paciente_id, cliente_financeiro_id,
              tipo_documento_financeiro_id, natureza_financeira_id, centro_custo_id
         FROM titulo_receber
        WHERE id IN (${ph(e.titulos)}) AND estabelecimento_id = ? AND excluido_em IS NULL ORDER BY id`,
      [...e.titulos, est],
      { teto: 100 },
    );
    if (titulos.length !== e.titulos.length)
      throw recusa('titulo-inexistente', 'Há título que não existe neste estabelecimento: releia a lista.', {
        campos: ['titulos'],
      });
    const parcelas = await tx.consultarParaAtualizar(
      `SELECT id, versao, titulo_receber_id, situacao, valor, saldo FROM parcela_receber
        WHERE titulo_receber_id IN (${ph(e.titulos)}) AND excluido_em IS NULL
          AND saldo > 0 AND situacao IN ('aberta','parcial')
        ORDER BY titulo_receber_id, sequencia`,
      [...e.titulos],
      { teto: 5000 },
    );
    const porTitulo = new Map(titulos.map((t) => [numero(t['id']), t]));
    const comParcela = new Set(parcelas.map((p) => numero(p['titulo_receber_id'])));
    if (titulos.some((t) => !comParcela.has(numero(t['id']))))
      throw recusa(
        'parcela-nao-renegociavel',
        'Há título sem saldo em aberto (já recebido, cancelado ou renegociado): releia a lista.',
        { campos: ['titulos'] },
      );
    const ids = parcelas.map((p) => numero(p['id']));
    const emEncontro = new Set(
      (
        await tx.consultar(
          `SELECT i.parcela_receber_id AS p FROM encontro_contas_item i JOIN encontro_contas c ON c.id = i.encontro_contas_id
            WHERE i.parcela_receber_id IN (${ph(ids)}) AND i.excluido_em IS NULL AND c.situacao = 'aguardando_aprovacao'`,
          [...ids],
        )
      ).map((l) => numero(l['p'])),
    );
    const aberto = (t: Record<string, unknown> | undefined) =>
      !!t && ['aberto', 'recebido_parcial'].includes(String(t['situacao']));
    const plano = recusar(
      planejarRenegociacao({
        dataAcordo: hoje,
        parcelas: parcelas.map((p) => {
          const t = porTitulo.get(numero(p['titulo_receber_id']));
          return {
            parcela: numero(p['id']),
            titulo: numero(p['titulo_receber_id']),
            situacao: aberto(t) ? String(p['situacao']) : 'cancelada',
            valor: numero(p['valor']),
            saldo: numero(p['saldo']),
            devedor: t ? devedorDe(t) : '',
            emEncontro: emEncontro.has(numero(p['id'])),
          };
        }),
        juros: e.juros,
        multa: e.multa,
        desconto: e.desconto,
        quantidadeParcelas: e.quantidadeParcelas,
        primeiroVencimento: e.primeiroVencimento,
      }),
    );
    const base = titulos[0] as Record<string, unknown>;
    const devedor = await identificacaoDoDevedor(tx, base);
    await garantirSequencia(
      tx,
      { tipo: 'renegociacao', estabelecimento: est, prefixo: 'RN-' },
      { usuario, agora },
    );
    const num = await tx.proximoNumero('renegociacao');
    const acordo = await tx.incluir('renegociacao', {
      estabelecimento_id: est,
      numero: num.formatado,
      tipo: 'receber',
      renegociado_em: agora,
      responsavel_usuario_id: usuario,
      paciente_id: base['paciente_id'] ?? null,
      fonte_pagadora_id: base['fonte_pagadora_id'] ?? null,
      devedor_nome: devedor.nome,
      devedor_cpf: devedor.cpf,
      devedor_cnpj: devedor.cnpj,
      valor_original: plano.valorOriginal,
      valor_juros: plano.juros,
      valor_multa: plano.multa,
      valor_desconto: plano.desconto,
      valor_renegociado: plano.valorRenegociado,
      quantidade_parcelas: plano.novas.length,
      primeiro_vencimento: e.primeiroVencimento,
      termo_aceito_em: agora,
      situacao: 'efetivada',
      observacao: e.observacao || null,
    });
    await garantirSequencia(
      tx,
      { tipo: 'titulo_receber', estabelecimento: est, prefixo: 'TR-' },
      { usuario, agora },
    );
    const numTitulo = await tx.proximoNumero('titulo_receber');
    const novo = await tx.incluir('titulo_receber', {
      estabelecimento_id: est,
      numero: numTitulo.formatado,
      tipo_devedor: base['tipo_devedor'],
      fonte_pagadora_id: base['fonte_pagadora_id'] ?? null,
      paciente_id: base['paciente_id'] ?? null,
      cliente_financeiro_id: base['cliente_financeiro_id'] ?? null,
      tipo_origem: 'acordo',
      renegociacao_id: acordo,
      tipo_documento_financeiro_id: base['tipo_documento_financeiro_id'],
      numero_documento: num.formatado.slice(0, 30),
      data_emissao: hoje,
      data_lancamento: hoje,
      data_prevista_recebimento: e.primeiroVencimento,
      valor_bruto: plano.valorRenegociado,
      valor_liquido: plano.valorRenegociado,
      quantidade_parcelas: plano.novas.length,
      natureza_financeira_id: base['natureza_financeira_id'],
      centro_custo_id: base['centro_custo_id'] ?? null,
      referente: `Acordo ${num.formatado}`.slice(0, 150),
    });
    for (const n of plano.novas)
      await tx.incluir('parcela_receber', {
        titulo_receber_id: novo,
        sequencia: n.sequencia,
        vencimento: n.vencimento,
        vencimento_original: n.vencimento,
        valor: n.valor,
        saldo: n.valor,
      });
    await tx.alterar('renegociacao', acordo, 1, { novo_titulo_receber_id: novo });
    const versaoDaParcela = new Map(parcelas.map((p) => [numero(p['id']), numero(p['versao'])]));
    for (const it of plano.itens) {
      await tx.incluir('titulo_renegociado', {
        renegociacao_id: acordo,
        parcela_receber_id: it.parcela,
        // O saldo levado nunca passa do valor guardado da parcela (acréscimo posterior entra como valor da emissão).
        valor_original: Math.max(it.valorOriginal, it.saldo),
        valor_saldo: it.saldo,
        valor_juros: it.juros,
        valor_multa: it.multa,
        valor_desconto: it.desconto,
      });
      await tx.alterar('parcela_receber', it.parcela, versaoDaParcela.get(it.parcela) ?? 0, {
        situacao: 'renegociada',
        saldo: 0,
      });
    }
    // O título original só fica "renegociado" quando não sobra saldo fora do acordo (parcela protestada, por exemplo).
    const fora = new Set(
      (
        await tx.consultar(
          `SELECT DISTINCT titulo_receber_id AS t FROM parcela_receber
            WHERE titulo_receber_id IN (${ph(e.titulos)}) AND excluido_em IS NULL AND saldo > 0
              AND id NOT IN (${ph(ids)})`,
          [...e.titulos, ...ids],
        )
      ).map((l) => numero(l['t'])),
    );
    for (const t of titulos)
      if (!fora.has(numero(t['id'])))
        await tx.alterar('titulo_receber', numero(t['id']), numero(t['versao']), { situacao: 'renegociado' });
    return {
      renegociacao: acordo,
      numero: num.formatado,
      titulo: novo,
      numeroTitulo: numTitulo.formatado,
      valorOriginal: plano.valorOriginal,
      valorRenegociado: plano.valorRenegociado,
      parcelas: plano.novas.length,
      titulosRenegociados: titulos.length,
      parcelasRenegociadas: plano.itens.length,
    };
  },
  alvo: (_e, r) => ({ tabela: 'renegociacao', id: numero(r['renegociacao']) || null }),
  eventos: (_e, r) => [
    {
      tipo: 'financeiro.titulo_receber.renegociado',
      carga: { renegociacao: numero(r['renegociacao']), titulos: numero(r['titulosRenegociados']) },
    },
  ],
});

const desfazerRenegociacao = definirOperacao<z.infer<typeof esquemaDesfazerRenegociacao>, ResultadoOperacao>({
  nome: 'financeiro.desfazer_renegociacao_receber',
  tabelas: ['renegociacao', 'titulo_receber', 'parcela_receber'],
  entrada: esquemaDesfazerRenegociacao as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    usuarioDe(ctx);
    const agora = new Date();
    await exigirPeriodoAberto(tx, est, hojeIso(), 'motivo');
    const [r] = await tx.consultarParaAtualizar(
      `SELECT id, versao, numero, situacao, novo_titulo_receber_id, observacao FROM renegociacao
        WHERE id = ? AND estabelecimento_id = ? AND tipo = 'receber' AND excluido_em IS NULL`,
      [e.renegociacao, est],
      { teto: 1 },
    );
    if (!r) throw recusa('acordo-inexistente', 'O acordo não existe neste estabelecimento.');
    const idNovo = numero(r['novo_titulo_receber_id']);
    const [novo] = idNovo
      ? await tx.consultarParaAtualizar(
          'SELECT id, versao, valor_recebido FROM titulo_receber WHERE id = ? AND excluido_em IS NULL',
          [idNovo],
          { teto: 1 },
        )
      : [];
    const novas = idNovo
      ? await tx.consultarParaAtualizar(
          'SELECT id, versao, situacao, valor_recebido FROM parcela_receber WHERE titulo_receber_id = ? AND excluido_em IS NULL',
          [idNovo],
          { teto: 400 },
        )
      : [];
    recusar(
      conferirDesfazerRenegociacao({
        situacao: String(r['situacao']),
        recebidoNoAcordo:
          numero(novo?.['valor_recebido']) + novas.reduce((x, p) => x + numero(p['valor_recebido']), 0),
        parcelaNovaMovimentada: novas.some((p) => String(p['situacao']) !== 'aberta'),
        motivo: e.motivo,
      }) ?? {},
    );
    if (!novo)
      throw recusa(
        'acordo-sem-titulo',
        'Este acordo não tem título gerado por aqui (veio de outra origem): não há o que desfazer.',
      );
    const motivo = `Acordo ${String(r['numero'])} desfeito: ${e.motivo.trim()}`.slice(0, 300);
    for (const p of novas)
      await tx.alterar('parcela_receber', numero(p['id']), numero(p['versao']), {
        situacao: 'cancelada',
        saldo: 0,
        cancelada_em: agora,
        motivo_cancelamento: motivo,
      });
    await tx.alterar('titulo_receber', idNovo, numero(novo['versao']), {
      situacao: 'cancelado',
      cancelado_em: agora,
      motivo_cancelamento: motivo,
    });
    const originais = await tx.consultarParaAtualizar(
      `SELECT p.id, p.versao, p.situacao, p.valor_recebido, p.titulo_receber_id, x.valor_saldo
         FROM titulo_renegociado x JOIN parcela_receber p ON p.id = x.parcela_receber_id
        WHERE x.renegociacao_id = ? AND x.excluido_em IS NULL ORDER BY p.id`,
      [e.renegociacao],
      { teto: 5000 },
    );
    const titulos = new Set<number>();
    for (const p of originais) {
      if (String(p['situacao']) !== 'renegociada') continue;
      titulos.add(numero(p['titulo_receber_id']));
      await tx.alterar('parcela_receber', numero(p['id']), numero(p['versao']), {
        situacao: numero(p['valor_recebido']) > 0 ? 'parcial' : 'aberta',
        saldo: numero(p['valor_saldo']),
      });
    }
    for (const t of titulos) {
      const [linha] = await tx.consultarParaAtualizar(
        'SELECT id, versao, situacao, valor_recebido FROM titulo_receber WHERE id = ? AND excluido_em IS NULL',
        [t],
        { teto: 1 },
      );
      if (linha && String(linha['situacao']) === 'renegociado')
        await tx.alterar('titulo_receber', t, numero(linha['versao']), {
          situacao: numero(linha['valor_recebido']) > 0 ? 'recebido_parcial' : 'aberto',
        });
    }
    await tx.alterar('renegociacao', e.renegociacao, numero(r['versao']), {
      situacao: 'cancelada',
      observacao: [String(r['observacao'] ?? '').trim(), `Desfeito: ${e.motivo.trim()}`]
        .filter(Boolean)
        .join(' | ')
        .slice(0, 1000),
    });
    return {
      renegociacao: e.renegociacao,
      numero: String(r['numero']),
      tituloCancelado: idNovo,
      parcelasDevolvidas: originais.length,
      titulosReabertos: titulos.size,
    };
  },
  alvo: (e) => ({ tabela: 'renegociacao', id: e.renegociacao }),
  trilha: (e) => ({ dados: null, motivo: e.motivo.trim() }),
});

export const OPERACOES_RENEGOCIACAO = {
  'financeiro.renegociarTitulosReceber': renegociar,
  'financeiro.desfazerRenegociacaoReceber': desfazerRenegociacao,
} as const;

// ── Leituras ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Os acordos do estabelecimento, do mais novo para o mais antigo, com o que a lista mostra. */
export async function acordosDoEstabelecimento(l: Leitor, est: number) {
  const linhas = await l.consultar(
    `SELECT r.id, r.numero, r.renegociado_em, r.situacao, r.devedor_nome, r.valor_original, r.valor_juros,
            r.valor_multa, r.valor_desconto, r.valor_renegociado, r.quantidade_parcelas, r.primeiro_vencimento,
            r.observacao, u.login, t.numero AS titulo_numero, t.id AS titulo, t.valor_recebido,
            (SELECT COUNT(*) FROM titulo_renegociado x WHERE x.renegociacao_id = r.id AND x.excluido_em IS NULL) AS parcelas
       FROM renegociacao r LEFT JOIN usuario u ON u.id = r.responsavel_usuario_id
       LEFT JOIN titulo_receber t ON t.id = r.novo_titulo_receber_id
      WHERE r.estabelecimento_id = ? AND r.tipo = 'receber' AND r.excluido_em IS NULL
      ORDER BY r.renegociado_em DESC, r.id DESC LIMIT 300`,
    [est],
  );
  return linhas.map((r) => ({
    id: numero(r['id']),
    numero: String(r['numero']),
    em: instanteIso(r['renegociado_em']) ?? '',
    situacao: String(r['situacao']),
    devedor: String(r['devedor_nome']),
    responsavel: String(r['login'] ?? ''),
    valorOriginal: numero(r['valor_original']),
    juros: numero(r['valor_juros']),
    multa: numero(r['valor_multa']),
    desconto: numero(r['valor_desconto']),
    valorRenegociado: numero(r['valor_renegociado']),
    parcelas: numero(r['quantidade_parcelas']),
    primeiroVencimento: dataIso(r['primeiro_vencimento']) ?? '',
    observacao: String(r['observacao'] ?? ''),
    titulo: numero(r['titulo']) || null,
    numeroTitulo: String(r['titulo_numero'] ?? ''),
    recebido: numero(r['valor_recebido']),
    parcelasOriginais: numero(r['parcelas']),
  }));
}

/** O histórico de um acordo: as parcelas que entraram (com o saldo levado) e as parcelas novas com a situação. */
export async function detalheDoAcordo(l: Leitor, est: number, acordo: number) {
  const r = await l.uma(
    "SELECT id, novo_titulo_receber_id FROM renegociacao WHERE id = ? AND estabelecimento_id = ? AND tipo = 'receber' AND excluido_em IS NULL",
    [acordo, est],
  );
  if (!r) return null;
  const originais = await l.consultar(
    `SELECT x.parcela_receber_id, x.valor_original, x.valor_saldo, x.valor_juros, x.valor_multa, x.valor_desconto,
            p.sequencia, p.vencimento_original, p.situacao, t.id AS titulo, t.numero, t.numero_documento
       FROM titulo_renegociado x JOIN parcela_receber p ON p.id = x.parcela_receber_id
       JOIN titulo_receber t ON t.id = p.titulo_receber_id
      WHERE x.renegociacao_id = ? AND x.excluido_em IS NULL ORDER BY t.id, p.sequencia LIMIT 5000`,
    [acordo],
  );
  const novas = await l.consultar(
    `SELECT id, sequencia, vencimento, valor, valor_recebido, saldo, situacao FROM parcela_receber
      WHERE titulo_receber_id = ? AND excluido_em IS NULL ORDER BY sequencia LIMIT 400`,
    [numero(r['novo_titulo_receber_id'])],
  );
  return {
    id: acordo,
    originais: originais.map((o) => ({
      parcela: numero(o['parcela_receber_id']),
      titulo: numero(o['titulo']),
      numeroTitulo: String(o['numero']),
      documento: String(o['numero_documento']),
      sequencia: numero(o['sequencia']),
      vencimento: dataIso(o['vencimento_original']) ?? '',
      valor: numero(o['valor_original']),
      saldoLevado: numero(o['valor_saldo']),
      juros: numero(o['valor_juros']),
      multa: numero(o['valor_multa']),
      desconto: numero(o['valor_desconto']),
      situacao: String(o['situacao']),
    })),
    novas: novas.map((n) => ({
      parcela: numero(n['id']),
      sequencia: numero(n['sequencia']),
      vencimento: dataIso(n['vencimento']) ?? '',
      valor: numero(n['valor']),
      recebido: numero(n['valor_recebido']),
      saldo: numero(n['saldo']),
      situacao: String(n['situacao']),
    })),
  };
}

// ── Escolha por devedor (a visão de quem deve: todos os títulos em aberto dele, com o saldo real das parcelas) ──

/** Letra do tipo de devedor na rota ↔ tipo do modelo, com a coluna que o identifica no título. */
const DEVEDORES = {
  C: { tipo: 'fonte_pagadora', coluna: 'fonte_pagadora_id' },
  E: { tipo: 'paciente', coluna: 'paciente_id' },
  O: { tipo: 'cliente', coluna: 'cliente_financeiro_id' },
} as const;
export type LetraDevedor = keyof typeof DEVEDORES;
export const letraDevedor = (v: unknown): LetraDevedor | null =>
  typeof v === 'string' && v in DEVEDORES ? (v as LetraDevedor) : null;
const NOME_DO_DEVEDOR = {
  C: { de: 'fonte_pagadora n ON n.id = t.fonte_pagadora_id', nome: 'n.nome' },
  E: {
    de: 'paciente pa ON pa.id = t.paciente_id JOIN pessoa_fisica n ON n.id = pa.pessoa_fisica_id',
    nome: 'n.nome',
  },
  O: { de: 'cliente_financeiro n ON n.id = t.cliente_financeiro_id', nome: 'n.nome' },
} as const;
/** A parcela que pode entrar num acordo: a mesma condição da gravação. */
const RENEGOCIAVEL = `p.excluido_em IS NULL AND p.saldo > 0 AND p.situacao IN ('aberta','parcial')
  AND t.excluido_em IS NULL AND t.situacao IN ('aberto','recebido_parcial')`;

/** Os devedores do tipo com saldo renegociável, do maior saldo para o menor; a busca é pelo nome. */
export async function devedoresComSaldoAberto(l: Leitor, est: number, letra: LetraDevedor, busca: string) {
  const d = DEVEDORES[letra];
  const n = NOME_DO_DEVEDOR[letra];
  const termo = busca.trim().slice(0, 80);
  const linhas = await l.consultar(
    `SELECT t.${d.coluna} AS id, ${n.nome} AS nome, COUNT(DISTINCT t.id) AS titulos, SUM(p.saldo) AS saldo,
            MIN(p.vencimento) AS mais_antigo
       FROM titulo_receber t JOIN parcela_receber p ON p.titulo_receber_id = t.id JOIN ${n.de}
      WHERE t.estabelecimento_id = ? AND t.tipo_devedor = ? AND ${RENEGOCIAVEL}
        AND (? = '' OR ${n.nome} LIKE ?)
      GROUP BY t.${d.coluna}, ${n.nome} ORDER BY saldo DESC, nome LIMIT 50`,
    [est, d.tipo, termo, `%${termo.replace(/[%_\\]/g, (c) => `\\${c}`)}%`],
  );
  return linhas.map((r) => ({
    id: numero(r['id']),
    nome: String(r['nome']),
    titulos: numero(r['titulos']),
    saldo: numero(r['saldo']),
    maisAntigo: dataIso(r['mais_antigo']) ?? '',
  }));
}

/**
 * Todos os títulos em aberto de UM devedor, do vencimento mais antigo para o mais novo, com as parcelas que entram no
 * acordo e o saldo real de cada uma (o que a gravação usa): a prévia da tela dá o mesmo valor que fica gravado.
 */
export async function titulosRenegociaveisDoDevedor(
  l: Leitor,
  est: number,
  letra: LetraDevedor,
  devedor: number,
) {
  const d = DEVEDORES[letra];
  const linhas = await l.consultar(
    `SELECT t.id AS titulo, t.numero, t.numero_documento, t.data_emissao, t.valor_liquido, t.valor_recebido,
            p.id AS parcela, p.sequencia, p.vencimento, p.valor, p.saldo, p.situacao,
            EXISTS (SELECT 1 FROM encontro_contas_item i JOIN encontro_contas c ON c.id = i.encontro_contas_id
                     WHERE i.parcela_receber_id = p.id AND i.excluido_em IS NULL
                       AND c.situacao = 'aguardando_aprovacao') AS em_encontro
       FROM titulo_receber t JOIN parcela_receber p ON p.titulo_receber_id = t.id
      WHERE t.estabelecimento_id = ? AND t.tipo_devedor = ? AND t.${d.coluna} = ? AND ${RENEGOCIAVEL}
      ORDER BY p.vencimento, t.id, p.sequencia LIMIT 5000`,
    [est, d.tipo, devedor],
  );
  const titulos = new Map<
    number,
    {
      id: number;
      numero: string;
      documento: string;
      emissao: string;
      valor: number;
      recebido: number;
      vencimento: string;
      saldo: number;
      emEncontro: boolean;
      parcelas: {
        parcela: number;
        sequencia: number;
        vencimento: string;
        valor: number;
        saldo: number;
        situacao: string;
        emEncontro: boolean;
      }[];
    }
  >();
  for (const r of linhas) {
    const id = numero(r['titulo']);
    const t = titulos.get(id) ?? {
      id,
      numero: String(r['numero']),
      documento: String(r['numero_documento'] ?? ''),
      emissao: dataIso(r['data_emissao']) ?? '',
      valor: numero(r['valor_liquido']),
      recebido: numero(r['valor_recebido']),
      vencimento: dataIso(r['vencimento']) ?? '',
      saldo: 0,
      emEncontro: false,
      parcelas: [],
    };
    const emEncontro = !!Number(r['em_encontro']);
    t.parcelas.push({
      parcela: numero(r['parcela']),
      sequencia: numero(r['sequencia']),
      vencimento: dataIso(r['vencimento']) ?? '',
      valor: numero(r['valor']),
      saldo: numero(r['saldo']),
      situacao: String(r['situacao']),
      emEncontro,
    });
    t.saldo = Math.round((t.saldo + numero(r['saldo']) + Number.EPSILON) * 100) / 100;
    t.emEncontro = t.emEncontro || emEncontro;
    titulos.set(id, t);
  }
  return { devedor: `${d.tipo}:${devedor}`, titulos: [...titulos.values()] };
}
