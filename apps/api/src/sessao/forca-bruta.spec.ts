// Bloqueio da porta do novo (ficha do M05, regra 5): após o limite (TBCFGLOGIN, no máximo 10) a porta
// fecha para o login, sem gravar nada no legado. A tentativa é contada ANTES de conferir a senha, então
// uma rajada em paralelo não fura o limite. Fonte sintética, armazém em memória.
import { describe, expect, it, vi } from 'vitest';
import { REDE, SENHA, entrada, montar } from './teste.spec-util.js';

describe('força bruta', () => {
  it('fecha a porta depois de 10 falhas, mesmo com a senha certa', async () => {
    const { servico } = montar();
    for (let i = 0; i < 10; i++)
      await servico.entrar(entrada('SINT.USUARIO', 'errada'), REDE).catch(() => null);
    await expect(servico.entrar(entrada('SINT.USUARIO'), REDE)).rejects.toMatchObject({
      tipo: 'muitas-tentativas',
    });
  });

  it('rajada de 50 pedidos em paralelo: só 10 chegam a conferir a senha', async () => {
    const { servico, fonte } = montar();
    const conferencias = vi.spyOn(fonte, 'autenticar');
    const r = await Promise.allSettled(
      Array.from({ length: 50 }, () => servico.entrar(entrada('SINT.USUARIO', 'errada'), REDE)),
    );
    expect(conferencias).toHaveBeenCalledTimes(10);
    const tipos = r.map((x) => (x.status === 'rejected' ? (x.reason as { tipo: string }).tipo : 'ok'));
    expect(tipos.filter((t) => t === 'muitas-tentativas')).toHaveLength(40);
  });

  it('a porta reabre depois do prazo (ACESSO_BLOQUEIO_PORTA_MINUTOS)', async () => {
    let t = 1_000_000;
    const { servico } = montar({ agora: () => t, config: { bloqueioPortaSegundos: 60 } });
    for (let i = 0; i < 10; i++)
      await servico.entrar(entrada('SINT.USUARIO', 'errada'), REDE).catch(() => null);
    await expect(servico.entrar(entrada('SINT.USUARIO'), REDE)).rejects.toMatchObject({
      tipo: 'muitas-tentativas',
    });
    t += 61_000;
    await expect(servico.entrar(entrada('SINT.USUARIO'), REDE)).resolves.toBeTruthy();
  });

  it('o sucesso zera o contador', async () => {
    const { servico } = montar();
    for (let i = 0; i < 3; i++)
      await servico.entrar(entrada('SINT.USUARIO', 'errada'), REDE).catch(() => null);
    await servico.entrar(entrada('SINT.USUARIO'), REDE);
    for (let i = 0; i < 9; i++)
      await servico.entrar(entrada('SINT.USUARIO', 'errada'), REDE).catch(() => null);
    await expect(servico.entrar(entrada('SINT.USUARIO', SENHA), REDE)).resolves.toBeTruthy();
  });

  it('a reautenticação usa o mesmo contador (desbloqueio não vira força bruta)', async () => {
    const { servico } = montar();
    const r = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    for (let i = 0; i < 10; i++) await servico.reautenticar(r.idSessao, REDE, 'errada').catch(() => null);
    await expect(servico.reautenticar(r.idSessao, REDE, SENHA)).rejects.toMatchObject({
      tipo: 'muitas-tentativas',
    });
  });
});
