// W0-03, mercado M3 (critério 12): o relógio de protocolos funcionando no internado (internação e UTI), pela API — a
// sugestão pelo alerta do NEWS2, a inclusão com a hora do alerta como tempo zero (ou a do reconhecimento da suspeita),
// as recusas (aberto no atendimento, versão mudada, hora no futuro, técnico), a meta cumprida ou perdida com o motivo,
// o encerramento, a inativação por engano (só do autor, com a senha; continua visível) e os indicadores por origem
// (PA, internação, UTI) com o numerador e o denominador. Portas em memória; relógio controlado; dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PROTOCOLOS_GERENCIADOS_SINTETICOS } from '@sgh/dominio-recepcao';
import type { ProtocoloPaciente } from '../recepcao/tipos.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAppComEnfermagem } from './app-enfermagem.spec-util.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaClassificacaoMemoria } from '../recepcao/public-api.js';
import { PortaEscoresMemoria } from './escores-porta-memoria.js';
import { PortaEnfermagemMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
/** 2026-10-25 08:00 em São Paulo. */
const relogio = Date.parse('2026-10-25T11:00:00Z');
const agora = () => new Date(relogio);

interface Sessao {
  cookie: string;
  csrf: string;
}

async function montar() {
  const trilha = new RegistradorTrilhaMemoria();
  const enfermagem = new PortaEnfermagemMemoria({ agora });
  const escores = new PortaEscoresMemoria({ agora });
  const classificacao = new PortaClassificacaoMemoria({ agora, trilha });
  const app: NestFastifyApplication = await criarAppComEnfermagem(env, {
    trilha,
    enfermagem,
    escores,
    recepcao: { classificacao },
    vigiaEnfermagem: null,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  let seq = 0;
  return {
    app,
    trilha,
    escores,
    classificacao,
    async entrar(login: string): Promise<Sessao> {
      const r = await app.inject({
        method: 'POST',
        url: '/api/sessao',
        payload: { estabelecimento: 'aa', login, senha: SENHA },
      });
      expect(r.statusCode).toBe(201);
      const set = r.headers['set-cookie'] as string[];
      return {
        cookie: set.map((c) => c.split(';')[0]).join('; '),
        csrf:
          set
            .find((c) => c.startsWith('sgh_csrf='))
            ?.split(';')[0]
            ?.slice(9) ?? '',
      };
    },
    get: (s: Sessao, url: string) =>
      app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } }),
    post: (s: Sessao, url: string, payload: unknown = {}) =>
      app.inject({
        method: 'POST',
        url: `/api${url}`,
        headers: {
          cookie: s.cookie,
          'x-csrf': s.csrf,
          'idempotency-key': `teste-w003-m3-${++seq}-${Date.now()}`,
        },
        payload: payload as object,
      }),
  };
}

type Montado = Awaited<ReturnType<typeof montar>>;
let a: Montado;
beforeAll(async () => {
  a = await montar();
});
afterAll(async () => {
  await a.app.close();
});

const DOIS = { paciente: 25002, atendimento: 25102 };
const TRES = { paciente: 25003, atendimento: 25103 };
const URL = '/enfermagem/protocolos-internado';

/** O NEWS2 sintético gravado na memória (o registro pela tela dos escores é coberto pelos testes do M45). */
function news2(id: number, total: number, aferidoEm: string, x = DOIS) {
  a.escores.estado('aa').escores.push({
    id,
    paciente: x.paciente,
    reg: null,
    atendimento: x.atendimento,
    unidade: 'UTI',
    escala: 'news2',
    versaoRegra: 1,
    itens: {},
    total,
    faixa: total >= 7 ? 'alta' : 'media',
    gatilho: total >= 7 ? 'emergencia' : 'urgente',
    suspeitaInfeccao: true,
    origem: 'afericao',
    aferidoEm: `${aferidoEm}:00`,
    usuario: 'SINT.ENF.PLANTAO',
  });
}

describe('W0-03, M3: protocolos gerenciados no internado pela API', () => {
  const versoes: Record<string, number> = {};
  let sepse = 0;
  let tev = 0;

  it('a diretoria publica as definições; o relógio da UTI sugere a sepse pelo NEWS2 no limiar', async () => {
    const dir = await a.entrar('SINT.DIRETOR.CLINICO');
    for (const tipo of ['sepse', 'tev'] as const) {
      const r = await a.post(dir, '/pa/protocolos-gerenciados/definicoes', {
        autor: 'SINT.ENFERMEIRO.PA',
        conteudo: PROTOCOLOS_GERENCIADOS_SINTETICOS.find((p) => p.tipo === tipo),
        notas: 'Versão sintética do teste',
        senha: SENHA,
      });
      expect(r.statusCode, r.body).toBe(201);
      versoes[tipo] = r.json().id;
    }
    news2(9001, 4, '2026-10-25T07:00');
    news2(9002, 6, '2026-10-25T07:40');
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const r = await a.get(enf, `${URL}/relogio?unidade=UTI`);
    expect(r.statusCode, r.body).toBe(200);
    const x = r.json();
    expect(x.limiarNews2).toBe(5);
    expect(x.vigentes.map((v: { tipo: string; id: number }) => [v.tipo, v.id])).toEqual([
      ['sepse', versoes['sepse']],
      ['tev', versoes['tev']],
    ]);
    expect(x.sugestoes).toEqual([
      expect.objectContaining({ escore: 9002, atendimento: DOIS.atendimento, total: 6, local: 'uti' }),
    ]);
    expect(x.acoes).toMatchObject({ incluir: true, registrar: true, motivo: null });
    expect(a.trilha.eventos.some((e) => e.evento === 'enfermagem.protocoloInternado.lido')).toBe(true);
  });

  it('a inclusão pelo alerta usa a hora do NEWS2 como tempo zero; recusas da inclusão', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const tec = await a.entrar('SINT.TECNICO.ENF');
    const base = {
      atendimento: DOIS.atendimento,
      tipo: 'sepse',
      versao: versoes['sepse'],
      origem: 'news2',
      escore: 9002,
      criterios: ['suspeita-infeccao'],
    };
    expect((await a.post(tec, URL, base)).statusCode).toBe(403);
    const abaixo = await a.post(enf, URL, { ...base, escore: 9001 });
    expect(abaixo.json().codigo).toBe('escore-abaixo-do-limiar');
    const versao = await a.post(enf, URL, { ...base, versao: versoes['tev'] });
    expect(versao.json().codigo).toBe('versao-desatualizada');
    const criterio = await a.post(enf, URL, { ...base, criterios: ['inventado'] });
    expect(criterio.statusCode).toBe(422);
    const r = await a.post(enf, URL, base);
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().reconhecidoEm).toBe('2026-10-25T07:40');
    sepse = r.json().id;
    expect((await a.post(enf, URL, base)).json().codigo).toBe('protocolo-ja-aberto');
    const gravado = a.escores.estado('aa').protocolos!.find((p) => p.id === sepse)!;
    expect(gravado).toMatchObject({
      local: 'uti',
      origem: 'news2',
      escore: 9002,
      incluidoPor: 'SINT.ENF.PLANTAO',
    });
    // A suspeita: a hora no futuro é recusada.
    const futuro = await a.post(enf, URL, {
      atendimento: TRES.atendimento,
      tipo: 'tev',
      versao: versoes['tev'],
      origem: 'suspeita',
      reconhecidoEm: '2026-10-25T09:30',
      criterios: ['risco-alto'],
    });
    expect(futuro.json().codigo).toBe('reconhecimento-no-futuro');
    const t = await a.post(enf, URL, {
      atendimento: TRES.atendimento,
      tipo: 'tev',
      versao: versoes['tev'],
      origem: 'suspeita',
      reconhecidoEm: '2026-10-25T07:30',
      criterios: ['risco-alto'],
    });
    expect(t.statusCode, t.body).toBe(201);
    tev = t.json().id;
    // O alerta usado não é mais sugerido.
    expect((await a.get(enf, `${URL}/relogio?unidade=UTI`)).json().sugestoes).toEqual([]);
  });

  it('as metas: cumprida no prazo; atrasada sem motivo é recusada e com motivo fica perdida; encerramento', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const ok = await a.post(enf, `${URL}/${sepse}/metas`, {
      tipo: 'meta',
      codigo: 'lactato',
      situacao: 'cumprida',
      quando: '2026-10-25T08:00',
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().situacao).toBe('cumprida');
    // O antibiótico vence às 08:40 (60 min do tempo zero, 07:40): feito às 08:00, no prazo.
    const tarde = await a.post(enf, `${URL}/${sepse}/metas`, {
      tipo: 'meta',
      codigo: 'antibiotico',
      situacao: 'cumprida',
      quando: '2026-10-25T08:00',
    });
    expect(tarde.json().situacao).toBe('cumprida');
    const semMotivo = await a.post(enf, `${URL}/${sepse}/metas`, {
      tipo: 'meta',
      codigo: 'hemoculturas',
      situacao: 'perdida',
      motivo: null,
    });
    expect(semMotivo.statusCode).toBe(400);
    // A hora no futuro é recusada pelo servidor.
    const futura = await a.post(enf, `${URL}/${sepse}/metas`, {
      tipo: 'meta',
      codigo: 'hemoculturas',
      situacao: 'cumprida',
      quando: '2026-10-25T09:00',
    });
    expect(futura.json().codigo).toBe('hora-no-futuro');
    const perdida = await a.post(enf, `${URL}/${sepse}/metas`, {
      tipo: 'meta',
      codigo: 'hemoculturas',
      situacao: 'perdida',
      motivo: 'Coletadas depois do antibiótico por falta de frasco',
    });
    expect(perdida.json().situacao).toBe('perdida');
    const relogio = (await a.get(enf, `${URL}/relogio?unidade=UTI`)).json();
    const p = relogio.ativos.find((x: { id: number }) => x.id === sepse);
    expect(p.metas.map((m: { situacao: string }) => m.situacao)).toEqual([
      'cumprida',
      'perdida',
      'cumprida',
      'pendente',
    ]);
    expect(p.escore).toEqual({ id: 9002, total: 6, em: '2026-10-25T07:40', estornado: false });
    const enc = await a.post(enf, `${URL}/${sepse}/encerrar`, { desfecho: 'concluido', motivo: null });
    expect(enc.statusCode, enc.body).toBe(201);
    const depois = await a.post(enf, `${URL}/${sepse}/metas`, {
      tipo: 'checklist',
      codigo: 'reavaliacao',
      situacao: 'cumprida',
      quando: '2026-10-25T08:00',
    });
    expect(depois.json().codigo).toBe('protocolo-encerrado');
  });

  it('a inativação por engano: só do autor, com a senha; continua visível e sai dos indicadores', async () => {
    const outro = await a.entrar('SINT.ENF.APOIO');
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const motivo = 'Lançado no paciente do leito ao lado';
    expect((await a.post(outro, `${URL}/${tev}/inativar`, { motivo, senha: SENHA })).json().codigo).toBe(
      'so-o-autor',
    );
    expect((await a.post(enf, `${URL}/${tev}/inativar`, { motivo, senha: 'errada' })).statusCode).toBe(401);
    const r = await a.post(enf, `${URL}/${tev}/inativar`, { motivo, senha: SENHA });
    expect(r.statusCode, r.body).toBe(200);
    const relogio = (await a.get(enf, `${URL}/relogio?unidade=UTI`)).json();
    const t = relogio.encerrados.find((x: { id: number }) => x.id === tev);
    expect(t.inativacao).toMatchObject({ por: 'SINT.ENF.PLANTAO', motivo });
    expect(relogio.ativos).toEqual([]);
    // De novo no paciente certo, o mesmo protocolo abre (a inativada não conta como aberta).
    const certo = await a.post(enf, URL, {
      atendimento: TRES.atendimento,
      tipo: 'tev',
      versao: versoes['tev'],
      origem: 'suspeita',
      reconhecidoEm: '2026-10-25T07:50',
      criterios: ['risco-alto'],
    });
    expect(certo.statusCode, certo.body).toBe(201);
    expect(
      a.trilha.eventos.filter((e) => e.evento === 'enfermagem.protocoloInternado.inativado'),
    ).toHaveLength(1);
  });

  it('os indicadores por origem (PA, internação, UTI) imprimem o numerador e o denominador', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    // Um protocolo do PA no período (lido da mesma tabela do relógio do PA).
    const pa: ProtocoloPaciente = {
      id: 7001,
      cabecalho: '1',
      reg: 1,
      paciente: 1,
      tipo: 'sepse',
      gerenciado: versoes['sepse']!,
      origem: 'enfermeiro',
      sugeridoPor: null,
      criterios: ['suspeita-infeccao'],
      chegadaEm: '2026-10-24T10:00:00',
      incluidoEm: '2026-10-24T10:10:00',
      incluidoPor: 'SINT.ENFERMEIRO.PA',
      eventos: [
        {
          id: 1,
          tipo: 'meta',
          codigo: 'lactato',
          situacao: 'cumprida',
          quando: '2026-10-24T10:20:00',
          prazoEm: null,
          motivo: null,
          por: 'X',
          em: '2026-10-24T10:21:00',
        },
      ],
    };
    (a.classificacao as unknown as { e(c: { hospital: string }): { protocolos: ProtocoloPaciente[] } })
      .e({ hospital: 'aa' })
      .protocolos.push(pa);
    const r = await a.get(enf, `${URL}/indicadores?de=2026-10-01&ate=2026-10-25`);
    expect(r.statusCode, r.body).toBe(200);
    const xs = r.json().indicadores as { local: string; tipo: string }[];
    expect(xs.find((x) => x.local === 'pa' && x.tipo === 'todos')).toMatchObject({
      inclusoes: 1,
      metasCumpridas: 1,
      metasRegistradas: 1,
      adesaoPercentual: 100,
    });
    // UTI: a sepse (3 metas registradas, 2 cumpridas; encerrada sem o pacote completo) e o TEV certo; o inativado não conta.
    expect(xs.find((x) => x.local === 'uti' && x.tipo === 'todos')).toMatchObject({
      inclusoes: 2,
      pelaNews2: 1,
      metasCumpridas: 2,
      metasRegistradas: 3,
      adesaoPercentual: 66.7,
      pacoteCompleto: 0,
      encerradas: 1,
    });
    expect(xs.some((x) => x.local === 'internacao')).toBe(false);
    expect((await a.get(enf, `${URL}/indicadores?de=2026-10-25&ate=2026-10-01`)).statusCode).toBe(400);
  });

  it('revisão W0-03: o estorno do NEWS2 que abriu o protocolo de sepse avisa a inclusão aberta; a tela marca a origem', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    news2(9010, 7, '2026-10-25T07:45', TRES);
    const inc = await a.post(enf, URL, {
      atendimento: TRES.atendimento,
      tipo: 'sepse',
      versao: versoes['sepse'],
      origem: 'news2',
      escore: 9010,
      criterios: ['suspeita-infeccao'],
    });
    expect(inc.statusCode, inc.body).toBe(201);
    const id = inc.json().id;
    const r = await a.post(enf, '/enfermagem/escores/9010/estornar', {
      motivo: 'NEWS2 lançado no paciente errado',
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().vinculados).toEqual({ acionamentos: 0, profilaxias: 0, protocolos: 1, reavaliacoes: 0 });
    expect(r.json().mensagem).toMatch(
      /abriu 1 inclusão\(ões\) no protocolo de sepse.*inative-a ou encerre-a/,
    );
    expect(a.trilha.eventos.filter((e) => e.evento === 'enfermagem.registro.estornado').at(-1)?.idAlvo).toBe(
      '9010',
    );
    // A inclusão continua aberta (nada se apaga), com o escore marcado como estornado para a tela.
    const relogio = (await a.get(enf, `${URL}/relogio?unidade=UTI`)).json();
    const p = relogio.ativos.find((x: { id: number }) => x.id === id);
    expect(p.escore).toMatchObject({ id: 9010, total: 7, estornado: true });
    // Encerrada ou inativada, a inclusão deixa de contar no aviso.
    expect(
      (await a.post(enf, `${URL}/${id}/inativar`, { motivo: 'Aberto pelo alerta errado', senha: SENHA }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await a.escores.protocolosInternados({ hospital: 'aa' } as never, { escores: [9010] })
      )[0]!.eventos.some((e) => e.tipo === 'inativacao'),
    ).toBe(true);
  });
});
