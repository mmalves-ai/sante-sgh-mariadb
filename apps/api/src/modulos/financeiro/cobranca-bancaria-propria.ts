// F7, 07-FIN linha 78: cobrança bancária com boleto no banco próprio, pelo executor do @sgh/nucleo (trilha, outbox e
// idempotência na mesma transação). As regras são as do @sgh/dominio-financeiro (cobranca-boleto.ts); aqui ficam a
// leitura sob a trava e a gravação.
// - Carteira de cobrança: conta do escopo, faixa do nosso número e leiaute do banco (o leiaute de cobrança CNAB 240 do
//   banco da conta, quando não escolhido). Desativar guarda a linha.
// - Emissão: uma ou várias parcelas a receber de uma vez (visão por pagador); cada uma ganha o nosso número da faixa,
//   o código de barras e a linha digitável; a parcela guarda a carteira, o nosso número e o código de barras.
// - Cancelamento: o boleto ainda não enviado sai direto; o já registrado no banco fica cancelado e a próxima remessa
//   leva a instrução de baixa. Nada se apaga.
// - Remessa: os boletos emitidos ainda não enviados (instrução de registro) e os cancelados já registrados (instrução de
//   baixa), com a mensagem ao pagador; o arquivo é remontado pela regra a partir do que ficou gravado.
// - Retorno: o arquivo é lido inteiro antes de gravar (recusado inteiro se não fecha) e não entra duas vezes
//   (impressão digital). A entrada confirmada registra o boleto; a liquidação baixa a parcela e o título a receber
//   com o recebimento e o crédito na conta (data do crédito do banco); a rejeição volta com o motivo na remessa; a
//   liquidação repetida não baixa de novo; as tarifas viram um débito na conta com as parcelas no histórico.
import { createHash } from 'node:crypto';
import {
  type BoletoDoRetorno,
  campoLivrePadrao,
  conferirCarteira,
  conferirEmissao,
  descreverOcorrenciaCobranca,
  gerarRemessaCobranca240,
  type ItemRemessaCobranca,
  lerRetornoCobranca240,
  montarCodigoBoleto,
  montarRetornoCobranca240,
  planejarRetornoCobranca,
  proximoNossoNumero,
  retornoCobrancaRecusado,
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
import { dataIso, instanteIso, LANCAMENTO_RECEBIMENTO, numero, texto } from './vocabulario.js';

const id = z.number().int().positive();
const centavos = (v: number) => Math.round(v * 100) / 100;
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const hojeIso = () => new Date().toISOString().slice(0, 10);
const naLista = (ids: readonly unknown[]) => (ids.length ? ids.map(() => '?').join(',') : 'NULL');
type Linha = Record<string, unknown>;

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

/** A carteira com a conta, o banco e o beneficiário (estabelecimento). */
const SQL_CARTEIRA = `SELECT c.id, c.versao, c.descricao, c.conta_bancaria_id, c.codigo_carteira, c.codigo_beneficiario,
        c.convenio_cobranca, c.nosso_numero_inicial, c.nosso_numero_final, c.nosso_numero_atual,
        c.proxima_sequencia_remessa, c.dias_compensacao, c.valor_tarifa, c.local_pagamento, c.ativo,
        c.remessa_leiaute_bancario_id, c.retorno_leiaute_bancario_id, cb.numero_agencia, cb.numero_conta,
        cb.digito_conta, cb.descricao AS conta_nome, b.codigo_compensacao, e.cnpj, e.razao_social
   FROM carteira_cobranca c JOIN conta_bancaria cb ON cb.id = c.conta_bancaria_id
   LEFT JOIN banco b ON b.id = cb.banco_id JOIN estabelecimento e ON e.id = c.estabelecimento_id
  WHERE c.id = ? AND c.estabelecimento_id = ?`;

function bancoDa(c: Linha): number {
  const banco = numero(c['codigo_compensacao']);
  if (!banco)
    throw recusa('cadastro-incompleto', 'O banco da conta da carteira não tem o código de compensação.', {
      campos: ['carteira'],
    });
  return banco;
}

// ── Carteira ────────────────────────────────────────────────────────────────────────────────────────────────────

const dadosCarteira = {
  conta: id,
  descricao: z.string().trim().min(1).max(150),
  codigoCarteira: z.string().trim().min(1).max(10),
  variacaoCarteira: z.string().trim().max(10).nullable().default(null),
  codigoBeneficiario: z.string().trim().min(1).max(30),
  convenio: z.string().trim().max(20).nullable().default(null),
  nossoNumeroInicial: z.number().int().positive(),
  nossoNumeroFinal: z.number().int().positive(),
  diasCompensacao: z.number().int().min(0).max(30).default(1),
  valorTarifa: z.number().min(0).nullable().default(null),
  localPagamento: z.string().trim().max(200).nullable().default(null),
  leiaute: id.nullable().default(null),
};
export const esquemaCarteira = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('incluir'), ...dadosCarteira }).strict(),
  z.object({ acao: z.literal('desativar'), carteira: id }).strict(),
]);
type EntradaCarteira = z.infer<typeof esquemaCarteira>;

const manterCarteira = definirOperacao<EntradaCarteira, ResultadoOperacao>({
  nome: 'financeiro.manter_carteira_cobranca',
  tabelas: ['carteira_cobranca'],
  entrada: esquemaCarteira as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    if (e.acao === 'desativar') {
      const [c] = await tx.consultarParaAtualizar(
        'SELECT id, versao, ativo FROM carteira_cobranca WHERE id = ? AND estabelecimento_id = ?',
        [e.carteira, est],
        { teto: 1 },
      );
      if (!c) throw recusa('carteira-inexistente', 'A carteira não existe neste estabelecimento.');
      await tx.alterar('carteira_cobranca', e.carteira, numero(c['versao']), {
        ativo: false,
        vigencia_fim: hojeIso(),
      });
      return { carteira: e.carteira, ativo: false };
    }
    const r = conferirCarteira(e);
    if (r) throw recusa(r.codigo, r.mensagem, { campos: [...r.campos] });
    await exigirContaMovimentavel(tx, est, usuario, e.conta);
    const conta = await tx.uma(
      'SELECT id, banco_id FROM conta_bancaria WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.conta, est],
    );
    if (!conta)
      throw recusa('conta-inexistente', 'A conta não existe neste estabelecimento.', { campos: ['conta'] });
    const leiaute = e.leiaute
      ? await tx.uma(
          "SELECT id FROM leiaute_bancario WHERE id = ? AND servico = 'cobranca' AND ativo = TRUE",
          [e.leiaute],
        )
      : await tx.uma(
          `SELECT id FROM leiaute_bancario WHERE banco_id = ? AND servico = 'cobranca' AND padrao = 'cnab240'
              AND ativo = TRUE ORDER BY versao_leiaute DESC, id DESC LIMIT 1`,
          [conta['banco_id']],
        );
    if (!leiaute)
      throw recusa(
        'leiaute-ausente',
        'Falta no cadastro o leiaute de cobrança CNAB 240 do banco desta conta.',
        { campos: ['leiaute'] },
      );
    const repetida = await tx.uma(
      `SELECT id FROM carteira_cobranca WHERE conta_bancaria_id = ? AND codigo_carteira = ?
          AND COALESCE(variacao_carteira, '') = ? AND codigo_beneficiario = ?`,
      [e.conta, e.codigoCarteira, e.variacaoCarteira ?? '', e.codigoBeneficiario],
    );
    if (repetida)
      throw recusa('carteira-repetida', 'Esta carteira já está cadastrada para a conta.', {
        campos: ['codigoCarteira'],
      });
    const carteira = await tx.incluir('carteira_cobranca', {
      estabelecimento_id: est,
      conta_bancaria_id: e.conta,
      descricao: e.descricao,
      codigo_carteira: e.codigoCarteira,
      variacao_carteira: e.variacaoCarteira,
      codigo_beneficiario: e.codigoBeneficiario,
      convenio_cobranca: e.convenio,
      registrada: true,
      emissor: 'beneficiario',
      nosso_numero_inicial: e.nossoNumeroInicial,
      nosso_numero_final: e.nossoNumeroFinal,
      nosso_numero_atual: e.nossoNumeroInicial,
      dias_compensacao: e.diasCompensacao,
      valor_tarifa: e.valorTarifa,
      local_pagamento: e.localPagamento,
      remessa_leiaute_bancario_id: leiaute['id'],
      retorno_leiaute_bancario_id: leiaute['id'],
      vigencia_inicio: hojeIso(),
      ativo: true,
    });
    return { carteira, ativo: true };
  },
  alvo: (e, r) => ({
    tabela: 'carteira_cobranca',
    id: e.acao === 'desativar' ? e.carteira : numero(r['carteira']) || null,
  }),
  eventos: (_e, r) => [
    { tipo: 'financeiro.carteira_cobranca.mantida', carga: { carteira: numero(r['carteira']) } },
  ],
});

// ── Emissão e cancelamento do boleto ────────────────────────────────────────────────────────────────────────────

export const esquemaEmitirBoletos = z
  .object({
    carteira: id,
    parcelas: z.array(id).min(1).max(200),
    /** Pagador informado na hora, quando o cadastro não tem o documento (vale para todas as parcelas). */
    pagadorDocumento: z.string().trim().max(18).nullable().default(null),
    pagadorNome: z.string().trim().max(150).nullable().default(null),
  })
  .strict();

const emitirBoletos = definirOperacao<z.infer<typeof esquemaEmitirBoletos>, ResultadoOperacao>({
  nome: 'financeiro.emitir_boletos',
  tabelas: ['boleto', 'carteira_cobranca', 'parcela_receber'],
  entrada: esquemaEmitirBoletos as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const [c] = await tx.consultarParaAtualizar(SQL_CARTEIRA, [e.carteira, est], { teto: 1 });
    if (!c || !c['ativo'])
      throw recusa('carteira-inexistente', 'A carteira não existe ou está desativada.', {
        campos: ['carteira'],
      });
    await exigirContaMovimentavel(tx, est, usuario, numero(c['conta_bancaria_id']));
    const banco = bancoDa(c);
    const parcelas = await tx.consultarParaAtualizar(
      `SELECT p.id, p.versao, p.situacao, p.saldo, p.vencimento, p.sequencia, p.nosso_numero, p.carteira_cobranca_id,
              t.numero, t.situacao AS titulo_situacao, pac.pessoa_fisica_id, t.cliente_financeiro_id,
              fp.pessoa_juridica_id, COALESCE(pf.nome, cf.nome, pj.razao_social, fp.nome) AS pagador_nome,
              COALESCE(pf.cpf, cf.cpf, cf.cnpj, pj.cnpj) AS pagador_documento,
              (SELECT COUNT(*) FROM boleto b WHERE b.carteira_cobranca_id = p.carteira_cobranca_id
                  AND b.nosso_numero = p.nosso_numero AND b.situacao IN ('emitido','registrado')
                  AND b.excluido_em IS NULL) AS boletos_ativos
         FROM parcela_receber p JOIN titulo_receber t ON t.id = p.titulo_receber_id
         LEFT JOIN paciente pac ON pac.id = t.paciente_id LEFT JOIN pessoa_fisica pf ON pf.id = pac.pessoa_fisica_id
         LEFT JOIN cliente_financeiro cf ON cf.id = t.cliente_financeiro_id
         LEFT JOIN fonte_pagadora fp ON fp.id = t.fonte_pagadora_id
         LEFT JOIN pessoa_juridica pj ON pj.id = fp.pessoa_juridica_id
        WHERE p.id IN (${naLista(e.parcelas)}) AND t.estabelecimento_id = ? AND p.excluido_em IS NULL
        ORDER BY p.vencimento, p.id`,
      [...e.parcelas, est],
      { teto: 200 },
    );
    if (parcelas.length !== new Set(e.parcelas).size)
      throw recusa('parcela-inexistente', 'Alguma parcela não existe neste estabelecimento.', {
        campos: ['parcelas'],
      });
    const usados = await tx.uma('SELECT COUNT(*) AS n FROM boleto WHERE carteira_cobranca_id = ?', [
      e.carteira,
    ]);
    let atual =
      numero(usados?.['n']) > 0 ? numero(c['nosso_numero_atual']) : numero(c['nosso_numero_inicial']) - 1;
    const hoje = hojeIso();
    const emitidos: {
      boleto: number;
      parcela: number;
      nossoNumero: string;
      linhaDigitavel: string;
      valor: number;
    }[] = [];
    for (const p of parcelas) {
      const documento = (e.pagadorDocumento ?? texto(p['pagador_documento'])).replace(/\D/g, '');
      const nome = (e.pagadorNome ?? texto(p['pagador_nome'])).trim();
      const vencimento = dataIso(p['vencimento']) ?? '';
      const r = conferirEmissao(
        {
          parcela: numero(p['id']),
          situacao: texto(p['situacao']),
          tituloSituacao: texto(p['titulo_situacao']),
          saldo: numero(p['saldo']),
          vencimento,
          boletoAtivo: numero(p['boletos_ativos']) > 0,
          pagadorDocumento: documento,
          pagadorNome: nome,
        },
        hoje,
      );
      if (r) throw recusa(r.codigo, r.mensagem, { campos: [...r.campos] });
      const prox = proximoNossoNumero({
        codigoCarteira: texto(c['codigo_carteira']),
        atual,
        inicial: numero(c['nosso_numero_inicial']),
        final: numero(c['nosso_numero_final']),
      });
      if (!prox)
        throw recusa(
          'faixa-esgotada',
          'A faixa do nosso número da carteira acabou: peça nova faixa ao banco.',
          {
            campos: ['carteira'],
          },
        );
      atual = prox.sequencia;
      const valor = centavos(numero(p['saldo']));
      const codigo = montarCodigoBoleto({
        banco,
        vencimento,
        valor,
        campoLivre: campoLivrePadrao({
          agencia: texto(c['numero_agencia']),
          carteira: texto(c['codigo_carteira']),
          nossoNumero: prox.nossoNumero,
          conta: texto(c['numero_conta']),
        }),
      });
      const boleto = await tx.incluir('boleto', {
        estabelecimento_id: est,
        carteira_cobranca_id: e.carteira,
        nosso_numero: prox.nossoNumero,
        numero_documento: `${texto(p['numero'])}/${numero(p['sequencia'])}`.slice(0, 30),
        linha_digitavel: codigo.linhaDigitavel,
        codigo_barras: codigo.codigoBarras,
        pessoa_fisica_id: p['pessoa_fisica_id'] ?? null,
        pessoa_juridica_id: p['pessoa_juridica_id'] ?? null,
        cliente_financeiro_id: p['cliente_financeiro_id'] ?? null,
        pagador_nome: nome.slice(0, 150),
        pagador_documento: documento,
        data_emissao: hoje,
        data_vencimento: vencimento,
        valor,
        situacao: 'emitido',
      });
      await tx.alterar('parcela_receber', numero(p['id']), numero(p['versao']), {
        carteira_cobranca_id: e.carteira,
        nosso_numero: prox.nossoNumero,
        codigo_barras: codigo.codigoBarras,
      });
      emitidos.push({
        boleto,
        parcela: numero(p['id']),
        nossoNumero: prox.nossoNumero,
        linhaDigitavel: codigo.linhaDigitavel,
        valor,
      });
    }
    await tx.alterar('carteira_cobranca', e.carteira, numero(c['versao']), { nosso_numero_atual: atual });
    const parcelasValor = emitidos.map((x) => x.valor);
    return {
      carteira: e.carteira,
      boletos: emitidos,
      quantidade: emitidos.length,
      parcelasValor,
      total: centavos(parcelasValor.reduce((s, v) => s + v, 0)),
    };
  },
  alvo: (e) => ({ tabela: 'carteira_cobranca', id: e.carteira }),
  eventos: (e, r) => [
    {
      tipo: 'financeiro.boleto.emitido',
      carga: { carteira: e.carteira, quantidade: numero(r['quantidade']) },
    },
  ],
});

export const esquemaCancelarBoleto = z
  .object({ boleto: id, motivo: z.string().trim().min(5).max(500) })
  .strict();

const cancelarBoleto = definirOperacao<z.infer<typeof esquemaCancelarBoleto>, ResultadoOperacao>({
  nome: 'financeiro.cancelar_boleto',
  tabelas: ['boleto', 'parcela_receber'],
  entrada: esquemaCancelarBoleto as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const [b] = await tx.consultarParaAtualizar(
      `SELECT b.id, b.versao, b.situacao, b.remessa_cobranca_id, b.carteira_cobranca_id, b.nosso_numero,
              c.conta_bancaria_id
         FROM boleto b JOIN carteira_cobranca c ON c.id = b.carteira_cobranca_id
        WHERE b.id = ? AND b.estabelecimento_id = ? AND b.excluido_em IS NULL`,
      [e.boleto, est],
      { teto: 1 },
    );
    if (!b) throw recusa('boleto-inexistente', 'O boleto não existe neste estabelecimento.');
    await exigirContaMovimentavel(tx, est, usuario, numero(b['conta_bancaria_id']));
    const situacao = texto(b['situacao']);
    if (!['emitido', 'registrado', 'rejeitado'].includes(situacao))
      throw recusa('boleto-nao-cancelavel', `O boleto está ${situacao}: não pode ser cancelado.`);
    await tx.alterar('boleto', e.boleto, numero(b['versao']), {
      situacao: 'cancelado',
      data_cancelamento: hojeIso(),
      cancelado_por_usuario_id: usuario,
      motivo_cancelamento: e.motivo,
    });
    const p = await tx.uma(
      'SELECT id, versao FROM parcela_receber WHERE carteira_cobranca_id = ? AND nosso_numero = ?',
      [b['carteira_cobranca_id'], b['nosso_numero']],
    );
    if (p)
      await tx.alterar('parcela_receber', numero(p['id']), numero(p['versao']), {
        carteira_cobranca_id: null,
        nosso_numero: null,
        codigo_barras: null,
      });
    // O boleto que já foi ao banco precisa da instrução de baixa na próxima remessa.
    return { boleto: e.boleto, baixaNoBanco: b['remessa_cobranca_id'] !== null && situacao !== 'rejeitado' };
  },
  alvo: (e) => ({ tabela: 'boleto', id: e.boleto }),
  eventos: (e) => [{ tipo: 'financeiro.boleto.cancelado', carga: { boleto: e.boleto } }],
});

// ── Remessa ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** O que vai na próxima remessa: registro dos emitidos não enviados e baixa dos cancelados já registrados. */
async function pendentesDaRemessa(l: Leitor, carteira: number, mensagem: string | null) {
  const linhas = await l.consultar(
    `SELECT b.id, b.nosso_numero, b.numero_documento, b.data_vencimento, b.data_emissao, b.valor, b.pagador_nome,
            b.pagador_documento, b.situacao, p.id AS parcela, p.percentual_multa, p.percentual_juros_mes
       FROM boleto b LEFT JOIN parcela_receber p ON p.carteira_cobranca_id = b.carteira_cobranca_id
            AND p.nosso_numero = b.nosso_numero
      WHERE b.carteira_cobranca_id = ? AND b.excluido_em IS NULL
        AND ((b.situacao = 'emitido' AND b.remessa_cobranca_id IS NULL)
          OR (b.situacao = 'cancelado' AND b.remessa_cobranca_id IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM remessa_cobranca_item i WHERE i.boleto_id = b.id AND i.instrucao = 'baixa'
                  AND i.excluido_em IS NULL)
              AND NOT EXISTS (SELECT 1 FROM retorno_cobranca_item ri WHERE ri.boleto_id = b.id
                  AND ri.situacao = 'rejeitado' AND ri.codigo_ocorrencia = '03')))
      ORDER BY b.id`,
    [carteira],
    { teto: 2000 },
  );
  return linhas.map((b) => ({
    boleto: numero(b['id']),
    parcela: b['parcela'] === null ? null : numero(b['parcela']),
    item: {
      instrucao: texto(b['situacao']) === 'cancelado' ? 'baixa' : 'registro',
      nossoNumero: texto(b['nosso_numero']),
      numeroDocumento: texto(b['numero_documento']),
      vencimento: dataIso(b['data_vencimento']) ?? '',
      emissao: dataIso(b['data_emissao']) ?? '',
      valor: numero(b['valor']),
      pagadorDocumento: texto(b['pagador_documento']),
      pagadorNome: texto(b['pagador_nome']),
      percentualMulta: b['percentual_multa'] === null ? null : numero(b['percentual_multa']),
      percentualJurosMes: b['percentual_juros_mes'] === null ? null : numero(b['percentual_juros_mes']),
      mensagem,
    } satisfies ItemRemessaCobranca,
  }));
}

const beneficiario = (c: Linha) => ({
  banco: bancoDa(c),
  cnpj: texto(c['cnpj']),
  nome: texto(c['razao_social']),
  convenio: texto(c['convenio_cobranca']) || texto(c['codigo_beneficiario']),
  agencia: texto(c['numero_agencia']),
  conta: texto(c['numero_conta']),
  digitoConta: texto(c['digito_conta']),
  carteira: texto(c['codigo_carteira']),
});

export const esquemaGerarRemessaCobranca = z
  .object({ carteira: id, mensagem: z.string().trim().max(80).nullable().default(null) })
  .strict();

const gerarRemessa = definirOperacao<z.infer<typeof esquemaGerarRemessaCobranca>, ResultadoOperacao>({
  nome: 'financeiro.gerar_remessa_cobranca',
  tabelas: ['remessa_cobranca', 'remessa_cobranca_item', 'boleto', 'carteira_cobranca'],
  entrada: esquemaGerarRemessaCobranca as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const [c] = await tx.consultarParaAtualizar(SQL_CARTEIRA, [e.carteira, est], { teto: 1 });
    if (!c || !c['ativo'])
      throw recusa('carteira-inexistente', 'A carteira não existe ou está desativada.', {
        campos: ['carteira'],
      });
    await exigirContaMovimentavel(tx, est, usuario, numero(c['conta_bancaria_id']));
    if (!c['remessa_leiaute_bancario_id'])
      throw recusa('leiaute-ausente', 'A carteira não tem leiaute de remessa.', { campos: ['carteira'] });
    const pendentes = await pendentesDaRemessa(tx, e.carteira, e.mensagem);
    if (pendentes.length === 0)
      throw recusa('remessa-vazia', 'Não há boleto novo nem cancelamento para enviar ao banco.', {
        campos: ['carteira'],
      });
    const sequencia = numero(c['proxima_sequencia_remessa']) || 1;
    const agora = new Date();
    const arquivo = gerarRemessaCobranca240(
      beneficiario(c),
      sequencia,
      agora,
      pendentes.map((p) => p.item),
    );
    const remessa = await tx.incluir('remessa_cobranca', {
      estabelecimento_id: est,
      numero: `CB${e.carteira}-${String(sequencia).padStart(6, '0')}`,
      conta_bancaria_id: c['conta_bancaria_id'],
      carteira_cobranca_id: e.carteira,
      leiaute_bancario_id: c['remessa_leiaute_bancario_id'],
      formato: 'cnab240',
      sequencia_arquivo: sequencia,
      descricao: e.mensagem,
      gerado_em: agora,
      gerado_usuario_id: usuario,
      quantidade_titulos: pendentes.length,
      valor_total: arquivo.total,
      hash_arquivo: sha256(arquivo.conteudo),
      situacao: 'gerada',
    });
    for (const [i, p] of pendentes.entries()) {
      await tx.incluir('remessa_cobranca_item', {
        remessa_cobranca_id: remessa,
        sequencia: i + 1,
        boleto_id: p.boleto,
        parcela_receber_id: p.parcela,
        instrucao: p.item.instrucao,
        nosso_numero: p.item.nossoNumero,
        data_vencimento: p.item.vencimento,
        valor_titulo: p.item.valor,
        mensagem: p.item.mensagem,
      });
      if (p.item.instrucao === 'registro') {
        const b = await tx.uma('SELECT versao FROM boleto WHERE id = ?', [p.boleto]);
        await tx.alterar('boleto', p.boleto, numero(b?.['versao']), { remessa_cobranca_id: remessa });
      }
    }
    await tx.alterar('carteira_cobranca', e.carteira, numero(c['versao']), {
      proxima_sequencia_remessa: sequencia + 1,
    });
    return {
      remessa,
      sequencia,
      registros: pendentes.filter((p) => p.item.instrucao === 'registro').length,
      baixas: pendentes.filter((p) => p.item.instrucao === 'baixa').length,
      parcelasValor: arquivo.parcelas,
      total: arquivo.total,
      nomeArquivo: `cobranca-${e.carteira}-${sequencia}.rem`,
      conteudo: arquivo.conteudo,
    };
  },
  alvo: (_e, r) => ({ tabela: 'remessa_cobranca', id: numero(r['remessa']) || null }),
  eventos: (e, r) => [
    {
      tipo: 'financeiro.remessa_cobranca.gerada',
      carga: { carteira: e.carteira, remessa: numero(r['remessa']), total: numero(r['total']) },
    },
  ],
});

// ── Retorno ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const esquemaProcessarRetornoCobranca = z
  .object({
    carteira: id,
    nomeArquivo: z.string().trim().min(1).max(255),
    conteudo: z.string().min(1).max(4_000_000),
  })
  .strict();

async function tipoLancamento(l: Leitor, codigo: string, falta: string): Promise<number> {
  const t = await l.uma('SELECT id FROM tipo_lancamento_bancario WHERE codigo = ? AND ativo = TRUE', [
    codigo,
  ]);
  if (!t) throw recusa('cadastro-incompleto', falta);
  return numero(t['id']);
}

const processarRetorno = definirOperacao<z.infer<typeof esquemaProcessarRetornoCobranca>, ResultadoOperacao>({
  nome: 'financeiro.processar_retorno_cobranca',
  tabelas: [
    'retorno_cobranca',
    'retorno_cobranca_item',
    'remessa_cobranca_item',
    'boleto',
    'recebimento',
    'movimento_bancario',
    'parcela_receber',
    'titulo_receber',
  ],
  entrada: esquemaProcessarRetornoCobranca as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const [c] = await tx.consultarParaAtualizar(SQL_CARTEIRA, [e.carteira, est], { teto: 1 });
    if (!c)
      throw recusa('carteira-inexistente', 'A carteira não existe neste estabelecimento.', {
        campos: ['carteira'],
      });
    const conta = numero(c['conta_bancaria_id']);
    await exigirContaMovimentavel(tx, est, usuario, conta);
    const lido = lerRetornoCobranca240(e.conteudo, bancoDa(c));
    if (retornoCobrancaRecusado(lido)) throw recusa(lido.codigo, lido.mensagem, { campos: ['conteudo'] });
    const hash = sha256(e.conteudo);
    if (
      await tx.uma('SELECT id FROM retorno_cobranca WHERE estabelecimento_id = ? AND hash_arquivo = ?', [
        est,
        hash,
      ])
    )
      throw recusa(
        'retorno-ja-importado',
        'Este arquivo de retorno já foi processado: nada foi baixado de novo.',
        {
          campos: ['conteudo'],
        },
      );
    const nossos = [...new Set(lido.linhas.flatMap((l) => [l.nossoNumero, l.nossoNumero.padStart(12, '0')]))];
    const linhasBoleto = await tx.consultarParaAtualizar(
      `SELECT b.id, b.versao, b.nosso_numero, b.situacao, p.id AS parcela, p.versao AS parcela_versao, p.saldo,
              p.valor_recebido, p.valor_desconto, p.valor_juros, p.titulo_receber_id, t.natureza_financeira_id,
              t.numero AS titulo_numero
         FROM boleto b LEFT JOIN parcela_receber p ON p.carteira_cobranca_id = b.carteira_cobranca_id
              AND p.nosso_numero = b.nosso_numero
         LEFT JOIN titulo_receber t ON t.id = p.titulo_receber_id
        WHERE b.carteira_cobranca_id = ? AND b.excluido_em IS NULL AND b.nosso_numero IN (${naLista(nossos)})`,
      [e.carteira, ...nossos],
      { teto: 5000 },
    );
    const porNosso = new Map<string, BoletoDoRetorno>();
    const porBoleto = new Map<number, Linha>();
    for (const b of linhasBoleto) {
      porBoleto.set(numero(b['id']), b);
      porNosso.set(texto(b['nosso_numero']), {
        boleto: numero(b['id']),
        parcela: b['parcela'] === null ? null : numero(b['parcela']),
        situacao: texto(b['situacao']),
        saldoParcela: numero(b['saldo']),
      });
    }
    const plano = planejarRetornoCobranca(porNosso, lido, numero(c['dias_compensacao']));
    const itensRemessa = new Map<number, Linha>();
    if (porBoleto.size)
      for (const i of await tx.consultarParaAtualizar(
        `SELECT id, versao, boleto_id FROM remessa_cobranca_item WHERE boleto_id IN (${naLista([...porBoleto.keys()])})
            AND instrucao = 'registro' AND excluido_em IS NULL ORDER BY id`,
        [...porBoleto.keys()],
        { teto: 5000 },
      ))
        itensRemessa.set(numero(i['boleto_id']), i);
    const agora = new Date();
    const retorno = await tx.incluir('retorno_cobranca', {
      estabelecimento_id: est,
      conta_bancaria_id: conta,
      carteira_cobranca_id: e.carteira,
      leiaute_bancario_id: c['retorno_leiaute_bancario_id'] ?? c['remessa_leiaute_bancario_id'],
      nome_arquivo: e.nomeArquivo,
      hash_arquivo: hash,
      data_gravacao_banco: lido.dataGravacao || hojeIso(),
      sequencia_arquivo: lido.sequencial || null,
      tipo_processamento: 'manual',
      importado_em: agora,
      importado_usuario_id: usuario,
      processado_em: agora,
      quantidade_registros: plano.itens.length,
      quantidade_liquidados: plano.liquidados,
      quantidade_rejeitados: plano.rejeitados,
      valor_total: plano.totalLiquidado,
      valor_total_rejeitado: plano.totalRejeitado,
      valor_tarifas: plano.totalTarifas,
      situacao: plano.rejeitados + plano.naoLocalizados > 0 ? 'processado_com_erros' : 'processado',
    });
    let tipoReceb = 0;
    let forma = 0;
    const versaoBoleto = new Map<number, number>();
    const versaoParcela = new Map<number, number>();
    const titulos = new Map<number, number>();
    const recebimentos: number[] = [];
    for (const [i, item] of plano.itens.entries()) {
      const b = item.boleto ? porBoleto.get(item.boleto) : undefined;
      let movimento: number | null = null;
      let recebimento: number | null = null;
      if (item.baixa && b && item.parcela) {
        await exigirPeriodoAberto(tx, est, item.baixa.data, 'conteudo');
        if (!tipoReceb) {
          tipoReceb = await tipoLancamento(
            tx,
            LANCAMENTO_RECEBIMENTO,
            'Falta no cadastro o tipo de lançamento bancário do recebimento.',
          );
          const f = await tx.uma(
            `SELECT id FROM forma_recebimento WHERE ativo = TRUE AND uso IN ('recebimento','ambos')
              ORDER BY (meio = 'boleto') DESC, padrao DESC, id LIMIT 1`,
            [],
          );
          if (!f) throw recusa('cadastro-incompleto', 'Falta no cadastro uma forma de recebimento ativa.');
          forma = numero(f['id']);
          await garantirSequencia(
            tx,
            { tipo: 'recebimento', estabelecimento: est, prefixo: 'RC-' },
            { usuario, agora },
          );
        }
        const nosso = texto(b['nosso_numero']);
        if (item.baixa.recebido > 0)
          movimento = await tx.incluir('movimento_bancario', {
            estabelecimento_id: est,
            conta_bancaria_id: conta,
            tipo_lancamento_bancario_id: tipoReceb,
            natureza: 'credito',
            tipo_origem: 'baixa_titulo',
            data_movimento: item.baixa.dataCredito,
            numero_documento: nosso.slice(0, 30),
            historico:
              `Recebimento do boleto ${nosso} do título ${texto(b['titulo_numero'])} (retorno do banco)`.slice(
                0,
                300,
              ),
            valor: item.baixa.recebido,
            natureza_financeira_id: b['natureza_financeira_id'] ?? null,
          });
        const num = await tx.proximoNumero('recebimento');
        recebimento = await tx.incluir('recebimento', {
          estabelecimento_id: est,
          numero: num.formatado,
          parcela_receber_id: item.parcela,
          data_recebimento: item.baixa.data,
          data_credito: item.baixa.dataCredito,
          forma_recebimento_id: forma,
          conta_bancaria_id: conta,
          numero_documento: nosso.slice(0, 30),
          valor_recebido: item.baixa.recebido,
          valor_desconto: item.baixa.desconto,
          valor_juros: item.baixa.encargos,
          meio_baixa: 'retorno_bancario',
          movimento_bancario_id: movimento,
          observacao: `Baixa pelo retorno da cobrança: ${item.motivo}`.slice(0, 500),
        });
        recebimentos.push(recebimento);
        const quitada = item.baixa.saldoRestante === 0;
        const vp = versaoParcela.get(item.parcela) ?? numero(b['parcela_versao']);
        await tx.alterar('parcela_receber', item.parcela, vp, {
          valor_recebido: centavos(numero(b['valor_recebido']) + item.baixa.principal),
          valor_desconto: centavos(numero(b['valor_desconto']) + item.baixa.desconto),
          valor_juros: centavos(numero(b['valor_juros']) + item.baixa.encargos),
          saldo: item.baixa.saldoRestante,
          situacao: quitada ? 'recebida' : 'parcial',
          quitada_em: quitada ? item.baixa.data : null,
        });
        versaoParcela.set(item.parcela, vp + 1);
        const t = numero(b['titulo_receber_id']);
        titulos.set(t, centavos((titulos.get(t) ?? 0) + item.baixa.principal));
      }
      if (item.boleto && item.boletoNovo && b) {
        const vb = versaoBoleto.get(item.boleto) ?? numero(b['versao']);
        await tx.alterar('boleto', item.boleto, vb, {
          situacao: item.boletoNovo,
          ...(item.baixa ? { valor_pago: item.baixa.recebido, data_pagamento: item.baixa.data } : {}),
        });
        versaoBoleto.set(item.boleto, vb + 1);
      }
      const ir = item.boleto ? itensRemessa.get(item.boleto) : undefined;
      if (ir && item.situacao === 'rejeitado' && item.linha.codigo === '03') {
        await tx.alterar('remessa_cobranca_item', numero(ir['id']), numero(ir['versao']), {
          rejeitado: true,
          motivo_rejeicao: item.motivo.slice(0, 300),
        });
        ir['versao'] = numero(ir['versao']) + 1;
      }
      await tx.incluir('retorno_cobranca_item', {
        retorno_cobranca_id: retorno,
        sequencia: i + 1,
        boleto_id: item.boleto,
        parcela_receber_id: item.parcela,
        remessa_cobranca_item_id: ir ? ir['id'] : null,
        codigo_ocorrencia: item.linha.codigo,
        nosso_numero: item.linha.nossoNumero.slice(0, 30),
        data_vencimento: item.linha.vencimento,
        data_pagamento: item.baixa?.data ?? item.linha.dataOcorrencia,
        data_credito: item.baixa?.dataCredito ?? item.linha.dataCredito,
        valor_titulo: item.linha.valorTitulo,
        valor_pago: item.linha.valorPago,
        valor_juros: item.linha.encargos,
        valor_desconto: item.linha.desconto,
        valor_abatimento: item.linha.abatimento,
        valor_tarifa: item.linha.valorTarifa,
        situacao: item.situacao,
        motivo_rejeicao: item.situacao === 'rejeitado' ? item.motivo.slice(0, 500) : null,
        recebimento_id: recebimento,
        movimento_bancario_id: movimento,
      });
    }
    if (titulos.size) {
      const linhas = await tx.consultarParaAtualizar(
        `SELECT t.id, t.versao, t.valor_recebido,
                SUM(p.situacao IN ('aberta','parcial') AND p.excluido_em IS NULL) AS abertas
           FROM titulo_receber t JOIN parcela_receber p ON p.titulo_receber_id = t.id
          WHERE t.id IN (${naLista([...titulos.keys()])}) GROUP BY t.id, t.versao, t.valor_recebido`,
        [...titulos.keys()],
        { teto: 5000 },
      );
      for (const t of linhas)
        await tx.alterar('titulo_receber', numero(t['id']), numero(t['versao']), {
          valor_recebido: centavos(numero(t['valor_recebido']) + (titulos.get(numero(t['id'])) ?? 0)),
          situacao: numero(t['abertas']) > 0 ? 'recebido_parcial' : 'recebido',
        });
    }
    let movimentoTarifa: number | null = null;
    if (plano.totalTarifas > 0) {
      const tipo = await tipoLancamento(
        tx,
        'tarifa',
        'Falta no cadastro o tipo de lançamento bancário da tarifa.',
      );
      movimentoTarifa = await tx.incluir('movimento_bancario', {
        estabelecimento_id: est,
        conta_bancaria_id: conta,
        tipo_lancamento_bancario_id: tipo,
        natureza: 'debito',
        tipo_origem: 'tarifa',
        data_movimento: lido.dataGravacao || hojeIso(),
        numero_documento: `RET${retorno}`.slice(0, 30),
        historico:
          `Tarifas da cobrança, retorno ${e.nomeArquivo}: ${plano.parcelasTarifa.map((v) => v.toFixed(2)).join(' + ')}`.slice(
            0,
            300,
          ),
        valor: plano.totalTarifas,
      });
    }
    return {
      retorno,
      carteira: e.carteira,
      registros: plano.itens.length,
      liquidados: plano.liquidados,
      confirmados: plano.itens.filter((i) => i.situacao === 'entrada_confirmada').length,
      baixados: plano.itens.filter((i) => i.situacao === 'baixado').length,
      rejeitados: plano.rejeitados,
      naoLocalizados: plano.naoLocalizados,
      totalLiquidado: plano.totalLiquidado,
      parcelasLiquidadas: plano.parcelasLiquidadas,
      totalTarifas: plano.totalTarifas,
      parcelasTarifa: plano.parcelasTarifa,
      recebimentos,
      movimentoTarifa,
    };
  },
  alvo: (_e, r) => ({ tabela: 'retorno_cobranca', id: numero(r['retorno']) || null }),
  eventos: (e, r) => [
    {
      tipo: 'financeiro.retorno_cobranca.processado',
      carga: {
        carteira: e.carteira,
        retorno: numero(r['retorno']),
        liquidados: numero(r['liquidados']),
        rejeitados: numero(r['rejeitados']),
      },
    },
  ],
});

export const OPERACOES_COBRANCA_BANCARIA = {
  'financeiro.manterCarteiraCobranca': manterCarteira,
  'financeiro.emitirBoletos': emitirBoletos,
  'financeiro.cancelarBoleto': cancelarBoleto,
  'financeiro.gerarRemessaCobranca': gerarRemessa,
  'financeiro.processarRetornoCobranca': processarRetorno,
} as const;

// ── Leituras ───────────────────────────────────────────────────────────────────────────────────────────────────

/** As carteiras das contas do escopo, com o que aguarda a remessa. */
export async function carteirasCobranca(l: Leitor, est: number, contas: readonly number[]) {
  const linhas = await l.consultar(
    `SELECT c.id, c.descricao, c.codigo_carteira, c.codigo_beneficiario, c.conta_bancaria_id, c.ativo,
            c.nosso_numero_inicial, c.nosso_numero_final, c.nosso_numero_atual, c.dias_compensacao, c.valor_tarifa,
            cb.descricao AS conta_nome,
            (SELECT COUNT(*) FROM boleto b WHERE b.carteira_cobranca_id = c.id AND b.situacao = 'emitido'
                AND b.remessa_cobranca_id IS NULL AND b.excluido_em IS NULL) AS aguardando_remessa,
            (SELECT COUNT(*) FROM boleto b WHERE b.carteira_cobranca_id = c.id
                AND b.situacao IN ('emitido','registrado') AND b.excluido_em IS NULL) AS em_aberto
       FROM carteira_cobranca c JOIN conta_bancaria cb ON cb.id = c.conta_bancaria_id
      WHERE c.estabelecimento_id = ? AND c.conta_bancaria_id IN (${naLista(contas)})
      ORDER BY c.ativo DESC, c.descricao`,
    [est, ...contas],
    { teto: 200 },
  );
  return linhas.map((c) => ({
    id: numero(c['id']),
    descricao: texto(c['descricao']),
    carteira: texto(c['codigo_carteira']),
    beneficiario: texto(c['codigo_beneficiario']),
    conta: numero(c['conta_bancaria_id']),
    contaNome: texto(c['conta_nome']),
    ativo: Boolean(c['ativo']),
    faixa: `${numero(c['nosso_numero_inicial'])} a ${numero(c['nosso_numero_final'])}`,
    disponiveis: numero(c['nosso_numero_final']) - numero(c['nosso_numero_atual']),
    diasCompensacao: numero(c['dias_compensacao']),
    tarifa: c['valor_tarifa'] === null ? null : numero(c['valor_tarifa']),
    aguardandoRemessa: numero(c['aguardando_remessa']),
    emAberto: numero(c['em_aberto']),
  }));
}

/** Parcelas a receber em aberto que podem ganhar boleto, agrupáveis por pagador (busca por nome ou título). */
export async function parcelasParaBoleto(l: Leitor, est: number, busca: string) {
  const termo = `%${busca.trim()}%`;
  const linhas = await l.consultar(
    `SELECT p.id, p.sequencia, p.vencimento, p.saldo, t.numero, t.tipo_devedor,
            COALESCE(pf.nome, cf.nome, pj.razao_social, fp.nome) AS pagador_nome,
            COALESCE(pf.cpf, cf.cpf, cf.cnpj, pj.cnpj) IS NOT NULL AS tem_documento,
            p.nosso_numero IS NOT NULL AS tem_boleto
       FROM parcela_receber p JOIN titulo_receber t ON t.id = p.titulo_receber_id
       LEFT JOIN paciente pac ON pac.id = t.paciente_id LEFT JOIN pessoa_fisica pf ON pf.id = pac.pessoa_fisica_id
       LEFT JOIN cliente_financeiro cf ON cf.id = t.cliente_financeiro_id
       LEFT JOIN fonte_pagadora fp ON fp.id = t.fonte_pagadora_id
       LEFT JOIN pessoa_juridica pj ON pj.id = fp.pessoa_juridica_id
      WHERE t.estabelecimento_id = ? AND p.excluido_em IS NULL AND t.excluido_em IS NULL
        AND p.situacao IN ('aberta','parcial') AND p.saldo > 0 AND t.situacao IN ('aberto','recebido_parcial')
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
    devedor: texto(p['tipo_devedor']),
    pagador: texto(p['pagador_nome']),
    temDocumento: Boolean(numero(p['tem_documento'])),
    temBoleto: Boolean(numero(p['tem_boleto'])),
  }));
}

/** Os boletos das carteiras do escopo (filtro por carteira, situação e pagador ou nosso número). */
export async function boletosCobranca(
  l: Leitor,
  est: number,
  contas: readonly number[],
  f: { carteira: number | null; situacao: string | null; busca: string },
) {
  const termo = `%${f.busca.trim()}%`;
  const linhas = await l.consultar(
    `SELECT b.id, b.carteira_cobranca_id, b.nosso_numero, b.numero_documento, b.linha_digitavel, b.pagador_nome,
            b.data_emissao, b.data_vencimento, b.valor, b.valor_pago, b.data_pagamento, b.situacao,
            b.remessa_cobranca_id, b.motivo_cancelamento
       FROM boleto b JOIN carteira_cobranca c ON c.id = b.carteira_cobranca_id
      WHERE b.estabelecimento_id = ? AND b.excluido_em IS NULL AND c.conta_bancaria_id IN (${naLista(contas)})
        AND (? IS NULL OR b.carteira_cobranca_id = ?) AND (? IS NULL OR b.situacao = ?)
        AND (? = '%%' OR b.pagador_nome LIKE ? OR b.nosso_numero LIKE ? OR b.numero_documento LIKE ?)
      ORDER BY b.id DESC LIMIT 300`,
    [est, ...contas, f.carteira, f.carteira, f.situacao, f.situacao, termo, termo, termo, termo],
    { teto: 300 },
  );
  return linhas.map((b) => ({
    id: numero(b['id']),
    carteira: numero(b['carteira_cobranca_id']),
    nossoNumero: texto(b['nosso_numero']),
    documento: texto(b['numero_documento']),
    linhaDigitavel: texto(b['linha_digitavel']),
    pagador: texto(b['pagador_nome']),
    emissao: dataIso(b['data_emissao']),
    vencimento: dataIso(b['data_vencimento']),
    valor: numero(b['valor']),
    valorPago: b['valor_pago'] === null ? null : numero(b['valor_pago']),
    dataPagamento: dataIso(b['data_pagamento']),
    situacao: texto(b['situacao']),
    enviado: b['remessa_cobranca_id'] !== null,
    motivoCancelamento: texto(b['motivo_cancelamento']) || null,
  }));
}

/** O boleto para imprimir (e salvar em PDF): beneficiário, pagador, código, instruções e mensagens. */
export async function boletoParaImpressao(l: Leitor, est: number, contas: readonly number[], boleto: number) {
  const b = await l.uma(
    `SELECT b.*, c.descricao AS carteira_nome, c.codigo_carteira, c.codigo_beneficiario, c.local_pagamento,
            c.conta_bancaria_id, cb.numero_agencia, cb.numero_conta, cb.digito_conta, bc.codigo_compensacao,
            bc.descricao AS banco_nome, e.razao_social, e.cnpj, p.percentual_multa, p.percentual_juros_mes,
            (SELECT i.mensagem FROM remessa_cobranca_item i WHERE i.boleto_id = b.id ORDER BY i.id DESC LIMIT 1) AS mensagem
       FROM boleto b JOIN carteira_cobranca c ON c.id = b.carteira_cobranca_id
       JOIN conta_bancaria cb ON cb.id = c.conta_bancaria_id LEFT JOIN banco bc ON bc.id = cb.banco_id
       JOIN estabelecimento e ON e.id = b.estabelecimento_id
       LEFT JOIN parcela_receber p ON p.carteira_cobranca_id = b.carteira_cobranca_id AND p.nosso_numero = b.nosso_numero
      WHERE b.id = ? AND b.estabelecimento_id = ? AND b.excluido_em IS NULL`,
    [boleto, est],
  );
  if (!b || !contas.includes(numero(b['conta_bancaria_id']))) return null;
  const instrucoes: string[] = [];
  if (b['percentual_multa'] !== null && numero(b['percentual_multa']) > 0)
    instrucoes.push(`Após o vencimento, multa de ${numero(b['percentual_multa']).toFixed(2)}%.`);
  if (b['percentual_juros_mes'] !== null && numero(b['percentual_juros_mes']) > 0)
    instrucoes.push(`Juros de ${numero(b['percentual_juros_mes']).toFixed(2)}% ao mês.`);
  if (texto(b['mensagem'])) instrucoes.push(texto(b['mensagem']));
  return {
    id: numero(b['id']),
    banco: texto(b['codigo_compensacao']).padStart(3, '0'),
    bancoNome: texto(b['banco_nome']),
    beneficiario: texto(b['razao_social']),
    beneficiarioDocumento: texto(b['cnpj']),
    agenciaCodigo: `${texto(b['numero_agencia'])} / ${texto(b['codigo_beneficiario'])}`,
    carteira: texto(b['codigo_carteira']),
    localPagamento: texto(b['local_pagamento']) || 'Pagável em qualquer banco até o vencimento',
    nossoNumero: texto(b['nosso_numero']),
    documento: texto(b['numero_documento']),
    pagador: texto(b['pagador_nome']),
    pagadorDocumento: texto(b['pagador_documento']),
    emissao: dataIso(b['data_emissao']),
    vencimento: dataIso(b['data_vencimento']),
    valor: numero(b['valor']),
    linhaDigitavel: texto(b['linha_digitavel']),
    codigoBarras: texto(b['codigo_barras']),
    situacao: texto(b['situacao']),
    instrucoes,
  };
}

/** As remessas da carteira. */
export async function remessasCobranca(l: Leitor, est: number, carteira: number) {
  const linhas = await l.consultar(
    `SELECT r.id, r.numero, r.sequencia_arquivo, r.gerado_em, r.quantidade_titulos, r.valor_total, r.situacao,
            r.descricao, u.nome AS usuario,
            (SELECT COUNT(*) FROM remessa_cobranca_item i WHERE i.remessa_cobranca_id = r.id AND i.rejeitado = TRUE) AS rejeitados
       FROM remessa_cobranca r LEFT JOIN usuario u ON u.id = r.gerado_usuario_id
      WHERE r.estabelecimento_id = ? AND r.carteira_cobranca_id = ? AND r.excluido_em IS NULL
      ORDER BY r.id DESC LIMIT 100`,
    [est, carteira],
    { teto: 100 },
  );
  return linhas.map((r) => ({
    id: numero(r['id']),
    numero: texto(r['numero']),
    sequencial: numero(r['sequencia_arquivo']),
    geradaEm: instanteIso(r['gerado_em']),
    por: texto(r['usuario']),
    titulos: numero(r['quantidade_titulos']),
    valor: numero(r['valor_total']),
    situacao: texto(r['situacao']),
    mensagem: texto(r['descricao']) || null,
    rejeitados: numero(r['rejeitados']),
  }));
}

/** O arquivo da remessa, remontado pela regra a partir do que ficou gravado (e conferido pela impressão digital). */
export async function arquivoDaRemessaCobranca(l: Leitor, est: number, remessa: number) {
  const r = await l.uma(
    'SELECT id, carteira_cobranca_id, sequencia_arquivo, gerado_em, hash_arquivo FROM remessa_cobranca WHERE id = ? AND estabelecimento_id = ?',
    [remessa, est],
  );
  if (!r) return null;
  const c = await l.uma(SQL_CARTEIRA, [r['carteira_cobranca_id'], est]);
  if (!c) return null;
  const itens = await l.consultar(
    `SELECT i.instrucao, i.nosso_numero, i.data_vencimento, i.valor_titulo, i.mensagem, b.numero_documento,
            b.data_emissao, b.pagador_nome, b.pagador_documento, p.percentual_multa, p.percentual_juros_mes
       FROM remessa_cobranca_item i JOIN boleto b ON b.id = i.boleto_id
       LEFT JOIN parcela_receber p ON p.id = i.parcela_receber_id
      WHERE i.remessa_cobranca_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia`,
    [remessa],
    { teto: 5000 },
  );
  const arquivo = gerarRemessaCobranca240(
    beneficiario(c),
    numero(r['sequencia_arquivo']),
    r['gerado_em'] instanceof Date ? r['gerado_em'] : new Date(texto(r['gerado_em'])),
    itens.map((i) => ({
      instrucao: texto(i['instrucao']) === 'baixa' ? 'baixa' : 'registro',
      nossoNumero: texto(i['nosso_numero']),
      numeroDocumento: texto(i['numero_documento']),
      vencimento: dataIso(i['data_vencimento']) ?? '',
      emissao: dataIso(i['data_emissao']) ?? '',
      valor: numero(i['valor_titulo']),
      pagadorDocumento: texto(i['pagador_documento']),
      pagadorNome: texto(i['pagador_nome']),
      percentualMulta: i['percentual_multa'] === null ? null : numero(i['percentual_multa']),
      percentualJurosMes: i['percentual_juros_mes'] === null ? null : numero(i['percentual_juros_mes']),
      mensagem: texto(i['mensagem']) || null,
    })),
  );
  return {
    nomeArquivo: `cobranca-${numero(r['carteira_cobranca_id'])}-${numero(r['sequencia_arquivo'])}.rem`,
    conteudo: arquivo.conteudo,
    conferido: sha256(arquivo.conteudo) === texto(r['hash_arquivo']),
  };
}

/** Os retornos lidos da carteira, linha a linha (ocorrência, boleto, valores e o que foi feito). */
export async function retornosCobranca(l: Leitor, est: number, carteira: number) {
  const cab = await l.consultar(
    `SELECT r.id, r.nome_arquivo, r.importado_em, r.situacao, r.quantidade_registros, r.quantidade_liquidados,
            r.quantidade_rejeitados, r.valor_total, r.valor_tarifas, u.nome AS usuario
       FROM retorno_cobranca r LEFT JOIN usuario u ON u.id = r.importado_usuario_id
      WHERE r.estabelecimento_id = ? AND r.carteira_cobranca_id = ? ORDER BY r.id DESC LIMIT 30`,
    [est, carteira],
    { teto: 30 },
  );
  const ids = cab.map((c) => numero(c['id']));
  const itens = ids.length
    ? await l.consultar(
        `SELECT i.retorno_cobranca_id, i.sequencia, i.codigo_ocorrencia, i.nosso_numero, i.situacao, i.valor_titulo,
                i.valor_pago, i.valor_tarifa, i.data_pagamento, i.motivo_rejeicao, b.pagador_nome
           FROM retorno_cobranca_item i LEFT JOIN boleto b ON b.id = i.boleto_id
          WHERE i.retorno_cobranca_id IN (${naLista(ids)}) ORDER BY i.retorno_cobranca_id, i.sequencia`,
        ids,
        { teto: 10000 },
      )
    : [];
  return cab.map((c) => ({
    id: numero(c['id']),
    arquivo: texto(c['nome_arquivo']),
    importadoEm: instanteIso(c['importado_em']),
    por: texto(c['usuario']),
    situacao: texto(c['situacao']),
    registros: numero(c['quantidade_registros']),
    liquidados: numero(c['quantidade_liquidados']),
    rejeitados: numero(c['quantidade_rejeitados']),
    total: numero(c['valor_total']),
    tarifas: numero(c['valor_tarifas']),
    itens: itens
      .filter((i) => numero(i['retorno_cobranca_id']) === numero(c['id']))
      .map((i) => ({
        sequencia: numero(i['sequencia']),
        ocorrencia: texto(i['codigo_ocorrencia']),
        descricao: descreverOcorrenciaCobranca(texto(i['codigo_ocorrencia'])),
        nossoNumero: texto(i['nosso_numero']),
        pagador: texto(i['pagador_nome']),
        situacao: texto(i['situacao']),
        valorTitulo: i['valor_titulo'] === null ? null : numero(i['valor_titulo']),
        valorPago: numero(i['valor_pago']),
        tarifa: numero(i['valor_tarifa']),
        dataPagamento: dataIso(i['data_pagamento']),
        motivo: texto(i['motivo_rejeicao']) || null,
      })),
  }));
}

/** Simulador fora de produção: confirma a entrada e liquida cada boleto enviado e ainda não pago, com a tarifa. */
export async function retornoCobrancaSimulado(
  l: Leitor,
  est: number,
  carteira: number,
): Promise<string | null> {
  const c = await l.uma(SQL_CARTEIRA, [carteira, est]);
  if (!c) return null;
  const boletos = await l.consultar(
    `SELECT nosso_numero, valor, data_vencimento, situacao FROM boleto
      WHERE carteira_cobranca_id = ? AND remessa_cobranca_id IS NOT NULL AND situacao IN ('emitido','registrado')
        AND excluido_em IS NULL ORDER BY id`,
    [carteira],
    { teto: 2000 },
  );
  const hoje = hojeIso();
  const tarifa = c['valor_tarifa'] === null ? 0 : numero(c['valor_tarifa']);
  const itens = boletos.flatMap((b) => {
    const base = { nossoNumero: texto(b['nosso_numero']), valorTitulo: numero(b['valor']) };
    const venc = dataIso(b['data_vencimento']) ?? hoje;
    return [
      ...(texto(b['situacao']) === 'emitido' ? [{ ...base, codigo: '02', vencimento: venc }] : []),
      { ...base, codigo: '06', vencimento: venc, valorPago: base.valorTitulo, tarifa, dataOcorrencia: hoje },
    ];
  });
  const seq = await l.uma('SELECT COUNT(*) AS n FROM retorno_cobranca WHERE carteira_cobranca_id = ?', [
    carteira,
  ]);
  return montarRetornoCobranca240(bancoDa(c), numero(seq?.['n']) + 1, hoje, itens);
}
