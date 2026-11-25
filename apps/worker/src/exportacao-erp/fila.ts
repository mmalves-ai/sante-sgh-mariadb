// Job da fila com o ERP corporativo no worker (F8, 08-INTG L136), ao lado do lote contábil (exportacao-contabil/lote.ts):
// pega os lotes gerados, envia cada um pelo adaptador do ERP (fora de produção, o simulador do domínio: nada sai para
// fora), registra o protocolo e importa o retorno item a item pela regra idempotente do domínio (aplicarRetornoErp). Um
// lote que falha no envio fica como gerado (volta no próximo ciclo) e é contado; o retorno repetido não muda nada. Log
// só com contagens.
import {
  aplicarRetornoErp,
  type ItemAtualErp,
  type ResultadoRetornoErp,
  type RetornoItemErp,
  simularRetornoErp,
  type SituacaoLoteErp,
  type TipoFilaErp,
} from '@sgh/dominio-integracao';

export interface LoteParaEnvioErp {
  readonly id: number;
  readonly numero: string;
  readonly tipo: TipoFilaErp;
  readonly versao: number;
  readonly itens: readonly {
    sequencia: number;
    cpfCnpj: string | null;
    valor: number | null;
    conteudo: unknown;
  }[];
}

export interface FonteFilaErp {
  lotesParaEnviar(hospital: string, teto: number): Promise<readonly LoteParaEnvioErp[]>;
  /** Marca o lote como enviado (com a versão lida) e devolve a versão nova. */
  registrarEnvio(hospital: string, id: number, versao: number, protocolo: string): Promise<number>;
  itensAtuais(
    hospital: string,
    id: number,
  ): Promise<{ situacao: SituacaoLoteErp; itens: readonly ItemAtualErp[] }>;
  gravarRetorno(hospital: string, id: number, versao: number, r: ResultadoRetornoErp): Promise<void>;
}

export interface AdaptadorErpWorker {
  enviar(l: LoteParaEnvioErp): Promise<{ protocolo: string; itens: RetornoItemErp[] }>;
}

export const adaptadorErpSimuladoWorker: AdaptadorErpWorker = {
  enviar: async (l) => ({
    protocolo: `SIM-${l.numero}`,
    itens: simularRetornoErp(l.numero, l.tipo, l.itens),
  }),
};

export interface CicloFilaErp {
  readonly enviados: number;
  readonly falhas: number;
  readonly itensAlterados: number;
  readonly rejeitados: number;
}

export async function processarFilaErp(
  fonte: FonteFilaErp,
  adaptador: AdaptadorErpWorker,
  hospital: string,
  teto = 20,
): Promise<CicloFilaErp> {
  let enviados = 0;
  let falhas = 0;
  let itensAlterados = 0;
  let rejeitados = 0;
  for (const l of await fonte.lotesParaEnviar(hospital, teto)) {
    let resposta: { protocolo: string; itens: RetornoItemErp[] };
    try {
      resposta = await adaptador.enviar(l);
    } catch {
      falhas++;
      continue;
    }
    const versao = await fonte.registrarEnvio(hospital, l.id, l.versao, resposta.protocolo.slice(0, 100));
    const atual = await fonte.itensAtuais(hospital, l.id);
    const r = aplicarRetornoErp(atual.situacao, atual.itens, resposta.itens);
    await fonte.gravarRetorno(hospital, l.id, versao, r);
    enviados++;
    itensAlterados += r.mudancas.length;
    rejeitados += r.quantidadeErros;
  }
  return { enviados, falhas, itensAlterados, rejeitados };
}

/** Importa um retorno avulso do ERP (arquivo ou chamada do ERP), idempotente. */
export async function importarRetornoErp(
  fonte: FonteFilaErp,
  hospital: string,
  id: number,
  versao: number,
  retorno: readonly RetornoItemErp[],
): Promise<ResultadoRetornoErp> {
  const atual = await fonte.itensAtuais(hospital, id);
  const r = aplicarRetornoErp(atual.situacao, atual.itens, retorno);
  if (r.mudancas.length > 0 || r.situacaoLote !== atual.situacao)
    await fonte.gravarRetorno(hospital, id, versao, r);
  return r;
}
