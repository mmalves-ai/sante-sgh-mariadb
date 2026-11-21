import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_ROUPARIA_CODIGOS = {
  ler: 'hotelaria.rouparia.ler',
  registrar: 'hotelaria.rouparia.registrar',
} as const;

export const PERMISSOES_ROUPARIA_M55: readonly DeclaracaoPermissao[] = [
  {
    codigo: PERMISSOES_ROUPARIA_CODIGOS.ler,
    descricao:
      'Consultar o enxoval, as cotas por setor, os movimentos da rouparia (coleta, envio, retorno, entrega, perdas e inventário), os quilos por setor e os indicadores',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['rouparia'],
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: PERMISSOES_ROUPARIA_CODIGOS.registrar,
    descricao:
      'Registrar a coleta pesada, o envio e o retorno da lavanderia, a entrega ao setor, as perdas e o inventário; cadastrar as peças, os kits e as cotas por setor',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['rouparia'],
    categoria: 'administrativa',
    criticidade: 'normal',
  },
];
