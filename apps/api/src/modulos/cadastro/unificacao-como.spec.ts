// Correção do M57.2 (ADR 0021) pela HTTP, sobre a fonte SINTÉTICA, o banco da plataforma EM MEMÓRIA e a porta do
// cadastro EM MEMÓRIA: numa sessão "como", a unificação de prontuários é recusada (falha fechada, 403
// `como-sem-correcao`): a fusão de prontuários é decisão do gestor de cadastro do hospital, com a senha dele na própria
// conta, e o operador do suporte não é esse responsável (F3.1). A fila mostra o botão desabilitado com o motivo. Dados
// sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { cifrarSenha } from '@sgh/dominio-acesso';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import { envTeste, REDE, SENHA } from '../../sessao/teste.spec-util.js';
import {
  CONTAS_PLATAFORMA_SINTETICAS as C,
  RepositorioPlataformaMemoria,
  SENHA_PLATAFORMA_SINTETICA,
} from '../suporte/repositorio.js';
import { REGISTRO_MODULOS } from '../registro.js';
import { PortaCadastroMemoria } from './porta-memoria.js';
import { moduloConfiguracaoDeTeste, registroDeTeste } from './teste.spec-util.js';

/** A sessão "como" é do módulo suporte: o teste roda quando ele estiver migrado e registrado (F2.2). */
const SUPORTE = REGISTRO_MODULOS['suporte'];

const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  SUPORTE_SESSAO_MINUTOS: '60',
  API_MODULOS: 'configuracao_teste,cadastro,suporte',
};
const trilha = new RegistradorTrilhaMemoria();
const porta = new PortaCadastroMemoria();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  if (!SUPORTE) return;
  const repo = RepositorioPlataformaMemoria.sintetico(REDE, ['aa', 'bb'], (s) =>
    cifrarSenha(s, { memoria: 8_192, passes: 1, paralelismo: 1 }),
  );
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    armazem: new ArmazemMemoria(),
    // O repositório sintético da plataforma é do módulo suporte (o tipo da fonte é dele).
    plataforma: repo as never,
    registro: {
      ...registroDeTeste(
        { cadastro: porta },
        { configuracao_teste: (ctx) => moduloConfiguracaoDeTeste(ctx) },
      ),
      suporte: SUPORTE,
    },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app?.close();
});

type Navegador = Map<string, string>;
function guardar(n: Navegador, set: string | string[] | undefined): void {
  for (const c of Array.isArray(set) ? set : set ? [set] : []) {
    const [par] = c.split(';');
    const i = par?.indexOf('=') ?? -1;
    if (!par || i < 0) continue;
    const nome = par.slice(0, i);
    const valor = par.slice(i + 1);
    if (/Max-Age=0/.test(c) || valor === '') n.delete(nome);
    else n.set(nome, valor);
  }
}
const cookie = (n: Navegador) => [...n].map(([k, v]) => `${k}=${v}`).join('; ');
const h = (n: Navegador) => ({
  cookie: cookie(n),
  'x-csrf': n.get('sgh_csrf') ?? '',
  'idempotency-key': `teste-m57-2-como-${++chave}-${Date.now()}`,
});

async function entrarComo(login: string): Promise<Navegador> {
  const n: Navegador = new Map();
  const p = await app.inject({
    method: 'POST',
    url: '/api/plataforma/sessao',
    payload: { email: C.plataforma, senha: SENHA_PLATAFORMA_SINTETICA },
  });
  expect(p.statusCode).toBe(200);
  guardar(n, p.headers['set-cookie']);
  const r = await app.inject({
    method: 'POST',
    url: '/api/plataforma/como',
    headers: { cookie: cookie(n), 'x-csrf-plataforma': n.get('sgh_pcsrf') ?? '' },
    payload: { estabelecimento: 'aa', login, motivo: 'CHAMADO-M57-2' },
  });
  expect(r.statusCode).toBe(201);
  guardar(n, r.headers['set-cookie']);
  return n;
}

async function entrarDireto(login: string): Promise<Navegador> {
  const n: Navegador = new Map();
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  guardar(n, r.headers['set-cookie']);
  return n;
}

describe.skipIf(!SUPORTE)('unificação numa sessão "como" (correção do M57.2, ADR 0021)', () => {
  it('a fila mostra a unificação indisponível com o motivo; o POST responde 403 como-sem-correcao, nada gravado', async () => {
    const direto = await entrarDireto('SINT.SAME');
    const at = await app.inject({
      method: 'POST',
      url: '/api/cadastros/pacientes/duplicidades/atualizar',
      headers: h(direto),
    });
    expect(at.statusCode).toBe(200);
    // Fora do "como", liberada (só a permissão do cargo: sem chave de liberação, F3.1).
    const filaDireta = await app.inject({
      method: 'GET',
      url: '/api/cadastros/pacientes/duplicidades',
      headers: { cookie: cookie(direto) },
    });
    expect(filaDireta.json().unificacao.disponivel).toBe(true);

    const n = await entrarComo('SINT.SAME');
    const fila = await app.inject({
      method: 'GET',
      url: '/api/cadastros/pacientes/duplicidades',
      headers: { cookie: cookie(n) },
    });
    expect(fila.statusCode).toBe(200);
    const f = fila.json();
    expect(f.unificacao.disponivel).toBe(false);
    expect(f.unificacao.motivo).toMatch(/sessão de suporte.*gestor de cadastro do hospital/);
    const par = f.itens[0] as { id: number };
    expect(par).toBeDefined();
    const antes = trilha.eventos.filter((e) => e.evento === 'cadastro.paciente.unificado').length;
    const r = await app.inject({
      method: 'POST',
      url: `/api/cadastros/pacientes/duplicidades/${par.id}/unificar`,
      headers: h(n),
      payload: { fica: 'a', justificativa: 'Mesmo CPF e mesma mãe', senha: SENHA },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('como-sem-correcao');
    expect(r.json().detail ?? r.json().detalhe).toMatch(/gestor de cadastro/);
    expect(trilha.eventos.filter((e) => e.evento === 'cadastro.paciente.unificado').length).toBe(antes);
    // O par continua aberto na fila.
    const depois = await app.inject({
      method: 'GET',
      url: '/api/cadastros/pacientes/duplicidades',
      headers: { cookie: cookie(direto) },
    });
    expect(depois.json().itens.some((x: { id: number }) => x.id === par.id)).toBe(true);
  });
});
