// C2-030 (05-SUP linha 26): a ata de registro de preços (Lei 14.133, art. 82 a 86) e a nota de empenho que consome o
// saldo dela (Lei 4.320, art. 58 a 61).
import { describe, expect, it } from 'vitest';
import {
  type AtaParaConferir,
  conferirAta,
  conferirEmpenho,
  type EmpenhoParaConferir,
  fimMaximoVigenciaAta,
  type ItemAtaRelido,
  podeAnularEmpenho,
  saldoItemAta,
  situacaoItemAtaApos,
  totalEmpenho,
} from '../index.js';

const codigos = (r: readonly { codigo: string }[]) => r.map((x) => x.codigo);
const ata = (x: Partial<AtaParaConferir> = {}): AtaParaConferir => ({
  numero: 'ARP 1/2026',
  objeto: 'Material médico hospitalar',
  vigenciaInicio: '2026-03-10',
  vigenciaFim: '2027-03-09',
  itens: [
    { insumo: 1, fornecedor: 10, quantidade: 100, valorUnitario: 2.5 },
    { insumo: 2, fornecedor: 11, quantidade: 50, valorUnitario: 10 },
  ],
  processo: null,
  ...x,
});
const item = (x: Partial<ItemAtaRelido> = {}): ItemAtaRelido => ({
  id: 7,
  situacao: 'ativo',
  fornecedor: 10,
  registrada: 100,
  utilizada: 40,
  valorUnitario: 2.5,
  ata: { situacao: 'vigente', vigenciaInicio: '2026-03-10', vigenciaFim: '2027-03-09' },
  ...x,
});
const empenho = (x: Partial<EmpenhoParaConferir> = {}): EmpenhoParaConferir => ({
  numero: '2026NE000123',
  emitidoEm: '2026-04-01',
  hoje: '2026-04-02',
  validoAte: null,
  fonteRecurso: '1.500.1002',
  itens: [{ quantidade: 60, ataItem: item() }],
  ...x,
});

describe('ata de registro de preços', () => {
  it('a vigência máxima é de 1 ano menos um dia, também a partir de 29/02', () => {
    expect(fimMaximoVigenciaAta('2026-03-10')).toBe('2027-03-09');
    expect(fimMaximoVigenciaAta('2028-02-29')).toBe('2029-02-28');
    expect(fimMaximoVigenciaAta('2026-01-01')).toBe('2026-12-31');
  });

  it('a ata completa passa; vigência acima de 1 ano, invertida, sem itens e sem objeto são recusadas', () => {
    expect(conferirAta(ata())).toEqual([]);
    expect(codigos(conferirAta(ata({ vigenciaFim: '2027-03-10' })))).toEqual(['ata-vigencia-acima-do-prazo']);
    expect(codigos(conferirAta(ata({ vigenciaFim: '2026-03-09' })))).toEqual(['ata-vigencia-invalida']);
    expect(codigos(conferirAta(ata({ itens: [], objeto: 'x', numero: ' ' })))).toEqual([
      'ata-sem-numero',
      'ata-sem-objeto',
      'ata-sem-itens',
    ]);
  });

  it('o mesmo produto do mesmo fornecedor não se repete; quantidade e preço são conferidos', () => {
    const r = conferirAta(
      ata({
        itens: [
          { insumo: 1, fornecedor: 10, quantidade: 1, valorUnitario: 1 },
          { insumo: 1, fornecedor: 10, quantidade: 0, valorUnitario: -1 },
          { insumo: 1, fornecedor: 12, quantidade: 1, valorUnitario: 1 },
        ],
      }),
    );
    expect(codigos(r)).toEqual(['ata-item-repetido', 'ata-quantidade-invalida', 'ata-valor-invalido']);
    expect(r[0]?.campos).toEqual(['itens.1']);
  });

  it('ligada ao processo: só homologado, só o vencedor adjudicado e preço até o adjudicado', () => {
    const adjudicados = [
      { insumo: 1, fornecedor: 10, valor: 2.5 },
      { insumo: 2, fornecedor: 11, valor: 9 },
    ];
    expect(codigos(conferirAta(ata({ processo: { etapa: 'julgamento', adjudicados } })))).toEqual([
      'processo-nao-homologado',
    ]);
    expect(codigos(conferirAta(ata({ processo: { etapa: 'homologado', adjudicados } })))).toEqual([
      'ata-preco-acima-do-adjudicado',
    ]);
    expect(
      codigos(
        conferirAta(
          ata({
            itens: [{ insumo: 1, fornecedor: 11, quantidade: 1, valorUnitario: 1 }],
            processo: { etapa: 'homologado', adjudicados },
          }),
        ),
      ),
    ).toEqual(['ata-item-nao-adjudicado']);
    expect(
      conferirAta(
        ata({
          itens: [{ insumo: 2, fornecedor: 11, quantidade: 5, valorUnitario: 9 }],
          processo: { etapa: 'homologado', adjudicados },
        }),
      ),
    ).toEqual([]);
  });

  it('o saldo é a registrada menos a utilizada; o item esgota e volta a ativo pela devolução', () => {
    expect(saldoItemAta(100, 40)).toBe(60);
    expect(saldoItemAta(1, 0.33333)).toBe(0.6667);
    expect(situacaoItemAtaApos('ativo', 100, 100)).toBe('esgotado');
    expect(situacaoItemAtaApos('esgotado', 100, 40)).toBe('ativo');
    expect(situacaoItemAtaApos('suspenso', 100, 100)).toBe('suspenso');
  });
});

describe('nota de empenho sobre a ata', () => {
  it('o empenho dentro do saldo e da vigência passa; o total é a soma das parcelas', () => {
    expect(conferirEmpenho(empenho())).toEqual([]);
    expect(
      totalEmpenho([
        { quantidade: 60, valorUnitario: 2.5 },
        { quantidade: 3, valorUnitario: 0.3333 },
      ]),
    ).toEqual({ itens: [150, 1], total: 151 });
  });

  it('acima do saldo, data futura, sem fonte, fora da vigência e ata encerrada são recusados', () => {
    expect(codigos(conferirEmpenho(empenho({ itens: [{ quantidade: 60.0001, ataItem: item() }] })))).toEqual([
      'empenho-acima-do-saldo',
    ]);
    expect(codigos(conferirEmpenho(empenho({ emitidoEm: '2026-04-03', fonteRecurso: ' ' })))).toEqual([
      'empenho-data-futura',
      'empenho-sem-fonte',
    ]);
    expect(codigos(conferirEmpenho(empenho({ emitidoEm: '2026-03-01', hoje: '2026-03-02' })))).toEqual([
      'empenho-fora-da-vigencia',
    ]);
    const encerrada = item({
      ata: { situacao: 'encerrada', vigenciaInicio: '2026-03-10', vigenciaFim: '2027-03-09' },
    });
    expect(codigos(conferirEmpenho(empenho({ itens: [{ quantidade: 1, ataItem: encerrada }] })))).toEqual([
      'ata-nao-vigente',
    ]);
    expect(
      codigos(
        conferirEmpenho(empenho({ itens: [{ quantidade: 1, ataItem: item({ situacao: 'esgotado' }) }] })),
      ),
    ).toEqual(['ata-item-indisponivel']);
    expect(codigos(conferirEmpenho(empenho({ validoAte: '2026-03-31' })))).toEqual([
      'empenho-validade-invalida',
    ]);
  });

  it('um credor só por empenho e o mesmo item da ata não se repete', () => {
    expect(
      codigos(
        conferirEmpenho(
          empenho({
            itens: [
              { quantidade: 1, ataItem: item() },
              { quantidade: 1, ataItem: item({ id: 8, fornecedor: 11 }) },
              { quantidade: 1, ataItem: item() },
            ],
          }),
        ),
      ),
    ).toEqual(['empenho-credor-unico', 'empenho-item-repetido']);
  });

  it('a anulação: só do emitido, sem execução e com motivo', () => {
    const base = {
      situacao: 'emitido',
      valorLiquidado: 0,
      quantidadeRecebida: 0,
      motivo: 'Dotação remanejada',
    };
    expect(podeAnularEmpenho(base)).toBeNull();
    expect(podeAnularEmpenho({ ...base, situacao: 'anulado' })?.codigo).toBe('empenho-nao-anulavel');
    expect(podeAnularEmpenho({ ...base, valorLiquidado: 1 })?.codigo).toBe('empenho-com-execucao');
    expect(podeAnularEmpenho({ ...base, quantidadeRecebida: 1 })?.codigo).toBe('empenho-com-execucao');
    expect(podeAnularEmpenho({ ...base, motivo: 'curto' })?.codigo).toBe('empenho-sem-motivo');
  });
});
