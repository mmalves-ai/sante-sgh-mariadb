// Cadastros da assinatura digital no CRUD genérico (M49, etapa 3; ficha, seção 5, "Receita genérica do CRUD para as 7
// tabelas migrar-crud do marco"): os OIDs ICP-Brasil (DOC-ICP-04.01) e os tipos de OID, os tipos de certificado e, dos
// provedores em nuvem do outro sistema, as formas de assinatura (SafeWeb e Vidaas), as situações da autorização e os
// tipos de atendimento. "Consulta por padrão; atualizar um OID do DOC-ICP-04.01 ou uma forma de provedor é edição pela
// receita genérica": nenhuma das tabelas tem trigger nem generator (o código é digitado, nunca MAX+1); só o OID ganha
// inclusão (um OID novo de uma versão nova do DOC-ICP-04.01); os demais só se alteram (os códigos são os das APIs dos
// provedores e do cadastro do outro sistema). As formas de assinatura ICP (AD-RB e AD-RT) são só leitura (consulta do
// item). Opções do outro sistema (TBOPCOES): Tabelas › Geral A–L › Assinatura avançada 6922 (Gerenciamento 6923): o
// cadastro de apoio da assinatura; a tela própria dos OIDs não tem opção separada na árvore (inferida: conferir na
// validação). As permissões `documento.cadastro.ler/.editar` da tela vêm do mesmo par de opções.
import type { DominioPublico } from './tipos.js';

const LER = [6922, 6923];
const GERENCIAR = [6923];
const CIE = ['ler', 'criar', 'editar', 'exportar'] as const;
const IE = ['ler', 'editar', 'exportar'] as const;

const opcoes = (acoes: DominioPublico['acoes']): DominioPublico['opcoesLegado'] =>
  Object.fromEntries(acoes.map((a) => [a, a === 'ler' || a === 'exportar' ? LER : GERENCIAR])) as never;

const doc = (
  recurso: string,
  singular: string,
  plural: string,
  acoes: DominioPublico['acoes'],
  extra: Partial<DominioPublico> = {},
): DominioPublico => ({
  modulo: 'documento',
  recurso,
  rotulo: { singular, plural },
  subitem: 'assinaturaCadastros',
  natureza: 'editavel',
  acoes,
  opcoesLegado: opcoes(acoes),
  origemOpcoes: 'inferida',
  marco: 'M49',
  ...extra,
});

const SO_ALTERA =
  'os códigos são os das APIs dos provedores e do cadastro de origem: só se alteram o nome e o vínculo';

export const DOMINIOS_M49: readonly DominioPublico[] = [
  doc('oidIcp', 'OID ICP-Brasil', 'OIDs ICP-Brasil', CIE),
  doc('tipoOid', 'Tipo de OID', 'Tipos de OID', IE, {
    semInclusao: 'os tipos de OID classificam os campos do certificado que o sistema lê: só se altera o nome',
  }),
  doc('tipoCertificado', 'Tipo de certificado', 'Tipos de certificado', IE, {
    semInclusao:
      'os tipos de certificado são os meios de assinatura que o sistema conhece: só se altera o nome',
  }),
  doc('formaAssinaturaSafeweb', 'Forma de assinatura (SafeWeb)', 'Formas de assinatura (SafeWeb)', IE, {
    semInclusao: SO_ALTERA,
  }),
  doc('formaAssinaturaVidaas', 'Forma de assinatura (Vidaas)', 'Formas de assinatura (Vidaas)', IE, {
    semInclusao: SO_ALTERA,
  }),
  doc(
    'situacaoAutorizacaoSafeweb',
    'Situação da autorização (SafeWeb)',
    'Situações da autorização (SafeWeb)',
    IE,
    { semInclusao: SO_ALTERA },
  ),
  doc('tipoAtendimentoSafeweb', 'Tipo de atendimento (SafeWeb)', 'Tipos de atendimento (SafeWeb)', IE, {
    semInclusao: SO_ALTERA,
  }),
];
