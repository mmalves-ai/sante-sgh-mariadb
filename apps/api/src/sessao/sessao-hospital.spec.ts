// Um hospital por sessão (ficha do M05, regra 7): cada banco tem o seu TBUSERS; a sessão guarda o
// estabelecimento em que o login foi conferido, e trocar de estabelecimento é novo login (a sessão
// anterior é apagada). Pela HTTP, POST /api/sessao/estabelecimento com sessão real responde 409.
import { describe, expect, it } from 'vitest';
import { REDE, entrada, montar } from './teste.spec-util.js';

describe('sessão por estabelecimento', () => {
  it('o mesmo login em aa e bb são sessões distintas, cada uma presa ao seu estabelecimento', async () => {
    const { servico } = montar();
    const a = await servico.entrar(entrada('SINT.USUARIO', undefined, 'aa'), REDE);
    const b = await servico.entrar(entrada('SINT.USUARIO', undefined, 'bb'), REDE);
    expect(a.sessao.estabelecimentoAtivo).toBe('aa');
    expect(b.sessao.estabelecimentoAtivo).toBe('bb');
    expect((await servico.ler(a.idSessao, REDE))?.registro.estabelecimento).toBe('aa');
  });
});
