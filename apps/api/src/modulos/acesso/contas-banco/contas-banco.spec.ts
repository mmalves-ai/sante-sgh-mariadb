// M59-F1/F3: o painel "Contas do banco de dados e privilégios" sobre a porta de memória (sem banco): o serviço (o banco
// do cliente é o único: sem desligamento nem contingência; plano por módulo injetado) e as rotas por um módulo de teste
// (permissão, trilha própria com o ator real, 503 sem trilha, 404 sem plano). A porta própria tem o seu teste de
// integração (porta-propria.int.spec.ts).
import { Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { CHAVE_AUDITAR } from '../../../autorizacao/decoradores.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { ErroProblema } from '../../../problema.filter.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { ContasBancoController } from './contas-banco.controller.js';
import { PORTA_CONTAS_BANCO } from './porta.js';
import { PortaContasBancoMemoria } from './porta-memoria.js';
import { contasSghDoAmbiente, titularDoGrantee } from './porta-propria.js';
import { CATALOGO_EXCLUSOES, ServicoContasBanco } from './servico.js';

const AGORA = Date.parse('2026-10-28T12:00:00Z');
const C = { rede: 'rede-teste', hospital: 'pc' };
// O domínio do plano ainda valida identificadores em maiúsculas (pedido: aceitar os nomes do banco próprio).
const PLANO = {
  alcances: [
    { modulo: 'acesso', objetos: { USUARIO: ['SELECT', 'UPDATE'] as const, TRILHA: ['INSERT'] as const } },
    { modulo: 'cadastro', objetos: { PACIENTE: ['SELECT', 'INSERT', 'UPDATE'] as const } },
  ],
};

describe('ServicoContasBanco', () => {
  it('o banco do cliente é o único: sem desligamento a esperar, as contas pedem a medição do uso', async () => {
    const s = new ServicoContasBanco({ porta: new PortaContasBancoMemoria(), agora: () => AGORA });
    expect(await s.situacao(C)).toEqual({ desligado: true, contingenciaAtiva: false, avisos: [] });
    const inv = await s.inventario(C);
    expect(inv.contexto.avisos.join(' ')).toMatch(/uso das contas ainda não medido/);
    // O agregado das contas fora do catálogo nunca sai pelo nome e a contagem baixa vira faixa.
    expect(inv.contas.find((c) => c.nome === null)?.quantidade).toBe('<5');
    expect(inv.resumo.loginsSemPrivilegio).toBe('<5');
    expect(inv.contas.find((c) => c.nome === 'SGH_SINTETICO')).toMatchObject({ classe: 'aplicacao-sgh' });
  });

  it('desvios com o plano injetado; privilégio fora do plano numa conta da aplicação é excesso', async () => {
    const s = new ServicoContasBanco({
      porta: new PortaContasBancoMemoria([
        { titular: 'SGH_SINTETICO', objeto: 'USUARIO', acao: 'DELETE' },
        { titular: 'SGH_SINTETICO', objeto: 'USUARIO', acao: 'SELECT' },
      ]),
      plano: () => PLANO,
      agora: () => AGORA,
    });
    const d = await s.desvios(C);
    expect(d.modulos).toHaveLength(2);
    expect(d.planoAplicado).toBe(false);
    expect(d.modulos.every((m) => !m.contaConfigurada)).toBe(true);
  });

  it('desvios sem plano gerado para o estabelecimento: 404', async () => {
    const s = new ServicoContasBanco({ porta: new PortaContasBancoMemoria() });
    await expect(s.desvios({ rede: 'r', hospital: 'zz' })).rejects.toBeInstanceOf(ErroProblema);
  });

  it('imutabilidade: todas as tabelas do banco próprio; sem DELETE da aplicação, a concessão está encerrada', async () => {
    const porta = new PortaContasBancoMemoria();
    porta.deleteClinico = [{ titular: null, tabelas: 3 }];
    const s = new ServicoContasBanco({
      porta,
      agora: () => AGORA,
      exclusoes: () => ({
        operacoes: [
          { operacao: 'agenda.horario.excluir', tabela: 'horario_agenda' },
          { operacao: 'administracao.escopo.retirar', tabela: 'usuario_escopo' },
        ],
        excecoes: [{ tabela: 'horario_agenda', motivo: 'grade futura sem marcação' }],
      }),
    });
    const r = await s.imutabilidade(C);
    expect(r.tabelasClinicas).toEqual({ legado: 0, sgh: 3500 });
    // A operação que apaga fora das exceções aparece; a da exceção aceita, não.
    expect(r.operacoesComDelete).toEqual([{ operacao: 'administracao.escopo.retirar', tabela: 'USUARIO_ESCOPO' }]);
    expect(r.excecoes).toEqual([{ tabela: 'HORARIO_AGENDA', motivo: 'grade futura sem marcação' }]);
    expect(r.planoComDelete).toBe(0);
    expect(r.titulares).toEqual([{ titular: '(outras)', doSante: false, tabelas: '<5' }]);
    expect(r.concessaoVigente).toBe(false);
  });

  it('imutabilidade sem o catálogo das exclusões: 409 catalogo-pendente, nunca zero afirmado', async () => {
    const s = new ServicoContasBanco({ porta: new PortaContasBancoMemoria(), agora: () => AGORA });
    await expect(s.imutabilidade(C)).rejects.toMatchObject({ extras: { codigo: 'catalogo-pendente' } });
  });
});

describe('porta própria: utilitários', () => {
  it('a conta da aplicação vem da configuração do núcleo (padrão root); nunca a senha', () => {
    expect(contasSghDoAmbiente({ SGH_MARIADB_USUARIO: 'sgh_app', MARIADB_SENHA: '<nao-aparece>' })).toEqual({
      aplicacao: ['sgh_app'],
      scripts: null,
      leitura: null,
    });
    expect(contasSghDoAmbiente({}).aplicacao).toEqual(['root']);
  });

  it('o titular do information_schema: conta com host e papel sem host', () => {
    expect(titularDoGrantee("'sgh_app'@'%'")).toEqual({ nome: 'sgh_app', papel: false });
    expect(titularDoGrantee("'leitura'")).toEqual({ nome: 'leitura', papel: true });
  });
});

@Module({})
class ContasBancoTeste {}

describe('rotas /api/administracao/acesso/contas-banco', () => {
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'contas_banco_teste' };
  let app: NestFastifyApplication;
  const trilha = new RegistradorTrilhaMemoria();
  beforeAll(async () => {
    app = await criarApp(lerConfiguracao(env), null, env, {
      trilha,
      registro: {
        contas_banco_teste: async () => ({
          modulo: () => ({
            module: ContasBancoTeste,
            controllers: [ContasBancoController],
            providers: [
              { provide: PORTA_CONTAS_BANCO, useValue: new PortaContasBancoMemoria() },
              { provide: CATALOGO_EXCLUSOES, useValue: () => ({ operacoes: [], excecoes: [] }) },
            ],
          }),
        }),
      },
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
    const antes = trilha.eventos.length;
    const cookie = await entrar('SINT.ADMIN');
    expect((await get(cookie, '/api/administracao/acesso/contas-banco')).statusCode).toBe(200);
    const novos = trilha.eventos.slice(antes).filter((e) => e.evento === evento);
    expect(novos).toHaveLength(1);
    expect(novos[0]).toMatchObject({ hospital: 'aa', resultado: 'sucesso' });
    for (const h of ['inventario', 'desvios', 'imutabilidade'] as const)
      expect(Reflect.getMetadata(CHAVE_AUDITAR, ContasBancoController.prototype[h]), h).toBe(evento);
    trilha.falhar = true;
    try {
      expect((await get(cookie, '/api/administracao/acesso/contas-banco')).statusCode).toBe(503);
    } finally {
      trilha.falhar = false;
    }
  });

  it('desvios sem plano gerado: 404; imutabilidade no esquema; 403 sem a permissão', async () => {
    const cookie = await entrar('SINT.ADMIN');
    expect((await get(cookie, '/api/administracao/acesso/contas-banco/desvios')).statusCode).toBe(404);
    const r = await get(cookie, '/api/administracao/acesso/contas-banco/imutabilidade');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ hospital: 'aa', operacoesComDelete: [], planoComDelete: 0, concessaoVigente: true });
    const n = await get(await entrar('SINT.RECEPCAO'), '/api/administracao/acesso/contas-banco/imutabilidade');
    expect(n.statusCode).toBe(403);
  });
});
