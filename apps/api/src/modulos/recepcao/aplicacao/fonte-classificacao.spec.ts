// M44, regra 6 (uma fonte de cor no PA; cap-12 §12.4, Nota) pela HTTP, com a sessão real sobre a fonte sintética
// (nada conecta a banco): ligar a classificação externa onde a própria está ligada é recusado; ligar a própria
// desliga, no mesmo pedido, a externa ligada nos mesmos escopos (a SGH_TRILHA registra as duas mudanças). A prova sobre
// a cópia (as duas chaves na mesma reversão) fica em fonte-classificacao.int.spec.ts. Dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, vigia: null });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});

async function entrar(login: string) {
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

describe('regra 6: uma fonte de cor no pronto atendimento', () => {
  it('a externa não liga onde a própria está ligada; ligar a própria desliga a externa no mesmo pedido', async () => {
    const admin = await entrar('SINT.ADMIN');
    const pedir = (url: string, payload: object) =>
      app.inject({
        method: url.endsWith('prerequisitos') ? 'PUT' : 'POST',
        url: `/api/administracao/liberacao${url}`,
        headers: { cookie: admin.cookie, 'x-csrf': admin.csrf, 'idempotency-key': `m44-r6-${++chave}` },
        payload: { ...payload, senha: SENHA },
      });
    const liberar = (c: string, ligar: boolean) =>
      pedir('', {
        chave: c,
        tipo: 'recurso',
        escopo: 'hospital',
        valores: ['*'],
        ligar,
        justificativa: 'Regra 6 do M44 (teste sintético)',
      });
    // A própria vem ligada na sessão sintética: a externa é recusada.
    const r1 = await liberar('integracao.classificacaoExterna', true);
    expect(r1.statusCode, r1.body).toBe(409);
    expect(r1.json().codigo).toBe('fonte-de-cor-unica');
    // Desliga a própria e liga a externa (com o pré-requisito registrado).
    expect((await liberar('pa.classificacao', false)).statusCode).toBe(200);
    const pr = await pedir('/prerequisitos', {
      recurso: 'integracao.classificacaoExterna',
      tipo: 'aprovacao',
      situacao: 'cumprido',
      validade: null,
      evidencia: 'Teste sintético da regra 6',
    });
    expect(pr.statusCode, pr.body).toBe(200);
    const r2 = await liberar('integracao.classificacaoExterna', true);
    expect(r2.statusCode, r2.body).toBe(200);
    // Ligar a própria de novo desliga a externa na mesma ação.
    const antes = trilha.eventos.filter((e) => e.evento === 'config.liberacao.alterada').length;
    const r3 = await liberar('pa.classificacao', true);
    expect(r3.statusCode, r3.body).toBe(200);
    const depois = trilha.eventos.filter((e) => e.evento === 'config.liberacao.alterada').length;
    expect(depois - antes).toBeGreaterThanOrEqual(2);
    // A externa ficou desligada: ligá-la de novo continua recusado.
    expect((await liberar('integracao.classificacaoExterna', true)).json().codigo).toBe('fonte-de-cor-unica');

    // As duas mudanças são uma só: se ligar a própria falhar (pré-requisito pendente), a externa continua ligada.
    expect((await liberar('pa.classificacao', false)).statusCode).toBe(200);
    expect((await liberar('integracao.classificacaoExterna', true)).statusCode).toBe(200);
    const prerequisito = (situacao: string) =>
      pedir('/prerequisitos', {
        recurso: 'pa.classificacao',
        tipo: 'aprovacao',
        situacao,
        validade: null,
        evidencia: 'Teste sintético da regra 6 (atomicidade)',
      });
    expect((await prerequisito('pendente')).statusCode).toBe(200);
    const semFalha = trilha.eventos.filter((e) => e.evento === 'config.liberacao.alterada').length;
    const r4 = await liberar('pa.classificacao', true);
    expect(r4.statusCode, r4.body).toBe(409);
    expect(r4.json().codigo).toBe('prerequisito-pendente');
    expect(trilha.eventos.filter((e) => e.evento === 'config.liberacao.alterada').length).toBe(semFalha);
    // A externa não foi desligada: com o pré-requisito cumprido, ligar a própria desliga a externa agora (2 lotes).
    expect((await prerequisito('cumprido')).statusCode).toBe(200);
    const r5 = await liberar('pa.classificacao', true);
    expect(r5.statusCode, r5.body).toBe(200);
    expect(trilha.eventos.filter((e) => e.evento === 'config.liberacao.alterada').length - semFalha).toBe(2);
  });
});
