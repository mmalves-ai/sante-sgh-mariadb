// Permissões do M49 (ficha, seção 7; convencoes.md §12): assinar documento e em lote, vincular o próprio certificado,
// política por tipo de documento, OIDs e formas de assinatura, provedores em nuvem e o painel do verificador público. Quem tem a opção no outro sistema
// tem a permissão no novo (regra 1 do M06). Opções da árvore do menu de origem levantadas no preparo (catalogo-legado.json, pc):
//   - P.E.P. › Movimentações › Pendências de assinatura digital 5298 (Consultar 5534);
//   - P.E.P. › Movimentações › Receita/Atestado Digital 6463 (Nova 6468, Consultar 6464, Impressão 6467, Suspender 6469);
//   - Tabelas › Geral A - L › Assinatura avançada 6922 (Gerenciamento 6923): cadastro de apoio da assinatura.
// A política e os provedores são recursos novos (o outro sistema não tem a tela): concedidos por perfil ao
// Administrador do sistema; a política é decidida com a diretoria clínica (DP-22), o que fica na trilha.
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_ASSINATURA_DIGITAL = {
  pendencias: 5298,
  pendenciasConsultar: 5534,
  receitaAtestadoDigital: 6463,
  receitaAtestadoNova: 6468,
  receitaAtestadoConsultar: 6464,
  assinaturaAvancada: 6922,
  assinaturaAvancadaGerenciar: 6923,
} as const;

const O = OPCOES_ASSINATURA_DIGITAL;
const ADMIN = ['administrador-sistema'] as const;

export const PERMISSOES_DOCUMENTO_M49 = [
  {
    codigo: 'documento.assinatura.assinar',
    descricao:
      'Assinar com certificado ICP-Brasil os próprios documentos emitidos (um a um ou em lote), com a prévia exata',
    opcoesLegado: [O.pendencias, O.receitaAtestadoDigital, O.receitaAtestadoNova],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'critica',
    // O módulo "documento" não tem escopo CASL: quem assina é o autor (conferido no serviço, regra 7 e "nao-e-o-autor").
    escopos: [],
  },
  {
    codigo: 'documento.certificado.vincular',
    descricao: 'Vincular o próprio certificado ICP-Brasil (em nuvem, A1 ou A3) à sua conta',
    opcoesLegado: [],
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: 'documento.politica.ler',
    descricao: 'Consultar a política de assinatura por tipo de documento, conselho e destino',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: 'documento.politica.editar',
    descricao: 'Alterar a política de assinatura por tipo de documento (decisão da diretoria clínica)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'administrativa',
    criticidade: 'critica',
  },
  {
    codigo: 'documento.cadastro.ler',
    descricao: 'Consultar OIDs, tipos de certificado e formas de assinatura',
    opcoesLegado: [O.assinaturaAvancada, O.assinaturaAvancadaGerenciar],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: 'documento.cadastro.editar',
    descricao: 'Editar OIDs, tipos de certificado e formas de assinatura dos provedores',
    opcoesLegado: [O.assinaturaAvancadaGerenciar],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: 'documento.provedor.ler',
    descricao: 'Consultar os provedores de certificado em nuvem (o segredo aparece só como definido ou não)',
    opcoesLegado: [O.assinaturaAvancadaGerenciar],
    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
    criticidade: 'normal',
  },
  {
    codigo: 'documento.provedor.editar',
    descricao: 'Cadastrar provedor de certificado em nuvem, trocar o segredo no cofre e testar a conexão',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    // M49 (etapa 3): o painel interno do verificador público (consultas por dia e resultado, varredura barrada). A página
    // pública (/verificar/:codigo) não pede login nem permissão.
    codigo: 'documento.verificador.ler',
    descricao:
      'Acompanhar as consultas ao verificador público de documentos (contagens por resultado e consultas barradas)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
    criticidade: 'normal',
  },
  {
    codigo: 'documento.assinatura.reprocessar',
    descricao: 'Acompanhar as assinaturas pendentes por falha de revogação ou carimbo e reprocessar à mão',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ADMIN,
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
] as const satisfies readonly DeclaracaoPermissao[];
