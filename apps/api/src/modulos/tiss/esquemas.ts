// Entradas das operações do pós-fechamento (M31) pelo nome da operação: o mesmo Zod dos contratos na memória e no
// banco (a porta própria declara as operações com estes esquemas; a memória valida com eles antes de aplicar).
import {
  esquemaFecharCompetencia,
  esquemaReabrirCompetencia,
  esquemaGerarLote,
  esquemaRegistrarGlosa,
  esquemaRegistrarProtocolo,
  esquemaRegistrarRecurso,
  esquemaRegistrarRetornoRecurso,
} from '@sgh/contratos';
import { z, type ZodType } from 'zod';

/**
 * F3.7 (06-FAT linha 34): a baixa e o recurso levam o parâmetro do prazo do recurso por convênio
 * (`faturamento.recursoPrazoPorOperadora`), resolvido pelo serviço na sessão. O corpo da requisição é conferido pelo
 * esquema estrito do contrato, sem este campo: ele só entra pelo serviço.
 */
const prazoParametro = { prazoParametro: z.string().max(4000).default('') };
export const esquemaBaixaComPrazo = esquemaRegistrarGlosa.extend(prazoParametro);
export const esquemaRecursoComPrazo = esquemaRegistrarRecurso.extend(prazoParametro);

export const ENTRADAS_TISS: Readonly<Record<string, ZodType>> = {
  'faturamento.gerarLote': esquemaGerarLote,
  'faturamento.registrarProtocolo': esquemaRegistrarProtocolo,
  'faturamento.registrarGlosa': esquemaBaixaComPrazo,
  'faturamento.registrarRecurso': esquemaRecursoComPrazo,
  'faturamento.registrarRetornoRecurso': esquemaRegistrarRetornoRecurso,
  'faturamento.fecharCompetencia': esquemaFecharCompetencia,
  'faturamento.reabrirCompetencia': esquemaReabrirCompetencia,
};
