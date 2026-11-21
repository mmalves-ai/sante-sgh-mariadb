// Portas indisponíveis da Rede (falha fechada): fora de dev/ci sem o núcleo, tudo responde 503 e nada é lido nem gravado.
import { ErroProblema } from '../../problema.filter.js';
import { METODOS_PORTA_REDE, type PortaRede } from './porta.js';
import type { PortaServicosRede } from './servicos/porta.js';

function recusa(): Promise<never> {
  return Promise.reject(
    new ErroProblema(
      'indisponivel',
      503,
      'Banco do cliente indisponível',
      'O banco do cliente não está configurado: nada foi lido nem gravado.',
    ),
  );
}

export function portaRedeIndisponivel(): PortaRede {
  const base = Object.fromEntries(METODOS_PORTA_REDE.map((m) => [m, recusa]));
  return {
    ...(base as unknown as PortaRede),
    destino: 'indisponivel',
    redeConfigurada: () => null,
    estabelecimentos: () => [],
  };
}

export function portaServicosRedeIndisponivel(): PortaServicosRede {
  return { destino: 'indisponivel', listar: recusa, ler: recusa, registrar: recusa, alterar: recusa };
}
