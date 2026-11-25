// F3.8, 07-FIN linha 108: a classificação fiscal do item da entrada, a conferência das somas e o arquivo da
// EFD-Contribuições (massa sintética; nenhum documento real).
import { describe, expect, it } from 'vitest';
import {
  type ClassificacaoFiscalItem,
  conferirClassificacaoItem,
  conferirEntregaEfd,
  conferirGeracaoEfd,
  conferirSomasEfd,
  creditoDoItem,
  type DocumentoEfd,
  type ItemEfd,
  montarEfdContribuicoes,
  type PedidoEfd,
  pendenciasDoItem,
  totaisDoDocumento,
} from './escrituracao-entrada.js';

const classe = (x: Partial<ClassificacaoFiscalItem> = {}): ClassificacaoFiscalItem => ({
  sequencia: 1,
  cfop: '1556',
  cstPis: '50',
  basePis: 1000,
  aliquotaPis: 1.65,
  cstCofins: '50',
  baseCofins: 1000,
  aliquotaCofins: 7.6,
  naturezaCredito: '02',
  ...x,
});
const item = (x: Partial<ItemEfd> = {}): ItemEfd => ({
  ...classe(),
  valorItem: 1000,
  valorDesconto: 0,
  valorPis: 16.5,
  valorCofins: 76,
  codigoItem: 'SINT-1',
  descricao: 'ITEM SINTETICO',
  quantidade: 10,
  unidade: 'UN',
  ...x,
});
const doc = (x: Partial<DocumentoEfd> = {}): DocumentoEfd => ({
  id: 1,
  servico: false,
  participanteDocumento: '92070000000107',
  participanteNome: 'FORNECEDOR SINTETICO',
  modelo: '55',
  serie: '1',
  numero: '1001',
  chave: null,
  dataEmissao: '2026-10-05',
  dataEntrada: '2026-10-06',
  situacaoDocumento: '00',
  valorDocumento: 1000,
  valorDesconto: 0,
  valorPis: 16.5,
  valorCofins: 76,
  itens: [item()],
  ...x,
});
const pedido = (documentos: DocumentoEfd[], x: Partial<PedidoEfd> = {}): PedidoEfd => ({
  declarante: {
    cnpj: '92.070.000/0001-99',
    nome: 'HOSPITAL SINTETICO',
    uf: 'SP',
    codigoMunicipio: '3550308',
    inscricaoEstadual: null,
    inscricaoMunicipal: null,
  },
  periodo: '2026-10',
  regime: 'nao_cumulativo',
  reciboAnterior: null,
  documentos,
  ...x,
});

describe('classificação fiscal do item da entrada', () => {
  it('o crédito é a base vezes a alíquota: 1000 x 1,65% = 16,50; 1000 x 7,6% = 76,00', () => {
    expect(creditoDoItem(1000, 1.65)).toBe(16.5);
    expect(creditoDoItem(1000, 7.6)).toBe(76);
    expect(creditoDoItem(333.33, 1.65)).toBe(5.5);
    expect(conferirClassificacaoItem(classe(), 1000, 0)).toBeNull();
  });

  it('CFOP de saída, CST fora da tabela de entrada e base acima do item são recusados com o campo', () => {
    expect(conferirClassificacaoItem(classe({ cfop: '5102' }), 1000, 0)?.codigo).toBe(
      'cfop-nao-e-de-entrada',
    );
    expect(conferirClassificacaoItem(classe({ cstPis: '01' }), 1000, 0)?.codigo).toBe('cst-invalido');
    const maior = conferirClassificacaoItem(classe({ basePis: 900, baseCofins: 950.01 }), 1000, 50);
    expect(maior?.codigo).toBe('base-maior-que-item');
    expect(maior?.campos).toEqual(['baseCofins']);
    expect(conferirClassificacaoItem(classe({ aliquotaPis: null }), 1000, 0)?.codigo).toBe(
      'aliquota-obrigatoria',
    );
  });

  it('CST com crédito pede a natureza da base; CST sem crédito não leva base, alíquota nem natureza', () => {
    expect(conferirClassificacaoItem(classe({ naturezaCredito: null }), 1000, 0)?.codigo).toBe(
      'natureza-credito-obrigatoria',
    );
    expect(conferirClassificacaoItem(classe({ naturezaCredito: '19' }), 1000, 0)?.codigo).toBe(
      'natureza-credito-obrigatoria',
    );
    const sem = classe({
      cstPis: '70',
      basePis: 0,
      aliquotaPis: null,
      cstCofins: '70',
      baseCofins: 0,
      aliquotaCofins: null,
      naturezaCredito: null,
    });
    expect(conferirClassificacaoItem(sem, 1000, 0)).toBeNull();
    expect(conferirClassificacaoItem({ ...sem, basePis: 10 }, 1000, 0)?.codigo).toBe('credito-indevido');
    expect(conferirClassificacaoItem({ ...sem, naturezaCredito: '02' }, 1000, 0)?.codigo).toBe(
      'natureza-credito-indevida',
    );
  });

  it('as pendências dizem o que falta classificar', () => {
    expect(pendenciasDoItem(item())).toEqual([]);
    expect(
      pendenciasDoItem(item({ cfop: null, cstPis: null, cstCofins: null, naturezaCredito: null })),
    ).toEqual(['sem-cfop', 'sem-cst-pis', 'sem-cst-cofins']);
    expect(pendenciasDoItem(item({ naturezaCredito: null }))).toEqual(['sem-natureza-credito']);
  });
});

describe('conferência das somas da competência', () => {
  const dois = [
    doc(),
    doc({
      id: 2,
      numero: '1002',
      valorDocumento: 500,
      valorPis: 4.95,
      valorCofins: 22.8,
      itens: [
        item({ basePis: 300, baseCofins: 300, valorItem: 300, valorPis: 4.95, valorCofins: 22.8 }),
        item({
          sequencia: 2,
          valorItem: 200,
          cstPis: '70',
          basePis: 0,
          aliquotaPis: null,
          valorPis: 0,
          cstCofins: '70',
          baseCofins: 0,
          aliquotaCofins: null,
          valorCofins: 0,
          naturezaCredito: null,
        }),
      ],
    }),
  ];

  it('soma por natureza, CST e alíquota: bases 1000 + 300 = 1300; PIS 16,50 + 4,95 = 21,45; COFINS 76 + 22,80 = 98,80', () => {
    const c = conferirSomasEfd(dois);
    expect(c.liberado).toBe(true);
    expect(c.documentos).toBe(2);
    expect(c.itens).toBe(3);
    expect(c.pis).toEqual([
      { natureza: '02', cst: '50', aliquota: 1.65, base: 1300, credito: 21.45, itens: 2 },
    ]);
    expect(c.totalBaseCofins).toBe(1300);
    expect(c.totalCreditoCofins).toBe(98.8);
    expect(totaisDoDocumento(dois[1]!.itens)).toEqual({ valorPis: 4.95, valorCofins: 22.8 });
  });

  it('aponta o crédito que não é base x alíquota, o total do documento que não é a soma dos itens e o documento sem item', () => {
    const c = conferirSomasEfd([
      doc({ itens: [item({ valorPis: 17 })] }),
      doc({ id: 2, valorCofins: 80 }),
      doc({ id: 3, itens: [], valorPis: 0, valorCofins: 0 }),
    ]);
    expect(c.liberado).toBe(false);
    expect(c.divergencias.map((d) => [d.documento, d.codigo, d.tributo, d.esperado, d.encontrado])).toEqual([
      [1, 'credito-do-item', 'pis', 16.5, 17],
      [1, 'total-do-documento', 'pis', 17, 16.5],
      [2, 'total-do-documento', 'cofins', 76, 80],
      [3, 'documento-sem-item', null, 1, 0],
    ]);
  });

  it('o documento cancelado não entra na apuração nem gera pendência', () => {
    const c = conferirSomasEfd([
      doc(),
      doc({ id: 2, situacaoDocumento: '02', itens: [item({ cfop: null })] }),
    ]);
    expect(c.liberado).toBe(true);
    expect(c.totalCreditoPis).toBe(16.5);
  });
});

describe('arquivo da EFD-Contribuições', () => {
  it('recusa a geração com pendência, com soma divergente, sem entrada, sem CNPJ e com crédito no cumulativo', () => {
    const gerar = (p: PedidoEfd) => conferirGeracaoEfd(p, conferirSomasEfd(p.documentos))?.codigo ?? null;
    expect(gerar(pedido([doc()]))).toBeNull();
    expect(gerar(pedido([]))).toBe('competencia-sem-entrada');
    expect(gerar(pedido([doc({ itens: [item({ cfop: null })] })]))).toBe('escrituracao-pendente');
    expect(gerar(pedido([doc({ valorPis: 1 })]))).toBe('somas-divergentes');
    expect(gerar(pedido([doc()], { regime: 'cumulativo' }))).toBe('credito-no-regime-cumulativo');
    expect(gerar(pedido([doc()], { declarante: { ...pedido([]).declarante, cnpj: '' } }))).toBe(
      'declarante-sem-cnpj',
    );
  });

  it('blocos 0, A, C, M e 9: os registros contados no 9900 batem com as linhas e o 9999 com o total', () => {
    const servico = doc({
      id: 2,
      servico: true,
      modelo: '99',
      numero: '77',
      participanteDocumento: '92070000017',
      participanteNome: 'PRESTADOR SINTETICO',
      valorDocumento: 400,
      valorPis: 6.6,
      valorCofins: 30.4,
      itens: [
        item({
          basePis: 400,
          baseCofins: 400,
          valorItem: 400,
          valorPis: 6.6,
          valorCofins: 30.4,
          naturezaCredito: '03',
        }),
      ],
    });
    const a = montarEfdContribuicoes(pedido([doc(), servico]));
    const linhas = a.conteudo.trimEnd().split('\r\n');
    expect(a.linhas).toBe(linhas.length);
    expect(linhas[0]).toContain('|0000|006|0||');
    expect(linhas[0]).toContain('|01102026|31102026|HOSPITAL SINTETICO|92070000000199|SP|3550308|');
    expect(linhas.at(-1)).toBe(`|9999|${linhas.length}|`);
    // Cada 9900 diz quantas linhas daquele registro o arquivo tem.
    for (const l of linhas.filter((x) => x.startsWith('|9900|'))) {
      const [, , reg, n] = l.split('|');
      expect([reg, linhas.filter((x) => x.startsWith(`|${reg!}|`)).length]).toEqual([reg, Number(n)]);
    }
    // Cada bloco fecha com a contagem das suas linhas.
    for (const b of ['0', 'A', 'C', 'M', '9']) {
      const doBloco = linhas.filter((x) => x.startsWith(`|${b}`));
      expect(doBloco.at(b === '9' ? -2 : -1)).toBe(`|${b}990|${doBloco.length}|`);
    }
    expect(linhas).toContain('|0150|92070000000107|FORNECEDOR SINTETICO|01058|92070000000107|||||||||');
    expect(linhas).toContain('|0150|92070000017|PRESTADOR SINTETICO|01058||92070000017||||||||');
    expect(linhas.find((x) => x.startsWith('|A170|'))).toContain(
      '|03|0|50|400,00|1,6500|6,60|50|400,00|7,6000|30,40|',
    );
    expect(linhas.find((x) => x.startsWith('|C170|'))).toContain('|1556|');
    // Apuração: base 1000 + 400 = 1400; PIS 16,50 + 6,60 = 23,10; COFINS 76,00 + 30,40 = 106,40.
    expect(linhas.find((x) => x.startsWith('|M100|'))).toContain('|101|0|1400,00|1,6500|||23,10|');
    expect(linhas.find((x) => x.startsWith('|M500|'))).toContain('|101|0|1400,00|7,6000|||106,40|');
    expect(linhas.filter((x) => x.startsWith('|M105|'))).toEqual([
      '|M105|02|50|1000,00||1000,00|1000,00||||',
      '|M105|03|50|400,00||400,00|400,00||||',
    ]);
    // O mesmo dado dá o mesmo arquivo (o hash confere o que foi entregue).
    expect(montarEfdContribuicoes(pedido([servico, doc()])).conteudo).toBe(a.conteudo);
  });

  it('a retificadora leva o recibo do arquivo entregue; o cancelado vai só com o cabeçalho', () => {
    const a = montarEfdContribuicoes(
      pedido([doc(), doc({ id: 2, numero: '1002', situacaoDocumento: '02' })], {
        reciboAnterior: 'REC-SINT-0001',
      }),
    );
    const linhas = a.conteudo.trimEnd().split('\r\n');
    expect(linhas[0]).toContain('|0000|006|1||REC-SINT-0001|');
    expect(linhas.filter((x) => x.startsWith('|C100|')).length).toBe(2);
    expect(linhas.filter((x) => x.startsWith('|C170|')).length).toBe(1);
    expect(a.conferencia.totalCreditoPis).toBe(16.5);
  });

  it('a entrega pede o recibo e só vale para o arquivo gerado ou validado', () => {
    expect(conferirEntregaEfd('gerado', 'REC-SINT-0001')).toBeNull();
    expect(conferirEntregaEfd('gerado', 'x')?.codigo).toBe('recibo-invalido');
    expect(conferirEntregaEfd('transmitido', 'REC-SINT-0001')?.codigo).toBe('arquivo-nao-entregavel');
    expect(conferirEntregaEfd('cancelado', 'REC-SINT-0001')?.codigo).toBe('arquivo-nao-entregavel');
  });
});
