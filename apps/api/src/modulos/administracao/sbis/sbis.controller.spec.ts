// Rotas do M59-F5: permissões (certificação com auditoria.sbis.ler|avaliar, ciclos pelo escritório da qualidade; termo com config.coexistencia.ler e
// auditoria.concessao.encerrar; backup com auditoria.backup.ler|registrar; exportação com auditoria.trilha.exportar),
// auditoria das leituras, validação da entrada e a senha nas ações críticas. App da base com o módulo da administração
// (registro) sobre a porta em memória (dados sintéticos). A rota de exportação da trilha é do controlador da trilha
// (auditoria.controller.ts, lote 02-05); aqui, a identificação e a prova pelo serviço que o módulo exporta.
import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { EVENTOS_AUDITAVEIS, REQUISITOS_SBIS } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { CHAVE_AUDITAR } from '../../../autorizacao/decoradores.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { modulo } from '../modulo.js';
import { PortaSbisMemoria } from './porta-memoria.js';
import { SbisController } from './sbis.controller.js';
import { SERVICO_SBIS, type ServicoSbis } from './servico.js';

const SBIS = '/api/administracao/auditoria/sbis';
const CONCESSOES = '/api/administracao/coexistencia/concessoes';
const BACKUP = '/api/administracao/auditoria/backup';

describe('rotas do M59-F5', () => {
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'administracao' };
  let app: NestFastifyApplication;
  const trilha = new RegistradorTrilhaMemoria();
  const porta = new PortaSbisMemoria();
  const csrf = new Map<string, string>();
  beforeAll(async () => {
    app = await criarApp(lerConfiguracao(env), null, env, {
      trilha,
      registro: { administracao: async () => ({ modulo: (ctx) => modulo(ctx, { sbis: porta }) }) },
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
    const cookie = set.map((c) => c.split(';')[0]).join('; ');
    csrf.set(
      cookie,
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '',
    );
    return cookie;
  };
  const com = (cookie: string) => ({ cookie, 'x-csrf': csrf.get(cookie) ?? '' });
  const post = (cookie: string, url: string, payload: unknown, chave: string = randomUUID()) =>
    app.inject({
      method: 'POST',
      url,
      headers: { ...com(cookie), 'idempotency-key': chave },
      payload: payload as object,
    });

  it('gravação sem Idempotency-Key: 400 (o reenvio só é reconhecido pela chave do pedido)', async () => {
    const auditor = await entrar('SINT.SBIS.CONFORMIDADE');
    const r = await app.inject({
      method: 'POST',
      url: `${SBIS}/ciclos`,
      headers: com(auditor),
      payload: { tipo: 'autoavaliacao', versao: '1.0.0' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('painel da certificação: auditor lê (auditado); sem a permissão, 403', async () => {
    const auditor = await entrar('SINT.AUDITOR');
    const antes = trilha.eventos.length;
    const r = await app.inject({ method: 'GET', url: SBIS, headers: { cookie: auditor } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ hospital: 'aa', requisitos: { total: REQUISITOS_SBIS.length } });
    expect(r.json().pacote).toHaveLength(10);
    const evento = EVENTOS_AUDITAVEIS.sbisConsultado.codigo;
    expect(trilha.eventos.slice(antes).filter((e) => e.evento === evento)).toHaveLength(1);
    for (const h of ['painel', 'ciclo'] as const)
      expect(Reflect.getMetadata(CHAVE_AUDITAR, SbisController.prototype[h]), h).toBe(evento);
    const outro = await entrar('SINT.SANEAR.AREA');
    expect((await app.inject({ method: 'GET', url: SBIS, headers: { cookie: outro } })).statusCode).toBe(403);
  });

  it('ciclo: abrir, avaliar, recusa com o código, corrigir e verificar por outra pessoa, concluir com a senha', async () => {
    const auditor = await entrar('SINT.SBIS.CONFORMIDADE');
    const r = await post(auditor, `${SBIS}/ciclos`, { tipo: 'autoavaliacao', versao: '1.0.0' });
    expect(r.statusCode).toBe(201);
    const id = r.json().id as string;
    expect((await post(auditor, `${SBIS}/ciclos`, { tipo: 'xyz', versao: '1' })).statusCode).toBe(400);
    const nc = await post(auditor, `${SBIS}/ciclos/${id}/itens/SBIS-05`, {
      resultado: 'nao-conforme',
      severidade: 'maior',
      origem: 'defeito',
      evidencia: 'sem bloqueio',
    });
    expect(nc.statusCode).toBe(200);
    const recusa = await post(auditor, `${SBIS}/ciclos/${id}/itens/SBIS-01`, { resultado: 'conforme' });
    expect(recusa.statusCode).toBe(409);
    expect(recusa.json().codigo).toBe('evidencia-obrigatoria');
    expect(
      (await post(auditor, `${SBIS}/ciclos/abc/itens/SBIS-01`, { resultado: 'conforme' })).statusCode,
    ).toBe(400);
    expect(
      (
        await post(auditor, `${SBIS}/ciclos/${id}/itens/SBIS-05/corrigir`, {
          descricao: 'Bloqueio após 5 tentativas',
        })
      ).statusCode,
    ).toBe(200);
    expect((await post(auditor, `${SBIS}/ciclos/${id}/itens/SBIS-05/verificar`, {})).json().codigo).toBe(
      'verificador-igual',
    );
    const segundo = await entrar('SINT.SBIS.CONFORMIDADE2');
    expect((await post(segundo, `${SBIS}/ciclos/${id}/itens/SBIS-05/verificar`, {})).statusCode).toBe(200);
    for (const req of REQUISITOS_SBIS)
      if (req.codigo !== 'SBIS-05')
        await post(auditor, `${SBIS}/ciclos/${id}/itens/${req.codigo}`, {
          resultado: 'conforme',
          evidencia: 'ok',
        });
    expect(
      (await post(auditor, `${SBIS}/ciclos/${id}/concluir`, { parecerTexto: 'Fevereiro sem bloqueio' }))
        .statusCode,
    ).toBe(400);
    const fim = await post(auditor, `${SBIS}/ciclos/${id}/concluir`, {
      parecerTexto: 'Fevereiro sem bloqueio',
      senha: SENHA,
    });
    expect(fim.statusCode).toBe(200);
    expect(fim.json()).toMatchObject({ situacao: 'concluido', parecer: 'apto' });
    const det = await app.inject({
      method: 'GET',
      url: `${SBIS}/ciclos/${id}`,
      headers: { cookie: auditor },
    });
    expect(det.json().itens).toHaveLength(REQUISITOS_SBIS.length);
    expect(porta.trilhas.some((t) => t.startsWith(`ciclo:${id}:concluido`))).toBe(true);
  });

  it('termo das concessões: o administrador lê e encerra com a senha; o auditor não encerra', async () => {
    const admin = await entrar('SINT.ADMIN');
    const r = await app.inject({ method: 'GET', url: CONCESSOES, headers: { cookie: admin } });
    expect(r.statusCode).toBe(200);
    expect(r.json().concessoes).toHaveLength(6);
    const auditor = await entrar('SINT.AUDITOR');
    expect(
      (
        await post(auditor, `${CONCESSOES}/privilegio-banco/encerrar`, {
          evidencia: 'Relatório F1',
          senha: SENHA,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await post(admin, `${CONCESSOES}/xyz/encerrar`, { evidencia: 'Relatório da F1', senha: SENHA }))
        .statusCode,
    ).toBe(400);
    expect(
      (await post(admin, `${CONCESSOES}/privilegio-banco/encerrar`, { evidencia: 'Relatório da F1' }))
        .statusCode,
    ).toBe(400);
    const e = await post(admin, `${CONCESSOES}/privilegio-banco/encerrar`, {
      evidencia: 'Relatório da F1',
      senha: SENHA,
    });
    expect(e.statusCode).toBe(409);
    expect([
      'sistema-anterior-ligado',
      'contingencia-ativa',
      'indicador-pendente',
      'indicador-indisponivel',
    ]).toContain(e.json().codigo);
    expect(
      (await post(admin, `${CONCESSOES}/privilegio-banco/previsao`, { fimPrevisto: '2027-01-31' }))
        .statusCode,
    ).toBe(200);
    const re = await post(admin, `${CONCESSOES}/privilegio-banco/reabrir`, {
      motivo: 'teste da rota',
      senha: SENHA,
    });
    expect(re.json().codigo).toBe('concessao-ja-vigente');
  });

  it('backup verificado: o operador registra; o auditor lê e não registra', async () => {
    const backup = await entrar('SINT.SBIS.BACKUP');
    const agora = Date.now();
    const r = await post(backup, `${BACKUP}/restauracoes`, {
      tipo: 'diaria',
      inicio: new Date(agora - 3_600_000).toISOString(),
      fim: new Date(agora - 60_000).toISOString(),
      resultado: 'ok',
      integridade: 'ok',
      ambiente: 'cópia de leitura',
    });
    expect(r.statusCode).toBe(201);
    expect((await post(backup, `${BACKUP}/restauracoes`, { tipo: 'diaria' })).statusCode).toBe(400);
    const auditor = await entrar('SINT.AUDITOR');
    const l = await app.inject({ method: 'GET', url: BACKUP, headers: { cookie: auditor } });
    expect(l.statusCode).toBe(200);
    expect(l.json()).toMatchObject({ diaria: { emDia: true }, destino: 'memoria' });
    expect((await post(auditor, `${BACKUP}/restauracoes`, {})).statusCode).toBe(403);
  });

  it('exportação para a auditoria: o serviço exportado pelo módulo monta a identificação e a prova da cadeia', async () => {
    const servico = app.get<ServicoSbis>(SERVICO_SBIS);
    const hoje = new Date().toISOString().slice(0, 10);
    const r = await servico.identificacaoEProva(
      { rede: '', hospital: 'aa', login: 'SINT.AUDITOR', estacao: null, correlacao: 'teste-exportacao' },
      hoje,
      hoje,
    );
    expect(r.identificacao).toMatchObject({
      cnes: '0000000',
      inicio: hoje,
      fim: hoje,
      geradoPor: 'SINT.AUDITOR',
    });
    expect(r.prova.integra).toBe(true);
  });
});
