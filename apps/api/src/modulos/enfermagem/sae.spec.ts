// SAE e prescrição de enfermagem pela HTTP (M45, etapa 4; regras 7, 8, 15 e 16), com a sessão real sobre a fonte
// sintética e as portas EM MEMÓRIA (nada conecta a banco; dados sintéticos): o processo em cinco etapas só do
// enfermeiro (o técnico recebe 403 `so-enfermeiro`), a revisão com a versão vista, a recusa do domínio, os cuidados
// aprazados pela grade da unidade e checados no turno (não feito com o motivo, o horário uma vez, o estorno e a
// checagem de novo, a suspensão), a evolução que reavalia a meta, a terminologia carregada com a senha e a chave
// desligada pelo administrador.
import type { CuidadosDoTurno, SaeDoPaciente } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarAppSae, SENHA, type Sessao } from './sae.spec-util.js';

const AT = 25_103;

type App = Awaited<ReturnType<typeof montarAppSae>>;
let a: App;
beforeAll(async () => {
  a = await montarAppSae();
});
afterAll(async () => {
  await a.app.close();
});

const PROCESSO = {
  avaliacao: 'Paciente sintético acamado, pele íntegra, dor 6 na incisão; cooperativo.',
  versaoVista: 0,
  diagnosticos: [
    {
      codigo: 'S-D01',
      fatores: ['S-F011', 'S-F013'],
      resultados: [{ codigo: 'S-R01', escalaAtual: 3, meta: 1, escalaMeta: 5 }],
      intervencoes: [{ codigo: 'S-I01' }],
    },
    {
      codigo: 'S-D04',
      caracteristicas: ['S-C041'],
      fatores: ['S-F041'],
      resultados: [{ codigo: 'S-R04', escalaAtual: 4, meta: 3, escalaMeta: 2 }],
      intervencoes: [{ codigo: 'S-I04' }],
    },
  ],
};

const ler = async (s: Sessao) => {
  const r = await a.get(s, `/enfermagem/sae/${AT}`);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as SaeDoPaciente;
};

describe('regra 7: o processo de enfermagem', () => {
  it('lista as unidades e os pacientes; sem processo, nenhuma etapa feita, a terminologia sintética e a grade', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    expect((await a.get(s, '/enfermagem/sae/unidades')).statusCode).toBe(200);
    const ps = (await a.get(s, '/enfermagem/sae/unidades/UTI/pacientes')).json();
    expect(ps.map((p: { atendimento: number }) => p.atendimento)).toContain(AT);
    const p = await ler(s);
    expect(p.atual).toBeNull();
    expect(p.etapas.every((e) => !e.feita)).toBe(true);
    expect(p.terminologia).toMatchObject({ sistema: 'SINT', sintetica: true });
    expect(p.dominios.escala.map((x) => x.valor)).toEqual([1, 2, 3, 4, 5, null]);
    expect(p.grade['4']).toEqual(['00:00', '06:00', '12:00', '18:00']);
    expect(p.gravacao).toMatchObject({ ligada: true, enfermeiro: true });
    expect(a.trilha.eventos.some((l) => l.evento === 'enfermagem.sae.lida')).toBe(true);
    expect((await a.get(s, '/enfermagem/sae/99999')).statusCode).toBe(404);
  });

  it('o técnico não registra a SAE (403 so-enfermeiro); a recusa do domínio vem com o código', async () => {
    const t = await a.entrar('SINT.TECNICO.ENF');
    const g = await ler(t);
    expect(g.gravacao).toMatchObject({ enfermeiro: false, enfermagem: true });
    expect(g.gravacao.operacoes['registrar']?.pode).toBe(false);
    const r = await a.post(t, `/enfermagem/sae/${AT}`, PROCESSO);
    // O técnico não tem a permissão (as opções do aprazamento são do enfermeiro).
    expect(r.statusCode).toBe(403);
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const semFator = {
      ...PROCESSO,
      diagnosticos: [{ ...PROCESSO.diagnosticos[0]!, fatores: [] }],
    };
    const x = await a.post(s, `/enfermagem/sae/${AT}`, semFator);
    expect(x.statusCode).toBe(422);
    expect(x.json().codigo).toBe('sem-fator-de-risco');
    expect((await a.post(s, `/enfermagem/sae/${AT}`, { ...PROCESSO, avaliacao: 'curta' })).statusCode).toBe(
      400,
    );
  });

  it('o enfermeiro registra; a revisão pede a versão vista (a antiga recusa 409); a chave repetida não grava de novo', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const r = await a.post(s, `/enfermagem/sae/${AT}`, PROCESSO, 'chave-sae-teste-01');
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().mensagem).toMatch(/registrado/);
    const deNovo = await a.post(s, `/enfermagem/sae/${AT}`, PROCESSO, 'chave-sae-teste-01');
    expect(deNovo.statusCode).toBe(409);
    const p = await ler(s);
    expect(p.atual).toMatchObject({ versao: 1, sistema: 'SINT' });
    expect(p.atual?.diagnosticos.map((d) => d.descricao)).toEqual([
      'Sintético: risco de lesão da pele por pressão',
      'Sintético: dor aguda',
    ]);
    expect(p.atual?.diagnosticos[0]?.fatores[0]?.descricao).toBe('Mobilidade reduzida no leito');
    expect(p.etapas.filter((e) => e.feita).map((e) => e.etapa)).toEqual([
      'avaliacao',
      'diagnostico',
      'planejamento',
    ]);
    const velha = await a.post(s, `/enfermagem/sae/${AT}`, { ...PROCESSO, versaoVista: 0 });
    expect(velha.statusCode).toBe(409);
    expect(velha.json().codigo).toBe('sae-mudou');
    expect(a.trilha.eventos.some((l) => l.evento === 'enfermagem.sae.registrada')).toBe(true);
  });
});

describe('regra 8: a prescrição de enfermagem aprazada e checada no turno', () => {
  const turno = async (s: Sessao) => {
    const r = await a.get(s, '/enfermagem/sae/turno?unidade=UTI');
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as CuidadosDoTurno;
  };

  it('prescreve as atividades das intervenções; o turno mostra os horários aprazados', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const p = await ler(s);
    const iv = p.atual!.diagnosticos[0]!.intervencoes[0]!;
    const dor = p.atual!.diagnosticos[1]!.intervencoes[0]!;
    const r = await a.post(s, `/enfermagem/sae/${AT}/cuidados`, {
      versaoVista: 1,
      atividades: [
        {
          intervencao: iv.id,
          codigo: 'S-A011',
          descricao: 'Mudar o decúbito',
          frequenciaDia: 4,
          horarios: p.grade['4'],
          inicio: '2026-10-22T08:00',
        },
        {
          intervencao: dor.id,
          codigo: 'S-A042',
          descricao: 'Aplicar compressa fria',
          frequenciaDia: 0,
          horarios: [],
        },
      ],
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().ids).toHaveLength(2);
    const t = await turno(s);
    const doPaciente = t.horarios.filter((h) => h.atendimento === AT);
    expect(doPaciente.filter((h) => !h.seNecessario).map((h) => [h.previsto, h.estado])).toEqual([
      ['2026-10-22T12:00', 'pendente'],
      ['2026-10-22T18:00', 'pendente'],
    ]);
    expect(doPaciente.filter((h) => h.seNecessario)).toHaveLength(1);
    expect(t.resumo.seNecessario).toBe(1);
    // A intervenção de outro processo e os horários fora da frequência são recusados.
    const x = await a.post(s, `/enfermagem/sae/${AT}/cuidados`, {
      versaoVista: 1,
      atividades: [{ intervencao: iv.id, descricao: 'x tarefa', frequenciaDia: 2, horarios: ['10:00'] }],
    });
    expect(x.json().codigo).toBe('horarios-da-frequencia');
    const tec = await a.entrar('SINT.TECNICO.ENF');
    expect(
      (await a.post(tec, `/enfermagem/sae/${AT}/cuidados`, { versaoVista: 1, atividades: [] })).statusCode,
    ).toBe(403);
  });

  it('o técnico checa: não feito exige motivo; o horário checado não se checa de novo; estorno e checagem de novo', async () => {
    const tec = await a.entrar('SINT.TECNICO.ENF');
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const t = await turno(tec);
    const h = t.horarios.find((x) => x.atendimento === AT && x.previsto === '2026-10-22T12:00')!;
    const url = `/enfermagem/sae/${AT}/cuidados/${h.atividade}/checagem`;
    const sem = await a.post(tec, url, { previsto: h.previsto, feita: false });
    expect(sem.statusCode).toBe(422);
    expect(sem.json().codigo).toBe('motivo-obrigatorio');
    const nao = await a.post(tec, url, {
      previsto: h.previsto,
      feita: false,
      motivo: 'Paciente no exame de imagem',
    });
    expect(nao.statusCode, nao.body).toBe(201);
    const dup = await a.post(tec, url, { previsto: h.previsto, feita: true });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().codigo).toBe('ja-checado');
    const id = nao.json().ids[0];
    // O técnico não estorna (permissão do cancelamento da checagem); o enfermeiro estorna com a justificativa.
    expect(
      (
        await a.post(tec, `/enfermagem/sae/${AT}/checagens/${id}/estorno`, {
          motivo: 'Checado no horário errado',
        })
      ).statusCode,
    ).toBe(403);
    const est = await a.post(enf, `/enfermagem/sae/${AT}/checagens/${id}/estorno`, {
      motivo: 'Checado no horário errado',
    });
    expect(est.statusCode, est.body).toBe(201);
    const dois = await a.post(enf, `/enfermagem/sae/${AT}/checagens/${id}/estorno`, {
      motivo: 'Checado no horário errado',
    });
    expect(dois.json().codigo).toBe('ja-estornado');
    const feita = await a.post(tec, url, {
      previsto: h.previsto,
      feita: true,
      horaReal: '2026-10-22T12:20',
      origemOffline: true,
    });
    expect(feita.statusCode, feita.body).toBe(201);
    const depois = (await turno(tec)).horarios.find(
      (x) => x.atendimento === AT && x.previsto === h.previsto,
    )!;
    expect(depois).toMatchObject({
      estado: 'feita',
      estornos: 1,
      checagem: { feita: true, origemOffline: true, categoria: 'tecnico' },
    });
    // Antes da hora (mais de uma hora à frente) e fora dos horários aprazados: recusa.
    expect((await a.post(tec, url, { previsto: '2026-10-22T18:00', feita: true })).json().codigo).toBe(
      'antes-da-hora',
    );
    expect((await a.post(tec, url, { previsto: '2026-10-22T13:00', feita: true })).json().codigo).toBe(
      'horario-nao-aprazado',
    );
    // O "se necessário": cada ato um horário, na hora real.
    const sn = (await turno(tec)).horarios.find((x) => x.atendimento === AT && x.seNecessario)!;
    const r = await a.post(tec, `/enfermagem/sae/${AT}/cuidados/${sn.atividade}/checagem`, {
      previsto: '2026-10-22T13:00',
      feita: true,
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(
      a.trilha.eventos.filter((l) => l.evento === 'enfermagem.cuidado.checado').length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('a suspensão: uma vez só, com o motivo; o horário depois dela sai do turno', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const h = (await turno(enf)).horarios.find(
      (x) => x.atendimento === AT && x.previsto === '2026-10-22T18:00',
    )!;
    const url = `/enfermagem/sae/${AT}/cuidados/${h.atividade}/suspensao`;
    expect((await a.post(enf, url, { motivo: 'curto' })).statusCode).toBe(400);
    const r = await a.post(enf, url, { motivo: 'Paciente deambulando sem ajuda desde a manhã.' });
    expect(r.statusCode, r.body).toBe(201);
    expect(
      (await a.post(enf, url, { motivo: 'Paciente deambulando sem ajuda desde a manhã.' })).json().codigo,
    ).toBe('ja-suspensa');
    const t = await turno(enf);
    expect(t.horarios.some((x) => x.atividade === h.atividade && x.previsto === '2026-10-22T18:00')).toBe(
      false,
    );
    // O horário de antes da suspensão continua com a checagem.
    expect(t.horarios.some((x) => x.atividade === h.atividade && x.previsto === '2026-10-22T12:00')).toBe(
      true,
    );
  });

  it('a evolução reavalia as metas (a situação sai da conta) e completa as cinco etapas', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const p = await ler(enf);
    const [pele, dor] = p.atual!.diagnosticos.map((d) => d.resultados[0]!);
    const r = await a.post(enf, `/enfermagem/sae/${AT}/evolucao`, {
      versaoVista: 1,
      nota: 'Evolução sintética: pele íntegra, dor controlada após a compressa.',
      resultados: [
        { resultado: pele!.id, escala: 4 },
        { resultado: dor!.id, escala: 2 },
      ],
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().mensagem).toMatch(/2 resultado\(s\) reavaliado\(s\), 1 com a meta atingida/);
    const depois = await ler(enf);
    expect(depois.etapas.every((e) => e.feita)).toBe(true);
    expect(depois.atual!.diagnosticos[0]!.resultados[0]!.evolucoes[0]).toMatchObject({
      escala: 4,
      situacao: 'melhorou',
    });
    expect(depois.atual!.evolucoes.map((e) => e.nota)).toEqual([
      'Evolução sintética: pele íntegra, dor controlada após a compressa.',
    ]);
    const tec = await a.entrar('SINT.TECNICO.ENF');
    expect(
      (
        await a.post(tec, `/enfermagem/sae/${AT}/evolucao`, {
          versaoVista: 1,
          nota: 'x'.repeat(12),
          resultados: [{ resultado: pele!.id, escala: 4 }],
        })
      ).statusCode,
    ).toBe(403);
  });

  it('a revisão (versão 2) substitui a vigente: as atividades da anterior saem do turno', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const r = await a.post(enf, `/enfermagem/sae/${AT}`, { ...PROCESSO, versaoVista: 1 });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().mensagem).toMatch(/versão 2/);
    const p = await ler(enf);
    expect(p.versoes.map((v) => v.versao)).toEqual([1, 2]);
    expect(p.horarios).toEqual([]);
  });
});

describe('terminologia (DP-19) e a chave desligada (POL-3)', () => {
  it('a carga é do administrador, com a senha; a versão carregada passa a valer e não se recarrega', async () => {
    const adm = await a.entrar('SINT.ADMIN');
    const termos = [
      { tipo: 'diagnostico', codigo: 'C-D1', descricao: 'Diagnóstico de teste', risco: true },
      { tipo: 'fator', codigo: 'C-F1', pai: 'C-D1', descricao: 'Fator de teste' },
      { tipo: 'resultado', codigo: 'C-R1', descricao: 'Resultado de teste' },
      { tipo: 'intervencao', codigo: 'C-I1', descricao: 'Intervenção de teste' },
      { tipo: 'atividade', codigo: 'C-A1', pai: 'C-I1', descricao: 'Atividade de teste' },
    ];
    const corpo = {
      sistema: 'CIPE',
      versao: 'TESTE-1',
      licenca: 'Licença sintética de teste',
      termos,
      senha: SENHA,
    };
    expect(
      (await a.post(adm, '/enfermagem/sae/terminologia', { ...corpo, senha: undefined })).statusCode,
    ).toBe(400);
    const sem = await a.post(adm, '/enfermagem/sae/terminologia', { ...corpo, termos: termos.slice(0, 3) });
    expect(sem.json().codigo).toBe('terminologia-incompleta');
    const r = await a.post(adm, '/enfermagem/sae/terminologia', corpo);
    expect(r.statusCode, r.body).toBe(201);
    expect((await a.post(adm, '/enfermagem/sae/terminologia', corpo)).json().codigo).toBe(
      'versao-ja-carregada',
    );
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    expect((await a.get(enf, '/enfermagem/sae/terminologia')).json()).toMatchObject({
      sistema: 'CIPE',
      versao: 'TESTE-1',
      sintetica: false,
      diagnosticos: 1,
      carregar: false,
    });
    expect((await a.post(enf, '/enfermagem/sae/terminologia', corpo)).statusCode).toBe(403);
  });

  it('desligada: a tela fica em consulta com o motivo e a gravação responde 403 recurso-desligado', async () => {
    const b = await montarAppSae({ semChave: 'enfermagem.sae' });
    try {
      const s = await b.entrar('SINT.ENF.PLANTAO');
      const p = (await b.get(s, `/enfermagem/sae/${AT}`)).json() as SaeDoPaciente;
      expect(p.gravacao.ligada).toBe(false);
      expect(p.gravacao.motivo).toMatch(/Funcionalidades por estabelecimento/);
      const r = await b.post(s, `/enfermagem/sae/${AT}`, PROCESSO);
      expect(r.statusCode).toBe(403);
      expect(r.json().codigo).toBe('recurso-desligado');
    } finally {
      await b.app.close();
    }
  });
});
