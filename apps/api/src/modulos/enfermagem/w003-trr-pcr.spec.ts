// W0-03, mercado M2 (critério 10): o TRR e a PCR pela API — o alerta do escore com gatilho de TRR aparece aberto na
// unidade; o acionamento a partir dele grava a hora do alerta (a do escore) e a do acionamento, uma vez por alerta; a
// chegada e o desfecho; a ficha Utstein com o rascunho do autor e a versão finalizada (imutável); os indicadores de PCR
// por 1.000 pacientes-dia fora da UTI e do tempo de resposta, com o numerador e o denominador. Porta em memória;
// relógio controlado; dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { fonteCatalogoArquivo } from '@sgh/legado';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
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
  const enfermagem = new PortaEnfermagemMemoria(
    fonteCatalogoArquivo(resolve(import.meta.dirname, '../../../../../docs/operacoes/catalogo')),
    { agora },
  );
  const escores = new PortaEscoresMemoria({ agora });
  const app: NestFastifyApplication = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    enfermagem,
    escores,
    vigiaEnfermagem: null,
    vigia: null,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  let seq = 0;
  return {
    app,
    trilha,
    escores,
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
          'idempotency-key': `teste-w003-m2-${++seq}-${Date.now()}`,
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

const P4 = { paciente: 25004, atendimento: 25104 };
const PEWS_5 = { comport: 1, cardio: 1, resp: 1, nebul: 2, vomito: 0 };
const FICHA = {
  presenciada: true,
  monitorizada: false,
  ritmoInicial: 'fv',
  colapsoEm: '2026-10-25T08:20',
  rcpEm: '2026-10-25T08:21',
  desfibrilacaoEm: '2026-10-25T08:23',
  adrenalinaEm: null,
  viaAereaAvancada: true,
  rceEm: null,
  fimEm: null,
  desfecho: null,
};

describe('W0-03, M2: TRR e PCR pela API', () => {
  it('o alerta aciona o time com a hora do alerta; chegada, desfecho; a ficha Utstein do rascunho à finalizada; indicadores', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const med = await a.entrar('SINT.MEDICO');
    // O PEWS 5 da enfermaria às 08:00 dispara o gatilho de TRR.
    const esc = await a.post(enf, '/enfermagem/escores', {
      ...P4,
      reg: 25204,
      unidade: 'ENF1',
      escala: 'pews',
      itens: PEWS_5,
    });
    expect(esc.statusCode, esc.body).toBe(201);
    expect(esc.json().gatilho).toBe('trr');
    const escore = esc.json().id as number;
    let tela = (await a.get(enf, '/enfermagem/trr/unidade?unidade=ENF1')).json();
    expect(tela.alertas).toEqual([
      expect.objectContaining({
        escore,
        atendimento: P4.atendimento,
        escala: 'pews',
        total: 5,
        alertaEm: '2026-10-25T08:00',
      }),
    ]);
    expect(tela.gravacao.agir).toBe(true);

    // Quatro minutos depois, a enfermeira aciona pelo alerta: a hora do alerta vem do escore.
    avancar(4);
    const ac = await a.post(enf, '/enfermagem/trr', { ...P4, escore });
    expect(ac.statusCode).toBe(201);
    expect(ac.json()).toMatchObject({ alertaEm: '2026-10-25T08:00', acionadoEm: '2026-10-25T08:04' });
    const trr = ac.json().id as number;
    const dup = await a.post(enf, '/enfermagem/trr', { ...P4, escore });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().codigo).toBe('trr-ja-acionado');
    // À mão, sem alerta, o motivo é obrigatório.
    expect((await a.post(enf, '/enfermagem/trr', { ...P4 })).statusCode).toBe(400);
    tela = (await a.get(enf, '/enfermagem/trr/unidade?unidade=ENF1')).json();
    expect(tela.alertas).toEqual([]);

    // A chegada do time 3 minutos depois (no prazo de 5) e o desfecho.
    avancar(3);
    expect((await a.post(med, `/enfermagem/trr/${trr}/eventos`, { tipo: 'chegada' })).statusCode).toBe(201);
    expect((await a.post(med, `/enfermagem/trr/${trr}/eventos`, { tipo: 'chegada' })).statusCode).toBe(409);
    expect((await a.post(med, `/enfermagem/trr/${trr}/eventos`, { tipo: 'desfecho' })).statusCode).toBe(400);
    expect(
      (await a.post(med, `/enfermagem/trr/${trr}/eventos`, { tipo: 'desfecho', desfecho: 'pcr' })).statusCode,
    ).toBe(201);
    tela = (await a.get(enf, '/enfermagem/trr/unidade?unidade=ENF1')).json();
    expect(tela.acionamentos.find((x: { id: number }) => x.id === trr)).toMatchObject({
      origem: 'escore',
      alertaEm: '2026-10-25T08:00',
      acionadoEm: '2026-10-25T08:04',
      chegadaEm: '2026-10-25T08:07',
      desfecho: 'pcr',
      minutosAteAcionar: 4,
      minutosResposta: 3,
    });

    // A ficha da parada: o rascunho do médico (versão 1); a finalização sem desfecho é recusada; horas fora de ordem, 422.
    avancar(20);
    const fora = await a.post(med, '/enfermagem/trr/pcr', {
      ...P4,
      trr,
      dados: { ...FICHA, rcpEm: '2026-10-25T08:10' },
      finalizar: false,
    });
    expect(fora.statusCode).toBe(422);
    expect(fora.json().codigo).toBe('rcp-antes-do-colapso');
    const v1 = await a.post(med, '/enfermagem/trr/pcr', { ...P4, trr, dados: FICHA, finalizar: false });
    expect(v1.statusCode).toBe(201);
    expect(v1.json().versao).toBe(1);
    const id1 = v1.json().id as number;
    expect(
      (await a.post(med, `/enfermagem/trr/pcr/${id1}/versoes`, { dados: FICHA, finalizar: true })).json()
        .codigo,
    ).toBe('finalizada-sem-desfecho');
    // Só o autor continua o rascunho.
    const outro = await a.post(enf, `/enfermagem/trr/pcr/${id1}/versoes`, { dados: FICHA, finalizar: false });
    expect(outro.statusCode).toBe(409);
    expect(outro.json().codigo).toBe('so-o-autor');
    const fim = { ...FICHA, rceEm: '2026-10-25T08:31', desfecho: 'rceSustentado' };
    const v2 = await a.post(med, `/enfermagem/trr/pcr/${id1}/versoes`, { dados: fim, finalizar: true });
    expect(v2.statusCode).toBe(201);
    expect(v2.json().versao).toBe(2);
    const id2 = v2.json().id as number;
    // A versão 1 não aceita outra (a 2 a substituiu); a finalizada não muda.
    expect(
      (await a.post(med, `/enfermagem/trr/pcr/${id1}/versoes`, { dados: fim, finalizar: false })).json()
        .codigo,
    ).toBe('versao-desatualizada');
    // Revisão W0-03: a finalizada se corrige só com a justificativa (e continua finalizada).
    expect(
      (await a.post(med, `/enfermagem/trr/pcr/${id2}/versoes`, { dados: fim, finalizar: false })).json()
        .codigo,
    ).toBe('motivo-obrigatorio');
    tela = (await a.get(enf, '/enfermagem/trr/unidade?unidade=ENF1')).json();
    const ficha = tela.fichas.find((f: { id: number }) => f.id === id2);
    expect(ficha).toMatchObject({ versao: 2, situacao: 'finalizada', trr, uti: false, autor: 'SINT.MEDICO' });
    // A versão anterior legível com os dados (não só o número).
    expect(ficha.versoes).toEqual([
      expect.objectContaining({
        id: id1,
        versao: 1,
        situacao: 'rascunho',
        dados: expect.objectContaining({ ritmoInicial: 'fv' }),
      }),
    ]);
    // O acionamento aponta a ficha vigente (a tela mostra "Ver a ficha", não abre outra).
    expect(tela.acionamentos.find((x: { id: number }) => x.id === trr).ficha).toBe(id2);

    // Um acionamento à mão sem chegada registrada.
    const man = await a.post(enf, '/enfermagem/trr', {
      ...P4,
      motivo: 'Rebaixamento súbito do nível de consciência',
    });
    expect(man.statusCode).toBe(201);

    // Indicadores do dia: 1 PCR fora da UTI sobre os pacientes-dia das unidades que não são UTI (8, sintéticos); a chegada
    // no prazo de 5 min (1 de 1 com chegada); do alerta ao acionamento, 4 min.
    const ind = await a.get(enf, '/enfermagem/trr/indicadores?de=2026-10-25&ate=2026-10-25');
    expect(ind.statusCode).toBe(200);
    const i = ind.json();
    expect(i.pcrForaUti).toEqual({ numerador: 1, denominador: 8, por1000: 125 });
    expect(i.tempoResposta).toEqual({
      medianaMinutos: 3,
      noPrazo: { numerador: 1, denominador: 1, percentual: 100 },
      metaMinutos: 5,
    });
    expect(i.alertaAteAcionar).toEqual({ medianaMinutos: 4, n: 1 });
    expect(i.impressao).toMatch(/1 \/ 8 × 1.000 = 125/);
    expect(a.trilha.eventos.map((t) => t.evento)).toEqual(
      expect.arrayContaining([
        'enfermagem.trr.acionado',
        'enfermagem.trr.evento',
        'enfermagem.pcr.registrada',
      ]),
    );
    expect(JSON.stringify(a.trilha.eventos)).not.toMatch(/Rebaixamento/);
  });

  it('revisão W0-03: correção da finalizada, uma ficha por acionamento, local da parada, retificação, inativação e indicadores', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const med = await a.entrar('SINT.MEDICO');
    let tela = (await a.get(enf, '/enfermagem/trr/unidade?unidade=ENF1')).json();
    const fic = tela.fichas.find((f: { situacao: string; trr: number | null }) => f.trr !== null);
    const trr = fic.trr as number;
    // A segunda "versão 1" do mesmo acionamento é recusada (a parada não se duplica no indicador).
    const segunda = await a.post(med, '/enfermagem/trr/pcr', { ...P4, trr, dados: FICHA, finalizar: false });
    expect(segunda.statusCode).toBe(409);
    expect(segunda.json().codigo).toBe('pcr-ja-aberta');
    // A correção da finalizada: com a justificativa, finalizada; a anterior fica inativa e legível.
    const fim = { ...FICHA, rceEm: '2026-10-25T08:31', desfecho: 'rceSustentado', causaProvavel: 'Hipóxia' };
    const motivo = 'Hora do colapso corrigida pelo registro do monitor';
    expect(
      (
        await a.post(med, `/enfermagem/trr/pcr/${fic.id}/versoes`, { dados: fim, finalizar: false, motivo })
      ).json().codigo,
    ).toBe('correcao-finaliza');
    const outroAutor = await a.post(enf, `/enfermagem/trr/pcr/${fic.id}/versoes`, {
      dados: fim,
      finalizar: true,
      motivo,
    });
    expect(outroAutor.json().codigo).toBe('so-o-autor');
    const corr = await a.post(med, `/enfermagem/trr/pcr/${fic.id}/versoes`, {
      dados: { ...fim, colapsoEm: '2026-10-25T08:19' },
      finalizar: true,
      motivo,
    });
    expect(corr.statusCode, corr.body).toBe(201);
    expect(corr.json().versao).toBe(3);
    tela = (await a.get(enf, '/enfermagem/trr/unidade?unidade=ENF1')).json();
    const v3 = tela.fichas.find((f: { id: number }) => f.id === corr.json().id);
    expect(v3).toMatchObject({ versao: 3, situacao: 'finalizada', motivo, uti: false, unidade: 'ENF1' });
    expect(v3.dados).toMatchObject({ colapsoEm: '2026-10-25T08:19', causaProvavel: 'Hipóxia' });
    expect(v3.versoes[0]).toMatchObject({
      versao: 2,
      situacao: 'finalizada',
      dados: { colapsoEm: '2026-10-25T08:20' },
    });
    let ind = (await a.get(enf, '/enfermagem/trr/indicadores?de=2026-10-25&ate=2026-10-25')).json();
    expect(ind.pcrForaUti.numerador).toBe(1);

    // O acionamento com ficha vigente não se inativa (nenhum órfão); a ficha se inativa só pelo autor, com a senha.
    const comFicha = await a.post(enf, `/enfermagem/trr/${trr}/inativar`, {
      motivo: 'Acionado no paciente errado',
      senha: SENHA,
    });
    expect(comFicha.json().codigo).toBe('trr-com-ficha');
    expect(
      (
        await a.post(med, `/enfermagem/trr/pcr/${v3.id}/inativar`, {
          motivo: 'Ficha lançada no atendimento errado',
          senha: 'errada',
        })
      ).statusCode,
    ).toBe(401);
    const inat = await a.post(med, `/enfermagem/trr/pcr/${v3.id}/inativar`, {
      motivo: 'Ficha lançada no atendimento errado',
      senha: SENHA,
    });
    expect(inat.statusCode, inat.body).toBe(200);
    tela = (await a.get(enf, '/enfermagem/trr/unidade?unidade=ENF1')).json();
    expect(tela.fichas.find((f: { id: number }) => f.id === v3.id).inativacao).toMatchObject({
      motivo: 'Ficha lançada no atendimento errado',
    });
    expect(tela.acionamentos.find((x: { id: number }) => x.id === trr).ficha).toBeNull();
    ind = (await a.get(enf, '/enfermagem/trr/indicadores?de=2026-10-25&ate=2026-10-25')).json();
    expect(ind.pcrForaUti.numerador).toBe(0);

    // O local da parada: a primeira versão com o acionamento leva o local dele, não o informado.
    const nova = await a.post(med, '/enfermagem/trr/pcr', {
      ...P4,
      trr,
      unidade: 'UTI',
      dados: FICHA,
      finalizar: false,
    });
    expect(nova.statusCode, nova.body).toBe(201);
    tela = (await a.get(enf, '/enfermagem/trr/unidade?unidade=ENF1')).json();
    expect(tela.fichas.find((f: { id: number }) => f.id === nova.json().id)).toMatchObject({
      unidade: 'ENF1',
      uti: false,
    });

    // A retificação da chegada: só do autor, versão nova com o motivo; a anterior fica visível.
    avancar(5);
    const man = await a.post(enf, '/enfermagem/trr', { ...P4, motivo: 'Dor torácica súbita com sudorese' });
    const mid = man.json().id as number;
    avancar(9);
    expect((await a.post(med, `/enfermagem/trr/${mid}/eventos`, { tipo: 'chegada' })).statusCode).toBe(201);
    tela = (await a.get(enf, '/enfermagem/trr/unidade?unidade=ENF1')).json();
    let ac = tela.acionamentos.find((x: { id: number }) => x.id === mid);
    const chegada = ac.eventos.find((v: { vigente: boolean }) => v.vigente);
    const antes = `${ac.acionadoEm.slice(0, 14)}${String(Number(ac.acionadoEm.slice(14, 16)) + 2).padStart(2, '0')}`;
    // A chegada registrada 9 min depois; a certa foi 2 min depois do acionamento.
    expect(ac.minutosResposta).toBe(9);
    expect(
      (
        await a.post(enf, `/enfermagem/trr/eventos/${chegada.id}/retificar`, {
          em: antes,
          motivo: 'A chegada foi registrada atrasada',
        })
      ).json().codigo,
    ).toBe('so-o-autor');
    const ret = await a.post(med, `/enfermagem/trr/eventos/${chegada.id}/retificar`, {
      em: antes,
      motivo: 'A chegada foi registrada atrasada',
    });
    expect(ret.statusCode, ret.body).toBe(201);
    tela = (await a.get(enf, '/enfermagem/trr/unidade?unidade=ENF1')).json();
    ac = tela.acionamentos.find((x: { id: number }) => x.id === mid);
    expect(ac.chegadaEm).toBe(antes);
    expect(ac.minutosResposta).toBe(2);
    expect(ac.eventos.map((v: { seq: number; vigente: boolean }) => [v.seq, v.vigente])).toEqual([
      [1, false],
      [2, true],
    ]);
    // A chegada inativada (lançada errada) libera o relançamento; o acionamento à mão inativado sai do indicador.
    const vig = ac.eventos.find((v: { vigente: boolean }) => v.vigente);
    expect(
      (
        await a.post(med, `/enfermagem/trr/eventos/${vig.id}/inativar`, {
          motivo: 'Chegada registrada no acionamento errado',
          senha: SENHA,
        })
      ).statusCode,
    ).toBe(200);
    expect((await a.post(med, `/enfermagem/trr/${mid}/eventos`, { tipo: 'chegada' })).statusCode).toBe(201);
    const antesInd = (await a.get(enf, '/enfermagem/trr/indicadores?de=2026-10-25&ate=2026-10-25')).json();
    const inatAc = await a.post(enf, `/enfermagem/trr/${mid}/inativar`, {
      motivo: 'Acionado no paciente errado',
      senha: SENHA,
    });
    expect(inatAc.statusCode, inatAc.body).toBe(200);
    const depois = (await a.get(enf, '/enfermagem/trr/indicadores?de=2026-10-25&ate=2026-10-25')).json();
    expect(depois.tempoResposta.noPrazo.denominador).toBe(antesInd.tempoResposta.noPrazo.denominador - 1);
    tela = (await a.get(enf, '/enfermagem/trr/unidade?unidade=ENF1')).json();
    expect(tela.acionamentos.find((x: { id: number }) => x.id === mid).inativacao).toMatchObject({
      motivo: 'Acionado no paciente errado',
    });
    // O evento do acionamento inativado não se registra mais.
    expect(
      (
        await a.post(med, `/enfermagem/trr/${mid}/eventos`, { tipo: 'desfecho', desfecho: 'permanece' })
      ).json().codigo,
    ).toBe('trr-inativado');
  });

  it('revisão W0-03: o alerta velho (fora das 12 horas) não aciona pelo escore; a ficha do paciente que saiu continua na tela e finalizável', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const med = await a.entrar('SINT.MEDICO');
    // O estorno do escore que acionou o time avisa o vínculo; o acionamento fica (marcado) e sai do "alerta ao acionamento".
    const antes = (await a.get(enf, '/enfermagem/trr/indicadores?de=2026-10-25&ate=2026-10-25')).json();
    const comEscore = (await a.get(enf, '/enfermagem/trr/unidade?unidade=ENF1'))
      .json()
      .acionamentos.find(
        (x: { origem: string; inativacao: unknown }) => x.origem === 'escore' && !x.inativacao,
      );
    const estorno = await a.post(enf, `/enfermagem/escores/${comEscore.escore}/estornar`, {
      motivo: 'PEWS lançado no paciente errado',
    });
    expect(estorno.statusCode, estorno.body).toBe(200);
    expect(estorno.json().vinculados).toEqual({
      acionamentos: 1,
      profilaxias: 0,
      protocolos: 0,
      reavaliacoes: 0,
    });
    expect(estorno.json().mensagem).toMatch(/acionou o Time de Resposta Rápida \(1 acionamento/);
    const marcado = (await a.get(enf, '/enfermagem/trr/unidade?unidade=ENF1'))
      .json()
      .acionamentos.find((x: { id: number }) => x.id === comEscore.id);
    expect(marcado.escoreEstornado).toBe(true);
    const depoisEst = (await a.get(enf, '/enfermagem/trr/indicadores?de=2026-10-25&ate=2026-10-25')).json();
    expect(depoisEst.alertaAteAcionar.n).toBe(antes.alertaAteAcionar.n - 1);

    const esc = await a.post(enf, '/enfermagem/escores', {
      ...P4,
      reg: 25204,
      unidade: 'ENF1',
      escala: 'pews',
      itens: PEWS_5,
    });
    const escore = esc.json().id as number;
    avancar(13 * 60);
    const velho = await a.post(enf, '/enfermagem/trr', { ...P4, escore });
    expect(velho.statusCode).toBe(409);
    expect(velho.json().codigo).toBe('alerta-fora-da-janela');
    // Uma ficha em rascunho de um atendimento que já não está internado (alta por óbito), parada na ENF1.
    const estados = (a.escores as unknown as { estados: Map<string, { pcr: unknown[]; seq: number }> })
      .estados;
    const [hosp, est] = [...estados.entries()][0]!;
    expect(hosp).toBeTruthy();
    const id = ++est.seq;
    est.pcr.push({
      id,
      paciente: 99_001,
      atendimento: 99_101,
      unidade: 'ENF1',
      uti: false,
      trr: null,
      anterior: null,
      versao: 1,
      situacao: 'rascunho',
      colapsoEm: '2026-10-25T09:00',
      dados: JSON.stringify(FICHA),
      autor: 'SINT.MEDICO',
      criadoEm: '2026-10-25T09:30:00',
      motivo: null,
      inativacao: null,
    });
    const tela = (await a.get(enf, '/enfermagem/trr/unidade?unidade=ENF1')).json();
    expect(tela.fichas.find((f: { id: number }) => f.id === id)).toMatchObject({
      situacao: 'rascunho',
      foraDaUnidade: true,
    });
    const fim = { ...FICHA, fimEm: '2026-10-25T08:40', desfecho: 'obito' };
    const r = await a.post(med, `/enfermagem/trr/pcr/${id}/versoes`, { dados: fim, finalizar: true });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().versao).toBe(2);
  });
});
