// M56.6 (F5; ficha, regra 5): o lado da operadora no TISS 04.03.00. O lote que o hospital gera (M31) é lido pela
// operadora com os mesmos campos; o demonstrativo de análise da conta que a operadora devolve passa no XSD oficial com 0
// erro, tem o hash do epílogo conferido e é lido pelo importador de demonstrativos do hospital (M31): o ciclo fecha.
import { beforeAll, describe, expect, it } from 'vitest';
import { lerDemonstrativoXml } from './demonstrativo.js';
import {
  cabecalho,
  consulta,
  honorario,
  recurso,
  resumoInternacao,
  spSadt,
  spSadtComDespesas,
} from './fixtures.spec-util.js';
import { conferirHashEpilogo, mensagemLoteGuias, mensagemRecursoGlosa } from './lote.js';
import {
  type DemonstrativoAnalise,
  ErroLoteRecebido,
  lerLoteRecebido,
  type DemonstrativoPagamento,
  mensagemDemonstrativoAnalise,
  mensagemDemonstrativoPagamento,
} from './operadora.js';
import { type ArquivoEsquema, carregarEsquemas, conferirLote, validarNoXsd } from './validacao.js';

let esquemas: ArquivoEsquema[];
beforeAll(async () => {
  esquemas = await carregarEsquemas();
});

describe('lerLoteRecebido: o lote do hospital lido pela operadora', () => {
  it('consulta: a carteirinha, a data e o procedimento com o valor', () => {
    const l = lerLoteRecebido(mensagemLoteGuias(cabecalho, '2001', [consulta]).xml);
    expect(l).toMatchObject({
      tipoTransacao: 'ENVIO_LOTE_GUIAS',
      sequencialTransacao: '1',
      dataTransacao: '2026-10-19',
      padrao: '4.03.00',
      prestador: { tipo: 'codigo', valor: 'PRESTTESTE01' },
      registroAnsDestino: '999999',
      numeroLote: '2001',
      tipoGuia: 'consulta',
    });
    expect(l.guias).toHaveLength(1);
    expect(l.guias[0]).toMatchObject({
      registroAns: '999999',
      numeroGuiaPrestador: 'TESTE-C-0001',
      carteirinha: 'SINTETICO0000001',
      atendimentoRN: false,
      senha: null,
      carater: null,
      inicio: '2026-10-18',
      fim: '2026-10-18',
    });
    expect(l.guias[0]!.itens).toEqual([
      expect.objectContaining({ codigo: '10101012', tabela: '22', quantidade: 1, valorTotal: 150, fator: 1 }),
    ]);
  });

  it('SP/SADT com outras despesas e a senha da autorização', () => {
    const g = { ...spSadtComDespesas, autorizacao: { data: '2026-10-17', senha: '1234561234567890' } };
    const l = lerLoteRecebido(mensagemLoteGuias(cabecalho, '2002', [g]).xml);
    const guia = l.guias[0]!;
    expect(guia).toMatchObject({ tipo: 'sp-sadt', senha: '1234561234567890', carater: '1' });
    expect(guia.itens.map((i) => i.sequencial)).toEqual([1, 1, 2, 3]);
    expect(guia.itens.map((i) => [i.grupo, i.codigoDespesa, i.codigo, i.quantidade, i.valorTotal])).toEqual([
      ['procedimento', null, '40301630', 2, 24.7],
      ['despesa', '03', '70000001', 3, 13.5],
      ['despesa', '02', '90000001', 1.5, 15],
      ['despesa', '07', '60000001', 1, 25],
    ]);
    expect(guia.itens[1]).toMatchObject({
      descricao: 'MATERIAL FICTÍCIO DE TESTE',
      valorUnitario: 4.5,
      fator: 1,
    });
    expect(guia.inicio).toBe('2026-10-18');
  });

  it('SP/SADT sem autorização vem sem senha', () => {
    const l = lerLoteRecebido(mensagemLoteGuias(cabecalho, '2003', [spSadt]).xml);
    expect(l.guias[0]!.senha).toBeNull();
  });

  it('resumo de internação: a senha, o caráter e o período do faturamento', () => {
    const l = lerLoteRecebido(mensagemLoteGuias(cabecalho, '2004', [resumoInternacao]).xml);
    expect(l.guias[0]).toMatchObject({
      tipo: 'resumo-internacao',
      senha: 'SENHAFICTICIA1',
      carater: '2',
      inicio: '2026-10-10',
      fim: '2026-10-15',
    });
    expect(l.guias[0]!.itens[0]).toMatchObject({ quantidade: 5, valorUnitario: 300, valorTotal: 1500 });
  });

  it('honorário: a senha opcional e os procedimentos realizados', () => {
    const sem = lerLoteRecebido(mensagemLoteGuias(cabecalho, '2005', [honorario]).xml).guias[0]!;
    expect(sem).toMatchObject({ tipo: 'honorario', senha: null, inicio: '2026-10-10', fim: '2026-10-15' });
    expect(sem.itens[0]).toMatchObject({ codigo: '30101012', valorTotal: 480 });
    const com = lerLoteRecebido(
      mensagemLoteGuias(cabecalho, '2006', [{ ...honorario, senha: '1234561234567890' }]).xml,
    ).guias[0]!;
    expect(com.senha).toBe('1234561234567890');
  });

  it('o lote com a senha passa no XSD (as guias do hospital continuam válidas)', async () => {
    for (const m of [
      mensagemLoteGuias(cabecalho, '2007', [
        { ...spSadt, autorizacao: { data: '2026-10-17', senha: '1234561234567890' } },
      ]),
      mensagemLoteGuias(cabecalho, '2008', [{ ...honorario, senha: '1234561234567890' }]),
    ]) {
      const v = await validarNoXsd(m.bytes, esquemas);
      expect(v.erros).toEqual([]);
      expect((await conferirLote(m, esquemas)).estado).toBe('pronto');
    }
  });

  it('o que não é lote de guias é recusado com o código', () => {
    const erro = (xml: string) => {
      try {
        lerLoteRecebido(xml);
        return null;
      } catch (e) {
        return e instanceof ErroLoteRecebido ? e.codigo : 'outro';
      }
    };
    expect(erro('<html>nada</html>')).toBe('arquivo-invalido');
    expect(erro(mensagemRecursoGlosa(cabecalho, recurso).xml)).toBe('transacao-nao-e-lote');
    const misturado = mensagemLoteGuias(cabecalho, '2009', [consulta]).xml.replace(
      '</ans:guiasTISS>',
      '<ans:guiaHonorarios></ans:guiaHonorarios></ans:guiasTISS>',
    );
    expect(erro(misturado)).toBe('arquivo-invalido');
  });

  it('a origem por CPF ou CNPJ', () => {
    const xml = mensagemLoteGuias(cabecalho, '2010', [consulta]).xml;
    const comCnpj = xml.replace(
      '<ans:identificacaoPrestador><ans:codigoPrestadorNaOperadora>PRESTTESTE01</ans:codigoPrestadorNaOperadora></ans:identificacaoPrestador>',
      '<ans:identificacaoPrestador><ans:CNPJ>11222333000181</ans:CNPJ></ans:identificacaoPrestador>',
    );
    expect(lerLoteRecebido(comCnpj).prestador).toEqual({ tipo: 'cnpj', valor: '11222333000181' });
    const comCpf = comCnpj.replace('<ans:CNPJ>11222333000181</ans:CNPJ>', '<ans:CPF>52998224725</ans:CPF>');
    expect(lerLoteRecebido(comCpf).prestador).toEqual({ tipo: 'cpf', valor: '52998224725' });
  });
});

const demonstrativo = (p: Partial<DemonstrativoAnalise> = {}): DemonstrativoAnalise => ({
  sequencialTransacao: '77',
  data: '2026-10-26',
  hora: '09:15:00',
  registroAns: '999999',
  nomeOperadora: 'OPERADORA FICTÍCIA DE TESTE',
  cnpjOperadora: '11222333000181',
  numeroDemonstrativo: '202610000001',
  prestador: { tipo: 'codigo', valor: 'PRESTTESTE01' },
  cnes: '9999999',
  numeroLote: '2002',
  protocolo: '202610000001',
  dataProtocolo: '2026-10-20',
  situacao: '3',
  observacao: 'Análise concluída — glosa do material sem cobertura.',
  guias: [
    {
      numeroGuiaPrestador: 'TESTE-S-0002',
      numeroGuiaOperadora: null,
      senha: '1234561234567890',
      numeroCarteira: '9999990000000017',
      inicio: '2026-10-18',
      fim: '2026-10-18',
      situacao: '3',
      itens: [
        {
          sequencial: 1,
          data: '2026-10-18',
          tabela: '22',
          codigo: '40301630',
          descricao: 'EXAME FICTÍCIO DE TESTE',
          informado: 24.7,
          quantidade: 2,
          liberado: 24.7,
          glosas: [],
        },
        {
          sequencial: 2,
          data: '2026-10-18',
          tabela: '19',
          codigo: '70000001',
          descricao: 'MATERIAL FICTÍCIO DE TESTE',
          informado: 13.5,
          quantidade: 3,
          liberado: 4.5,
          glosas: [{ valor: 9, tipo: '1408' }],
        },
      ],
    },
  ],
  ...p,
});

describe('mensagemDemonstrativoAnalise: o demonstrativo da operadora ao prestador', () => {
  it('passa no XSD 04.03.00 com 0 erro e o hash do epílogo confere', async () => {
    const m = mensagemDemonstrativoAnalise(demonstrativo());
    expect(m.tipoTransacao).toBe('DEMONSTRATIVO_ANALISE_CONTA');
    expect((await validarNoXsd(m.bytes, esquemas)).erros).toEqual([]);
    expect(conferirHashEpilogo(m.xml).confere).toBe(true);
    expect(m.xml).toContain('<ans:valorGlosaGeral>9.00</ans:valorGlosaGeral>');
    expect(m.xml).toContain('<ans:valorLiberadoGeral>29.20</ans:valorLiberadoGeral>');
  });

  it('o importador de demonstrativos do hospital (M31) lê o que a operadora gerou', () => {
    const lido = lerDemonstrativoXml(mensagemDemonstrativoAnalise(demonstrativo()).xml);
    expect(lido).toMatchObject({ numero: '202610000001', dataEmissao: '2026-10-26', numeroLote: '2002' });
    expect(lido.itens.map((i) => [i.sequencial, i.valorInformado, i.valorPago, i.motivo])).toEqual([
      [1, 24.7, 24.7, 0],
      [2, 13.5, 4.5, 1408],
    ]);
  });

  it('destino por CPF e CNPJ, guia devolvida sem observação: XSD válido', async () => {
    for (const prestador of [
      { tipo: 'cpf', valor: '52998224725' },
      { tipo: 'cnpj', valor: '11222333000181' },
    ] as const) {
      const base = demonstrativo();
      const m = mensagemDemonstrativoAnalise({
        ...base,
        prestador,
        situacao: '4',
        observacao: null,
        cnes: '',
        guias: base.guias.map((g) => ({
          ...g,
          senha: null,
          fim: null,
          numeroGuiaOperadora: '000123',
          situacao: '4',
          itens: g.itens.map((i) => ({ ...i, liberado: 0, glosas: [{ valor: i.informado, tipo: '1001' }] })),
        })),
      });
      expect((await validarNoXsd(m.bytes, esquemas)).erros).toEqual([]);
    }
  });

  it('texto fora do ISO-8859-1 vira espaço (nunca derruba o demonstrativo)', async () => {
    const m = mensagemDemonstrativoAnalise(
      demonstrativo({ nomeOperadora: 'OPERADORA — TESTE \u{1F600}', observacao: '\u0007' }),
    );
    expect(m.xml).toContain('<ans:nomeOperadora>OPERADORA TESTE</ans:nomeOperadora>');
    expect((await validarNoXsd(m.bytes, esquemas)).erros).toEqual([]);
  });
});

const pagamento = (p: Partial<DemonstrativoPagamento> = {}): DemonstrativoPagamento => ({
  sequencialTransacao: '7',
  data: '2026-11-10',
  hora: '10:20:30',
  registroAns: '999999',
  nomeOperadora: 'OPERADORA TESTE',
  cnpjOperadora: '11222333000181',
  numeroDemonstrativo: 'P202610000001',
  prestador: { tipo: 'codigo', valor: 'PRESTTESTE01' },
  cnes: '1234567',
  pagamentos: [
    {
      data: '2026-11-09',
      forma: '1',
      protocolos: [
        {
          dataProtocolo: '2026-10-20',
          protocolo: '202610000001',
          numeroLote: '2002',
          guias: [
            {
              numeroGuiaPrestador: 'TESTE-S-0001',
              numeroGuiaOperadora: null,
              senha: '1234561234567890',
              recurso: false,
              informado: 38.2,
              liberado: 29.2,
              glosa: 9,
            },
            {
              numeroGuiaPrestador: 'TESTE-S-0002',
              numeroGuiaOperadora: '000123',
              senha: null,
              recurso: true,
              informado: 10,
              liberado: 10,
              glosa: 0,
            },
          ],
        },
      ],
    },
  ],
  observacao: 'Pagamentos: 09/11/2026 R$ 39,20.',
  ...p,
});

describe('mensagemDemonstrativoPagamento: o demonstrativo de pagamento da operadora ao prestador', () => {
  it('passa no XSD 04.03.00 com 0 erro, o hash do epílogo confere e os totais batem com as guias', async () => {
    const m = mensagemDemonstrativoPagamento(pagamento());
    expect(m.tipoTransacao).toBe('DEMONSTRATIVO_PAGAMENTO');
    expect((await validarNoXsd(m.bytes, esquemas)).erros).toEqual([]);
    expect(conferirHashEpilogo(m.xml).confere).toBe(true);
    expect(m.xml).toContain('<ans:valorInformado>48.20</ans:valorInformado>');
    expect(m.xml).toContain('<ans:liquidoPorData>39.20</ans:liquidoPorData>');
    expect(m.xml).toContain('<ans:valorLiberadoDemonstrativo>39.20</ans:valorLiberadoDemonstrativo>');
    expect(m.xml).toContain('<ans:valorGlosaBruto>9.00</ans:valorGlosaBruto>');
    expect(m.xml.match(/<ans:tipoPagamento>(\d)</g)).toEqual([
      '<ans:tipoPagamento>1<',
      '<ans:tipoPagamento>2<',
    ]);
  });

  it('dois pagamentos por data, destino por CNPJ, sem CNES nem observação: XSD válido e total somado', async () => {
    const base = pagamento();
    const m = mensagemDemonstrativoPagamento({
      ...base,
      prestador: { tipo: 'cnpj', valor: '11222333000181' },
      cnes: '',
      observacao: null,
      pagamentos: [base.pagamentos[0]!, { ...base.pagamentos[0]!, data: '2026-11-10', forma: '3' }],
    });
    expect((await validarNoXsd(m.bytes, esquemas)).erros).toEqual([]);
    expect(m.xml).toContain('<ans:valorLiberadoBruto>78.40</ans:valorLiberadoBruto>');
  });

  it('sem pagamento ou sem guia não monta (nunca um demonstrativo vazio)', () => {
    expect(() => mensagemDemonstrativoPagamento(pagamento({ pagamentos: [] }))).toThrow();
    const base = pagamento();
    expect(() =>
      mensagemDemonstrativoPagamento({
        ...base,
        pagamentos: [
          { ...base.pagamentos[0]!, protocolos: [{ ...base.pagamentos[0]!.protocolos[0]!, guias: [] }] },
        ],
      }),
    ).toThrow();
  });
});
