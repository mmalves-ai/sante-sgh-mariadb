// Permissões do balanço hídrico (M45, etapa 3; ficha, seção 7). Quem tem a opção no legado tem a permissão no novo
// (regra 1 do M06). Opções do módulo do PEP (TBOPCOES, retrato tools/verificadores/dados/acesso-legado.pc.json), todas
// ativas: Balanço hídrico 2641 (Consultar 5539, Novo balanço 5316, Lançamento 5322 › Incluir outros líquidos 5323 e
// Incluir perdas 5325, Alterar 4629, Fechar balanço 5317 › parcial 5318 e total 5319). As opções antigas do mesmo
// módulo (4622 a 4632, 5315, 5541) estão inativas no retrato e não entram. O estorno de um lançamento é do mesmo
// profissional que lança (5322) ou altera (4629); o fechamento, de quem fecha (D-PERM-BAL-45).
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_BALANCO = {
  balanco: 2641,
  consultar: 5539,
  novo: 5316,
  lancamento: 5322,
  incluirLiquidos: 5323,
  incluirPerdas: 5325,
  alterar: 4629,
  fechar: 5317,
  fecharParcial: 5318,
  fecharTotal: 5319,
} as const;
const O = OPCOES_BALANCO;

export const PERMISSOES_BALANCO = {
  ler: 'enfermagem.balanco.ler',
  lancar: 'enfermagem.balanco.lancar',
  fechar: 'enfermagem.balanco.fechar',
} as const;

const p = (codigo: string, descricao: string, opcoesLegado: readonly number[]): DeclaracaoPermissao => ({
  codigo,
  descricao,
  opcoesLegado,
  concessaoPorPerfil: null,
  categoria: 'clinica',
  criticidade: 'sensivel',
});

export const PERMISSOES_BALANCO_M45: readonly DeclaracaoPermissao[] = [
  p(
    PERMISSOES_BALANCO.ler,
    'Ver o balanço hídrico do paciente (ganhos, perdas, fechamentos, débito urinário e o gráfico)',
    [O.balanco, O.consultar],
  ),
  p(
    PERMISSOES_BALANCO.lancar,
    'Lançar ganhos e perdas no balanço hídrico e estornar um lançamento com o motivo',
    [O.novo, O.lancamento, O.incluirLiquidos, O.incluirPerdas, O.alterar],
  ),
  p(
    PERMISSOES_BALANCO.fechar,
    'Fechar o balanço hídrico parcial e o de 24 horas (com os ganhos da checagem e a diurese dos sinais vitais)',
    [O.fechar, O.fecharParcial, O.fecharTotal],
  ),
];
