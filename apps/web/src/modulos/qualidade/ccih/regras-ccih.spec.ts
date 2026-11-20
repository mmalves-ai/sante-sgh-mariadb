// Regras de tela da CCIH (M48, etapa 3): competência, contas com as parcelas (regra 5), critérios por sítio, montagem
// das entradas de IRAS, precaução e observação das mãos, filtro da vigilância e números digitados. Dados SINTÉTICOS.
import { CODIGOS_CRITERIO_IRAS, CODIGOS_SITIO_IRAS } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  adesaoDaSessao,
  classeDaSituacao,
  competenciaAnterior,
  competenciaDe,
  competenciasRecentes,
  contaDaParcela,
  criteriosDoSitio,
  dispositivoDoSitio,
  filtrarVigilancia,
  formularioIrasVazio,
  instanteLocal,
  inteiroPositivo,
  montarIras,
  montarObservacao,
  montarPrecaucao,
  numeroDecimal,
  rotuloCompetencia,
  setoresDe,
  sugestaoDaPrecaucao,
  valorDaParcela,
} from './regras-ccih.js';

describe('competência', () => {
  it('do instante, anterior (virada do ano) e as recentes', () => {
    expect(competenciaDe('2026-10-22T13:00:00')).toBe('2026-10');
    expect(competenciaAnterior('2026-01')).toBe('2025-12');
    expect(competenciaAnterior('2026-10')).toBe('2026-09');
    expect(competenciasRecentes('2026-02-01T00:00:00', 4)).toEqual([
      '2026-02',
      '2026-01',
      '2025-12',
      '2025-11',
    ]);
    expect(rotuloCompetencia('2026-10')).toBe('10/2026');
  });
});

describe('parcelas impressas (regra 5)', () => {
  it('densidade por 1.000 com a conta', () => {
    const p = { numerador: 3, denominador: 1250, valor: 2.4, fator: 1000 as const };
    expect(valorDaParcela(p)).toBe('2,40');
    expect(contaDaParcela(p)).toBe('3 ÷ 1.250 × 1.000 = 2,40');
  });
  it('taxa por 100 com o sinal de porcentagem; DDD fracionária com duas casas', () => {
    expect(valorDaParcela({ numerador: 17, denominador: 20, valor: 85, fator: 100 })).toBe('85,0 %');
    expect(contaDaParcela({ numerador: 12.5, denominador: 100, valor: 125, fator: 1000 })).toBe(
      '12,50 ÷ 100 × 1.000 = 125,00',
    );
  });
  it('por 1 sem fator; sem denominador não inventa valor', () => {
    expect(contaDaParcela({ numerador: 4000, denominador: 200, valor: 20, fator: 1 })).toBe(
      '4.000 ÷ 200 = 20,00',
    );
    const zero = { numerador: 0, denominador: 0, valor: null, fator: 1000 as const };
    expect(valorDaParcela(zero)).toBe('-');
    expect(contaDaParcela(zero)).toBe('0 ÷ 0 × 1.000 (sem denominador)');
  });
});

describe('critérios por sítio', () => {
  it('todo sítio tem critérios do catálogo; a IPCS inclui a alternativa do comensal', () => {
    for (const s of CODIGOS_SITIO_IRAS) {
      const c = criteriosDoSitio(s);
      expect(c.length).toBeGreaterThan(0);
      for (const x of c) expect(CODIGOS_CRITERIO_IRAS).toContain(x);
    }
    expect(criteriosDoSitio('ipcs')).toEqual(
      expect.arrayContaining(['hemoculturaPatogeno', 'comensalDuasAmostras', 'febre']),
    );
    expect(criteriosDoSitio('itu')).not.toContain('imagemPulmonar');
  });
  it('o dispositivo de cada sítio', () => {
    expect(dispositivoDoSitio('ipcs')).toBe('cvc');
    expect(dispositivoDoSitio('pav')).toBe('ventilacaoMecanica');
    expect(dispositivoDoSitio('isc')).toBeNull();
  });
});

describe('montarIras', () => {
  const base = () => ({ ...formularioIrasVazio(4801), dataInfeccao: '2026-10-20' });
  it('pede sítio e data; critérios que não fecham são recusados como no servidor', () => {
    expect(montarIras(formularioIrasVazio(4801)).problema).toBe('sitio');
    expect(montarIras({ ...formularioIrasVazio(4801), sitio: 'ipcs' }).problema).toBe('data');
    expect(montarIras({ ...base(), sitio: 'ipcs', criterios: ['febre'] }).problema).toBe(
      'criterios-insuficientes',
    );
  });
  it('IPCS com hemocultura: entrada limpa (sem campos da ISC; critério de outro sítio descartado)', () => {
    const r = montarIras({
      ...base(),
      sitio: 'ipcs',
      criterios: ['hemoculturaPatogeno', 'imagemPulmonar'],
      nivelIsc: 'superficial',
      cirurgia: 9,
      implante: true,
      microrganismo: '  ',
    });
    expect(r.problema).toBeNull();
    expect(r.entrada).toEqual({
      internacao: 4801,
      sitio: 'ipcs',
      dataInfeccao: '2026-10-20',
      criterios: ['hemoculturaPatogeno'],
      nivelIsc: null,
      cirurgia: null,
      implante: false,
      exame: null,
      microrganismo: null,
      multirresistente: false,
      descricao: null,
    });
  });
  it('ISC exige a cirurgia e a profundidade; multirresistente exige o germe; outra exige descrição', () => {
    const isc = { ...base(), sitio: 'isc' as const, criterios: ['drenagemPurulenta' as const] };
    expect(montarIras(isc).problema).toBe('cirurgia');
    expect(montarIras({ ...isc, cirurgia: 77 }).problema).toBe('nivelIsc');
    expect(montarIras({ ...isc, cirurgia: 77, nivelIsc: 'profunda', implante: true }).entrada).toMatchObject({
      cirurgia: 77,
      nivelIsc: 'profunda',
      implante: true,
    });
    expect(montarIras({ ...isc, cirurgia: 77, nivelIsc: 'profunda', multirresistente: true }).problema).toBe(
      'microrganismo',
    );
    const outra = { ...base(), sitio: 'outra' as const, criterios: ['diagnosticoMedico' as const] };
    expect(montarIras({ ...outra, descricao: 'curta' }).problema).toBe('descricao');
    expect(montarIras({ ...outra, descricao: 'Infecção de pele sintética' }).problema).toBeNull();
  });
});

describe('precaução', () => {
  const f = {
    internacao: 4801,
    motivo: '' as const,
    motivoOutro: '',
    tipo: '' as const,
    origem: 'manual' as const,
    exame: null,
    bloquearVizinhos: false,
    observacao: '',
  };
  it('o motivo sugere o tipo e o bloqueio', () => {
    expect(sugestaoDaPrecaucao('tuberculose', '', 2)).toEqual({ tipo: 'aerossois', bloqueio: 'exigido' });
    expect(sugestaoDaPrecaucao('kpc', '', 1)).toEqual({ tipo: 'contato', bloqueio: 'sugerido' });
    expect(sugestaoDaPrecaucao('clostridioides', '', 1).bloqueio).toBe('naoSeAplica');
    expect(sugestaoDaPrecaucao('tuberculose', '', 0).bloqueio).toBe('naoSeAplica');
  });
  it('aerossóis em quarto compartilhado sem bloqueio é recusado; microbiologia exige a cultura', () => {
    expect(montarPrecaucao(f, 1).problema).toBe('motivo');
    expect(montarPrecaucao({ ...f, motivo: 'outro', tipo: 'contato' }, 0).problema).toBe('motivoOutro');
    expect(montarPrecaucao({ ...f, motivo: 'tuberculose' }, 0).problema).toBe('tipo');
    expect(montarPrecaucao({ ...f, motivo: 'tuberculose', tipo: 'aerossois' }, 1).problema).toBe(
      'bloqueio-vizinho-exigido',
    );
    expect(
      montarPrecaucao({ ...f, motivo: 'kpc', tipo: 'contato', origem: 'microbiologia' }, 0).problema,
    ).toBe('exame');
    const ok = montarPrecaucao(
      { ...f, motivo: 'kpc', tipo: 'contato', origem: 'microbiologia', exame: 123, motivoOutro: 'x' },
      0,
    );
    expect(ok.entrada).toEqual({
      internacao: 4801,
      motivo: 'kpc',
      motivoOutro: null,
      tipo: 'contato',
      origem: 'microbiologia',
      exame: 123,
      bloquearVizinhos: false,
      observacao: null,
    });
  });
});

describe('observação das mãos', () => {
  const ops = [
    { momento: 'antesContato' as const, acao: 'friccao' as const, luvas: false },
    { momento: 'aposContato' as const, acao: 'naoRealizada' as const, luvas: true },
  ];
  it('a adesão parcial da sessão', () => {
    expect(adesaoDaSessao(ops)).toEqual({ conformes: 1, total: 2 });
  });
  it('sem unidade, instante, categoria ou oportunidade não monta', () => {
    const e = {
      unidade: 1,
      setor: '',
      observadoEm: '2026-10-22T10:00',
      categoria: 'medico',
      oportunidades: ops,
      observacao: '',
    };
    expect(montarObservacao({ ...e, unidade: null })).toBeNull();
    expect(montarObservacao({ ...e, observadoEm: null })).toBeNull();
    expect(montarObservacao({ ...e, categoria: '' })).toBeNull();
    expect(montarObservacao({ ...e, oportunidades: [] })).toBeNull();
    expect(montarObservacao(e)).toEqual({
      unidade: 1,
      setor: null,
      observadoEm: '2026-10-22T10:00',
      categoria: 'medico',
      oportunidades: ops,
      observacao: null,
    });
  });
});

describe('vigilância e utilidades', () => {
  const itens = [
    { setor: 'UTI', motivos: ['febre', 'dispositivo'], nome: 'PACIENTE SINTETICO A', prontuario: 11 },
    { setor: 'CM', motivos: ['posOperatorio'], nome: 'PACIENTE SINTETICO B', prontuario: 22 },
  ];
  it('filtra por setor, motivo e nome ou prontuário, mantendo a ordem', () => {
    expect(filtrarVigilancia(itens, { setor: '', motivo: '', busca: '' })).toHaveLength(2);
    expect(filtrarVigilancia(itens, { setor: 'CM', motivo: '', busca: '' })).toEqual([itens[1]]);
    expect(filtrarVigilancia(itens, { setor: '', motivo: 'febre', busca: '' })).toEqual([itens[0]]);
    expect(filtrarVigilancia(itens, { setor: '', motivo: '', busca: 'sintetico b' })).toEqual([itens[1]]);
    expect(filtrarVigilancia(itens, { setor: '', motivo: '', busca: '11' })).toEqual([itens[0]]);
    expect(setoresDe(itens)).toEqual(['CM', 'UTI']);
  });
  it('classe da situação, instante e números digitados', () => {
    expect(classeDaSituacao('vencida')).toContain('grave');
    expect(classeDaSituacao('aguardando')).toContain('atencao');
    expect(classeDaSituacao('naoLiberado')).toContain('neutro');
    expect(classeDaSituacao('liberado')).toContain('ok');
    expect(instanteLocal('2026-10-22', '08:30')).toBe('2026-10-22T08:30');
    expect(instanteLocal('2026-10-22', '0830')).toBe('2026-10-22T08:30');
    expect(instanteLocal('2026-10-22', null)).toBeNull();
    expect(instanteLocal('22/10/2026', '08:30')).toBeNull();
    expect(numeroDecimal('')).toBeNull();
    expect(numeroDecimal('1,5')).toBe(1.5);
    expect(numeroDecimal('2')).toBe(2);
    expect(numeroDecimal('0')).toBeUndefined();
    expect(numeroDecimal('abc')).toBeUndefined();
    expect(inteiroPositivo('120', 1000)).toBe(120);
    expect(inteiroPositivo('1,5', 1000)).toBeNull();
    expect(inteiroPositivo('5000', 1000)).toBeNull();
  });
});
