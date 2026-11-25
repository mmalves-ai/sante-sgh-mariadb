// Regra de campo do cadastro na abertura do atendimento (F3.1, 02-CAD linha 2). A conferência roda DENTRO da
// transação que abre o atendimento (recepção ambulatorial, pronto atendimento, exames): lê as regras de campo ativas do
// estabelecimento e da rede e os dados atuais do cadastro do paciente, e recusa com os campos que faltam no escopo
// (módulo de recepção, tipo de atendimento e fonte pagadora). Recusada, nada do atendimento é gravado. A regra é a do
// domínio (recusaAberturaPorCadastro); aqui só a leitura. O cadastro provisório (paciente não identificado da
// urgência) não é barrado: a identificação fica pendente. A admissão da internação (internacao.internar) confere do
// mesmo jeito, com o tipo "internacao". O módulo de recepção sai do local de atendimento em que a recepção abre.
import { recusaAberturaPorCadastro, tipoAtendimentoDaAbertura } from '@sgh/dominio-cadastro';
import { type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import {
  lerDadosDoCadastro,
  lerRegrasCampoAtivas,
  moduloRecepcaoDoLocal,
} from './ficha-complementar-proprio.js';

export interface EscopoDaAbertura {
  readonly estabelecimento: number;
  readonly paciente: number;
  /** Código do tipo com que a recepção abre (consulta, pa, exame, requisicaoLab, internacao). */
  readonly tipo: string;
  readonly fontePagadora: number | null;
  /**
   * Local de atendimento em que a recepção abre (a senha chamada no guichê traz o local): o módulo de recepção do
   * local é o escopo da regra, sem a tela precisar informá-lo.
   */
  readonly local?: number | null;
  /** Módulo de recepção informado à parte: só vale sem local ou com local sem módulo. */
  readonly modulo?: number | null;
  /** Cadastro provisório (paciente ainda não identificado): a abertura não é barrada. */
  readonly provisorio?: boolean;
}

/** Recusa (`cadastro-incompleto`, com os campos do cadastro que faltam) a abertura do atendimento no escopo. */
export async function conferirCadastroNaAbertura(l: Leitor | TxOperacao, e: EscopoDaAbertura): Promise<void> {
  if (e.provisorio) return;
  const regras = await lerRegrasCampoAtivas(l, e.estabelecimento);
  if (regras.length === 0) return;
  const r = recusaAberturaPorCadastro(
    regras,
    {
      estabelecimento: e.estabelecimento,
      modulo: (await moduloRecepcaoDoLocal(l, e.estabelecimento, e.local)) ?? e.modulo ?? null,
      tipoAtendimento: tipoAtendimentoDaAbertura(e.tipo),
      fontePagadora: e.fontePagadora,
    },
    await lerDadosDoCadastro(l, e.paciente),
  );
  if (r) throw recusa(r.codigo, r.detalhe, { campos: [...r.campos] });
}
