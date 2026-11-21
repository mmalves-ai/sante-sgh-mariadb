// Fonte do M16 (painel de leitos, censo, painéis e vigia): o que as telas leem, independente de onde (a API não
// escreve SQL):
//   - `banco`: o banco do cliente pelo @sgh/nucleo (fonte-propria.ts), somente leitura;
//   - `memoria`: a sessão sintética de dev/ci (E2E): estabelecimento SINTÉTICO com movimento gerado; a "gravação por
//     fora" do E2E chega por um arquivo (LEITOS_SINTETICOS_POR_FORA);
//   - indisponível: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
// Melhoria: tipos de negócio próprios (sem nome de coluna do sistema de origem: o cadastro de acomodações deixa de
// vir como linha crua); contexto com o ContextoNucleo da sessão (cliente, estabelecimento e usuário por id).
import type { CanalVigia, CensoDia, LeiturasPainel, MovimentoInternacao } from '@sgh/contratos';
import type { ContextoNucleo } from '@sgh/nucleo';
import { ErroProblema } from '../../problema.filter.js';
import type { LeituraCanal, MarcaVigia } from './vigia.js';

export const FONTE_INTERNACAO = Symbol('FONTE_INTERNACAO');

export interface CtxInternacao {
  readonly rede: string;
  readonly hospital: string;
  readonly traceId: string;
  /** Contexto do núcleo (cliente, estabelecimento, usuário e correlação) para a fonte do banco. */
  readonly porta?: ContextoNucleo;
}

export type CensoFechadoLido = Pick<CensoDia, 'linhas' | 'horaFechamento' | 'versaoCalculo' | 'geradoEm'>;

/** Cadastro de leitos do estabelecimento (blocos, acomodações e leitos com a ocupação). */
export interface CadastroLeitos {
  readonly blocos: readonly { bloco: string; nome: string; andares: number | null }[];
  readonly acomodacoes: readonly { bloco: string; acomodacao: string; nome: string }[];
  readonly leitos: readonly {
    id: number;
    bloco: string;
    acomodacao: string;
    leito: string;
    ativo: boolean;
    ocupado: boolean;
    ramal: number | null;
    andar: number | null;
    /** Internação que ocupa o leito (0 = livre). */
    reg: number;
  }[];
}

/** Retrato do cadastro de leitos para conferência (forma do motor de conferência de @sgh/dominio-organizacao). */
export interface RetratoLeitos {
  readonly acomodacoes: readonly {
    bloco: string | null;
    acomodacao: string;
    tipoAtendimento: 'I' | 'E';
    nome: string;
  }[];
  readonly leitos: readonly {
    bloco: string | null;
    acomodacao: string;
    leito: string;
    tipoAtendimento: 'I' | 'E';
    ativo: boolean;
    ramal: number | null;
  }[];
  readonly retratos: number;
}

export interface PacienteDaInternacao {
  readonly internacao: number;
  readonly nome: string;
  readonly entrada: string;
  readonly convenio: string | null;
  readonly clinica: string | null;
}

export interface OperacionalDoMes {
  readonly periodo: string;
  readonly atendimentosExternos: number;
  readonly internacoes: number;
  readonly consultas: number;
  readonly cirurgias: number;
  readonly exames: number;
}

export interface FinanceiroDoMes {
  readonly periodo: string;
  readonly regua: 'data-do-item' | 'competencia';
  readonly cobrado: number;
  readonly pago: number;
  readonly cobradoBaixado: number;
  readonly pagoBaixado: number;
}

/** Onde a fonte lê: o banco do cliente ou a memória sintética. */
export type DestinoFonte = 'banco' | 'memoria';

export interface FonteInternacao {
  readonly destino: DestinoFonte;
  leiturasPainel(c: CtxInternacao): Promise<LeiturasPainel>;
  pacienteDaInternacao(c: CtxInternacao, reg: number): Promise<PacienteDaInternacao | null>;
  movimento(c: CtxInternacao): Promise<MovimentoInternacao>;
  conferencia(c: CtxInternacao): Promise<{ cadastro: CadastroLeitos; espelho: RetratoLeitos }>;
  censoFechado(
    c: CtxInternacao,
    data: string,
    tipos: ReadonlyMap<number, string>,
    nomes: ReadonlyMap<string, string>,
    intensivas: readonly number[],
  ): Promise<CensoFechadoLido | null>;
  diasFechados(c: CtxInternacao, de: string, ate: string): Promise<string[]>;
  operacional(c: CtxInternacao, de: string, ate: string): Promise<OperacionalDoMes[]>;
  financeiro(c: CtxInternacao, de: string, ate: string): Promise<FinanceiroDoMes[]>;
  dataDaCopia(c: CtxInternacao): Promise<Date | null>;
  /** Selo do canal do vigia: chega sem sessão, só com o cliente e o estabelecimento (usuário nulo: processo). */
  canal(alvo: ContextoNucleo, canal: CanalVigia, marca: MarcaVigia): Promise<LeituraCanal>;
}

/** Valor de `destino` no contrato das telas (o enum do contrato ainda chama o banco de 'legado'; pedido da onda). */
export const destinoNoContrato = (d: DestinoFonte): 'legado' | 'memoria' => (d === 'memoria' ? 'memoria' : 'legado');

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido). */
export function fonteInternacaoIndisponivel(): FonteInternacao {
  const recusa = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O banco do estabelecimento não está configurado: nada foi lido.',
      ),
    );
  return {
    destino: 'banco',
    leiturasPainel: recusa,
    pacienteDaInternacao: recusa,
    movimento: recusa,
    conferencia: recusa,
    censoFechado: recusa,
    diasFechados: recusa,
    operacional: recusa,
    financeiro: recusa,
    dataDaCopia: recusa,
    canal: recusa,
  };
}
