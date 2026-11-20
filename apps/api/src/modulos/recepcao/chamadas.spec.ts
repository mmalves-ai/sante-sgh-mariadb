// M19: central de chamadas dos painéis (regra 7): a chamada do novo entra na hora; a do outro sistema entra pelo
// vigia de mudanças (o canal "senhas" muda → o retrato das senhas do dia → a diferença) em até um ciclo; nada se
// repete; o painel filtra pela recepção e pelos locais do dispositivo. Porta em memória, vigia de verdade.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import { MotorVigia } from '../internacao/public-api.js';
import { CentralChamadas, chaveDaChamada } from './chamadas.js';
import { PortaRecepcaoMemoria } from './porta-memoria.js';

const pasta = mkdtempSync(join(tmpdir(), 'sgh-m19-chamadas-'));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

describe('central de chamadas', () => {
  it('a chamada do outro sistema aparece pelo vigia; a do novo na hora; sem repetir', async () => {
    const porFora = join(pasta, 'por-fora.json');
    const porta = new PortaRecepcaoMemoria(
      { estado: () => 'verde' },
      { arquivoPorFora: porFora, agora: () => new Date('2026-10-21T11:30:00Z') },
    );
    const c = { rede: 'r', hospital: 'aa' };
    const vigia = new MotorVigia({
      rede: 'r',
      lerCanal: (hospital, _canal, marca) => porta.canalSenhas({ rede: 'r', hospital }, marca),
      armazem: new ArmazemMemoria(),
      tipoArmazem: 'memoria',
      intervaloMs: 1_000,
    });
    const central = new CentralChamadas(porta, 'r', vigia);
    const avisos: number[] = [];
    const cancelar = central.assinar('aa', (v) => avisos.push(v));
    // Primeiro retrato (nada é anunciado no primeiro).
    expect((await central.chamadas('aa', { recepcao: 2, locais: [] })).chamadas).toEqual([]);
    await vigia.cicloAgora('aa', 'senhas');
    // O outro sistema chama a mais antiga no guichê 1 (o guichê aberto por ele).
    writeFileSync(porFora, JSON.stringify({ chamadas: [{ id: 'a1', guiche: 1 }] }));
    await vigia.cicloAgora('aa', 'senhas');
    await new Promise((r) => setTimeout(r, 20));
    const depois = await central.chamadas('aa', { recepcao: 2, locais: [] });
    expect(depois.chamadas).toHaveLength(1);
    expect(depois.chamadas[0]).toMatchObject({ origem: 'outro', guiche: 1, local: 2, recepcao: 2 });
    expect(avisos.length).toBeGreaterThan(0);
    // A primeira chamada do outro sistema entra nos tempos por etapa (gravada na extensão da senha).
    await new Promise((r) => setTimeout(r, 20));
    const deFora = await porta.senha(c, depois.chamadas[0]?.senha ?? 0);
    expect(deFora?.primeiraChamadaEm).toBeTruthy();
    const ind = await porta.indicadores(c, '2026-10-21', '2026-10-21', 2);
    expect(ind.tempos.some((t) => t.guiche === 1 && t.chamadaEm !== null)).toBe(true);
    // A do novo entra na hora (a senha relida depois do COMMIT).
    await porta.executar(
      c,
      'recepcao.abrirGuiche',
      { recepcao: 2, local: 2, guiche: 5 },
      {
        rede: 'r',
        hospital: 'aa',
        traceId: 't',
        usuarioLegado: 'GUICHE.CINCO',
        idempotencyKey: 'chave-teste-abrir-0001',
      },
    );
    const r = await porta.executar(
      c,
      'recepcao.chamarSenha',
      { recepcao: 2, local: 2, guiche: 5, geradores: [23, 24] },
      {
        rede: 'r',
        hospital: 'aa',
        traceId: 't',
        usuarioLegado: 'GUICHE.CINCO',
        idempotencyKey: 'chave-teste-chamar-0001',
      },
    );
    const senha = await porta.senha(c, Number(r.resultado['senha']));
    if (!senha) throw new Error('senha não relida');
    await central.registrarDoNovo('aa', senha);
    await vigia.cicloAgora('aa', 'senhas');
    const todas = await central.chamadas('aa', { recepcao: 2, locais: [] });
    expect(todas.chamadas.map((x) => x.origem)).toEqual(['novo', 'outro']);
    expect(todas.chamadas[0]?.chave).toBe(chaveDaChamada(senha));
    // O painel de outra recepção ou de outro local não as vê.
    expect((await central.chamadas('aa', { recepcao: 10, locais: [] })).chamadas).toEqual([]);
    expect((await central.chamadas('aa', { recepcao: 2, locais: [12] })).chamadas).toEqual([]);
    cancelar();
    central.parar();
    vigia.parar();
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
