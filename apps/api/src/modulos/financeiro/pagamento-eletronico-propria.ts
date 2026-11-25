// F3.8, 07-FIN linha 66: pagamento eletrônico a credores no banco próprio, pelo executor do @sgh/nucleo (trilha, outbox e
// idempotência na mesma transação). As regras são as do @sgh/dominio-financeiro (retorno-pagamento.ts, chave-pix.ts e
// pagamento-eletronico.ts); aqui ficam a leitura sob a trava e a gravação.
// Retorno do banco: o arquivo é lido inteiro antes de qualquer gravação (arquivo que não fecha é recusado inteiro) e o
// mesmo arquivo não entra duas vezes (impressão digital). Cada linha vira um item do retorno com a ocorrência; o pago
// ganha a baixa na conta da remessa com o movimento bancário (data e valor efetivos do banco), o rejeitado devolve a
// parcela à fila com o motivo e o agendado continua aguardando. O vínculo da parcela com a remessa é respondido aqui.
// Dados bancários do credor (fornecedor, profissional ou prestador terceiro, C1-026): conta em banco e chave Pix conferidas no domínio; nada se apaga (desativar guarda a linha e
// a chave trocada fica no histórico de chaves). A lista mostra o dado mascarado.
// Remessa por Pix: o arquivo é montado pela regra do domínio com a chave preferencial do credor; a gravação remonta o
// arquivo sob a trava e só registra se a impressão digital for a do arquivo guardado.
import { createHash } from 'node:crypto';
import {
  type ChaveCandidata,
  conferirContaCredor,
  type CredorDaConta,
  credorDaConta,
  credorRecusado,
  escolherChavePix,
  gerarCnab240Pix,
  lerRetornoCnab240,
  mascararDadoBancario,
  montarRetornoCnab240,
  planejarRetorno,
  remessaPixRecusada,
  retornoRecusado,
  TIPOS_CONTA_CREDOR,
  TIPOS_CREDOR_CONTA,
  type TipoChavePix,
  type TipoCredorConta,
  type TituloRemessaPix,
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
import { ligarArquivo, registrarArquivoGuardado, retencaoAte } from '../tiss/armazem-xml.js';
import { acompanharGuiasDosTitulos, TABELAS_GUIA_DO_TITULO } from './guia-recolhimento-titulo.js';
import { exigirPeriodoAberto } from './periodo-propria.js';
import { dataIso, instanteIso, LANCAMENTO_PAGAMENTO, numero, texto } from './vocabulario.js';

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.number().int().positive();
const centavos = (v: number) => Math.round(v * 100) / 100;
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const hojeIso = () => new Date().toISOString().slice(0, 10);

function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}
function usuarioDe(ctx: ContextoOperacao): number {
  if (ctx.usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  return ctx.usuario;
}
/** A conta tem de estar no escopo de quem movimenta (regra 15); a importação é tardia para não criar ciclo. */
async function exigirContaMovimentavel(
  l: Leitor,
  est: number,
  usuario: number,
  conta: number,
): Promise<void> {
  const { contasDoEscopo } = await import('./operacoes.js');
  if (!(await contasDoEscopo(l, est, usuario, 'movimentar')).includes(conta))
    throw recusa('fora-do-escopo', 'A conta bancária não está no seu escopo de contas.', {
      campos: ['conta'],
    });
}
const meioDaRemessa = (observacao: unknown): 'pix' | 'transferencia' => {
  try {
    return (JSON.parse(texto(observacao) || '{}') as { meio?: string }).meio === 'pix'
      ? 'pix'
      : 'transferencia';
  } catch {
    return 'transferencia';
  }
};

// ── Retorno do banco ───────────────────────────────────────────────────────────────────────────────────────────

export const esquemaProcessarRetorno = z
  .object({
    remessa: id,
    nomeArquivo: z.string().trim().min(1).max(255),
    conteudo: z.string().min(1).max(4_000_000),
  })
  .strict();

const processarRetorno = definirOperacao<z.infer<typeof esquemaProcessarRetorno>, ResultadoOperacao>({
  nome: 'financeiro.processar_retorno_pagamento',
  tabelas: [
    'retorno_bancario',
    'retorno_bancario_item',
    'parcela_remessa_bancaria',
    'remessa_bancaria',
    'baixa_titulo',
    'movimento_bancario',
    'parcela_pagar',
    'titulo_pagar',
    ...TABELAS_GUIA_DO_TITULO,
  ],
  entrada: esquemaProcessarRetorno as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const [remessa] = await tx.consultarParaAtualizar(
      `SELECT r.id, r.versao, r.situacao, r.conta_bancaria_id, r.leiaute_bancario_id, r.observacao,
              b.codigo_compensacao
         FROM remessa_bancaria r JOIN conta_bancaria c ON c.id = r.conta_bancaria_id
         LEFT JOIN banco b ON b.id = c.banco_id
        WHERE r.id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL`,
      [e.remessa, est],
      { teto: 1 },
    );
    if (!remessa) throw recusa('remessa-inexistente', 'A remessa não existe neste estabelecimento.');
    if (texto(remessa['situacao']) === 'cancelada')
      throw recusa('remessa-cancelada', 'A remessa foi cancelada: o retorno dela não é processado.');
    const conta = numero(remessa['conta_bancaria_id']);
    await exigirContaMovimentavel(tx, est, usuario, conta);
    const lido = lerRetornoCnab240(e.conteudo, numero(remessa['codigo_compensacao']));
    if (retornoRecusado(lido)) throw recusa(lido.codigo, lido.mensagem, { campos: ['conteudo'] });
    const hash = sha256(e.conteudo);
    const ja = await tx.uma(
      'SELECT id FROM retorno_bancario WHERE estabelecimento_id = ? AND hash_arquivo = ?',
      [est, hash],
    );
    if (ja)
      throw recusa(
        'retorno-ja-importado',
        'Este arquivo de retorno já foi processado: nada foi baixado de novo.',
        { campos: ['conteudo'] },
      );
    const vinculos = await tx.consultarParaAtualizar(
      `SELECT pr.id, pr.versao, pr.parcela_pagar_id, pr.valor, pr.situacao, p.versao AS parcela_versao, p.saldo,
              p.valor_pago, p.situacao AS parcela_situacao, p.titulo_pagar_id, t.numero_documento,
              t.natureza_financeira_id
         FROM parcela_remessa_bancaria pr JOIN parcela_pagar p ON p.id = pr.parcela_pagar_id
         JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
        WHERE pr.remessa_bancaria_id = ? AND pr.excluido_em IS NULL`,
      [e.remessa],
      { teto: 5000 },
    );
    const porParcela = new Map(vinculos.map((v) => [numero(v['parcela_pagar_id']), v]));
    const emAberto = (v: Record<string, unknown>) =>
      ['aberta', 'parcial'].includes(texto(v['parcela_situacao'])) ? numero(v['saldo']) : 0;
    const plano = planejarRetorno(
      vinculos.map((v) => ({
        parcela: numero(v['parcela_pagar_id']),
        vinculo: texto(v['situacao']) as 'pendente' | 'retornada' | 'rejeitada',
        valorEnviado: numero(v['valor']),
        saldo: emAberto(v),
      })),
      lido,
      hojeIso(),
    );
    const agora = new Date();
    const retorno = await tx.incluir('retorno_bancario', {
      estabelecimento_id: est,
      conta_bancaria_id: conta,
      leiaute_bancario_id: remessa['leiaute_bancario_id'],
      remessa_bancaria_id: e.remessa,
      nome_arquivo: e.nomeArquivo,
      hash_arquivo: hash,
      data_arquivo: hojeIso(),
      sequencia_arquivo: Number.isFinite(lido.sequencial) ? lido.sequencial : null,
      importado_em: agora,
      importado_usuario_id: usuario,
      processado_em: agora,
      quantidade_registros: plano.itens.length,
      quantidade_baixados: plano.baixados,
      quantidade_rejeitados: plano.rejeitados,
      valor_total: plano.totalBaixado,
      situacao: plano.rejeitados + plano.naoLocalizados > 0 ? 'processado_com_erros' : 'processado',
    });
    const forma = meioDaRemessa(remessa['observacao']);
    let tipoMov = 0;
    const titulos = new Set<number>();
    for (const [i, item] of plano.itens.entries()) {
      const v = porParcela.get(item.titulo);
      let movimento: number | null = null;
      if (item.baixa && v && item.dataPagamento) {
        await exigirPeriodoAberto(tx, est, item.dataPagamento, 'conteudo');
        if (!tipoMov) {
          const t = await tx.uma('SELECT id FROM tipo_lancamento_bancario WHERE codigo = ?', [
            LANCAMENTO_PAGAMENTO,
          ]);
          if (!t)
            throw recusa(
              'cadastro-incompleto',
              'Falta no cadastro do financeiro o tipo de lançamento do pagamento de título.',
            );
          tipoMov = numero(t['id']);
        }
        const pago = centavos(item.baixa.principal + item.baixa.acrescimo);
        movimento = await tx.incluir('movimento_bancario', {
          estabelecimento_id: est,
          conta_bancaria_id: conta,
          tipo_lancamento_bancario_id: tipoMov,
          natureza: 'debito',
          tipo_origem: 'baixa_titulo',
          data_movimento: item.dataPagamento,
          numero_documento: texto(v['numero_documento']).slice(0, 30) || null,
          historico: `Pagamento do título ${texto(v['numero_documento'])} (retorno do banco)`.slice(0, 300),
          valor: pago,
          natureza_financeira_id: v['natureza_financeira_id'],
        });
        const baixa = await tx.incluir('baixa_titulo', {
          estabelecimento_id: est,
          parcela_pagar_id: item.titulo,
          data_pagamento: item.dataPagamento,
          conta_bancaria_id: conta,
          forma_pagamento: forma,
          valor_principal: item.baixa.principal,
          valor_acrescimo: item.baixa.acrescimo,
          valor_pago: pago,
          movimento_bancario_id: movimento,
          observacao: `Baixa pelo retorno do banco: ${item.motivo}`.slice(0, 300),
        });
        await tx.alterar('movimento_bancario', movimento, 1, { baixa_titulo_id: baixa });
        const quitada = item.baixa.saldoRestante === 0;
        await tx.alterar('parcela_pagar', item.titulo, numero(v['parcela_versao']), {
          valor_pago: centavos(numero(v['valor_pago']) + item.baixa.principal),
          saldo: item.baixa.saldoRestante,
          situacao: quitada ? 'paga' : 'parcial',
          ...(quitada ? { quitada_em: item.dataPagamento } : {}),
        });
        titulos.add(numero(v['titulo_pagar_id']));
      }
      if (v && item.vinculoNovo)
        await tx.alterar('parcela_remessa_bancaria', numero(v['id']), numero(v['versao']), {
          situacao: item.vinculoNovo,
          retornada_em: agora,
        });
      await tx.incluir('retorno_bancario_item', {
        retorno_bancario_id: retorno,
        sequencia: i + 1,
        parcela_pagar_id: v ? item.titulo : null,
        codigo_ocorrencia: item.codigo.slice(0, 5),
        codigos_complementares: item.complementares.join(',').slice(0, 50) || null,
        data_pagamento: item.dataPagamento,
        valor_pagamento: item.valorEnviado,
        valor_efetivado: item.valorEfetivado,
        situacao: item.situacao,
        movimento_bancario_id: movimento,
      });
    }
    for (const t of titulos) {
      const [r] = await tx.consultarParaAtualizar(
        `SELECT t.versao, SUM(p.saldo > 0) AS abertas FROM titulo_pagar t
           JOIN parcela_pagar p ON p.titulo_pagar_id = t.id AND p.excluido_em IS NULL
          WHERE t.id = ? GROUP BY t.id, t.versao`,
        [t],
        { teto: 1 },
      );
      if (r)
        await tx.alterar('titulo_pagar', t, numero(r['versao']), {
          situacao: numero(r['abertas']) > 0 ? 'pago_parcial' : 'pago',
        });
    }
    // 07-FIN linha 110: a guia do recolhimento quitado pelo retorno fica paga e a apuração do retido, recolhida.
    await acompanharGuiasDosTitulos(tx, titulos, usuario);
    await tx.alterar('remessa_bancaria', e.remessa, numero(remessa['versao']), {
      situacao: plano.situacaoRemessa,
    });
    return {
      retorno,
      remessa: e.remessa,
      baixados: plano.baixados,
      rejeitados: plano.rejeitados,
      agendados: plano.agendados,
      naoLocalizados: plano.naoLocalizados,
      informativos: plano.informativos,
      totalBaixado: plano.totalBaixado,
      pendentes: plano.pendentes,
      situacaoRemessa: plano.situacaoRemessa,
    };
  },
  alvo: (_e, r) => ({ tabela: 'retorno_bancario', id: numero(r['retorno']) || null }),
  eventos: (_e, r) => [
    {
      tipo: 'financeiro.retorno_pagamento.processado',
      carga: {
        retorno: numero(r['retorno']),
        remessa: numero(r['remessa']),
        baixados: numero(r['baixados']),
        rejeitados: numero(r['rejeitados']),
      },
    },
  ],
});

// ── Dados bancários e chave Pix do credor ──────────────────────────────────────────────────────────────────────

const dadosConta = {
  titularNome: z.string().trim().min(1).max(150),
  titularDocumento: z.string().trim().min(11).max(18),
  tipoConta: z.enum(TIPOS_CONTA_CREDOR),
  banco: id.nullable(),
  agencia: z.string().trim().max(15),
  digitoAgencia: z.string().trim().max(2),
  conta: z.string().trim().max(25),
  digitoConta: z.string().trim().max(2),
  tipoChavePix: z.enum(['cpf', 'cnpj', 'email', 'telefone', 'aleatoria']).nullable(),
  chavePix: z.string().trim().max(100),
  preferencial: z.boolean(),
};
// A linha do cadastro vem em `contaCredor`: `conta` é o número da conta em banco.
export const esquemaAlterarContaCredor = z
  .object({
    acao: z.literal('alterar'),
    contaCredor: id,
    versao: id,
    ...dadosConta,
  })
  .strict();
// O credor da conta nova: o par (tipoCredor, credor) ou `fornecedor` sozinho (forma curta); a regra é a do domínio.
export const esquemaContaCredor = z.discriminatedUnion('acao', [
  z
    .object({
      acao: z.literal('incluir'),
      fornecedor: id.optional(),
      tipoCredor: z.enum(TIPOS_CREDOR_CONTA).optional(),
      credor: id.optional(),
      ...dadosConta,
    })
    .strict(),
  esquemaAlterarContaCredor,
  z.object({ acao: z.literal('desativar'), contaCredor: id, versao: id }).strict(),
]);
type ContaCredorEntradaOp = z.infer<typeof esquemaContaCredor>;

/** Coluna da conta do credor para cada tipo (a conta é de um credor só: o CHECK do banco confere). */
const COLUNA_DO_CREDOR: Readonly<
  Record<TipoCredorConta, 'empresa_fornecedora_id' | 'profissional_id' | 'prestador_terceiro_id'>
> = {
  fornecedor: 'empresa_fornecedora_id',
  profissional: 'profissional_id',
  prestador: 'prestador_terceiro_id',
};
/** O credor da linha gravada (nulo: conta de pessoa física avulsa, fora deste cadastro). */
const credorDaLinha = (l: Record<string, unknown>): CredorDaConta | null => {
  for (const tipo of TIPOS_CREDOR_CONTA) {
    const v = l[COLUNA_DO_CREDOR[tipo]];
    if (v !== null && v !== undefined) return { tipo, id: numero(v) };
  }
  return null;
};

const manterContaCredor = definirOperacao<ContaCredorEntradaOp, ResultadoOperacao>({
  nome: 'financeiro.manter_conta_credor',
  tabelas: ['conta_bancaria_credor', 'chave_pix_credor'],
  entrada: esquemaContaCredor as never,
  async gravar(tx, e, ctx) {
    const desativarChaves = async (contaCredor: number, menos: string | null) => {
      const chaves = await tx.consultarParaAtualizar(
        'SELECT id, versao, chave FROM chave_pix_credor WHERE conta_bancaria_credor_id = ? AND ativa = TRUE',
        [contaCredor],
        { teto: 100 },
      );
      let mantida = false;
      for (const c of chaves) {
        if (menos !== null && texto(c['chave']) === menos && !mantida) {
          mantida = true;
          continue;
        }
        await tx.alterar('chave_pix_credor', numero(c['id']), numero(c['versao']), {
          ativa: false,
          padrao: false,
        });
      }
      return mantida;
    };
    const lerLinha = async (contaCredor: number, versao: number) => {
      const [l] = await tx.consultarParaAtualizar(
        `SELECT id, versao, empresa_fornecedora_id, profissional_id, prestador_terceiro_id, ativo
           FROM conta_bancaria_credor WHERE id = ?`,
        [contaCredor],
        { teto: 1 },
      );
      if (!l || credorDaLinha(l) === null) throw recusa('conta-inexistente', 'A conta do credor não existe.');
      // A conta de prestador terceiro de outro estabelecimento não existe para esta sessão (desativar e alterar).
      if (l['prestador_terceiro_id'] !== null && l['prestador_terceiro_id'] !== undefined) {
        const doEstabelecimento = await tx.uma(
          'SELECT id FROM prestador_terceiro WHERE id = ? AND estabelecimento_id = ?',
          [numero(l['prestador_terceiro_id']), estabelecimentoDe(ctx)],
        );
        if (!doEstabelecimento) throw recusa('conta-inexistente', 'A conta do credor não existe.');
      }
      if (numero(l['versao']) !== versao)
        throw recusa('versao-desatualizada', 'Outra pessoa alterou a conta do credor: releia.');
      return l;
    };
    if (e.acao === 'desativar') {
      const l = await lerLinha(e.contaCredor, e.versao);
      await tx.alterar('conta_bancaria_credor', e.contaCredor, e.versao, {
        ativo: false,
        preferencial: false,
      });
      await desativarChaves(e.contaCredor, null);
      const dono = credorDaLinha(l) as CredorDaConta;
      return {
        contaCredor: e.contaCredor,
        tipoCredor: dono.tipo,
        credor: dono.id,
        fornecedor: dono.tipo === 'fornecedor' ? dono.id : null,
        acao: e.acao,
      };
    }
    const conferida = conferirContaCredor(e);
    if ('codigo' in conferida)
      throw recusa(conferida.codigo, conferida.mensagem, { campos: [...(conferida.campos ?? [])] });
    const atual = e.acao === 'alterar' ? await lerLinha(e.contaCredor, e.versao) : null;
    if (atual && !atual['ativo'])
      throw recusa('conta-desativada', 'A conta do credor está desativada: inclua uma nova.');
    let dono: CredorDaConta;
    if (atual) dono = credorDaLinha(atual) as CredorDaConta;
    else {
      const r = credorDaConta(e.acao === 'incluir' ? e : {});
      if (credorRecusado(r)) throw recusa(r.codigo, r.mensagem, { campos: [...(r.campos ?? [])] });
      dono = r;
    }
    // O credor existe no cadastro dele; o prestador terceiro é do estabelecimento da sessão.
    const existe =
      dono.tipo === 'fornecedor'
        ? await tx.uma('SELECT id FROM empresa_fornecedora WHERE id = ?', [dono.id])
        : dono.tipo === 'profissional'
          ? await tx.uma('SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL', [dono.id])
          : await tx.uma(
              'SELECT id FROM prestador_terceiro WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
              [dono.id, estabelecimentoDe(ctx)],
            );
    if (!existe) throw recusa('credor-inexistente', 'O credor não existe.', { campos: ['credor'] });
    const coluna = COLUNA_DO_CREDOR[dono.tipo];
    if (conferida.banco !== null) {
      const b = await tx.uma('SELECT id FROM banco WHERE id = ?', [conferida.banco]);
      if (!b) throw recusa('banco-inexistente', 'Escolha o banco da lista.', { campos: ['banco'] });
    }
    const outras = await tx.consultarParaAtualizar(
      `SELECT id, versao, banco_id, numero_agencia, numero_conta, chave_pix, preferencial
         FROM conta_bancaria_credor WHERE ${coluna} = ? AND ativo = TRUE AND id <> ?`,
      [dono.id, atual ? numero(atual['id']) : 0],
      { teto: 200 },
    );
    const repetida = outras.some(
      (o) =>
        (conferida.conta !== null &&
          numero(o['banco_id']) === conferida.banco &&
          texto(o['numero_agencia']) === conferida.agencia &&
          texto(o['numero_conta']) === conferida.conta) ||
        (conferida.chavePix !== null && texto(o['chave_pix']) === conferida.chavePix),
    );
    if (repetida)
      throw recusa('conta-repetida', 'O credor já tem esta conta ou esta chave Pix no cadastro.', {
        campos: ['conta', 'chavePix'],
      });
    // A primeira conta ativa do credor é a preferencial; marcar outra como preferencial desmarca as demais.
    const preferencial = e.preferencial || outras.length === 0;
    if (preferencial)
      for (const o of outras)
        if (o['preferencial'])
          await tx.alterar('conta_bancaria_credor', numero(o['id']), numero(o['versao']), {
            preferencial: false,
          });
    const valores = {
      banco_id: conferida.banco,
      tipo_conta: conferida.tipoConta,
      numero_agencia: conferida.agencia,
      digito_agencia: conferida.digitoAgencia,
      numero_conta: conferida.conta,
      digito_conta: conferida.digitoConta,
      tipo_chave_pix: conferida.tipoChavePix,
      chave_pix: conferida.chavePix,
      titular_nome: conferida.titularNome,
      titular_documento: conferida.titularDocumento,
      preferencial,
    };
    let contaCredor: number;
    if (atual) {
      contaCredor = numero(atual['id']);
      await tx.alterar('conta_bancaria_credor', contaCredor, e.acao === 'alterar' ? e.versao : 1, valores);
    } else contaCredor = await tx.incluir('conta_bancaria_credor', { [coluna]: dono.id, ...valores });
    // A chave trocada não some: fica desativada no histórico de chaves; a nova entra como a padrão da conta.
    const mantida = await desativarChaves(contaCredor, conferida.chavePix);
    if (conferida.chavePix !== null && conferida.tipoChavePix !== null && !mantida) {
      const seq = await tx.uma(
        'SELECT COALESCE(MAX(sequencia), 0) AS n FROM chave_pix_credor WHERE conta_bancaria_credor_id = ?',
        [contaCredor],
      );
      const antiga = await tx.uma(
        'SELECT id, versao FROM chave_pix_credor WHERE conta_bancaria_credor_id = ? AND tipo_chave = ? AND chave = ?',
        [contaCredor, conferida.tipoChavePix, conferida.chavePix],
      );
      if (antiga)
        await tx.alterar('chave_pix_credor', numero(antiga['id']), numero(antiga['versao']), {
          ativa: true,
          padrao: true,
        });
      else
        await tx.incluir('chave_pix_credor', {
          conta_bancaria_credor_id: contaCredor,
          sequencia: numero(seq?.['n']) + 1,
          tipo_chave: conferida.tipoChavePix,
          chave: conferida.chavePix,
          padrao: true,
          data_ativacao: hojeIso(),
        });
    }
    return {
      contaCredor,
      tipoCredor: dono.tipo,
      credor: dono.id,
      fornecedor: dono.tipo === 'fornecedor' ? dono.id : null,
      acao: e.acao,
      preferencial,
    };
  },
  alvo: (_e, r) => ({ tabela: 'conta_bancaria_credor', id: numero(r['contaCredor']) || null }),
  eventos: (_e, r) => [
    {
      tipo: 'financeiro.conta_credor.mantida',
      carga: {
        contaCredor: numero(r['contaCredor']),
        tipoCredor: texto(r['tipoCredor']),
        credor: numero(r['credor']),
        acao: texto(r['acao']),
      },
    },
  ],
});

// ── Remessa de pagamento por Pix ───────────────────────────────────────────────────────────────────────────────

export interface RemessaPixMontada {
  readonly conteudo: string;
  readonly total: number;
  readonly sequencial: number;
  readonly titulos: readonly TituloRemessaPix[];
  readonly vencimentos: ReadonlyMap<number, string>;
}

/**
 * Monta o arquivo da remessa por Pix com a chave ativa de cada credor (fornecedor ou profissional; sem chave dele, a do
 * prestador terceiro ligado, pela regra do domínio `escolherChavePix`); o documento do favorecido é o do titular da
 * chave. Recusa parcela de outro estabelecimento, sem saldo, de credor que não é fornecedor nem profissional ou que já
 * está numa remessa aguardando o retorno.
 */
export async function montarRemessaPix(
  l: Leitor,
  est: number,
  conta: number,
  parcelas: readonly number[],
  dataPagamento: string,
): Promise<RemessaPixMontada> {
  const c = await l.uma(
    `SELECT c.id, c.numero_agencia, c.numero_conta, c.sequencia_remessa, b.codigo_compensacao
       FROM conta_bancaria c LEFT JOIN banco b ON b.id = c.banco_id
      WHERE c.id = ? AND c.estabelecimento_id = ? AND c.excluido_em IS NULL`,
    [conta, est],
  );
  if (!c || c['codigo_compensacao'] === null)
    throw recusa('conta-sem-banco', 'A conta escolhida não é uma conta em banco deste estabelecimento.', {
      campos: ['conta'],
    });
  const unicas = [...new Set(parcelas)];
  const linhas = await l.consultar(
    `SELECT p.id, p.saldo, p.situacao, p.vencimento, t.empresa_fornecedora_id, t.profissional_id,
            COALESCE(f.razao_social, pf.nome) AS razao_social, COALESCE(f.cnpj, f.cpf, pf.cpf) AS documento,
            (SELECT COUNT(*) FROM parcela_remessa_bancaria pr JOIN remessa_bancaria r ON r.id = pr.remessa_bancaria_id
              WHERE pr.parcela_pagar_id = p.id AND pr.situacao = 'pendente' AND pr.excluido_em IS NULL
                AND r.excluido_em IS NULL AND r.situacao <> 'cancelada') AS em_remessa
       FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
       LEFT JOIN empresa_fornecedora f ON f.id = t.empresa_fornecedora_id
       LEFT JOIN profissional pr ON pr.id = t.profissional_id
       LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
      WHERE p.id IN (${unicas.map(() => '?').join(',')}) AND t.estabelecimento_id = ? AND p.excluido_em IS NULL
        AND t.excluido_em IS NULL AND t.situacao <> 'cancelado'
      ORDER BY p.id`,
    [...unicas, est],
    { teto: 500 },
  );
  if (linhas.length !== unicas.length)
    throw recusa('parcela-inexistente', 'Há título que não existe neste estabelecimento: releia.', {
      campos: ['parcelas'],
    });
  const fechadas = linhas.filter(
    (x) => !['aberta', 'parcial'].includes(texto(x['situacao'])) || !(numero(x['saldo']) > 0),
  );
  if (fechadas.length > 0)
    throw recusa(
      'titulo-ja-baixado',
      `Título já pago ou fora da fila de pagamento: ${fechadas.map((x) => numero(x['id'])).join(', ')}.`,
    );
  const presas = linhas.filter((x) => numero(x['em_remessa']) > 0);
  if (presas.length > 0)
    throw recusa(
      'titulo-em-remessa',
      `Título já enviado numa remessa que aguarda o retorno do banco: ${presas.map((x) => numero(x['id'])).join(', ')}.`,
    );
  const semCredor = linhas.filter(
    (x) => x['empresa_fornecedora_id'] === null && x['profissional_id'] === null,
  );
  if (semCredor.length > 0)
    throw recusa(
      'credor-sem-cadastro-bancario',
      `A remessa por Pix paga fornecedores e profissionais: o(s) título(s) ${semCredor.map((x) => numero(x['id'])).join(', ')} são de outro tipo de credor.`,
    );
  const chaves = await chavesDosCredores(l, est, linhas);
  const titulos: TituloRemessaPix[] = linhas.map((x) => {
    const escolhida = escolherChavePix(chaves.candidatas(x));
    return {
      titulo: numero(x['id']),
      valor: numero(x['saldo']),
      dataPagamento,
      favorecido: texto(x['razao_social']),
      documento: (escolhida ? (chaves.titular.get(escolhida.conta) ?? '') : texto(x['documento'])).replace(
        /\D/g,
        '',
      ),
      tipoChavePix: escolhida?.tipoChavePix ?? null,
      chavePix: escolhida?.chavePix ?? null,
    };
  });
  const sequencial = numero(c['sequencia_remessa']) + 1;
  const arquivo = gerarCnab240Pix(
    numero(c['codigo_compensacao']),
    {
      agencia: numero(c['numero_agencia']),
      numero: Number(texto(c['numero_conta']).replace(/\D/g, '')) || 0,
    },
    sequencial,
    titulos,
  );
  if (remessaPixRecusada(arquivo)) throw recusa(arquivo.codigo, arquivo.mensagem, { campos: ['parcelas'] });
  return {
    conteudo: arquivo.conteudo,
    total: arquivo.total,
    sequencial,
    titulos,
    vencimentos: new Map(linhas.map((x) => [numero(x['id']), dataIso(x['vencimento']) ?? dataPagamento])),
  };
}

/**
 * As contas com chave Pix ativa dos credores das parcelas: a do próprio credor (fornecedor ou profissional) e a do
 * prestador terceiro do estabelecimento ligado a ele. A escolha entre elas é do domínio.
 */
async function chavesDosCredores(l: Leitor, est: number, linhas: readonly Record<string, unknown>[]) {
  const ids = (k: string) => [
    ...new Set(
      linhas
        .map((x) => x[k])
        .filter((v) => v !== null)
        .map(numero),
    ),
  ];
  const fs = ids('empresa_fornecedora_id');
  const ps = ids('profissional_id');
  const contas = await l.consultar(
    `SELECT cc.id, cc.empresa_fornecedora_id, cc.profissional_id, pt.empresa_fornecedora_id AS pt_fornecedor,
            pt.profissional_id AS pt_profissional, cc.preferencial, cc.tipo_chave_pix, cc.chave_pix, cc.titular_documento
       FROM conta_bancaria_credor cc
       LEFT JOIN prestador_terceiro pt ON pt.id = cc.prestador_terceiro_id AND pt.estabelecimento_id = ?
                                      AND pt.excluido_em IS NULL AND pt.ativo = TRUE
      WHERE cc.ativo = TRUE AND cc.chave_pix IS NOT NULL
        AND (cc.empresa_fornecedora_id IN (${naLista(fs)}) OR cc.profissional_id IN (${naLista(ps)})
             OR pt.empresa_fornecedora_id IN (${naLista(fs)}) OR pt.profissional_id IN (${naLista(ps)}))`,
    [est, ...fs, ...ps, ...fs, ...ps],
    { teto: 2000 },
  );
  const igual = (a: unknown, b: unknown) => a !== null && b !== null && numero(a) === numero(b);
  return {
    titular: new Map(contas.map((c) => [numero(c['id']), texto(c['titular_documento'])])),
    candidatas: (x: Record<string, unknown>): ChaveCandidata[] =>
      contas.flatMap((c) => {
        const doCredor =
          igual(c['empresa_fornecedora_id'], x['empresa_fornecedora_id']) ||
          igual(c['profissional_id'], x['profissional_id']);
        const doPrestador =
          igual(c['pt_fornecedor'], x['empresa_fornecedora_id']) ||
          igual(c['pt_profissional'], x['profissional_id']);
        if (!doCredor && !doPrestador) return [];
        return [
          {
            conta: numero(c['id']),
            nivel: doCredor ? ('credor' as const) : ('prestador' as const),
            preferencial: Boolean(c['preferencial']),
            tipoChavePix: texto(c['tipo_chave_pix']) as TipoChavePix,
            chavePix: texto(c['chave_pix']),
          },
        ];
      }),
  };
}

export const esquemaGerarRemessaPix = z
  .object({ conta: id, parcelas: z.array(id).min(1).max(500), dataPagamento: DATA })
  .strict();
export const esquemaRegistrarRemessaPix = esquemaGerarRemessaPix
  .extend({
    hashArquivo: z.string().regex(/^[0-9a-f]{64}$/),
    arquivo: z
      .object({
        chave: z.string().min(1).max(300),
        tamanhoBytes: z.number().int().positive(),
        tipoMime: z.string().min(1).max(100),
      })
      .strict()
      .nullable(),
    destino: z.enum(['banco', 'simulador']),
  })
  .strict();

const registrarRemessaPix = definirOperacao<z.infer<typeof esquemaRegistrarRemessaPix>, ResultadoOperacao>({
  nome: 'financeiro.registrar_remessa_pix',
  tabelas: ['remessa_bancaria', 'parcela_remessa_bancaria', 'conta_bancaria', 'sequencia_negocio', 'arquivo'],
  entrada: esquemaRegistrarRemessaPix as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    await exigirContaMovimentavel(tx, est, usuario, e.conta);
    const [conta] = await tx.consultarParaAtualizar(
      'SELECT id, versao, banco_id FROM conta_bancaria WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.conta, est],
      { teto: 1 },
    );
    if (!conta) throw recusa('fora-do-escopo', 'A conta bancária não está no seu escopo de contas.');
    const montada = await montarRemessaPix(tx, est, e.conta, e.parcelas, e.dataPagamento);
    if (sha256(montada.conteudo) !== e.hashArquivo)
      throw recusa(
        'remessa-desatualizada',
        'Os títulos, as chaves Pix ou a sequência da conta mudaram enquanto a remessa era gerada: gere de novo.',
      );
    const leiaute = await tx.uma(
      `SELECT id FROM leiaute_bancario WHERE banco_id = ? AND padrao = 'cnab240' AND servico = 'pagamento'
          AND ativo = TRUE AND sentido IN ('remessa','ambos') ORDER BY id DESC LIMIT 1`,
      [conta['banco_id']],
    );
    if (!leiaute)
      throw recusa(
        'cadastro-incompleto',
        'Falta no cadastro do financeiro: o leiaute bancário de pagamento do banco desta conta. Peça ao administrador para cadastrar.',
      );
    await tx.alterar('conta_bancaria', e.conta, numero(conta['versao']), {
      sequencia_remessa: montada.sequencial,
    });
    const agora = new Date();
    await garantirSequencia(
      tx,
      { tipo: 'remessa_bancaria', estabelecimento: est, prefixo: 'RM-' },
      { usuario, agora },
    );
    const num = await tx.proximoNumero('remessa_bancaria');
    const arquivo = e.arquivo
      ? await registrarArquivoGuardado(tx, {
          estabelecimento: est,
          entidade: 'remessa_bancaria',
          entidadeId: null,
          finalidade: 'remessa_bancaria',
          nomeOriginal: e.arquivo.chave.slice(e.arquivo.chave.lastIndexOf('/') + 1),
          tipoMime: e.arquivo.tipoMime,
          tamanhoBytes: e.arquivo.tamanhoBytes,
          hash: e.hashArquivo,
          chave: e.arquivo.chave,
          retencaoAte: retencaoAte(agora),
        })
      : null;
    const remessa = await tx.incluir('remessa_bancaria', {
      estabelecimento_id: est,
      numero: num.formatado,
      conta_bancaria_id: e.conta,
      leiaute_bancario_id: leiaute['id'],
      formato: 'cnab240',
      sequencia_arquivo: montada.sequencial,
      gerado_em: agora,
      gerado_usuario_id: usuario,
      data_pagamento: e.dataPagamento,
      quantidade_registros: montada.titulos.length,
      valor_total: montada.total,
      hash_arquivo: e.hashArquivo,
      arquivo_id: arquivo?.id ?? null,
      situacao: 'gerada',
      observacao: JSON.stringify({ destino: e.destino, meio: 'pix', ocorrencias: null, retorno: null }),
    });
    if (arquivo) await ligarArquivo(tx, arquivo, remessa);
    for (const t of montada.titulos)
      await tx.incluir('parcela_remessa_bancaria', {
        remessa_bancaria_id: remessa,
        parcela_pagar_id: t.titulo,
        valor: t.valor,
        vencimento: montada.vencimentos.get(t.titulo) ?? e.dataPagamento,
        situacao: 'pendente',
        retornada_em: null,
      });
    return {
      remessa,
      sequencial: montada.sequencial,
      numero: num.formatado,
      titulos: montada.titulos.length,
      valor: montada.total,
    };
  },
  alvo: (_e, r) => ({ tabela: 'remessa_bancaria', id: numero(r['remessa']) || null }),
  eventos: (_e, r) => [
    {
      tipo: 'financeiro.remessa_pix.gerada',
      carga: { remessa: numero(r['remessa']), titulos: numero(r['titulos']), valor: numero(r['valor']) },
    },
  ],
});

export const OPERACOES_PAGAMENTO_ELETRONICO = {
  'financeiro.processarRetornoPagamento': processarRetorno,
  'financeiro.manterContaCredor': manterContaCredor,
  'financeiro.registrarRemessaPix': registrarRemessaPix,
} as const;

// ── Leituras ───────────────────────────────────────────────────────────────────────────────────────────────────

const naLista = (ids: readonly number[]) => (ids.length ? ids.map(() => '?').join(',') : 'NULL');

/** As remessas das contas do escopo, com quantas parcelas ainda aguardam o retorno do banco. */
export async function remessasComPendencia(l: Leitor, est: number, contas: readonly number[]) {
  const linhas = await l.consultar(
    `SELECT r.id, r.numero, r.sequencia_arquivo, r.situacao, r.valor_total, r.gerado_em, r.data_pagamento,
            r.observacao, r.conta_bancaria_id, c.descricao AS conta_nome,
            (SELECT COUNT(*) FROM parcela_remessa_bancaria pr
              WHERE pr.remessa_bancaria_id = r.id AND pr.excluido_em IS NULL) AS parcelas,
            (SELECT COUNT(*) FROM parcela_remessa_bancaria pr
              WHERE pr.remessa_bancaria_id = r.id AND pr.excluido_em IS NULL AND pr.situacao = 'pendente') AS pendentes,
            (SELECT COUNT(*) FROM retorno_bancario rb WHERE rb.remessa_bancaria_id = r.id) AS retornos
       FROM remessa_bancaria r JOIN conta_bancaria c ON c.id = r.conta_bancaria_id
      WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND r.conta_bancaria_id IN (${naLista(contas)})
      ORDER BY r.id DESC LIMIT 200`,
    [est, ...contas],
    { teto: 200 },
  );
  return linhas.map((r) => ({
    id: numero(r['id']),
    numero: texto(r['numero']),
    sequencial: numero(r['sequencia_arquivo']),
    situacao: texto(r['situacao']),
    meio: meioDaRemessa(r['observacao']),
    conta: numero(r['conta_bancaria_id']),
    contaNome: texto(r['conta_nome']),
    valor: numero(r['valor_total']),
    geradaEm: instanteIso(r['gerado_em']),
    dataPagamento: dataIso(r['data_pagamento']),
    parcelas: numero(r['parcelas']),
    pendentes: numero(r['pendentes']),
    retornos: numero(r['retornos']),
  }));
}

/** Os retornos lidos de uma remessa, com cada linha: título, credor, ocorrência, situação e valores. */
export async function retornosDaRemessa(l: Leitor, est: number, remessa: number) {
  const cabecalhos = await l.consultar(
    `SELECT rb.id, rb.nome_arquivo, rb.importado_em, rb.situacao, rb.quantidade_registros, rb.quantidade_baixados,
            rb.quantidade_rejeitados, rb.valor_total, u.nome AS usuario
       FROM retorno_bancario rb LEFT JOIN usuario u ON u.id = rb.importado_usuario_id
      WHERE rb.estabelecimento_id = ? AND rb.remessa_bancaria_id = ? ORDER BY rb.id DESC`,
    [est, remessa],
    { teto: 100 },
  );
  const ids = cabecalhos.map((c) => numero(c['id']));
  const itens = await l.consultar(
    `SELECT i.retorno_bancario_id, i.sequencia, i.parcela_pagar_id, i.codigo_ocorrencia, i.codigos_complementares,
            i.data_pagamento, i.valor_pagamento, i.valor_efetivado, i.situacao, t.numero_documento, f.razao_social
       FROM retorno_bancario_item i LEFT JOIN parcela_pagar p ON p.id = i.parcela_pagar_id
       LEFT JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
       LEFT JOIN empresa_fornecedora f ON f.id = t.empresa_fornecedora_id
      WHERE i.retorno_bancario_id IN (${naLista(ids)}) ORDER BY i.retorno_bancario_id, i.sequencia`,
    ids,
    { teto: 5000 },
  );
  const { descreverOcorrencia } = await import('@sgh/dominio-financeiro');
  return cabecalhos.map((c) => ({
    id: numero(c['id']),
    arquivo: texto(c['nome_arquivo']),
    importadoEm: instanteIso(c['importado_em']),
    por: texto(c['usuario']),
    situacao: texto(c['situacao']),
    registros: numero(c['quantidade_registros']),
    baixados: numero(c['quantidade_baixados']),
    rejeitados: numero(c['quantidade_rejeitados']),
    totalBaixado: numero(c['valor_total']),
    itens: itens
      .filter((i) => numero(i['retorno_bancario_id']) === numero(c['id']))
      .map((i) => ({
        sequencia: numero(i['sequencia']),
        parcela: i['parcela_pagar_id'] === null ? null : numero(i['parcela_pagar_id']),
        documento: texto(i['numero_documento']),
        credor: texto(i['razao_social']),
        ocorrencia: texto(i['codigo_ocorrencia']),
        descricao: descreverOcorrencia(texto(i['codigo_ocorrencia'])),
        complementares: texto(i['codigos_complementares']),
        situacao: texto(i['situacao']),
        dataPagamento: dataIso(i['data_pagamento']),
        valorEnviado: i['valor_pagamento'] === null ? null : numero(i['valor_pagamento']),
        valorEfetivado: i['valor_efetivado'] === null ? null : numero(i['valor_efetivado']),
      })),
  }));
}

/**
 * O retorno que o simulador do banco devolve para as parcelas que ainda aguardam resposta (crédito efetuado na data do
 * pagamento da remessa). Só fora de produção: quem chama confere o ambiente.
 */
export async function retornoSimulado(l: Leitor, est: number, remessa: number): Promise<string | null> {
  const r = await l.uma(
    `SELECT r.sequencia_arquivo, r.data_pagamento, b.codigo_compensacao
       FROM remessa_bancaria r JOIN conta_bancaria c ON c.id = r.conta_bancaria_id
       LEFT JOIN banco b ON b.id = c.banco_id
      WHERE r.id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL`,
    [remessa, est],
  );
  if (!r) return null;
  const pendentes = await l.consultar(
    `SELECT parcela_pagar_id, valor FROM parcela_remessa_bancaria
      WHERE remessa_bancaria_id = ? AND situacao = 'pendente' AND excluido_em IS NULL ORDER BY parcela_pagar_id`,
    [remessa],
    { teto: 5000 },
  );
  const quando = dataIso(r['data_pagamento']) ?? hojeIso();
  return montarRetornoCnab240(
    numero(r['codigo_compensacao']),
    numero(r['sequencia_arquivo']),
    pendentes.map((p) => ({
      titulo: numero(p['parcela_pagar_id']),
      valor: numero(p['valor']),
      ocorrencias: ['00'],
      dataPagamento: quando,
      valorPago: numero(p['valor']),
    })),
  );
}

/** Credores (fornecedores) pelo nome ou pelo documento, com quantas contas ativas e se há chave Pix. */
export async function credoresParaPagamento(l: Leitor, busca: string) {
  const termo = busca.trim();
  const digitos = termo.replace(/\D/g, '');
  const linhas = await l.consultar(
    `SELECT f.id, f.razao_social, f.cnpj, f.cpf,
            (SELECT COUNT(*) FROM conta_bancaria_credor cc
              WHERE cc.empresa_fornecedora_id = f.id AND cc.ativo = TRUE) AS contas,
            (SELECT COUNT(*) FROM conta_bancaria_credor cc
              WHERE cc.empresa_fornecedora_id = f.id AND cc.ativo = TRUE AND cc.chave_pix IS NOT NULL) AS chaves
       FROM empresa_fornecedora f
      WHERE f.razao_social LIKE ? ${digitos.length >= 3 ? 'OR f.cnpj LIKE ? OR f.cpf LIKE ?' : ''}
      ORDER BY f.razao_social LIMIT 20`,
    [`%${termo}%`, ...(digitos.length >= 3 ? [`${digitos}%`, `${digitos}%`] : [])],
    { teto: 20 },
  );
  return linhas.map((f) => ({
    id: numero(f['id']),
    nome: texto(f['razao_social']),
    documento: texto(f['cnpj'] ?? f['cpf']),
    contas: numero(f['contas']),
    temChavePix: numero(f['chaves']) > 0,
  }));
}

/** As contas do credor (ativas primeiro). Agência, conta e chave saem mascaradas: a tela nunca recebe o dado inteiro. */
export async function contasDoCredor(l: Leitor, credor: CredorDaConta, estabelecimento: number) {
  const coluna = COLUNA_DO_CREDOR[credor.tipo];
  // O prestador terceiro é do estabelecimento: o de outro estabelecimento não tem contas para esta sessão.
  const doEstabelecimento =
    credor.tipo === 'prestador'
      ? 'JOIN prestador_terceiro pt ON pt.id = cc.prestador_terceiro_id AND pt.estabelecimento_id = ?'
      : '';
  const linhas = await l.consultar(
    `SELECT cc.id, cc.versao, cc.banco_id, b.codigo_compensacao, b.descricao AS banco_nome, cc.tipo_conta,
            cc.numero_agencia, cc.numero_conta, cc.digito_conta, cc.tipo_chave_pix, cc.chave_pix, cc.titular_nome,
            cc.titular_documento, cc.preferencial, cc.ativo,
            (SELECT COUNT(*) FROM chave_pix_credor k WHERE k.conta_bancaria_credor_id = cc.id) AS chaves_historico
       FROM conta_bancaria_credor cc ${doEstabelecimento} LEFT JOIN banco b ON b.id = cc.banco_id
      WHERE cc.${coluna} = ? ORDER BY cc.ativo DESC, cc.preferencial DESC, cc.id DESC`,
    credor.tipo === 'prestador' ? [estabelecimento, credor.id] : [credor.id],
    { teto: 200 },
  );
  return linhas.map((c) => ({
    id: numero(c['id']),
    versao: numero(c['versao']),
    banco: c['banco_id'] === null ? null : numero(c['banco_id']),
    bancoNome:
      c['banco_id'] === null ? '' : `${texto(c['codigo_compensacao'])} ${texto(c['banco_nome'])}`.trim(),
    tipoConta: texto(c['tipo_conta']),
    agencia: mascararDadoBancario(c['numero_agencia'] === null ? null : texto(c['numero_agencia'])),
    conta: mascararDadoBancario(c['numero_conta'] === null ? null : texto(c['numero_conta'])),
    tipoChavePix: c['tipo_chave_pix'] === null ? null : texto(c['tipo_chave_pix']),
    chavePix: mascararDadoBancario(c['chave_pix'] === null ? null : texto(c['chave_pix'])),
    titularNome: texto(c['titular_nome']),
    titularDocumento: mascararDadoBancario(texto(c['titular_documento'])),
    preferencial: Boolean(c['preferencial']),
    ativo: Boolean(c['ativo']),
    chavesNoHistorico: numero(c['chaves_historico']),
  }));
}

/** Os bancos da lista oficial com código de compensação, para a escolha na tela. */
export async function bancosParaConta(l: Leitor) {
  const linhas = await l.consultar(
    `SELECT id, codigo_compensacao, descricao FROM banco
      WHERE codigo_compensacao IS NOT NULL AND vigencia_fim IS NULL ORDER BY codigo_compensacao LIMIT 800`,
    [],
    { teto: 800 },
  );
  return linhas.map((b) => ({
    id: numero(b['id']),
    nome: `${texto(b['codigo_compensacao'])} ${texto(b['descricao'])}`,
  }));
}

/** Prestadores terceiros do estabelecimento pelo nome, pelo código ou pelo documento (credor da conta bancária). */
export async function prestadoresParaPagamento(l: Leitor, est: number, busca: string) {
  const termo = busca.trim();
  const digitos = termo.replace(/\D/g, '');
  const linhas = await l.consultar(
    `SELECT id, nome, cpf, cnpj FROM prestador_terceiro
      WHERE estabelecimento_id = ? AND excluido_em IS NULL AND ativo = TRUE
        AND (nome LIKE ? OR codigo = ? ${digitos.length >= 3 ? 'OR cnpj LIKE ? OR cpf LIKE ?' : ''})
      ORDER BY nome LIMIT 20`,
    [est, `%${termo}%`, termo, ...(digitos.length >= 3 ? [`${digitos}%`, `${digitos}%`] : [])],
    { teto: 20 },
  );
  return linhas.map((p) => ({
    id: numero(p['id']),
    nome: texto(p['nome']),
    // Do prestador pessoa física não sai o CPF (só o nome e o código), como do profissional.
    documento: p['cnpj'] === null ? null : texto(p['cnpj']),
  }));
}

/**
 * Parcelas em aberto de fornecedores e de profissionais que ainda não estão numa remessa pendente, com a marca de quem
 * tem chave Pix (a do credor ou a do prestador terceiro ligado a ele).
 */
export async function parcelasParaPix(l: Leitor, est: number) {
  const linhas = await l.consultar(
    `SELECT p.id, p.sequencia AS numero_parcela, p.saldo, p.vencimento, t.numero_documento,
            COALESCE(t.empresa_fornecedora_id, t.profissional_id) AS credor,
            CASE WHEN t.empresa_fornecedora_id IS NULL THEN 'profissional' ELSE 'fornecedor' END AS credor_tipo,
            COALESCE(f.razao_social, pf.nome) AS razao_social,
            (SELECT COUNT(*) FROM conta_bancaria_credor cc
               LEFT JOIN prestador_terceiro pt ON pt.id = cc.prestador_terceiro_id AND pt.estabelecimento_id = t.estabelecimento_id
                                              AND pt.excluido_em IS NULL AND pt.ativo = TRUE
              WHERE cc.ativo = TRUE AND cc.chave_pix IS NOT NULL
                AND (cc.empresa_fornecedora_id = t.empresa_fornecedora_id OR cc.profissional_id = t.profissional_id
                     OR pt.empresa_fornecedora_id = t.empresa_fornecedora_id OR pt.profissional_id = t.profissional_id)) AS chaves
       FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
       LEFT JOIN empresa_fornecedora f ON f.id = t.empresa_fornecedora_id
       LEFT JOIN profissional pr ON pr.id = t.profissional_id
       LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
      WHERE t.estabelecimento_id = ? AND p.excluido_em IS NULL AND t.excluido_em IS NULL
        AND (t.empresa_fornecedora_id IS NOT NULL OR t.profissional_id IS NOT NULL)
        AND t.situacao NOT IN ('cancelado','renegociado') AND p.situacao IN ('aberta','parcial') AND p.saldo > 0
        AND NOT EXISTS (SELECT 1 FROM parcela_remessa_bancaria pr2 JOIN remessa_bancaria r ON r.id = pr2.remessa_bancaria_id
                         WHERE pr2.parcela_pagar_id = p.id AND pr2.situacao = 'pendente' AND pr2.excluido_em IS NULL
                           AND r.excluido_em IS NULL AND r.situacao <> 'cancelada')
      ORDER BY p.vencimento, p.id LIMIT 300`,
    [est],
    { teto: 300 },
  );
  return linhas.map((p) => ({
    id: numero(p['id']),
    documento: texto(p['numero_documento']),
    parcela: numero(p['numero_parcela']),
    credor: numero(p['credor']),
    credorTipo: texto(p['credor_tipo']) as 'fornecedor' | 'profissional',
    credorNome: texto(p['razao_social']),
    vencimento: dataIso(p['vencimento']),
    valor: numero(p['saldo']),
    temChavePix: numero(p['chaves']) > 0,
  }));
}
