// M46 (etapa 2) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (dados SINTÉTICOS): o
// checklist em três momentos (regra 1: itens, observação obrigatória, ordem dos momentos e dos horários, versão vista,
// chave do pedido), a exceção em urgência, o quadro do bloco com o estado de segurança, o rastreio (entrada com o código
// do painel, mudança de local, sala obrigatória, saída e a saída desfeita), o painel para familiares sem nome (regra 5)
// e as chaves desligadas (POL-3).
import { LISTA_CHECKLIST_V1, type MomentoChecklist } from '@sgh/contratos';
import { FORMATO_CODIGO_PAINEL } from '@sgh/dominio-cirurgia';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AG,
  AMANHA,
  type AppBloco,
  HOJE,
  montarAppBloco,
  respostasQueConcluem,
} from './bloco-seguro.spec-util.js';
import { contextoDoEstabelecimento } from '../cadastro/contexto-nucleo.js';
import { PainelBlocoFamilia } from './painel-bloco-familia.js';

let a: AppBloco;
beforeAll(async () => {
  a = await montarAppBloco();
});
afterAll(async () => {
  await a.fechar();
});

const itens = (m: MomentoChecklist) => LISTA_CHECKLIST_V1.itens.filter((i) => i.momento === m);
const versao = async (s: Awaited<ReturnType<AppBloco['entrar']>>, ag = AG) =>
  (await a.get(s, `/${ag}/checklist`)).json().checklist.versao as number;

describe('checklist de cirurgia segura (regra 1)', () => {
  it('a tela com o contexto e o checklist vazio; sem as opções, 403', async () => {
    const s = await a.entrar('SINT.ENF.BLOCO');
    const r = await a.get(s, `/${AG}/checklist`);
    expect(r.statusCode, r.body).toBe(200);
    const t = r.json();
    expect(t.contexto).toMatchObject({ agendamento: AG, sala: 2 });
    expect(t.checklist).toMatchObject({ id: null, versao: 0, lista: 1, incisaoLiberada: false });
    expect(t.checklist.momentos.map((m: { momento: string }) => m.momento)).toEqual([
      'inducao',
      'incisao',
      'saida',
    ]);
    expect(t.checklist.momentos[1].impedimento).toBe('checklist-momento-fora-de-ordem');
    expect(t.gravacao.operacoes.confirmar.pode).toBe(true);
    expect(t.gravacao.operacoes.excecao.pode).toBe(false);
    expect(t.trava.ligada).toBe(true);
    const fora = await a.entrar('SINT.AGENDA');
    expect((await a.get(fora, `/${AG}/checklist`)).statusCode).toBe(403);
    expect((await a.post(fora, `/${AG}/checklist/itens`, {})).statusCode).toBe(403);
  });

  it('confirma os itens (o checklist nasce), exige a observação, recusa item de outro momento e a versão antiga', async () => {
    const s = await a.entrar('SINT.ENF.BLOCO');
    const base = { agendamento: AG, momento: 'inducao', versaoVista: 0, em: `${HOJE}T08:40` };
    const semObs = await a.post(s, `/${AG}/checklist/itens`, {
      ...base,
      itens: [{ item: 'alergiaConhecida', resposta: 'sim', observacao: null }],
    });
    expect(semObs.json().codigo).toBe('checklist-observacao-obrigatoria');
    const outro = await a.post(s, `/${AG}/checklist/itens`, {
      ...base,
      itens: [{ item: 'equipeApresentada', resposta: 'sim', observacao: null }],
    });
    expect(outro.json().codigo).toBe('checklist-item-desconhecido');
    const futuro = await a.post(s, `/${AG}/checklist/itens`, {
      ...base,
      em: `${HOJE}T09:30`,
      itens: [{ item: 'identidade', resposta: 'sim', observacao: null }],
    });
    expect(futuro.json().codigo).toBe('bloco-horario-futuro');
    const chave = a.novaChave();
    const ok = await a.post(
      s,
      `/${AG}/checklist/itens`,
      { ...base, itens: [{ item: 'identidade', resposta: 'sim', observacao: null }] },
      chave,
    );
    expect(ok.statusCode, ok.body).toBe(201);
    // O reenvio do mesmo pedido (a fila sem rede) não grava de novo; a versão antiga recusa.
    const de = await a.post(
      s,
      `/${AG}/checklist/itens`,
      { ...base, versaoVista: 1, itens: [{ item: 'identidade', resposta: 'sim', observacao: null }] },
      chave,
    );
    expect(de.statusCode).toBe(201);
    expect(await versao(s)).toBe(2);
    const velha = await a.post(s, `/${AG}/checklist/itens`, {
      ...base,
      versaoVista: 1,
      itens: [{ item: 'oximetro', resposta: 'sim', observacao: null }],
    });
    expect(velha.statusCode).toBe(409);
    expect(velha.json().codigo).toBe('checklist-mudou');
    // A trilha leva o evento sem dado clínico.
    expect(a.trilha.eventos.some((l) => l.evento === 'cirurgia.checklist.itensConfirmados')).toBe(true);
  });

  it('conclui os momentos na ordem, com todos os itens; nada muda depois; a saída conclui o checklist', async () => {
    const s = await a.entrar('SINT.ENF.BLOCO');
    const pendente = await a.post(s, `/${AG}/checklist/momentos`, {
      agendamento: AG,
      momento: 'inducao',
      versaoVista: await versao(s),
      em: `${HOJE}T08:45`,
    });
    expect(pendente.json().codigo).toBe('checklist-itens-pendentes');
    const respostas = respostasQueConcluem(itens('inducao')).map((r) =>
      r.item === 'alergiaConhecida' ? { ...r, resposta: 'sim', observacao: 'Dipirona' } : r,
    );
    expect(
      (
        await a.post(s, `/${AG}/checklist/itens`, {
          agendamento: AG,
          momento: 'inducao',
          versaoVista: await versao(s),
          em: `${HOJE}T08:42`,
          itens: respostas,
        })
      ).statusCode,
    ).toBe(201);
    const foraDeOrdem = await a.post(s, `/${AG}/checklist/momentos`, {
      agendamento: AG,
      momento: 'incisao',
      versaoVista: await versao(s),
      em: `${HOJE}T08:45`,
    });
    expect(foraDeOrdem.json().codigo).toBe('checklist-momento-fora-de-ordem');
    const antes = await a.post(s, `/${AG}/checklist/momentos`, {
      agendamento: AG,
      momento: 'inducao',
      versaoVista: await versao(s),
      em: `${HOJE}T08:41`,
    });
    expect(antes.json().codigo).toBe('checklist-horario-fora-de-ordem');
    const ind = await a.post(s, `/${AG}/checklist/momentos`, {
      agendamento: AG,
      momento: 'inducao',
      versaoVista: await versao(s),
      em: `${HOJE}T08:45`,
    });
    expect(ind.statusCode, ind.body).toBe(201);
    expect(ind.json().mensagem).toContain('Entrada');
    const t = (await a.get(s, `/${AG}/checklist`)).json();
    expect(t.checklist.momentos[0]).toMatchObject({
      concluidoEm: `${HOJE}T08:45`,
      concluidoPor: 'SINT.ENF.BLOCO',
    });
    expect(t.checklist.alertas).toEqual([expect.stringContaining('alergia')]);
    const depois = await a.post(s, `/${AG}/checklist/itens`, {
      agendamento: AG,
      momento: 'inducao',
      versaoVista: t.checklist.versao,
      em: `${HOJE}T08:50`,
      itens: [{ item: 'oximetro', resposta: 'sim', observacao: null }],
    });
    expect(depois.json().codigo).toBe('checklist-momento-concluido');
    for (const [m, hora] of [
      ['incisao', '08:50'],
      ['saida', '08:55'],
    ] as const) {
      await a.post(s, `/${AG}/checklist/itens`, {
        agendamento: AG,
        momento: m,
        versaoVista: await versao(s),
        em: `${HOJE}T${hora}`,
        itens: respostasQueConcluem(itens(m)),
      });
      const r = await a.post(s, `/${AG}/checklist/momentos`, {
        agendamento: AG,
        momento: m,
        versaoVista: await versao(s),
        em: `${HOJE}T${hora}`,
      });
      expect(r.statusCode, r.body).toBe(201);
    }
    const fim = (await a.get(s, `/${AG}/checklist`)).json().checklist;
    expect(fim).toMatchObject({ situacao: 'concluido', incisaoLiberada: true });
    expect(
      a.trilha.eventos
        .filter((l) => l.evento === 'cirurgia.checklist.momentoConcluido')
        .map((l) => l.resultado),
    ).toEqual(['sucesso', 'sucesso', 'sucesso']);
  });

  it('a exceção em urgência só pelo supervisor, com o motivo, e só antes da pausa', async () => {
    const enf = await a.entrar('SINT.ENF.BLOCO');
    const sup = await a.entrar('SINT.BLOCO');
    const AG2 = 702;
    const corpo = {
      agendamento: AG2,
      versaoVista: 0,
      urgencia: true,
      motivo: 'Urgência: sangramento ativo',
      em: `${HOJE}T08:50`,
    };
    expect((await a.post(enf, `/${AG2}/checklist/excecao`, corpo)).statusCode).toBe(403);
    expect((await a.post(sup, `/${AG2}/checklist/excecao`, { ...corpo, motivo: 'curto' })).statusCode).toBe(
      400,
    );
    const ok = await a.post(sup, `/${AG2}/checklist/excecao`, corpo);
    expect(ok.statusCode, ok.body).toBe(201);
    const t = (await a.get(sup, `/${AG2}/checklist`)).json().checklist;
    expect(t).toMatchObject({ incisaoLiberada: true, excecao: { por: 'SINT.BLOCO', motivo: corpo.motivo } });
    const de = await a.post(sup, `/${AG2}/checklist/excecao`, { ...corpo, versaoVista: t.versao });
    expect(de.json().codigo).toBe('excecao-ja-registrada');
    expect(a.trilha.eventos.some((l) => l.evento === 'cirurgia.incisao.excecao')).toBe(true);
    // Concluída a pausa, a exceção não cabe (no 701, do teste anterior).
    const r = await a.post(sup, `/${AG}/checklist/excecao`, {
      ...corpo,
      agendamento: AG,
      versaoVista: await versao(sup),
    });
    expect(r.json().codigo).toBe('excecao-timeout-concluido');
  });
});

describe('quadro do bloco, rastreio e painel para familiares', () => {
  it('o quadro do dia com o estado de segurança; o rastreio da entrada à saída com o código do painel', async () => {
    const s = await a.entrar('SINT.BLOCO');
    const q = (await a.get(s, `/quadro?data=${AMANHA}`)).json();
    expect(q.linhas.map((l: { agendamento: number }) => l.agendamento)).toEqual([701, 702]);
    expect(q.linhas[0].checklist).toMatchObject({ inducao: true, incisao: true, saida: true, alertas: 1 });
    expect(q.linhas[1].checklist).toMatchObject({ excecao: true });
    expect(q.totais).toMatchObject({ cirurgias: 2, noBloco: 0, pausaConcluida: 1 });
    expect((await a.get(s, '/dominios')).json().locais.map((l: { rotulo: string }) => l.rotulo)).toContain(
      'Sala cirúrgica',
    );
    const mover = (corpo: Record<string, unknown>) =>
      a.post(s, `/${AG}/rastreio`, { agendamento: AG, em: `${HOJE}T08:30`, ...corpo });
    expect((await mover({ ultimoVisto: 0, tipo: 'transferencia', local: 2 })).json().codigo).toBe(
      'rastreio-movimento-invalido',
    );
    const entrada = await mover({ ultimoVisto: 0, tipo: 'admissao', local: 1 });
    expect(entrada.statusCode, entrada.body).toBe(201);
    expect(entrada.json().codigoPainel).toMatch(FORMATO_CODIGO_PAINEL);
    expect((await mover({ ultimoVisto: 0, tipo: 'transferencia', local: 2 })).statusCode).toBe(409);
    expect((await mover({ ultimoVisto: 1, tipo: 'transferencia', local: 1 })).json().codigo).toBe(
      'rastreio-mesmo-local',
    );
    expect((await mover({ ultimoVisto: 1, tipo: 'transferencia', local: 3 })).json().codigo).toBe(
      'rastreio-sala-obrigatoria',
    );
    expect(
      (await mover({ ultimoVisto: 1, tipo: 'transferencia', local: 3, salaCirurgica: 99 })).json().codigo,
    ).toBe('rastreio-local-desconhecido');
    expect(
      (
        await mover({
          ultimoVisto: 1,
          tipo: 'transferencia',
          local: 3,
          salaCirurgica: 2,
          em: `${HOJE}T08:40`,
        })
      ).statusCode,
    ).toBe(201);
    const r = (await a.get(s, `/${AG}/rastreio`)).json();
    expect(r).toMatchObject({
      dentro: true,
      local: { id: 3, salaCirurgica: 2 },
      permitidos: ['transferencia', 'alta'],
    });
    expect(r.codigoPainel).toBe(entrada.json().codigoPainel);
    expect(r.movimentos.map((m: { tipo: string }) => m.tipo)).toEqual(['admissao', 'transferencia']);
    const saida = await mover({ ultimoVisto: 2, tipo: 'alta', destino: 'unidade', em: `${HOJE}T08:50` });
    expect(saida.statusCode, saida.body).toBe(201);
    expect(saida.json().mensagem).toContain('Unidade de internação');
    const desfeita = await mover({ ultimoVisto: 3, tipo: 'cancelamentoAlta', em: `${HOJE}T08:55` });
    expect(desfeita.statusCode, desfeita.body).toBe(201);
    expect((await a.get(s, `/${AG}/rastreio`)).json().local).toMatchObject({ id: 3, salaCirurgica: 2 });
    const q2 = (await a.get(s, `/quadro?data=${AMANHA}`)).json();
    expect(q2.linhas[0]).toMatchObject({ local: { id: 3 }, codigoPainel: entrada.json().codigoPainel });
    expect(q2.totais).toMatchObject({ noBloco: 1, emSala: 1 });
    expect(a.trilha.eventos.filter((l) => l.evento === 'cirurgia.rastreio.movido')).toHaveLength(4);
    const sem = await a.entrar('SINT.ENF.BLOCO');
    expect(
      (
        await a.post(sem, `/${AG}/rastreio`, {
          agendamento: AG,
          ultimoVisto: 4,
          tipo: 'alta',
          destino: 'uti',
          em: `${HOJE}T08:58`,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('o painel para familiares só com o código, a etapa e o horário (nunca nome, procedimento nem sala)', async () => {
    const p = new PainelBlocoFamilia(a.blocoSeguro, a.cirurgia);
    const v = await p.painel({ ...contextoDoEstabelecimento('aa'), usuario: null, correlacao: 'teste' });
    expect(v.linhas).toHaveLength(1);
    expect(v.linhas[0]).toEqual({
      codigo: expect.stringMatching(FORMATO_CODIGO_PAINEL),
      etapa: 'cirurgia',
      rotuloEtapa: 'Em cirurgia',
      desde: '08:55',
    });
    const texto = JSON.stringify(v);
    expect(texto).not.toMatch(/PACIENTE|SINTETICO|COLECIST|sala|701/i);
  });
});

describe('chaves desligadas (POL-3)', () => {
  it('sem as chaves, as telas ficam em consulta e as gravações recusam com 403 recurso-desligado', async () => {
    const b = await montarAppBloco({ semChaves: ['bloco.checklistFormulario', 'bloco.rastreio'] });
    try {
      const s = await b.entrar('SINT.ENF.BLOCO');
      const t = (await b.get(s, `/${AG}/checklist`)).json();
      expect(t.gravacao.ligada).toBe(false);
      const r = await b.post(s, `/${AG}/checklist/itens`, {
        agendamento: AG,
        momento: 'inducao',
        versaoVista: 0,
        em: `${HOJE}T08:40`,
        itens: [{ item: 'identidade', resposta: 'sim', observacao: null }],
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().codigo).toBe('recurso-desligado');
      const sb = await b.entrar('SINT.BLOCO');
      const m = await b.post(sb, `/${AG}/rastreio`, {
        agendamento: AG,
        ultimoVisto: 0,
        tipo: 'admissao',
        local: 1,
        em: `${HOJE}T08:40`,
      });
      expect(m.json().codigo).toBe('recurso-desligado');
    } finally {
      await b.fechar();
    }
  });
});
