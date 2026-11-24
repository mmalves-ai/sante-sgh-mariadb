// Cliente do cadastro do kit padrão (F3.6, 05-SUP linha 13), validado pelos contratos: a lista do cadastro (ativos e
// inativos, com a composição e os procedimentos), a busca da cirurgia ou do procedimento e a gravação do kit inteiro.
import {
  esquemaKitPadraoCadastro,
  esquemaProcedimentoKitBusca,
  esquemaResultadoSuprimentos,
  type KitPadraoCadastro,
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
export const gravarKitPadrao = (e: unknown, chave: string): Promise<ResultadoSuprimentos> =>
  enviar(S, e, esquemaResultadoSuprimentos, chave);
