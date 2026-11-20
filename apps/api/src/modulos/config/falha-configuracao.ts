// Falha das gravações de configuração do M08 (liberação, pré-requisito, parâmetro) → Problem Details.
import { ErroLote } from '@sgh/dominio-config';
import { ehTravaOcupada, ErroConfiguracaoSgh, restricaoUnicaViolada } from '@sgh/legado';
import { logger } from '../../logger.js';
import { ErroProblema } from '../../problema.filter.js';

/**
 * Falha da gravação de configuração → Problem Details: recusa decidida na transação (409/400), restrição
 * única ou trava ocupada (409, concorrência) e o resto 503 com o erro no log (só o tipo, sem dado).
 */
export function falhaDaConfiguracao(e: unknown, operacao: string, naoGravado: string): ErroProblema {
  if (e instanceof ErroProblema) return e;
  if (e instanceof ErroLote) return new ErroProblema('entrada-invalida', 400, 'Lote inválido', e.message);
  if (e instanceof ErroConfiguracaoSgh)
    return new ErroProblema('recusa-de-negocio', 409, 'Não gravado', e.message, { codigo: e.codigo });
  if (restricaoUnicaViolada(e) || ehTravaOcupada(e))
    return new ErroProblema(
      'registro-em-edicao',
      409,
      'Não gravado',
      'Outra pessoa alterou esta configuração ao mesmo tempo. Releia e tente de novo.',
      { codigo: 'conflito-concorrente' },
    );
  logger.error(
    { operacao, tipoErro: e instanceof Error ? e.name : typeof e },
    'gravação de configuração falhou (nada gravado)',
  );
  return new ErroProblema('trilha-indisponivel', 503, 'Não gravado', naoGravado);
}
