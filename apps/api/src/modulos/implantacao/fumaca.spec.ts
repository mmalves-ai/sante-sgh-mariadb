// M60 (etapa 3) pela HTTP, com a sessão real sobre a fonte sintética, a porta EM MEMÓRIA e as filas de um dublê (nada
// conecta a banco nem ao Valkey): a fumaça do servidor do estabelecimento ativo, as recusas (sem permissão,
// sonda sem o segredo) e, no serviço, o servidor errado em produção (fuso, relógio, Valkey, worker, estrutura e chaves).
// A app é a migrada (F2.2), com o módulo da implantação registrado pelas opções do teste.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  esquemaFumacaServidor,
  type FilaConferida,
  ITENS_FUMACA_SERVIDOR,
  ROTA_FUMACA_IMPLANTACAO,
  ROTA_SONDA_FUMACA,
} from '@sgh/contratos';
import { formatarHoraDeParede } from '@sgh/dominio-config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import type { FonteConfiguracao } from '../config/public-api.js';
import { impressaoDaEstrutura, ServicoFumacaServidor } from './aplicacao/fumaca.js';
import { FilasBullmq, filasDoAmbiente, FilasSemValkey, type PortaFilasImplantacao } from './filas.js';
import { chavesEsperadasDoAmbiente, estruturaHomologadaDoAmbiente, fusoDoProcesso } from './fumaca.controller.js';
import { moduloConfiguracaoDeTeste } from '../cadastro/teste.spec-util.js';
import { modulo } from './modulo.js';
import { PortaImplantacaoMemoria } from './porta-memoria.js';

const filasBoas = (): PortaFilasImplantacao => ({
  valkey: () => Promise.resolve({ configurado: true, responde: true, latenciaMs: 1 }),
  filas: () =>
    Promise.resolve(
      (['email', 'relatorio'] as const).map((codigo): FilaConferida => ({
        codigo,
        consumidores: 1,
        aguardando: 0,
        ativos: 0,
        atrasados: 0,
        falhas: 0,
      })),
    ),
});

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', TZ: 'UTC', API_MODULOS: 'configuracao_teste,implantacao' };
let app: NestFastifyApplication;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha: new RegistradorTrilhaMemoria(),
    registro: {
      configuracao_teste: async () => ({ modulo: (ctx) => moduloConfiguracaoDeTeste(ctx) }),
      implantacao: async () => ({
        modulo: (ctx) =>
          modulo(ctx, { scriptsDoPacote: () => [{ numero: 1, hash: 'a'.repeat(64) }], filas: filasBoas() }),
      }),
    },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});

async function entrar(login: string): Promise<string> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
  return set.map((c) => c.split(';')[0]).join('; ');
}

describe('M60.3: fumaça do servidor pela HTTP', { timeout: 60_000 }, () => {
  it('o administrador vê o servidor sintético correto: os itens na ordem, relógio em dia e banco em UTC-03:00', async () => {
    const antes = process.env['TZ'];
    process.env['TZ'] = 'UTC';
    try {
      const r = await app.inject({
        method: 'GET',
        url: ROTA_FUMACA_IMPLANTACAO,
        headers: { cookie: await entrar('SINT.ADMIN') },
      });
      expect(r.statusCode).toBe(200);
      const f = esquemaFumacaServidor.parse(r.json());
      expect(f.hospital).toBe('aa');
      expect(f.itens.map((i) => i.codigo)).toEqual([...ITENS_FUMACA_SERVIDOR]);
      expect(f.relogio.fusoBancoMin).toBe(-180);
      // W0-09 (M2): o sintético tem a hora em dia; o fuso da instituição é o padrão.
      expect(f.horaConfiavel).toMatchObject({
        servidorNtp: 'a.st1.ntp.br',
        referencia: 'ntp',
        desvioServidorMs: 0,
        fusoInstituicao: 'America/Sao_Paulo',
        limiarMs: 1_000,
      });
      expect(f.em).toMatch(/Z$/);
      expect(Math.abs(f.relogio.derivaMs ?? 99_999)).toBeLessThan(1_000);
      expect(f.impressao.estado).toBe('homologado');
      expect(f.chaves.lidas).toBe(true);
      // A configuração sintética de dev liga as chaves das telas: só elas saem fora do esperado.
      expect(f.itens.filter((i) => i.situacao !== 'ok').map((i) => i.codigo)).toEqual(['chaves']);
      expect(f.chaves.inesperadas.length).toBeGreaterThan(0);
      // Nada de senha nem endereço (as chaves têm códigos como acesso.trocarSenha: só o campo conta).
      expect(r.body).not.toMatch(/"senha"|password|127\.0\.0\.1/i);
    } finally {
      if (antes === undefined) delete process.env['TZ'];
      else process.env['TZ'] = antes;
    }
  });

  it('sem a permissão da saúde do sistema é 403', async () => {
    const r = await app.inject({
      method: 'GET',
      url: ROTA_FUMACA_IMPLANTACAO,
      headers: { cookie: await entrar('SINT.LEITOS') },
    });
    expect(r.statusCode).toBe(403);
  });

  it('sonda da fumaça: sem o segredo é 404; com ele, a fumaça sem sessão; estabelecimento desconhecido é 400', async () => {
    const antes = { t: process.env['SONDA_TOKEN'], e: process.env['ESTABELECIMENTOS'] };
    process.env['SONDA_TOKEN'] = 's'.repeat(40);
    process.env['ESTABELECIMENTOS'] = 'aa';
    try {
      expect((await app.inject({ method: 'GET', url: ROTA_SONDA_FUMACA })).statusCode).toBe(404);
      const errado = { 'x-sonda-token': 'x'.repeat(40) };
      expect((await app.inject({ method: 'GET', url: ROTA_SONDA_FUMACA, headers: errado })).statusCode).toBe(
        404,
      );
      const certo = { 'x-sonda-token': 's'.repeat(40) };
      const r = await app.inject({ method: 'GET', url: ROTA_SONDA_FUMACA, headers: certo });
      expect(r.statusCode).toBe(200);
      expect(esquemaFumacaServidor.parse(r.json()).hospital).toBe('aa');
      const outro = await app.inject({
        method: 'GET',
        url: `${ROTA_SONDA_FUMACA}?hospital=zz`,
        headers: certo,
      });
      expect(outro.statusCode).toBe(400);
      process.env['SONDA_TOKEN'] = 'curto';
      expect(
        (await app.inject({ method: 'GET', url: ROTA_SONDA_FUMACA, headers: { 'x-sonda-token': 'curto' } }))
          .statusCode,
      ).toBe(404);
    } finally {
      for (const [k, v] of [
        ['SONDA_TOKEN', antes.t],
        ['ESTABELECIMENTOS', antes.e],
      ] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe('M60.3: fumaça do servidor (serviço)', () => {
  const T = Date.UTC(2026, 9, 27, 15, 0, 0);
  const ATUAL = { resumo: 'f'.repeat(64), tabelas: 2 };
  const HOMOLOGADA = 'e'.repeat(64);
  const fonteChaves = (linhas: unknown[]): FonteConfiguracao =>
    ({ chaves: () => Promise.resolve(linhas) }) as unknown as FonteConfiguracao;

  it('servidor errado em produção: fuso local, relógio 8 s atrasado, sem Valkey, estrutura divergente e chave ligada', async () => {
    const memoria = new PortaImplantacaoMemoria(
      () => [],
      () => T - 8_000,
    );
    const porta = Object.assign(memoria, { estrutura: () => Promise.resolve(ATUAL) });
    const s = new ServicoFumacaServidor({
      porta,
      filas: new FilasSemValkey(),
      ambiente: 'producao',
      estruturaHomologada: () => HOMOLOGADA,
      configuracao: fonteChaves([
        {
          tipo: 'recurso',
          chave: 'pep.prontuario.consulta',
          escopo: 'pessoa',
          valor: 'ALGUEM',
          ligada: true,
        },
      ]),
      chavesEsperadas: [],
      fuso: () => 'America/Sao_Paulo',
      agora: () => T,
    });
    const f = await s.conferir({ rede: 'r', hospital: 'pc' });
    const sit = Object.fromEntries(f.itens.map((i) => [i.codigo, i.situacao]));
    expect(sit).toEqual({
      fuso: 'falha',
      relogio: 'falha',
      'hora-confiavel': 'alerta',
      valkey: 'falha',
      worker: 'falha',
      filas: 'falha',
      'impressao-digital': 'falha',
      chaves: 'falha',
    });
    expect(f.situacao).toBe('falha');
    expect(f.impressao).toMatchObject({ estado: 'divergente', resumo: 'f'.repeat(16), tabelasBloqueadas: 0 });
    expect(f.chaves.ligadas).toEqual([
      { tipo: 'recurso', chave: 'pep.prontuario.consulta', hospital: 0, setor: 0, grupo: 0, pessoa: 1 },
    ]);
    // O valor do escopo pessoa (um login) nunca sai.
    expect(JSON.stringify(f)).not.toContain('ALGUEM');
  });

  it('o banco não respondeu e as chaves não foram lidas: relógio, estrutura e chaves em falha, o resto segue', async () => {
    const porta = {
      destino: 'banco' as const,
      conexao: () => Promise.reject(new Error('x')),
      migracoesRegistradas: () => Promise.reject(new Error('x')),
      relogioBanco: () => Promise.reject(new Error('Unable to complete network request')),
      estrutura: () => Promise.reject(new Error('x')),
    };
    const s = new ServicoFumacaServidor({
      porta,
      filas: filasBoas(),
      ambiente: 'producao',
      estruturaHomologada: () => HOMOLOGADA,
      configuracao: {
        chaves: () => Promise.reject(new Error('x')),
      } as unknown as FonteConfiguracao,
      chavesEsperadas: [],
      fuso: () => 'UTC',
    });
    const f = await s.conferir({ rede: 'r', hospital: 'pc' });
    const sit = Object.fromEntries(f.itens.map((i) => [i.codigo, i.situacao]));
    expect(sit).toMatchObject({ fuso: 'ok', relogio: 'falha', valkey: 'ok', worker: 'ok', chaves: 'falha' });
    expect(sit['impressao-digital']).toBe('falha');
    expect(f.impressao.estado).toBe('indisponivel');
  });

  it('a impressão da estrutura: indisponível sem resposta, sem homologação sem a do pacote, igual ou divergente', () => {
    const em = new Date(T).toISOString();
    expect(impressaoDaEstrutura(undefined, HOMOLOGADA, em).estado).toBe('indisponivel');
    expect(impressaoDaEstrutura(ATUAL, null, em).estado).toBe('sem-homologacao');
    expect(impressaoDaEstrutura(ATUAL, 'F'.repeat(64), em)).toMatchObject({
      estado: 'homologado',
      resumoHomologado: 'f'.repeat(16),
      verificadaEm: em,
    });
    expect(impressaoDaEstrutura(ATUAL, HOMOLOGADA, em).estado).toBe('divergente');
    expect(estruturaHomologadaDoAmbiente({ ESTRUTURA_HOMOLOGADA: 'x' })).toBeNull();
    expect(estruturaHomologadaDoAmbiente({ ESTRUTURA_HOMOLOGADA: HOMOLOGADA })).toBe(HOMOLOGADA);
  });

  it('variáveis: chaves esperadas inválidas contam como vazias; fuso pela TZ', () => {
    expect(chavesEsperadasDoAmbiente({ IMPLANTACAO_CHAVES_ESPERADAS: 'a;b' })).toEqual([]);
    expect(
      chavesEsperadasDoAmbiente({ IMPLANTACAO_CHAVES_ESPERADAS: 'sistema.*,config.matriz.consulta' }),
    ).toEqual(['sistema.*', 'config.matriz.consulta']);
    // M61 (liberação full na instalação): sem a variável, todas menos as exceções do comando; `nenhuma` é o vazio.
    const padrao = chavesEsperadasDoAmbiente({}, 'producao');
    expect(padrao[0]).toBe('*');
    expect(padrao).toContain('!entrada.utf8');
    expect(padrao).toContain('!operadora.mensagens');
    expect(padrao).toContain('!financeiro.fiscal');
    expect(padrao).toContain('!portal.conta');
    // Em dev/ci o comando liga as da decisão do dono: o padrão não as acusa (só as que nunca ligam e as de envio).
    const dev = chavesEsperadasDoAmbiente({ AMBIENTE: 'dev' });
    expect(dev).toContain('!entrada.utf8');
    expect(dev).toContain('!operadora.mensagens');
    expect(dev).not.toContain('!financeiro.fiscal');
    expect(dev).not.toContain('!portal.conta');
    expect(chavesEsperadasDoAmbiente({ IMPLANTACAO_CHAVES_ESPERADAS: 'nenhuma' })).toEqual([]);
    expect(fusoDoProcesso({ TZ: 'UTC' })).toBe('UTC');
  });

  it('formatarHoraDeParede do relógio sintético bate com o banco em UTC-03:00', async () => {
    const p = new PortaImplantacaoMemoria(
      () => [],
      () => T,
    );
    expect(await p.relogioBanco()).toBe(formatarHoraDeParede(T - 3 * 3_600_000));
  });
});

describe('M60.3: Valkey e filas (porta)', () => {
  it('só redis:// em loopback; sem VALKEY_URL, a porta sem Valkey', async () => {
    expect(() => new FilasBullmq('redis://10.0.0.1:6379')).toThrow(/loopback/);
    expect(() => new FilasBullmq('http://127.0.0.1:6379')).toThrow(/loopback/);
    const sem = filasDoAmbiente({});
    expect(sem).toBeInstanceOf(FilasSemValkey);
    expect(await sem.valkey('r')).toEqual({ configurado: false, responde: false, latenciaMs: null });
    expect((await sem.filas('r')).map((f) => f.consumidores)).toEqual([null, null]);
  });

  it('Valkey fora do ar: responde falso e as filas sem leitura, dentro do prazo', async () => {
    const p = new FilasBullmq('redis://127.0.0.1:1', 'sgh', 800);
    const inicio = Date.now();
    try {
      expect(await p.valkey('r')).toEqual({ configurado: true, responde: false, latenciaMs: null });
      const f = await p.filas('r');
      expect(f.map((x) => [x.codigo, x.consumidores, x.aguardando])).toEqual([
        ['email', null, null],
        ['relatorio', null, null],
      ]);
      expect(Date.now() - inicio).toBeLessThan(5_000);
    } finally {
      await p.encerrar();
    }
  });

  it('W0-09 (M2): hora confiável pelos parâmetros (servidor NTP, limiar e fuso do estabelecimento), alerta acima do limiar', async () => {
    const T = Date.UTC(2026, 10, 18, 12, 0, 0);
    const pedidos: string[] = [];
    const valores = [
      { chave: 'sistema.ntpServidor', nivel: 'rede', alvo: 'r', valor: 'b.st1.ntp.br' },
      { chave: 'sistema.ntpLimiarMs', nivel: 'rede', alvo: 'r', valor: '500' },
      { chave: 'sistema.fusoInstituicao', nivel: 'rede', alvo: 'r', valor: 'America/Sao_Paulo' },
      { chave: 'sistema.fusoInstituicao', nivel: 'estabelecimento', alvo: 'pc', valor: 'America/Manaus' },
    ].map((v, i) => ({
      ...v,
      nivel: v.nivel as 'rede' | 'estabelecimento',
      id: String(i + 1),
      vigenteDesde: '2026-01-01T00:00:00.000Z',
      vigenteAte: null,
      justificativa: 'teste',
      autor: 'T',
    }));
    const s = new ServicoFumacaServidor({
      porta: new PortaImplantacaoMemoria(
        () => [],
        () => T,
      ),
      filas: filasBoas(),
      ambiente: 'producao',
      estruturaHomologada: () => null,
      configuracao: {
        chaves: () => Promise.resolve([]),
        valoresParametro: () => Promise.resolve(valores),
      } as unknown as FonteConfiguracao,
      chavesEsperadas: [],
      fuso: () => 'UTC',
      agora: () => T,
      ntp: (servidor) => {
        pedidos.push(servidor);
        return Promise.resolve(-800);
      },
    });
    const f = await s.conferir({ rede: 'r', hospital: 'pc' });
    expect(pedidos).toEqual(['b.st1.ntp.br']);
    expect(f.horaConfiavel).toMatchObject({
      servidorNtp: 'b.st1.ntp.br',
      referencia: 'ntp',
      desvioServidorMs: 800,
      limiarMs: 500,
      fusoInstituicao: 'America/Manaus',
    });
    const item = f.itens.find((i) => i.codigo === 'hora-confiavel');
    expect(item?.situacao).toBe('alerta');
    expect(item?.detalhe).toContain('0,8 s adiantado');
    // Gravado em UTC; exibido no fuso do estabelecimento (Manaus, UTC-04:00).
    expect(f.em).toBe(new Date(T).toISOString());
    expect(f.horaConfiavel.exibidoNoFuso).toBe(
      new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Manaus',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
        .format(new Date(T))
        .replace(',', ''),
    );
    // Sem NTP (sem rede): 'sem referência', alerta, desvios nulos.
    const semRede = new ServicoFumacaServidor({
      porta: new PortaImplantacaoMemoria(
        () => [],
        () => T,
      ),
      filas: filasBoas(),
      ambiente: 'dev',
      estruturaHomologada: () => null,
      configuracao: null,
      chavesEsperadas: [],
      fuso: () => 'UTC',
      agora: () => T,
      ntp: () => Promise.resolve(null),
    });
    const g = await semRede.conferir({ rede: 'r', hospital: 'pc' });
    expect(g.horaConfiavel).toMatchObject({ referencia: 'sem-referencia', desvioServidorMs: null });
    expect(g.itens.find((i) => i.codigo === 'hora-confiavel')?.situacao).toBe('alerta');
  });
});
