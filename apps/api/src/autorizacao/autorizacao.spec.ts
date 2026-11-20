// M06: autorização no servidor com a sessão real (fonte sintética, sem banco): a guarda com as regras CASL,
// a matriz perfil × rota, a trilha dupla dos eventos de sessão (em memória), "sem trilha, sem dado" e o
// cache de 3 min das permissões (quem perde no legado perde no novo no prazo do cache). Só usuários
// sintéticos; nenhuma conexão real.
import { EVENTOS_AUDITAVEIS, esquemaSessao, tipoDoProblema } from '@sgh/contratos';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../app.js';
import { lerConfiguracao } from '../configuracao.js';
import { CONCESSOES_VAZIAS } from '../modulos/acesso/fonte-sintetica.js';
import { ArmazemMemoria } from '../sessao/armazem.js';
import { envTeste } from '../sessao/teste.spec-util.js';
import {
  CACHE_AUTORIZACAO_SEGUNDOS,
  ErroCatalogoDeOutroEstabelecimento,
  ServicoAutorizacao,
  type DadosAutorizacaoLegado,
} from './servico-autorizacao.js';
import { RegistradorTrilhaMemoria } from './trilha.js';

const env: Record<string, string> = { ...envTeste };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});

async function entrar(login: string): Promise<{ cookie: string; csrf: string }> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: 'Sintetico#2026' },
  });
  expect(r.statusCode, login).toBe(201);
  const bruto = r.headers['set-cookie'];
  const set = Array.isArray(bruto) ? bruto : [String(bruto)];
  return {
    cookie: set.map((c) => c.split(';')[0]).join('; '),
    csrf:
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice('sgh_csrf='.length) ?? '',
  };
}

describe('sessão real com as permissões do legado (regra 1)', () => {
  it('médico tem o PEP e a quebra de vidro; recepção, o cadastro e nada clínico', async () => {
    const m = await entrar('SINT.MEDICO');
    const sm = esquemaSessao.parse(
      (await app.inject({ method: 'GET', url: '/api/sessao', headers: { cookie: m.cookie } })).json(),
    );
    expect(sm.permissoes).toEqual(
      expect.arrayContaining([
        'pep.movimentacoesEvolucao.ler',
        'pep.movimentacoesLocalizarPaciente.selecionarPaciente',
        'acesso.emergencia.solicitar',
        'acesso.inicio.ler',
      ]),
    );
    expect(sm.perfil).toMatchObject({ tipo: 'perfil', perfil: 'medico', assistencial: true });
    const r = await entrar('SINT.RECEPCAO');
    const sr = esquemaSessao.parse(
      (await app.inject({ method: 'GET', url: '/api/sessao', headers: { cookie: r.cookie } })).json(),
    );
    expect(sr.permissoes).toEqual(
      expect.arrayContaining([
        'recepcao.cadastrosAtendimentosCadastroDePacientes.criar',
        'recepcao.internacoesManutencaoCadastroDePacientes.criar',
      ]),
    );
    expect(sr.permissoes.some((p) => p.startsWith('pep.'))).toBe(false);
    expect(sr.permissoes).not.toContain('acesso.emergencia.solicitar');
    expect(sr.escopos?.unidades).toEqual([]);
  });

  it('matriz perfil × rota: a guarda recusa sem permissão (403) e sem sessão (401)', async () => {
    const perfis = {
      'SINT.GESTOR': { '/api/acesso/grupos': true, '/api/config/gravacao': false },
      'SINT.RECEPCAO': { '/api/acesso/grupos': false, '/api/config/gravacao': false },
      'SINT.AUDITOR': { '/api/acesso/grupos': false, '/api/config/conexoes': false },
      'SINT.MEDICO': { '/api/acesso/mapa': false, '/api/config/assinaturas': false },
    } as const;
    for (const [login, rotas] of Object.entries(perfis)) {
      const s = await entrar(login);
      for (const [url, permite] of Object.entries(rotas)) {
        const r = await app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
        // Sem núcleo neste teste: com a permissão, a guarda passa e o handler responde 503.
        expect(r.statusCode, `${login} ${url}`).toBe(permite ? 503 : 403);
      }
    }
    // Cookie de sessão que não vale nunca cai na sintética: 401.
    const r = await app.inject({
      method: 'GET',
      url: '/api/acesso/grupos',
      headers: { cookie: 'sgh_sessao=x' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('tentativa negada vai à SGH_TRILHA como falha; correlação que não é código não entra na trilha', async () => {
    const s = await entrar('SINT.RECEPCAO');
    trilha.eventos.length = 0;
    const r = await app.inject({
      method: 'GET',
      url: '/api/acesso/grupos',
      headers: { cookie: s.cookie, 'x-correlacao': 'Fulana de Tal, CPF 000' },
    });
    expect(r.statusCode).toBe(403);
    expect(trilha.eventos.map((e) => [e.evento, e.resultado, e.legado, e.recurso, e.correlacao])).toEqual([
      [EVENTOS_AUDITAVEIS.permissaoNegada.codigo, 'falha', false, 'acesso.grupo.ler', 'negada'],
    ]);
  });

  it('com a sessão real, método que muda estado exige o CSRF por token duplo na guarda', async () => {
    const s = await entrar('SINT.USUARIO');
    const pedir = (h: Record<string, string>) =>
      app.inject({ method: 'POST', url: '/api/sessao/senha', headers: { cookie: s.cookie, ...h } });
    const csrf = /CSRF/;
    for (const h of [{}, { 'x-csrf': 'outro' }]) {
      const r = await pedir(h);
      expect(r.statusCode).toBe(403);
      expect(String(r.json().title)).toMatch(csrf);
    }
    // Com o token, passa a guarda (o handler pede a reautenticação recente).
    const com = await pedir({ 'x-csrf': s.csrf });
    expect(com.statusCode).not.toBe(403);
  });

  it('trilha dupla dos eventos de sessão: login, falha e fim (em memória com a fonte sintética)', async () => {
    trilha.eventos.length = 0;
    const s = await entrar('SINT.USUARIO');
    await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login: 'SINT.USUARIO', senha: 'Senha#Errada1' },
    });
    await app.inject({
      method: 'DELETE',
      url: '/api/sessao',
      headers: { cookie: s.cookie, 'x-csrf': s.csrf },
    });
    const codigos = trilha.eventos.map((e) => [e.evento, e.resultado, e.legado]);
    expect(codigos).toEqual([
      [EVENTOS_AUDITAVEIS.loginOk.codigo, 'sucesso', true],
      [EVENTOS_AUDITAVEIS.loginFalho.codigo, 'falha', true],
      [EVENTOS_AUDITAVEIS.fimSessao.codigo, 'sucesso', true],
    ]);
    expect(trilha.eventos.every((e) => /^SGH-WEB:/.test(e.estacao) && e.hospital === 'aa')).toBe(true);
    expect(JSON.stringify(trilha.eventos)).not.toMatch(/Sintetico#2026|Senha#Errada1/);
  });

  it('sem trilha, sem sessão: com a trilha fora, o login responde 503 e não abre sessão', async () => {
    trilha.falhar = true;
    try {
      const r = await app.inject({
        method: 'POST',
        url: '/api/sessao',
        payload: { estabelecimento: 'aa', login: 'SINT.USUARIO', senha: 'Sintetico#2026' },
      });
      expect(r.statusCode).toBe(503);
      expect(tipoDoProblema(r.json())).toBe('trilha-indisponivel');
      expect(r.headers['set-cookie']).toBeUndefined();
    } finally {
      trilha.falhar = false;
    }
  });
});

describe('cache das permissões (3 min, seção 4)', () => {
  it('quem perde a opção no legado perde a permissão no novo depois do prazo do cache', async () => {
    let t = 1_000_000;
    let opcoes = [5181];
    let leituras = 0;
    const fonte = {
      dadosDeAutorizacao: (): Promise<DadosAutorizacaoLegado> => {
        leituras++;
        return Promise.resolve({
          concessoes: { ...CONCESSOES_VAZIAS, grupo: 'MEDICOS', opcoesGrupo: opcoes, conselho: true },
          escopos: {
            unidades: [],
            locais: [],
            convenios: [],
            centrosCusto: [],
            locaisEstoque: [],
            contasBancarias: [],
            tiposAgenda: [],
            tiposProntuario: [],
          },
          restricaoVinculo: false,
          perfisConcedidos: [],
          mapaPerfis: [],
        });
      },
    };
    const s = new ServicoAutorizacao(fonte, new ArmazemMemoria(() => t), () => t);
    expect((await s.obter('r', 'aa', 'SINT.MEDICO')).permissoes).toContain('pep.movimentacoesEvolucao.ler');
    opcoes = [];
    t += (CACHE_AUTORIZACAO_SEGUNDOS - 1) * 1000;
    expect((await s.obter('r', 'aa', 'SINT.MEDICO')).permissoes).toContain('pep.movimentacoesEvolucao.ler');
    expect(leituras).toBe(1);
    t += 2_000;
    expect((await s.obter('r', 'aa', 'SINT.MEDICO')).permissoes).not.toContain(
      'pep.movimentacoesEvolucao.ler',
    );
    expect(leituras).toBe(2);
    await s.invalidar('r', 'aa', 'SINT.MEDICO');
    await s.obter('r', 'aa', 'SINT.MEDICO');
    expect(leituras).toBe(3);
  });

  it('catálogo gerado de outro estabelecimento: falha fechada (núcleo real; HS-1)', async () => {
    const fonte = {
      dadosDeAutorizacao: () => Promise.reject(new Error('não deveria ler')),
    };
    const s = new ServicoAutorizacao(fonte, new ArmazemMemoria(), () => 0, new Set(['pc']));
    await expect(s.obter('r', 'hs', 'SINT.X')).rejects.toBeInstanceOf(ErroCatalogoDeOutroEstabelecimento);
  });

  it('desempenho: 4.000 opções; em cache por usuário abaixo de 5 ms', async () => {
    const todas = Array.from({ length: 4_000 }, (_, i) => 1_000 + i);
    const fonte = {
      dadosDeAutorizacao: (): Promise<DadosAutorizacaoLegado> =>
        Promise.resolve({
          concessoes: { ...CONCESSOES_VAZIAS, grupo: 'MASTER', opcoesGrupo: todas },
          escopos: {
            unidades: [],
            locais: [],
            convenios: [],
            centrosCusto: [],
            locaisEstoque: [],
            contasBancarias: [],
            tiposAgenda: [],
            tiposProntuario: [],
          },
          restricaoVinculo: false,
          perfisConcedidos: [],
          mapaPerfis: [],
        }),
    };
    const s = new ServicoAutorizacao(fonte, new ArmazemMemoria());
    const fria = performance.now();
    const a = await s.obter('r', 'aa', 'SINT.MASTER');
    const msFrio = performance.now() - fria;
    expect(a.permissoes.length).toBeGreaterThan(2_000);
    const tempos: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      await s.obter('r', 'aa', 'SINT.MASTER');
      tempos.push(performance.now() - t0);
    }
    tempos.sort((x, y) => x - y);
    const p95 = tempos[Math.floor(tempos.length * 0.95)] ?? Infinity;
    console.log(`desempenho M06: frio ${msFrio.toFixed(1)} ms; cache p95 ${p95.toFixed(2)} ms`);
    expect(msFrio).toBeLessThan(200);
    expect(p95).toBeLessThan(5);
  });
});
