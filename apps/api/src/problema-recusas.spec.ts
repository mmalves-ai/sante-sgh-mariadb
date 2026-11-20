// M53.4: a programação de férias recusada leva TODAS as regras da CLT que não cumpre (`recusas`) no Problem Details; o
// filtro só repassa os extras que conhece, e o E2E @M53.4 mostrou a lista cortada na primeira recusa.
import type { ArgumentsHost } from '@nestjs/common';
import { esquemaProblema } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { ErroProblema, ProblemaFilter } from './problema.filter.js';

function capturar(erro: unknown): unknown {
  let corpo: unknown = null;
  const resposta = {
    status: () => resposta,
    header: () => resposta,
    send: (c: unknown) => (corpo = c),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ headers: {}, url: '/api/pessoas/folha/ferias', method: 'POST' }),
      getResponse: () => resposta,
    }),
  } as unknown as ArgumentsHost;
  new ProblemaFilter().catch(erro, host);
  return corpo;
}

describe('Problem Details: recusas da programação de férias', () => {
  it('repassa todas as recusas, e o corpo segue o contrato', () => {
    const corpo = capturar(
      new ErroProblema(
        'recusa-de-negocio',
        409,
        'Operação recusada',
        'O início das férias não pode ser antes de hoje.',
        {
          codigo: 'inicio-no-passado',
          campos: ['inicio'],
          recusas: ['inicio-no-passado', 'vespera-de-descanso'],
        },
      ),
    );
    expect(corpo).toMatchObject({
      status: 409,
      codigo: 'inicio-no-passado',
      recusas: ['inicio-no-passado', 'vespera-de-descanso'],
    });
    expect(esquemaProblema.safeParse(corpo).success).toBe(true);
  });

  it('sem recusas, o campo não aparece', () => {
    const corpo = capturar(
      new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', 'x', { codigo: 'y' }),
    );
    expect(corpo).not.toHaveProperty('recusas');
  });
});
