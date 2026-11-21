// Regra 2 do M46 (trava da incisão; ficha, seção 8: `trava-incisao.int-spec.ts`), pela HTTP com a sessão real e as portas
// em memória (dados SINTÉTICOS): com a chave `bloco.checklistTrava` ligada, a hora da incisão no registro do ato (M18)
// e o marco "início da cirurgia" da ficha anestésica (M46.1) são recusados sem a pausa cirúrgica concluída (a negação vai
// à trilha) e antes dela; passam depois dela, com a exceção em urgência e, no ato sem agendamento, só com o supervisor;
// com a chave desligada, nada é conferido (a gravação não muda).
import { LISTA_CHECKLIST_V1, type MomentoChecklist } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AG, type AppBloco, HOJE, montarAppBloco, respostasQueConcluem } from '../bloco-seguro.spec-util.js';

const ato = (agendamento: number | null, incisao: string | null, reg = 77010) => ({
  agendamento,
  reg,
  data: HOJE,
  sala: 2,
  convenio: 10,
  porte: 'M',
  potencialContaminacao: 'L',
  carater: 2,
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
  extensao: { entradaSala: '0740', incisao, saidaSala: '0950', asa: 2, observacao: null },
});
const itens = (m: MomentoChecklist) => LISTA_CHECKLIST_V1.itens.filter((i) => i.momento === m);

describe('trava da incisão ligada', () => {
  let a: AppBloco;
  beforeAll(async () => {
    a = await montarAppBloco();
  });
  afterAll(async () => {
    await a.fechar();
  });

  it('sem a pausa, recusa no registro do ato e na ficha; antes da pausa, também; depois, passa', async () => {
    const bloco = await a.entrar('SINT.BLOCO');
    const enf = await a.entrar('SINT.ENF.BLOCO');
    const anest = await a.entrar('SINT.ANESTESISTA');
    const sem = await a.postSemChave(bloco, '/api/cirurgia/realizadas', ato(AG, '0805'));
    expect(sem.statusCode, sem.body).toBe(422);
    expect(sem.json().codigo).toBe('incisao-sem-timeout');
    expect(a.trilha.eventos.filter((x) => x.evento === 'cirurgia.incisao.recusada')).toHaveLength(1);
    const marco = await a.post(anest, `/api/cirurgia/anestesia/${AG}/ficha/marcos`, {
      agendamento: AG,
      marco: 'inicioCirurgia',
      momento: `${HOJE}T08:05`,
    });
    expect(marco.json().codigo).toBe('incisao-sem-timeout');
    // A pausa cirúrgica concluída às 08:20 (entrada e pausa, todos os itens).
    let versao = 0;
    for (const [m, hora] of [
      ['inducao', '08:10'],
      ['incisao', '08:20'],
    ] as const) {
      const r = await a.post(enf, `/${AG}/checklist/itens`, {
        agendamento: AG,
        momento: m,
        versaoVista: versao,
        em: `${HOJE}T${hora}`,
        itens: respostasQueConcluem(itens(m)),
      });
      expect(r.statusCode, r.body).toBe(201);
      versao = (await a.get(enf, `/${AG}/checklist`)).json().checklist.versao;
      const c = await a.post(enf, `/${AG}/checklist/momentos`, {
        agendamento: AG,
        momento: m,
        versaoVista: versao,
        em: `${HOJE}T${hora}`,
      });
      expect(c.statusCode, c.body).toBe(201);
      versao += 1;
    }
    const antes = await a.postSemChave(bloco, '/api/cirurgia/realizadas', ato(AG, '0815'));
    expect(antes.json().codigo).toBe('incisao-antes-do-timeout');
    const depois = await a.postSemChave(bloco, '/api/cirurgia/realizadas', ato(AG, '0825'));
    expect(depois.statusCode, depois.body).toBe(201);
    const marcoOk = await a.post(anest, `/api/cirurgia/anestesia/${AG}/ficha/marcos`, {
      agendamento: AG,
      marco: 'inicioCirurgia',
      momento: `${HOJE}T08:25`,
    });
    expect(String(marcoOk.json().codigo ?? '')).not.toMatch(/^incisao-/);
  });

  it('com a exceção em urgência registrada pelo supervisor, passa; o ato sem agendamento só com o supervisor', async () => {
    const bloco = await a.entrar('SINT.BLOCO');
    const exc = await a.post(bloco, '/702/checklist/excecao', {
      agendamento: 702,
      versaoVista: 0,
      urgencia: true,
      motivo: 'Urgência: perfuração com instabilidade',
      em: `${HOJE}T08:00`,
    });
    expect(exc.statusCode, exc.body).toBe(201);
    const r = await a.postSemChave(bloco, '/api/cirurgia/realizadas', ato(702, '0805', 77011));
    expect(r.statusCode, r.body).toBe(201);
    // Sem agendamento, o supervisor (a opção dos parâmetros do bloco) informa a incisão só em urgência e com o motivo
    // (regra 2: a mesma exceção do checklist); a trilha registra a exceção com o caráter e o motivo.
    const n = a.trilha.eventos.filter((x) => x.evento === 'cirurgia.incisao.excecao').length;
    const recusas = a.trilha.eventos.filter((x) => x.evento === 'cirurgia.incisao.recusada').length;
    const motivo = 'Urgência: sangramento ativo sem tempo para a pausa';
    const eletiva = await a.postSemChave(bloco, '/api/cirurgia/realizadas', {
      ...ato(null, '0805', 77012),
      motivoExcecaoIncisao: motivo,
    });
    expect(eletiva.statusCode, eletiva.body).toBe(422);
    expect(eletiva.json().codigo).toBe('excecao-so-urgencia');
    const semMotivo = await a.postSemChave(bloco, '/api/cirurgia/realizadas', {
      ...ato(null, '0805', 77012),
      carater: 1,
    });
    expect(semMotivo.statusCode, semMotivo.body).toBe(422);
    expect(semMotivo.json().codigo).toBe('excecao-sem-motivo');
    const curto = await a.postSemChave(bloco, '/api/cirurgia/realizadas', {
      ...ato(null, '0805', 77012),
      carater: 1,
      motivoExcecaoIncisao: 'urgente',
    });
    expect(curto.json().codigo).toBe('excecao-sem-motivo');
    expect(a.trilha.eventos.filter((x) => x.evento === 'cirurgia.incisao.recusada')).toHaveLength(
      recusas + 3,
    );
    const semAg = await a.postSemChave(bloco, '/api/cirurgia/realizadas', {
      ...ato(null, '0805', 77012),
      carater: 1,
      motivoExcecaoIncisao: motivo,
    });
    expect(semAg.statusCode, semAg.body).toBe(201);
    const excecoes = a.trilha.eventos.filter((x) => x.evento === 'cirurgia.incisao.excecao');
    expect(excecoes).toHaveLength(n + 1);
    expect(excecoes.at(-1)?.chaveNaturalAlvo).toBe(`carater:1;motivo:${motivo}`);
    // Sem a hora da incisão, nada a conferir.
    expect((await a.postSemChave(bloco, '/api/cirurgia/realizadas', ato(null, null, 77013))).statusCode).toBe(
      201,
    );
  });
});

describe('trava da incisão desligada', () => {
  it('nada é conferido: o registro do ato passa como sem o checklist', async () => {
    const b = await montarAppBloco({ semChaves: ['bloco.checklistTrava'] });
    try {
      const s = await b.entrar('SINT.BLOCO');
      const t = (await b.get(s, `/${AG}/checklist`)).json();
      expect(t.trava.ligada).toBe(false);
      const r = await b.postSemChave(s, '/api/cirurgia/realizadas', ato(AG, '0805'));
      expect(r.statusCode, r.body).toBe(201);
      expect(b.trilha.eventos.some((x) => x.evento === 'cirurgia.incisao.recusada')).toBe(false);
    } finally {
      await b.fechar();
    }
  });
});
