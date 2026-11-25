// Job da fila com o ERP corporativo no worker (F8, 08-INTG L136), ao lado do lote contábil (exportacao-contabil/lote.ts):
// pega os lotes gerados, RESERVA cada um ('enviando', sob trava e versão) antes de chamar o adaptador do ERP (fora de
// produção, o simulador do domínio: nada sai para fora), registra o protocolo e importa o retorno item a item pela regra
// idempotente do domínio (aplicarRetornoErp). A reserva impede que a tela envie ou cancele o lote em paralelo e que o
// mesmo lote vá duas vezes ao ERP. Se o adaptador recusa, o lote volta a gerado (próximo ciclo). Cada lote é tratado à
// parte: uma falha (lote que mudou, gravação que falhou) conta como falha e não interrompe os demais. O lote enviado sem
// retorno gravado (processado_em vazio) é retomado no ciclo seguinte pela consulta ao ERP com o protocolo. Log só com
// contagens.
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

export interface LoteSemRetornoErp extends LoteParaEnvioErp {
  readonly protocolo: string;
}

export interface FonteFilaErp {
  lotesParaEnviar(hospital: string, teto: number): Promise<readonly LoteParaEnvioErp[]>;
  /** Reserva o lote gerado ('enviando', com a versão lida) e devolve a versão nova; lote que mudou lança. */
  reservarEnvio(hospital: string, id: number, versao: number): Promise<number>;
  /** O adaptador recusou: o lote reservado volta a gerado. */
  liberarEnvio(hospital: string, id: number, versao: number): Promise<void>;
  /** Marca o lote reservado como enviado com o protocolo e devolve a versão nova. */
  registrarEnvio(hospital: string, id: number, versao: number, protocolo: string): Promise<number>;
  /** Lotes enviados ainda sem retorno gravado (processado_em vazio), com o protocolo e a versão atual. */
  lotesSemRetorno(hospital: string, teto: number): Promise<readonly LoteSemRetornoErp[]>;
  itensAtuais(
    hospital: string,
    id: number,
  ): Promise<{ situacao: SituacaoLoteErp; itens: readonly ItemAtualErp[] }>;
  gravarRetorno(hospital: string, id: number, versao: number, r: ResultadoRetornoErp): Promise<void>;
}

export interface AdaptadorErpWorker {
  enviar(l: LoteParaEnvioErp): Promise<{ protocolo: string; itens: RetornoItemErp[] }>;
  /** O retorno de um lote já enviado, consultado ao ERP pelo protocolo (retomada). */
  consultarRetorno(l: LoteSemRetornoErp): Promise<RetornoItemErp[]>;
}

export const adaptadorErpSimuladoWorker: AdaptadorErpWorker = {
  enviar: async (l) => ({
    protocolo: `SIM-${l.numero}`,
    itens: simularRetornoErp(l.numero, l.tipo, l.itens),
  }),
  consultarRetorno: async (l) => simularRetornoErp(l.numero, l.tipo, l.itens),
};

export interface CicloFilaErp {
  readonly enviados: number;
  /** Lotes enviados antes cujo retorno foi gravado agora (retomada). */
  readonly retomados: number;
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
  let retomados = 0;
  let falhas = 0;
  let itensAlterados = 0;
  let rejeitados = 0;
  const retorno = async (id: number, versao: number, itens: readonly RetornoItemErp[]) => {
    const atual = await fonte.itensAtuais(hospital, id);
    const r = aplicarRetornoErp(atual.situacao, atual.itens, itens);
    if (r.mudancas.length > 0 || r.situacaoLote !== atual.situacao)
      await fonte.gravarRetorno(hospital, id, versao, r);
    itensAlterados += r.mudancas.length;
    rejeitados += r.quantidadeErros;
    return r;
  };
  // 1) Retomada: o lote enviado sem retorno gravado (falha depois do envio, ou itens ainda pendentes no ERP).
  for (const l of await fonte.lotesSemRetorno(hospital, teto)) {
    try {
      const r = await retorno(l.id, l.versao, await adaptador.consultarRetorno(l));
      if (r.situacaoLote !== 'enviado') retomados++;
    } catch {
      falhas++;
    }
  }
  // 2) Envio dos gerados: reserva, envio, protocolo e retorno, cada lote à parte.
  for (const l of await fonte.lotesParaEnviar(hospital, teto)) {
    try {
      const reservado = await fonte.reservarEnvio(hospital, l.id, l.versao);
      let resposta: { protocolo: string; itens: RetornoItemErp[] };
      try {
        resposta = await adaptador.enviar(l);
      } catch {
        falhas++;
        await fonte.liberarEnvio(hospital, l.id, reservado);
        continue;
      }
      const versao = await fonte.registrarEnvio(hospital, l.id, reservado, resposta.protocolo.slice(0, 100));
      enviados++;
      await retorno(l.id, versao, resposta.itens);
    } catch {
      falhas++;
    }
  }
  return { enviados, retomados, falhas, itensAlterados, rejeitados };
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
