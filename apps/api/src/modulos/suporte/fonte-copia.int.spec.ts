// ACESSO_FONTE_DEV=copia (ADR 0021, item 6): em AMBIENTE=dev, o login dos usuários do SPDATA e a lista de
// alvos do "login como" usam o TBUSERS REAL da cópia, em READ ONLY, e NADA é gravado na cópia: contagens de
// TBUSERS, TBHISTSENHA, TBCABTRILHA, TBLANTRILHASGH, SGH_TRILHA e SGH_IDEMPOTENCIA iguais antes e depois de um
// login (falho, com login sintético inexistente) e da abertura de uma sessão "como" de um usuário real do
// primeiro grupo ativo. O banco da plataforma fica em memória (as contas sintéticas). Nenhum login, nome ou
// senha real é impresso: a saída só tem contagens. Rodar sob a trava: flock <travas>/copia.lock
// ./pnpm testes:integracao.
import { resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { cifrarSenha } from '@sgh/dominio-acesso';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  exigirTravaDaCopia,
  lerConfiguracaoNucleo,
  NucleoLegado,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import {
  CONTAS_PLATAFORMA_SINTETICAS as C,
  FonteComoLegado,
  RepositorioPlataformaMemoria,
  SENHA_PLATAFORMA_SINTETICA,
} from './repositorio.js';

const raiz = resolve(import.meta.dirname, '../../../../..');
const { env: base } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const env: Record<string, string> = {
  ...(base as Record<string, string>),
  AMBIENTE: 'dev',
  ACESSO_FONTE_DEV: 'copia',
  FB_POOL_TETO: '2',
};
delete env['SESSAO_SINTETICA'];
const TABELAS = ['TBUSERS', 'TBHISTSENHA', 'TBCABTRILHA', 'TBLANTRILHASGH', 'SGH_TRILHA', 'SGH_IDEMPOTENCIA'];

let nucleo: NucleoLegado;
let app: NestFastifyApplication;
let hospital = '';

async function contagens(): Promise<Record<string, number>> {
  const ctx = { rede: nucleo.rede, hospital, traceId: 'copia-login' };
  const r: Record<string, number> = {};
  for (const t of TABELAS) {
    const [l] = await nucleo.consultar(ctx, `SELECT COUNT(*) N FROM ${t}`, [], { tempoMaximoMs: 60_000 });
    r[t] = Number(l?.['N'] ?? -1);
  }
  return r;
}

beforeAll(async () => {
  exigirTravaDaCopia();
  nucleo = new NucleoLegado({
    env,
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
  });
  const saude = await nucleo.partida();
  hospital = saude.find((s) => s.disponivel)?.codigo ?? '';
  if (!hospital) throw new Error('Nenhum estabelecimento da cópia disponível.');
  const repo = RepositorioPlataformaMemoria.sintetico(nucleo.rede, [hospital], (s) =>
    cifrarSenha(s, { memoria: 8_192, passes: 1, paralelismo: 1 }),
  );
  app = await criarApp(lerConfiguracao(env), nucleo, env, {
    plataforma: repo,
    comoEstabelecimento: new FonteComoLegado(nucleo),
    trilha: new RegistradorTrilhaMemoria(),
    armazem: new ArmazemMemoria(),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app?.close();
  await nucleo?.encerrar();
});

describe('ACESSO_FONTE_DEV=copia: login e "como" sobre o TBUSERS real, sem gravar na cópia', () => {
  it('login falho e sessão "como" de um usuário real: nenhuma contagem muda', async () => {
    const antes = await contagens();
    const falho = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: hospital, login: 'SINT.SGH.NAO.EXISTE', senha: 'Sintetica#Errada2026' },
    });
    expect(falho.statusCode).toBe(401);

    const p = await app.inject({
      method: 'POST',
      url: '/api/plataforma/sessao',
      payload: { email: C.plataforma, senha: SENHA_PLATAFORMA_SINTETICA },
    });
    expect(p.statusCode).toBe(200);
    const set = p.headers['set-cookie'] as string[];
    const cookies = new Map(set.map((c) => c.split(';')[0]!.split('=') as [string, string]));
    const h = () => ({
      cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      'x-csrf-plataforma': cookies.get('sgh_pcsrf') ?? '',
    });
    const grupos = (
      await app.inject({
        method: 'GET',
        url: `/api/plataforma/como/grupos?estabelecimento=${hospital}`,
        headers: h(),
      })
    ).json() as { grupo: string; usuarios: number }[];
    const grupo = grupos.find((g) => g.usuarios > 0);
    expect(grupo).toBeDefined();
    const usuarios = (
      await app.inject({
        method: 'GET',
        url: `/api/plataforma/como/usuarios?${new URLSearchParams({ estabelecimento: hospital, grupo: grupo!.grupo }).toString()}`,
        headers: h(),
      })
    ).json() as { login: string }[];
    expect(usuarios.length).toBeGreaterThan(0);
    const como = await app.inject({
      method: 'POST',
      url: '/api/plataforma/como',
      headers: h(),
      payload: { estabelecimento: hospital, login: usuarios[0]!.login },
    });
    expect(como.statusCode).toBe(201);
    for (const c of como.headers['set-cookie'] as string[]) {
      const [k, v] = c.split(';')[0]!.split('=') as [string, string];
      cookies.set(k, v);
    }
    const sessao = await app.inject({ method: 'GET', url: '/api/sessao', headers: h() });
    expect(sessao.statusCode).toBe(200);
    expect(sessao.json().como.ator.tipo).toBe('plataforma');
    expect(sessao.json().sintetica).toBe(false);

    const depois = await contagens();
    expect(depois).toEqual(antes);
    console.log(
      `[copia] contagens iguais antes e depois (${TABELAS.length} tabelas); grupos ativos: ${grupos.length}`,
    );
  });
});
