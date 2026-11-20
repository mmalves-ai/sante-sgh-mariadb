// Entrar (ficha do M05, regras 3, 4 e 13): só entra quem o legado deixa entrar, mensagem genérica, conta
// sem senha guardada nunca abre sessão, conta sem cifra com senha vai à troca obrigatória e o usuário
// técnico da sante-api (STATUS='F', BLOQUEADO='T') não entra. Fonte sintética, sem dado pessoal.
import { describe, expect, it } from 'vitest';
import { REDE, entrada, montar } from '../../../sessao/teste.spec-util.js';

describe('entrar', () => {
  it('senha errada, conta impedida e login inexistente: o mesmo desfecho genérico', async () => {
    const { servico } = montar();
    for (const e of [
      entrada('SINT.USUARIO', 'errada'),
      entrada('SINT.BLOQUEADO'),
      entrada('NAO.EXISTE', 'x'),
    ]) {
      await expect(servico.entrar(e, REDE)).rejects.toMatchObject({
        tipo: 'credencial-invalida',
        detalhe: 'Usuário ou senha inválidos.',
      });
    }
  });

  it('conta sem senha guardada (sem cifra, SENHA nula) NUNCA abre sessão, com qualquer texto', async () => {
    const { servico } = montar();
    for (const senha of ['qualquer', '', 'Sintetico#2026']) {
      await expect(servico.entrar(entrada('SINT.SEMCIFRA', senha), REDE)).rejects.toMatchObject({
        tipo: 'primeiro-acesso',
      });
    }
  });

  it('conta sem cifra com senha em texto puro: confere a senha e vai à troca obrigatória (regra 3)', async () => {
    const { servico } = montar();
    await expect(servico.entrar(entrada('SINT.TEXTOPURO', 'errada'), REDE)).rejects.toMatchObject({
      tipo: 'credencial-invalida',
    });
    const r = await servico.entrar(entrada('SINT.TEXTOPURO', 'Textopuro#2026'), REDE);
    expect(r.sessao.trocaSenha).toBe('senha-sem-cifra');
    expect(r.sessao.trocaSenhaPeloNovo).toBe(false);
  });

  it('estabelecimento fora da configuração é recusado', async () => {
    const { servico } = montar();
    await expect(servico.entrar(entrada('SINT.USUARIO', undefined, 'xx'), REDE)).rejects.toMatchObject({
      tipo: 'estabelecimento-invalido',
    });
  });
});
