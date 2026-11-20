// M44, regras 1 e 6: só o enfermeiro com conselho ativo classifica; uma fonte de cor por estabelecimento.
import { describe, expect, it } from 'vitest';
import { acoesPermitidas, mudancasDaFonteDeCor, recusaDaAcao, recusaLigarExterna } from './autorizacao.js';

const ator = (
  categoria: Parameters<typeof recusaDaAcao>[0]['categoria'],
  conselhoAtivo = true,
  vinculoAssistencial = true,
) => ({
  categoria,
  conselhoAtivo,
  vinculoAssistencial,
});

describe('quem classifica (regra 1)', () => {
  it('enfermeiro com conselho ativo conclui e reclassifica; técnico só registra sinais; recepção nada', () => {
    expect(acoesPermitidas(ator('enfermeiro'))).toEqual(['registrarSinais', 'concluir', 'reclassificar']);
    expect(acoesPermitidas(ator('tecnico-enfermagem'))).toEqual(['registrarSinais']);
    expect(acoesPermitidas(ator('administrativo'))).toEqual([]);
    expect(recusaDaAcao(ator('medico'), 'concluir')).toBe('privativo-enfermeiro');
    expect(recusaDaAcao(ator('medico'), 'registrarSinais')).toBe('categoria-nao-registra');
    expect(recusaDaAcao(ator('enfermeiro', false), 'concluir')).toBe('conselho-inativo');
    expect(recusaDaAcao(ator('enfermeiro', false), 'registrarSinais')).toBeNull();
    expect(recusaDaAcao(ator('enfermeiro', true, false), 'concluir')).toBe('sem-vinculo-assistencial');
  });
});

describe('uma fonte de cor (regra 6)', () => {
  it('ligar a própria desliga a externa na mesma mudança; a externa não liga com a própria ligada', () => {
    expect(mudancasDaFonteDeCor({ chave: 'pa.classificacao', ligada: true }, true)).toEqual([
      { chave: 'pa.classificacao', ligada: true },
      { chave: 'integracao.classificacaoExterna', ligada: false },
    ]);
    expect(mudancasDaFonteDeCor({ chave: 'pa.classificacao', ligada: true }, false)).toHaveLength(1);
    expect(mudancasDaFonteDeCor({ chave: 'pa.classificacao', ligada: false }, true)).toHaveLength(1);
    expect(recusaLigarExterna({ chave: 'integracao.classificacaoExterna', ligada: true }, true)).toBe(true);
    expect(recusaLigarExterna({ chave: 'integracao.classificacaoExterna', ligada: true }, false)).toBe(false);
    expect(recusaLigarExterna({ chave: 'outra.chave', ligada: true }, true)).toBe(false);
  });
});
