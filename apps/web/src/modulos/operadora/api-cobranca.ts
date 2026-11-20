// Cliente da cobrança e das mensalidades da operadora própria (M56, etapa 3, F2): tela, lista com as contagens, ficha,
// prévia e geração das mensalidades, lançamentos, baixa, cancelamento, estorno, acordo, inadimplência, notificação e
// reajuste, validados pelos contratos. As gravações levam o CSRF e a Idempotency-Key; Problem Details viram ErroApi.
import {
  type CobrancaDetalhe,
  type Cobrancas,
  esquemaCobrancaDetalhe,
  esquemaCobrancas,
  esquemaInadimplencia,
  esquemaPreviaAcordo,
  esquemaPreviaMensalidades,
  esquemaReajustes,
  esquemaResultadoAcordo,
  esquemaResultadoCobranca,
  esquemaResultadoGeracao,
  esquemaTelaCobranca,
  type InadimplenciaOperadora,
  type PreviaAcordo,
  type PreviaMensalidades,
  type ReajustesOperadora,
  type ResultadoAcordo,
  type ResultadoCobranca,
  type ResultadoGeracao,
  type TelaCobranca,
} from '@sgh/contratos';
import { enviar, ler, novaChave, qs } from '../exames/api-exames.js';

const O = '/api/operadora';

export const lerTelaCobranca = (): Promise<TelaCobranca> => ler(`${O}/cobranca/tela`, esquemaTelaCobranca);

export const lerCobrancas = (f: {
  operadora: number | null;
  competencia?: string | null;
  situacao?: string | null;
  tipo?: number | null;
  contrato?: number | null;
  vencidas?: boolean;
  busca?: string | null;
  apos?: number | null;
}): Promise<Cobrancas> =>
  ler(
    `${O}/cobrancas${qs({
      operadora: f.operadora,
      competencia: f.competencia,
      situacao: f.situacao,
      tipo: f.tipo,
      contrato: f.contrato,
      vencidas: f.vencidas ? '1' : null,
      busca: f.busca,
      apos: f.apos,
    })}`,
    esquemaCobrancas,
  );

export const lerCobranca = (id: number): Promise<CobrancaDetalhe> =>
  ler(`${O}/cobrancas/${id}`, esquemaCobrancaDetalhe);

export const previaMensalidades = (corpo: unknown): Promise<PreviaMensalidades> =>
  enviar(
    `${O}/cobrancas/mensalidades/previa`,
    corpo,
    esquemaPreviaMensalidades,
    novaChave('cobranca-previa'),
  );
export const gerarMensalidades = (corpo: unknown): Promise<ResultadoGeracao> =>
  enviar(`${O}/cobrancas/mensalidades`, corpo, esquemaResultadoGeracao, novaChave('cobranca-gerar'));
export const lancarCoparticipacao = (corpo: unknown): Promise<ResultadoCobranca> =>
  enviar(`${O}/cobrancas/coparticipacao`, corpo, esquemaResultadoCobranca, novaChave('cobranca-copart'));
export const lancarAvulsa = (corpo: unknown): Promise<ResultadoCobranca> =>
  enviar(`${O}/cobrancas/avulsa`, corpo, esquemaResultadoCobranca, novaChave('cobranca-avulsa'));
export const baixarCobranca = (id: number, corpo: unknown): Promise<ResultadoCobranca> =>
  enviar(`${O}/cobrancas/${id}/baixa`, corpo, esquemaResultadoCobranca, novaChave('cobranca-baixa'));
export const cancelarCobranca = (id: number, corpo: unknown): Promise<ResultadoCobranca> =>
  enviar(
    `${O}/cobrancas/${id}/cancelamento`,
    corpo,
    esquemaResultadoCobranca,
    novaChave('cobranca-cancelar'),
  );
export const estornarCobranca = (id: number, corpo: unknown): Promise<ResultadoCobranca> =>
  enviar(`${O}/cobrancas/${id}/estorno`, corpo, esquemaResultadoCobranca, novaChave('cobranca-estorno'));
export const previaAcordo = (corpo: unknown): Promise<PreviaAcordo> =>
  enviar(`${O}/cobrancas/acordo/previa`, corpo, esquemaPreviaAcordo, novaChave('cobranca-acordo-previa'));
export const fazerAcordo = (corpo: unknown): Promise<ResultadoAcordo> =>
  enviar(`${O}/cobrancas/acordo`, corpo, esquemaResultadoAcordo, novaChave('cobranca-acordo'));

export const lerInadimplencia = (
  operadora: number | null,
  apos: number | null,
): Promise<InadimplenciaOperadora> =>
  ler(`${O}/cobranca/inadimplencia${qs({ operadora, apos })}`, esquemaInadimplencia);
export const notificarInadimplencia = (corpo: unknown): Promise<ResultadoCobranca> =>
  enviar(
    `${O}/cobranca/inadimplencia/notificacao`,
    corpo,
    esquemaResultadoCobranca,
    novaChave('cobranca-notificar'),
  );

export const lerReajustes = (operadora: number | null, apos: number | null): Promise<ReajustesOperadora> =>
  ler(`${O}/reajustes${qs({ operadora, apos })}`, esquemaReajustes);
export const reajustarContrato = (corpo: unknown): Promise<ResultadoCobranca> =>
  enviar(`${O}/reajustes`, corpo, esquemaResultadoCobranca, novaChave('cobranca-reajuste'));
export const cancelarReajuste = (id: number, motivo: string): Promise<ResultadoCobranca> =>
  enviar(
    `${O}/reajustes/${id}/cancelamento`,
    { motivo },
    esquemaResultadoCobranca,
    novaChave('cobranca-reajuste-cancelar'),
  );
