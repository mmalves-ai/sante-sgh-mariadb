// Regra 10 do M55 (etapa 4): o documento do processo formal de compra (termo de referência, registro da etapa ou ata)
// em PDF/A, pelo serviço de emissão do M09: Gotenberg (PDF/A-2b), S3 com Object Lock (nunca sobrescreve), SHA-256 e
// QR de validação. O conteúdo vem da regra pura `documentoLicitacao`, sobre o detalhe já filtrado pelo sigilo.
import {
  documentoLicitacao,
  type DocumentoLicitacao,
  type TipoDocumentoLicitacao,
  VERSAO_MODELO_DOCUMENTO_LICITACAO,
} from '@sgh/contratos/regras-suprimentos';
import type { LicitacaoDetalhe } from '@sgh/contratos';
import type { FonteDocumento } from '../documento/public-api.js';
import { ErroProblema } from '../../problema.filter.js';

type EmissaoFeita = Awaited<ReturnType<FonteDocumento['emissao']['emitir']>>;

export async function emitirDocumentoLicitacao(
  fonte: Pick<FonteDocumento, 'emissao'> | null,
  ctx: { readonly rede: string; readonly hospital: string; readonly autor: string },
  d: LicitacaoDetalhe,
  tipo: TipoDocumentoLicitacao,
): Promise<{ documento: DocumentoLicitacao; feita: EmissaoFeita }> {
  const m = documentoLicitacao(d, tipo);
  if (!m.ok)
    throw new ErroProblema('recusa-de-negocio', 409, 'Documento indisponível', m.motivo, {
      codigo: 'licitacao-documento-indisponivel',
    });
  if (!fonte)
    throw new ErroProblema(
      'indisponivel',
      503,
      'Emissão indisponível',
      'O serviço de emissão de documentos não está configurado.',
    );
  try {
    const feita = await fonte.emissao.emitir({
      rede: ctx.rede,
      estabelecimento: ctx.hospital,
      modelo: m.documento.modelo,
      versaoModelo: VERSAO_MODELO_DOCUMENTO_LICITACAO,
      titulo: m.documento.titulo,
      origem: { tipo: 'licitacao', idLegado: d.id },
      campos: m.documento.campos,
      autor: ctx.autor,
    });
    return { documento: m.documento, feita };
  } catch {
    throw new ErroProblema(
      'indisponivel',
      503,
      'Emissão indisponível',
      'Não foi possível gerar o PDF agora: tente de novo.',
    );
  }
}
