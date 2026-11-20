// Comuns e rotas da gestão de pessoas (M52.1): a data no formato do Brasil, as opções do vocabulário, o código da recusa
// e a entrada sem o vínculo; toda rota exige a permissão do catálogo (o servidor confere de novo).
import {
  PARENTESCOS_DEPENDENTE,
  PERMISSOES_PESSOAS_M52_F1,
  PERMISSOES_PESSOAS_M52_F2,
  PERMISSOES_PESSOAS_M52_F3,
  PERMISSOES_PESSOAS_M52_F4,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { ErroApi } from '../../casca/erros/problem-details.js';
import { codigoDoErro, dataBr, opcoesDe, semVinculo } from './comum.js';
import { rotasPessoas } from './rotas.js';

describe('comuns da gestão de pessoas', () => {
  it('data, opções, código da recusa e a entrada sem o vínculo', () => {
    expect(dataBr('2026-10-25')).toBe('25/10/2026');
    expect(dataBr(null)).toBe('');
    expect(opcoesDe(PARENTESCOS_DEPENDENTE)[0]).toEqual({ valor: '01', rotulo: 'Cônjuge' });
    expect(codigoDoErro(new ErroApi({ codigo: 'data-futura' } as never, 409))).toBe('data-futura');
    expect(codigoDoErro(new Error('x'))).toBeNull();
    expect(semVinculo({ vinculo: 3, data: 'x' })).toEqual({ data: 'x' });
  });

  it('as rotas da F1, da F2, da F3 e da F4 exigem permissões do catálogo', () => {
    const codigos = new Set(
      [
        ...PERMISSOES_PESSOAS_M52_F1,
        ...PERMISSOES_PESSOAS_M52_F2,
        ...PERMISSOES_PESSOAS_M52_F3,
        ...PERMISSOES_PESSOAS_M52_F4,
      ].map((p) => p.codigo),
    );
    expect(rotasPessoas.map((r) => r.path)).toEqual([
      '/pessoas/colaboradores',
      '/pessoas/colaboradores/admitir',
      '/pessoas/colaboradores/:vinculo(\\d+)',
      '/pessoas/escala',
      '/pessoas/escala/trocas',
      '/pessoas/plantao-agora',
      '/pessoas/dimensionamento',
      '/pessoas/escala/:escala(\\d+)',
      '/pessoas/regimes',
      '/pessoas/ponto',
      '/pessoas/ponto/meu',
      '/pessoas/ponto/:vinculo(\\d+)/:competencia(\\d{4}-\\d{2})',
      '/pessoas/cargos',
      '/pessoas/avaliacoes',
      '/pessoas/avaliacoes/minhas',
      '/pessoas/indicadores',
    ]);
    for (const r of rotasPessoas) expect(codigos.has(String(r.meta?.['permissao']))).toBe(true);
  });
});
