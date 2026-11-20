// W0-09 (programa CRUD completo), parte 4b, pela HTTP sobre a fonte SINTÉTICA (nenhuma conexão real, nenhum dado
// de pessoa): voltar uma decisão do mapa grupo → perfil a 'proposta' mostra ANTES quantos usuários perdem o perfil
// (prévia, nada grava), exige o motivo, invalida o cache (a permissão efetiva muda na requisição seguinte), deixa o
// evento na trilha e o anterior no histórico da linha.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { esquemaSessao, EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { estadoAcessoSintetico, reiniciarEstadoAcessoSintetico } from './fonte-sintetica.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  reiniciarEstadoAcessoSintetico();
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, armazem: new ArmazemMemoria() });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
  reiniciarEstadoAcessoSintetico();
});

interface Navegador {
  cookies: Map<string, string>;
}
function guardar(n: Navegador, set: string | string[] | undefined): void {
  for (const c of Array.isArray(set) ? set : set ? [set] : []) {
    const [par] = c.split(';');
    const i = par?.indexOf('=') ?? -1;
    if (!par || i < 0) continue;
    if (/Max-Age=0/.test(c) || par.slice(i + 1) === '') n.cookies.delete(par.slice(0, i));
    else n.cookies.set(par.slice(0, i), par.slice(i + 1));
  }
}
const h = (n: Navegador) => ({
  cookie: [...n.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
  'x-csrf': n.cookies.get('sgh_csrf') ?? '',
  'idempotency-key': `teste-w009-4b-${++chave}-${Date.now()}`,
});
async function entrar(login: string): Promise<Navegador> {
  const n: Navegador = { cookies: new Map() };
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    headers: { host: 'localhost' },
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  guardar(n, r.headers['set-cookie']);
  return n;
}
const permissoes = async (n: Navegador) =>
  esquemaSessao.parse((await app.inject({ method: 'GET', url: '/api/sessao', headers: h(n) })).json())
    .permissoes;

describe('W0-09: mapa — voltar a decisão a proposta com prévia e motivo', () => {
  it('prévia conta quem perde; sem motivo 400; com motivo a permissão sai na requisição seguinte; trilha e histórico', async () => {
    const gestor = await entrar('SINT.GESTOR');
    const alvo = await entrar('SINT.RECEPCAO');
    const chave = { tipo: 'grupo-perfil', grupo: 'ATENDIMENTO', perfil: 'administrador-sistema' } as const;
    const previa = (situacao: string) =>
      app.inject({
        method: 'POST',
        url: '/api/acesso/gestao/mapa/previa',
        headers: h(gestor),
        payload: { chave, situacao },
      });
    const decidir = (situacao: string, motivo?: string) =>
      app.inject({
        method: 'POST',
        url: '/api/acesso/gestao/mapa/decidir',
        headers: h(gestor),
        payload: { chave, situacao, ...(motivo === undefined ? {} : { motivo }), senha: SENHA },
      });
    expect(await permissoes(alvo)).not.toContain('config.parametro.ler');
    // Aprovar não tira nada de ninguém: a prévia não pede motivo.
    expect((await previa('aprovada')).json()).toMatchObject({
      situacaoAtual: null,
      exigeMotivo: false,
      perdem: 0,
    });
    expect((await decidir('aprovada')).statusCode).toBe(200);
    expect(await permissoes(alvo)).toContain('config.parametro.ler');

    // Prévia: o grupo inteiro perde o perfil (quem não o tem por outra origem); nada grava.
    const p = await previa('proposta');
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({
      situacaoAtual: 'aprovada',
      situacao: 'proposta',
      exigeMotivo: true,
      limitado: false,
    });
    expect(p.json().perdem).toBeGreaterThanOrEqual(1);
    expect(p.json().amostra).toContain('SINT.RECEPCAO');
    expect(await permissoes(alvo)).toContain('config.parametro.ler');

    // Sem motivo (ou curto): 400, nada muda.
    const sem = await decidir('proposta');
    expect(sem.statusCode).toBe(400);
    expect(sem.json().codigo).toBe('motivo-obrigatorio');
    expect((await decidir('proposta', 'abc')).statusCode).toBe(400);
    expect(await permissoes(alvo)).toContain('config.parametro.ler');

    // Com motivo: volta a proposta, cache do estabelecimento invalidado, a permissão sai na requisição seguinte.
    const ok = await decidir('proposta', 'revisão da área: perfil amplo demais');
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ operacao: 'acesso.decidirMapa', invalidado: 'estabelecimento' });
    expect(await permissoes(alvo)).not.toContain('config.parametro.ler');
    expect(
      trilha.eventos.some(
        (e) => e.evento === EVENTOS_AUDITAVEIS.mapaDecidido.codigo && e.usuario === 'SINT.GESTOR',
      ),
    ).toBe(true);
    const linha = estadoAcessoSintetico().mapa.find(
      (m) => m.grupo === 'ATENDIMENTO' && m.perfil === 'administrador-sistema',
    );
    expect(linha).toMatchObject({ situacao: 'proposta', aprovadoPor: null });

    // Histórico: a aprovação e a volta, com quem aprovara, o motivo e quantos perdiam.
    const hist = await app.inject({
      method: 'GET',
      url: `/api/acesso/gestao/mapa/${linha?.id}/decisoes`,
      headers: h(gestor),
    });
    expect(hist.statusCode).toBe(200);
    expect(hist.json()).toHaveLength(2);
    expect(hist.json()[0]).toMatchObject({
      situacaoAntes: 'aprovada',
      aprovadoPorAntes: 'SINT.GESTOR',
      situacao: 'proposta',
      motivo: 'revisão da área: perfil amplo demais',
      usuariosAfetados: p.json().perdem,
      decididoPor: 'SINT.GESTOR',
    });
    expect(hist.json()[1]).toMatchObject({ situacaoAntes: null, situacao: 'aprovada', motivo: null });
  });

  it('revisão: reverter ou conceder uma recusa também exige o motivo (recusada → proposta/aprovada sem motivo → 400)', async () => {
    const gestor = await entrar('SINT.GESTOR');
    const chave = { tipo: 'grupo-perfil', grupo: 'ATENDIMENTO', perfil: 'ouvidoria' } as const;
    const decidir = (situacao: string, motivo?: string) =>
      app.inject({
        method: 'POST',
        url: '/api/acesso/gestao/mapa/decidir',
        headers: h(gestor),
        payload: { chave, situacao, ...(motivo === undefined ? {} : { motivo }), senha: SENHA },
      });
    // A linha nova nasce recusada sem motivo (nada existia antes).
    expect((await decidir('recusada')).statusCode).toBe(200);
    const previa = await app.inject({
      method: 'POST',
      url: '/api/acesso/gestao/mapa/previa',
      headers: h(gestor),
      payload: { chave, situacao: 'proposta' },
    });
    expect(previa.json()).toMatchObject({ situacaoAtual: 'recusada', exigeMotivo: true, perdem: 0 });
    for (const situacao of ['proposta', 'aprovada']) {
      const sem = await decidir(situacao);
      expect(sem.statusCode).toBe(400);
      expect(sem.json().codigo).toBe('motivo-obrigatorio');
    }
    const linha = () =>
      estadoAcessoSintetico().mapa.find((m) => m.grupo === 'ATENDIMENTO' && m.perfil === 'ouvidoria');
    expect(linha()).toMatchObject({ situacao: 'recusada' });
    // Repetir a mesma situação não muda nada e dispensa o motivo; com motivo, a recusa volta a proposta.
    expect((await decidir('recusada')).statusCode).toBe(200);
    expect((await decidir('proposta', 'Revisão da área: reavaliar')).statusCode).toBe(200);
    expect(linha()).toMatchObject({ situacao: 'proposta' });
  });

  it('perfil → permissão sem linha aprovada no banco: nada a perder, sem motivo', async () => {
    const gestor = await entrar('SINT.GESTOR');
    const r = await app.inject({
      method: 'POST',
      url: '/api/acesso/gestao/mapa/previa',
      headers: h(gestor),
      payload: {
        chave: {
          tipo: 'perfil-permissao',
          perfil: 'administrador-sistema',
          permissao: 'config.parametro.ler',
        },
        situacao: 'recusada',
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ situacaoAtual: null, exigeMotivo: false, perdem: 0 });
  });
});
