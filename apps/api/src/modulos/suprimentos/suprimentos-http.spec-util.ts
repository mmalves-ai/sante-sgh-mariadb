// Aplicação de teste das telas do suprimentos pela HTTP (consignado, contratos, licitação, OPME e manipulação): a sessão
// real sobre a fonte sintética, o centro cirúrgico e o suprimentos EM MEMÓRIA (nada conecta a banco; dados
// SINTÉTICOS), o relógio fixo em 2026-10-21 09:00. Monta os módulos `cirurgia` e `suprimentos` pelo registro (API_MODULOS),
// com o consignado, os contratos e a licitação sobre as portas de memória (o mesmo que o `modulo.ts` faz sem núcleo).
import type { DynamicModule, Provider } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { expect } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { PortaAnestesiaMemoria } from '../cirurgia/anestesia-porta-memoria.js';
import { PortaBlocoSeguroMemoria } from '../cirurgia/bloco-seguro-porta-memoria.js';
import { HOJE, type Sessao } from '../cirurgia/bloco-seguro.spec-util.js';
import { moduloCirurgia } from '../cirurgia/modulo.js';
import { PORTA_CIRURGIA } from '../cirurgia/porta.js';
import { PortaCirurgiaMemoria } from '../cirurgia/porta-memoria.js';
import { PortaConsignadoMemoria } from './consignado-porta-memoria.js';
import { ContratoController } from './contrato.controller.js';
import { PORTA_CONTRATO } from './contrato-porta.js';
import { PortaContratoMemoria } from './contrato-porta-memoria.js';
import { LicitacaoController } from './licitacao.controller.js';
import { PORTA_LICITACAO } from './licitacao-porta.js';
import { PortaLicitacaoMemoria } from './licitacao-porta-memoria.js';
import { ManipulacaoController } from './manipulacao.controller.js';
import { PortaManipulacaoMemoria } from './manipulacao-porta-memoria.js';
import { modulo as moduloSuprimentos } from './modulo.js';
import { OpmeController } from './opme.controller.js';
import { PortaOpmeMemoria } from './opme-porta-memoria.js';
import { PortaSuprimentosMemoria } from './porta-memoria.js';

export type { Sessao };
export { HOJE };

/** As portas do suprimentos que o teste lê ou ajusta. */
export interface PortasSuprimentosTeste {
  readonly opme: PortaOpmeMemoria;
  readonly consignado: PortaConsignadoMemoria;
  readonly contrato: PortaContratoMemoria;
  readonly licitacao: PortaLicitacaoMemoria;
}

/**
 * O app de teste: a mesma superfície do `montarAppBloco` (entrar, get, post, trilha, fechar), com o módulo suprimentos
 * montado por cima do cirurgia.
 */
export async function montarAppSuprimentos(o: { hhmm?: string; semChaves?: readonly string[] } = {}) {
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'cirurgia,suprimentos' };
  const trilha = new RegistradorTrilhaMemoria();
  const cadastro = new PortaCadastroMemoria();
  const relogio = { hoje: HOJE, hhmm: o.hhmm ?? '0900' };
  const cirurgia = new PortaCirurgiaMemoria(
    null,
    (c, ids) => cadastro.lerPacientes({ ...c, rede: '', hospital: '' }, ids),
    () => relogio,
  );
  const opme = new PortaOpmeMemoria();
  const portas: PortasSuprimentosTeste = {
    opme,
    consignado: new PortaConsignadoMemoria(opme),
    contrato: new PortaContratoMemoria(),
    licitacao: new PortaLicitacaoMemoria(),
  };
  const extras: Provider[] = [
    { provide: PORTA_CIRURGIA, useValue: cirurgia },
    { provide: PORTA_CONTRATO, useValue: portas.contrato },
    { provide: PORTA_LICITACAO, useValue: portas.licitacao },
  ];
  const app: NestFastifyApplication = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: {
      cirurgia: async () => ({
        modulo: (ctx) =>
          moduloCirurgia(ctx, {
            cirurgia,
            anestesia: new PortaAnestesiaMemoria(cirurgia),
            blocoSeguro: new PortaBlocoSeguroMemoria(cirurgia),
          }),
      }),
      suprimentos: async () => ({
        modulo: async (ctx): Promise<DynamicModule> => {
          const base = await moduloSuprimentos(ctx, {
            suprimentos: new PortaSuprimentosMemoria(null),
            opme,
            manipulacao: new PortaManipulacaoMemoria(),
            consignado: portas.consignado,
            ...(o.semChaves ? { semChaves: o.semChaves } : {}),
          });
          // O OPME e a manipulação leem a porta do centro cirúrgico: o `modulo.ts` só os monta quando o registro já tem
          // o cirurgia; aqui entram sempre, com a porta do centro cirúrgico de memória.
          const doBase = new Set(base.controllers ?? []);
          const comCirurgia = [OpmeController, ManipulacaoController].filter((c) => !doBase.has(c));
          return {
            ...base,
            controllers: [
              ...(base.controllers ?? []),
              ...comCirurgia,
              ContratoController,
              LicitacaoController,
            ],
            providers: [...(base.providers ?? []), ...extras],
            exports: [...(base.exports ?? []), PORTA_CONTRATO, PORTA_LICITACAO],
          };
        },
      }),
    },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  let seq = 0;
  const novaChave = () => `teste-sup-${++seq}-${Date.now()}`;
  return {
    app,
    trilha,
    portas,
    relogio,
    cirurgia,
    novaChave,
    async entrar(login: string): Promise<Sessao> {
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
    },
    /** GET absoluto (começando por /api). */
    get: (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } }),
    /** POST com a chave no cabeçalho e no corpo (a mesma). */
    post(s: Sessao, url: string, payload: Record<string, unknown> = {}, chave?: string) {
      const k = chave ?? novaChave();
      return app.inject({
        method: 'POST',
        url,
        headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': k },
        payload: { chave: k, ...payload },
      });
    },
    fechar: () => app.close(),
  };
}
export type AppSuprimentos = Awaited<ReturnType<typeof montarAppSuprimentos>>;
