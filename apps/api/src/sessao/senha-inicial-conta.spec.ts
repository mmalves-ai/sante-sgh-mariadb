// 01-ADM L57 (C1-045, revisão): a conclusão da senha inicial da conta criada pelo gestor. A regravação da credencial
// forte vai com o gestor como autor da trilha (não a conta recém-criada); a regravação não feita ou com falha vai ao
// aviso, sem a senha, e não desfaz nada (a troca obrigatória é a da credencial gravada pela receita).
import { describe, expect, it } from 'vitest';
import type { AtorIdentidadeSessao, GanchoIdentidade } from './servico-sessao.js';
import { cifrarSenha } from '@sgh/dominio-acesso';
import { estadoAcessoSintetico, reiniciarEstadoAcessoSintetico } from '../modulos/acesso/fonte-sintetica.js';
import { REDE, entrada, montar } from './teste.spec-util.js';

const ORIGEM = { estacao: 'SGH-WEB:teste', correlacao: 'teste-senha-inicial' };
const SENHA = 'Provisoria#Sint2026';

function identidade(desfecho: () => Promise<boolean>) {
  const chamadas: {
    a: AtorIdentidadeSessao;
    senha: string;
    origem?: string;
    autor?: AtorIdentidadeSessao;
  }[] = [];
  const gancho: GanchoIdentidade = {
    autenticar: async () => ({ tipo: 'legado' as const }),
    regravar: async (a, senha, origem, autor) => {
      chamadas.push({ a, senha, ...(origem ? { origem } : {}), ...(autor ? { autor } : {}) });
      return desfecho();
    },
    segundoFatorNoLogin: async () => ({
      tipo: 'entrar' as const,
      info: { cadastrado: false, disponivel: true, exigencia: 'opcional' as const, prazoAdesaoAte: null },
    }),
  };
  return { gancho, chamadas };
}

function comAviso(desfecho: () => Promise<boolean>) {
  const avisos: { mensagem: string; campos: Record<string, unknown> }[] = [];
  const { gancho, chamadas } = identidade(desfecho);
  const { servico } = montar({
    config: { identidade: gancho, aviso: (mensagem, campos) => avisos.push({ mensagem, campos }) },
  });
  return { servico, chamadas, avisos };
}

describe('conclusão da senha inicial da conta criada (identidade)', () => {
  it('regrava com origem senha-provisoria, a conta nova como alvo e o gestor como autor', async () => {
    const { servico, chamadas, avisos } = comAviso(async () => true);
    const feita = await servico.concluirSenhaInicial(
      { rede: REDE, estabelecimento: 'aa', login: 'SINT.GESTOR', idUsuario: 41 },
      'SINT.NOVA',
      77,
      SENHA,
      ORIGEM,
    );
    expect(feita).toBe(true);
    expect(avisos).toEqual([]);
    expect(chamadas).toHaveLength(1);
    const c = chamadas[0]!;
    expect(c.origem).toBe('senha-provisoria');
    expect(c.senha).toBe(SENHA);
    expect([c.a.login, c.a.idUsuario, c.a.hospital]).toEqual(['SINT.NOVA', 77, 'aa']);
    expect([c.autor?.login, c.autor?.idUsuario, c.autor?.correlacao]).toEqual([
      'SINT.GESTOR',
      41,
      ORIGEM.correlacao,
    ]);
  });

  it('sem o usuario.id do gestor (conta sintética), não inventa autor', async () => {
    const { servico, chamadas } = comAviso(async () => true);
    await servico.concluirSenhaInicial(
      { rede: REDE, estabelecimento: 'aa', login: 'SINT.GESTOR', idUsuario: null },
      'SINT.NOVA',
      77,
      SENHA,
      ORIGEM,
    );
    expect(chamadas[0]?.autor).toBeUndefined();
  });

  it('regravação não feita ou com falha vai ao aviso, sem a senha, e não lança', async () => {
    for (const desfecho of [async () => false, async () => Promise.reject(new TypeError('fora'))]) {
      const { servico, avisos } = comAviso(desfecho);
      const feita = await servico.concluirSenhaInicial(
        { rede: REDE, estabelecimento: 'aa', login: 'SINT.GESTOR', idUsuario: 41 },
        'SINT.NOVA',
        77,
        SENHA,
        ORIGEM,
      );
      expect(feita).toBe(false);
      expect(avisos).toHaveLength(1);
      expect(avisos[0]?.mensagem).toMatch(/^senha inicial: /);
      expect(JSON.stringify(avisos)).not.toContain(SENHA);
      expect(avisos[0]?.campos['correlacao']).toBe(ORIGEM.correlacao);
    }
  });

  it('sem o serviço da identidade: nada a regravar', async () => {
    const { servico } = montar({ config: {} });
    expect(
      await servico.concluirSenhaInicial(
        { rede: REDE, estabelecimento: 'aa', login: 'SINT.GESTOR', idUsuario: 41 },
        'SINT.NOVA',
        77,
        SENHA,
        ORIGEM,
      ),
    ).toBe(false);
  });

  it('sessão sintética: a conta criada em memória entra com a senha inicial e vai à troca obrigatória', async () => {
    reiniciarEstadoAcessoSintetico();
    const e = estadoAcessoSintetico();
    e.contas.set('SINT.NOVA', {
      id: 990077,
      grupo: 'SAME',
      papeis: new Map([[4, true]]),
      flags: [],
      conselho: false,
    });
    e.credenciaisIniciais.set(
      'SINT.NOVA',
      await cifrarSenha(SENHA, { memoria: 8_192, passes: 1, paralelismo: 1 }),
    );
    const { servico } = montar({ config: {} });
    await expect(servico.entrar(entrada('SINT.NOVA', `${SENHA}x`), REDE)).rejects.toMatchObject({
      tipo: 'credencial-invalida',
    });
    const r = await servico.entrar(entrada('SINT.NOVA', SENHA), REDE);
    expect(r.sessao.trocaSenha).toBeTruthy();
    // Sem a credencial inicial (conta criada sem senha), não entra.
    e.credenciaisIniciais.delete('SINT.NOVA');
    await expect(servico.entrar(entrada('SINT.NOVA', SENHA), REDE)).rejects.toMatchObject({
      tipo: 'credencial-invalida',
    });
    reiniciarEstadoAcessoSintetico();
  });
});
