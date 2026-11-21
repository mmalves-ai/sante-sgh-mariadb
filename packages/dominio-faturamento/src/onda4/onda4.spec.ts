// Regras puras da onda 4 (ficha do M42, campo 8: regras 1, 4 e 9; campo 4: acompanhamento e conferência).
import { describe, expect, it } from 'vitest';
import {
  CODIGOS_BAIXA_CONFIANCA_ONDA_4,
  conferirAberturaDaCompetencia,
  conferirCodigoOnda4,
  diasDeFechamento,
  diaUtil,
  diaValido,
  diferencasDaCompetencia,
  domingoDePascoa,
  emFeriadoProlongado,
  feriadosNacionais,
  podePublicarVersao,
  primeiroDiaUtil,
  primeirosDiasUteis,
  resumirContasDaCompetencia,
  somarDias,
  ultimosDiasUteis,
} from '../index.js';

// Feriados de teste (parâmetro do hospital; nenhum é inventado pela regra).
const FERIADOS = new Set([
  '2026-12-25',
  '2027-01-01',
  '2027-02-08',
  '2027-02-09',
  '2026-11-02',
  '2026-11-20',
]);
const NENHUM = new Set<string>();

describe('calendário', () => {
  it('dia válido, soma de dias e dia útil', () => {
    expect(diaValido('2027-02-29')).toBe(false);
    expect(diaValido('2028-02-29')).toBe(true);
    expect(diaValido('27-01-01')).toBe(false);
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(somarDias('2027-01-01', -1)).toBe('2026-12-31');
    expect(diaUtil('2027-01-01', FERIADOS)).toBe(false);
    expect(diaUtil('2027-01-02', NENHUM)).toBe(false);
    expect(diaUtil('2027-01-04', FERIADOS)).toBe(true);
    expect(() => somarDias('2027-13-01', 1)).toThrow(RangeError);
  });

  it('primeiros e últimos dias úteis do mês', () => {
    expect(primeiroDiaUtil(2027, 1, FERIADOS)).toBe('2027-01-04');
    expect(primeiroDiaUtil(2027, 1, NENHUM)).toBe('2027-01-01');
    expect(() => primeiroDiaUtil(2027, 13, NENHUM)).toThrow(RangeError);
    expect(primeirosDiasUteis(2027, 1, 3, FERIADOS)).toEqual(['2027-01-04', '2027-01-05', '2027-01-06']);
    expect(ultimosDiasUteis(2026, 12, 2, FERIADOS)).toEqual(['2026-12-30', '2026-12-31']);
    expect(primeirosDiasUteis(2027, 2, 40, NENHUM)).toHaveLength(20);
    expect(ultimosDiasUteis(2027, 2, 40, NENHUM)).toHaveLength(20);
  });
});

describe('feriados nacionais (padrão de mercado; o cadastro do estabelecimento soma os locais)', () => {
  it('Páscoa e Sexta-feira da Paixão', () => {
    expect(domingoDePascoa(2026)).toBe('2026-04-05');
    expect(domingoDePascoa(2027)).toBe('2027-03-28');
    expect(domingoDePascoa(2024)).toBe('2024-03-31');
    expect(feriadosNacionais(2027)).toContain('2027-03-26');
  });

  it('fixos de lei, com a Consciência Negra só desde 2024; Carnaval e Corpus Christi ficam de fora', () => {
    const f = feriadosNacionais(2027);
    expect(f).toHaveLength(10);
    expect(f).toEqual(expect.arrayContaining(['2027-01-01', '2027-11-20', '2027-12-25', '2027-04-21']));
    expect(feriadosNacionais(2023)).not.toContain('2023-11-20');
    expect(f).not.toContain('2027-02-08');
  });

  it('com a configuração padrão (só os nacionais), a primeira abertura de 2027 é 04/01, não 01/01', () => {
    const nacionais = new Set(feriadosNacionais(2027));
    expect(primeiroDiaUtil(2027, 1, nacionais)).toBe('2027-01-04');
    expect(conferirAberturaDaCompetencia('2027-01-04', nacionais).ok).toBe(true);
    expect(conferirAberturaDaCompetencia('2027-01-01', nacionais).ok).toBe(false);
  });
});

describe('regra 1: a onda começa na abertura de uma competência', () => {
  it('aceita o primeiro dia útil do mês', () => {
    const r = conferirAberturaDaCompetencia('2027-01-04', FERIADOS);
    expect(r).toMatchObject({ ok: true, competencia: '2027-01', abertura: '2027-01-04', recusa: null });
  });

  it('recusa outro dia e diz a próxima abertura (virada de ano incluída)', () => {
    const r = conferirAberturaDaCompetencia('2027-01-05', FERIADOS);
    expect(r.ok).toBe(false);
    expect(r.proximaAbertura).toBe('2027-02-01');
    expect(r.recusa?.codigo).toBe('onda4-fora-da-abertura');
    expect(r.recusa?.mensagem).toContain('2027-02-01');
    expect(r.recusa?.mensagem).not.toMatch(/SPDATA|legado/i);
    expect(conferirAberturaDaCompetencia('2026-12-02', FERIADOS).proximaAbertura).toBe('2027-01-04');
  });
});

describe('regra 4: sem versão nos dias de fechamento nem em feriado prolongado', () => {
  it('dias de fechamento: 2 últimos úteis do mês e 5 primeiros do seguinte (padrão de mercado, parâmetro)', () => {
    expect(diasDeFechamento(2026, 12, FERIADOS)).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-04',
      '2027-01-05',
      '2027-01-06',
      '2027-01-07',
      '2027-01-08',
    ]);
    expect(
      diasDeFechamento(2027, 1, FERIADOS, { ultimosDiasUteisDoMes: 1, primeirosDiasUteisDoMesSeguinte: 1 }),
    ).toEqual(['2027-01-29', '2027-02-01']);
  });

  it('feriado prolongado: o bloco de 3 ou mais dias com feriado e o dia útil anterior', () => {
    expect(emFeriadoProlongado('2027-02-08', FERIADOS)).toBe(true);
    expect(emFeriadoProlongado('2027-02-06', FERIADOS)).toBe(true);
    expect(emFeriadoProlongado('2027-02-05', FERIADOS)).toBe(true);
    expect(emFeriadoProlongado('2027-02-10', FERIADOS)).toBe(false);
    // Fim de semana comum não é feriado prolongado.
    expect(emFeriadoProlongado('2027-02-13', FERIADOS)).toBe(false);
    expect(emFeriadoProlongado('2027-02-12', FERIADOS)).toBe(false);
  });

  it('só hotfix de S1 nos dias bloqueados; nos demais, livre', () => {
    expect(podePublicarVersao('2027-01-05', 'S2', FERIADOS)).toEqual({
      pode: false,
      motivo: 'fechamento',
      soHotfixS1: true,
    });
    expect(podePublicarVersao('2027-01-05', 'S1', FERIADOS).pode).toBe(true);
    expect(podePublicarVersao('2026-12-31', null, FERIADOS).motivo).toBe('fechamento');
    // 19/11: quinta antes do feriado de sexta com o fim de semana (fora dos dias de fechamento).
    expect(podePublicarVersao('2026-11-19', null, FERIADOS).motivo).toBe('feriado-prolongado');
    // 05/02 é feriado prolongado e também dia de fechamento: vale o fechamento.
    expect(podePublicarVersao('2027-02-05', null, FERIADOS).motivo).toBe('fechamento');
    expect(podePublicarVersao('2027-01-20', null, FERIADOS)).toEqual({
      pode: true,
      motivo: 'livre',
      soHotfixS1: false,
    });
    expect(podePublicarVersao('2027-02-02', 'S3', FERIADOS).motivo).toBe('fechamento');
  });
});

describe('regra 9: códigos de baixa confiança da onda', () => {
  it('a lista cobre os códigos da ficha, com a DP de cada um', () => {
    expect(CODIGOS_BAIXA_CONFIANCA_ONDA_4.map((c) => c.coluna)).toEqual([
      'contaPagar.situacao',
      'contaPagar.formaPagamento',
      'contaReceber.origem',
      'movimentoBancario.tipoTransferencia',
      'contaHospitalar.tipoNota',
      'contaHospitalar.pacote',
      'itemConta.fpa',
      'itemConta.origemLancamento',
    ]);
  });

  it('recusa valor nunca visto e mostra "a confirmar" no visto', () => {
    const ok = conferirCodigoOnda4('movimentoBancario.tipoTransferencia', 'I', ['', 'F', 'I', 'O']);
    expect(ok).toEqual({ aceito: true, legenda: 'I (a confirmar)', recusa: null });
    const nao = conferirCodigoOnda4('movimentoBancario.tipoTransferencia', 'Z', ['', 'F', 'I', 'O']);
    expect(nao.aceito).toBe(false);
    expect(nao.recusa?.codigo).toBe('codigo-nunca-visto');
    expect(nao.recusa?.mensagem).toContain('DP-46.4');
    expect(conferirCodigoOnda4('contaReceber.origem', '', ['']).legenda).toBe('(a confirmar)');
  });

  it('legenda confirmada substitui a de baixa confiança; coluna fora da lista segue a regra geral', () => {
    expect(conferirCodigoOnda4('contaHospitalar.pacote', 'P', ['P'], { P: 'Pacote' }).legenda).toBe('Pacote');
    expect(conferirCodigoOnda4('contaHospitalar.situacao', 'X', [])).toMatchObject({ aceito: true, recusa: null });
  });
});

describe('acompanhamento da competência', () => {
  it('soma as contas com as parcelas por situação e por sistema que fechou', () => {
    const r = resumirContasDaCompetencia([
      { convenio: 2, situacao: 'A', contas: 10, fechadasPeloNovo: 4, valor: 1000.1 },
      { convenio: 2, situacao: 'N', contas: 3, fechadasPeloNovo: 0, valor: 0 },
      { convenio: 1, situacao: 'S', contas: 5, fechadasPeloNovo: 9, valor: 250 },
      { convenio: 1, situacao: '?', contas: 1, fechadasPeloNovo: 1, valor: 1 },
    ]);
    expect(r.contas).toBe(19);
    expect(r.porSituacao.map((p) => p.situacao)).toEqual(['N', 'S', 'A', 'outra']);
    expect(r.porSituacao.reduce((s, p) => s + p.contas, 0)).toBe(r.contas);
    expect(r.fechadas).toBe(15);
    // Nunca mais "pelo novo" do que contas na linha; a situação desconhecida não conta como fechada.
    expect(r.fechadasPeloNovo).toBe(9);
    expect(r.fechadasPeloNovo + r.fechadasPeloOutro).toBe(r.fechadas);
    expect(r.parcelaDoNovo).toBeCloseTo(9 / 15);
    expect(r.valor).toBe(1251.1);
    expect(r.porConvenio.map((c) => c.convenio)).toEqual([1, 2]);
    expect(r.porConvenio[1]).toMatchObject({ contas: 13, fechadas: 10, fechadasPeloNovo: 4 });
  });

  it('sem conta fechada, a parcela do novo é nula', () => {
    expect(resumirContasDaCompetencia([]).parcelaDoNovo).toBeNull();
  });
});

describe('conferência da competência: relatório de diferenças', () => {
  it('vazio quando as duas leituras conferem (tolerância de meio centavo)', () => {
    const a = [{ chave: 'conv:1', valores: { contas: 3, valor: 10.001, situacao: 'A' } }];
    const b = [{ chave: 'conv:1', valores: { contas: 3, valor: 10, situacao: 'A' } }];
    expect(diferencasDaCompetencia(a, b)).toEqual([]);
  });

  it('lista campo divergente e chave de um lado só', () => {
    const r = diferencasDaCompetencia(
      [
        { chave: 'conv:1', valores: { contas: 3, situacao: 'A' } },
        { chave: 'conv:2', valores: { contas: 1 } },
      ],
      [
        { chave: 'conv:1', valores: { contas: 4, extra: null } },
        { chave: 'conv:3', valores: { contas: 1 } },
      ],
    );
    expect(r).toEqual([
      { chave: 'conv:1', campo: 'contas', novo: 3, outro: 4 },
      { chave: 'conv:1', campo: 'situacao', novo: 'A', outro: null },
      { chave: 'conv:2', campo: 'presenca', novo: 'presente', outro: null },
      { chave: 'conv:3', campo: 'presenca', novo: null, outro: 'presente' },
    ]);
  });
});
