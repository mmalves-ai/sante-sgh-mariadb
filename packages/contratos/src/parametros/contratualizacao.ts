// Parâmetros da contratualização SUS (M55, fatia F5; ficha, regra 11; cap-07 §7.3). O padrão é o de mercado dos
// documentos descritivos dos contratos com o gestor (POL-1): quatro faixas de cumprimento, uma por escore (Ótimo, Bom,
// Regular, Ruim, os códigos do domínio), cada uma com o percentual do repasse da parte; o faturamento troca por
// estabelecimento conforme o contrato assinado, sem mudar código.
import type { DefinicaoParametro } from './definicoes.js';

/** Padrão: cumprimento ≥ 95% recebe 100%; ≥ 85%, 90%; ≥ 70%, 70%; abaixo, nada (o escore 1). */
export const FAIXAS_CUMPRIMENTO_SUS_PADRAO = '95:100,85:90,70:70,0:0';

export const PARAMETROS_CONTRATUALIZACAO: readonly DefinicaoParametro[] = [
  {
    chave: 'contratualizacao.faixasCumprimento',
    modulo: 'faturamento',
    descricao:
      'Faixas de cumprimento das metas SUS: quatro pares "mínimo %:repasse %", do escore Ótimo ao Ruim (o último começa em 0)',
    tipo: 'texto',
    padrao: FAIXAS_CUMPRIMENTO_SUS_PADRAO,
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    formato: {
      expressao: '^\\d{1,3}:\\d{1,3},\\d{1,3}:\\d{1,3},\\d{1,3}:\\d{1,3},0:\\d{1,3}$',
      mensagem:
        'Use quatro pares mínimo:repasse separados por vírgula, do maior ao menor, o último com mínimo 0.',
    },
    dono: 'faturamento (contratualização SUS)',
    origem:
      'ficha do M55, regra 11 (metas com periodicidade e escore); padrão de mercado dos documentos descritivos (POL-1)',
  },
];
