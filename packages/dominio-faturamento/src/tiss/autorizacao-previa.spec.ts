import { beforeAll, describe, expect, it } from 'vitest';
import {
  casarAutorizacaoComConta,
  conferirDiagnosticosAutorizacao,
  conferirLimiteOpme,
  conferirPedidoAutorizacao,
  conferirProcedimentoDaOpme,
  type DadosMensagemSolicitacao,
  faltasParaMensagem,
  type ItemPedidoAutorizacao,
  lerRespostaAutorizacao,
  mensagemSolicitacaoAutorizacao,
  type PedidoAutorizacao,
  cidDoPedido,
  podeMudar,
  proximaConsultaAndamento,
} from './autorizacao-previa.js';
import { conferirHashEpilogo } from './lote.js';
import { type ArquivoEsquema, carregarEsquemas, iso88591, validarNoXsd } from './validacao.js';

const item = (x: Partial<ItemPedidoAutorizacao> = {}): ItemPedidoAutorizacao => ({
  codigoTabela: '22',
  codigoProcedimento: '40301010',
  descricao: 'Procedimento sintético',
  quantidade: 1,
  valorUnitario: null,
  opme: false,
  registroAnvisa: null,
  fabricante: null,
  ...x,
});
const pedido = (x: Partial<PedidoAutorizacao> = {}): PedidoAutorizacao => ({
  tipo: 'sp_sadt',
  canal: 'webservice',
  carteira: 'SINT0001',
  validadeCarteira: '2030-12-31',
  hoje: '2026-11-24',
  ligado: false,
  temSolicitante: true,
  regimeInternacao: null,
  diarias: null,
  indicacaoClinica: null,
  itens: [item()],
  ...x,
});

describe('pedido de autorização prévia', () => {
  it('aceita o pedido completo e recusa na hora o que falta', () => {
    expect(conferirPedidoAutorizacao(pedido())).toEqual([]);
    const campos = (p: PedidoAutorizacao) => conferirPedidoAutorizacao(p).map((x) => x.campo);
    expect(campos(pedido({ validadeCarteira: '2026-01-01' }))).toContain('carteira');
    expect(campos(pedido({ temSolicitante: false }))).toContain('solicitante');
    expect(campos(pedido({ itens: [] }))).toContain('itens');
    expect(campos(pedido({ itens: [item({ quantidade: 1.5 })] }))).toContain('itens.0');
    expect(campos(pedido({ itens: [item(), item()] }))).toContain('itens.1');
    expect(campos(pedido({ tipo: 'internacao' }))).toEqual(
      expect.arrayContaining(['regime', 'diarias', 'indicacaoClinica']),
    );
    expect(campos(pedido({ tipo: 'prorrogacao', canal: 'portal', diarias: 2 }))).toContain('principal');
    expect(campos(pedido({ tipo: 'quimioterapia', ligado: true }))).toContain('canal');
    expect(campos(pedido({ itens: [item({ opme: true })] }))).toContain('itens.0');
    expect(
      campos(
        pedido({
          tipo: 'opme',
          canal: 'portal',
          ligado: true,
          itens: [item({ opme: true, fabricante: 1 }), item({ codigoProcedimento: 'X' })],
        }),
      ),
    ).toContain('itens');
  });

  it('confere o limite de OPME do procedimento (o menor vale)', () => {
    const itens = [item({ opme: true, registroAnvisa: '80000000001', valorUnitario: 1500, quantidade: 2 })];
    expect(conferirLimiteOpme(itens, [])).toEqual([]);
    expect(conferirLimiteOpme(itens, [{ valorLimite: 5000, quantidadeLimite: null }])).toEqual([]);
    expect(
      conferirLimiteOpme(itens, [
        { valorLimite: 5000, quantidadeLimite: null },
        { valorLimite: 2999.99, quantidadeLimite: null },
      ]),
    ).toHaveLength(1);
    expect(conferirLimiteOpme(itens, [{ valorLimite: null, quantidadeLimite: 1 }])).toHaveLength(1);
  });

  it('não deixa a OPME sem valor passar pelo limite de valor como zero', () => {
    const semValor = [item({ opme: true, registroAnvisa: '80000000001', quantidade: 1 })];
    expect(conferirLimiteOpme(semValor, [{ valorLimite: 5000, quantidadeLimite: null }])).toEqual([
      expect.objectContaining({ mensagem: expect.stringMatching(/Informe o valor da OPME/) }),
    ]);
    // Só limite de quantidade: o valor não é exigido.
    expect(conferirLimiteOpme(semValor, [{ valorLimite: null, quantidadeLimite: 3 }])).toEqual([]);
  });

  it('pede o procedimento identificado quando há OPME (base do limite)', () => {
    const opme = item({ opme: true, codigoProcedimento: '70000001', registroAnvisa: '80000000001' });
    expect(conferirProcedimentoDaOpme([item()], 0)).toEqual([]);
    expect(conferirProcedimentoDaOpme([item(), opme], 0)).toHaveLength(1);
    expect(conferirProcedimentoDaOpme([item({ itemFaturavel: 7 }), opme], 0)).toEqual([]);
    expect(conferirProcedimentoDaOpme([opme], 0)).toHaveLength(1);
    expect(conferirProcedimentoDaOpme([opme], 1)).toEqual([]);
  });

  it('recusa na hora a guia de SP/SADT ou internação só com OPME', () => {
    const opme = item({ opme: true, registroAnvisa: '80000000001' });
    const sp = conferirPedidoAutorizacao(pedido({ itens: [opme] }));
    expect(sp.map((p) => p.mensagem).join(' ')).toMatch(/ao menos um procedimento além da OPME/);
    expect(
      conferirPedidoAutorizacao(pedido({ canal: 'portal', itens: [opme] })).map((p) => p.campo),
    ).toContain('itens');
    expect(conferirPedidoAutorizacao(pedido({ itens: [item(), opme] }))).toEqual([]);
  });

  it('segue as transições e o intervalo da consulta do andamento', () => {
    expect(podeMudar('rascunho', 'enviada')).toBe(true);
    expect(podeMudar('rascunho', 'pronta_envio')).toBe(true);
    expect(podeMudar('pronta_envio', 'enviada')).toBe(true);
    expect(podeMudar('pronta_envio', 'cancelada')).toBe(true);
    expect(podeMudar('pronta_envio', 'autorizada')).toBe(false);
    expect(podeMudar('enviada', 'autorizada')).toBe(true);
    expect(podeMudar('negada', 'autorizada')).toBe(false);
    expect(podeMudar('autorizada', 'rascunho')).toBe(false);
    const t0 = new Date('2026-11-24T12:00:00Z');
    expect(proximaConsultaAndamento(1, t0).toISOString()).toBe('2026-11-24T12:30:00.000Z');
    expect(proximaConsultaAndamento(3, t0).toISOString()).toBe('2026-11-24T14:00:00.000Z');
    expect(proximaConsultaAndamento(20, t0).toISOString()).toBe('2026-11-25T12:00:00.000Z');
  });
});

describe('resposta da operadora', () => {
  const pedidos = [
    { sequencia: 1, quantidade: 2 },
    { sequencia: 2, quantidade: 1 },
  ];
  const base = {
    situacao: null,
    senha: 'S123',
    numeroGuiaOperadora: null,
    dataAutorizacao: '2026-11-24',
    senhaValidade: '2026-12-24',
  };
  const it1 = (q: number, motivo: string | null = null) => ({
    sequencia: 1,
    quantidadeAutorizada: q,
    valorAutorizado: null,
    motivoNegativa: motivo,
    motivoGlosa: null,
  });
  const it2 = (q: number, motivo: string | null = null) => ({ ...it1(q, motivo), sequencia: 2 });

  it('deriva a situação do pedido pelos itens', () => {
    expect(lerRespostaAutorizacao(pedidos, { ...base, itens: [it1(2), it2(1)] })).toMatchObject({
      situacao: 'autorizado',
      solicitacao: 'autorizada',
      problemas: [],
    });
    const p = lerRespostaAutorizacao(pedidos, {
      ...base,
      itens: [it1(1), it2(0, 'Sem cobertura contratual')],
    });
    expect(p).toMatchObject({
      situacao: 'autorizado_parcial',
      solicitacao: 'autorizada_parcial',
      problemas: [],
    });
    expect(p.itens.map((i) => i.situacao)).toEqual(['autorizado_parcial', 'negado']);
    expect(
      lerRespostaAutorizacao(pedidos, { ...base, senha: null, itens: [it1(0, 'x'), it2(0, 'y')] }),
    ).toMatchObject({ situacao: 'negado', solicitacao: 'negada', problemas: [] });
    expect(
      lerRespostaAutorizacao(pedidos, { ...base, situacao: 'aguardando_documentacao', itens: [] }),
    ).toMatchObject({ solicitacao: 'em_analise', problemas: [] });
  });

  it('recusa a resposta incoerente', () => {
    const campos = (r: Parameters<typeof lerRespostaAutorizacao>[1]) =>
      lerRespostaAutorizacao(pedidos, r).problemas.map((x) => x.campo);
    expect(campos({ ...base, itens: [it1(3), it2(1)] })).toContain('itens.0');
    expect(campos({ ...base, itens: [it1(2)] })).toContain('itens');
    expect(campos({ ...base, itens: [it1(2), it2(0)] })).toContain('itens.1');
    expect(campos({ ...base, senha: null, itens: [it1(2), it2(1)] })).toContain('senha');
    expect(campos({ ...base, senhaValidade: '2026-11-01', itens: [it1(2), it2(1)] })).toContain(
      'senhaValidade',
    );
    expect(campos({ ...base, situacao: 'autorizado', itens: [] })).toContain('itens');
  });
});

describe('mensagem SOLICITACAO_PROCEDIMENTOS (TISS 04.03.00)', () => {
  let esquemas: ArquivoEsquema[];
  beforeAll(async () => {
    esquemas = await carregarEsquemas();
  }, 60_000);
  const dados = (x: Partial<DadosMensagemSolicitacao> = {}): DadosMensagemSolicitacao => ({
    tipo: 'sp_sadt',
    sequencialTransacao: '17',
    data: '2026-11-24',
    hora: '10:15:00',
    registroAns: '999999',
    codigoPrestador: 'HSINT01',
    nomeContratado: 'Hospital sintético',
    cnes: '1234567',
    numeroGuia: 'SA-17',
    numeroGuiaPrincipal: null,
    carteira: 'SINT0001',
    recemNascido: false,
    solicitante: {
      nome: 'Profissional sintético',
      conselho: '06',
      numeroConselho: '12345',
      uf: '35',
      cbo: '225125',
      telefone: '1130000000',
    },
    urgencia: false,
    indicacaoClinica: 'Indicação sintética',
    regime: null,
    tipoInternacao: null,
    diarias: null,
    dataAdmissao: null,
    cids: [],
    acidente: null,
    observacao: null,
    itens: [{ ...item({ quantidade: 2 }), opcaoFabricante: null }],
    ...x,
  });

  it('SP/SADT válida no XSD, com o hash do epílogo', async () => {
    const m = mensagemSolicitacaoAutorizacao(dados());
    const v = await validarNoXsd(m.bytes, esquemas);
    expect(v.erros).toEqual([]);
    expect(v.valido).toBe(true);
    expect(conferirHashEpilogo(iso88591(m.bytes)).confere).toBe(true);
    expect(m.xml).toContain('<ans:solicitacaoSP-SADT>');
  });

  it('internação com o anexo de OPME válida no XSD', async () => {
    const m = mensagemSolicitacaoAutorizacao(
      dados({
        tipo: 'internacao',
        regime: 'hospitalar',
        tipoInternacao: '2',
        diarias: 3,
        dataAdmissao: '2026-11-26',
        cids: ['M17.1'],
        acidente: 'nao_acidente',
        itens: [
          { ...item(), opcaoFabricante: null },
          {
            ...item({
              codigoTabela: '19',
              codigoProcedimento: '70000001',
              opme: true,
              registroAnvisa: '80000000001',
              valorUnitario: 1234.5,
            }),
            opcaoFabricante: 1,
          },
        ],
      }),
    );
    const v = await validarNoXsd(m.bytes, esquemas);
    expect(v.erros).toEqual([]);
    expect(m.xml).toContain('<ans:solicitacaoOPME>');
    expect(m.xml).toContain('<ans:indicadorOPME>S</ans:indicadorOPME>');
  });

  it('prorrogação da internação válida no XSD, com o anexo de OPME e a guia referenciada', async () => {
    const m = mensagemSolicitacaoAutorizacao(
      dados({
        tipo: 'prorrogacao',
        numeroGuiaPrincipal: 'SA000123',
        diarias: 2,
        indicacaoClinica: 'Evolução sintética que pede mais dias',
        itens: [
          { ...item(), opcaoFabricante: null },
          {
            ...item({
              codigoTabela: '19',
              codigoProcedimento: '70000001',
              opme: true,
              registroAnvisa: '80000000001',
            }),
            opcaoFabricante: 1,
          },
        ],
      }),
    );
    const v = await validarNoXsd(m.bytes, esquemas);
    expect(v.erros).toEqual([]);
    expect(m.xml).toContain('<ans:solicitacaoProrrogacao>');
    expect(m.xml).toContain('<ans:nrGuiaReferenciada>SA000123</ans:nrGuiaReferenciada>');
    expect(m.xml).toContain('<ans:qtDiariasAdicionais>2</ans:qtDiariasAdicionais>');
    expect(m.xml).toContain('<ans:anexoClinicoProrrogacao>');
    // Só diárias, sem procedimento adicional, também é guia válida.
    const soDiarias = mensagemSolicitacaoAutorizacao(
      dados({
        tipo: 'prorrogacao',
        numeroGuiaPrincipal: 'SA000123',
        diarias: 3,
        indicacaoClinica: 'Sintética',
        itens: [],
      }),
    );
    expect((await validarNoXsd(soDiarias.bytes, esquemas)).erros).toEqual([]);
    expect(faltasParaMensagem(dados({ tipo: 'prorrogacao', indicacaoClinica: null }))).toEqual(
      expect.arrayContaining([
        'número da guia da internação que se prorroga',
        'indicação clínica da prorrogação',
      ]),
    );
  });

  it('lista o que falta e não monta a mensagem incompleta', () => {
    const d = dados({ registroAns: '', solicitante: { ...dados().solicitante, cbo: '' } });
    expect(faltasParaMensagem(d)).toEqual([
      'registro da operadora na agência reguladora',
      'CBO do solicitante',
    ]);
    expect(() => mensagemSolicitacaoAutorizacao(d)).toThrow(/Faltam dados/);
    const soOpme = dados().itens.map((i) => ({ ...i, opme: true, registroAnvisa: '80000000001' }));
    expect(faltasParaMensagem(dados({ itens: soOpme }))).toContain('ao menos um procedimento além da OPME');
    expect(() => mensagemSolicitacaoAutorizacao(dados({ itens: soOpme }))).toThrow(/Faltam dados/);
    expect(faltasParaMensagem(dados({ tipo: 'radioterapia' }))).toContain(
      'tipo sem mensagem eletrônica (use o portal)',
    );
  });
});

describe('hipóteses diagnósticas do pedido', () => {
  const d = (
    cid: string,
    x: Partial<{ tempo: number | null; unidadeTempo: 'dia' | 'mes' | 'ano' | null }> = {},
  ) => ({
    cid,
    tipoDoenca: null,
    tempo: null,
    unidadeTempo: null,
    ...x,
  });
  it('normaliza a CID-10 e recusa o que não tem a forma', () => {
    expect(cidDoPedido('m17.1')).toBe('M171');
    expect(cidDoPedido('I10')).toBe('I10');
    expect(cidDoPedido('17.1')).toBeNull();
  });
  it('internação pede o CID; até quatro, sem repetir, tempo com unidade', () => {
    expect(conferirDiagnosticosAutorizacao('sp_sadt', [])).toEqual([]);
    expect(conferirDiagnosticosAutorizacao('internacao', []).map((x) => x.campo)).toEqual(['diagnosticos']);
    expect(
      conferirDiagnosticosAutorizacao('internacao', [
        d('M17.1'),
        d('I10', { tempo: 2, unidadeTempo: 'ano' }),
      ]),
    ).toEqual([]);
    const campos = conferirDiagnosticosAutorizacao('internacao', [
      d('M17.1'),
      d('M171'),
      d('XX'),
      d('I10', { tempo: 3 }),
      d('E11'),
    ]).map((x) => x.campo);
    expect(campos).toEqual(
      expect.arrayContaining(['diagnosticos', 'diagnosticos.1', 'diagnosticos.2', 'diagnosticos.3']),
    );
  });
});

describe('autorização ligada aos itens da conta', () => {
  it('cobre os itens do mesmo faturável até a quantidade autorizada, sem duplicar ao refazer', () => {
    const autorizados = [
      { respostaItem: 10, sequencia: 1, itemFaturavel: 7, quantidadeAutorizada: 3, jaCoberta: 0 },
      { respostaItem: 11, sequencia: 2, itemFaturavel: null, quantidadeAutorizada: 1, jaCoberta: 0 },
    ];
    const conta = [
      { contaItem: 100, itemFaturavel: 7, quantidade: 2, jaCoberta: 0 },
      { contaItem: 101, itemFaturavel: 8, quantidade: 1, jaCoberta: 0 },
      { contaItem: 102, itemFaturavel: 7, quantidade: 2, jaCoberta: 0 },
    ];
    const r = casarAutorizacaoComConta(autorizados, conta);
    expect(r.ligacoes).toEqual([
      { contaItem: 100, respostaItem: 10, sequencia: 1, quantidadeCoberta: 2 },
      { contaItem: 102, respostaItem: 10, sequencia: 1, quantidadeCoberta: 1 },
    ]);
    expect(r.semCobertura).toEqual([101, 102]);
    const de_novo = casarAutorizacaoComConta(
      [{ ...autorizados[0]!, jaCoberta: 3 }],
      conta.map((c) => ({ ...c, jaCoberta: c.contaItem === 100 ? 2 : c.contaItem === 102 ? 1 : 0 })),
    );
    expect(de_novo.ligacoes).toEqual([]);
  });
});
