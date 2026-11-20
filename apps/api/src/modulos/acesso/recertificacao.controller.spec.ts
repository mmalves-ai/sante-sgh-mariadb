// W1-01 (parte 9c2): API da recertificação de acessos sobre a app inteira (fonte da gestão em memória, estado
// sintético): abrir com prazo e motivo (recusas do domínio), decidir manter / retirar com bloqueio pelo executor ou
// revogação do perfil do retrato, decisão definitiva, ninguém decide a própria conta, relatório, encerrar uma vez só;
// senha conferida antes de gravar; trilha com o motivo e sem a senha.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
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
const cookies = new Map<string, string>();
const URL = '/api/acesso/gestao/recertificacoes';

const dia = (deslocamento: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(Date.now() + deslocamento * 86_400_000),
  );
const cab = () => ({
  cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
  'x-csrf': cookies.get('sgh_csrf') ?? '',
  'idempotency-key': `teste-recert-${++chave}-${Date.now()}`,
});
const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, headers: cab(), payload });
const get = async <T>(url: string) => (await app.inject({ method: 'GET', url, headers: cab() })).json() as T;

beforeAll(async () => {
  reiniciarEstadoAcessoSintetico();
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, armazem: new ArmazemMemoria() });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    headers: { host: 'localhost' },
    payload: { estabelecimento: 'aa', login: 'SINT.GESTOR', senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = r.headers['set-cookie'];
  for (const c of Array.isArray(set) ? set : set ? [set] : []) {
    const [par] = c.split(';');
    const i = par?.indexOf('=') ?? -1;
    if (par && i > 0) cookies.set(par.slice(0, i), par.slice(i + 1));
  }
});
afterAll(async () => {
  await app.close();
  reiniciarEstadoAcessoSintetico();
});

interface Relatorio {
  total: number;
  mantidas: number;
  bloqueadas: number;
  revogadas: number;
  pendentes: number;
  percentual: number;
}
interface Lista {
  hoje: string;
  prazoPadrao: string;
  prazoMaximoDias: number;
  campanhas: { id: string; situacao: string; relatorio: Relatorio }[];
  bloqueio: { ligada: boolean };
}
interface Detalhe {
  campanha: { id: string; situacao: string; motivoFechamento: string | null; relatorio: Relatorio };
  itens: {
    login: string;
    perfis: string[];
    decisao: string | null;
    acao: string | null;
    perfil: string | null;
  }[];
}

describe('API da recertificação de acessos (W1-01 parte 9c2)', () => {
  it('abre, decide manter / bloquear / revogar com efeito, recusa a própria conta e a repetição, encerra uma vez só', async () => {
    const est = estadoAcessoSintetico();
    const l0 = await get<Lista>(URL);
    expect(l0).toMatchObject({ hoje: dia(0), prazoPadrao: dia(30), prazoMaximoDias: 90, campanhas: [] });
    expect(l0.bloqueio.ligada).toBe(true);

    // Recusas do domínio, antes da senha.
    const base = {
      escopo: 'todos',
      alvo: null,
      prazo: dia(10),
      motivo: 'recertificação semestral',
      senha: SENHA,
    };
    const hoje = await post(URL, { ...base, prazo: dia(0) });
    expect(hoje.statusCode).toBe(409);
    expect(hoje.json()).toMatchObject({ codigo: 'prazo-invalido' });
    const longe = await post(URL, { ...base, prazo: dia(91) });
    expect(longe.json()).toMatchObject({ codigo: 'prazo-invalido' });
    const semGrupo = await post(URL, { ...base, escopo: 'grupo' });
    expect(semGrupo.json()).toMatchObject({ codigo: 'alvo-obrigatorio' });
    const vazio = await post(URL, { ...base, escopo: 'grupo', alvo: 'GRUPO-QUE-NAO-EXISTE' });
    expect(vazio.json()).toMatchObject({ codigo: 'escopo-vazio' });
    const errada = await post(URL, { ...base, senha: 'senha-errada-123' });
    expect(errada.statusCode).toBeGreaterThanOrEqual(400);
    expect((await get<Lista>(URL)).campanhas).toEqual([]);

    // Um perfil SGH_ vigente entra no retrato (para a revogação).
    const livres = [...est.contas.keys()]
      .filter((l) => l !== 'SINT.GESTOR' && !(est.bloqueio.get(l) ?? false))
      .sort();
    const alvoRevogar = livres.find((l) => l !== 'SINT.BLOQUEADO')!;
    est.concederPerfil({
      login: alvoRevogar,
      perfil: 'faturista',
      inicio: new Date(Date.now() - 86_400_000),
      fim: null,
      motivo: 'teste da recertificação',
      concedidoPor: 'SINT.AUDITOR',
    });

    const aberta = await post(URL, base);
    expect(aberta.statusCode).toBe(200);
    const { id, itens: n } = aberta.json() as { id: string; itens: number };
    expect(n).toBeGreaterThan(3);
    const d0 = await get<Detalhe>(`${URL}/${id}`);
    expect(d0.campanha.situacao).toBe('aberta');
    expect(d0.itens.find((i) => i.login === alvoRevogar)?.perfis).toContain('faturista');
    const outros = d0.itens.map((i) => i.login).filter((l) => l !== 'SINT.GESTOR' && l !== alvoRevogar);
    const [manter, bloquear] = outros;
    expect(manter && bloquear).toBeTruthy();

    const decidir = (login: string, x: Record<string, unknown>) =>
      post(`${URL}/${id}/decisoes`, { login, acao: null, perfil: null, motivo: '', senha: SENHA, ...x });

    // Ninguém decide a própria conta.
    const asi = await decidir('SINT.GESTOR', { decisao: 'manter' });
    expect(asi.statusCode).toBe(409);
    expect(asi.json()).toMatchObject({ codigo: 'decidir-a-si' });
    // Retirar sem motivo e revogar perfil fora do retrato: recusados.
    expect((await decidir(bloquear!, { decisao: 'retirar', acao: 'bloqueio' })).json()).toMatchObject({
      codigo: 'motivo-curto',
    });
    expect(
      (
        await decidir(bloquear!, {
          decisao: 'retirar',
          acao: 'revogacao',
          perfil: 'faturista',
          motivo: 'não usa mais o faturamento',
        })
      ).json(),
    ).toMatchObject({ codigo: 'perfil-ausente' });

    expect((await decidir(manter!, { decisao: 'manter' })).statusCode).toBe(200);
    const rep = await decidir(manter!, { decisao: 'manter' });
    expect(rep.json()).toMatchObject({ codigo: 'ja-decidido' });

    const b = await decidir(bloquear!, {
      decisao: 'retirar',
      acao: 'bloqueio',
      motivo: 'desligado do setor',
    });
    expect(b.statusCode).toBe(200);
    expect(b.json()).toMatchObject({ decisao: 'retirar', acao: 'bloqueio', destino: 'memoria' });
    expect(est.bloqueio.get(bloquear!)).toBe(true);

    const r = await decidir(alvoRevogar, {
      decisao: 'retirar',
      acao: 'revogacao',
      perfil: 'faturista',
      motivo: 'não usa mais o faturamento',
    });
    expect(r.statusCode).toBe(200);
    const conc = est.concessoes.find((c) => c.login === alvoRevogar && c.perfil === 'faturista');
    expect(conc?.revogadoEm).toBeTruthy();
    expect(conc?.revogadoMotivo).toContain(`Recertificação ${id}`);

    const d1 = await get<Detalhe>(`${URL}/${id}`);
    expect(d1.campanha.relatorio).toMatchObject({
      total: n,
      mantidas: 1,
      bloqueadas: 1,
      revogadas: 1,
      pendentes: n - 3,
    });
    expect(d1.itens.find((i) => i.login === alvoRevogar)).toMatchObject({
      decisao: 'retirar',
      acao: 'revogacao',
      perfil: 'faturista',
    });

    // Encerrar uma vez só; depois, nada se decide.
    const f = await post(`${URL}/${id}/fechar`, {
      situacao: 'encerrada',
      motivo: 'prazo do semestre cumprido',
      senha: SENHA,
    });
    expect(f.statusCode).toBe(200);
    expect(f.json()).toMatchObject({ situacao: 'encerrada', pendentes: n - 3 });
    const f2 = await post(`${URL}/${id}/fechar`, {
      situacao: 'cancelada',
      motivo: 'prazo do semestre cumprido',
      senha: SENHA,
    });
    expect(f2.json()).toMatchObject({ codigo: 'campanha-fechada' });
    const pend = d1.itens.find((i) => i.decisao === null && i.login !== 'SINT.GESTOR')!;
    expect((await decidir(pend.login, { decisao: 'manter' })).json()).toMatchObject({
      codigo: 'campanha-fechada',
    });
    const l1 = await get<Lista>(URL);
    expect(l1.campanhas).toHaveLength(1);
    expect(l1.campanhas[0]).toMatchObject({
      id,
      situacao: 'encerrada',
      relatorio: { percentual: Math.floor(300 / n) },
    });
    expect((await app.inject({ method: 'GET', url: `${URL}/999`, headers: cab() })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `${URL}/abc`, headers: cab() })).statusCode).toBe(404);

    // Trilha: os três eventos da recertificação e a revogação; nunca a senha.
    const eventos = trilha.eventos.map((x) => x.evento);
    for (const ev of [
      'acesso.recertificacao.aberta',
      'acesso.recertificacao.decidida',
      'acesso.recertificacao.fechada',
    ])
      expect(eventos).toContain(ev);
    expect(JSON.stringify(trilha.eventos)).not.toContain(SENHA);
  });
});
