// Onda 2 (ficha do M40): regras puras da liberação por setor e do acompanhamento. Sem banco e sem tela: quem chama
// lê o catálogo de operações, os itens registrados do setor (SGH_CFG_COEX_LIGAR, D-REG-40), o estado do pentest e os
// agregados do banco, e entrega aqui. As regras 1 a 8 valem para as ondas 2 a 5 (M40 a M43).
import {
  ESTADOS_FORA_DA_ONDA,
  EXCECOES_REGRA_15,
  HOSPITAL_INICIAL_ONDAS,
  ITENS_CRITERIO_GERAIS,
  ITENS_CRITERIO_POR_SETOR_ONDA_2,
  ITENS_CRITERIO_POR_SETOR_ONDA_3,
  ITENS_CRITERIO_POR_SETOR_ONDA_4,
  ITENS_SEM_NAO_SE_APLICA_ONDA_2,
  JANELAS_SEM_VERSAO_PADRAO,
  RECURSOS_SO_NO_NOVO,
  ROTULOS_CRITERIO_LIBERACAO,
  operacoesDoSetor,
  SETORES_PRONTIDAO,
  TABELAS_NUNCA_GRAVADAS,
  type DefinicaoSetor,
  type EstadoOperacao,
  type ItemCriterioLiberacao,
  type ItemCriterioRegistrado,
  type JanelaSemVersao,
  ORDEM_SETORES_ONDA_2,
  SETORES_ONDA_2,
  type SituacaoItemCriterio,
} from '@sgh/contratos';

// ---------------------------------------------------------------------------------------------------------------
// Itens do critério de liberação do setor

/** Recursos do setor que só existem no novo (regra 6). */
export function recursosSoNoNovoDoSetor(setor: Pick<DefinicaoSetor, 'recursos'>): string[] {
  return setor.recursos.filter((r) => r in RECURSOS_SO_NO_NOVO);
}

/**
 * Itens do critério para o setor: os gerais, os próprios da onda do setor (2 ou 3) e a contingência se o setor usa
 * recurso novo da onda 2.
 */
export function itensDoSetor(setor: Pick<DefinicaoSetor, 'id' | 'recursos'>): ItemCriterioLiberacao[] {
  const daOnda3 = (
    ITENS_CRITERIO_POR_SETOR_ONDA_3 as Readonly<Record<string, readonly ItemCriterioLiberacao[]>>
  )[setor.id];
  const daOnda4 = (
    ITENS_CRITERIO_POR_SETOR_ONDA_4 as Readonly<Record<string, readonly ItemCriterioLiberacao[]>>
  )[setor.id];
  const itens: ItemCriterioLiberacao[] = [
    ...ITENS_CRITERIO_GERAIS,
    ...(ITENS_CRITERIO_POR_SETOR_ONDA_2[setor.id] ?? []),
    ...(daOnda3 ?? []),
    ...(daOnda4 ?? []),
  ];
  if (recursosSoNoNovoDoSetor(setor).length > 0) itens.push('relatorio-contingencia');
  return [...new Set(itens)];
}

export interface EntradaLiberacaoSetor {
  readonly setor: Pick<DefinicaoSetor, 'id' | 'recursos'>;
  /** Estado no hospital de cada operação de escrita usada pelo setor (catálogo, com a regra 6 do M36 aplicada). */
  readonly operacoes: Readonly<Record<string, EstadoOperacao>>;
  /** Itens registrados pelo comitê (SGH_CFG_COEX_LIGAR); o não registrado conta como pendente (falha fechada). */
  readonly itens: readonly ItemCriterioRegistrado[];
  /** Pentest com achado crítico ou alto aberto, ou não concluído (M36, situacaoPentest().bloqueiaLiberacao). */
  readonly pentest: { readonly bloqueia: boolean; readonly motivo: string };
  /** Operações do setor desligadas pela POL-3 (ficam no outro sistema nesta onda; D-OPS-40). */
  readonly fora?: readonly string[];
}

export interface ItemAvaliado {
  readonly item: ItemCriterioLiberacao;
  readonly rotulo: string;
  readonly ok: boolean;
  readonly origem: 'calculado' | 'registrado';
  readonly situacao: SituacaoItemCriterio;
  /** O que falta, em texto de produto (null quando ok). */
  readonly falta: string | null;
  /** A conta ou a evidência (texto de produto). */
  readonly detalhe: string;
}

export interface AvaliacaoLiberacaoSetor {
  readonly setor: string;
  readonly itens: readonly ItemAvaliado[];
  /** Todos os itens ok (regra 1). A liberação em produção continua sendo da pessoa designada (regra 2). */
  readonly podeLiberar: boolean;
}

const ESTADOS_CONFERIDOS: readonly EstadoOperacao[] = ['conferida', 'liberada'];

/**
 * A operação fica fora da onda (no outro sistema, sem segurar o setor; D-OPS-40)? Só a desligada pela POL-3 desde a
 * origem. `regrediu`: a operação já foi conferida no hospital (voltou a `bloqueada` pelo recolhimento, regra 4) ou o
 * estado efetivo a bloqueou por divergência na reexecução (regra 6 do M36): essa segura o setor até voltar à conferência.
 */
export function operacaoForaDaOnda(estado: string, regrediu: boolean): boolean {
  if (estado === 'bloqueada' && regrediu) return false;
  return ESTADOS_FORA_DA_ONDA.includes(estado);
}

/** O que falta quando o item registrado está pendente (texto de produto). */
const FALTA_REGISTRADO: Readonly<Record<ItemCriterioLiberacao, string>> = {
  'operacoes-conferidas': '',
  'pentest-sem-critico': '',
  'aceite-jornada': 'aceite da jornada não registrado',
  'treinamento-concluido': 'treinamento de quem vai começar não registrado como concluído',
  'estacoes-conferidas': 'conferência das estações, impressoras e leitores pela TI não registrada',
  'carga-dentro-do-limite': 'carga somada dentro do limite não registrada',
  'apoio-e-chamados': 'apoio no setor e canal de chamados não registrados',
  'autorizacao-do-dono': 'autorização do dono não registrada',
  'recolhimento-ensaiado': 'recolhimento não ensaiado no setor',
  'retorno-ensaiado': 'teste de retorno não feito no setor',
  'relatorio-contingencia':
    'relatório de contingência por posto não gerado e impresso na estação de contingência',
  'pep-aberto-no-outro-sistema':
    'registros clínicos ainda não abertos no outro sistema por médico e enfermeiro',
  'unidade-piloto': 'unidade-piloto não definida',
  'inventario-recente': 'inventário recente dos locais de estoque não registrado',
  'documentos-conferidos': 'documentos gravados aqui ainda não conferidos no outro sistema',
  'prescricao-na-unidade':
    'prescrição eletrônica ainda não registrada como em uso nas unidades atendidas pela farmácia',
  'conferencia-numerica': 'conferência de saldo e preço médio sem divergência não registrada',
  'abertura-da-competencia': 'início na abertura de uma competência não registrado',
  'reproducao-sem-diferenca': 'reprodução do faturamento da competência sem diferença não registrada',
  'registros-conferidos':
    'conta, lote, glosa, título e RPA gravados aqui ainda não conferidos no outro sistema',
};

/**
 * Regra 1 e condições da onda: cada item do critério com o que falta. Os itens das operações (catálogo) e do teste de
 * invasão (M36) são calculados; os demais vêm do registro do comitê. Falha fechada: o item sem registro está pendente.
 */
export function avaliarLiberacaoSetor(e: EntradaLiberacaoSetor): AvaliacaoLiberacaoSetor {
  const nomes = Object.keys(e.operacoes).sort();
  const pendentes = nomes.filter((n) => !ESTADOS_CONFERIDOS.includes(e.operacoes[n]!));
  const registrados = new Map(e.itens.map((i) => [i.item, i]));
  const avaliar = (item: ItemCriterioLiberacao): Omit<ItemAvaliado, 'item' | 'rotulo'> => {
    if (item === 'operacoes-conferidas') {
      const falta =
        nomes.length === 0
          ? e.fora?.length
            ? `todas as ${e.fora.length} operações de gravação do setor estão desligadas até a prova`
            : 'nenhuma operação de gravação do setor no catálogo'
          : pendentes.length
            ? `operações ainda não conferidas: ${pendentes
                .map((n) =>
                  e.operacoes[n] === 'bloqueada'
                    ? `${n} (bloqueada: volta à conferência)`
                    : `${n} (${e.operacoes[n]})`,
                )
                .join(', ')}`
            : null;
      return {
        ok: falta === null,
        origem: 'calculado',
        situacao: falta === null ? 'cumprido' : 'pendente',
        falta,
        detalhe: `${nomes.length - pendentes.length} de ${nomes.length} conferidas`,
      };
    }
    if (item === 'pentest-sem-critico')
      return {
        ok: !e.pentest.bloqueia,
        origem: 'calculado',
        situacao: e.pentest.bloqueia ? 'pendente' : 'cumprido',
        falta: e.pentest.bloqueia ? e.pentest.motivo : null,
        detalhe: e.pentest.motivo,
      };
    const r = registrados.get(item);
    const situacao = r?.situacao ?? 'pendente';
    // Os itens sem "não se aplica" só se cumprem com "cumprido" (um registro antigo com "não se aplica" segura o setor).
    const exigeCumprido = ITENS_SEM_NAO_SE_APLICA_ONDA_2.includes(item);
    const ok = exigeCumprido ? situacao === 'cumprido' : situacao !== 'pendente';
    return {
      ok,
      origem: 'registrado',
      situacao,
      falta: ok
        ? null
        : situacao === 'nao-se-aplica'
          ? `${FALTA_REGISTRADO[item]} (este item não admite "não se aplica")`
          : FALTA_REGISTRADO[item],
      detalhe:
        ok || (r && situacao !== 'pendente')
          ? [r?.em ? `em ${r.em}` : '', r?.evidencia ?? ''].filter(Boolean).join('; ') || 'registrado'
          : 'sem registro',
    };
  };
  const itens = itensDoSetor(e.setor).map((item) => ({
    item,
    rotulo: ROTULOS_CRITERIO_LIBERACAO[item],
    ...avaliar(item),
  }));
  return { setor: e.setor.id, itens, podeLiberar: itens.every((i) => i.ok) };
}

/** Motivo da recusa do lote do setor com o critério incompleto (null quando pode liberar). */
export function motivoLoteOnda2(a: AvaliacaoLiberacaoSetor): string | null {
  if (a.podeLiberar) return null;
  return `Critério de liberação incompleto: ${a.itens
    .filter((i) => !i.ok)
    .map((i) => i.falta ?? i.rotulo)
    .join('; ')}.`;
}

/**
 * Setores da onda 2 a que a chave de liberação pertence: a operação de gravação do setor (catálogo) ou um recurso
 * dele. Vazio: a chave não é da onda 2 (a tela de chaves não confere o critério do setor). A chave que um setor das
 * ondas 0 ou 1 também usa (a senha e a chegada da recepção, que o pronto atendimento repete) já foi liberada pela
 * onda dela e segue a lista dela: fica vazia aqui.
 */
export function setoresOnda2DaChave(
  tipo: 'recurso' | 'operacao',
  chave: string,
  nomesCatalogo: readonly string[],
  setores: readonly Pick<DefinicaoSetor, 'id' | 'onda' | 'operacoes' | 'recursos'>[] = SETORES_PRONTIDAO,
): string[] {
  return setoresDaOndaDaChave(2, SETORES_ONDA_2, tipo, chave, nomesCatalogo, setores);
}

/**
 * Setores da onda `onda` (ids em `daOnda`) a que a chave pertence. A chave que um setor de onda anterior também usa já
 * foi liberada pela onda dela e segue a lista dela: vazio.
 */
export function setoresDaOndaDaChave(
  onda: number,
  daOnda: readonly string[],
  tipo: 'recurso' | 'operacao',
  chave: string,
  nomesCatalogo: readonly string[],
  setores: readonly Pick<DefinicaoSetor, 'id' | 'onda' | 'operacoes' | 'recursos'>[] = SETORES_PRONTIDAO,
): string[] {
  const donos = setores.filter((d) =>
    tipo === 'operacao'
      ? operacoesDoSetor(d as DefinicaoSetor, nomesCatalogo).includes(chave)
      : d.recursos.includes(chave),
  );
  if (donos.some((d) => d.onda < onda && !daOnda.includes(d.id))) return [];
  return donos.filter((d) => daOnda.includes(d.id)).map((d) => d.id);
}

/** O setor é da onda 2? */
export function ehSetorOnda2(setor: string): boolean {
  return SETORES_ONDA_2.includes(setor);
}

/** O passo do setor na ordem recomendada (1 = primeiro), ou 0 fora da onda. */
export function passoDoSetorOnda2(setor: string): number {
  return ORDEM_SETORES_ONDA_2.findIndex((p) => p.includes(setor)) + 1;
}

// ---------------------------------------------------------------------------------------------------------------
// Regra 4: recolher na hora

export interface PlanoRecolhimento {
  /** Chaves de SGH_CFG_LIBERACAO a desligar no setor: operações de escrita e recursos do setor. */
  readonly chaves: readonly string[];
  /** Operações que passam a `bloqueada` (voltam à conferência depois da correção). */
  readonly bloquear: readonly string[];
}

/**
 * O que desligar ao recolher o setor (ou uma operação dele). Os usuários continuam no outro sistema sobre os mesmos
 * dados; a trilha dupla lista o que o novo gravou.
 */
export function planoRecolhimento(
  setor: Pick<DefinicaoSetor, 'recursos'>,
  operacoesLiberadas: readonly string[],
  apenas?: string,
): PlanoRecolhimento {
  if (apenas) {
    if (!operacoesLiberadas.includes(apenas)) return { chaves: [], bloquear: [] };
    return { chaves: [apenas], bloquear: [apenas] };
  }
  const ops = [...new Set(operacoesLiberadas)].sort();
  return { chaves: [...ops, ...setor.recursos], bloquear: ops };
}

// ---------------------------------------------------------------------------------------------------------------
// Regra 8: o Serrano depois de todas as ondas prontas no ProntoCardio

/** Situações do setor (M37, SGH_CFG_COEX_SETOR) que contam como "pronto" no hospital inicial. */
export const SITUACOES_SETOR_PRONTO: readonly string[] = ['liberado', 'acompanhamento', 'migrado'];

/**
 * Setores que ainda seguram o hospital `hospital` (vazio: pode começar). No hospital inicial, nada segura; nos demais,
 * todo setor das ondas 1 a 5 do hospital inicial precisa estar pronto (DP-4). Um setor que o dono deixou no outro
 * sistema (situação `fora`) não segura.
 */
export function setoresQueSeguramHospital(
  hospital: string,
  situacoesNoInicial: Readonly<Record<string, string>>,
  setores: readonly Pick<DefinicaoSetor, 'id' | 'onda'>[] = SETORES_PRONTIDAO,
): string[] {
  if (hospital === HOSPITAL_INICIAL_ONDAS) return [];
  return setores
    .filter((s) => s.onda >= 1)
    .filter((s) => {
      const sit = situacoesNoInicial[s.id];
      return sit !== 'fora' && !SITUACOES_SETOR_PRONTO.includes(sit ?? '');
    })
    .map((s) => s.id);
}

// ---------------------------------------------------------------------------------------------------------------
// Regra 15: tabelas que o novo nunca grava

export interface TabelaGravada {
  readonly tabela: string;
  readonly acao: string;
}

export interface ViolacaoRegra15 {
  readonly operacao: string;
  readonly tabela: string;
  readonly acao: string;
}

/** Gravações diretas (não de gatilho) em tabela proibida, fora das exceções justificadas. */
export function violacoesRegra15(
  operacoes: readonly { readonly nome: string; readonly tabelasGravadas: readonly TabelaGravada[] }[],
): ViolacaoRegra15[] {
  const v: ViolacaoRegra15[] = [];
  for (const o of operacoes)
    for (const t of o.tabelasGravadas) {
      if (!TABELAS_NUNCA_GRAVADAS.includes(t.tabela)) continue;
      const excecao = EXCECOES_REGRA_15.some(
        (x) => x.operacao === o.nome && x.tabela === t.tabela && x.acao === t.acao,
      );
      if (!excecao) v.push({ operacao: o.nome, tabela: t.tabela, acao: t.acao });
    }
  return v;
}

// ---------------------------------------------------------------------------------------------------------------
// Regra 16: sem versão nova em feriado prolongado; hotfix só para S1

export type SeveridadeVersao = 'S1' | 'S2' | 'S3' | 'S4';

/** Pode publicar versão na data (AAAA-MM-DD)? Na janela, só hotfix de S1. */
export function versaoPermitida(
  dia: string,
  severidade: SeveridadeVersao | null,
  janelas: readonly JanelaSemVersao[] = JANELAS_SEM_VERSAO_PADRAO,
): { permitida: boolean; motivo: string | null } {
  const j = janelas.find((x) => dia >= x.de && dia <= x.ate);
  if (!j) return { permitida: true, motivo: null };
  if (severidade === 'S1') return { permitida: true, motivo: `hotfix de S1 na janela (${j.motivo})` };
  return { permitida: false, motivo: `sem versão nova de ${j.de} a ${j.ate} (${j.motivo}); só hotfix de S1` };
}

// ---------------------------------------------------------------------------------------------------------------
// Assinaturas: cenários mínimos da ficha que o catálogo ainda não tem (campo 9)

export function cenariosFaltantes(minimos: readonly string[], doCatalogo: readonly string[]): string[] {
  return minimos.filter((c) => !doCatalogo.includes(c));
}

// ---------------------------------------------------------------------------------------------------------------
// Acompanhamento (campo 4): agregados prontos para o painel (nenhum dado de pessoa)

/** Situações que marcam a administração registrada no horário (comparação binária: `n` não é `N`). */
export const SITUACOES_CHECADAS: readonly string[] = ['A', 'N'];

const pct = (parte: number, total: number) => (total > 0 ? Math.round((parte / total) * 10_000) / 100 : 0);

export interface LinhaChecagem {
  readonly dia: string;
  readonly unidade: string;
  readonly situacao: string;
  readonly n: number;
}

/** Horários por dia e unidade e quantos têm administração registrada (regra 11; linha de base: 77 em 829 mil). */
export function indicadorChecagem(linhas: readonly LinhaChecagem[]) {
  const m = new Map<string, { dia: string; unidade: string; horarios: number; checados: number }>();
  for (const l of linhas) {
    const k = `${l.dia}|${l.unidade}`;
    const x = m.get(k) ?? { dia: l.dia, unidade: l.unidade, horarios: 0, checados: 0 };
    x.horarios += l.n;
    if (SITUACOES_CHECADAS.includes(l.situacao)) x.checados += l.n;
    m.set(k, x);
  }
  return [...m.values()]
    .map((x) => ({ ...x, percentual: pct(x.checados, x.horarios) }))
    .sort((a, b) => a.dia.localeCompare(b.dia) || a.unidade.localeCompare(b.unidade));
}

export interface LinhaHigienizacao {
  readonly dia: string;
  readonly unidade: string;
  /** Situação da execução no outro sistema (1 = primeiro estado). */
  readonly situacao: number;
  /** Solicitações com etapa além da solicitação registrada no novo (aceite, execução, checklist, inspeção). */
  readonly comEtapaNoNovo: number;
  readonly n: number;
}

/** Solicitações por dia e unidade e quantas avançaram além do primeiro estado (regra 12; hoje 11 de 6.868). */
export function indicadorHigienizacao(linhas: readonly LinhaHigienizacao[]) {
  const m = new Map<string, { dia: string; unidade: string; solicitacoes: number; avancaram: number }>();
  for (const l of linhas) {
    const k = `${l.dia}|${l.unidade}`;
    const x = m.get(k) ?? { dia: l.dia, unidade: l.unidade, solicitacoes: 0, avancaram: 0 };
    x.solicitacoes += l.n;
    // Avançou no outro sistema (situação além da 1) ou tem etapa no novo; o maior dos dois, sem contar duas vezes.
    x.avancaram += l.situacao !== 1 ? l.n : Math.min(l.n, l.comEtapaNoNovo);
    m.set(k, x);
  }
  return [...m.values()]
    .map((x) => ({ ...x, percentual: pct(x.avancaram, x.solicitacoes) }))
    .sort((a, b) => a.dia.localeCompare(b.dia) || a.unidade.localeCompare(b.unidade));
}

/**
 * Registros do dia por sistema: o total do banco menos o que a trilha atribui ao novo (cap-15 §15.3.4). Trilha acima
 * do total (relógios ou dia de corte diferentes) não dá negativo: o outro fica em zero.
 */
export function registrosPorSistema(
  totais: readonly { dia: string; tipo: 'evolucao' | 'prescricao'; n: number }[],
  peloNovo: readonly { dia: string; tipo: 'evolucao' | 'prescricao'; n: number }[],
) {
  const novo = new Map(peloNovo.map((x) => [`${x.dia}|${x.tipo}`, x.n]));
  return totais
    .map((t) => {
      const n = Math.min(novo.get(`${t.dia}|${t.tipo}`) ?? 0, t.n);
      return { dia: t.dia, tipo: t.tipo, total: t.n, peloNovo: n, peloOutro: t.n - n };
    })
    .sort((a, b) => a.dia.localeCompare(b.dia) || a.tipo.localeCompare(b.tipo));
}

// ---------------------------------------------------------------------------------------------------------------
// Roteiros de recolhimento e de retorno por setor (entregável; regras 4 e 5; cap-14 §14.8 e §14.8.2)

export interface EntradaRoteiroRecolhimento {
  readonly setor: Pick<DefinicaoSetor, 'id' | 'nome' | 'recursos'>;
  readonly hospital: string;
  /** Operações de gravação do setor (nomes do catálogo). */
  readonly operacoes: readonly string[];
  /** Onda do setor (padrão 2): o nome da aba do painel e o texto do roteiro. */
  readonly onda?: number;
  /** Recursos só do novo da onda (chave → o que é); padrão: os da onda 2 (regra 6). */
  readonly recursosSoNoNovo?: Readonly<Record<string, string>>;
}

/**
 * O roteiro de recolhimento e de retorno do setor, para o pacote de homologação (docs/prontidao/homologacao/
 * <setor>.recolhimento.md). Texto de produto lido por chave-usuário e TI: nunca cita o outro sistema pelo nome.
 */
export function roteiroRecolhimentoMarkdown(e: EntradaRoteiroRecolhimento): string {
  const plano = planoRecolhimento(e.setor, e.operacoes);
  const onda = e.onda ?? 2;
  const mapaNovos = e.recursosSoNoNovo ?? RECURSOS_SO_NO_NOVO;
  const novos = e.setor.recursos.filter((r) => r in mapaNovos);
  return [
    `# Recolhimento e retorno: ${e.setor.nome} (${e.hospital})`,
    '',
    `Roteiro da regra 4 (recolher na hora) e da regra 5 (teste de retorno ao sistema anterior) da onda ${onda}. Ensaiar na homologação antes de liberar o setor e registrar o ensaio no critério de liberação do setor (painel de migração gradual, aba "Onda ${onda}").`,
    '',
    '## Quando recolher',
    '',
    '- Defeito numa operação liberada que grava errado, some com dado ou impede o atendimento (S1 ou S2).',
    '- Pedido do coordenador do projeto, da TI ou do comitê de coexistência.',
    '',
    '## Quem recolhe',
    '',
    '- O coordenador do projeto ou a TI, pela tela "Chaves de liberação" (uma chave) ou pelo botão "Recolher" do lote no painel de migração (o setor inteiro). As duas pedem a senha de novo.',
    '- O sistema nunca recolhe nem liga sozinho em produção.',
    '',
    '## O que desligar',
    '',
    plano.chaves.length
      ? plano.chaves.map((c) => `- \`${c}\``).join('\n')
      : '- Nenhuma chave ligada no setor.',
    '',
    '## O que passa a bloqueada',
    '',
    plano.bloquear.length
      ? `${plano.bloquear.map((c) => `\`${c}\``).join(', ')}: depois da correção, cada uma volta à conferência antes de ser ligada de novo.`
      : 'Nenhuma operação liberada.',
    '',
    '## Depois de desligar',
    '',
    '1. Confirmar na tela do setor que a gravação ficou recusada e que a tela continua aberta só para consulta.',
    '2. Listar o que o sistema novo gravou desde a liberação: "Administração > Auditoria e privacidade > Trilha de auditoria e eventos auditáveis", filtro pelas operações do setor e pelo período.',
    '3. Conferir no sistema anterior cada registro listado (o chave-usuário do setor abre e confere).',
    '4. Avisar o setor: o trabalho segue no sistema anterior sobre os mesmos dados; nada é migrado nem perdido.',
    '5. Abrir o chamado com a severidade e anexar a lista do passo 2 (sem dado de paciente no texto do chamado).',
    '',
    ...(novos.length
      ? [
          '## Recursos que só existem no sistema novo',
          '',
          onda === 2
            ? `Com o recolhimento, ${novos.map((r) => mapaNovos[r]).join(', ')} deixam de ser registrados no sistema novo. O posto passa a usar o relatório de contingência impresso (regra 6) até o setor voltar.`
            : `Com o recolhimento, ${novos.map((r) => mapaNovos[r]).join(', ')} deixam de ser registrados no sistema novo e voltam ao registro de hoje (papel ou livro) até o setor voltar. Os documentos de estoque e os saldos são os mesmos nos dois sistemas: nada a migrar.`,
          '',
        ]
      : []),
    '## Teste de retorno ao sistema anterior (regra 5)',
    '',
    'Antes de liberar o setor, em horário de baixo movimento, o setor volta ao sistema anterior por um período curto:',
    '',
    '1. Login de quem vai trabalhar no setor, com os menus de cada papel.',
    '2. Estações, impressoras e leitores do setor conferidos pela TI.',
    '3. Uma tarefa de cada operação do setor feita no sistema anterior e aberta no sistema novo.',
    '4. Registro do teste no critério do setor (item "Teste de retorno ao sistema anterior feito no setor"), com o caminho da ata.',
    '',
  ].join('\n');
}
