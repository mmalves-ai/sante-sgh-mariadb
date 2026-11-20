// Reautenticação (ficha do M05, regra 11): operações críticas pedem senha recente; fora da janela, Problem
// Details `reautenticacao-necessaria`. Só a senha conferida desbloqueia ("sem-cifra" nunca vale).
import { describe, expect, it } from 'vitest';
import type { FonteAcesso } from './fonte-acesso.js';
import { REDE, SENHA, entrada, envTeste, montar } from './teste.spec-util.js';
import { FonteAcessoSintetica } from '../modulos/acesso/fonte-sintetica.js';

describe('reautenticação', () => {
  it('dentro da janela passa; fora dela, reautenticacao-necessaria; senha certa renova', async () => {
    let t = 1_000_000;
    const { servico } = montar({ agora: () => t });
    const r = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    await expect(servico.exigirReautenticacaoRecente(r.idSessao, REDE)).resolves.toBeTruthy();
    t += 5 * 60 * 1000 + 1000;
    await servico.tocar(r.idSessao, REDE);
    await expect(servico.exigirReautenticacaoRecente(r.idSessao, REDE)).rejects.toMatchObject({
      tipo: 'reautenticacao-necessaria',
    });
    await expect(servico.reautenticar(r.idSessao, REDE, 'errada')).rejects.toMatchObject({
      tipo: 'credencial-invalida',
    });
    const s = await servico.reautenticar(r.idSessao, REDE, SENHA);
    expect(s.reautenticacaoValidaAte).not.toBeNull();
    await expect(servico.exigirReautenticacaoRecente(r.idSessao, REDE)).resolves.toBeTruthy();
  });

  it('desfecho "sem-cifra" (nada conferido) não desbloqueia', async () => {
    let t = 1_000_000;
    const base = new FonteAcessoSintetica(envTeste);
    let semCifra = false;
    const fonte: FonteAcesso = {
      rede: base.rede,
      estabelecimentos: base.estabelecimentos,
      saude: () => base.saude(),
      configLogin: () => base.configLogin(),
      dadosDeSessao: (c, l, cfg) => base.dadosDeSessao(c, l, cfg),
      dadosDeAutorizacao: (c, l) => base.dadosDeAutorizacao(c, l),
      autenticar: async (c, l, s) => {
        const a = await base.autenticar(c, l, s);
        return semCifra && a.desfecho === 'ok' ? { desfecho: 'sem-cifra', conta: a.conta } : a;
      },
    };
    const { servico } = montar({ agora: () => t, fonte });
    const r = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    t += 1801 * 1000;
    expect((await servico.ler(r.idSessao, REDE))?.sessao.bloqueada).toBe(true);
    semCifra = true; // a senha da conta foi apagada no legado depois do login
    await expect(servico.reautenticar(r.idSessao, REDE, 'qualquer')).rejects.toMatchObject({
      tipo: 'credencial-invalida',
    });
    expect((await servico.ler(r.idSessao, REDE))?.sessao.bloqueada).toBe(true);
  });

  it('sessão bloqueada não passa na guarda de operação crítica', async () => {
    let t = 1_000_000;
    const { servico } = montar({ agora: () => t });
    const r = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    t += 1801 * 1000;
    await expect(servico.exigirReautenticacaoRecente(r.idSessao, REDE)).rejects.toMatchObject({
      tipo: 'sessao-bloqueada',
    });
  });
});
