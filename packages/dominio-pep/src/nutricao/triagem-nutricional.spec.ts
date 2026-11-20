// Triagem nutricional (ficha do M45, regras 3 e 10): o total do NRS-2002 e do NUTRIC modificado é sempre calculado (as
// faixas publicadas), a idade entra pelo cadastro, e a fila mostra a triagem vencida (mais de 48 h) em vermelho, a de
// atenção (de 24 a 48 h) e as reavaliações. Casos sintéticos.
import { describe, expect, it } from 'vitest';
import {
  calcularNrs2002,
  calcularNutric,
  calcularTriagem,
  ErroTriagem,
  horasDesdeAdmissao,
  idadeNoDia,
  imc,
  indicadoresTriagem,
  minutosEntre,
  ordenarFilaTriagem,
  PRAZOS_TRIAGEM_PADRAO,
  reavaliarEm,
  respostasCompactas,
  situacaoTriagem,
  somarDias,
  somarHoras,
} from '../index.js';

const nao = {
  instrumento: 'nrs2002' as const,
  imcAbaixoDe20e5: false,
  perdaDePeso3Meses: false,
  ingestaoReduzidaSemana: false,
  gravementeDoente: false,
  estadoNutricional: null,
  gravidade: null,
};

describe('NRS-2002 (regra 3: total sempre calculado)', () => {
  it('triagem inicial toda "não": sem risco, sem triagem final, total 0', () => {
    const r = calcularNrs2002(nao, 50);
    expect(r).toMatchObject({ total: 0, risco: 'sem-risco', triagemFinal: false, versao: 'nrs2002-v1' });
    expect(r.parcelas).toEqual({ estado: null, gravidade: null, idade: null });
  });
  it('alguma "sim" sem a triagem final é recusada', () => {
    expect(() => calcularNrs2002({ ...nao, perdaDePeso3Meses: true }, 50)).toThrow(ErroTriagem);
    try {
      calcularNrs2002({ ...nao, gravementeDoente: true, estadoNutricional: 1 }, 50);
    } catch (x) {
      expect((x as ErroTriagem).codigo).toBe('triagem-final-pendente');
    }
  });
  it('estado 1 + gravidade 1 aos 69 anos: 2 (sem risco); aos 70 anos: 3 (risco), com a parcela da idade', () => {
    const r = { ...nao, ingestaoReduzidaSemana: true, estadoNutricional: 1, gravidade: 1 };
    expect(calcularNrs2002(r, 69)).toMatchObject({ total: 2, risco: 'sem-risco', triagemFinal: true });
    expect(calcularNrs2002(r, 70)).toMatchObject({
      total: 3,
      risco: 'risco',
      parcelas: { estado: 1, gravidade: 1, idade: 1 },
    });
  });
  it('o máximo é 7 (3 + 3 + 1); sem nascimento, a triagem final é recusada', () => {
    const r = { ...nao, imcAbaixoDe20e5: true, estadoNutricional: 3, gravidade: 3 };
    expect(calcularNrs2002(r, 81).total).toBe(7);
    expect(() => calcularNrs2002(r, null)).toThrow(/nascimento/);
  });
});

describe('NUTRIC modificado (terapia intensiva)', () => {
  const base = {
    instrumento: 'nutric' as const,
    apache2: 10,
    sofa: 3,
    comorbidades: 0,
    diasInternadoAntesUti: 0,
  };
  it('jovem, APACHE e SOFA baixos: 0, sem risco', () => {
    expect(calcularNutric(base, 40)).toMatchObject({ total: 0, risco: 'sem-risco', versao: 'mnutric-v1' });
  });
  it('as faixas de cada variável (caso publicado: 75 anos, APACHE 28, SOFA 10, 2 comorbidades, 1 dia = 9)', () => {
    const r = calcularNutric(
      { ...base, apache2: 28, sofa: 10, comorbidades: 2, diasInternadoAntesUti: 1 },
      75,
    );
    expect(r).toMatchObject({ total: 9, risco: 'alto', parcelas: { estado: 5, gravidade: 2, idade: 2 } });
  });
  it('limiar: 5 é alto; 4 não', () => {
    // 50 anos (1) + APACHE 20 (2) + SOFA 6 (1) = 4; + 2 comorbidades = 5.
    expect(calcularNutric({ ...base, apache2: 20, sofa: 6 }, 50)).toMatchObject({
      total: 4,
      risco: 'sem-risco',
    });
    expect(calcularNutric({ ...base, apache2: 20, sofa: 6, comorbidades: 2 }, 50)).toMatchObject({
      total: 5,
      risco: 'alto',
    });
    expect(calcularNutric({ ...base, apache2: 15 }, 49).total).toBe(1);
  });
  it('sem nascimento é recusado; o despacho pelo instrumento', () => {
    expect(() => calcularNutric(base, null)).toThrow(ErroTriagem);
    expect(calcularTriagem(base, 40).instrumento).toBe('nutric');
    expect(calcularTriagem(nao, 40).instrumento).toBe('nrs2002');
    expect(JSON.parse(respostasCompactas(base))).toEqual(base);
  });
});

describe('idade, IMC e instantes', () => {
  it('idade em anos completos; sentinela e nascimento inválido viram null', () => {
    expect(idadeNoDia('1956-10-26', '2026-10-25')).toBe(69);
    expect(idadeNoDia('1956-10-25', '2026-10-25')).toBe(70);
    expect(idadeNoDia('1956-09-30', '2026-10-25')).toBe(70);
    expect(idadeNoDia('1899-12-30', '2026-10-25')).toBeNull();
    expect(idadeNoDia(null, '2026-10-25')).toBeNull();
    expect(idadeNoDia('2030-01-01', '2026-10-25')).toBeNull();
  });
  it('IMC com uma casa; sem peso ou altura, null', () => {
    expect(imc(70, 175)).toBe(22.9);
    expect(imc(null, 175)).toBeNull();
    expect(imc(70, 0)).toBeNull();
  });
  it('minutos, horas e dias entre instantes locais; instante inválido é recusado', () => {
    expect(minutosEntre('2026-10-24T10:00', '2026-10-25T10:30')).toBe(1470);
    expect(horasDesdeAdmissao('2026-10-26T10:00', '2026-10-25T10:00')).toBe(0);
    expect(somarHoras('2026-10-24T23:00', 2)).toBe('2026-10-25T01:00');
    expect(somarDias('2026-10-25', 7)).toBe('2026-11-01');
    expect(() => minutosEntre('x', '2026-10-25T10:00')).toThrow(ErroTriagem);
  });
});

describe('prazo e fila (regra 10: em até 48 h, de preferência 24 h; vencida em vermelho)', () => {
  const p = PRAZOS_TRIAGEM_PADRAO;
  const agora = '2026-10-25T12:00';
  it('sem triagem: a triar até 24 h, atenção até 48 h, vencida depois', () => {
    expect(situacaoTriagem({ admissao: '2026-10-25T00:00', agora, ultima: null, prazos: p })).toBe('a-triar');
    expect(situacaoTriagem({ admissao: '2026-10-24T12:00', agora, ultima: null, prazos: p })).toBe('a-triar');
    expect(situacaoTriagem({ admissao: '2026-10-24T11:00', agora, ultima: null, prazos: p })).toBe('atencao');
    expect(situacaoTriagem({ admissao: '2026-10-23T12:00', agora, ultima: null, prazos: p })).toBe('atencao');
    expect(situacaoTriagem({ admissao: '2026-10-23T11:59', agora, ultima: null, prazos: p })).toBe('vencida');
  });
  it('triado sem risco reavalia na data; com risco, segue triado', () => {
    expect(reavaliarEm('sem-risco', '2026-10-18', p)).toBe('2026-10-25');
    expect(reavaliarEm('risco', '2026-10-18', p)).toBeNull();
    expect(
      situacaoTriagem({
        admissao: '2026-10-01T00:00',
        agora,
        ultima: { risco: 'sem-risco', reavaliarEm: '2026-10-25' },
        prazos: p,
      }),
    ).toBe('reavaliar');
    expect(
      situacaoTriagem({
        admissao: '2026-10-01T00:00',
        agora,
        ultima: { risco: 'sem-risco', reavaliarEm: '2026-10-26' },
        prazos: p,
      }),
    ).toBe('triado');
    expect(
      situacaoTriagem({
        admissao: '2026-10-01T00:00',
        agora,
        ultima: { risco: 'risco', reavaliarEm: null },
        prazos: p,
      }),
    ).toBe('triado');
  });
  it('a ordem: vencidas, atenção, a triar, reavaliar, triados; empate pela admissão mais antiga', () => {
    const fila = ordenarFilaTriagem([
      { id: 1, situacao: 'triado' as const, admissao: '2026-10-01T00:00' },
      { id: 2, situacao: 'a-triar' as const, admissao: '2026-10-25T08:00' },
      { id: 3, situacao: 'vencida' as const, admissao: '2026-10-22T00:00' },
      { id: 4, situacao: 'a-triar' as const, admissao: '2026-10-25T01:00' },
      { id: 5, situacao: 'atencao' as const, admissao: '2026-10-24T01:00' },
      { id: 6, situacao: 'reavaliar' as const, admissao: '2026-10-10T00:00' },
    ]);
    expect(fila.map((x) => x.id)).toEqual([3, 5, 4, 2, 6, 1]);
  });
  it('indicadores com as parcelas: triados em 24 h e em 48 h dos admitidos', () => {
    expect(
      indicadoresTriagem(
        [
          { admissao: '2026-10-20T08:00', primeiraTriagemEm: '2026-10-20T20:00' },
          { admissao: '2026-10-20T08:00', primeiraTriagemEm: '2026-10-21T20:00' },
          { admissao: '2026-10-20T08:00', primeiraTriagemEm: '2026-10-23T08:00' },
          { admissao: '2026-10-20T08:00', primeiraTriagemEm: null },
        ],
        p,
      ),
    ).toEqual({ admitidos: 4, triados24h: 1, triados48h: 2 });
  });
});
