// Cliente do construtor de formulários novos (M45, etapa 1), validado pelos contratos. As gravações vão com o CSRF e
// a Idempotency-Key (uma por intenção de gravar); a recusa de negócio fica em `problema.codigo` para a tela.
import {
  type CasoFormularioNovo,
  type DefinicaoFormularioNovo,
  type EspecialidadeFormularioNovo,
  esquemaEspecialidadeFormularioNovo,
  esquemaListaFormulariosNovos,
  esquemaPerguntaDoBanco,
  esquemaResultadoFormularioNovo,
  esquemaVersaoFormularioNovoDetalhe,
  type ListaFormulariosNovos,
  type PerguntaDoBanco,
  type ResultadoFormularioNovo,
  type TipoPerguntaFormularioNovo,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../exames/api-exames.js';

export { codigoDaRecusa } from '../exames/api-exames.js';

const B = '/api/pep/admin/formularios-novos';

export const chaveFormularioNovo = (rotulo: string) => novaChave(`m45.${rotulo}`);

export const lerFormulariosNovos = (): Promise<ListaFormulariosNovos> => ler(B, esquemaListaFormulariosNovos);
export const lerFormularioNovo = (id: number) => ler(`${B}/${id}`, esquemaVersaoFormularioNovoDetalhe);
export const buscarBancoDePerguntas = (
  termo: string,
  tipo: TipoPerguntaFormularioNovo | null,
): Promise<PerguntaDoBanco[]> =>
  ler(`${B}/banco-perguntas${qs({ termo, tipo })}`, z.array(esquemaPerguntaDoBanco));
export const lerEspecialidadesFormularioNovo = (): Promise<EspecialidadeFormularioNovo[]> =>
  ler(`${B}/especialidades`, z.array(esquemaEspecialidadeFormularioNovo));

export const salvarFormularioNovo = (
  corpo: {
    id: number | null;
    baseadoEm: number | null;
    definicao: DefinicaoFormularioNovo;
    casos: CasoFormularioNovo[];
    versaoEsperada: string | null;
  },
  chave: string,
): Promise<ResultadoFormularioNovo> => enviar(B, corpo, esquemaResultadoFormularioNovo, chave);

export const enviarRevisaoFormularioNovo = (id: number, versaoEsperada: string, chave: string) =>
  enviar(`${B}/${id}/revisao`, { versaoEsperada }, esquemaResultadoFormularioNovo, chave);

export const decidirFormularioNovo = (
  id: number,
  corpo: { versaoEsperada: string; decisao: 'aprovar' | 'devolver'; parecer: string },
  chave: string,
) => enviar(`${B}/${id}/decisao`, corpo, esquemaResultadoFormularioNovo, chave);

export const publicarFormularioNovo = (
  id: number,
  corpo: { versaoEsperada: string; contentHashEsperado: string; senha: string },
  chave: string,
) => enviar(`${B}/${id}/publicar`, corpo, esquemaResultadoFormularioNovo, chave);

export const aposentarFormularioNovo = (
  id: number,
  corpo: { motivo: string; senha: string },
  chave: string,
) => enviar(`${B}/${id}/aposentar`, corpo, esquemaResultadoFormularioNovo, chave);
