// W0-03 (programa CRUD completo; matriz, linha "Hemoterapia"; RDC 34/2014 art. 15 §1º) pela HTTP, com a sessão real
// sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco; dados sintéticos):
//   - a requisição se altera (volume, urgência, hemocomponente) antes do atendimento, com o motivo; a versão anterior
//     fica legível; depois do início da transfusão, 409;
//   - o adendo do ato não muda o ato (a linha lida antes é igual à lida depois) e o momento sem medida é recusado;
//   - a bolsa se corrige (etiqueta, validade, volume) antes do uso, com a versão anterior legível; depois do uso, 409;
//   - o motivo nunca vai à trilha.
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

describe('W0-03: hemoterapia — requisição, ato e bolsa corrigidos com a versão legível', () => {
  let med: Sessao;
  let enf: Sessao;
  let bio: Sessao;
  let admin: Sessao;
  let req = 0;
  let agora = '';
  let bolsaId = 0;
  let ato = 0;
  const numero = `SINT03B${String(Date.now()).slice(-6)}`;
  const validade = () => `${String(Number(agora.slice(0, 4)) + 1)}-01-31T23:59`;

  async function liberacao(ligar: boolean) {
    const r = await a.post(admin, '/administracao/liberacao', {
      chave: 'agencia.completa',
      tipo: 'recurso',
      escopo: 'pessoa',
      valores: PESSOAS,
      ligar,
      justificativa: 'Agência própria sintética (teste do W0-03)',
      senha: SENHA,
    });
    expect(r.statusCode, r.body).toBe(200);
  }

  it('requisição: alterada antes do atendimento, com o motivo; a original fica legível; sem mudança, 409', async () => {
    med = await a.entrar('SINT.MEDICO');
    enf = await a.entrar('SINT.ENF.PLANTAO');
    bio = await a.entrar('SINT.BIOMEDICO');
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
    const d0 = (await a.get(med, `/sadt/transfusao/requisicoes/${req}`)).json();
    expect(d0.gravacao.acoes.alterar).toBe(true);
    expect(d0.versoes).toEqual([]);
    expect(d0.versaoVigente).toBe(1);
    // Motivo curto: 400; nenhum campo: 400.
    const curto = await a.post(med, `/sadt/transfusao/requisicoes/${req}/alterar`, {
      volumeMl: 300,
      motivo: 'curto',
    });
    expect(curto.statusCode).toBe(400);
    const nada = await a.post(med, `/sadt/transfusao/requisicoes/${req}/alterar`, {
      motivo: 'Nada a alterar aqui',
    });
    expect(nada.statusCode).toBe(400);
    const antes = a.trilha.eventos.length;
    const alt = await a.post(med, `/sadt/transfusao/requisicoes/${req}/alterar`, {
      volumeMl: 300,
      urgencia: 'urgente',
      motivo: 'Volume e urgência pedidos errado',
    });
    expect(alt.statusCode, alt.body).toBe(200);
    expect(alt.json()).toMatchObject({ ok: true, versao: 2 });
    const d = (await a.get(med, `/sadt/transfusao/requisicoes/${req}`)).json();
    expect(d.requisicao).toMatchObject({ volumeMl: 300, urgencia: 'urgente', estado: 'requisitada' });
    expect(d.versaoVigente).toBe(2);
    expect(d.versoes).toHaveLength(1);
    expect(d.versoes[0]).toMatchObject({
      versao: 1,
      hemocomponente: 'CH',
      volumeMl: null,
      urgencia: 'rotina',
      motivo: 'Volume e urgência pedidos errado',
      alteradaPor: 'SINT.MEDICO',
    });
    // O prazo da urgente é recalculado a partir da hora da requisição (3 horas).
    expect(d.requisicao.prazo).not.toBe(d0.requisicao.prazo);
    // A trilha leva o evento, sem o motivo (o valor anterior fica na versão).
    const novas = a.trilha.eventos.slice(antes);
    expect(novas.some((l) => l.evento === 'sadt.transfusao.alterada')).toBe(true);
    expect(JSON.stringify(novas)).not.toContain('pedidos errado');
    const igual = await a.post(med, `/sadt/transfusao/requisicoes/${req}/alterar`, {
      volumeMl: 300,
      motivo: 'Repetindo a mesma alteração',
    });
    expect(igual.statusCode).toBe(409);
    expect(igual.json().codigo).toBe('requisicao-sem-mudanca');
    // A programada sem data: 409; o hemocomponente fora da lista: 422.
    const prog = await a.post(med, `/sadt/transfusao/requisicoes/${req}/alterar`, {
      urgencia: 'programada',
      motivo: 'Passar para programada',
    });
    expect(prog.statusCode).toBe(409);
    expect(prog.json().codigo).toBe('programada-sem-data');
    const xx = await a.post(med, `/sadt/transfusao/requisicoes/${req}/alterar`, {
      hemocomponente: 'XX',
      motivo: 'Hemocomponente inexistente',
    });
    expect(xx.statusCode).toBe(422);
  });

  it('com a amostra coletada ainda se altera; quem não requisita não altera', async () => {
    const am = await a.post(enf, `/sadt/transfusao/requisicoes/${req}/amostra`, {
      pulseira: { lida: true, codigo: UTI2.pulseira },
      identificadoresConferidos: true,
      rotuladaNoLeito: true,
      coletadaEm: agora.slice(0, 16),
    });
    expect(am.statusCode, am.body).toBe(201);
    const sem = await a.post(enf, `/sadt/transfusao/requisicoes/${req}/alterar`, {
      volumeMl: 280,
      motivo: 'Enfermagem tentando alterar',
    });
    expect(sem.statusCode).toBe(403);
    const ok = await a.post(med, `/sadt/transfusao/requisicoes/${req}/alterar`, {
      volumeMl: 280,
      motivo: 'Volume ajustado depois da amostra',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const d = (await a.get(med, `/sadt/transfusao/requisicoes/${req}`)).json();
    expect(d.requisicao.estado).toBe('amostraColetada');
    expect(d.versoes.map((v: { versao: number; volumeMl: number | null }) => [v.versao, v.volumeMl])).toEqual(
      [
        [1, null],
        [2, 300],
      ],
    );
  });

  it('bolsa: corrigida antes do uso, com o motivo e a versão anterior legível; versão velha e sem mudança, 409', async () => {
    const pre = await a.app.inject({
      method: 'PUT',
      url: '/api/administracao/liberacao/prerequisitos',
      headers: { cookie: admin.cookie, 'x-csrf': admin.csrf, 'idempotency-key': `pre-${Date.now()}` },
      payload: {
        recurso: 'agencia.completa',
        tipo: 'aprovacao',
        situacao: 'cumprido',
        validade: '2099-12-31',
        evidencia: 'decisão sintética da DP-21 (teste do W0-03)',
        senha: SENHA,
      },
    });
    expect(pre.statusCode, pre.body).toBe(200);
    await liberacao(true);
    const r = await a.post(bio, '/sadt/agencia/bolsas', {
      numero,
      hemocomponente: 'CH',
      tipagem: { abo: 'O', rh: 'positivo' },
      volumeMl: 280,
      validade: validade(),
      origem: 'Hemocentro sintético',
      local: 1,
      irradiada: false,
      leucorreduzida: true,
      temperaturaC: 4,
      inspecaoOk: true,
      liberarNaEntrada: true,
    });
    expect(r.statusCode, r.body).toBe(201);
    bolsaId = r.json().id;
    expect((await a.get(bio, '/sadt/agencia/estado')).json().gravacao.acoes.corrigir).toBe(true);
    const curto = await a.post(bio, `/sadt/agencia/bolsas/${bolsaId}/corrigir`, {
      volumeMl: 300,
      versao: 0,
      motivo: 'curto',
    });
    expect(curto.statusCode).toBe(400);
    const antes = a.trilha.eventos.length;
    const ok = await a.post(bio, `/sadt/agencia/bolsas/${bolsaId}/corrigir`, {
      volumeMl: 300,
      validade: `${String(Number(agora.slice(0, 4)) + 1)}-01-30T23:59`,
      versao: 0,
      motivo: 'Volume e validade da etiqueta digitados errado',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ ok: true, numero, versao: 2 });
    const novas = a.trilha.eventos.slice(antes);
    expect(novas.some((l) => l.evento === 'sadt.bolsa.corrigida')).toBe(true);
    expect(JSON.stringify(novas)).not.toContain('digitados errado');
    const b = (await a.get(bio, `/sadt/agencia/bolsas/${bolsaId}`)).json();
    expect(b.bolsa).toMatchObject({ volumeMl: 300, versao: 1 });
    expect(b.versoes).toEqual([
      expect.objectContaining({
        versao: 1,
        numero,
        volumeMl: 280,
        validade: validade(),
        tipagem: { abo: 'O', rh: 'positivo' },
        motivo: 'Volume e validade da etiqueta digitados errado',
        corrigidaPor: 'SINT.BIOMEDICO',
      }),
    ]);
    const velha = await a.post(bio, `/sadt/agencia/bolsas/${bolsaId}/corrigir`, {
      volumeMl: 290,
      versao: 0,
      motivo: 'Corrigindo com a tela velha',
    });
    expect(velha.statusCode).toBe(409);
    expect(velha.json().codigo).toBe('bolsa-alterada');
    const igual = await a.post(bio, `/sadt/agencia/bolsas/${bolsaId}/corrigir`, {
      volumeMl: 300,
      versao: 1,
      motivo: 'Repetindo a mesma correção',
    });
    expect(igual.json().codigo).toBe('bolsa-sem-mudanca');
    // A agência completa desligada: a bolsa fica em consulta (o ato da etapa 1 não confere o estoque).
    await liberacao(false);
  });

  it('depois do início da transfusão: requisição alterada → 409 (a versão anterior continua legível)', async () => {
    const inicio = await a.post(enf, `/sadt/transfusao/requisicoes/${req}/atos`, {
      horario: null,
      pulseira: { lida: true, codigo: UTI2.pulseira },
      bolsa: {
        numero,
        hemocomponente: 'CH',
        tipagem: { abo: 'O', rh: 'positivo' },
        validade: `${String(Number(agora.slice(0, 4)) + 1)}-01-30T23:59`,
        volumeMl: 300,
        etiquetaDoReceptorConfere: true,
        inspecaoVisualOk: true,
      },
      segundoProfissional: { login: 'SINT.ENF.APOIO', senha: SENHA },
      sinaisAntes: sinais,
      justificativaRh: null,
    });
    expect(inicio.statusCode, inicio.body).toBe(201);
    ato = inicio.json().ato;
    const depois = await a.post(med, `/sadt/transfusao/requisicoes/${req}/alterar`, {
      volumeMl: 250,
      motivo: 'Alterar depois do atendimento',
    });
    expect(depois.statusCode).toBe(409);
    expect(depois.json().codigo).toBe('requisicao-ja-atendida');
    const d = (await a.get(med, `/sadt/transfusao/requisicoes/${req}`)).json();
    expect(d.requisicao.estado).toBe('emAtendimento');
    expect(d.versoes).toHaveLength(2);
  });

  it('ato: o adendo não altera o registro original (a linha antes = depois); o momento sem medida é recusado', async () => {
    const ler = async () =>
      (await a.get(enf, `/sadt/transfusao/requisicoes/${req}`))
        .json()
        .atos.find((x: { id: number }) => x.id === ato);
    const antes = await ler();
    expect(antes.adendos).toEqual([]);
    const semMedida = await a.post(enf, `/sadt/transfusao/atos/${ato}/adendo`, {
      momento: 'depois',
      sinais,
      motivo: 'Sinais do término digitados errado',
    });
    expect(semMedida.statusCode).toBe(409);
    expect(semMedida.json().codigo).toBe('momento-sem-medida');
    const curto = await a.post(enf, `/sadt/transfusao/atos/${ato}/adendo`, {
      momento: 'antes',
      sinais,
      motivo: 'curto',
    });
    expect(curto.statusCode).toBe(400);
    const medico = await a.post(med, `/sadt/transfusao/atos/${ato}/adendo`, {
      momento: 'antes',
      sinais: { ...sinais, pas: 128 },
      motivo: 'Médico tentando o adendo',
    });
    expect(medico.statusCode).toBe(403);
    const marca = a.trilha.eventos.length;
    const ok = await a.post(enf, `/sadt/transfusao/atos/${ato}/adendo`, {
      momento: 'antes',
      sinais: { ...sinais, pas: 128 },
      motivo: 'PAS digitada 118 em vez de 128',
    });
    expect(ok.statusCode, ok.body).toBe(201);
    const depois = await ler();
    const { adendos: a1, tarefas: t1, ...linhaAntes } = antes;
    const { adendos: a2, tarefas: t2, ...linhaDepois } = depois;
    void [a1, t1, t2];
    // O registro original (com os sinais do momento "antes") é exatamente o mesmo.
    expect(linhaDepois).toEqual(linhaAntes);
    expect(linhaDepois.sinais.find((s: { momento: string }) => s.momento === 'antes').pas).toBe(118);
    expect(a2).toEqual([
      expect.objectContaining({
        ato,
        momento: 'antes',
        sinais: { ...sinais, pas: 128 },
        motivo: 'PAS digitada 118 em vez de 128',
        usuario: 'SINT.ENF.PLANTAO',
      }),
    ]);
    const novas = a.trilha.eventos.slice(marca);
    expect(novas.some((l) => l.evento === 'sadt.transfusao.adendo')).toBe(true);
    expect(JSON.stringify(novas)).not.toContain('digitada 118');
  });

  it('bolsa: depois do uso (há ato com o número), corrigir → 409; a versão anterior continua legível', async () => {
    await liberacao(true);
    const b = (await a.get(bio, `/sadt/agencia/bolsas/${bolsaId}`)).json();
    expect(b.bolsa.situacao).toBe('transfundida');
    const r = await a.post(bio, `/sadt/agencia/bolsas/${bolsaId}/corrigir`, {
      volumeMl: 250,
      versao: b.bolsa.versao,
      motivo: 'Corrigir depois do uso',
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('bolsa-usada');
    expect(b.versoes).toHaveLength(1);
    // Nenhuma rota de exclusão física: DELETE e POST …/excluir não existem.
    const del = await a.app.inject({
      method: 'DELETE',
      url: `/api/sadt/agencia/bolsas/${bolsaId}`,
      headers: { cookie: bio.cookie, 'x-csrf': bio.csrf },
    });
    expect([404, 405]).toContain(del.statusCode);
    const excluirAto = await a.post(enf, `/sadt/transfusao/atos/${ato}/excluir`, { motivo: 'Excluir o ato' });
    expect(excluirAto.statusCode).toBe(404);
  });
});
