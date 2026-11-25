// Contrato de efeito do comercial da operadora (08-SGO L100, C2-095) contra o MariaDB real (cliente f22_o2). Massa
// SINTÉTICA pela carteira da F1 (operadora, plano individual, contrato com titular e dependente) e um plano
// comercializado sintético. Prova o que fica no banco: a força de venda (corretora com a pessoa jurídica pelo CNPJ,
// vendedor, equipe com membro) e a regra de comissão com as faixas; a proposta de adesão com os proponentes, o fluxo
// (recusa sem motivo e aprovação pulando a análise recusadas) e a efetivação que carimba a venda no contrato; o lote de
// comissão só com a parcela paga (a não paga fica como pendência, fora do bruto), o fechamento, e o estorno no lote
// seguinte depois do cancelamento do contrato; o cancelamento do lote marca os itens; a meta apurada pela efetivação e a
// campanha ativada só com desconto. SGH_NUCLEO_SEM_BANCO=1 pula o banco.
import { cnpjSintetico, cpfSintetico } from '@sgh/dominio-operadora';
import { garantirSequencia, type NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import { type Gravado, PortaComercialPropria } from './comercial-propria.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  criarNucleo,
  limparMassa,
  type MassaBase,
  montarCarteira,
  PODE,
  prepararBase,
  servicoNoBanco,
  sessao,
} from './infra/copia.spec-util.js';

let nucleo: NucleoProprio | null = null;
let massa: MassaBase | null = null;
let porta: PortaComercialPropria | null = null;
let cart: Awaited<ReturnType<typeof montarCarteira>> | null = null;
let plano = 0;
let incidencia = 0;
let corretora = 0;
let vendedor = 0;
let equipe = 0;
let regra = 0;
let proposta: Gravado | null = null;
const CNPJ = cnpjSintetico('209500010001');
const CPF_VEND = cpfSintetico('920950001');

const trilha =
  (evento: string) =>
  (r: { id: number }): RegistroTrilhaTela => ({
    estabelecimento: massa?.est ?? null,
    usuario: massa?.usuario ?? null,
    acao: 'operacao',
    entidade: 'operadora',
    entidadeId: r.id,
    dadosDepois: { evento, recurso: 'operadora.comercial' },
    correlacao: 'teste-c2095',
  });

const q = (sql: string, p: unknown[] = []) =>
  nucleo!.lerSomente({ cliente: CLIENTE, correlacao: 'teste-c2095' }, (l) =>
    l.consultar(sql, p, { teto: 1000 }),
  );

async function limpar(n: NucleoProprio, m: MassaBase) {
  await n.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c2095' }, async (e) => {
    const ests = [m.est, m.outroEst];
    const ope =
      'SELECT operadora_saude_id FROM operadora_saude_estabelecimento WHERE estabelecimento_id IN (?, ?)';
    await e.executar(
      'DELETE i FROM comissao_venda_item i JOIN comissao_venda c ON c.id = i.comissao_venda_id WHERE c.estabelecimento_id IN (?, ?)',
      ests,
    );
    await e.executar('DELETE FROM comissao_venda WHERE estabelecimento_id IN (?, ?)', ests);
    await e.executar(
      'DELETE b FROM proposta_adesao_beneficiario b JOIN proposta_adesao p ON p.id = b.proposta_adesao_id WHERE p.estabelecimento_id IN (?, ?) AND b.titular_proposta_adesao_beneficiario_id IS NOT NULL',
      ests,
    );
    await e.executar(
      'DELETE b FROM proposta_adesao_beneficiario b JOIN proposta_adesao p ON p.id = b.proposta_adesao_id WHERE p.estabelecimento_id IN (?, ?)',
      ests,
    );
    await e.executar('DELETE FROM proposta_adesao WHERE estabelecimento_id IN (?, ?)', ests);
    await e.executar(
      'DELETE i FROM meta_venda_item i JOIN meta_venda m ON m.id = i.meta_venda_id WHERE m.estabelecimento_id IN (?, ?)',
      ests,
    );
    await e.executar('DELETE FROM meta_venda WHERE estabelecimento_id IN (?, ?)', ests);
    for (const t of ['campanha_venda_desconto', 'campanha_venda_participante'])
      await e.executar(
        `DELETE x FROM ${t} x JOIN campanha_comercial_plano c ON c.id = x.campanha_comercial_plano_id WHERE c.estabelecimento_id IN (?, ?)`,
        ests,
      );
    await e.executar('DELETE FROM campanha_comercial_plano WHERE estabelecimento_id IN (?, ?)', ests);
    await e.executar(
      `DELETE x FROM regra_comissao_parcela x JOIN regra_comissao_venda r ON r.id = x.regra_comissao_venda_id WHERE r.operadora_saude_id IN (${ope})`,
      ests,
    );
    await e.executar(`DELETE FROM regra_comissao_venda WHERE operadora_saude_id IN (${ope})`, ests);
    await e.executar(
      'DELETE x FROM equipe_venda_membro x JOIN equipe_venda q ON q.id = x.equipe_venda_id WHERE q.estabelecimento_id IN (?, ?)',
      ests,
    );
    await e.executar('DELETE FROM equipe_venda WHERE estabelecimento_id IN (?, ?)', ests);
    await e.executar(
      'UPDATE contrato_plano SET vendedor_plano_id = NULL, corretora_venda_id = NULL WHERE estabelecimento_id IN (?, ?)',
      ests,
    );
    await e.executar('DELETE FROM vendedor_plano WHERE estabelecimento_id IN (?, ?)', ests);
    await e.executar(`DELETE FROM corretora_venda WHERE operadora_saude_id IN (${ope})`, ests);
    await e.executar('DELETE FROM pessoa_juridica WHERE cnpj = ?', [CNPJ]);
    await e.executar('DELETE FROM fatura_plano WHERE estabelecimento_id IN (?, ?)', ests);
    await e.executar(
      "DELETE FROM plano_comercializado WHERE estabelecimento_id IN (?, ?) AND codigo = 'PC-2095' AND NOT EXISTS (SELECT 1 FROM beneficiario_plano b WHERE b.plano_comercializado_id = plano_comercializado.id)",
      ests,
    );
    await limparTrilhaDaMassa(e, { ids: ests });
  });
}

beforeAll(async () => {
  if (!PODE) return;
  nucleo = criarNucleo();
  massa = await prepararBase(nucleo);
  await limpar(nucleo, massa);
  await limparMassa(nucleo, massa);
  const { servico } = servicoNoBanco(nucleo);
  cart = await montarCarteira(servico, sessao(massa), { registro: '420951', base: '2095' });
  porta = new PortaComercialPropria(nucleo, CLIENTE);
  const m = massa;
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c2095' }, async (e) => {
    const inc = await e.uma(
      "SELECT id FROM incidencia_comissao WHERE base_calculo = 'mensalidade' AND ativo = TRUE ORDER BY id LIMIT 1",
    );
    if (inc) incidencia = Number(inc['id']);
    else {
      await e.executar(
        "INSERT INTO incidencia_comissao (codigo, descricao, base_calculo, criado_em) VALUES ('c2095-mens', 'Mensalidade (sintética)', 'mensalidade', NOW(3))",
      );
      incidencia = Number(
        (await e.uma("SELECT id FROM incidencia_comissao WHERE codigo = 'c2095-mens'"))!['id'],
      );
    }
    for (const s of ['F', 'M'])
      if (!(await e.uma('SELECT id FROM sexo WHERE sigla = ? AND ativo = TRUE', [s])))
        await e.executar('INSERT INTO sexo (codigo, descricao, sigla, criado_em) VALUES (?, ?, ?, NOW(3))', [
          `c2095-${s}`,
          `Sintético ${s}`,
          s,
        ]);
    for (const tipo of ['proposta_adesao', 'comissao_venda'])
      await garantirSequencia(
        e,
        { tipo, estabelecimento: m.est, prefixo: 'C2095-' },
        { usuario: m.usuario, agora: new Date() },
      );
    // O plano comercializado do produto da carteira (o cadastro do produto já o cria); sem ele, um sintético.
    const ja = await e.uma(
      "SELECT id FROM plano_comercializado WHERE estabelecimento_id = ? AND produto_plano_id = ? AND situacao = 'ativo' ORDER BY id LIMIT 1",
      [m.est, cart!.produto],
    );
    if (ja) plano = Number(ja['id']);
    else {
      await e.executar(
        `INSERT INTO plano_comercializado (estabelecimento_id, produto_plano_id, codigo, nome_comercial, vigencia_inicio, criado_em)
         VALUES (?, ?, 'PC-2095', 'Plano comercial sintético', '2026-01-01', NOW(3))`,
        [m.est, cart!.produto],
      );
      plano = Number(
        (await e.uma(
          "SELECT id FROM plano_comercializado WHERE estabelecimento_id = ? AND codigo = 'PC-2095'",
          [m.est],
        ))!['id'],
      );
    }
  });
}, 300_000);

afterAll(async () => {
  if (nucleo && massa) {
    await limpar(nucleo, massa);
    await limparMassa(nucleo, massa);
  }
  await nucleo?.encerrar();
});

describe.skipIf(!PODE)('comercial da operadora no banco próprio (C2-095)', () => {
  it('cadastra a força de venda e a regra de comissão com as faixas', async () => {
    const c = contexto(massa!);
    const op = cart!.operadora;
    corretora = (
      await porta!.gravarCorretora(
        c,
        op,
        {
          codigo: 'COR-2095',
          nome: 'Corretora Sintética',
          tipo: 'corretora',
          cnpj: CNPJ,
          corretoraPai: null,
          registroSusep: null,
          email: null,
        },
        trilha('corretora'),
      )
    ).id;
    expect(
      await codigoDe(
        porta!.gravarCorretora(
          c,
          op,
          {
            codigo: 'COR-X',
            nome: 'Sem CNPJ',
            tipo: 'corretora',
            cnpj: null,
            corretoraPai: null,
            registroSusep: null,
            email: null,
          },
          trilha('corretora'),
        ),
      ),
    ).toBe('corretora-cnpj-invalido');
    vendedor = (
      await porta!.gravarVendedor(
        c,
        op,
        { codigo: 'V-2095', nome: 'Vendedor Sintético', cpf: CPF_VEND, corretora, email: null },
        trilha('vendedor'),
      )
    ).id;
    equipe = (
      await porta!.gravarEquipe(
        c,
        op,
        {
          codigo: 'EQ-2095',
          nome: 'Equipe Sintética',
          corretora,
          chefe: vendedor,
          membros: [{ vendedor, inicio: '2026-01-01' }],
        },
        trilha('equipe'),
      )
    ).id;
    const parcelas = [
      {
        parcelaInicial: 1,
        parcelaFinal: 1,
        tipo: 'percentual' as const,
        percentual: 100,
        valor: null,
        desconto: null,
        vigenciaInicio: '2026-01-01',
      },
      {
        parcelaInicial: 2,
        parcelaFinal: 12,
        tipo: 'percentual' as const,
        percentual: 5,
        valor: null,
        desconto: null,
        vigenciaInicio: '2026-01-01',
      },
    ];
    const base = {
      descricao: 'Regra sintética',
      incidencia,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
      corretora: null,
      equipe: null,
      vendedor: null,
      plano: null,
    };
    expect(
      await codigoDe(
        porta!.gravarRegra(
          c,
          op,
          {
            ...base,
            codigo: 'RG-X',
            parcelas: [parcelas[1]!, { ...parcelas[1]!, parcelaInicial: 12, parcelaFinal: 14 }],
          },
          trilha('regra'),
        ),
      ),
    ).toBe('parcela-sobreposta');
    regra = (await porta!.gravarRegra(c, op, { ...base, codigo: 'RG-2095', parcelas }, trilha('regra'))).id;
    const [cor] = await q(
      'SELECT c.tipo, c.situacao, pj.cnpj FROM corretora_venda c JOIN pessoa_juridica pj ON pj.id = c.pessoa_juridica_id WHERE c.id = ?',
      [corretora],
    );
    expect(cor).toMatchObject({ tipo: 'corretora', situacao: 'ativa', cnpj: CNPJ });
    expect(
      Number(
        (await q('SELECT COUNT(*) AS n FROM equipe_venda_membro WHERE equipe_venda_id = ?', [equipe]))[0]?.[
          'n'
        ],
      ),
    ).toBe(1);
    const ps = await q(
      'SELECT parcela_inicial, parcela_final, tipo_aplicacao, percentual FROM regra_comissao_parcela WHERE regra_comissao_venda_id = ? ORDER BY sequencia',
      [regra],
    );
    expect(ps.map((p) => [p['parcela_inicial'], p['parcela_final'], Number(p['percentual'])])).toEqual([
      [1, 1, 100],
      [2, 12, 5],
    ]);
    const painel = await porta!.painel(c, op);
    expect(painel.regras.find((r) => r.id === regra)?.parcelas).toHaveLength(2);
    expect(painel.planos.map((p) => p.id)).toContain(plano);
  });

  it('proposta com proponentes segue o fluxo e a efetivação carimba a venda no contrato', async () => {
    const c = contexto(massa!);
    const op = cart!.operadora;
    const titular = {
      sequencia: 1,
      tipo: 'titular' as const,
      titularSequencia: null,
      parentesco: null,
      nome: 'Proponente Sintético',
      nascimento: '1990-04-04',
      sexo: 'F',
      cpf: cpfSintetico('920950002'),
      cns: null,
      nomeMae: 'Mãe Sintética',
    };
    const [par] = await q('SELECT id FROM grau_parentesco_dependente ORDER BY id LIMIT 1');
    const dep = {
      ...titular,
      sequencia: 2,
      tipo: 'dependente' as const,
      titularSequencia: 1,
      parentesco: par ? Number(par['id']) : null,
      nome: 'Dependente Proponente',
      nascimento: '2018-01-01',
      sexo: 'M',
      cpf: null,
    };
    const ent = {
      propostaEm: '2026-10-01',
      plano,
      contrato: cart!.contrato,
      contratante: null,
      vendedor,
      corretora,
      equipe,
      diaVencimento: 10,
      observacao: null,
      proponentes: [titular, dep],
    };
    expect(
      await codigoDe(
        porta!.incluirProposta(
          c,
          op,
          { ...ent, proponentes: [{ ...dep, titularSequencia: 7 }] },
          trilha('proposta'),
        ),
      ),
    ).toBe('dependente-sem-titular');
    proposta = await porta!.incluirProposta(c, op, ent, trilha('proposta'));
    let v = proposta.versao;
    const mudar = (para: never, motivo: string | null = null, contrato: number | null = null) =>
      porta!.mudarProposta(c, proposta!.id, { versao: v, para, motivo, contrato }, trilha('situacao'));
    expect(await codigoDe(mudar('aprovada' as never))).toBe('proposta-transicao-invalida');
    v = (await mudar('enviada' as never)).versao;
    v = (await mudar('em_analise' as never)).versao;
    expect(await codigoDe(mudar('recusada' as never))).toBe('proposta-sem-motivo');
    v = (await mudar('aprovada' as never)).versao;
    v = (await mudar('efetivada' as never)).versao;
    const lida = await porta!.proposta(c, proposta.id);
    expect(lida.situacao).toBe('efetivada');
    expect(lida.proponentes.map((p) => [p.tipo, p.titularSequencia])).toEqual([
      ['titular', null],
      ['dependente', 1],
    ]);
    const [k] = await q(
      'SELECT vendido_em, vendedor_plano_id, corretora_venda_id FROM contrato_plano WHERE id = ?',
      [cart!.contrato],
    );
    expect([
      String(k?.['vendido_em']).slice(0, 10) !== 'null',
      Number(k?.['vendedor_plano_id']),
      Number(k?.['corretora_venda_id']),
    ]).toEqual([true, vendedor, corretora]);
    const [p] = await q('SELECT situacao, situacao_anterior, numero FROM proposta_adesao WHERE id = ?', [
      proposta.id,
    ]);
    expect(p).toMatchObject({ situacao: 'efetivada', situacao_anterior: 'aprovada' });
    expect(String(p?.['numero'])).not.toBe('');
  });

  it('lote de comissão só com a parcela paga; estorno no cancelamento; meta e campanha', async () => {
    const c = contexto(massa!);
    const op = cart!.operadora;
    const m = massa!;
    await nucleo!.escrever({ cliente: CLIENTE, correlacao: 'preparo-c2095' }, async (e) => {
      const forma = await e.uma('SELECT id FROM forma_cobranca_plano ORDER BY id LIMIT 1');
      await e.executar(
        `INSERT INTO fatura_plano (estabelecimento_id, numero, contrato_plano_id, competencia, parcela, data_emissao, data_vencimento,
                                   forma_cobranca_plano_id, tipo_fatura, valor_bruto, valor_total, valor_pago, data_pagamento, situacao, criado_em)
         VALUES (?, 'C2095-1', ?, '2026-10-01', 1, '2026-10-01', '2026-10-10', ?, 'mensalidade', 400, 400, 400, '2026-10-09', 'paga', NOW(3)),
                (?, 'C2095-2', ?, '2026-11-01', 2, '2026-11-01', '2026-11-10', ?, 'mensalidade', 400, 400, NULL, NULL, 'emitida', NOW(3))`,
        [m.est, cart!.contrato, forma?.['id'], m.est, cart!.contrato, forma?.['id']],
      );
    });
    const apuracao = {
      descricao: null,
      regra,
      corretora,
      equipe: null,
      vendedor: null,
      pagamentoInicio: '2026-10-01',
      pagamentoFim: '2026-11-30',
      prazoEstornoDias: 90,
      aliquotaIrrf: 1.5,
      aliquotaIss: 0,
    };
    const l1 = await porta!.apurarComissao(c, op, apuracao, trilha('comissao'));
    const [lote] = await q(
      'SELECT situacao, valor_bruto, valor_estorno, valor_irrf, valor_liquido FROM comissao_venda WHERE id = ?',
      [l1.id],
    );
    expect([
      lote?.['situacao'],
      Number(lote?.['valor_bruto']),
      Number(lote?.['valor_irrf']),
      Number(lote?.['valor_liquido']),
    ]).toEqual(['calculada', 400, 0, 400]);
    const itens = await q(
      'SELECT tipo_lancamento, numero_parcela, valor_comissao, pendente FROM comissao_venda_item WHERE comissao_venda_id = ? ORDER BY sequencia',
      [l1.id],
    );
    expect(
      itens.map((i) => [
        i['tipo_lancamento'],
        i['numero_parcela'],
        Number(i['valor_comissao']),
        Number(i['pendente']),
      ]),
    ).toEqual([
      ['comissao', 1, 400, 0],
      ['pendencia', 2, 20, 1],
    ]);
    expect(
      await codigoDe(
        porta!.mudarComissao(c, l1.id, { versao: l1.versao, para: 'paga', motivo: null }, trilha('lote')),
      ),
    ).toBe('comissao-transicao-invalida');
    await porta!.mudarComissao(
      c,
      l1.id,
      { versao: l1.versao, para: 'fechada', motivo: null },
      trilha('lote'),
    );
    expect(await codigoDe(porta!.apurarComissao(c, op, apuracao, trilha('comissao')))).toBe(
      'comissao-sem-movimento',
    );
    // O contrato é cancelado 50 dias depois da venda: o próximo lote estorna o que foi liberado.
    await nucleo!.escrever({ cliente: CLIENTE, correlacao: 'preparo-c2095' }, (e) =>
      e.executar(
        "UPDATE contrato_plano SET situacao = 'encerrado', fim_vigencia = '2026-11-20' WHERE id = ?",
        [cart!.contrato],
      ),
    );
    const l2 = await porta!.apurarComissao(c, op, apuracao, trilha('comissao'));
    const est = await q(
      'SELECT tipo_lancamento, valor_comissao, dias_permanencia FROM comissao_venda_item WHERE comissao_venda_id = ?',
      [l2.id],
    );
    expect(
      est.map((i) => [i['tipo_lancamento'], Number(i['valor_comissao']), i['dias_permanencia']]),
    ).toEqual([['estorno', -400, 50]]);
    const [lote2] = await q('SELECT valor_estorno, valor_liquido FROM comissao_venda WHERE id = ?', [l2.id]);
    expect([Number(lote2?.['valor_estorno']), Number(lote2?.['valor_liquido'])]).toEqual([400, -400]);
    expect(
      await codigoDe(
        porta!.mudarComissao(c, l2.id, { versao: 1, para: 'cancelada', motivo: null }, trilha('lote')),
      ),
    ).toBe('comissao-sem-motivo');
    await porta!.mudarComissao(
      c,
      l2.id,
      { versao: 1, para: 'cancelada', motivo: 'Conferência' },
      trilha('lote'),
    );
    const canc = await q(
      'SELECT COUNT(*) AS n FROM comissao_venda_item WHERE comissao_venda_id = ? AND cancelado = TRUE',
      [l2.id],
    );
    expect(Number(canc[0]?.['n'])).toBe(1);

    // Meta de contratos do vendedor: a proposta efetivada conta 1, na faixa 1 a 4.
    const meta = await porta!.gravarMeta(
      c,
      op,
      {
        descricao: 'Contratos de outubro',
        medida: 'contratos',
        inicio: '2026-10-01',
        fim: '2026-10-31',
        equipe: null,
        vendedor,
        corretora: null,
        valorMeta: 4,
        faixas: [
          { de: 1, ate: 3, percentualPremio: 1, valorPremio: null },
          { de: 4, ate: null, percentualPremio: 3, valorPremio: null },
        ],
      },
      trilha('meta'),
    );
    expect(await porta!.apurarMeta(c, meta.id)).toMatchObject({
      realizado: 1,
      atingido: 25,
      faixa: 1,
      percentualPremio: 1,
    });

    const camp = await porta!.gravarCampanha(
      c,
      op,
      {
        codigo: 'CP-2095',
        descricao: 'Campanha sintética',
        inicio: '2026-11-01',
        fim: '2026-12-31',
        regra,
        condicoes: null,
        descontos: [],
        participantes: [{ corretora, equipe: null, vendedor: null }],
      },
      trilha('campanha'),
    );
    expect(
      await codigoDe(porta!.mudarCampanha(c, camp.id, { versao: 1, para: 'ativa' }, trilha('campanha'))),
    ).toBe('campanha-sem-desconto');
    const camp2 = await porta!.gravarCampanha(
      c,
      op,
      {
        codigo: 'CP-2095B',
        descricao: 'Campanha com desconto',
        inicio: '2026-11-01',
        fim: null,
        regra: null,
        condicoes: null,
        descontos: [{ parcela: 1, percentual: 50, valor: null }],
        participantes: [],
      },
      trilha('campanha'),
    );
    await porta!.mudarCampanha(c, camp2.id, { versao: 1, para: 'ativa' }, trilha('campanha'));
    const cs = await q(
      `SELECT c.codigo, c.situacao, (SELECT COUNT(*) FROM campanha_venda_participante p WHERE p.campanha_comercial_plano_id = c.id AND p.todos_participantes = TRUE) AS todos
         FROM campanha_comercial_plano c WHERE c.id IN (?, ?) ORDER BY c.codigo`,
      [camp.id, camp2.id],
    );
    expect(cs.map((x) => [x['codigo'], x['situacao'], Number(x['todos'])])).toEqual([
      ['CP-2095', 'planejada', 0],
      ['CP-2095B', 'ativa', 1],
    ]);
  });
});
