// O parâmetro legado.contingencia do estabelecimento (M59, regra 1; regra 7 da Fase 7): lido pela fonte de configuração
// com a resolução por nível; sem a fonte, sem a definição ou com erro de leitura, LIGADO (falha para o lado seguro: nada
// do que o sistema anterior lê é retirado).
import { definicaoParametro, PARAMETRO_CONTINGENCIA_LEGADO } from '@sgh/contratos';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';
import type { FonteConfiguracao } from '../../config/configuracao-fonte.js';

export function contingenciaPelaConfiguracao(
  fonte: () => Pick<FonteConfiguracao, 'valoresParametro'> | null,
  agora: () => number = () => Date.now(),
): (rede: string, hospital: string) => Promise<boolean> {
  return async (rede, hospital) => {
    const def = definicaoParametro(PARAMETRO_CONTINGENCIA_LEGADO);
    const f = fonte();
    if (!def || !f) return true;
    try {
      const valores = await f.valoresParametro(rede, hospital);
      const v = valorTipado(
        def,
        resolverParametro(
          def,
          valores,
          { rede, empresa: null, estabelecimento: hospital, unidade: null, perfis: [], usuario: '' },
          new Date(agora()),
        ).valor,
      );
      return v !== false;
    } catch {
      return true;
    }
  };
}
