// M10 pela HTTP, com a sessão real sobre a fonte sintética e a fonte das telas EM MEMÓRIA (nada conecta a banco):
// usuários (lista, ficha sem segredo, criar com reautenticação, login repetido, bloquear derruba a sessão e
// impede o login, ninguém a si mesmo), escopos, árvore de permissões e conceder/retirar opção a grupo sintético,
// simulador, termo pendente e aceite, trilha com período obrigatório de até 31 dias e exportação, acessos ao
// prontuário, leitos (incluir, ocupado não inativa, conferência), pedidos do titular, consultas da organização e
// os 403 sem a permissão.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { avisoCorte, celulaCsv, exportarTrilha } from './auditoria.controller.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});

interface Sessao {
  cookie: string;
  csrf: string;
}
async function entrar(login: string, esperado = 201): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(esperado);
  const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
  return {
    cookie: set.map((c) => c.split(';')[0]).join('; '),
    csrf:
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '',
  };
}
const h = (s: Sessao) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': `teste-m10-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: h(s), payload: payload as Record<string, unknown> });
const A = '/api/administracao/acesso';
const dia = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

describe('usuários', () => {
  it('lista paginada com busca; a ficha não leva senha, hash nem CPF', async () => {
    const s = await entrar('SINT.GESTOR');
    const l = await get(s, `${A}/usuarios?busca=SINT.ME&porPagina=10`);
    expect(l.statusCode).toBe(200);
    expect(l.json().itens.map((u: { login: string }) => u.login)).toContain('SINT.MEDICO');
    expect(l.json().destino).toBe('memoria');
    const f = await get(s, `${A}/usuarios/SINT.MEDICO`);
    expect(f.statusCode).toBe(200);
    const corpo = f.body;
    expect(corpo).not.toMatch(/"senha"\s*:\s*"/i);
    expect(corpo).not.toMatch(/hash/i);
    expect(f.json().usuario).toMatchObject({ login: 'SINT.MEDICO', grupo: 'MEDICOS', cpf: null });
    // X-01: o profissional ligado ao login (papel Operador de sistema); sem vínculo, null.
    expect(f.json().profissionalVinculado).toEqual({ id: 3, nome: 'ANA MÉDICA SINTETICO' });
    expect((await get(s, `${A}/usuarios/SINT.SAME`)).json().profissionalVinculado).toBeNull();
    expect(
      f.json().operacoes.find((o: { operacao: string }) => o.operacao === 'acesso.alterarFlagsUsuario'),
    ).toMatchObject({ ligada: true });
    expect((await get(s, `${A}/usuarios/NINGUEM.AQUI`)).statusCode).toBe(404);
    expect(trilha.eventos.some((e) => e.evento === 'acesso.usuario.consultado')).toBe(true);
  });

  it('X-01: o vínculo da ficha do usuário é o da aba Login do sistema do profissional (ida e volta)', async () => {
    const s = await entrar('SINT.GESTOR');
    const P = '/api/cadastros/profissionais';
    // A ficha do profissional 3 e a do usuário SINT.MEDICO dizem a mesma coisa.
    const v = await entrar('SINT.VINCULOS');
    const logins = (await get(v, `${P}/logins`)).json() as { login: string; profissional: number | null }[];
    expect(logins.find((l) => l.login === 'SINT.MEDICO')?.profissional).toBe(3);
    expect((await get(s, `${A}/usuarios/SINT.SAME`)).json().profissionalVinculado).toBeNull();
    // Vincular SINT.SAME pela aba Login do sistema (troca do login da CARLA, 5, no registro 13).
    const liga = await app.inject({
      method: 'PUT',
      url: `${P}/5/login`,
      headers: h(v),
      payload: {
        registro: 13,
        login: 'sint.same',
        versao: 'SINT.PROF5',
        justificativa: 'Vínculo do atalho no teste sintético',
        senha: SENHA,
      },
    });
    expect(liga.statusCode).toBe(200);
    expect((await get(s, `${A}/usuarios/SINT.SAME`)).json().profissionalVinculado).toEqual({
      id: 5,
      nome: 'CARLA ENFERMEIRA SINTETICO',
    });
  });

  it('criar exige a senha de novo; login repetido é recusado; o novo aparece na lista', async () => {
    const s = await entrar('SINT.GESTOR');
    const entrada = { login: 'SINT.NOVO1', nomeCompleto: 'Usuario Novo Sintetico', grupo: 'SAME' };
    const sem = await post(s, `${A}/usuarios`, { entrada });
    expect(sem.statusCode).toBeGreaterThanOrEqual(400);
    const errada = await post(s, `${A}/usuarios`, { entrada, senha: 'errada-errada' });
    expect(errada.statusCode).toBeGreaterThanOrEqual(400);
    const ok = await post(s, `${A}/usuarios`, { entrada, senha: SENHA });
    expect(ok.statusCode).toBe(201);
    const dup = await post(s, `${A}/usuarios`, { entrada, senha: SENHA });
    expect(dup.statusCode).toBe(409);
    const l = (await get(s, `${A}/usuarios?busca=SINT.NOVO1`)).json();
    expect(l.itens.map((u: { login: string }) => u.login)).toEqual(['SINT.NOVO1']);
  });

  it('alterar o nome com a versão lida; versão velha dá colisão', async () => {
    const s = await entrar('SINT.GESTOR');
    const f = (await get(s, `${A}/usuarios/SINT.SAME`)).json();
    const r = await post(s, `${A}/usuarios/SINT.SAME/nome`, {
      entrada: { nomeCompleto: 'Same Sintetico Renomeado', versao: f.usuario.versao },
      senha: SENHA,
    });
    expect(r.statusCode).toBe(200);
    const velho = await post(s, `${A}/usuarios/SINT.SAME/nome`, {
      entrada: { nomeCompleto: 'Outro Nome', versao: f.usuario.versao },
      senha: SENHA,
    });
    expect(velho.statusCode).toBe(409);
  });

  it('W1-01: permissões complementares com a letra de cada coluna, colisão pela letra lida e ninguém a si mesmo', async () => {
    const s = await entrar('SINT.GESTOR');
    const f = (await get(s, `${A}/usuarios/SINT.FATURISTA`)).json();
    const alta = f.flags.find((x: { coluna: string }) => x.coluna === 'ALTAPAC');
    expect(alta).toMatchObject({ letra: 'T', ligado: true, podeLigar: true, podeDesligar: true });
    const pedido = { flags: [{ coluna: 'ALTAPAC', ligado: false, antes: 'T' }] };
    expect(
      (await post(s, `${A}/usuarios/SINT.FATURISTA/flags`, { entrada: pedido })).statusCode,
    ).toBeGreaterThanOrEqual(400);
    const ok = await post(s, `${A}/usuarios/SINT.FATURISTA/flags`, { entrada: pedido, senha: SENHA });
    expect(ok.statusCode).toBe(200);
    const depois = (await get(s, `${A}/usuarios/SINT.FATURISTA`)).json();
    expect(depois.flags.find((x: { coluna: string }) => x.coluna === 'ALTAPAC')).toMatchObject({
      letra: 'F',
    });
    const velho = await post(s, `${A}/usuarios/SINT.FATURISTA/flags`, { entrada: pedido, senha: SENHA });
    expect(velho.statusCode).toBe(409);
    expect(JSON.stringify(velho.json())).toContain('conflito-versao');
    const nunca = await post(s, `${A}/usuarios/SINT.FATURISTA/flags`, {
      entrada: { flags: [{ coluna: 'ABRIR_GUIA_FECHADA', ligado: true, antes: '' }] },
      senha: SENHA,
    });
    expect(nunca.statusCode).toBe(409);
    expect(JSON.stringify(nunca.json())).toContain('flag-sem-letra');
    const proprio = await post(s, `${A}/usuarios/SINT.GESTOR/flags`, { entrada: pedido, senha: SENHA });
    expect(proprio.statusCode).toBe(409);
    expect(JSON.stringify(proprio.json())).toContain('a-si-mesmo');
  });

  it('W1-01: troca de CPF sem justificativa recusada; CPF repetido entre logins recusado; com motivo grava', async () => {
    const s = await entrar('SINT.GESTOR');
    const f = (await get(s, `${A}/usuarios/SINT.SAME`)).json();
    const base = { nomeCompleto: f.usuario.nome ?? 'Same Sintetico', versao: f.usuario.versao };
    const sem = await post(s, `${A}/usuarios/SINT.SAME/nome`, {
      entrada: { ...base, cpf: '52998224725' },
      senha: SENHA,
    });
    expect(sem.statusCode).toBe(409);
    expect(sem.json().codigo ?? sem.json().type).toMatch(/justificativa-obrigatoria/);
    const ok = await post(s, `${A}/usuarios/SINT.SAME/nome`, {
      entrada: { ...base, cpf: '52998224725', justificativa: 'CPF digitado errado na criação' },
      senha: SENHA,
    });
    expect(ok.statusCode).toBe(200);
    const g = (await get(s, `${A}/usuarios/SINT.FATURISTA`)).json();
    const dup = await post(s, `${A}/usuarios/SINT.FATURISTA/nome`, {
      entrada: {
        nomeCompleto: g.usuario.nome ?? 'Faturista Sintetico',
        versao: g.usuario.versao,
        cpf: '52998224725',
        justificativa: 'tentativa de CPF repetido',
      },
      senha: SENHA,
    });
    expect(dup.statusCode).toBe(409);
    expect(JSON.stringify(dup.json())).toContain('cpf-em-uso');
    const invalido = await post(s, `${A}/usuarios/SINT.FATURISTA/nome`, {
      entrada: {
        nomeCompleto: 'X Y',
        versao: g.usuario.versao,
        cpf: '11111111111',
        justificativa: 'sequência repetida',
      },
      senha: SENHA,
    });
    expect(invalido.statusCode).toBeGreaterThanOrEqual(400);
    expect(invalido.statusCode).toBeLessThan(500);
  });

  it('bloquear derruba a sessão do usuário e impede o login; desbloquear devolve; ninguém a si mesmo', async () => {
    const g = await entrar('SINT.GESTOR');
    const alvo = await entrar('SINT.FATURISTA');
    expect((await get(alvo, '/api/sessao')).statusCode).toBe(200);
    // A ficha mostra as sessões abertas (sem token nem endereço); o bloqueio as derruba.
    const antes = (await get(g, `${A}/usuarios/SINT.FATURISTA`)).json().sessoes;
    expect(antes.length).toBeGreaterThan(0);
    expect(Object.keys(antes[0]).sort()).toEqual([
      'bloqueada',
      'como',
      'estabelecimento',
      'inicio',
      'ultimoUso',
    ]);
    // Sem a senha: 401 em Problem Details (regra 8).
    const semSenha = await post(g, `${A}/usuarios/SINT.FATURISTA/bloqueio`, { bloquear: true });
    expect(semSenha.statusCode).toBe(401);
    expect(semSenha.headers['content-type']).toMatch(/problem\+json/);
    const b = await post(g, `${A}/usuarios/SINT.FATURISTA/bloqueio`, { bloquear: true, senha: SENHA });
    expect(b.statusCode).toBe(200);
    expect((await get(alvo, '/api/sessao')).statusCode).toBe(401);
    expect((await get(g, `${A}/usuarios/SINT.FATURISTA`)).json().sessoes).toEqual([]);
    await entrar('SINT.FATURISTA', 401);
    const d = await post(g, `${A}/usuarios/SINT.FATURISTA/bloqueio`, { bloquear: false, senha: SENHA });
    expect(d.statusCode).toBe(200);
    await entrar('SINT.FATURISTA');
    const proprio = await post(g, `${A}/usuarios/SINT.GESTOR/bloqueio`, { bloquear: true, senha: SENHA });
    expect(proprio.statusCode).toBe(409);
  });

  it('escopo: conceder e retirar unidade; conceder de novo é recusado', async () => {
    const g = await entrar('SINT.GESTOR');
    const url = `${A}/usuarios/SINT.MEDICO/escopos`;
    const opc = (await get(g, `${A}/usuarios-opcoes`)).json();
    const valor = opc.escopos.local?.[0]?.valor ?? '1';
    const c = await post(g, url, { tipo: 'local', acao: 'conceder', valor: Number(valor), senha: SENHA });
    expect(c.statusCode).toBe(200);
    expect(
      (await post(g, url, { tipo: 'local', acao: 'conceder', valor: Number(valor), senha: SENHA }))
        .statusCode,
    ).toBe(409);
    const r = await post(g, url, { tipo: 'local', acao: 'retirar', valor: Number(valor), senha: SENHA });
    expect(r.statusCode).toBe(200);
  });

  it('sem a permissão, 403', async () => {
    const s = await entrar('SINT.USUARIO');
    expect((await get(s, `${A}/usuarios`)).statusCode).toBe(403);
    expect((await get(s, '/api/administracao/auditoria/trilha')).statusCode).toBe(403);
    expect((await get(s, '/api/cadastros/estrutura/leitos')).statusCode).toBe(403);
  });
});

describe('permissões, simulador e termo', () => {
  it('árvore por módulo; conceder e retirar uma opção do grupo sintético com a senha', async () => {
    const g = await entrar('SINT.GESTOR');
    const painel = await get(g, `${A}/permissoes`);
    expect(painel.statusCode).toBe(200);
    const mods = (await get(g, `${A}/permissoes/arvore?grupo=SAME`)).json();
    expect(mods.modulos.length).toBeGreaterThan(0);
    let arvore = { nos: [] as { id: number; ativo: boolean }[], alvo: { opcoes: [] as number[] } };
    for (const m of mods.modulos as { id: number }[]) {
      arvore = (await get(g, `${A}/permissoes/arvore?grupo=SAME&modulo=${m.id}`)).json();
      if (arvore.nos.some((n) => n.id > 0 && n.ativo)) break;
    }
    const antes: number[] = arvore.alvo?.opcoes ?? [];
    const candidata = arvore.nos.find((n) => n.id > 0 && n.ativo && !antes.includes(n.id));
    expect(candidata).toBeDefined();
    const id = candidata?.id ?? 0;
    expect(
      (await post(g, `${A}/permissoes/conceder`, { grupo: 'SAME', opcoes: [id], senha: SENHA })).statusCode,
    ).toBe(200);
    const depois = (await get(g, `${A}/permissoes/arvore?grupo=SAME`)).json();
    expect(depois.alvo.opcoes).toContain(id);
    expect(trilha.eventos.some((e) => e.evento.startsWith('acesso.'))).toBe(true);
    expect(
      (await post(g, `${A}/permissoes/revogar`, { grupo: 'SAME', opcoes: [id], senha: SENHA })).statusCode,
    ).toBe(200);
    expect((await get(g, `${A}/permissoes/arvore?grupo=SAME`)).json().alvo.opcoes).not.toContain(id);
  });

  it('simulador responde pode/não pode com o porquê', async () => {
    const g = await entrar('SINT.GESTOR');
    const r = await get(g, `${A}/simulador?login=SINT.MEDICO&recurso=acesso.usuario.ler`);
    expect(r.statusCode).toBe(200);
    expect(JSON.stringify(r.json())).not.toMatch(/senha"\s*:\s*"/i);
  });

  it('termo pendente: a sessão marca; aceitar limpa e fica registrado', async () => {
    const s = await entrar('SINT.TERMO');
    expect((await get(s, '/api/sessao')).json().termoPendente).toBe(true);
    const t = (await get(s, `${A}/termo/sessao`)).json();
    expect(t.pendente).toBe(true);
    expect(t.termo.id).toBeGreaterThan(0);
    const a = await post(s, `${A}/termo/aceitar`, { termo: t.termo.id });
    expect(a.statusCode).toBeLessThan(300);
    expect((await get(s, '/api/sessao')).json().termoPendente ?? false).toBe(false);
    const g = await entrar('SINT.GESTOR');
    expect((await get(g, `${A}/termo`)).statusCode).toBe(200);
  });
});

describe('auditoria e privacidade', () => {
  it('trilha: período obrigatório até 31 dias; consulta e exportação registradas', async () => {
    const s = await entrar('SINT.AUDITOR');
    const T = '/api/administracao/auditoria/trilha';
    expect((await get(s, `${T}?inicio=${dia(40)}&fim=${dia(0)}`)).statusCode).toBe(400);
    expect((await get(s, `${T}?inicio=${dia(0)}&fim=${dia(3)}`)).statusCode).toBe(400);
    const r = await get(s, `${T}?inicio=${dia(2)}&fim=${dia(0)}`);
    expect(r.statusCode).toBe(200);
    expect(r.json().periodo.dias).toBeLessThanOrEqual(31);
    const csv = await get(s, `${T}/exportar?inicio=${dia(2)}&fim=${dia(0)}&formato=csv`);
    expect(csv.statusCode).toBe(200);
    expect(String(csv.headers['content-type'])).toMatch(/csv/);
    const html = await get(s, `${T}/exportar?inicio=${dia(2)}&fim=${dia(0)}&formato=html`);
    expect(html.statusCode).toBe(200);
    expect(html.body).not.toMatch(/<script/i);
    expect(trilha.eventos.some((e) => e.evento === 'auditoria.trilha.exportada')).toBe(true);
    expect(csv.headers['x-trilha-cortada']).toBe('nao');
    // Além da página 20 (10.000 eventos), a consulta pede para refinar o filtro; a 20 ainda responde.
    const p21 = await get(s, `${T}?inicio=${dia(2)}&fim=${dia(0)}&pagina=21`);
    expect(p21.statusCode).toBe(400);
    expect(p21.json()).toMatchObject({ codigo: 'pagina-alem-do-limite' });
    expect(p21.json().detail).toMatch(/Refine o filtro/);
    const p20 = await get(s, `${T}?inicio=${dia(2)}&fim=${dia(0)}&pagina=20`);
    expect(p20.statusCode).toBe(200);
    expect(p20.json()).toMatchObject({ pagina: 20, temMais: false, cortado: false });
  });

  it('exportação: CSV sem fórmula (apóstrofo na frente) e o corte escrito no arquivo', () => {
    expect(celulaCsv('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    for (const v of ['+1', '-1', '@SOMA', '\tx', '\rx']) expect(celulaCsv(v).startsWith(`"'`)).toBe(true);
    expect(celulaCsv('SINT.AUDITOR')).toBe('"SINT.AUDITOR"');
    const linha = {
      origem: 'legado' as const,
      id: 'L1',
      dataHora: '2026-10-20T10:00:00',
      usuario: '=cmd|calc',
      acao: 'Evento',
      opcao: null,
      criticidade: null,
      estacao: '@estacao',
      alvo: null,
      paciente: null,
      resultado: null,
      atorReal: null,
    };
    const csv = exportarTrilha([linha], 'csv', { cortado: true, teto: 10_000 });
    expect(csv).toContain(`"'=cmd|calc"`);
    expect(csv).toContain(`"'@estacao"`);
    expect(csv).toContain(avisoCorte(10_000));
    expect(exportarTrilha([linha], 'xml', { cortado: true, teto: 10_000 })).toMatch(
      /<trilha cortada="true" teto="10000">\n {2}<aviso>/,
    );
    expect(exportarTrilha([linha], 'html', { cortado: true, teto: 10_000 })).toContain('<p role="note">');
    expect(exportarTrilha([linha], 'csv')).not.toContain('Exportação cortada');
  });

  it('acessos ao prontuário e exclusões pelo período', async () => {
    const s = await entrar('SINT.AUDITOR');
    expect(
      (await get(s, `/api/administracao/auditoria/leituras-prontuario?inicio=${dia(5)}&fim=${dia(0)}`))
        .statusCode,
    ).toBe(200);
    const x = await get(s, `/api/administracao/auditoria/exclusoes?inicio=${dia(5)}&fim=${dia(0)}`);
    expect(x.statusCode).toBe(200);
    expect(Array.isArray(x.json().tipos)).toBe(true);
    // Linha a linha: período obrigatório, usuário e 500 por página; tipo desconhecido 404.
    const E = '/api/administracao/auditoria/exclusoes';
    const lin = await get(s, `${E}/atendimentos?inicio=${dia(5)}&fim=${dia(0)}`);
    expect(lin.statusCode).toBe(200);
    expect(lin.json()).toMatchObject({ chave: 'atendimentos', comUsuario: true, pagina: 1, temMais: false });
    expect(Object.keys(lin.json().itens[0]).sort()).toEqual([
      'dataHora',
      'justificativa',
      'registro',
      'usuario',
    ]);
    expect(
      (await get(s, `${E}/atendimentos?inicio=${dia(5)}&fim=${dia(0)}&usuario=OUTRO`)).json().itens,
    ).toEqual([]);
    expect((await get(s, `${E}/atendimentos`)).statusCode).toBe(400);
    expect((await get(s, `${E}/naoExiste?inicio=${dia(5)}&fim=${dia(0)}`)).statusCode).toBe(404);
    const con = await get(s, `/api/administracao/auditoria/conexoes?inicio=${dia(5)}&fim=${dia(0)}`);
    expect(con.statusCode).toBe(200);
    expect(con.json().itens[0]).toMatchObject({ usuario: 'SINT.MEDICO', modulo: 23 });
    expect(trilha.eventos.filter((e) => e.evento === 'auditoria.exclusao.consultada').length).toBeGreaterThan(
      2,
    );
    // Acessos ao prontuário pelo prontuário (não pelo ID interno): inexistente 404.
    const A2 = '/api/administracao/auditoria/leituras-prontuario';
    expect((await get(s, `${A2}?inicio=${dia(5)}&fim=${dia(0)}&prontuario=900001`)).statusCode).toBe(200);
    expect((await get(s, `${A2}?inicio=${dia(5)}&fim=${dia(0)}&prontuario=123`)).statusCode).toBe(404);
  });

  it('pedido do titular: registrar, confirmar a identidade e atender; eliminação só se nega', async () => {
    // O Auditor só consulta (segregação): quem trata é o administrador ou a área de privacidade.
    const aud = await entrar('SINT.AUDITOR');
    expect((await get(aud, '/api/administracao/privacidade/pedidos')).statusCode).toBe(200);
    expect(
      (
        await post(aud, '/api/administracao/privacidade/pedidos', {
          idPaciente: 999_000_001,
          tipo: 'acesso',
          canal: 'email',
        })
      ).statusCode,
    ).toBe(403);
    const s = await entrar('SINT.ADMIN');
    const P = '/api/administracao/privacidade/pedidos';
    // O titular pelo prontuário; os dois juntos ou nenhum, 400; prontuário inexistente, 409 com a mensagem.
    expect(
      (await post(s, P, { prontuario: 900_001, idPaciente: 999_000_001, tipo: 'acesso', canal: 'email' }))
        .statusCode,
    ).toBe(400);
    expect((await post(s, P, { tipo: 'acesso', canal: 'email' })).statusCode).toBe(400);
    expect((await post(s, P, { prontuario: 123, tipo: 'acesso', canal: 'email' })).statusCode).toBe(409);
    const r = await post(s, P, { prontuario: 900_001, tipo: 'acesso', canal: 'presencial' });
    expect(r.statusCode, r.body).toBeLessThan(300);
    expect(r.json().protocolo).toMatch(/\w/);
    const lista = (await get(s, P)).json();
    const p = lista.itens.find((x: { protocolo: string }) => x.protocolo === r.json().protocolo);
    expect(p.situacao).toBe('aberto');
    expect((await post(s, `${P}/${p.id}`, { acao: 'atender' })).statusCode).toBe(409);
    expect((await post(s, `${P}/${p.id}`, { acao: 'confirmar-identidade' })).statusCode).toBeLessThan(300);
    expect((await post(s, `${P}/${p.id}`, { acao: 'atender' })).statusCode).toBeLessThan(300);
    const e = await post(s, P, { idPaciente: 999_000_001, tipo: 'eliminacao', canal: 'email' });
    const pe = (await get(s, P))
      .json()
      .itens.find((x: { protocolo: string }) => x.protocolo === e.json().protocolo);
    await post(s, `${P}/${pe.id}`, { acao: 'confirmar-identidade' });
    expect((await post(s, `${P}/${pe.id}`, { acao: 'atender' })).statusCode).toBe(409);
    expect(
      (await post(s, `${P}/${pe.id}`, { acao: 'negar', fundamento: 'guarda-legal-prontuario' })).statusCode,
    ).toBeLessThan(300);
  });
});

describe('estrutura e leitos', () => {
  it('estrutura e leitos com contagens; incluir leito; ocupado não inativa; conferência aponta a divergência', async () => {
    const s = await entrar('SINT.ADMIN');
    const est = await get(s, '/api/cadastros/estrutura');
    expect(est.statusCode, est.body).toBe(200);
    const l = (await get(s, '/api/cadastros/estrutura/leitos')).json();
    expect(l.totais.leitos).toBeGreaterThan(0);
    const novo = {
      bloco: 'INT-1',
      acomodacao: '102',
      leito: 'C',
      andar: 1,
      anoVigente: 2026,
      mesVigente: 10,
      ramal: 210,
    };
    // Reautenticação (ficha seção 5; regra 8): sem a senha, 401 em Problem Details; senha errada, 401.
    const semSenha = await post(s, '/api/cadastros/estrutura/leitos/incluirLeito', { entrada: novo });
    expect(semSenha.statusCode).toBe(401);
    expect(semSenha.headers['content-type']).toMatch(/problem\+json/);
    expect(
      (await post(s, '/api/cadastros/estrutura/leitos/incluirLeito', { entrada: novo, senha: 'errada-x' }))
        .statusCode,
    ).toBe(401);
    const inc = await post(s, '/api/cadastros/estrutura/leitos/incluirLeito', {
      entrada: novo,
      senha: SENHA,
    });
    expect(inc.statusCode, inc.body).toBe(200);
    const dup = await post(s, '/api/cadastros/estrutura/leitos/incluirLeito', {
      entrada: { bloco: 'INT-1', acomodacao: '102', leito: 'C', andar: 1, anoVigente: 2026, mesVigente: 10 },
      senha: SENHA,
    });
    expect(dup.statusCode).toBe(409);
    const depois = (await get(s, '/api/cadastros/estrutura/leitos')).json();
    const ocupado = depois.blocos
      .flatMap((b: { acomodacoes: { leitos: { id: number; ocupado: boolean; versao: string }[] }[] }) =>
        b.acomodacoes.flatMap((a) => a.leitos),
      )
      .find((x: { ocupado: boolean }) => x.ocupado);
    const rec = await post(s, '/api/cadastros/estrutura/leitos/inativarLeito', {
      entrada: { id: ocupado.id, versao: ocupado.versao },
      senha: SENHA,
    });
    expect(rec.statusCode).toBe(409);
    expect((await post(s, '/api/cadastros/estrutura/leitos/naoExiste', { entrada: {} })).statusCode).toBe(
      404,
    );
    const c = (await get(s, '/api/cadastros/estrutura/leitos/conferencia')).json();
    expect(c.divergencias.some((d: { tipo: string }) => d.tipo === 'espelho-sem-leito')).toBe(true);
  });

  it('consultas da organização sem credencial na resposta', async () => {
    const s = await entrar('SINT.ADMIN');
    for (const u of ['alertas', 'notificacoes', 'empresa', 'backup', 'parametros-banco']) {
      const r = await get(s, `/api/administracao/${u}`);
      expect([200, 403]).toContain(r.statusCode);
      expect(r.body).not.toMatch(/"(senha|password|smtpPass)"\s*:\s*"/i);
    }
  });
});
