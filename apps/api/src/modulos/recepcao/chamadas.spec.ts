// M19: central de chamadas dos painéis (regra 7): a chamada desta instância entra na hora; a feita em outra instância
// (outro processo da API sobre o mesmo banco) entra pelo retrato das senhas do dia na leitura do painel; nada se
// repete; o painel filtra pela recepção e pelos locais do dispositivo. Porta em memória compartilhada pelas duas.
import { describe, expect, it } from 'vitest';
import { CentralChamadas, chaveDaChamada } from './chamadas.js';
import { PortaRecepcaoMemoria } from './porta-memoria.js';
import type { ContextoGravacao } from './tipos.js';

const ctx = (chave: string): ContextoGravacao => ({
  login: 'GUICHE.CINCO',
  correlacao: 't',
  chaveIdempotencia: chave,
});

describe('central de chamadas', () => {
  it('a chamada de outra instância aparece no retrato; a desta, na hora; sem repetir', async () => {
    const porta = new PortaRecepcaoMemoria(
      { estado: () => 'verde' },
      { agora: () => new Date('2026-10-21T11:30:00Z') },
    );
    const c = { rede: 'r', hospital: 'aa' };
    let agora = 1_000_000;
    const esta = new CentralChamadas(porta, 'r', null, () => agora);
    const outra = new CentralChamadas(porta, 'r', null, () => agora);
    const avisos: number[] = [];
    const cancelar = esta.assinar('aa', (v) => avisos.push(v));
    // Primeiro retrato (nada é anunciado no primeiro).
    expect((await esta.chamadas('aa', { recepcao: 2, locais: [] })).chamadas).toEqual([]);
    await porta.executar(
      c,
      'recepcao.abrirGuiche',
      { recepcao: 2, local: 2, guiche: 5 },
      ctx('chave-teste-abrir-0001'),
    );
    // A outra instância chama: esta vê a chamada na releitura seguinte (origem "outro").
    const r1 = await porta.executar(
      c,
      'recepcao.chamarSenha',
      { recepcao: 2, local: 2, guiche: 5, geradores: [23, 24] },
      ctx('chave-teste-chamar-0001'),
    );
    const s1 = await porta.senha(c, Number(r1.resultado['senha']));
    if (!s1) throw new Error('senha não relida');
    await outra.registrarDoNovo('aa', s1);
    agora += 5_000;
    const depois = await esta.chamadas('aa', { recepcao: 2, locais: [] });
    expect(depois.chamadas).toHaveLength(1);
    expect(depois.chamadas[0]).toMatchObject({ origem: 'outro', guiche: 5, local: 2, recepcao: 2 });
    expect(avisos.length).toBeGreaterThan(0);
    // A desta instância entra na hora (a senha relida depois do COMMIT) e não se repete na releitura.
    const r2 = await porta.executar(
      c,
      'recepcao.chamarSenha',
      { recepcao: 2, local: 2, guiche: 5, geradores: [23, 24] },
      ctx('chave-teste-chamar-0002'),
    );
    const s2 = await porta.senha(c, Number(r2.resultado['senha']));
    if (!s2) throw new Error('senha não relida');
    await esta.registrarDoNovo('aa', s2);
    agora += 5_000;
    const todas = await esta.chamadas('aa', { recepcao: 2, locais: [] });
    expect(todas.chamadas.map((x) => x.origem)).toEqual(['novo', 'outro']);
    expect(todas.chamadas[0]?.chave).toBe(chaveDaChamada(s2));
    // O painel de outra recepção ou de outro local não as vê.
    expect((await esta.chamadas('aa', { recepcao: 10, locais: [] })).chamadas).toEqual([]);
    expect((await esta.chamadas('aa', { recepcao: 2, locais: [12] })).chamadas).toEqual([]);
    cancelar();
    esta.parar();
    outra.parar();
  });

  it('sem vigia, o painel refaz o retrato na leitura', async () => {
    const porta = new PortaRecepcaoMemoria({ estado: () => 'verde' });
    let agora = 1_000_000;
    const central = new CentralChamadas(porta, 'r', null, () => agora);
    expect((await central.chamadas('bb', { recepcao: null, locais: [] })).chamadas).toEqual([]);
    agora += 5_000;
    expect((await central.chamadas('bb', { recepcao: null, locais: [] })).atualizadoEm).toBe(
      new Date(agora).toISOString(),
    );
    expect(central.versao('bb')).toBe(0);
  });
});
