// M59-F1: a porta do painel de contas do banco sobre o núcleo do adaptador (transação de leitura; só metadado do
// catálogo de segurança e contagens; conta fora da lista legível nunca volta pelo nome).
import type { ContasSgh } from '@sgh/dominio-acesso';
import {
  contarLoginsNaoLegiveis,
  lerContasDeModulo,
  lerDeleteClinico,
  lerInventarioContasBanco,
  lerPrivilegiosReais,
  type NucleoLegado,
} from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import type { PortaContasBanco } from './porta.js';

type Env = Readonly<Record<string, string | undefined>>;

/** As contas do Sante SGH do estabelecimento, lidas do arquivo de ambiente (só os nomes de conta). */
export function contasSghDoAmbiente(env: Env, hospital: string): ContasSgh {
  const C = hospital.toUpperCase();
  const limpo = (v: string | undefined) => (v?.trim() ? v.trim() : null);
  const aplicacao = [limpo(env[`FB_${C}_USUARIO`])].filter((x): x is string => x !== null);
  let modulos: string[];
  try {
    modulos = lerContasDeModulo(hospital, env).map((c) => c.usuario);
  } catch {
    modulos = [];
  }
  return {
    aplicacao: [...aplicacao, ...modulos],
    scripts: limpo(env[`FB_${C}_SCRIPTS_USUARIO`]),
    leitura: limpo(env[`FB_${C}_LEITURA_USUARIO`]),
  };
}

export function portaContasBancoLegado(nucleo: NucleoLegado, env: Env): PortaContasBanco {
  const ctx = (c: { rede: string; hospital: string }) => ({
    rede: c.rede,
    hospital: c.hospital,
    traceId: 'contas-banco',
  });
  return {
    destino: 'legado',
    contasSgh: (h) => contasSghDoAmbiente(env, h),
    modulosComConta(h) {
      try {
        return lerContasDeModulo(h, env).map((c) => c.sufixo);
      } catch {
        return [];
      }
    },
    lerInventario: (c, legiveis) =>
      nucleo.lerSomente(ctx(c), async (l) => ({
        contas: await lerInventarioContasBanco(l, legiveis),
        loginsNaoLegiveis: await contarLoginsNaoLegiveis(l, legiveis),
      })),
    lerPrivilegiosSgh: (c) => nucleo.lerSomente(ctx(c), (l) => lerPrivilegiosReais(l, { prefixo: 'SGH_' })),
    lerDeleteClinico: (c, legiveis) => nucleo.lerSomente(ctx(c), (l) => lerDeleteClinico(l, legiveis)),
  };
}

/** Sem o núcleo do adaptador (e fora do ambiente sintético): o painel responde 503, nunca uma lista vazia enganosa. */
export function portaContasBancoIndisponivel(): PortaContasBanco {
  const fora = () =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco indisponível',
        'O banco do estabelecimento não está configurado.',
      ),
    );
  return {
    destino: 'legado',
    contasSgh: () => ({ aplicacao: [], scripts: null, leitura: null }),
    modulosComConta: () => [],
    lerInventario: fora,
    lerPrivilegiosSgh: fora,
    lerDeleteClinico: fora,
  };
}
