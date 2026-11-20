// M52.2 (fatia F2) pela HTTP, com a sessão real sobre a fonte sintética e as portas da gestão de pessoas e da escala EM
// MEMÓRIA (nada conecta a banco; CPF SINTÉTICO): a gestora de escala (perfil `gestor-escala`) inclui o regime, cria a
// escala, inclui o plantão e publica; o RH monta mas não publica (a publicação é só do perfil); quem só consulta
// colaboradores não vê a escala; a entrada inválida dá 400 e a mudança da escala publicada sem motivo dá 409.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ChaveGravada, PrerequisitoGravado } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import { PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from '../porta-memoria.js';
import { PortaEscalaMemoria } from './porta-escala-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const chave = (c: string): ChaveGravada => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'teste sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});

let app: NestFastifyApplication;
const trilha = new RegistradorTrilhaMemoria();
const pessoas = new PortaPessoasMemoria();
pessoas.hojeFixo = '2026-10-25';
const escala = new PortaEscalaMemoria(pessoas);

beforeAll(async () => {
  const recursos = ['pessoas.colaborador', 'pessoas.escala'];
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    pessoas,
    escala,
    cifraCpf: new CifraCpf(Buffer.alloc(32, 7)),
    configuracao: fonteConfiguracaoMemoria(trilha, {
      chavesIniciais: () => recursos.map(chave),
      prerequisitosIniciais: () => recursos.map(cumprido),
    }),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 120_000);
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
let n = 0;
const pedir = (s: Sessao) => {
  const h = () => ({ cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `m52-2-teste-${++n}` });
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers: h() }),
    post: (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, payload: payload as object, headers: h() }),
  };
};
const P = '/api/pessoas';
const C = PESSOAS_SINTETICAS_M52;

describe('escala de plantão, fatia F2, pela HTTP', { timeout: 120_000 }, () => {
  it('gestora de escala: regime, escala, plantão, publicação; o RH não publica; a consulta de colaboradores não vê', async () => {
    const rh = pedir(await entrar('SINT.RH'));
    const adm = await rh.post(`${P}/colaboradores`, {
      cpf: C.escalaEnfermeira.cpf,
      nome: 'ENFERMEIRA SINTETICA TRES',
      tipo: 'clt',
      admissao: '2026-10-01',
      cargo: 'Enfermeira assistencial',
      funcao: null,
      cargaSemanalHoras: 36,
      lotacao: { centroCusto: 9521, unidade: 1, setor: 'Posto 2' },
      matricula: null,
      profissional: C.escalaEnfermeira.profissional,
      usuario: null,
    });
    expect(adm.statusCode).toBe(200);
    const vinculo = adm.json().id as number;

    const g = pedir(await entrar('SINT.ESCALA'));
    const apoio = await g.get(`${P}/escala/apoio`);
    expect(apoio.statusCode).toBe(200);
    expect(apoio.json()).toMatchObject({
      gravacao: { ligada: true },
      acoes: { montar: true, publicar: true, editarRegime: true },
      interjornadaMinimaMin: 660,
    });
    const reg = await g.post(`${P}/regimes`, {
      codigo: '12x36',
      nome: 'Plantão 12 por 36',
      jornada: 2,
      minutosPlantao: 720,
      descansoMinimoMin: 2160,
      limiteSemanalHoras: 48,
    });
    expect(reg.statusCode).toBe(200);
    expect(
      (await g.post(`${P}/regimes/atribuicao`, { vinculo, regime: reg.json().id, desde: '2026-10-01' }))
        .statusCode,
    ).toBe(200);
    expect((await g.get(`${P}/regimes`)).json().itens).toHaveLength(1);
    expect((await g.get(`${P}/escala/colaboradores?termo=TRES`)).json().itens[0]).toMatchObject({
      vinculo,
      regime: { codigo: '12x36' },
    });

    const esc = await g.post(`${P}/escalas`, {
      unidade: 1,
      setor: 'Posto 2',
      competencia: '2026-11',
      tipo: 'enfermagem',
      cobertura: { manha: 0, tarde: 0, noite: 0 },
    });
    expect(esc.statusCode).toBe(200);
    const id = esc.json().id as number;
    expect((await g.post(`${P}/escalas/${id}/plantoes`, { vinculo, tipo: 'presencial' })).statusCode).toBe(
      400,
    );
    const pl = await g.post(`${P}/escalas/${id}/plantoes`, {
      vinculo,
      tipo: 'presencial',
      inicio: '2026-11-02T07:00',
      fim: '2026-11-02T19:00',
    });
    expect(pl.statusCode).toBe(200);
    // 12x36 sem exceção: 36 h de descanso; o seguinte no dia 3 é recusado.
    const inter = await g.post(`${P}/escalas/${id}/plantoes`, {
      vinculo,
      tipo: 'presencial',
      inicio: '2026-11-03T07:00',
      fim: '2026-11-03T19:00',
    });
    expect(inter.statusCode).toBe(409);
    expect(inter.json().codigo).toBe('interjornada');

    // O RH (quadro de escalas do outro sistema) lê e monta, mas não publica (a publicação é só do perfil).
    expect((await rh.get(`${P}/escala/apoio`)).json().acoes).toMatchObject({ montar: true, publicar: false });
    expect((await rh.post(`${P}/escalas/${id}/publicacao`, { versao: 1 })).statusCode).toBe(403);
    expect((await g.post(`${P}/escalas/${id}/publicacao`, { versao: 1 })).statusCode).toBe(200);
    const grade = await g.get(`${P}/escalas/${id}`);
    expect(grade.json()).toMatchObject({ escala: { estado: 'publicada', plantoes: 1 } });
    const semMotivo = await g.post(`${P}/escalas/${id}/plantoes`, {
      vinculo,
      tipo: 'presencial',
      inicio: '2026-11-05T07:00',
      fim: '2026-11-05T19:00',
    });
    expect(semMotivo.statusCode).toBe(409);
    expect(semMotivo.json().codigo).toBe('sem-motivo');
    expect((await g.get(`${P}/escalas?competencia=2026-11`)).json().itens).toHaveLength(1);

    const consulta = pedir(await entrar('SINT.RH.CONSULTA'));
    expect((await consulta.get(`${P}/escalas`)).statusCode).toBe(403);
    expect((await consulta.get(`${P}/regimes`)).statusCode).toBe(403);
  });
});
