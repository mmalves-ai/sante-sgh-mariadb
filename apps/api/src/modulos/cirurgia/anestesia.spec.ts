// M46 (etapa 1) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (dados SINTÉTICOS): a
// escolha das cirurgias do dia, a APA (jejum ASA 2017, alergias conferidas, versão vista, retificação e a pendência
// resolvida), a ficha anestésica (abertura pelo primeiro lote, marcos em ordem, sinais, fármacos, gás, fluido, evento,
// equipe, lacuna justificada, fim do gás, assinatura com a senha e o adendo, nada depois da assinatura), a SRPA
// (admissão, avaliação a cada 15 minutos, a alta pela regra versionada e o quadro) e a chave desligada (POL-3).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AMANHA, type AppAnestesia, HOJE, montarAppAnestesia, SENHA, sinais } from './anestesia.spec-util.js';

let a: AppAnestesia;
beforeAll(async () => {
  a = await montarAppAnestesia();
});
afterAll(async () => {
  await a.fechar();
});

const AG = 701; // a cirurgia sintética de amanhã às 08:00 na sala 2, com o anestesista 5002
const apa = (extra: Record<string, unknown> = {}) => ({
  agendamento: AG,
  versao: 0,
  avaliadoEm: `${HOJE}T08:30`,
  asa: 2,
  viaAerea: { mallampati: 2 },
  jejum: { liquidosClaros: `${AMANHA}T04:00`, refeicaoLeve: `${HOJE}T20:00` },
  criteriosLee: [],
  alergiasConferidas: true,
  plano: { tipoAnestesia: 1, tecnica: 'Geral balanceada' },
  conclusao: 'apto',
  ...extra,
});

describe('escolha do dia e domínios', () => {
  it('as cirurgias do dia com a situação de cada registro; sem as opções do bloco, 403', async () => {
    const s = await a.entrar('SINT.ANESTESISTA');
    const r = await a.get(s, `/cirurgias?data=${AMANHA}`);
    expect(r.statusCode, r.body).toBe(200);
    const itens = r.json().itens as { agendamento: number; apa: unknown; paciente: string }[];
    expect(itens.map((x) => x.agendamento)).toEqual([701, 702]);
    expect(itens[0]).toMatchObject({ apa: null, paciente: expect.stringContaining('SINTETICO') });
    expect(
      (await a.get(s, '/dominios'))
        .json()
        .funcoesEquipe.some((f: { rotulo: string }) => f.rotulo === 'Anestesista'),
    ).toBe(true);
    const fora = await a.entrar('SINT.AGENDA');
    expect((await a.get(fora, `/cirurgias?data=${AMANHA}`)).statusCode).toBe(403);
    expect((await a.get(fora, `/${AG}/apa`)).statusCode).toBe(403);
  });
});

describe('cirurgia.registrarApa', () => {
  it('o contexto com as alergias, os exames e as medicações; jejum e alergias recusados; a versão e a retificação', async () => {
    const s = await a.entrar('SINT.ANESTESISTA');
    const t = (await a.get(s, `/${AG}/apa`)).json();
    expect(t.contexto).toMatchObject({
      agendamento: AG,
      sala: 2,
      anestesistaAgendado: 5002,
      dataHora: `${AMANHA}T08:00`,
    });
    expect(t.contexto.alergias).toHaveLength(1);
    expect(t.contexto.medicacoesEmUso).toHaveLength(1);
    expect(t.vigente).toBeNull();
    expect(t.gravacao.operacoes.apa.pode).toBe(true);
    // Regra do jejum (ASA 2017): líquido claro 4 h antes → "apto" recusado fora da emergência.
    const j = await a.post(s, `/${AG}/apa`, apa({ jejum: { liquidosClaros: `${AMANHA}T07:00` } }));
    expect(j.statusCode).toBe(422);
    expect(j.json().codigo).toBe('apa-jejum-insuficiente');
    expect((await a.post(s, `/${AG}/apa`, apa({ alergiasConferidas: false }))).json().codigo).toBe(
      'apa-alergias-nao-conferidas',
    );
    expect((await a.post(s, `/${AG}/apa`, apa({ avaliadoEm: `${AMANHA}T07:00` }))).json().codigo).toBe(
      'anestesia-horario-futuro',
    );
    expect((await a.post(s, `/${AG}/apa`, apa({ plano: { tipoAnestesia: 99 } }))).statusCode).toBe(400);
    const ok = await a.post(s, `/${AG}/apa`, apa());
    expect(ok.statusCode, ok.body).toBe(201);
    const v1 = (await a.get(s, `/${AG}/apa`)).json().vigente;
    expect(v1).toMatchObject({
      versao: 1,
      rotuloAsa: 'ASA II',
      conclusao: 'apto',
      fechaPendencia: true,
      avaliadoPor: 5002,
    });
    expect(v1.jejum.find((x: { tipo: string }) => x.tipo === 'liquidosClaros')).toMatchObject({
      horas: 4,
      suficiente: true,
    });
    // Outra versão no meio: recusa; a retificação parte da vigente.
    expect((await a.post(s, `/${AG}/apa`, apa())).json().codigo).toBe('apa-mudou');
    const r2 = await a.post(
      s,
      `/${AG}/apa`,
      apa({ versao: 1, conclusao: 'apto-ressalvas', ressalvas: 'Via aérea a observar' }),
    );
    expect(r2.statusCode, r2.body).toBe(201);
    const t2 = (await a.get(s, `/${AG}/apa`)).json();
    expect(t2.versoes.map((x: { versao: number }) => x.versao)).toEqual([2, 1]);
    expect((await a.get(s, `/cirurgias?data=${AMANHA}`)).json().itens[0].apa).toBe('apto-ressalvas');
  });
  it('a chave do corpo difere da Idempotency-Key: 400; a enfermagem do bloco não registra (sem a opção)', async () => {
    const s = await a.entrar('SINT.ANESTESISTA');
    const r = await a.app.inject({
      method: 'POST',
      url: `/api/cirurgia/anestesia/${AG}/apa`,
      headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': 'chave-cabecalho-1' },
      payload: { ...apa({ versao: 2 }), chave: 'chave-corpo-0001' },
    });
    expect(r.statusCode).toBe(400);
    const enf = await a.entrar('SINT.ENF.BLOCO');
    expect((await a.post(enf, `/${AG}/apa`, apa({ versao: 2 }))).statusCode).toBe(403);
    expect((await a.get(enf, `/${AG}/srpa`)).statusCode).toBe(200);
  });
  it('revisão: o agendamento relido na transação; cancelado ou realizado entre a leitura e a gravação recusa', async () => {
    const s = await a.entrar('SINT.ANESTESISTA');
    const vigente = (await a.get(s, `/${AG}/apa`)).json().vigente.versao as number;
    // A linha da agenda some (cancelamento por outro caminho) depois da leitura do contexto: 404, nada gravado.
    const ag = a.cirurgia.agendamento.bind(a.cirurgia);
    const sumiu = vi.spyOn(a.cirurgia, 'agendamento').mockImplementationOnce(ag).mockResolvedValueOnce(null);
    const r = await a.post(s, `/${AG}/apa`, apa({ versao: vigente }));
    sumiu.mockRestore();
    expect(r.statusCode, r.body).toBe(404);
    // O estado vira "realizado" depois da conferência fora da transação: a APA recusa na transação.
    const est = a.cirurgia.estadosDosAgendamentos.bind(a.cirurgia);
    const fechou = vi
      .spyOn(a.cirurgia, 'estadosDosAgendamentos')
      .mockImplementationOnce(est)
      .mockImplementationOnce(async (c, ids) => {
        const m = await est(c, ids);
        const e = m.get(AG);
        return new Map([[AG, { ...(e ?? {}), estado: 'realizado' } as NonNullable<typeof e>]]);
      });
    const f = await a.post(s, `/${AG}/apa`, apa({ versao: vigente }));
    fechou.mockRestore();
    expect(f.json().codigo).toBe('apa-agendamento-fechado');
    expect((await a.get(s, `/${AG}/apa`)).json().vigente.versao).toBe(vigente);
  });
});

describe('cirurgia.registrarFichaAnestesica', () => {
  const D = HOJE;
  it('abre pelo primeiro lote; marcos em ordem; lançamentos por parte; lacuna; fim do gás; assinatura; adendo', async () => {
    const s = await a.entrar('SINT.ANESTESISTA');
    expect((await a.get(s, `/${AG}/ficha`)).json().ficha).toBeNull();
    const p1 = await a.post(s, `/${AG}/ficha/lancamentos`, {
      agendamento: AG,
      lancamentos: [
        { parte: 'equipe', momento: `${D}T08:00`, profissional: { id: 5002, cod: 9002 }, funcao: 6 },
        { parte: 'posicao', momento: `${D}T08:00`, posicao: 1 },
      ],
    });
    expect(p1.statusCode, p1.body).toBe(201);
    for (const [marco, h] of [
      ['entradaSala', '08:00'],
      ['inicioAnestesia', '08:05'],
    ] as const)
      expect(
        (await a.post(s, `/${AG}/ficha/marcos`, { agendamento: AG, marco, momento: `${D}T${h}` })).statusCode,
      ).toBe(201);
    // Marco repetido e fora de ordem.
    expect(
      (
        await a.post(s, `/${AG}/ficha/marcos`, {
          agendamento: AG,
          marco: 'entradaSala',
          momento: `${D}T08:01`,
        })
      ).json().codigo,
    ).toBe('ficha-marco-repetido');
    expect(
      (
        await a.post(s, `/${AG}/ficha/marcos`, {
          agendamento: AG,
          marco: 'fimCirurgia',
          momento: `${D}T07:00`,
        })
      ).json().codigo,
    ).toBe('ficha-marco-fora-de-ordem');
    const lote = await a.post(s, `/${AG}/ficha/lancamentos`, {
      agendamento: AG,
      lancamentos: [
        ...sinais(`${D}T08:05`),
        ...sinais(`${D}T08:10`),
        { parte: 'medicamento', momento: `${D}T08:05`, item: 501, dose: 150, unidade: 'mg', via: 'ev' },
        { parte: 'gas', momento: `${D}T08:05`, gas: 'o2', valor: 2 },
        { parte: 'fluido', momento: `${D}T08:06`, fluido: 'cristaloide', volumeMl: 500 },
        { parte: 'perda', momento: `${D}T08:12`, perda: 'sangramento', volumeMl: 100 },
        { parte: 'evento', momento: `${D}T08:06`, evento: 'intubacao' },
        { parte: 'modoRespiratorio', momento: `${D}T08:06`, modo: 3 },
      ],
    });
    expect(lote.statusCode, lote.body).toBe(201);
    // Fora da janela (antes da entrada na sala), sinal implausível, horário futuro e domínio fora da lista.
    expect(
      (
        await a.post(s, `/${AG}/ficha/lancamentos`, { agendamento: AG, lancamentos: sinais(`${D}T07:50`) })
      ).json().codigo,
    ).toBe('ficha-fora-da-janela');
    expect(
      (
        await a.post(s, `/${AG}/ficha/lancamentos`, {
          agendamento: AG,
          lancamentos: [{ parte: 'sinal', momento: `${D}T08:11`, tipo: 'fc', valor: 900 }],
        })
      ).json().codigo,
    ).toBe('ficha-sinal-implausivel');
    expect(
      (
        await a.post(s, `/${AG}/ficha/lancamentos`, { agendamento: AG, lancamentos: sinais(`${D}T10:00`) })
      ).json().codigo,
    ).toBe('anestesia-horario-futuro');
    expect(
      (
        await a.post(s, `/${AG}/ficha/lancamentos`, {
          agendamento: AG,
          lancamentos: [{ parte: 'posicao', momento: `${D}T08:11`, posicao: 77 }],
        })
      ).statusCode,
    ).toBe(400);
    // A lacuna de 08:15 a 08:20 justificada; o fim da anestesia encerra a ficha.
    expect(
      (
        await a.post(s, `/${AG}/ficha/lacunas`, {
          agendamento: AG,
          inicio: `${D}T08:15`,
          fim: `${D}T08:20`,
          motivo: 'Troca do monitor da sala',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await a.post(s, `/${AG}/ficha/marcos`, {
          agendamento: AG,
          marco: 'fimAnestesia',
          momento: `${D}T08:20`,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await a.post(s, `/${AG}/ficha/lancamentos`, { agendamento: AG, lancamentos: sinais(`${D}T08:19`) })
      ).json().codigo,
    ).toBe('ficha-encerrada');
    let t = (await a.get(s, `/${AG}/ficha`)).json();
    expect(t.ficha).toMatchObject({
      situacao: 'encerrada',
      totais: { ganhosMl: 500, perdasMl: 100, hemocomponentesMl: 0 },
    });
    expect(t.ficha.lacunas).toEqual([expect.objectContaining({ inicio: `${D}T08:15`, justificada: true })]);
    expect(t.ficha.pendenciasAssinatura).toEqual(['ficha-gas-sem-fim']);
    expect(t.ficha.anestesistas).toContain(5002);
    expect(t.profissionalSessao).toBe(5002);
    const gas = t.ficha.lancamentos.find((l: { parte: string }) => l.parte === 'gas');
    expect(gas).toMatchObject({ podeEncerrar: true, unidade: 'L/min' });
    // O fim do gás (vale com a ficha encerrada); a dose única não tem fim.
    const med = t.ficha.lancamentos.find((l: { parte: string }) => l.parte === 'medicamento');
    expect(
      (
        await a.post(s, `/${AG}/ficha/lancamentos/${med.id}/encerrar`, {
          agendamento: AG,
          lancamento: med.id,
          fim: `${D}T08:20`,
        })
      ).json().codigo,
    ).toBe('ficha-lancamento-sem-fim');
    expect(
      (
        await a.post(s, `/${AG}/ficha/lancamentos/${gas.id}/encerrar`, {
          agendamento: AG,
          lancamento: gas.id,
          fim: `${D}T08:20`,
        })
      ).statusCode,
    ).toBe(201);
    t = (await a.get(s, `/${AG}/ficha`)).json();
    expect(t.ficha.pendenciasAssinatura).toEqual([]);
    // A assinatura com a versão lida e a senha; a versão antiga recusa; o adendo depois.
    expect(
      (
        await a.post(s, `/${AG}/ficha/assinatura`, {
          agendamento: AG,
          versao: t.ficha.versao - 1,
          senha: SENHA,
        })
      ).json().codigo,
    ).toBe('ficha-mudou');
    const ass = await a.post(s, `/${AG}/ficha/assinatura`, {
      agendamento: AG,
      versao: t.ficha.versao,
      senha: SENHA,
    });
    expect(ass.statusCode, ass.body).toBe(201);
    t = (await a.get(s, `/${AG}/ficha`)).json();
    expect(t.ficha).toMatchObject({ situacao: 'assinada', assinadaPor: 5002 });
    expect(t.ficha.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      (
        await a.post(s, `/${AG}/ficha/lancamentos`, { agendamento: AG, lancamentos: sinais(`${D}T08:19`) })
      ).json().codigo,
    ).toBe('ficha-assinada');
    expect(
      (
        await a.post(s, `/${AG}/ficha/adendos`, {
          agendamento: AG,
          texto: 'Adendo sintético: reação leve na recuperação.',
        })
      ).statusCode,
    ).toBe(201);
    expect((await a.get(s, `/${AG}/ficha`)).json().ficha.adendos).toHaveLength(1);
    expect((await a.get(s, `/cirurgias?data=${AMANHA}`)).json().itens[0].ficha).toBe('assinada');
  });
  it('as outras partes (procedimento, exame, item avulso e bomba de infusão): a bomba aberta impede a assinatura', async () => {
    const s = await a.entrar('SINT.ANESTESISTA');
    const AG3 = 703;
    for (const [marco, h] of [
      ['entradaSala', '07:00'],
      ['inicioAnestesia', '07:05'],
    ] as const)
      expect(
        (await a.post(s, `/${AG3}/ficha/marcos`, { agendamento: AG3, marco, momento: `${D}T${h}` }))
          .statusCode,
      ).toBe(201);
    const r = await a.post(s, `/${AG3}/ficha/lancamentos`, {
      agendamento: AG3,
      lancamentos: [
        ...sinais(`${D}T07:05`),
        { parte: 'procedimento', momento: `${D}T07:05`, descricao: 'Acesso venoso central' },
        { parte: 'exame', momento: `${D}T07:06`, exame: 'Gasometria', resultado: 'pH 7,40' },
        { parte: 'avulso', momento: `${D}T07:06`, descricao: 'Manta térmica', quantidade: 1 },
        { parte: 'bi', momento: `${D}T07:06`, item: 502, vazao: 5, unidade: 'mL/h' },
      ],
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(
      (
        await a.post(s, `/${AG3}/ficha/marcos`, {
          agendamento: AG3,
          marco: 'fimAnestesia',
          momento: `${D}T07:09`,
        })
      ).statusCode,
    ).toBe(201);
    let t = (await a.get(s, `/${AG3}/ficha`)).json();
    expect(t.ficha.pendenciasAssinatura).toEqual(['ficha-gas-sem-fim']);
    const bi = t.ficha.lancamentos.find((l: { parte: string }) => l.parte === 'bi');
    expect(bi).toMatchObject({ podeEncerrar: true, valor: 5, unidade: 'mL/h' });
    expect(t.ficha.lancamentos.find((l: { parte: string }) => l.parte === 'exame').descricao).toBe(
      'Gasometria: pH 7,40',
    );
    expect(
      (
        await a.post(s, `/${AG3}/ficha/lancamentos/${bi.id}/encerrar`, {
          agendamento: AG3,
          lancamento: bi.id,
          fim: `${D}T07:09`,
        })
      ).statusCode,
    ).toBe(201);
    t = (await a.get(s, `/${AG3}/ficha`)).json();
    expect(t.ficha.pendenciasAssinatura).toEqual([]);
  });
  it('sem ficha: o fim, a lacuna e a passagem recusam; o adendo antes da assinatura recusa', async () => {
    const s = await a.entrar('SINT.ANESTESISTA');
    const r = await a.post(s, `/702/ficha/lacunas`, {
      agendamento: 702,
      inicio: `${D}T08:15`,
      fim: `${D}T08:20`,
      motivo: 'Troca do monitor da sala',
    });
    expect(r.json().codigo).toBe('ficha-sem-ficha');
    expect(
      (
        await a.post(s, `/702/ficha/adendos`, { agendamento: 702, texto: 'Adendo sintético qualquer.' })
      ).json().codigo,
    ).toBe('ficha-sem-ficha');
    expect(
      (
        await a.post(s, `/702/ficha/lacunas`, {
          agendamento: 702,
          inicio: `${D}T08:20`,
          fim: `${D}T08:15`,
          motivo: 'Troca do monitor da sala',
        })
      ).statusCode,
    ).toBe(400);
    expect((await a.get(s, '/999999/ficha')).statusCode).toBe(404);
  });
});

describe('cirurgia.registrarSrpa', () => {
  const aldrete = (n: number) => ({
    atividade: n,
    respiracao: 2,
    circulacao: 2,
    consciencia: n,
    saturacao: 2,
  });
  const av = (momento: string, em: string, ultimaVista: number, extra: Record<string, unknown> = {}) => ({
    agendamento: AG,
    momento,
    em: `${HOJE}T${em}`,
    aldrete: aldrete(2),
    dor: 2,
    nvpo: 0,
    ultimaVista,
    ...extra,
  });
  it('admissão, avaliações a cada 15 minutos, a alta pela regra v1 e o quadro', async () => {
    const enf = await a.entrar('SINT.ENF.BLOCO');
    expect((await a.post(enf, `/${AG}/srpa`, av('avaliacao', '08:30', 0))).json().codigo).toBe(
      'srpa-sem-admissao',
    );
    expect(
      (await a.post(enf, `/${AG}/srpa`, av('admissao', '08:25', 0, { aldrete: aldrete(1) }))).statusCode,
    ).toBe(201);
    let t = (await a.get(enf, `/${AG}/srpa`)).json();
    expect(t.srpa).toMatchObject({
      regraVersao: 1,
      proximaAvaliacaoAte: `${HOJE}T08:40`,
      podeDarAlta: false,
    });
    expect(t.srpa.avaliacoes[0].total).toBe(8);
    // Outra avaliação no meio (a vista antiga): recusa.
    expect((await a.post(enf, `/${AG}/srpa`, av('avaliacao', '08:40', 0))).json().codigo).toBe('srpa-mudou');
    expect((await a.post(enf, `/${AG}/srpa`, av('avaliacao', '08:40', t.srpa.ultima))).statusCode).toBe(201);
    t = (await a.get(enf, `/${AG}/srpa`)).json();
    // A alta antes dos 30 minutos de permanência: recusa pela regra versionada.
    expect(
      (await a.post(enf, `/${AG}/srpa`, av('alta', '08:50', t.srpa.ultima, { destino: 'unidade' }))).json()
        .codigo,
    ).toBe('srpa-permanencia-curta');
    const q = (await a.get(enf, '/srpa/quadro')).json();
    expect(q.linhas).toEqual([
      expect.objectContaining({ agendamento: AG, admitidoEm: `${HOJE}T08:25`, ultimoTotal: 10 }),
    ]);
    expect((await a.post(enf, `/${AG}/srpa`, av('avaliacao', '08:55', t.srpa.ultima))).statusCode).toBe(201);
    t = (await a.get(enf, `/${AG}/srpa`)).json();
    const alta = await a.post(enf, `/${AG}/srpa`, av('alta', '08:58', t.srpa.ultima, { destino: 'unidade' }));
    expect(alta.statusCode, alta.body).toBe(201);
    t = (await a.get(enf, `/${AG}/srpa`)).json();
    expect(t.srpa.alta).toMatchObject({ destino: 'unidade' });
    expect(t.srpa.impedimentosAlta).toEqual(['srpa-ja-com-alta']);
    expect((await a.get(enf, '/srpa/quadro')).json().linhas).toEqual([]);
    expect((await a.post(enf, `/${AG}/srpa`, av('avaliacao', '08:59', t.srpa.ultima))).json().codigo).toBe(
      'srpa-ja-com-alta',
    );
  });
  it('a UTI dispensa o índice e exige o motivo', async () => {
    const enf = await a.entrar('SINT.ENF.BLOCO');
    expect(
      (
        await a.post(enf, '/702/srpa', {
          ...av('admissao', '08:30', 0),
          agendamento: 702,
          aldrete: aldrete(0),
        })
      ).statusCode,
    ).toBe(201);
    const t = (await a.get(enf, '/702/srpa')).json();
    const sem = {
      ...av('alta', '08:40', t.srpa.ultima, { destino: 'uti', aldrete: aldrete(0) }),
      agendamento: 702,
    };
    expect((await a.post(enf, '/702/srpa', sem)).json().codigo).toBe('srpa-motivo-obrigatorio');
    expect(
      (await a.post(enf, '/702/srpa', { ...sem, motivoDestino: 'Instabilidade hemodinâmica' })).statusCode,
    ).toBe(201);
  });
});

describe('a chave desligada (POL-3)', () => {
  it('a tela fica em consulta com o motivo e a gravação responde 403 recurso-desligado', async () => {
    const b = await montarAppAnestesia({ semChave: true });
    try {
      const s = await b.entrar('SINT.ANESTESISTA');
      const t = (await b.get(s, `/${AG}/apa`)).json();
      expect(t.gravacao.ligada).toBe(false);
      expect(t.gravacao.motivo).toBeTruthy();
      const r = await b.post(s, `/${AG}/apa`, apa());
      expect(r.statusCode).toBe(403);
      expect(r.json().codigo).toBe('recurso-desligado');
    } finally {
      await b.fechar();
    }
  });
});
