// W0-08, parte 9b (mercado M3: treinamento dos operadores e ciclo de vida; RDC 509/2021, arts. 8º, 15 e 16): as regras
// puras do domínio entregues à gravação do legado como callback (o legado não importa o domínio) e a montagem do índice
// de obsolescência a partir das leituras da porta.
import type {
  AtividadePlano,
  ClasseRisco,
  ConclusaoDeCurso,
  CriticidadeEquipamento,
  CursoDoModelo,
  EventoCicloVida,
  IndiceObsolescencia,
  RecusaCicloVida,
  ResultadoExecucao,
  SituacaoEquipamento,
  TipoEquipamento,
  TipoEventoCiclo,
  UnidadePeriodicidade,
} from '@sgh/contratos';
import {
  conferirEventoCiclo,
  indiceObsolescencia,
  JANELA_OBSOLESCENCIA_MESES,
  mesesCompletos,
  normalizarModelo,
  operadoresDoModelo,
} from '@sgh/dominio-manutencao';
import type { ModeloDoPgts, PgtsParaDocumento } from './documentos.js';

/** A chave do modelo (fabricante + modelo normalizados); nula sem fabricante ou modelo. */
export function chaveDoModelo(
  fabricante: string | null | undefined,
  modelo: string | null | undefined,
): { fabricante: string; modelo: string } | null {
  const f = normalizarModelo(fabricante ?? '');
  const m = normalizarModelo(modelo ?? '');
  return f && m ? { fabricante: f, modelo: m } : null;
}

/** O evento novo conferido contra os já registrados, com o dia de hoje do banco. */
export const conferirEvento =
  (novo: { tipo: TipoEventoCiclo; data: string }) =>
  (existentes: readonly EventoCicloVida[], hoje: string): RecusaCicloVida | null =>
    conferirEventoCiclo(existentes, novo, hoje);

/** O dia `meses` meses antes de `data` (AAAA-MM-DD), no último dia do mês quando o dia não existe. */
export function mesesAntes(data: string, meses: number): string {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  const total = a * 12 + (m - 1) - meses;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${ano}-${p2(mes)}-${p2(Math.min(d, ultimo))}`;
}

/** A janela do índice (os últimos 12 meses até hoje). */
export const inicioDaJanela = (hoje: string) => mesesAntes(hoje, JANELA_OBSOLESCENCIA_MESES);

/**
 * O índice de obsolescência: a idade conta da incorporação registrada, senão da instalação, senão da aquisição do bem
 * ligado; a vida útil é a do bem ligado, senão o parâmetro; o custo é sobre o valor do bem (sem bem, sem base).
 */
export function montarIndice(x: {
  readonly hoje: string;
  readonly eventos: readonly EventoCicloVida[];
  readonly instalacao: string | null;
  readonly bem: {
    readonly dataAquisicao: string;
    readonly vidaUtilMeses: number;
    readonly valorCent: number;
  } | null;
  readonly vidaUtilPadraoMeses: number;
  readonly base: { readonly custoCent: number; readonly corretivas: number };
}): IndiceObsolescencia {
  const incorporacao = x.eventos.find((e) => e.tipo === 'incorporacao')?.data ?? null;
  const inicio = incorporacao ?? x.instalacao ?? x.bem?.dataAquisicao ?? null;
  return indiceObsolescencia({
    idadeMeses: inicio ? mesesCompletos(inicio.slice(0, 10), x.hoje) : null,
    vidaUtilMeses: x.bem && x.bem.vidaUtilMeses > 0 ? x.bem.vidaUtilMeses : x.vidaUtilPadraoMeses,
    custoCent: x.base.custoCent,
    valorCent: x.bem ? x.bem.valorCent : null,
    corretivas: x.base.corretivas,
  });
}

/** O equipamento como a porta o lê (só o que o PGTS imprime). */
interface EquipamentoDoCadastro {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: TipoEquipamento;
  readonly criticidade: CriticidadeEquipamento;
  readonly classeRisco: ClasseRisco | null;
  readonly fabricante: string | null;
  readonly modelo: string | null;
  readonly numeroSerie: string | null;
  readonly registroAnvisa: string | null;
  readonly centroCusto: number;
  readonly situacao: SituacaoEquipamento;
}

/**
 * Os dados do PGTS (RDC 509/2021) a partir das leituras: o descartado sai do inventário, do índice, da contagem por
 * modelo e dos planos, e fica só no ciclo de vida; o treinamento por modelo conta os aptos e os pendentes pelos cursos
 * ativos exigidos; os eventos vão na ordem da data.
 */
export function montarPgts(x: {
  readonly hoje: string;
  readonly equipamentos: readonly EquipamentoDoCadastro[];
  readonly ciclo: ReadonlyMap<
    number,
    { readonly indice: IndiceObsolescencia; readonly eventos: readonly EventoCicloVida[] }
  >;
  readonly setor: (centroCusto: number) => string;
  readonly cursos: readonly CursoDoModelo[];
  readonly conclusoes: readonly ConclusaoDeCurso[];
  readonly planos: readonly {
    readonly equipamento: number;
    readonly atividade: AtividadePlano;
    readonly periodicidade: { readonly quantidade: number; readonly unidade: UnidadePeriodicidade };
    readonly ativo: boolean;
    readonly ultimaExecucao: string | null;
    readonly ultimoResultado: ResultadoExecucao | null;
  }[];
  readonly emissao: {
    readonly estabelecimento: string;
    readonly emitidoEm: string;
    readonly emitidoPor: string;
  };
}): PgtsParaDocumento {
  const equipamentos = [...x.equipamentos].sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR'));
  const descartado = (id: number) => x.ciclo.get(id)?.eventos.some((e) => e.tipo === 'descarte') ?? false;
  const nomeDe = new Map(equipamentos.map((e) => [e.id, `${e.codigo} ${e.nome}`]));
  const porModelo = new Map<string, CursoDoModelo[]>();
  for (const c of x.cursos) {
    const k = `${c.fabricante}\u0000${c.modelo}`;
    porModelo.set(k, [...(porModelo.get(k) ?? []), c]);
  }
  const modelos: ModeloDoPgts[] = [...porModelo.values()].map((cs) => {
    const { fabricante, modelo } = cs[0] as CursoDoModelo;
    const ops = operadoresDoModelo(cs, x.conclusoes, x.hoje);
    return {
      fabricante,
      modelo,
      equipamentos: equipamentos.filter((e) => {
        const k = chaveDoModelo(e.fabricante, e.modelo);
        return !descartado(e.id) && k?.fabricante === fabricante && k.modelo === modelo;
      }).length,
      cursos: cs
        .filter((c) => c.cursoAtivo)
        .map((c) => ({ codigo: c.cursoCodigo, titulo: c.cursoTitulo, validadeMeses: c.validadeMeses })),
      aptos: ops.aptos.length,
      pendentes: ops.pendentes.length,
    };
  });
  return {
    equipamentos: equipamentos.map((e) => ({
      codigo: e.codigo,
      nome: e.nome,
      tipo: e.tipo,
      criticidade: e.criticidade,
      classeRisco: e.classeRisco,
      fabricante: e.fabricante,
      modelo: e.modelo,
      numeroSerie: e.numeroSerie,
      registroAnvisa: e.registroAnvisa,
      setor: x.setor(e.centroCusto),
      situacao: e.situacao,
      indice: descartado(e.id) ? null : (x.ciclo.get(e.id)?.indice ?? null),
    })),
    modelos,
    eventos: equipamentos
      .flatMap((e) =>
        (x.ciclo.get(e.id)?.eventos ?? []).map((v) => ({
          equipamento: nomeDe.get(e.id) ?? '',
          tipo: v.tipo,
          data: v.data,
          motivo: v.motivo,
          documento: v.documento,
          destino: v.destino,
          autorizadoPor: v.autorizadoPor,
        })),
      )
      .sort((a, b) => a.data.localeCompare(b.data)),
    planos: x.planos
      .filter((p) => nomeDe.has(p.equipamento) && !descartado(p.equipamento))
      .map((p) => ({
        equipamento: nomeDe.get(p.equipamento) ?? '',
        atividade: p.atividade,
        periodicidade: p.periodicidade,
        ativo: p.ativo,
        ultimaExecucao: p.ultimaExecucao,
        ultimoResultado: p.ultimoResultado,
      })),
    ...x.emissao,
  };
}
