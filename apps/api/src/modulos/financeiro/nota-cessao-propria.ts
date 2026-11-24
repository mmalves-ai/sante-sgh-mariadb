// F8, 07-FIN linhas 70 e 79: nota de crédito e de débito com tributos e portador do título a receber com desconto e
// cessão de recebíveis, no banco próprio, pelo executor do @sgh/nucleo (trilha, outbox e idempotência na mesma
// transação). As regras são do @sgh/dominio-financeiro (nota-credito-cessao.ts); aqui ficam a leitura sob a trava e a
// gravação nas tabelas do modelo:
//   nota_credito_debito + tributo_nota_credito_debito (a nota ajusta UMA parcela; parcela, efeito e valor do ajuste
//   ficam gravados, migração 14_FIN/95), com o ajuste na parcela e no título (desconto ou acréscimo, saldo, situação);
//   portador_titulo + condicao_portador (taxa, prazo, limite e conta por vigência);
//   operacao_cessao_recebivel + operacao_cessao_recebivel_item (a parcela cedida ganha o portador; sem coobrigação ela
//   sai da carteira no ato; com coobrigação, quando o sacado paga ao portador ou o hospital recompra).
// Nada é apagado: a nota e a operação se cancelam com motivo, desfazendo exatamente o ajuste feito.
import { centavos } from '@sgh/contratos/regras-financeiro';
import {
  conferirCancelamentoNota,
  conferirDesfechoItem,
  type EfeitoNota,
  planejarCessao,
  planejarNota,
  type RecusaFinanceiro,
} from '@sgh/dominio-financeiro';
import {
  type ContextoOperacao,
  definirOperacao,
  garantirSequencia,
  type Leitor,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { dataIso, numero, texto } from './vocabulario.js';

const id = z.number().int().positive();
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dinheiro = z.number().min(0).max(999_999_999);
type Lado = 'pagar' | 'receber';

function recusar(r: RecusaFinanceiro | null | object): void {
  if (r && 'codigo' in r && 'mensagem' in r) {
    const f = r as RecusaFinanceiro;
    throw recusa(f.codigo, f.mensagem, f.campos ? { campos: f.campos } : {});
  }
}
function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}
const hoje = () => new Date().toISOString().slice(0, 10);

// ── Parcela e título: leitura travada e ajuste ──────────────────────────────────────────────────────────────────

interface ParcelaTravada {
  readonly lado: Lado;
  readonly parcela: number;
  readonly versao: number;
  readonly saldo: number;
  readonly situacao: string;
  readonly desconto: number;
  readonly acrescimo: number;
  readonly quitado: number;
  readonly titulo: number;
  readonly tituloVersao: number;
  readonly tituloSituacao: string;
  readonly tituloDesconto: number;
  readonly tituloAcrescimo: number;
  readonly tituloLiquido: number;
  readonly tituloRecebido: number;
  readonly fornecedor: number | null;
  readonly cliente: number | null;
  readonly fonte: number | null;
  readonly paciente: number | null;
  readonly portador: number | null;
}

async function travarParcela(
  tx: TxOperacao,
  est: number,
  lado: Lado,
  parcela: number,
): Promise<ParcelaTravada> {
  const sql =
    lado === 'pagar'
      ? `SELECT p.id, p.versao, p.saldo, p.situacao, p.valor_desconto, p.valor_acrescimo, p.valor_pago AS quitado,
                NULL AS portador_titulo_id, t.id AS titulo, t.versao AS tv, t.situacao AS ts, t.estabelecimento_id,
                t.valor_desconto AS td, t.valor_acrescimo AS ta, t.valor_liquido AS tl, 0 AS tr,
                t.empresa_fornecedora_id, NULL AS cliente_financeiro_id, NULL AS fonte_pagadora_id, NULL AS paciente_id
           FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id WHERE p.id = ? FOR UPDATE`
      : `SELECT p.id, p.versao, p.saldo, p.situacao, p.valor_desconto, p.valor_acrescimo, p.valor_recebido AS quitado,
                p.portador_titulo_id, t.id AS titulo, t.versao AS tv, t.situacao AS ts, t.estabelecimento_id,
                t.valor_desconto AS td, t.valor_acrescimo AS ta, t.valor_liquido AS tl, t.valor_recebido AS tr,
                NULL AS empresa_fornecedora_id, t.cliente_financeiro_id, t.fonte_pagadora_id, t.paciente_id
           FROM parcela_receber p JOIN titulo_receber t ON t.id = p.titulo_receber_id WHERE p.id = ? FOR UPDATE`;
  const r = await tx.uma(sql, [parcela]);
  if (!r || numero(r['estabelecimento_id']) !== est)
    throw recusa('parcela-inexistente', 'A parcela não existe neste estabelecimento.', {
      campos: ['parcela'],
    });
  const n = (k: string) => (r[k] === null || r[k] === undefined ? null : numero(r[k]));
  return {
    lado,
    parcela,
    versao: numero(r['versao']),
    saldo: numero(r['saldo']),
    situacao: texto(r['situacao']),
    desconto: numero(r['valor_desconto']),
    acrescimo: numero(r['valor_acrescimo']),
    quitado: numero(r['quitado']),
    titulo: numero(r['titulo']),
    tituloVersao: numero(r['tv']),
    tituloSituacao: texto(r['ts']),
    tituloDesconto: numero(r['td']),
    tituloAcrescimo: numero(r['ta']),
    tituloLiquido: numero(r['tl']),
    tituloRecebido: numero(r['tr']),
    fornecedor: n('empresa_fornecedora_id'),
    cliente: n('cliente_financeiro_id'),
    fonte: n('fonte_pagadora_id'),
    paciente: n('paciente_id'),
    portador: n('portador_titulo_id'),
  };
}

const QUITADA = { pagar: 'paga', receber: 'recebida' } as const;
const TITULO_QUITADO = { pagar: 'pago', receber: 'recebido' } as const;
const TITULO_PARCIAL = { pagar: 'pago_parcial', receber: 'recebido_parcial' } as const;

/** Depois de mudar a parcela, o título acompanha: todo saldo zerado, quitado; saldo de volta, aberto ou parcial. */
async function acertarSituacaoTitulo(
  tx: TxOperacao,
  p: ParcelaTravada,
  versao: number,
  extra: Record<string, unknown>,
) {
  const tabela = p.lado === 'pagar' ? 'parcela_pagar' : 'parcela_receber';
  const col = p.lado === 'pagar' ? 'titulo_pagar_id' : 'titulo_receber_id';
  const quit = p.lado === 'pagar' ? 'valor_pago' : 'valor_recebido';
  const s = await tx.uma(
    `SELECT COALESCE(SUM(saldo), 0) AS aberto, COALESCE(SUM(${quit}), 0) AS quitado FROM ${tabela}
      WHERE ${col} = ? AND situacao NOT IN ('cancelada','renegociada')`,
    [p.titulo],
  );
  const aberto = centavos(numero(s?.['aberto']));
  let situacao = p.tituloSituacao;
  if (aberto === 0) situacao = TITULO_QUITADO[p.lado];
  else if (situacao === TITULO_QUITADO[p.lado])
    situacao = numero(s?.['quitado']) > 0 ? TITULO_PARCIAL[p.lado] : 'aberto';
  await tx.alterar(p.lado === 'pagar' ? 'titulo_pagar' : 'titulo_receber', p.titulo, versao, {
    ...extra,
    situacao,
  });
}

/** Ajusta a parcela e o título pela nota: abate vira desconto, acresce vira acréscimo; sinal -1 desfaz. */
async function ajustarPelaNota(
  tx: TxOperacao,
  p: ParcelaTravada,
  efeito: EfeitoNota,
  valor: number,
  sinal: 1 | -1,
  data: string,
) {
  const v = centavos(valor * sinal);
  const delta = efeito === 'abate' ? -v : v;
  const saldo = centavos(p.saldo + delta);
  if (saldo < 0) throw recusa('saldo-insuficiente', 'O ajuste deixaria a parcela com saldo negativo.');
  const quitada = saldo === 0;
  await tx.alterar(p.lado === 'pagar' ? 'parcela_pagar' : 'parcela_receber', p.parcela, p.versao, {
    ...(efeito === 'abate'
      ? { valor_desconto: centavos(p.desconto + v) }
      : { valor_acrescimo: centavos(p.acrescimo + v) }),
    saldo,
    situacao: quitada ? QUITADA[p.lado] : p.quitado > 0 ? 'parcial' : 'aberta',
    quitada_em: quitada ? data : null,
  });
  await acertarSituacaoTitulo(
    tx,
    p,
    p.tituloVersao,
    efeito === 'abate'
      ? { valor_desconto: centavos(p.tituloDesconto + v), valor_liquido: centavos(p.tituloLiquido - v) }
      : { valor_acrescimo: centavos(p.tituloAcrescimo + v), valor_liquido: centavos(p.tituloLiquido + v) },
  );
}

/** Abate a parcela a receber pela cessão (sem coobrigação) ou pelo pagamento do sacado ao portador; sinal -1 desfaz. */
async function quitarPelaCessao(
  tx: TxOperacao,
  p: ParcelaTravada,
  valor: number,
  sinal: 1 | -1,
  data: string,
) {
  const v = centavos(valor * sinal);
  const saldo = centavos(p.saldo - v);
  const recebido = centavos(p.quitado + v);
  if (saldo < 0 || recebido < 0) throw recusa('saldo-insuficiente', 'O valor passa do saldo da parcela.');
  await tx.alterar('parcela_receber', p.parcela, p.versao, {
    valor_recebido: recebido,
    saldo,
    situacao: saldo === 0 ? 'recebida' : recebido > 0 ? 'parcial' : 'aberta',
    quitada_em: saldo === 0 ? data : null,
  });
  await acertarSituacaoTitulo(tx, p, p.tituloVersao, { valor_recebido: centavos(p.tituloRecebido + v) });
}

// ── Nota de crédito e de débito ─────────────────────────────────────────────────────────────────────────────

const esquemaTributoNota = z
  .object({ tributo: id, base: dinheiro, aliquota: z.number().min(0).max(100), retido: z.boolean() })
  .strict();
export const esquemaEmitirNota = z
  .object({
    lado: z.enum(['pagar', 'receber']),
    parcela: id,
    direcao: z.enum(['emitida', 'recebida']),
    natureza: z.enum(['credito', 'debito']),
    motivo: id,
    dataEmissao: DATA,
    dataVencimento: DATA.nullable().optional(),
    serie: z.string().trim().max(10).optional(),
    numeroDocumento: z.string().trim().max(20).optional(),
    valorItens: dinheiro,
    valorDesconto: dinheiro.default(0),
    valorOutros: dinheiro.default(0),
    tributos: z.array(esquemaTributoNota).max(20).default([]),
    observacao: z.string().trim().max(2000).optional(),
    aplicar: z.boolean().default(true),
  })
  .strict();
export type EmitirNotaEntrada = z.infer<typeof esquemaEmitirNota>;

async function aplicarNotaGravada(tx: TxOperacao, est: number, nota: Record<string, unknown>, data: string) {
  const lado: Lado = nota['parcela_pagar_id'] !== null ? 'pagar' : 'receber';
  const p = await travarParcela(
    tx,
    est,
    lado,
    numero(nota['parcela_pagar_id'] ?? nota['parcela_receber_id']),
  );
  if (p.situacao !== 'aberta' && p.situacao !== 'parcial')
    throw recusa('parcela-fechada', 'A parcela da nota não está em aberto.', { campos: ['parcela'] });
  const efeito = texto(nota['efeito']) as EfeitoNota;
  const valor = numero(nota['valor_ajuste']);
  if (efeito === 'abate' && valor > centavos(p.saldo))
    throw recusa('nota-maior-que-saldo', 'A nota abate mais que o saldo em aberto da parcela.', {
      campos: ['valorItens'],
    });
  await ajustarPelaNota(tx, p, efeito, valor, 1, data);
  return tx.alterar('nota_credito_debito', numero(nota['id']), numero(nota['versao']), {
    situacao: 'aplicada',
    aplicada_em: new Date(),
  });
}

const emitirNota = definirOperacao<EmitirNotaEntrada, ResultadoOperacao>({
  nome: 'financeiro.nota_credito_debito_emitir',
  tabelas: [
    'nota_credito_debito',
    'tributo_nota_credito_debito',
    'parcela_pagar',
    'parcela_receber',
    'titulo_pagar',
    'titulo_receber',
  ],
  entrada: esquemaEmitirNota as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const p = await travarParcela(tx, est, e.lado, e.parcela);
    if (p.lado === 'receber' && p.paciente !== null)
      throw recusa(
        'devedor-paciente',
        'A nota de crédito ou débito é para empresa, cliente ou fonte pagadora.',
        {
          campos: ['parcela'],
        },
      );
    if (p.lado === 'pagar' && p.fornecedor === null)
      throw recusa('credor-sem-empresa', 'O credor do título não é uma empresa fornecedora.', {
        campos: ['parcela'],
      });
    if (p.situacao !== 'aberta' && p.situacao !== 'parcial')
      throw recusa('parcela-fechada', 'A parcela não está em aberto.', { campos: ['parcela'] });
    const m = await tx.uma('SELECT natureza, ativo FROM motivo_nota_credito_debito WHERE id = ?', [e.motivo]);
    if (!m) throw recusa('motivo-inexistente', 'O motivo da nota não existe.', { campos: ['motivo'] });
    if (e.tributos.length > 0) {
      const ids = [...new Set(e.tributos.map((t) => t.tributo))];
      const achados = await tx.consultar(
        `SELECT id FROM tributo WHERE id IN (${ids.map(() => '?').join(', ')})`,
        ids,
      );
      if (achados.length !== ids.length)
        throw recusa('tributo-inexistente', 'Há tributo que não existe.', { campos: ['tributos'] });
    }
    const plano = planejarNota({
      direcao: e.direcao,
      natureza: e.natureza,
      lado: e.lado,
      naturezaMotivo: texto(m['natureza']) as 'credito' | 'debito' | 'ambos',
      motivoAtivo: Boolean(numero(m['ativo'])),
      valorItens: e.valorItens,
      valorDesconto: e.valorDesconto,
      valorOutros: e.valorOutros,
      tributos: e.tributos,
      dataEmissao: e.dataEmissao,
      dataVencimento: e.dataVencimento ?? null,
      situacaoTitulo: p.tituloSituacao,
      saldoTitulo: p.saldo,
    });
    recusar(plano);
    if (!('efeito' in plano)) throw recusa('nota-invalida', 'Nota inválida.');
    await garantirSequencia(
      tx,
      { tipo: 'nota_credito_debito', estabelecimento: est, prefixo: null },
      { usuario: ctx.usuario, agora: new Date() },
    );
    const num = await tx.proximoNumero('nota_credito_debito');
    const nota = await tx.incluir('nota_credito_debito', {
      estabelecimento_id: est,
      numero: num.valor,
      direcao: e.direcao,
      natureza: e.natureza,
      tipo_conteudo: 'servico',
      motivo_nota_credito_debito_id: e.motivo,
      empresa_fornecedora_id: p.fornecedor,
      cliente_financeiro_id: p.lado === 'receber' ? p.cliente : null,
      fonte_pagadora_id: p.lado === 'receber' ? p.fonte : null,
      serie: e.serie || null,
      numero_documento: e.numeroDocumento || null,
      data_emissao: e.dataEmissao,
      data_vencimento: e.dataVencimento ?? null,
      titulo_pagar_id: p.lado === 'pagar' ? p.titulo : null,
      titulo_receber_id: p.lado === 'receber' ? p.titulo : null,
      parcela_pagar_id: p.lado === 'pagar' ? p.parcela : null,
      parcela_receber_id: p.lado === 'receber' ? p.parcela : null,
      efeito: plano.efeito,
      valor_ajuste: plano.valorAjuste,
      valor_itens: e.valorItens,
      valor_desconto: e.valorDesconto,
      valor_outros: e.valorOutros,
      valor_impostos: plano.valorImpostos,
      valor_total: plano.valorTotal,
      situacao: 'emitida',
      observacao: e.observacao || null,
    });
    for (const t of plano.tributos)
      await tx.incluir('tributo_nota_credito_debito', {
        nota_credito_debito_id: nota,
        sequencia: t.sequencia,
        tributo_id: t.tributo,
        retido: t.retido,
        valor_base_calculo: t.base,
        aliquota: t.aliquota,
        valor_tributo: t.valor,
      });
    if (e.aplicar) {
      const n = await tx.uma('SELECT * FROM nota_credito_debito WHERE id = ?', [nota]);
      await aplicarNotaGravada(tx, est, n ?? {}, e.dataEmissao);
    }
    return {
      nota,
      numero: num.valor,
      efeito: plano.efeito,
      valorTotal: plano.valorTotal,
      valorAjuste: plano.valorAjuste,
      situacao: e.aplicar ? 'aplicada' : 'emitida',
    };
  },
  alvo: (_e, r) => ({ tabela: 'nota_credito_debito', id: numero(r['nota']) || null }),
});

export const esquemaAplicarNota = z.object({ nota: id }).strict();
const aplicarNota = definirOperacao<z.infer<typeof esquemaAplicarNota>, ResultadoOperacao>({
  nome: 'financeiro.nota_credito_debito_aplicar',
  tabelas: ['nota_credito_debito', 'parcela_pagar', 'parcela_receber', 'titulo_pagar', 'titulo_receber'],
  entrada: esquemaAplicarNota as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const n = await tx.uma(
      'SELECT * FROM nota_credito_debito WHERE id = ? AND estabelecimento_id = ? FOR UPDATE',
      [e.nota, est],
    );
    if (!n) throw recusa('nota-inexistente', 'A nota não existe neste estabelecimento.');
    if (texto(n['situacao']) !== 'emitida')
      throw recusa('nota-nao-emitida', 'Só a nota emitida e ainda não aplicada vai ao título.');
    await aplicarNotaGravada(tx, est, n, hoje());
    return { nota: e.nota, situacao: 'aplicada' };
  },
  alvo: (e) => ({ tabela: 'nota_credito_debito', id: e.nota }),
});

export const esquemaCancelarNota = z
  .object({ nota: id, motivoCancelamento: id, observacao: z.string().trim().min(5).max(500) })
  .strict();
const cancelarNota = definirOperacao<z.infer<typeof esquemaCancelarNota>, ResultadoOperacao>({
  nome: 'financeiro.nota_credito_debito_cancelar',
  tabelas: ['nota_credito_debito', 'parcela_pagar', 'parcela_receber', 'titulo_pagar', 'titulo_receber'],
  entrada: esquemaCancelarNota as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const n = await tx.uma(
      'SELECT * FROM nota_credito_debito WHERE id = ? AND estabelecimento_id = ? FOR UPDATE',
      [e.nota, est],
    );
    if (!n) throw recusa('nota-inexistente', 'A nota não existe neste estabelecimento.');
    const mc = await tx.uma(
      'SELECT id FROM motivo_cancelamento_documento_fiscal WHERE id = ? AND ativo = TRUE AND aplica_nota_credito_debito = TRUE',
      [e.motivoCancelamento],
    );
    if (!mc)
      throw recusa('motivo-inexistente', 'Escolha o motivo do cancelamento.', {
        campos: ['motivoCancelamento'],
      });
    const lado: Lado = n['parcela_pagar_id'] !== null ? 'pagar' : 'receber';
    const p = await travarParcela(tx, est, lado, numero(n['parcela_pagar_id'] ?? n['parcela_receber_id']));
    const efeito = texto(n['efeito']) as EfeitoNota;
    const valor = numero(n['valor_ajuste']);
    recusar(
      conferirCancelamentoNota({
        situacao: texto(n['situacao']),
        efeito,
        valorAjuste: valor,
        saldoTitulo: p.saldo,
      }),
    );
    if (texto(n['situacao']) === 'aplicada') await ajustarPelaNota(tx, p, efeito, valor, -1, hoje());
    const obs = [texto(n['observacao'] ?? ''), `Cancelamento: ${e.observacao}`].filter(Boolean).join('\n');
    await tx.alterar('nota_credito_debito', e.nota, numero(n['versao']), {
      situacao: 'cancelada',
      cancelada_em: new Date(),
      motivo_cancelamento_documento_fiscal_id: e.motivoCancelamento,
      observacao: obs.slice(0, 2000),
    });
    return { nota: e.nota, situacao: 'cancelada', desfeito: texto(n['situacao']) === 'aplicada' };
  },
  alvo: (e) => ({ tabela: 'nota_credito_debito', id: e.nota }),
  trilha: (e) => ({ motivo: e.observacao }),
});

// ── Portador, desconto e cessão ─────────────────────────────────────────────────────────────────────────────

export const esquemaManterPortador = z
  .object({
    id: id.nullable().default(null),
    codigo: z.string().trim().min(1).max(20),
    descricao: z.string().trim().min(3).max(100),
    tipo: z.enum([
      'carteira_propria',
      'cobranca_simples',
      'cobranca_descontada',
      'cobranca_caucionada',
      'cessao',
      'cartorio',
      'juridico',
    ]),
    contaBancaria: id.nullable().default(null),
    pessoaJuridica: id.nullable().default(null),
    taxaDesconto: z.number().min(0).max(100).default(0),
    prazoDias: z.number().int().min(0).max(3650).nullable().default(null),
    limiteCredito: dinheiro.nullable().default(null),
    valorTarifa: dinheiro.nullable().default(null),
    vigenciaInicio: DATA,
    ativo: z.boolean().default(true),
  })
  .strict();
const manterPortador = definirOperacao<z.infer<typeof esquemaManterPortador>, ResultadoOperacao>({
  nome: 'financeiro.portador_titulo_manter',
  tabelas: ['portador_titulo', 'condicao_portador'],
  entrada: esquemaManterPortador as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const BANCO = ['cobranca_simples', 'cobranca_descontada', 'cobranca_caucionada'];
    if (BANCO.includes(e.tipo) && e.contaBancaria === null)
      throw recusa('conta-obrigatoria', 'O portador bancário exige a conta de cobrança.', {
        campos: ['contaBancaria'],
      });
    if (e.tipo === 'cessao' && e.pessoaJuridica === null)
      throw recusa('cessionario-obrigatorio', 'Informe o cessionário (banco, fundo ou fomento).', {
        campos: ['pessoaJuridica'],
      });
    if (e.contaBancaria !== null) {
      const c = await tx.uma('SELECT estabelecimento_id FROM conta_bancaria WHERE id = ?', [e.contaBancaria]);
      if (!c || numero(c['estabelecimento_id']) !== est)
        throw recusa('conta-inexistente', 'A conta não é deste estabelecimento.', {
          campos: ['contaBancaria'],
        });
    }
    const valores = {
      codigo: e.codigo,
      descricao: e.descricao,
      tipo: e.tipo,
      interno: ['carteira_propria', 'cartorio', 'juridico'].includes(e.tipo),
      conta_bancaria_id: e.contaBancaria,
      pessoa_juridica_id: e.pessoaJuridica,
      ativo: e.ativo,
    };
    let portador: number;
    if (e.id !== null) {
      const p = await tx.uma(
        'SELECT versao, estabelecimento_id FROM portador_titulo WHERE id = ? FOR UPDATE',
        [e.id],
      );
      if (!p || numero(p['estabelecimento_id']) !== est)
        throw recusa('portador-inexistente', 'O portador não existe.');
      await tx.alterar('portador_titulo', e.id, numero(p['versao']), valores);
      portador = e.id;
    } else {
      const ja = await tx.uma('SELECT id FROM portador_titulo WHERE estabelecimento_id = ? AND codigo = ?', [
        est,
        e.codigo,
      ]);
      if (ja) throw recusa('codigo-repetido', 'Já existe portador com este código.', { campos: ['codigo'] });
      portador = await tx.incluir('portador_titulo', { estabelecimento_id: est, ...valores });
    }
    // A condição é por vigência: a da mesma data de início é atualizada; outra data abre nova vigência e encerra a
    // anterior na véspera (a história das taxas fica).
    const cond = await tx.consultarParaAtualizar(
      'SELECT id, versao, vigencia_inicio, vigencia_fim FROM condicao_portador WHERE portador_titulo_id = ? ORDER BY vigencia_inicio',
      [portador],
    );
    const valoresCond = {
      taxa_desconto: e.taxaDesconto,
      prazo_dias: e.prazoDias,
      limite_credito: e.limiteCredito,
      valor_tarifa: e.valorTarifa,
      conta_bancaria_id: e.contaBancaria,
      ativo: true,
    };
    const mesma = cond.find((c) => dataIso(c['vigencia_inicio']) === e.vigenciaInicio);
    if (mesma)
      await tx.alterar('condicao_portador', numero(mesma['id']), numero(mesma['versao']), valoresCond);
    else {
      const anterior = cond.filter((c) => (dataIso(c['vigencia_inicio']) ?? '') < e.vigenciaInicio).at(-1);
      if (
        anterior &&
        (anterior['vigencia_fim'] === null || (dataIso(anterior['vigencia_fim']) ?? '') >= e.vigenciaInicio)
      ) {
        const vespera = new Date(Date.parse(`${e.vigenciaInicio}T00:00:00Z`) - 86_400_000)
          .toISOString()
          .slice(0, 10);
        await tx.alterar('condicao_portador', numero(anterior['id']), numero(anterior['versao']), {
          vigencia_fim: vespera,
        });
      }
      await tx.incluir('condicao_portador', {
        portador_titulo_id: portador,
        vigencia_inicio: e.vigenciaInicio,
        ...valoresCond,
      });
    }
    return { portador };
  },
  alvo: (_e, r) => ({ tabela: 'portador_titulo', id: numero(r['portador']) || null }),
});

export const esquemaContratarCessao = z
  .object({
    portador: id,
    tipo: z.enum(['desconto_duplicata', 'cessao', 'fomento']),
    comCoobrigacao: z.boolean(),
    dataOperacao: DATA,
    dataCredito: DATA.nullable().default(null),
    taxaMensal: z.number().min(0).max(100).nullable().default(null),
    valorTarifas: dinheiro.default(0),
    valorIof: dinheiro.default(0),
    numeroContrato: z.string().trim().max(40).optional(),
    parcelas: z.array(id).min(1).max(500),
    observacao: z.string().trim().max(2000).optional(),
  })
  .strict();
const TIPO_PORTADOR: Record<string, readonly string[]> = {
  desconto_duplicata: ['cobranca_descontada', 'cobranca_caucionada'],
  cessao: ['cessao'],
  fomento: ['cessao'],
};
const contratarCessao = definirOperacao<z.infer<typeof esquemaContratarCessao>, ResultadoOperacao>({
  nome: 'financeiro.cessao_recebivel_contratar',
  tabelas: [
    'operacao_cessao_recebivel',
    'operacao_cessao_recebivel_item',
    'parcela_receber',
    'titulo_receber',
  ],
  entrada: esquemaContratarCessao as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const port = await tx.uma('SELECT * FROM portador_titulo WHERE id = ? FOR UPDATE', [e.portador]);
    if (!port || numero(port['estabelecimento_id']) !== est || !numero(port['ativo']))
      throw recusa('portador-inexistente', 'O portador não existe ou está inativo.', {
        campos: ['portador'],
      });
    if (!TIPO_PORTADOR[e.tipo]?.includes(texto(port['tipo'])))
      throw recusa('portador-tipo', 'O portador escolhido não faz este tipo de operação.', {
        campos: ['portador', 'tipo'],
      });
    const cond = await tx.uma(
      `SELECT taxa_desconto, limite_credito, conta_bancaria_id FROM condicao_portador
        WHERE portador_titulo_id = ? AND ativo = TRUE AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
        ORDER BY vigencia_inicio DESC LIMIT 1`,
      [e.portador, e.dataOperacao, e.dataOperacao],
    );
    const conta = port['conta_bancaria_id'] ?? cond?.['conta_bancaria_id'] ?? null;
    if (conta === null)
      throw recusa('conta-obrigatoria', 'O portador não tem conta para o crédito do líquido.', {
        campos: ['portador'],
      });
    const usado = await tx.uma(
      `SELECT COALESCE(SUM(i.valor_face), 0) AS v FROM operacao_cessao_recebivel_item i
         JOIN operacao_cessao_recebivel o ON o.id = i.operacao_cessao_recebivel_id
        WHERE o.portador_titulo_id = ? AND o.situacao = 'contratada' AND i.situacao = 'cedida'`,
      [e.portador],
    );
    const parcelas: ParcelaTravada[] = [];
    const vencimentos = new Map<number, string>();
    for (const pid of [...new Set(e.parcelas)].sort((a, b) => a - b)) {
      parcelas.push(await travarParcela(tx, est, 'receber', pid));
      const v = await tx.uma('SELECT vencimento FROM parcela_receber WHERE id = ?', [pid]);
      vencimentos.set(pid, dataIso(v?.['vencimento']) ?? '');
    }
    const cedidas = await tx.consultar(
      `SELECT DISTINCT i.parcela_receber_id FROM operacao_cessao_recebivel_item i
         JOIN operacao_cessao_recebivel o ON o.id = i.operacao_cessao_recebivel_id
        WHERE o.situacao IN ('rascunho','contratada') AND i.situacao = 'cedida'
          AND i.parcela_receber_id IN (${parcelas.map(() => '?').join(', ')})`,
      parcelas.map((p) => p.parcela),
    );
    const jaCedidas = new Set(cedidas.map((c) => numero(c['parcela_receber_id'])));
    const plano = planejarCessao({
      tipo: e.tipo,
      comCoobrigacao: e.comCoobrigacao,
      dataOperacao: e.dataOperacao,
      taxaMensal: e.taxaMensal ?? numero(cond?.['taxa_desconto'] ?? 0),
      valorTarifas: e.valorTarifas,
      valorIof: e.valorIof,
      parcelas: parcelas.map((p) => ({
        parcela: p.parcela,
        situacao: p.situacao,
        saldo: p.saldo,
        vencimento: vencimentos.get(p.parcela) ?? '',
        jaCedida: jaCedidas.has(p.parcela),
      })),
      limitePortador:
        cond?.['limite_credito'] === null || cond?.['limite_credito'] === undefined
          ? null
          : numero(cond['limite_credito']),
      utilizadoPortador: numero(usado?.['v']),
    });
    recusar(plano);
    if (!('itens' in plano)) throw recusa('operacao-invalida', 'Operação inválida.');
    await garantirSequencia(
      tx,
      { tipo: 'operacao_cessao_recebivel', estabelecimento: est, prefixo: null },
      { usuario: ctx.usuario, agora: new Date() },
    );
    const num = await tx.proximoNumero('operacao_cessao_recebivel');
    const taxa = e.taxaMensal ?? numero(cond?.['taxa_desconto'] ?? 0);
    const operacao = await tx.incluir('operacao_cessao_recebivel', {
      estabelecimento_id: est,
      numero: num.valor,
      tipo_operacao: e.tipo,
      conta_bancaria_id: conta,
      portador_titulo_id: e.portador,
      cessionario_pessoa_juridica_id: port['pessoa_juridica_id'] ?? null,
      numero_contrato: e.numeroContrato || null,
      data_operacao: e.dataOperacao,
      data_credito: e.dataCredito,
      taxa_mensal: taxa,
      com_coobrigacao: e.comCoobrigacao,
      valor_face: plano.valorFace,
      valor_desagio: plano.valorDesagio,
      valor_tarifas: e.valorTarifas,
      valor_iof: e.valorIof,
      valor_liquido: plano.valorLiquido,
      situacao: 'contratada',
      observacao: e.observacao || null,
    });
    for (const it of plano.itens) {
      await tx.incluir('operacao_cessao_recebivel_item', {
        operacao_cessao_recebivel_id: operacao,
        parcela_receber_id: it.parcela,
        data_vencimento: it.vencimento,
        valor_face: it.valorFace,
        valor_desagio: it.valorDesagio,
        situacao: 'cedida',
      });
      // A parcela passa ao portador; sem coobrigação ela sai da carteira no ato (o risco é do cessionário).
      const p = await travarParcela(tx, est, 'receber', it.parcela);
      const versao = await tx.alterar('parcela_receber', p.parcela, p.versao, {
        portador_titulo_id: e.portador,
      });
      if (!e.comCoobrigacao) await quitarPelaCessao(tx, { ...p, versao }, it.valorFace, 1, e.dataOperacao);
    }
    return {
      operacao,
      numero: num.valor,
      valorFace: plano.valorFace,
      valorDesagio: plano.valorDesagio,
      valorLiquido: plano.valorLiquido,
    };
  },
  alvo: (_e, r) => ({ tabela: 'operacao_cessao_recebivel', id: numero(r['operacao']) || null }),
});

export const esquemaDesfechoCessao = z
  .object({
    item: id,
    acao: z.enum(['liquidar', 'recomprar']),
    data: DATA,
    valorRecompra: dinheiro.optional(),
  })
  .strict();
const desfechoCessao = definirOperacao<z.infer<typeof esquemaDesfechoCessao>, ResultadoOperacao>({
  nome: 'financeiro.cessao_recebivel_desfecho',
  tabelas: [
    'operacao_cessao_recebivel',
    'operacao_cessao_recebivel_item',
    'parcela_receber',
    'titulo_receber',
  ],
  entrada: esquemaDesfechoCessao as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const i = await tx.uma(
      `SELECT i.id, i.versao, i.situacao, i.parcela_receber_id, i.valor_face, o.id AS operacao, o.versao AS ov,
              o.situacao AS os, o.com_coobrigacao, o.estabelecimento_id
         FROM operacao_cessao_recebivel_item i JOIN operacao_cessao_recebivel o ON o.id = i.operacao_cessao_recebivel_id
        WHERE i.id = ? FOR UPDATE`,
      [e.item],
    );
    if (!i || numero(i['estabelecimento_id']) !== est)
      throw recusa('item-inexistente', 'O recebível cedido não existe.');
    const coob = Boolean(numero(i['com_coobrigacao']));
    recusar(
      conferirDesfechoItem({
        acao: e.acao,
        situacaoOperacao: texto(i['os']),
        situacaoItem: texto(i['situacao']),
        comCoobrigacao: coob,
        ...(e.valorRecompra !== undefined ? { valorRecompra: e.valorRecompra } : {}),
      }),
    );
    const p = await travarParcela(tx, est, 'receber', numero(i['parcela_receber_id']));
    if (e.acao === 'liquidar') {
      await tx.alterar('operacao_cessao_recebivel_item', e.item, numero(i['versao']), {
        situacao: 'liquidada_pelo_sacado',
        liquidada_em: e.data,
      });
      // Com coobrigação a parcela ainda estava na carteira: o pagamento ao portador a quita.
      if (coob) await quitarPelaCessao(tx, p, numero(i['valor_face']), 1, e.data);
    } else {
      await tx.alterar('operacao_cessao_recebivel_item', e.item, numero(i['versao']), {
        situacao: 'recomprada',
        recomprada_em: e.data,
        valor_recompra: e.valorRecompra,
      });
      // A parcela volta à carteira própria, em aberto, para o hospital cobrar.
      await tx.alterar('parcela_receber', p.parcela, p.versao, { portador_titulo_id: null });
    }
    const vivos = await tx.uma(
      "SELECT COUNT(*) AS n FROM operacao_cessao_recebivel_item WHERE operacao_cessao_recebivel_id = ? AND situacao = 'cedida'",
      [numero(i['operacao'])],
    );
    const encerrada = numero(vivos?.['n']) === 0;
    if (encerrada)
      await tx.alterar('operacao_cessao_recebivel', numero(i['operacao']), numero(i['ov']), {
        situacao: 'liquidada',
      });
    return {
      item: e.item,
      situacao: e.acao === 'liquidar' ? 'liquidada_pelo_sacado' : 'recomprada',
      operacaoLiquidada: encerrada,
    };
  },
  alvo: (e) => ({ tabela: 'operacao_cessao_recebivel_item', id: e.item }),
});

export const esquemaCancelarCessao = z
  .object({ operacao: id, motivo: z.string().trim().min(5).max(500) })
  .strict();
const cancelarCessao = definirOperacao<z.infer<typeof esquemaCancelarCessao>, ResultadoOperacao>({
  nome: 'financeiro.cessao_recebivel_cancelar',
  tabelas: [
    'operacao_cessao_recebivel',
    'operacao_cessao_recebivel_item',
    'parcela_receber',
    'titulo_receber',
  ],
  entrada: esquemaCancelarCessao as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const o = await tx.uma(
      'SELECT * FROM operacao_cessao_recebivel WHERE id = ? AND estabelecimento_id = ? FOR UPDATE',
      [e.operacao, est],
    );
    if (!o) throw recusa('operacao-inexistente', 'A operação não existe neste estabelecimento.');
    if (texto(o['situacao']) !== 'contratada' && texto(o['situacao']) !== 'rascunho')
      throw recusa('operacao-encerrada', 'Só a operação contratada e sem desfecho se cancela.');
    const itens = await tx.consultarParaAtualizar(
      'SELECT id, versao, situacao, parcela_receber_id, valor_face FROM operacao_cessao_recebivel_item WHERE operacao_cessao_recebivel_id = ?',
      [e.operacao],
    );
    if (itens.some((i) => texto(i['situacao']) !== 'cedida'))
      throw recusa(
        'item-com-desfecho',
        'Há recebível já liquidado ou recomprado: a operação não se cancela.',
      );
    const coob = Boolean(numero(o['com_coobrigacao']));
    for (const i of itens) {
      const p = await travarParcela(tx, est, 'receber', numero(i['parcela_receber_id']));
      const versao = await tx.alterar('parcela_receber', p.parcela, p.versao, { portador_titulo_id: null });
      if (!coob) await quitarPelaCessao(tx, { ...p, versao }, numero(i['valor_face']), -1, hoje());
      await tx.alterar('operacao_cessao_recebivel_item', numero(i['id']), numero(i['versao']), {
        situacao: 'devolvida',
      });
    }
    await tx.alterar('operacao_cessao_recebivel', e.operacao, numero(o['versao']), {
      situacao: 'cancelada',
      cancelada_em: new Date(),
      motivo_cancelamento: e.motivo,
    });
    return { operacao: e.operacao, situacao: 'cancelada', devolvidas: itens.length };
  },
  alvo: (e) => ({ tabela: 'operacao_cessao_recebivel', id: e.operacao }),
  trilha: (e) => ({ motivo: e.motivo }),
});

/** As operações desta parte, pelo nome da rota. */
export const OPERACOES_NOTA_CESSAO = {
  emitirNota,
  aplicarNota,
  cancelarNota,
  manterPortador,
  contratarCessao,
  desfechoCessao,
  cancelarCessao,
} as const;

// ── Leituras ────────────────────────────────────────────────────────────────────────────────────────────────

/** Parcelas em aberto do lado, com a contraparte, para escolher na nota ou na cessão (as 300 de vencimento mais próximo). */
export async function parcelasEmAberto(l: Leitor, est: number, lado: Lado, busca: string | null) {
  const like = busca ? `%${busca}%` : null;
  const sql =
    lado === 'pagar'
      ? `SELECT p.id, p.sequencia, p.vencimento, p.saldo, p.situacao, t.id AS titulo, t.numero, t.numero_documento,
                COALESCE(f.nome_fantasia, f.razao_social) AS contraparte, NULL AS portador
           FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
           LEFT JOIN empresa_fornecedora f ON f.id = t.empresa_fornecedora_id
          WHERE t.estabelecimento_id = ? AND p.situacao IN ('aberta','parcial') AND t.empresa_fornecedora_id IS NOT NULL
            AND (? IS NULL OR t.numero_documento LIKE ? OR f.razao_social LIKE ? OR f.nome_fantasia LIKE ?)
          ORDER BY p.vencimento, p.id LIMIT 300`
      : `SELECT p.id, p.sequencia, p.vencimento, p.saldo, p.situacao, t.id AS titulo, t.numero, t.numero_documento,
                COALESCE(c.nome_fantasia, c.nome, fp.nome) AS contraparte, pt.descricao AS portador
           FROM parcela_receber p JOIN titulo_receber t ON t.id = p.titulo_receber_id
           LEFT JOIN cliente_financeiro c ON c.id = t.cliente_financeiro_id
           LEFT JOIN fonte_pagadora fp ON fp.id = t.fonte_pagadora_id
           LEFT JOIN portador_titulo pt ON pt.id = p.portador_titulo_id
          WHERE t.estabelecimento_id = ? AND p.situacao IN ('aberta','parcial') AND t.paciente_id IS NULL
            AND (? IS NULL OR t.numero_documento LIKE ? OR c.nome LIKE ? OR fp.nome LIKE ?)
          ORDER BY p.vencimento, p.id LIMIT 300`;
  const linhas = await l.consultar(sql, [est, like, like, like, like]);
  return linhas.map((r) => ({
    parcela: numero(r['id']),
    sequencia: numero(r['sequencia']),
    vencimento: dataIso(r['vencimento']),
    saldo: numero(r['saldo']),
    situacao: texto(r['situacao']),
    titulo: numero(r['titulo']),
    numero: texto(r['numero']),
    documento: texto(r['numero_documento']),
    contraparte: r['contraparte'] === null ? null : texto(r['contraparte']),
    portador: r['portador'] === null ? null : texto(r['portador']),
  }));
}

export async function notasDoEstabelecimento(l: Leitor, est: number) {
  const linhas = await l.consultar(
    `SELECT n.id, n.numero, n.direcao, n.natureza, n.efeito, n.data_emissao, n.valor_total, n.valor_impostos,
            n.valor_ajuste, n.situacao, n.titulo_pagar_id, n.titulo_receber_id, m.descricao AS motivo,
            COALESCE(f.nome_fantasia, f.razao_social, c.nome, fp.nome) AS contraparte
       FROM nota_credito_debito n JOIN motivo_nota_credito_debito m ON m.id = n.motivo_nota_credito_debito_id
       LEFT JOIN empresa_fornecedora f ON f.id = n.empresa_fornecedora_id
       LEFT JOIN cliente_financeiro c ON c.id = n.cliente_financeiro_id
       LEFT JOIN fonte_pagadora fp ON fp.id = n.fonte_pagadora_id
      WHERE n.estabelecimento_id = ? AND n.excluido_em IS NULL ORDER BY n.numero DESC LIMIT 300`,
    [est],
  );
  return linhas.map((r) => ({
    nota: numero(r['id']),
    numero: numero(r['numero']),
    direcao: texto(r['direcao']),
    natureza: texto(r['natureza']),
    efeito: r['efeito'] === null ? null : texto(r['efeito']),
    lado: r['titulo_pagar_id'] !== null ? 'pagar' : 'receber',
    dataEmissao: dataIso(r['data_emissao']),
    valorTotal: numero(r['valor_total']),
    valorImpostos: numero(r['valor_impostos']),
    valorAjuste: r['valor_ajuste'] === null ? null : numero(r['valor_ajuste']),
    situacao: texto(r['situacao']),
    motivo: texto(r['motivo']),
    contraparte: r['contraparte'] === null ? null : texto(r['contraparte']),
  }));
}

export async function apoiosNotaCessao(l: Leitor, est: number) {
  const [motivos, cancelamentos, tributos, contas, pessoas] = await Promise.all([
    l.consultar(
      'SELECT id, codigo, descricao, natureza FROM motivo_nota_credito_debito WHERE ativo = TRUE ORDER BY descricao',
      [],
    ),
    l.consultar(
      'SELECT id, descricao FROM motivo_cancelamento_documento_fiscal WHERE ativo = TRUE AND aplica_nota_credito_debito = TRUE ORDER BY descricao',
      [],
    ),
    l.consultar('SELECT id, codigo, descricao FROM tributo ORDER BY codigo', []),
    l.consultar('SELECT id, descricao FROM conta_bancaria WHERE estabelecimento_id = ? ORDER BY descricao', [
      est,
    ]),
    l.consultar(
      'SELECT id, COALESCE(nome_fantasia, razao_social) AS nome FROM pessoa_juridica ORDER BY 2 LIMIT 500',
      [],
    ),
  ]);
  const op = (rs: Record<string, unknown>[], rot: (r: Record<string, unknown>) => string) =>
    rs.map((r) => ({
      id: numero(r['id']),
      rotulo: rot(r),
      ...(r['natureza'] ? { natureza: texto(r['natureza']) } : {}),
    }));
  return {
    motivos: op(motivos, (r) => texto(r['descricao'])),
    motivosCancelamento: op(cancelamentos, (r) => texto(r['descricao'])),
    tributos: op(tributos, (r) => `${texto(r['codigo'])} · ${texto(r['descricao'])}`),
    contas: op(contas, (r) => texto(r['descricao'])),
    pessoas: op(pessoas, (r) => texto(r['nome'])),
  };
}

export async function portadoresDoEstabelecimento(l: Leitor, est: number, data: string) {
  const linhas = await l.consultar(
    `SELECT p.id, p.codigo, p.descricao, p.tipo, p.ativo, p.conta_bancaria_id, p.pessoa_juridica_id,
            c.taxa_desconto, c.prazo_dias, c.limite_credito, c.valor_tarifa, c.vigencia_inicio,
            (SELECT COALESCE(SUM(i.valor_face), 0) FROM operacao_cessao_recebivel_item i
               JOIN operacao_cessao_recebivel o ON o.id = i.operacao_cessao_recebivel_id
              WHERE o.portador_titulo_id = p.id AND o.situacao = 'contratada' AND i.situacao = 'cedida') AS utilizado
       FROM portador_titulo p
       LEFT JOIN condicao_portador c ON c.id = (SELECT c2.id FROM condicao_portador c2 WHERE c2.portador_titulo_id = p.id
            AND c2.ativo = TRUE AND c2.vigencia_inicio <= ? AND (c2.vigencia_fim IS NULL OR c2.vigencia_fim >= ?)
          ORDER BY c2.vigencia_inicio DESC LIMIT 1)
      WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL ORDER BY p.codigo`,
    [data, data, est],
  );
  return linhas.map((r) => ({
    portador: numero(r['id']),
    codigo: texto(r['codigo']),
    descricao: texto(r['descricao']),
    tipo: texto(r['tipo']),
    ativo: Boolean(numero(r['ativo'])),
    contaBancaria: r['conta_bancaria_id'] === null ? null : numero(r['conta_bancaria_id']),
    pessoaJuridica: r['pessoa_juridica_id'] === null ? null : numero(r['pessoa_juridica_id']),
    taxaDesconto: r['taxa_desconto'] === null ? null : numero(r['taxa_desconto']),
    prazoDias: r['prazo_dias'] === null ? null : numero(r['prazo_dias']),
    limiteCredito: r['limite_credito'] === null ? null : numero(r['limite_credito']),
    valorTarifa: r['valor_tarifa'] === null ? null : numero(r['valor_tarifa']),
    vigenciaInicio: dataIso(r['vigencia_inicio']),
    utilizado: numero(r['utilizado']),
  }));
}

export async function operacoesCessao(l: Leitor, est: number) {
  const ops = await l.consultar(
    `SELECT o.id, o.numero, o.tipo_operacao, o.data_operacao, o.taxa_mensal, o.com_coobrigacao, o.valor_face,
            o.valor_desagio, o.valor_tarifas, o.valor_iof, o.valor_liquido, o.situacao, p.descricao AS portador
       FROM operacao_cessao_recebivel o LEFT JOIN portador_titulo p ON p.id = o.portador_titulo_id
      WHERE o.estabelecimento_id = ? AND o.excluido_em IS NULL ORDER BY o.numero DESC LIMIT 100`,
    [est],
  );
  const ids = ops.map((o) => numero(o['id']));
  const itens = ids.length
    ? await l.consultar(
        `SELECT i.id, i.operacao_cessao_recebivel_id, i.parcela_receber_id, i.data_vencimento, i.valor_face,
                i.valor_desagio, i.situacao, t.numero_documento
           FROM operacao_cessao_recebivel_item i JOIN parcela_receber pr ON pr.id = i.parcela_receber_id
           JOIN titulo_receber t ON t.id = pr.titulo_receber_id
          WHERE i.operacao_cessao_recebivel_id IN (${ids.map(() => '?').join(', ')}) ORDER BY i.data_vencimento`,
        ids,
      )
    : [];
  return ops.map((o) => ({
    operacao: numero(o['id']),
    numero: numero(o['numero']),
    tipo: texto(o['tipo_operacao']),
    dataOperacao: dataIso(o['data_operacao']),
    taxaMensal: numero(o['taxa_mensal']),
    comCoobrigacao: Boolean(numero(o['com_coobrigacao'])),
    valorFace: numero(o['valor_face']),
    valorDesagio: numero(o['valor_desagio']),
    valorTarifas: numero(o['valor_tarifas']),
    valorIof: numero(o['valor_iof']),
    valorLiquido: numero(o['valor_liquido']),
    situacao: texto(o['situacao']),
    portador: o['portador'] === null ? null : texto(o['portador']),
    itens: itens
      .filter((i) => numero(i['operacao_cessao_recebivel_id']) === numero(o['id']))
      .map((i) => ({
        item: numero(i['id']),
        parcela: numero(i['parcela_receber_id']),
        documento: texto(i['numero_documento']),
        vencimento: dataIso(i['data_vencimento']),
        valorFace: numero(i['valor_face']),
        valorDesagio: numero(i['valor_desagio']),
        situacao: texto(i['situacao']),
      })),
  }));
}
