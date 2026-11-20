// Agência transfusional, etapa 2, pela HTTP (M47; regras 3, 6 e 11), com a sessão real sobre a fonte sintética e as
// portas EM MEMÓRIA (nada conecta a banco; dados sintéticos): desligada (POL-3), tudo em consulta; ligada a
// `agencia.completa` com o pré-requisito, a biomédica registra a tipagem ABO e Rh (a mesma pessoa não libera; a
// hemoterapeuta libera), a pesquisa de anticorpos e a prova cruzada; recebe a bolsa (o mesmo número de novo é recusado;
// fora da faixa entra em quarentena); a reserva sem prova é recusada; com a prova liberada, reserva; o início do ato
// pela enfermagem usa a tipagem da agência (que prevalece sobre o cadastro) e a bolsa do estoque; a bolsa fica
// transfundida e não se movimenta mais; o descarte vai à trilha como BOLSA_DESCARTADA; os cadastros da agência só gravam
// com a chave.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarAppSae, type Sessao } from './sae.spec-util.js';

type App = Awaited<ReturnType<typeof montarAppSae>>;
let a: App;
beforeAll(async () => {
  a = await montarAppSae();
});
afterAll(async () => {
  await a.app.close();
});

const SENHA = 'Sintetico#2026';
const UTI2 = { atendimento: 25_102, pulseira: 'P25002|A25202' };
const PESSOAS = ['SINT.BIOMEDICO', 'SINT.HEMOTERAPEUTA', 'SINT.ENF.PLANTAO'];
const sinais = { pas: 118, pad: 76, fc: 84, temperatura: 36.6 };

async function liberacao(admin: Sessao, ligar: boolean) {
  const r = await a.post(admin, '/administracao/liberacao', {
    chave: 'agencia.completa',
    tipo: 'recurso',
    escopo: 'pessoa',
    valores: PESSOAS,
    ligar,
    justificativa: 'Agência própria sintética (teste da etapa 2)',
    senha: SENHA,
  });
  expect(r.statusCode, r.body).toBe(200);
}

describe('agência transfusional (etapa 2) pela HTTP', () => {
  let med: Sessao;
  let enf: Sessao;
  let bio: Sessao;
  let hemo: Sessao;
  let admin: Sessao;
  let req = 0;
  let paciente = 0;
  let agora = '';
  let bolsaId = 0;
  const numero = `SINT47B${String(Date.now()).slice(-6)}`;
  const validade = () => `${String(Number(agora.slice(0, 4)) + 1)}-01-31T23:59`;

  it('prepara a requisição com a amostra (etapa 1) e, desligada a agência completa, tudo fica em consulta', async () => {
    med = await a.entrar('SINT.MEDICO');
    enf = await a.entrar('SINT.ENF.PLANTAO');
    bio = await a.entrar('SINT.BIOMEDICO');
    hemo = await a.entrar('SINT.HEMOTERAPEUTA');
    admin = await a.entrar('SINT.ADMIN');
    const r = (await a.get(med, '/sadt/transfusao/itens')).json();
    agora = r.agora;
    const i = r.itens.find(
      (x: { atendimento: number; horarios: number }) => x.atendimento === UTI2.atendimento && x.horarios > 0,
    );
    const termo = (await a.get(med, `/sadt/transfusao/itens/${i.item}`)).json().termos[0].id as number;
    const q = await a.post(med, '/sadt/transfusao/requisicoes', {
      itemHemoterapia: i.item,
      atendimento: i.atendimento,
      quantidadeBolsas: 1,
      volumeMl: null,
      urgencia: 'rotina',
      programadaPara: null,
      indicacao: 'Hemoglobina sintética 6,9 com taquicardia',
      examesDeApoio: null,
      termo,
      justificativaUrgencia: null,
      transfusaoAnterior: 'nao',
      reacaoAnterior: 'nao',
      gestacaoAnterior: 'naoSeAplica',
    });
    expect(q.statusCode, q.body).toBe(201);
    req = q.json().id;
    const am = await a.post(enf, `/sadt/transfusao/requisicoes/${req}/amostra`, {
      pulseira: { lida: true, codigo: UTI2.pulseira },
      identificadoresConferidos: true,
      rotuladaNoLeito: true,
      coletadaEm: agora.slice(0, 16),
    });
    expect(am.statusCode, am.body).toBe(201);
    const est = (await a.get(bio, '/sadt/agencia/estado')).json();
    expect(est.gravacao.ligada).toBe(false);
    const d = (await a.get(bio, `/sadt/agencia/requisicoes/${req}`)).json();
    paciente = d.requisicao.paciente.id;
    expect(d.receptor).toMatchObject({ origem: 'cadastro', tipagem: { abo: 'O', rh: 'positivo' } });
    const des = await a.post(bio, '/sadt/agencia/imuno', {
      tipo: 'pai',
      paciente,
      requisicao: req,
      metodo: 'gelTeste',
      origem: 'digitado',
      exameLancado: null,
      observacao: null,
      resultado: 'negativo',
      anticorpos: null,
    });
    expect(des.statusCode).toBe(403);
    expect(des.json().codigo).toBe('recurso-desligado');
  });

  it('regra 6: ligada a agência completa (com o pré-requisito), a tipagem é registrada e liberada por outra pessoa', async () => {
    const pre = await a.app.inject({
      method: 'PUT',
      url: '/api/administracao/liberacao/prerequisitos',
      headers: { cookie: admin.cookie, 'x-csrf': admin.csrf, 'idempotency-key': `pre-${Date.now()}` },
      payload: {
        recurso: 'agencia.completa',
        tipo: 'aprovacao',
        situacao: 'cumprido',
        validade: '2099-12-31',
        evidencia: 'decisão sintética da DP-21 (teste)',
        senha: SENHA,
      },
    });
    expect(pre.statusCode, pre.body).toBe(200);
    await liberacao(admin, true);
    expect((await a.get(bio, '/sadt/agencia/estado')).json().gravacao).toMatchObject({
      ligada: true,
      acoes: { registrar: true, receber: true },
    });
    const aboRh = await a.post(bio, '/sadt/agencia/imuno', {
      tipo: 'aboRh',
      paciente,
      requisicao: req,
      metodo: 'gelTeste',
      origem: 'digitado',
      exameLancado: null,
      observacao: null,
      direta: { antiA: 4, antiB: 0, antiD: 4, controle: 0 },
      reversa: { hemaciaA1: 0, hemaciaB: 4 },
    });
    expect(aboRh.statusCode, aboRh.body).toBe(201);
    expect(aboRh.json().tipagem).toEqual({ abo: 'A', rh: 'positivo' });
    const id = aboRh.json().id as number;
    const propria = await a.post(bio, `/sadt/agencia/imuno/${id}/liberar`, { conferido: true });
    expect(propria.statusCode).toBe(409);
    expect(propria.json().codigo).toBe('mesmo-profissional');
    const lib = await a.post(hemo, `/sadt/agencia/imuno/${id}/liberar`, { conferido: true });
    expect(lib.statusCode, lib.body).toBe(200);
    const pai = await a.post(bio, '/sadt/agencia/imuno', {
      tipo: 'pai',
      paciente,
      requisicao: req,
      metodo: 'gelTeste',
      origem: 'digitado',
      exameLancado: null,
      observacao: null,
      resultado: 'negativo',
      anticorpos: null,
    });
    expect(pai.statusCode, pai.body).toBe(201);
    expect(
      (await a.post(hemo, `/sadt/agencia/imuno/${pai.json().id}/liberar`, { conferido: true })).statusCode,
    ).toBe(200);
    // A discrepância fica registrada sem tipagem e não pode ser liberada.
    const disc = await a.post(bio, '/sadt/agencia/imuno', {
      tipo: 'aboRh',
      paciente,
      requisicao: req,
      metodo: 'tubo',
      origem: 'digitado',
      exameLancado: null,
      observacao: null,
      direta: { antiA: 4, antiB: 0, antiD: 4, controle: 0 },
      reversa: { hemaciaA1: 4, hemaciaB: 4 },
    });
    expect(disc.json().tipagem).toBeNull();
    const nao = await a.post(hemo, `/sadt/agencia/imuno/${disc.json().id}/liberar`, { conferido: true });
    expect(nao.json().codigo).toBe('tipagem-inconclusiva');
    const inv = await a.post(hemo, `/sadt/agencia/imuno/${disc.json().id}/invalidar`, {
      motivo: 'Discrepância sintética',
    });
    expect(inv.statusCode, inv.body).toBe(200);
    const d = (await a.get(bio, `/sadt/agencia/requisicoes/${req}`)).json();
    expect(d.receptor).toMatchObject({
      origem: 'agencia',
      tipagem: { abo: 'A', rh: 'positivo' },
      pai: 'negativo',
    });
    for (const ev of ['sadt.imuno.registrado', 'sadt.imuno.liberado', 'sadt.imuno.invalidado'])
      expect(a.trilha.eventos.some((l) => l.evento === ev)).toBe(true);
  });

  it('regra 3: o estoque recebe a bolsa (repetida recusada; fora da faixa em quarentena) e reserva só com a prova', async () => {
    const bolsa = (n: string, x: Record<string, unknown> = {}) => ({
      numero: n,
      hemocomponente: 'CH',
      tipagem: { abo: 'A', rh: 'positivo' },
      volumeMl: 290,
      validade: validade(),
      origem: 'Hemocentro sintético',
      local: 0,
      irradiada: false,
      leucorreduzida: true,
      temperaturaC: 4,
      inspecaoOk: true,
      liberarNaEntrada: true,
      ...x,
    });
    const r = await a.post(bio, '/sadt/agencia/bolsas', bolsa(numero));
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().situacao).toBe('liberada');
    bolsaId = r.json().id;
    const de = await a.post(bio, '/sadt/agencia/bolsas', bolsa(numero));
    expect(de.json().codigo).toBe('bolsa-ja-recebida');
    const quente = await a.post(bio, '/sadt/agencia/bolsas', bolsa(`${numero}Q`, { temperaturaC: 15 }));
    expect(quente.json()).toMatchObject({ situacao: 'quarentena' });
    expect(quente.json().alertas.join(' ')).toContain('fora da faixa');
    const vencida = await a.post(
      bio,
      '/sadt/agencia/bolsas',
      bolsa(`${numero}V`, { validade: '2020-01-01T00:00' }),
    );
    expect(vencida.json().codigo).toBe('bolsa-vencida-no-recebimento');

    const est = (await a.get(bio, '/sadt/agencia/bolsas')).json();
    expect(est.resumo.find((x: { abo: string }) => x.abo === 'A')).toMatchObject({
      liberadas: 1,
      quarentena: 1,
    });
    const sem = await a.post(bio, `/sadt/agencia/bolsas/${bolsaId}/movimentos`, {
      acao: 'reservar',
      requisicao: req,
      motivoCadastro: null,
      motivo: null,
      versao: 0,
    });
    expect(sem.statusCode).toBe(409);
    expect(sem.json().bloqueios).toContain('prova-cruzada-pendente');

    const prova = await a.post(bio, '/sadt/agencia/imuno', {
      tipo: 'provaCruzada',
      paciente,
      requisicao: req,
      metodo: 'gelTeste',
      origem: 'digitado',
      exameLancado: null,
      observacao: null,
      bolsa: numero,
      resultado: 'compativel',
      faseAntiglobulina: true,
    });
    expect(prova.statusCode, prova.body).toBe(201);
    const fora = await a.post(bio, '/sadt/agencia/imuno', {
      tipo: 'provaCruzada',
      paciente,
      requisicao: req,
      metodo: 'gelTeste',
      origem: 'digitado',
      exameLancado: null,
      observacao: null,
      bolsa: 'NAOEXISTE01',
      resultado: 'compativel',
      faseAntiglobulina: true,
    });
    expect(fora.json().bloqueios).toContain('bolsa-fora-do-estoque');
    expect(
      (await a.post(hemo, `/sadt/agencia/imuno/${prova.json().id}/liberar`, { conferido: true })).statusCode,
    ).toBe(200);
    const versaoVelha = await a.post(bio, `/sadt/agencia/bolsas/${bolsaId}/movimentos`, {
      acao: 'reservar',
      requisicao: req,
      motivoCadastro: null,
      motivo: null,
      versao: 5,
    });
    expect(versaoVelha.json().codigo).toBe('versao-desatualizada');
    const res = await a.post(bio, `/sadt/agencia/bolsas/${bolsaId}/movimentos`, {
      acao: 'reservar',
      requisicao: req,
      motivoCadastro: null,
      motivo: null,
      versao: 0,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().situacao).toBe('reservada');
    const d = (await a.get(bio, `/sadt/agencia/requisicoes/${req}`)).json();
    expect(d.reservadas.map((b: { numero: string }) => b.numero)).toEqual([numero]);
  });

  it('o início do ato usa a tipagem da agência e a bolsa reservada; a bolsa fica transfundida; o descarte vai à trilha', async () => {
    const inicio = (n: string) => ({
      horario: null,
      pulseira: { lida: true, codigo: UTI2.pulseira },
      bolsa: {
        numero: n,
        hemocomponente: 'CH',
        tipagem: { abo: 'A', rh: 'positivo' },
        validade: validade(),
        volumeMl: 290,
        etiquetaDoReceptorConfere: true,
        inspecaoVisualOk: true,
      },
      segundoProfissional: { login: 'SINT.ENF.APOIO', senha: SENHA },
      sinaisAntes: sinais,
      justificativaRh: null,
    });
    // Fora do estoque: recusado (com a agência própria, a bolsa vem do estoque).
    const fora = await a.post(enf, `/sadt/transfusao/requisicoes/${req}/atos`, inicio('SINT47FORA01'));
    expect(fora.statusCode).toBe(409);
    expect(fora.json().bloqueios).toContain('bolsa-fora-do-estoque');
    // A bolsa A positivo no paciente que o cadastro diz O positivo: vale a tipagem da agência (A positivo).
    const ok = await a.post(enf, `/sadt/transfusao/requisicoes/${req}/atos`, inicio(numero));
    expect(ok.statusCode, ok.body).toBe(201);
    const b = (await a.get(bio, `/sadt/agencia/bolsas/${bolsaId}`)).json();
    expect(b.bolsa.situacao).toBe('transfundida');
    expect(b.bolsa.acoes).toEqual([]);
    expect(b.movimentos.map((m: { tipo: string }) => m.tipo)).toEqual([
      'recebimento',
      'reserva',
      'transfusao',
    ]);
    const desc = await a.post(bio, `/sadt/agencia/bolsas/${bolsaId}/movimentos`, {
      acao: 'descartar',
      requisicao: null,
      motivoCadastro: 0,
      motivo: 'Descarte sintético',
      versao: 1,
    });
    expect(desc.json().codigo).toBe('bolsa-transfundida');
    // A de quarentena é descartada com o motivo (BOLSA_DESCARTADA na trilha).
    const q = (await a.get(bio, '/sadt/agencia/bolsas?situacao=quarentena')).json().itens[0];
    const d2 = await a.post(bio, `/sadt/agencia/bolsas/${q.id}/movimentos`, {
      acao: 'descartar',
      requisicao: null,
      motivoCadastro: 0,
      motivo: 'Temperatura sintética fora da faixa',
      versao: q.versao,
    });
    expect(d2.statusCode, d2.body).toBe(200);
    expect(a.trilha.eventos.some((l) => l.evento === 'sadt.bolsa.descartada')).toBe(true);
    expect(a.trilha.eventos.some((l) => l.evento === 'sadt.bolsa.recebida')).toBe(true);
  });

  it('a quarentena tem saída coerente; o local e o motivo vêm do cadastro; as leituras dirigidas vão à trilha com o paciente', async () => {
    const receber = (n: string, x: Record<string, unknown>) =>
      a.post(bio, '/sadt/agencia/bolsas', {
        numero: n,
        hemocomponente: 'CH',
        tipagem: { abo: 'B', rh: 'positivo' },
        volumeMl: 280,
        validade: validade(),
        origem: 'Hemocentro sintético',
        local: 1,
        irradiada: false,
        leucorreduzida: true,
        temperaturaC: 4,
        inspecaoOk: true,
        liberarNaEntrada: true,
        ...x,
      });
    const liberar = (id: number, x: Record<string, unknown> = {}) =>
      a.post(bio, `/sadt/agencia/bolsas/${id}/movimentos`, {
        acao: 'liberar',
        requisicao: null,
        motivoCadastro: null,
        motivo: null,
        versao: 0,
        ...x,
      });
    // Os combos do recebimento e dos movimentos.
    const cad = await a.get(bio, '/sadt/agencia/estoque/cadastros');
    expect(cad.statusCode, cad.body).toBe(200);
    expect(cad.json().locais.map((l: { codigo: number }) => l.codigo)).toContain(1);
    expect(cad.json().motivos.map((l: { codigo: number }) => l.codigo)).toContain(2);
    // O local que não existe no cadastro é recusado.
    const semLocal = await receber(`${numero}L`, { local: 9999 });
    expect(semLocal.json().codigo).toBe('local-inexistente');
    // Temperatura fora da faixa: a liberação pede o motivo, que vai ao histórico.
    const quente = (await receber(`${numero}T`, { temperaturaC: 15 })).json();
    expect(quente.situacao).toBe('quarentena');
    const semMotivo = await liberar(quente.id);
    expect(semMotivo.json().codigo).toBe('motivo-da-liberacao');
    const comMotivo = await liberar(quente.id, { motivo: 'Reaferida a 4 °C, dentro da faixa' });
    expect(comMotivo.statusCode, comMotivo.body).toBe(200);
    const h = (await a.get(bio, `/sadt/agencia/bolsas/${quente.id}`)).json();
    expect(h.movimentos.at(-1)).toMatchObject({
      tipo: 'liberacao',
      motivo: 'Reaferida a 4 °C, dentro da faixa',
    });
    // Inspeção reprovada: sem a reinspeção não sai; com ela (e o motivo), sai e a inspeção passa a aprovada.
    const ruim = (await receber(`${numero}I`, { inspecaoOk: false })).json();
    expect(ruim.situacao).toBe('quarentena');
    const sem = await liberar(ruim.id, { motivo: 'Conferi o rótulo de novo' });
    expect(sem.json().codigo).toBe('inspecao-pendente');
    const semTexto = await liberar(ruim.id, { inspecaoConferida: true });
    expect(semTexto.statusCode).toBe(400);
    const re = await liberar(ruim.id, {
      inspecaoConferida: true,
      motivo: 'Reinspeção: rótulo legível, sem hemólise',
    });
    expect(re.statusCode, re.body).toBe(200);
    expect((await a.get(bio, `/sadt/agencia/bolsas/${ruim.id}`)).json().bolsa.inspecaoOk).toBe(true);
    // O motivo do cadastro que não existe é recusado; o que existe grava.
    const desc = (motivoCadastro: number) =>
      a.post(bio, `/sadt/agencia/bolsas/${ruim.id}/movimentos`, {
        acao: 'descartar',
        requisicao: null,
        motivoCadastro,
        motivo: 'Descarte sintético',
        versao: 1,
      });
    expect((await desc(12_345)).json().codigo).toBe('motivo-inexistente');
    expect((await desc(2)).statusCode).toBe(200);
    // A leitura da bolsa vai à trilha; a imuno-hematologia filtrada pelo paciente vai com ele.
    const antes = a.trilha.eventos.length;
    await a.get(bio, `/sadt/agencia/bolsas/${ruim.id}`);
    expect(a.trilha.eventos.slice(antes)).toContainEqual(
      expect.objectContaining({
        evento: 'sadt.agencia.lida',
        tabelaAlvo: 'SGH_SADT_HEMO_BOLSA',
        idAlvo: String(ruim.id),
      }),
    );
    const antes2 = a.trilha.eventos.length;
    await a.get(bio, `/sadt/agencia/imuno?paciente=${paciente}`);
    expect(a.trilha.eventos.slice(antes2)).toContainEqual(
      expect.objectContaining({ evento: 'sadt.agencia.lida', tabelaAlvo: 'SGH_SADT_HEMO_IMUNO', paciente }),
    );
    const antes3 = a.trilha.eventos.length;
    await a.get(bio, `/sadt/agencia/imuno?requisicao=${req}`);
    expect(a.trilha.eventos.slice(antes3)).toContainEqual(
      expect.objectContaining({ evento: 'sadt.agencia.lida', paciente, idAlvo: String(req) }),
    );
  });

  it('com a chave, os cadastros da agência não ficam em consulta pela chave', async () => {
    const ok = await a.get(hemo, '/cadastros/dominios/sadt/agenciaReacao');
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().recusadas?.criar ?? '').not.toContain('ainda não foi liberado para gravar');
    expect(ok.json().permitidas).toEqual(expect.arrayContaining(['criar', 'editar']));
  });

  it('a gravação dos cadastros da agência exige também a sadt.agenciaCadastro.editar (a da tela da ficha)', async () => {
    // A biomédica tem a permissão de cada cadastro (pelas opções), mas não a de editar os cadastros da agência.
    const d = await a.get(bio, '/cadastros/dominios/sadt/agenciaReacao');
    expect(d.statusCode, d.body).toBe(200);
    expect(d.json().permitidas).not.toContain('criar');
    expect(d.json().permitidas).not.toContain('editar');
    const r = await a.post(bio, '/cadastros/dominios/sadt/agenciaReacao/itens', { valores: {} });
    expect(r.statusCode).toBe(403);
    expect(
      a.trilha.eventos.some(
        (l) => l.evento === 'acesso.permissao.negada' && l.recurso === 'sadt.agenciaCadastro.editar',
      ),
    ).toBe(true);
  });

  it('recolher: desligada de novo, a gravação volta a recusar', async () => {
    await liberacao(admin, false);
    const r = await a.post(bio, '/sadt/agencia/bolsas', {
      numero: `${numero}R`,
      hemocomponente: 'CP',
      tipagem: { abo: 'O', rh: 'positivo' },
      volumeMl: 200,
      validade: validade(),
      origem: 'Hemocentro sintético',
      local: 0,
      irradiada: false,
      leucorreduzida: false,
      temperaturaC: 22,
      inspecaoOk: true,
      liberarNaEntrada: true,
    });
    expect(r.statusCode).toBe(403);
    // Os cadastros da agência voltam à consulta, com o motivo; a gravação é recusada antes do executor.
    const dom = await a.get(hemo, '/cadastros/dominios/sadt/agenciaReacao');
    expect(dom.json().recusadas?.criar ?? '').toContain('ainda não foi liberado para gravar');
    const grava = await a.app.inject({
      method: 'POST',
      url: '/api/cadastros/dominios/sadt/agenciaReacao/itens',
      headers: { cookie: hemo.cookie, 'x-csrf': hemo.csrf, 'idempotency-key': `cad-${Date.now()}` },
      payload: { valores: { descricao: 'REACAO SINTETICA M47' } },
    });
    expect(grava.statusCode, grava.body).toBe(403);
    expect(grava.json().codigo).toBe('recurso-desligado');
  });
});
