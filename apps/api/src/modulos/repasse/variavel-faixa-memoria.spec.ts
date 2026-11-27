// Porta em memória da remuneração variável por faixa e do rateio da equipe (C2-106): as mesmas recusas e o mesmo
// cálculo de domínio da porta própria, sobre a produção sintética.
import { describe, expect, it } from 'vitest';
import { PortaVariavelFaixaMemoria } from './variavel-faixa-memoria.js';

const c = {} as never;
const hoje = new Date('2026-11-15T12:00:00Z');
const membros = (a: number, b: number) => [
  { profissional: 7001, cota: a, chefe: true },
  { profissional: 7002, cota: b },
];

describe('PortaVariavelFaixaMemoria (C2-106)', () => {
  it('equipe 60/40 → recompor → regra por faixa → simular → lançar uma vez → encerrar sem apagar', async () => {
    const p = new PortaVariavelFaixaMemoria(hoje);
    const painel = await p.painel(c);
    expect(painel.apuracoes).toEqual([
      { id: 801, numero: '801', competencia: '2026-11-01', situacao: 'em_apuracao' },
    ]);
    const equipe = { codigo: 'EQ1', nome: 'Equipe', inicio: '2026-11-01' };
    await expect(p.incluirEquipe(c, { ...equipe, membros: membros(60, 30) })).rejects.toThrow(
      /regra-violada/,
    );
    const { id: eq } = await p.incluirEquipe(c, { ...equipe, membros: membros(60, 40) });
    await expect(p.incluirEquipe(c, { ...equipe, membros: membros(60, 40) })).rejects.toThrow(
      /regra-violada/,
    );
    await p.recomporEquipe(c, eq, { versao: 1, inicio: '2026-11-02', membros: membros(60, 40) });
    const recomposta = (await p.painel(c)).equipes[0]!;
    expect(recomposta.membros.filter((m) => m.fim === '2026-11-01')).toHaveLength(2);
    expect(recomposta.membros.filter((m) => m.fim === null && m.inicio === '2026-11-02')).toHaveLength(2);

    const regra = {
      codigo: 'VF1',
      descricao: 'Produtividade',
      equipe: eq,
      indicador: 'quantidade_procedimentos',
      evento: 40,
      inicio: '2026-11-01',
      faixas: [
        { de: 0, ate: 10, percentual: 5, valorFixo: 100 },
        { de: 10, percentual: 8, valorFixo: 200 },
      ],
    };
    await expect(p.incluirRegra(c, regra)).rejects.toThrow(/regra-violada/);
    const { id } = await p.incluirRegra(c, {
      ...regra,
      faixas: [regra.faixas[0], { ...regra.faixas[1], de: 11 }],
    });
    await expect(p.incluirRegra(c, { ...regra, codigo: 'VF2', faixas: [] })).rejects.toThrow(/regra-violada/);

    const sim = (await p.simular(c, 801)).regras.find((r) => r.regra === id)!;
    expect(sim.medida).toBe(7);
    expect(sim.faixa).toBe(1);
    expect(sim.fecha).toBe(true);
    expect(sim.pendencias).toEqual([]);
    expect(sim.partes.map((x) => x.cota)).toEqual([60, 40]);
    const centavos = Math.round(sim.valor * 100);
    expect(sim.partes.reduce((s, x) => s + Math.round(x.valor * 100), 0)).toBe(centavos);

    const lancou = await p.lancar(c, 801);
    expect(lancou.lancamentos).toBe(2);
    expect(lancou.credito).toBe(sim.valor);
    expect((await p.lancar(c, 801)).lancamentos).toBe(0);
    const depois = (await p.simular(c, 801)).regras.find((r) => r.regra === id)!;
    expect(depois.partes.map((x) => x.lancado)).toEqual([true, true]);

    await expect(p.encerrarRegra(c, id, { versao: 1, fim: '2026-10-31' })).rejects.toThrow(/regra-violada/);
    await p.encerrarRegra(c, id, { versao: 1, fim: '2026-11-30' });
    const fim = (await p.painel(c)).regras.find((r) => r.id === id)!;
    expect(fim.fim).toBe('2026-11-30');
    await expect(p.simular(c, 999)).rejects.toThrow();
  });
});
