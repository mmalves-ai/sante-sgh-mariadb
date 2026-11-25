import { describe, expect, it } from 'vitest';
import {
  dataCivilValida,
  errosCooperado,
  errosCooperativa,
  errosEncerramento,
  errosEquipe,
  errosFimEquipe,
  errosMembroEquipe,
  normalizarCodigoEquipe,
  vigenciaDentro,
  vigenciasSobrepostas,
  vinculoVigenteEm,
} from './equipe.js';

const V = (inicio: string, fim: string | null = null) => ({ inicio, fim });
// CNPJ sintético com dígitos válidos (gerado para teste; não pertence a ninguém).
const CNPJ = '11222333000181';

describe('equipe do profissional', () => {
  it('normaliza o código e valida o cadastro da equipe', () => {
    expect(normalizarCodigoEquipe('  eq  cardio ')).toBe('EQ-CARDIO');
    expect(
      errosEquipe({ codigo: 'EQ1', nome: 'Equipe Cardio', tipo: 'medica', vigencia: V('2026-01-01') }),
    ).toEqual([]);
    expect(
      errosEquipe({ codigo: ' ', nome: 'Eq', tipo: 'x', vigencia: V('2026-02-30', '2025-01-01') }),
    ).toEqual(['codigo-ausente', 'nome-curto', 'tipo-invalido', 'inicio-invalido']);
    expect(
      errosEquipe({
        codigo: 'A'.repeat(31),
        nome: 'Equipe',
        tipo: 'cirurgica',
        vigencia: V('2026-03-01', '2026-02-01'),
      }),
    ).toEqual(['codigo-longo', 'fim-antes-do-inicio']);
  });

  it('vigência: data civil, em vigor, sobreposição e contenção', () => {
    expect(dataCivilValida('2026-02-29')).toBe(false);
    expect(dataCivilValida('2028-02-29')).toBe(true);
    expect(vinculoVigenteEm(V('2026-01-01', '2026-01-31'), '2026-01-31')).toBe(true);
    expect(vinculoVigenteEm(V('2026-01-01', '2026-01-31'), '2026-02-01')).toBe(false);
    expect(vigenciasSobrepostas(V('2026-01-01', '2026-01-31'), V('2026-01-31'))).toBe(true);
    expect(vigenciasSobrepostas(V('2026-01-01', '2026-01-30'), V('2026-01-31'))).toBe(false);
    expect(vigenciaDentro(V('2026-02-01'), V('2026-01-01', '2026-12-31'))).toBe(false);
    expect(vigenciaDentro(V('2026-02-01', '2026-03-01'), V('2026-01-01', '2026-12-31'))).toBe(true);
  });

  it('membro: papel, vigência dentro da equipe, sem sobreposição e um responsável por vez', () => {
    const equipe = V('2026-01-01');
    const existentes = [
      { id: 1, profissionalId: 10, papel: 'responsavel', ...V('2026-01-01') },
      { id: 2, profissionalId: 11, papel: 'membro', ...V('2026-01-01', '2026-03-31') },
    ];
    expect(
      errosMembroEquipe(
        { profissionalId: 12, papel: 'auxiliar', vigencia: V('2026-02-01') },
        equipe,
        existentes,
      ),
    ).toEqual([]);
    expect(
      errosMembroEquipe(
        { profissionalId: 11, papel: 'membro', vigencia: V('2026-04-01') },
        equipe,
        existentes,
      ),
    ).toEqual([]);
    expect(
      errosMembroEquipe(
        { profissionalId: 11, papel: 'membro', vigencia: V('2026-03-31') },
        equipe,
        existentes,
      ),
    ).toEqual(['vigencia-sobreposta']);
    expect(
      errosMembroEquipe(
        { profissionalId: 12, papel: 'responsavel', vigencia: V('2026-02-01') },
        equipe,
        existentes,
      ),
    ).toEqual(['responsavel-duplicado']);
    expect(
      errosMembroEquipe(
        { profissionalId: 12, papel: 'chefe', vigencia: V('2025-12-01') },
        equipe,
        existentes,
      ),
    ).toEqual(['papel-invalido', 'fora-da-vigencia-equipe']);
    expect(errosMembroEquipe({ profissionalId: 12, papel: 'membro', vigencia: V('x') }, equipe, [])).toEqual([
      'inicio-invalido',
    ]);
  });

  it('encerramento só antecipa; fim da equipe exige membros encerrados até ele', () => {
    expect(errosEncerramento(V('2026-01-01'), '2026-06-30')).toEqual([]);
    expect(errosEncerramento(V('2026-01-01'), '2025-12-31')).toEqual(['fim-antes-do-inicio']);
    expect(errosEncerramento(V('2026-01-01', '2026-06-30'), '2026-07-01')).toEqual([
      'encerramento-nao-antecipa',
    ]);
    expect(errosEncerramento(V('2026-01-01', '2026-06-30'), '2026-05-31')).toEqual([]);
    expect(errosEncerramento(V('2026-01-01'), '31/12/2026')).toEqual(['fim-invalido']);
    expect(errosFimEquipe(V('2026-01-01', '2026-06-30'), [V('2026-01-01')])).toEqual([
      'membros-apos-fim-equipe',
    ]);
    expect(errosFimEquipe(V('2026-01-01', '2026-06-30'), [V('2026-01-01', '2026-06-30')])).toEqual([]);
    expect(errosFimEquipe(V('2026-01-01'), [V('2026-01-01')])).toEqual([]);
  });
});

describe('cooperativa médica', () => {
  const base = {
    cnpj: '11.222.333/0001-81',
    razaoSocial: 'Cooperativa Sintetica de Anestesia',
    nome: 'Coop Sintetica',
    percentualRepasse: 80,
    bancoId: null,
    agencia: null,
    conta: null,
    tipoConta: null,
    retemIr: true,
    aliquotas: { ir: 1.5, iss: 5 },
  };
  it('aceita o cadastro completo e o CNPJ com máscara', () => {
    expect(errosCooperativa(base)).toEqual([]);
    expect(
      errosCooperativa({
        ...base,
        cnpj: CNPJ,
        bancoId: 1,
        agencia: '0001',
        conta: '12345',
        tipoConta: 'corrente',
      }),
    ).toEqual([]);
  });
  it('recusa CNPJ, nomes, percentuais, conta pela metade, tipo de conta e IR sem retenção', () => {
    expect(
      errosCooperativa({
        ...base,
        cnpj: '11222333000182',
        razaoSocial: 'C',
        nome: 'C',
        percentualRepasse: 120,
        bancoId: 1,
        tipoConta: 'salario',
        retemIr: false,
      }),
    ).toEqual([
      'cnpj-invalido',
      'razao-curta',
      'nome-curto',
      'percentual-invalido',
      'conta-incompleta',
      'tipo-conta-invalido',
      'ir-sem-retencao',
    ]);
  });
  it('cooperado: sem sobreposição na mesma cooperativa', () => {
    const ex = [{ id: 1, profissionalId: 10, ...V('2026-01-01', '2026-06-30') }];
    expect(errosCooperado({ profissionalId: 10, vigencia: V('2026-07-01') }, ex)).toEqual([]);
    expect(errosCooperado({ profissionalId: 10, vigencia: V('2026-06-01') }, ex)).toEqual([
      'vigencia-sobreposta',
    ]);
    expect(errosCooperado({ profissionalId: 11, vigencia: V('2026-06-01') }, ex)).toEqual([]);
    expect(errosCooperado({ profissionalId: 11, vigencia: V('2026-06-01', '2026-05-01') }, ex)).toEqual([
      'fim-antes-do-inicio',
    ]);
  });
});
