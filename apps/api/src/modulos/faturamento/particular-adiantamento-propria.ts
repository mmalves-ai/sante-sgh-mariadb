// Adiantamento e caução do paciente, conta corrente dele (06-FAT linha 39) e modelo de orçamento padrão (06-FAT linha
// 40), sobre o banco do cliente. Leituras pelo Leitor e gravações pelo Executor (trilha, autoria e idempotência na
// mesma transação). As regras são do @sgh/dominio-faturamento (conta/adiantamento-paciente, conta/modelo-orcamento).
// Contrato de efeito (particular-adiantamento-propria.int.spec.ts):
// - adiantamento.receber: adiantamento_paciente (número AD-, tipo, saldo = valor, sessão do caixa aberta do operador,
//   forma, comprovante) e o movimento_caixa de entrada ligado a ele; o total da espécie na sessão do caixa somado.
// - adiantamento.aplicar: aplicacao_adiantamento_paciente por adiantamento usado na conta (do mais antigo ao mais
//   novo), o saldo e a situação de cada adiantamento refeitos. Nada de movimento de caixa (o dinheiro já entrou).
// - adiantamento.estornar: a aplicação fica marcada estornada (nunca apagada) e o valor volta ao saldo.
// - adiantamento.devolver: devolucao_adiantamento_paciente "devolvida" (sequência, favorecido, motivo); em dinheiro,
//   o movimento_caixa de saída na sessão aberta e o total em dinheiro dela abatido; saldo e situação refeitos.
// - modelo.cadastrar: modelo_orcamento e modelo_orcamento_item (o código é único; para mudar um modelo, cadastra-se
//   outro e inativa-se o antigo, e o orçamento já gerado continua apontando para o antigo).
// - modelo.inativar: ativo = falso (o orçamento já gerado continua apontando para ele).
// - modelo.gerarOrcamento: orcamento_particular (modelo_orcamento_id, acomodação, validade do modelo, bruto, total)
//   e os itens montados pelo domínio (preço do modelo ou da tabela particular vigente, honorário pela função).
import {
  type EntradaAdiantamento,
  extratoContaCorrente,
  FORMAS_ADIANTAMENTO,
  type LancamentoCorrente,
  montarOrcamentoDoModelo,
  planejarAplicacao,
  type SituacaoAdiantamento,
  situacaoPeloSaldo,
  TIPOS_ADIANTAMENTO,
  TIPOS_ITEM_MODELO,
  validarAdiantamento,
  validarDevolucao,
  validarModelo,
} from '@sgh/dominio-faturamento';
import {
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { precoVigente, tabelasDePreco } from './preco-conta.js';

type Linha = Record<string, unknown>;
type Consulta = Pick<Leitor, 'consultar' | 'uma'>;

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const r2 = (x: number) => Math.round(x * 100) / 100;
const somarDias = (data: string, dias: number) =>
  new Date(Date.parse(`${data}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
const hoje = () => new Date().toISOString().slice(0, 10);

/** Tipos de movimento de caixa usados aqui (cadastro da instituição; a ausência é recusada com a orientação). */
export const TIPO_MOVIMENTO_ADIANTAMENTO = 'adiantamento_paciente';
export const TIPO_MOVIMENTO_DEVOLUCAO = 'devolucao_adiantamento';
const TOTAL_DA_ESPECIE: Readonly<Record<string, string>> = {
  dinheiro: 'total_dinheiro',
  cartao_debito: 'total_cartao_debito',
  cartao_credito: 'total_cartao_credito',
  pix: 'total_pix',
  cheque: 'total_cheque',
};

function exigirValido(erros: Record<string, string>) {
  const campos = Object.keys(erros);
  if (campos.length) throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos, erros });
}
function estDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.', { campos: [] });
  return ctx.estabelecimento;
}
function usuarioDe(ctx: ContextoOperacao): number {
  if (ctx.usuario === null)
    throw recusa('sem-usuario', 'A operação exige o usuário da sessão.', { campos: [] });
  return ctx.usuario;
}
async function numeroDe(tx: TxOperacao, ctx: ContextoOperacao, tipo: string, prefixo: string) {
  await garantirSequencia(
    tx,
    { tipo, estabelecimento: estDe(ctx), prefixo },
    { usuario: ctx.usuario, agora: new Date() },
  );
  return tx.proximoNumero(tipo);
}
async function sessaoAberta(tx: TxOperacao, est: number, operador: number): Promise<Linha> {
  const [s] = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao, caixa_id, total_dinheiro, total_cartao_debito, total_cartao_credito, total_pix, total_cheque,
            total_outras_formas, fundo_troco, total_suprimento, total_sangria
       FROM sessao_caixa WHERE estabelecimento_id = ? AND operador_usuario_id = ?
        AND situacao IN ('aberta','reaberta') AND excluido_em IS NULL ORDER BY id DESC LIMIT 1`,
    [est, operador],
    { teto: 1 },
  );
  if (!s)
    throw recusa('caixa-fechado', 'Abra o seu caixa antes de receber ou devolver em dinheiro.', {
      campos: [],
    });
  return s;
}
async function tipoMovimento(tx: TxOperacao, codigo: string, sentido: string): Promise<number> {
  const t = await tx.uma<Linha>('SELECT id FROM tipo_movimento_caixa WHERE codigo = ? AND ativo = TRUE', [
    codigo,
  ]);
  if (!t)
    throw recusa(
      'tipo-movimento-inexistente',
      `Cadastre o tipo de movimento de caixa "${codigo}" (${sentido}) antes de continuar.`,
      { campos: [] },
    );
  return n(t['id']);
}
async function formaDe(tx: TxOperacao, meio: string, usos: readonly string[]): Promise<number> {
  const f = await tx.uma<Linha>(
    `SELECT id FROM forma_recebimento WHERE meio = ? AND ativo = TRUE AND uso IN (${usos.map(() => '?').join(', ')})
      ORDER BY padrao DESC, id`,
    [meio, ...usos],
  );
  if (!f)
    throw recusa('forma-recebimento-inexistente', `Cadastre uma forma ativa para "${meio}".`, {
      campos: ['forma'],
    });
  return n(f['id']);
}
async function paciente(tx: Consulta, id: number): Promise<{ id: number; nome: string }> {
  const p = await tx.uma<Linha>(
    `SELECT pa.id, COALESCE(NULLIF(pa.nome_social, ''), pf.nome) AS nome
       FROM paciente pa JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id WHERE pa.id = ? AND pa.excluido_em IS NULL`,
    [id],
  );
  if (!p) throw recusa('paciente-inexistente', 'O paciente não existe.', { campos: ['pacienteId'] });
  return { id: n(p['id']), nome: txt(p['nome']) };
}
/** O que a conta ainda deve: total − recebido no caixa − adiantamento aplicado (não estornado). */
async function devidoNaConta(tx: Consulta, conta: number): Promise<number> {
  const c = await tx.uma<Linha>(
    `SELECT ch.valor_total,
            (SELECT COALESCE(SUM(m.valor), 0) FROM movimento_caixa m WHERE m.conta_hospitalar_id = ch.id
               AND m.natureza = 'entrada' AND m.situacao = 'ativo' AND m.excluido_em IS NULL) AS pago,
            (SELECT COALESCE(SUM(a.valor), 0) FROM aplicacao_adiantamento_paciente a WHERE a.conta_hospitalar_id = ch.id
               AND a.estornado = FALSE AND a.excluido_em IS NULL) AS aplicado
       FROM conta_hospitalar ch WHERE ch.id = ?`,
    [conta],
  );
  return c ? r2(n(c['valor_total']) - n(c['pago']) - n(c['aplicado'])) : 0;
}
async function refazerSaldo(tx: TxOperacao, id: number, delta: number, devolvido = false) {
  const [a] = await tx.consultarParaAtualizar<Linha>(
    'SELECT id, versao, valor, saldo, situacao FROM adiantamento_paciente WHERE id = ?',
    [id],
    { teto: 1 },
  );
  const saldo = r2(n(a!['saldo']) + delta);
  const jaDevolvido = devolvido || txt(a!['situacao']) === 'devolvido';
  await tx.alterar('adiantamento_paciente', id, n(a!['versao']), {
    saldo,
    situacao: situacaoPeloSaldo(n(a!['valor']), saldo, jaDevolvido),
  });
  return saldo;
}

const id = z.coerce.number().int().positive();
const forma = z.enum(FORMAS_ADIANTAMENTO);

// ── Linha 39: adiantamento e caução ─────────────────────────────────────────────────────────────

export const esquemaReceberAdiantamento = z.object({
  pacienteId: id,
  atendimentoId: id.nullable().default(null),
  tipo: z.enum(TIPOS_ADIANTAMENTO),
  valor: z.coerce.number(),
  forma,
  parcelas: z.coerce.number().int().default(1),
  comprovante: z.string().trim().max(60).nullable().default(null),
  atendimentoUrgencia: z.boolean().default(false),
  declaracaoVoluntaria: z.boolean().default(false),
  pagadorNome: z.string().trim().max(150).nullable().default(null),
  pagadorCpf: z.string().trim().nullable().default(null),
  observacao: z.string().trim().max(2000).nullable().default(null),
  /** Posto pela rota: fora de produção, o conector de Pix e cartão é o simulado. */
  conectorEletronico: z.boolean().default(false),
});

export const opReceberAdiantamento = definirOperacao({
  nome: 'faturamento.adiantamento-paciente.receber',
  tabelas: ['adiantamento_paciente', 'movimento_caixa', 'sessao_caixa', 'sequencia_negocio'],
  entrada: esquemaReceberAdiantamento,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const operador = usuarioDe(ctx);
    const pac = await paciente(tx, e.pacienteId);
    const pacienteEhPagador = !e.pagadorNome;
    const entrada: EntradaAdiantamento = { ...e, pacienteEhPagador };
    exigirValido(validarAdiantamento(entrada));
    const sessao = await sessaoAberta(tx, est, operador);
    const tipoMov = await tipoMovimento(tx, TIPO_MOVIMENTO_ADIANTAMENTO, 'entrada');
    const formaId = await formaDe(tx, e.forma, ['recebimento', 'ambos']);
    const eletronico = e.forma === 'pix' || e.forma.startsWith('cartao');
    const comprovante = e.comprovante ?? (eletronico ? 'simulado' : null);
    const numero = await numeroDe(tx, ctx, 'adiantamento_paciente', 'AD-');
    const agora = new Date();
    const ad = await tx.incluir('adiantamento_paciente', {
      estabelecimento_id: est,
      numero: numero.formatado,
      tipo: e.tipo,
      paciente_id: pac.id,
      atendimento_id: e.atendimentoId,
      pagador_nome: e.pagadorNome,
      pagador_cpf: e.pagadorCpf,
      recebido_em: agora,
      valor: e.valor,
      saldo: e.valor,
      forma_recebimento_id: formaId,
      sessao_caixa_id: n(sessao['id']),
      quantidade_parcelas: e.parcelas,
      identificador_transacao: comprovante,
      atendimento_urgencia: e.atendimentoUrgencia,
      declaracao_voluntaria: e.declaracaoVoluntaria,
      situacao: 'ativo',
      observacao: e.observacao,
    });
    const mov = await tx.incluir('movimento_caixa', {
      estabelecimento_id: est,
      sessao_caixa_id: n(sessao['id']),
      tipo_movimento_caixa_id: tipoMov,
      natureza: 'entrada',
      ocorrido_em: agora,
      especie: e.forma,
      forma_recebimento_id: formaId,
      valor: e.valor,
      descricao: `${e.tipo === 'caucao' ? 'Caução' : 'Adiantamento'} ${numero.formatado}`,
      numero_documento: comprovante,
      adiantamento_paciente_id: ad,
      responsavel_nome: (e.pagadorNome ?? pac.nome).slice(0, 150) || null,
    });
    const coluna = TOTAL_DA_ESPECIE[e.forma] ?? 'total_outras_formas';
    await tx.alterar('sessao_caixa', n(sessao['id']), n(sessao['versao']), {
      [coluna]: r2(n(sessao[coluna]) + e.valor),
    });
    return { id: ad, numero: numero.formatado, movimento: mov, saldo: e.valor };
  },
  alvo: (_e, r) => ({ tabela: 'adiantamento_paciente', id: r.id }),
});

export const esquemaAplicarAdiantamento = z.object({
  contaId: id,
  valor: z.coerce.number().nullable().default(null),
  adiantamentos: z.array(id).max(200).nullable().default(null),
});

export const opAplicarAdiantamento = definirOperacao({
  nome: 'faturamento.adiantamento-paciente.aplicar',
  tabelas: ['aplicacao_adiantamento_paciente', 'adiantamento_paciente'],
  entrada: esquemaAplicarAdiantamento,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const usuario = usuarioDe(ctx);
    const [conta] = await tx.consultarParaAtualizar<Linha>(
      'SELECT id, paciente_id, situacao FROM conta_hospitalar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.contaId, est],
      { teto: 1 },
    );
    if (!conta || nn(conta['paciente_id']) === null)
      throw recusa('conta-inexistente', 'A conta não existe neste estabelecimento.', { campos: ['contaId'] });
    if (['cancelada', 'faturada'].includes(txt(conta['situacao'])))
      throw recusa(
        'conta-fechada',
        'A conta está cancelada ou faturada: o adiantamento não entra mais nela.',
        {
          campos: ['contaId'],
        },
      );
    const saldos = await tx.consultarParaAtualizar<Linha>(
      `SELECT a.id, a.saldo, a.recebido_em, a.situacao,
              (SELECT COUNT(*) FROM aplicacao_adiantamento_paciente x WHERE x.adiantamento_paciente_id = a.id
                 AND x.conta_hospitalar_id = ?) AS na_conta
         FROM adiantamento_paciente a
        WHERE a.paciente_id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.saldo > 0
          AND a.situacao IN ('ativo','aplicado_parcial')`,
      [e.contaId, conta['paciente_id'], est],
      { teto: 500 },
    );
    const plano = planejarAplicacao(
      saldos.map((s) => ({
        id: n(s['id']),
        saldo: n(s['saldo']),
        recebidoEm: new Date(s['recebido_em'] as Date).toISOString(),
        situacao: txt(s['situacao']) as SituacaoAdiantamento,
        jaNaConta: n(s['na_conta']) > 0,
      })),
      await devidoNaConta(tx, e.contaId),
      e.valor,
      e.adiantamentos,
    );
    exigirValido(plano.erros);
    const agora = new Date();
    const aplicacoes: number[] = [];
    for (const p of plano.parcelas) {
      const ja = await tx.uma<Linha>(
        'SELECT id, versao, valor, estornado FROM aplicacao_adiantamento_paciente WHERE adiantamento_paciente_id = ? AND conta_hospitalar_id = ?',
        [p.adiantamento, e.contaId],
      );
      if (ja) {
        // Uma linha por adiantamento e conta: a nova aplicação soma (ou reativa a estornada); a trilha guarda o antes.
        const valor = r2((n(ja['estornado']) ? 0 : n(ja['valor'])) + p.valor);
        await tx.alterar('aplicacao_adiantamento_paciente', n(ja['id']), n(ja['versao']), {
          valor,
          estornado: false,
          estornado_em: null,
          aplicado_em: agora,
          aplicador_usuario_id: usuario,
        });
        aplicacoes.push(n(ja['id']));
      } else
        aplicacoes.push(
          await tx.incluir('aplicacao_adiantamento_paciente', {
            adiantamento_paciente_id: p.adiantamento,
            conta_hospitalar_id: e.contaId,
            aplicado_em: agora,
            valor: p.valor,
            aplicador_usuario_id: usuario,
          }),
        );
      await refazerSaldo(tx, p.adiantamento, -p.valor);
    }
    return { id: aplicacoes[0]!, aplicacoes, total: plano.total, parcelas: plano.parcelas };
  },
  alvo: (_e, r) => ({ tabela: 'aplicacao_adiantamento_paciente', id: r.id }),
});

export const esquemaEstornarAplicacao = z.object({
  aplicacaoId: id,
  motivo: z.string().trim().min(1).max(500),
});

export const opEstornarAplicacao = definirOperacao({
  nome: 'faturamento.adiantamento-paciente.estornar-aplicacao',
  tabelas: ['aplicacao_adiantamento_paciente', 'adiantamento_paciente'],
  entrada: esquemaEstornarAplicacao,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const [a] = await tx.consultarParaAtualizar<Linha>(
      `SELECT x.id, x.versao, x.valor, x.estornado, x.adiantamento_paciente_id
         FROM aplicacao_adiantamento_paciente x JOIN adiantamento_paciente a ON a.id = x.adiantamento_paciente_id
        WHERE x.id = ? AND a.estabelecimento_id = ? AND x.excluido_em IS NULL`,
      [e.aplicacaoId, est],
      { teto: 1 },
    );
    if (!a) throw recusa('aplicacao-inexistente', 'A aplicação não existe.', { campos: ['aplicacaoId'] });
    if (n(a['estornado']))
      throw recusa('aplicacao-estornada', 'A aplicação já foi estornada.', { campos: [] });
    await tx.alterar('aplicacao_adiantamento_paciente', e.aplicacaoId, n(a['versao']), {
      estornado: true,
      estornado_em: new Date(),
    });
    const saldo = await refazerSaldo(tx, n(a['adiantamento_paciente_id']), n(a['valor']));
    return { id: e.aplicacaoId, saldo };
  },
  alvo: (_e, r) => ({ tabela: 'aplicacao_adiantamento_paciente', id: r.id }),
  trilha: (e) => ({ motivo: e.motivo }),
});

export const esquemaDevolverAdiantamento = z.object({
  adiantamentoId: id,
  valor: z.coerce.number(),
  forma,
  favorecidoNome: z.string().trim().max(150),
  favorecidoCpf: z.string().trim().nullable().default(null),
  chavePix: z.string().trim().max(77).nullable().default(null),
  comprovante: z.string().trim().max(60).nullable().default(null),
  motivo: z.string().trim().max(500),
});

export const opDevolverAdiantamento = definirOperacao({
  nome: 'faturamento.adiantamento-paciente.devolver',
  tabelas: ['devolucao_adiantamento_paciente', 'adiantamento_paciente', 'movimento_caixa', 'sessao_caixa'],
  entrada: esquemaDevolverAdiantamento,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const usuario = usuarioDe(ctx);
    const [a] = await tx.consultarParaAtualizar<Linha>(
      'SELECT id, numero, saldo, situacao FROM adiantamento_paciente WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.adiantamentoId, est],
      { teto: 1 },
    );
    if (!a)
      throw recusa('adiantamento-inexistente', 'O adiantamento não existe.', { campos: ['adiantamentoId'] });
    exigirValido(
      validarDevolucao({ ...e, saldo: n(a['saldo']), situacao: txt(a['situacao']) as SituacaoAdiantamento }),
    );
    const formaId = await formaDe(tx, e.forma, ['pagamento', 'ambos', 'recebimento']);
    const agora = new Date();
    let sessaoId: number | null = null;
    let mov: number | null = null;
    if (e.forma === 'dinheiro') {
      const s = await sessaoAberta(tx, est, usuario);
      sessaoId = n(s['id']);
      // A devolução em dinheiro sai da gaveta: não sai mais do que há nela (fundo + dinheiro + suprimento − sangria).
      const gaveta = r2(
        n(s['fundo_troco']) + n(s['total_dinheiro']) + n(s['total_suprimento']) - n(s['total_sangria']),
      );
      if (e.valor > gaveta)
        throw recusa(
          'caixa-sem-dinheiro',
          `Há ${gaveta.toFixed(2)} em dinheiro no caixa: devolva por Pix ou transferência.`,
          {
            campos: ['valor', 'forma'],
          },
        );
      mov = await tx.incluir('movimento_caixa', {
        estabelecimento_id: est,
        sessao_caixa_id: sessaoId,
        tipo_movimento_caixa_id: await tipoMovimento(tx, TIPO_MOVIMENTO_DEVOLUCAO, 'saida'),
        natureza: 'saida',
        ocorrido_em: agora,
        especie: 'dinheiro',
        forma_recebimento_id: formaId,
        valor: e.valor,
        descricao: `Devolução do adiantamento ${txt(a['numero'])}`,
        adiantamento_paciente_id: e.adiantamentoId,
        responsavel_nome: e.favorecidoNome,
      });
      await tx.alterar('sessao_caixa', sessaoId, n(s['versao']), {
        total_dinheiro: r2(n(s['total_dinheiro']) - e.valor),
      });
    }
    const seq = await tx.uma<Linha>(
      'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM devolucao_adiantamento_paciente WHERE adiantamento_paciente_id = ?',
      [e.adiantamentoId],
    );
    const dev = await tx.incluir('devolucao_adiantamento_paciente', {
      adiantamento_paciente_id: e.adiantamentoId,
      sequencia: n(seq?.['s']),
      data_devolucao: hoje(),
      valor: e.valor,
      forma_recebimento_id: formaId,
      sessao_caixa_id: sessaoId,
      movimento_caixa_id: mov,
      favorecido_nome: e.favorecidoNome,
      favorecido_cpf: e.favorecidoCpf,
      favorecido_chave_pix: e.chavePix,
      identificador_transacao: e.comprovante,
      motivo: e.motivo,
      situacao: 'devolvida',
      aprovado_por_usuario_id: usuario,
      aprovado_em: agora,
      devolvido_em: agora,
    });
    const saldo = await refazerSaldo(tx, e.adiantamentoId, -e.valor, true);
    return { id: dev, saldo, movimento: mov };
  },
  alvo: (_e, r) => ({ tabela: 'devolucao_adiantamento_paciente', id: r.id }),
  trilha: (e) => ({ motivo: e.motivo }),
});

/** A conta corrente do paciente: adiantamentos com saldo, aplicações por conta, devoluções e o extrato corrido. */
export async function contaCorrentePaciente(l: Consulta, est: number, pacienteId: number) {
  const pac = await paciente(l, pacienteId);
  const ads = await l.consultar<Linha>(
    `SELECT a.id, a.numero, a.tipo, a.recebido_em, a.valor, a.saldo, a.situacao, a.atendimento_urgencia,
            a.declaracao_voluntaria, f.meio
       FROM adiantamento_paciente a JOIN forma_recebimento f ON f.id = a.forma_recebimento_id
      WHERE a.paciente_id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL ORDER BY a.recebido_em, a.id`,
    [pacienteId, est],
    { teto: 1000 },
  );
  const apl = await l.consultar<Linha>(
    `SELECT x.id, x.adiantamento_paciente_id, x.conta_hospitalar_id, ch.numero AS conta, x.aplicado_em, x.valor,
            x.estornado, x.estornado_em
       FROM aplicacao_adiantamento_paciente x JOIN adiantamento_paciente a ON a.id = x.adiantamento_paciente_id
       LEFT JOIN conta_hospitalar ch ON ch.id = x.conta_hospitalar_id
      WHERE a.paciente_id = ? AND a.estabelecimento_id = ? AND x.excluido_em IS NULL ORDER BY x.aplicado_em, x.id`,
    [pacienteId, est],
    { teto: 2000 },
  );
  const dev = await l.consultar<Linha>(
    `SELECT d.id, d.adiantamento_paciente_id, d.devolvido_em, d.valor, d.favorecido_nome, d.motivo
       FROM devolucao_adiantamento_paciente d JOIN adiantamento_paciente a ON a.id = d.adiantamento_paciente_id
      WHERE a.paciente_id = ? AND a.estabelecimento_id = ? AND d.situacao = 'devolvida' AND d.excluido_em IS NULL`,
    [pacienteId, est],
    { teto: 2000 },
  );
  const contas = await l.consultar<Linha>(
    `SELECT ch.id, ch.numero, ch.situacao, ch.valor_total FROM conta_hospitalar ch
      WHERE ch.paciente_id = ? AND ch.estabelecimento_id = ? AND ch.excluido_em IS NULL
        AND ch.situacao NOT IN ('cancelada','faturada') ORDER BY ch.id DESC`,
    [pacienteId, est],
    { teto: 50 },
  );
  const lanc: LancamentoCorrente[] = [];
  for (const a of ads)
    lanc.push({
      tipo: txt(a['tipo']) === 'caucao' ? 'caucao' : 'adiantamento',
      data: new Date(a['recebido_em'] as Date).toISOString(),
      valor: n(a['valor']),
      referencia: txt(a['numero']),
      adiantamento: n(a['id']),
    });
  for (const x of apl) {
    lanc.push({
      tipo: 'aplicacao',
      data: new Date(x['aplicado_em'] as Date).toISOString(),
      valor: n(x['valor']),
      referencia: txt(x['conta']),
      adiantamento: n(x['adiantamento_paciente_id']),
    });
    if (n(x['estornado']))
      lanc.push({
        tipo: 'estorno_aplicacao',
        data: new Date(x['estornado_em'] as Date).toISOString(),
        valor: n(x['valor']),
        referencia: txt(x['conta']),
        adiantamento: n(x['adiantamento_paciente_id']),
      });
  }
  for (const d of dev)
    lanc.push({
      tipo: 'devolucao',
      data: new Date(d['devolvido_em'] as Date).toISOString(),
      valor: n(d['valor']),
      referencia: txt(d['favorecido_nome']),
      adiantamento: n(d['adiantamento_paciente_id']),
    });
  const extrato = extratoContaCorrente(lanc);
  const contasAbertas = [];
  for (const c of contas)
    contasAbertas.push({
      id: n(c['id']),
      numero: txt(c['numero']),
      situacao: txt(c['situacao']),
      total: n(c['valor_total']),
      devido: await devidoNaConta(l, n(c['id'])),
    });
  return {
    paciente: pac,
    saldo: r2(ads.reduce((t, a) => t + n(a['saldo']), 0)),
    adiantamentos: ads.map((a) => ({
      id: n(a['id']),
      numero: txt(a['numero']),
      tipo: txt(a['tipo']),
      recebidoEm: new Date(a['recebido_em'] as Date).toISOString(),
      valor: n(a['valor']),
      saldo: n(a['saldo']),
      situacao: txt(a['situacao']),
      forma: txt(a['meio']),
      urgencia: Boolean(n(a['atendimento_urgencia'])),
      voluntaria: Boolean(n(a['declaracao_voluntaria'])),
    })),
    aplicacoes: apl.map((x) => ({
      id: n(x['id']),
      adiantamento: n(x['adiantamento_paciente_id']),
      contaId: nn(x['conta_hospitalar_id']),
      conta: txt(x['conta']),
      aplicadoEm: new Date(x['aplicado_em'] as Date).toISOString(),
      valor: n(x['valor']),
      estornado: Boolean(n(x['estornado'])),
    })),
    contasAbertas,
    extrato,
  };
}

// ── Linha 40: modelo de orçamento padrão ────────────────────────────────────────────────────────

const pct = z.coerce.number().nullable().default(null);
export const esquemaModelo = z.object({
  codigo: z.string().trim().max(30),
  descricao: z.string().trim().max(150),
  todosEstabelecimentos: z.boolean().default(false),
  procedimentoId: id,
  acomodacaoId: id,
  fontePagadoraId: id.nullable().default(null),
  quantidade: z.coerce.number().default(1),
  valorFechado: z.coerce.number().nullable().default(null),
  administracao: pct,
  acrescimo: pct,
  validadeDias: z.coerce.number().int().nullable().default(null),
  itens: z
    .array(
      z.object({
        tipo: z.enum(TIPOS_ITEM_MODELO),
        itemId: id.nullable().default(null),
        funcaoId: id.nullable().default(null),
        profissionalId: id.nullable().default(null),
        quantidade: z.coerce.number().default(1),
        unitario: z.coerce.number().nullable().default(null),
        acrescimo: pct,
      }),
    )
    .max(200),
});

export const opCadastrarModelo = definirOperacao({
  nome: 'faturamento.modelo-orcamento.cadastrar',
  tabelas: ['modelo_orcamento', 'modelo_orcamento_item'],
  entrada: esquemaModelo,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    exigirValido(validarModelo(e));
    if (await tx.uma('SELECT id FROM modelo_orcamento WHERE codigo = ?', [e.codigo]))
      throw recusa('codigo-repetido', 'Já existe modelo com este código.', { campos: ['codigo'] });
    const modelo = await tx.incluir('modelo_orcamento', {
      estabelecimento_id: e.todosEstabelecimentos ? null : est,
      codigo: e.codigo,
      descricao: e.descricao,
      item_faturavel_id: e.procedimentoId,
      categoria_acomodacao_id: e.acomodacaoId,
      fonte_pagadora_id: e.fontePagadoraId,
      quantidade: e.quantidade,
      valor_total: e.valorFechado,
      percentual_administracao: e.administracao,
      percentual_acrescimo: e.acrescimo,
      validade_dias: e.validadeDias,
      ativo: true,
    });
    let s = 0;
    for (const i of e.itens)
      await tx.incluir('modelo_orcamento_item', {
        modelo_orcamento_id: modelo,
        sequencia: ++s,
        tipo_item: i.tipo,
        item_faturavel_id: i.itemId,
        funcao_equipe_cobranca_id: i.funcaoId,
        profissional_id: i.profissionalId,
        quantidade: i.quantidade,
        valor_unitario: i.unitario,
        valor_total: i.unitario === null ? null : r2(i.unitario * i.quantidade),
        percentual_acrescimo: i.acrescimo,
      });
    return { id: modelo, itens: s };
  },
  alvo: (_e, r) => ({ tabela: 'modelo_orcamento', id: r.id }),
});

export const esquemaInativarModelo = z.object({ modeloId: id, motivo: z.string().trim().min(1).max(500) });
export const opInativarModelo = definirOperacao({
  nome: 'faturamento.modelo-orcamento.inativar',
  tabelas: ['modelo_orcamento'],
  entrada: esquemaInativarModelo,
  async gravar(tx, e) {
    const [m] = await tx.consultarParaAtualizar<Linha>(
      'SELECT id, versao, ativo FROM modelo_orcamento WHERE id = ?',
      [e.modeloId],
      { teto: 1 },
    );
    if (!m) throw recusa('modelo-inexistente', 'O modelo não existe.', { campos: ['modeloId'] });
    if (n(m['ativo'])) await tx.alterar('modelo_orcamento', e.modeloId, n(m['versao']), { ativo: false });
    return { id: e.modeloId };
  },
  alvo: (_e, r) => ({ tabela: 'modelo_orcamento', id: r.id }),
  trilha: (e) => ({ motivo: e.motivo }),
});

async function modeloLido(tx: Consulta, est: number, modeloId: number) {
  const m = await tx.uma<Linha>(
    `SELECT * FROM modelo_orcamento WHERE id = ? AND ativo = TRUE AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`,
    [modeloId, est],
  );
  if (!m)
    throw recusa('modelo-inexistente', 'O modelo não existe ou está inativo.', { campos: ['modeloId'] });
  const itens = await tx.consultar<Linha>(
    `SELECT mi.*, f.percentual_cobranca FROM modelo_orcamento_item mi
       LEFT JOIN funcao_equipe_cobranca f ON f.id = mi.funcao_equipe_cobranca_id
      WHERE mi.modelo_orcamento_id = ? AND mi.excluido_em IS NULL ORDER BY mi.sequencia`,
    [modeloId],
    { teto: 200 },
  );
  return { m, itens };
}
async function fonteParticular(tx: Consulta, fonte: number | null): Promise<number | null> {
  if (fonte) return fonte;
  const f = await tx.uma<Linha>(
    "SELECT id FROM fonte_pagadora WHERE tipo = 'particular' AND excluido_em IS NULL ORDER BY id LIMIT 1",
    [],
  );
  return f ? n(f['id']) : null;
}
/** A montagem do orçamento pelo modelo (prévia na tela e gravação usam a mesma conta). */
export async function previaDoModelo(
  tx: Consulta,
  est: number,
  modeloId: number,
  informados: Readonly<Record<string, number>> = {},
) {
  const { m, itens } = await modeloLido(tx, est, modeloId);
  const fonte = await fonteParticular(tx, nn(m['fonte_pagadora_id']));
  const tabelas = fonte ? await tabelasDePreco(tx as Leitor, est, fonte, null) : [];
  const preco = async (item: number | null) =>
    item && tabelas.length
      ? ((await precoVigente(tx as Leitor, tabelas, item, hoje()))?.unitario ?? null)
      : null;
  const montado = montarOrcamentoDoModelo(
    {
      procedimentoId: n(m['item_faturavel_id']),
      quantidade: n(m['quantidade']),
      valorFechado: nn(m['valor_total']),
      administracao: nn(m['percentual_administracao']),
      acrescimo: nn(m['percentual_acrescimo']),
      validadeDias: nn(m['validade_dias']),
      precoPrincipal: informados['1'] ?? (await preco(n(m['item_faturavel_id']))),
    },
    await Promise.all(
      itens.map(async (i, k) => ({
        tipo: txt(i['tipo_item']) as (typeof TIPOS_ITEM_MODELO)[number],
        itemId: nn(i['item_faturavel_id']),
        funcaoId: nn(i['funcao_equipe_cobranca_id']),
        profissionalId: nn(i['profissional_id']),
        quantidade: n(i['quantidade']),
        unitario: informados[String(k + 2)] ?? nn(i['valor_unitario']),
        acrescimo: nn(i['percentual_acrescimo']),
        precoTabela: await preco(nn(i['item_faturavel_id'])),
        percentualFuncao: nn(i['percentual_cobranca']),
      })),
    ),
  );
  return { modelo: m, fonte, montado };
}

export const esquemaGerarOrcamento = z.object({
  modeloId: id,
  pacienteId: id.nullable().default(null),
  nomeInteressado: z.string().trim().max(150).nullable().default(null),
  /** Valores digitados na hora para as linhas sem preço (sequência → unitário). */
  precos: z.record(z.string(), z.coerce.number().nonnegative()).default({}),
});

export const opGerarOrcamentoDoModelo = definirOperacao({
  nome: 'faturamento.modelo-orcamento.gerar-orcamento',
  tabelas: ['orcamento_particular', 'orcamento_particular_item', 'sequencia_negocio'],
  entrada: esquemaGerarOrcamento,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    if (!e.pacienteId && !e.nomeInteressado)
      throw recusa('entrada-invalida', 'Escolha o paciente ou informe o nome do interessado.', {
        campos: ['pacienteId', 'nomeInteressado'],
      });
    if (e.pacienteId) await paciente(tx, e.pacienteId);
    // Linhas sem preço: o valor digitado na hora entra na montagem (administração e acréscimo incidem sobre ele);
    // a que continuar sem valor é recusada (orçamento sem furo).
    const { modelo, fonte, montado } = await previaDoModelo(tx, est, e.modeloId, e.precos);
    const linhas = montado.linhas;
    const faltam = montado.semPreco;
    if (faltam.length)
      throw recusa(
        'sem-preco',
        `Informe o valor das linhas ${faltam.join(', ')} (sem preço na tabela particular).`,
        {
          campos: faltam.map((s) => `precos.${s}`),
        },
      );
    const ajuste = r2(montado.administracao + montado.acrescimo);
    const bruto = montado.total;
    const numero = await numeroDe(tx, ctx, 'orcamento_particular', 'OP-');
    const data = hoje();
    const orc = await tx.incluir('orcamento_particular', {
      estabelecimento_id: est,
      numero: numero.formatado,
      paciente_id: e.pacienteId,
      nome_interessado: e.nomeInteressado,
      fonte_pagadora_id: fonte,
      modelo_orcamento_id: e.modeloId,
      categoria_acomodacao_id: modelo['categoria_acomodacao_id'],
      data_orcamento: data,
      validade_ate: somarDias(data, montado.validadeDias),
      valor_bruto: bruto,
      valor_desconto: 0,
      valor_total: bruto,
      especificacao: txt(modelo['descricao']),
      situacao: 'emitido',
    });
    let seq = 0;
    for (const l of linhas)
      await tx.incluir('orcamento_particular_item', {
        orcamento_particular_id: orc,
        sequencia: ++seq,
        tipo_item: l.tipo,
        item_faturavel_id: l.itemId,
        funcao_equipe_cobranca_id: l.funcaoId,
        profissional_id: l.profissionalId,
        quantidade: l.quantidade,
        valor_unitario: l.unitario,
        valor_total: l.total,
        valor_pacote: l.valorPacote,
      });
    if (ajuste > 0)
      await tx.incluir('orcamento_particular_item', {
        orcamento_particular_id: orc,
        sequencia: ++seq,
        tipo_item: 'taxa',
        descricao: 'Administração e acréscimo do modelo',
        quantidade: 1,
        valor_unitario: ajuste,
        valor_total: ajuste,
      });
    return { id: orc, numero: numero.formatado, total: bruto, itens: seq };
  },
  alvo: (_e, r) => ({ tabela: 'orcamento_particular', id: r.id }),
});

/** Os modelos ativos visíveis no estabelecimento, com a quantidade de itens. */
export async function listarModelos(l: Consulta, est: number) {
  const r = await l.consultar<Linha>(
    `SELECT m.id, m.codigo, m.descricao, m.item_faturavel_id, i.descricao AS procedimento,
            m.categoria_acomodacao_id, c.descricao AS acomodacao, m.valor_total, m.validade_dias,
            (SELECT COUNT(*) FROM modelo_orcamento_item x WHERE x.modelo_orcamento_id = m.id AND x.excluido_em IS NULL) AS itens
       FROM modelo_orcamento m JOIN item_faturavel i ON i.id = m.item_faturavel_id
       JOIN categoria_acomodacao c ON c.id = m.categoria_acomodacao_id
      WHERE m.ativo = TRUE AND (m.estabelecimento_id IS NULL OR m.estabelecimento_id = ?) ORDER BY m.descricao`,
    [est],
    { teto: 500 },
  );
  return r.map((m) => ({
    id: n(m['id']),
    codigo: txt(m['codigo']),
    descricao: txt(m['descricao']),
    procedimentoId: n(m['item_faturavel_id']),
    procedimento: txt(m['procedimento']),
    acomodacaoId: n(m['categoria_acomodacao_id']),
    acomodacao: txt(m['acomodacao']),
    valorFechado: nn(m['valor_total']),
    validadeDias: nn(m['validade_dias']),
    itens: n(m['itens']),
  }));
}

export const OPERACOES_PARTICULAR = {
  'adiantamento.receber': opReceberAdiantamento,
  'adiantamento.aplicar': opAplicarAdiantamento,
  'adiantamento.estornar': opEstornarAplicacao,
  'adiantamento.devolver': opDevolverAdiantamento,
  'modelo.cadastrar': opCadastrarModelo,
  'modelo.inativar': opInativarModelo,
  'modelo.gerarOrcamento': opGerarOrcamentoDoModelo,
} as const;
export type NomeOperacaoParticular = keyof typeof OPERACOES_PARTICULAR;

export async function gravarParticular(
  executor: Executor,
  nome: NomeOperacaoParticular,
  ctx: ContextoOperacao,
  entrada: unknown,
): Promise<Record<string, unknown>> {
  const op = OPERACOES_PARTICULAR[nome] as Parameters<Executor['executar']>[0];
  const r = await executor.executar(op, ctx.cliente, entrada, ctx);
  return r.resultado as Record<string, unknown>;
}
