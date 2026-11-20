// W0-06, parte 4: cargos e salários pela HTTP (permissões pessoas.cargos.*, Zod com motivo, 409 com a contagem e a
// oferta da inativação). Portas em memória; dados sintéticos; nada conecta a banco.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ChaveGravada, PrerequisitoGravado } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { PortaPessoasMemoria } from '../porta-memoria.js';
import { PortaCargosMemoria } from './porta-cargos-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const chave: ChaveGravada = {
  id: 'pessoas.colaborador',
  tipo: 'recurso',
  chave: 'pessoas.colaborador',
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'teste sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
};
const conferencia: PrerequisitoGravado = {
  recurso: 'pessoas.colaborador',
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
};

let app: NestFastifyApplication;
const trilha = new RegistradorTrilhaMemoria();
const cargos = new PortaCargosMemoria();
cargos.agoraFixo = '2026-11-18T10:00';

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    pessoas: new PortaPessoasMemoria(),
    cargos,
    configuracao: fonteConfiguracaoMemoria(trilha, {
      chavesIniciais: () => [chave],
      prerequisitosIniciais: () => [conferencia],
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
  const h = () => ({ cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `w006-cargos-http-${++n}` });
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers: h() }),
    post: (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, payload: payload as object, headers: h() }),
  };
};
const P = '/api/pessoas/cargos';
const MOTIVO = 'Lançado com o dado errado na implantação';
const CARGO = {
  nome: 'Técnico de enfermagem',
  cbo: '322205',
  descricao: null,
  requisitos: null,
  conselho: 'COREN',
};

describe('W0-06 parte 4: cargos e salários pela HTTP', () => {
  it('o RH inclui, altera com motivo, lança faixa e vaga; a ficha traz o histórico', async () => {
    const rh = pedir(await entrar('SINT.RH'));
    const ap = await rh.get(`${P}/apoio`);
    expect(ap.statusCode).toBe(200);
    expect(ap.json().acoes.gerir).toBe(true);
    expect((await rh.get(`${P}/cbo?termo=enferm`)).json().length).toBeGreaterThan(0);
    const i = await rh.post(P, CARGO);
    expect(i.statusCode).toBe(200);
    const id = i.json().id as number;
    // Sem motivo: 400 do Zod (o mesmo esquema da tela).
    expect((await rh.post(`${P}/${id}/alteracao`, { ...CARGO, versao: 0 })).statusCode).toBe(400);
    const versao = (await rh.get(`${P}/${id}`)).json().cargo.versao;
    const a = await rh.post(`${P}/${id}/alteracao`, {
      ...CARGO,
      nome: 'Técnico de enfermagem da UTI',
      versao,
      motivo: MOTIVO,
    });
    expect(a.statusCode).toBe(200);
    expect(
      (
        await rh.post(`${P}/faixas`, {
          cargo: id,
          faixa: 'A',
          nivel: 'I',
          valor: 320_000,
          desde: '2026-01-01',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await rh.post(`${P}/vagas`, { cargo: id, centroCusto: 9521, quantidade: 4, desde: '2026-01-01' }))
        .statusCode,
    ).toBe(200);
    const f = (await rh.get(`${P}/${id}`)).json();
    expect(f.cargo.nome).toBe('Técnico de enfermagem da UTI');
    expect(f.correcoes[0].motivo).toBe(MOTIVO);
    expect(f.faixas).toHaveLength(1);
    expect(f.vagas[0].quantidade).toBe(4);
    // Referenciado pela vaga: a exclusão recusa com a contagem e oferece a inativação.
    const x = await rh.post(`${P}/exclusao`, { alvo: 'cargo', id, versao: f.cargo.versao, motivo: MOTIVO });
    expect(x.statusCode).toBe(409);
    expect(x.json().codigo).toMatch(/-com-vinculos$/);
    expect(x.json().detail ?? x.json().detalhe).toMatch(/inative/);
    const s = await rh.post(`${P}/situacao`, {
      alvo: 'cargo',
      id,
      versao: f.cargo.versao,
      ativo: false,
      motivo: MOTIVO,
    });
    expect(s.statusCode).toBe(200);
    expect((await rh.get(`${P}/${id}`)).json().cargo.ativo).toBe(false);
  });

  it('quem não tem pessoas.cargos.* não lê nem grava (403)', async () => {
    const c = pedir(await entrar('SINT.RH.CONSULTA'));
    expect((await c.get(P)).statusCode).toBe(403);
    expect((await c.post(P, CARGO)).statusCode).toBe(403);
    const med = pedir(await entrar('SINT.MEDICO'));
    expect((await med.get(`${P}/apoio`)).statusCode).toBe(403);
  });
});
