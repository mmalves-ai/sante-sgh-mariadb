// Registro das emissões (SGH_DOCUMENTO_EMISSAO, packages/legado/src/documento/sgh/0101_documento_emissao.sql).
// Duas etapas, nesta ordem (revisão do M09):
//   1. `reservar`: a linha entra ANTES do PUT no S3, já com via, chave, QR e SHA-256 (ESTADO 'reservado').
//      A unicidade (UUID, chave, QR e (ID_ORIGINAL, VIA)) é conferida aqui: duas reemissões ao mesmo tempo não
//      ganham a mesma via, e quem perde tenta a próxima sem ter gravado nada no S3.
//   2. `confirmar`: depois do PUT, a única alteração permitida — de 'reservado' para 'emitido', com a versão
//      do S3 (`x-amz-version-id`). No banco, o usuário da aplicação recebe só INSERT, SELECT e
//      UPDATE (ESTADO, VERSAO_S3) (concessão por coluna, deploy).
// Assim, nenhum PDF travado por COMPLIANCE fica sem linha: se o PUT falha, a reserva fica sem objeto (e a
// validação pública não a mostra); se a confirmação falha, a linha já tem chave e hash do objeto gravado.
// No spike, o registro é em memória: a gravação na tabela SGH_ passa pelo executor do M04.
import { type EmissaoDocumento, ErroEmissao, ErroViaOcupada } from '@sgh/dominio-documento';

export interface RegistroEmissoes {
  /**
   * Reserva a emissão (versaoS3 null). Lança ErroViaOcupada se a via do mesmo original já existe. Devolve o id da linha
   * (emissao_documento.id) quando o registro é do banco, para o vínculo do arquivo guardado.
   */
  reservar(e: EmissaoDocumento): Promise<number | void>;
  /** Confirma a reserva com a versão do S3; só de 'reservado' para 'emitido', uma vez. */
  confirmar(id: string, versaoS3: string): Promise<EmissaoDocumento>;
  /** Só emissões confirmadas. */
  porId(id: string): Promise<EmissaoDocumento | null>;
  /** Só emissões confirmadas (a validação pública nunca mostra reserva sem objeto). */
  porQr(identificador: string): Promise<EmissaoDocumento | null>;
  /** Todas as linhas do original, reservas inclusive (para calcular a próxima via). */
  doOriginal(idOriginal: string): Promise<EmissaoDocumento[]>;
  /** As emissões confirmadas de um objeto de origem (a reimpressão acha a 1ª via sem estado no processo). */
  daOrigem(tipo: string, idLegado: number): Promise<EmissaoDocumento[]>;
}

export class RegistroEmissoesMemoria implements RegistroEmissoes {
  private readonly linhas: EmissaoDocumento[] = [];

  // Sem id de linha (memória): o arquivo fica ligado só pela tabela dona.
  async reservar(e: EmissaoDocumento): Promise<number | void> {
    if (e.versaoS3 !== null) throw new ErroEmissao('A reserva entra sem versão do S3.');
    if (e.idOriginal !== null && this.linhas.some((x) => x.idOriginal === e.idOriginal && x.via === e.via)) {
      throw new ErroViaOcupada(`Via ${e.via} já reservada para o original.`);
    }
    if (
      this.linhas.some(
        (x) => x.id === e.id || x.chaveObjeto === e.chaveObjeto || x.identificadorQr === e.identificadorQr,
      )
    ) {
      throw new ErroEmissao('Emissão repetida: o registro é só de inclusão.');
    }
    this.linhas.push(Object.freeze({ ...e }));
  }

  async confirmar(id: string, versaoS3: string): Promise<EmissaoDocumento> {
    const i = this.linhas.findIndex((x) => x.id === id);
    const atual = this.linhas[i];
    if (!atual) throw new ErroEmissao('Reserva da emissão não encontrada.');
    if (atual.versaoS3 !== null) throw new ErroEmissao('Emissão já confirmada.');
    if (!versaoS3.trim() || versaoS3.length > 100) throw new ErroEmissao('Versão do S3 inválida.');
    const confirmada = Object.freeze({ ...atual, versaoS3 });
    this.linhas[i] = confirmada;
    return confirmada;
  }

  async porId(id: string): Promise<EmissaoDocumento | null> {
    return this.linhas.find((x) => x.id === id && x.versaoS3 !== null) ?? null;
  }

  async porQr(identificador: string): Promise<EmissaoDocumento | null> {
    return this.linhas.find((x) => x.identificadorQr === identificador && x.versaoS3 !== null) ?? null;
  }

  async doOriginal(idOriginal: string): Promise<EmissaoDocumento[]> {
    return this.linhas.filter((x) => x.id === idOriginal || x.idOriginal === idOriginal);
  }

  async daOrigem(tipo: string, idLegado: number): Promise<EmissaoDocumento[]> {
    return this.linhas.filter(
      (x) => x.origem.tipo === tipo && x.origem.idLegado === idLegado && x.versaoS3 !== null,
    );
  }
}
