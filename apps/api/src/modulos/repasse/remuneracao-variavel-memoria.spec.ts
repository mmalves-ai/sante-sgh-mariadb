// Porta em memória do valor fixo e do mínimo garantido (C2-100): as mesmas recusas e o mesmo cálculo da porta própria.
import { describe, expect, it } from 'vitest';
import { PortaFavorecidosRepasseMemoria } from './favorecidos-memoria.js';
import { PortaRemuneracaoVariavelMemoria } from './remuneracao-variavel-memoria.js';

const c = {} as never;
const hoje = new Date('2026-11-15T12:00:00Z');

describe('PortaRemuneracaoVariavelMemoria (C2-100)', () => {
  it('fixo e mínimo → simulação → lançar uma vez → encerrar sem apagar', async () => {
    const p = new PortaRemuneracaoVariavelMemoria(hoje);
    const painel = await p.painel(c, null);
    expect(painel.apuracoes).toEqual([
      { id: 801, numero: '801', competencia: '2026-11-01', situacao: 'em_apuracao' },
    ]);
    const fixo = {
      profissional: 7001,
      descricao: 'Coordenação',
      valorMensal: 1500,
      evento: 40,
      inicio: '2026-11-01',
    };
    await expect(p.incluirFixo(c, { ...fixo, diaPagamento: 32 })).rejects.toThrow();
    const { id } = await p.incluirFixo(c, { ...fixo, diaPagamento: 10 });
    await expect(p.incluirFixo(c, fixo)).rejects.toThrow(/regra-violada/);
    await p.incluirMinimo(c, {
      profissional: 7001,
      valorMinimo: 50000,
      evento: 40,
      inicio: '2026-11-01',
      fim: '2026-11-30',
    });
    await expect(p.incluirFixo(c, { ...fixo, profissional: 999 })).rejects.toThrow();

    const sim = await p.simular(c, 801, 7001);
    const itens = sim.profissionais[0]!.itens;
    expect(itens.filter((i) => i.tipo === 'valor_fixo').map((i) => [i.valor, i.lancado])).toEqual([
      [1500, false],
    ]);
    // o complemento completa só a produção (925,50) até o piso
    expect(itens.find((i) => i.tipo === 'complemento_minimo')?.valor).toBe(50000 - 925.5);

    const l = await p.lancar(c, 801, 7001);
    expect(l.lancamentos).toBe(2);
    expect((await p.lancar(c, 801, 7001)).lancamentos).toBe(0);
    expect((await p.simular(c, 801, 7001)).profissionais[0]!.itens.every((i) => i.lancado)).toBe(true);

    await expect(p.encerrar(c, 'fixo', id, { versao: 1, fim: '2026-10-31' })).rejects.toThrow(
      /regra-violada/,
    );
    await p.encerrar(c, 'fixo', id, { versao: 1, fim: '2026-11-30' });
    const depois = await p.painel(c, 7001);
    expect(depois.fixos.map((f) => [f.id, f.fim, f.versao])).toEqual([[id, '2026-11-30', 2]]);
    await expect(p.incluirResultado()).rejects.toThrow(/sem banco/);
  });

  it('o favorecido próprio do médico sintético entra pela porta de favorecidos em memória (pré-condição do E2E)', async () => {
    const f = new PortaFavorecidosRepasseMemoria();
    await f.incluirFavorecido(c, { profissional: 7001, tipo: 'proprio_profissional', inicio: '2026-11-01' });
    const lista = await f.listarFavorecidos(c, 7001);
    expect(lista.map((x) => [x.tipo, x.profissionalNome, x.ativo])).toEqual([
      ['proprio_profissional', 'MEDICO SINTETICO A', true],
    ]);
  });
});
