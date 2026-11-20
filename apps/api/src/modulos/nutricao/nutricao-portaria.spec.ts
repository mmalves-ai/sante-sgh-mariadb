// M50.5 (correção da revisão): uma fonte só para o acompanhante. O acompanhante com direito legal e com a refeição
// registrado na portaria (POST /portaria/acompanhantes, em SGH_HOT_ACOMPANHANTE) chega ao mapa de dietas da nutrição
// (M45.5) sem um segundo cadastro; o autorizado pela equipe (sem direito legal) não entra. Pela HTTP, com a sessão real
// sobre a fonte sintética e as duas portas EM MEMÓRIA, com os mesmos internados sintéticos (nada conecta a banco).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { InternadoPortaria } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaPortariaMemoria } from '../portaria/porta-memoria.js';
import { acompanhantesDoMapa } from './servico.js';
import { PortaNutricaoMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const relogio = () => new Date(2026, 9, 25, 8, 0, 0);
const nutricao = new PortaNutricaoMemoria(relogio);
// Os internados da portaria são os da nutrição em memória (950001, de 1948, e 950002, de 1980, na unidade 2A).
const internado = (reg: number, nascimento: string, leito: string): InternadoPortaria => ({
  internacao: reg,
  paciente: reg - 850_000,
  nome: `PACIENTE SINTETICO ${reg}`,
  nascimento,
  unidade: '2A',
  unidadeNome: 'UNIDADE SINTETICA 2A',
  acomod: '201',
  leitoCodigo: leito,
  leito: `201-${leito}`,
  isolamento: false,
});
const portaria = new PortaPortariaMemoria({
  agora: relogio,
  internados: [internado(950_001, '1948-03-07', 'A'), internado(950_002, '1980-05-10', 'B')],
});
let app: NestFastifyApplication;
let seq = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, nutricao, portaria, vigia: null });
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
  expect(r.statusCode, r.body).toBe(201);
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
type Sessao = Awaited<ReturnType<typeof entrar>>;
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url: `/api${url}`,
    headers: {
      cookie: s.cookie,
      'x-csrf': s.csrf,
      'idempotency-key': `teste-m50-5-nutri-${++seq}-${Date.now()}`,
    },
    payload: payload as object,
  });

describe('o acompanhante da portaria no mapa de dietas (M50.5 com o M45.5)', () => {
  it('registrado na portaria com a refeição, aparece no mapa (todas as refeições); o autorizado não', async () => {
    const p = await entrar('SINT.PORTARIA');
    const copa = await entrar('SINT.COPA');
    const pessoa = async (documento: string) => {
      const r = await post(p, '/portaria/visitantes', {
        nome: `Acompanhante Sintetico ${documento}`,
        tipoDocumento: 'outro',
        documento,
        nascimento: '1975-01-01',
        tipoVisitante: 1,
      });
      expect(r.statusCode, r.body).toBe(201);
      return (r.json() as { id: number }).id;
    };
    const antes = await get(copa, '/nutricao/mapa?unidade=2A&refeicao=2&data=2026-10-25');
    expect(antes.statusCode, antes.body).toBe(200);
    expect(antes.json().acompanhantes).toBe(0);
    const legal = await post(p, '/portaria/acompanhantes', {
      internacao: 950_001,
      visitante: await pessoa('SINTNUP001'),
      fundamento: 'idoso',
      refeicao: true,
      pernoite: true,
    });
    expect(legal.statusCode, legal.body).toBe(201);
    const autorizado = await post(p, '/portaria/acompanhantes', {
      internacao: 950_002,
      visitante: await pessoa('SINTNUP002'),
      fundamento: 'autorizado',
      refeicao: false,
      pernoite: false,
    });
    expect(autorizado.statusCode, autorizado.body).toBe(201);
    for (const refeicao of [2, 6]) {
      const m = await get(copa, `/nutricao/mapa?unidade=2A&refeicao=${refeicao}&data=2026-10-25`);
      expect(m.statusCode, m.body).toBe(200);
      const linhas = m.json().linhas as { internacao: number; acompanhante: unknown }[];
      expect(m.json().acompanhantes).toBe(1);
      expect(linhas.find((l) => l.internacao === 950_001)?.acompanhante).toMatchObject({
        baseLegal: 'idoso',
        origem: 'portaria',
        inicio: '2026-10-25',
        fim: null,
      });
      expect(linhas.find((l) => l.internacao === 950_002)?.acompanhante).toBeNull();
    }
    // Antes do dia do registro, não.
    const ontem = await get(copa, '/nutricao/mapa?unidade=2A&refeicao=2&data=2026-10-24');
    expect(ontem.json().acompanhantes).toBe(0);
  });

  it('o registro da nutrição prevalece (escolhe as refeições); o fundamento vira a base legal', () => {
    const daNutricao = new Map([
      [
        1,
        {
          id: 9,
          reg: 1,
          baseLegal: 'idoso' as const,
          refeicoes: [2],
          inicio: '2026-10-20',
          fim: null,
          observacao: null,
          situacao: 'ativa' as const,
          por: 'SINT',
          em: '2026-10-20T08:00',
          dieta: null,
        },
      ],
    ]);
    const daPortaria = (
      internacao: number,
      fundamento: 'idoso' | 'crianca' | 'parto' | 'deficiencia' | 'autorizado',
    ) => ({
      id: 70 + internacao,
      internacao,
      paciente: 1,
      unidade: '2A',
      fundamento,
      pernoite: false,
      desde: '2026-10-25T09:30',
    });
    const m = acompanhantesDoMapa(
      daNutricao,
      [
        daPortaria(1, 'idoso'),
        daPortaria(2, 'crianca'),
        daPortaria(3, 'parto'),
        daPortaria(4, 'deficiencia'),
        daPortaria(5, 'autorizado'),
      ],
      [1, 2, 3],
    );
    expect(m.get(1)).toMatchObject({ id: 9, refeicoes: [2] });
    expect(m.get(2)).toMatchObject({
      baseLegal: 'crianca-adolescente',
      refeicoes: [1, 2, 3],
      inicio: '2026-10-25',
    });
    expect(m.get(3)?.baseLegal).toBe('parturiente');
    expect(m.get(4)?.baseLegal).toBe('pessoa-deficiencia');
    expect(m.has(5)).toBe(false);
  });
});
