// M25 (enfermagem beira-leito) pela HTTP, com a sessão real sobre a fonte sintética e a porta EM MEMÓRIA (nada conecta
// a banco): permissões pelas opções do legado, a linha do tempo do turno (atrasada, omitida, suspensa), a checagem com
// a pulseira, os nove certos, o não administrado com o motivo, a dupla checagem com o segundo login, a glicemia com a
// faixa da escala, a infusão, o aprazamento só do enfermeiro (no novo), o conflito da suspensão vinda da prescrição, a
// sincronização sem rede na ordem, os sinais vitais com a faixa e a retificação, a passagem de plantão com o aceite, os
// aparelhos e o estorno com o motivo (W1-08: grava no banco). Dados sintéticos.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type AppEnfermagem,
  checagemPadrao,
  criarAppEnfermagem,
  horariosDaUti,
  SENHA,
} from './enfermagem.spec-util.js';
import { PERMISSOES_ENFERMAGEM as P, PERMISSOES_ENFERMAGEM_M25 } from '@sgh/contratos';
import { estadoAcessoSintetico } from '../acesso/fonte-sintetica.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { REDE } from '../../sessao/teste.spec-util.js';
import { EnfermagemController } from './enfermagem.controller.js';

let a: AppEnfermagem;
beforeAll(async () => {
  a = await criarAppEnfermagem();
});
afterAll(async () => {
  await a.fechar();
});

describe('permissões, funcionalidades e a linha do tempo do turno', () => {
  it('sem as opções da checagem, 403; o enfermeiro vê a UTI com o estado de cada horário', async () => {
    const outra = await a.entrar('SINT.AGENDA');
    expect((await a.get(outra, '/enfermagem/turno?unidade=UTI')).statusCode).toBe(403);
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const g = (await a.get(s, '/enfermagem/gravacao')).json();
    expect(g.categoria).toBe('enfermeiro');
    expect(g.funcionalidades['enfermagem.checagem'].ligada).toBe(true);
    // POL-3: a leitura obrigatória da dose depende da etiqueta de dose (M29): desligada, com o motivo.
    expect(g.funcionalidades['enfermagem.leituraDose'].ligada).toBe(false);
    // W1-08: o estorno e o aprazamento gravam no banco (ligados).
    expect(g.operacoes['enfermagem.estornarChecagem']).toMatchObject({ pode: true, motivo: null });
    expect(g.operacoes['enfermagem.aprazarHorario']).toMatchObject({ pode: true, motivo: null });
    expect(g.parametros).toMatchObject({
      toleranciaMinutos: 60,
      pulseiraObrigatoria: true,
      duplaChecagem: true,
    });
    const t = await horariosDaUti(a, s);
    expect(t.pacientes).toHaveLength(3);
    // A dipirona de 2 horas atrás está atrasada (tolerância de 60 min); a de 20 min, a checar.
    const dip = t.horarios.filter((h) => h.descricao.startsWith('DIPIRONA'));
    expect(dip.map((h) => h.estado).slice(0, 2)).toEqual(['atrasada', 'pendente']);
    // A ceftriaxona (antimicrobiano, tempo crítico de 30 min) de 90 min atrás: atrasada.
    expect(t.horarios.find((h) => h.descricao.startsWith('CEFTRIAXONA'))?.estado).toBe('atrasada');
    // As faixas da escala de glicemia não aparecem como dose própria.
    expect(t.horarios.some((h) => h.descricao.startsWith('Escala da glicemia'))).toBe(false);
    expect(t.resumo['atrasada']).toBeGreaterThanOrEqual(2);
    expect(a.trilha.eventos.some((e) => e.evento === 'enfermagem.horario.lido')).toBe(true);
    expect(JSON.stringify([g, t])).not.toMatch(/SPDATA|legado|sistema atual/i);
    expect((await a.get(s, '/enfermagem/unidades')).json()).toHaveLength(2);
  });
  it('a pulseira lida abre o paciente; o código que não é de pulseira recusa', async () => {
    const s = await a.entrar('SINT.TECNICO.ENF');
    const p = await a.get(s, '/enfermagem/pulseira?codigo=P25001|A25201');
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ atendimento: 25101, leito: 'UTI-01' });
    expect((await a.get(s, '/enfermagem/pulseira?codigo=XYZ')).statusCode).toBe(400);
    expect((await a.get(s, '/enfermagem/pulseira?codigo=P99999')).statusCode).toBe(404);
    const hs = await a.get(s, '/enfermagem/pacientes/25101/horarios');
    expect(hs.statusCode).toBe(200);
    expect(hs.json().paciente.nome).toMatch(/SINTETICO M25/);
  });
});

describe('checagem: pulseira, motivo, nove certos', () => {
  it('administrado com a pulseira do paciente; a de outro paciente e sem leitura sem motivo recusam', async () => {
    const s = await a.entrar('SINT.TECNICO.ENF');
    const t = await horariosDaUti(a, s);
    const h = t.horarios.find((x) => x.descricao.startsWith('DIPIRONA') && x.estado === 'pendente')!;
    const outro = await a.post(s, `/enfermagem/horarios/${h.id}/checar`, checagemPadrao(25002, 25202));
    expect(outro.statusCode).toBe(409);
    expect(outro.json().codigo).toBe('pulseira-outro-paciente');
    const semLer = await a.post(s, `/enfermagem/horarios/${h.id}/checar`, {
      ...checagemPadrao(25001, 25201),
      pulseira: { lida: false, motivo: 'semPulseira' },
    });
    // Sem ler a pulseira, com o motivo: vale (vai para a trilha e para o indicador).
    expect(semLer.statusCode).toBe(200);
    const d = (await a.get(s, `/enfermagem/horarios/${h.id}`)).json();
    expect(d.horario.situacao).toBe('A');
    expect(d.atos[0]).toMatchObject({ pulseiraLida: false, motivoSemPulseira: 'semPulseira' });
    expect(a.trilha.eventos.some((e) => e.evento === 'enfermagem.administracao.checada')).toBe(true);
    // Checado: a segunda checagem do mesmo horário vira conflito (nunca sobrescreve).
    const de2 = await a.post(s, `/enfermagem/horarios/${h.id}/checar`, checagemPadrao(25001, 25201));
    expect(de2.statusCode).toBe(409);
    expect(de2.json().codigo).toBe('horario-ja-checado');
    expect(de2.json().conflito).toBeGreaterThan(0);
  });
  it('não administrado exige o motivo da lista; os nove certos bloqueiam a dose maior e o vencido', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const t = await horariosDaUti(a, s);
    const h = t.horarios.find((x) => x.descricao.startsWith('ONDANSETRONA'))!;
    const sem = await a.post(s, `/enfermagem/horarios/${h.id}/checar`, {
      ...checagemPadrao(25003, 25203),
      desfecho: 'naoAdministrado',
    });
    expect(sem.statusCode).toBe(422);
    // "Se necessário" administrado exige a condição.
    const sn = await a.post(s, `/enfermagem/horarios/${h.id}/checar`, checagemPadrao(25003, 25203));
    expect(sn.statusCode).toBe(422);
    const maior = await a.post(
      s,
      `/enfermagem/horarios/${h.id}/checar`,
      checagemPadrao(25003, 25203, { observacao: 'náusea', quantidade: 8 }),
    );
    expect(maior.statusCode).toBe(409);
    expect(maior.json().codigo).toBe('nove-certos');
    const vencido = await a.post(
      s,
      `/enfermagem/horarios/${h.id}/checar`,
      checagemPadrao(25003, 25203, {
        observacao: 'náusea',
        dose: { codigo: '(01)07891000400049(17)200101(10)L1' },
      }),
    );
    expect(vencido.statusCode).toBe(409);
    expect(vencido.json().bloqueios.join(' ')).toMatch(/vencido/);
    const outroRemedio = await a.post(
      s,
      `/enfermagem/horarios/${h.id}/checar`,
      checagemPadrao(25003, 25203, { observacao: 'náusea', dose: { gtin: '07890000000001' } }),
    );
    expect(outroRemedio.json().bloqueios.join(' ')).toMatch(/não é o prescrito/);
    const n = await a.post(s, `/enfermagem/horarios/${h.id}/checar`, {
      ...checagemPadrao(25003, 25203),
      desfecho: 'naoAdministrado',
      motivo: 'recusa',
      observacao: 'paciente recusou',
    });
    expect(n.statusCode).toBe(200);
    expect(n.json().situacao).toBe('N');
  });
  it('fora da tolerância avisa: sem conferir, recusa; conferido, grava', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const t = await horariosDaUti(a, s);
    const h = t.horarios.find((x) => x.descricao.startsWith('DIPIRONA') && x.estado === 'atrasada')!;
    const sem = await a.post(
      s,
      `/enfermagem/horarios/${h.id}/checar`,
      checagemPadrao(25001, 25201, { avisosConferidos: false }),
    );
    expect(sem.statusCode).toBe(409);
    expect(sem.json().codigo).toBe('avisos-a-conferir');
    const ok = await a.post(s, `/enfermagem/horarios/${h.id}/checar`, checagemPadrao(25001, 25201));
    expect(ok.statusCode).toBe(200);
    expect(ok.json().avisos.join(' ')).toMatch(/tolerância/);
  });
});

describe('glicemia, infusão e hemocomponente', () => {
  it('a glicemia exige o valor; a faixa indicada é administrada e a outra não', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const t = await horariosDaUti(a, s);
    const g = t.horarios.find((x) => x.tipo === 'glicemia' && x.estado === 'pendente')!;
    expect(
      (await a.post(s, `/enfermagem/horarios/${g.id}/checar`, checagemPadrao(25001, 25201))).statusCode,
    ).toBe(422);
    const r = await a.post(
      s,
      `/enfermagem/horarios/${g.id}/checar`,
      checagemPadrao(25001, 25201, { glicemia: 182 }),
    );
    expect(r.statusCode).toBe(200);
    const d = (await a.get(s, `/enfermagem/horarios/${g.id}`)).json();
    expect(d.faixas.map((f: { situacao: string }) => f.situacao)).toEqual(['A', 'N']);
    const sv = (await a.get(s, '/enfermagem/pacientes/25001/sinais-vitais')).json();
    expect(
      sv.sinais.some((x: { tipo: string; valor: number }) => x.tipo === 'glicemia' && x.valor === 182),
    ).toBe(true);
    // Glicemia e laboratório na mesma régua.
    expect(sv.laboratorio.length).toBeGreaterThan(0);
  });
  it('infusão: início, velocidade, fim com o volume; fora de ordem recusa', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const t = await horariosDaUti(a, s);
    const soro = t.horarios.find((x) => x.tipo === 'solucao')!;
    expect((await a.post(s, `/enfermagem/horarios/${soro.id}/infusao`, { evento: 'pausa' })).statusCode).toBe(
      409,
    );
    expect(
      (await a.post(s, `/enfermagem/horarios/${soro.id}/infusao`, { evento: 'inicio' })).statusCode,
    ).toBe(201);
    expect(
      (
        await a.post(s, `/enfermagem/horarios/${soro.id}/infusao`, {
          evento: 'velocidade',
          velocidadeMlH: 60,
        })
      ).statusCode,
    ).toBe(201);
    const fim = await a.post(s, `/enfermagem/horarios/${soro.id}/infusao`, {
      evento: 'fim',
      volumeInfundidoMl: 120,
    });
    expect(fim.statusCode).toBe(201);
    expect(fim.json().volumeInfundidoMl).toBe(120);
    expect(
      (await a.post(s, `/enfermagem/horarios/${soro.id}/infusao`, { evento: 'inicio' })).statusCode,
    ).toBe(409);
  });
  it('o hemocomponente exige a dupla checagem sempre', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const t = await horariosDaUti(a, s);
    const ch = t.horarios.find((x) => x.hemocomponente)!;
    // O lote e a validade da bolsa são obrigatórios para o hemocomponente (parâmetro da unidade).
    const semBolsa = await a.post(s, `/enfermagem/horarios/${ch.id}/checar`, checagemPadrao(25002, 25202));
    expect(semBolsa.json().bloqueios.join(' ')).toMatch(/lote e a validade/);
    const bolsa = { dose: { lote: 'BOLSA0001', validade: '2026-12-31' } };
    const r = await a.post(s, `/enfermagem/horarios/${ch.id}/checar`, checagemPadrao(25002, 25202, bolsa));
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('dupla-checagem');
    const ok = await a.post(
      s,
      `/enfermagem/horarios/${ch.id}/checar`,
      checagemPadrao(25002, 25202, { ...bolsa, conferente: { login: 'SINT.ENF.APOIO', senha: SENHA } }),
    );
    expect(ok.statusCode).toBe(200);
  });
});

describe('aprazamento, sinais vitais, plantão, aparelhos e estorno', () => {
  it('a proposta pela grade; o enfermeiro confirma (grava no horário); reaprazar sem motivo recusa', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const p = (await a.get(s, '/enfermagem/aprazamento?unidade=UTI')).json();
    expect(p.gravaNoHorario).toBe(true);
    expect(p.motivo).toBeNull();
    const x = p.itens[0];
    const semMotivo = await a.post(s, '/enfermagem/aprazamento', {
      itens: [{ horario: x.horario, acao: 'reaprazar', proposto: x.proposto, confirmado: x.proposto }],
    });
    expect(semMotivo.statusCode).toBe(422);
    const ok = await a.post(s, '/enfermagem/aprazamento', {
      itens: [{ horario: x.horario, acao: 'aprazar', proposto: x.proposto, confirmado: x.proposto }],
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ registrados: 1, gravados: 1 });
    const p2 = (await a.get(s, '/enfermagem/aprazamento?unidade=UTI')).json();
    expect(p2.itens.find((y: { horario: number }) => y.horario === x.horario).registrado.acao).toBe(
      'aprazar',
    );
  });
  it('sinais vitais: fora da faixa pede confirmação; implausível recusa; a retificação é versão nova', async () => {
    const s = await a.entrar('SINT.TECNICO.ENF');
    const fora = await a.post(s, '/enfermagem/pacientes/25002/sinais-vitais', {
      sinais: [{ tipo: 'spo2', valor: 85 }],
    });
    expect(fora.statusCode).toBe(422);
    expect(fora.json().codigo).toBe('sinal-confirmar');
    expect(
      (await a.post(s, '/enfermagem/pacientes/25002/sinais-vitais', { sinais: [{ tipo: 'fc', valor: 900 }] }))
        .statusCode,
    ).toBe(422);
    const ok = await a.post(s, '/enfermagem/pacientes/25002/sinais-vitais', {
      sinais: [
        { tipo: 'spo2', valor: 85, confirmadoForaDaFaixa: true },
        { tipo: 'fc', valor: 98 },
      ],
    });
    expect(ok.statusCode).toBe(201);
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const id = ok.json().sinais[1];
    const r = await a.post(enf, `/enfermagem/sinais-vitais/${id}/retificar?paciente=25002`, {
      valor: 89,
      justificativa: 'valor do monitor errado',
    });
    expect(r.statusCode).toBe(200);
    const sv = (await a.get(enf, '/enfermagem/pacientes/25002/sinais-vitais')).json();
    const fc = sv.sinais.filter((x: { tipo: string }) => x.tipo === 'fc');
    expect(fc.map((x: { versao: number }) => x.versao)).toEqual([1, 2]);
    expect(fc[0].substituidoPor).toBe(fc[1].id);
    // O técnico não retifica.
    expect(
      (
        await a.post(s, `/enfermagem/sinais-vitais/${id}/retificar`, {
          valor: 90,
          justificativa: 'outra correção',
        })
      ).statusCode,
    ).toBe(403);
  });
  it('a retificação lê o sinal pelo id no servidor: sem o paciente ou com outro, a trilha leva o titular', async () => {
    const s = await a.entrar('SINT.TECNICO.ENF');
    const ok = await a.post(s, '/enfermagem/pacientes/25003/sinais-vitais', {
      sinais: [{ tipo: 'spo2', valor: 97 }],
    });
    expect(ok.statusCode).toBe(201);
    const id = ok.json().sinais[0];
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    // O valor é conferido pelo tipo lido (saturação), mesmo sem o paciente no pedido.
    const fora = await a.post(enf, `/enfermagem/sinais-vitais/${id}/retificar`, {
      valor: 80,
      justificativa: 'valor do oxímetro errado',
    });
    expect(fora.statusCode).toBe(422);
    expect(fora.json().codigo).toBe('sinal-confirmar');
    // A linha da trilha que vai na transação leva o paciente dono do sinal, não o do pedido.
    const linhas: { idPaciente: number | null }[] = [];
    const original = a.porta.gravarSgh.bind(a.porta);
    const espiao = vi.spyOn(a.porta, 'gravarSgh').mockImplementation(async (c, trilha, fn) => {
      const r = await original(c, trilha, fn);
      linhas.push((trilha as (x: unknown) => { idPaciente: number | null })(r));
      return r;
    });
    const r = await a.post(enf, `/enfermagem/sinais-vitais/${id}/retificar?paciente=25001`, {
      valor: 95,
      justificativa: 'valor do oxímetro errado',
    });
    espiao.mockRestore();
    expect(r.statusCode).toBe(200);
    expect(linhas.map((l) => l.idPaciente)).toEqual([25003]);
    expect(
      (
        await a.post(enf, '/enfermagem/sinais-vitais/987654321/retificar', {
          valor: 95,
          justificativa: 'não existe',
        })
      ).statusCode,
    ).toBe(404);
  });
  it('sem rede: o sinal vital do lote pede a permissão dele; a anotação tem o evento próprio', async () => {
    const estado = estadoAcessoSintetico();
    const grupo = estado.opcoesGrupo.get('TECNICO_ENFERMAGEM')!;
    const checar = new Set(
      PERMISSOES_ENFERMAGEM_M25.find((p) => p.codigo === P.administracaoChecar)!.opcoesLegado,
    );
    const doSinal = PERMISSOES_ENFERMAGEM_M25.find((p) => p.codigo === P.sinalCriar)!.opcoesLegado.filter(
      (o) => !checar.has(o) && grupo.has(o),
    );
    const autorizacao = a.app.get<ServicoSessao>(SERVICO_SESSAO).servicoAutorizacao!;
    for (const o of doSinal) grupo.delete(o);
    await autorizacao.invalidar(REDE, 'aa', 'SINT.TECNICO.ENF');
    try {
      const s = await a.entrar('SINT.TECNICO.ENF');
      const r = await a.post(s, '/enfermagem/sincronizar', {
        dispositivo: 'tablet-sem-sinal',
        atos: [
          {
            tipo: 'sinal',
            chave: 'ato-offline-sem-sinal-01',
            paciente: 25001,
            sinal: { tipo: 'fc', valor: 80, horaReal: '2026-10-22T12:40' },
          },
          {
            tipo: 'anotacao',
            chave: 'ato-offline-anotacao-01',
            paciente: 25001,
            atendimento: 25101,
            texto: 'paciente dormindo',
            horaReal: '2026-10-22T12:41',
          },
        ],
      });
      expect(r.statusCode).toBe(200);
      expect(
        r.json().resultados.map((x: { ok: boolean; codigo: string | null }) => [x.ok, x.codigo]),
      ).toEqual([
        [false, 'sem-permissao'],
        [true, null],
      ]);
      expect(a.trilha.eventos.some((e) => e.evento === 'enfermagem.anotacao.registrada')).toBe(true);
    } finally {
      for (const o of doSinal) grupo.add(o);
      await autorizacao.invalidar(REDE, 'aa', 'SINT.TECNICO.ENF');
    }
  });
  it('a exigência de aparelho autorizado (POL-3): desligada com o motivo; ligada, só o aparelho ativo envia', async () => {
    const sup = await a.entrar('SINT.SUPERVISOR.ENF');
    const g = (await a.get(sup, '/enfermagem/gravacao')).json();
    expect(g.funcionalidades['enfermagem.aparelhoAutorizado'].ligada).toBe(false);
    expect(g.funcionalidades['enfermagem.aparelhoAutorizado'].motivo).toBeTruthy();
    const d = (
      await a.post(sup, '/enfermagem/dispositivos', { nome: 'Tablet SINT', unidade: 'UTI', tipo: 'tablet' })
    ).json();
    const ctrl = a.app.get(EnfermagemController);
    const liga = vi
      .spyOn(ctrl.apoios.aparelho, 'liberacao')
      .mockResolvedValue({ ligada: true, motivo: null });
    try {
      const s = await a.entrar('SINT.ENF.PLANTAO');
      const lote = (dispositivo: string, chave: string) => ({
        dispositivo,
        atos: [
          {
            tipo: 'anotacao',
            chave,
            paciente: 25001,
            atendimento: 25101,
            texto: 'curativo limpo',
            horaReal: '2026-10-22T12:42',
          },
        ],
      });
      const fora = await a.post(
        s,
        '/enfermagem/sincronizar',
        lote('web-qualquer', 'ato-offline-aparelho-01'),
      );
      expect(fora.statusCode).toBe(403);
      expect(fora.json().codigo).toBe('aparelho-nao-autorizado');
      expect(
        (await a.post(s, '/enfermagem/sincronizar', lote(d.identificador, 'ato-offline-aparelho-02')))
          .statusCode,
      ).toBe(200);
      expect(
        (
          await a.post(sup, `/enfermagem/dispositivos/${d.dispositivo}`, {
            ativo: false,
            motivo: 'Aparelho retirado para conserto',
          })
        ).statusCode,
      ).toBe(200);
      const retirado = await a.post(
        s,
        '/enfermagem/sincronizar',
        lote(d.identificador, 'ato-offline-aparelho-03'),
      );
      expect(retirado.statusCode).toBe(403);
    } finally {
      liga.mockRestore();
    }
  });
  it('passagem de plantão: as pendências herdadas; só o recebedor aceita', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const p = (await a.get(s, '/enfermagem/plantao?unidade=UTI')).json();
    expect(p.sugestoes.pacientes.length).toBe(3);
    const notas = p.sugestoes.pacientes.map(
      (x: { atendimento: number; paciente: number; pendencias: unknown[] }) => ({
        atendimento: x.atendimento,
        paciente: x.paciente,
        situacao: 'estável',
        recomendacao: 'manter',
        pendencias: x.pendencias,
      }),
    );
    const passar = await a.post(s, '/enfermagem/plantao', {
      unidade: 'UTI',
      turno: 'diurno',
      data: '2026-10-22',
      recebedor: 'SINT.ENF.APOIO',
      notas,
    });
    expect(passar.statusCode).toBe(201);
    const id = passar.json().passagem;
    expect((await a.post(s, `/enfermagem/plantao/${id}/aceite`, { aceite: true })).statusCode).toBe(409);
    const apoio = await a.entrar('SINT.ENF.APOIO');
    expect((await a.post(apoio, `/enfermagem/plantao/${id}/aceite`, { aceite: true })).statusCode).toBe(200);
    const depois = (await a.get(apoio, '/enfermagem/plantao?unidade=UTI')).json();
    expect(depois.passagens[0].situacao).toBe('aceita');
  });
  it('aparelhos só pela supervisão; o estorno volta o horário a não checado com o motivo', async () => {
    const tec = await a.entrar('SINT.TECNICO.ENF');
    expect(
      (await a.post(tec, '/enfermagem/dispositivos', { nome: 'Tablet UTI', unidade: 'UTI', tipo: 'tablet' }))
        .statusCode,
    ).toBe(403);
    const sup = await a.entrar('SINT.SUPERVISOR.ENF');
    const d = await a.post(sup, '/enfermagem/dispositivos', {
      nome: 'Tablet UTI',
      unidade: 'UTI',
      tipo: 'tablet',
    });
    expect(d.statusCode).toBe(201);
    expect(d.json().identificador).toMatch(/^tablet-/);
    expect((await a.get(sup, '/enfermagem/dispositivos')).json()[0]).not.toHaveProperty('hash');
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const t = await horariosDaUti(a, s);
    const checado = t.horarios.find((x) => x.situacao === 'A')!;
    const semMotivo = await a.post(s, `/enfermagem/horarios/${checado.id}/estornar`, {
      justificativa: 'checado no horário errado',
    });
    expect(semMotivo.statusCode).toBe(400);
    const e = await a.post(s, `/enfermagem/horarios/${checado.id}/estornar`, {
      motivo: 'checado-por-engano',
      justificativa: 'checado no horário errado',
    });
    expect(e.statusCode).toBe(200);
    expect(e.json()).toMatchObject({ situacao: 'P', devolucaoPendente: false });
    const depois = await horariosDaUti(a, s);
    expect(depois.horarios.find((x) => x.id === checado.id)?.situacao).toBe('P');
  });
});
