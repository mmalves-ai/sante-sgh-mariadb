// Cliente das telas de gestão do financeiro (F3.8, 07-FIN linhas 98 e 99): reclassificação gerencial de um lançamento
// já gravado e as permissões do financeiro (escopo de contas por usuário, tipos de lançamento por perfil).
import type { ResultadoFinanceiro } from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const P = '/api/financeiro/gestao';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export type AlvoReclassificacao = 'titulo_pagar' | 'titulo_receber' | 'movimento_bancario';
export interface ClassificacaoAtual {
  readonly alvo: AlvoReclassificacao;
  readonly id: number;
  readonly valor: number;
  readonly data: string;
  readonly natureza: { readonly codigo: string; readonly descricao: string; readonly tipo: string } | null;
  readonly rateio: readonly { centroCusto: number; centro: string; percentual: number; valor: number }[];
  readonly substituidas: number;
  readonly reclassificacoes: readonly { em: string; por: string; motivo: string }[];
}
export interface Opcao {
  readonly id: number;
  readonly codigo?: string;
  readonly nome: string;
  readonly login?: string;
}
export interface EscopoConta {
  readonly conta: number;
  readonly nome: string;
  readonly consultar: boolean;
  readonly movimentar: boolean;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
  readonly temLinha: boolean;
}
/** As operações que têm tipo por perfil: o movimento (tipo de lançamento), o título a pagar e o adiantamento (credor). */
export const OPERACOES_TIPO = ['banco', 'contas_pagar', 'adiantamento'] as const;
export type OperacaoTipo = (typeof OPERACOES_TIPO)[number];
export interface TipoDoPerfil {
  readonly tipo: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly liberado: boolean;
}

export const lerClassificacao = (alvo: AlvoReclassificacao, id: number): Promise<ClassificacaoAtual> =>
  ler(`${P}/classificacao${qs({ alvo, id })}`, confiar<ClassificacaoAtual>());
export const lerCentros = (): Promise<Opcao[]> => ler(`${P}/centros`, z.array(confiar<Opcao>()));
export const reclassificar = (
  e: {
    alvo: AlvoReclassificacao;
    id: number;
    classificacao: { grupo: number; subgrupo: number; item: number };
    rateio: { centroCusto: number; percentual: number }[];
    motivo: string;
  },
  chave: string,
): Promise<ResultadoFinanceiro> => enviar(`${P}/reclassificar`, e, confiar<ResultadoFinanceiro>(), chave);

export const lerUsuarios = (): Promise<Opcao[]> => ler(`${P}/usuarios`, z.array(confiar<Opcao>()));
export const lerEscopo = (usuario: number): Promise<{ restrito: boolean; contas: EscopoConta[] }> =>
  ler(`${P}/escopo-contas${qs({ usuario })}`, confiar<{ restrito: boolean; contas: EscopoConta[] }>());
export const gravarEscopo = (
  e: {
    usuario: number;
    conta: number;
    consultar: boolean;
    movimentar: boolean;
    vigenciaInicio: string | null;
    vigenciaFim: string | null;
  },
  chave: string,
): Promise<ResultadoFinanceiro> => enviar(`${P}/escopo-contas`, e, confiar<ResultadoFinanceiro>(), chave);

export interface LancamentoAchado {
  readonly id: number;
  readonly rotulo: string;
  readonly data: string;
  readonly valor: number;
  readonly natureza: string | null;
}
export const buscarLancamentos = (alvo: AlvoReclassificacao, termo: string): Promise<LancamentoAchado[]> =>
  ler(`${P}/lancamentos${qs({ alvo, termo })}`, z.array(confiar<LancamentoAchado>()));
export const gravarRestricaoDoPerfil = (
  e: { perfil: number; restrito: boolean; operacao: OperacaoTipo },
  chave: string,
): Promise<ResultadoFinanceiro> =>
  enviar(`${P}/tipos-lancamento/restricao`, e, confiar<ResultadoFinanceiro>(), chave);

export const lerPerfis = (): Promise<Opcao[]> => ler(`${P}/perfis`, z.array(confiar<Opcao>()));
export const lerTiposDoPerfil = (
  perfil: number,
  operacao: OperacaoTipo,
): Promise<{ restrito: boolean; tipos: TipoDoPerfil[] }> =>
  ler(
    `${P}/tipos-lancamento${qs({ perfil, operacao })}`,
    confiar<{ restrito: boolean; tipos: TipoDoPerfil[] }>(),
  );
export const gravarTipoDoPerfil = (
  e: { perfil: number; tipo: number; liberado: boolean; operacao: OperacaoTipo },
  chave: string,
): Promise<ResultadoFinanceiro> => enviar(`${P}/tipos-lancamento`, e, confiar<ResultadoFinanceiro>(), chave);
