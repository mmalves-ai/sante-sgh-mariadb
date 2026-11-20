// Rouparia e lavanderia (M55, fatia F2; ficha, seção 8, regra 4; cap-06a §6.3 "Rouparia"; cap-07 §7.2 "Coleta de
// estatísticas"; manual m18). Regras puras, sem banco nem HTTP:
//   - o que cada movimento pede (setor, peso, peças, envio, lavanderia, motivo), as datas e as peças do cadastro;
//   - a conferência do retorno com o envio: a diferença em kg e em %, as peças que faltam e a ocorrência para o
//     fornecedor quando passa da tolerância;
//   - a estatística de custeio: os kg coletados por setor e por dia, e o total do setor no período com as parcelas
//     (regra 4: "peso por setor e por dia vira estatística de custeio");
//   - os indicadores com as parcelas impressas: kg por paciente-dia, índice de perda e custo por paciente-dia;
//   - a cota do setor: o estimado no setor (último inventário + entregas − peças coletadas − perdas) e a reposição;
//   - o envio atrasado e o cancelamento no prazo (sem exclusão: o movimento fica cancelado, com o motivo).
import {
  type CodigoRecusaRouparia,
  type ConferenciaRetornoRoupa,
  type CotaRoupa,
  type EnvioAberto,
  EXIGENCIAS_MOVIMENTO_ROUPA,
  type IndicadoresRouparia,
  type ItemMovimentoRoupa,
  type KgSetorDia,
  type KgSetorPeriodo,
  MENSAGENS_ROUPARIA,
  type MovimentoRoupa,
  type PecaRoupa,
  type PecaRoupaEntrada,
  type RegistrarMovimentoRoupaEntrada,
  type SituacaoCotaSetor,
} from '@sgh/contratos';

export interface RecusaRouparia {
  readonly codigo: CodigoRecusaRouparia;
  readonly mensagem: string;
  readonly campos?: readonly string[];
}

const recusa = (codigo: CodigoRecusaRouparia, campos?: readonly string[]): RecusaRouparia => ({
  codigo,
  mensagem: MENSAGENS_ROUPARIA[codigo],
  ...(campos ? { campos } : {}),
});

/** Dias para trás aceitos na data do movimento (o registro atrasado de um plantão). */
export const DIAS_RETROATIVOS_ROUPARIA = 31;

const kg3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const dias = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
const fmtKg = (n: number) => kg3(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const fmt2 = (n: number) =>
  r2(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Total de peças do movimento (a soma das quantidades). */
export function totalPecas(itens: readonly ItemMovimentoRoupa[]): number {
  return itens.reduce((s, i) => s + i.quantidade, 0);
}

export interface ContextoMovimentoRoupa {
  /** Hoje no relógio do estabelecimento (AAAA-MM-DD). */
  readonly hoje: string;
  readonly pecasAtivas: ReadonlySet<number>;
  readonly setoresAtivos: ReadonlySet<number>;
  /** O envio relido na transação (só no retorno). */
  readonly remessa?: Pick<MovimentoRoupa, 'tipo' | 'situacao' | 'data'> | null;
  /** O fornecedor existe no cadastro (só na lavanderia terceirizada). */
  readonly fornecedorExiste?: boolean;
}

/** As recusas do movimento, na ordem dos campos da tela (vazio: pode gravar). */
export function conferirMovimentoRoupa(
  e: RegistrarMovimentoRoupaEntrada,
  c: ContextoMovimentoRoupa,
): RecusaRouparia[] {
  const x = EXIGENCIAS_MOVIMENTO_ROUPA[e.tipo];
  const r: RecusaRouparia[] = [];
  if (e.data > c.hoje) r.push(recusa('data-futura', ['data']));
  else if (dias(e.data, c.hoje) > DIAS_RETROATIVOS_ROUPARIA) r.push(recusa('data-antiga', ['data']));
  if (x.setor === 'obrigatorio' && e.centroCusto === null)
    r.push(recusa('setor-obrigatorio', ['centroCusto']));
  if (x.setor === 'proibido' && e.centroCusto !== null)
    r.push(recusa('setor-nao-se-aplica', ['centroCusto']));
  if (e.centroCusto !== null && x.setor !== 'proibido' && !c.setoresAtivos.has(e.centroCusto))
    r.push(recusa('setor-inativo', ['centroCusto']));
  if (x.peso === 'obrigatorio' && e.pesoKg === null) r.push(recusa('peso-obrigatorio', ['pesoKg']));
  if (x.pecas === 'obrigatorio' && e.itens.length === 0) r.push(recusa('pecas-obrigatorias', ['itens']));
  const vistas = new Set<number>();
  for (const i of e.itens) {
    if (vistas.has(i.peca)) {
      r.push(recusa('peca-repetida', ['itens']));
      break;
    }
    vistas.add(i.peca);
  }
  if (e.itens.some((i) => !c.pecasAtivas.has(i.peca))) r.push(recusa('peca-inexistente', ['itens']));
  if (e.tipo !== 'inventario' && e.itens.some((i) => i.quantidade === 0))
    r.push(recusa('quantidade-zero', ['itens']));
  if (x.remessa) {
    const m = c.remessa;
    if (e.remessa === null) r.push(recusa('remessa-obrigatoria', ['remessa']));
    else if (!m || m.tipo !== 'envio') r.push(recusa('remessa-inexistente', ['remessa']));
    else if (m.situacao === 'cancelado') r.push(recusa('remessa-cancelada', ['remessa']));
    else if (m.situacao === 'retornado') r.push(recusa('remessa-ja-retornada', ['remessa']));
    else if (e.data < m.data) r.push(recusa('retorno-antes-do-envio', ['data']));
  }
  if (x.lavanderia) {
    if (e.lavanderia === null) r.push(recusa('lavanderia-obrigatoria', ['lavanderia']));
    else if (e.lavanderia === 'terceirizada' && e.fornecedor === null)
      r.push(recusa('fornecedor-obrigatorio', ['fornecedor']));
  }
  if (e.fornecedor !== null && c.fornecedorExiste === false)
    r.push(recusa('fornecedor-inexistente', ['fornecedor']));
  if (x.motivo && e.motivoPerda === null) r.push(recusa('motivo-obrigatorio', ['motivoPerda']));
  return r;
}

/** O movimento como será gravado: só os campos que o tipo aceita (o resto vira nulo). */
export function normalizarMovimentoRoupa(e: RegistrarMovimentoRoupaEntrada): RegistrarMovimentoRoupaEntrada {
  const x = EXIGENCIAS_MOVIMENTO_ROUPA[e.tipo];
  return {
    ...e,
    centroCusto: x.setor === 'proibido' ? null : e.centroCusto,
    remessa: x.remessa ? e.remessa : null,
    lavanderia: x.lavanderia ? e.lavanderia : null,
    fornecedor: x.lavanderia && e.lavanderia === 'terceirizada' ? e.fornecedor : null,
    motivoPerda: x.motivo ? e.motivoPerda : null,
    itens: [...e.itens].sort((a, b) => a.peca - b.peca),
  };
}

/**
 * A conferência do retorno com o envio (manual m18: "diferença entre envio e retorno acima da tolerância do contrato vira
 * ocorrência para o fornecedor"). A diferença é enviado − retornado (positiva: voltou menos). As peças só entram quando o
 * envio foi contado; a peça que volta a menos é "faltando" (o extravio é registrado como perda, à parte).
 */
export function conferirRetornoRoupa(
  envio: { readonly pesoKg: number; readonly itens: readonly ItemMovimentoRoupa[] },
  retorno: { readonly pesoKg: number; readonly itens: readonly ItemMovimentoRoupa[] },
  toleranciaPct: number,
): ConferenciaRetornoRoupa {
  const diferencaKg = kg3(envio.pesoKg - retorno.pesoKg);
  const diferencaPct = envio.pesoKg > 0 ? r2((diferencaKg / envio.pesoKg) * 100) : 0;
  const voltou = new Map(retorno.itens.map((i) => [i.peca, i.quantidade]));
  const pecasFaltando =
    retorno.itens.length === 0
      ? []
      : envio.itens
          .map((i) => {
            const retornadas = voltou.get(i.peca) ?? 0;
            return { peca: i.peca, enviadas: i.quantidade, retornadas, faltam: i.quantidade - retornadas };
          })
          .filter((i) => i.faltam > 0);
  const motivos: string[] = [];
  if (Math.abs(diferencaPct) > toleranciaPct)
    motivos.push(
      `Diferença de ${fmtKg(diferencaKg)} kg (${fmt2(diferencaPct)}% de ${fmtKg(envio.pesoKg)} kg enviados) acima da tolerância de ${toleranciaPct}%.`,
    );
  if (pecasFaltando.length > 0)
    motivos.push(`${pecasFaltando.reduce((s, i) => s + i.faltam, 0)} peça(s) não voltaram da lavanderia.`);
  return {
    pesoEnviadoKg: kg3(envio.pesoKg),
    pesoRetornadoKg: kg3(retorno.pesoKg),
    diferencaKg,
    diferencaPct,
    toleranciaPct,
    pecasFaltando,
    ocorrencia: motivos.length > 0,
    motivos,
  };
}

/**
 * Regra 4: o peso coletado por setor e por dia (só coletas não canceladas) vira a estatística "kg de roupa" do custeio;
 * o total do setor no período sai com as parcelas por dia.
 */
export function kgPorSetorDia(
  coletas: readonly Pick<MovimentoRoupa, 'tipo' | 'situacao' | 'data' | 'centroCusto' | 'pesoKg'>[],
): KgSetorDia[] {
  const m = new Map<string, { data: string; centroCusto: number; kg: number; coletas: number }>();
  for (const c of coletas) {
    if (c.tipo !== 'coleta' || c.situacao === 'cancelado' || c.centroCusto === null || c.pesoKg === null)
      continue;
    const k = `${c.data}|${c.centroCusto}`;
    const x = m.get(k) ?? { data: c.data, centroCusto: c.centroCusto, kg: 0, coletas: 0 };
    x.kg += c.pesoKg;
    x.coletas += 1;
    m.set(k, x);
  }
  return [...m.values()]
    .map((x) => ({ ...x, kg: kg3(x.kg) }))
    .sort((a, b) => a.data.localeCompare(b.data) || a.centroCusto - b.centroCusto);
}

export function kgPorSetorNoPeriodo(linhas: readonly KgSetorDia[]): KgSetorPeriodo[] {
  const m = new Map<number, { kg: number; coletas: number; dias: { data: string; kg: number }[] }>();
  for (const l of linhas) {
    const x = m.get(l.centroCusto) ?? { kg: 0, coletas: 0, dias: [] };
    x.kg += l.kg;
    x.coletas += l.coletas;
    x.dias.push({ data: l.data, kg: l.kg });
    m.set(l.centroCusto, x);
  }
  return [...m.entries()]
    .map(([centroCusto, x]) => ({
      centroCusto,
      kg: kg3(x.kg),
      coletas: x.coletas,
      dias: [...x.dias].sort((a, b) => a.data.localeCompare(b.data)),
    }))
    .sort((a, b) => b.kg - a.kg || a.centroCusto - b.centroCusto);
}

export interface EntradaIndicadoresRouparia {
  readonly de: string;
  readonly ate: string;
  readonly kgColetados: number;
  readonly kgEnviados: number;
  readonly kgRetornados: number;
  readonly pacientesDia: number;
  readonly pecasPerdidas: number;
  /** Peças em circulação: a soma do último inventário de cada local (setores e rouparia central). */
  readonly pecasEmCirculacao: number;
  readonly precoKgCentavos: number;
  readonly retornos: number;
  readonly ocorrencias: number;
}

/** Os indicadores do manual (m18) com as parcelas impressas; sem denominador, o valor fica nulo. */
export function indicadoresRouparia(e: EntradaIndicadoresRouparia): IndicadoresRouparia {
  const kgPd = e.pacientesDia > 0 ? r2(e.kgColetados / e.pacientesDia) : null;
  const perda = e.pecasEmCirculacao > 0 ? r2((e.pecasPerdidas / e.pecasEmCirculacao) * 100) : null;
  const custoCentavos = Math.round(e.kgEnviados * e.precoKgCentavos);
  const custoPd =
    e.pacientesDia > 0 && e.precoKgCentavos > 0 ? r2(custoCentavos / 100 / e.pacientesDia) : null;
  return {
    de: e.de,
    ate: e.ate,
    kgColetados: kg3(e.kgColetados),
    kgEnviados: kg3(e.kgEnviados),
    kgRetornados: kg3(e.kgRetornados),
    pacientesDia: e.pacientesDia,
    kgPorPacienteDia: {
      valor: kgPd,
      numerador: kg3(e.kgColetados),
      denominador: e.pacientesDia,
      conta:
        kgPd === null
          ? `${fmtKg(e.kgColetados)} kg coletados; sem pacientes-dia no período.`
          : `${fmtKg(e.kgColetados)} kg coletados ÷ ${e.pacientesDia} pacientes-dia = ${fmt2(kgPd)} kg por paciente-dia.`,
    },
    indicePerda: {
      valor: perda,
      numerador: e.pecasPerdidas,
      denominador: e.pecasEmCirculacao,
      conta:
        perda === null
          ? `${e.pecasPerdidas} peças perdidas; sem inventário para as peças em circulação.`
          : `${e.pecasPerdidas} peças perdidas ÷ ${e.pecasEmCirculacao} peças em circulação × 100 = ${fmt2(perda)}%.`,
    },
    custoPorPacienteDia: {
      valor: custoPd,
      numerador: r2(custoCentavos / 100),
      denominador: e.pacientesDia,
      precoKgCentavos: e.precoKgCentavos,
      conta:
        e.precoKgCentavos <= 0
          ? 'Preço do quilo não informado nos parâmetros: o custo fica sem cálculo.'
          : custoPd === null
            ? `${fmtKg(e.kgEnviados)} kg enviados × R$ ${fmt2(e.precoKgCentavos / 100)} = R$ ${fmt2(custoCentavos / 100)}; sem pacientes-dia no período.`
            : `${fmtKg(e.kgEnviados)} kg enviados × R$ ${fmt2(e.precoKgCentavos / 100)} = R$ ${fmt2(custoCentavos / 100)} ÷ ${e.pacientesDia} pacientes-dia = R$ ${fmt2(custoPd)} por paciente-dia.`,
    },
    ocorrencias: e.ocorrencias,
    retornos: e.retornos,
  };
}

/**
 * As peças em circulação: o último inventário (não cancelado) de cada local (o setor ou a rouparia central, setor nulo)
 * e a soma das quantidades.
 */
export function pecasEmCirculacao(
  inventarios: readonly Pick<MovimentoRoupa, 'tipo' | 'situacao' | 'id' | 'data' | 'centroCusto' | 'itens'>[],
): number {
  const ultimo = new Map<string, (typeof inventarios)[number]>();
  for (const i of inventarios) {
    if (i.tipo !== 'inventario' || i.situacao === 'cancelado') continue;
    const k = String(i.centroCusto ?? 'central');
    const u = ultimo.get(k);
    if (!u || i.data > u.data || (i.data === u.data && i.id > u.id)) ultimo.set(k, i);
  }
  return [...ultimo.values()].reduce((s, i) => s + totalPecas(i.itens), 0);
}

/**
 * A cota do setor: o estimado de cada peça no setor é o último inventário do setor mais as entregas menos as peças
 * coletadas e as perdas registradas depois dele (sem inventário, conta desde o zero); a reposição é o que falta para a
 * cota (nunca negativa). Os kits contam pela própria peça do kit.
 */
export function situacaoCotaSetor(
  centroCusto: number,
  cotas: readonly CotaRoupa[],
  movimentos: readonly Pick<MovimentoRoupa, 'tipo' | 'situacao' | 'id' | 'data' | 'centroCusto' | 'itens'>[],
): SituacaoCotaSetor {
  const doSetor = movimentos.filter((m) => m.centroCusto === centroCusto && m.situacao !== 'cancelado');
  const inventario = doSetor
    .filter((m) => m.tipo === 'inventario')
    .reduce<(typeof doSetor)[number] | null>(
      (u, m) => (!u || m.data > u.data || (m.data === u.data && m.id > u.id) ? m : u),
      null,
    );
  const depois = doSetor.filter(
    (m) =>
      m.tipo !== 'inventario' &&
      (!inventario || m.data > inventario.data || (m.data === inventario.data && m.id > inventario.id)),
  );
  const qtd = (ms: readonly (typeof doSetor)[number][], peca: number) =>
    ms.reduce((s, m) => s + (m.itens.find((i) => i.peca === peca)?.quantidade ?? 0), 0);
  const itens = cotas
    .filter((c) => c.centroCusto === centroCusto && c.quantidade > 0)
    .map((c) => {
      const base = inventario?.itens.find((i) => i.peca === c.peca)?.quantidade ?? 0;
      const entregues = qtd(
        depois.filter((m) => m.tipo === 'entrega'),
        c.peca,
      );
      const coletadas = qtd(
        depois.filter((m) => m.tipo === 'coleta'),
        c.peca,
      );
      const perdidas = qtd(
        depois.filter((m) => m.tipo === 'perda'),
        c.peca,
      );
      const estimado = Math.max(0, base + entregues - coletadas - perdidas);
      const reposicao = Math.max(0, c.quantidade - estimado);
      return {
        peca: c.peca,
        cota: c.quantidade,
        estimado,
        reposicao,
        conta: `${inventario ? `inventário ${base}` : 'sem inventário: 0'} + entregues ${entregues} − coletadas ${coletadas} − perdidas ${perdidas} = ${estimado}; cota ${c.quantidade} − ${estimado} = repor ${reposicao}.`,
      };
    })
    .sort((a, b) => a.peca - b.peca);
  return { centroCusto, inventarioEm: inventario?.data ?? null, itens };
}

/** Horas inteiras entre dois instantes locais AAAA-MM-DDTHH:mm[:ss]. */
export function horasEntre(de: string, ate: string): number {
  const ms = (t: string) => Date.parse(`${t.length === 16 ? `${t}:00` : t.slice(0, 19)}Z`);
  return Math.max(0, Math.floor((ms(ate) - ms(de)) / 3_600_000));
}

/** O envio aguardando o retorno, com o atraso pelo prazo (parâmetro `rouparia.prazoRetornoHoras`). */
export function envioAberto(
  m: Pick<MovimentoRoupa, 'id' | 'data' | 'em' | 'pesoKg' | 'pecas' | 'lavanderia' | 'fornecedor'>,
  agora: string,
  prazoHoras: number,
): EnvioAberto {
  const h = horasEntre(m.em, agora);
  return {
    id: m.id,
    data: m.data,
    em: m.em,
    pesoKg: m.pesoKg ?? 0,
    pecas: m.pecas,
    lavanderia: m.lavanderia,
    fornecedor: m.fornecedor,
    horasDesdeEnvio: h,
    atrasado: h > prazoHoras,
  };
}

/** O cancelamento do movimento: só o não cancelado, no prazo, e o envio só sem o retorno (que se cancela antes). */
export function conferirCancelamentoRoupa(
  m: Pick<MovimentoRoupa, 'situacao' | 'tipo' | 'em' | 'versao'> | null,
  c: { readonly agora: string; readonly prazoHoras: number; readonly versaoVista: number },
): RecusaRouparia | null {
  if (!m) return recusa('movimento-inexistente');
  if (m.situacao === 'cancelado') return recusa('movimento-cancelado');
  if (m.versao !== c.versaoVista) return recusa('versao-desatualizada');
  if (m.tipo === 'envio' && m.situacao === 'retornado') return recusa('envio-com-retorno');
  if (horasEntre(m.em, c.agora) > c.prazoHoras) return recusa('fora-do-prazo-de-cancelamento');
  return null;
}

/** A peça ou o kit: nome único entre as ativas e a composição só no kit, só de peças ativas que não são kit. */
export function conferirPecaRoupa(
  e: PecaRoupaEntrada,
  c: { readonly id: number | null; readonly pecas: readonly PecaRoupa[] },
): RecusaRouparia[] {
  const r: RecusaRouparia[] = [];
  const atual = c.id === null ? null : (c.pecas.find((p) => p.id === c.id) ?? null);
  if (c.id !== null && atual && e.versaoVista !== null && atual.versao !== e.versaoVista)
    r.push(recusa('versao-desatualizada'));
  const nome = e.nome.toLocaleUpperCase('pt-BR');
  if (e.ativa && c.pecas.some((p) => p.ativa && p.id !== c.id && p.nome.toLocaleUpperCase('pt-BR') === nome))
    r.push(recusa('nome-duplicado', ['nome']));
  if (e.categoria === 'kit') {
    if (e.composicao.length === 0) r.push(recusa('kit-sem-composicao', ['composicao']));
    const porId = new Map(c.pecas.map((p) => [p.id, p]));
    if (e.composicao.some((i) => porId.get(i.peca)?.categoria === 'kit'))
      r.push(recusa('kit-dentro-de-kit', ['composicao']));
    else if (e.composicao.some((i) => !porId.get(i.peca)?.ativa || i.peca === c.id))
      r.push(recusa('peca-inexistente', ['composicao']));
  } else if (e.composicao.length > 0) r.push(recusa('composicao-so-de-kit', ['composicao']));
  return r;
}
