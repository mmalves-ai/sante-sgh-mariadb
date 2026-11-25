// Franquia e desconto por volume no total da fonte pagadora e na guia TISS (F8, 06-FAT linha 19). Contas SINTÉTICAS.
import { beforeAll, describe, expect, it } from 'vitest';
import { type ContaTiss, montarGuia, montarLote, naturezaPadrao, TABELA_PADRAO } from '../tiss/montagem.js';
import { type ArquivoEsquema, carregarEsquemas, conferirLote } from '../tiss/validacao.js';
import {
  conferirReducaoComercialDaGuia,
  efeitoComercialNaConta,
  fatorReducaoGuia,
  reducaoComercialDaGuia,
  valorLinhaGuia,
} from './efeito-comercial.js';

let esquemas: ArquivoEsquema[];
beforeAll(async () => {
  esquemas = await carregarEsquemas();
});

const prestador = {
  registroAns: '999999',
  codigoPrestador: 'PRESTTESTE01',
  cnes: '9999999',
  nome: 'HOSPITAL FICTÍCIO DE TESTE',
};
const item = (sequencial: number, tipo: number, valor: number) => {
  const natureza = naturezaPadrao(tipo);
  return {
    sequencial,
    tipo,
    natureza,
    data: '2026-10-18',
    codigo: String(40_000_000 + sequencial),
    codigoTabela: TABELA_PADRAO[natureza],
    descricao: `ITEM FICTÍCIO ${sequencial}`,
    quantidade: 1,
    valorUnitario: valor,
  };
};
const conta = (tipoGuia: 1 | 2 | 3 | 4, reducaoAcrescimo?: number): ContaTiss => ({
  conta: 9100,
  tipoGuia,
  numeroGuia: `SINT-C043-${tipoGuia}`,
  carteira: 'SINTETICO0000043',
  atendimentoRN: false,
  inicio: { data: '2026-10-10', hora: '08:00:00' },
  fim: { data: '2026-10-15', hora: '12:00:00' },
  caraterAtendimento: '1',
  tipoConsulta: '1',
  tipoAtendimento: '23',
  senha: '',
  guiaSolicitacao: '',
  dataAutorizacao: '',
  tipoFaturamento: '4',
  tipoInternacao: '1',
  regimeInternacao: '1',
  motivoEncerramento: '12',
  profissional: { conselho: '06', numeroConselho: '000000', uf: '33', cbos: '225125' },
  profissionalNome: 'PROFISSIONAL FICTÍCIO',
  profissionalCodigo: '',
  ...(reducaoAcrescimo === undefined ? {} : { reducaoAcrescimo }),
  itens: [item(1, 3, 600), item(2, 2, 250), item(3, 1, 150)],
});

describe('efeito comercial na conta', () => {
  const base = { valorItens: 1000, valorAcrescimo: 0, valorDesconto: 0, valorPaciente: 0 };

  it('desconto abatido da fonte; franquia vai ao paciente e sai do total da fonte', () => {
    expect(
      efeitoComercialNaConta(base, { franquia: 0, desconto: 0 }, { franquia: 200, desconto: 100 }),
    ).toEqual({ valorDesconto: 300, valorPaciente: 200, valorTotal: 700, abatimento: 300 });
  });

  it('a reaplicação troca o anterior (não soma duas vezes) e mantém o desconto de outro fluxo', () => {
    const conta = { ...base, valorAcrescimo: 50, valorDesconto: 340, valorPaciente: 200 }; // 40 vieram de ajuste
    expect(
      efeitoComercialNaConta(conta, { franquia: 200, desconto: 100 }, { franquia: 200, desconto: 100 }),
    ).toEqual({ valorDesconto: 340, valorPaciente: 200, valorTotal: 710, abatimento: 300 });
    expect(
      efeitoComercialNaConta(conta, { franquia: 200, desconto: 100 }, { franquia: 0, desconto: 0 }),
    ).toEqual({ valorDesconto: 40, valorPaciente: 0, valorTotal: 1010, abatimento: 0 });
  });

  it('o total da fonte nunca fica negativo', () => {
    expect(
      efeitoComercialNaConta(base, { franquia: 0, desconto: 0 }, { franquia: 900, desconto: 300 }).valorTotal,
    ).toBe(0);
  });

  it('fator da guia: (bruto − abatimento) / bruto com duas casas; sem abatimento, 1', () => {
    expect(fatorReducaoGuia(1000, 300)).toBe(0.7);
    expect(fatorReducaoGuia(1000, 0)).toBe(1);
    expect(fatorReducaoGuia(0, 10)).toBe(1);
    expect(fatorReducaoGuia(100, 150)).toBe(0);
    expect(fatorReducaoGuia(300, 100)).toBe(0.67);
    expect(valorLinhaGuia(2, 150, 0.7)).toBe(210);
  });
});

describe('guia TISS com o abatimento comercial', () => {
  it.each([2, 3] as const)(
    'guia do tipo %i: reducaoAcrescimo no item e total geral reduzido, válida no XSD',
    async (tipo) => {
      const m = montarLote(
        prestador,
        '000000000143',
        '000000000043',
        [conta(tipo, 0.7)],
        new Date('2026-10-23T13:14:15Z'),
      );
      expect(m.xml).toContain('<ans:reducaoAcrescimo>0.70</ans:reducaoAcrescimo>');
      expect(m.xml).not.toContain('<ans:reducaoAcrescimo>1.00</ans:reducaoAcrescimo>');
      expect(m.xml).toContain('<ans:valorTotalGeral>700.00</ans:valorTotalGeral>');
      expect(m.xml).toContain('<ans:valorTotal>420.00</ans:valorTotal>');
      expect((await conferirLote(m, esquemas)).erros).toEqual([]);
    },
  );

  it('consulta e honorário levam o valor reduzido', async () => {
    const c = montarGuia(conta(1, 0.7), prestador);
    expect(c.tipo === 'consulta' && c.valor).toBe(700);
    const h = montarLote(
      prestador,
      '000000000144',
      '000000000044',
      [conta(4, 0.7)],
      new Date('2026-10-23T13:14:15Z'),
    );
    expect(h.xml).toContain('<ans:valorTotalHonorarios>175.00</ans:valorTotalHonorarios>');
    expect((await conferirLote(h, esquemas)).erros).toEqual([]);
  });

  it('sem abatimento a guia segue com 1.00 e o valor cheio', () => {
    const m = montarLote(
      prestador,
      '000000000145',
      '000000000045',
      [conta(2)],
      new Date('2026-10-23T13:14:15Z'),
    );
    expect(m.xml).toContain('<ans:reducaoAcrescimo>1.00</ans:reducaoAcrescimo>');
    expect(m.xml).toContain('<ans:valorTotalGeral>1000.00</ans:valorTotalGeral>');
  });
});

describe('repartição do abatimento nos itens da guia (fecha no centavo com a conta)', () => {
  const linhas = (vs: number[]) => vs.map((v) => ({ quantidade: 1, valorUnitario: v }));
  const totalGuia = (vs: number[], fs: readonly number[]) =>
    vs.reduce((t, v, k) => t + Math.round(v * (fs[k] ?? 1) * 100), 0) / 100;

  it('divisão exata: fator comum', () => {
    const r = reducaoComercialDaGuia(linhas([600, 250, 150]), 300);
    expect(r.fatores).toEqual([0.7, 0.7, 0.7]);
    expect(r).toMatchObject({ totalGuia: 700, alvo: 700, residuo: 0 });
  });

  it('divisão não exata (1000 com 333 de abatimento): a guia fecha em 667, não 670', () => {
    const vs = [600, 250, 150];
    const r = reducaoComercialDaGuia(linhas(vs), 333);
    expect(r.residuo).toBe(0);
    expect(r.totalGuia).toBe(667);
    expect(totalGuia(vs, r.fatores)).toBe(667);
    for (const f of r.fatores) expect(Math.round(f * 100)).toBe(f * 100);
    expect(conferirReducaoComercialDaGuia('C1', r, 667, 333)).toBeNull();
  });

  it('abatimento abaixo de 0,5% (franquia de 40 sobre 10000): a guia sai com 9960, nunca cheia', () => {
    const vs = [4000, 3000, 2000, 900, 80, 20];
    const r = reducaoComercialDaGuia(linhas(vs), 40);
    expect(r.residuo).toBe(0);
    expect(totalGuia(vs, r.fatores)).toBe(9960);
    expect(r.fatores.some((f) => f < 1)).toBe(true);
  });

  it('guia de um item só que o fator de duas casas não representa: recusa com o resíduo, nunca cobra diferente', () => {
    const r = reducaoComercialDaGuia(linhas([1000]), 333);
    expect(r.residuo).not.toBe(0);
    expect(conferirReducaoComercialDaGuia('C9', r, 667, 333)).toMatchObject({
      codigo: 'guia-abatimento-sem-fator',
    });
    // Sem abatimento: nada a conferir e fator 1.
    const s = reducaoComercialDaGuia(linhas([1000]), 0);
    expect(s).toMatchObject({ fatores: [1], residuo: 0, totalGuia: 1000 });
    expect(conferirReducaoComercialDaGuia('C9', s, 1000, 0)).toBeNull();
  });

  it('fator por item vai ao XML e o total geral do lote é o da conta (XSD 04.03.00)', async () => {
    const base = conta(2);
    const r = reducaoComercialDaGuia(base.itens, 333);
    const c: ContaTiss = {
      ...base,
      itens: base.itens.map((i, k) => {
        const f = r.fatores[k] ?? 1;
        return f === 1 ? i : { ...i, reducaoAcrescimo: f };
      }),
    };
    const m = montarLote(prestador, '000000000145', '000000000045', [c], new Date('2026-10-23T13:14:15Z'));
    expect(m.xml).toContain('<ans:valorTotalGeral>667.00</ans:valorTotalGeral>');
    expect((await conferirLote(m, esquemas)).erros).toEqual([]);
    const consulta = montarGuia({ ...c, tipoGuia: 1 }, prestador);
    expect(consulta.tipo === 'consulta' && consulta.valor).toBe(667);
  });
});
