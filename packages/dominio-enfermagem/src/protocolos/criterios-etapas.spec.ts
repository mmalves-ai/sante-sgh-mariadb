// C2-042 (03-PEP L134): critérios de entrada avaliados pelo sistema, fórmula, alerta de elegível e etapas com meta.
import { describe, expect, it } from 'vitest';
import {
  alertasDeElegiveis,
  avaliarCriterio,
  avaliarEntrada,
  cabeNoPublico,
  type CriterioProtocolo,
  type EtapaProtocolo,
  type FatoClinico,
  MODELOS_PROTOCOLO,
  planoDasEtapas,
  problemaDaConclusao,
  problemaDaEtapa,
  problemaDaFormula,
  problemaDoCancelamento,
  problemasDoCriterio,
  relogioDaEtapa,
  situacaoAoConcluir,
  situacaoAoSairDoProtocolo,
} from './criterios-etapas.js';

const ADULTO = { sexo: 'masculino' as const, idadeDias: 40 * 365 };
const AGORA = '2026-11-25T10:00';

const crit = (x: Partial<CriterioProtocolo>): CriterioProtocolo => ({
  id: 1,
  sequencia: 1,
  finalidade: 'entrada',
  grupo: null,
  categoria: 'sinal_vital',
  campo: 'fc',
  termo: null,
  valorTexto: null,
  valorMinimo: null,
  valorMaximo: null,
  sexo: 'todos',
  idadeMinimaDias: null,
  idadeMaximaDias: null,
  validadeHoras: null,
  descricao: null,
  ativo: true,
  ...x,
});
const sinal = (chave: string, valor: number, em: string): FatoClinico => ({
  categoria: 'sinal_vital',
  chave,
  valor,
  texto: null,
  em,
});
/** Os critérios do modelo de sepse como se gravados (ids e sequências). */
const SEPSE: CriterioProtocolo[] = MODELOS_PROTOCOLO['sepse']!.criterios.map((c, i) =>
  crit({ ...c, id: i + 1, sequencia: i + 1, finalidade: 'entrada', ativo: true }),
);
const FORMULA_SEPSE = MODELOS_PROTOCOLO['sepse']!.formula;

describe('critério avaliado pelo sistema', () => {
  it('usa o dado mais recente dentro da janela e confere a faixa', () => {
    const c = crit({ valorMinimo: 91 });
    const fatos = [sinal('fc', 120, '2026-11-25T08:00'), sinal('fc', 80, '2026-11-25T09:30')];
    const r = avaliarCriterio(c, fatos, ADULTO, AGORA);
    expect(r.atendido).toBe(false);
    expect(r.valorEncontrado).toBe('80');
    expect(avaliarCriterio(c, [sinal('fc', 120, '2026-11-25T09:59')], ADULTO, AGORA).atendido).toBe(true);
  });

  it('ignora o dado fora da janela (6 h no sinal vital) e o do futuro', () => {
    const c = crit({ valorMinimo: 91 });
    expect(avaliarCriterio(c, [sinal('fc', 130, '2026-11-25T03:59')], ADULTO, AGORA).motivo).toMatch(/6 h/);
    expect(avaliarCriterio(c, [sinal('fc', 130, '2026-11-25T10:01')], ADULTO, AGORA).atendido).toBe(false);
    expect(
      avaliarCriterio(
        crit({ valorMinimo: 91, validadeHoras: 12 }),
        [sinal('fc', 130, '2026-11-25T03:59')],
        ADULTO,
        AGORA,
      ).atendido,
    ).toBe(true);
  });

  it('respeita o sexo e a faixa de idade; o diagnóstico vale pela presença', () => {
    expect(
      avaliarCriterio(crit({ sexo: 'feminino', valorMinimo: 1 }), [sinal('fc', 99, AGORA)], ADULTO, AGORA)
        .atendido,
    ).toBe(false);
    expect(
      avaliarCriterio(crit({ idadeMaximaDias: 365, valorMinimo: 1 }), [sinal('fc', 99, AGORA)], ADULTO, AGORA)
        .atendido,
    ).toBe(false);
    const dx = crit({ categoria: 'diagnostico', campo: null, termo: 77 });
    const fato: FatoClinico = {
      categoria: 'diagnostico',
      chave: '77',
      valor: null,
      texto: 'I21',
      em: '2026-11-20T10:00',
    };
    expect(avaliarCriterio(dx, [fato], ADULTO, AGORA).atendido).toBe(true);
    expect(avaliarCriterio(dx, [], ADULTO, AGORA).atendido).toBe(false);
  });

  it('confere a configuração antes de gravar', () => {
    const base = {
      finalidade: 'entrada' as const,
      grupo: 'fc alta',
      categoria: 'sinal_vital' as const,
      campo: null,
      termo: null,
      valorTexto: null,
      valorMinimo: 10,
      valorMaximo: 5,
      sexo: 'todos' as const,
      idadeMinimaDias: null,
      idadeMaximaDias: null,
      validadeHoras: 0,
    };
    expect(problemasDoCriterio(base)).toEqual([
      'grupo-invalido',
      'campo-obrigatorio',
      'faixa-invertida',
      'validade-invalida',
    ]);
    expect(
      problemasDoCriterio({
        ...base,
        grupo: null,
        categoria: 'diagnostico',
        valorMinimo: null,
        valorMaximo: null,
        validadeHoras: null,
      }),
    ).toEqual(['termo-obrigatorio']);
  });
});

describe('fórmula de entrada', () => {
  it('recusa grupo sem critério e sintaxe quebrada', () => {
    expect(problemaDaFormula('a E b', ['a'])).toMatch(/b/);
    expect(problemaDaFormula('a E (b', ['a', 'b'])).toMatch(/\)/);
    expect(problemaDaFormula('PELO_MENOS 3 (a, b)', ['a', 'b'])).toMatch(/PELO_MENOS 3/);
    expect(problemaDaFormula('a OU NAO b', ['a', 'b'])).toBeNull();
  });

  it('sepse: dois sinais alterados abrem o alerta; um só, não', () => {
    const dois = [
      sinal('temperatura', 38.9, '2026-11-25T09:00'),
      sinal('frequencia_cardiaca', 112, '2026-11-25T09:00'),
    ];
    const a = avaliarEntrada(FORMULA_SEPSE, SEPSE, dois, ADULTO, AGORA);
    expect(a.elegivel).toBe(true);
    expect(a.regraAvaliada).toContain('temperatura: sim');
    expect(a.regraAvaliada).toContain('hipotensao: não');
    expect(avaliarEntrada(FORMULA_SEPSE, SEPSE, dois.slice(0, 1), ADULTO, AGORA).elegivel).toBe(false);
    // A hipotermia vale pelo mesmo grupo (um critério do grupo basta).
    const hipo = [
      sinal('temperatura', 35.2, '2026-11-25T09:00'),
      sinal('pressao_sistolica', 88, '2026-11-25T09:00'),
    ];
    expect(avaliarEntrada(FORMULA_SEPSE, SEPSE, hipo, ADULTO, AGORA).elegivel).toBe(true);
  });

  it('sem fórmula, todos os grupos; sem critério ativo, nunca elegível', () => {
    const cs = [
      crit({ id: 1, sequencia: 1, valorMinimo: 100 }),
      crit({ id: 2, sequencia: 2, campo: 'fr', valorMinimo: 22 }),
    ];
    const f = [sinal('fc', 120, AGORA), sinal('fr', 18, AGORA)];
    expect(avaliarEntrada(null, cs, f, ADULTO, AGORA).elegivel).toBe(false);
    expect(avaliarEntrada(null, cs, [...f, sinal('fr', 24, AGORA)], ADULTO, AGORA).formula).toBe(
      'criterio_1 E criterio_2',
    );
    expect(
      avaliarEntrada(
        null,
        cs.map((c) => ({ ...c, ativo: false })),
        f,
        ADULTO,
        AGORA,
      ).elegivel,
    ).toBe(false);
  });
});

describe('alerta de paciente elegível', () => {
  const protocolo = {
    id: 9,
    nome: 'Sepse',
    tipo: 'sepse',
    publico: 'adulto' as const,
    formula: FORMULA_SEPSE,
    mensagem: 'Suspeita de sepse',
    criterios: SEPSE,
  };
  const fatos = [
    sinal('temperatura', 39, '2026-11-25T09:10'),
    sinal('frequencia_cardiaca', 115, '2026-11-25T09:20'),
  ];

  it('lista o elegível com os critérios atendidos e o tempo zero sugerido; não repete o aberto', () => {
    const c = { atendimento: 5, paciente: 7, dados: ADULTO, fatos };
    const r = alertasDeElegiveis([c], [protocolo], new Set(), AGORA);
    expect(r).toHaveLength(1);
    expect(r[0]!.desde).toBe('2026-11-25T09:20');
    expect(r[0]!.criteriosAtendidos).toHaveLength(2);
    expect(alertasDeElegiveis([c], [protocolo], new Set(['5|9']), AGORA)).toHaveLength(0);
  });

  it('confere o público do protocolo', () => {
    expect(cabeNoPublico('adulto', { sexo: null, idadeDias: 10 * 365 })).toBe(false);
    expect(cabeNoPublico('neonatal', { sexo: null, idadeDias: 3 })).toBe(true);
    expect(cabeNoPublico('obstetrico', ADULTO)).toBe(false);
    expect(cabeNoPublico('todos', { sexo: null, idadeDias: null })).toBe(true);
  });
});

describe('etapas com meta de tempo', () => {
  const et = (x: Partial<EtapaProtocolo>): EtapaProtocolo => ({
    id: 1,
    sequencia: 1,
    nome: 'Etapa',
    tipo: 'exame',
    metaMinutos: 60,
    faixaEtaria: 'todas',
    obrigatoria: true,
    ...x,
  });

  it('planeja os prazos a partir do horário zero, pela faixa do paciente', () => {
    const p = planoDasEtapas(
      [
        et({ id: 3, sequencia: 3, metaMinutos: null }),
        et({ id: 1, sequencia: 1, metaMinutos: 60 }),
        et({ id: 2, sequencia: 2, faixaEtaria: 'pediatrico' }),
        et({ id: 4, sequencia: 4, faixaEtaria: 'adulto', metaMinutos: 25 }),
      ],
      '2026-11-25T09:00',
      70 * 365,
    );
    expect(p).toEqual([
      { etapa: 1, sequencia: 1, iniciadaEm: '2026-11-25T09:00', prazoMetaEm: '2026-11-25T10:00' },
      { etapa: 3, sequencia: 2, iniciadaEm: '2026-11-25T09:00', prazoMetaEm: null },
      { etapa: 4, sequencia: 3, iniciadaEm: '2026-11-25T09:00', prazoMetaEm: '2026-11-25T09:25' },
    ]);
  });

  it('meta atingida no prazo; perdida exige justificativa; nada no futuro nem antes do início', () => {
    const base = {
      situacaoAtual: 'em_andamento' as const,
      iniciadaEm: '2026-11-25T09:00',
      prazoMetaEm: '2026-11-25T10:00',
      agora: '2026-11-25T11:00',
      justificativa: null,
    };
    expect(situacaoAoConcluir(base.prazoMetaEm, '2026-11-25T10:00')).toBe('meta_atingida');
    expect(situacaoAoConcluir(base.prazoMetaEm, '2026-11-25T10:01')).toBe('meta_perdida');
    expect(problemaDaConclusao({ ...base, concluidaEm: '2026-11-25T09:45' })).toBeNull();
    expect(problemaDaConclusao({ ...base, concluidaEm: '2026-11-25T10:30' })).toBe(
      'justificativa-obrigatoria',
    );
    expect(
      problemaDaConclusao({
        ...base,
        concluidaEm: '2026-11-25T10:30',
        justificativa: 'Acesso venoso difícil.',
      }),
    ).toBeNull();
    expect(problemaDaConclusao({ ...base, concluidaEm: '2026-11-25T11:05' })).toBe('conclusao-no-futuro');
    expect(problemaDaConclusao({ ...base, concluidaEm: '2026-11-25T08:59' })).toBe(
      'conclusao-antes-do-inicio',
    );
    expect(
      problemaDaConclusao({ ...base, situacaoAtual: 'meta_atingida', concluidaEm: '2026-11-25T09:45' }),
    ).toBe('etapa-ja-concluida');
  });

  it('cancela só a etapa opcional, com motivo', () => {
    expect(
      problemaDoCancelamento({
        situacaoAtual: 'em_andamento',
        obrigatoria: true,
        motivo: 'Não se aplica ao caso.',
      }),
    ).toBe('etapa-obrigatoria');
    expect(
      problemaDoCancelamento({ situacaoAtual: 'em_andamento', obrigatoria: false, motivo: 'curto' }),
    ).toBe('motivo-obrigatorio');
    expect(
      problemaDoCancelamento({
        situacaoAtual: 'em_andamento',
        obrigatoria: false,
        motivo: 'Sem hipotensão.',
      }),
    ).toBeNull();
  });

  it('relógio: no prazo, vencendo (15 min), vencida', () => {
    expect(relogioDaEtapa('em_andamento', '2026-11-25T10:30', AGORA)).toEqual({
      estado: 'no_prazo',
      minutosRestantes: 30,
    });
    expect(relogioDaEtapa('em_andamento', '2026-11-25T10:15', AGORA).estado).toBe('vencendo');
    expect(relogioDaEtapa('em_andamento', '2026-11-25T09:50', AGORA)).toEqual({
      estado: 'vencida',
      minutosRestantes: -10,
    });
    expect(relogioDaEtapa('em_andamento', null, AGORA).estado).toBe('sem_meta');
    expect(relogioDaEtapa('meta_perdida', '2026-11-25T09:50', AGORA).estado).toBe('perdida');
  });

  it('os modelos de mercado trazem as metas configuráveis válidas', () => {
    expect(MODELOS_PROTOCOLO['sepse']!.etapas.slice(0, 3).map((e) => e.metaMinutos)).toEqual([60, 60, 60]);
    expect(MODELOS_PROTOCOLO['dor_toracica']!.etapas.map((e) => e.metaMinutos)).toEqual([10, 60, 30, 90]);
    expect(MODELOS_PROTOCOLO['avc']!.etapas.map((e) => e.metaMinutos)).toEqual([10, 25, 45, 60]);
    for (const m of Object.values(MODELOS_PROTOCOLO))
      for (const e of m!.etapas) expect(problemaDaEtapa(e)).toBeNull();
    const grupos = [...new Set(SEPSE.map((c) => c.grupo!))];
    expect(problemaDaFormula(FORMULA_SEPSE!, grupos)).toBeNull();
    for (const c of MODELOS_PROTOCOLO['sepse']!.criterios)
      expect(problemasDoCriterio({ ...c, finalidade: 'entrada' })).toEqual([]);
  });

  it('o modelo da sepse usa os códigos do catálogo padrão de parâmetros vitais', () => {
    // O catálogo que todo cliente recebe (parametro_vital): o modelo não pode depender de código próprio do hospital.
    const CATALOGO = [
      'pressao_sistolica',
      'pressao_diastolica',
      'frequencia_cardiaca',
      'frequencia_respiratoria',
    ];
    const campos = MODELOS_PROTOCOLO['sepse']!.criterios.map((c) => c.campo!);
    for (const c of campos) expect([...CATALOGO, 'temperatura']).toContain(c);
  });

  it('na saída do protocolo a etapa pendente ganha situação final', () => {
    // Encerramento depois do prazo: meta perdida; antes do prazo ou sem meta: cancelada.
    expect(situacaoAoSairDoProtocolo('2026-11-25T10:00', '2026-11-25T10:05', 'encerramento')).toBe(
      'meta_perdida',
    );
    expect(situacaoAoSairDoProtocolo('2026-11-25T10:00', '2026-11-25T09:55', 'encerramento')).toBe(
      'cancelada',
    );
    expect(situacaoAoSairDoProtocolo(null, '2026-11-25T12:00', 'encerramento')).toBe('cancelada');
    // Inclusão lançada por engano: a meta não conta como perdida.
    expect(situacaoAoSairDoProtocolo('2026-11-25T10:00', '2026-11-25T11:00', 'inativacao')).toBe('cancelada');
  });
});
