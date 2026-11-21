// Falha das gravações de configuração do M08 (liberação, pré-requisito, parâmetro) → Problem Details.
// Melhoria: a recusa do Executor (ErroOperacao: conflito de versão, entrada inválida, restrição do banco) vira a
// mesma mensagem de negócio, sem nome de tabela nem valor.
// Melhoria: só a unicidade das chaves de escopo vira concorrência; CHECK, FK e as demais restrições voltam como regra
// do cadastro (422/409 do núcleo), para a pessoa não repetir uma ação que o banco sempre recusará.
import { ErroLote } from '@sgh/dominio-config';
import {
  ehTravaOcupada,
  ErroOperacao,
  problemaDaOperacao,
  restricaoUnicaViolada,
  restricaoViolada,
} from '@sgh/nucleo';
import { logger } from '../../logger.js';
import { ErroProblema } from '../../problema.filter.js';
import { ErroRecusaConfiguracao } from './configuracao-fonte.js';

/**
 * As unicidades das chaves de escopo das configurações: violá-las quer dizer que outra pessoa gravou a mesma linha ao
 * mesmo tempo (concorrência). As demais restrições (CHECK, FK, NOT NULL, outras UNIQUE) são regra do cadastro e
 * voltam com a mensagem de negócio do núcleo, nunca como concorrência.
 */
const UNICAS_DE_ESCOPO: ReadonlySet<string> = new Set([
  'uq_parametro_valor_escopo_vigencia',
  'uq_liberacao_chave_escopo',
  'uq_liberacao_lote_numero',
  'uq_recurso_prerequisito_tipo',
]);

const CONCORRENCIA = 'Outra pessoa alterou esta configuração ao mesmo tempo. Releia e tente de novo.';

/**
 * Falha da gravação de configuração → Problem Details: recusa decidida na transação (409/400), restrição
 * única, conflito de versão ou trava ocupada (409, concorrência) e o resto 503 com o erro no log (só o tipo, sem dado).
 */
export function falhaDaConfiguracao(e: unknown, operacao: string, naoGravado: string): ErroProblema {
  if (e instanceof ErroProblema) return e;
  if (e instanceof ErroLote) return new ErroProblema('entrada-invalida', 400, 'Lote inválido', e.message);
  if (e instanceof ErroRecusaConfiguracao)
    return new ErroProblema('recusa-de-negocio', 409, 'Não gravado', e.message, { codigo: e.codigo });
  if (e instanceof ErroOperacao) {
    const p = e.problema;
    if (
      p.codigo === 'conflito-versao' ||
      p.codigo === 'registro-em-edicao' ||
      (p.codigo === 'registro-duplicado' && p.restricao !== undefined && UNICAS_DE_ESCOPO.has(p.restricao))
    )
      return new ErroProblema('registro-em-edicao', 409, 'Não gravado', CONCORRENCIA, {
        codigo: 'conflito-concorrente',
      });
    if (p.status === 400)
      return new ErroProblema('entrada-invalida', 400, 'Não gravado', p.detail, { codigo: p.codigo ?? '' });
    if (p.status === 422)
      return new ErroProblema('entrada-invalida', 422, 'Não gravado', p.detail, { codigo: p.codigo ?? '' });
    if (p.status === 409 || p.status === 403 || p.status === 401)
      return new ErroProblema('recusa-de-negocio', p.status, 'Não gravado', p.detail, {
        codigo: p.codigo ?? '',
      });
  }
  const unica = restricaoUnicaViolada(e);
  if ((unica !== null && UNICAS_DE_ESCOPO.has(unica)) || ehTravaOcupada(e))
    return new ErroProblema('registro-em-edicao', 409, 'Não gravado', CONCORRENCIA, {
      codigo: 'conflito-concorrente',
    });
  if (restricaoViolada(e)) {
    // Restrição do banco fora da transação do Executor: a mesma mensagem de negócio do núcleo, sem valor.
    const p = problemaDaOperacao(e);
    const tipo = p.status === 400 || p.status === 422 ? 'entrada-invalida' : 'recusa-de-negocio';
    return new ErroProblema(tipo, p.status, 'Não gravado', p.detail, { codigo: p.codigo ?? '' });
  }
  logger.error(
    { operacao, tipoErro: e instanceof Error ? e.name : typeof e },
    'gravação de configuração falhou (nada gravado)',
  );
  return new ErroProblema('trilha-indisponivel', 503, 'Não gravado', naoGravado);
}
