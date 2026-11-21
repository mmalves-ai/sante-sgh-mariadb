// M18 (agenda de exames) pela HTTP, com a sessão real sobre a fonte sintética e a porta EM MEMÓRIA (nada conecta a
// banco): permissões pelas opções do SADT, liberação (POL-3), busca de vaga com a cobertura por convênio e por exame,
// marcação com a disputa do mesmo horário, detalhe auditado, cancelamento com motivo, remarcação (transferir e
// liberar), cobertura (convênio pelo executor e exame só do novo), prévia e geração da grade, resíduo e a operação
// sem prontuário desligada.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { PortaExameMemoria } from './porta-memoria.js';
import { portaExameIndisponivel } from './porta-propria.js';
import { ServicoExame } from './servico.js';

const HOJE = '2026-10-21'; // quarta-feira
const AMANHA = '2026-10-22';
const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const cadastro = new PortaCadastroMemoria();
const exame = new PortaExameMemoria(
  null,
  (c, ids) => cadastro.lerPacientes(c, ids),
  () => ({
    hoje: HOJE,
    hhmm: '0600',
  }),
);
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, cadastro, exame });
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
async function entrar(login: string): Promise<Sessao> {
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
}
const A = '/api/agenda/exames';
const h = (s: Sessao, k?: string) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': k ?? `teste-m18-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `${A}${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}, k?: string) =>
  app.inject({ method: 'POST', url: `${A}${url}`, headers: h(s, k), payload: payload as object });
const marcar = (s: Sessao, agenda: number, hora: string, extra: Record<string, unknown> = {}) =>
  post(s, '/marcacoes', {
    agenda,
    data: AMANHA,
    hora,
    paciente: 1001,
    convenio: 10,
    exame: null,
    solicitante: null,
    retorno: false,
    canal: 'telefone',
    ...extra,
  });

describe('permissões, liberação e opções', () => {
  it('sem as opções do SADT, 403; com elas, as agendas, o estado da gravação e o vocabulário do novo', async () => {
    const r = await entrar('SINT.AGENDA');
    expect((await get(r, '/agendas')).statusCode).toBe(403);
    const s = await entrar('SINT.EXAME');
    const l = await get(s, '/agendas');
    expect(l.statusCode).toBe(200);
    expect(l.json().itens.map((a: { id: number }) => a.id)).toEqual([951, 952, 953, 954]);
    expect(l.json().itens[0].exames).toBe(2);
    expect(
      (await get(s, '/agendas?situacao=inativas')).json().itens.map((a: { id: number }) => a.id),
    ).toEqual([954]);
    const g = (await get(s, '/gravacao')).json();
    expect(g.ligada).toBe(true);
    expect(g.operacoes['agenda.agendarExame'].pode).toBe(true);
    expect(g.operacoes['agenda.agendarExameSemProntuario'].pode).toBe(false);
    expect(g.operacoes['agenda.agendarExameSemProntuario'].motivo).toMatch(/Falta provar/);
    const o = (await get(s, '/opcoes')).json();
    expect(o.exames.length).toBe(5);
    expect(o.categorias.map((c: { codigo: number }) => c.codigo)).toContain(90);
    expect(JSON.stringify(o)).not.toMatch(/SPDATA|legado|consulta/i);
  });

  it('o detalhe da agenda tem os convênios, a cobertura por exame, a escala e as gerações', async () => {
    const s = await entrar('SINT.EXAME');
    const d = (await get(s, '/agendas/952')).json();
    expect(d.convenios.map((c: { codigo: number }) => c.codigo)).toEqual([10, 306]);
    expect(d.escala.length).toBe(5);
    expect(d.geracoes[0].dias).toEqual([2, 3, 4, 5, 6]);
    expect((await get(s, '/agendas/999')).statusCode).toBe(404);
  });
});

describe('vagas, marcação, detalhe auditado, cancelamento e remarcação', () => {
  it('busca a vaga pela categoria e pelo convênio aceito, marca, recusa o mesmo horário e audita o contato', async () => {
    const s = await entrar('SINT.EXAME');
    const v = await get(s, `/vagas?categoria=24&de=${AMANHA}&ate=${AMANHA}`);
    expect(v.statusCode).toBe(200);
    expect(v.json().itens.every((x: { agenda: number }) => x.agenda === 951)).toBe(true);
    expect(v.json().itens.length).toBe(12);
    // A agenda 952 só aceita os convênios 10 e 306: com o 305, nenhuma vaga dela.
    const conv = (await get(s, `/vagas?agenda=952&convenio=305&de=${AMANHA}&ate=${AMANHA}`)).json();
    expect(conv.itens).toEqual([]);
    // A 951 faz só os exames 7001 e 7002 (cobertura do novo): o 7003 não aparece nela.
    expect((await get(s, `/vagas?agenda=951&exame=7003&de=${AMANHA}&ate=${AMANHA}`)).json().itens).toEqual(
      [],
    );
    const m = await marcar(s, 951, '0700', {
      exame: 7001,
      solicitante: { crm: 12345, uf: 'MG', nome: 'MEDICO SOLICITANTE' },
    });
    expect(m.statusCode).toBe(201);
    const id = m.json().resultado.marcacao as number;
    expect((await marcar(s, 951, '0700', { paciente: 1002 })).statusCode).toBe(409);
    expect((await marcar(s, 951, '0720', { exame: 7003 })).json().codigo).toBe('exame-nao-feito');
    expect((await marcar(s, 952, '0700', { convenio: 305 })).json().codigo).toBe('convenio-nao-aceito');
    expect((await marcar(s, 954, '0700')).statusCode).toBe(409);
    const d = await get(s, `/marcacoes/${id}`);
    expect(d.statusCode).toBe(200);
    expect(d.json().exameEscolhido).toEqual({ id: 7001, nome: 'ULTRASSONOGRAFIA DE ABDOME TOTAL' });
    expect(d.json().solicitante.crm).toBe(12345);
    expect(d.json().estado).toBe('marcado');
    const lida = trilha.eventos.filter((e) => e.evento === 'agenda.exame.lido').at(-1);
    expect(lida?.tabelaAlvo).toBe('SIPACAGD');
    expect(trilha.eventos.some((e) => e.evento === 'agenda.exame.marcado')).toBe(true);
    const dia = (await get(s, `/marcacoes?data=${AMANHA}`)).json();
    expect(dia.itens.find((x: { id: number }) => x.id === id).paciente).not.toMatch(/SILVA/);
    // As marcações do paciente respeitam o escopo de unidade da permissão (as agendas sintéticas são da unidade 2).
    const servico = new ServicoExame(exame);
    const ctx = { rede: 'rede-teste', hospital: 'aa' };
    const doPaciente = async (unidades: string[] | null) =>
      (await servico.marcacoesDoPaciente({ ...ctx, unidades }, 1001)).itens.map((x) => x.id);
    expect(await doPaciente(null)).toContain(id);
    expect(await doPaciente(['2'])).toContain(id);
    expect(await doPaciente(['99'])).toEqual([]);
    expect(
      (await get(s, '/pacientes/1001/marcacoes')).json().itens.map((x: { id: number }) => x.id),
    ).toContain(id);
  });

  it('remarca transferindo (o horário antigo fica "transferido") e cancela com motivo (o horário volta vago)', async () => {
    const s = await entrar('SINT.EXAME');
    const m = await marcar(s, 953, '1330');
    expect(m.statusCode).toBe(201);
    const id = m.json().resultado.marcacao as number;
    const r = await post(s, `/marcacoes/${id}/remarcar`, {
      destino: { agenda: 953, data: AMANHA, hora: '1345' },
      modo: 'transferir',
      canal: 'telefone',
    });
    expect(r.statusCode).toBe(200);
    const nova = r.json().resultado.marcacao as number;
    const g = (await get(s, `/grade?agenda=953&de=${AMANHA}&ate=${AMANHA}`)).json();
    expect(g.horarios.find((x: { hora: string }) => x.hora === '13:30').estado).toBe('transferido');
    expect(g.horarios.find((x: { hora: string }) => x.hora === '13:45').estado).toBe('marcado');
    const c = await post(s, `/marcacoes/${nova}/cancelar`, {
      motivo: 'PAC-DESISTIU',
      solicitante: 'paciente',
    });
    expect(c.statusCode).toBe(200);
    expect(
      (await get(s, `/grade?agenda=953&de=${AMANHA}&ate=${AMANHA}`))
        .json()
        .horarios.find((x: { hora: string }) => x.hora === '13:45').estado,
    ).toBe('vago');
    const lista = (await get(s, `/cancelamentos?de=${HOJE}&ate=${HOJE}`)).json();
    expect(lista.total).toBeGreaterThanOrEqual(1);
    expect(lista.itens[0].motivo).toBe('Paciente desistiu');
    expect(lista.itens[0].paciente).not.toMatch(/SILVA/);
    expect(
      (await post(s, `/marcacoes/${nova}/cancelar`, { motivo: 'OUTRO', solicitante: 'paciente' })).statusCode,
    ).toBe(400);
  });

  it('a mesma Idempotency-Key não marca duas vezes; o pedido diferente com a mesma chave é recusado', async () => {
    const s = await entrar('SINT.EXAME');
    const k = `teste-m18-idem-${Date.now()}`;
    const a = await post(
      s,
      '/marcacoes',
      {
        agenda: 951,
        data: AMANHA,
        hora: '0800',
        paciente: 1003,
        convenio: 10,
        exame: null,
        solicitante: null,
        retorno: false,
        canal: 'presencial',
      },
      k,
    );
    const b = await post(
      s,
      '/marcacoes',
      {
        agenda: 951,
        data: AMANHA,
        hora: '0800',
        paciente: 1003,
        convenio: 10,
        exame: null,
        solicitante: null,
        retorno: false,
        canal: 'presencial',
      },
      k,
    );
    expect(a.statusCode).toBe(201);
    expect(b.json().repetida).toBe(true);
    const c = await post(
      s,
      '/marcacoes',
      {
        agenda: 951,
        data: AMANHA,
        hora: '0820',
        paciente: 1003,
        convenio: 10,
        exame: null,
        solicitante: null,
        retorno: false,
        canal: 'presencial',
      },
      k,
    );
    expect(c.statusCode).toBe(422);
  });

  it('a marcação sem prontuário fica desligada (POL-3) com o motivo', async () => {
    const s = await entrar('SINT.EXAME');
    const r = await post(s, '/marcacoes/sem-prontuario', {
      agenda: 951,
      data: AMANHA,
      hora: '0840',
      nome: 'PACIENTE SINTETICO NOVO',
      telefone: '31999990000',
      convenio: 10,
      canal: 'telefone',
    });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(r.json())).toMatch(/Falta provar|desligad/i);
  });
});

describe('cobertura, grade e resíduo', () => {
  it('convênio pela receita (a última linha pede confirmação) e exame só do novo, com a trilha', async () => {
    const s = await entrar('SINT.EXAME');
    expect((await post(s, '/agendas/952/convenios', { convenio: 305, acao: 'incluir' })).statusCode).toBe(
      200,
    );
    expect((await post(s, '/agendas/952/convenios', { convenio: 305, acao: 'incluir' })).statusCode).toBe(
      409,
    );
    for (const c of [10, 306])
      expect((await post(s, '/agendas/952/convenios', { convenio: c, acao: 'remover' })).statusCode).toBe(
        200,
      );
    const ultima = await post(s, '/agendas/952/convenios', { convenio: 305, acao: 'remover' });
    expect(ultima.json().codigo).toBe('ultima-linha');
    expect(
      (
        await post(s, '/agendas/952/convenios', {
          convenio: 305,
          acao: 'remover',
          confirmarAceitarTodos: true,
        })
      ).statusCode,
    ).toBe(200);
    const inc = await post(s, '/agendas/952/exames', { exame: 7003, convenio: null, acao: 'incluir' });
    expect(inc.statusCode).toBe(200);
    expect(
      (await post(s, '/agendas/952/exames', { exame: 7003, convenio: null, acao: 'incluir' })).statusCode,
    ).toBe(409);
    expect(
      (await post(s, '/agendas/952/exames', { exame: 9999, convenio: null, acao: 'incluir' })).statusCode,
    ).toBe(400);
    expect((await get(s, '/agendas/952')).json().cobertura.map((c: { exame: number }) => c.exame)).toEqual([
      7003,
    ]);
    expect(
      (await post(s, '/agendas/952/exames', { exame: 7003, convenio: null, acao: 'remover' })).statusCode,
    ).toBe(200);
    expect(
      (await post(s, '/agendas/952/exames', { exame: 7003, convenio: null, acao: 'remover' })).statusCode,
    ).toBe(404);
    expect(
      trilha.eventos.some((e) => e.evento === 'agenda.coberturaExame.definida' && e.tabelaAlvo === 'MEMORIA'),
    ).toBe(true);
  });

  it('prévia da grade (nada gravado) e geração pela impressão aprovada; a prévia velha é recusada', async () => {
    const s = await entrar('SINT.EXAME');
    const pedido = {
      agenda: 951,
      de: '2026-11-23',
      ate: '2026-11-27',
      duracaoMinutos: 20,
      faixas: [{ semana: 2, inicio: '1300', fim: '1500' }],
    };
    // Faixa ou duração fora dos valores que a escala já usa: recusada na prévia, com o motivo e as opções.
    const fora = await post(s, '/grade/previa', {
      ...pedido,
      faixas: [{ semana: 2, inicio: '0715', fim: '1200' }],
    });
    expect(fora.statusCode).toBe(409);
    expect(fora.json().codigo).toBe('fora-do-padrao');
    expect(fora.json().detail).toMatch(/07:15/);
    expect(fora.json().detail).not.toMatch(/SPDATA|legado|sistema atual/i);
    expect((await post(s, '/grade/previa', { ...pedido, duracaoMinutos: 30 })).json().codigo).toBe(
      'fora-do-padrao',
    );
    const p = await post(s, '/grade/previa', pedido);
    expect(p.statusCode).toBe(200);
    expect(p.json().horarios).toBe(6);
    const g = await post(s, '/grade/gerar', { ...pedido, assinatura: p.json().assinatura });
    expect(g.statusCode).toBe(201);
    expect(g.json().resultado.horarios).toBe(6);
    const de_novo = await post(s, '/grade/gerar', { ...pedido, assinatura: p.json().assinatura });
    expect(de_novo.statusCode).toBe(409);
    expect(
      (await post(s, '/grade/previa', { ...pedido, faixas: [{ semana: 7, inicio: '0800', fim: '1000' }] }))
        .statusCode,
    ).toBe(409);
  });

  it('resíduo: o confirmado sem paciente e o ocupado sem a marcação, só contagens e horários', async () => {
    const s = await entrar('SINT.EXAME');
    const r = (await get(s, `/residuo?de=2026-10-15&ate=2026-11-15`)).json();
    expect(r.confirmadosSemPaciente).toBe(1);
    expect(r.ocupadosSemMarcacao).toBe(1);
    expect(r.total).toBe(r.confirmadosSemPaciente + r.ocupadosSemMarcacao);
    expect(JSON.stringify(r)).not.toMatch(/INCOMPLETO/);
    expect((await get(s, `/residuo?de=2026-01-01&ate=2026-12-31`)).statusCode).toBe(400);
    const g = (await get(s, `/grade?agenda=953&de=${HOJE}&ate=2026-11-15`)).json();
    expect(g.residuo.ocupadosSemMarcacao).toBe(1);
  });
});

describe('porta indisponível', () => {
  it('fora de dev/ci sem o núcleo: 503 em tudo e a gravação recusada', async () => {
    const p = portaExameIndisponivel();
    const c = { cliente: 'sintetico', estabelecimento: 1, usuario: 1, correlacao: 't' };
    expect(p.destino).toBe('banco');
    await expect(p.agendas(c)).rejects.toThrow(/indispon/i);
    expect((await p.podeGravar(c, 'agenda.agendarExame')).pode).toBe(false);
    expect((p as unknown as Record<string, unknown>)['then']).toBeUndefined();
  });
});
