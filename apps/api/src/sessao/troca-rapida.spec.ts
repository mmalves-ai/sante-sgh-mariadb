// W1-01 (parte 11b2): troca rápida de usuário por PIN no servidor (sem rota). Fonte sintética, armazém e porta do PIN
// em memória, relógio simulado; sem dado pessoal. Prova: o PIN só com a senha, a recusa do trivial, a troca só depois
// do login forte HOJE nesta estação, a sessão anterior BLOQUEADA (não encerrada), a resposta genérica, o bloqueio
// por erros seguidos, o gestor retirando o PIN, e que o PIN nunca aparece na trilha nem na porta (só o hash).
import { describe, expect, it } from 'vitest';
import { PADRAO_TROCA_RAPIDA, type ParametrosTrocaRapida } from '@sgh/dominio-acesso';
import { RegistradorTrilhaMemoria } from '../autorizacao/trilha.js';
import { portaPinMemoria } from './porta-pin.js';
import { ErroSessao, type OrigemPedido } from './servico-sessao.js';
import { MENSAGEM_TROCA_RECUSADA, ServicoTrocaRapida } from './troca-rapida.js';
import { REDE, SENHA, entrada, montar } from './teste.spec-util.js';

// O posto é o resumo do cookie do posto (o controlador o calcula); o IP fica só na trilha.
const E1: OrigemPedido = { estacao: 'SGH-WEB:10.0.0.1', correlacao: 'c1', posto: 'p1' };
const E2: OrigemPedido = { estacao: 'SGH-WEB:10.0.0.2', correlacao: 'c2', posto: 'p2' };
const PIN = '384716';

function cenario(p: Partial<ParametrosTrocaRapida> = {}, cifraReal = false) {
  let t = Date.parse('2026-11-19T13:00:00Z');
  const agora = () => t;
  const trilha = new RegistradorTrilhaMemoria();
  const linhasPin: string[] = [];
  const porta = portaPinMemoria((x) => linhasPin.push(JSON.stringify(x)), agora);
  const { servico } = montar({ agora, config: { trilha } });
  const parametros = { ...PADRAO_TROCA_RAPIDA, ...p };
  const troca = new ServicoTrocaRapida(servico, {
    porta,
    parametros: () => Promise.resolve(parametros),
    trilha,
    agora,
    ...(cifraReal
      ? {}
      : {
          cifrar: (pin: string) => Promise.resolve(`$argon2id$teste$${[...pin].reverse().join('')}`),
          conferir: (pin: string, h: string | null) =>
            Promise.resolve(h === `$argon2id$teste$${[...pin].reverse().join('')}`),
        }),
  });
  return {
    servico,
    troca,
    porta,
    trilha,
    linhasPin,
    parametros,
    avancar: (ms: number) => void (t += ms),
  };
}

const recusa = (e: unknown) => {
  expect(e).toBeInstanceOf(ErroSessao);
  return e as ErroSessao;
};

describe('W1-01 (parte 11b2): PIN da própria pessoa', () => {
  it('só com a senha certa; recusa o trivial e o curto; define e troca; situação sem o hash', async () => {
    const c = cenario();
    const a = await c.servico.entrar(entrada('SINT.USUARIO'), REDE, null, E1);
    expect(
      recusa(await c.troca.definir(a.idSessao, REDE, { pin: PIN, senha: 'errada' }, E1).catch((x) => x)).tipo,
    ).toBe('credencial-invalida');
    const trivial = recusa(
      await c.troca.definir(a.idSessao, REDE, { pin: '123456', senha: SENHA }, E1).catch((x) => x),
    );
    expect([trivial.tipo, trivial.codigo]).toEqual(['pin-recusado', 'pin-trivial']);
    expect(
      recusa(await c.troca.definir(a.idSessao, REDE, { pin: '3847', senha: SENHA }, E1).catch((x) => x))
        .codigo,
    ).toBe('pin-formato');
    const s = await c.troca.definir(a.idSessao, REDE, { pin: PIN, senha: SENHA }, E1);
    expect(s).toMatchObject({ ligada: true, digitosPin: 6, definido: true, bloqueado: false });
    expect(JSON.stringify(s)).not.toContain('argon2');
    await c.troca.definir(a.idSessao, REDE, { pin: '905372', senha: SENHA }, E1);
    expect(c.porta.linhas().map((x) => x.situacao)).toEqual(['substituido', 'vivo']);
    expect(c.porta.linhas()[0]?.hashPhc).toBeNull();
    expect(c.linhasPin.join('\n')).toContain('nenhum -> definido');
    expect(c.linhasPin.join('\n')).toContain('definido -> definido');
  });

  it('desligada: definir é recusado; retirar o próprio PIN com a senha', async () => {
    const c = cenario();
    const a = await c.servico.entrar(entrada('SINT.USUARIO'), REDE, null, E1);
    await c.troca.definir(a.idSessao, REDE, { pin: PIN, senha: SENHA }, E1);
    expect((await c.troca.retirar(a.idSessao, REDE, { senha: SENHA }, E1)).definido).toBe(false);
    expect(recusa(await c.troca.retirar(a.idSessao, REDE, { senha: SENHA }, E1).catch((x) => x)).codigo).toBe(
      'sem-pin',
    );
    const d = cenario({ ligada: false });
    const b = await d.servico.entrar(entrada('SINT.USUARIO'), REDE, null, E1);
    expect(
      recusa(await d.troca.definir(b.idSessao, REDE, { pin: PIN, senha: SENHA }, E1).catch((x) => x)).tipo,
    ).toBe('troca-rapida-desligada');
  });
});

describe('W1-01 (parte 11b2): troca rápida', () => {
  async function preparado(c: ReturnType<typeof cenario>) {
    // A entra com a senha na estação 1 e define o PIN; depois B entra com a senha na mesma estação.
    const a = await c.servico.entrar(entrada('SINT.USUARIO'), REDE, null, E1);
    await c.troca.definir(a.idSessao, REDE, { pin: PIN, senha: SENHA }, E1);
    const b = await c.servico.entrar(entrada('SINT.MEDICO'), REDE, null, E1);
    return { a, b };
  }

  it('troca para A com o PIN: sessão nova marcada; a de B fica BLOQUEADA (não encerrada); trilha', async () => {
    const c = cenario();
    const { b } = await preparado(c);
    const r = await c.troca.trocar({ login: 'SINT.USUARIO', pin: PIN }, REDE, b.idSessao, E1);
    expect(r.sessao.usuario.login).toBe('SINT.USUARIO');
    expect((await c.servico.ler(r.idSessao, REDE))?.registro.trocaRapida).toBe(true);
    const anterior = await c.servico.ler(b.idSessao, REDE);
    expect(anterior?.registro.bloqueada).toBe(true);
    expect(c.trilha.eventos.map((e) => e.evento)).toEqual(
      expect.arrayContaining(['sessao.troca-rapida', 'sessao.bloqueada']),
    );
    // O PIN não vale como login forte: não abre outra troca noutra estação.
    expect(await c.servico.loginsFortes(REDE, 'aa', 'SINT.USUARIO')).toEqual([
      { dia: '2026-11-19', estacao: 'POSTO:p1' },
    ]);
  });

  it('recusa genérica: outra estação, outro dia, conta inexistente e PIN errado dão a MESMA mensagem', async () => {
    const c = cenario();
    const { b } = await preparado(c);
    const tentar = (login: string, pin: string, origem: OrigemPedido, id: string | null) =>
      c.troca.trocar({ login, pin, estabelecimento: 'aa' }, REDE, id, origem).then(
        () => null,
        (x: unknown) => recusa(x),
      );
    const noOutroPosto = await c.servico.entrar(entrada('SINT.MEDICO'), REDE, null, E2);
    const erros = [
      await tentar('SINT.USUARIO', PIN, E2, noOutroPosto.idSessao),
      await tentar('NAO.EXISTE', PIN, E1, b.idSessao),
      await tentar('SINT.USUARIO', '905372', E1, b.idSessao),
      await tentar('SINT.MEDICO', PIN, E1, b.idSessao),
    ];
    for (const e of erros) {
      expect(e?.tipo).toBe('troca-rapida-recusada');
      expect(e?.detalhe).toBe(MENSAGEM_TROCA_RECUSADA);
    }
    const codigos = c.trilha.eventos
      .filter((e) => e.evento === 'sessao.login.falho' && e.chaveNaturalAlvo)
      .map((e) => e.chaveNaturalAlvo);
    expect(codigos).toEqual([
      'troca-rapida:outra-estacao',
      'troca-rapida:conta-indisponivel',
      'troca-rapida:pin-errado',
      'troca-rapida:mesmo-usuario',
    ]);
    // A sessão de B não foi bloqueada por nenhuma tentativa recusada.
    expect((await c.servico.ler(b.idSessao, REDE))?.registro.bloqueada).toBe(false);
    // No dia seguinte (sem novo login forte), recusada.
    c.avancar(24 * 3600_000);
    const d = c.servico.entrar(entrada('SINT.MEDICO'), REDE, null, E1);
    const amanha = await c.troca
      .trocar({ login: 'SINT.USUARIO', pin: PIN }, REDE, (await d).idSessao, E1)
      .catch((x: unknown) => recusa(x));
    expect((amanha as ErroSessao).tipo).toBe('troca-rapida-recusada');
    expect(c.trilha.eventos.at(-1)?.chaveNaturalAlvo).toBe('troca-rapida:sem-login-forte-hoje');
  });

  it('revisão (estação): dois postos atrás do MESMO IP (NAT): sem o cookie do posto, sem a sessão anterior ou com a sessão de outro posto, recusada', async () => {
    const c = cenario();
    const { b } = await preparado(c);
    const mesmoIp = { estacao: E1.estacao, correlacao: 'c3' };
    const tentar = (origem: OrigemPedido, id: string | null) =>
      c.troca.trocar({ login: 'SINT.USUARIO', pin: PIN, estabelecimento: 'aa' }, REDE, id, origem).then(
        () => null,
        (x: unknown) => recusa(x),
      );
    // Outra máquina com o mesmo IP: sem cookie do posto; com posto próprio mas sem sessão; ou reaproveitando a sessão
    // de B (cookie roubado) a partir de outro posto.
    const erros = [
      await tentar(mesmoIp, null),
      await tentar(mesmoIp, b.idSessao),
      await tentar({ ...mesmoIp, posto: 'p3' }, null),
      await tentar({ ...mesmoIp, posto: 'p3' }, b.idSessao),
    ];
    for (const e of erros) {
      expect(e?.tipo).toBe('troca-rapida-recusada');
      expect(e?.detalhe).toBe(MENSAGEM_TROCA_RECUSADA);
    }
    expect(
      c.trilha.eventos
        .filter((e) => e.evento === 'sessao.login.falho' && e.chaveNaturalAlvo)
        .map((e) => e.chaveNaturalAlvo),
    ).toEqual([
      'troca-rapida:sem-posto',
      'troca-rapida:sem-posto',
      'troca-rapida:sem-sessao-no-posto',
      'troca-rapida:posto-divergente',
    ]);
    // Login forte sem o cookie do posto não habilita troca nenhuma.
    const semPosto = await c.servico.entrar(entrada('SINT.USUARIO'), REDE, null, mesmoIp);
    expect(semPosto.idSessao).toBeTruthy();
    expect(await c.servico.loginsFortes(REDE, 'aa', 'SINT.USUARIO')).toEqual([
      { dia: '2026-11-19', estacao: 'POSTO:p1' },
    ]);
    expect((await c.servico.ler(b.idSessao, REDE))?.registro.bloqueada).toBe(false);
    // No posto certo, com a sessão dele, passa.
    const ok = await c.troca.trocar({ login: 'SINT.USUARIO', pin: PIN }, REDE, b.idSessao, E1);
    expect(ok.sessao.usuario.login).toBe('SINT.USUARIO');
  });

  it('erros seguidos bloqueiam o PIN no teto; nem o certo passa; PIN novo depois da senha libera', async () => {
    const c = cenario({ tentativasPin: 2 });
    const { b } = await preparado(c);
    for (let i = 0; i < 2; i++)
      await c.troca.trocar({ login: 'SINT.USUARIO', pin: '905372' }, REDE, b.idSessao, E1).catch(() => null);
    expect(c.porta.linhas().at(-1)?.bloqueadoEm).toBeInstanceOf(Date);
    expect(c.linhasPin.at(-1)).toContain('definido -> bloqueado; motivo: 2 erros seguidos');
    const e = await c.troca
      .trocar({ login: 'SINT.USUARIO', pin: PIN }, REDE, b.idSessao, E1)
      .catch((x: unknown) => recusa(x));
    expect((e as ErroSessao).tipo).toBe('troca-rapida-recusada');
    expect(c.trilha.eventos.at(-1)?.chaveNaturalAlvo).toBe('troca-rapida:pin-bloqueado');
    const a2 = await c.servico.entrar(entrada('SINT.USUARIO'), REDE, null, E1);
    await c.troca.definir(a2.idSessao, REDE, { pin: '519384', senha: SENHA }, E1);
    const b2 = await c.servico.entrar(entrada('SINT.MEDICO'), REDE, null, E1);
    const ok = await c.troca.trocar({ login: 'SINT.USUARIO', pin: '519384' }, REDE, b2.idSessao, E1);
    expect(ok.sessao.usuario.login).toBe('SINT.USUARIO');
  });

  it('revisão (achado 4): 20 tentativas em PARALELO não contornam o teto; a trilha registra o bloqueio uma vez; o certo não passa', async () => {
    const c = cenario({ tentativasPin: 5 });
    const { b } = await preparado(c);
    const erradas = Array.from({ length: 20 }, (_, i) => String(100000 + i * 7));
    await Promise.all(
      erradas.map((pin) =>
        c.troca.trocar({ login: 'SINT.USUARIO', pin }, REDE, b.idSessao, E1).catch(() => null),
      ),
    );
    const viva = c.porta.linhas().at(-1);
    expect(viva?.bloqueadoEm).toBeInstanceOf(Date);
    expect(viva?.falhas).toBe(5);
    expect(c.linhasPin.filter((x) => x.includes('definido -> bloqueado'))).toHaveLength(1);
    const e = await c.troca
      .trocar({ login: 'SINT.USUARIO', pin: PIN }, REDE, b.idSessao, E1)
      .catch((x: unknown) => recusa(x));
    expect((e as ErroSessao).tipo).toBe('troca-rapida-recusada');
  });

  it('revisão (achado 4): o certo conferido enquanto uma tentativa paralela bloqueia o PIN não entra', async () => {
    const c = cenario({ tentativasPin: 1 });
    const { b } = await preparado(c);
    const [errada, certa] = await Promise.all([
      c.troca.trocar({ login: 'SINT.USUARIO', pin: '905372' }, REDE, b.idSessao, E1).catch((x: unknown) => x),
      c.troca.trocar({ login: 'SINT.USUARIO', pin: PIN }, REDE, b.idSessao, E1).catch((x: unknown) => x),
    ]);
    expect(errada).toBeInstanceOf(ErroSessao);
    // Os dois leram o PIN livre; a falha gravou o bloqueio antes: o certo é recusado pela gravação atômica.
    expect(certa).toBeInstanceOf(ErroSessao);
    expect(c.porta.linhas().at(-1)?.bloqueadoEm).toBeInstanceOf(Date);
  });

  it('um erro e depois o certo zera as falhas; o gestor retira o PIN (motivo) e a troca passa a ser recusada', async () => {
    const c = cenario();
    const { b } = await preparado(c);
    await c.troca.trocar({ login: 'SINT.USUARIO', pin: '905372' }, REDE, b.idSessao, E1).catch(() => null);
    expect(c.porta.linhas().at(-1)?.falhas).toBe(1);
    const r = await c.troca.trocar({ login: 'SINT.USUARIO', pin: PIN }, REDE, b.idSessao, E1);
    expect(c.porta.linhas().at(-1)?.falhas).toBe(0);
    const g = { rede: REDE, estabelecimento: 'aa', login: 'SINT.GESTOR' };
    expect(
      recusa(await c.troca.retirarDoUsuario(g, 'SINT.USUARIO', 'curto', E1).catch((x) => x)).codigo,
    ).toBe('motivo');
    expect(await c.troca.retirarDoUsuario(g, 'SINT.USUARIO', 'estação compartilhada trocada', E1)).toEqual({
      anterior: 'definido',
    });
    expect(c.linhasPin.at(-1)).toContain('definido -> retirado; motivo: estação compartilhada trocada');
    const e = await c.troca
      .trocar({ login: 'SINT.USUARIO', pin: PIN }, REDE, r.idSessao, E1)
      .catch((x: unknown) => recusa(x));
    expect((e as ErroSessao).tipo).toBe('troca-rapida-recusada');
  });

  it('desligada: a troca responde "desligada" (sem conferir nada)', async () => {
    const c = cenario();
    const { b } = await preparado(c);
    (c.parametros as { ligada: boolean }).ligada = false;
    const e = await c.troca
      .trocar({ login: 'SINT.USUARIO', pin: PIN }, REDE, b.idSessao, E1)
      .catch((x: unknown) => recusa(x));
    expect((e as ErroSessao).tipo).toBe('troca-rapida-desligada');
  });

  it('Argon2id real: só o hash vai à porta; o PIN nunca aparece na porta nem na trilha', async () => {
    const c = cenario({}, true);
    const { b } = await preparado(c);
    await c.troca.trocar({ login: 'SINT.USUARIO', pin: '905372' }, REDE, b.idSessao, E1).catch(() => null);
    const r = await c.troca.trocar({ login: 'SINT.USUARIO', pin: PIN }, REDE, b.idSessao, E1);
    expect(r.sessao.usuario.login).toBe('SINT.USUARIO');
    expect(c.porta.linhas().at(-1)?.hashPhc).toMatch(/^\$argon2id\$v=19\$/);
    const tudo = JSON.stringify(c.trilha.eventos) + c.linhasPin.join('\n');
    expect(tudo).not.toContain(PIN);
    expect(tudo).not.toContain('905372');
    expect(tudo).not.toContain('argon2');
  });
});
