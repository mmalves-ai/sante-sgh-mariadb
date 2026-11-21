// M53.1 pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco): o
// departamento pessoal (SINT.DP.FOLHA) abre o apoio, lista os lotes e pede a geração (que devolve a conta ou as
// pendências, nunca o CPF); quem só consulta a folha (SINT.FOLHA.CONSULTA) abre o apoio sem as ações e é barrado (403) ao
// gerar, baixar, importar e registrar afastamento; quem não tem a folha não abre nada.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import {
  type ChaveLiberacao,
  fonteConfiguracaoMemoria,
  type PrerequisitoRecurso,
} from '../../config/public-api.js';
import { criarAppPessoas } from '../opcoes-teste.spec-util.js';
import { FolhaController } from './folha.controller.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const chave = (c: string): ChaveLiberacao => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'teste sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoRecurso => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});

let app: NestFastifyApplication;
const trilha = new RegistradorTrilhaMemoria();

beforeAll(async () => {
  const recursos = ['pessoas.colaborador', 'pessoas.folhaExterna'];
  app = await criarAppPessoas(env, {
    trilha,
    configuracao: fonteConfiguracaoMemoria(trilha, {
      chavesIniciais: () => recursos.map(chave),
      prerequisitosIniciais: () => recursos.map(cumprido),
    }),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 120_000);
afterAll(async () => {
  await app.close();
});

interface Sessao {
  cookie: string;
  csrf: string;
}
async function entrar(login: string): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
  return {
    cookie: set.map((c) => c.split(';')[0]).join('; '),
    csrf:
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '',
  };
}
let n = 0;
const pedir = (s: Sessao) => {
  const h = () => ({ cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `m53-1-teste-${++n}` });
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers: h() }),
    post: (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, payload: payload as object, headers: h() }),
  };
};
const P = '/api/pessoas/folha';

describe('interface com a folha externa pela HTTP', { timeout: 180_000 }, () => {
  it('o departamento pessoal gera; quem só consulta vê sem as ações; sem a folha, nada', async () => {
    const dp = pedir(await entrar('SINT.DP.FOLHA'));
    const apoio = await dp.get(`${P}/apoio`);
    expect(apoio.statusCode).toBe(200);
    expect(apoio.json().acoes).toMatchObject({ exportar: true, importar: true, afastamento: true });
    expect((await dp.get(`${P}/lotes`)).statusCode).toBe(200);
    expect((await dp.get(`${P}/lotes?competencia=2026-13`)).statusCode).toBe(400);
    const g = await dp.post(`${P}/lotes/exportacao`, { empresa: 1, competencia: '2026-09' });
    expect(g.statusCode).toBe(200);
    expect(typeof g.json().conta).toBe('string');
    expect((await dp.get(`${P}/afastamentos?competencia=2026-09`)).statusCode).toBe(200);
    expect((await dp.get(`${P}/afastamentos`)).statusCode).toBe(400);
    expect((await dp.get(`${P}/lotes/99999/arquivo`)).statusCode).toBe(404);

    const consulta = pedir(await entrar('SINT.FOLHA.CONSULTA'));
    const a2 = await consulta.get(`${P}/apoio`);
    expect(a2.statusCode).toBe(200);
    expect(a2.json().acoes).toMatchObject({ exportar: false, importar: false, afastamento: false });
    expect(
      (await consulta.post(`${P}/lotes/exportacao`, { empresa: 1, competencia: '2026-09' })).statusCode,
    ).toBe(403);
    expect((await consulta.get(`${P}/lotes/1/arquivo`)).statusCode).toBe(403);
    expect((await consulta.post(`${P}/lotes/1/retorno`, {})).statusCode).toBe(403);
    expect(
      (
        await consulta.post(`${P}/afastamentos`, {
          vinculo: 1,
          motivo: 1,
          inicio: '2026-09-01',
          fim: null,
        })
      ).statusCode,
    ).toBe(403);

    const outro = pedir(await entrar('SINT.RH'));
    expect((await outro.get(`${P}/apoio`)).statusCode).toBe(403);
  });

  it('o download do arquivo com CPF: a trilha diz qual lote saiu e é gravada antes; sem trilha, o arquivo não sai', async () => {
    // O lote (com CPF sintético) vem de um dublê do serviço: o que se prova aqui é a rota, a trilha e a ordem.
    const servico = app.get(FolhaController, { strict: false }).servico;
    const conteudo = '{"leiaute":"sintetico","cpf":"00000000191"}';
    const espiao = vi.spyOn(servico, 'arquivoLote').mockResolvedValue({
      nome: 'folha_aa_1_2026-09_lote42.json',
      conteudo,
      lote: { empresa: 1, competencia: '2026-09' } as never,
    });
    try {
      const dp = pedir(await entrar('SINT.DP.FOLHA'));
      const antes = trilha.eventos.length;
      const r = await dp.get(`${P}/lotes/42/arquivo`);
      expect(r.statusCode).toBe(200);
      expect(r.body).toBe(conteudo);
      expect(r.headers['content-disposition']).toContain('lote42.json');
      expect(r.headers['cache-control']).toBe('no-store');
      const ev = trilha.eventos.slice(antes).filter((e) => e.evento === 'pessoas.folha_lote.baixado');
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({
        tabelaAlvo: 'SGH_PES_FOLHA_INTERFACE',
        idAlvo: '42',
        chaveNaturalAlvo: 'empresa:1;competencia:2026-09',
        resultado: 'sucesso',
      });

      trilha.falhar = true;
      try {
        const sem = await dp.get(`${P}/lotes/42/arquivo`);
        expect(sem.statusCode).toBe(503);
        expect(sem.body).not.toContain('00000000191');
      } finally {
        trilha.falhar = false;
      }
    } finally {
      espiao.mockRestore();
    }
  });
});
