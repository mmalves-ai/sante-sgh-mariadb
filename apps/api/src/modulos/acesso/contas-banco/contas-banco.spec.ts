// M59-F1: painel "Contas do banco de dados e privilégios" (inventário e desvios), só consulta. Serviço com a porta de
// memória (contas técnicas do cap-08 §8.10, números sintéticos) e as rotas com a permissão acesso.contaBanco.ler.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { EVENTOS_AUDITAVEIS, type ValorParametro } from '@sgh/contratos';
import { alcanceVersionado } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { CHAVE_AUDITAR } from '../../../autorizacao/decoradores.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { ErroProblema } from '../../../problema.filter.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import type { FonteConfiguracao } from '../../config/public-api.js';
import { ContasBancoController } from './contas-banco.controller.js';
import { contasSghDoAmbiente } from './porta-legado.js';
import { PortaContasBancoMemoria } from './porta-memoria.js';
import { ServicoContasBanco } from './servico.js';

const AGORA = Date.parse('2026-10-28T12:00:00Z');
const vazia = mkdtempSync(join(tmpdir(), 'm59-deslig-vazio-'));
const desligada = mkdtempSync(join(tmpdir(), 'm59-deslig-'));
writeFileSync(
  join(desligada, 'pc.yaml'),
  [
    'formato: 1',
    'estabelecimento: pc',
    'passos:',
    '  desligamento:',
    "    autorizacao: { data: '2026-10-20', referencia: 'autorização sintética' }",
    "    ensaio: { data: '2026-10-21', relatorio: 'ensaio sintético', resultado: aprovado }",
    "    execucao: { data: '2026-10-22', referencia: 'execução sintética' }",
    '',
  ].join('\n'),
);
const contingencia = (valor: 'sim' | 'nao'): FonteConfiguracao =>
  ({
    valoresParametro: async (): Promise<ValorParametro[]> => [
      {
        id: '1',
        chave: 'legado.contingencia',
        nivel: 'estabelecimento',
        alvo: 'pc',
        valor,
        vigenteDesde: '2026-10-01T00:00:00Z',
        vigenteAte: null,
        justificativa: 'sintético',
        autor: 'SINT',
      } as ValorParametro,
    ],
  }) as unknown as FonteConfiguracao;
const C = { rede: 'rede-teste', hospital: 'pc' };

describe('ServicoContasBanco', () => {
  it('sem registro dos passos nem parâmetros: não desligado e contingência aberta (falha fechada)', async () => {
    const s = new ServicoContasBanco({
      porta: new PortaContasBancoMemoria(),
      raizDesligamento: vazia,
      agora: () => AGORA,
    });
    const r = await s.situacao(C);
    expect(r).toMatchObject({ desligado: false, contingenciaAtiva: true });
    expect(r.avisos.join(' ')).toMatch(/registro dos passos ausente/);
    const inv = await s.inventario(C);
    expect(inv.contas.every((c) => c.situacao === 'aguardando-desligamento')).toBe(true);
    expect(inv.contexto.avisos.join(' ')).toMatch(/uso das contas ainda não medido/);
    // O agregado das contas fora do catálogo nunca sai pelo nome e a contagem baixa vira faixa.
    expect(inv.contas.find((c) => c.nome === null)?.quantidade).toBe('<5');
    expect(inv.resumo.loginsSemPrivilegio).toBe('<5');
    expect(inv.resumo.contasComEscritaAmpla).toBe(4);
  });

  it('desligado pelo M58 e contingência encerrada: as contas pedem a medição do uso', async () => {
    const s = new ServicoContasBanco({
      porta: new PortaContasBancoMemoria(),
      raizDesligamento: desligada,
      configuracao: contingencia('nao'),
      agora: () => AGORA,
    });
    expect(await s.situacao(C)).toEqual({ desligado: true, contingenciaAtiva: false, avisos: [] });
    const inv = await s.inventario(C);
    const por = (n: string) => inv.contas.find((c) => c.nome === n);
    expect(por('AUTORIZADOR')?.situacao).toBe('medir-uso');
    expect(por('PUBLIC')?.situacao).not.toBe('medir-uso');
    expect(por('SGH_SINTETICO')).toMatchObject({ classe: 'aplicacao-sgh', destino: 'privilegio-minimo' });
    expect(inv.contas[0]?.nome).toBeNull(); // a conta a identificar vem primeiro
  });

  it('com a contingência ligada, o que o sistema anterior usa aguarda', async () => {
    const s = new ServicoContasBanco({
      porta: new PortaContasBancoMemoria(),
      raizDesligamento: desligada,
      configuracao: contingencia('sim'),
      agora: () => AGORA,
    });
    expect((await s.situacao(C)).contingenciaAtiva).toBe(true);
  });

  it('desvios: plano versionado do pc, ainda não aplicado; privilégio direto numa conta por módulo é excesso', async () => {
    const plano = alcanceVersionado('pc');
    const s = new ServicoContasBanco({
      porta: new PortaContasBancoMemoria([
        { titular: 'SGH_APP_ACESSO', objeto: 'TBUSERS', acao: 'DELETE' },
        { titular: 'SGH_APLICACAO', objeto: 'SGH_TRILHA', acao: 'INSERT' },
      ]),
      raizDesligamento: vazia,
      agora: () => AGORA,
    });
    const d = await s.desvios(C);
    expect(d.versaoPlano).toBe(plano?.versao);
    expect(d.modulos).toHaveLength(plano?.alcances.length ?? -1);
    expect(d.planoAplicado).toBe(false);
    expect(d.excesso).toEqual([{ titular: 'SGH_APP_ACESSO', objeto: 'TBUSERS', acao: 'DELETE' }]);
    expect(d.faltaTotal).toBe(d.modulos.reduce((t, m) => t + m.itens, 0));
    expect(d.falta.length).toBeLessThanOrEqual(500);
    expect(d.modulos.every((m) => !m.contaConfigurada)).toBe(true);
  });

  it('desvios sem plano gerado para o estabelecimento: 404', async () => {
    const s = new ServicoContasBanco({ porta: new PortaContasBancoMemoria(), raizDesligamento: vazia });
    await expect(s.desvios({ rede: 'r', hospital: 'zz' })).rejects.toBeInstanceOf(ErroProblema);
  });
});

describe('contasSghDoAmbiente', () => {
  it('a conta única, as por módulo e a dos scripts; nunca a senha', () => {
    const r = contasSghDoAmbiente(
      {
        FB_PC_USUARIO: 'sgh_app',
        FB_PC_SCRIPTS_USUARIO: 'sgh_scripts',
        FB_PC_MOD_ACESSO_USUARIO: 'SGH_APP_ACESSO',
        FB_PC_MOD_ACESSO_SENHA: '<nao-aparece>',
      },
      'pc',
    );
    expect(r).toEqual({ aplicacao: ['sgh_app', 'SGH_APP_ACESSO'], scripts: 'sgh_scripts', leitura: null });
    expect(JSON.stringify(r)).not.toContain('<nao-aparece>');
  });
});

describe('rotas /api/administracao/acesso/contas-banco', () => {
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', SGH_COEX_DESLIGAMENTO: vazia };
  let app: NestFastifyApplication;
  const trilha = new RegistradorTrilhaMemoria();
  beforeAll(async () => {
    app = await criarApp(lerConfiguracao(env), null, env, {
      trilha,
      contasBanco: new PortaContasBancoMemoria(),
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app.close();
  });
  const entrar = async (login: string) => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login, senha: SENHA },
    });
    expect(r.statusCode).toBe(201);
    const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
    return set.map((c) => c.split(';')[0]).join('; ');
  };
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });

  it('administrador do sistema e auditor leem o inventário; quem não tem a permissão recebe 403', async () => {
    for (const login of ['SINT.ADMIN', 'SINT.AUDITOR']) {
      const r = await get(await entrar(login), '/api/administracao/acesso/contas-banco');
      expect(r.statusCode, login).toBe(200);
      expect(r.json().hospital).toBe('aa');
    }
    const r = await get(await entrar('SINT.RECEPCAO'), '/api/administracao/acesso/contas-banco');
    expect(r.statusCode).toBe(403);
  });

  it('a leitura permitida entra na trilha própria com o ator real; sem trilha, 503 e nada sai', async () => {
    const evento = EVENTOS_AUDITAVEIS.contasBancoConsultadas.codigo;
    for (const login of ['SINT.ADMIN', 'SINT.AUDITOR']) {
      const antes = trilha.eventos.length;
      const r = await get(await entrar(login), '/api/administracao/acesso/contas-banco');
      expect(r.statusCode, login).toBe(200);
      const novos = trilha.eventos.slice(antes).filter((e) => e.evento === evento);
      expect(novos, login).toHaveLength(1);
      expect(novos[0]).toMatchObject({ hospital: 'aa', resultado: 'sucesso' });
      expect(novos[0]?.usuario, login).toMatch(new RegExp(login.split('.')[1] ?? '', 'i'));
    }
    const cookie = await entrar('SINT.ADMIN');
    // Os desvios levam o mesmo evento (a resposta com plano é provada no serviço; aqui o estabelecimento não tem plano).
    for (const h of ['inventario', 'desvios', 'imutabilidade'] as const) {
      expect(Reflect.getMetadata(CHAVE_AUDITAR, ContasBancoController.prototype[h]), h).toBe(evento);
    }
    trilha.falhar = true;
    try {
      const r = await get(cookie, '/api/administracao/acesso/contas-banco');
      expect(r.statusCode).toBe(503);
      expect(r.body).not.toContain('SGH_');
    } finally {
      trilha.falhar = false;
    }
  });

  it('desvios do estabelecimento sem plano gerado: 404 com problema', async () => {
    const r = await get(await entrar('SINT.ADMIN'), '/api/administracao/acesso/contas-banco/desvios');
    expect(r.statusCode).toBe(404);
  });

  it('M59-F3: a imutabilidade responde no esquema, com a concessão vigente da conta sintética; 403 sem a permissão', async () => {
    const r = await get(await entrar('SINT.ADMIN'), '/api/administracao/acesso/contas-banco/imutabilidade');
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.hospital).toBe('aa');
    expect(j.operacoesComDelete).toEqual([]);
    expect(j.planoComDelete).toBe(0);
    expect(j.concessaoVigente).toBe(true);
    expect(j.titulares).toEqual([
      { titular: 'SGH_SINTETICO', doSante: true, tabelas: 55 },
      { titular: '(outras)', doSante: false, tabelas: 330 },
    ]);
    const n = await get(
      await entrar('SINT.RECEPCAO'),
      '/api/administracao/acesso/contas-banco/imutabilidade',
    );
    expect(n.statusCode).toBe(403);
  });
});

describe('ServicoContasBanco.imutabilidade (pc, plano versionado)', () => {
  it('conta as tabelas clínicas, nenhum DELETE clínico no catálogo nem no plano; sem DELETE do Sante, concessão encerrada', async () => {
    const porta = new PortaContasBancoMemoria();
    porta.deleteClinico = [{ titular: null, tabelas: 3 }];
    const s = new ServicoContasBanco({ porta, raizDesligamento: vazia, agora: () => AGORA });
    const r = await s.imutabilidade(C);
    expect(r.tabelasClinicas.legado).toBeGreaterThan(40);
    expect(r.tabelasClinicas.sgh).toBeGreaterThan(0);
    expect(r.operacoesComDelete).toEqual([]);
    expect(r.planoComDelete).toBe(0);
    expect(r.excecoes.map((e) => e.tabela)).toEqual([
      'SGH_PEP_FORMNOVO_CASO',
      'SGH_PEP_DISPOSITIVO',
      'SGH_PEP_DISPOSITIVO_VERSAO',
      'SGH_PEP_ONCO_CICLO_PRESC',
    ]);
    expect(r.titulares).toEqual([{ titular: '(outras)', doSante: false, tabelas: '<5' }]);
    expect(r.concessaoVigente).toBe(false);
  });
});
