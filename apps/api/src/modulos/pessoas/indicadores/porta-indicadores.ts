// Porta do painel de indicadores de pessoas (W0-06, parte 7; M4 de mercado): monta a `BaseIndicadoresPessoas` do
// período e do setor pedidos, a partir do cadastro, do ponto apurado, da folha, das turmas realizadas, do SESMT, do
// censo e do último dimensionamento do setor. Só leitura: nada se grava.
//   - `banco`: o banco do cliente pelo @sgh/nucleo, uma transação somente leitura por fonte (porta-indicadores-propria);
//   - `memoria`: a sessão sintética de dev/ci, com os fatos semeados (testes e E2E);
//   - indisponível: fora de dev/ci sem o núcleo, 503 em tudo (falha fechada).
// Fonte que não pôde ser lida não derruba o painel: vem vazia e com um aviso, e o indicador que depende dela sai sem
// valor dizendo por quê.
import type { FonteIndicadorPessoas } from '@sgh/contratos';
import type { BaseIndicadoresPessoas } from '@sgh/dominio-pessoas';
import type { ContextoPorta } from '../../cadastro/porta.js';
import { portaIndisponivel } from '../../exames/public-api.js';

export const PORTA_INDICADORES_PESSOAS = Symbol('PORTA_INDICADORES_PESSOAS');

/** O contexto do núcleo (cliente, estabelecimento por id, usuário) mais o código do estabelecimento da sessão. */
export type ContextoIndicadores = ContextoPorta;

/** O recorte já validado: o período, o estabelecimento da sessão e, se pedido, o setor. */
export interface RecorteIndicadores {
  readonly inicio: string;
  readonly fim: string;
  readonly hospital: string;
  readonly setor: number | null;
}

/** A base sem o ajuste da COFEN (o serviço resolve o parâmetro) e as fontes que ficaram de fora. */
export interface BaseLidaIndicadores {
  readonly base: Omit<BaseIndicadoresPessoas, 'horasCofen'>;
  readonly indisponiveis: readonly { fonte: FonteIndicadorPessoas; motivo: string }[];
}

export interface PortaIndicadoresPessoas {
  readonly destino: 'banco' | 'memoria';
  hoje(c: ContextoIndicadores): Promise<string>;
  /** Os setores do estabelecimento (o filtro do painel). */
  setores(c: ContextoIndicadores): Promise<{ codigo: number; rotulo: string }[]>;
  base(c: ContextoIndicadores, r: RecorteIndicadores): Promise<BaseLidaIndicadores>;
}

export const METODOS_PORTA_INDICADORES: ReadonlySet<string> = new Set(['hoje', 'setores', 'base']);

export function portaIndicadoresPessoasIndisponivel(): PortaIndicadoresPessoas {
  return portaIndisponivel<PortaIndicadoresPessoas>(METODOS_PORTA_INDICADORES);
}
