// Agência transfusional pela HTTP (M47, etapa 1; regras 1 a 7 e 11), com a sessão real sobre a fonte sintética e as
// portas EM MEMÓRIA (nada conecta a banco; dados sintéticos): o médico requisita a partir do item de hemoterapia com o
// termo (a segunda aberta do item é recusada; sem termo fora da extrema urgência, também); a enfermeira registra a
// amostra com a pulseira (a de outro paciente é recusada); o início sem o segundo profissional, com a mesma pessoa, com
// a bolsa incompatível ou vencida é bloqueado; com a dupla checagem, o horário da prescrição fica administrado (a
// checagem do M25) e o ato fica em curso; os sinais aos 10 a 15 minutos; a reação interrompe o ato e sugere a
// notificação; os indicadores e os campos da notificação só com as iniciais; o item sem horário fica só no novo, com a
// conclusão e o ganho no balanço; a chave desligada deixa em consulta.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarAppSae, type Sessao } from './sae.spec-util.js';
import { ITEM_SEM_HORARIO_SINTETICO } from './transfusao-porta-memoria.js';

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
const UTI1 = { atendimento: 25_101, pulseira: 'P25001|A25201' };

interface ItemLido {
  item: number;
  atendimento: number;
  horarios: number;
  hemocomponente: { codigo: string };
}

const requisicao = (
  item: number,
  atendimento: number,
  termo: number | null,
  x: Record<string, unknown> = {},
) => ({
  itemHemoterapia: item,
  atendimento,
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
  ...x,
});

const sinais = { pas: 118, pad: 76, fc: 84, temperatura: 36.6 };
const inicio = (agora: string, x: Record<string, unknown> = {}) => ({
  horario: null,
  pulseira: { lida: true, codigo: UTI2.pulseira },
  bolsa: {
    numero: 'SINT47A0001',
    hemocomponente: 'CH',
    tipagem: { abo: 'O', rh: 'positivo' },
    validade: `${String(Number(agora.slice(0, 4)) + 1)}-01-31T23:59`,
    volumeMl: 300,
    etiquetaDoReceptorConfere: true,
    inspecaoVisualOk: true,
  },
  segundoProfissional: { login: 'SINT.ENF.APOIO', senha: SENHA },
  sinaisAntes: sinais,
  justificativaRh: null,
  ...x,
});

async function itens(s: Sessao): Promise<{ itens: ItemLido[]; agora: string }> {
  const r = await a.get(s, '/sadt/transfusao/itens');
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}

describe('agência transfusional (etapa 1) pela HTTP', () => {
  let med: Sessao;
  let enf: Sessao;
  let req = 0;
  let agora = '';

  it('o médico vê os itens a atender (com e sem horário), o item com a proposta, o termo e a tipagem', async () => {
    med = await a.entrar('SINT.MEDICO');
    const r = await itens(med);
    agora = r.agora;
    const comHorario = r.itens.find((i) => i.atendimento === UTI2.atendimento && i.horarios > 0)!;
    expect(comHorario).toBeDefined();
    expect(r.itens.some((i) => i.item === ITEM_SEM_HORARIO_SINTETICO && i.horarios === 0)).toBe(true);
    const d = (await a.get(med, `/sadt/transfusao/itens/${comHorario.item}`)).json();
    expect(d.proposta).toMatchObject({ hemocomponente: 'CH', quantidadeBolsas: 1, urgencia: 'rotina' });
    expect(d.termos).toHaveLength(1);
    expect(d.tipagem).toEqual({ abo: 'O', rh: 'positivo' });
  });

  it('o cancelamento tem o evento próprio; a busca por nome e prontuário vai à leitura', async () => {
    // Antes das outras: o item cancelado volta a ficar a atender (os testes seguintes o usam).
    const r = await itens(med);
    const i = r.itens.find((x) => x.atendimento === UTI2.atendimento && x.horarios > 0)!;
    expect(i).toBeDefined();
    const termo = (await a.get(med, `/sadt/transfusao/itens/${i.item}`)).json().termos[0]?.id ?? null;
    const q = await a.post(
      med,
      '/sadt/transfusao/requisicoes',
      requisicao(
        i.item,
        i.atendimento,
        termo,
        termo === null
          ? {
              urgencia: 'extremaUrgencia',
              justificativaUrgencia: 'Sangramento ativo sintético com instabilidade',
            }
          : {},
      ),
    );
    expect(q.statusCode, q.body).toBe(201);
    const id = q.json().id as number;
    const c = await a.post(med, `/sadt/transfusao/requisicoes/${id}/cancelar`, {
      motivo: 'Pedido em duplicidade sintético',
    });
    expect(c.statusCode, c.body).toBe(200);
    const ev = a.trilha.eventos.filter((l) => l.evento === 'sadt.transfusao.cancelada');
    expect(ev).toHaveLength(1);
    const d = (await a.get(med, `/sadt/transfusao/requisicoes/${id}`)).json();
    const pront = d.requisicao.paciente.prontuario as number;
    const porPront = (await a.get(med, `/sadt/transfusao/requisicoes?termo=${String(pront)}`)).json();
    expect(porPront.itens.map((x: { id: number }) => x.id)).toContain(id);
    const nada = (await a.get(med, '/sadt/transfusao/requisicoes?termo=NINGUEMSINTETICO')).json();
    expect(nada.itens).toEqual([]);
  });

  it('regra 1: requisita com o termo; sem termo recusa; a segunda aberta do item é recusada', async () => {
    const r = await itens(med);
    const i = r.itens.find((x) => x.atendimento === UTI2.atendimento && x.horarios > 0)!;
    const termo = (await a.get(med, `/sadt/transfusao/itens/${i.item}`)).json().termos[0].id as number;
    const sem = await a.post(med, '/sadt/transfusao/requisicoes', requisicao(i.item, i.atendimento, null));
    expect(sem.statusCode).toBe(400);
    const errado = await a.post(med, '/sadt/transfusao/requisicoes', requisicao(i.item, i.atendimento, 999));
    expect(errado.statusCode, errado.body).toBe(409);
    expect(errado.json().codigo).toBe('sem-termo');
    const chaveReq = `teste-m47-req-${Date.now()}`;
    const ok = await a.post(
      med,
      '/sadt/transfusao/requisicoes',
      requisicao(i.item, i.atendimento, termo),
      chaveReq,
    );
    expect(ok.statusCode, ok.body).toBe(201);
    req = ok.json().id;
    expect(ok.json().repetida).toBe(false);
    // D-CHAVE-UI: o reenvio com a mesma chave (a resposta perdida) devolve a requisição gravada, não a recusa.
    const reenvio = await a.post(
      med,
      '/sadt/transfusao/requisicoes',
      requisicao(i.item, i.atendimento, termo),
      chaveReq,
    );
    expect(reenvio.statusCode, reenvio.body).toBe(201);
    expect(reenvio.json()).toMatchObject({ id: req, repetida: true, prazo: ok.json().prazo });
    const de = await a.post(med, '/sadt/transfusao/requisicoes', requisicao(i.item, i.atendimento, termo));
    expect(de.statusCode).toBe(409);
    expect((await itens(med)).itens.some((x) => x.item === i.item)).toBe(false);
    const lista = (await a.get(med, '/sadt/transfusao/requisicoes?estado=requisitada')).json();
    expect(lista.itens.map((x: { id: number }) => x.id)).toContain(req);
  });

  it('a amostra com a pulseira do paciente (a de outro paciente recusada) e a requisição em "amostra coletada"', async () => {
    enf = await a.entrar('SINT.ENF.PLANTAO');
    const coletadaEm = agora.slice(0, 16);
    const outro = await a.post(enf, `/sadt/transfusao/requisicoes/${req}/amostra`, {
      pulseira: { lida: true, codigo: UTI1.pulseira },
      identificadoresConferidos: true,
      rotuladaNoLeito: true,
      coletadaEm,
    });
    expect(outro.statusCode).toBe(409);
    expect(outro.json().codigo).toBe('pulseira-outro-paciente');
    const ok = await a.post(enf, `/sadt/transfusao/requisicoes/${req}/amostra`, {
      pulseira: { lida: true, codigo: UTI2.pulseira },
      identificadoresConferidos: true,
      rotuladaNoLeito: true,
      coletadaEm,
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().codigo).toMatch(/^HT\d{10}$/);
    const d = (await a.get(enf, `/sadt/transfusao/requisicoes/${req}`)).json();
    expect(d.requisicao.estado).toBe('amostraColetada');
    expect(d.gravacaoNoHorario).toBe('checar-administrado');
  });

  it('regras 2 e 3: sem dupla checagem, com a mesma pessoa, bolsa incompatível ou vencida, não inicia', async () => {
    const semSenha = await a.post(
      enf,
      `/sadt/transfusao/requisicoes/${req}/atos`,
      inicio(agora, { segundoProfissional: { login: 'SINT.ENF.APOIO', senha: 'errada' } }),
    );
    expect(semSenha.statusCode).toBe(409);
    expect(semSenha.json().bloqueios).toContain('sem-segundo-profissional');
    const mesma = await a.post(
      enf,
      `/sadt/transfusao/requisicoes/${req}/atos`,
      inicio(agora, { segundoProfissional: { login: 'SINT.ENF.PLANTAO', senha: SENHA } }),
    );
    expect(mesma.json().bloqueios).toContain('segundo-profissional-igual');
    const b = inicio(agora).bolsa;
    const incompat = await a.post(
      enf,
      `/sadt/transfusao/requisicoes/${req}/atos`,
      inicio(agora, { bolsa: { ...b, tipagem: { abo: 'A', rh: 'positivo' } } }),
    );
    expect(incompat.json().bloqueios).toContain('abo-incompativel');
    const vencida = await a.post(
      enf,
      `/sadt/transfusao/requisicoes/${req}/atos`,
      inicio(agora, { bolsa: { ...b, validade: '2020-01-01T00:00' } }),
    );
    expect(vencida.json().bloqueios).toContain('bolsa-vencida');
    expect(a.trilha.eventos.some((l) => l.evento === 'sadt.transfusao.bloqueada')).toBe(true);
  });

  it('com a dupla checagem: o horário administrado (checagem do M25), o ato em curso, os sinais e a reação', async () => {
    const conta = (ev: string) => a.trilha.eventos.filter((l) => l.evento === ev).length;
    const [iniciadas, bloqueadas] = [conta('sadt.transfusao.iniciada'), conta('sadt.transfusao.bloqueada')];
    const chaveAto = `teste-m47-ato-${Date.now()}`;
    const r = await a.post(enf, `/sadt/transfusao/requisicoes/${req}/atos`, inicio(agora), chaveAto);
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().horarioChecado).not.toBeNull();
    const ato = r.json().ato as number;
    // Regra 11: o início pela checagem do M25 também tem a linha própria (TRANSFUSAO_INICIADA).
    expect(conta('sadt.transfusao.iniciada')).toBe(iniciadas + 1);
    // D-CHAVE-UI: o reenvio com a mesma chave devolve o ato (não "bolsa já usada" nem bloqueio na trilha).
    const reenvio = await a.post(enf, `/sadt/transfusao/requisicoes/${req}/atos`, inicio(agora), chaveAto);
    expect(reenvio.statusCode, reenvio.body).toBe(201);
    expect(reenvio.json()).toMatchObject({ ato, repetida: true, horarioChecado: r.json().horarioChecado });
    expect(conta('sadt.transfusao.bloqueada')).toBe(bloqueadas);
    expect(conta('sadt.transfusao.iniciada')).toBe(iniciadas + 1);
    const h = (await a.get(enf, `/enfermagem/horarios/${r.json().horarioChecado}`)).json();
    expect(h.situacao ?? h.horario?.situacao).toBe('A');
    // A mesma bolsa não entra de novo.
    const d = (await a.get(enf, `/sadt/transfusao/requisicoes/${req}`)).json();
    expect(d.requisicao.estado).toBe('emAtendimento');
    expect(d.atos[0].tarefas.map((t: { momento: string }) => t.momento)).toEqual([
      'antes',
      'durante',
      'depois',
    ]);
    expect(d.atos[0].sinais[0].momento).toBe('antes');
    const s = await a.post(enf, `/sadt/transfusao/atos/${ato}/sinais`, {
      momento: 'durante',
      sinais: { ...sinais, fc: 92 },
      medidoEm: agora.slice(0, 16),
    });
    expect(s.statusCode, s.body).toBe(201);
    expect(s.json().foraDaJanela).toBe(true);
    // Os sinais têm o evento próprio (não contam como mais uma transfusão iniciada).
    expect(conta('sadt.transfusao.sinaisRegistrados')).toBe(1);
    expect(conta('sadt.transfusao.iniciada')).toBe(iniciadas + 1);
    const de = await a.post(enf, `/sadt/transfusao/atos/${ato}/sinais`, {
      momento: 'durante',
      sinais,
      medidoEm: agora.slice(0, 16),
    });
    expect(de.statusCode).toBe(409);
    // Regra 5: a reação com a transfusão em curso interrompe o ato e sugere a notificação imediata (grau 3).
    const re = {
      tipo: 'hemoliticaAgudaImune',
      descricaoOutra: null,
      grau: 3,
      correlacao: 'provavel',
      inicioEm: agora.slice(0, 16),
      sinaisESintomas: 'Dor lombar sintética, febre e hipotensão',
      condutas: ['comunicarMedico'],
      condutaOutra: null,
      destinoBolsa: 'devolvida',
      sinaisNaReacao: { pas: 88, pad: 50, fc: 120, temperatura: 38.6 },
      volumeTransfundidoMl: 60,
    };
    const semInterromper = await a.post(enf, `/sadt/transfusao/atos/${ato}/reacao`, re);
    expect(semInterromper.statusCode).toBe(409);
    expect(semInterromper.json().codigo).toBe('em-curso-sem-interromper');
    const ok = await a.post(enf, `/sadt/transfusao/atos/${ato}/reacao`, {
      ...re,
      condutas: ['interromperTransfusao', 'comunicarMedico'],
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json()).toMatchObject({
      interrompeu: true,
      notificacao: { prioridade: 'imediata', sugerida: true },
    });
    const depois = (await a.get(enf, `/sadt/transfusao/requisicoes/${req}`)).json();
    expect(depois.atos[0].estado).toBe('interrompido');
    expect(depois.requisicao.estado).toBe('atendida');
    expect(a.trilha.eventos.some((l) => l.evento === 'sadt.bolsa.descartada')).toBe(true);
  });

  it('hemovigilância: as reações e os indicadores com o numerador e o denominador; os campos só com as iniciais', async () => {
    const h = await a.get(enf, '/sadt/transfusao/hemovigilancia');
    expect(h.statusCode, h.body).toBe(200);
    const x = h.json();
    expect(x.reacoes).toHaveLength(1);
    const ind = x.indicadores.find((i: { codigo: string }) => i.codigo === 'reacoesPorMil');
    expect(ind).toMatchObject({ numerador: 1, denominador: 1, valor: 1000 });
    const n = (await a.get(enf, `/sadt/transfusao/reacoes/${x.reacoes[0].id}/notificacao`)).json();
    expect(n.campos.paciente.iniciais).toMatch(/^[A-Z]+$/);
    expect(JSON.stringify(n.campos)).not.toContain('PACIENTE');
    const env = await a.post(enf, `/sadt/transfusao/reacoes/${x.reacoes[0].id}/notificacao`, {
      enviadaEm: agora.slice(0, 16),
    });
    expect(env.statusCode, env.body).toBe(200);
    // O envio da notificação tem o evento próprio (não conta como nova reação).
    expect(a.trilha.eventos.filter((l) => l.evento === 'sadt.reacao.notificada')).toHaveLength(1);
    expect(a.trilha.eventos.filter((l) => l.evento === 'sadt.reacao.registrada')).toHaveLength(1);
    const de = await a.post(enf, `/sadt/transfusao/reacoes/${x.reacoes[0].id}/notificacao`, {
      enviadaEm: agora.slice(0, 16),
    });
    expect(de.statusCode).toBe(409);
  });

  it('o item sem horário fica só no novo: extrema urgência sem termo, início, conclusão com o ganho e os sinais do término', async () => {
    const r = await a.post(
      med,
      '/sadt/transfusao/requisicoes',
      requisicao(ITEM_SEM_HORARIO_SINTETICO, UTI1.atendimento, null, {
        urgencia: 'extremaUrgencia',
        justificativaUrgencia: 'Sangramento ativo sintético com instabilidade',
      }),
    );
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json().id as number;
    // Extrema urgência: sem amostra nem termo (a justificativa), mas com a dupla checagem e os sinais de antes.
    const i = await a.post(
      enf,
      `/sadt/transfusao/requisicoes/${id}/atos`,
      inicio(agora, {
        pulseira: { lida: true, codigo: UTI1.pulseira },
        bolsa: {
          ...inicio(agora).bolsa,
          numero: 'SINT47B0001',
          hemocomponente: 'CP',
          tipagem: { abo: 'A', rh: 'negativo' },
        },
      }),
    );
    expect(i.statusCode, i.body).toBe(201);
    expect(i.json().horarioChecado).toBeNull();
    const c = await a.post(enf, `/sadt/transfusao/atos/${i.json().ato}/concluir`, {
      terminoEm: agora.slice(0, 16),
      volumeTransfundidoMl: 250,
      interrompida: false,
      motivoInterrupcao: null,
    });
    expect(c.statusCode, c.body).toBe(200);
    expect(c.json()).toMatchObject({ estadoRequisicao: 'atendida', ganhoNoBalanco: true });
    const s = await a.post(enf, `/sadt/transfusao/atos/${i.json().ato}/sinais`, {
      momento: 'depois',
      sinais,
      medidoEm: agora.slice(0, 16),
    });
    expect(s.statusCode, s.body).toBe(201);
    const de = await a.post(enf, `/sadt/transfusao/atos/${i.json().ato}/concluir`, {
      terminoEm: agora.slice(0, 16),
      volumeTransfundidoMl: 250,
      interrompida: false,
      motivoInterrupcao: null,
    });
    expect(de.statusCode).toBe(409);
  });

  it('regra 4: as tarefas dos sinais na linha do tempo do turno da unidade; o histórico transfusional do paciente', async () => {
    const t = (await a.get(enf, '/sadt/transfusao/tarefas?unidade=UTI')).json();
    // As duas transfusões do dia ficam na linha do tempo: a interrompida (UTI-02) sem os sinais do término (a tarefa
    // "depois" devida) e a concluída (UTI-01) sem a medida dos 10 a 15 minutos.
    const leitos = t.itens.map((x: { paciente: { leito: string } }) => x.paciente.leito);
    expect(leitos.sort()).toEqual(['UTI-01', 'UTI-02']);
    const uti2 = t.itens.find((x: { paciente: { leito: string } }) => x.paciente.leito === 'UTI-02');
    expect(uti2.tarefas.find((x: { momento: string }) => x.momento === 'depois').situacao).toBe('devida');
    const uti1 = t.itens.find((x: { paciente: { leito: string } }) => x.paciente.leito === 'UTI-01');
    expect(uti1.tarefas.find((x: { momento: string }) => x.momento === 'depois').situacao).toBe('feita');
    expect((await a.get(enf, '/sadt/transfusao/tarefas?unidade=../x')).statusCode).toBe(400);
    const h = (await a.get(enf, '/sadt/transfusao/pacientes/25002/historico')).json();
    expect(h).toMatchObject({ tipagem: { abo: 'O', rh: 'positivo' }, origemTipagem: 'cadastro' });
    expect(h.atos).toHaveLength(1);
    expect(h.atos[0].reacao).not.toBeNull();
  });

  it('sem a permissão, 403; a chave desligada deixa em consulta', async () => {
    const tec = await a.entrar('SINT.TECNICO.ENF');
    expect((await a.post(tec, '/sadt/transfusao/requisicoes', requisicao(1, 1, 1))).statusCode).toBe(403);
    const b = await montarAppSae({ semChave: 'agencia.transfusao' });
    try {
      const m = await b.entrar('SINT.MEDICO');
      const g = (await b.get(m, '/sadt/transfusao/itens')).json();
      expect(g.gravacao).toMatchObject({ ligada: false, acoes: { requisitar: false } });
      const it0 = g.itens[0] as ItemLido;
      const termo = (await b.get(m, `/sadt/transfusao/itens/${it0.item}`)).json().termos[0]?.id ?? 1;
      const r = await b.post(m, '/sadt/transfusao/requisicoes', requisicao(it0.item, it0.atendimento, termo));
      expect(r.statusCode).toBe(403);
      expect(r.json().codigo).toBe('recurso-desligado');
      // O início confere a chave da agência antes de tudo (o caminho da checagem do M25 só conferia a dela): 403
      // antes de ler a requisição, e nada vai à trilha nem ao horário.
      const enf0 = await b.entrar('SINT.ENF.PLANTAO');
      const antes = b.trilha.eventos.length;
      const ini = await b.post(
        enf0,
        '/sadt/transfusao/requisicoes/47999/atos',
        inicio(g.agora ?? '2026-10-24T10:00'),
      );
      expect(ini.statusCode, ini.body).toBe(403);
      expect(ini.json().codigo).toBe('recurso-desligado');
      expect(b.trilha.eventos.slice(antes).filter((l) => l.evento.startsWith('sadt.'))).toEqual([]);
    } finally {
      await b.app.close();
    }
  });
});
