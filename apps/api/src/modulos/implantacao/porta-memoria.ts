// A porta sintética da conferência (dev/ci, E2E): uma instalação correta no Firebird 3 com Srp, canal cifrado, conta
// própria com o papel da aplicação e todos os scripts do pacote registrados com o hash do arquivo. Nada vai ao banco.
import type { ConexaoAtualLida, ScriptRegistradoLido } from '@sgh/legado';
import { formatarHoraDeParede } from '@sgh/dominio-config';
import type { PortaImplantacao } from './porta.js';

export class PortaImplantacaoMemoria implements PortaImplantacao {
  readonly destino = 'memoria' as const;

  constructor(
    private readonly pacote: () => readonly ScriptRegistradoLido[],
    private readonly agora: () => number = Date.now,
  ) {}

  conexao(): Promise<ConexaoAtualLida> {
    return Promise.resolve({
      versaoMotor: '3.0.14',
      charsetBanco: 'NONE',
      charsetConexaoId: 0,
      autenticacao: 'Srp256',
      canalCifrado: true,
      canalComprimido: false,
      protocolo: 'TCPv4',
      conta: 'SGH_APP',
      papel: 'SGH_APLICACAO',
    });
  }

  scriptsRegistrados(): Promise<ScriptRegistradoLido[]> {
    return Promise.resolve(this.pacote().map((s) => ({ numero: s.numero, hash: s.hash })));
  }

  /** O banco sintético num servidor em UTC-03:00 com o relógio em dia. */
  relogioBanco(): Promise<string> {
    return Promise.resolve(formatarHoraDeParede(this.agora() - 3 * 3_600_000));
  }
}
