// Permissões do M27 (ficha, seção 7): as filas de trabalho da página inicial, a central de avisos, as mensagens
// internas e comunicados, as mensagens do sistema anterior (consulta) e o dicionário ortográfico pessoal. Quem tem a
// opção no legado tem a permissão no novo (regra 1 do M06); os recursos só do novo vão por perfil
// (mapa de opções do acesso). Opções da árvore do menu de origem (retrato tools/verificadores/dados/acesso-legado.pc.json):
//   - "Mensagem a usuários" do módulo de abertura (2 no sghspd, 6932 no sgospd; ativas, 6 de 39 grupos com a 2): a
//     publicação de comunicado e a consulta das mensagens do sistema anterior seguem quem as tinha;
//   - a fila do médico segue quem prescreve no prontuário (Prescrição geral 2601 e Prescrever 5223 do módulo do PEP,
//     as opções que no outro sistema só o médico tem; a localização de paciente, 3900, a recepção também tem): a fila
//     é dos pacientes com vínculo assistencial pelo CBO do profissional (regra 2);
//   - a fila da recepção segue o gerador de senhas e os atendimentos da recepção (3308, 5739, 5745, 6026) e os do
//     diagnóstico (2728), sem a localização de paciente do prontuário (3900), que o médico também tem.
// O dicionário não tem opção no legado (cada usuário mantém o próprio): recurso de toda pessoa, como as preferências.
import { OPCOES_RECEPCAO } from './recepcao.js';
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_MENSAGEM_LEGADO = { sghspd: 2, sgospd: 6932 } as const;
/** Prescrição geral (2601) e Prescrever (5223), do módulo do PEP. */
export const OPCOES_WORKLIST_MEDICO = [2601, 5223] as const;

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
  opcoesLegado: [],
  concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
  categoria: 'administrativa',
  criticidade: 'normal',
});

export const PERMISSOES_M27: readonly DeclaracaoPermissao[] = [
  {
    codigo: P.worklistMedicoLer,
    descricao:
      'Ver a fila do médico na página inicial (pacientes com vínculo assistencial: leito, previsão de alta, resultados, pendências)',
    opcoesLegado: [...OPCOES_WORKLIST_MEDICO],
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
    opcoesLegado: [
      OPCOES_RECEPCAO.geradorSenhas,
      OPCOES_RECEPCAO.atendimentos,
      OPCOES_RECEPCAO.atendimentosIncluir,
      OPCOES_RECEPCAO.atendimentosConsultar,
      OPCOES_RECEPCAO.sadtAtendimentos,
    ],
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
    opcoesLegado: [OPCOES_MENSAGEM_LEGADO.sghspd, OPCOES_MENSAGEM_LEGADO.sgospd],
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: P.comunicadoPublicar,
    descricao: 'Publicar comunicado com vigência e ciência obrigatória (gestor)',
    opcoesLegado: [OPCOES_MENSAGEM_LEGADO.sghspd, OPCOES_MENSAGEM_LEGADO.sgospd],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  pessoa(P.dicionarioLer, 'Ver o próprio dicionário ortográfico (o mesmo nos dois sistemas)'),
  pessoa(P.dicionarioEditar, 'Incluir e excluir palavras do próprio dicionário ortográfico'),
];
