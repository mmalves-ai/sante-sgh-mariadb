// Agregador estável dos domínios declarados do CRUD genérico (W0-01). Gerado por
// planejamento/crud/ferramentas/fatiar-catalogo.mjs: não edite à mão. Domínio novo entra no arquivo do prefixo do
// módulo, prefixos/<prefixo>.ts (já importado aqui, mesmo vazio); auxiliares em ajudantes.ts. As listas geradas
// por ferramenta (lote-m14.gerado.ts e as demais importadas abaixo) continuam nos seus arquivos e geradores.
import { DOMINIOS_ACESSO } from './prefixos/acesso.js';
import { DOMINIOS_AGENDA } from './prefixos/agenda.js';
import { DOMINIOS_ATENDIMENTO } from './prefixos/atendimento.js';
import { DOMINIOS_AUDITORIA } from './prefixos/auditoria.js';
import { DOMINIOS_CADASTRO } from './prefixos/cadastro.js';
import { DOMINIOS_CATALOGO } from './prefixos/catalogo.js';
import { DOMINIOS_CIRURGIA } from './prefixos/cirurgia.js';
import { DOMINIOS_CONFIG } from './prefixos/config.js';
import { DOMINIOS_CONTABIL } from './prefixos/contabil.js';
import { DOMINIOS_CONVENIO } from './prefixos/convenio.js';
import { DOMINIOS_CUSTOS } from './prefixos/custos.js';
import { DOMINIOS_DOCUMENTO } from './prefixos/documento.js';
import { DOMINIOS_ENFERMAGEM } from './prefixos/enfermagem.js';
import { DOMINIOS_FATURAMENTO } from './prefixos/faturamento.js';
import { DOMINIOS_FINANCEIRO } from './prefixos/financeiro.js';
import { DOMINIOS_HOTELARIA } from './prefixos/hotelaria.js';
import { DOMINIOS_INTEGRACAO } from './prefixos/integracao.js';
import { DOMINIOS_INTERNACAO } from './prefixos/internacao.js';
import { DOMINIOS_OPERADORA } from './prefixos/operadora.js';
import { DOMINIOS_ORGANIZACAO } from './prefixos/organizacao.js';
import { DOMINIOS_PATRIMONIO } from './prefixos/patrimonio.js';
import { DOMINIOS_PEP } from './prefixos/pep.js';
import { DOMINIOS_PESSOAS } from './prefixos/pessoas.js';
import { DOMINIOS_PRECO } from './prefixos/preco.js';
import { DOMINIOS_QUALIDADE } from './prefixos/qualidade.js';
import { DOMINIOS_RECEPCAO } from './prefixos/recepcao.js';
import { DOMINIOS_RELATORIO } from './prefixos/relatorio.js';
import { DOMINIOS_REPASSE } from './prefixos/repasse.js';
import { DOMINIOS_SADT } from './prefixos/sadt.js';
import { DOMINIOS_SAME } from './prefixos/same.js';
import { DOMINIOS_SUPRIMENTOS } from './prefixos/suprimentos.js';
import { DOMINIOS_M14 } from './lote-m14.gerado.js';
import { DOMINIOS_M48 } from './dominios-m48.js';
import { DOMINIOS_M23 } from './dominios-m23.js';
import { DOMINIOS_M24, DOMINIOS_M24_CADASTROS } from './dominios-m24.js';
import { DOMINIOS_M34 } from './dominios-m34.js';
import { DOMINIOS_M32 } from './dominios-m32.js';
import { DOMINIOS_M33 } from './dominios-m33.js';
import { DOMINIOS_M49 } from './dominios-m49.js';
import { DOMINIOS_M50 } from './dominios-m50.js';
import { DOMINIOS_M50_SESSOES } from './dominios-m50-sessoes.js';
import { DOMINIOS_M47 } from './dominios-m47.js';
import { DOMINIOS_M51 } from './dominios-m51.js';
import { DOMINIOS_M56 } from './dominios-m56.gerado.js';
import { DOMINIOS_M53 } from './dominios-m53.gerado.js';
import { DOMINIOS_M54_CUSTOS } from './dominios-m54-custos.js';
import { DOMINIOS_M54 } from './dominios-m54.gerado.js';
import type { DominioPublico } from './tipos.js';

/** Os domínios de cada prefixo (= módulo do domínio), um arquivo por prefixo. */
export const DOMINIOS_POR_PREFIXO: Readonly<Record<string, readonly DominioPublico[]>> = {
  acesso: DOMINIOS_ACESSO,
  agenda: DOMINIOS_AGENDA,
  atendimento: DOMINIOS_ATENDIMENTO,
  auditoria: DOMINIOS_AUDITORIA,
  cadastro: DOMINIOS_CADASTRO,
  catalogo: DOMINIOS_CATALOGO,
  cirurgia: DOMINIOS_CIRURGIA,
  config: DOMINIOS_CONFIG,
  contabil: DOMINIOS_CONTABIL,
  convenio: DOMINIOS_CONVENIO,
  custos: DOMINIOS_CUSTOS,
  documento: DOMINIOS_DOCUMENTO,
  enfermagem: DOMINIOS_ENFERMAGEM,
  faturamento: DOMINIOS_FATURAMENTO,
  financeiro: DOMINIOS_FINANCEIRO,
  hotelaria: DOMINIOS_HOTELARIA,
  integracao: DOMINIOS_INTEGRACAO,
  internacao: DOMINIOS_INTERNACAO,
  operadora: DOMINIOS_OPERADORA,
  organizacao: DOMINIOS_ORGANIZACAO,
  patrimonio: DOMINIOS_PATRIMONIO,
  pep: DOMINIOS_PEP,
  pessoas: DOMINIOS_PESSOAS,
  preco: DOMINIOS_PRECO,
  qualidade: DOMINIOS_QUALIDADE,
  recepcao: DOMINIOS_RECEPCAO,
  relatorio: DOMINIOS_RELATORIO,
  repasse: DOMINIOS_REPASSE,
  sadt: DOMINIOS_SADT,
  same: DOMINIOS_SAME,
  suprimentos: DOMINIOS_SUPRIMENTOS,
};

/** Todos os domínios declarados: os de cada prefixo e as listas geradas por ferramenta. */
export const DOMINIOS_DECLARADOS: readonly DominioPublico[] = [
  ...DOMINIOS_ACESSO,
  ...DOMINIOS_AGENDA,
  ...DOMINIOS_ATENDIMENTO,
  ...DOMINIOS_AUDITORIA,
  ...DOMINIOS_CADASTRO,
  ...DOMINIOS_CATALOGO,
  ...DOMINIOS_CIRURGIA,
  ...DOMINIOS_CONFIG,
  ...DOMINIOS_CONTABIL,
  ...DOMINIOS_CONVENIO,
  ...DOMINIOS_CUSTOS,
  ...DOMINIOS_DOCUMENTO,
  ...DOMINIOS_ENFERMAGEM,
  ...DOMINIOS_FATURAMENTO,
  ...DOMINIOS_FINANCEIRO,
  ...DOMINIOS_HOTELARIA,
  ...DOMINIOS_INTEGRACAO,
  ...DOMINIOS_INTERNACAO,
  ...DOMINIOS_OPERADORA,
  ...DOMINIOS_ORGANIZACAO,
  ...DOMINIOS_PATRIMONIO,
  ...DOMINIOS_PEP,
  ...DOMINIOS_PESSOAS,
  ...DOMINIOS_PRECO,
  ...DOMINIOS_QUALIDADE,
  ...DOMINIOS_RECEPCAO,
  ...DOMINIOS_RELATORIO,
  ...DOMINIOS_REPASSE,
  ...DOMINIOS_SADT,
  ...DOMINIOS_SAME,
  ...DOMINIOS_SUPRIMENTOS,
  ...DOMINIOS_M14,
  // M23: os cadastros de dieta (nutrição clínica e hotelaria).
  ...DOMINIOS_M23,
  // M24: cadastros de prescrição (locais de assistência, perguntas à operadora, hemocomponentes).
  ...DOMINIOS_M24,
  ...DOMINIOS_M24_CADASTROS,
  // M34: de-para do laboratório de apoio e das interfaces; domínios das mensagens, da classificação externa e dos webservices.
  ...DOMINIOS_M34,
  // M32: cadastros e parâmetros financeiros, naturezas de operação, de-para contábil, NFS-e e escrituração.
  ...DOMINIOS_M32,
  // M33: eventos de RPA, parâmetros, integração contábil, configurações, cooperativas e credenciamento do repasse.
  ...DOMINIOS_M33,
  // M49 (etapa 3): OIDs ICP-Brasil, tipos de OID e de certificado e as formas, situações e tipos dos provedores em nuvem.
  ...DOMINIOS_M49,
  // M56 (etapa F0): as 63 migrar-crud da operadora própria (40 de sistema, 7 travadas, 16 editáveis).
  ...DOMINIOS_M56,
  // M54 (etapa 4): os cadastros da estrutura de custos (contas de receita, grupos de exportação, tipos de dado e de regra
  // de rateio, unidades de mensuração).
  ...DOMINIOS_M54_CUSTOS,
  // M50 (etapa 5): os domínios da portaria e dos terminais.
  ...DOMINIOS_M50,
  // M50 (etapa 6): as agendas de sessões e os recursos (cadeiras e salas).
  ...DOMINIOS_M50_SESSOES,
  // M47 (etapa 2): os cadastros da agência transfusional (editáveis só com a agência própria).
  ...DOMINIOS_M47,
  // M51 (etapa 2): os médicos solicitantes SUS (FAMEDSOL).
  ...DOMINIOS_M51,
  // M53 (etapa F1): rubricas, incidências, tabelas legais, lançamento automático por empresa e rotinas de integração
  // da folha (`pnpm folha:rubricas`).
  ...DOMINIOS_M53,
  // M54 (etapa F1): as 15 migrar-crud da controladoria nos grupos contabil, custos, patrimonio e financeiro
  // (`pnpm contabil:dominios`).
  ...DOMINIOS_M54,
  // M48 (etapa 5): as autoridades sanitárias e os eixos e graus da matriz GUT.
  ...DOMINIOS_M48,
];

export function dominioPublico(modulo: string, recurso: string): DominioPublico | undefined {
  return DOMINIOS_DECLARADOS.find((d) => d.modulo === modulo && d.recurso === recurso);
}
