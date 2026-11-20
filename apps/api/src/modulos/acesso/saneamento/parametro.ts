// acesso.saneamento.administradoresMaximo do estabelecimento (M59-F4), lido pela fonte de configuração com a resolução
// por nível. Sem a fonte, sem a definição ou com erro de leitura, o padrão da definição (3): o limite nunca some.
import { definicaoParametro, PARAMETRO_ADMINISTRADORES_MAXIMO } from '@sgh/contratos';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';
import type { FonteConfiguracao } from '../../config/configuracao-fonte.js';

const PADRAO = 3;

export function administradoresMaximoPelaConfiguracao(
  fonte: () => Pick<FonteConfiguracao, 'valoresParametro'> | null,
  agora: () => number = () => Date.now(),
): (rede: string, hospital: string) => Promise<number> {
  return async (rede, hospital) => {
    const def = definicaoParametro(PARAMETRO_ADMINISTRADORES_MAXIMO);
    if (!def) return PADRAO;
    const padrao = Number(def.padrao);
    const f = fonte();
    if (!f) return padrao;
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
      return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : padrao;
    } catch {
      return padrao;
    }
  };
}
