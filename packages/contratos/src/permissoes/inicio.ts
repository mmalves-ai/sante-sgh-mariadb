import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_INICIO = {
  worklistMedicoLer: 'pep.worklist.ler',
  worklistRecepcaoLer: 'recepcao.worklist.ler',
  avisoLer: 'acesso.aviso.ler',
  avisoResolver: 'acesso.aviso.resolver',
  mensagemLer: 'acesso.mensagem.ler',
  mensagemEnviar: 'acesso.mensagem.enviar',
  mensagemAnteriorLer: 'acesso.mensagemAnterior.ler',
  comunicadoPublicar: 'acesso.comunicado.publicar',
  dicionarioLer: 'acesso.dicionario.ler',
  dicionarioEditar: 'acesso.dicionario.editar',
} as const;

const P = PERMISSOES_INICIO;
const pessoa = (codigo: string, descricao: string): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
  categoria: 'administrativa',
  criticidade: 'normal',
});

export const PERMISSOES_M27: readonly DeclaracaoPermissao[] = [
  {
    codigo: P.worklistMedicoLer,
    descricao:
      'Ver a fila do médico na página inicial (pacientes com vínculo assistencial: leito, previsão de alta, resultados, pendências)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
    escopos: ['unidade', 'vinculo'],
    exigeConselho: true,
  },
  {
    codigo: P.worklistRecepcaoLer,
    descricao:
      'Ver a fila da recepção na página inicial (senhas por prioridade legal, chegadas do dia, guias aguardando autorização)',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'normal',
    escopos: ['unidade', 'local'],
  },
  pessoa(P.avisoLer, 'Ver a central de avisos (o sino da barra superior)'),
  pessoa(P.avisoResolver, 'Marcar os próprios avisos como lidos ou resolvidos'),
  pessoa(P.mensagemLer, 'Ler as mensagens internas e os comunicados recebidos e dar ciência'),
  pessoa(P.mensagemEnviar, 'Enviar mensagem interna a usuários, perfis, setores ou unidades'),
  {
    codigo: P.mensagemAnteriorLer,
    descricao: 'Consultar as próprias mensagens recebidas no sistema anterior (só leitura)',

    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: P.comunicadoPublicar,
    descricao: 'Publicar comunicado com vigência e ciência obrigatória (gestor)',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  pessoa(P.dicionarioLer, 'Ver o próprio dicionário ortográfico (o mesmo nos dois sistemas)'),
  pessoa(P.dicionarioEditar, 'Incluir e excluir palavras do próprio dicionário ortográfico'),
];
