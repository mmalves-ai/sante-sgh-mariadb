// A porta sintética da conferência (dev/ci, E2E): uma instalação correta no MariaDB, com canal cifrado, autenticação
// ed25519, conta própria com o papel da aplicação, todas as migrações do pacote registradas com o hash do arquivo e a
// estrutura igual à homologada. Nada vai ao banco.
import { formatarHoraDeParede } from '@sgh/dominio-config';
import type { ConexaoBanco, EstruturaBanco, MigracaoRegistrada, PortaImplantacao } from './porta.js';

/** O resumo sintético da estrutura (a homologada da sessão sintética é a mesma). */
export const RESUMO_ESTRUTURA_SINTETICA = 's'.repeat(64);

export class PortaImplantacaoMemoria implements PortaImplantacao {
  readonly destino = 'memoria' as const;

  constructor(
    private readonly pacote: () => readonly MigracaoRegistrada[],
    private readonly agora: () => number = Date.now,
  ) {}

  conexao(): Promise<ConexaoBanco> {
    return Promise.resolve({
      versaoMotor: '12.3.1-MariaDB',
      charsetBanco: 'utf8mb4',
      charsetConexao: 'utf8mb4',
      autenticacao: 'ed25519',
      canalCifrado: true,
      canalComprimido: false,
      protocolo: 'TCP',
      conta: 'sgh_app',
      papel: 'sgh_aplicacao',
    });
  }

  migracoesRegistradas(): Promise<MigracaoRegistrada[]> {
    return Promise.resolve(this.pacote().map((s) => ({ numero: s.numero, hash: s.hash })));
  }

  /** O banco sintético num servidor em UTC-03:00 com o relógio em dia. */
  relogioBanco(): Promise<string> {
    return Promise.resolve(formatarHoraDeParede(this.agora() - 3 * 3_600_000));
  }

  estrutura(): Promise<EstruturaBanco> {
    return Promise.resolve({ resumo: RESUMO_ESTRUTURA_SINTETICA, tabelas: 0 });
  }
}
