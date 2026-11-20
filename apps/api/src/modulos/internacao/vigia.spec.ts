// Regra 15: vigia sem trigger e com carga fixa. Uma consulta por canal e estabelecimento por ciclo, qualquer que seja
// o número de telas (50 ouvintes = as mesmas consultas que 1); evento só quando o selo muda; a marca d'água no
// armazém e, perdida, a releitura com aviso; armazém fora não é perda; erro do banco não derruba o laço.
import type { CanalVigia } from '@sgh/contratos';
import type { LeituraCanal, MarcaVigia } from '@sgh/legado';
import { describe, expect, it, vi } from 'vitest';
import { ArmazemMemoria, type ArmazemSessao } from '../../sessao/armazem.js';
import { intervaloDoAmbiente, MotorVigia } from './vigia.js';

function fonte() {
  let selo = 'a';
  const chamadas: { hospital: string; canal: CanalVigia; marca: MarcaVigia }[] = [];
  return {
    chamadas,
    mudar: (s: string) => (selo = s),
    falhar: false,
    ler(hospital: string, canal: CanalVigia, marca: MarcaVigia): Promise<LeituraCanal> {
      chamadas.push({ hospital, canal, marca });
      if (this.falhar) return Promise.reject(new Error('banco fora'));
      return Promise.resolve({
        selo,
        marca: { maiorId: marca.maiorId + 1, maiorId2: 0, janela: 0 },
        consultas: 1,
      });
    },
  };
}

function motor(f: ReturnType<typeof fonte>, armazem: ArmazemSessao = new ArmazemMemoria()) {
  return new MotorVigia({
    rede: 'r',
    lerCanal: (h, c, m) => f.ler(h, c, m),
    armazem,
    tipoArmazem: 'memoria',
    intervaloMs: 1_000,
  });
}

describe('vigia de mudanças', () => {
  it('50 ouvintes geram as mesmas consultas que 1', async () => {
    vi.useFakeTimers();
    try {
      const contar = async (n: number) => {
        const f = fonte();
        const m = motor(f);
        const cancelar = Array.from({ length: n }, () => m.assinar('pc', 'leitos', () => undefined));
        for (let k = 0; k < 5; k++) await vi.advanceTimersByTimeAsync(1_000);
        m.parar();
        for (const c of cancelar) c();
        return f.chamadas.length;
      };
      const um = await contar(1);
      expect(um).toBeGreaterThanOrEqual(5);
      expect(await contar(50)).toBe(um);
    } finally {
      vi.useRealTimers();
    }
  });

  it('evento só quando o selo muda; todos os ouvintes recebem; o último a sair para o laço', async () => {
    vi.useFakeTimers();
    try {
      const f = fonte();
      const m = motor(f);
      const a: number[] = [];
      const b: number[] = [];
      const sa = m.assinar('pc', 'leitos', (e) => a.push(e.versao));
      const sb = m.assinar('pc', 'leitos', (e) => b.push(e.versao));
      // Um ouvinte com defeito não derruba os outros.
      const sc = m.assinar('pc', 'leitos', () => {
        throw new Error('x');
      });
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(a).toEqual([]);
      f.mudar('b');
      await vi.advanceTimersByTimeAsync(1_000);
      expect(a).toEqual([1]);
      expect(b).toEqual([1]);
      expect(m.versao('pc', 'leitos')).toBe(1);
      expect(m.ultimoCiclo('pc', 'leitos')).not.toBeNull();
      expect(m.versao('hs', 'leitos')).toBe(0);
      expect(m.ultimoCiclo('hs', 'leitos')).toBeNull();
      sa();
      sb();
      sc();
      const antes = f.chamadas.length;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(f.chamadas.length).toBe(antes);
      const s = m.saude().canais[0]!;
      expect(s).toMatchObject({
        canal: 'leitos',
        estabelecimento: 'pc',
        ligado: false,
        mudancas: 1,
        consultasUltimoCiclo: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("marca d'água no armazém; perdida: releitura do zero e aviso de mudança", async () => {
    const f = fonte();
    const armazem = new ArmazemMemoria();
    const m = motor(f, armazem);
    const eventos: number[] = [];
    m.assinar('pc', 'senhas', (e) => eventos.push(e.versao));
    m.parar(); // os ciclos à mão
    await m.cicloAgora('pc', 'senhas');
    await m.cicloAgora('pc', 'senhas');
    expect(f.chamadas.map((c) => c.marca.maiorId)).toEqual([0, 1]);
    expect(await armazem.obter('sgh:r:vigia:pc:senhas')).toBe(
      JSON.stringify({ maiorId: 2, maiorId2: 0, janela: 0 }),
    );
    await armazem.apagar('sgh:r:vigia:pc:senhas');
    await m.cicloAgora('pc', 'senhas');
    expect(f.chamadas.at(-1)?.marca.maiorId).toBe(0);
    expect(eventos).toEqual([1]);
    expect(m.saude().canais[0]?.releituras).toBe(1);
    // Marca ilegível no armazém: recomeça do zero.
    await armazem.gravar('sgh:r:vigia:pc:senhas', '{x', 60);
    await m.cicloAgora('pc', 'senhas');
    expect(f.chamadas.at(-1)?.marca.maiorId).toBe(0);
  });

  it('armazém fora não é perda (a marca da memória); erro do banco conta e segue', async () => {
    const f = fonte();
    const fora: ArmazemSessao = {
      obter: () => Promise.reject(new Error('fora')),
      gravar: () => Promise.reject(new Error('fora')),
      apagar: () => Promise.resolve(),
      consumir: () => Promise.reject(new Error('fora')),
      incrementar: () => Promise.resolve(0),
      encerrar: () => Promise.resolve(),
    };
    const avisos: string[] = [];
    const m = new MotorVigia({
      rede: 'r',
      lerCanal: (h, c, mm) => f.ler(h, c, mm),
      armazem: fora,
      tipoArmazem: 'valkey',
      intervaloMs: 5,
      aviso: (msg) => avisos.push(msg),
    });
    const ev: number[] = [];
    m.assinar('pc', 'dispensacao', (e) => ev.push(e.versao));
    m.parar();
    await m.cicloAgora('pc', 'dispensacao');
    await m.cicloAgora('pc', 'dispensacao');
    expect(f.chamadas.map((c) => c.marca.maiorId)).toEqual([0, 1]);
    expect(ev).toEqual([]);
    f.falhar = true;
    await m.cicloAgora('pc', 'dispensacao');
    expect(m.saude()).toMatchObject({ marcaDagua: 'valkey', canais: [{ erros: 1, intervaloMs: 1_000 }] });
    expect(avisos).toEqual(['vigia: ciclo falhou']);
  });

  it('intervalo de 1 a 2 s pelo ambiente', () => {
    expect(intervaloDoAmbiente({ VIGIA_MUDANCAS_MS: '2000' })).toBe(2_000);
    expect(intervaloDoAmbiente({ VIGIA_MUDANCAS_MS: '500' })).toBe(1_500);
    expect(intervaloDoAmbiente({})).toBe(1_500);
  });
});
