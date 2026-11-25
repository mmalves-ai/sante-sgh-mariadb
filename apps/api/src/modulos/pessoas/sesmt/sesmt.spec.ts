// M52.5 (fatia F5) pela HTTP, com a sessão real sobre a fonte sintética e as portas da gestão de pessoas e do SESMT EM
// MEMÓRIA (nada conecta a banco; pessoas sintéticas): com a chave desligada, as telas ficam em consulta e as gravações
// dão 403; com a chave ligada, o ASO admissional e o periódico com o próximo calculado, a retificação, as recusas da
// regra 17; as vacinas e o anti-HBs; o acidente com material biológico (profilaxia sugerida, sorologia, prazo da CAT,
// emissão, encerramento); o mapa de riscos e o EPI exigido, a entrega com CA vencido recusada, a assinatura, a dose do
// ano; o painel com as pendências; as leituras de saúde auditadas; os documentos; e a segregação da regra 16 (o médico
// do PEP não abre o SESMT e o SESMT não abre o PEP).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DynamicModule, Module } from '@nestjs/common';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import {
  type ChaveLiberacao,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
  type PrerequisitoRecurso,
  fonteConfiguracaoMemoria,
} from '../../config/public-api.js';
import { REGISTRO_MODULOS } from '../../registro.js';
import { PORTA_PESSOAS } from '../porta.js';
import { PortaPessoasMemoria } from '../porta-memoria.js';
import { PORTA_SESMT, type PortaSesmt } from './porta-sesmt.js';
import { PortaSesmtMemoria } from './porta-sesmt-memoria.js';
import { SesmtController } from './sesmt.controller.js';
import { ctxTeste, trilhaTeste } from './contexto-teste.spec-util.js';

// O controller do SESMT entra pelo `registro` do criarApp com as portas em memória (o módulo pessoas do registro é
// montado por outro lote); o PEP entra pelo registro real, para a segregação da regra 16.
@Module({})
class ModuloSesmtTeste {}
const moduloSesmt = (
  porta: PortaSesmt,
  p: PortaPessoasMemoria,
  configuracao: FonteConfiguracao | null,
): DynamicModule => ({
  module: ModuloSesmtTeste,
  controllers: [SesmtController],
  providers: [
    { provide: PORTA_SESMT, useValue: porta },
    { provide: PORTA_PESSOAS, useValue: p },
    ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
  ],
});
const registroCom = (porta: PortaSesmt, p: PortaPessoasMemoria, configuracao: FonteConfiguracao | null) => ({
  ...(REGISTRO_MODULOS['pep'] ? { pep: REGISTRO_MODULOS['pep'] } : {}),
  pessoas: async () => ({ modulo: () => moduloSesmt(porta, p, configuracao) }),
});

describe('SESMT pela HTTP', () => {
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'pep,pessoas' };
  const chave: ChaveLiberacao = {
    id: 'pessoas.sesmt',
    tipo: 'recurso',
    chave: 'pessoas.sesmt',
    escopo: 'hospital',
    valor: '*',
    ligada: true,
    ligadaAntes: null,
    lote: null,
    justificativa: 'teste sintético',
    alteradoPor: 'SINT.ADMIN',
    alteradoEm: '2026-10-25T10:00:00',
  };
  const conferencia: PrerequisitoRecurso = {
    recurso: 'pessoas.sesmt',
    tipo: 'aprovacao',
    situacao: 'cumprido',
    validade: null,
    evidencia: 'conferência sintética',
    alteradoPor: 'SINT.ADMIN',
    alteradoEm: '2026-10-25T10:00:00',
  };

  let ligado: NestFastifyApplication;
  let desligado: NestFastifyApplication;
  const trilha = new RegistradorTrilhaMemoria();
  const pessoas = new PortaPessoasMemoria();
  const sesmt = new PortaSesmtMemoria(pessoas);
  sesmt.agoraFixo = '2026-10-26T10:00';
  let vinculo = 0;
  let outro = 0;
  let desligadoVinculo = 0;

  async function semear(
    p: PortaPessoasMemoria,
    hospital: string,
    nome: string,
    extra: Record<string, unknown> = {},
  ) {
    return p.gravarSgh(
      ctxTeste(hospital),
      trilhaTeste('vinculo_trabalho'),
      async (g) =>
        (
          await g.incluirVinculo({
            pessoa: null,
            cpfHmac: `h-${nome}`.padEnd(64, '0'),
            cpfCifrado: 'v1.sintetico',
            nome,
            profissional: null,
            usuario: null,
            tipo: 'clt',
            matricula: null,
            cargo: 'Técnico de enfermagem',
            funcao: null,
            cargaSemanal: 36,
            centroCusto: 9521,
            unidade: 1,
            setor: null,
            admissao: '2025-01-10',
            por: 'SINT.RH',
            ...extra,
          } as never)
        ).id,
    );
  }

  beforeAll(async () => {
    vinculo = await semear(pessoas, 'aa', 'COLABORADORA SINTETICA SESMT');
    outro = await semear(pessoas, 'bb', 'COLABORADOR DE OUTRO HOSPITAL');
    const d = await semear(pessoas, 'aa', 'COLABORADOR SINTETICO DESLIGADO');
    await pessoas.gravarSgh(ctxTeste('aa'), trilhaTeste('vinculo_trabalho'), async (g) => {
      await g.desligarVinculo({
        id: d,
        versao: 0,
        data: '2026-09-30',
        tipoRescisao: 1,
        motivo: 'Desligamento sintético do teste.',
        por: 'SINT.RH',
      } as never);
    });
    desligadoVinculo = d;
    ligado = await criarApp(lerConfiguracao(env), null, env, {
      trilha,
      registro: registroCom(
        sesmt,
        pessoas,
        fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: () => [chave],
          prerequisitosIniciais: () => [conferencia],
        }),
      ),
    });
    desligado = await criarApp(lerConfiguracao(env), null, env, {
      registro: registroCom(new PortaSesmtMemoria(pessoas), pessoas, null),
    });
    for (const a of [ligado, desligado]) {
      await a.init();
      await a.getHttpAdapter().getInstance().ready();
    }
  }, 120_000);
  afterAll(async () => {
    await ligado.close();
    await desligado.close();
  });

  interface Sessao {
    cookie: string;
    csrf: string;
  }
  async function entrar(app: NestFastifyApplication, login: string): Promise<Sessao> {
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
  const pedir = (app: NestFastifyApplication, s: Sessao) => {
    const h = () => ({ cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `m525-teste-${++n}` });
    return {
      get: (url: string) => app.inject({ method: 'GET', url, headers: h() }),
      post: (url: string, payload: unknown) =>
        app.inject({ method: 'POST', url, payload: payload as object, headers: h() }),
    };
  };
  const P = '/api/pessoas/sesmt';
  /** Com o Gotenberg no ar o documento sai em PDF; sem ele, o HTML que seria convertido (com o conteúdo conferido). */
  const pdfOuHtml = (r: { headers: Record<string, unknown>; body: string }, textos: readonly string[]) =>
    String(r.headers['content-type']).includes('application/pdf')
      ? r.body.startsWith('%PDF')
      : textos.every((t) => r.body.includes(t)) && !/paciente/i.test(r.body);
  const aso = (extra: Record<string, unknown> = {}) => ({
    tipo: 0,
    data: '2025-01-05',
    conclusao: 1,
    medico: 'MEDICA DO TRABALHO SINTETICA',
    medicoConselho: 'CRM 0000',
    exames: [{ exame: 'Hemograma completo', data: '2025-01-03', resultado: 'normal' }],
    ...extra,
  });

  describe('SESMT pela HTTP (M52.5)', () => {
    it('chave desligada: apoio em consulta com o motivo; gravação 403; quem só consulta não grava', async () => {
      const c = pedir(desligado, await entrar(desligado, 'SINT.SESMT'));
      const a = await c.get(`${P}/aso/apoio`);
      expect(a.statusCode).toBe(200);
      expect(a.json().gravacao.ligada).toBe(false);
      expect(a.json().acoes.ocupacional).toBe(false);
      expect((await c.post(`${P}/aso/${vinculo}`, aso())).statusCode).toBe(403);
      const q = pedir(ligado, await entrar(ligado, 'SINT.SESMT.CONSULTA'));
      const ap = (await q.get(`${P}/vacinas/apoio`)).json();
      expect([ap.acoes.vacina, ap.acoes.ocupacional]).toEqual([false, false]);
      expect((await q.post(`${P}/aso/${vinculo}`, aso())).statusCode).toBe(403);
      expect((await q.get(`${P}/aso/${vinculo}`)).statusCode).toBe(200);
    });

    it('regra 16: o médico do PEP não abre o SESMT; o SESMT não abre o PEP; 404 de outro estabelecimento', async () => {
      const med = pedir(ligado, await entrar(ligado, 'SINT.MEDICO'));
      for (const u of [
        `${P}/aso/${vinculo}`,
        `${P}/vacinas/${vinculo}`,
        `${P}/acidentes`,
        `${P}/painel`,
        `${P}/epi/${vinculo}`,
      ])
        expect((await med.get(u)).statusCode).toBe(403);
      const s = pedir(ligado, await entrar(ligado, 'SINT.SESMT'));
      expect((await s.get('/api/pep/prontuario/1')).statusCode).toBe(403);
      // A memória numera por estabelecimento: o ID inexistente aqui dá 404 (o outro hospital: integração na cópia).
      expect((await s.get(`${P}/aso/${outro + 999_000}`)).statusCode).toBe(404);
    });

    it('ASO (regra 17): admissional, periódico com o próximo calculado, retificação, recusas, leitura auditada', async () => {
      const s = pedir(ligado, await entrar(ligado, 'SINT.SESMT'));
      const sem = await s.post(`${P}/aso/${vinculo}`, aso({ tipo: 1 }));
      expect([sem.statusCode, sem.json().codigo]).toEqual([409, 'sem-admissional']);
      const adm = await s.post(`${P}/aso/${vinculo}`, aso());
      expect(adm.statusCode).toBe(200);
      const rep = await s.post(`${P}/aso/${vinculo}`, aso());
      expect(rep.json().codigo).toBe('admissional-repetido');
      const inapto = await s.post(`${P}/aso/${vinculo}`, aso({ tipo: 1, data: '2026-01-10', conclusao: 2 }));
      expect(inapto.json().codigo).toBe('inapto-sem-motivo');
      const ret = await s.post(
        `${P}/aso/${vinculo}`,
        aso({
          data: '2025-01-06',
          retifica: adm.json().id,
          motivoRetificacao: 'Data do exame digitada errada.',
        }),
      );
      expect([ret.statusCode, ret.json().mensagem]).toEqual([200, 'ASO retificado.']);
      const r2 = await s.post(
        `${P}/aso/${vinculo}`,
        aso({ retifica: adm.json().id, motivoRetificacao: 'Segunda retificação do mesmo.' }),
      );
      expect(r2.json().codigo).toBe('ja-retificado');
      const antes = trilha.eventos.filter((e) => e.evento === 'pessoas.ocupacional.lido').length;
      const p = (await s.get(`${P}/aso/${vinculo}`)).json();
      expect(trilha.eventos.filter((e) => e.evento === 'pessoas.ocupacional.lido').length).toBe(antes + 1);
      // O admissional de 06/01/2025 vale 12 meses: em 26/10/2026 está vencido.
      expect([p.aso.situacao, p.aso.proximo]).toEqual(['vencido', '2026-01-06']);
      expect(p.asos.find((a: { id: number }) => a.id === adm.json().id).retificadoPor).toBe(ret.json().id);
      expect(p.pendencias.map((x: { codigo: string }) => x.codigo)).toEqual(['aso-vencido']);
      expect(p.pedidoExame.integrado).toBe(false);
      const per = await s.post(
        `${P}/aso/${vinculo}`,
        aso({
          tipo: 1,
          data: '2026-10-20',
          exames: [{ exame: 'Audiometria', data: '2026-10-19', resultado: 'alterado' }],
        }),
      );
      expect(per.statusCode).toBe(200);
      const p2 = (await s.get(`${P}/aso/${vinculo}`)).json();
      expect([p2.aso.situacao, p2.aso.proximo]).toEqual(['valido', '2027-10-20']);
      expect(p2.asos[0].exames[0]).toMatchObject({ exame: 'Audiometria', resultado: 'alterado' });
      const desl = await s.post(`${P}/aso/${desligadoVinculo}`, aso({ tipo: 1, data: '2026-10-01' }));
      expect(desl.json().codigo).toBe('vinculo-desligado');
    });

    it('vacinas (regra 17): dose com lote vencido recusada, esquema da hepatite B e anti-HBs', async () => {
      const s = pedir(ligado, await entrar(ligado, 'SINT.SESMT'));
      const dose = (d: string, data: string, validadeLote = '2027-12-31') =>
        s.post(`${P}/vacinas/${vinculo}`, {
          registro: 'dose',
          vacina: 'hepatite-b',
          dose: d,
          data,
          lote: 'L-SINT',
          validadeLote,
        });
      expect((await dose('1', '2026-01-10', '2025-12-31')).json().codigo).toBe('lote-vencido');
      for (const [d, data] of [
        ['1', '2026-01-10'],
        ['2', '2026-02-10'],
        ['3', '2026-07-10'],
      ] as const)
        expect((await dose(d, data)).statusCode).toBe(200);
      expect((await dose('2', '2026-08-10')).json().codigo).toBe('dose-repetida');
      // D-VAC-525: o código vem do domínio lido pela descrição (Hepatite B = 8 no sintético), nunca "outras" (7).
      expect(sesmt.codigosVacinaGravados.slice(-3)).toEqual([
        { vacina: 'hepatite-b', codigo: 8, dose: 1 },
        { vacina: 'hepatite-b', codigo: 8, dose: 2 },
        { vacina: 'hepatite-b', codigo: 8, dose: 3 },
      ]);
      let c = (await s.get(`${P}/vacinas/${vinculo}`)).json();
      const hb = () => c.situacao.find((x: { vacina: string }) => x.vacina === 'hepatite-b');
      expect(hb().pendencias.map((x: { codigo: string }) => x.codigo)).toEqual(['anti-hbs-pendente']);
      expect(
        (
          await s.post(`${P}/vacinas/${vinculo}`, {
            registro: 'anti-hbs',
            vacina: 'hepatite-b',
            data: '2026-08-20',
            antiHbs: 85,
          })
        ).statusCode,
      ).toBe(200);
      c = (await s.get(`${P}/vacinas/${vinculo}`)).json();
      expect([hb().completo, hb().antiHbs, hb().pendencias]).toEqual([true, 85, []]);
    });

    it('acidente (regra 18): biológico com profilaxia sugerida, sorologia, prazo e emissão da CAT, PDF, encerramento', async () => {
      const s = pedir(ligado, await entrar(ligado, 'SINT.SESMT'));
      const novo = {
        vinculo,
        ocorridoEm: '2026-10-23T22:30',
        tipo: 'tipico',
        local: 'Posto de enfermagem 2',
        descricao: 'Picada de agulha ao descartar material perfurocortante.',
        biologico: true,
        perfurocortante: true,
        exposicao: 'percutanea',
        material: 'sangue',
        fonte: 'conhecida',
        parteCorpo: 753050000,
      };
      expect(
        (await s.post(`${P}/acidentes`, { ...novo, ocorridoEm: '2026-10-27T08:00' })).json().codigo,
      ).toBe('acidente-futuro');
      expect((await s.post(`${P}/acidentes`, { ...novo, parteCorpo: 1 })).json().codigo).toBe(
        'codigo-invalido',
      );
      const r = await s.post(`${P}/acidentes`, novo);
      expect(r.statusCode).toBe(200);
      const id = r.json().id;
      let a = (await s.get(`${P}/acidentes/${id}`)).json();
      // Sexta à noite: a CAT vence na segunda; a profilaxia foi sugerida (indicada); quatro marcos de sorologia.
      expect([a.catPrazo, a.profilaxia, a.sorologias.length]).toEqual(['2026-10-26', 'indicada', 4]);
      expect(a.pendencias.map((x: { codigo: string }) => x.codigo)).toEqual([
        'cat-prazo',
        'profilaxia-indicada',
      ]);
      expect(
        (
          await s.post(`${P}/acidentes/${id}/profilaxia`, {
            versao: a.versao,
            profilaxia: 'iniciada',
            profilaxiaEm: '2026-10-23T23:10',
          })
        ).statusCode,
      ).toBe(200);
      a = (await s.get(`${P}/acidentes/${id}`)).json();
      expect(
        (
          await s.post(`${P}/acidentes/${id}/encerramento`, {
            versao: a.versao,
            motivo: 'Fim do acompanhamento.',
          })
        ).json().codigo,
      ).toBe('sem-cat');
      expect((await s.get(`${P}/acidentes/${id}/cat/pdf`)).json().codigo).toBe('sem-cat');
      const cat = await s.post(`${P}/acidentes/${id}/cat`, {
        versao: a.versao,
        tipoCat: 1,
        iniciativa: 1,
        numero: 'SINT-CAT-0001',
        emitidaEm: '2026-10-26',
      });
      expect([cat.statusCode, cat.json().mensagem]).toEqual([200, 'CAT registrada.']);
      const velho = await s.post(`${P}/acidentes/${id}/cat`, {
        versao: a.versao,
        tipoCat: 2,
        numero: 'X',
        emitidaEm: '2026-10-26',
      });
      expect(velho.json().codigo).toBe('desatualizado');
      // D-CAT-525: a CAT inicial nunca é sobrescrita (nem repetida, nem trocada pela de reabertura ou de óbito).
      const atual = (await s.get(`${P}/acidentes/${id}`)).json();
      for (const [tipoCat, codigo] of [
        [1, 'cat-ja-emitida'],
        [2, 'cat-reabertura-pendente'],
        [3, 'cat-reabertura-pendente'],
      ] as const)
        expect(
          (
            await s.post(`${P}/acidentes/${id}/cat`, {
              versao: atual.versao,
              tipoCat,
              numero: 'SINT-CAT-0002',
              emitidaEm: '2026-10-26',
            })
          ).json().codigo,
        ).toBe(codigo);
      expect((await s.get(`${P}/acidentes/${id}`)).json()).toMatchObject({ catNumero: 'SINT-CAT-0001' });
      const pdf = await s.get(`${P}/acidentes/${id}/cat/pdf`);
      expect(pdf.statusCode).toBe(200);
      expect(pdfOuHtml(pdf, ['SINT-CAT-0001', 'Dedo'])).toBe(true);
      for (const m of ['d0', 'd30', 'd90', 'd180'])
        expect(
          (await s.post(`${P}/acidentes/${id}/sorologia`, { marco: m, resultado: 'nao-realizada' }))
            .statusCode,
        ).toBe(200);
      expect(
        (await s.post(`${P}/acidentes/${id}/sorologia`, { marco: 'd0', resultado: 'nao-realizada' })).json()
          .codigo,
      ).toBe('desatualizado');
      a = (await s.get(`${P}/acidentes/${id}`)).json();
      expect(
        (
          await s.post(`${P}/acidentes/${id}/encerramento`, {
            versao: a.versao,
            motivo: 'Fim do acompanhamento.',
          })
        ).statusCode,
      ).toBe(200);
      const lista = (await s.get(`${P}/acidentes?estado=todos`)).json();
      expect(lista.itens[0]).toMatchObject({ id, estado: 'encerrado', nome: 'COLABORADORA SINTETICA SESMT' });
    });

    it('riscos e EPI (regra 19): EPI exigido falta, CA vencido recusado, comprovante, assinatura, dose do ano', async () => {
      const s = pedir(ligado, await entrar(ligado, 'SINT.SESMT'));
      const fat = (await s.get(`${P}/riscos/fatores?termo=biol`)).json();
      expect(fat.itens[0].codigo).toBe('03.01.001');
      expect(
        (
          await s.post(`${P}/riscos`, {
            funcao: 'Técnico de enfermagem',
            tipo: 'risco',
            fatorRisco: '99.99',
            grupoRisco: 'B',
            inicio: '2026-01-01',
          })
        ).json().codigo,
      ).toBe('fator-invalido');
      expect(
        (
          await s.post(`${P}/riscos`, {
            funcao: 'Técnico de enfermagem',
            tipo: 'risco',
            fatorRisco: '03.01.001',
            grupoRisco: 'B',
            epc: 2,
            inicio: '2026-01-01',
          })
        ).statusCode,
      ).toBe(200);
      const luva = await s.post(`${P}/riscos`, {
        funcao: 'TECNICO DE ENFERMAGEM',
        tipo: 'epi',
        epi: 'Luva de procedimento',
        inicio: '2026-01-01',
      });
      expect(luva.statusCode).toBe(200);
      let e = (await s.get(`${P}/epi/${vinculo}`)).json();
      expect(e.riscos.map((r: { tipo: string }) => r.tipo).sort()).toEqual(['epi', 'risco']);
      expect(e.riscos.find((r: { tipo: string }) => r.tipo === 'risco').fatorRiscoRotulo).toMatch(
        /biológicos/,
      );
      expect(e.episFaltando).toEqual(['Luva de procedimento']);
      const entrega = {
        tipo: 'epi',
        data: '2026-10-26',
        epi: 'Luva de procedimento',
        caNumero: '12345',
        quantidade: 2,
      };
      expect(
        (await s.post(`${P}/epi/${vinculo}`, { ...entrega, caValidade: '2026-10-25' })).json().codigo,
      ).toBe('ca-vencido');
      const ok = await s.post(`${P}/epi/${vinculo}`, { ...entrega, caValidade: '2027-10-25' });
      expect(ok.statusCode).toBe(200);
      const comp = await s.get(`${P}/epi/entregas/${ok.json().id}/comprovante/pdf`);
      expect(pdfOuHtml(comp, ['12345', 'Luva de procedimento'])).toBe(true);
      e = (await s.get(`${P}/epi/${vinculo}`)).json();
      expect([e.episFaltando, e.pendencias.map((x: { codigo: string }) => x.codigo)]).toEqual([
        [],
        ['epi-assinatura'],
      ]);
      expect(
        (await s.post(`${P}/epi/entregas/${ok.json().id}/assinatura`, { conferida: true })).statusCode,
      ).toBe(200);
      expect(
        (await s.post(`${P}/epi/entregas/${ok.json().id}/assinatura`, { conferida: true })).json().codigo,
      ).toBe('ja-assinada');
      for (const [ini, fim, dose] of [
        ['2026-06-01', '2026-06-30', 8.5],
        ['2026-09-01', '2026-09-30', 12],
      ] as const)
        expect(
          (
            await s.post(`${P}/epi/${vinculo}`, {
              tipo: 'dosimetria',
              periodoInicio: ini,
              data: fim,
              doseMsv: dose,
              dosimetro: 'DOS-SINT-1',
            })
          ).statusCode,
        ).toBe(200);
      expect(
        (
          await s.post(`${P}/epi/${vinculo}`, {
            tipo: 'quimio',
            data: '2026-10-20',
            agente: 'Ciclofosfamida',
            duracaoMin: 30,
          })
        ).statusCode,
      ).toBe(200);
      e = (await s.get(`${P}/epi/${vinculo}`)).json();
      expect(e.dose).toEqual({ ano: 2026, totalMsv: 20.5, parcelasMsv: [8.5, 12], situacao: 'acima-limite' });
      expect(e.pendencias.map((x: { codigo: string }) => x.codigo)).toEqual(['dose-acima-limite']);
      // C1-119: o cancelamento leva o tipo junto do id; a leitura lançada por engano sai da dose do ano e fica na lista.
      const errada = await s.post(`${P}/epi/${vinculo}`, {
        tipo: 'dosimetria',
        periodoInicio: '2026-07-01',
        data: '2026-07-31',
        doseMsv: 3,
        dosimetro: 'DOS-SINT-2',
      });
      expect(errada.statusCode).toBe(200);
      const idErrada = errada.json().id as number;
      expect((await s.get(`${P}/epi/${vinculo}`)).json().dose.totalMsv).toBe(23.5);
      expect(
        (
          await s.post(`${P}/epi/entregas/${idErrada}/cancelamento`, {
            tipo: 'quimio',
            motivo: 'Tipo trocado.',
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await s.post(`${P}/epi/entregas/${idErrada}/cancelamento`, {
            tipo: 'dosimetria',
            motivo: 'Leitura de outro dosímetro.',
          })
        ).statusCode,
      ).toBe(200);
      e = (await s.get(`${P}/epi/${vinculo}`)).json();
      expect(e.dose).toMatchObject({ totalMsv: 20.5, parcelasMsv: [8.5, 12] });
      expect(
        e.registros.find((x: { id: number; tipo: string }) => x.id === idErrada && x.tipo === 'dosimetria'),
      ).toMatchObject({ motivoCancelamento: 'Leitura de outro dosímetro.' });
      expect(e.correcoes.some((x: { registro: number }) => x.registro === idErrada)).toBe(true);
      const mapa = (await s.get(`${P}/riscos?funcao=tecnico de enfermagem`)).json();
      expect(mapa.linhas).toHaveLength(2);
      expect(
        (
          await s.post(`${P}/riscos/${luva.json().id}/encerramento`, {
            fim: '2025-12-31',
            motivo: 'Revisão do PGR do setor.',
          })
        ).json().codigo,
      ).toBe('fim-antes-inicio');
      expect(
        (
          await s.post(`${P}/riscos/${luva.json().id}/encerramento`, {
            fim: '2026-10-26',
            motivo: 'Revisão do PGR do setor.',
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await s.post(`${P}/epi/${desligadoVinculo}`, { ...entrega, caValidade: '2027-10-25' })).json()
          .codigo,
      ).toBe('desligado');
    });

    it('painel: as pendências dos ativos, as contagens, o filtro e a busca do colaborador', async () => {
      const s = pedir(ligado, await entrar(ligado, 'SINT.SESMT'));
      const p = (await s.get(`${P}/painel?somentePendentes=false`)).json();
      expect(p.ativos).toBe(1);
      expect(p.itens[0]).toMatchObject({ vinculo, proximoAso: '2027-10-20' });
      expect(p.itens[0].pendencias.map((x: { codigo: string }) => x.codigo)).toEqual([
        'dupla-incompleta',
        'dose-acima-limite',
      ]);
      expect(p.contagens).toEqual({ 'dupla-incompleta': 1, 'dose-acima-limite': 1 });
      expect((await s.get(`${P}/painel?pendencia=aso-vencido`)).json().total).toBe(0);
      const b = (await s.get(`${P}/aso/colaboradores?termo=SESMT`)).json();
      expect(b.itens.map((x: { vinculo: number }) => x.vinculo)).toEqual([vinculo]);
      expect(JSON.stringify(b)).not.toMatch(/cpf/i);
    });

    it('regra 16: o painel e a lista de acidentes são leituras auditadas; quem só lê o ASO não vê acidente, EPI nem vacina', async () => {
      const s = pedir(ligado, await entrar(ligado, 'SINT.SESMT'));
      const lidos = () => trilha.eventos.filter((e) => e.evento === 'pessoas.ocupacional.lido').length;
      let antes = lidos();
      expect((await s.get(`${P}/painel`)).statusCode).toBe(200);
      expect(lidos()).toBe(antes + 1);
      antes = lidos();
      expect((await s.get(`${P}/acidentes`)).statusCode).toBe(200);
      expect(lidos()).toBe(antes + 1);

      const completo = (await s.get(`${P}/painel?somentePendentes=false`)).json();
      expect(completo.contagens['dose-acima-limite']).toBe(1);
      const so = pedir(ligado, await entrar(ligado, 'SINT.SESMT.ASO'));
      expect((await so.get(`${P}/acidentes`)).statusCode).toBe(403);
      expect((await so.get(`${P}/epi/${vinculo}`)).statusCode).toBe(403);
      antes = lidos();
      const p = (await so.get(`${P}/painel?somentePendentes=false`)).json();
      expect(lidos()).toBe(antes + 1);
      const codigos = p.itens.flatMap((l: { pendencias: { codigo: string }[] }) =>
        l.pendencias.map((x) => x.codigo),
      );
      const ocultas = [
        'cat-atrasada',
        'sorologia-atrasada',
        'profilaxia-indicada',
        'dose-acima-limite',
        'dupla-incompleta',
        'hepatite-b-incompleta',
        'anti-hbs-nao-protetor',
      ];
      expect(codigos.filter((c: string) => ocultas.includes(c))).toEqual([]);
      expect(Object.keys(p.contagens).filter((c) => ocultas.includes(c))).toEqual([]);
      expect(p.itens[0]).toMatchObject({ vinculo, proximoAso: '2027-10-20' });
    });

    it('PPP de consulta (D-PPP-525): períodos, fatores de risco, EPI com o CA; os ASO só para quem lê o prontuário', async () => {
      const s = pedir(ligado, await entrar(ligado, 'SINT.SESMT'));
      const lidos = () => trilha.eventos.filter((e) => e.evento === 'pessoas.ocupacional.lido').length;
      const antes = lidos();
      const r = await s.get(`${P}/epi/${vinculo}/ppp`);
      expect(r.statusCode).toBe(200);
      expect(lidos()).toBe(antes + 1);
      const d = r.json();
      expect(d.periodos).toHaveLength(1);
      expect(d.periodos[0]).toMatchObject({
        inicio: '2025-01-10',
        fim: null,
        funcao: 'Técnico de enfermagem',
      });
      expect(d.periodos[0].linhas.length).toBeGreaterThan(0);
      expect(d.periodos[0].linhas.every((l: { vigenteDe: string }) => l.vigenteDe >= '2025-01-10')).toBe(
        true,
      );
      expect(
        d.registros.some((x: { tipo: string; caNumero: string | null }) => x.tipo === 'epi' && x.caNumero),
      ).toBe(true);
      expect(Array.isArray(d.asos) && d.asos.length > 0).toBe(true);
      expect(JSON.stringify(d)).not.toMatch(/cpf/i);
      const pdf = await s.get(`${P}/epi/${vinculo}/ppp/pdf`);
      expect(pdf.statusCode).toBe(200);
      expect(pdfOuHtml(pdf, ['Perfil Profissiográfico Previdenciário', 'Monitoração biológica'])).toBe(true);

      const so = pedir(ligado, await entrar(ligado, 'SINT.SESMT.PPP'));
      const q = (await so.get(`${P}/epi/${vinculo}/ppp`)).json();
      expect(q.asos).toBeNull();
      expect(q.periodos[0].linhas.length).toBe(d.periodos[0].linhas.length);
      expect((await so.get(`${P}/aso/${vinculo}`)).statusCode).toBe(403);
      const aso = pedir(ligado, await entrar(ligado, 'SINT.SESMT.ASO'));
      expect((await aso.get(`${P}/epi/${vinculo}/ppp`)).statusCode).toBe(403);
      expect((await s.get(`${P}/epi/${outro + 999_000}/ppp`)).statusCode).toBe(404);
    });
  });
});
