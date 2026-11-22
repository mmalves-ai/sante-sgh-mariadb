// Regra 15: vigia sem trigger e com carga fixa. Uma consulta por canal e estabelecimento por ciclo, qualquer que seja
// o número de telas (50 ouvintes = as mesmas consultas que 1); evento só quando o selo muda; a marca d'água no
// armazém e, perdida, a releitura com aviso; armazém fora não é perda; erro do banco não derruba o laço. O canal é
// do estabelecimento de um cliente (chave `sgh:<cliente>:vigia:<estabelecimento>:<canal>`).
import type { CanalVigia } from '@sgh/contratos';
import type { ContextoNucleo } from '@sgh/nucleo';
import { describe, expect, it, vi } from 'vitest';
import { ArmazemMemoria, type ArmazemSessao } from '../../sessao/armazem.js';
import {
  type AlvoVigia,
  intervaloDoAmbiente,
  type LeituraCanal,
  type MarcaVigia,
  MotorVigia,
} from './vigia.js';

const PC: AlvoVigia = { cliente: 'c1', estabelecimento: 11 };
const HS: AlvoVigia = { cliente: 'c1', estabelecimento: 12 };

function fonte() {
  let selo = 'a';
  const chamadas: { ctx: ContextoNucleo; canal: CanalVigia; marca: MarcaVigia }[] = [];
  return {
    chamadas,
    mudar: (s: string) => (selo = s),
    falhar: false,
    ler(ctx: ContextoNucleo, canal: CanalVigia, marca: MarcaVigia): Promise<LeituraCanal> {
      chamadas.push({ ctx, canal, marca });
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
    lerCanal: (x, c, m) => f.ler(x, c, m),
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
        const cancelar = Array.from({ length: n }, () => m.assinar(PC, 'leitos', () => undefined));
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
      const sa = m.assinar(PC, 'leitos', (e) => a.push(e.versao));
      const sb = m.assinar(PC, 'leitos', (e) => b.push(e.versao));
      // Um ouvinte com defeito não derruba os outros.
      const sc = m.assinar(PC, 'leitos', () => {
        throw new Error('x');
      });
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(a).toEqual([]);
      f.mudar('b');
      await vi.advanceTimersByTimeAsync(1_000);
      expect(a).toEqual([1]);
      expect(b).toEqual([1]);
      expect(m.versao(PC, 'leitos')).toBe(1);
      expect(m.ultimoCiclo(PC, 'leitos')).not.toBeNull();
      expect(m.versao(HS, 'leitos')).toBe(0);
      expect(m.ultimoCiclo(HS, 'leitos')).toBeNull();
      sa();
      sb();
      sc();
      const antes = f.chamadas.length;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(f.chamadas.length).toBe(antes);
      const s = m.saude().canais[0]!;
      expect(s).toMatchObject({
        canal: 'leitos',
        estabelecimento: '11',
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
    m.assinar(PC, 'senhas', (e) => eventos.push(e.versao));
    m.parar(); // os ciclos à mão
    await m.cicloAgora(PC, 'senhas');
    await m.cicloAgora(PC, 'senhas');
    expect(f.chamadas.map((c) => c.marca.maiorId)).toEqual([0, 1]);
    // A leitura recebe o contexto do núcleo do canal, sem sessão (processo).
    expect(f.chamadas[0]?.ctx).toEqual({
      cliente: 'c1',
      estabelecimento: 11,
      usuario: null,
      correlacao: 'vigia-senhas',
    });
    expect(await armazem.obter('sgh:c1:vigia:11:senhas')).toBe(
      JSON.stringify({ maiorId: 2, maiorId2: 0, janela: 0 }),
    );
    await armazem.apagar('sgh:c1:vigia:11:senhas');
    await m.cicloAgora(PC, 'senhas');
    expect(f.chamadas.at(-1)?.marca.maiorId).toBe(0);
    expect(eventos).toEqual([1]);
    expect(m.saude().canais[0]?.releituras).toBe(1);
    // Marca ilegível no armazém: recomeça do zero.
    await armazem.gravar('sgh:c1:vigia:11:senhas', '{x', 60);
    await m.cicloAgora(PC, 'senhas');
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
      lerCanal: (x, c, mm) => f.ler(x, c, mm),
      armazem: fora,
      tipoArmazem: 'valkey',
      intervaloMs: 5,
      aviso: (msg) => avisos.push(msg),
    });
    const ev: number[] = [];
    m.assinar(PC, 'dispensacao', (e) => ev.push(e.versao));
    m.parar();
    await m.cicloAgora(PC, 'dispensacao');
    await m.cicloAgora(PC, 'dispensacao');
    expect(f.chamadas.map((c) => c.marca.maiorId)).toEqual([0, 1]);
    expect(ev).toEqual([]);
    f.falhar = true;
    await m.cicloAgora(PC, 'dispensacao');
    expect(m.saude()).toMatchObject({ marcaDagua: 'valkey', canais: [{ erros: 1, intervaloMs: 1_000 }] });
    expect(avisos).toEqual(['vigia: ciclo falhou']);
  });

  it('o mesmo estabelecimento em outro cliente é outro canal; sem estabelecimento não assina', async () => {
    const f = fonte();
    const m = motor(f);
    m.parar();
    await m.cicloAgora(PC, 'leitos');
    await m.cicloAgora({ cliente: 'c2', estabelecimento: 11 }, 'leitos');
    expect(f.chamadas.map((c) => c.ctx.cliente)).toEqual(['c1', 'c2']);
    expect(m.saude().canais).toHaveLength(2);
    expect(() => m.assinar({ cliente: 'c1', estabelecimento: null }, 'leitos', () => undefined)).toThrow();
  });

  it('intervalo de 1 a 2 s pelo ambiente', () => {
    expect(intervaloDoAmbiente({ VIGIA_MUDANCAS_MS: '2000' })).toBe(2_000);
    expect(intervaloDoAmbiente({ VIGIA_MUDANCAS_MS: '500' })).toBe(1_500);
    expect(intervaloDoAmbiente({})).toBe(1_500);
  });
});
