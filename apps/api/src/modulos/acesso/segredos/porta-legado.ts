// M59-F3: a porta dos segredos e das senhas secundárias sobre o núcleo do adaptador (leitura em transação de leitura;
// o registro do cofre pela transação SGH_ do núcleo, com a SGH_TRILHA na mesma transação).
import {
  lerSegredosLegado,
  lerSenhasSecundarias,
  type NucleoLegado,
  registrarGuardaSegredo,
} from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import type { PortaSegredos } from './porta.js';

export function portaSegredosLegado(nucleo: NucleoLegado): PortaSegredos {
  const ctx = (c: { rede: string; hospital: string }) => ({
    rede: c.rede,
    hospital: c.hospital,
    traceId: 'segredos',
  });
  return {
    destino: 'legado',
    lerSegredos: (c) => nucleo.lerSomente(ctx(c), (l) => lerSegredosLegado(l, c.hospital)),
    registrarGuarda: (c, g, trilha) =>
      nucleo.gravarSgh(ctx(c), (e) => registrarGuardaSegredo(e, { ...g, hospital: c.hospital }, trilha)),
    lerSenhasSecundarias: (c, f) => nucleo.lerSomente(ctx(c), (l) => lerSenhasSecundarias(l, f)),
  };
}

/** Sem o núcleo do adaptador (e fora do ambiente sintético): 503, nunca uma lista vazia enganosa. */
export function portaSegredosIndisponivel(): PortaSegredos {
  const fora = () =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco indisponível',
        'O banco do estabelecimento não está configurado.',
      ),
    );
  return { destino: 'legado', lerSegredos: fora, registrarGuarda: fora, lerSenhasSecundarias: fora };
}
