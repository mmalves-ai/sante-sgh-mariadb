// Fonte do M16 (painel de leitos, censo, painéis e vigia): o que as telas leem, independente de onde (a API não
// escreve SQL; fronteira):
//   - `legado`: o núcleo do legado (leituras READ ONLY dos repositórios de @sgh/legado; nada é gravado em tabela do
//     legado; o retrato do censo fechado é do worker, só SGH_);
//   - `memoria`: a sessão sintética de dev/ci (E2E): estabelecimento SINTÉTICO com movimento gerado; a "gravação por
//     fora" do E2E chega por um arquivo (LEITOS_SINTETICOS_POR_FORA), como o outro sistema gravaria;
//   - `indisponivel`: fora de dev/ci sem o núcleo: 503 em tudo (falha fechada).
import type { CanalVigia, CensoDia, LeiturasPainel, MovimentoInternacao } from '@sgh/contratos';
import {
  diasFechados,
  type EspelhoLegado,
  type FinanceiroMensalLido,
  type LeituraCanal,
  type Leitor,
  lerCanal,
  lerCensoFechado,
  lerDataDaCopia,
  lerEspelhoLeitos,
  lerFinanceiroMensal,
  lerLeiturasPainel,
  lerLeitos,
  lerMovimentoInternacao,
  lerOperacionalMensal,
  lerPacienteDaInternacao,
  type LeitosLegado,
  type MarcaVigia,
  type NucleoLegado,
  type OperacionalMensalLido,
  type PacienteDaInternacaoLido,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';

export const FONTE_INTERNACAO = Symbol('FONTE_INTERNACAO');

export interface CtxInternacao {
  readonly rede: string;
  readonly hospital: string;
  readonly traceId: string;
}

export type CensoFechadoLido = Pick<CensoDia, 'linhas' | 'horaFechamento' | 'versaoCalculo' | 'geradoEm'>;

export interface FonteInternacao {
  readonly destino: 'legado' | 'memoria';
  leiturasPainel(c: CtxInternacao): Promise<LeiturasPainel>;
  pacienteDaInternacao(c: CtxInternacao, reg: number): Promise<PacienteDaInternacaoLido | null>;
  movimento(c: CtxInternacao): Promise<MovimentoInternacao>;
  conferencia(c: CtxInternacao): Promise<{ cadastro: LeitosLegado; espelho: EspelhoLegado }>;
  censoFechado(
    c: CtxInternacao,
    data: string,
    tipos: ReadonlyMap<number, string>,
    nomes: ReadonlyMap<string, string>,
    intensivas: readonly number[],
  ): Promise<CensoFechadoLido | null>;
  diasFechados(c: CtxInternacao, de: string, ate: string): Promise<string[]>;
  operacional(c: CtxInternacao, de: string, ate: string): Promise<OperacionalMensalLido[]>;
  financeiro(c: CtxInternacao, de: string, ate: string): Promise<FinanceiroMensalLido[]>;
  dataDaCopia(c: CtxInternacao): Promise<Date | null>;
  canal(c: CtxInternacao, canal: CanalVigia, marca: MarcaVigia): Promise<LeituraCanal>;
}

export function fonteInternacaoLegado(nucleo: Pick<NucleoLegado, 'lerSomente'>): FonteInternacao {
  const ler = <T>(c: CtxInternacao, fn: (l: Leitor) => Promise<T>) =>
    nucleo.lerSomente({ rede: c.rede, hospital: c.hospital, traceId: c.traceId.slice(0, 64) }, fn);
  return {
    destino: 'legado',
    leiturasPainel: (c) => ler(c, (l) => lerLeiturasPainel(l)),
    pacienteDaInternacao: (c, reg) => ler(c, (l) => lerPacienteDaInternacao(l, reg)),
    movimento: (c) => ler(c, (l) => lerMovimentoInternacao(l)),
    conferencia: (c) =>
      ler(c, async (l) => ({ cadastro: await lerLeitos(l), espelho: await lerEspelhoLeitos(l) })),
    censoFechado: (c, data, tipos, nomes, intensivas) =>
      ler(c, (l) => lerCensoFechado(l, c.hospital, data, tipos, nomes, intensivas)),
    diasFechados: (c, de, ate) => ler(c, (l) => diasFechados(l, c.hospital, de, ate)),
    operacional: (c, de, ate) => ler(c, (l) => lerOperacionalMensal(l, de, ate)),
    financeiro: (c, de, ate) => ler(c, (l) => lerFinanceiroMensal(l, de, ate)),
    dataDaCopia: (c) => ler(c, (l) => lerDataDaCopia(l)),
    canal: (c, canal, marca) => ler(c, (l) => lerCanal(l, canal, marca, c.hospital)),
  };
}

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
    destino: 'legado',
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
