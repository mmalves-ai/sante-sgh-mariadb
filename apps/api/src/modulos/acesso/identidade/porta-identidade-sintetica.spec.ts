// M59.2: a identidade sobre a fonte sintética (dev/ci, E2E) conhece só as contas sintéticas da identidade, com o ID
// sintético da fonte; as demais seguem pela senha antiga sem regravar.
import { describe, expect, it } from 'vitest';
import { CONTAS_IDENTIDADE_SINTETICAS, idUsuarioSintetico } from '../fonte-sintetica.js';
import { portaIdentidadeSintetica } from './porta-identidade-sintetica.js';
import { ServicoIdentidade } from './servico-identidade.js';

describe('porta da identidade sintética (M59.2)', () => {
  it('semeia só as contas da identidade, com o ID e o grupo da fonte sintética', async () => {
    const porta = portaIdentidadeSintetica();
    expect([...porta.usuariosPorLogin.keys()]).toEqual([...CONTAS_IDENTIDADE_SINTETICAS]);
    const critico = await porta.conta('pc', 'SINT.IDENT.CRITICO');
    expect(critico).toMatchObject({
      id: idUsuarioSintetico('SINT.IDENT.CRITICO'),
      grupo: 'MASTER',
      ativo: true,
    });
    expect(await porta.conta('pc', 'SINT.USUARIO')).toBeNull();
  });

  it('a conta da identidade regrava e passa a entrar pela forte; outra conta segue pela senha antiga', async () => {
    const porta = portaIdentidadeSintetica();
    const s = new ServicoIdentidade({
      porta,
      contingencia: async () => true,
      chave: Buffer.alloc(32, 3),
      emissor: 'Produto sintético',
      argon2: { memoria: 8_192, passes: 1, paralelismo: 1 },
    });
    const ator = (login: string) => ({
      rede: 'rede-sintetica',
      hospital: 'pc',
      login,
      idUsuario: idUsuarioSintetico(login),
      estacao: 'ESTACAO:teste',
      correlacao: 'c-1',
    });
    expect(await s.autenticar('pc', 'SINT.IDENT', 'Sintetico#2026')).toEqual({ tipo: 'legado' });
    expect(await s.regravar(ator('SINT.IDENT'), 'Sintetico#2026')).toBe(true);
    expect(await s.autenticar('pc', 'SINT.IDENT', 'Sintetico#2026')).toMatchObject({ tipo: 'forte-ok' });
    expect(await s.regravar(ator('SINT.USUARIO'), 'Sintetico#2026')).toBe(false);
    expect(await s.autenticar('pc', 'SINT.USUARIO', 'Sintetico#2026')).toEqual({ tipo: 'legado' });
  });
});

describe('conta sintética fora da identidade (M59.2)', () => {
  it('o cadastro do segundo fator fica indisponível (503), sem erro do servidor', async () => {
    const s = new ServicoIdentidade({
      porta: portaIdentidadeSintetica(),
      contingencia: async () => true,
      chave: Buffer.alloc(32, 3),
      emissor: 'Produto sintético',
    });
    const ator = {
      rede: 'rede-sintetica',
      hospital: 'pc',
      login: 'SINT.USUARIO',
      idUsuario: idUsuarioSintetico('SINT.USUARIO'),
      estacao: 'ESTACAO:teste',
      correlacao: 'c-1',
    };
    const alcance = { perfil: null, complementares: [], grupo: null };
    expect((await s.meuSegundoFator(ator, alcance)).disponivel).toBe(false);
    await expect(s.iniciarCadastro(ator)).rejects.toMatchObject({ status: 503 });
  });
});
