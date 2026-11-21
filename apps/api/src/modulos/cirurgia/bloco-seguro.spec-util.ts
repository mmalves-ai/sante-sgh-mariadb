// Aplicação de teste da cirurgia segura e do rastreio (M46, etapa 2) pela HTTP: a sessão real sobre a fonte sintética, o
// centro cirúrgico, a anestesia e o bloco seguro EM MEMÓRIA (nada conecta a banco; dados SINTÉTICOS), o relógio fixo em
// 2026-10-21 09:00 e, se pedido, as chaves desligadas pelo administrador. Usada pelo bloco-seguro.spec.ts e pelo
// aplicacao/trava-incisao.int.spec.ts.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { expect } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { moduloCirurgia } from './modulo.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/configuracao-fonte.js';
import { PortaAnestesiaMemoria } from './anestesia-porta-memoria.js';
import { PortaBlocoSeguroMemoria } from './bloco-seguro-porta-memoria.js';
import { PortaCirurgiaMemoria } from './porta-memoria.js';

export { SENHA };
export const HOJE = '2026-10-21';
export const AMANHA = '2026-10-22';
/** A cirurgia sintética de amanhã às 08:00 na sala 2 (eletiva sem registro do novo: o caráter não informado). */
export const AG = 701;

export interface Sessao {
  cookie: string;
  csrf: string;
}

export async function montarAppBloco(o: { semChaves?: readonly string[]; hhmm?: string } = {}) {
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'cirurgia' };
  const trilha = new RegistradorTrilhaMemoria();
  const cadastro = new PortaCadastroMemoria();
  const relogio = { hoje: HOJE, hhmm: o.hhmm ?? '0900' };
  const cirurgia = new PortaCirurgiaMemoria(
    null,
    (c, ids) => cadastro.lerPacientes({ ...c, rede: '', hospital: '' }, ids),
    () => relogio,
  );
  const anestesia = new PortaAnestesiaMemoria(cirurgia);
  const blocoSeguro = new PortaBlocoSeguroMemoria(cirurgia);
  const fora = new Set(o.semChaves ?? []);
  const configuracao =
    fora.size > 0
      ? fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: () => chavesIniciaisSinteticas().filter((c) => !fora.has(c.chave)),
          prerequisitosIniciais: prerequisitosIniciaisSinteticos,
          parametrosIniciais: parametrosIniciaisSinteticos,
        })
      : undefined;
  const app: NestFastifyApplication = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: {
      cirurgia: async () => ({
        modulo: (ctx) =>
          moduloCirurgia(ctx, {
            cirurgia,
            anestesia,
            blocoSeguro,
            ...(configuracao ? { configuracao } : {}),
          }),
      }),
    },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  let seq = 0;
  const B = '/api/cirurgia/bloco';
  const novaChave = () => `teste-m462-${++seq}-${Date.now()}`;
  return {
    app,
    trilha,
    cirurgia,
    blocoSeguro,
    relogio,
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
    /** GET relativo a /api/cirurgia/bloco (ou absoluto, começando por /api). */
    get: (s: Sessao, url: string) =>
      app.inject({
        method: 'GET',
        url: url.startsWith('/api') ? url : `${B}${url}`,
        headers: { cookie: s.cookie },
      }),
    /** POST com a chave no cabeçalho e no corpo (a mesma). */
    post(s: Sessao, url: string, payload: Record<string, unknown> = {}, chave?: string) {
      const k = chave ?? novaChave();
      return app.inject({
        method: 'POST',
        url: url.startsWith('/api') ? url : `${B}${url}`,
        headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': k },
        payload: { chave: k, ...payload },
      });
    },
    /** POST com a Idempotency-Key só no cabeçalho (as rotas do M18, de corpo estrito sem a chave). */
    postSemChave(s: Sessao, url: string, payload: Record<string, unknown>) {
      return app.inject({
        method: 'POST',
        url,
        headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': novaChave() },
        payload,
      });
    },
    fechar: () => app.close(),
  };
}
export type AppBloco = Awaited<ReturnType<typeof montarAppBloco>>;

/** As respostas que concluem cada item do momento (a pergunta com "não"). */
export function respostasQueConcluem(
  itens: readonly { codigo: string; tipo: string }[],
): { item: string; resposta: string; observacao: null }[] {
  return itens.map((i) => ({
    item: i.codigo,
    resposta: i.tipo === 'pergunta' ? 'nao' : 'sim',
    observacao: null,
  }));
}
