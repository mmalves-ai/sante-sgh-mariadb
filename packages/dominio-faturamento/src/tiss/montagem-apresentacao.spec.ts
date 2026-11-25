// 06-FAT linha 30: regras do montador pela apresentação da fonte pagadora (padrão TISS 4.x). Massa SINTÉTICA (CNPJ e CPF
// de exemplo, válidos só pelo dígito). Prova: o contratado por CNPJ ou CPF sai no elemento da escolha do padrão e o
// lote de cada tipo de guia continua com 0 erro no XSD oficial; a numeração dá número só a quem não tem e recusa o
// repetido; a quebra do resumo e a separação da SP/SADT repartem os itens sem somar nem perder valor.
import type { ContaTiss, ItemContaTiss } from '@sgh/contratos';
import { beforeAll, describe, expect, it } from 'vitest';
import { cabecalho, consulta, honorario, recurso, resumoInternacao, spSadt } from './fixtures.spec-util.js';
import { mensagemLoteGuias, mensagemRecursoGlosa } from './lote.js';
import {
  centavosDaConta,
  cnpjValido,
  cpfValido,
  identificacaoContratado,
  numerarGuias,
  quebrarResumoInternacao,
  separarSpSadt,
} from './montagem-apresentacao.js';
import { type ArquivoEsquema, carregarEsquemas, validarNoXsd } from './validacao.js';

const CNPJ = '11222333000181';
const CPF = '52998224725';

const item = (seq: number, data: string, valor = 10): ItemContaTiss => ({
  sequencial: seq,
  tipo: 4,
  natureza: 'material',
  data,
  codigo: `C${seq}`,
  codigoTabela: '19',
  descricao: `ITEM ${seq}`,
  quantidade: 1,
  valorUnitario: valor,
});
const conta = (itens: ItemContaTiss[], x: Partial<ContaTiss> = {}): ContaTiss =>
  ({
    conta: 7,
    tipoGuia: 3,
    numeroGuia: 'G-7',
    carteira: 'X',
    atendimentoRN: false,
    inicio: { data: '2026-10-01', hora: '08:00:00' },
    fim: { data: '2026-10-20', hora: '10:00:00' },
    caraterAtendimento: '1',
    tipoConsulta: '1',
    tipoAtendimento: '07',
    senha: '',
    guiaSolicitacao: '',
    dataAutorizacao: '',
    tipoFaturamento: '4',
    tipoInternacao: '1',
    regimeInternacao: '1',
    motivoEncerramento: '12',
    profissional: { conselho: '06', numeroConselho: '1', uf: '33', cbos: '225125' },
    profissionalNome: '',
    profissionalCodigo: '',
    itens,
    ...x,
  }) as ContaTiss;

let esquemas: ArquivoEsquema[];
beforeAll(async () => {
  esquemas = await carregarEsquemas();
});

describe('identificação do contratado (CNPJ, CPF ou código na operadora)', () => {
  it('confere o dígito verificador e recusa a sequência repetida', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11222333000182')).toBe(false);
    expect(cnpjValido('11111111111111')).toBe(false);
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('52998224726')).toBe(false);
    expect(cpfValido('00000000000')).toBe(false);
  });

  it('a escolha devolve a identificação ou o erro em português', () => {
    expect(identificacaoContratado('cnpj', 'X', '11.222.333/0001-81')).toEqual({
      identificacao: { tipo: 'cnpj', valor: CNPJ },
      erro: null,
    });
    expect(identificacaoContratado('cpf', 'X', '123').erro).toMatch(/CPF do contratado não confere/);
    expect(identificacaoContratado('codigo', ' 9988 ', null).identificacao).toEqual({
      tipo: 'codigo',
      valor: '9988',
    });
    expect(identificacaoContratado('codigo', '123456789012345', null).erro).toMatch(/1 a 14/);
  });

  it.each([
    ['cnpj', CNPJ, 'cnpjContratado', '<ans:CNPJ>'],
    ['cpf', CPF, 'cpfContratado', '<ans:CPF>'],
  ] as const)(
    'por %s: elemento da escolha do padrão e 0 erro no XSD em toda guia',
    async (tipo, valor, el, origem) => {
      const cab = { ...cabecalho, identificacao: { tipo, valor } };
      const lotes = [
        mensagemLoteGuias(cab, '3001', [consulta]),
        mensagemLoteGuias(cab, '3002', [spSadt]),
        mensagemLoteGuias(cab, '3003', [resumoInternacao]),
        mensagemLoteGuias(cab, '3004', [honorario]),
        mensagemRecursoGlosa(cab, recurso),
      ];
      for (const m of lotes) {
        const xml = new TextDecoder('latin1').decode(m.bytes);
        expect(xml).toContain(origem);
        expect((await validarNoXsd(m.bytes, esquemas)).erros).toEqual([]);
      }
      const sp = new TextDecoder('latin1').decode(lotes[1]!.bytes);
      expect(sp).toContain(`<ans:${el}>${valor}</ans:${el}>`);
      expect(sp).not.toContain('codigoPrestadorNaOperadora');
    },
  );

  it('honorário por CNPJ: o local executante leva o CNPJ', () => {
    const m = mensagemLoteGuias({ ...cabecalho, identificacao: { tipo: 'cnpj', valor: CNPJ } }, '3005', [
      honorario,
    ]);
    expect(new TextDecoder('latin1').decode(m.bytes)).toContain(`<ans:cnpjLocalExecutante>${CNPJ}`);
  });
});

describe('numeração da guia do prestador', () => {
  it('só a guia sem número recebe o próximo da série; devolve o seguinte', () => {
    const r = numerarGuias([{ numeroGuia: '' }, { numeroGuia: 'H-1' }, { numeroGuia: ' ' }], {
      prefixo: 'HS',
      proximo: 41,
      largura: 6,
    });
    expect(r.guias.map((g) => g.numeroGuia)).toEqual(['HS000041', 'H-1', 'HS000042']);
    expect(r.proximo).toBe(43);
    expect(r.erros).toEqual([]);
  });

  it('recusa o número repetido e a série acima de 20 caracteres', () => {
    expect(
      numerarGuias([{ numeroGuia: 'HS000041' }, { numeroGuia: '' }], {
        prefixo: 'HS',
        proximo: 41,
        largura: 6,
      }).erros,
    ).toEqual(['O número de guia HS000041 se repete no lote.']);
    expect(
      numerarGuias([{ numeroGuia: '' }], { prefixo: 'PREFIXO-LONGO-', proximo: 1, largura: 8 }).erros[0],
    ).toMatch(/passa de 20 caracteres/);
  });
});

describe('quebra do resumo de internação e separação da SP/SADT', () => {
  const itens = [
    item(1, '2026-10-02'),
    item(2, '2026-10-09', 25.5),
    item(3, '2026-10-15'),
    item(4, '2026-10-20', 3),
  ];

  it('corte por datas: parcial nas primeiras, final na última, itens no seu período, total preservado', () => {
    const c = conta(itens);
    const partes = quebrarResumoInternacao(c, ['2026-10-10', '2026-10-05', '2026-11-30']);
    expect(partes.map((p) => p.numeroGuia)).toEqual(['G-7-1', 'G-7-2', 'G-7-3']);
    expect(partes.map((p) => p.tipoFaturamento)).toEqual(['1', '1', '2']);
    expect(partes.map((p) => p.itens.map((i) => i.sequencial))).toEqual([[1], [2], [3, 4]]);
    expect(partes[0]!.inicio).toEqual(c.inicio);
    expect(partes[0]!.fim).toEqual({ data: '2026-10-05', hora: '23:59:59' });
    expect(partes[1]!.inicio).toEqual({ data: '2026-10-06', hora: '00:00:00' });
    expect(partes[2]!.fim).toEqual(c.fim);
    expect(partes.reduce((s, p) => s + centavosDaConta(p), 0)).toBe(centavosDaConta(c));
  });

  it('sem corte dentro da internação, ou parte única com itens, a conta fica como está', () => {
    const c = conta(itens);
    expect(quebrarResumoInternacao(c, ['2026-09-01', '2026-10-20'])).toEqual([c]);
    expect(quebrarResumoInternacao(conta([item(1, '2026-10-02')]), ['2026-10-10'])).toHaveLength(1);
    expect(quebrarResumoInternacao(conta(itens, { tipoGuia: 2 }), ['2026-10-10'])).toHaveLength(1);
  });

  it('SP/SADT por data: uma guia por dia, em ordem; por prestador: uma por executante, sem chave fica com a conta', () => {
    const sp = conta([item(1, '2026-10-03'), item(2, '2026-10-02'), item(3, '2026-10-03')], { tipoGuia: 2 });
    const porData = separarSpSadt(sp, 'data');
    expect(porData.map((p) => [p.numeroGuia, p.inicio.data, p.itens.map((i) => i.sequencial)])).toEqual([
      ['G-7-1', '2026-10-02', [2]],
      ['G-7-2', '2026-10-03', [1, 3]],
    ]);
    const porPrestador = separarSpSadt(sp, 'prestador', [10, null, 10]);
    expect(porPrestador.map((p) => p.itens.map((i) => i.sequencial))).toEqual([[1, 3], [2]]);
    expect(porPrestador.reduce((s, p) => s + centavosDaConta(p), 0)).toBe(centavosDaConta(sp));
    expect(separarSpSadt(sp, 'prestador', [5, 5, 5])).toEqual([sp]);
  });

  it('número longo: o sufixo da parte cabe nos 20 caracteres', () => {
    const c = conta(itens, { numeroGuia: '12345678901234567890' });
    const partes = quebrarResumoInternacao(c, ['2026-10-10']);
    expect(partes.map((p) => p.numeroGuia)).toEqual(['123456789012345678-1', '123456789012345678-2']);
  });
});
