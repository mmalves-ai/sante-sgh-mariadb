// Permissões do M11 (ficha, seção 7; convencoes.md §12; cap-08 §8.13): pacientes, pessoas, profissionais e
// solicitantes. Quem tem a opção no legado tem a permissão no novo (regra 1 do M06): as opções são as das telas
// do sistema anterior que fazem o mesmo (menu de origem, retrato tools/verificadores/dados/acesso-legado.pc.json):
//   - Cadastro de pacientes das duas recepções: externa (3253 acessar, 6027 consultar, 3255 incluir,
//     3254 alterar) e interna (2347, 6061, 2349, 2348); Pesquisa de pacientes (3290);
//   - Termo de consentimento do cadastro (externa 6533–6537, pesquisa 6538–6542, interna 6589–6593);
//   - Unificação de cadastros (recepção interna 3272/4005, SADT 4790) e reversão (6544/6608, 6531): SAME e
//     supervisores, que comparam lado a lado;
//   - Profissionais (Tabelas › Geral M–Z › Profissionais 3984; Gerenciamento 6390–6395).
// Dados sensíveis (raça/cor, religião, vulnerabilidade, responsável legal; cap-08 §8.13; regra 9) só para quem
// unifica (SAME) e para o perfil assistencial com conselho: a recepção não os vê.
// Os domínios do marco (conselhos, prestadores, especialidades e CBO da especialidade) vêm do CRUD genérico
// (permissoes/dominios.ts), com as opções na parte pública da declaração (dominios/catalogo.ts).
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_CADASTRO_M11 = [
  {
    codigo: 'cadastro.paciente.ler',
    descricao: 'Buscar paciente e abrir a ficha (toda abertura é registrada na trilha)',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['assistencial-com-conselho'],
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: 'cadastro.paciente.criar',
    descricao: 'Cadastrar paciente (procura pelo CPF antes de criar)',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
  },
  {
    codigo: 'cadastro.paciente.editar',
    descricao: 'Alterar o cadastro do paciente (só as colunas que mudaram; aviso de colisão)',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
  },
  {
    codigo: 'cadastro.paciente.verDocumento',
    descricao: 'Ver CPF, CNS e documentos sem máscara na ficha do paciente',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: 'cadastro.paciente.verSensivel',
    descricao: 'Ver raça/cor, religião, vulnerabilidade e responsável legal do paciente',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['assistencial-com-conselho'],
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: 'cadastro.consentimento.ler',
    descricao: 'Ver os consentimentos do paciente (finalidade, versão, revogação e signatário)',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['assistencial-com-conselho'],
    categoria: 'administrativa',
  },
  {
    codigo: 'cadastro.consentimento.registrar',
    descricao: 'Registrar ou revogar consentimento do paciente por finalidade',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: 'cadastro.historico.ler',
    descricao:
      'Ver a linha do tempo do cadastro do paciente e do profissional (versões gravadas a cada alteração)',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: 'cadastro.duplicidade.ler',
    descricao: 'Ver a fila de duplicidades e comparar cadastros lado a lado',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: 'cadastro.duplicidade.decidir',
    descricao: 'Decidir um par da fila ("É outra pessoa") e atualizar a fila',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
  },
  {
    codigo: 'cadastro.pessoa.ler',
    descricao: 'Consultar pessoas por CPF ou CNPJ e onde são usadas',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: 'cadastro.profissional.ler',
    descricao: 'Consultar profissionais, registros em conselho, CBO, especialidades e lotação',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema'],
    categoria: 'administrativa',
  },
  {
    codigo: 'cadastro.solicitante.ler',
    descricao: 'Consultar médicos solicitantes externos (conselho, UF e número)',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema'],
    categoria: 'administrativa',
  },
  // D-PROF-39 (liberação full, 30/10/2026): a inclusão e a edição do profissional do corpo clínico (dados, registros,
  // especialidades, lotação e credenciamento), para quem tem Profissionais › Gerenciamento › Incluir (6392) e
  // › Alterar (6391) no gerenciamento de profissionais.
  {
    codigo: 'cadastro.profissional.criar',
    descricao: 'Incluir profissional do corpo clínico com o registro no conselho e o CBO',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema'],
    categoria: 'administrativa',
  },
  {
    codigo: 'cadastro.profissional.editar',
    descricao:
      'Alterar profissional do corpo clínico: dados, registros (conselho e sigla), especialidades, lotação e convênios',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema'],
    categoria: 'administrativa',
  },
  // F3.1 (02-CAD linha 16): o dado fiscal do repasse e a conta para o pagamento do profissional, com acesso restrito ao
  // cargo do repasse (a edição do profissional não basta).
  {
    codigo: 'cadastro.profissional.financeiro.ler',
    descricao:
      'Consultar os dados fiscais (regime, retenções, ISS) e as contas para o pagamento do profissional',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema'],
    categoria: 'financeira',
    criticidade: 'sensivel',
  },
  {
    codigo: 'cadastro.profissional.financeiro.editar',
    descricao:
      'Incluir e encerrar os dados fiscais do repasse e incluir e inativar as contas e chaves de pagamento do profissional',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema'],
    categoria: 'financeira',
    criticidade: 'critica',
  },
  // D-PROF-39 (requisitos do dono de 18/11/2026): inativar, reativar e excluir o cadastrado por engano (só sem
  // vínculo), para quem tem Profissionais › Gerenciamento › Excluir (6393), e encerrar ou reativar um registro. O
  // vínculo com o login exige a gestão de acessos (acesso.perfil.gerir; revisão da D-PROF-39).
  {
    codigo: 'cadastro.profissional.excluir',
    descricao:
      'Inativar e reativar o profissional do corpo clínico (e cada registro dele) e excluir o cadastrado por engano (só sem nenhum vínculo)',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema'],
    categoria: 'administrativa',
  },
  // Revisão do M39 (onda 1, campo 7): a inclusão do médico solicitante externo pela tela do cadastro, para quem tem a
  // inclusão no gerenciamento de profissionais (Profissionais › Gerenciamento › Incluir, 6392).
  {
    codigo: 'cadastro.solicitante.criar',
    descricao: 'Incluir médico solicitante externo (conselho, UF e número; sem repetir o mesmo registro)',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema'],
    categoria: 'administrativa',
  },
] as const satisfies readonly DeclaracaoPermissao[];

export type PermissaoCadastro = (typeof PERMISSOES_CADASTRO_M11)[number]['codigo'];
