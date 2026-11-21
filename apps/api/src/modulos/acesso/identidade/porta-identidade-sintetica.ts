// M59.2: a identidade (credencial forte, segundo fator e política) sobre a fonte SINTÉTICA do dev/ci (E2E @M59.2):
// a porta em memória semeada só com as contas sintéticas da identidade (CONTAS_IDENTIDADE_SINTETICAS). Nada vai ao
// banco: com a fonte sintética, o login de SINT.* nunca procura a conta no banco nem grava a credencial.
// As demais contas sintéticas seguem pela senha antiga (a porta não as conhece: nem regravação nem segundo fator).
import { CONTAS_IDENTIDADE_SINTETICAS, CONTAS_SINTETICAS, idUsuarioSintetico } from '../fonte-sintetica.js';
import { PortaIdentidadeMemoria } from './porta-identidade-memoria.js';

export function portaIdentidadeSintetica(relogio: () => number = () => Date.now()): PortaIdentidadeMemoria {
  const porta = new PortaIdentidadeMemoria(relogio);
  for (const login of CONTAS_IDENTIDADE_SINTETICAS) {
    const c = CONTAS_SINTETICAS[login];
    if (!c) continue;
    porta.usuario({
      login,
      id: idUsuarioSintetico(login),
      nomeExibicao: login,
      ativo: c.ativo,
      bloqueado: c.bloqueado,
      grupo: c.concessoes?.grupo ?? null,
      senhaPresente: c.senha !== null,
      criptografada: c.criptografada,
      comSalt: c.criptografada,
      senhaAlteradaEm: c.senhaAlteradaEm,
    });
  }
  return porta;
}
