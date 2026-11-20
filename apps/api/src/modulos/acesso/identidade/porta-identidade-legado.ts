// A porta da identidade (M59-F2) sobre o núcleo do legado: leituras READ ONLY (lerSomente) e gravações só em tabelas
// SGH_ pela transação SGH_ (gravarSgh), com a SGH_TRILHA na mesma transação. Só @sgh/legado fala com o banco.
import {
  autenticarForte,
  confirmarSegundoFator,
  contarIdentidade,
  alterarPolitica2fa,
  encerrarPolitica2fa,
  gravarCredencialForte,
  iniciarSegundoFator,
  incluirPolitica2fa,
  lerContaIdentidade,
  lerCredencialForte,
  lerPoliticas2fa,
  lerSegundoFator,
  lerUsuariosIdentidade,
  marcarVerificacaoSegundoFator,
  type NucleoLegado,
  revogarSegundoFator,
  tabelasIdentidadeProntas,
} from '@sgh/legado';
import type { PortaIdentidade } from './servico-identidade.js';

export function portaIdentidadeDoNucleo(
  nucleo: Pick<NucleoLegado, 'rede' | 'lerSomente' | 'gravarSgh'>,
): PortaIdentidade {
  const ctx = (hospital: string, traceId = 'acesso-identidade') => ({ rede: nucleo.rede, hospital, traceId });
  return {
    prontas: (h) => nucleo.lerSomente(ctx(h), (l) => tabelasIdentidadeProntas(l)),
    conta: (h, login) => nucleo.lerSomente(ctx(h), (l) => lerContaIdentidade(l, login)),
    forte: (h, login, id) => nucleo.lerSomente(ctx(h), (l) => lerCredencialForte(l, login, id)),
    autenticarForte: (h, login, id, senha, conferir) =>
      nucleo.lerSomente(ctx(h), (l) => autenticarForte(l, login, id, senha, conferir)),
    gravarForte: async (h, c, t) => {
      await nucleo.gravarSgh(ctx(h, t.correlacao), (e) => gravarCredencialForte(e, c, t));
    },
    segundoFator: (h, login, id) => nucleo.lerSomente(ctx(h), (l) => lerSegundoFator(l, login, id)),
    iniciar2fa: (h, c, t) => nucleo.gravarSgh(ctx(h, t.correlacao), (e) => iniciarSegundoFator(e, c, t)),
    confirmar2fa: (h, id, t) =>
      nucleo.gravarSgh(ctx(h, t.correlacao), (e) => confirmarSegundoFator(e, id, t)),
    revogar2fa: (h, id, t) => nucleo.gravarSgh(ctx(h, t.correlacao), (e) => revogarSegundoFator(e, id, t)),
    marcar2fa: (h, id, instante) =>
      nucleo.gravarSgh(ctx(h), (e) => marcarVerificacaoSegundoFator(e, id, instante)),
    politicas: (h) => nucleo.lerSomente(ctx(h), (l) => lerPoliticas2fa(l, h)),
    incluirPolitica: (h, p, t) => nucleo.gravarSgh(ctx(h, t.correlacao), (e) => incluirPolitica2fa(e, p, t)),
    encerrarPolitica: (h, c, t) =>
      nucleo.gravarSgh(ctx(h, t.correlacao), (e) => encerrarPolitica2fa(e, c, t)),
    alterarPolitica: (h, a, t) => nucleo.gravarSgh(ctx(h, t.correlacao), (e) => alterarPolitica2fa(e, a, t)),
    usuarios: (h, f) => nucleo.lerSomente(ctx(h), (l) => lerUsuariosIdentidade(l, f)),
    contagens: (h) => nucleo.lerSomente(ctx(h), (l) => contarIdentidade(l)),
  };
}
