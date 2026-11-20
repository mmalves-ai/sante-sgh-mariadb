// Rotas do M13 (catálogos oficiais e importadores), com a permissão de leitura de cada tela (a API confere de
// novo; as ações aparecem só com a permissão de agir).
import type { RouteRecordRaw } from 'vue-router';

const consulta = (
  path: string,
  name: string,
  grupo: string,
  permissao = 'catalogo.item.ler',
): RouteRecordRaw => ({
  path,
  name,
  component: () => import('./telas/ConsultaCatalogoTela.vue'),
  props: { grupo },
  meta: { permissao },
});

export const rotasCatalogos: RouteRecordRaw[] = [
  {
    path: '/cadastros/catalogos',
    name: 'catalogos.painel',
    component: () => import('./telas/PainelCatalogosTela.vue'),
    meta: { permissao: 'catalogo.carga.ler' },
  },
  {
    path: '/cadastros/catalogos/cargas/:id(\\d+)',
    name: 'catalogos.carga',
    component: () => import('./telas/CargaCatalogoTela.vue'),
    props: true,
    meta: { permissao: 'catalogo.carga.ler' },
  },
  consulta('/cadastros/catalogos/tuss', 'catalogos.tuss', 'tuss'),
  consulta('/cadastros/catalogos/sigtap', 'catalogos.sigtap', 'sigtap'),
  consulta('/cadastros/catalogos/cid', 'catalogos.cid', 'cid'),
  consulta('/cadastros/catalogos/enderecos', 'catalogos.enderecos', 'enderecos'),
  consulta('/cadastros/catalogos/cbo', 'catalogos.cbo', 'cbo'),
  consulta('/cadastros/catalogos/dcb', 'catalogos.dcb', 'dcb'),
  consulta('/financeiro/fiscal/tabelas', 'catalogos.fiscal', 'fiscal'),
  // M51 (etapa 4): os domínios dos leiautes do SIH e do SIA (tipos de UTI, laudo de nefrologia), consulta e carga.
  consulta('/faturamento/sus/cadastros/dominios', 'catalogos.dominios-sus', 'dominiosSus'),
  // M54.3: as tabelas de código e nome do SPED contábil, consulta e carga (ligada da tela do SPED).
  consulta('/contabil/sped/tabelas', 'catalogos.sped-contabil', 'spedContabil'),
  consulta('/administracao/integracoes/leiautes', 'catalogos.leiautes', 'leiautes', 'catalogo.leiaute.ler'),
  {
    path: '/faturamento/sus/sigtap',
    name: 'catalogos.historico-sigtap',
    component: () => import('./telas/HistoricoSigtapTela.vue'),
    meta: { permissao: 'catalogo.item.ler' },
  },
];
