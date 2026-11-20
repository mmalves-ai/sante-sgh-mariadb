// Serviço social (ficha do M45, regra 13): o risco social calculado com as parcelas, o risco escolhido nunca abaixo do
// calculado, a categoria que registra, o sigilo do parecer (dado sensível) e a sugestão de avaliação na fila.
import type { RegistroSocialLido } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  avaliacaoSugerida,
  comSigiloSocial,
  conferirRiscoSocial,
  daCategoriaSocial,
  ErroSocial,
  exigirCategoriaSocial,
  pontosRiscoSocial,
  riscoSocialCalculado,
} from '../index.js';

describe('risco social', () => {
  it('as parcelas: a rede de apoio e cada vulnerabilidade com o peso (sem repetir)', () => {
    expect(pontosRiscoSocial('fragil', ['sem-renda', 'sem-renda', 'transporte'])).toEqual({
      pontos: 4,
      parcelas: [
        { codigo: 'rede:fragil', peso: 1 },
        { codigo: 'sem-renda', peso: 2 },
        { codigo: 'transporte', peso: 1 },
      ],
    });
  });
  it('baixo abaixo de 2, médio de 2 a 4, alto de 5 em diante', () => {
    expect(riscoSocialCalculado('presente', ['transporte'])).toBe('baixo');
    expect(riscoSocialCalculado('presente', ['sem-renda'])).toBe('medio');
    expect(riscoSocialCalculado('ausente', ['sem-renda'])).toBe('alto');
    expect(riscoSocialCalculado('presente', ['violencia', 'sem-cuidador'])).toBe('alto');
  });
  it('a assistente social pode subir o risco, nunca baixar abaixo do calculado', () => {
    expect(conferirRiscoSocial('alto', 'presente', [])).toBe('alto');
    expect(conferirRiscoSocial('medio', 'presente', ['sem-renda'])).toBe('medio');
    expect(() => conferirRiscoSocial('baixo', 'presente', ['sem-renda'])).toThrow(/médio/);
    expect(() => conferirRiscoSocial('medio', 'ausente', ['violencia'])).toThrow(/alto/);
  });
});

describe('categoria e sigilo (LGPD)', () => {
  const r: RegistroSocialLido = {
    id: 1,
    tipo: 'avaliacao',
    redeApoio: 'fragil',
    vulnerabilidades: ['sem-renda'],
    risco: 'medio',
    encaminhamentos: ['cras-creas'],
    parecer: 'Parecer social sintético do caso.',
    sigilo: false,
    orientacoes: 'Família visita à tarde.',
    barreira: null,
    por: 'SINT.SOCIAL',
    em: '2026-10-25T10:00',
    adendoDe: null,
    motivoAdendo: null,
    situacao: 'ativo',
    correcao: null,
  };
  it('só a assistente social registra', () => {
    expect(daCategoriaSocial('servico-social')).toBe(true);
    expect(() => exigirCategoriaSocial('servico-social')).not.toThrow();
    expect(() => exigirCategoriaSocial('medico')).toThrow(ErroSocial);
    expect(() => exigirCategoriaSocial(null)).toThrow(/assistente social/);
  });
  it('o parecer só para a categoria; as demais veem o resto, com a marca de sigilo', () => {
    expect(comSigiloSocial(r, 'servico-social')).toEqual(r);
    expect(comSigiloSocial(r, 'enfermagem')).toEqual({ ...r, parecer: null, sigilo: true });
    expect(comSigiloSocial(r, null).orientacoes).toBe('Família visita à tarde.');
  });
});

describe('sugestão de avaliação na fila', () => {
  const hoje = '2026-10-25';
  it('sem avaliação: idoso, menor ou 7 dias de internação', () => {
    expect(avaliacaoSugerida({ idade: 61, diasInternado: 1, ultima: null, hoje })).toBe(true);
    expect(avaliacaoSugerida({ idade: 12, diasInternado: 1, ultima: null, hoje })).toBe(true);
    expect(avaliacaoSugerida({ idade: 40, diasInternado: 7, ultima: null, hoje })).toBe(true);
    expect(avaliacaoSugerida({ idade: 40, diasInternado: 2, ultima: null, hoje })).toBe(false);
    expect(avaliacaoSugerida({ idade: null, diasInternado: 2, ultima: null, hoje })).toBe(false);
  });
  it('com avaliação: só o risco alto sem evolução há mais de 3 dias', () => {
    expect(
      avaliacaoSugerida({ idade: 80, diasInternado: 9, ultima: { risco: 'medio', em: '2026-10-01' }, hoje }),
    ).toBe(false);
    expect(
      avaliacaoSugerida({ idade: 80, diasInternado: 9, ultima: { risco: 'alto', em: '2026-10-21' }, hoje }),
    ).toBe(true);
    expect(
      avaliacaoSugerida({ idade: 80, diasInternado: 9, ultima: { risco: 'alto', em: '2026-10-23' }, hoje }),
    ).toBe(false);
  });
});
