// Permissões da rouparia e lavanderia (ficha do M55, fatia F2, seção 7; convencoes.md §12). O sistema anterior não tem
// rouparia; a equipe que cuida do enxoval é a da hotelaria, que no outro sistema tem as opções do módulo Higienização
// (TBOPCOES, retrato tools/verificadores/dados/acesso-legado.pc.json): Painel de leitos 5012, Gerenciar limpeza 5014 e
// Iniciar/Finalizar limpeza 5015 (regra 1 do M06: quem tem a opção tem a permissão). Além delas, o perfil complementar
// `rouparia` concede as duas a quem a gestão de acessos nomear (a costureira, o encarregado da lavanderia), sem dar a
// higienização (D-PERM-552).
import { OPCOES_INTERNACAO } from './internacao-adt.js';
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_ROUPARIA_CODIGOS = {
  ler: 'hotelaria.rouparia.ler',
  registrar: 'hotelaria.rouparia.registrar',
} as const;

const O = OPCOES_INTERNACAO;

export const PERMISSOES_ROUPARIA_M55: readonly DeclaracaoPermissao[] = [
  {
    codigo: PERMISSOES_ROUPARIA_CODIGOS.ler,
    descricao:
      'Consultar o enxoval, as cotas por setor, os movimentos da rouparia (coleta, envio, retorno, entrega, perdas e inventário), os quilos por setor e os indicadores',
    opcoesLegado: [O.higPainel, O.higGerenciar, O.higIniciarFinalizar],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['rouparia'],
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: PERMISSOES_ROUPARIA_CODIGOS.registrar,
    descricao:
      'Registrar a coleta pesada, o envio e o retorno da lavanderia, a entrega ao setor, as perdas e o inventário; cadastrar as peças, os kits e as cotas por setor',
    opcoesLegado: [O.higGerenciar, O.higIniciarFinalizar],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['rouparia'],
    categoria: 'administrativa',
    criticidade: 'normal',
  },
];
