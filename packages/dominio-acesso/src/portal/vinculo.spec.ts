// Responsável legal no portal (M50 etapa 1, regra 5): pedido, prova, validade, maioridade, decisão e escopo. Sintético.
import { describe, expect, it } from 'vitest';
import {
  conferirDecisaoVinculo,
  conferirPedidoVinculo,
  escoposAprovados,
  mensagemVinculo,
  type PedidoVinculoRegra,
  type RecusaVinculo,
  podeAgir,
  terminoDoVinculo,
  titularesDaSessao,
  titularPodeRevogar,
  type TitularParaVinculo,
  type VinculoRegra,
  vigenciaDoVinculo,
} from './vinculo.js';

const dia = '2026-10-24';
const menor: TitularParaVinculo = { nascimento: '2015-03-10', obito: false, ativo: true };
const maior: TitularParaVinculo = { nascimento: '1950-03-10', obito: false, ativo: true };
const pai: PedidoVinculoRegra = {
  tipo: 'pai-mae',
  prova: 'certidao-nascimento',
  validade: null,
  paraSiMesmo: false,
  jaExiste: false,
};

describe('pedido de vínculo', () => {
  it('pai ou mãe de menor com certidão: aceito para conferência', () => {
    expect(conferirPedidoVinculo(pai, menor, dia, 18, 365)).toBeNull();
    expect(
      conferirPedidoVinculo({ ...pai, prova: 'documento-com-filiacao' }, menor, dia, 18, 365),
    ).toBeNull();
  });
  it('recusas', () => {
    const casos: [PedidoVinculoRegra, TitularParaVinculo, RecusaVinculo][] = [
      [{ ...pai, paraSiMesmo: true }, menor, 'para-si-mesmo'],
      [{ ...pai, jaExiste: true }, menor, 'repetido'],
      [pai, { ...menor, ativo: false }, 'titular-inativo'],
      [pai, { ...menor, obito: true }, 'obito'],
      [pai, { ...menor, nascimento: null }, 'sem-nascimento'],
      [pai, maior, 'titular-maior'],
      [{ ...pai, tipo: 'curador', prova: 'termo-curatela' }, menor, 'titular-menor'],
      [{ ...pai, prova: 'procuracao' }, menor, 'prova-nao-aceita'],
      [{ ...pai, tipo: 'procurador', prova: 'procuracao' }, maior, 'validade-obrigatoria'],
      [
        { ...pai, tipo: 'procurador', prova: 'procuracao', validade: '2026-10-23' },
        maior,
        'validade-vencida',
      ],
      [{ ...pai, tipo: 'procurador', prova: 'procuracao', validade: '2028-01-01' }, maior, 'validade-longa'],
    ];
    for (const [p, t, r] of casos) {
      expect(conferirPedidoVinculo(p, t, dia, 18, 365)).toBe(r);
      expect(mensagemVinculo(r).length).toBeGreaterThan(10);
      expect(mensagemVinculo(r)).not.toMatch(/spdata|legado/i);
    }
  });
  it('curador de maior com termo; procurador com validade dentro do prazo; tutor com validade opcional', () => {
    expect(
      conferirPedidoVinculo({ ...pai, tipo: 'curador', prova: 'termo-curatela' }, maior, dia, 18, 365),
    ).toBeNull();
    expect(
      conferirPedidoVinculo(
        { ...pai, tipo: 'procurador', prova: 'procuracao', validade: '2027-06-30' },
        maior,
        dia,
        18,
        365,
      ),
    ).toBeNull();
    expect(
      conferirPedidoVinculo(
        { ...pai, tipo: 'tutor', prova: 'termo-tutela', validade: '2030-01-01' },
        menor,
        dia,
        18,
        365,
      ),
    ).toBeNull();
    expect(
      conferirPedidoVinculo(
        { ...pai, tipo: 'guardiao', prova: 'termo-guarda', validade: '2026-01-01' },
        menor,
        dia,
        18,
        365,
      ),
    ).toBe('validade-vencida');
  });
});

describe('término e vigência', () => {
  const ativo: VinculoRegra = { tipo: 'pai-mae', situacao: 'ativo', validade: null, escopos: ['documentos'] };
  it('pai ou mãe: acaba na maioridade; procurador: no dia seguinte à validade; o mais cedo dos dois', () => {
    expect(terminoDoVinculo(ativo, '2015-03-10', 18)).toBe('2033-03-10');
    expect(terminoDoVinculo({ tipo: 'procurador', validade: '2027-06-30' }, '1950-03-10', 18)).toBe(
      '2027-07-01',
    );
    expect(terminoDoVinculo({ tipo: 'tutor', validade: '2030-01-01' }, '2015-03-10', 18)).toBe('2030-01-02');
    expect(terminoDoVinculo({ tipo: 'tutor', validade: '2040-01-01' }, '2015-03-10', 18)).toBe('2033-03-10');
    expect(terminoDoVinculo({ tipo: 'curador', validade: null }, '1950-03-10', 18)).toBeNull();
    expect(terminoDoVinculo(ativo, null, 18)).toBeNull();
  });
  it('vigência: maioridade, validade, óbito e situação', () => {
    expect(vigenciaDoVinculo(ativo, menor, dia, 18)).toEqual({ vigente: true });
    expect(vigenciaDoVinculo(ativo, menor, '2033-03-10', 18)).toEqual({
      vigente: false,
      motivo: 'maioridade',
    });
    expect(vigenciaDoVinculo(ativo, { ...menor, obito: true }, dia, 18)).toEqual({
      vigente: false,
      motivo: 'obito-do-titular',
    });
    expect(vigenciaDoVinculo({ ...ativo, situacao: 'pendente' }, menor, dia, 18)).toEqual({
      vigente: false,
      motivo: null,
    });
    const proc: VinculoRegra = { tipo: 'procurador', situacao: 'ativo', validade: '2026-10-23', escopos: [] };
    expect(vigenciaDoVinculo(proc, maior, dia, 18)).toEqual({ vigente: false, motivo: 'validade' });
    expect(vigenciaDoVinculo({ ...proc, validade: '2026-10-24' }, maior, dia, 18)).toEqual({ vigente: true });
    // Tutor com validade antes da maioridade: acaba pela validade.
    expect(vigenciaDoVinculo({ ...ativo, tipo: 'tutor', validade: '2026-01-01' }, menor, dia, 18)).toEqual({
      vigente: false,
      motivo: 'validade',
    });
  });
});

describe('decisão e escopo', () => {
  it('escopo limitado ao padrão do vínculo; procurador recebe o que a procuração diz', () => {
    expect(escoposAprovados('pai-mae', ['pedidos', 'documentos', 'documentos'])).toEqual([
      'documentos',
      'pedidos',
    ]);
    expect(escoposAprovados('procurador', ['documentos'])).toEqual(['documentos']);
  });
  it('quem pediu não decide; procurador sem escopo não é aprovado; decisão única', () => {
    const p = { situacao: 'pendente' as const, tipo: 'procurador' as const };
    expect(conferirDecisaoVinculo(p, { aprovar: true, escopos: [] }, false)).toBe('procurador-sem-escopo');
    expect(conferirDecisaoVinculo(p, { aprovar: false, escopos: [] }, false)).toBeNull();
    expect(conferirDecisaoVinculo(p, { aprovar: true, escopos: ['documentos'] }, true)).toBe(
      'quem-pediu-nao-decide',
    );
    expect(conferirDecisaoVinculo({ ...p, situacao: 'ativo' }, { aprovar: true, escopos: [] }, false)).toBe(
      'ja-decidido',
    );
    expect(titularPodeRevogar('procurador')).toBe(true);
    expect(titularPodeRevogar('curador')).toBe(false);
  });
});

describe('titulares da sessão', () => {
  it('o próprio (maior) com todos os escopos e os representados vigentes com o escopo aprovado', () => {
    const vinculos = [
      {
        id: '1',
        tipo: 'pai-mae' as const,
        situacao: 'ativo' as const,
        validade: null,
        escopos: ['pedidos', 'documentos'] as const,
        titular: menor,
      },
      {
        id: '2',
        tipo: 'pai-mae' as const,
        situacao: 'pendente' as const,
        validade: null,
        escopos: [] as const,
        titular: menor,
      },
      {
        id: '3',
        tipo: 'procurador' as const,
        situacao: 'ativo' as const,
        validade: '2026-01-01',
        escopos: ['documentos'] as const,
        titular: maior,
      },
    ];
    const r = titularesDaSessao({ nascimento: '1985-01-01' }, vinculos, dia, 18);
    expect(r).toEqual([
      { vinculo: null, escopos: ['agendamentos', 'consentimentos', 'documentos', 'pedidos'] },
      { vinculo: '1', escopos: ['documentos', 'pedidos'] },
    ]);
    expect(podeAgir(r, '1', 'documentos')).toBe(true);
    expect(podeAgir(r, '1', 'consentimentos')).toBe(false);
    expect(podeAgir(r, '3', 'documentos')).toBe(false);
    expect(podeAgir(r, null, 'consentimentos')).toBe(true);
  });
  it('conta só de responsável (o próprio sem idade de conta própria ou sem nascimento) não vê dados próprios', () => {
    expect(titularesDaSessao({ nascimento: '2012-01-01' }, [], dia, 18)).toEqual([]);
    expect(titularesDaSessao({ nascimento: null }, [], dia, 18)).toEqual([]);
    expect(titularesDaSessao(null, [], dia, 18)).toEqual([]);
  });
});
