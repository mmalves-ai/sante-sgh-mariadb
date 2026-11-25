// As operações de gravação das telas do atendimento e a entrada (Zod do contrato) de cada uma: a memória de dev/ci e a
// porta própria validam pela mesma tabela.
import {
  esquemaAbrirAtendimento,
  esquemaAlterarAtendimento,
  esquemaAlterarHeranca,
  esquemaAlterarSegurado,
  esquemaCancelarAtendimento,
  esquemaConduzirNoConsultorio,
  esquemaCorrigirProcedimentoExtra,
  esquemaDefinirPadraoAbertura,
  esquemaEncerrarAtendimento,
  esquemaEstornarProcedimentoExtra,
  esquemaLancarProcedimentoExtra,
} from '@sgh/contratos';
import type { ZodType } from 'zod';

export const ENTRADAS_OPERACOES_ATENDIMENTO: Readonly<Record<string, ZodType>> = Object.freeze({
  'atendimento.abrirAtendimento': esquemaAbrirAtendimento,
  'atendimento.alterarAtendimento': esquemaAlterarAtendimento,
  'atendimento.alterarHeranca': esquemaAlterarHeranca,
  'atendimento.alterarSegurado': esquemaAlterarSegurado,
  'atendimento.cancelarAtendimento': esquemaCancelarAtendimento,
  'atendimento.conduzirNoConsultorio': esquemaConduzirNoConsultorio,
  'atendimento.corrigirProcedimentoExtra': esquemaCorrigirProcedimentoExtra,
  'atendimento.definirMeuPadraoAbertura': esquemaDefinirPadraoAbertura,
  'atendimento.definirPadraoAbertura': esquemaDefinirPadraoAbertura,
  'atendimento.encerrarAtendimento': esquemaEncerrarAtendimento,
  'atendimento.estornarProcedimentoExtra': esquemaEstornarProcedimentoExtra,
  'atendimento.lancarProcedimentoExtra': esquemaLancarProcedimentoExtra,
});
