// M61 (ADR 0034; decisão do dono de 30/10/2026): o miolo do comando `pnpm liberacao:ligar-tudo`, sem banco (a porta
// chega de fora; o spec usa uma porta em memória). Por estabelecimento: confere o teto de linhas, registra os
// pré-requisitos (aprovação dispensada em todo ambiente; contrato, certificado e credenciamento só em dev/ci), e liga
// cada chave por um lote próprio (uma transação por chave, com LIGADA_ANTES e a trilha; aplicarLoteLiberacao), depois
// das MESMAS conferências da tela de chaves (@sgh/dominio-config, conferencias-ligar.ts). Recusa vira pendência e não
// para as outras. A reversão desfaz os lotes com a marca, do mais novo ao mais antigo. Nunca toca permissão por login
// (SGH_ACESSO_*, TBPERUSU, TBGRUUSU) nem o painel de migração. Saída só com chaves e contagens (nenhum login).
import {
  CHAVE_CLASSIFICACAO_EXTERNA,
  CHAVE_LIBERACAO_CLASSIFICACAO,
  ehAmbienteDaObra,
  MARCA_LIBERACAO_FULL,
  RECURSOS_DESLIGADOS,
  recursoDesligado,
  type TipoPrerequisito,
} from '@sgh/contratos';
import {
  anteriorDaDispensaFull,
  classificarChavesFull,
  conferirFonteUnicaDeCor,
  conferirLigarEmProducao,
  conferirPrerequisitosDeLigar,
  conferirRegrasDeLigar,
  diaEmSaoPaulo,
  evidenciaDispensaFull,
  justificativaLiberacaoFull,
  lotesParaReverter,
  type ChaveExcluidaFull,
  type ChaveFull,
  type MudancaLote,
  planejarLigarTudo,
  planejarLote,
  planejarPrerequisitosFull,
  type RecusaLigar,
  recusaPorLinhas,
  reverterLote,
} from '@sgh/dominio-config';

/** A linha de chave como o banco a devolve (o valor do escopo nunca sai no relatório). */
export interface LinhaChaveFull {
  readonly tipo: 'operacao' | 'recurso';
  readonly chave: string;
  readonly escopo: 'hospital' | 'setor' | 'grupo' | 'pessoa';
  readonly valor: string;
  readonly ligada: boolean | null;
  readonly ligadaAntes: boolean | null;
  readonly lote: string | null;
  readonly justificativa: string | null;
}

export interface PrerequisitoLidoFull {
  readonly recurso: string;
  readonly tipo: TipoPrerequisito;
  readonly situacao: 'pendente' | 'cumprido' | 'dispensado';
  readonly validade: string | null;
  readonly evidencia: string | null;
}

/** Estado relido NA transação, com trava (o de aplicarLoteLiberacao). */
export interface EstadoTravado {
  readonly chaves: readonly LinhaChaveFull[];
  readonly prerequisitos: readonly PrerequisitoLidoFull[];
}

export interface PedidoLoteFull {
  readonly tipo: 'operacao' | 'recurso';
  readonly chave: string;
  readonly planejar: (estado: EstadoTravado) => readonly MudancaLote[];
  readonly justificativa: string;
  readonly referencia: string | null;
}

/** O que o comando pede ao banco de um estabelecimento (o comando de verdade usa o núcleo do legado). */
export interface PortaLiberacaoFull {
  contarLinhas(hospital: string): Promise<{ readonly decidem: number; readonly todas: number }>;
  /** As chaves que decidem (ligada não nula). */
  chaves(hospital: string): Promise<readonly LinhaChaveFull[]>;
  prerequisitos(hospital: string): Promise<readonly PrerequisitoLidoFull[]>;
  /** Os lotes, numa transação SGH_ só (um lote por pedido, na ordem), com a trilha. */
  aplicarLotes(
    hospital: string,
    pedidos: readonly PedidoLoteFull[],
    evento: 'alterada' | 'revertida',
  ): Promise<readonly { readonly lote: string; readonly alteradas: number }[]>;
  gravarPrerequisito(
    hospital: string,
    p: {
      readonly recurso: string;
      readonly tipo: TipoPrerequisito;
      /** `cumprido` só na reversão (o registro de antes da dispensa, com a validade dele). */
      readonly situacao: 'pendente' | 'cumprido' | 'dispensado';
      readonly validade: string | null;
      readonly evidencia: string | null;
    },
  ): Promise<void>;
  /** As linhas dos lotes com a marca (para reverter). */
  lotesMarcados(hospital: string): Promise<readonly LinhaChaveFull[]>;
  /** M41, regra 1: o que falta para ligar a dispensação ou a entrega (null: pode). */
  regraFarmacia(hospital: string, tipo: 'recurso' | 'operacao', chave: string): Promise<string | null>;
}

export interface OpcoesLiberacaoFull {
  readonly ambiente: string;
  readonly hospitais: readonly string[];
  readonly operacoes: readonly string[];
  /** O estado efetivo da operação no estabelecimento (M36), para a conferência de produção. */
  readonly estadoEfetivo: (operacao: string, hospital: string) => string | null;
  readonly referencia: string | null;
  readonly incluir: readonly string[];
  readonly soListar: boolean;
  readonly agora: Date;
}

export interface PendenciaFull {
  readonly tipo: 'operacao' | 'recurso';
  readonly chave: string;
  readonly motivo: string;
}

export interface RelatorioHospitalFull {
  readonly hospital: string;
  /** Recusado por inteiro (teto de linhas): nada gravado. */
  readonly recusa: string | null;
  readonly ligadas: readonly ChaveFull[];
  readonly jaLigadas: readonly ChaveFull[];
  /** Operações que, em produção, esperam o catálogo `liberada` (o comando não o promove): não são pendência. */
  readonly aguardandoCatalogo: readonly ChaveFull[];
  /** Linhas específicas desligadas que passaram a herdar (contagem). */
  readonly especificasHerdando: number;
  readonly pendentes: readonly PendenciaFull[];
  readonly prerequisitosGravados: number;
  readonly prerequisitosEmDia: number;
  readonly prerequisitosPendentes: readonly (PendenciaFull & { readonly tipoPrerequisito: string })[];
  readonly revertidos: number;
}

export interface RelatorioFull {
  readonly modo: 'ligar' | 'listar' | 'reverter';
  readonly ambiente: string;
  readonly excluidas: readonly ChaveExcluidaFull[];
  readonly incluidas: readonly string[];
  readonly hospitais: readonly RelatorioHospitalFull[];
}

/** Recusa decidida dentro da transação (pré-requisito relido com trava; lote mexido): vira pendência. */
export class RecusaNaTransacao extends Error {
  override readonly name = 'RecusaNaTransacao';
}

const textoDaRecusa = (r: RecusaLigar) => `${r.titulo}: ${r.motivo}`;

function referenciaDoAmbiente(o: OpcoesLiberacaoFull): string | null {
  if (o.referencia) return o.referencia.slice(0, 200);
  if (ehAmbienteDaObra(o.ambiente))
    return 'ESTADO.md › Autorizações 2026-10-30: liberação full na instalação (dev)';
  // Só o plano, sem a referência: a conferência de produção a supõe informada (nada é gravado).
  return o.soListar ? '(simulação)' : null;
}

/** As conferências fora da transação (as mesmas da tela de chaves); o critério do setor não tem avaliador aqui. */
async function conferirAntes(
  o: OpcoesLiberacaoFull,
  porta: PortaLiberacaoFull,
  hospital: string,
  c: ChaveFull,
  referencia: string | null,
): Promise<RecusaLigar | null> {
  const prod = conferirLigarEmProducao({
    ambiente: o.ambiente,
    tipo: c.tipo,
    estadoEfetivo: () => o.estadoEfetivo(c.chave, hospital),
    referenciaAutorizacao: referencia,
  });
  if (prod) return prod;
  const regra = await conferirRegrasDeLigar({
    ambiente: o.ambiente,
    tipo: c.tipo,
    chave: c.chave,
    nomesOperacoes: () => o.operacoes,
    avaliadores: {
      // O critério do setor das ondas 2 a 4 é do módulo de coexistência da API: sem ele, não liga pelo terminal (falha
      // fechada); quem decide liga pela tela de chaves.
      criterioSetor: null,
      regraFarmacia: (t, k) => porta.regraFarmacia(hospital, t, k),
      regraEntradaUtf8: null,
    },
  });
  return regra;
}

const motivoDoErro = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 300);

async function ligarNoHospital(
  o: OpcoesLiberacaoFull,
  porta: PortaLiberacaoFull,
  hospital: string,
  ligar: readonly ChaveFull[],
): Promise<RelatorioHospitalFull> {
  const referencia = referenciaDoAmbiente(o);
  const dia = diaEmSaoPaulo(o.agora);
  const justificativa = justificativaLiberacaoFull(dia);
  const vazio = {
    hospital,
    recusa: null,
    ligadas: [] as ChaveFull[],
    jaLigadas: [] as ChaveFull[],
    aguardandoCatalogo: [] as ChaveFull[],
    especificasHerdando: 0,
    pendentes: [] as PendenciaFull[],
    prerequisitosGravados: 0,
    prerequisitosEmDia: 0,
    prerequisitosPendentes: [] as (PendenciaFull & { tipoPrerequisito: string })[],
    revertidos: 0,
  };
  const [linhas, chaves] = await Promise.all([porta.contarLinhas(hospital), porta.chaves(hospital)]);
  const doEstab = (c: ChaveFull) =>
    chaves.some(
      (x) => x.chave === c.chave && x.tipo === c.tipo && x.escopo === 'hospital' && x.valor === '*',
    );
  const recusa = recusaPorLinhas(linhas.decidem, ligar.filter((c) => !doEstab(c)).length);
  if (recusa) return { ...vazio, recusa };

  // Pré-requisitos dos recursos a ligar (antes das chaves: sem eles, o recurso não liga).
  const recursos = ligar.filter((c) => c.tipo === 'recurso').map((c) => recursoDesligado(c.chave)!);
  const registrados = await porta.prerequisitos(hospital);
  const pre = planejarPrerequisitosFull({ ambiente: o.ambiente, recursos, registrados, agora: o.agora });
  const r = { ...vazio, prerequisitosEmDia: pre.emDia };
  for (const p of pre.pendentes)
    r.prerequisitosPendentes.push({
      tipo: 'recurso',
      chave: p.recurso,
      tipoPrerequisito: p.tipo,
      motivo: p.motivo,
    });
  const dispensados = new Set<string>();
  for (const p of pre.dispensar) {
    if (o.soListar) {
      r.prerequisitosGravados++;
      dispensados.add(`${p.recurso}\u0000${p.tipo}`);
      continue;
    }
    // O registro de antes (pendente, ou cumprido vencido) vai na evidência da dispensa: a reversão o devolve.
    const antes = registrados.find((x) => x.recurso === p.recurso && x.tipo === p.tipo) ?? null;
    try {
      await porta.gravarPrerequisito(hospital, {
        ...p,
        situacao: 'dispensado',
        validade: null,
        evidencia: evidenciaDispensaFull(dia, referencia, antes),
      });
      r.prerequisitosGravados++;
      dispensados.add(`${p.recurso}\u0000${p.tipo}`);
    } catch (e) {
      r.prerequisitosPendentes.push({
        tipo: 'recurso',
        chave: p.recurso,
        tipoPrerequisito: p.tipo,
        motivo: `não gravado: ${motivoDoErro(e)}`,
      });
    }
  }

  for (const c of ligar) {
    const antes = await conferirAntes(o, porta, hospital, c, referencia);
    if (antes?.problema === 'operacao-bloqueada') {
      // Em produção a operação só grava `liberada` no catálogo (que o comando não promove): a chave espera por ele.
      r.aguardandoCatalogo.push(c);
      continue;
    }
    if (antes) {
      r.pendentes.push({ ...c, motivo: textoDaRecusa(antes) });
      continue;
    }
    const minhas = chaves.filter((x) => x.chave === c.chave && x.tipo === c.tipo);
    if (o.soListar) {
      // Simulação: o plano sobre o estado lido agora (sem trava) e os pré-requisitos como ficariam.
      const plano = planejarLigarTudo(minhas);
      if (c.tipo === 'recurso') {
        // A dispensa simulada SUBSTITUI o registro do mesmo tipo (como o UPDATE da gravação de verdade): o registro
        // de antes (pendente, ou cumprido vencido) sai da conta.
        const ficam = [
          ...registrados.filter(
            (x) => x.recurso === c.chave && !dispensados.has(`${x.recurso}\u0000${x.tipo}`),
          ),
          ...[...dispensados]
            .filter((k) => k.startsWith(`${c.chave}\u0000`))
            .map((k) => ({
              tipo: k.split('\u0000')[1] as TipoPrerequisito,
              situacao: 'dispensado' as const,
              validade: null,
            })),
        ];
        const falta = conferirPrerequisitosDeLigar(c.chave, ficam, o.agora);
        if (falta) {
          r.pendentes.push({ ...c, motivo: textoDaRecusa(falta) });
          continue;
        }
      }
      if (plano.length === 0) r.jaLigadas.push(c);
      else {
        r.ligadas.push(c);
        r.especificasHerdando += plano.filter((m) => m.escopo !== 'hospital').length;
      }
      continue;
    }
    const pedidos: PedidoLoteFull[] = [];
    // M44, regra 6: ligar a própria desliga a externa na MESMA transação, antes dela (a decisão compartilhada com a
    // tela; aqui a externa sai do estabelecimento inteiro, porque a própria passa a valer para todos).
    const cor = conferirFonteUnicaDeCor(chaves, { chave: c.chave, escopo: 'hospital', valores: ['*'] });
    if (cor.recusa) {
      r.pendentes.push({ ...c, motivo: textoDaRecusa(cor.recusa) });
      continue;
    }
    if (
      cor.desligarExterna ||
      (c.chave === CHAVE_LIBERACAO_CLASSIFICACAO &&
        chaves.some(
          (x) => x.chave === CHAVE_CLASSIFICACAO_EXTERNA && x.tipo === 'recurso' && x.ligada === true,
        ))
    )
      pedidos.push({
        tipo: 'recurso',
        chave: CHAVE_CLASSIFICACAO_EXTERNA,
        planejar: (e) => planejarLote(e.chaves, 'hospital', ['*'], false),
        justificativa: justificativaLiberacaoFull(dia, 'regra 6: uma fonte de cor'),
        referencia,
      });
    let herdando = 0;
    pedidos.push({
      tipo: c.tipo,
      chave: c.chave,
      planejar: (e) => {
        if (c.tipo === 'recurso') {
          const falta = conferirPrerequisitosDeLigar(c.chave, e.prerequisitos, o.agora);
          if (falta) throw new RecusaNaTransacao(textoDaRecusa(falta));
        }
        const plano = planejarLigarTudo(e.chaves);
        herdando = plano.filter((m) => m.escopo !== 'hospital').length;
        return plano;
      },
      justificativa,
      referencia,
    });
    try {
      const res = await porta.aplicarLotes(hospital, pedidos, 'alterada');
      const ultimo = res[res.length - 1];
      if (!ultimo || ultimo.alteradas === 0) r.jaLigadas.push(c);
      else {
        r.ligadas.push(c);
        r.especificasHerdando += herdando;
      }
    } catch (e) {
      r.pendentes.push({ ...c, motivo: motivoDoErro(e) });
    }
  }
  return r;
}

async function reverterNoHospital(
  o: OpcoesLiberacaoFull,
  porta: PortaLiberacaoFull,
  hospital: string,
): Promise<RelatorioHospitalFull> {
  const referencia = referenciaDoAmbiente(o);
  const dia = diaEmSaoPaulo(o.agora);
  const r = {
    hospital,
    recusa: null,
    ligadas: [] as ChaveFull[],
    jaLigadas: [] as ChaveFull[],
    aguardandoCatalogo: [] as ChaveFull[],
    especificasHerdando: 0,
    pendentes: [] as PendenciaFull[],
    prerequisitosGravados: 0,
    prerequisitosEmDia: 0,
    prerequisitosPendentes: [] as (PendenciaFull & { tipoPrerequisito: string })[],
    revertidos: 0,
  };
  const linhas = await porta.lotesMarcados(hospital);
  const comoMudanca = (l: LinhaChaveFull) => ({
    escopo: l.escopo,
    valor: l.valor,
    ligada: l.ligada,
    antes: l.ligadaAntes,
  });
  for (const alvo of lotesParaReverter(linhas)) {
    const doLote = linhas.filter((l) => l.lote === alvo.lote);
    // A reversão que volta a LIGAR passa pelas mesmas conferências de ligar (produção, regras e pré-requisito).
    if (reverterLote(doLote.map(comoMudanca)).some((m) => m.ligada === true)) {
      const antes = o.soListar ? null : await conferirAntes(o, porta, hospital, alvo, referencia);
      if (antes) {
        r.pendentes.push({
          tipo: alvo.tipo,
          chave: alvo.chave,
          motivo: `reversão religaria: ${textoDaRecusa(antes)}`,
        });
        continue;
      }
    }
    if (o.soListar) {
      r.revertidos++;
      continue;
    }
    let volta: readonly MudancaLote[] = [];
    const pedidos: PedidoLoteFull[] = [
      {
        tipo: alvo.tipo,
        chave: alvo.chave,
        planejar: (e) => {
          const atuais = e.chaves.filter((c) => c.lote === alvo.lote);
          if (atuais.length !== doLote.length)
            throw new RecusaNaTransacao(
              'Lote já alterado: um lote posterior mudou estas chaves (reverta-o antes).',
            );
          volta = reverterLote(atuais.map(comoMudanca));
          if (alvo.tipo === 'recurso' && volta.some((v) => v.ligada === true)) {
            const falta = conferirPrerequisitosDeLigar(alvo.chave, e.prerequisitos, o.agora);
            if (falta) throw new RecusaNaTransacao(textoDaRecusa(falta));
          }
          return volta;
        },
        justificativa: `Reversão da ${MARCA_LIBERACAO_FULL} (lote ${alvo.lote}), ${dia}`.slice(0, 200),
        referencia,
      },
    ];
    // M44, regra 6, também na reversão: religar a externa com a própria ligada daria duas fontes de cor. A própria é
    // relida COM TRAVA na mesma transação (um pedido sem mudança); ligada nos escopos que voltam, a transação inteira
    // é desfeita e o lote vira pendência.
    if (alvo.tipo === 'recurso' && alvo.chave === CHAVE_CLASSIFICACAO_EXTERNA)
      pedidos.push({
        tipo: 'recurso',
        chave: CHAVE_LIBERACAO_CLASSIFICACAO,
        planejar: (e) => {
          for (const m of volta.filter((v) => v.ligada === true)) {
            const cor = conferirFonteUnicaDeCor(e.chaves, {
              chave: CHAVE_CLASSIFICACAO_EXTERNA,
              escopo: m.escopo,
              valores: [m.valor],
            });
            if (cor.recusa) throw new RecusaNaTransacao(`reversão religaria: ${textoDaRecusa(cor.recusa)}`);
          }
          return [];
        },
        justificativa: `Reversão da ${MARCA_LIBERACAO_FULL} (conferência da regra 6), ${dia}`.slice(0, 200),
        referencia,
      });
    try {
      await porta.aplicarLotes(hospital, pedidos, 'revertida');
      r.revertidos++;
    } catch (e) {
      r.pendentes.push({ tipo: alvo.tipo, chave: alvo.chave, motivo: motivoDoErro(e) });
    }
  }
  // Os pré-requisitos que o comando dispensou voltam ao registro de antes, guardado na evidência da dispensa
  // (situação, validade e evidência); sem registro antes (ou dispensa num formato sem o estado), voltam a pendente
  // (sem registro e pendente valem o mesmo: falta).
  for (const p of await porta.prerequisitos(hospital)) {
    if (p.situacao !== 'dispensado' || !(p.evidencia ?? '').startsWith(`${MARCA_LIBERACAO_FULL} `)) continue;
    if (o.soListar) {
      r.prerequisitosGravados++;
      continue;
    }
    const antes = anteriorDaDispensaFull(p.evidencia);
    const marcaReversao = `Reversão da ${MARCA_LIBERACAO_FULL}, ${dia}`.slice(0, 200);
    try {
      await porta.gravarPrerequisito(
        hospital,
        antes && antes.situacao !== 'dispensado'
          ? {
              recurso: p.recurso,
              tipo: p.tipo,
              situacao: antes.situacao,
              validade: antes.situacao === 'cumprido' ? antes.validade : null,
              evidencia: antes.evidencia,
            }
          : {
              recurso: p.recurso,
              tipo: p.tipo,
              situacao: 'pendente',
              validade: null,
              evidencia: marcaReversao,
            },
      );
      r.prerequisitosGravados++;
    } catch (e) {
      r.prerequisitosPendentes.push({
        tipo: 'recurso',
        chave: p.recurso,
        tipoPrerequisito: p.tipo,
        motivo: `não revertido: ${motivoDoErro(e)}`,
      });
    }
  }
  return r;
}

/** Fora de dev/ci, a referência da autorização do dono é obrigatória (ESTADO.md › Autorizações). */
export function conferirOpcoes(o: Pick<OpcoesLiberacaoFull, 'ambiente' | 'referencia' | 'soListar'>): void {
  if (!ehAmbienteDaObra(o.ambiente) && !o.soListar && !(o.referencia ?? '').trim())
    throw new Error(
      'Fora de dev/ci, informe --referencia="<linha de ESTADO.md › Autorizações>" (a autorização do dono).',
    );
}

export async function executarLiberacaoFull(
  o: OpcoesLiberacaoFull,
  porta: PortaLiberacaoFull,
  modo: 'ligar' | 'reverter',
): Promise<RelatorioFull> {
  conferirOpcoes(o);
  const cls = classificarChavesFull({
    ambiente: o.ambiente,
    recursos: RECURSOS_DESLIGADOS.map((r) => r.chave),
    operacoes: o.operacoes,
    incluir: o.incluir,
  });
  const hospitais: RelatorioHospitalFull[] = [];
  for (const h of o.hospitais)
    hospitais.push(
      modo === 'reverter'
        ? await reverterNoHospital(o, porta, h)
        : await ligarNoHospital(o, porta, h, cls.ligar),
    );
  return {
    modo: modo === 'reverter' ? 'reverter' : o.soListar ? 'listar' : 'ligar',
    ambiente: o.ambiente,
    excluidas: modo === 'reverter' ? [] : cls.excluidas,
    incluidas: cls.incluidas,
    hospitais,
  };
}

const NOMES_LISTA = {
  'nunca-em-massa': 'nunca em massa',
  'sem-envio-no-dev': 'sem envio no dev',
  'decisao-do-dono': 'decisão do dono em produção',
} as const;

/** O relatório em texto (só chaves e contagens; pendências agrupadas pelo motivo). */
export function relatorioEmTexto(r: RelatorioFull, simulacao: boolean): string {
  const l: string[] = [];
  const titulo = {
    ligar: 'Liberação full',
    listar: 'Liberação full (só o plano, nada gravado)',
    reverter: 'Reversão da liberação full',
  }[r.modo];
  l.push(
    `${titulo}: ambiente ${r.ambiente}${simulacao && r.modo === 'reverter' ? ' (só o plano, nada gravado)' : ''}`,
  );
  if (r.excluidas.length) {
    l.push(`Excluídas (${r.excluidas.length}):`);
    for (const e of r.excluidas) l.push(`  - ${e.tipo}:${e.chave} [${NOMES_LISTA[e.lista]}] ${e.motivo}`);
  }
  if (r.incluidas.length) l.push(`Incluídas por decisão do dono: ${r.incluidas.join(', ')}`);
  // O valor dos testes pós-implantação que bate com esta liberação (a incluída já saiu da lista).
  if (r.modo !== 'reverter' && r.excluidas.length)
    l.push(
      `Testes pós-implantação (sante.env): IMPLANTACAO_CHAVES_ESPERADAS=todas-exceto:${[...new Set(r.excluidas.map((e) => e.chave))].join(',')}`,
    );
  for (const h of r.hospitais) {
    l.push(`[${h.hospital}]`);
    if (h.recusa) {
      l.push(`  RECUSADO: ${h.recusa}`);
      continue;
    }
    if (r.modo === 'reverter')
      l.push(
        `  lotes revertidos: ${h.revertidos}; pré-requisitos devolvidos ao registro de antes: ${h.prerequisitosGravados}`,
      );
    else {
      const porTipo = (xs: readonly ChaveFull[], t: string) => xs.filter((x) => x.tipo === t).length;
      l.push(
        `  ligadas: ${h.ligadas.length} (recurso ${porTipo(h.ligadas, 'recurso')}, operação ${porTipo(h.ligadas, 'operacao')}); já ligadas: ${h.jaLigadas.length}; linhas específicas desligadas que passaram a herdar: ${h.especificasHerdando}`,
      );
      if (h.aguardandoCatalogo.length)
        l.push(
          `  operações à espera do catálogo \`liberada\` (o comando não promove o catálogo): ${h.aguardandoCatalogo.length}`,
        );
      l.push(
        `  pré-requisitos: ${h.prerequisitosGravados} dispensado(s) agora; ${h.prerequisitosEmDia} já em dia; ${h.prerequisitosPendentes.length} pendente(s)`,
      );
      for (const p of h.prerequisitosPendentes)
        l.push(`    - ${p.chave} (${p.tipoPrerequisito}): ${p.motivo}`);
    }
    if (h.pendentes.length) {
      l.push(`  pendentes (${h.pendentes.length}):`);
      const grupos = new Map<string, string[]>();
      for (const p of h.pendentes)
        grupos.set(p.motivo, [...(grupos.get(p.motivo) ?? []), `${p.tipo}:${p.chave}`]);
      for (const [motivo, ks] of grupos) {
        const mostrar = ks.length > 12 ? [...ks.slice(0, 12), `… e mais ${ks.length - 12}`] : ks;
        l.push(`    - ${motivo}`);
        l.push(`      ${mostrar.join(', ')}`);
      }
    }
  }
  if (r.modo !== 'listar' && !simulacao)
    l.push(
      'Cache: as telas já abertas veem a mudança em até 300 s (o cache da configuração não é invalidado pelo terminal); a gravação no banco já vale.',
    );
  return l.join('\n');
}

/**
 * Saída 0 com o relatório (as pendências são esperadas e listadas: a farmácia, os pré-requisitos externos); 2 quando um
 * estabelecimento foi recusado por inteiro (teto de linhas). A falha de partida sai 1.
 */
export const codigoDeSaida = (r: RelatorioFull): number => (r.hospitais.some((h) => h.recusa) ? 2 : 0);
