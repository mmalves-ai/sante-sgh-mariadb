// Portas do prontuário fora de dev/ci sem o núcleo, e os métodos ainda sem adaptador próprio: toda chamada responde
// com erro (falha fechada), nada é lido nem gravado.
// Melhoria: uma só fábrica para as cinco portas do PEP (antes uma por arquivo de convivência).
import { ErroProblema } from '../../problema.filter.js';
import type { PortaDocumentos } from './documentos-porta.js';
import type { PortaFormularioNovo } from './formulario-novo-porta.js';
import type { PortaProntuario } from './porta.js';
import type { PortaPrescricao } from './prescricao-porta.js';
import type { PortaRegistro } from './registro-porta.js';

const BANCO_INDISPONIVEL = (): ErroProblema =>
  new ErroProblema(
    'indisponivel',
    503,
    'Banco do estabelecimento indisponível',
    'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
  );

/** Ganchos do Nest (onModuleInit, beforeApplicationShutdown…), `then` e símbolos não são da porta. */
const NAO_E_DA_PORTA = /^(on[A-Z]|before[A-Z]|then$|constructor$|toJSON$)/;

/** Uma porta cujos métodos recusam todos com o erro dado (a propriedade `destino` fica legível). */
export function portaQueRecusa<T extends { readonly destino: string }>(
  destino: T['destino'],
  erro: (metodo: string) => Error = BANCO_INDISPONIVEL,
): T {
  return new Proxy({ destino } as T, {
    get(alvo, chave) {
      if (chave === 'destino') return alvo.destino;
      if (typeof chave !== 'string' || NAO_E_DA_PORTA.test(chave)) return undefined;
      return (): Promise<never> => Promise.reject(erro(chave));
    },
  });
}

export const portaProntuarioIndisponivel = (): PortaProntuario => portaQueRecusa<PortaProntuario>('proprio');
export const portaRegistroIndisponivel = (): PortaRegistro => portaQueRecusa<PortaRegistro>('proprio');
export const portaPrescricaoIndisponivel = (): PortaPrescricao => portaQueRecusa<PortaPrescricao>('proprio');
export const portaDocumentosIndisponivel = (): PortaDocumentos => portaQueRecusa<PortaDocumentos>('proprio');
export const portaFormularioNovoIndisponivel = (): PortaFormularioNovo =>
  portaQueRecusa<PortaFormularioNovo>('proprio' as PortaFormularioNovo['destino']);
