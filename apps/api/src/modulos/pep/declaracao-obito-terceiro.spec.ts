// 04-INT L74 (CFM Res. 1.779/2005) pela HTTP, com a sessão real sobre a fonte sintética e as portas em memória (nada
// conecta a banco; pacientes SINTÉTICOS): o perfil diretoria-clinica leva a permissão pep.declaracaoObito.cancelarOutro
// à sessão do SINT.DIRETOR.CLINICO; a leitura da alta diz, antes do motivo, quem pode cancelar (o emissor; o diretor
// clínico, por terceiro, vendo o emissor; o outro médico não vê o formulário); o controller repassa a permissão da
// sessão à porta (o médico comum que não emitiu recebe 403 nao-emissor; o diretor clínico cancela). O que fica no banco
// está no contrato de efeito documentos-propria-pareceres.int.spec.ts.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { permissaoDaSessao, podeCancelarObitoDeOutro } from './documentos.controller.js';
import { PortaRegistroMemoria } from './registro-porta-memoria.js';
import { criarAppPep } from './teste.spec-util.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;

beforeAll(async () => {
  app = await criarAppPep(env, {
    trilha,
    cadastro: new PortaCadastroMemoria(),
    registro: new PortaRegistroMemoria(trilha),
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
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
let chave = 0;
const post = (s: Sessao, url: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url,
    headers: {
      cookie: s.cookie,
      'x-csrf': s.csrf,
      'idempotency-key': `teste.c1048.${Date.now()}.${chave++}`,
    },
    payload: payload as object,
  });
const permissoes = async (s: Sessao) =>
  ((await get(s, '/api/sessao')).json() as { permissoes?: string[] }).permissoes ?? [];
const agora = () => new Date(Date.now() - 3 * 3_600_000 - 2 * 60_000).toISOString().slice(0, 16);

const PERMISSAO = 'pep.declaracaoObito.cancelarOutro';
const MOTIVO = 'Causa básica SINTETICA registrada na linha errada';

describe('podeCancelarObitoDeOutro: a permissão da sessão que o controller repassa à porta', () => {
  const req = (permissoes?: string[]) =>
    ({ sgh: permissoes ? { sessao: { permissoes } } : undefined }) as unknown as RequisicaoAutorizada;
  it('só com pep.declaracaoObito.cancelarOutro na sessão', () => {
    expect(podeCancelarObitoDeOutro(req([PERMISSAO, 'pep.declaracaoObito.emitir']))).toBe(true);
    expect(podeCancelarObitoDeOutro(req(['pep.declaracaoObito.emitir']))).toBe(false);
    expect(podeCancelarObitoDeOutro(req())).toBe(false);
  });
  it('a rota entra com a permissão que a sessão tem: a do emissor primeiro, senão a do responsável técnico', () => {
    const emitir = 'pep.declaracaoObito.emitir';
    expect(permissaoDaSessao(req([emitir, PERMISSAO]), emitir, PERMISSAO)).toBe(emitir);
    expect(permissaoDaSessao(req([PERMISSAO]), emitir, PERMISSAO)).toBe(PERMISSAO);
  });
});

describe('cancelamento da declaração de óbito por terceiro (04-INT L74), pela HTTP', () => {
  let medico: Sessao;
  let outro: Sessao;
  let diretor: Sessao;

  beforeAll(async () => {
    medico = await entrar('SINT.MEDICO');
    outro = await entrar('SINT.RESIDENTE');
    diretor = await entrar('SINT.DIRETOR.CLINICO');
  });

  it('o perfil diretoria-clinica concede a permissão; o médico comum não a tem', async () => {
    expect(await permissoes(diretor)).toContain(PERMISSAO);
    // O grupo do diretor clínico não emite a declaração nem lê o sumário: a permissão sozinha abre a aba e o cancelamento.
    expect(await permissoes(diretor)).not.toContain('pep.declaracaoObito.emitir');
    expect(await permissoes(medico)).not.toContain(PERMISSAO);
    expect(await permissoes(outro)).not.toContain(PERMISSAO);
  });

  it('a alta diz quem pode cancelar antes do motivo; o outro médico recebe 403; o diretor cancela por terceiro', async () => {
    const r = await post(medico, '/api/pep/paciente/1003/alta/obito', {
      atendimento: 10031,
      dataHora: agora(),
      causas: { a: 'Causa sintética a' },
      senha: SENHA,
    });
    expect(r.statusCode, r.body).toBeLessThan(300);

    const doEmissor = (await get(medico, '/api/pep/paciente/1003/alta')).json();
    expect(doEmissor.obito).toMatchObject({ emissor: expect.any(String) });
    expect(doEmissor.cancelarObitoAcao).toEqual({ pode: true, motivo: null, porTerceiro: false });

    // O médico que não emitiu e não tem a permissão nem vê o formulário: o motivo da recusa vem na leitura.
    const doOutro = (await get(outro, '/api/pep/paciente/1003/alta')).json();
    expect(doOutro.cancelarObitoAcao).toMatchObject({
      pode: false,
      motivo: expect.stringMatching(/Só o médico/),
    });

    const doDiretor = (await get(diretor, '/api/pep/paciente/1003/alta')).json();
    expect(doDiretor.cancelarObitoAcao).toEqual({ pode: true, motivo: null, porTerceiro: true });

    // Sem a permissão, o controller não a repassa: a porta recusa quem não emitiu.
    const recusa = await post(outro, '/api/pep/paciente/1003/alta/obito/cancelar', {
      motivo: MOTIVO,
      senha: SENHA,
    });
    expect(recusa.statusCode).toBe(403);
    expect(recusa.json()).toMatchObject({ codigo: 'nao-emissor' });
    expect((await get(medico, '/api/pep/paciente/1003/alta')).json().obito).not.toBeNull();

    // Com a permissão da sessão do diretor clínico, o cancelamento por terceiro passa, com a trilha de terceiro.
    const ok = await post(diretor, '/api/pep/paciente/1003/alta/obito/cancelar', {
      motivo: MOTIVO,
      senha: SENHA,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await get(medico, '/api/pep/paciente/1003/alta')).json().obito).toBeNull();
  });
});
