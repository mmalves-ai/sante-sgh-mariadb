import { describe, expect, it } from 'vitest';
import { ArmazemMemoria, chaveFila, enfileirarZpl, type TrabalhoZpl } from './fila.js';

const trabalho: TrabalhoZpl = {
  chaveIdempotencia: 'clique-0001-abc',
  rede: 'rede-teste',
  estabelecimento: 'zz',
  estacao: 'estacao-01',
  modelo: 'pulseira',
  zpl: '^XA^XZ',
};

describe('fila zpl idempotente', () => {
  it('mesma chave de idempotência = um trabalho só', async () => {
    const armazem = new ArmazemMemoria();
    const enviados: string[] = [];
    let n = 0;
    const destino = { enviar: async (t: { id: string }) => void enviados.push(t.id) };
    const r1 = await enfileirarZpl(trabalho, armazem, destino, () => `t${++n}`);
    const r2 = await enfileirarZpl(trabalho, armazem, destino, () => `t${++n}`);
    expect(r1).toEqual({ id: 't1', novo: true });
    expect(r2).toEqual({ id: 't1', novo: false });
    expect(enviados).toEqual(['t1']);
    const r3 = await enfileirarZpl(
      { ...trabalho, chaveIdempotencia: 'clique-0002-abc' },
      armazem,
      destino,
      () => `t${++n}`,
    );
    expect(r3.novo).toBe(true);
    expect(enviados).toHaveLength(2);
  });

  it('a chave expira depois da janela e leva o código da rede (ARQ-2)', async () => {
    let agora = 0;
    const armazem = new ArmazemMemoria(() => agora);
    expect(await armazem.reservar('k', 'a', 10)).toBe(true);
    expect(await armazem.reservar('k', 'b', 10)).toBe(false);
    agora = 11;
    expect(await armazem.ler('k')).toBeNull();
    expect(await armazem.reservar('k', 'c', 10)).toBe(true);
    expect(chaveFila(trabalho)).toBe('sgh:rede-teste:zz:zpl:clique-0001-abc');
    expect(() => chaveFila({ ...trabalho, chaveIdempotencia: 'curta' })).toThrow(/Idempotency-Key/);
    expect(() => chaveFila({ ...trabalho, rede: '' })).toThrow(/Rede/);
  });

  it('envio falhou depois da reserva: a reserva é desfeita e a nova tentativa cria o trabalho', async () => {
    const armazem = new ArmazemMemoria();
    let falhar = true;
    const enviados: string[] = [];
    const destino = {
      enviar: async (t: { id: string }) => {
        if (falhar) throw new Error('fila fora');
        enviados.push(t.id);
      },
    };
    await expect(enfileirarZpl(trabalho, armazem, destino, () => 'a1')).rejects.toThrow('fila fora');
    expect(await armazem.ler(chaveFila(trabalho))).toBeNull();
    falhar = false;
    expect(await enfileirarZpl(trabalho, armazem, destino, () => 'a2')).toEqual({ id: 'a2', novo: true });
    expect(enviados).toEqual(['a2']);
    // liberar só apaga a reserva do próprio valor (outra chamada que já reservou não perde a sua).
    await armazem.liberar(chaveFila(trabalho), 'outro');
    expect(await armazem.ler(chaveFila(trabalho))).toBe('a2');
  });
});
