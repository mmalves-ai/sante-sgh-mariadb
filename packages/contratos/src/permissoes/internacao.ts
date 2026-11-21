// Permissões do M16 (ficha, seção 7; convencoes.md §12): painel de leitos ao vivo, divergência de cadastro de
// leitos, censo diário, painéis gerenciais, indicadores hospitalares e o BI. Quem tem a opção no legado tem a
// permissão no novo (regra 1 do M06). Opções da árvore do legado (menu de origem, retrato
// tools/verificadores/dados/acesso-legado.pc.json):
//   - Recepção interna (módulo 7): Leitos 2322, Painel de leitos 3990, Controle Central de Leitos 2483,
//     Pacientes por localização 2428; Recepção externa (8): Painel de leitos 4555 e Consultar 6009; módulo 37:
//     Painel de leitos 5012;
//   - censo: Censo 2378, Censo/estatísticas hospitalar mensal 2517, Censo diário por horário 2548, Censo
//     hospitalar completo 2549, Censo diário eletrônico 2564 e os relatórios do usuário "Censo diário de pacientes
//     internados" 5415 e "Censo hospitalar" 5595;
//   - estatística e painel: Estatística 2324 (módulo 7) e o Dashboard 6785 (Consultar 6789, Imprimir 6790);
//   - financeiro: Estatísticas de contas 1169 (Faturamento convênios).
// Conferir na validação com a TI (DP-3). A meta dos indicadores é um parâmetro do sistema novo
// (`config.parametro.editar`, M08).
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_LEITOS = [2322, 3990, 2483, 2428, 4555, 6009, 5012] as const;
export const OPCOES_CENSO = [2378, 2517, 2548, 2549, 2564, 5415, 5595] as const;
export const OPCOES_CENSO_EXPORTAR = [2549, 2548, 5415, 5595] as const;
export const OPCOES_PAINEIS = [2324, 6785, 6789] as const;
export const OPCOES_INDICADORES = [2517, 2324, 6785, 6789] as const;
export const OPCOES_INDICADORES_EXPORTAR = [2517, 6790] as const;
export const OPCOES_FINANCEIRO = [1169] as const;

export const PERMISSOES_M16_CODIGOS = {
  leitosLer: 'internacao.leitos.ler',
  censoLer: 'internacao.censo.ler',
  censoExportar: 'internacao.censo.exportar',
  paineisLer: 'relatorio.paineis.ler',
  financeiroLer: 'relatorio.financeiro.ler',
  indicadoresLer: 'relatorio.indicadores.ler',
  indicadoresExportar: 'relatorio.indicadores.exportar',
  biAcessar: 'relatorio.bi.acessar',
} as const;

const C = PERMISSOES_M16_CODIGOS;

export const PERMISSOES_M16: readonly DeclaracaoPermissao[] = [
  {
    codigo: C.leitosLer,
    descricao:
      'Ver o painel de leitos ao vivo (ocupação por bloco e acomodação; cartão sem nome) e a divergência de cadastro de leitos',
    opcoesLegado: [...OPCOES_LEITOS],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.censoLer,
    descricao: 'Ver o censo hospitalar diário (dia em aberto, dias fechados e a série desde 2020)',
    opcoesLegado: [...OPCOES_CENSO],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.censoExportar,
    descricao: 'Exportar o censo hospitalar diário e a série (planilha, só contagens)',
    opcoesLegado: [...OPCOES_CENSO_EXPORTAR],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.paineisLer,
    descricao: 'Ver os painéis gerenciais assistencial e operacional (só contagens agregadas)',
    opcoesLegado: [...OPCOES_PAINEIS],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.financeiroLer,
    descricao:
      'Ver o painel financeiro nas duas réguas (data do item e competência da conta), com a glosa sobre os itens baixados',
    opcoesLegado: [...OPCOES_FINANCEIRO],
    concessaoPorPerfil: null,
    categoria: 'financeira',
    criticidade: 'sensivel',
  },
  {
    codigo: C.indicadoresLer,
    descricao:
      'Ver os indicadores hospitalares com a ficha técnica, a série, os recortes, o ano anterior e o detalhe',
    opcoesLegado: [...OPCOES_INDICADORES],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.indicadoresExportar,
    descricao: 'Exportar a série de um indicador (planilha com numerador e denominador)',
    opcoesLegado: [...OPCOES_INDICADORES_EXPORTAR],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.biAcessar,
    descricao: 'Abrir a análise livre no BI (data mart sem dado pessoal, a partir da cópia diária)',
    opcoesLegado: [6785, 6789],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
];
