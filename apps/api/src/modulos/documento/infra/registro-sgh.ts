// Registro das emissões no banco do estabelecimento (SGH_DOCUMENTO_EMISSAO), pelo núcleo do legado (M23): a mesma
// interface do registro em memória do M09, com a reserva e a confirmação em transações SGH_ curtas e as leituras em
// READ ONLY. Usado pela emissão dos documentos do prontuário; a validação pública pelo QR lê daqui.
import { ErroEmissao, ErroViaOcupada, type EmissaoDocumento } from '@sgh/dominio-documento';
import {
  confirmarEmissao,
  emissaoPorId,
  emissaoPorQr,
  emissoesDaOrigem,
  emissoesDoOriginal,
  ErroRegistroEmissao,
  type NucleoLegado,
  reservarEmissao,
} from '@sgh/legado';
import type { RegistroEmissoes } from './registro.js';

const traduzir = (e: unknown): never => {
  if (e instanceof ErroRegistroEmissao)
    throw e.viaOcupada ? new ErroViaOcupada(e.message) : new ErroEmissao(e.message);
  throw e;
};

export class RegistroEmissoesSgh implements RegistroEmissoes {
  private readonly nucleo: NucleoLegado;
  private readonly hospital: string;
  constructor(nucleo: NucleoLegado, hospital: string) {
    this.nucleo = nucleo;
    this.hospital = hospital;
  }

  private ctx() {
    return { rede: this.nucleo.rede, hospital: this.hospital, traceId: 'documento-emissao' };
  }

  async reservar(e: EmissaoDocumento): Promise<void> {
    await this.nucleo.gravarSgh(this.ctx(), (x) => reservarEmissao(x, e)).catch(traduzir);
  }

  async confirmar(id: string, versaoS3: string): Promise<EmissaoDocumento> {
    return this.nucleo.gravarSgh(this.ctx(), (x) => confirmarEmissao(x, id, versaoS3)).catch(traduzir);
  }

  porId(id: string): Promise<EmissaoDocumento | null> {
    return this.nucleo.lerSomente(this.ctx(), (l) => emissaoPorId(l, id));
  }

  porQr(identificador: string): Promise<EmissaoDocumento | null> {
    return this.nucleo.lerSomente(this.ctx(), (l) => emissaoPorQr(l, identificador));
  }

  doOriginal(idOriginal: string): Promise<EmissaoDocumento[]> {
    return this.nucleo.lerSomente(this.ctx(), (l) => emissoesDoOriginal(l, idOriginal));
  }

  daOrigem(tipo: string, idLegado: number): Promise<EmissaoDocumento[]> {
    return this.nucleo.lerSomente(this.ctx(), (l) => emissoesDaOrigem(l, tipo, idLegado));
  }
}
