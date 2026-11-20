// Cliente da tela "Orçamento empresarial" (M54, etapa 7): apoio, versões do ano, criar (vazia, cópia ou do realizado com
// ajuste), detalhe com as ações, gravar as linhas que mudaram pela versão lida, aprovar, descartar e o orçado ×
// realizado. As gravações vão com o CSRF e a Idempotency-Key (uma por intenção); Problem Details viram ErroApi com o
// código da recusa. As respostas seguem os tipos de @sgh/contratos.
import type {
  AprovarOrcamento,
  ApoioOrcamento,
  ComparativoOrcamento,
  CriarVersaoOrcamento,
  DescartarOrcamento,
  GravarLinhasOrcamento,
  OrcamentoDetalhe,
  OrcamentoVersao,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../exames/api-exames.js';

const O = '/api/financeiro/orcamento';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

export interface ResultadoGravarLinhas {
  readonly versao: number;
  readonly mudou: boolean;
  readonly incluidas: number;
  readonly alteradas: number;
  readonly removidas: number;
  readonly totalAntes: number;
  readonly totalDepois: number;
}

export const lerApoioOrcamento = () => ler(`${O}/apoio`, confiar<ApoioOrcamento>());
export const lerVersoesOrcamento = (ano: number | null) =>
  ler(`${O}/versoes${qs({ ano })}`, confiar<{ versoes: OrcamentoVersao[] }>());
export const criarVersaoOrcamento = (e: CriarVersaoOrcamento) =>
  enviar(
    `${O}/versoes`,
    e,
    confiar<{ id: number; numero: number; linhas: number; descartadas: number }>(),
    novaChave('m54.orc.criar'),
  );
export const lerDetalheOrcamento = (id: number) => ler(`${O}/versoes/${id}`, confiar<OrcamentoDetalhe>());
export const gravarLinhasOrcamento = (id: number, e: GravarLinhasOrcamento) =>
  enviar(`${O}/versoes/${id}/linhas`, e, confiar<ResultadoGravarLinhas>(), novaChave('m54.orc.linhas'));
export const aprovarOrcamento = (id: number, e: AprovarOrcamento) =>
  enviar(
    `${O}/versoes/${id}/aprovacao`,
    e,
    confiar<{ substituida: number | null }>(),
    novaChave('m54.orc.aprovar'),
  );
export const descartarOrcamento = (id: number, e: DescartarOrcamento) =>
  enviar(`${O}/versoes/${id}/descarte`, e, confiar<{ descartada: true }>(), novaChave('m54.orc.descartar'));
export const lerComparativoOrcamento = (
  id: number,
  visao: 'linha' | 'centro' | 'item',
  mesAte: number,
  recorte: { centro?: number | null; item?: string | null } = {},
) =>
  ler(
    `${O}/versoes/${id}/comparativo${qs({ visao, mesAte, centro: recorte.centro, item: recorte.item })}`,
    confiar<ComparativoOrcamento>(),
  );
