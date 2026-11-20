// Fonte das telas de parâmetros e de funcionalidades por estabelecimento (M08): o núcleo do legado (SGH_CFG_*
// pela transação SGH_ do núcleo, com a SGH_TRILHA na mesma transação; parâmetros do legado em READ ONLY) ou a
// memória (sessão sintética, dev/ci: nada vai à cópia; a trilha vai ao registrador da API). Com cache
// (CacheConfig) e invalidação por evento depois do commit (regra 10).
import {
  CHAVES_TELA_ONDA_0,
  chaveLiberacaoRelatorio,
  type ParametroLegadoDescrito,
  RELATORIOS_CATALOGO,
  type ValorParametro,
} from '@sgh/contratos';
import {
  aplicarLoteLiberacao,
  type ChaveGravada,
  type DefinicaoGravada,
  ErroConfiguracaoSgh,
  type EstadoDoLote,
  gravarDefinicaoParametro,
  type RetiradaGravada,
  retirarSobreposicaoParametro,
  gravarPrerequisito,
  lerChavesLiberacao,
  type Leitor,
  lerLote,
  lerParametrosLegado,
  lerPrerequisitos,
  lerValoresParametro,
  type LinhaTrilha,
  type MudancaChave,
  type NucleoLegado,
  painelParametrosLegado,
  PARAMETROS_LEGADO,
  type PrerequisitoGravado,
  relogioDoBanco,
} from '@sgh/legado';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroFonteIndisponivel } from './dominios-fonte.js';

/** M21: as chaves da internação, do mapa, do supervisor, da higienização e do SAME (ficha, seção 12). */
const M21_CHAVES = [
  'internacao.adt',
  'leitos.mapa',
  'internacao.supervisor',
  'hotelaria.limpeza',
  'same.movimento',
] as const;
/** M25: a checagem, o aprazamento, os sinais vitais e o plantão (a leitura obrigatória da dose fica desligada: M29). */
const M25_CHAVES = [
  'enfermagem.checagem',
  'enfermagem.aprazamento',
  'enfermagem.sinaisVitais',
  'enfermagem.plantao',
] as const;
/** M45 (etapa 3): o balanço hídrico (o E2E @M45.3 percorre). */
const M45_E3_CHAVES = ['enfermagem.balanco'] as const;
/** M50 (etapa 5): a portaria e o simulador da catraca (o E2E @M50.5 percorre); a biometria fica desligada (DP-45). */
const M50_E5_CHAVES = ['portaria', 'portaria.catraca'] as const;
/**
 * M45 (etapa 4): a SAE e a prescrição de enfermagem, a receita do enfermeiro e a vacina (o E2E @M45.4 percorre; a receita
 * e a vacina nascem desligadas fora da sessão sintética, POL-3).
 */
const M45_E4_CHAVES = [
  ['enfermagem.sae', 'aprovacao'],
  ['enfermagem.prescricaoMedicamento', 'aprovacao'],
  ['enfermagem.vacina', 'credenciamento'],
] as const;
/**
 * M46 (etapa 1): a APA, a ficha anestésica e a SRPA (o E2E @M46.1 percorre; fora da sessão sintética nascem desligadas,
 * POL-3, com os pré-requisitos de aprovação do anestesista chave-usuário e da coordenação do bloco).
 */
const M46_E1_CHAVES = [['bloco.ficha', 'aprovacao']] as const;
/**
 * M47 (etapa 1): a agência transfusional (o E2E @M47.1 percorre); a agência completa (etapa 2) fica desligada até a
 * DP-21.
 */
const M47_E1_CHAVES = ['agencia.transfusao'] as const;
/** M48 (etapa 1): a notificação de incidentes (o E2E @M48.1 percorre). */
const M48_E1_CHAVES = ['qualidade.notificacao'] as const;
/** M48 (etapa 3): a CCIH (o E2E @M48.3 percorre). */
const M48_E3_CHAVES = ['qualidade.ccih'] as const;
/** M48 (etapa 4): a notificação compulsória de agravos (o E2E @M48.4 percorre). */
const M48_E4_CHAVES = ['qualidade.agravos'] as const;
/** M48 (etapa 5): a gestão da qualidade e os envios regulatórios (o E2E @M48.5 percorre). */
const M48_E5_CHAVES = ['qualidade.gestao'] as const;
/**
 * M46 (etapa 2): o checklist de cirurgia segura, a trava da incisão e o rastreio com o painel para familiares (o E2E
 * @M46.2 percorre; fora da sessão sintética nascem desligadas, POL-3, com os pré-requisitos do núcleo de segurança do
 * paciente, da enfermagem e da coordenação do bloco).
 */
const M46_E2_CHAVES = [
  ['bloco.checklistFormulario', 'aprovacao'],
  ['bloco.checklistTrava', 'aprovacao'],
  ['bloco.rastreio', 'aprovacao'],
] as const;
/**
 * M46 (etapa 3): o OPME (o E2E @M46.3 percorre a solicitação, a autorização, o consumo em sala e a conciliação; fora da
 * sessão sintética nasce desligado, POL-3, com os pré-requisitos do almoxarifado, do faturamento e do bloco).
 */
const M46_E3_CHAVES = [['suprimentos.opme', 'aprovacao']] as const;
/**
 * M46 (etapa 4): os consignados e a manipulação (o E2E @M46.4 percorre a remessa, a reposição, o faturamento, a ordem, a
 * dupla conferência e a baixa; fora da sessão sintética nascem desligados, POL-3, com os pré-requisitos).
 */
const M46_E4_CHAVES = [
  ['suprimentos.consignado', 'aprovacao'],
  ['suprimentos.manipulacao', 'aprovacao'],
] as const;
/**
 * M54 (etapa 4): os custos hospitalares (estrutura de custos e estatísticas; o E2E @M54.4 percorre a classificação, a
 * coleta e o lançamento; fora da sessão sintética nasce desligado, POL-3, com o pré-requisito do analista de custos).
 */
const M54_E4_CHAVES = [['custos', 'aprovacao']] as const;
/**
 * M54 (etapa 7): o orçamento empresarial (o E2E @M54.7 percorre a versão, os valores, a aprovação e o comparativo; fora
 * da sessão sintética nasce desligado, POL-3, com o pré-requisito da controladoria).
 */
const M54_E7_CHAVES = [['orcamento', 'aprovacao']] as const;
/**
 * M54 (etapa 6): o patrimônio (bens, movimentos, depreciação e inventário; o E2E @M54.6 percorre o cadastro da nota, a
 * depreciação e o inventário; fora da sessão sintética nasce desligado, POL-3, com o pré-requisito do patrimônio).
 */
const M54_E6_CHAVES = [['patrimonio', 'aprovacao']] as const;
/**
 * M55 (etapa 3): os contratos com fornecedores (o E2E @M55.3 percorre o contrato, o aditivo, o pedido ligado e o saldo;
 * fora da sessão sintética nascem desligados, POL-3, com os pré-requisitos de compras e da diretoria).
 */
const M55_E3_CHAVES = [['contratos', 'aprovacao']] as const;
/**
 * M55 (etapa 5): a contratualização SUS (o E2E @M55.5 percorre o contrato com o gestor, as metas, a apuração e o painel
 * produção × meta; fora da sessão sintética nasce desligada, POL-3, com os pré-requisitos do faturamento SUS).
 */
const M55_E5_CHAVES = [['contratualizacao', 'aprovacao']] as const;
/**
 * M55 (etapa 4): a licitação e o pregão (o E2E @M55.4 percorre o processo até a ata; fora da sessão sintética nasce
 * desligada, DP-13 e POL-3, com os pré-requisitos da diretoria e do jurídico).
 */
const M55_E4_CHAVES = [['licitacao', 'aprovacao']] as const;
export const FONTE_CONFIGURACAO = Symbol('FONTE_CONFIGURACAO');

export type TrilhaConfig = Omit<LinhaTrilha, 'tabelaAlvo' | 'idAlvo'>;

export interface PedidoLote {
  readonly hospital: string;
  readonly tipo: 'operacao' | 'recurso';
  readonly chave: string;
  /**
   * Decide as mudanças sobre o estado relido NA transação, com trava (nunca sobre o cache); pode recusar
   * lançando ErroProblema.
   */
  readonly planejar: (estado: EstadoDoLote) => readonly MudancaChave[];
  readonly justificativa: string;
  readonly autor: string;
  readonly referenciaAutorizacao?: string | null;
}

export interface PedidoPrerequisito {
  readonly hospital: string;
  readonly recurso: string;
  readonly tipo: PrerequisitoGravado['tipo'];
  readonly situacao: PrerequisitoGravado['situacao'];
  readonly validade: string | null;
  readonly evidencia: string | null;
  readonly autor: string;
}

export interface FonteConfiguracao {
  readonly destino: 'legado' | 'memoria';
  relogio(rede: string, hospital: string): Promise<Date>;
  valoresParametro(rede: string, hospital: string): Promise<ValorParametro[]>;
  definirParametro(d: DefinicaoGravada, trilha: TrilhaConfig): Promise<{ id: string }>;
  /** W0-09: fecha a vigente do nível e do alvo (volta a herdar), com quem e o motivo; trilha junta. */
  retirarParametro(d: RetiradaGravada, trilha: TrilhaConfig): Promise<{ fechadas: readonly string[] }>;
  parametrosLegado(rede: string, hospital: string, login: string): Promise<ParametroLegadoDescrito[]>;
  chaves(rede: string, hospital: string): Promise<ChaveGravada[]>;
  aplicarLote(
    rede: string,
    p: PedidoLote,
    trilha: TrilhaConfig,
  ): Promise<{ lote: string; alteradas: number }>;
  /**
   * Vários lotes (um por chave) numa transação SGH_ só, na ordem dada: a falha de qualquer um desfaz todos (M44,
   * regra 6: desligar a classificação externa e ligar a própria são a mesma mudança de configuração).
   */
  aplicarLotes(
    rede: string,
    pedidos: readonly PedidoLote[],
    trilha: TrilhaConfig,
  ): Promise<{ lote: string; alteradas: number }[]>;
  lote(rede: string, hospital: string, lote: string): Promise<ChaveGravada[]>;
  prerequisitos(rede: string, hospital: string): Promise<PrerequisitoGravado[]>;
  gravarPrerequisito(rede: string, p: PedidoPrerequisito, trilha: TrilhaConfig): Promise<void>;
}

export function fonteConfiguracaoLegado(nucleo: NucleoLegado): FonteConfiguracao {
  const ctx = (rede: string, hospital: string, traceId: string) => ({
    rede,
    hospital,
    traceId: traceId.slice(0, 64),
  });
  return {
    destino: 'legado',
    relogio: (rede, h) => nucleo.lerSomente(ctx(rede, h, 'cfg'), (l) => relogioDoBanco(l)),
    valoresParametro: (rede, h) => nucleo.lerSomente(ctx(rede, h, 'cfg'), (l) => lerValoresParametro(l, h)),
    definirParametro: (d, t) =>
      nucleo.gravarSgh(ctx(d.rede, d.hospital, t.correlacao), (e) => gravarDefinicaoParametro(e, d, t)),
    retirarParametro: (d, t) =>
      nucleo.gravarSgh(ctx(d.rede, d.hospital, t.correlacao), (e) => retirarSobreposicaoParametro(e, d, t)),
    parametrosLegado: (rede, h, login) =>
      nucleo.lerSomente(ctx(rede, h, 'cfg'), (l) => painelParametrosLegado(l, login)),
    chaves: (rede, h) => nucleo.lerSomente(ctx(rede, h, 'cfg'), (l) => lerChavesLiberacao(l, h)),
    aplicarLote: (rede, p, t) =>
      nucleo.gravarSgh(ctx(rede, p.hospital, t.correlacao), (e) => aplicarLoteLiberacao(e, p, t)),
    aplicarLotes: (rede, ps, t) =>
      nucleo.gravarSgh(ctx(rede, ps[0]?.hospital ?? t.hospital, t.correlacao), async (e) => {
        if (ps.some((p) => p.hospital !== (ps[0]?.hospital ?? '')))
          throw new Error('Lotes de estabelecimentos diferentes na mesma transação.');
        const r: { lote: string; alteradas: number }[] = [];
        for (const p of ps) r.push(await aplicarLoteLiberacao(e, p, t));
        return r;
      }),
    lote: (rede, h, lote) => nucleo.lerSomente(ctx(rede, h, 'cfg'), (l) => lerLote(l, h, lote)),
    prerequisitos: (rede, h) => nucleo.lerSomente(ctx(rede, h, 'cfg'), (l) => lerPrerequisitos(l, h)),
    gravarPrerequisito: (rede, p, t) =>
      nucleo.gravarSgh(ctx(rede, p.hospital, t.correlacao), (e) => gravarPrerequisito(e, p, t)),
  };
}

/** Fora de dev/ci sem o núcleo: falha fechada (503 em toda chamada; nunca a memória). */
export function fonteConfiguracaoIndisponivel(): FonteConfiguracao {
  const recusar = async (): Promise<never> => {
    throw new ErroFonteIndisponivel();
  };
  return {
    destino: 'legado',
    relogio: recusar,
    valoresParametro: recusar,
    definirParametro: recusar,
    retirarParametro: recusar,
    parametrosLegado: recusar,
    chaves: recusar,
    aplicarLote: recusar,
    aplicarLotes: recusar,
    lote: recusar,
    prerequisitos: recusar,
    gravarPrerequisito: recusar,
  };
}

/** Linha sintética dos parâmetros do legado (sessão sintética): só as colunas declaradas têm valor. */
function leitorSintetico(): Leitor {
  return {
    hospital: 'sintetico',
    async consultar<T>(sql: string): Promise<T[]> {
      const tabela = PARAMETROS_LEGADO.find((t) => sql.includes(` FROM ${t.tabela}`));
      if (!tabela) return [];
      const linha: Record<string, unknown> = {};
      for (const [c, tipo] of Object.entries(tabela.declaradas))
        linha[c] = tipo.tipo === 'letra' ? tipo.verdadeiro : tipo.tipo === 'hora' ? '0800' : 1;
      return [linha as T];
    },
    async lerBlob() {
      return Buffer.alloc(0);
    },
  } as unknown as Leitor;
}

/**
 * Chaves que a sessão sintética (dev/ci) já encontra ligadas no estabelecimento: as dos recursos que os testes
 * de ponta a ponta percorrem (o prontuário ao vivo, M15). Desligar pela tela continua valendo (recolher).
 */
export function chavesIniciaisSinteticas(): ChaveGravada[] {
  return [
    {
      id: 'sintetica-1',
      tipo: 'recurso',
      chave: 'pep.prontuario.consulta',
      escopo: 'hospital',
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-21T00:00:00.000Z',
    },
    // M22: registro clínico nos modelos do formulário (o E2E @M22 percorre).
    {
      id: 'sintetica-2',
      tipo: 'recurso',
      chave: 'pep.evolucao.registro',
      escopo: 'hospital',
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-21T00:00:00.000Z',
    },
    // M16: painel de leitos ao vivo, censo, painéis gerenciais e indicadores (o E2E @M16 percorre). O fechamento
    // automático do censo e o BI ficam desligados (onda 2 e cópia diária de produção).
    ...(['internacao.leitos.painel', 'relatorio.paineis'] as const).map((chave, i) => ({
      id: `sintetica-m16-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-21T00:00:00.000Z',
    })),
    // M38: as chaves das telas de consulta da onda 0 (cadastro, domínios, acessos ao prontuário, matriz e saúde): as
    // telas existiam antes da chave, e os testes de ponta a ponta dos marcos de origem as percorrem.
    ...CHAVES_TELA_ONDA_0.map((chave, i) => ({
      id: `sintetica-m38-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-24T00:00:00.000Z',
    })),
    // M23: documentos, alergias, exames, anexos e os recursos só do novo (o E2E @M23 percorre).
    ...RECURSOS_SINTETICOS_M23.map((chave, i) => ({
      id: `sintetica-m23-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-21T00:00:00.000Z',
    })),
    // M49, etapa 2: a assinatura ICP-Brasil dos documentos emitidos (o E2E @M49.2 percorre, no simulador). A numeração
    // SNCR (`receita.sncr`) continua desligada (POL-3: falta o credenciamento).
    {
      id: 'sintetica-m49-1',
      tipo: 'recurso',
      chave: 'assinatura.icp',
      escopo: 'hospital',
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-24T00:00:00.000Z',
    },
    // M49, etapa 3: a entrada com certificado A1/A3 (o E2E @M49.3 percorre com o agente local simulado).
    {
      id: 'sintetica-m49-3',
      tipo: 'recurso',
      chave: 'acesso.loginCertificado',
      escopo: 'hospital',
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-24T00:00:00.000Z',
    },
    // W1-01 (parte 7): o "Esqueci a senha" (o envio fica em memória na sintética: nada sai da VM).
    {
      id: 'sintetica-w1-01-7',
      tipo: 'recurso',
      chave: 'acesso.recuperacaoSenha',
      escopo: 'hospital',
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-11-18T00:00:00.000Z',
    },
    // M50, etapa 1: o portal do paciente (o E2E @M50.1 percorre convite, ativação com segundo fator, documentos,
    // responsável legal, consentimentos, pedidos do titular e o relatório de acessos).
    {
      id: 'sintetica-m50-1',
      tipo: 'recurso',
      chave: 'portal.conta',
      escopo: 'hospital',
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-24T00:00:00.000Z',
    },
    // M50, etapa 3: o portal do médico externo (o E2E @M50.3 percorre o vínculo, o extrato, a agenda e o pedido).
    {
      id: 'sintetica-m50-3',
      tipo: 'recurso',
      chave: 'portal.medicoExterno',
      escopo: 'hospital',
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    },
    // M50, etapa 4: a telemedicina (o E2E @M50.4 percorre a sala de espera, o início com o provedor simulado, o
    // encerramento e a teleinterconsulta).
    {
      id: 'sintetica-m50-4',
      tipo: 'recurso',
      chave: 'telemedicina',
      escopo: 'hospital',
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    },
    // M50, etapa 2: o agendamento online e o pagamento do portal (o E2E @M50.2 percorre marcar, pré-check-in, conferir,
    // pagar no gateway simulado e responder a pesquisa).
    ...(['portal.agenda', 'portal.pagamento'] as const).map((chave, i) => ({
      id: `sintetica-m50-2-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    })),
    // M17: agenda de consultas (o E2E @M17 percorre marcação, encaixe, remarcação e cancelamento).
    {
      id: 'sintetica-3',
      tipo: 'recurso',
      chave: 'agenda.consulta',
      escopo: 'hospital',
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-21T00:00:00.000Z',
    },
    // M24: prescrição eletrônica, reconciliação e ficha de antimicrobiano (o E2E @M24 percorre).
    ...(['pep.prescricao.cpoe', 'pep.reconciliacao.registro', 'pep.antimicrobiano.ficha'] as const).map(
      (chave, i) => ({
        id: `sintetica-m24-${i + 1}`,
        tipo: 'recurso' as const,
        chave,
        escopo: 'hospital' as const,
        valor: '*',
        ligada: true,
        ligadaAntes: null,
        lote: null,
        justificativa: 'Sessão sintética de desenvolvimento e testes',
        alteradoPor: 'SINT.ADMIN',
        alteradoEm: '2026-10-21T00:00:00.000Z',
      }),
    ),
    // M19: recepção (o E2E @M19 percorre totem, painel, guichê, encaminhamento e check-in).
    {
      id: 'sintetica-4',
      tipo: 'recurso',
      chave: 'recepcao.senha',
      escopo: 'hospital',
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-21T00:00:00.000Z',
    },
    // M20: atendimento ambulatorial, pronto atendimento e a exclusão (o E2E @M20 percorre).
    ...(['atendimento.ambulatorio', 'atendimento.pa', 'atendimento.cancelar'] as const).map((chave, i) => ({
      id: `sintetica-m20-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-22T00:00:00.000Z',
    })),
    // M50 (etapa 6): a agenda de sessões e a digitalização certificada (o E2E @M50.6 percorre).
    ...['sessoes', 'digitalizacao'].map((chave) => ({
      id: `sintetica-m50-6-${chave}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    })),
    // M45 (etapa 5): a nutrição e o serviço social (o E2E @M45.5 percorre).
    ...['nutricao', 'servico.social'].map((chave) => ({
      id: `sintetica-m45-5-${chave}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    })),
    // M45 (etapa 1): o construtor de formulários novos (o E2E @M45.1 percorre); a ponte com o prontuário, não.
    {
      id: 'sintetica-m45-1',
      tipo: 'recurso',
      chave: 'pep.formularioNovo',
      escopo: 'hospital',
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-24T00:00:00.000Z',
    },
    // M45 (etapa 2): os escores, a classificação de pacientes e os índices de UTI (o E2E @M45.2 percorre).
    {
      id: 'sintetica-m45-2',
      tipo: 'recurso',
      chave: 'enfermagem.escores',
      escopo: 'hospital',
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    },
    // M45 (etapa 6; DP-32): as especialidades sob demanda e o lactário, desligados fora daqui; a sessão sintética liga
    // para o E2E @M45.6 percorrer (sem linha em SGH_CFG_LIBERACAO o estabelecimento fica com tudo desligado).
    ...[
      'pep.especialidade.oftalmologia',
      'pep.especialidade.oncologia',
      'pep.especialidade.obstetricia',
      'nutricao.lactario',
      // M55 (fatia F2): a rouparia, ligada na sintética para o E2E @M55.2.
      'rouparia',
      // M55 (etapa 1): a manutenção e engenharia clínica, ligada na sintética para o E2E @M55.1.
      'manutencao',
    ].map((chave) => ({
      id: `sintetica-m45-6-${chave}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    })),
    // M44: a classificação de risco no PA (o E2E @M44.1 percorre).
    {
      id: 'sintetica-m44-1',
      tipo: 'recurso',
      chave: 'pa.classificacao',
      escopo: 'hospital',
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-24T00:00:00.000Z',
    },
    // M44 (etapa 2): o NIR (o E2E @M44.2 percorre).
    {
      id: 'sintetica-m44-2',
      tipo: 'recurso',
      chave: 'nir',
      escopo: 'hospital',
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-24T00:00:00.000Z',
    },
    // M57 (etapa 1): o MPI da Rede (o E2E @M57.1 percorre).
    {
      id: 'sintetica-m57-1',
      tipo: 'recurso',
      chave: 'rede.mpi',
      escopo: 'hospital',
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-24T00:00:00.000Z',
    },
    // M57 (etapa 3): o BI consolidado da Rede e os serviços compartilhados (o E2E @M57.3 percorre). O pseudônimo comum
    // (DP-42) fica desligado: a tela mostra o pseudônimo por estabelecimento.
    {
      id: 'sintetica-m57-3',
      tipo: 'recurso',
      chave: 'rede.bi',
      escopo: 'hospital',
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    },
    // M57 (etapa 2): a unificação de prontuários (o E2E @M57.2 percorre). O acesso cruzado ao prontuário
    // (`rede.acessoCruzado`) fica DESLIGADO também aqui: a DP-42 não foi decidida (o E2E confere a recusa).
    {
      id: 'sintetica-m57-2',
      tipo: 'recurso',
      chave: 'cadastro.unificacao',
      escopo: 'hospital',
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    },
    // M28: estoque, nota fiscal, compras, inventário, kits, fechamento e saneamento (o E2E @M28 percorre).
    ...RECURSOS_SINTETICOS_M28.map((chave, i) => ({
      id: `sintetica-m28-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-22T00:00:00.000Z',
    })),
    // M29: dispensação, entrega, avaliação e controlados (o E2E @M29 percorre); o livro oficial e o SNGPC desligados.
    ...RECURSOS_SINTETICOS_M29.map((chave, i) => ({
      id: `sintetica-m29-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-23T00:00:00.000Z',
    })),
    // M33: o repasse médico (o E2E @M33 percorre).
    ...RECURSOS_SINTETICOS_M33.map((chave, i) => ({
      id: `sintetica-m33-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-23T00:00:00.000Z',
    })),
    // M32: contas a pagar, contas a receber, tesouraria e fiscal (o E2E @M32 percorre).
    ...RECURSOS_SINTETICOS_M32.map((chave, i) => ({
      id: `sintetica-m32-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-23T00:00:00.000Z',
    })),
    // M31: protocolo e recurso, conciliação, lote, competência e webservices (o E2E @M31 percorre).
    ...RECURSOS_SINTETICOS_M31.map((chave, i) => ({
      id: `sintetica-m31-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-23T00:00:00.000Z',
    })),
    // M30: contas, lançamento manual, fila tardia, auditoria, regras, particular e pagamento (o E2E @M30 percorre).
    ...RECURSOS_SINTETICOS_M30.map((chave, i) => ({
      id: `sintetica-m30-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-23T00:00:00.000Z',
    })),
    // M26: SADT por setor, rastreio, valor crítico, portal, orçamento e requisição (o E2E @M26 percorre).
    // M27: os componentes da página inicial (filas, avisos, mensagens e dicionário; o E2E @M27 percorre).
    ...RECURSOS_SINTETICOS_M27.map((chave, i) => ({
      id: `sintetica-m27-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-22T00:00:00.000Z',
    })),
    ...RECURSOS_SINTETICOS_M26.map((chave, i) => ({
      id: `sintetica-m26-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-22T00:00:00.000Z',
    })),
    // M21: internação, mapa de leitos, supervisor, higienização e SAME (o E2E @M21 percorre).
    ...M21_CHAVES.map((chave, i) => ({
      id: `sintetica-m21-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-22T00:00:00.000Z',
    })),
    // M25: enfermagem beira-leito (o E2E @M25 percorre).
    ...M50_E5_CHAVES.map((chave, i) => ({
      id: `sintetica-m50-5-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    })),
    ...M45_E3_CHAVES.map((chave, i) => ({
      id: `sintetica-m45-3-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    })),
    ...M54_E6_CHAVES.map(([chave], i) => ({
      id: `sintetica-m54-6-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-29T00:00:00.000Z',
    })),
    ...M54_E4_CHAVES.map(([chave], i) => ({
      id: `sintetica-m54-4-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-28T00:00:00.000Z',
    })),
    ...M54_E7_CHAVES.map(([chave], i) => ({
      id: `sintetica-m54-7-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-29T00:00:00.000Z',
    })),
    ...M46_E3_CHAVES.map(([chave], i) => ({
      id: `sintetica-m46-3-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-26T00:00:00.000Z',
    })),
    ...M55_E3_CHAVES.map(([chave], i) => ({
      id: `sintetica-m55-3-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-28T00:00:00.000Z',
    })),
    ...M55_E5_CHAVES.map(([chave], i) => ({
      id: `sintetica-m55-5-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-28T00:00:00.000Z',
    })),
    ...M55_E4_CHAVES.map(([chave], i) => ({
      id: `sintetica-m55-4-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-29T00:00:00.000Z',
    })),
    ...M46_E4_CHAVES.map(([chave], i) => ({
      id: `sintetica-m46-4-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-26T00:00:00.000Z',
    })),
    ...M46_E2_CHAVES.map(([chave], i) => ({
      id: `sintetica-m46-2-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    })),
    ...M46_E1_CHAVES.map(([chave], i) => ({
      id: `sintetica-m46-1-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    })),
    ...M48_E1_CHAVES.map((chave, i) => ({
      id: `sintetica-m48-1-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-26T00:00:00.000Z',
    })),
    ...M48_E5_CHAVES.map((chave, i) => ({
      id: `sintetica-m48-5-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-27T00:00:00.000Z',
    })),
    ...M48_E4_CHAVES.map((chave, i) => ({
      id: `sintetica-m48-4-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-27T00:00:00.000Z',
    })),
    ...M48_E3_CHAVES.map((chave, i) => ({
      id: `sintetica-m48-3-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-26T00:00:00.000Z',
    })),
    ...M47_E1_CHAVES.map((chave, i) => ({
      id: `sintetica-m47-1-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    })),
    ...M45_E4_CHAVES.map(([chave], i) => ({
      id: `sintetica-m45-4-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    })),
    ...M25_CHAVES.map((chave, i) => ({
      id: `sintetica-m25-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-22T00:00:00.000Z',
    })),
    // M34: os relatórios do catálogo, o envio agendado, a entrega às integrações novas e o conector do laboratório de
    // apoio (o E2E @M34 percorre). A RNDS, os canais HL7, a classificação externa e as mensagens ao paciente ficam
    // desligados (pré-requisitos externos: credenciamento e certificado, DP-17, DP-16 e DP-44 a).
    ...RECURSOS_SINTETICOS_M34.map((chave, i) => ({
      id: `sintetica-m34-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-22T00:00:00.000Z',
    })),
    // M18: agenda de exames, agenda cirúrgica e registro do ato (o E2E @M18 percorre).
    ...(['agenda.exame', 'cirurgia.agenda', 'cirurgia.registro'] as const).map((chave, i) => ({
      id: `sintetica-m18-${i + 1}`,
      tipo: 'recurso' as const,
      chave,
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
      ligadaAntes: null,
      lote: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-21T00:00:00.000Z',
    })),
  ];
}

/** M27: os componentes da página inicial ligados na sessão sintética. */
const RECURSOS_SINTETICOS_M27 = [
  'inicio.worklistMedico',
  'inicio.worklistRecepcao',
  'inicio.avisos',
  'inicio.mensagens',
  'inicio.dicionario',
] as const;

/** M34: os recursos do catálogo de relatórios e das integrações ligados na sessão sintética. */
const RECURSOS_SINTETICOS_M34 = [
  ...RELATORIOS_CATALOGO.map((r) => chaveLiberacaoRelatorio(r.codigo)),
  'relatorio.envioAgendado',
  'integracao.parceiros',
  'integracao.apoio',
] as const;

/** M28: os recursos do estoque, das compras e do almoxarifado ligados na sessão sintética. */
const RECURSOS_SINTETICOS_M28 = [
  'suprimentos.estoque',
  'suprimentos.notaFiscal',
  'suprimentos.compras',
  'suprimentos.inventario',
  'suprimentos.kits',
  'suprimentos.fechamento',
  'suprimentos.saneamento',
] as const;

/**
 * M29: os recursos da farmácia ligados na sessão sintética. O livro oficial (pré-requisito da VISA) e a farmácia
 * ambulatorial com SNGPC (regra 10: nasce desligada; CNAE e credenciamento) ficam DESLIGADOS também aqui.
 */
const RECURSOS_SINTETICOS_M29 = [
  'suprimentos.dispensacao',
  'suprimentos.entrega',
  'suprimentos.avaliacao',
  'suprimentos.controlados',
] as const;

/** M33: o repasse médico ligado na sessão sintética. */
const RECURSOS_SINTETICOS_M33 = ['repasse'];

/** M32: os recursos do financeiro e fiscal ligados na sessão sintética. */
const RECURSOS_SINTETICOS_M32 = [
  'financeiro.contasPagar',
  'financeiro.contasReceber',
  'financeiro.tesouraria',
  'financeiro.fiscal',
] as const;

/** M31: os recursos do pós-fechamento ligados na sessão sintética. */
const RECURSOS_SINTETICOS_M31 = [
  'faturamento.protocoloRecurso',
  'faturamento.conciliacao',
  'faturamento.lote',
  'faturamento.competencia',
  'integracao.tiss',
] as const;

/** M30: os recursos da conta do paciente ligados na sessão sintética. */
const RECURSOS_SINTETICOS_M30 = [
  'faturamento.contas',
  'faturamento.lancamentoManual',
  'faturamento.lancamentoTardio',
  'faturamento.auditoria',
  'faturamento.regras',
  'faturamento.particular',
  'faturamento.pagamentoEletronico',
] as const;

/** M26: os recursos do SADT ligados na sessão sintética. */
const RECURSOS_SINTETICOS_M26 = [
  'sadt.laboratorio',
  'sadt.imagem',
  'sadt.metodosGraficos',
  'sadt.endoscopia',
  'sadt.rastreio',
  'sadt.critico',
  'sadt.portal',
  'sadt.orcamento',
  'sadt.requisicao',
] as const;

/** M23: os recursos do prontuário de uso diário ligados na sessão sintética. */
const RECURSOS_SINTETICOS_M23 = [
  'pep.documentos.emissao',
  'pep.alergia.registro',
  'pep.exame.solicitacao',
  'pep.anexo.registro',
  'pep.interconsulta.fila',
  'pep.problema.lista',
  'pep.resultado.ciencia',
  'documento.assinatura.lote',
] as const;

/**
 * Pré-requisitos que a sessão sintética já encontra registrados (dispensados, com a evidência de que é a sessão
 * sintética): o da conferência modelo a modelo do registro clínico (M22), o da conferência da agenda (M17) e o do turno simulado da recepção (M19). Fora de dev/ci, nada é pré-registrado.
 */
export function prerequisitosIniciaisSinteticos(): PrerequisitoGravado[] {
  return [
    {
      recurso: 'pep.evolucao.registro',
      tipo: 'aprovacao',
      situacao: 'dispensado',
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-21T00:00:00.000Z',
    },
    {
      recurso: 'agenda.consulta',
      tipo: 'aprovacao',
      situacao: 'dispensado',
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-21T00:00:00.000Z',
    },
    // M34: a conferência do número de cada relatório contra o de origem e a troca combinada da interface do
    // laboratório de apoio (dispensadas na sintética).
    ...[...RELATORIOS_CATALOGO.map((r) => chaveLiberacaoRelatorio(r.codigo)), 'integracao.apoio'].map(
      (recurso): PrerequisitoGravado => ({
        recurso,
        tipo: recurso === 'integracao.apoio' ? 'contrato' : 'aprovacao',
        situacao: 'dispensado',
        validade: null,
        evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
        alteradoPor: 'SINT.ADMIN',
        alteradoEm: '2026-10-22T00:00:00.000Z',
      }),
    ),
    // M50 (etapa 6): o serviço de terapias e a comissão de revisão de prontuários com o certificado (dispensados).
    ...(
      [
        ['sessoes', 'aprovacao'],
        ['digitalizacao', 'aprovacao'],
        ['digitalizacao', 'certificado'],
      ] as const
    ).map(([recurso, tipo]) => ({
      recurso,
      tipo,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    })),
    // M45 (etapa 5): o aceite da nutrição e da copa e o do serviço social com o encarregado de dados (dispensados).
    ...['nutricao', 'servico.social'].map((recurso) => ({
      recurso,
      tipo: 'aprovacao' as const,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    })),
    // M45 (etapa 1): a comissão de prontuário nomeada (dispensada na sintética).
    {
      recurso: 'pep.formularioNovo',
      tipo: 'aprovacao',
      situacao: 'dispensado',
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-24T00:00:00.000Z',
    },
    // M45 (etapa 2): as faixas aprovadas pela enfermagem e o plantão simulado (dispensados na sintética).
    {
      recurso: 'enfermagem.escores',
      tipo: 'aprovacao',
      situacao: 'dispensado',
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    },
    // M45 (etapa 6): a demanda confirmada pela área e a conferência na cópia (dispensadas na sintética).
    ...[
      'pep.especialidade.oftalmologia',
      'pep.especialidade.oncologia',
      'pep.especialidade.obstetricia',
      'nutricao.lactario',
      // M55 (fatia F2): a rouparia, ligada na sintética para o E2E @M55.2.
      'rouparia',
      // M55 (etapa 1): a manutenção e engenharia clínica, ligada na sintética para o E2E @M55.1.
      'manutencao',
    ].map((recurso) => ({
      recurso,
      tipo: 'aprovacao' as const,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    })),
    // M44: o protocolo de produção e as 30 classificações roteirizadas (dispensados na sintética).
    {
      recurso: 'pa.classificacao',
      tipo: 'aprovacao',
      situacao: 'dispensado',
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-24T00:00:00.000Z',
    },
    // M49, etapa 2: o contrato do provedor e a aprovação da política (dispensados na sintética: só o simulador).
    ...(['contrato', 'aprovacao'] as const).map((tipo): PrerequisitoGravado => ({
      recurso: 'assinatura.icp',
      tipo,
      situacao: 'dispensado',
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real; provedor simulado)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-24T00:00:00.000Z',
    })),
    // M50, etapa 1: a aprovação do encarregado de dados e o teste de invasão (dispensados na sintética).
    {
      recurso: 'portal.conta',
      tipo: 'aprovacao',
      situacao: 'dispensado',
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-24T00:00:00.000Z',
    },
    // M50, etapa 3: o escopo do DPO (DP-43) e o fluxo do bloco (dispensados na sintética).
    {
      recurso: 'portal.medicoExterno',
      tipo: 'aprovacao',
      situacao: 'dispensado',
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    },
    // M50, etapa 4: o ponto 18 do cap-13 §13.7, a assinatura do M49 e o provedor (dispensados na sintética).
    {
      recurso: 'telemedicina',
      tipo: 'aprovacao',
      situacao: 'dispensado',
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real; provedor simulado)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    },
    // M50, etapa 2: a conferência dos chave-usuários, o teste de invasão e a autorização do gateway (dispensados).
    ...(['portal.agenda', 'portal.pagamento'] as const).map((recurso) => ({
      recurso,
      tipo: 'aprovacao' as const,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real; gateway simulado)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    })),
    // M44 (etapa 2): o aceite do NIR e os limites de permanência (dispensados na sintética).
    {
      recurso: 'nir',
      tipo: 'aprovacao',
      situacao: 'dispensado',
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-24T00:00:00.000Z',
    },
    // M57 (etapa 1): o fim da migração e a amostra revisada (dispensados na sintética).
    {
      recurso: 'rede.mpi',
      tipo: 'aprovacao',
      situacao: 'dispensado',
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-24T00:00:00.000Z',
    },
    // M57 (etapa 3): a validação dos painéis e a conferência do DPO (dispensadas na sintética).
    {
      recurso: 'rede.bi',
      tipo: 'aprovacao',
      situacao: 'dispensado',
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    },
    // M57 (etapa 2): o cenário controlado e a conferência da unificação (dispensados na sintética).
    {
      recurso: 'cadastro.unificacao',
      tipo: 'aprovacao',
      situacao: 'dispensado',
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    },
    // M49, etapa 3: o teste de invasão e o agente local (dispensados na sintética: só o agente simulado).
    {
      recurso: 'acesso.loginCertificado',
      tipo: 'aprovacao',
      situacao: 'dispensado',
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real; agente local simulado)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-24T00:00:00.000Z',
    },
    // W1-01 (parte 7): o servidor de e-mail institucional (dispensado na sintética: envio em memória).
    {
      recurso: 'acesso.recuperacaoSenha',
      tipo: 'aprovacao',
      situacao: 'dispensado',
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real; envio em memória)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-11-18T00:00:00.000Z',
    },
    // M24: a conferência dos chave-usuários da prescrição (dispensada na sintética).
    {
      recurso: 'pep.prescricao.cpoe',
      tipo: 'aprovacao',
      situacao: 'dispensado',
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-21T00:00:00.000Z',
    },
    {
      recurso: 'recepcao.senha',
      tipo: 'aprovacao',
      situacao: 'dispensado',
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-21T00:00:00.000Z',
    },
    // M23: a conferência no outro sistema dos atos que gravam no banco do estabelecimento (dispensada na sintética).
    ...(
      [
        'pep.documentos.emissao',
        'pep.alergia.registro',
        'pep.exame.solicitacao',
        'pep.anexo.registro',
      ] as const
    ).map((recurso) => ({
      recurso,
      tipo: 'aprovacao' as const,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-21T00:00:00.000Z',
    })),
    ...(['atendimento.ambulatorio', 'atendimento.pa', 'atendimento.cancelar'] as const).map((recurso) => ({
      recurso,
      tipo: 'aprovacao' as const,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-22T00:00:00.000Z',
    })),
    // M28: a conferência do almoxarifado e o cenário controlado (dispensados na sintética).
    ...RECURSOS_SINTETICOS_M28.map((recurso) => ({
      recurso,
      tipo: 'aprovacao' as const,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-22T00:00:00.000Z',
    })),
    // M29: as conferências da farmácia, da enfermagem e da TI e a DP-25 (dispensadas na sintética).
    ...RECURSOS_SINTETICOS_M29.map((recurso) => ({
      recurso,
      tipo: 'aprovacao' as const,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-23T00:00:00.000Z',
    })),
    // M33: a conferência pelos chave-usuários do repasse (dispensada na sintética).
    ...RECURSOS_SINTETICOS_M33.map((recurso) => ({
      recurso,
      tipo: 'aprovacao' as const,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-23T00:00:00.000Z',
    })),
    // M32: a conferência pelos chave-usuários do financeiro e as respostas do fiscal (dispensadas na sintética).
    ...RECURSOS_SINTETICOS_M32.map((recurso) => ({
      recurso,
      tipo: 'aprovacao' as const,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-23T00:00:00.000Z',
    })),
    // M31: a conferência pelos faturistas de remessa e de recurso e a autorização do envio real (dispensadas).
    ...RECURSOS_SINTETICOS_M31.map((recurso) => ({
      recurso,
      tipo: 'aprovacao' as const,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-23T00:00:00.000Z',
    })),
    // M30: a conferência do faturamento, a reprodução, o auditor, a tesouraria e o provedor de pagamento (dispensados).
    ...RECURSOS_SINTETICOS_M30.map((recurso) => ({
      recurso,
      tipo: 'aprovacao' as const,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-23T00:00:00.000Z',
    })),
    // M26: as conferências dos chave-usuários, do faturamento, da TI e do encarregado (dispensadas na sintética).
    ...RECURSOS_SINTETICOS_M26.map((recurso) => ({
      recurso,
      tipo: 'aprovacao' as const,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-22T00:00:00.000Z',
    })),
    ...M21_CHAVES.map((recurso) => ({
      recurso,
      tipo: 'aprovacao' as const,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-22T00:00:00.000Z',
    })),
    ...M50_E5_CHAVES.map((recurso) => ({
      recurso,
      tipo: recurso === 'portaria.catraca' ? ('contrato' as const) : ('aprovacao' as const),
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real; a catraca só pelo simulador)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    })),
    ...M45_E3_CHAVES.map((recurso) => ({
      recurso,
      tipo: 'aprovacao' as const,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    })),
    ...M54_E6_CHAVES.map(([recurso, tipo]) => ({
      recurso,
      tipo,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-29T00:00:00.000Z',
    })),
    ...M54_E4_CHAVES.map(([recurso, tipo]) => ({
      recurso,
      tipo,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-28T00:00:00.000Z',
    })),
    ...M54_E7_CHAVES.map(([recurso, tipo]) => ({
      recurso,
      tipo,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-29T00:00:00.000Z',
    })),
    ...M46_E3_CHAVES.map(([recurso, tipo]) => ({
      recurso,
      tipo,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-26T00:00:00.000Z',
    })),
    ...M55_E3_CHAVES.map(([recurso, tipo]) => ({
      recurso,
      tipo,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-28T00:00:00.000Z',
    })),
    ...M55_E5_CHAVES.map(([recurso, tipo]) => ({
      recurso,
      tipo,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-28T00:00:00.000Z',
    })),
    ...M55_E4_CHAVES.map(([recurso, tipo]) => ({
      recurso,
      tipo,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-29T00:00:00.000Z',
    })),
    ...M46_E4_CHAVES.map(([recurso, tipo]) => ({
      recurso,
      tipo,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-26T00:00:00.000Z',
    })),
    ...M46_E2_CHAVES.map(([recurso, tipo]) => ({
      recurso,
      tipo,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    })),
    ...M46_E1_CHAVES.map(([recurso, tipo]) => ({
      recurso,
      tipo,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    })),
    ...M48_E1_CHAVES.map((recurso) => ({
      recurso,
      tipo: 'aprovacao' as const,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-26T00:00:00.000Z',
    })),
    ...M48_E5_CHAVES.map((recurso) => ({
      recurso,
      tipo: 'aprovacao' as const,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-27T00:00:00.000Z',
    })),
    ...M48_E4_CHAVES.map((recurso) => ({
      recurso,
      tipo: 'aprovacao' as const,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-27T00:00:00.000Z',
    })),
    ...M48_E3_CHAVES.map((recurso) => ({
      recurso,
      tipo: 'aprovacao' as const,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-26T00:00:00.000Z',
    })),
    ...M47_E1_CHAVES.map((recurso) => ({
      recurso,
      tipo: 'aprovacao' as const,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    })),
    ...M45_E4_CHAVES.map(([recurso, tipo]) => ({
      recurso,
      tipo,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-25T00:00:00.000Z',
    })),
    ...M25_CHAVES.map((recurso) => ({
      recurso,
      tipo: 'aprovacao' as const,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-22T00:00:00.000Z',
    })),
    ...(['agenda.exame', 'cirurgia.agenda', 'cirurgia.registro'] as const).map((recurso) => ({
      recurso,
      tipo: 'aprovacao' as const,
      situacao: 'dispensado' as const,
      validade: null,
      evidencia: 'sessão sintética de desenvolvimento e testes (sem dado real)',
      alteradoPor: 'SINT.ADMIN',
      alteradoEm: '2026-10-21T00:00:00.000Z',
    })),
  ];
}

/**
 * Parâmetros que a sessão sintética já encontra definidos no estabelecimento: os modelos do pedido e da resposta de
 * parecer (MED09, MED10) junto dos liberados por padrão, para o E2E @M23 pedir o parecer pela tela. Fora de dev/ci,
 * nada é pré-definido (a liberação de cada modelo é da comissão de prontuário).
 */
export function parametrosIniciaisSinteticos(hospital: string): ValorParametro[] {
  return [
    {
      id: 'sintetico-p1',
      chave: 'pep.evolucao.modelosLiberados',
      nivel: 'estabelecimento',
      alvo: hospital,
      valor: 'EVAM,M9,M10,MED09,MED10',
      vigenteDesde: '2026-10-21T00:00:00.000Z',
      vigenteAte: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes',
      autor: 'SINT.ADMIN',
    },
    // M33: as tabelas de retenção do RPA SINTÉTICAS (INSS, teto, IRRF e ISS), para o E2E @M33 emitir o RPA pela tela;
    // fora de dev/ci não há padrão (regra 7: nunca constante no código; a tabela vigente é definida pelo setor).
    ...(
      [
        ['repasse.inssAliquotaPct', '11'],
        ['repasse.inssTeto', '8157.41'],
        [
          'repasse.irrfTabela',
          '2259.20:0:0;2826.65:7.5:169.44;3751.05:15:381.44;4664.68:22.5:662.77;0:27.5:896',
        ],
        ['repasse.issAliquotaPct', '5'],
      ] as const
    ).map(([chave, valor], i) => ({
      id: `sintetico-m33-${i + 1}`,
      chave,
      nivel: 'estabelecimento' as const,
      alvo: hospital,
      valor,
      vigenteDesde: '2026-10-23T00:00:00.000Z',
      vigenteAte: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes (valores sintéticos)',
      autor: 'SINT.ADMIN',
    })),
    // M45 (etapa 4): os protocolos, a lista do anexo II e os imunobiológicos SINTÉTICOS, para o E2E @M45.4 emitir a receita
    // do enfermeiro e registrar a vacina pela tela; fora de dev/ci não há padrão (a área publica pelos parâmetros).
    ...(
      [
        [
          'enfermagem.prescricaoMedicamento.protocolos',
          'PROT-SINT-DOR/2026:institucional:paracetamol,dipirona;PROT-SINT-HAS/2026:programa:losartana',
        ],
        [
          'enfermagem.prescricaoMedicamento.anexoII',
          'ANEXO-II-SINT-1=paracetamol,dipirona,losartana,sulfato ferroso',
        ],
        ['enfermagem.vacina.imunobiologicos', '99:Vacina sintética A;98:Vacina sintética B'],
      ] as const
    ).map(([chave, valor], i) => ({
      id: `sintetico-m45-4-${i + 1}`,
      chave,
      nivel: 'estabelecimento' as const,
      alvo: hospital,
      valor,
      vigenteDesde: '2026-10-25T00:00:00.000Z',
      vigenteAte: null,
      justificativa: 'Sessão sintética de desenvolvimento e testes (valores sintéticos)',
      autor: 'SINT.ADMIN',
    })),
  ];
}

/** Em memória (sessão sintética, dev/ci): nada vai à cópia; a trilha vai ao registrador da API. */
export function fonteConfiguracaoMemoria(
  trilha: RegistradorTrilha,
  opcoes: {
    readonly chavesIniciais?: () => ChaveGravada[];
    readonly prerequisitosIniciais?: () => PrerequisitoGravado[];
    readonly parametrosIniciais?: (hospital: string) => ValorParametro[];
  } = {},
): FonteConfiguracao {
  const valoresDe = new Map<string, ValorParametro[]>();
  const parametros = {
    get: (h: string): ValorParametro[] => {
      if (!valoresDe.has(h)) valoresDe.set(h, opcoes.parametrosIniciais?.(h) ?? []);
      return valoresDe.get(h)!;
    },
    set: (h: string, l: ValorParametro[]) => void valoresDe.set(h, l),
  };
  const chavesGravadas = new Map<string, ChaveGravada[]>();
  const chaves = {
    get: (h: string): ChaveGravada[] => {
      if (!chavesGravadas.has(h)) chavesGravadas.set(h, opcoes.chavesIniciais?.() ?? []);
      return chavesGravadas.get(h)!;
    },
    set: (h: string, l: ChaveGravada[]) => void chavesGravadas.set(h, l),
  };
  const prereqs = new Map<string, PrerequisitoGravado[]>();
  const prereqsDe = (h: string): PrerequisitoGravado[] => {
    if (!prereqs.has(h)) prereqs.set(h, opcoes.prerequisitosIniciais?.() ?? []);
    return prereqs.get(h)!;
  };
  let id = 0;
  let lote = 0;
  const registrar = (t: TrilhaConfig, tabelaAlvo: string, idAlvo: string, evento: string) =>
    trilha.registrar({
      evento,
      rede: t.rede,
      hospital: t.hospital,
      usuario: t.usuario,
      estacao: t.estacao ?? '',
      correlacao: t.correlacao,
      recurso: t.recurso,
      resultado: 'sucesso',
      tabelaAlvo,
      idAlvo,
    });
  /** Aplica o pedido sobre a lista (cópia de trabalho), sem registrar nem gravar. */
  const aplicarNaLista = (lista: ChaveGravada[], p: PedidoLote): { lote: string; alteradas: number } => {
    const doNome = lista.filter((c) => c.chave === p.chave);
    if (doNome.some((c) => c.tipo !== p.tipo))
      throw new ErroConfiguracaoSgh(
        'chave-de-outro-tipo',
        'Já existe uma chave com este nome de outro tipo (operação × recurso). Use outro nome.',
      );
    const mudancas = p.planejar({
      chaves: doNome,
      prerequisitos: p.tipo === 'recurso' ? prereqsDe(p.hospital).filter((x) => x.recurso === p.chave) : [],
    });
    if (mudancas.length === 0) return { lote: '', alteradas: 0 };
    const n = String(++lote);
    for (const m of mudancas) {
      const i = lista.findIndex(
        (c) => c.chave === p.chave && c.tipo === p.tipo && c.escopo === m.escopo && c.valor === m.valor,
      );
      const linha: ChaveGravada = {
        id: i >= 0 ? (lista[i]?.id ?? String(++id)) : String(++id),
        tipo: p.tipo,
        chave: p.chave,
        escopo: m.escopo,
        valor: m.valor,
        ligada: m.ligada,
        ligadaAntes: m.antes,
        lote: n,
        justificativa: p.justificativa,
        alteradoPor: p.autor,
        alteradoEm: new Date().toISOString(),
      };
      if (i >= 0) lista[i] = linha;
      else lista.push(linha);
    }
    return { lote: n, alteradas: mudancas.length };
  };
  return {
    destino: 'memoria',
    relogio: async () => new Date(),
    valoresParametro: async (_r, h) => [...parametros.get(h)],
    async definirParametro(d, t) {
      const lista = parametros.get(d.hospital);
      // Mesma conferência da transação SGH_: as vigentes do nível e alvo têm de ser as que o plano fecha.
      const vigentes = lista.filter(
        (v) =>
          v.chave === d.nova.chave &&
          v.nivel === d.nova.nivel &&
          v.alvo === d.nova.alvo &&
          v.vigenteAte === null,
      );
      if (vigentes.length !== d.fechar.length || vigentes.some((v) => !d.fechar.includes(v.id)))
        throw new ErroConfiguracaoSgh(
          'conflito-concorrente',
          'O parâmetro foi definido por outra pessoa neste nível e alvo enquanto você editava. Releia e defina de novo.',
        );
      const agora = new Date().toISOString();
      const novos = lista.map((v) =>
        d.fechar.includes(v.id) && v.vigenteAte === null ? { ...v, vigenteAte: agora } : v,
      );
      const nova: ValorParametro = { ...d.nova, id: String(++id), vigenteDesde: agora };
      await registrar(t, 'MEMORIA', nova.id, t.evento);
      parametros.set(d.hospital, [nova, ...novos]);
      return { id: nova.id };
    },
    async retirarParametro(d, t) {
      const lista = parametros.get(d.hospital);
      const vigentes = lista.filter(
        (v) => v.chave === d.chave && v.nivel === d.nivel && v.alvo === d.alvo && v.vigenteAte === null,
      );
      if (
        d.fechar.length === 0 ||
        vigentes.length !== d.fechar.length ||
        vigentes.some((v) => !d.fechar.includes(v.id))
      )
        throw new ErroConfiguracaoSgh(
          'conflito-concorrente',
          'O parâmetro foi alterado por outra pessoa neste nível e alvo enquanto você editava. Releia e tente de novo.',
        );
      const agora = new Date().toISOString();
      parametros.set(
        d.hospital,
        lista.map((v) =>
          d.fechar.includes(v.id) && v.vigenteAte === null
            ? { ...v, vigenteAte: agora, retiradaPor: d.por, retiradaMotivo: d.motivo }
            : v,
        ),
      );
      await registrar(t, 'MEMORIA', d.fechar[0] ?? '', t.evento);
      return { fechadas: [...d.fechar] };
    },
    parametrosLegado: async (_r, _h, login) => {
      const l = leitorSintetico();
      const r: ParametroLegadoDescrito[] = [];
      for (const t of PARAMETROS_LEGADO) r.push(...(await lerParametrosLegado(l, t, login)));
      return r;
    },
    chaves: async (_r, h) => [...(chaves.get(h) ?? [])],
    async aplicarLote(_r, p, t) {
      const lista = [...(chaves.get(p.hospital) ?? [])];
      const r = aplicarNaLista(lista, p);
      if (r.alteradas === 0) return r;
      await registrar(t, 'MEMORIA', r.lote, t.evento);
      chaves.set(p.hospital, lista);
      return r;
    },
    async aplicarLotes(_r, ps, t) {
      // A "transação" em memória: todos planejados sobre a mesma cópia; só grava (e registra) se nenhum recusar.
      const hospital = ps[0]?.hospital ?? t.hospital;
      if (ps.some((p) => p.hospital !== hospital))
        throw new Error('Lotes de estabelecimentos diferentes na mesma transação.');
      const lista = [...(chaves.get(hospital) ?? [])];
      const loteAntes = lote;
      const idAntes = id;
      let rs: { lote: string; alteradas: number }[];
      try {
        rs = ps.map((p) => aplicarNaLista(lista, p));
      } catch (erro) {
        lote = loteAntes;
        id = idAntes;
        throw erro;
      }
      for (const r of rs) if (r.alteradas > 0) await registrar(t, 'MEMORIA', r.lote, t.evento);
      chaves.set(hospital, lista);
      return rs;
    },
    lote: async (_r, h, l) => (chaves.get(h) ?? []).filter((c) => c.lote === l),
    prerequisitos: async (_r, h) => [...prereqsDe(h)],
    async gravarPrerequisito(_r, p, t) {
      const lista = prereqsDe(p.hospital).filter((x) => !(x.recurso === p.recurso && x.tipo === p.tipo));
      await registrar(t, 'MEMORIA', `${p.recurso}:${p.tipo}`, t.evento);
      lista.push({ ...p, alteradoPor: p.autor, alteradoEm: new Date().toISOString() });
      prereqs.set(p.hospital, lista);
    },
  };
}
