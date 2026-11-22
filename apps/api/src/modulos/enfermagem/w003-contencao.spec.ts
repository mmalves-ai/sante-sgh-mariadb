// W0-03, mercado M5 (critério 13): a contenção mecânica pela API — a ordem gera a checagem periódica no aprazamento
// SGH_ (os horários gravados com a ordem), a checagem no horário (a técnica checa, não prescreve), a retirada encerra
// (cancela os horários depois dela), a ordem vencida gera o alerta (na tela e na central, pela vigia), a renovação é
// ordem nova vinculada, a inativação é do autor com a senha, e o indicador imprime o numerador e o denominador. Porta
// em memória; relógio controlado; dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONTEXTO_SINTETICO, criarAppComEnfermagem } from './app-enfermagem.spec-util.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { VigiaContencao } from './contencao-servico.js';
import { PortaEscoresMemoria } from './escores-porta-memoria.js';
import { PortaEnfermagemMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
/** 2026-10-25 08:00 em São Paulo. */
let relogio = Date.parse('2026-10-25T11:00:00Z');
const agora = () => new Date(relogio);
const avancar = (min: number) => {
  relogio += min * 60_000;
};

interface Sessao {
  cookie: string;
  csrf: string;
}

async function montar() {
  const trilha = new RegistradorTrilhaMemoria();
  const enfermagem = new PortaEnfermagemMemoria({ agora });
  const escores = new PortaEscoresMemoria({ agora });
  const app: NestFastifyApplication = await criarAppComEnfermagem(env, {
    trilha,
    enfermagem,
    escores,
    vigiaEnfermagem: null,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  let seq = 0;
  return {
    app,
    trilha,
    escores,
    vigia: new VigiaContencao(escores, enfermagem, [CONTEXTO_SINTETICO]),
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
          'idempotency-key': `teste-w003-m5-${++seq}-${Date.now()}`,
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
const ORDEM = {
  motivo: 'riscoDispositivo',
  justificativa: 'Tentou retirar o tubo orotraqueal duas vezes',
  tipo: 'leito',
  membros: ['msd', 'mse'],
  prazoHoras: 2,
  intervaloMinutos: 60,
};
const NORMAL = { perfusao: 'normal', pele: 'normal', posicao: 'normal', necessidades: 'normal' };

describe('W0-03, M5: contenção mecânica pela API', () => {
  it('a ordem gera a checagem periódica no aprazamento SGH_; a técnica checa e não prescreve; a retirada encerra', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const tec = await a.entrar('SINT.TECNICO.ENF');
    expect((await a.post(tec, '/enfermagem/contencao', { ...DOIS, ...ORDEM })).statusCode).toBe(403);
    // Prazo acima do máximo do parâmetro (24 h) não passa no esquema; intervalo maior que o prazo, 422.
    expect(
      (await a.post(enf, '/enfermagem/contencao', { ...DOIS, ...ORDEM, prazoHoras: 30 })).statusCode,
    ).toBe(400);
    const r = await a.post(enf, '/enfermagem/contencao', { ...DOIS, ...ORDEM });
    expect(r.statusCode).toBe(201);
    expect(r.json().horarios).toEqual(['2026-10-25T09:00', '2026-10-25T10:00']);
    const id = r.json().id as number;
    // Gravados com a ordem (o aprazamento SGH_ é da mesma gravação).
    const gravada = a.escores.estado('aa').contencoes.find((x) => x.id === id)!;
    expect(gravada.horarios.map((h) => h.previsto)).toEqual(['2026-10-25T09:00', '2026-10-25T10:00']);
    // Uma segunda ordem no mesmo atendimento, com a primeira em curso: recusada (o caminho é renovar).
    const dup = await a.post(enf, '/enfermagem/contencao', { ...DOIS, ...ORDEM });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().codigo).toBe('contencao-em-curso');

    // A tela da unidade mostra a ordem ativa com os horários pendentes.
    let tela = (await a.get(enf, '/enfermagem/contencao/unidade?unidade=UTI')).json();
    const pac = tela.pacientes.find((x: { atendimento: number }) => x.atendimento === DOIS.atendimento);
    expect(pac.ordem).toMatchObject({ id, situacao: 'ativa', fim: '2026-10-25T10:00' });
    expect(pac.ordem.horarios.map((h: { estado: string }) => h.estado)).toEqual(['pendente', 'pendente']);
    expect(tela.gravacao).toMatchObject({ ligada: true, prescrever: true, checar: true });

    // O horário que ainda não chegou não se checa; no horário, a técnica checa; o alterado exige a observação.
    const cedo = await a.post(tec, `/enfermagem/contencao/${id}/checagens`, {
      previsto: '2026-10-25T09:00',
      achados: NORMAL,
    });
    expect(cedo.statusCode).toBe(409);
    expect(cedo.json().codigo).toBe('checagem-antecipada');
    avancar(62);
    const semObs = await a.post(tec, `/enfermagem/contencao/${id}/checagens`, {
      previsto: '2026-10-25T09:00',
      achados: { ...NORMAL, pele: 'alterado' },
    });
    expect(semObs.statusCode).toBe(400);
    const ch = await a.post(tec, `/enfermagem/contencao/${id}/checagens`, {
      previsto: '2026-10-25T09:00',
      achados: { ...NORMAL, pele: 'alterado' },
      observacao: 'Hiperemia no punho direito; contenção afrouxada',
    });
    expect(ch.statusCode).toBe(201);
    expect(ch.json().mensagem).toMatch(/alterado/);
    const repetida = await a.post(tec, `/enfermagem/contencao/${id}/checagens`, {
      previsto: '2026-10-25T09:00',
      achados: NORMAL,
    });
    expect(repetida.statusCode).toBe(409);
    expect(repetida.json().codigo).toBe('checagem-ja-feita');

    // A técnica não retira; a enfermeira retira com o motivo: o horário depois da retirada fica cancelado.
    expect(
      (await a.post(tec, `/enfermagem/contencao/${id}/retirar`, { motivo: 'Paciente calmo e colaborativo' }))
        .statusCode,
    ).toBe(403);
    expect((await a.post(enf, `/enfermagem/contencao/${id}/retirar`, { motivo: 'curto' })).statusCode).toBe(
      422,
    );
    const ret = await a.post(enf, `/enfermagem/contencao/${id}/retirar`, {
      motivo: 'Paciente calmo, colaborativo e sem risco ao tubo',
    });
    expect(ret.statusCode).toBe(200);
    const h = (await a.get(enf, `/enfermagem/contencao/atendimentos/${DOIS.atendimento}`)).json();
    const o = h.ordens.find((x: { id: number }) => x.id === id);
    expect(o).toMatchObject({
      situacao: 'retirada',
      encerramento: { tipo: 'retirada', usuario: 'SINT.ENF.PLANTAO' },
    });
    expect(o.horarios.map((x: { estado: string }) => x.estado)).toEqual(['feita', 'cancelada']);
    expect(o.horarios[0].checagem).toMatchObject({
      alterado: true,
      noPrazo: true,
      usuario: 'SINT.TECNICO.ENF',
    });
    const depois = await a.post(tec, `/enfermagem/contencao/${id}/checagens`, {
      previsto: '2026-10-25T10:00',
      achados: NORMAL,
    });
    expect(depois.statusCode).toBe(409);
    expect(depois.json().codigo).toBe('horario-cancelado');
    expect(
      (
        await a.post(enf, `/enfermagem/contencao/${id}/retirar`, {
          motivo: 'Segunda retirada da mesma ordem',
        })
      ).statusCode,
    ).toBe(409);
    // A tela da unidade não mostra mais a ordem retirada.
    tela = (await a.get(enf, '/enfermagem/contencao/unidade?unidade=UTI')).json();
    expect(
      tela.pacientes.find((x: { atendimento: number }) => x.atendimento === DOIS.atendimento).ordem,
    ).toBeNull();
    expect(a.trilha.eventos.map((t) => t.evento)).toEqual(
      expect.arrayContaining([
        'enfermagem.contencao.prescrita',
        'enfermagem.contencao.checada',
        'enfermagem.contencao.encerrada',
      ]),
    );
    // Nenhum texto clínico na trilha.
    expect(JSON.stringify(a.trilha.eventos)).not.toMatch(/Hiperemia|orotraqueal/);
  });

  it('a ordem vencida gera o alerta na tela e na central; a renovação é ordem nova vinculada; o atraso pela tolerância', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const r = await a.post(enf, '/enfermagem/contencao', {
      ...TRES,
      ...ORDEM,
      prazoHoras: 1,
      intervaloMinutos: 30,
    });
    expect(r.statusCode).toBe(201);
    const id = r.json().id as number;
    // 40 minutos depois: o horário de meia hora passou da tolerância (15 min padrão) sem checagem.
    avancar(50);
    let tela = (await a.get(enf, '/enfermagem/contencao/unidade?unidade=UTI')).json();
    let o = tela.pacientes.find((x: { atendimento: number }) => x.atendimento === TRES.atendimento).ordem;
    expect(o.horarios[0].estado).toBe('atrasada');
    expect(tela.atrasadas).toBeGreaterThanOrEqual(1);
    expect(await a.vigia.ciclo(CONTEXTO_SINTETICO)).toBe(0);
    // Passado o prazo, sem retirada nem renovação: vencida, com o alerta da tela e o aviso da central (uma vez).
    avancar(20);
    tela = (await a.get(enf, '/enfermagem/contencao/unidade?unidade=UTI')).json();
    o = tela.pacientes.find((x: { atendimento: number }) => x.atendimento === TRES.atendimento).ordem;
    expect(o.situacao).toBe('vencida');
    expect(tela.vencidas).toBe(1);
    expect(await a.vigia.ciclo(CONTEXTO_SINTETICO)).toBe(1);
    expect(await a.vigia.ciclo(CONTEXTO_SINTETICO)).toBe(0);
    const aviso = a.escores.estado('aa').avisos.find((x) => x.objeto === String(id))!;
    expect(aviso).toMatchObject({
      login: 'SINT.ENF.PLANTAO',
      evento: 'enfermagem.contencao.vencida',
      gravidade: 'grave',
      link: `/enfermagem/contencao?atendimento=${TRES.atendimento}`,
    });
    // A renovação: ordem nova que aponta a anterior; a anterior fica "renovada" e não vence mais.
    const rn = await a.post(enf, `/enfermagem/contencao/${id}/renovar`, { ...TRES, ...ORDEM });
    expect(rn.statusCode).toBe(201);
    const nova = rn.json().id as number;
    expect((await a.post(enf, `/enfermagem/contencao/${id}/renovar`, { ...TRES, ...ORDEM })).statusCode).toBe(
      409,
    );
    const h = (await a.get(enf, `/enfermagem/contencao/atendimentos/${TRES.atendimento}`)).json();
    expect(h.ordens.find((x: { id: number }) => x.id === id)).toMatchObject({
      situacao: 'renovada',
      renovadaPor: nova,
    });
    expect(h.ordens.find((x: { id: number }) => x.id === nova)).toMatchObject({
      situacao: 'ativa',
      anterior: id,
    });
    tela = (await a.get(enf, '/enfermagem/contencao/unidade?unidade=UTI')).json();
    expect(tela.vencidas).toBe(0);
    // A renovada não se retira (a retirada é da vigente).
    const r2 = await a.post(enf, `/enfermagem/contencao/${id}/retirar`, {
      motivo: 'Retirada pela ordem antiga',
    });
    expect(r2.statusCode).toBe(409);
    expect(r2.json().codigo).toBe('contencao-renovada');
  });

  it('a inativação é do autor, com a senha; a ordem fica visível e sai do indicador, que imprime numerador e denominador', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const apoio = await a.entrar('SINT.ENF.APOIO');
    const UM = { paciente: 25001, atendimento: 25101 };
    const r = await a.post(enf, '/enfermagem/contencao', { ...UM, ...ORDEM });
    expect(r.statusCode).toBe(201);
    const id = r.json().id as number;
    const motivo = 'Ordem lançada no paciente errado';
    const outro = await a.post(apoio, `/enfermagem/contencao/${id}/inativar`, { motivo, senha: SENHA });
    expect(outro.statusCode).toBe(409);
    expect(outro.json().codigo).toBe('so-o-autor');
    expect(
      (await a.post(enf, `/enfermagem/contencao/${id}/inativar`, { motivo, senha: 'errada' })).statusCode,
    ).toBe(401);
    expect((await a.post(enf, `/enfermagem/contencao/${id}/inativar`, { motivo })).statusCode).toBe(400);
    const ok = await a.post(enf, `/enfermagem/contencao/${id}/inativar`, { motivo, senha: SENHA });
    expect(ok.statusCode).toBe(200);
    const h = (await a.get(enf, `/enfermagem/contencao/atendimentos/${UM.atendimento}`)).json();
    expect(h.ordens.find((x: { id: number }) => x.id === id)).toMatchObject({
      inativa: true,
      encerramento: { tipo: 'inativacao', motivo },
    });

    const dia = new Date(relogio - 3 * 3_600_000).toISOString().slice(0, 10);
    const ind = await a.get(enf, `/enfermagem/contencao/indicador?unidade=UTI&de=${dia}&ate=${dia}`);
    expect(ind.statusCode).toBe(200);
    const i = ind.json();
    // As três ordens de hoje na UTI: a retirada e a vencida contam; a renovação não é contenção nova; a inativada não conta.
    expect(i.contencoes).toEqual({ numerador: 2, denominador: 8, por1000: 250 });
    expect(i.checagensNoPrazo.numerador).toBe(1);
    expect(i.checagensNoPrazo.denominador).toBeGreaterThanOrEqual(3);
    expect(i.impressao).toMatch(/2 \/ 8 × 1.000 = 250/);
    expect(
      (await a.get(enf, '/enfermagem/contencao/indicador?unidade=UTI&de=2026-10-26&ate=2026-10-25'))
        .statusCode,
    ).toBe(400);
  });

  it('revisão W0-03: a renovação inativada devolve a anterior (vencida, renova de novo); o adendo da checagem só do autor', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const tec = await a.entrar('SINT.TECNICO.ENF');
    let h = (await a.get(enf, `/enfermagem/contencao/atendimentos/${TRES.atendimento}`)).json();
    const A = h.ordens.find((x: { situacao: string }) => x.situacao === 'renovada');
    const B = A.renovadaPor as number;
    // A renovação B foi lançada errada: inativada pelo autor, com a senha.
    const inat = await a.post(enf, `/enfermagem/contencao/${B}/inativar`, {
      motivo: 'Renovação lançada com o prazo errado',
      senha: SENHA,
    });
    expect(inat.statusCode, inat.body).toBe(200);
    h = (await a.get(enf, `/enfermagem/contencao/atendimentos/${TRES.atendimento}`)).json();
    // A anterior volta a ser a vigente: vencida, sem renovação, alertando na tela.
    expect(h.ordens.find((x: { id: number }) => x.id === A.id)).toMatchObject({
      situacao: 'vencida',
      renovadaPor: null,
      renovadaEm: null,
    });
    let tela = (await a.get(enf, '/enfermagem/contencao/unidade?unidade=UTI')).json();
    expect(
      tela.pacientes.find((x: { atendimento: number }) => x.atendimento === TRES.atendimento).ordem.id,
    ).toBe(A.id);
    expect(tela.vencidas).toBeGreaterThanOrEqual(1);
    // E se renova de novo (a chave da renovação admite a seguinte).
    const C = await a.post(enf, `/enfermagem/contencao/${A.id}/renovar`, { ...TRES, ...ORDEM });
    expect(C.statusCode, C.body).toBe(201);
    const c = C.json().id as number;
    h = (await a.get(enf, `/enfermagem/contencao/atendimentos/${TRES.atendimento}`)).json();
    expect(h.ordens.find((x: { id: number }) => x.id === A.id)).toMatchObject({
      situacao: 'renovada',
      renovadaPor: c,
    });
    // O adendo: a técnica checa; a enfermeira (não autora) não corrige; a técnica corrige com o motivo.
    avancar(61);
    const previsto = C.json().horarios[0] as string;
    expect(
      (
        await a.post(tec, `/enfermagem/contencao/${c}/checagens`, {
          previsto,
          achados: { ...NORMAL, pele: 'alterado' },
          observacao: 'Observação escrita no paciente errado',
        })
      ).statusCode,
    ).toBe(201);
    const ADENDO = { previsto, achados: NORMAL, motivo: 'A observação era de outro paciente' };
    const outro = await a.post(enf, `/enfermagem/contencao/${c}/checagens/adendo`, ADENDO);
    expect(outro.statusCode).toBe(409);
    expect(outro.json().codigo).toBe('so-o-autor');
    const semMotivo = await a.post(tec, `/enfermagem/contencao/${c}/checagens/adendo`, {
      ...ADENDO,
      motivo: 'curto',
    });
    expect(semMotivo.statusCode).toBe(400);
    const ad = await a.post(tec, `/enfermagem/contencao/${c}/checagens/adendo`, ADENDO);
    expect(ad.statusCode, ad.body).toBe(201);
    h = (await a.get(enf, `/enfermagem/contencao/atendimentos/${TRES.atendimento}`)).json();
    const k = h.ordens.find((x: { id: number }) => x.id === c).horarios[0].checagem;
    // A checagem original continua (alterada, com a observação); o adendo vem junto, com o motivo e o autor.
    expect(k).toMatchObject({ alterado: true, observacao: 'Observação escrita no paciente errado' });
    expect(k.adendos).toEqual([
      expect.objectContaining({ alterado: false, motivo: ADENDO.motivo, usuario: 'SINT.TECNICO.ENF' }),
    ]);
    tela = (await a.get(enf, '/enfermagem/contencao/unidade?unidade=UTI')).json();
    expect(tela.gravacao.prescrever).toBe(true);
  });

  it('revisão W0-03: a ordem vencida e não retirada continua na tela e no alerta depois de 72 horas', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const UM = { paciente: 25001, atendimento: 25101 };
    const r = await a.post(enf, '/enfermagem/contencao', {
      ...UM,
      ...ORDEM,
      prazoHoras: 1,
      intervaloMinutos: 30,
    });
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json().id as number;
    avancar(80 * 60);
    const tela = (await a.get(enf, '/enfermagem/contencao/unidade?unidade=UTI')).json();
    const o = tela.pacientes.find((x: { atendimento: number }) => x.atendimento === UM.atendimento).ordem;
    expect(o).toMatchObject({ id, situacao: 'vencida' });
    expect(tela.vencidas).toBeGreaterThanOrEqual(1);
    // Ainda se retira pela tela.
    expect(
      (await a.post(enf, `/enfermagem/contencao/${id}/retirar`, { motivo: 'Retirada na revisão do plantão' }))
        .statusCode,
    ).toBe(200);
  });
});

describe('revisão W0-03: o prescritor (médico) pela guarda, sem a permissão da linha do turno', () => {
  it('o SINT.MEDICO (só pep.prescricao.criar) lê a unidade, prescreve, renova e retira; sem nenhuma das duas, 403', async () => {
    const b = await montar();
    try {
      const med = await b.entrar('SINT.MEDICO');
      // Pela guarda (não só pelo podePrescrever): a sessão não tem enfermagem.horario.ler.
      const sessao = (await b.get(med, '/sessao')).json();
      expect(sessao.permissoes).toContain('pep.prescricao.criar');
      expect(sessao.permissoes).not.toContain('enfermagem.horario.ler');
      const us = await b.get(med, '/enfermagem/unidades');
      expect(us.statusCode).toBe(200);
      expect(us.json().some((u: { unidade: string }) => u.unidade === 'UTI')).toBe(true);
      const tela = await b.get(med, '/enfermagem/contencao/unidade?unidade=UTI');
      expect(tela.statusCode).toBe(200);
      expect(tela.json().gravacao).toMatchObject({ ligada: true, prescrever: true, checar: false });
      const r = await b.post(med, '/enfermagem/contencao', { ...TRES, ...ORDEM });
      expect(r.statusCode).toBe(201);
      const id = r.json().id as number;
      const ren = await b.post(med, `/enfermagem/contencao/${id}/renovar`, { ...TRES, ...ORDEM });
      expect(ren.statusCode).toBe(201);
      const hist = await b.get(med, `/enfermagem/contencao/atendimentos/${TRES.atendimento}`);
      expect(hist.statusCode).toBe(200);
      expect(
        hist
          .json()
          .ordens.map((o: { id: number }) => o.id)
          .sort(),
      ).toEqual([id, ren.json().id].sort());
      const ret = await b.post(med, `/enfermagem/contencao/${ren.json().id}/retirar`, {
        motivo: 'Paciente calmo e colaborativo na reavaliação',
      });
      expect(ret.statusCode).toBe(200);
      // A checagem continua da enfermagem (a guarda recusa o médico).
      expect(
        (
          await b.post(med, `/enfermagem/contencao/${id}/checagens`, {
            previsto: '2026-10-25T09:00',
            ...NORMAL,
          })
        ).statusCode,
      ).toBe(403);
      const ind = await b.get(
        med,
        '/enfermagem/contencao/indicador?unidade=UTI&de=2026-10-01&ate=2026-10-31',
      );
      expect(ind.statusCode).toBe(200);
      // Sem nenhuma das duas permissões: 403 na guarda.
      const agenda = await b.entrar('SINT.AGENDA');
      expect((await b.get(agenda, '/enfermagem/contencao/unidade?unidade=UTI')).statusCode).toBe(403);
      expect((await b.post(agenda, '/enfermagem/contencao', { ...TRES, ...ORDEM })).statusCode).toBe(403);
      expect((await b.get(agenda, '/enfermagem/unidades')).statusCode).toBe(403);
    } finally {
      await b.app.close();
    }
  });
});
