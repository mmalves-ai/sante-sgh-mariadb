// M59-F5 (ficha do M59, regra 10; cap-13 §13.6.3): o checklist do pacote de evidências SBIS por estabelecimento. O
// servidor mede o que vê (cadeia da trilha, configuração de login e sessão, segundo fator dos perfis críticos,
// relatórios de restauração, concessões, ambiente identificado e assinatura ICP-Brasil configurada); o roteiro de
// demonstração, a matriz de rastreabilidade, a varredura da comunicação e a documentação são gerados pelo CI na
// versão candidata (`pnpm sbis:verificar`, `pnpm seguranca:verificar`, `pnpm e2e`) e aparecem como "gerado no CI".
import {
  ITENS_PACOTE_SBIS,
  type ItemPacote,
  type ItemPacoteSbis,
  REQUISITOS_SBIS,
  type SituacaoItemPacote,
} from '@sgh/contratos';

export const TITULOS_PACOTE: Readonly<Record<ItemPacoteSbis, string>> = {
  'roteiro-demonstracao': 'Roteiro de demonstração por requisito (vídeo e capturas)',
  'ambiente-testes': 'Ambiente de testes certificável, identificado como testes',
  'trilha-exportada': 'Trilha exportada com identificação e prova da cadeia',
  'configuracao-seguranca': 'Configuração de login, sessão, senha e segundo fator',
  'restauracao-backup': 'Restauração do backup: diária e mensal, com integridade',
  'comunicacao-segura': 'Comunicação segura: TLS, canais e assinatura das imagens',
  documentacao: 'Manuais por perfil, instalação, configuração segura e notas de versão',
  assinaturas: 'Documentos de amostra assinados e validados',
  'fim-concessoes': 'Relatório do fim das concessões da coexistência',
  'matriz-rastreabilidade': 'Matriz de rastreabilidade requisito, funcionalidade, teste e resultado',
};

const NO_CI: Readonly<Partial<Record<ItemPacoteSbis, string>>> = {
  'comunicacao-segura': 'Gerado pelo comando pnpm seguranca:verificar na versão candidata.',
  documentacao: 'Gerado com o pacote de implantação e o manual (pnpm implantacao:manual).',
  'matriz-rastreabilidade':
    'Gerada com a suíte SBIS executada (pnpm verificar:tudo) na versão candidata; a cada versão, a estrutura.',
};

/** O motivo visível do roteiro de demonstração (regra 10) enquanto a gravação por requisito não existe. */
export const ROTEIRO_PENDENTE =
  'O roteiro de demonstração gravado em vídeo por requisito ainda não está pronto: os testes de ponta a ponta ' +
  'cobrem parte dos requisitos e não gravam vídeo. Ele será gerado na versão candidata, antes da auditoria formal.';

/** Limite de tentativas do SBIS-05. */
export const TENTATIVAS_MAXIMAS_SBIS = 10;

export interface EntradasPacote {
  /** Ambiente do servidor (AMBIENTE): a homologação é o ambiente de testes certificável. */
  readonly ambiente: string;
  /** Cadeia da trilha própria nos últimos dias: íntegra, quebrada ou não verificada (null). */
  readonly trilhaIntegra: boolean | null;
  readonly limiteTentativas: number | null;
  readonly inatividadeSegundos: number | null;
  /** Segundo fator obrigatório para os perfis críticos (onda 1 da política); null: não medido. */
  readonly segundoFatorCriticos: boolean | null;
  readonly diariaEmDia: boolean;
  readonly mensalEmDia: boolean;
  readonly concessoesVigentes: number;
  /** Assinatura ICP-Brasil configurada no estabelecimento; null: não medido. */
  readonly assinaturaConfigurada: boolean | null;
}

export const AMBIENTES_CERTIFICAVEIS: ReadonlySet<string> = new Set(['homologacao', 'testes']);

function avaliar(item: ItemPacoteSbis, e: EntradasPacote): { situacao: SituacaoItemPacote; detalhe: string } {
  const no = NO_CI[item];
  if (no) return { situacao: 'gerado-no-ci', detalhe: no };
  const ok = (cond: boolean, sim: string, nao: string) =>
    cond ? { situacao: 'pronto' as const, detalhe: sim } : { situacao: 'pendente' as const, detalhe: nao };
  switch (item) {
    // POL-3: o roteiro filmado por requisito ainda não existe; o item fica pendente, com o motivo visível.
    case 'roteiro-demonstracao':
      return { situacao: 'pendente', detalhe: ROTEIRO_PENDENTE };
    case 'ambiente-testes':
      return ok(
        AMBIENTES_CERTIFICAVEIS.has(e.ambiente),
        'Este servidor é o ambiente de testes certificável.',
        'Gere o pacote no servidor de homologação identificado como testes.',
      );
    case 'trilha-exportada':
      return e.trilhaIntegra === null
        ? { situacao: 'pendente', detalhe: 'A cadeia da trilha não foi verificada no período.' }
        : ok(
            e.trilhaIntegra,
            'Cadeia da trilha íntegra no período verificado.',
            'A cadeia da trilha tem quebra.',
          );
    case 'configuracao-seguranca': {
      const faltas: string[] = [];
      if (
        e.limiteTentativas === null ||
        e.limiteTentativas < 1 ||
        e.limiteTentativas > TENTATIVAS_MAXIMAS_SBIS
      )
        faltas.push(`limite de tentativas entre 1 e ${TENTATIVAS_MAXIMAS_SBIS}`);
      if (!e.inatividadeSegundos || e.inatividadeSegundos <= 0)
        faltas.push('bloqueio da sessão por inatividade');
      if (e.segundoFatorCriticos !== true) faltas.push('segundo fator obrigatório nos perfis críticos');
      return ok(
        faltas.length === 0,
        'Login, sessão e segundo fator configurados.',
        `Falta: ${faltas.join('; ')}.`,
      );
    }
    case 'restauracao-backup':
      return ok(
        e.diariaEmDia && e.mensalEmDia,
        'Restaurações diária e mensal em dia.',
        `Em atraso: ${[!e.diariaEmDia && 'diária', !e.mensalEmDia && 'mensal'].filter(Boolean).join(' e ')}.`,
      );
    case 'assinaturas':
      return e.assinaturaConfigurada === null
        ? { situacao: 'pendente', detalhe: 'A assinatura digital não foi conferida neste servidor.' }
        : ok(
            e.assinaturaConfigurada,
            'Assinatura digital configurada no estabelecimento.',
            'Configure a assinatura digital do estabelecimento.',
          );
    case 'fim-concessoes':
      return ok(
        e.concessoesVigentes === 0,
        'Todas as concessões da coexistência encerradas.',
        `${e.concessoesVigentes} concessão(ões) ainda vigente(s).`,
      );
    default:
      return { situacao: 'pendente', detalhe: '' };
  }
}

export function montarPacote(e: EntradasPacote): ItemPacote[] {
  return ITENS_PACOTE_SBIS.map((item) => ({
    item,
    titulo: TITULOS_PACOTE[item],
    ...avaliar(item, e),
    requisitos: REQUISITOS_SBIS.filter((r) => r.evidencias.includes(item)).map((r) => r.codigo),
  }));
}

/** Contagens do catálogo para o painel. */
export function contagemRequisitos() {
  const porNivel = { NGS1: 0, ECF: 0, NGS2: 0 };
  const porRegime = { novo: 0, concessao: 0, 'pos-coexistencia': 0 };
  let fase5 = 0;
  for (const r of REQUISITOS_SBIS) {
    porNivel[r.nivel]++;
    porRegime[r.regime]++;
    if (r.fase5) fase5++;
  }
  return { total: REQUISITOS_SBIS.length, porNivel, porRegime, fase5 };
}
