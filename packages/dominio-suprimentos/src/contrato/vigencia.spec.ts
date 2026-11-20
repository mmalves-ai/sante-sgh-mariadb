// Regra 5 da ficha do M55 (etapa 3): a vigência pelo fim vigente (aditivo de prazo e renovação), a faixa do alerta em
// 90, 60 e 30 dias, o alerta uma vez por faixa, o reajuste por índice e data-base (um ano entre reajustes) e as
// conferências do aditivo, da renovação e do encerramento.
import { describe, expect, it } from 'vitest';
import { esquemaCriarContrato, esquemaRegistrarEventoContrato } from '@sgh/contratos';
import {
  alertaDeVencimento,
  calcularReajuste,
  conferirEventoContrato,
  diasEntre,
  faixaVigencia,
  fimVigente,
  proximoReajuste,
  somarMeses,
} from '../index.js';

const ev = (id: number, tipo: 'aditivo' | 'renovacao' | 'ocorrencia', novoFim: string | null) => ({
  id,
  tipo,
  data: null,
  valor: 0,
  novoFim,
  criadoEm: '2026-01-01T00:00:00',
  usuario: 'COMPRAS',
});

describe('datas', () => {
  it('dias entre datas e meses somados com o último dia do mês', () => {
    expect(diasEntre('2026-01-01', '2026-01-31')).toBe(30);
    expect(diasEntre('2026-02-01', '2026-01-01')).toBe(-31);
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(somarMeses('2028-01-31', 1)).toBe('2028-02-29');
    expect(somarMeses('2026-11-15', 2)).toBe('2027-01-15');
  });
});

describe('fim vigente', () => {
  it('o do último aditivo de prazo ou renovação; a ocorrência não muda', () => {
    expect(fimVigente('2026-12-31', [])).toBe('2026-12-31');
    expect(
      fimVigente('2026-12-31', [
        ev(3, 'renovacao', '2028-12-31'),
        ev(2, 'aditivo', '2027-06-30'),
        ev(4, 'ocorrencia', null),
      ]),
    ).toBe('2028-12-31');
    expect(fimVigente('2026-12-31', [ev(1, 'aditivo', null)])).toBe('2026-12-31');
  });
});

describe('faixa de vigência (alertas de 90, 60 e 30 dias)', () => {
  const c = { situacao: 'ativo' as const, inicio: '2026-01-01', fim: '2026-12-31' };
  it.each([
    ['2025-12-01', 'a-iniciar'],
    ['2026-06-01', 'vigente'],
    ['2026-10-02', 'vence-90'],
    ['2026-11-01', 'vence-60'],
    ['2026-12-01', 'vence-30'],
    ['2026-12-31', 'vence-30'],
    ['2027-01-01', 'vencido'],
  ])('em %s: %s', (hoje, faixa) => {
    expect(faixaVigencia({ ...c, hoje }).faixa).toBe(faixa);
  });
  it('os dias para vencer e o encerrado sem dias', () => {
    expect(faixaVigencia({ ...c, hoje: '2026-12-01' }).diasParaVencer).toBe(30);
    expect(faixaVigencia({ ...c, situacao: 'encerrado', hoje: '2026-06-01' })).toEqual({
      faixa: 'encerrado',
      diasParaVencer: null,
    });
  });
  it('o alerta uma vez por faixa; nada no vigente', () => {
    expect(alertaDeVencimento({ ...c, hoje: '2026-06-01', faixaJaAvisada: null })).toBeNull();
    expect(alertaDeVencimento({ ...c, hoje: '2026-10-02', faixaJaAvisada: null })).toBe('vence-90');
    expect(alertaDeVencimento({ ...c, hoje: '2026-10-03', faixaJaAvisada: 'vence-90' })).toBeNull();
    expect(alertaDeVencimento({ ...c, hoje: '2026-11-02', faixaJaAvisada: 'vence-90' })).toBe('vence-60');
    expect(alertaDeVencimento({ ...c, hoje: '2027-01-02', faixaJaAvisada: 'vence-30' })).toBe('vencido');
  });
});

describe('reajuste por índice e data-base', () => {
  const r = { indice: 'ipca' as const, dataBase: '2026-03-01', ultimoReajuste: null, valorVigente: 120_000 };
  it('o próximo reajuste: um ano da data-base ou do último; sem índice, nenhum', () => {
    expect(proximoReajuste(r)).toBe('2027-03-01');
    expect(proximoReajuste({ ...r, ultimoReajuste: '2027-03-01' })).toBe('2028-03-01');
    expect(proximoReajuste({ ...r, indice: 'nenhum' })).toBeNull();
    expect(proximoReajuste({ ...r, dataBase: null })).toBeNull();
  });
  it('o valor do reajuste sobre o vigente, com a conta impressa', () => {
    const x = calcularReajuste({ ...r, data: '2027-03-01', percentual: 4.62 });
    expect(x).toEqual({ valor: 5544, conta: '120.000,00 × 4.62% = 5.544,00' });
  });
  it('recusa antes de um ano e sem índice', () => {
    expect(calcularReajuste({ ...r, data: '2027-02-28', percentual: 4 })).toMatchObject({
      codigo: 'reajuste-antes-do-prazo',
    });
    expect(calcularReajuste({ ...r, indice: 'nenhum', data: '2027-03-01', percentual: 4 })).toMatchObject({
      codigo: 'sem-indice',
    });
  });
});

describe('conferência dos eventos', () => {
  const base = {
    situacao: 'ativo' as const,
    inicio: '2026-01-01',
    fim: '2026-12-31',
    novoFim: null,
    valor: null,
    saldo: 1000,
    data: null,
    hoje: '2026-06-01',
  };
  it('aceita o aditivo de prazo para depois do fim e a supressão até o saldo', () => {
    expect(conferirEventoContrato({ ...base, tipo: 'aditivo', novoFim: '2027-06-30' })).toBeNull();
    expect(conferirEventoContrato({ ...base, tipo: 'aditivo', valor: -1000 })).toBeNull();
  });
  it('recusa prazo que não aumenta, supressão acima do saldo, encerrado e datas fora', () => {
    expect(conferirEventoContrato({ ...base, tipo: 'renovacao', novoFim: '2026-12-31' })?.codigo).toBe(
      'prazo-nao-aumenta',
    );
    expect(conferirEventoContrato({ ...base, tipo: 'aditivo', valor: -1000.01 })?.codigo).toBe(
      'supressao-acima-do-saldo',
    );
    expect(
      conferirEventoContrato({ ...base, situacao: 'encerrado', tipo: 'aditivo', valor: 10 })?.codigo,
    ).toBe('contrato-encerrado');
    expect(
      conferirEventoContrato({ ...base, situacao: 'rescindido', tipo: 'ocorrencia', data: '2026-05-01' }),
    ).toBeNull();
    expect(conferirEventoContrato({ ...base, tipo: 'encerramento', data: '2025-12-31' })?.codigo).toBe(
      'data-antes-do-inicio',
    );
    expect(conferirEventoContrato({ ...base, tipo: 'ocorrencia', data: '2026-06-02' })?.codigo).toBe(
      'data-futura',
    );
  });
});

describe('entradas (Zod)', () => {
  const contrato = {
    chave: 'contrato-0001',
    numero: ' 12/2026 ',
    fornecedor: 10,
    tipo: 'servico',
    objeto: 'Manutenção dos  equipamentos de imagem',
    inicio: '2026-01-01',
    fim: '2026-12-31',
    valor: 120000,
    gestor: 'COMPRAS',
    fiscal: 'FISCAL1',
  };
  it('normaliza e aplica os padrões', () => {
    const c = esquemaCriarContrato.parse(contrato);
    expect(c.numero).toBe('12/2026');
    expect(c.objeto).toBe('Manutenção dos equipamentos de imagem');
    expect(c).toMatchObject({
      critico: false,
      indiceReajuste: 'nenhum',
      garantia: 'nenhuma',
      observacao: null,
    });
  });
  it.each([
    [{ fim: '2025-12-31' }, 'fim'],
    [{ fiscal: 'compras' }, 'fiscal'],
    [{ indiceReajuste: 'ipca' }, 'dataBase'],
    [{ garantia: 'caucao' }, 'garantiaValor'],
    [{ valor: 0 }, 'valor'],
  ])('recusa %o', (mudanca, campo) => {
    const r = esquemaCriarContrato.safeParse({ ...contrato, ...mudanca });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path[0])).toContain(campo);
  });
  it('o aditivo muda valor ou prazo; a exceção exige a justificativa', () => {
    const a = {
      chave: 'evento-0001',
      versao: 1,
      tipo: 'aditivo',
      numeroTermo: '1',
      descricao: 'Primeiro termo aditivo',
    };
    expect(esquemaRegistrarEventoContrato.safeParse(a).success).toBe(false);
    expect(esquemaRegistrarEventoContrato.safeParse({ ...a, valor: 1000 }).success).toBe(true);
    expect(
      esquemaRegistrarEventoContrato.safeParse({
        chave: 'evento-0002',
        versao: 1,
        tipo: 'excecao',
        descricao: 'curta',
      }).success,
    ).toBe(false);
  });
});
