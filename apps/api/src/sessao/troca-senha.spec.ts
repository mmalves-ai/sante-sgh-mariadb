// W1-01 (parte 2): POST /api/sessao/senha pelo serviço de sessão. A senha atual conferida vale como reautenticação;
// a nova passa pela política e pelo reuso; a porta recebe só o resumo e o sal (nunca a senha) e grava pela receita
// acesso.trocarSenha; sem a combinação confirmada, a troca fica indisponível.
import { describe, expect, it } from 'vitest';
import { cifrarSenhaLegado, type ContextoOperacao, type SenhaLegado, verificarSenha } from '@sgh/legado';
import { estadoAcessoSintetico, reiniciarEstadoAcessoSintetico } from '../modulos/acesso/fonte-sintetica.js';
import { type PortaSenhaLegado, portaSenhaMemoria } from '../modulos/acesso/senha/porta-senha.js';
import { REDE, SENHA, entrada, montar } from './teste.spec-util.js';

const NOVA = 'Trocada#2026x';

function portaEspia(base = portaSenhaMemoria()) {
  const gravadas: { login: string; senha: SenhaLegado; ctx: ContextoOperacao }[] = [];
  const porta: PortaSenhaLegado = {
    combinacao: base.combinacao,
    reuso: (h, l, s, d) => base.reuso(h, l, s, d),
    nascimento: (h, l) => base.nascimento!(h, l),
    async gravar(h, l, s, ctx, tipo) {
      gravadas.push({ login: l, senha: s, ctx });
      return base.gravar(h, l, s, ctx, tipo);
    },
  };
  return { porta, gravadas, base };
}

async function sessaoCom(porta: PortaSenhaLegado | undefined, trocaSenhaPeloNovo = true) {
  let t = 1_000_000;
  const avisos: unknown[] = [];
  const m = montar({
    agora: () => t,
    config: {
      trocaSenhaPeloNovo,
      ...(porta ? { senhaLegado: porta } : {}),
      aviso: (msg, campos) => avisos.push({ msg, campos }),
    },
  });
  const r = await m.servico.entrar(entrada('SINT.USUARIO'), REDE);
  return { ...m, id: r.idSessao, avisos, avancar: (ms: number) => (t += ms) };
}

describe('troca de senha pelo novo (acesso.trocarSenha)', () => {
  it('grava pela porta só o resumo de 40 hex e o sal de 20, com a combinação fixada, e limpa a troca pendente', async () => {
    const { porta, gravadas } = portaEspia();
    const { servico, id } = await sessaoCom(porta);
    const s = await servico.trocarSenha(id, REDE, { senhaAtual: SENHA, senhaNova: NOVA });
    expect(s.trocaSenha ?? null).toBeNull();
    expect(gravadas).toHaveLength(1);
    const g = gravadas[0]!;
    expect(g.login).toBe('SINT.USUARIO');
    expect(g.senha.resumo).toMatch(/^[0-9A-F]{40}$/);
    expect(g.senha.sal).toMatch(/^[0-9A-Z]{20}$/);
    // O resumo confere com a senha nova pela combinação fixada (o legado entra com ela).
    expect(
      verificarSenha(
        NOVA,
        { senha: g.senha.resumo, salt: g.senha.sal, criptografada: true },
        porta.combinacao!,
      ).confere,
    ).toBe(true);
    expect(g.ctx.usuarioLegado).toBe('SINT.USUARIO');
    expect(g.ctx.reautenticadoEm).toBeTypeOf('number');
    // Varredura: a senha digitada nunca chega ao contexto da receita.
    expect(JSON.stringify(g.ctx)).not.toContain(NOVA);
    expect(JSON.stringify(g.ctx)).not.toContain(SENHA);
  });

  it('revisão W1-01: com a política que recusa o nascimento, a troca recusa a senha derivada da data do profissional vinculado', async () => {
    reiniciarEstadoAcessoSintetico();
    try {
      const agora = new Date();
      estadoAcessoSintetico().publicarPoliticaSenha(
        {
          hospital: 'qualquer',
          minimoCaracteres: 8,
          exigeEspecial: false,
          exigeMinuscula: false,
          exigeMaiuscula: false,
          trocaDias: 0,
          reusoDias: 0,
          recusaNome: false,
          recusaNascimento: true,
          recusaComuns: false,
          senhasProibidas: [],
          vigenteDesde: new Date(agora.getTime() - 1000),
          motivo: 'teste',
          por: 'SINT.GESTOR',
        },
        agora,
      );
      const base = portaSenhaMemoria();
      const lidas: string[] = [];
      const { porta, gravadas } = portaEspia(base);
      const comData: PortaSenhaLegado = {
        ...porta,
        nascimento: (_h, l) => {
          lidas.push(l);
          return Promise.resolve('1985-03-12');
        },
      };
      const { servico, id } = await sessaoCom(comData);
      for (const senhaNova of ['Hosp12031985!', 'Hosp19850312!', 'Hosp120385x!'])
        await expect(servico.trocarSenha(id, REDE, { senhaAtual: SENHA, senhaNova })).rejects.toMatchObject({
          tipo: 'senha-recusada',
          falhas: ['deriva-do-nascimento'],
        });
      expect(lidas).toEqual(['SINT.USUARIO', 'SINT.USUARIO', 'SINT.USUARIO']);
      expect(gravadas).toHaveLength(0);
      await servico.trocarSenha(id, REDE, { senhaAtual: SENHA, senhaNova: 'Kq7#mWz2pLx9vT' });
      expect(gravadas).toHaveLength(1);
      // Sem data conhecida (sem vínculo com o profissional), a mesma senha passa.
      const semData = portaEspia(base);
      const s2 = await sessaoCom(semData.porta);
      await s2.servico.trocarSenha(s2.id, REDE, { senhaAtual: SENHA, senhaNova: 'Hosp12031985!' });
      expect(semData.gravadas).toHaveLength(1);
    } finally {
      reiniciarEstadoAcessoSintetico();
    }
  });

  it('W1-01 (parte 5): a política do Sante publicada aperta a troca (tamanho, senha comum, nome); sem ela, a mesma senha passa', async () => {
    reiniciarEstadoAcessoSintetico();
    try {
      const agora = new Date();
      estadoAcessoSintetico().publicarPoliticaSenha(
        {
          hospital: 'qualquer',
          minimoCaracteres: 14,
          exigeEspecial: false,
          exigeMinuscula: false,
          exigeMaiuscula: false,
          trocaDias: 0,
          reusoDias: 0,
          recusaNome: false,
          recusaNascimento: false,
          recusaComuns: true,
          senhasProibidas: ['Redesante'],
          vigenteDesde: new Date(agora.getTime() - 1000),
          motivo: 'teste',
          por: 'SINT.GESTOR',
        },
        agora,
      );
      const { porta, gravadas } = portaEspia();
      const { servico, id } = await sessaoCom(porta);
      await expect(
        servico.trocarSenha(id, REDE, { senhaAtual: SENHA, senhaNova: 'Brasil#2024' }),
      ).rejects.toMatchObject({ tipo: 'senha-recusada', falhas: expect.arrayContaining(['curta', 'comum']) });
      await expect(
        servico.trocarSenha(id, REDE, { senhaAtual: SENHA, senhaNova: 'RedeSante#20241' }),
      ).rejects.toMatchObject({ falhas: ['comum'] });
      expect(gravadas).toHaveLength(0);
      await servico.trocarSenha(id, REDE, { senhaAtual: SENHA, senhaNova: 'Kq7#mWz2pLx9vT' });
      expect(gravadas).toHaveLength(1);
    } finally {
      reiniciarEstadoAcessoSintetico();
    }
    const { porta, gravadas } = portaEspia();
    const { servico, id } = await sessaoCom(porta);
    await servico.trocarSenha(id, REDE, { senhaAtual: SENHA, senhaNova: 'Brasil#2024' });
    expect(gravadas).toHaveLength(1);
  });

  it('senha atual errada: credencial-invalida e nada gravado', async () => {
    const { porta, gravadas } = portaEspia();
    const { servico, id } = await sessaoCom(porta);
    await expect(
      servico.trocarSenha(id, REDE, { senhaAtual: 'errada-123', senhaNova: NOVA }),
    ).rejects.toMatchObject({ tipo: 'credencial-invalida' });
    expect(gravadas).toHaveLength(0);
  });

  it('política: curta, sem número, derivada do login e igual à atual voltam como códigos', async () => {
    const { porta, gravadas } = portaEspia();
    const { servico, id } = await sessaoCom(porta);
    await expect(
      servico.trocarSenha(id, REDE, { senhaAtual: SENHA, senhaNova: 'abc' }),
    ).rejects.toMatchObject({
      tipo: 'senha-recusada',
      falhas: expect.arrayContaining(['curta', 'sem-numero']),
    });
    await expect(
      servico.trocarSenha(id, REDE, { senhaAtual: SENHA, senhaNova: 'sint.usuario99' }),
    ).rejects.toMatchObject({ falhas: expect.arrayContaining(['deriva-do-login']) });
    await expect(
      servico.trocarSenha(id, REDE, { senhaAtual: SENHA, senhaNova: SENHA }),
    ).rejects.toMatchObject({ falhas: expect.arrayContaining(['igual-atual']) });
    expect(gravadas).toHaveLength(0);
  });

  it('reuso: a senha guardada (atual) é recusada como igual-atual pela porta', async () => {
    const { porta, base } = portaEspia();
    const { servico, id } = await sessaoCom(porta);
    await servico.trocarSenha(id, REDE, { senhaAtual: SENHA, senhaNova: NOVA });
    expect(base.trocas('aa', 'SINT.USUARIO')).toBe(1);
    // Na fonte sintética a senha atual continua a do repositório; a porta conhece o resumo gravado.
    await expect(servico.trocarSenha(id, REDE, { senhaAtual: SENHA, senhaNova: NOVA })).rejects.toMatchObject(
      { tipo: 'senha-recusada', falhas: ['igual-atual'] },
    );
  });

  it('sem a combinação confirmada, sem a porta ou com a chave desligada: troca indisponível', async () => {
    const semComb: PortaSenhaLegado = { ...portaSenhaMemoria(), combinacao: null };
    for (const [porta, ligada] of [
      [semComb, true],
      [undefined, true],
      [portaSenhaMemoria(), false],
    ] as const) {
      const { servico, id } = await sessaoCom(porta, ligada);
      const s = await servico.ler(id, REDE);
      expect(s?.sessao.trocaSenhaPeloNovo).toBe(false);
      await expect(
        servico.trocarSenha(id, REDE, { senhaAtual: SENHA, senhaNova: NOVA }),
      ).rejects.toMatchObject({ tipo: 'troca-indisponivel' });
    }
    const { servico, id } = await sessaoCom(portaSenhaMemoria());
    expect((await servico.ler(id, REDE))?.sessao.trocaSenhaPeloNovo).toBe(true);
  });

  it('cifrarSenhaLegado nunca grava texto puro', () => {
    expect(() => cifrarSenhaLegado(NOVA, 'texto-puro')).toThrow();
    expect(() => cifrarSenhaLegado(NOVA, null)).toThrow();
  });
});
