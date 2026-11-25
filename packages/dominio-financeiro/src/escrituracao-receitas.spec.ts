// F3.8, 07-FIN linha 108: o lado das receitas da EFD-Contribuições: a receita das notas de serviço autorizadas, a
// contribuição apurada por regime (M200/M210 e M600/M610), o crédito descontado, a retenção e o bloco A das notas
// emitidas (massa sintética; nenhuma nota nem pessoa real).
import { describe, expect, it } from 'vitest';
import {
  conferirGeracaoEfd,
  conferirSomasEfd,
  type DocumentoEfd,
  montarEfdContribuicoes,
  type PedidoEfd,
} from './escrituracao-entrada.js';
import {
  apurarContribuicoes,
  type ReceitaServicoEfd,
  repartirCreditoDescontado,
} from './escrituracao-receitas.js';

const nota = (x: Partial<ReceitaServicoEfd> = {}): ReceitaServicoEfd => ({
  id: 1,
  numero: '501',
  serie: 'A1',
  chave: null,
  dataEmissao: '2026-10-10',
  tipoTomador: 'pessoa_juridica',
  tomadorDocumento: '92070000000280',
  tomadorNome: 'OPERADORA SINTETICA',
  situacao: 'autorizada',
  valorServicos: 10000,
  valorDesconto: 0,
  valorIss: 200,
  pisRetido: 65,
  cofinsRetido: 300,
  ...x,
});
const notas = [
  nota(),
  nota({
    id: 2,
    numero: '502',
    tipoTomador: 'pessoa_fisica',
    tomadorDocumento: null,
    tomadorNome: 'TOMADOR SINTETICO',
    valorServicos: 5000,
    valorDesconto: 1000,
    pisRetido: 0,
    cofinsRetido: 0,
  }),
];
// Entrada com crédito: base 1000, PIS 16,50 (1,65%) e COFINS 76,00 (7,6%).
const entrada: DocumentoEfd = {
  id: 9,
  servico: true,
  participanteDocumento: '92070000000107',
  participanteNome: 'FORNECEDOR SINTETICO',
  modelo: '99',
  serie: null,
  numero: '77',
  chave: null,
  dataEmissao: '2026-10-05',
  dataEntrada: '2026-10-06',
  situacaoDocumento: '00',
  valorDocumento: 1000,
  valorDesconto: 0,
  valorPis: 16.5,
  valorCofins: 76,
  itens: [
    {
      sequencia: 1,
      cfop: '1933',
      cstPis: '50',
      basePis: 1000,
      aliquotaPis: 1.65,
      cstCofins: '50',
      baseCofins: 1000,
      aliquotaCofins: 7.6,
      naturezaCredito: '03',
      valorItem: 1000,
      valorDesconto: 0,
      valorPis: 16.5,
      valorCofins: 76,
      codigoItem: 'SINT-1',
      descricao: 'SERVICO SINTETICO',
      quantidade: 1,
      unidade: null,
    },
  ],
};
const pedido = (x: Partial<PedidoEfd> = {}): PedidoEfd => ({
  declarante: {
    cnpj: '92070000000199',
    nome: 'HOSPITAL SINTETICO',
    uf: 'SP',
    codigoMunicipio: '3550308',
    inscricaoEstadual: null,
    inscricaoMunicipal: null,
  },
  periodo: '2026-10',
  regime: 'nao_cumulativo',
  reciboAnterior: null,
  documentos: [entrada],
  receitas: notas,
  ...x,
});
const linhasDe = (p: PedidoEfd) => montarEfdContribuicoes(p).conteudo.trimEnd().split('\r\n');
const reg = (ls: string[], r: string) => ls.filter((l) => l.startsWith(`|${r}|`));

describe('apuração da contribuição sobre a receita', () => {
  it('não cumulativo: base 15000 - 1000 = 14000; PIS 1,65% = 231,00 e COFINS 7,6% = 1064,00; o crédito e a retenção descontam', () => {
    const a = apurarContribuicoes('nao_cumulativo', notas, { pis: 16.5, cofins: 76 });
    expect(a.regimeReceita).toBe('nao_cumulativo');
    expect(a.pis).toEqual({
      codigoContribuicao: '01',
      aliquota: 1.65,
      receitaBruta: 15000,
      base: 14000,
      apurada: 231,
      creditoDisponivel: 16.5,
      creditoDescontado: 16.5,
      saldoCredito: 0,
      retido: 65,
      retencaoDescontada: 65,
      // 231,00 - 16,50 - 65,00 = 149,50
      aRecolher: 149.5,
    });
    // 1064,00 - 76,00 - 300,00 = 688,00
    expect(a.cofins).toMatchObject({ apurada: 1064, creditoDescontado: 76, aRecolher: 688 });
  });

  it('misto e cumulativo: a receita hospitalar é cumulativa (0,65% e 3%, código 51); o crédito não desconta e fica como saldo', () => {
    const a = apurarContribuicoes('misto', notas, { pis: 16.5, cofins: 76 });
    expect(a.regimeReceita).toBe('cumulativo');
    // 14000 x 0,65% = 91,00 - 65,00 retido = 26,00; 14000 x 3% = 420,00 - 300,00 = 120,00.
    expect(a.pis).toMatchObject({
      codigoContribuicao: '51',
      apurada: 91,
      creditoDescontado: 0,
      saldoCredito: 16.5,
      aRecolher: 26,
    });
    expect(a.cofins).toMatchObject({ apurada: 420, saldoCredito: 76, aRecolher: 120 });
    expect(apurarContribuicoes('cumulativo', notas, { pis: 0, cofins: 0 }).pis.apurada).toBe(91);
  });

  it('a retenção e o crédito nunca passam do devido; a nota aguardando não é receita', () => {
    const a = apurarContribuicoes(
      'nao_cumulativo',
      [nota({ valorServicos: 1000, pisRetido: 50 }), nota({ id: 3, situacao: 'aguardando' })],
      { pis: 10, cofins: 500 },
    );
    // PIS: 16,50 - 10,00 = 6,50 devido; retenção de 50,00 limitada a 6,50.
    expect(a.pis).toMatchObject({
      apurada: 16.5,
      creditoDescontado: 10,
      retencaoDescontada: 6.5,
      aRecolher: 0,
    });
    // COFINS: 76,00 apurada; crédito de 500,00 desconta só 76,00 e sobra 424,00.
    expect(a.cofins).toMatchObject({ creditoDescontado: 76, saldoCredito: 424, aRecolher: 0 });
    expect(a).toMatchObject({ notas: 1, aguardando: 1 });
    expect(repartirCreditoDescontado([10, 20, 5], 25)).toEqual([
      { descontado: 10, saldo: 0 },
      { descontado: 15, saldo: 5 },
      { descontado: 0, saldo: 5 },
    ]);
  });
});

describe('arquivo da EFD-Contribuições com as receitas', () => {
  it('gera só com receita; recusa a competência com nota aguardando a autorização', () => {
    const gerar = (p: PedidoEfd) => conferirGeracaoEfd(p, conferirSomasEfd(p.documentos))?.codigo ?? null;
    expect(gerar(pedido({ documentos: [] }))).toBeNull();
    expect(gerar(pedido({ documentos: [], receitas: [] }))).toBe('competencia-sem-entrada');
    expect(gerar(pedido({ receitas: [...notas, nota({ id: 7, situacao: 'aguardando' })] }))).toBe(
      'receita-pendente',
    );
  });

  it('bloco A com as notas emitidas; M100 com o crédito descontado; M200/M210 e M600/M610 com a contribuição', () => {
    const ls = linhasDe(pedido());
    // Participante só o tomador pessoa jurídica (e o fornecedor da entrada); a pessoa física não vai ao arquivo.
    expect(reg(ls, '0150').map((l) => l.split('|')[2])).toEqual(['92070000000107', '92070000000280']);
    const saidas = reg(ls, 'A100').filter((l) => l.startsWith('|A100|1|'));
    expect(saidas).toEqual([
      '|A100|1|0|92070000000280|00|A1||501||10102026|10102026|10000,00|9|0,00|10000,00|165,00|10000,00|760,00|65,00|300,00|200,00|',
      '|A100|1|0||00|A1||502||10102026|10102026|5000,00|9|1000,00|4000,00|66,00|4000,00|304,00|0,00|0,00|200,00|',
    ]);
    expect(reg(ls, 'A170').filter((l) => l.includes('|SERVICO-SAUDE|')).length).toBe(2);
    expect(reg(ls, 'M100')).toEqual([
      '|M100|101|0|1000,00|1,6500|||16,50|0,00|0,00|0,00|16,50|0|16,50|0,00|',
    ]);
    expect(reg(ls, 'M200')).toEqual([
      '|M200|231,00|16,50|0,00|214,50|65,00|0,00|149,50|0,00|0,00|0,00|0,00|149,50|',
    ]);
    expect(reg(ls, 'M210')).toEqual([
      '|M210|01|15000,00|14000,00|0,00|0,00|14000,00|1,6500|||231,00|0,00|0,00|0,00|0,00|231,00|',
    ]);
    expect(reg(ls, 'M600')).toEqual([
      '|M600|1064,00|76,00|0,00|988,00|300,00|0,00|688,00|0,00|0,00|0,00|0,00|688,00|',
    ]);
    expect(reg(ls, 'M610')[0]).toContain('|01|15000,00|14000,00|0,00|0,00|14000,00|7,6000|||1064,00|');
    // A ordem do bloco M: crédito do PIS, contribuição do PIS, crédito da COFINS, contribuição da COFINS.
    expect(ls.filter((l) => /^\|M[1-6]\d0\|/.test(l)).map((l) => l.slice(1, 5))).toEqual([
      'M100',
      'M200',
      'M210',
      'M500',
      'M600',
      'M610',
    ]);
    // O 9900 conta cada registro e o 9999 o total de linhas.
    for (const l of reg(ls, '9900')) {
      const [, , r, n] = l.split('|');
      expect(reg(ls, r!).length, r).toBe(Number(n));
    }
    expect(ls.at(-1)).toBe(`|9999|${ls.length}|`);
  });

  it('misto: M200 cumulativo com o código 51; o crédito fica como saldo (desconto parcial); cumulativo detalhado no 0110', () => {
    const ls = linhasDe(pedido({ regime: 'misto' }));
    expect(reg(ls, 'M100')[0]).toMatch(/\|16,50\|1\|0,00\|16,50\|$/);
    expect(reg(ls, 'M200')).toEqual([
      '|M200|0,00|0,00|0,00|0,00|0,00|0,00|0,00|91,00|65,00|0,00|26,00|26,00|',
    ]);
    expect(reg(ls, 'M210')[0]).toContain('|M210|51|15000,00|14000,00|');
    const cum = linhasDe(pedido({ regime: 'cumulativo', documentos: [] }));
    expect(reg(cum, '0110')).toEqual(['|0110|2||1|9|']);
    expect(reg(cum, 'M600')[0]).toBe(
      '|M600|0,00|0,00|0,00|0,00|0,00|0,00|0,00|420,00|300,00|0,00|120,00|120,00|',
    );
  });

  it('sem receita: o arquivo das entradas continua igual no bloco A e o M200 sai zerado com o crédito em saldo', () => {
    const ls = linhasDe(pedido({ receitas: [] }));
    expect(reg(ls, 'A100').length).toBe(1);
    expect(reg(ls, 'M210').length).toBe(0);
    expect(reg(ls, 'M200')[0]).toBe('|M200|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|');
    expect(reg(ls, 'M100')[0]).toMatch(/\|16,50\|1\|0,00\|16,50\|$/);
  });
});
