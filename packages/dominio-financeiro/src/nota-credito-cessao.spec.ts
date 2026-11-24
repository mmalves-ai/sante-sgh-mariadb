import { describe, expect, it } from 'vitest';
import {
  conferirCancelamentoNota,
  conferirDesfechoItem,
  desagio,
  efeitoNota,
  type EntradaCessao,
  type EntradaNota,
  planejarCessao,
  planejarNota,
} from './nota-credito-cessao.js';

const nota = (x: Partial<EntradaNota> = {}): EntradaNota => ({
  direcao: 'recebida',
  natureza: 'credito',
  lado: 'pagar',
  naturezaMotivo: 'ambos',
  motivoAtivo: true,
  valorItens: 100,
  valorDesconto: 0,
  valorOutros: 0,
  tributos: [],
  dataEmissao: '2026-11-10',
  dataVencimento: null,
  situacaoTitulo: 'aberto',
  saldoTitulo: 500,
  ...x,
});

describe('nota de crédito e de débito (07-FIN linha 70)', () => {
  it('efeito pelo ponto de vista do hospital', () => {
    expect(efeitoNota('recebida', 'credito', 'pagar')).toBe('abate');
    expect(efeitoNota('emitida', 'debito', 'pagar')).toBe('abate');
    expect(efeitoNota('recebida', 'debito', 'pagar')).toBe('acresce');
    expect(efeitoNota('emitida', 'credito', 'receber')).toBe('abate');
    expect(efeitoNota('emitida', 'debito', 'receber')).toBe('acresce');
    expect(efeitoNota('recebida', 'credito', 'receber')).toBe('acresce');
  });

  it('tributos destacados somam ao total e os retidos reduzem o ajuste do título', () => {
    const p = planejarNota(
      nota({
        valorItens: 1000,
        saldoTitulo: 5000,
        valorDesconto: 100,
        valorOutros: 10,
        tributos: [
          { tributo: 1, base: 900, aliquota: 5, retido: false },
          { tributo: 2, base: 900, aliquota: 1.5, retido: true },
        ],
      }),
    );
    expect(p).toMatchObject({
      efeito: 'abate',
      valorImpostos: 45,
      valorRetido: 13.5,
      valorTotal: 955,
      valorAjuste: 941.5,
    });
    if ('tributos' in p)
      expect(p.tributos.map((t) => [t.sequencia, t.valor])).toEqual([
        [1, 45],
        [2, 13.5],
      ]);
  });

  it('recusa a nota que abate mais que o saldo, o motivo de outra natureza e o título encerrado', () => {
    expect(planejarNota(nota({ valorItens: 600 }))).toMatchObject({ codigo: 'nota-maior-que-saldo' });
    expect(planejarNota(nota({ valorItens: 600, natureza: 'debito' }))).toMatchObject({ efeito: 'acresce' });
    expect(planejarNota(nota({ naturezaMotivo: 'debito' }))).toMatchObject({ codigo: 'motivo-natureza' });
    expect(planejarNota(nota({ motivoAtivo: false }))).toMatchObject({ codigo: 'motivo-inativo' });
    expect(planejarNota(nota({ situacaoTitulo: 'pago' }))).toMatchObject({ codigo: 'titulo-encerrado' });
    expect(planejarNota(nota({ dataVencimento: '2026-11-01' }))).toMatchObject({
      codigo: 'vencimento-antes-emissao',
    });
    expect(
      planejarNota(
        nota({
          tributos: [
            { tributo: 1, base: 10, aliquota: 1, retido: false },
            { tributo: 1, base: 10, aliquota: 1, retido: false },
          ],
        }),
      ),
    ).toMatchObject({ codigo: 'tributo-repetido' });
    expect(
      planejarNota(nota({ tributos: [{ tributo: 1, base: 100, aliquota: 100, retido: true }] })),
    ).toMatchObject({ codigo: 'retido-maior' });
  });

  it('cancelamento: a cancelada não volta e o acréscimo já baixado exige estorno antes', () => {
    expect(
      conferirCancelamentoNota({ situacao: 'cancelada', efeito: 'abate', valorAjuste: 1, saldoTitulo: 9 }),
    ).toMatchObject({ codigo: 'nota-cancelada' });
    expect(
      conferirCancelamentoNota({ situacao: 'aplicada', efeito: 'acresce', valorAjuste: 50, saldoTitulo: 10 }),
    ).toMatchObject({ codigo: 'titulo-ja-baixado' });
    expect(
      conferirCancelamentoNota({ situacao: 'aplicada', efeito: 'abate', valorAjuste: 50, saldoTitulo: 0 }),
    ).toBeNull();
  });
});

const cessao = (x: Partial<EntradaCessao> = {}): EntradaCessao => ({
  tipo: 'desconto_duplicata',
  comCoobrigacao: true,
  dataOperacao: '2026-11-01',
  taxaMensal: 3,
  valorTarifas: 10,
  valorIof: 5,
  parcelas: [
    { parcela: 1, situacao: 'aberta', saldo: 1000, vencimento: '2026-12-01', jaCedida: false },
    { parcela: 2, situacao: 'parcial', saldo: 500, vencimento: '2026-12-31', jaCedida: false },
  ],
  limitePortador: null,
  utilizadoPortador: 0,
  ...x,
});

describe('portador, desconto e cessão (07-FIN linha 79)', () => {
  it('deságio comercial simples por parcela e líquido', () => {
    expect(desagio(1000, 3, 30)).toBe(30);
    const p = planejarCessao(cessao());
    expect(p).toMatchObject({ valorFace: 1500, valorDesagio: 60, valorLiquido: 1425 });
    if ('itens' in p)
      expect(p.itens.map((i) => [i.dias, i.valorDesagio])).toEqual([
        [30, 30],
        [60, 30],
      ]);
  });

  it('recusas: vencida, já cedida, desconto sem coobrigação, limite do portador, sem parcelas', () => {
    const venc = { parcela: 3, situacao: 'aberta', saldo: 10, vencimento: '2026-10-01', jaCedida: false };
    expect(planejarCessao(cessao({ parcelas: [venc] }))).toMatchObject({ codigo: 'parcela-vencida' });
    expect(
      planejarCessao(cessao({ parcelas: [{ ...venc, vencimento: '2026-12-01', jaCedida: true }] })),
    ).toMatchObject({ codigo: 'parcela-ja-cedida' });
    expect(planejarCessao(cessao({ comCoobrigacao: false }))).toMatchObject({
      codigo: 'desconto-sem-coobrigacao',
    });
    expect(planejarCessao(cessao({ tipo: 'cessao', comCoobrigacao: false }))).toMatchObject({
      valorFace: 1500,
    });
    expect(planejarCessao(cessao({ limitePortador: 2000, utilizadoPortador: 600 }))).toMatchObject({
      codigo: 'limite-portador',
    });
    expect(planejarCessao(cessao({ parcelas: [] }))).toMatchObject({ codigo: 'sem-parcelas' });
    expect(planejarCessao(cessao({ valorTarifas: 2000 }))).toMatchObject({ codigo: 'liquido-invalido' });
  });

  it('desfecho do item: recompra só com coobrigação; item encerrado não muda', () => {
    const base = { situacaoOperacao: 'contratada', situacaoItem: 'cedida', comCoobrigacao: false };
    expect(conferirDesfechoItem({ ...base, acao: 'recomprar', valorRecompra: 10 })).toMatchObject({
      codigo: 'sem-coobrigacao',
    });
    expect(conferirDesfechoItem({ ...base, acao: 'liquidar' })).toBeNull();
    expect(conferirDesfechoItem({ ...base, situacaoItem: 'recomprada', acao: 'liquidar' })).toMatchObject({
      codigo: 'item-encerrado',
    });
  });
});
