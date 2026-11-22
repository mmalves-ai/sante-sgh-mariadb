// D-PROF-39 pela HTTP, com a sessão real sobre a fonte sintética e a porta do cadastro EM MEMÓRIA (nada conecta a
// banco; dados SINTÉTICOS): inclusão do profissional com o registro, edição dos dados com a versão (colisão 409),
// registro novo, inativação do registro, especialidade, lotação e credenciamento; permissões no servidor (403 sem a
// opção), IDOR (registro de outro profissional dá 404), trilha e nenhum dado bancário na ficha.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from './porta-memoria.js';
import { moduloConfiguracaoDeTeste, registroDeTeste } from './teste.spec-util.js';

const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  API_MODULOS: 'configuracao_teste,cadastro',
};
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: registroDeTeste(
      { cadastro: new PortaCadastroMemoria() },
      { configuracao_teste: (ctx) => moduloConfiguracaoDeTeste(ctx) },
    ),
  });
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
async function entrar(login: string): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = r.headers['set-cookie'] as string[];
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
  'idempotency-key': `teste-prof-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
const enviar = (s: Sessao, method: 'POST' | 'PUT', url: string, payload: unknown) =>
  app.inject({ method, url, headers: h(s), payload: payload as Record<string, unknown> });
const P = '/api/cadastros/profissionais';

describe('D-PROF-39: inclusão e edição do profissional (memória)', () => {
  it('inclui o profissional com o registro e o credenciamento; recusa o CPF e o registro repetidos', async () => {
    const s = await entrar('SINT.ADMIN');
    const opc = (await get(s, `${P}/opcoes`)).json();
    expect(opc.cbos.length).toBeGreaterThan(0);
    expect(opc.conselhos.map((c: { valor: string }) => c.valor)).toContain('CRM');
    const corpo = {
      nome: 'nova medica sintetica',
      cpf: '529.982.247-25',
      sexo: 'F',
      registro: { conselho: 'crm', numero: 812001, uf: 'rj', cbo: 1, convenios: [10, 11] },
    };
    const r = await enviar(s, 'POST', P, corpo);
    expect(r.statusCode).toBe(201);
    const { profissional, registro } = r.json() as { profissional: number; registro: number };
    const f = (await get(s, `${P}/${profissional}`)).json();
    expect(f.nome).toBe('NOVA MEDICA SINTETICA');
    expect(f.registros).toMatchObject([
      { id: registro, conselho: 'CRM', numero: 812001, uf: 'RJ', ativo: true },
    ]);
    expect(f.credenciamentos).toHaveLength(2);
    expect(JSON.stringify(f)).not.toMatch(/banco|agencia|conta|repasse|cpf/i);
    expect((await get(s, `${P}?termo=nova%20medica`)).json().itens[0].id).toBe(profissional);
    expect(
      trilha.eventos.some(
        (e) => e.evento === 'cadastro.profissional.cadastrado' && e.idAlvo === String(profissional),
      ),
    ).toBe(true);
    const cpf = await enviar(s, 'POST', P, { ...corpo, registro: { ...corpo.registro, numero: 812002 } });
    expect([cpf.statusCode, cpf.json().codigo]).toEqual([409, 'cpf-existente']);
    const rep = await enviar(s, 'POST', P, {
      ...corpo,
      cpf: '11144477735',
      registro: { ...corpo.registro, numero: 11111, uf: 'MG' },
    });
    expect([rep.statusCode, rep.json().codigo]).toEqual([409, 'registro-repetido']);
    expect((await enviar(s, 'POST', P, { ...corpo, cpf: '123' })).statusCode).toBe(400);
  });

  it('edita os dados pela versão lida; a versão velha dá 409 de colisão', async () => {
    const s = await entrar('SINT.ADMIN');
    const f = (await get(s, `${P}/3`)).json();
    expect(f.dados.versao).toMatch(/NOME/);
    const ok = await enviar(s, 'PUT', `${P}/3`, {
      versao: f.dados.versao,
      alteracoes: { email: 'ana@exemplo.com', nomeSocial: 'ana' },
    });
    expect(ok.statusCode).toBe(200);
    const g = (await get(s, `${P}/3`)).json();
    expect([g.nomeSocial, g.dados.email]).toEqual(['ANA', 'ana@exemplo.com']);
    const velha = await enviar(s, 'PUT', `${P}/3`, {
      versao: f.dados.versao,
      alteracoes: { nomeMae: 'MAE SINTETICA' },
    });
    expect(velha.statusCode).toBe(409);
    expect(
      (
        await enviar(s, 'PUT', `${P}/3`, { versao: g.dados.versao, alteracoes: { email: 'ana@exemplo.com' } })
      ).json().codigo,
    ).toBe('sem-alteracao');
  });

  it('registro novo, inativação, especialidade, lotação e credenciamento; IDOR e permissões', async () => {
    const s = await entrar('SINT.ADMIN');
    const novo = await enviar(s, 'POST', `${P}/4/registros`, {
      conselho: 'CRM',
      numero: 812003,
      uf: 'SP',
      cbo: 1,
    });
    expect(novo.statusCode).toBe(201);
    const reg = novo.json().registro as number;
    const f = (await get(s, `${P}/4`)).json();
    const r = f.registros.find((x: { id: number }) => x.id === reg);
    // Encerrar o registro exige o motivo (400 sem ele) e a permissão de inativar (403 só com a de editar).
    expect(
      (await enviar(s, 'PUT', `${P}/4/registros/${reg}`, { versao: r.versao, alteracoes: { ativo: false } }))
        .statusCode,
    ).toBe(400);
    const cad = await entrar('SINT.CORPOCLINICO');
    expect(
      (
        await enviar(cad, 'PUT', `${P}/4/registros/${reg}`, {
          versao: r.versao,
          alteracoes: { ativo: false },
          motivo: 'Encerrado no teste sintético',
        })
      ).statusCode,
    ).toBe(403);
    const ina = await enviar(s, 'PUT', `${P}/4/registros/${reg}`, {
      versao: r.versao,
      alteracoes: { ativo: false },
      motivo: 'Encerrado no teste sintético',
    });
    expect(ina.statusCode).toBe(200);
    // O encerramento vai ao histórico do profissional com o motivo.
    expect((await get(s, `${P}/4/eventos`)).json()[0]).toMatchObject({
      evento: 'inativado',
      registro: reg,
      motivo: 'Encerrado no teste sintético',
    });
    expect((await get(s, `${P}/4`)).json().registros.find((x: { id: number }) => x.id === reg).ativo).toBe(
      false,
    );
    expect(
      (await enviar(s, 'PUT', `${P}/4/especialidades`, { registro: reg, especialidade: 2, ativo: true }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await enviar(s, 'PUT', `${P}/4/lotacao`, {
          registro: reg,
          unidade: 2,
          horasAmbulatorio: 10,
          horasHospital: 0,
          horasOutros: 0,
          ativo: true,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await enviar(s, 'PUT', `${P}/4/credenciamentos`, { registro: reg, convenio: 10, credenciado: true }))
        .statusCode,
    ).toBe(200);
    expect(
      (await enviar(s, 'PUT', `${P}/4/credenciamentos`, { registro: reg, convenio: 10, credenciado: false }))
        .statusCode,
    ).toBe(200);
    const g = (await get(s, `${P}/4`)).json();
    expect(
      g.especialidades.some(
        (e: { registro: number; codigo: number }) => e.registro === reg && e.codigo === 2,
      ),
    ).toBe(true);
    expect(
      g.lotacao.some((e: { registro: number; unidade: number }) => e.registro === reg && e.unidade === 2),
    ).toBe(true);
    // IDOR: o registro 10 é da ANA (3), não do BRUNO (4).
    expect(
      (await enviar(s, 'PUT', `${P}/4/especialidades`, { registro: 10, especialidade: 2, ativo: true }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await enviar(s, 'PUT', `${P}/4/registros/10`, {
          versao: '{}',
          alteracoes: { ativo: false },
          motivo: 'Encerrado no teste sintético',
        })
      ).statusCode,
    ).toBe(404);
    // Sem a opção do gerenciamento de profissionais: 403 no servidor.
    const rec = await entrar('SINT.RECEPCAO');
    expect(
      (
        await enviar(rec, 'PUT', `${P}/4/lotacao`, {
          registro: reg,
          unidade: 1,
          horasAmbulatorio: 1,
          horasHospital: 0,
          horasOutros: 0,
          ativo: true,
        })
      ).statusCode,
    ).toBe(403);
    expect((await enviar(rec, 'POST', P, {})).statusCode).toBe(403);
    expect((await get(rec, `${P}/3`)).json().dados).toBeUndefined();
  });
});

describe('D-PROF-39: login do profissional, inativar/reativar e exclusão só sem vínculo (memória)', () => {
  it('liga o login com a senha de novo; toda mudança com justificativa; um login, um profissional; histórico', async () => {
    // Revisão da D-PROF-39: o vínculo é a identidade clínica: exige a gestão de acessos, não a edição do cadastro.
    const adm = await entrar('SINT.ADMIN');
    expect((await get(adm, `${P}/logins`)).statusCode).toBe(403);
    expect(
      (
        await enviar(adm, 'PUT', `${P}/4/login`, {
          registro: 12,
          login: 'sint.livre1',
          versao: '',
          justificativa: 'Ligado no teste sintético',
          senha: SENHA,
        })
      ).statusCode,
    ).toBe(403);
    const s = await entrar('SINT.VINCULOS');
    const logins = (await get(s, `${P}/logins`)).json() as { login: string; profissional: number | null }[];
    expect(logins.find((l) => l.login === 'SINT.MEDICO')?.profissional).toBe(3);
    expect(logins.find((l) => l.login === 'SINT.LIVRE1')?.profissional).toBeNull();
    const f = (await get(s, `${P}/4`)).json();
    expect(f.loginsRegistro).toEqual([{ registro: 11, login: 'SINT.PROF4' }]);
    expect(f.dados).toBeUndefined(); // gere acessos, mas não edita o cadastro: sem os dados pessoais
    // Sem a senha: 401 (crítica); nada muda.
    const sem = await enviar(s, 'PUT', `${P}/4/login`, {
      registro: 12,
      login: 'sint.livre1',
      versao: '',
      justificativa: 'Ligado no teste sintético',
    });
    expect(sem.statusCode).toBe(401);
    // Também a primeira ligação pede a justificativa.
    const semJust1 = await enviar(s, 'PUT', `${P}/4/login`, {
      registro: 12,
      login: 'sint.livre1',
      versao: '',
      senha: SENHA,
    });
    expect([semJust1.statusCode, semJust1.json().codigo]).toEqual([409, 'justificativa-obrigatoria']);
    // Ninguém liga o próprio login (segregação).
    const proprio = await enviar(s, 'PUT', `${P}/4/login`, {
      registro: 12,
      login: 'sint.vinculos',
      versao: '',
      justificativa: 'Ligando a mim mesmo no teste',
      senha: SENHA,
    });
    expect([proprio.statusCode, proprio.json().codigo]).toEqual([409, 'a-si-mesmo']);
    // Login único por profissional: o BRUNO (4) já tem SINT.PROF4 no registro 11; um SEGUNDO login no 12 é recusado.
    const segundo = await enviar(s, 'PUT', `${P}/4/login`, {
      registro: 12,
      login: 'sint.livre1',
      versao: '',
      justificativa: 'Ligado no teste sintético',
      senha: SENHA,
    });
    expect([segundo.statusCode, segundo.json().codigo]).toEqual([409, 'outro-login-no-profissional']);
    expect(segundo.json().detail).toMatch(/já tem o login SINT\.PROF4 ligado a outra ocupação/);
    // Trocar o login no registro em que ele está (11): passa.
    const liga = await enviar(s, 'PUT', `${P}/4/login`, {
      registro: 11,
      login: 'sint.livre1',
      versao: 'SINT.PROF4',
      justificativa: 'Login novo do médico no teste sintético',
      senha: SENHA,
    });
    expect(liga.statusCode).toBe(200);
    expect(liga.json()).toEqual({ registro: 11, semRegistroAtivo: false });
    // O login de outro profissional (ANA, 3) é recusado com o motivo.
    const outro = await enviar(s, 'PUT', `${P}/4/login`, {
      registro: 11,
      login: 'SINT.MEDICO',
      versao: 'SINT.LIVRE1',
      justificativa: 'Troca de teste sintético',
      senha: SENHA,
    });
    expect(outro.statusCode).toBe(409);
    expect(outro.json().detail).toMatch(/outro profissional/);
    // Trocar sem justificativa: recusado.
    const semJust = await enviar(s, 'PUT', `${P}/4/login`, {
      registro: 11,
      login: 'SINT.LIVRE2',
      versao: 'SINT.LIVRE1',
      senha: SENHA,
    });
    expect(semJust.json().codigo ?? semJust.json().type).toMatch(/justificativa/);
    // Trocar a ocupação: o MESMO login vai do registro 11 para o 12; o 11 fica sem login e o histórico dele mostra o
    // desligamento com a mesma justificativa.
    const move = await enviar(s, 'PUT', `${P}/4/login`, {
      registro: 12,
      login: 'SINT.LIVRE1',
      versao: '',
      justificativa: 'Login passa à outra ocupação',
      senha: SENHA,
    });
    expect([move.statusCode, move.json()]).toEqual([200, { registro: 12, semRegistroAtivo: false }]);
    expect((await get(s, `${P}/4`)).json().loginsRegistro).toEqual([{ registro: 12, login: 'SINT.LIVRE1' }]);
    const desl = await enviar(s, 'PUT', `${P}/4/login`, {
      registro: 12,
      login: null,
      versao: 'SINT.LIVRE1',
      justificativa: 'Desligado no teste sintético',
      senha: SENHA,
    });
    expect(desl.statusCode).toBe(200);
    const ev = (await get(s, `${P}/4/eventos`)).json() as {
      evento: string;
      registro: number;
      motivo: string | null;
    }[];
    expect(ev.filter((e) => e.evento.startsWith('login-')).map((e) => `${e.evento}:${e.registro}`)).toEqual([
      'login-desligado:12',
      'login-desligado:11',
      'login-ligado:12',
      'login-trocado:11',
    ]);
    expect(ev[1]!.motivo).toBe('Login passa à outra ocupação');
    expect(ev[0]!.motivo).toBe('Desligado no teste sintético');
    expect(trilha.eventos.some((e) => e.evento === 'cadastro.profissional.alterado')).toBe(true);
  });

  it('login único: o mesmo CRM em três ocupações tem um login; o dado herdado com dois logins aparece todo e o extra se desliga', async () => {
    const s = await entrar('SINT.VINCULOS');
    // EDUARDO (7): CRM 66666/MG em três CBOs, um login só (no registro 15).
    const f7 = (await get(s, `${P}/7`)).json() as {
      registros: { id: number; numero: number; cbo: string }[];
      loginsRegistro: { registro: number; login: string }[];
    };
    expect(f7.registros.filter((r) => r.cbo !== '000000').map((r) => `${r.numero}:${r.cbo}`)).toEqual([
      '66666:225125',
      '66666:225250',
      '66666:225170',
    ]);
    expect(f7.loginsRegistro).toEqual([{ registro: 15, login: 'SINT.PROF6' }]);
    const terceiro = await enviar(s, 'PUT', `${P}/7/login`, {
      registro: 17,
      login: 'SINT.LIVRE2',
      versao: '',
      justificativa: 'Segundo login no teste sintético',
      senha: SENHA,
    });
    expect([terceiro.statusCode, terceiro.json().codigo]).toEqual([409, 'outro-login-no-profissional']);
    // FERNANDA (8): dado herdado, dois logins em ocupações diferentes. A ficha devolve os dois (nunca esconde).
    const f8 = (await get(s, `${P}/8`)).json() as { loginsRegistro: { registro: number; login: string }[] };
    expect(f8.loginsRegistro).toEqual([
      { registro: 18, login: 'SINT.PROF7' },
      { registro: 19, login: 'SINT.PROF8' },
    ]);
    // Trocar o login de um deles por um terceiro: recusado (o outro registro tem login diferente).
    const troca = await enviar(s, 'PUT', `${P}/8/login`, {
      registro: 19,
      login: 'SINT.LIVRE2',
      versao: 'SINT.PROF8',
      justificativa: 'Troca no dado herdado do teste',
      senha: SENHA,
    });
    expect(troca.json().codigo).toBe('outro-login-no-profissional');
    // Desligar o extra: passa, e o profissional fica com um login só.
    const desl = await enviar(s, 'PUT', `${P}/8/login`, {
      registro: 19,
      login: null,
      versao: 'SINT.PROF8',
      justificativa: 'Login extra herdado desligado',
      senha: SENHA,
    });
    expect(desl.statusCode).toBe(200);
    expect((await get(s, `${P}/8`)).json().loginsRegistro).toEqual([{ registro: 18, login: 'SINT.PROF7' }]);
  });

  it('a ficha diz o que o executor aceita para quem pergunta (aviso único e controles pela mesma regra)', async () => {
    const s = await entrar('SINT.ADMIN');
    const f = (await get(s, `${P}/3`)).json() as { operacoes: { operacao: string; ligada: boolean }[] };
    expect(f.operacoes.map((o) => o.operacao)).toEqual(
      expect.arrayContaining([
        'cadastro.alterarProfissional',
        'cadastro.vincularLoginProfissional',
        'cadastro.excluirProfissional',
      ]),
    );
    expect(f.operacoes).toHaveLength(12);
    expect(f.operacoes.every((o) => typeof o.ligada === 'boolean')).toBe(true);
  });

  it('inativa e reativa com motivo; exclusão recusada com quantos e quais; o cadastrado por engano sai', async () => {
    const s = await entrar('SINT.ADMIN');
    expect((await enviar(s, 'POST', `${P}/3/inativar`, { motivo: 'curto' })).statusCode).toBe(400);
    expect(
      (await enviar(s, 'POST', `${P}/3/inativar`, { motivo: 'Desligado do corpo clínico' })).statusCode,
    ).toBe(200);
    expect((await get(s, `${P}/3`)).json().registros.every((r: { ativo: boolean }) => !r.ativo)).toBe(true);
    expect(
      (await enviar(s, 'POST', `${P}/3/reativar`, { motivo: 'Readmitido no corpo clínico' })).statusCode,
    ).toBe(200);
    // O DANIEL (6) foi inativado por fora (nenhuma inativação deste sistema): não reativa em bloco.
    const fora = await enviar(s, 'POST', `${P}/6/reativar`, { motivo: 'Readmitido no corpo clínico' });
    expect([fora.statusCode, fora.json().codigo]).toEqual([409, 'reativar-registro-a-registro']);
    const v = (await get(s, `${P}/3/vinculos`)).json();
    expect(v.podeExcluir).toBe(false);
    expect(v.vinculos).toEqual(
      expect.arrayContaining([
        { grupo: 'Atendimentos', quantidade: 8 },
        { grupo: 'Login do sistema', quantidade: 1 },
      ]),
    );
    const rec = await enviar(s, 'POST', `${P}/3/excluir`, {
      motivo: 'Cadastro feito por engano',
      senha: SENHA,
    });
    expect(rec.statusCode).toBe(409);
    expect(rec.json().detail).toMatch(/9 vínculos.*Atendimentos: 8.*inative/);
    // O cadastrado por engano, sem vínculo: sai (com a senha de novo).
    const novo = await enviar(s, 'POST', P, {
      nome: 'engano sintetico',
      cpf: '111.444.777-35',
      registro: { conselho: 'CRM', numero: 812999, uf: 'MG', cbo: 1, convenios: [] },
    });
    expect(novo.statusCode).toBe(201);
    const id = (novo.json() as { profissional: number }).profissional;
    expect((await get(s, `${P}/${id}/vinculos`)).json()).toEqual({
      total: 0,
      vinculos: [],
      podeExcluir: true,
    });
    expect(
      (await enviar(s, 'POST', `${P}/${id}/excluir`, { motivo: 'Cadastro feito por engano' })).statusCode,
    ).toBe(401);
    const ok = await enviar(s, 'POST', `${P}/${id}/excluir`, {
      motivo: 'Cadastro feito por engano',
      senha: SENHA,
    });
    expect(ok.statusCode).toBe(200);
    expect((await get(s, `${P}/${id}`)).statusCode).toBe(404);
    // Registro com atos: só encerrar.
    const r11 = await enviar(s, 'POST', `${P}/4/registros/11/excluir`, {
      motivo: 'Registro incluído por engano',
      senha: SENHA,
    });
    expect(r11.statusCode).toBe(409);
    expect(r11.json().detail).toMatch(/encerre/);
    // Sem a opção de excluir: 403.
    const rec2 = await entrar('SINT.RECEPCAO');
    expect(
      (await enviar(rec2, 'POST', `${P}/4/inativar`, { motivo: 'Desligado do corpo clínico' })).statusCode,
    ).toBe(403);
  });
});
