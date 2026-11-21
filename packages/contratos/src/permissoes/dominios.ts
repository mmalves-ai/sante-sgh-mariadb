// Permissões do M08 (ficha, seção 7; convencoes.md §12): as dos domínios do CRUD genérico, geradas da parte
// pública das declarações (`<modulo>.<recurso>.<acao>` com as opções do legado de cada ação), e as do
// módulo config (índice de domínios, parâmetros, chaves de liberação), recursos novos concedidos por perfil
// ao Administrador do sistema (papel SBIS 1; revisão por área no M10).
import { DOMINIOS_DECLARADOS } from '../dominios/catalogo.js';
import { permissaoDoDominio } from '../dominios/tipos.js';
import type { DeclaracaoPermissao } from './tipos.js';

const VERBO: Record<string, string> = {
  ler: 'Consultar',
  criar: 'Incluir',
  editar: 'Alterar',
  inativar: 'Inativar',
  // W0-02: a exclusão física (só sem vínculo; o motivo e o valor anterior vão ao registro do evento).
  excluir: 'Excluir',
  exportar: 'Exportar',
};

export const PERMISSOES_DOMINIOS: readonly DeclaracaoPermissao[] = DOMINIOS_DECLARADOS.flatMap((d) =>
  d.acoes.map((a): DeclaracaoPermissao => ({
    codigo: permissaoDoDominio(d, a),
    descricao: `${VERBO[a] ?? a} ${d.rotulo.plural.toLowerCase()} (CRUD genérico)`,

    // M56 (D-PERM-56): o domínio com perfis próprios também é concedido por perfil.
    ...(d.perfis
      ? {
          concessaoPorPerfil: 'por-perfil' as const,
          perfis: a === 'ler' || a === 'exportar' ? d.perfis.ler : d.perfis.gravar,
        }
      : { concessaoPorPerfil: null }),
    categoria: 'administrativa',
    criticidade: a === 'exportar' || a === 'excluir' ? 'sensivel' : 'normal',
  })),
);

const ADMIN = ['administrador-sistema'] as const;

export const PERMISSOES_CONFIG_M08 = [
  {
    codigo: 'config.dominio.ler',
    descricao: 'Ver o índice dos domínios e tabelas auxiliares (só os que a pessoa pode ler)',

    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
    categoria: 'administrativa',
  },
  {
    codigo: 'config.parametro.ler',
    descricao: 'Ver os parâmetros configuráveis e os gravados no banco de dados, com a origem do valor',

    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
  },
  {
    codigo: 'config.parametro.editar',
    descricao: 'Definir parâmetro do sistema novo por nível (com justificativa; crítico pede a senha)',

    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'config.liberacao.ler',
    descricao: 'Ver as funcionalidades por estabelecimento (chaves de liberação e pré-requisitos)',

    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
  },
  {
    codigo: 'config.liberacao.editar',
    descricao: 'Ligar ou desligar funcionalidade por estabelecimento, setor ou pessoa (reautenticação)',

    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
    criticidade: 'critica',
  },
] as const satisfies readonly DeclaracaoPermissao[];
