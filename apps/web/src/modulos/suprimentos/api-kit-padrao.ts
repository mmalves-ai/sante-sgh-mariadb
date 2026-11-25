// Cliente do cadastro do kit padrão (F3.6, 05-SUP linha 13), validado pelos contratos: a lista do cadastro (ativos e
// inativos, com a composição e os procedimentos), a busca da cirurgia ou do procedimento e a gravação do kit inteiro.
import {
  esquemaKitPadraoCadastro,
  esquemaKitPadraoSugerido,
  esquemaProcedimentoKitBusca,
  esquemaResultadoSuprimentos,
  type KitPadraoCadastro,
  type KitPadraoSugerido,
  type ProcedimentoKitBusca,
  type ResultadoSuprimentos,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const S = '/api/suprimentos/kits-padrao';

export const listarKitsPadraoCadastro = (): Promise<KitPadraoCadastro[]> =>
  ler(`${S}/cadastro`, z.array(esquemaKitPadraoCadastro));
export const buscarProcedimentosKit = (termo: string): Promise<ProcedimentoKitBusca[]> =>
  ler(`${S}/procedimentos?termo=${encodeURIComponent(termo)}`, z.array(esquemaProcedimentoKitBusca));
/** O kit padrão das cirurgias e procedimentos achados pelo termo, com a composição (para somar ao pedido). */
export const sugerirKitsPadrao = (termo: string): Promise<KitPadraoSugerido[]> =>
  ler(`${S}/sugestao?termo=${encodeURIComponent(termo)}`, z.array(esquemaKitPadraoSugerido));
export const gravarKitPadrao = (e: unknown, chave: string): Promise<ResultadoSuprimentos> =>
  enviar(S, e, esquemaResultadoSuprimentos, chave);
