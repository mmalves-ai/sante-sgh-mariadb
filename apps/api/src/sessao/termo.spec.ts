// Termo de uso (ficha do M05, regra 12): sem aceite da versão vigente, a sessão sai com termoPendente.
// Quem aceitou (no SPDATA) não aceita de novo. A gravação do aceite pelo novo é do M10.
import { describe, expect, it } from 'vitest';
import { REDE, entrada, montar } from './teste.spec-util.js';

describe('termo de uso', () => {
  it('sem aceite → termoPendente; com aceite → não pendente', async () => {
    const { servico } = montar();
    expect((await servico.entrar(entrada('SINT.TERMO'), REDE)).sessao.termoPendente).toBe(true);
    expect((await servico.entrar(entrada('SINT.USUARIO'), REDE)).sessao.termoPendente).toBe(false);
  });
});
