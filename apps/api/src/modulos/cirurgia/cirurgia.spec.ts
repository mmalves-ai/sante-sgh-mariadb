// M18 (centro cirúrgico) pela HTTP, com a sessão real sobre a fonte sintética e a porta EM MEMÓRIA (nada conecta a
// banco): permissões pelas opções do Bloco Cirúrgico, a sala permitida ao usuário, o mapa com o alerta de
// sobreposição gravada pelo outro sistema, agendamento com a recusa de sobreposição e a exceção de urgência só com a
// permissão, remarcação com controle otimista, cancelamento e suspensão com motivo, solicitação, andamento,
// pendências, registro do ato com tempos e a revisão da ligação, e os usuários permitidos da sala.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { moduloCirurgia } from './modulo.js';
import { portaCirurgiaIndisponivel } from './porta-propria.js';
import { fimDoBloco, PortaCirurgiaMemoria } from './porta-memoria.js';

const HOJE = '2026-10-21'; // quarta-feira
const AMANHA = '2026-10-22';
const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'cirurgia' };
const trilha = new RegistradorTrilhaMemoria();
const cadastro = new PortaCadastroMemoria();
const cirurgia = new PortaCirurgiaMemoria(
  null,
  (c, ids) => cadastro.lerPacientes({ ...c, rede: '', hospital: '' }, ids),
  () => ({
    hoje: HOJE,
    hhmm: '0600',
  }),
);
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: { cirurgia: async () => ({ modulo: (ctx) => moduloCirurgia(ctx, { cirurgia }) }) },
  });
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
const A = '/api/cirurgia';
const h = (s: Sessao, k?: string) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': k ?? `teste-m18c-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `${A}${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}, k?: string) =>
  app.inject({ method: 'POST', url: `${A}${url}`, headers: h(s, k), payload: payload as object });

const pedido = (extra: Record<string, unknown> = {}) => ({
  sala: 1,
  data: AMANHA,
  hora: '0700',
  duracaoMin: 90,
  paciente: 1003,
  reg: 0,
  atendimento: 'I',
  especialidade: 33,
  convenio: 10,
  procedimento: 30101271,
  anestesia: 1,
  equipe: { cirurgiao: { id: 5001, cod: 9001 }, anestesista: { id: 5002, cod: 9002 } },
  ...extra,
});

describe('permissões, salas e mapa', () => {
  it('sem as opções do bloco, 403; o mapa mostra as salas, a sala permitida e a sobreposição já gravada', async () => {
    expect((await get(await entrar('SINT.EXAME'), '/mapa')).statusCode).toBe(403);
    const s = await entrar('SINT.BLOCO');
    const m = await get(s, `/mapa?inicio=${AMANHA}&dias=1`);
    expect(m.statusCode).toBe(200);
    const mapa = m.json();
    expect(mapa.salas.map((x: { codigo: number; permitida: boolean }) => [x.codigo, x.permitida])).toEqual([
      [1, true],
      [2, true],
      [3, false],
    ]);
    expect(mapa.sobreposicoes).toBe(1);
    const sala2 = mapa.dias[0].salas.find((x: { sala: number }) => x.sala === 2);
    expect(sala2.agendamentos.every((a: { sobreposto: boolean }) => a.sobreposto)).toBe(true);
    expect(sala2.agendamentos[0].paciente).not.toMatch(/SALA DOIS/);
    expect(sala2.agendamentos[0].equipe.map((e: { funcao: string }) => e.funcao)).toEqual([
      'cirurgiao',
      'anestesista',
    ]);
    expect(sala2.ocupacao).toBeGreaterThan(0);
    const g = (await get(s, '/gravacao')).json();
    expect(g.agenda.operacoes['cirurgia.agendarCirurgia'].pode).toBe(true);
    expect(g.agenda.operacoes['excecao'].pode).toBe(true);
    expect(g.registro.operacoes['cirurgia.registrarCirurgia'].pode).toBe(true);
    const o = (await get(s, '/opcoes')).json();
    // Os 5 do bloco (o registro do conselho do cirurgião externo sintético, que ainda não atuou no bloco, fica fora: a
    // confirmação do pedido do portal o traz pelo detalhe da solicitação; M50, etapa 3).
    expect(o.profissionais.length).toBe(5);
    expect(o.preparoMinimoMin).toBe(0);
    expect(JSON.stringify(o)).not.toMatch(/SPDATA|legado/i);
  });
});

describe('agendar, mover, cancelar e suspender', () => {
  it('agenda na sala permitida, recusa a sobreposição e a sala não permitida, e audita o detalhe', async () => {
    const s = await entrar('SINT.BLOCO');
    const a = await post(
      s,
      '/agendamentos',
      pedido({ procedimentosAdicionais: [30101522], recursos: ['video'] }),
    );
    expect(a.statusCode).toBe(201);
    const id = a.json().resultado.agendamento as number;
    const cruza = await post(s, '/agendamentos', pedido({ hora: '0800', paciente: 1001 }));
    expect(cruza.statusCode).toBe(409);
    expect(cruza.json().codigo).toBe('sala-ocupada');
    expect((await post(s, '/agendamentos', pedido({ sala: 3, paciente: 1001 }))).json().codigo).toBe(
      'sala-nao-permitida',
    );
    expect(
      (await post(s, '/agendamentos', pedido({ data: HOJE, hora: '0500', paciente: 1001 }))).json().codigo,
    ).toBe('horario-passado');
    expect(
      (
        await post(
          s,
          '/agendamentos',
          pedido({ hora: '1200', paciente: 1001, equipe: { cirurgiao: { id: 5001, cod: 1 } } }),
        )
      ).json().codigo,
    ).toBe('profissional-invalido');
    const d = await get(s, `/agendamentos/${id}`);
    expect(d.statusCode).toBe(200);
    expect(d.json().pacienteNome).toMatch(/CINTHYA/);
    expect(d.json().procedimentosAdicionais).toEqual([{ codigo: 30101522, nome: 'HERNIORRAFIA INGUINAL' }]);
    expect(d.json().agendamento.recursos).toEqual(['Vídeo']);
    expect(d.json().historico[0].operacao).toBe('Inclusão');
    expect(trilha.eventos.filter((e) => e.evento === 'cirurgia.agenda.lida').at(-1)?.tabelaAlvo).toBe(
      'CCAGENDA',
    );
    // A remarcação recusa a cirurgia com procedimento adicional ligado ao horário (D-REM-18).
    const mov = await post(s, `/agendamentos/${id}/mover`, {
      sala: 1,
      data: AMANHA,
      hora: '1300',
      lido: { sala: 1, data: AMANHA, hora: '0700' },
      justificativa: 'Mudança pedida pela equipe',
    });
    expect(mov.json().codigo).toBe('cirurgia-com-adicional');
  });

  it('exceção de urgência só com a permissão; move com controle otimista; cancela e suspende com motivo', async () => {
    const s = await entrar('SINT.BLOCO');
    const a = await post(
      s,
      '/agendamentos',
      pedido({ sala: 2, hora: '1400', duracaoMin: 60, paciente: 1001 }),
    );
    expect(a.statusCode).toBe(201);
    const id = a.json().resultado.agendamento as number;
    const urg = await post(
      s,
      '/agendamentos',
      pedido({
        sala: 2,
        hora: '1430',
        duracaoMin: 30,
        paciente: 1004,
        carater: 1,
        excecao: { motivo: 'Urgência abdominal na sala ocupada' },
      }),
    );
    expect(urg.statusCode).toBe(201);
    expect(
      (await get(s, `/agendamentos/${urg.json().resultado.agendamento}`)).json().agendamento.excecao,
    ).toBe(true);
    const velho = await post(s, `/agendamentos/${id}/mover`, {
      sala: 2,
      data: AMANHA,
      hora: '1600',
      lido: { sala: 2, data: AMANHA, hora: '1300' },
      justificativa: 'Mudança pedida pela equipe',
    });
    expect(velho.statusCode).toBe(409);
    const mov = await post(s, `/agendamentos/${id}/mover`, {
      sala: 2,
      data: AMANHA,
      hora: '1600',
      lido: { sala: 2, data: AMANHA, hora: '1400' },
      justificativa: 'Mudança pedida pela equipe',
    });
    expect(mov.statusCode).toBe(200);
    expect(
      (await get(s, `/agendamentos/${id}`)).json().historico.map((x: { operacao: string }) => x.operacao),
    ).toContain('Remarcação');
    const sus = await post(s, `/agendamentos/${id}/cancelar`, {
      motivo: 'PAC-JEJUM',
      solicitante: 'equipe',
      suspender: true,
    });
    expect(sus.statusCode).toBe(200);
    expect((await get(s, `/agendamentos/${id}`)).statusCode).toBe(404);
    const c = (await get(s, `/cancelamentos?de=${AMANHA}&ate=${AMANHA}`)).json();
    expect(c.itens.find((x: { id: number }) => x.id === id).motivo).toBe('Suspensa: Jejum não cumprido');
    expect(
      (
        await post(s, `/agendamentos/${urg.json().resultado.agendamento}/cancelar`, {
          motivo: 'OUTRO',
          solicitante: 'hospital',
        })
      ).statusCode,
    ).toBe(400);
    expect(fimDoBloco('2026-10-22 23:30', 60)).toBe('2026-10-23 00:30');
  });

  it('sem a permissão de exceção, a urgência em sala ocupada é recusada (403 antes de gravar)', async () => {
    const s = await entrar('SINT.EXAME');
    const r = await post(
      s,
      '/agendamentos',
      pedido({ excecao: { motivo: 'Urgência abdominal na sala ocupada' } }),
    );
    expect(r.statusCode).toBe(403);
  });
});

describe('solicitação, andamento e pendências', () => {
  it('solicita sem ocupar a sala, registra pendência, confirma pelo agendamento e marca o andamento', async () => {
    const s = await entrar('SINT.BLOCO');
    const sol = await post(s, '/solicitacoes', {
      sala: 1,
      data: AMANHA,
      hora: '1500',
      duracaoMin: 60,
      paciente: 1007,
      reg: 0,
      procedimento: 30715016,
      convenio: 10,
      cirurgiao: 5005,
    });
    expect(sol.statusCode).toBe(201);
    const idSol = sol.json().resultado.solicitacao as number;
    const mapa = (await get(s, `/mapa?inicio=${AMANHA}&dias=1`)).json();
    expect(mapa.solicitacoes.map((x: { estadoId: number }) => x.estadoId)).toContain(idSol);
    expect((await get(s, `/estados/${idSol}`)).json().pacienteNome).toMatch(/LETÍCIA/);
    expect(
      (await post(s, `/estados/${idSol}/pendencias`, { tipo: 'autorizacao', situacao: 'pendente' }))
        .statusCode,
    ).toBe(200);
    expect(
      (await post(s, `/estados/${idSol}/pendencias`, { tipo: 'autorizacao', situacao: 'ok' })).statusCode,
    ).toBe(200);
    expect((await get(s, `/estados/${idSol}`)).json().pendencias).toEqual([
      expect.objectContaining({ tipo: 'autorizacao', situacao: 'Resolvida' }),
    ]);
    expect((await post(s, `/estados/${idSol}/andamento`, { estado: 'em-sala' })).statusCode).toBe(409);
    const conf = await post(
      s,
      '/agendamentos',
      pedido({ hora: '1500', duracaoMin: 60, paciente: 1007, solicitacao: idSol }),
    );
    expect(conf.statusCode).toBe(201);
    expect(
      (await post(s, '/agendamentos', pedido({ hora: '1700', paciente: 1007, solicitacao: idSol }))).json()
        .codigo,
    ).toBe('solicitacao-encerrada');
    expect((await post(s, `/estados/${idSol}/andamento`, { estado: 'no-bloco' })).statusCode).toBe(200);
    expect(
      (await post(s, `/estados/${idSol}/cancelar`, { motivo: 'PAC-AUSENTE', solicitante: 'paciente' })).json()
        .codigo,
    ).toBe('estado-invalido');
    const sol2 = (
      await post(s, '/solicitacoes', {
        sala: 1,
        data: AMANHA,
        hora: '1900',
        duracaoMin: 30,
        paciente: 1001,
        reg: 0,
        procedimento: 30101271,
        convenio: 10,
        cirurgiao: null,
      })
    ).json().resultado.solicitacao;
    expect(
      (await post(s, `/estados/${sol2}/cancelar`, { motivo: 'PAC-AUSENTE', solicitante: 'paciente' }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await post(s, '/solicitacoes', {
          sala: 3,
          data: AMANHA,
          hora: '1900',
          duracaoMin: 30,
          paciente: 1001,
          reg: 0,
          procedimento: 30101271,
          convenio: 10,
          cirurgiao: null,
        })
      ).json().codigo,
    ).toBe('sala-nao-permitida');
  });
});

describe('registro do ato, ligação e salas', () => {
  it('registra o ato com tempos válidos, recusa os inválidos e mostra o casamento das realizadas', async () => {
    const s = await entrar('SINT.BLOCO');
    const ato = {
      agendamento: null,
      reg: 77002,
      data: HOJE,
      sala: 1,
      convenio: 10,
      porte: 'M',
      potencialContaminacao: 'L',
      // Ato sem agendamento com a incisão: com a trava do M46 ligada, só a urgência com o motivo do supervisor.
      carater: 1,
      motivoExcecaoIncisao: 'Urgência: abdome agudo sem tempo para a pausa',
      tipoAnestesia: 1,
      inicio: '0800',
      fim: '0930',
      inicioAnestesia: '0745',
      fimAnestesia: '0940',
      cid10: 'K80.2',
      pressao: '120x80',
      pulso: 72,
      supuracao: false,
      usos: {
        tubo: { usado: false, descricao: null },
        antimicrobiano: { usado: true, descricao: 'CEFAZOLINA' },
        sonda: { usado: false, descricao: null },
        cateter: { usado: false, descricao: null },
        puncao: { usado: false, descricao: null },
      },
      procedimentos: [
        {
          procedimento: 30101271,
          especialidade: 33,
          tecnica: 0,
          equipe: { cirurgiao: { id: 5001, cod: 9001 }, anestesista: { id: 5002, cod: 9002 } },
        },
      ],
      extensao: { entradaSala: '0740', incisao: '0805', saidaSala: '0950', asa: 2, observacao: null },
    };
    expect((await post(s, '/realizadas', { ...ato, fim: '0730' })).json().codigo).toBe('tempos-invalidos');
    const r = await post(s, '/realizadas', ato);
    expect(r.statusCode).toBe(201);
    const id = r.json().resultado.cirurgia as number;
    const lista = (await get(s, `/realizadas?de=${'2026-10-20'}&ate=${HOJE}`)).json();
    const nova = lista.itens.find((x: { id: number }) => x.id === id);
    expect(nova.ligacao.tipo).toBe('registro');
    expect(nova.extensao.asa).toBe(2);
    expect(nova.procedimentos[0].equipe.map((x: { funcao: string }) => x.funcao)).toEqual([
      'cirurgiao',
      'anestesista',
    ]);
    const antiga = lista.itens.find((x: { id: number }) => x.id === 880);
    expect(antiga.ligacao).toEqual({ tipo: 'exato', agendamento: 703, candidatos: [703] });
    expect(lista.resumo.exato).toBe(1);
    expect(lista.resumo.registro).toBe(1);
    const rev = await post(s, '/realizadas/880/ligacao', { agendamento: 703 });
    expect(rev.statusCode).toBe(200);
    expect((await post(s, '/realizadas/880/ligacao', { agendamento: 703 })).statusCode).toBe(409);
    expect(
      (await get(s, `/realizadas?de=2026-10-20&ate=${HOJE}`))
        .json()
        .itens.find((x: { id: number }) => x.id === 880).ligacao.tipo,
    ).toBe('revisao');
    // Pelo atendimento (REG) sem período, pela sala e pelo período.
    const porReg = (await get(s, '/realizadas?reg=77001')).json();
    expect(porReg.itens.map((x: { id: number }) => x.id)).toEqual([880]);
    expect((await get(s, `/realizadas?de=2026-10-20&ate=${HOJE}&sala=2`)).json().itens).toEqual([]);
    expect(
      (await get(s, `/realizadas?de=2026-10-20&ate=${HOJE}&sala=1&reg=77001`))
        .json()
        .itens.map((x: { id: number }) => x.id),
    ).toEqual([880]);
    expect((await get(s, '/realizadas?reg=12345')).json().itens).toEqual([]);
    expect((await post(s, '/realizadas/999999/ligacao', { agendamento: null })).statusCode).toBe(404);
  });

  it('usuários permitidos da sala: inclui, recusa o repetido e retira', async () => {
    const s = await entrar('SINT.BLOCO');
    const u = (await get(s, '/salas/3/usuarios')).json();
    expect(u.total).toBe(1);
    expect((await post(s, '/salas/3/usuarios', { usuario: 'SINT.BLOCO', acao: 'incluir' })).statusCode).toBe(
      200,
    );
    expect(
      (await post(s, '/salas/3/usuarios', { usuario: 'SINT.BLOCO', acao: 'incluir' })).json().codigo,
    ).toBe('ja-permitido');
    expect((await get(s, '/salas')).json().find((x: { codigo: number }) => x.codigo === 3).permitida).toBe(
      true,
    );
    expect((await post(s, '/salas/3/usuarios', { usuario: 'SINT.BLOCO', acao: 'remover' })).statusCode).toBe(
      200,
    );
    expect((await get(s, '/profissionais?q=ANESTESISTA')).json()).toHaveLength(1);
    expect((await get(s, '/procedimentos?q=COLE')).json()).toEqual([
      { codigo: 30101271, nome: 'COLECISTECTOMIA' },
    ]);
  });
});

describe('sala permitida nas ações sobre a solicitação', () => {
  it('andamento, cancelamento, pendência e confirmação recusam quem saiu da lista da sala', async () => {
    const s = await entrar('SINT.BLOCO');
    expect((await post(s, '/salas/3/usuarios', { usuario: 'SINT.BLOCO', acao: 'incluir' })).statusCode).toBe(
      200,
    );
    const sol = await post(s, '/solicitacoes', {
      sala: 3,
      data: AMANHA,
      hora: '1300',
      duracaoMin: 30,
      paciente: 1001,
      reg: 0,
      procedimento: 30101271,
      convenio: 10,
      cirurgiao: null,
    });
    expect(sol.statusCode).toBe(201);
    const id = sol.json().resultado.solicitacao as number;
    expect((await post(s, '/salas/3/usuarios', { usuario: 'SINT.BLOCO', acao: 'remover' })).statusCode).toBe(
      200,
    );
    const recusas = [
      await post(s, `/estados/${id}/andamento`, { estado: 'no-bloco' }),
      await post(s, `/estados/${id}/cancelar`, { motivo: 'PAC-AUSENTE', solicitante: 'paciente' }),
      await post(s, `/estados/${id}/pendencias`, { tipo: 'autorizacao', situacao: 'pendente' }),
      // A confirmação na sala 1 (permitida) de uma solicitação da sala 3 (não permitida).
      await post(
        s,
        '/agendamentos',
        pedido({ hora: '1300', duracaoMin: 30, paciente: 1001, solicitacao: id }),
      ),
    ];
    for (const r of recusas) {
      expect(r.statusCode).toBe(409);
      expect(r.json().codigo).toBe('sala-nao-permitida');
    }
    expect((await get(s, `/estados/${id}`)).json().agendamento.estado).toBe('solicitado');
  });
});

describe('histórico da agenda por período', () => {
  it('lista as inclusões e remarcações do período com o nome mascarado e recusa janela longa', async () => {
    const s = await entrar('SINT.BLOCO');
    const h = (await get(s, `/historico?de=${HOJE}&ate=${HOJE}`)).json();
    expect(h.itens.length).toBeGreaterThan(0);
    expect(h.itens.map((x: { operacao: string }) => x.operacao)).toContain('Inclusão');
    for (const x of h.itens) expect(x.paciente).toMatch(/^(\S+( \S\.)*)?$/u);
    expect((await get(s, '/historico?de=2026-01-01&ate=2026-03-01')).statusCode).toBe(400);
    expect((await get(s, '/historico?de=2020-01-01&ate=2020-01-02')).json().itens).toEqual([]);
  });
});

describe('porta indisponível', () => {
  it('fora de dev/ci sem o núcleo: 503 em tudo', async () => {
    const p = portaCirurgiaIndisponivel();
    await expect(
      p.salas({ cliente: 'memoria', estabelecimento: 1, usuario: null, correlacao: 'teste' }, 'X'),
    ).rejects.toThrow(/indispon/i);
    expect(
      (
        await p.podeGravar(
          { cliente: 'memoria', estabelecimento: 1, usuario: null, correlacao: 'teste' },
          'cirurgia.agendarCirurgia',
        )
      ).motivo,
    ).toMatch(/não está configurado/);
  });
});
