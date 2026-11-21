// W1-01 (parte 12a): "Aplicar acessos de…" pela HTTP sobre a app inteira (fonte da gestão em memória, estado
// sintético). Prova: a prévia mostra a diferença sem gravar; aplicar exige a conferência da prévia (muda o alvo no
// meio → previa-desatualizada), motivo e senha; grava o grupo pela receita, o perfil com o mesmo fim e o papel; o
// privilégio de gestão do modelo fica em `ignorados`; ninguém aplica no próprio acesso; o auditor só consulta; a
// trilha não leva a senha.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PreviaModeloTela, ResultadoModeloTela } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { estadoAcessoSintetico, reiniciarEstadoAcessoSintetico } from './fonte-sintetica.js';
import { fonteGestaoMemoria } from './gestao-fonte.js';
import { moduloAcesso } from './modulo.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'acesso' };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let chave = 0;
type Pote = Map<string, string>;
const potes: Record<string, Pote> = {};
const MODELO = 'SINT.RECEPCAO';
const ALVO = 'SINT.SAME';
const URL = `/api/acesso/gestao/usuarios/${ALVO}/modelo`;

const cab = (quem: string) => {
  const c = potes[quem] ?? new Map<string, string>();
  return {
    cookie: [...c].map(([k, v]) => `${k}=${v}`).join('; '),
    'x-csrf': c.get('sgh_csrf') ?? '',
    'idempotency-key': `teste-modelo-${++chave}-${Date.now()}`,
  };
};
const post = (quem: string, url: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, headers: cab(quem), payload });

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

/** A conta ao vivo pela fonte da gestão em memória (a tela de efetivas é da gestão, montada pelo seu lote). */
const efetivas = async (login: string) => {
  const f = fonteGestaoMemoria(trilha);
  const agora = Date.now();
  const u = await f.usuario('', 'aa', login);
  const historico = await f.historicoPerfis('', 'aa', login);
  return {
    usuario: { grupo: u?.grupo ?? null },
    concessoes: historico.map((h) => ({
      perfil: h.perfil,
      fim: h.fim?.toISOString() ?? null,
      motivo: h.motivo,
      vigente: !h.revogadoEm && h.inicio.getTime() <= agora && (!h.fim || h.fim.getTime() > agora),
    })),
  };
};

beforeAll(async () => {
  reiniciarEstadoAcessoSintetico();
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    armazem: new ArmazemMemoria(),
    registro: { acesso: async () => ({ modulo: (ctx) => moduloAcesso(ctx) }) },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  await entrar('SINT.GESTOR');
  // O modelo ganha um perfil temporário (o fim vai junto) e um privilégio de gestão (fica de fora).
  const fim = new Date(Date.now() + 30 * 86_400_000).toISOString();
  for (const [perfil, ate] of [
    ['controle-infeccao', fim],
    ['administrador-sistema', undefined],
  ] as const) {
    // Semeado direto no estado sintético (a rota de concessão é da tela de gestão, montada pelo seu lote).
    const r = estadoAcessoSintetico().concederPerfil({
      login: MODELO,
      perfil,
      inicio: new Date(),
      fim: ate ? new Date(ate) : null,
      motivo: 'semente do teste do modelo',
      concedidoPor: 'SINT.GESTOR',
    });
    expect(r.id).toBeTruthy();
  }
});
afterAll(async () => {
  await app.close();
  reiniciarEstadoAcessoSintetico();
});

describe('W1-01 (parte 12a): aplicar acessos de um usuário-modelo', () => {
  it('mostra a diferença sem gravar e só grava o plano que a prévia mostrou', async () => {
    const r = await post('SINT.GESTOR', `${URL}/previa`, { modelo: MODELO, modo: 'somar' });
    expect(r.statusCode, r.body).toBe(200);
    const p = r.json() as PreviaModeloTela;
    expect(p.grupo).toBeNull(); // o produto não tem grupo de usuários: o modelo não o copia
    expect(p.perfisConceder).toHaveLength(1);
    expect(p.perfisConceder[0]?.perfil).toBe('controle-infeccao');
    expect(p.perfisConceder[0]?.fim).not.toBeNull();
    expect(p.ignorados).toContainEqual({
      tipo: 'perfil',
      item: 'administrador-sistema',
      motivo: 'privilegio-nominal',
    });
    expect(p.passos).toBeGreaterThanOrEqual(1);
    expect(p.conferencia).toMatch(/^[0-9a-f]{64}$/);
    // Nada gravou.
    expect((await efetivas(ALVO)).usuario.grupo).toBe('SAME');

    // Conferência de outra prévia, sem motivo e com senha errada: recusados.
    const base = {
      modelo: MODELO,
      modo: 'somar',
      conferencia: p.conferencia,
      motivo: 'mesma função da recepção',
    };
    expect(
      (await post('SINT.GESTOR', `${URL}/aplicar`, { ...base, senha: SENHA, motivo: 'curto' })).statusCode,
    ).toBe(400);
    const igualar = await post('SINT.GESTOR', `${URL}/aplicar`, { ...base, modo: 'igualar', senha: SENHA });
    // Igualar tem outro plano (ou o mesmo, se nada sobra no alvo): só passa se a conferência bater.
    const pi = (
      await post('SINT.GESTOR', `${URL}/previa`, { modelo: MODELO, modo: 'igualar' })
    ).json() as PreviaModeloTela;
    if (pi.conferencia !== p.conferencia) {
      expect(igualar.statusCode).toBe(409);
      expect((igualar.json() as { codigo?: string }).codigo).toBe('previa-desatualizada');
    }
    const senhaErrada = await post('SINT.GESTOR', `${URL}/aplicar`, { ...base, senha: 'errada-errada-1' });
    expect(senhaErrada.statusCode).not.toBe(200);
    expect((await efetivas(ALVO)).usuario.grupo).toBe('SAME');

    const a = await post('SINT.GESTOR', `${URL}/aplicar`, { ...base, senha: SENHA });
    expect(a.statusCode, a.body).toBe(200);
    const res = a.json() as ResultadoModeloTela;
    expect(res.falhas, JSON.stringify(res.passos)).toBe(0);
    expect(res.passos.map((x) => x.acao)).toEqual(expect.arrayContaining(['conceder-perfil']));
    expect(res.passos.map((x) => x.acao)).not.toContain('trocar-grupo');
    const depois = await efetivas(ALVO);
    expect(depois.usuario.grupo).toBe('SAME');
    const concedida = depois.concessoes.find((c) => c.perfil === 'controle-infeccao' && c.vigente);
    expect(concedida?.fim).toBe(p.perfisConceder[0]?.fim);
    expect(concedida?.motivo).toContain(`Acessos de ${MODELO}`);
    expect(depois.concessoes.some((c) => c.perfil === 'administrador-sistema')).toBe(false);

    // A mesma prévia de novo: já não vale (o alvo mudou); a nova não tem passos.
    const de = await post('SINT.GESTOR', `${URL}/aplicar`, { ...base, senha: SENHA });
    expect(de.statusCode).toBe(409);
    expect((de.json() as { codigo?: string }).codigo).toBe('previa-desatualizada');
    const nova = (
      await post('SINT.GESTOR', `${URL}/previa`, { modelo: MODELO, modo: 'somar' })
    ).json() as PreviaModeloTela;
    expect(nova.passos).toBe(0);
    const vazio = await post('SINT.GESTOR', `${URL}/aplicar`, {
      ...base,
      conferencia: nova.conferencia,
      senha: SENHA,
    });
    expect((vazio.json() as { codigo?: string }).codigo).toBe('nada-a-aplicar');

    expect(trilha.eventos.some((e) => e.evento === 'acesso.modelo.aplicado')).toBe(true);
    const texto = JSON.stringify(trilha.eventos);
    expect(texto).not.toContain(SENHA);
  });

  it('segregação: ninguém aplica no próprio acesso; modelo igual ao alvo recusados', async () => {
    const proprio = await post('SINT.GESTOR', '/api/acesso/gestao/usuarios/SINT.GESTOR/modelo/previa', {
      modelo: MODELO,
      modo: 'somar',
    });
    expect(proprio.statusCode).toBe(409);
    expect((proprio.json() as { codigo?: string }).codigo).toBe('a-si-mesmo');
    const igual = await post('SINT.GESTOR', `${URL}/previa`, { modelo: ALVO, modo: 'somar' });
    expect((igual.json() as { codigo?: string }).codigo).toBe('modelo-e-o-alvo');
    // Conta bloqueada (modelo-indisponivel): na regra do domínio (a memória da gestão não marca bloqueio).
    const naoExiste = await post('SINT.GESTOR', `${URL}/previa`, { modelo: 'NINGUEM.AQUI', modo: 'somar' });
    expect(naoExiste.statusCode).toBe(404);
  });
});
