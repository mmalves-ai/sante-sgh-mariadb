// M39 pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco): a lista para
// ligar cada setor da onda 1 (regra 1: o item das operações calculado pelo catálogo, os demais registrados com
// evidência e data, sem dado pessoal), os indicadores de disputa com as parcelas impressas (as recusas por horário
// ocupado do executor deste processo, as esperas por trava e as senhas chamadas por sistema) e o lote de um setor da
// onda 1: em dev/ci segue com o aviso do que falta; fora de dev/ci, recusado com a lista incompleta.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { MetricasExecutor } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { fonteConfiguracaoMemoria } from '../config/public-api.js';
import { ServicoMigracao } from './aplicacao/servico.js';
import { PortaCoexistenciaMemoria } from './porta-memoria.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { ErroProblema } from '../../problema.filter.js';
import { resolve } from 'node:path';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const metricas = new MetricasExecutor();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, metricas });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});

interface Sessao {
  cookie: string;
  csrf: string;
}
async function entrar(login: string, estabelecimento = 'aa'): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento, login, senha: SENHA },
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
const h = (s: Sessao) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': `teste-m39-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
const put = (s: Sessao, url: string, payload: unknown) =>
  app.inject({ method: 'PUT', url, headers: h(s), payload: payload as Record<string, unknown> });
const M = '/api/administracao/coexistencia/migracao';
const J = 'Registro sintético do comitê de coexistência';

describe('onda 1: lista para ligar o setor e indicadores de disputa', { timeout: 30_000 }, () => {
  it('o painel da onda 1: três setores, operações calculadas pelo catálogo, itens pendentes e as telas', async () => {
    const s = await entrar('SINT.ADMIN');
    const r = await get(s, `${M}/onda1`);
    expect(r.statusCode, r.body).toBe(200);
    const p = r.json();
    expect(p.avaliacoes.map((a: { setor: string }) => a.setor)).toEqual([
      'cadastros-estrutura',
      'agendamento',
      'recepcao-ambulatorial',
    ]);
    const ag = p.avaliacoes.find((a: { setor: string }) => a.setor === 'agendamento');
    // Nenhuma operação está conferida no catálogo: o veredito é "falta" e o item das operações diz quantas.
    expect(ag.veredito).toBe('falta');
    const ops = ag.itens.find((i: { item: string }) => i.item === 'operacoes-conferidas');
    expect(ops.situacao).toBe('pendente');
    expect(ops.detalhe).toMatch(/^0 de \d+ conferidas; faltam: agenda\./);
    expect(ag.foraDaOnda.map((x: { nome: string }) => x.nome)).toContain('agenda.agendarExame');
    // O agendamento não tem TV nem leitor; a recepção tem.
    expect(ag.itens.some((i: { item: string }) => i.item === 'tvs')).toBe(false);
    const rec = p.avaliacoes.find((a: { setor: string }) => a.setor === 'recepcao-ambulatorial');
    expect(rec.itens.some((i: { item: string }) => i.item === 'tvs')).toBe(true);
    expect(p.telas.length).toBeGreaterThanOrEqual(9);
    expect(p.disputa.setores).toHaveLength(3);
    expect(JSON.stringify(p)).not.toMatch(/spdata/i);
  });

  it('registrar itens: o das operações é recusado; evidência sem documento nem e-mail; cumprido pede data', async () => {
    const s = await entrar('SINT.ADMIN');
    const url = `${M}/onda1/ligar/agendamento`;
    const item = (x: Record<string, unknown>) => ({ itens: [x], justificativa: J });
    expect(
      (
        await put(
          s,
          url,
          item({ item: 'operacoes-conferidas', situacao: 'cumprido', evidencia: 'x', em: '2026-11-09' }),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await put(
          s,
          url,
          item({
            item: 'aceite-jornada',
            situacao: 'cumprido',
            evidencia: 'ata 123.456.789-09',
            em: '2026-11-09',
          }),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await put(
          s,
          url,
          item({ item: 'aceite-jornada', situacao: 'cumprido', evidencia: 'fulano@x', em: '2026-11-09' }),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (await put(s, url, item({ item: 'aceite-jornada', situacao: 'cumprido', evidencia: 'ata 7' })))
        .statusCode,
    ).toBe(400);
    expect((await put(s, url, { itens: [{ item: 'tvs', situacao: 'pendente' }] })).statusCode).toBe(400);
    expect(
      (await put(s, `${M}/onda1/ligar/sadt`, item({ item: 'tvs', situacao: 'pendente' }))).statusCode,
    ).toBe(404);
    // Sem a permissão de editar setor: 403.
    const recepcao = await entrar('SINT.RECEPCAO');
    expect((await put(recepcao, url, item({ item: 'tvs', situacao: 'pendente' }))).statusCode).toBe(403);
    const ok = await put(s, url, {
      itens: [
        {
          item: 'aceite-jornada',
          situacao: 'cumprido',
          evidencia: 'docs/homologacao/pc/ata-agenda.md',
          em: '2026-11-09',
        },
        { item: 'canal-chamados', situacao: 'nao-se-aplica', evidencia: 'chamado 42', em: '2026-11-09' },
      ],
      justificativa: J,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toEqual({ gravados: 2 });
    const ag = (await get(s, `${M}/onda1`))
      .json()
      .avaliacoes.find((a: { setor: string }) => a.setor === 'agendamento');
    expect(ag.itens.find((i: { item: string }) => i.item === 'aceite-jornada')).toMatchObject({
      situacao: 'cumprido',
      detalhe: 'em 2026-11-09; docs/homologacao/pc/ata-agenda.md',
    });
    expect(ag.registrados.find((i: { item: string }) => i.item === 'canal-chamados')).toMatchObject({
      situacao: 'nao-se-aplica',
      alteradoPor: 'SINT.ADMIN',
    });
    const ev = trilha.eventos.filter((e) => e.evento === 'coexistencia.ligar.alterado').at(-1);
    expect(ev?.chaveNaturalAlvo).toBe(J);
  });

  it('indicadores de disputa: recusas por horário ocupado, colisões e esperas por trava, com as parcelas', async () => {
    const s = await entrar('SINT.ADMIN');
    metricas.registrar('agenda.agendarConsulta', 'aa', 'recusa', new Date(), 'horario-ocupado');
    metricas.registrar('agenda.remarcarConsulta', 'aa', 'recusa', new Date(), 'horario-ocupado');
    metricas.registrar('agenda.agendarConsulta', 'aa', 'trava');
    metricas.registrar('agenda.cancelarConsulta', 'aa', 'conflito-versao');
    metricas.registrar('recepcao.chamarSenha', 'aa', 'trava');
    // Outro estabelecimento não entra.
    metricas.registrar('agenda.agendarConsulta', 'bb', 'recusa', new Date(), 'horario-ocupado');
    const r = await get(s, `${M}/indicadores`);
    expect(r.statusCode, r.body).toBe(200);
    const hoje = r.json().disputa.at(-1);
    const ag = hoje.setores.find((x: { setor: string }) => x.setor === 'agendamento');
    expect(ag.recusasHorarioOcupado).toBe(2);
    expect(ag.parcelas['recusas-horario-ocupado']).toBe('agendarConsulta 1 + remarcarConsulta 1 = 2');
    expect(ag.parcelas['colisoes-grade']).toBe('agendarConsulta 1 + cancelarConsulta 1 = 2');
    expect(ag.colisoesGrade).toBe(2);
    expect(ag.esperasTrava).toBe(1);
    const rec = hoje.setores.find((x: { setor: string }) => x.setor === 'recepcao-ambulatorial');
    expect(rec.esperasTrava).toBe(1);
    expect(rec.senhas).toEqual({ noNovo: 12, noOutro: 18, total: 30 });
    expect(rec.parcelas['senhas-por-sistema']).toBe('12 no novo + 18 no outro = 30');
    const painel = (await get(s, `${M}/onda1`)).json();
    expect(
      painel.disputa.setores.find((x: { setor: string }) => x.setor === 'agendamento').recusasHorarioOcupado,
    ).toBe(2);
  });

  it('lote de um setor da onda 1 em dev/ci: segue com o aviso do que falta na lista', async () => {
    const s = await entrar('SINT.ADMIN');
    const post = (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, headers: h(s), payload: payload as Record<string, unknown> });
    const ex = { exercicio: 'Chamar a senha e abrir o atendimento do paciente sintético.' };
    expect((await post(`${M}/treinamento/trilhas/recepcao/1`, ex)).statusCode).toBe(200);
    expect(
      (
        await post(`${M}/treinamento/conclusoes`, {
          logins: ['SINT.TURMA01', 'SINT.TURMA02'],
          papel: 'recepcao',
          onda: 1,
          turma: 'T1',
          concluidoEm: '2026-11-04',
          resultado: 'aprovado',
        })
      ).statusCode,
    ).toBe(200);
    for (const situacao of ['homologacao', 'treinamento', 'liberado'])
      expect(
        (await post(`${M}/setores/recepcao-ambulatorial`, { situacao, justificativa: J })).statusCode,
      ).toBe(200);
    const r = await post(`${M}/lotes`, {
      setor: 'recepcao-ambulatorial',
      alvo: { tipo: 'setor', valores: [] },
      justificativa: J,
      senha: SENHA,
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().avisoLigar).toMatch(/^A lista para ligar o setor não está completa: /);
  });
});

describe(
  'onda 1: fora de dev/ci, o lote de um setor da onda 1 exige a lista completa (regra 1)',
  { timeout: 30_000 },
  () => {
    const sessao = (hospital: string): SessaoCadastro => ({
      req: { headers: {}, ip: '127.0.0.1' } as unknown as SessaoCadastro['req'],
      hospital,
      rede: 'r',
      login: 'SINT.ADMIN',
      porta: { rede: 'r', hospital },
      pode: () => true,
    });
    const servico = (ambiente: string) =>
      new ServicoMigracao({
        porta: new PortaCoexistenciaMemoria(
          new RegistradorTrilhaMemoria(),
          fonteConfiguracaoMemoria(new RegistradorTrilhaMemoria()),
        ),
        trilha: new RegistradorTrilhaMemoria(),
        administracao: null,
        fonteConfig: null,
        cache: null,
        caminhoCatalogo: resolve(import.meta.dirname, '../../../../../docs/operacoes/catalogo'),
        ambiente,
        grafana: null,
        metodoMascaramento: null,
        primeiro: { codigo: 'pc', nome: 'ProntoCardio' },
      });
    const pedido = (setor: string) => ({
      setor,
      alvo: { tipo: 'setor', valores: [] },
      justificativa: J,
    });

    it('homologação: recusa 409 com o código e o que falta; setor de outra onda segue a regra do M37', async () => {
      const e = await servico('homologacao')
        .aplicarLote(sessao('pc'), pedido('agendamento'))
        .then(
          () => null,
          (x: unknown) => x as ErroProblema,
        );
      expect(e?.getStatus()).toBe(409);
      expect(e?.extras).toMatchObject({ codigo: 'lista-ligar-incompleta' });
      expect(e?.detalhe).toContain('Aceite da jornada pelo chave-usuário');
      // O setor da onda 2 não passa pela lista da onda 1 (o M37 recusa por outro motivo: ninguém para liberar).
      const outro = await servico('homologacao')
        .aplicarLote(sessao('pc'), pedido('sadt'))
        .then(
          () => null,
          (x: unknown) => x as ErroProblema,
        );
      expect(outro?.extras).not.toMatchObject({ codigo: 'lista-ligar-incompleta' });
    });

    it('o retrato de 15 min grava a disputa do executor no uso do dia (as operações sem medida de parcela também)', async () => {
      const m = new MetricasExecutor();
      m.registrar('agenda.agendarConsulta', 'pc', 'recusa', new Date(), 'horario-ocupado');
      m.registrar('agenda.encaixar', 'pc', 'trava');
      const porta = new PortaCoexistenciaMemoria(
        new RegistradorTrilhaMemoria(),
        fonteConfiguracaoMemoria(new RegistradorTrilhaMemoria()),
      );
      const s = new ServicoMigracao({
        porta,
        trilha: new RegistradorTrilhaMemoria(),
        administracao: null,
        fonteConfig: null,
        cache: null,
        caminhoCatalogo: '/nao/existe.yaml',
        ambiente: 'homologacao',
        grafana: null,
        metodoMascaramento: null,
        metricas: m,
      });
      expect(await s.gravarDiaCorrente({ rede: 'r', hospital: 'pc' })).toBeGreaterThan(0);
      const hoje = (await porta.relogio()).hoje;
      const uso = await porta.usoDia({ rede: 'r', hospital: 'pc' }, hoje);
      expect(uso.find((u) => u.operacao === 'agenda.agendarConsulta')).toMatchObject({
        recusasOcupado: 1,
        colisoes: 0,
      });
      expect(uso.find((u) => u.operacao === 'agenda.encaixar')).toMatchObject({
        setor: 'agendamento',
        colisoes: 1,
        esperasTrava: 1,
      });
      // Revisão do M39: o retrato seguinte soma só o que se contou depois (nada em dobro).
      m.registrar('agenda.agendarConsulta', 'pc', 'recusa', new Date(), 'horario-ocupado');
      m.registrar('agenda.agendarConsulta', 'pc', 'recusa', new Date(), 'horario-ocupado');
      await s.gravarDiaCorrente({ rede: 'r', hospital: 'pc' });
      await s.gravarDiaCorrente({ rede: 'r', hospital: 'pc' });
      const depois = await porta.usoDia({ rede: 'r', hospital: 'pc' }, hoje);
      expect(depois.find((u) => u.operacao === 'agenda.agendarConsulta')?.recusasOcupado).toBe(3);
      expect(depois.find((u) => u.operacao === 'agenda.encaixar')?.esperasTrava).toBe(1);
      // A API reinicia no meio do dia (um processo novo, o executor do zero): 2 recusas novas somam aos 3 do banco.
      const m2 = new MetricasExecutor();
      m2.registrar('agenda.agendarConsulta', 'pc', 'recusa', new Date(), 'horario-ocupado');
      m2.registrar('agenda.agendarConsulta', 'pc', 'recusa', new Date(), 'horario-ocupado');
      const s2 = new ServicoMigracao({
        porta,
        trilha: new RegistradorTrilhaMemoria(),
        administracao: null,
        fonteConfig: null,
        cache: null,
        caminhoCatalogo: '/nao/existe.yaml',
        ambiente: 'homologacao',
        grafana: null,
        metodoMascaramento: null,
        metricas: m2,
      });
      await s2.gravarDiaCorrente({ rede: 'r', hospital: 'pc' });
      const reiniciado = await porta.usoDia({ rede: 'r', hospital: 'pc' }, hoje);
      expect(reiniciado.find((u) => u.operacao === 'agenda.agendarConsulta')?.recusasOcupado).toBe(5);
    });

    it('o segundo estabelecimento fica bloqueado (DP-4) até todas as ondas do primeiro', async () => {
      const p = await servico('homologacao').painelOnda1(sessao('hs'));
      expect(p.avaliacoes.every((a) => a.veredito === 'bloqueado')).toBe(true);
      expect(p.avaliacoes[0]?.bloqueio).toMatch(/DP-4/);
    });
  },
);
