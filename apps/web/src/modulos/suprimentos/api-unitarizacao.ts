// Cliente do fracionamento e unitarização de dose (C2-092, 05-SUP linha 11): o painel (regras, lotes de origem com
// saldo por local, locais, capelas, unidades e últimas ordens), o cadastro e a ativação da regra, a ordem executada
// (baixa do lote de origem, entrada das doses e uma etiqueta por dose) e o rastreio dose → lote. A gravação vai com o
// CSRF e a Idempotency-Key: a repetição do mesmo pedido devolve o resultado da primeira.
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChaveContrato } from './api-contrato.js';

export interface RegraFracionamentoTela {
  readonly id: number;
  readonly versao: number;
  readonly origem: number;
  readonly origemNome: string;
  readonly resultante: number;
  readonly resultanteNome: string;
  readonly quantidadeOrigem: number;
  readonly rendimento: number;
  readonly unidade: number;
  readonly unidadeSigla: string;
  readonly validadeHoras: number | null;
  readonly exigeCapela: boolean;
  readonly reaproveitaSobra: boolean;
  readonly ativa: boolean;
}

export interface LoteOrigemTela {
  readonly id: number;
  readonly insumo: number;
  readonly local: number;
  readonly numero: string;
  readonly validade: string;
  readonly saldo: number;
}

export interface OrdemListadaTela {
  readonly id: number;
  readonly numero: number;
  readonly tipo: string;
  readonly executadaEm: string;
  readonly origemNome: string;
  readonly loteOrigem: string;
  readonly resultanteNome: string;
  readonly doses: number;
  readonly perda: number;
  readonly validadeDose: string | null;
  readonly situacao: string;
}

export interface PainelUnitarizacaoTela {
  readonly hoje: string;
  readonly agora: string;
  readonly regras: readonly RegraFracionamentoTela[];
  readonly lotes: readonly LoteOrigemTela[];
  readonly locais: readonly { readonly id: number; readonly nome: string }[];
  readonly capelas: readonly { readonly id: number; readonly nome: string; readonly situacao: string }[];
  readonly unidades: readonly { readonly id: number; readonly sigla: string }[];
  readonly ordens: readonly OrdemListadaTela[];
}

export interface RegraFracionamentoEntradaTela {
  readonly origem: number;
  readonly resultante: number;
  readonly quantidadeOrigem: number;
  readonly rendimento: number;
  readonly unidade: number;
  readonly validadeHoras: number | null;
  readonly exigeCapela: boolean;
  readonly reaproveitaSobra: boolean;
}

export interface OrdemUnitarizacaoEntradaTela {
  readonly regra: number;
  readonly tipo: 'fracionamento' | 'unitarizacao' | 'reembalagem';
  readonly local: number;
  readonly lote: number;
  readonly capela: number | null;
  readonly quantidadeOrigem: number;
  readonly doses: number;
  readonly perda: number;
  readonly rupturaLacre: boolean;
  readonly percentualEstabilidade: number | null;
  readonly observacao: string | null;
}

export interface DoseEmitidaTela {
  readonly id: number;
  readonly etiqueta: number;
  readonly validade: string;
  readonly identificador: string;
  readonly linhas: readonly string[];
  readonly datamatrix: string;
  readonly barras: string;
  readonly legivel: string;
}

export interface OrdemGravadaTela {
  readonly id: number;
  readonly numero: number;
  readonly loteDoses: number;
  readonly validadeDose: string;
  readonly doses: readonly DoseEmitidaTela[];
  readonly mensagem: string;
}

export interface RastreioDoseTela {
  readonly dose: {
    readonly id: number;
    readonly identificador: string;
    readonly insumo: string;
    readonly quantidade: number;
    readonly unidade: string;
    readonly validadeOriginal: string | null;
    readonly validadeNova: string;
    readonly unitarizadaEm: string;
    readonly situacao: string;
    readonly etiquetaSituacao: string | null;
  };
  readonly ordem: {
    readonly id: number;
    readonly numero: number;
    readonly tipo: string;
    readonly executadaEm: string | null;
    readonly farmaceutico: string | null;
    readonly capela: string | null;
    readonly rupturaLacre: boolean;
    readonly percentualEstabilidade: number | null;
  };
  readonly loteOrigem: {
    readonly id: number;
    readonly numero: string;
    readonly validade: string;
    readonly insumo: string;
    readonly fabricante: string | null;
  } | null;
  readonly irmas: readonly { readonly identificador: string; readonly situacao: string }[];
}

const B = '/api/farmacia/unitarizacao';

async function ler<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

async function gravar<T>(url: string, corpo: unknown, chave: string): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave,
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export const painelUnitarizacao = () => ler<PainelUnitarizacaoTela>(B);

export const rastrearDose = (identificador: string) =>
  ler<RastreioDoseTela>(`${B}/doses/${encodeURIComponent(identificador)}`);

export const salvarRegraFracionamento = (
  e: RegraFracionamentoEntradaTela,
  chave = novaChaveContrato('unit-regra'),
) => gravar<{ id: number; mensagem: string }>(`${B}/regras`, e, chave);

export const ativarRegraFracionamento = (
  regra: number,
  e: { readonly ativa: boolean; readonly versaoVista: number },
  chave = novaChaveContrato('unit-ativa'),
) => gravar<{ id: number; mensagem: string }>(`${B}/regras/${regra}/ativacao`, e, chave);

export const executarOrdemUnitarizacao = (
  e: OrdemUnitarizacaoEntradaTela,
  chave = novaChaveContrato('unit-ordem'),
) => gravar<OrdemGravadaTela>(`${B}/ordens`, e, chave);
