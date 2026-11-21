// W1-01 (parte 11d; D-W101-46): os parâmetros da conferência do conselho (acesso.conselho.*) pela fonte de
// configuração, com a resolução por nível; sem ela, ou com erro de leitura, os padrões das definições. E o "hoje" no
// fuso do estabelecimento para a validade da conferência. A regra é de @sgh/dominio-acesso (conselhoEfetivo).
import { definicaoParametro, type ValorParametro } from '@sgh/contratos';
import {
  MODOS_BLOQUEIO_CONSELHO,
  type ModoBloqueioConselho,
  PADRAO_CONSELHO,
  type ParametrosConselho,
} from '@sgh/dominio-acesso';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';

/** O que a regra do conselho lê da fonte de configuração (estrutural: a fonte de config. satisfaz). */
export interface FonteValoresParametro {
  valoresParametro(rede: string, hospital: string): Promise<ValorParametro[]>;
}

export const PARAMETROS_CONSELHO = {
  bloqueio: 'acesso.conselho.bloqueioAtosPrivativos',
  validadeDias: 'acesso.conselho.validadeConferenciaDias',
  consultaAutomatica: 'acesso.conselho.consultaAutomatica',
} as const;

export type RegraConselho = (rede: string, hospital: string) => Promise<ParametrosConselho>;

/** AAAA-MM-DD no fuso do Brasil (a data da conferência é o dia do estabelecimento). */
export function hojeNoEstabelecimento(agora: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(agora));
}

export function parametrosConselhoPelaConfiguracao(
  fonte: () => FonteValoresParametro | null,
  agora: () => number = () => Date.now(),
): RegraConselho {
  return async (rede, hospital) => {
    const f = fonte();
    const valores = f ? await f.valoresParametro(rede, hospital).catch(() => null) : null;
    const ler = (chave: string): unknown => {
      const def = definicaoParametro(chave);
      if (!def) return undefined;
      try {
        return valorTipado(
          def,
          valores
            ? resolverParametro(
                def,
                valores,
                { rede, empresa: null, estabelecimento: hospital, unidade: null, perfis: [], usuario: '' },
                new Date(agora()),
              ).valor
            : def.padrao,
        );
      } catch {
        return undefined;
      }
    };
    const P = PADRAO_CONSELHO;
    const modo = ler(PARAMETROS_CONSELHO.bloqueio);
    const dias = ler(PARAMETROS_CONSELHO.validadeDias);
    const auto = ler(PARAMETROS_CONSELHO.consultaAutomatica);
    return {
      bloqueio: MODOS_BLOQUEIO_CONSELHO.includes(modo as ModoBloqueioConselho)
        ? (modo as ModoBloqueioConselho)
        : P.bloqueio,
      validadeDias:
        typeof dias === 'number' && Number.isInteger(dias) && dias >= 30 && dias <= 1095
          ? dias
          : P.validadeDias,
      consultaAutomatica: typeof auto === 'boolean' ? auto : P.consultaAutomatica,
    };
  };
}
