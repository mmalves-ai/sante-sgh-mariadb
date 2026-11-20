// Onda 1 (ficha do M39): regras puras da lista para ligar um setor (regra 1; cap-15 §15.3.2; DP-4), dos
// indicadores de disputa do painel de migração (entregável; cap-10 §10.5) e do mapa de impacto do pacote do setor
// (entregável; cap-15 §15.4.3). Sem Nest, banco ou disco: quem lê o catálogo, o executor e o uso do dia é o chamador.
// Os textos podem aparecer na tela e nos pacotes lidos por chave-usuários: nunca citam o outro sistema pelo nome
// (ADR 0023). Toda conta agregada sai com as parcelas impressas.
import {
  type AvaliacaoLigar,
  CODIGO_HORARIO_OCUPADO,
  ESTABELECIMENTO_ONDA_1,
  type EstadoOperacao,
  type IndicadoresDisputa,
  ITENS_POR_SETOR,
  type ItemLigar,
  type ItemLigarSetor,
  OPERACOES_FICHA_ONDA_1,
  operacoesForaDaOnda1,
  operacoesLiberaveisOnda1,
  ROTULO_ITEM_LIGAR,
  SETORES_ONDA_1,
  type SetorOnda1,
  TELAS_ONDA_1,
} from '@sgh/contratos';

const CONFERIDA_OU_LIBERADA: readonly EstadoOperacao[] = ['conferida', 'liberada'];

export interface EntradaLigarSetor {
  readonly setor: SetorOnda1;
  readonly hospital: string;
  /** Estado de cada operação do catálogo no estabelecimento (já com a regra 6 aplicada). */
  readonly estados: Readonly<Record<string, EstadoOperacao>>;
  /** Itens registrados (os não registrados contam como pendentes). */
  readonly itens: readonly ItemLigar[];
  /** DP-4: todas as ondas prontas no ProntoCardio (só então o Serrano começa). */
  readonly ondasProntasNoPrimeiro: boolean;
  /** Bloqueio do estabelecimento inteiro (HS-1), ou null. */
  readonly bloqueio: string | null;
}

/**
 * Regra 1: o setor só liga com todas as operações que usa em `conferida` (ou já `liberada`) no estabelecimento e com
 * cada item da lista cumprido (ou que não se aplica). No outro estabelecimento, só depois de todas as ondas prontas
 * no primeiro (DP-4). O item das operações é calculado aqui, nunca registrado à mão.
 */
export function avaliarLigarSetor(e: EntradaLigarSetor): AvaliacaoLigar {
  const nomes = operacoesLiberaveisOnda1(e.setor);
  const operacoesPendentes = nomes
    .map((nome) => ({ nome, estado: e.estados[nome] ?? 'especificada' }))
    .filter((o) => !CONFERIDA_OU_LIBERADA.includes(o.estado));
  const foraDaOnda = operacoesForaDaOnda1().filter((o) =>
    OPERACOES_FICHA_ONDA_1.some((f) => f.setor === e.setor && f.catalogo.includes(o.nome)),
  );
  const bloqueio =
    e.bloqueio ??
    (e.hospital !== ESTABELECIMENTO_ONDA_1 && !e.ondasProntasNoPrimeiro
      ? `DP-4: este estabelecimento começa depois de todas as ondas prontas em ${ESTABELECIMENTO_ONDA_1}`
      : null);
  const registrados = new Map(e.itens.map((i) => [i.item, i]));
  const itens = ITENS_POR_SETOR[e.setor].map((item: ItemLigarSetor) => {
    const rotulo = ROTULO_ITEM_LIGAR[item];
    if (item === 'operacoes-conferidas')
      return {
        item,
        rotulo,
        situacao: operacoesPendentes.length ? ('pendente' as const) : ('cumprido' as const),
        detalhe: operacoesPendentes.length
          ? `${nomes.length - operacoesPendentes.length} de ${nomes.length} conferidas; faltam: ${operacoesPendentes.map((o) => `${o.nome} (${o.estado})`).join(', ')}`
          : `${nomes.length} de ${nomes.length} conferidas`,
      };
    const r = registrados.get(item);
    const situacao = r?.situacao ?? 'pendente';
    const detalhe =
      situacao === 'pendente'
        ? 'sem registro'
        : [r?.em ? `em ${r.em}` : '', r?.evidencia ?? ''].filter(Boolean).join('; ') ||
          'registrado sem evidência';
    return { item, rotulo, situacao, detalhe };
  });
  const veredito: AvaliacaoLigar['veredito'] = bloqueio
    ? 'bloqueado'
    : itens.some((i) => i.situacao === 'pendente')
      ? 'falta'
      : 'pode-ligar';
  return { setor: e.setor, hospital: e.hospital, veredito, bloqueio, itens, operacoesPendentes, foraDaOnda };
}

// ── Indicadores de disputa ───────────────────────────────────────────────────────────────────────────

/** Contagem do executor do processo para uma operação no dia (desfechos e recusas por código). */
export interface ContagemDisputa {
  readonly operacao: string;
  readonly hospital: string;
  readonly conflitosVersao: number;
  readonly travas: number;
  /** Recusas por código do problema (ex.: `horario-ocupado`). */
  readonly recusasPorCodigo: Readonly<Record<string, number>>;
}

/** Uso do dia por sistema (SGH_CFG_COEX_USO_DIA, M37): quantas no novo e quantas no outro. */
export interface UsoDiaDisputa {
  readonly operacao: string;
  readonly noNovo: number;
  readonly noLegado: number;
}

/**
 * A soma com as parcelas impressas, cada uma com o nome curto da operação (ex.: "agendarConsulta 3 + encaixar 1 = 4");
 * as parcelas zero não aparecem; sem parcela, "0"; uma parcela só, "agendarConsulta 3".
 */
const soma = (
  xs: readonly { readonly operacao: string; readonly n: number }[],
): { total: number; conta: string } => {
  const total = xs.reduce((t, x) => t + x.n, 0);
  const partes = xs.filter((x) => x.n > 0).map((x) => `${x.operacao.split('.').at(-1)} ${x.n}`);
  return {
    total,
    conta: partes.length === 0 ? '0' : partes.length === 1 ? partes[0]! : `${partes.join(' + ')} = ${total}`,
  };
};

const setorDaOperacao = (nome: string): SetorOnda1 | null =>
  OPERACOES_FICHA_ONDA_1.find((o) => o.catalogo.includes(nome))?.setor ?? null;

/**
 * Os quatro indicadores de disputa por setor no dia: colisões na grade (conflito de versão e trava nas operações da
 * agenda), recusas por horário ocupado, esperas por registro em edição (todas as operações do setor) e senhas
 * chamadas em cada sistema (uso do dia de `recepcao.chamarSenha`). Cada número sai com as parcelas.
 */
export function indicadoresDisputa(p: {
  readonly hospital: string;
  readonly dia: string;
  readonly contagens: readonly ContagemDisputa[];
  readonly usoDia: readonly UsoDiaDisputa[];
}): IndicadoresDisputa {
  const doHospital = p.contagens.filter((c) => c.hospital === p.hospital);
  const setores = SETORES_ONDA_1.map((setor) => {
    const cs = doHospital.filter((c) => setorDaOperacao(c.operacao) === setor);
    const agenda = cs.filter((c) => c.operacao.startsWith('agenda.'));
    const colisoes = soma(agenda.map((c) => ({ operacao: c.operacao, n: c.conflitosVersao + c.travas })));
    const ocupado = soma(
      agenda.map((c) => ({ operacao: c.operacao, n: c.recusasPorCodigo[CODIGO_HORARIO_OCUPADO] ?? 0 })),
    );
    const travas = soma(cs.map((c) => ({ operacao: c.operacao, n: c.travas })));
    const chamadas =
      setor === 'recepcao-ambulatorial'
        ? p.usoDia.find((u) => u.operacao === 'recepcao.chamarSenha')
        : undefined;
    const senhas = chamadas
      ? { noNovo: chamadas.noNovo, noOutro: chamadas.noLegado, total: chamadas.noNovo + chamadas.noLegado }
      : null;
    return {
      setor,
      colisoesGrade: colisoes.total,
      recusasHorarioOcupado: ocupado.total,
      esperasTrava: travas.total,
      senhas,
      parcelas: {
        'colisoes-grade': colisoes.conta,
        'recusas-horario-ocupado': ocupado.conta,
        'esperas-trava': travas.conta,
        'senhas-por-sistema': senhas
          ? `${senhas.noNovo} no novo + ${senhas.noOutro} no outro = ${senhas.total}`
          : 'não se aplica',
      },
    };
  });
  return { hospital: p.hospital, dia: p.dia, setores };
}

// ── Mapa de impacto (cap-15 §15.4.3) ─────────────────────────────────────────────────────────────────

export interface EntradaMapaImpacto {
  readonly setor: SetorOnda1;
  readonly nomeSetor: string;
  readonly hospital: string;
  /** Data prevista da liberação (AAAA-MM-DD), ou null enquanto não autorizada. */
  readonly aPartirDe: string | null;
  /** Público por papel, com a contagem agregada (abaixo de 5 vira "<5"). */
  readonly publico: readonly { readonly papel: string; readonly pessoas: number }[];
  /** M39: os guias da trilha do papel (caminho relativo ao pacote), para quem vai começar. */
  readonly guias?: readonly string[];
}

const contagem = (n: number) => (n < 5 ? '<5' : String(n));

/** Mapa de impacto do setor: o que muda, para quem e a partir de quando (pacote da onda 1). */
export function mapaImpactoMarkdown(e: EntradaMapaImpacto): string {
  const telas = TELAS_ONDA_1.filter((t) => t.setor === e.setor);
  const ops = OPERACOES_FICHA_ONDA_1.filter((o) => o.setor === e.setor);
  const dentro = ops.filter((o) => o.foraDaOnda1 === null);
  const fora = ops.filter((o) => o.foraDaOnda1 !== null);
  const total = e.publico.reduce((t, x) => t + x.pessoas, 0);
  const linhas = [
    `# Mapa de impacto: ${e.nomeSetor} (${e.hospital})`,
    '',
    `- A partir de: ${e.aPartirDe ?? 'a definir na autorização do setor'}`,
    `- Para quem: ${
      e.publico.length === 0
        ? 'a confirmar com o chave-usuário'
        : e.publico.length === 1
          ? `${e.publico[0]!.papel} ${contagem(total)} pessoa(s)`
          : `${e.publico.map((x) => `${x.papel} ${contagem(x.pessoas)}`).join(' + ')} = ${contagem(total)} pessoa(s)`
    }`,
    '',
    '## O que muda',
    '',
    ...telas
      .filter((t) => !t.foraDaOnda1)
      .map((t) => `- ${t.tela} (${t.item}) passa a ser feita no sistema novo.`),
    ...dentro.map((o) => `- Gravação: ${o.catalogo.join(', ')}.`),
    '',
    '## O que não muda',
    '',
    '- Os dados são os mesmos: o que um sistema grava, o outro enxerga na hora.',
    '- Quem ainda não foi liberado continua trabalhando como hoje; o recolhimento devolve o setor sem perder senha nem agendamento.',
    '- Nenhuma mensagem ao paciente sai do sistema novo nesta onda.',
    ...telas
      .filter((t) => t.foraDaOnda1)
      .map((t) => `- Fica para depois: a tela ${t.tela} (${t.foraDaOnda1}).`),
    ...fora.map((o) => `- Fica para depois: ${o.catalogo.join(', ')}.`),
    '',
    ...(e.guias && e.guias.length
      ? ['## Guias da trilha', '', ...e.guias.map((g) => `- [${g.split('/').at(-1)}](${g})`), '']
      : []),
  ];
  return linhas.join('\n');
}

// ── Indicadores de disputa por dia (painel de migração; SGH_CFG_COEX_USO_DIA mais o processo da API) ─────

/** Uma linha do uso do dia (SGH_CFG_COEX_USO_DIA, com a coluna do M39 das recusas por horário ocupado). */
export interface UsoDiaComDisputa {
  readonly dia: string;
  readonly operacao: string;
  readonly noNovo: number;
  readonly noLegado: number;
  /** Conflitos de versão mais esperas por trava (o executor do M04). */
  readonly colisoes: number;
  readonly esperasTrava: number;
  readonly recusasOcupado: number;
}

/** A contagem do dia de uma operação como ContagemDisputa (colisões = conflitos de versão + travas). */
export function contagemDoUso(hospital: string, u: UsoDiaComDisputa): ContagemDisputa {
  return {
    operacao: u.operacao,
    hospital,
    conflitosVersao: Math.max(u.colisoes - u.esperasTrava, 0),
    travas: u.esperasTrava,
    recusasPorCodigo: u.recusasOcupado ? { [CODIGO_HORARIO_OCUPADO]: u.recusasOcupado } : {},
  };
}

/**
 * Soma duas contagens da mesma operação (revisão do M39): a gravada no dia (a soma dos incrementos de cada processo da
 * API) e a ainda não gravada deste processo (o que ele contou depois do último retrato). Somar, não o maior: a
 * reinicialização da API no meio do dia e um segundo processo de API não perdem o contado.
 */
export function juntarContagens(
  a: ContagemDisputa | undefined,
  b: ContagemDisputa | undefined,
): ContagemDisputa {
  if (!a) return b as ContagemDisputa;
  if (!b) return a;
  const codigos = new Set([...Object.keys(a.recusasPorCodigo), ...Object.keys(b.recusasPorCodigo)]);
  return {
    operacao: a.operacao,
    hospital: a.hospital,
    conflitosVersao: a.conflitosVersao + b.conflitosVersao,
    travas: a.travas + b.travas,
    recusasPorCodigo: Object.fromEntries(
      [...codigos].map((k) => [k, (a.recusasPorCodigo[k] ?? 0) + (b.recusasPorCodigo[k] ?? 0)]),
    ),
  };
}

/**
 * O que o processo contou e ainda não gravou (revisão do M39): o total do executor desde a partida menos o que este
 * processo já somou no banco (o último retrato bem-sucedido). Nunca negativo (o executor só conta para cima).
 */
export function disputaPendente(
  total: readonly ContagemDisputa[],
  jaGravado: ReadonlyMap<string, ContagemDisputa>,
): ContagemDisputa[] {
  return total.map((t) => {
    const g = jaGravado.get(`${t.hospital}|${t.operacao}`);
    if (!g) return t;
    const codigos = new Set([...Object.keys(t.recusasPorCodigo), ...Object.keys(g.recusasPorCodigo)]);
    return {
      operacao: t.operacao,
      hospital: t.hospital,
      conflitosVersao: Math.max(t.conflitosVersao - g.conflitosVersao, 0),
      travas: Math.max(t.travas - g.travas, 0),
      recusasPorCodigo: Object.fromEntries(
        [...codigos]
          .map((k) => [k, Math.max((t.recusasPorCodigo[k] ?? 0) - (g.recusasPorCodigo[k] ?? 0), 0)] as const)
          .filter(([, v]) => v > 0),
      ),
    };
  });
}

/**
 * Os indicadores de disputa de cada dia da janela: os dias passados pelo uso gravado; o dia corrente pelo gravado
 * somado ao que este processo contou e ainda não gravou (`doProcesso` é o pendente, `disputaPendente`). Senhas
 * chamadas por sistema pelo uso de `recepcao.chamarSenha` (do dia corrente, a contagem ao vivo quando houver).
 */
export function disputaDosDias(p: {
  readonly hospital: string;
  readonly dias: readonly string[];
  readonly hoje: string;
  readonly uso: readonly UsoDiaComDisputa[];
  readonly doProcesso: readonly ContagemDisputa[];
  readonly senhasHoje: UsoDiaDisputa | null;
}): IndicadoresDisputa[] {
  return p.dias.map((dia) => {
    const doDia = p.uso.filter((u) => u.dia === dia);
    const porOp = new Map<string, ContagemDisputa>();
    for (const u of doDia) porOp.set(u.operacao, contagemDoUso(p.hospital, u));
    if (dia === p.hoje)
      for (const c of p.doProcesso.filter((x) => x.hospital === p.hospital))
        porOp.set(c.operacao, juntarContagens(porOp.get(c.operacao), c));
    const senhasGravadas = doDia.find((u) => u.operacao === 'recepcao.chamarSenha');
    const senhas =
      dia === p.hoje && p.senhasHoje
        ? p.senhasHoje
        : senhasGravadas
          ? {
              operacao: senhasGravadas.operacao,
              noNovo: senhasGravadas.noNovo,
              noLegado: senhasGravadas.noLegado,
            }
          : null;
    return indicadoresDisputa({
      hospital: p.hospital,
      dia,
      contagens: [...porOp.values()],
      usoDia: senhas ? [senhas] : [],
    });
  });
}

// ── Lote de um setor da onda 1 (regra 1) ─────────────────────────────────────────────────────────────

/** O setor é da onda 1? (os da lista para ligar). */
export function ehSetorOnda1(codigo: string): codigo is SetorOnda1 {
  return (SETORES_ONDA_1 as readonly string[]).includes(codigo);
}

/** O que falta, em uma frase, para o lote de um setor da onda 1 (null: pode ligar). */
export function motivoLoteOnda1(a: AvaliacaoLigar): string | null {
  if (a.veredito === 'pode-ligar') return null;
  if (a.veredito === 'bloqueado') return a.bloqueio ?? 'Estabelecimento bloqueado.';
  const faltam = a.itens.filter((i) => i.situacao === 'pendente').map((i) => i.rotulo);
  return `A lista para ligar o setor não está completa: ${faltam.join('; ')}.`;
}

/** Um guia de uma página da trilha (o caminho relativo e o texto, como `pnpm treinamento:gerar` grava). */
export interface GuiaTrilha {
  readonly caminho: string;
  readonly texto: string;
}

/** Os dois primeiros níveis do menu, sem o complemento entre parênteses ("Cadastros > Pacientes"). */
function raizDoMenu(item: string): string {
  return item
    .split(/\s*[>›]\s*/)
    .slice(0, 2)
    .map((x) => x.replace(/\s*\(.*?\)\s*/g, '').trim())
    .join(' > ');
}

/**
 * Os guias do mapa de impacto de um setor da onda 1 (revisão do M39): só os da onda 1 (o cabeçalho "onda 1" que o
 * gerador grava) que abrem uma tela do setor (os dois primeiros níveis do menu de um item de TELAS_ONDA_1 do setor).
 * O guia de outra onda (a internação é da onda 2) ou de outro setor fica fora.
 */
export function guiasDoSetorOnda1(setor: SetorOnda1, guias: readonly GuiaTrilha[]): string[] {
  const raizes = new Set(TELAS_ONDA_1.filter((t) => t.setor === setor).map((t) => raizDoMenu(t.item)));
  return guias
    .filter((g) => /\(papel [a-z-]+, onda 1\)/.test(g.texto))
    .filter((g) =>
      [...g.texto.matchAll(/Abra \*\*([^*]+)\*\*/g)].some((m) => raizes.has(raizDoMenu(m[1] ?? ''))),
    )
    .map((g) => g.caminho);
}
