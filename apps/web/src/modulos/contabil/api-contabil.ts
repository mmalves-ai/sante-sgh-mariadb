// Cliente das telas da contabilidade, etapa 1 (M54-F1): o apoio (chave, permissões, máscara e vocabulários), o plano de
// contas com os problemas, a inclusão e a alteração da conta, as versões das regras, a simulação (não grava), a
// publicação com a senha, os fatos lidos dos módulos (lista e resumo por fonte) e a conferência do reprocessamento. O
// servidor é a fonte: as respostas são os tipos de @sgh/contratos (ROTAS_CONTABIL_F1), conferidos só na forma.
import {
  type ApoioContabil,
  type ContaPlanoEntrada,
  type FatosContabeis,
  type PlanoContabil,
  type RegraContabilEntrada,
  type RegrasContabeis,
  type ResultadoContaPlano,
  type ResultadoPublicacaoRegra,
  type ResultadoReprocessamento,
  type ResumoFatosContabeis,
  ROTAS_CONTABIL_F1 as R,
  type SimulacaoRegra,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const A = '/api';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const url = (r: { caminho: string }) => `${A}/${r.caminho}`;

let sequencia = 0;
/** Idempotency-Key de uma intenção de gravar (única neste navegador). */
export function novaChave(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m54.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

export const lerApoioContabil = () => ler(url(R.apoio), confiar<ApoioContabil>());
/** O apoio da tela dos fatos (permissão de acompanhar os fatos, sem a do plano). */
export const lerApoioFatos = () => ler(url(R.apoioFatos), confiar<ApoioContabil>());
export const lerPlano = (empresa: number) =>
  ler(`${url(R.plano)}${qs({ empresa })}`, confiar<PlanoContabil>());
export const lerRegras = (f: { empresa: number; origem?: number | null; tipoFato?: string | null }) =>
  ler(
    `${url(R.regras)}${qs({ empresa: f.empresa, origem: f.origem, tipoFato: f.tipoFato })}`,
    confiar<RegrasContabeis>(),
  );
export const lerFatos = (f: {
  empresa?: number | null;
  competencia?: string | null;
  origem?: number | null;
  tipoFato?: string | null;
  situacao?: string | null;
  pagina?: number;
  tamanho?: number;
}) => ler(`${url(R.fatos)}${qs(f)}`, confiar<FatosContabeis>());
export const lerResumoFatos = () => ler(url(R.resumoFatos), confiar<ResumoFatosContabeis>());

export const incluirConta = (conta: ContaPlanoEntrada) =>
  enviar(url(R.incluirConta), conta, confiar<ResultadoContaPlano>(), novaChave('conta'));

export interface AlteracaoConta {
  readonly empresa: number;
  readonly codigo: string;
  readonly versao: number;
  readonly nome?: string;
  readonly referencialTipo?: number | null;
  readonly referencialConta?: string | null;
  readonly contaExportacao?: number | null;
  readonly exigeCentroCusto?: boolean;
  readonly ativa?: boolean;
}
export const alterarConta = (a: AlteracaoConta) =>
  enviar(url(R.alterarConta), a, confiar<ResultadoContaPlano>(), novaChave('alterar'));

export const simularRegra = (regra: RegraContabilEntrada, competencia: string) =>
  enviar(url(R.simular), { regra, competencia }, confiar<SimulacaoRegra>(), novaChave('simular'));

export const publicarRegra = (regra: RegraContabilEntrada, justificativa: string, senha: string) =>
  enviar(
    url(R.publicar),
    { regra, justificativa, senha },
    confiar<ResultadoPublicacaoRegra>(),
    novaChave('publicar'),
  );

export const reprocessarPeriodo = (p: {
  empresa: number;
  competencia: string;
  somenteConferir: boolean;
  senha?: string;
}) => enviar(url(R.reprocessar), p, confiar<ResultadoReprocessamento>(), novaChave('reprocessar'));
