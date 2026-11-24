// Base comum das portas próprias dos documentos do PEP: o núcleo usado e a recusa do que ainda não tem adaptador. Fica
// num módulo sem import de volta da porta (o painel a usa e a porta importa o painel), para não haver import circular.
import { ErroOperacao, type Executor, type Leitor } from '@sgh/nucleo';

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoDocumentosPep {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

export function recusaPendente(metodo: string): ErroOperacao {
  return new ErroOperacao(
    501,
    'pendente-modelo-proprio',
    'Ainda não disponível no banco próprio',
    `A leitura ou gravação "${metodo}" dos documentos do prontuário ainda não tem adaptador no banco próprio.`,
  );
}
