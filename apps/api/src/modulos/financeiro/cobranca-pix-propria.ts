// F7, 07-FIN linha 90: cobrança Pix sobre o título a receber, no banco próprio, pelo executor do @sgh/nucleo (trilha,
// outbox e idempotência na mesma transação). As regras são as do @sgh/dominio-financeiro (cobranca-pix.ts); aqui
// ficam a leitura sob a trava, a chamada ao prestador (pix-provedor.ts) e a gravação.
// - Chave Pix da conta: conferida no domínio e gravada na forma canônica; desativar guarda a linha.
// - Emissão: a parcela em aberto ganha a cobrança (imediata ou com vencimento) com o txid, a localização e o
//   "copia e cola" devolvidos pelo prestador.
// - Retorno: a notificação do prestador é lida inteira; cada Pix (único pelo identificador fim a fim) vira o retorno,
//   o crédito na conta e, até o saldo, o recebimento que baixa a parcela e o título; o excedente fica para devolução;
//   a repetição não baixa de novo.
// - Devolução: pelo prestador, primeiro do excedente; o resto estorna o recebimento e baixa de novo só o que ficou,
//   devolvendo o saldo à parcela. Nada se apaga.
import { randomBytes } from 'node:crypto';
import {
  conferirChavePix,
  conferirCobrancaPix,
  gerarTxid,
  lerNotificacaoPix,
  MOTIVOS_DEVOLUCAO_PIX,
  type MotivoDevolucaoPix,
  planejarBaixaPix,
  planejarDevolucaoPix,
  type PixRecebido,
  VALIDADE_PADRAO_SEGUNDOS,
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
import { exigirPeriodoAberto } from './periodo-propria.js';
import type { ProvedorPix } from './pix-provedor.js';
import { dataIso, instanteIso, LANCAMENTO_RECEBIMENTO, numero, texto } from './vocabulario.js';

const id = z.number().int().positive();
const centavos = (v: number) => Math.round(v * 100) / 100;
const hojeIso = () => new Date().toISOString().slice(0, 10);
type Linha = Record<string, unknown>;
export const LANCAMENTO_DEVOLUCAO_PIX = 'devolucao_pix';
export const FORMA_RECEBIMENTO_PIX = 'pix';

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
async function exigirContaMovimentavel(l: Leitor, est: number, usuario: number, conta: number) {
  const { contasDoEscopo } = await import('./operacoes.js');
  if (!(await contasDoEscopo(l, est, usuario, 'movimentar')).includes(conta))
    throw recusa('fora-do-escopo', 'A conta bancária não está no seu escopo de contas.', {
      campos: ['conta'],
    });
}
async function idDoCodigo(l: Leitor, sql: string, codigo: string, falta: string): Promise<number> {
  const t = await l.uma(sql, [codigo]);
  if (!t) throw recusa('cadastro-incompleto', falta);
  return numero(t['id']);
}
const SQL_TIPO_LANCAMENTO = 'SELECT id FROM tipo_lancamento_bancario WHERE codigo = ? AND ativo = TRUE';
const SQL_FORMA = `SELECT id FROM forma_recebimento WHERE ativo = TRUE AND uso IN ('recebimento','ambos')
  AND (codigo = ? OR meio = 'pix') ORDER BY (codigo = 'pix') DESC, padrao DESC, id LIMIT 1`;

/** O pagador do título (paciente, cliente financeiro ou fonte pagadora), com o documento só em dígitos. */
const SQL_PARCELA = `SELECT p.id, p.versao, p.saldo, p.situacao, p.valor_recebido, t.id AS titulo, t.numero,
        t.estabelecimento_id, COALESCE(pf.nome, cf.nome, pj.razao_social, fp.nome) AS pagador_nome,
        COALESCE(pf.cpf, cf.cpf, cf.cnpj, pj.cnpj) AS pagador_documento
   FROM parcela_receber p JOIN titulo_receber t ON t.id = p.titulo_receber_id
   LEFT JOIN paciente pac ON pac.id = t.paciente_id LEFT JOIN pessoa_fisica pf ON pf.id = pac.pessoa_fisica_id
   LEFT JOIN cliente_financeiro cf ON cf.id = t.cliente_financeiro_id
   LEFT JOIN fonte_pagadora fp ON fp.id = t.fonte_pagadora_id
   LEFT JOIN pessoa_juridica pj ON pj.id = fp.pessoa_juridica_id
  WHERE p.id = ? AND t.estabelecimento_id = ? AND p.excluido_em IS NULL AND t.excluido_em IS NULL`;

// ── Chave Pix da conta ─────────────────────────────────────────────────────────────────────────────────────────

export const esquemaChavePix = z.discriminatedUnion('acao', [
  z
    .object({
      acao: z.literal('incluir'),
      conta: id,
      tipo: z.enum(['cpf', 'cnpj', 'email', 'telefone', 'aleatoria']),
      chave: z.string().trim().min(1).max(100),
      padrao: z.boolean().default(true),
    })
    .strict(),
  z.object({ acao: z.literal('desativar'), chave: id }).strict(),
]);

const manterChavePix = definirOperacao<z.infer<typeof esquemaChavePix>, ResultadoOperacao>({
  nome: 'financeiro.manter_chave_pix_conta',
  tabelas: ['chave_pix_conta'],
  entrada: esquemaChavePix as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    if (e.acao === 'desativar') {
      const [c] = await tx.consultarParaAtualizar(
        `SELECT k.id, k.versao, k.conta_bancaria_id FROM chave_pix_conta k
           JOIN conta_bancaria b ON b.id = k.conta_bancaria_id
          WHERE k.id = ? AND b.estabelecimento_id = ? AND k.excluido_em IS NULL`,
        [e.chave, est],
        { teto: 1 },
      );
      if (!c) throw recusa('chave-inexistente', 'A chave Pix não existe neste estabelecimento.');
      await exigirContaMovimentavel(tx, est, usuario, numero(c['conta_bancaria_id']));
      await tx.alterar('chave_pix_conta', e.chave, numero(c['versao']), { ativa: false, padrao: false });
      return { chave: e.chave };
    }
    const conta = await tx.uma('SELECT id FROM conta_bancaria WHERE id = ? AND estabelecimento_id = ?', [
      e.conta,
      est,
    ]);
    if (!conta)
      throw recusa('conta-inexistente', 'A conta não existe neste estabelecimento.', { campos: ['conta'] });
    await exigirContaMovimentavel(tx, est, usuario, e.conta);
    const c = conferirChavePix(e.tipo, e.chave);
    if (!c.ok) throw recusa('chave-invalida', c.mensagem, { campos: ['chave'] });
    if (await tx.uma('SELECT id FROM chave_pix_conta WHERE tipo_chave = ? AND chave = ?', [c.tipo, c.chave]))
      throw recusa('chave-repetida', 'Esta chave Pix já está cadastrada.', { campos: ['chave'] });
    const outras = await tx.consultarParaAtualizar(
      'SELECT id, versao, sequencia, padrao FROM chave_pix_conta WHERE conta_bancaria_id = ? ORDER BY sequencia',
      [e.conta],
      { teto: 500 },
    );
    if (e.padrao)
      for (const o of outras.filter((x) => numero(x['padrao'])))
        await tx.alterar('chave_pix_conta', numero(o['id']), numero(o['versao']), { padrao: false });
    const chave = await tx.incluir('chave_pix_conta', {
      conta_bancaria_id: e.conta,
      sequencia: Math.max(0, ...outras.map((o) => numero(o['sequencia']))) + 1,
      tipo_chave: c.tipo,
      chave: c.chave,
      padrao: e.padrao || outras.length === 0,
      data_ativacao: hojeIso(),
      ativa: true,
    });
    return { chave, tipo: c.tipo };
  },
  alvo: (_e, r) => ({ tabela: 'chave_pix_conta', id: numero(r['chave']) || null }),
  eventos: (e, r) => [{ tipo: `financeiro.chave_pix.${e.acao}`, carga: { chave: numero(r['chave']) } }],
});

// ── Emissão e cancelamento ──────────────────────────────────────────────────────────────────────────────────────

export const esquemaEmitirCobrancaPix = z
  .object({
    parcela: id,
    chave: id,
    modalidade: z.enum(['imediata', 'com_vencimento']).default('imediata'),
    valor: z.number().positive().max(9_999_999_999).optional(),
    vencimento: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    validadeSegundos: z.number().int().optional(),
    descricao: z.string().trim().max(140).optional(),
  })
  .strict();

export const esquemaCancelarCobrancaPix = z
  .object({ cobranca: id, motivo: z.string().trim().min(3).max(300) })
  .strict();

export const esquemaRetornoPix = z.object({ notificacao: z.unknown() }).strict();

export const esquemaDevolverPix = z
  .object({
    retorno: id,
    valor: z.number().positive(),
    motivo: z.enum(Object.keys(MOTIVOS_DEVOLUCAO_PIX) as [MotivoDevolucaoPix, ...MotivoDevolucaoPix[]]),
  })
  .strict();

/** As operações da cobrança Pix, com o prestador do ambiente (simulador fora de produção). */
export function operacoesCobrancaPix(provedor: ProvedorPix) {
  const emitir = definirOperacao<z.infer<typeof esquemaEmitirCobrancaPix>, ResultadoOperacao>({
    nome: 'financeiro.emitir_cobranca_pix',
    tabelas: ['cobranca_pix'],
    entrada: esquemaEmitirCobrancaPix as never,
    async gravar(tx, e, ctx) {
      const est = estabelecimentoDe(ctx);
      const usuario = usuarioDe(ctx);
      const [p] = await tx.consultarParaAtualizar(SQL_PARCELA, [e.parcela, est], { teto: 1 });
      if (!p)
        throw recusa('parcela-inexistente', 'A parcela não existe neste estabelecimento.', {
          campos: ['parcela'],
        });
      const k = await tx.uma(
        `SELECT k.id, k.chave, k.ativa, k.conta_bancaria_id, s.nome_fantasia
           FROM chave_pix_conta k JOIN conta_bancaria b ON b.id = k.conta_bancaria_id
           JOIN estabelecimento s ON s.id = b.estabelecimento_id
          WHERE k.id = ? AND b.estabelecimento_id = ? AND k.excluido_em IS NULL`,
        [e.chave, est],
      );
      if (!k)
        throw recusa('chave-inexistente', 'A chave Pix não existe neste estabelecimento.', {
          campos: ['chave'],
        });
      const conta = numero(k['conta_bancaria_id']);
      await exigirContaMovimentavel(tx, est, usuario, conta);
      const ativa = await tx.uma(
        `SELECT id FROM cobranca_pix WHERE parcela_receber_id = ? AND situacao = 'ativa' AND excluido_em IS NULL
            AND (modalidade = 'com_vencimento'
                 OR criado_em + INTERVAL COALESCE(validade_segundos, ?) SECOND > NOW(3))`,
        [e.parcela, VALIDADE_PADRAO_SEGUNDOS],
      );
      const saldo = numero(p['saldo']);
      const valor = centavos(e.valor ?? saldo);
      const documento = p['pagador_documento'] ? texto(p['pagador_documento']).replace(/\D/g, '') : null;
      const conf = conferirCobrancaPix({
        modalidade: e.modalidade,
        valor,
        saldoParcela: saldo,
        situacaoParcela: texto(p['situacao']),
        hoje: hojeIso(),
        vencimento: e.vencimento ?? null,
        validadeSegundos: e.validadeSegundos ?? null,
        pagadorDocumento: documento,
        cobrancaAtivaNaParcela: !!ativa,
        chaveAtiva: !!numero(k['ativa']),
      });
      if (!conf.ok) throw recusa(conf.codigo, conf.mensagem, { campos: [conf.campo] });
      const txid = gerarTxid(randomBytes(32));
      const descricao = e.descricao || `Título ${texto(p['numero'])}`;
      const pagadorNome = p['pagador_nome'] ? texto(p['pagador_nome']).slice(0, 150) : null;
      const r = await provedor
        .criarCobranca({
          txid,
          modalidade: e.modalidade,
          chave: texto(k['chave']),
          valor,
          descricao,
          vencimento: e.vencimento ?? null,
          validadeSegundos:
            e.modalidade === 'imediata' ? (e.validadeSegundos ?? VALIDADE_PADRAO_SEGUNDOS) : null,
          pagadorNome,
          pagadorDocumento: documento,
          recebedorNome: texto(k['nome_fantasia']),
        })
        .catch((err: unknown) => {
          throw recusa(
            'prestador-pix',
            err instanceof Error ? err.message : 'O prestador Pix recusou a cobrança.',
          );
        });
      const cobranca = await tx.incluir('cobranca_pix', {
        estabelecimento_id: est,
        conta_bancaria_id: conta,
        chave_pix_conta_id: e.chave,
        modalidade: e.modalidade,
        txid,
        parcela_receber_id: e.parcela,
        modulo_origem: 'contas_a_receber',
        valor,
        descricao,
        pagador_nome: pagadorNome,
        pagador_documento: documento && documento.length <= 14 ? documento : null,
        data_vencimento: e.vencimento ?? null,
        validade_segundos:
          e.modalidade === 'imediata' ? (e.validadeSegundos ?? VALIDADE_PADRAO_SEGUNDOS) : null,
        localizacao_qr: r.localizacao?.slice(0, 500) ?? null,
        pix_copia_cola: r.copiaECola,
        revisao: r.revisao,
        situacao: 'ativa',
      });
      return { cobranca, txid, valor, copiaECola: r.copiaECola, simulado: r.simulado ?? provedor.simulado };
    },
    alvo: (_e, r) => ({ tabela: 'cobranca_pix', id: numero(r['cobranca']) || null }),
    eventos: (e, r) => [
      {
        tipo: 'financeiro.cobranca_pix.emitida',
        carga: { cobranca: numero(r['cobranca']), parcela: e.parcela, valor: numero(r['valor']) },
      },
    ],
  });

  const cancelar = definirOperacao<z.infer<typeof esquemaCancelarCobrancaPix>, ResultadoOperacao>({
    nome: 'financeiro.cancelar_cobranca_pix',
    tabelas: ['cobranca_pix'],
    entrada: esquemaCancelarCobrancaPix as never,
    async gravar(tx, e, ctx) {
      const est = estabelecimentoDe(ctx);
      const usuario = usuarioDe(ctx);
      const [c] = await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao, txid, modalidade, conta_bancaria_id, descricao FROM cobranca_pix
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [e.cobranca, est],
        { teto: 1 },
      );
      if (!c) throw recusa('cobranca-inexistente', 'A cobrança Pix não existe neste estabelecimento.');
      await exigirContaMovimentavel(tx, est, usuario, numero(c['conta_bancaria_id']));
      if (texto(c['situacao']) !== 'ativa')
        throw recusa(
          'cobranca-nao-ativa',
          `A cobrança está ${texto(c['situacao'])}: não pode ser cancelada.`,
        );
      await provedor
        .removerCobranca(texto(c['txid']), texto(c['modalidade']) as 'imediata' | 'com_vencimento')
        .catch((err: unknown) => {
          throw recusa(
            'prestador-pix',
            err instanceof Error ? err.message : 'O prestador Pix recusou o cancelamento.',
          );
        });
      await tx.alterar('cobranca_pix', e.cobranca, numero(c['versao']), {
        situacao: 'removida_usuario',
        descricao: `${texto(c['descricao'])} | Cancelada: ${e.motivo}`.slice(0, 300),
      });
      return { cobranca: e.cobranca };
    },
    alvo: (e) => ({ tabela: 'cobranca_pix', id: e.cobranca }),
    eventos: (e) => [{ tipo: 'financeiro.cobranca_pix.cancelada', carga: { cobranca: e.cobranca } }],
  });

  const devolver = definirOperacao<z.infer<typeof esquemaDevolverPix>, ResultadoOperacao>({
    nome: 'financeiro.devolver_pix',
    tabelas: [
      'devolucao_pix',
      'retorno_pix',
      'cobranca_pix',
      'recebimento',
      'movimento_bancario',
      'parcela_receber',
      'titulo_receber',
    ],
    entrada: esquemaDevolverPix as never,
    async gravar(tx, e, ctx) {
      const est = estabelecimentoDe(ctx);
      const usuario = usuarioDe(ctx);
      const [r] = await tx.consultarParaAtualizar(
        `SELECT r.id, r.versao, r.cobranca_pix_id, r.identificador_fim_a_fim, r.valor, r.pago_em, r.valor_devolvido,
                r.recebimento_id, r.movimento_bancario_id, c.versao AS cobranca_versao, c.conta_bancaria_id,
                c.identificador_fim_a_fim AS fim_a_fim_cobranca, c.parcela_receber_id, c.txid
           FROM retorno_pix r JOIN cobranca_pix c ON c.id = r.cobranca_pix_id
          WHERE r.id = ? AND c.estabelecimento_id = ? AND r.excluido_em IS NULL`,
        [e.retorno, est],
        { teto: 1 },
      );
      if (!r) throw recusa('retorno-inexistente', 'O Pix recebido não existe neste estabelecimento.');
      const conta = numero(r['conta_bancaria_id']);
      await exigirContaMovimentavel(tx, est, usuario, conta);
      const hoje = hojeIso();
      await exigirPeriodoAberto(tx, est, hoje, 'valor');
      const [rec] = r['recebimento_id']
        ? await tx.consultarParaAtualizar(
            `SELECT id, versao, valor_recebido, situacao, parcela_receber_id, data_recebimento, data_credito,
                    forma_recebimento_id, numero_documento, movimento_bancario_id
               FROM recebimento WHERE id = ?`,
            [r['recebimento_id']],
            { teto: 1 },
          )
        : [];
      const principalAtual =
        rec && texto(rec['situacao']) === 'efetivado' ? numero(rec['valor_recebido']) : 0;
      const plano = planejarDevolucaoPix({
        valorPago: numero(r['valor']),
        principalAtual,
        jaDevolvido: numero(r['valor_devolvido']),
        pedido: centavos(e.valor),
        pagoEm: instanteIso(r['pago_em']) ?? hoje,
        hoje,
      });
      if (!plano.ok) throw recusa(plano.codigo, plano.mensagem, { campos: [plano.campo] });
      const sequencia =
        numero(
          (
            await tx.uma('SELECT MAX(sequencia) AS s FROM devolucao_pix WHERE cobranca_pix_id = ?', [
              r['cobranca_pix_id'],
            ])
          )?.['s'],
        ) + 1;
      const idDevolucao = `D${texto(r['txid']).slice(0, 30)}${String(sequencia).padStart(3, '0')}`.slice(
        0,
        35,
      );
      const fimAFim = texto(r['identificador_fim_a_fim']);
      const resp = await provedor
        .devolver(fimAFim, idDevolucao, centavos(e.valor), MOTIVOS_DEVOLUCAO_PIX[e.motivo])
        .catch((err: unknown) => {
          throw recusa(
            'prestador-pix',
            err instanceof Error ? err.message : 'O prestador Pix recusou a devolução.',
          );
        });
      if (resp.situacao === 'nao_realizada')
        throw recusa(
          'devolucao-nao-realizada',
          `O prestador não realizou a devolução: ${resp.motivo ?? 'sem motivo'}.`,
        );
      const agora = new Date();
      const tipoDeb = await idDoCodigo(
        tx,
        SQL_TIPO_LANCAMENTO,
        LANCAMENTO_DEVOLUCAO_PIX,
        'Falta no cadastro o tipo de lançamento bancário da devolução Pix.',
      );
      const movimento = await tx.incluir('movimento_bancario', {
        estabelecimento_id: est,
        conta_bancaria_id: conta,
        tipo_lancamento_bancario_id: tipoDeb,
        natureza: 'debito',
        tipo_origem: 'estorno',
        data_movimento: hoje,
        numero_documento: idDevolucao.slice(0, 30),
        historico: `Devolução Pix (${MOTIVOS_DEVOLUCAO_PIX[e.motivo]}) do pagamento ${fimAFim}`.slice(0, 300),
        valor: centavos(e.valor),
      });
      const devolucao = await tx.incluir('devolucao_pix', {
        cobranca_pix_id: r['cobranca_pix_id'],
        sequencia,
        identificador_devolucao: idDevolucao,
        end_to_end_id: resp.fimAFimDevolucao,
        valor: centavos(e.valor),
        natureza: 'original',
        motivo_codigo: e.motivo,
        motivo_descricao: MOTIVOS_DEVOLUCAO_PIX[e.motivo],
        situacao: resp.situacao,
        solicitado_em: agora,
        liquidado_em: resp.situacao === 'devolvida' ? agora : null,
        solicitante_usuario_id: usuario,
      });
      let recebimentoNovo: number | null = null;
      if (plano.reverteBaixa > 0 && rec) {
        const parcela = numero(rec['parcela_receber_id']);
        const [p] = await tx.consultarParaAtualizar(
          `SELECT p.id, p.versao, p.saldo, p.situacao, p.valor_recebido, t.id AS titulo, t.versao AS titulo_versao,
                  t.valor_recebido AS titulo_recebido
             FROM parcela_receber p JOIN titulo_receber t ON t.id = p.titulo_receber_id WHERE p.id = ?`,
          [parcela],
          { teto: 1 },
        );
        if (!p || !['recebida', 'parcial'].includes(texto(p['situacao'])))
          throw recusa(
            'parcela-nao-reversivel',
            'A parcela mudou depois do Pix (renegociada ou cancelada): devolva só o excedente.',
            { campos: ['valor'] },
          );
        await tx.alterar('recebimento', numero(rec['id']), numero(rec['versao']), {
          situacao: 'estornado',
          estornado_em: agora,
          estorno_usuario_id: usuario,
          motivo_estorno: `Devolução Pix ${idDevolucao}: ${MOTIVOS_DEVOLUCAO_PIX[e.motivo]}`.slice(0, 500),
        });
        if (plano.principalRestante > 0) {
          const num = await tx.proximoNumero('recebimento');
          recebimentoNovo = await tx.incluir('recebimento', {
            estabelecimento_id: est,
            numero: num.formatado,
            parcela_receber_id: parcela,
            data_recebimento: dataIso(rec['data_recebimento']),
            data_credito: dataIso(rec['data_credito']),
            forma_recebimento_id: rec['forma_recebimento_id'],
            conta_bancaria_id: conta,
            numero_documento: rec['numero_documento'],
            valor_recebido: plano.principalRestante,
            meio_baixa: 'pix',
            movimento_bancario_id: rec['movimento_bancario_id'],
            observacao: `Baixa do Pix ${fimAFim} após a devolução ${idDevolucao}`.slice(0, 500),
          });
        }
        const recebidoParcela = centavos(numero(p['valor_recebido']) - plano.reverteBaixa);
        await tx.alterar('parcela_receber', parcela, numero(p['versao']), {
          valor_recebido: recebidoParcela,
          saldo: centavos(numero(p['saldo']) + plano.reverteBaixa),
          situacao: recebidoParcela > 0 ? 'parcial' : 'aberta',
          quitada_em: null,
        });
        const recebidoTitulo = centavos(numero(p['titulo_recebido']) - plano.reverteBaixa);
        await tx.alterar('titulo_receber', numero(p['titulo']), numero(p['titulo_versao']), {
          valor_recebido: recebidoTitulo,
          situacao: recebidoTitulo > 0 ? 'recebido_parcial' : 'aberto',
        });
      }
      await tx.alterar('retorno_pix', e.retorno, numero(r['versao']), {
        valor_devolvido: plano.devolvidoTotal,
        devolvido_em: agora,
        identificador_devolucao: idDevolucao,
        situacao: plano.total ? 'devolvido' : 'devolvido_parcial',
        ...(recebimentoNovo ? { recebimento_id: recebimentoNovo } : {}),
      });
      if (plano.total && texto(r['fim_a_fim_cobranca']) === fimAFim)
        await tx.alterar('cobranca_pix', numero(r['cobranca_pix_id']), numero(r['cobranca_versao']), {
          situacao: 'devolvida',
        });
      return {
        devolucao,
        retorno: e.retorno,
        valor: centavos(e.valor),
        doExcedente: plano.doExcedente,
        reverteBaixa: plano.reverteBaixa,
        situacao: resp.situacao,
        movimento,
        recebimentoNovo,
      };
    },
    alvo: (_e, r) => ({ tabela: 'devolucao_pix', id: numero(r['devolucao']) || null }),
    eventos: (e, r) => [
      {
        tipo: 'financeiro.pix.devolvido',
        carga: { retorno: e.retorno, valor: numero(r['valor']), reverteBaixa: numero(r['reverteBaixa']) },
      },
    ],
  });

  return {
    'financeiro.manterChavePix': manterChavePix,
    'financeiro.emitirCobrancaPix': emitir,
    'financeiro.cancelarCobrancaPix': cancelar,
    'financeiro.processarRetornoPix': processarRetornoPix,
    'financeiro.devolverPix': devolver,
  } as const;
}

// ── Retorno (notificação do prestador) ─────────────────────────────────────────────────────────────────────────

async function registrarPix(
  tx: TxOperacao,
  est: number,
  usuario: number,
  pix: PixRecebido,
  cache: { tipo: number; forma: number },
): Promise<{ situacao: string; principal: number; excedente: number; recebimento: number | null } | null> {
  const [c] = await tx.consultarParaAtualizar(
    `SELECT c.id, c.versao, c.situacao, c.identificador_fim_a_fim, c.parcela_receber_id, c.conta_bancaria_id,
            p.versao AS parcela_versao, p.saldo, p.situacao AS parcela_situacao, p.valor_recebido, p.titulo_receber_id,
            t.numero AS titulo_numero, t.natureza_financeira_id
       FROM cobranca_pix c LEFT JOIN parcela_receber p ON p.id = c.parcela_receber_id
       LEFT JOIN titulo_receber t ON t.id = p.titulo_receber_id
      WHERE c.txid = ? AND c.estabelecimento_id = ? AND c.excluido_em IS NULL`,
    [pix.txid, est],
    { teto: 1 },
  );
  if (!c) return null;
  const conta = numero(c['conta_bancaria_id']);
  await exigirContaMovimentavel(tx, est, usuario, conta);
  const plano = planejarBaixaPix({
    fimAFimJaRegistrado: !!(await tx.uma('SELECT id FROM retorno_pix WHERE identificador_fim_a_fim = ?', [
      pix.fimAFim,
    ])),
    situacaoCobranca: texto(c['situacao']),
    fimAFimDaCobranca: c['identificador_fim_a_fim'] ? texto(c['identificador_fim_a_fim']) : null,
    valorPago: pix.valor,
    saldoParcela: c['parcela_receber_id'] ? numero(c['saldo']) : 0,
    situacaoParcela: c['parcela_receber_id'] ? texto(c['parcela_situacao']) : 'sem_parcela',
  });
  if (plano.acao === 'repetido')
    return { situacao: 'repetido', principal: 0, excedente: 0, recebimento: null };
  const data = pix.pagoEm.slice(0, 10);
  await exigirPeriodoAberto(tx, est, data, 'notificacao');
  if (!cache.tipo) {
    cache.tipo = await idDoCodigo(
      tx,
      SQL_TIPO_LANCAMENTO,
      LANCAMENTO_RECEBIMENTO,
      'Falta no cadastro o tipo de lançamento bancário do recebimento.',
    );
    cache.forma = await idDoCodigo(
      tx,
      SQL_FORMA,
      FORMA_RECEBIMENTO_PIX,
      'Falta no cadastro a forma de recebimento Pix.',
    );
    await garantirSequencia(
      tx,
      { tipo: 'recebimento', estabelecimento: est, prefixo: 'RC-' },
      { usuario, agora: new Date() },
    );
  }
  const movimento = await tx.incluir('movimento_bancario', {
    estabelecimento_id: est,
    conta_bancaria_id: conta,
    tipo_lancamento_bancario_id: cache.tipo,
    natureza: 'credito',
    tipo_origem: 'baixa_titulo',
    data_movimento: data,
    numero_documento: pix.fimAFim.slice(0, 30),
    historico: `Pix recebido ${pix.fimAFim} da cobrança ${pix.txid}${
      c['titulo_numero'] ? ` (título ${texto(c['titulo_numero'])})` : ''
    }`.slice(0, 300),
    valor: pix.valor,
    natureza_financeira_id: c['natureza_financeira_id'] ?? null,
  });
  let recebimento: number | null = null;
  if (plano.principal > 0) {
    const parcela = numero(c['parcela_receber_id']);
    const num = await tx.proximoNumero('recebimento');
    recebimento = await tx.incluir('recebimento', {
      estabelecimento_id: est,
      numero: num.formatado,
      parcela_receber_id: parcela,
      data_recebimento: data,
      data_credito: data,
      forma_recebimento_id: cache.forma,
      conta_bancaria_id: conta,
      numero_documento: pix.fimAFim.slice(0, 30),
      valor_recebido: plano.principal,
      meio_baixa: 'pix',
      movimento_bancario_id: movimento,
      observacao: `Baixa automática do Pix da cobrança ${pix.txid}`.slice(0, 500),
    });
    await tx.alterar('parcela_receber', parcela, numero(c['parcela_versao']), {
      valor_recebido: centavos(numero(c['valor_recebido']) + plano.principal),
      saldo: plano.saldoRestante,
      situacao: plano.quitada ? 'recebida' : 'parcial',
      quitada_em: plano.quitada ? data : null,
    });
    const [t] = await tx.consultarParaAtualizar(
      `SELECT t.id, t.versao, t.valor_recebido,
              SUM(p.situacao IN ('aberta','parcial') AND p.excluido_em IS NULL) AS abertas
         FROM titulo_receber t JOIN parcela_receber p ON p.titulo_receber_id = t.id
        WHERE t.id = ? GROUP BY t.id, t.versao, t.valor_recebido`,
      [c['titulo_receber_id']],
      { teto: 1 },
    );
    if (t)
      await tx.alterar('titulo_receber', numero(t['id']), numero(t['versao']), {
        valor_recebido: centavos(numero(t['valor_recebido']) + plano.principal),
        situacao: numero(t['abertas']) > 0 ? 'recebido_parcial' : 'recebido',
      });
  }
  const seq = numero(
    (await tx.uma('SELECT MAX(sequencia) AS s FROM retorno_pix WHERE cobranca_pix_id = ?', [c['id']]))?.['s'],
  );
  await tx.incluir('retorno_pix', {
    cobranca_pix_id: c['id'],
    sequencia: seq + 1,
    identificador_fim_a_fim: pix.fimAFim,
    txid: pix.txid,
    pagador_nome: pix.pagadorNome,
    pagador_cpf: pix.pagadorCpf,
    pagador_cnpj: pix.pagadorCnpj,
    valor: pix.valor,
    pago_em: new Date(pix.pagoEm),
    situacao: plano.situacaoRetorno,
    baixa_automatica: plano.principal > 0,
    recebimento_id: recebimento,
    movimento_bancario_id: movimento,
    mensagem_erro: plano.aviso,
  });
  if (plano.concluiCobranca)
    await tx.alterar('cobranca_pix', numero(c['id']), numero(c['versao']), {
      situacao: 'concluida',
      identificador_fim_a_fim: pix.fimAFim,
      valor_pago: pix.valor,
      pago_em: new Date(pix.pagoEm),
      recebimento_id: recebimento,
    });
  return {
    situacao: plano.situacaoRetorno,
    principal: plano.principal,
    excedente: plano.excedente,
    recebimento,
  };
}

const processarRetornoPix = definirOperacao<z.infer<typeof esquemaRetornoPix>, ResultadoOperacao>({
  nome: 'financeiro.processar_retorno_pix',
  tabelas: [
    'retorno_pix',
    'cobranca_pix',
    'recebimento',
    'movimento_bancario',
    'parcela_receber',
    'titulo_receber',
  ],
  entrada: esquemaRetornoPix as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const lido = lerNotificacaoPix(e.notificacao);
    if (!lido.ok) throw recusa('notificacao-invalida', lido.mensagem, { campos: ['notificacao'] });
    const cache = { tipo: 0, forma: 0 };
    const r = {
      baixados: 0,
      paraDevolucao: 0,
      repetidos: 0,
      naoLocalizados: 0,
      totalBaixado: 0,
      totalExcedente: 0,
    };
    const recebimentos: number[] = [];
    for (const pix of lido.pix) {
      const x = await registrarPix(tx, est, usuario, pix, cache);
      if (!x) r.naoLocalizados += 1;
      else if (x.situacao === 'repetido') r.repetidos += 1;
      else {
        if (x.principal > 0) r.baixados += 1;
        if (x.excedente > 0) r.paraDevolucao += 1;
        r.totalBaixado = centavos(r.totalBaixado + x.principal);
        r.totalExcedente = centavos(r.totalExcedente + x.excedente);
        if (x.recebimento) recebimentos.push(x.recebimento);
      }
    }
    return { ...r, recebidos: lido.pix.length, recebimentos: recebimentos.join(',') };
  },
  alvo: () => ({ tabela: 'retorno_pix', id: null }),
  eventos: (_e, r) => [
    {
      tipo: 'financeiro.retorno_pix.processado',
      carga: { baixados: numero(r['baixados']), repetidos: numero(r['repetidos']) },
    },
  ],
});

// ── Leituras ───────────────────────────────────────────────────────────────────────────────────────────────────

/** As chaves Pix das contas do escopo. */
export async function chavesPix(l: Leitor, est: number, contas: readonly number[]) {
  if (!contas.length) return [];
  const marcas = contas.map(() => '?').join(',');
  const linhas = await l.consultar(
    `SELECT k.id, k.versao, k.conta_bancaria_id, b.descricao AS conta, k.tipo_chave, k.chave, k.padrao, k.ativa
       FROM chave_pix_conta k JOIN conta_bancaria b ON b.id = k.conta_bancaria_id
      WHERE b.estabelecimento_id = ? AND k.excluido_em IS NULL AND k.conta_bancaria_id IN (${marcas})
      ORDER BY k.ativa DESC, b.descricao, k.sequencia`,
    [est, ...contas],
    { teto: 500 },
  );
  return linhas.map((k) => ({
    id: numero(k['id']),
    versao: numero(k['versao']),
    conta: numero(k['conta_bancaria_id']),
    contaDescricao: texto(k['conta']),
    tipo: texto(k['tipo_chave']),
    chave: texto(k['chave']),
    padrao: !!numero(k['padrao']),
    ativa: !!numero(k['ativa']),
  }));
}

/** As parcelas em aberto que podem ganhar cobrança Pix (visão por pagador), com a cobrança ativa, se houver. */
export async function parcelasParaPix(l: Leitor, est: number, busca: string) {
  const termo = `%${busca.trim()}%`;
  const linhas = await l.consultar(
    `SELECT p.id, p.sequencia, p.vencimento, p.saldo, t.numero,
            COALESCE(pf.nome, cf.nome, pj.razao_social, fp.nome) AS pagador_nome,
            COALESCE(pf.cpf, cf.cpf, cf.cnpj, pj.cnpj) IS NOT NULL AS tem_documento,
            (SELECT MAX(c.id) FROM cobranca_pix c WHERE c.parcela_receber_id = p.id AND c.situacao = 'ativa'
                AND c.excluido_em IS NULL) AS cobranca_ativa
       FROM parcela_receber p JOIN titulo_receber t ON t.id = p.titulo_receber_id
       LEFT JOIN paciente pac ON pac.id = t.paciente_id LEFT JOIN pessoa_fisica pf ON pf.id = pac.pessoa_fisica_id
       LEFT JOIN cliente_financeiro cf ON cf.id = t.cliente_financeiro_id
       LEFT JOIN fonte_pagadora fp ON fp.id = t.fonte_pagadora_id
       LEFT JOIN pessoa_juridica pj ON pj.id = fp.pessoa_juridica_id
      WHERE t.estabelecimento_id = ? AND p.excluido_em IS NULL AND t.excluido_em IS NULL
        AND p.situacao IN ('aberta','parcial') AND p.saldo > 0
        AND (? = '%%' OR t.numero LIKE ? OR COALESCE(pf.nome, cf.nome, pj.razao_social, fp.nome) LIKE ?)
      ORDER BY pagador_nome, p.vencimento, p.id LIMIT 200`,
    [est, termo, termo, termo],
    { teto: 200 },
  );
  return linhas.map((p) => ({
    parcela: numero(p['id']),
    titulo: texto(p['numero']),
    sequencia: numero(p['sequencia']),
    vencimento: dataIso(p['vencimento']),
    saldo: numero(p['saldo']),
    pagador: texto(p['pagador_nome']),
    temDocumento: !!numero(p['tem_documento']),
    cobrancaAtiva: p['cobranca_ativa'] === null ? null : numero(p['cobranca_ativa']),
  }));
}

/** As cobranças Pix das contas do escopo, com o que foi pago, o excedente e o que já foi devolvido. */
export async function cobrancasPix(
  l: Leitor,
  est: number,
  contas: readonly number[],
  filtro: { situacao: string | null; busca: string },
) {
  if (!contas.length) return [];
  const marcas = contas.map(() => '?').join(',');
  const termo = `%${filtro.busca.trim()}%`;
  const linhas = await l.consultar(
    `SELECT c.id, c.txid, c.modalidade, c.valor, c.situacao, c.criado_em, c.validade_segundos, c.data_vencimento,
            c.pagador_nome, c.pix_copia_cola, c.valor_pago, c.pago_em, c.parcela_receber_id, t.numero AS titulo,
            c.modalidade = 'imediata' AND c.situacao = 'ativa'
              AND c.criado_em + INTERVAL COALESCE(c.validade_segundos, ?) SECOND <= NOW(3) AS expirou
       FROM cobranca_pix c LEFT JOIN parcela_receber p ON p.id = c.parcela_receber_id
       LEFT JOIN titulo_receber t ON t.id = p.titulo_receber_id
      WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL
        AND c.conta_bancaria_id IN (${marcas})
        AND (? IS NULL OR c.situacao = ?)
        AND (? = '%%' OR c.txid LIKE ? OR c.pagador_nome LIKE ? OR t.numero LIKE ?)
      ORDER BY c.id DESC LIMIT 200`,
    [VALIDADE_PADRAO_SEGUNDOS, est, ...contas, filtro.situacao, filtro.situacao, termo, termo, termo, termo],
    { teto: 200 },
  );
  const ids = linhas.map((c) => numero(c['id']));
  const marcasIds = ids.map(() => '?').join(',');
  const retornos = ids.length
    ? await l.consultar(
        `SELECT r.id, r.cobranca_pix_id, r.identificador_fim_a_fim, r.valor, r.pago_em, r.situacao, r.valor_devolvido,
                r.mensagem_erro, COALESCE(rc.valor_recebido, 0) AS baixado
           FROM retorno_pix r LEFT JOIN recebimento rc ON rc.id = r.recebimento_id AND rc.situacao = 'efetivado'
          WHERE r.cobranca_pix_id IN (${marcasIds}) AND r.excluido_em IS NULL ORDER BY r.id`,
        ids,
        { teto: 1000 },
      )
    : [];
  return linhas.map((c) => ({
    id: numero(c['id']),
    txid: texto(c['txid']),
    modalidade: texto(c['modalidade']),
    valor: numero(c['valor']),
    situacao: numero(c['expirou']) ? 'expirada' : texto(c['situacao']),
    criadaEm: instanteIso(c['criado_em']),
    vencimento: dataIso(c['data_vencimento']),
    pagador: c['pagador_nome'] ? texto(c['pagador_nome']) : null,
    titulo: c['titulo'] ? texto(c['titulo']) : null,
    parcela: c['parcela_receber_id'] === null ? null : numero(c['parcela_receber_id']),
    copiaECola: c['pix_copia_cola'] ? texto(c['pix_copia_cola']) : null,
    valorPago: c['valor_pago'] === null ? null : numero(c['valor_pago']),
    pagoEm: instanteIso(c['pago_em']),
    recebidos: retornos
      .filter((r) => numero(r['cobranca_pix_id']) === numero(c['id']))
      .map((r: Linha) => {
        const valor = numero(r['valor']);
        const devolvido = numero(r['valor_devolvido']);
        const baixado = numero(r['baixado']);
        return {
          retorno: numero(r['id']),
          fimAFim: texto(r['identificador_fim_a_fim']),
          valor,
          pagoEm: instanteIso(r['pago_em']),
          situacao: texto(r['situacao']),
          baixado,
          devolvido,
          podeDevolver: centavos(valor - devolvido),
          excedenteLivre: centavos(Math.max(0, valor - devolvido - baixado)),
          aviso: r['mensagem_erro'] ? texto(r['mensagem_erro']) : null,
        };
      }),
  }));
}

/** A notificação do simulador para pagar uma cobrança (fora de produção), no formato da API Pix. */
export async function notificacaoSimulada(l: Leitor, est: number, cobranca: number, valor: number | null) {
  const c = await l.uma(
    'SELECT txid, valor FROM cobranca_pix WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [cobranca, est],
  );
  if (!c) return null;
  const agora = new Date();
  const carimbo = agora.toISOString().replace(/\D/g, '').slice(0, 12);
  const sufixo = randomBytes(8).toString('hex').slice(0, 11);
  return {
    pix: [
      {
        endToEndId: `E00000000${carimbo}${sufixo}`,
        txid: texto(c['txid']),
        valor: (valor ?? numero(c['valor'])).toFixed(2),
        horario: agora.toISOString(),
        infoPagador: 'Pagamento simulado',
      },
    ],
  };
}
