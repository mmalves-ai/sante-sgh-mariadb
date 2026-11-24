// Os gravadores dos EFEITOS da aprovação do autoatendimento sobre o MariaDB do cliente (W0-06, D-W006-SOLIC-EFEITO):
// a decisão da solicitação e o efeito no ponto (o ajuste ou o abono), no cadastro do colaborador (a correção do vínculo,
// o histórico e a correção na trilha) e nas férias (a programação) correm NA MESMA transação da operação do Executor.
// Cada efeito usa o gravador da porta própria do módulo dono (as mesmas regras, recusas e travas da tela do módulo),
// montado sobre a transação da solicitação, com o contexto de quem decide.
//   - ponto: o gravador da porta própria do ponto (o fuso do estabelecimento lido na primeira chamada);
//   - pessoas: o gravador da porta própria do colaborador (com a cifra do CPF da porta);
//   - folha: o gravador do cálculo da folha, quando a porta oferece `gravadorNaTransacao`; sem ela, as férias aprovadas
//     recusam com `modelo-pendente` (e a operação inteira é desfeita, nada pela metade).
// Melhoria: o efeito expõe só os métodos que o contrato do autoatendimento lista (o resto do gravador do módulo não é
// alcançável pela solicitação).
// Melhoria: as tabelas que cada efeito grava entram na operação declaradas (a transação recusa as outras), incluindo a
// trilha que a correção do cadastro escreve na mesma transação.
import type { TxOperacao } from '@sgh/nucleo';
import { modeloPendente } from '../../qualidade/apoio-propria.js';
import { fusoDoEstabelecimento } from '../banco-apoio.js';
import type { GravadorCalculoFolha } from '../folha/porta-calculo.js';
import { TABELAS_CALCULO_FOLHA } from '../folha/porta-calculo-propria.js';
import type { GravadorPessoas } from '../porta.js';
import type { PortaPessoasPropria } from '../porta-propria.js';
import type { GravadorPonto } from '../ponto/porta-ponto.js';
import type { PortaPontoPropria } from '../ponto/porta-ponto-propria.js';
import type { ContextoAutoatendimento, GravadorAutoatendimento } from './porta-autoatendimento.js';
import type { EfeitosAutoatendimento } from './porta-propria.js';

type EfeitoPonto = GravadorAutoatendimento['ponto'];
type EfeitoFolha = GravadorAutoatendimento['folha'];
type EfeitoPessoas = GravadorAutoatendimento['pessoas'];

/** Os métodos de cada efeito que a solicitação alcança (o contrato do autoatendimento). */
export const METODOS_EFEITO_PONTO = [
  'travarPessoa',
  'eventosPeriodo',
  'marcacoes',
  'ajuste',
  'ajustes',
  'incluirAjuste',
  'decidirAjuste',
  'desistirAjuste',
] as const satisfies readonly (keyof EfeitoPonto)[];
export const METODOS_EFEITO_PESSOAS = [
  'vinculo',
  'corrigirVinculo',
  'incluirHistorico',
  'registrarCorrecao',
] as const satisfies readonly (keyof EfeitoPessoas)[];
export const METODOS_EFEITO_FOLHA = ['feriasDoVinculoComTrava', 'incluirFerias'] as const satisfies readonly (keyof EfeitoFolha)[];

/** As tabelas que o efeito no ponto grava (o ajuste e a decisão dele; a trava da pessoa é só leitura). */
export const TABELAS_EFEITO_PONTO = ['ajuste_ponto'] as const;
/** As tabelas que o efeito no cadastro grava (a correção do vínculo, o nome, o histórico de cargo e de jornada). */
export const TABELAS_EFEITO_PESSOAS = [
  'vinculo_trabalho',
  'colaborador',
  'historico_cargo',
  'vigencia_regime_colaborador',
] as const;
/** A trilha encadeada que a correção do cadastro e o evento do vínculo escrevem na mesma transação. */
export const TABELAS_EFEITO_TRILHA = ['trilha_cadeia', 'trilha_auditoria', 'trilha_auditoria_fecho'] as const;

/** A porta do cálculo da folha que entrega o gravador sobre uma transação de outra operação. */
export interface FonteGravadorCalculo {
  /** As tabelas que o gravador do cálculo grava (as férias incluídas, quando tiverem modelo). */
  readonly tabelas: readonly string[];
  gravadorNaTransacao(tx: TxOperacao, est: number): Pick<GravadorCalculoFolha, (typeof METODOS_EFEITO_FOLHA)[number]>;
}

/** A fonte do cálculo a partir da porta, quando ela oferece o gravador sobre a transação (senão, null). */
export function fonteCalculoDe(porta: unknown, tabelas: readonly string[] = TABELAS_CALCULO_FOLHA): FonteGravadorCalculo | null {
  const g = (porta as { gravadorNaTransacao?: unknown } | null)?.gravadorNaTransacao;
  if (typeof g !== 'function') return null;
  return {
    tabelas,
    gravadorNaTransacao: (tx, est) =>
      (g as FonteGravadorCalculo['gravadorNaTransacao']).call(porta, tx, est),
  };
}

const PENDENTE_FERIAS =
  'O efeito da aprovação das férias (a programação das férias gravada com a decisão)';

/** Só os métodos listados, cada um sobre o gravador (criado uma vez, na primeira chamada). */
function restrito<T extends object>(metodos: readonly string[], criar: () => T | Promise<T>): T {
  let g: Promise<T> | null = null;
  const alvo: Record<string, unknown> = {};
  for (const m of metodos)
    alvo[m] = async (...a: unknown[]) => {
      g ??= Promise.resolve().then(criar);
      const real = (await g) as Record<string, (...x: unknown[]) => Promise<unknown>>;
      return real[m]!(...a);
    };
  return Object.freeze(alvo) as T;
}

/** As portas próprias de onde vêm os gravadores dos efeitos. */
export interface PortasDosEfeitos {
  readonly pessoas: PortaPessoasPropria;
  readonly ponto: PortaPontoPropria;
  /** null: as férias aprovadas recusam com `modelo-pendente`. */
  readonly calculo?: FonteGravadorCalculo | null;
}

// O gravador de cada porta própria é o mesmo da tela do módulo, montado aqui sobre a transação da solicitação.
type ComGravadorPessoas = {
  gravador(e: TxOperacao, c: ContextoAutoatendimento, est: number): GravadorPessoas;
};
type ComGravadorPonto = {
  gravador(e: TxOperacao, c: ContextoAutoatendimento, est: number, fuso: string): GravadorPonto;
};

/** Os efeitos da aprovação ligados às portas próprias do ponto, do cadastro e (quando houver) do cálculo da folha. */
export function efeitosAutoatendimentoProprios(p: PortasDosEfeitos): EfeitosAutoatendimento {
  const calculo = p.calculo ?? null;
  const pessoas = p.pessoas as unknown as ComGravadorPessoas;
  const ponto = p.ponto as unknown as ComGravadorPonto;
  if (typeof pessoas.gravador !== 'function' || typeof ponto.gravador !== 'function')
    throw new Error('As portas próprias do cadastro e do ponto não oferecem o gravador sobre a transação.');
  const tabelas = [
    ...new Set<string>([
      ...TABELAS_EFEITO_PONTO,
      ...TABELAS_EFEITO_PESSOAS,
      ...TABELAS_EFEITO_TRILHA,
      ...(calculo?.tabelas ?? []),
    ]),
  ];
  return {
    tabelas,
    gravadores(tx, est, c) {
      return {
        ponto: restrito<EfeitoPonto>(METODOS_EFEITO_PONTO, async () =>
          ponto.gravador(tx, c, est, await fusoDoEstabelecimento(tx, est)),
        ),
        pessoas: restrito<EfeitoPessoas>(METODOS_EFEITO_PESSOAS, () => pessoas.gravador(tx, c, est)),
        folha: calculo
          ? restrito<EfeitoFolha>(METODOS_EFEITO_FOLHA, () => calculo.gravadorNaTransacao(tx, est))
          : restrito<EfeitoFolha>(METODOS_EFEITO_FOLHA, () => {
              throw modeloPendente(PENDENTE_FERIAS);
            }),
      };
    },
  };
}
