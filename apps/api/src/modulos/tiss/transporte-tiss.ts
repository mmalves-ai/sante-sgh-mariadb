// Transporte da saída TISS pelo serviço web da operadora no ambiente da API (C2-070, 06-FAT linha 26). A consulta de
// elegibilidade e a comunicação de beneficiário só vão à outbox quando o transmissor do worker vai entregá-las
// (regra do domínio `transporteTissDisponivel`): ligado (TRANSMISSOR_TISS diferente de 'desligado') e, em produção, com
// o transporte da operadora configurado. O transporte de produção ainda não existe no código (o transmissor recebe
// `null` em produção), por isso aqui é `false`: em produção nada vai à outbox e a recepção registra à mão, sem ficar
// presa num 'aguardando' sem fim. Quando o transporte entrar, os dois lados passam a ler a mesma configuração.
import { transporteTissDisponivel } from '@sgh/dominio-faturamento';

export const TRANSPORTE_TISS_PRODUCAO_CONFIGURADO = false;

export function transporteTissDoAmbiente(env: NodeJS.ProcessEnv = process.env): boolean {
  return transporteTissDisponivel({
    transmissorLigado: (env['TRANSMISSOR_TISS'] ?? '').trim() !== 'desligado',
    producao: (env['AMBIENTE'] ?? '').trim() === 'producao',
    transporteProducao: TRANSPORTE_TISS_PRODUCAO_CONFIGURADO,
  });
}
