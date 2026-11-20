// Domínios do CRUD genérico do módulo `catalogo` (W0-01: um arquivo por prefixo; o agregador DOMINIOS_DECLARADOS, em
// ../catalogo.ts, já importa todos, inclusive os vazios). Domínio novo do módulo entra aqui; auxiliares em
// ../ajudantes.ts. Regras da obra: docs/operacoes/README.md.
import { SUS_UNIFICADA, TISS_AUX, catalogoDominio, todas } from '../ajudantes.js';
import type { DominioPublico } from '../tipos.js';

export const DOMINIOS_CATALOGO: readonly DominioPublico[] = [
  catalogoDominio(
    'tussTipoLancamento',
    {
      singular: 'Terminologia TUSS por tipo de lançamento',
      plural: 'Terminologias TUSS por tipo de lançamento',
    },
    'tuss',
    todas(TISS_AUX, ['ler', 'criar', 'editar', 'exportar']),
    'inferida',
  ),
  catalogoDominio(
    'regionalSaude',
    { singular: 'Regional de saúde (DRS)', plural: 'Regionais de saúde (DRS)' },
    'sigtap',
    todas(SUS_UNIFICADA, ['ler', 'criar', 'editar', 'exportar']),
    'inferida',
  ),
  catalogoDominio(
    'fabricanteOpm',
    { singular: 'Fabricante de OPM', plural: 'Fabricantes de OPM' },
    'sigtap',
    todas(SUS_UNIFICADA, ['ler', 'criar', 'editar', 'exportar']),
    'inferida',
  ),
  catalogoDominio(
    'leiauteCep',
    { singular: 'Seção do leiaute de CEP', plural: 'Seções do leiaute de CEP' },
    'leiautesCep',
    { ler: [3649, 6341], criar: [3651], editar: [3650], exportar: [6341, 6342] },
    'tbopcoes',
  ),
];
