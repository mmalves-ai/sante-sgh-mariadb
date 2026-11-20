// W1-01 (parte 10b): API do pedido de acesso sobre a app inteira (fonte da gestão em memória, estado sintético):
// a pessoa pede (recusas do domínio), o 1º nível e o 2º nível são de gestores de acessos diferentes (D-W101-34),
// ninguém decide o próprio pedido, recusar exige motivo, cancelar só o próprio e com senha; aprovado o 2º nível, o
// perfil é concedido com início e fim e, com o relógio simulado depois do fim, sai dos vigentes sozinho; trilha
// com o motivo e sem a senha.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ErroOperacao } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { estadoAcessoSintetico, reiniciarEstadoAcessoSintetico } from './fonte-sintetica.js';
import {
  inicioDoDia,
  PedidosAcessoController,
  PedidosAcessoGestaoController,
} from './pedido-acesso.controller.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let chave = 0;
type Pote = Map<string, string>;
const potes: Record<string, Pote> = {};

const dia = (deslocamento: number, base = Date.now()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(base + deslocamento * 86_400_000),
  );
const cab = (quem: string) => {
  const c = potes[quem] ?? new Map<string, string>();
  return {
    cookie: [...c].map(([k, v]) => `${k}=${v}`).join('; '),
    'x-csrf': c.get('sgh_csrf') ?? '',
    'idempotency-key': `teste-pedido-${++chave}-${Date.now()}`,
  };
};
const post = (quem: string, url: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, headers: cab(quem), payload });
const get = async <T>(quem: string, url: string) =>
  (await app.inject({ method: 'GET', url, headers: cab(quem) })).json() as T;

async function entrar(login: string): Promise<void> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    headers: { host: 'localhost' },
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode, login).toBe(201);
  const pote: Pote = new Map();
  const set = r.headers['set-cookie'];
  for (const c of Array.isArray(set) ? set : set ? [set] : []) {
    const [par] = c.split(';');
    const i = par?.indexOf('=') ?? -1;
    if (par && i > 0) pote.set(par.slice(0, i), par.slice(i + 1));
  }
  potes[login] = pote;
}

beforeAll(async () => {
  reiniciarEstadoAcessoSintetico();
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, armazem: new ArmazemMemoria() });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  for (const l of ['SINT.USUARIO', 'SINT.GESTOR', 'SINT.VINCULOS']) await entrar(l);
});
afterAll(async () => {
  await app.close();
  reiniciarEstadoAcessoSintetico();
});

interface Pedido {
  id: string;
  login: string;
  perfil: string;
  situacao: string;
  nivel: string | null;
  setorPor: string | null;
  acessosPor: string | null;
  motivoFechamento: string | null;
  concessao: string | null;
}
interface Meus {
  hoje: string;
  periodoMaximoDias: number;
  perfis: string[];
  pedidos: Pedido[];
}

const MEUS = '/api/acesso/pedidos';
const GESTAO = '/api/acesso/gestao/pedidos';
const PERFIL = 'auditor';

describe('API do pedido de acesso (W1-01 parte 10b)', () => {
  it('pede, aprova em dois níveis por pessoas diferentes, concede com fim e o perfil expira sozinho', async () => {
    const m0 = await get<Meus>('SINT.USUARIO', MEUS);
    expect(m0).toMatchObject({ hoje: dia(0), periodoMaximoDias: 365, pedidos: [] });
    expect(m0.perfis).toContain(PERFIL);
    expect(m0.perfis).not.toContain('assistencial-com-conselho');

    // Recusas do domínio.
    const base = {
      perfil: PERFIL,
      setor: 'UTI',
      inicio: dia(0),
      fim: dia(2),
      motivo: 'cobrir a auditoria do mês',
    };
    const ontem = await post('SINT.USUARIO', MEUS, { ...base, inicio: dia(-1) });
    expect(ontem.statusCode).toBe(409);
    expect(ontem.json()).toMatchObject({ codigo: 'periodo-invalido' });
    const longo = await post('SINT.USUARIO', MEUS, { ...base, fim: dia(400) });
    expect(longo.json()).toMatchObject({ codigo: 'periodo-invalido' });
    const desconhecido = await post('SINT.USUARIO', MEUS, { ...base, perfil: 'perfil-que-nao-existe' });
    expect(desconhecido.json()).toMatchObject({ codigo: 'perfil-desconhecido' });
    const conselho = await post('SINT.USUARIO', MEUS, { ...base, perfil: 'assistencial-com-conselho' });
    expect(conselho.json()).toMatchObject({ codigo: 'perfil-desconhecido' });
    const curto = await post('SINT.USUARIO', MEUS, { ...base, motivo: 'curto' });
    expect(curto.statusCode).toBe(400);

    const criado = await post('SINT.USUARIO', MEUS, base);
    expect(criado.statusCode).toBe(201);
    const { id } = criado.json() as { id: string };
    const repetido = await post('SINT.USUARIO', MEUS, base);
    expect(repetido.json()).toMatchObject({ codigo: 'pedido-repetido' });

    // A lista da gestão: em andamento primeiro, 1º nível do gestor de acessos (sem gestor de setor).
    const g0 = await get<{
      pedidos: Pedido[];
      setorSemGestor: boolean;
      setores: { valor: string; rotulo: string }[];
    }>('SINT.GESTOR', GESTAO);
    expect(g0.setorSemGestor).toBe(true);
    // Parte 10c: os setores (blocos da estrutura) vêm para o combo com busca, na gestão e para quem pede.
    expect(g0.setores).toEqual(
      expect.arrayContaining([{ valor: 'UTI-1', rotulo: 'UTI adulto (sintético)' }]),
    );
    const ms = await get<{ setores: { valor: string; rotulo: string }[] }>('SINT.USUARIO', MEUS);
    expect(ms.setores.map((x) => x.valor)).toEqual(expect.arrayContaining(['INT-1', 'UTI-1']));
    expect(g0.pedidos[0]).toMatchObject({ id, situacao: 'pendente', nivel: 'setor', login: 'SINT.USUARIO' });

    // O solicitante não chega à gestão; senha errada não grava; recusar sem motivo é recusado.
    const proprio = await post('SINT.USUARIO', `${GESTAO}/${id}/decisao`, {
      decisao: 'aprovar',
      motivo: '',
      senha: SENHA,
    });
    expect(proprio.statusCode).toBe(403);
    const errada = await post('SINT.GESTOR', `${GESTAO}/${id}/decisao`, {
      decisao: 'aprovar',
      motivo: '',
      senha: 'senha-errada-123',
    });
    expect(errada.statusCode).toBeGreaterThanOrEqual(400);
    const semMotivo = await post('SINT.GESTOR', `${GESTAO}/${id}/decisao`, {
      decisao: 'recusar',
      motivo: 'não',
      senha: SENHA,
    });
    expect(semMotivo.json()).toMatchObject({ codigo: 'motivo-curto' });

    const n1 = await post('SINT.GESTOR', `${GESTAO}/${id}/decisao`, {
      decisao: 'aprovar',
      motivo: '',
      senha: SENHA,
    });
    expect(n1.statusCode).toBe(200);
    expect(n1.json()).toMatchObject({ id, situacao: 'aprovado-setor', concessao: null, destino: 'memoria' });

    // O mesmo aprovador não faz o 2º nível.
    const mesmo = await post('SINT.GESTOR', `${GESTAO}/${id}/decisao`, {
      decisao: 'aprovar',
      motivo: '',
      senha: SENHA,
    });
    expect(mesmo.json()).toMatchObject({ codigo: 'mesmo-aprovador' });

    const n2 = await post('SINT.VINCULOS', `${GESTAO}/${id}/decisao`, {
      decisao: 'aprovar',
      motivo: 'de acordo',
      senha: SENHA,
    });
    expect(n2.statusCode, n2.body).toBe(200);
    const d2 = n2.json() as { situacao: string; concessao: string };
    expect(d2.situacao).toBe('concedido');
    expect(d2.concessao).toBeTruthy();

    // A concessão: início hoje, fim = 00:00 do dia seguinte ao último dia pedido, quem aprovou o 2º nível, setor.
    const c = estadoAcessoSintetico().concessoes.find((x) => x.id === d2.concessao);
    expect(c).toMatchObject({ login: 'SINT.USUARIO', perfil: PERFIL, concedidoPor: 'SINT.VINCULOS' });
    expect(c?.fim?.toISOString()).toBe(inicioDoDia(dia(3)).toISOString());
    expect(c?.motivo).toContain(`Pedido de acesso ${id}`);

    const m1 = await get<Meus>('SINT.USUARIO', MEUS);
    expect(m1.pedidos[0]).toMatchObject({
      id,
      situacao: 'concedido',
      nivel: null,
      setorPor: 'SINT.GESTOR',
      acessosPor: 'SINT.VINCULOS',
      concessao: d2.concessao,
    });
    expect(m1.perfis).not.toContain(PERFIL); // vigente: não se pede de novo
    const deNovo = await post('SINT.USUARIO', MEUS, base);
    expect(deNovo.json()).toMatchObject({ codigo: 'perfil-ja-vigente' });

    // Relógio simulado depois do fim: o perfil saiu dos vigentes sozinho e pode ser pedido de novo.
    const meus = app.get(PedidosAcessoController);
    const real = meus.agora;
    meus.agora = () => inicioDoDia(dia(3)).getTime() + 60_000;
    try {
      const m2 = await get<Meus>('SINT.USUARIO', MEUS);
      expect(m2.perfis).toContain(PERFIL);
    } finally {
      meus.agora = real;
    }

    // Trilha: criado, decidido (2x), concedido e o perfilConcedido; nada de senha.
    const eventos = trilha.eventos.map((l) => l.evento);
    expect(eventos).toEqual(
      expect.arrayContaining([
        'acesso.pedido.criado',
        'acesso.pedido.decidido',
        'acesso.pedido.concedido',
        'acesso.perfil.concedido',
      ]),
    );
    expect(JSON.stringify(trilha.eventos)).not.toContain(SENHA);
  });

  it('recusa com motivo, cancela só o próprio e com senha, e não aprova o período vencido', async () => {
    const base = {
      perfil: 'ouvidoria',
      setor: 'UTI',
      inicio: dia(0),
      fim: dia(0),
      motivo: 'atender a ouvidoria hoje',
    };
    const a = (await post('SINT.USUARIO', MEUS, base)).json() as { id: string };
    const rec = await post('SINT.GESTOR', `${GESTAO}/${a.id}/decisao`, {
      decisao: 'recusar',
      motivo: 'sem necessidade no setor',
      senha: SENHA,
    });
    expect(rec.json()).toMatchObject({ situacao: 'recusado' });
    const fechado = await post('SINT.VINCULOS', `${GESTAO}/${a.id}/decisao`, {
      decisao: 'aprovar',
      motivo: '',
      senha: SENHA,
    });
    expect(fechado.json()).toMatchObject({ codigo: 'pedido-fechado' });

    const b = (await post('SINT.USUARIO', MEUS, base)).json() as { id: string };
    // Outro usuário não cancela (nem vê) o pedido alheio.
    const alheio = await post('SINT.GESTOR', `${MEUS}/${b.id}/cancelar`, {
      motivo: 'não preciso mais disso',
      senha: SENHA,
    });
    expect(alheio.statusCode).toBe(404);
    const semSenha = await post('SINT.USUARIO', `${MEUS}/${b.id}/cancelar`, {
      motivo: 'não preciso mais disso',
      senha: 'senha-errada-123',
    });
    expect(semSenha.statusCode).toBeGreaterThanOrEqual(400);
    const ok = await post('SINT.USUARIO', `${MEUS}/${b.id}/cancelar`, {
      motivo: 'não preciso mais disso',
      senha: SENHA,
    });
    expect(ok.json()).toMatchObject({ situacao: 'cancelado' });
    const deNovo = await post('SINT.USUARIO', `${MEUS}/${b.id}/cancelar`, {
      motivo: 'não preciso mais disso',
      senha: SENHA,
    });
    expect(deNovo.json()).toMatchObject({ codigo: 'pedido-fechado' });

    // Período vencido no 2º nível: o relógio da gestão passa do último dia pedido.
    const c = (await post('SINT.USUARIO', MEUS, base)).json() as { id: string };
    await post('SINT.GESTOR', `${GESTAO}/${c.id}/decisao`, { decisao: 'aprovar', motivo: '', senha: SENHA });
    const gestao = app.get(PedidosAcessoGestaoController);
    const real = gestao.agora;
    gestao.agora = () => Date.now() + 2 * 86_400_000;
    try {
      const venc = await post('SINT.VINCULOS', `${GESTAO}/${c.id}/decisao`, {
        decisao: 'aprovar',
        motivo: '',
        senha: SENHA,
      });
      expect(venc.json()).toMatchObject({ codigo: 'periodo-vencido' });
    } finally {
      gestao.agora = real;
    }
    const inexistente = await post('SINT.GESTOR', `${GESTAO}/999999/decisao`, {
      decisao: 'aprovar',
      motivo: '',
      senha: SENHA,
    });
    expect(inexistente.statusCode).toBe(404);
  });

  it('revisão (achado 2): 2º nível, concessão e anotação são uma só gravação; falha da concessão não deixa "aprovado"', async () => {
    const m0 = await get<Meus>('SINT.USUARIO', MEUS);
    const perfil = m0.perfis.find((x) => x !== PERFIL) ?? '';
    expect(perfil).not.toBe('');
    const criado = await post('SINT.USUARIO', MEUS, {
      perfil,
      setor: 'UTI',
      inicio: dia(0),
      fim: dia(1),
      motivo: 'cobrir o plantão do colega',
    });
    expect(criado.statusCode).toBe(201);
    const { id } = criado.json() as { id: string };
    const decidir = (login: string) =>
      post(login, `${GESTAO}/${id}/decisao`, { decisao: 'aprovar', motivo: 'de acordo', senha: SENHA });
    expect((await decidir('SINT.GESTOR')).json()).toMatchObject({ situacao: 'aprovado-setor' });

    // A concessão falha: nada fica gravado (sem 'aprovado' solto, sem concessão), e a decisão pode ser refeita.
    const est = estadoAcessoSintetico();
    const antes = est.concessoes.length;
    const original = est.concederPerfil.bind(est);
    est.concederPerfil = () => {
      throw new ErroOperacao(409, 'conflito', 'Operação recusada', 'conflito simulado na concessão');
    };
    try {
      const falhou = await decidir('SINT.VINCULOS');
      expect(falhou.statusCode).toBe(409);
      expect(falhou.json()).toMatchObject({ codigo: 'conflito' });
    } finally {
      est.concederPerfil = original;
    }
    expect(est.concessoes.length).toBe(antes);
    const meio = (await get<Meus>('SINT.USUARIO', MEUS)).pedidos.find((x) => x.id === id);
    expect(meio).toMatchObject({ situacao: 'aprovado-setor', acessosPor: null, concessao: null });

    const ok = await decidir('SINT.VINCULOS');
    expect(ok.statusCode, ok.body).toBe(200);
    const d = ok.json() as { situacao: string; concessao: string };
    expect(d.situacao).toBe('concedido');
    expect(est.concessoes.filter((x) => x.id === d.concessao)).toHaveLength(1);
    const fim = (await get<Meus>('SINT.USUARIO', MEUS)).pedidos.find((x) => x.id === id);
    expect(fim).toMatchObject({ situacao: 'concedido', concessao: d.concessao });
    // Concedido não se cancela (o acesso se revoga).
    const cancelar = await post('SINT.USUARIO', `${MEUS}/${id}/cancelar`, {
      motivo: 'não preciso mais do acesso',
      senha: SENHA,
    });
    expect(cancelar.json()).toMatchObject({ codigo: 'pedido-fechado' });
  });

  it('revisão (pedido preso): o pedido "aprovado" sem concessão recebe a concessão pela gestão, com senha, uma vez só', async () => {
    const m0 = await get<Meus>('SINT.USUARIO', MEUS);
    const perfil = m0.perfis.at(-1) ?? '';
    expect(perfil).not.toBe('');
    const criado = await post('SINT.USUARIO', MEUS, {
      perfil,
      setor: 'UTI',
      inicio: dia(0),
      fim: dia(3),
      motivo: 'apoio na escala do feriado',
    });
    expect(criado.statusCode, criado.body).toBe(201);
    const { id } = criado.json() as { id: string };
    const conceder = (login: string, senha = SENHA) => post(login, `${GESTAO}/${id}/conceder`, { senha });
    // Ainda pendente: nada a conceder.
    expect((await conceder('SINT.GESTOR')).json()).toMatchObject({ codigo: 'pedido-nao-aprovado' });
    const d1 = await post('SINT.GESTOR', `${GESTAO}/${id}/decisao`, {
      decisao: 'aprovar',
      motivo: 'de acordo',
      senha: SENHA,
    });
    expect(d1.json()).toMatchObject({ situacao: 'aprovado-setor' });
    // O estado preso: 2º nível gravado sem a concessão (pedido anterior à transação única).
    const est = estadoAcessoSintetico();
    est.pedidos.decidir(
      { hospital: 'aa', pedido: id, decisao: 'aprovar', motivo: '', por: 'SINT.VINCULOS' },
      () => null,
    );
    expect((await get<Meus>('SINT.USUARIO', MEUS)).pedidos.find((x) => x.id === id)).toMatchObject({
      situacao: 'aprovado',
      concessao: null,
    });
    const antes = est.concessoes.length;
    const semSenha = await post('SINT.GESTOR', `${GESTAO}/${id}/conceder`, {});
    expect(semSenha.statusCode).toBe(400);
    const senhaErrada = await conceder('SINT.GESTOR', 'Errada#2026');
    expect(senhaErrada.statusCode).toBe(401);
    expect(est.concessoes.length).toBe(antes);
    const ok = await conceder('SINT.GESTOR');
    expect(ok.statusCode, ok.body).toBe(200);
    const r = ok.json() as { situacao: string; concessao: string };
    expect(r.situacao).toBe('concedido');
    const c = est.concessoes.filter((x) => x.id === r.concessao);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ login: 'SINT.USUARIO', perfil });
    expect(c[0]?.fim?.getTime()).toBe(inicioDoDia(dia(4)).getTime());
    expect((await get<Meus>('SINT.USUARIO', MEUS)).pedidos.find((x) => x.id === id)).toMatchObject({
      situacao: 'concedido',
      concessao: r.concessao,
    });
    // Uma vez só: o pedido concedido não recebe outra concessão.
    expect((await conceder('SINT.GESTOR')).json()).toMatchObject({ codigo: 'pedido-nao-aprovado' });
    expect(est.concessoes.length).toBe(antes + 1);
    const n = (ev: string) => trilha.eventos.filter((e) => e.evento === ev).length;
    expect(n('acesso.pedido.concedido')).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(trilha.eventos)).not.toContain(SENHA);
    // O comum não concede (permissão do gestor).
    expect((await conceder('SINT.USUARIO')).statusCode).toBe(403);
  });
});
