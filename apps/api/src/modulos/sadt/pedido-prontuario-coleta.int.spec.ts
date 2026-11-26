// C1-077 (05-SADT linha 10): o pedido de exame feito no prontuário chega à coleta do laboratório na sessão sintética
// (as portas em MEMÓRIA do prontuário e do SADT ligadas pela mesma trilha, com todos os módulos, como no servidor do
// E2E). Prova a passagem que os E2E @F3.5-06 e M26 percorrem: o pedido novo vira um grupo a coletar no tubo do exame;
// o pedido repetido em 24 horas não grava sem os avisos conferidos e, conferido, entra no mesmo grupo. Dados SINTÉTICOS.
// NÃO é contrato de efeito: não toca o MariaDB (é o teste da sessão sintética que os E2E usam). Roda pela config de
// integração só porque sobe a app inteira com todos os módulos. O contrato de efeito do ciclo do resultado (digitar,
// liberar, valor crítico, retificar e o aviso ao destinatário na central de avisos) é sadt/aplicacao/resultado-banco.int.spec.ts.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { REGISTRO_MODULOS } from '../registro.js';

interface Grupo {
  recipiente: { nome: string } | null;
  exames: { id: number; codigo: string; coletado: boolean }[];
}

describe('pedido do prontuário até a coleta (sessão sintética, todos os módulos)', () => {
  let app: NestFastifyApplication;
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'todos' };
  beforeAll(async () => {
    app = await criarApp(lerConfiguracao(env), null, env, {
      trilha: new RegistradorTrilhaMemoria(),
      registro: REGISTRO_MODULOS,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app?.close();
  });

  const entrar = async (login: string) => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login, senha: SENHA },
    });
    const set = r.headers['set-cookie'] as string[];
    return {
      cookie: set.map((c) => c.split(';')[0]).join('; '),
      csrf:
        set
          .find((c) => c.startsWith('sgh_csrf='))
          ?.split(';')[0]
          ?.slice(9) ?? '',
    };
  };

  it('o potássio pedido no prontuário aparece no tubo amarelo da coleta; o repetido só com os avisos conferidos', async () => {
    const medico = await entrar('SINT.MEDICO');
    let k = 0;
    const pedir = (confirmarAvisos: boolean) =>
      app.inject({
        method: 'POST',
        url: '/api/pep/paciente/1001/exames',
        headers: {
          cookie: medico.cookie,
          'x-csrf': medico.csrf,
          'idempotency-key': `c1077-${Date.now()}-${++k}`,
        },
        payload: { atendimento: 10011, itens: [{ exame: 502, urgente: false }], confirmarAvisos },
      });
    const um = await pedir(false);
    expect(um.statusCode).toBe(201);
    expect(um.json()).toMatchObject({ gravado: true, avisos: [] });
    const repetido = await pedir(false);
    expect(repetido.json()).toMatchObject({ gravado: false, pedido: null });
    expect(repetido.json().avisos).toEqual([expect.objectContaining({ exame: 502, tipo: 'duplicidade' })]);
    const conferido = await pedir(true);
    expect(conferido.json()).toMatchObject({ gravado: true });

    const biomedico = await entrar('SINT.BIOMEDICO');
    const coleta = await app.inject({
      method: 'GET',
      url: '/api/sadt/coleta',
      headers: { cookie: biomedico.cookie },
    });
    expect(coleta.statusCode).toBe(200);
    const grupos = coleta.json().grupos as Grupo[];
    const amarelo = grupos.find((g) => g.recipiente?.nome === 'TUBO AMARELO (SORO)');
    const potassios = (amarelo?.exames ?? []).filter((e) => e.codigo === 'K');
    expect(potassios).toHaveLength(2);
    expect(potassios.every((e) => !e.coletado)).toBe(true);
  });
});
