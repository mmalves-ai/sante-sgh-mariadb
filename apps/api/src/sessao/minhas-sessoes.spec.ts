// W1-01 (parte 8): sessões e dispositivos. O limite de sessões simultâneas do perfil (SGH_ACESSO_LIMITE_SESSAO; '*' é
// o padrão) recusa a sessão excedente; "Minhas sessões" lista as da própria pessoa sem id nem token e encerra as
// outras (ou uma), cada uma na trilha. Fonte sintética e armazém em memória; sem dado pessoal.
import { describe, expect, it, vi } from 'vitest';
import type { ConfigLogin } from '@sgh/legado';
import { descreverDispositivo } from './dispositivo.js';
import { ErroSessao, type OrigemPedido } from './servico-sessao.js';
import { REDE, entrada, envTeste, montar } from './teste.spec-util.js';
import { FonteAcessoSintetica } from '../modulos/acesso/fonte-sintetica.js';

const origem = (dispositivo: string): OrigemPedido => ({ estacao: 'teste', correlacao: 'c', dispositivo });

function comLimites(limites: Record<string, number>): FonteAcessoSintetica {
  const fonte = new FonteAcessoSintetica(envTeste);
  const base = fonte.configLogin.bind(fonte);
  vi.spyOn(fonte, 'configLogin').mockImplementation(async (): Promise<ConfigLogin> => ({
    ...(await base()),
    limitesSessao: limites,
  }));
  return fonte;
}

describe('W1-01 (parte 8): limite de sessões simultâneas', () => {
  it("com o padrão '*' = 2, a terceira entrada é recusada com mensagem; sair libera a vaga", async () => {
    const { servico } = montar({ fonte: comLimites({ '*': 2 }) });
    const a = await servico.entrar(entrada('SINT.USUARIO'), REDE, null, origem('Chrome no Windows'));
    await servico.entrar(entrada('SINT.USUARIO'), REDE, null, origem('Firefox no Linux'));
    const e = await servico.entrar(entrada('SINT.USUARIO'), REDE).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroSessao);
    expect((e as ErroSessao).tipo).toBe('limite-sessoes');
    expect((e as ErroSessao).detalhe).toContain('2 sessões abertas');
    // Outra pessoa não é afetada.
    await expect(servico.entrar(entrada('SINT.MEDICO'), REDE)).resolves.toBeTruthy();
    await servico.sair(a.idSessao, REDE);
    await expect(servico.entrar(entrada('SINT.USUARIO'), REDE)).resolves.toBeTruthy();
  });

  it('o novo login no mesmo navegador (sessão anterior descartada) não conta como excedente', async () => {
    const { servico } = montar({ fonte: comLimites({ '*': 1 }) });
    const a = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    await expect(servico.entrar(entrada('SINT.USUARIO'), REDE, a.idSessao)).resolves.toBeTruthy();
  });

  it('limite só de outro perfil (sem o padrão) não limita; sem limites, nada muda', async () => {
    const { servico } = montar({ fonte: comLimites({ medico: 1 }) });
    await servico.entrar(entrada('SINT.USUARIO'), REDE);
    await expect(servico.entrar(entrada('SINT.USUARIO'), REDE)).resolves.toBeTruthy();
  });
});

describe('W1-01 (parte 8): Minhas sessões', () => {
  it('lista as próprias sessões sem id nem token, a atual marcada, com o dispositivo', async () => {
    const { servico } = montar();
    const a = await servico.entrar(entrada('SINT.USUARIO'), REDE, null, origem('Chrome no Windows'));
    const b = await servico.entrar(entrada('SINT.USUARIO'), REDE, null, origem('Safari no iOS'));
    await servico.entrar(entrada('SINT.MEDICO'), REDE);
    const lista = await servico.minhasSessoes(b.idSessao, REDE);
    expect(lista).toHaveLength(2);
    expect(lista.find((x) => x.atual)?.dispositivo).toBe('Safari no iOS');
    expect(lista.find((x) => !x.atual)?.dispositivo).toBe('Chrome no Windows');
    const texto = JSON.stringify(lista);
    for (const segredo of [a.idSessao, b.idSessao, a.csrf, b.csrf]) expect(texto).not.toContain(segredo);
    expect(lista.every((x) => /^[0-9a-f]{24}$/.test(x.ref))).toBe(true);
  });

  it('encerrar as outras derruba todas menos a atual e registra cada uma na trilha', async () => {
    const registrados: string[] = [];
    const trilha = {
      registrar: (l: { evento: string }) => {
        registrados.push(l.evento);
        return Promise.resolve();
      },
    };
    const { servico } = montar({ config: { trilha } as never });
    const a = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    const b = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    const c = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    registrados.length = 0;
    expect(await servico.encerrarMinhasSessoes(c.idSessao, REDE, null)).toBe(2);
    expect(await servico.ler(a.idSessao, REDE)).toBeNull();
    expect(await servico.ler(b.idSessao, REDE)).toBeNull();
    expect(await servico.ler(c.idSessao, REDE)).not.toBeNull();
    expect(registrados).toHaveLength(2);
    expect(await servico.minhasSessoes(c.idSessao, REDE)).toHaveLength(1);
  });

  it('encerrar uma pela referência; a atual e a desconhecida são recusadas', async () => {
    const { servico } = montar();
    const a = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    const b = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    const lista = await servico.minhasSessoes(b.idSessao, REDE);
    const outra = lista.find((x) => !x.atual)!.ref;
    const atual = lista.find((x) => x.atual)!.ref;
    await expect(servico.encerrarMinhasSessoes(b.idSessao, REDE, atual)).rejects.toMatchObject({
      tipo: 'sessao-nao-encontrada',
    });
    expect(await servico.encerrarMinhasSessoes(b.idSessao, REDE, outra)).toBe(1);
    expect(await servico.ler(a.idSessao, REDE)).toBeNull();
    await expect(servico.encerrarMinhasSessoes(b.idSessao, REDE, outra)).rejects.toMatchObject({
      tipo: 'sessao-nao-encontrada',
    });
  });
});

describe('W1-01 (parte 8): dispositivo pelo User-Agent', () => {
  it('só navegador e sistema, nunca o texto bruto', () => {
    expect(
      descreverDispositivo(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      ),
    ).toBe('Chrome no Windows');
    expect(
      descreverDispositivo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/604.1'),
    ).toBe('Safari no iOS');
    expect(descreverDispositivo('Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko Firefox/128.0')).toBe(
      'Firefox no Linux',
    );
    expect(descreverDispositivo('curl/8.0')).toBe('Outro dispositivo');
    expect(descreverDispositivo(undefined)).toBeUndefined();
  });
});
