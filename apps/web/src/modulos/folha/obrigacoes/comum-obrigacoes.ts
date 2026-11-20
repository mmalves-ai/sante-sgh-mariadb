// Comuns da tela das obrigações legais (M53.8, etapa F7): os períodos que a tela oferece por tipo (competências mensais
// ou anos-base), o período sugerido (o último exigido pelo regime gravado, sem passar do sugerido pelo servidor), o
// rótulo do período, o regime em vigor no período, o formulário dos parâmetros (a partir da vigência em vigor ou da
// sugestão com as fontes) e a entrada conferida no contrato, a entrega (valores em reais → centavos) e as ações que a
// situação da obrigação libera. O servidor confere tudo de novo.
import {
  APURACAO_DA_OBRIGACAO,
  esquemaParametrosObrigacoes,
  esquemaRegistrarEntregaObrigacao,
  type ObrigacaoLegal,
  type ParametrosObrigacoes,
  type ParametrosObrigacoesLidos,
  type RegimeObrigacao,
  type RegistrarEntregaObrigacaoEntrada,
  TIPOS_OBRIGACAO,
  type TipoObrigacao,
} from '@sgh/contratos';
import { competenciaDoPeriodo, obrigacaoExigida, parametrosObrigacoesNa } from '@sgh/dominio-pessoas';
import { competenciasAte, rotuloCompetencia } from '../comum-folha.js';

/** Os tipos da aba dos arquivos (o FGTS Digital tem aba própria). */
export const TIPOS_ARQUIVO = TIPOS_OBRIGACAO.filter((t) => t !== 'fgts-digital');

export const anual = (tipo: TipoObrigacao) => APURACAO_DA_OBRIGACAO[tipo] === 'anual';

/**
 * Os períodos que a tela oferece até `ate` (AAAA-MM ou AAAA): 12 anos de competências ou 15 anos-base. A SEFIP, o CAGED
 * e a RAIS são de períodos antigos (até a substituição pelo eSocial), por isso a lista vai longe; a seleção tem busca.
 */
export function periodosDoTipo(tipo: TipoObrigacao, ate: string): string[] {
  if (anual(tipo)) {
    const a = Number(ate.slice(0, 4));
    return Array.from({ length: 15 }, (_, i) => String(a - i));
  }
  const fim = ate.length === 4 ? `${ate}-12` : ate.slice(0, 7);
  return competenciasAte(`${fim}-01`, 12 * 12);
}

/** 2026-09 → 09/2026; o ano-base fica como está. */
export const rotuloPeriodoObrigacao = (tipo: TipoObrigacao, periodo: string) =>
  anual(tipo) ? periodo : rotuloCompetencia(periodo);

/** A vigência dos parâmetros em vigor no período (a mais recente que já começou na competência do período). */
export const vigenciaNoPeriodo = (
  vs: readonly ParametrosObrigacoesLidos[],
  empresa: number,
  tipo: TipoObrigacao,
  periodo: string,
): ParametrosObrigacoesLidos | null =>
  parametrosObrigacoesNa(vs, empresa, competenciaDoPeriodo(tipo, periodo));

/** O regime do tipo em vigor no período e se ele exige a obrigação ali (nulo sem parâmetros em vigor). */
export function regimeNoPeriodo(
  vs: readonly ParametrosObrigacoesLidos[],
  empresa: number,
  tipo: TipoObrigacao,
  periodo: string,
): { regime: RegimeObrigacao; exigida: boolean } | null {
  const v = vigenciaNoPeriodo(vs, empresa, tipo, periodo);
  if (!v) return null;
  const regime = v.regimes[tipo];
  return { regime, exigida: obrigacaoExigida(regime, tipo, periodo) };
}

/**
 * O período que a tela sugere para o tipo: o sugerido pelo servidor (a competência anterior à de hoje, ou o ano-base
 * anterior), puxado para trás até o fim do regime quando a obrigação já foi substituída (a SEFIP até 02/2024…).
 */
export function periodoSugeridoObrigacao(
  tipo: TipoObrigacao,
  sugestao: { competencia: string; ano: string },
  regime: RegimeObrigacao | null,
): string {
  const base = anual(tipo) ? sugestao.ano : sugestao.competencia;
  const ate = regime?.exigidaAte;
  if (!ate) return base;
  const limite = anual(tipo) ? ate.slice(0, 4) : ate.length === 4 ? `${ate}-12` : ate;
  return limite < base ? limite : base;
}

// ── Parâmetros ────────────────────────────────────────────────────────────────────────────────────────────────

/** O regime no formulário: os limites em texto ('' = sem limite). */
export interface FormRegime {
  exigidaDe: string;
  exigidaAte: string;
  leiaute: string;
  leiauteConferido: boolean;
}
export interface FormParametrosObrigacoes {
  inicio: string;
  razaoSocial: string;
  logradouro: string;
  bairro: string;
  cep: string;
  cidade: string;
  uf: string;
  municipio: string;
  contatoNome: string;
  telefone: string;
  email: string;
  naturezaJuridica: string;
  codigoRecolhimentoSefip: string;
  codigoPagamentoGps: string;
  regimes: Record<TipoObrigacao, FormRegime>;
}

const formRegime = (r: RegimeObrigacao): FormRegime => ({
  exigidaDe: r.exigidaDe ?? '',
  exigidaAte: r.exigidaAte ?? '',
  leiaute: r.leiaute,
  leiauteConferido: r.leiauteConferido,
});

/** Os regimes da sugestão no formulário (os leiautes nascem não conferidos). */
export const regimesDaSugestao = (
  sugeridos: Readonly<Record<TipoObrigacao, RegimeObrigacao>>,
): Record<TipoObrigacao, FormRegime> =>
  Object.fromEntries(TIPOS_OBRIGACAO.map((t) => [t, formRegime(sugeridos[t])])) as Record<
    TipoObrigacao,
    FormRegime
  >;

/** O formulário de uma vigência nova: a partir da em vigor (a correção) ou, sem ela, da sugestão. */
export function formDosParametros(
  atual: ParametrosObrigacoes | null,
  sugeridos: Readonly<Record<TipoObrigacao, RegimeObrigacao>>,
  inicio: string,
): FormParametrosObrigacoes {
  return {
    inicio,
    razaoSocial: atual?.razaoSocial ?? '',
    logradouro: atual?.endereco.logradouro ?? '',
    bairro: atual?.endereco.bairro ?? '',
    cep: atual?.endereco.cep ?? '',
    cidade: atual?.endereco.cidade ?? '',
    uf: atual?.endereco.uf ?? '',
    municipio: atual?.endereco.municipio ?? '',
    contatoNome: atual?.contato.nome ?? '',
    telefone: atual?.contato.telefone ?? '',
    email: atual?.contato.email ?? '',
    naturezaJuridica: atual?.naturezaJuridica ?? '',
    codigoRecolhimentoSefip: atual?.codigoRecolhimentoSefip ?? '115',
    codigoPagamentoGps: atual?.codigoPagamentoGps ?? '2100',
    regimes: atual
      ? (Object.fromEntries(TIPOS_OBRIGACAO.map((t) => [t, formRegime(atual.regimes[t])])) as Record<
          TipoObrigacao,
          FormRegime
        >)
      : regimesDaSugestao(sugeridos),
  };
}

const so = (s: string) => s.replace(/[.\-/\s()]/g, '');
const limite = (s: string) => (s.trim() ? s.trim() : null);

/** O formulário como entrada do contrato (limpa máscara de CEP e telefone; limite vazio vira nulo). */
export function entradaDosParametros(empresa: number, f: FormParametrosObrigacoes): unknown {
  return {
    empresa,
    inicio: f.inicio,
    razaoSocial: f.razaoSocial,
    endereco: {
      logradouro: f.logradouro,
      bairro: f.bairro,
      cep: so(f.cep),
      cidade: f.cidade,
      uf: f.uf.trim().toUpperCase(),
      municipio: so(f.municipio),
    },
    contato: { nome: f.contatoNome, telefone: so(f.telefone), email: f.email.trim() },
    naturezaJuridica: so(f.naturezaJuridica),
    codigoRecolhimentoSefip: so(f.codigoRecolhimentoSefip),
    codigoPagamentoGps: so(f.codigoPagamentoGps),
    regimes: Object.fromEntries(
      TIPOS_OBRIGACAO.map((t) => {
        const r = f.regimes[t];
        return [
          t,
          {
            exigidaDe: limite(r.exigidaDe),
            exigidaAte: limite(r.exigidaAte),
            leiaute: r.leiaute,
            leiauteConferido: r.leiauteConferido,
          },
        ];
      }),
    ),
  };
}

/** A entrada conferida no contrato e os campos inválidos (o primeiro trecho do caminho, para a tela nomear). */
export function conferirFormParametros(
  empresa: number,
  f: FormParametrosObrigacoes,
): { ok: true; dados: ParametrosObrigacoes } | { ok: false; campos: string[] } {
  const r = esquemaParametrosObrigacoes.safeParse(entradaDosParametros(empresa, f));
  if (r.success) return { ok: true, dados: r.data };
  const campos = r.error.issues.map((i) =>
    i.path[0] === 'regimes' ? `regimes.${String(i.path[1])}` : String(i.path[1] ?? i.path[0] ?? ''),
  );
  return { ok: false, campos: [...new Set(campos)] };
}

// ── Entrega ───────────────────────────────────────────────────────────────────────────────────────────────────

/** "1.234,56", "1234,56" ou "1234.56" → 123456 centavos; vazio → null; inválido → NaN. */
export function centavosDe(texto: string): number | null {
  const s = texto.trim().replace(/^R\$\s*/, '');
  if (!s) return null;
  const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return Number.NaN;
  return Math.round(Number(normal) * 100);
}

export interface FormEntrega {
  protocolo: string;
  data: string | null;
  valorGuia: string;
  acrescimos: string;
}

/** A entrada da entrega: no FGTS Digital, o valor da guia e os acréscimos; nos arquivos, nulos. */
export function entradaEntrega(
  o: Pick<ObrigacaoLegal, 'tipo' | 'versao'>,
  f: FormEntrega,
): { ok: true; dados: RegistrarEntregaObrigacaoEntrada } | { ok: false; campos: string[] } {
  const fgts = o.tipo === 'fgts-digital';
  const r = esquemaRegistrarEntregaObrigacao.safeParse({
    versao: o.versao,
    protocolo: f.protocolo,
    data: f.data ?? '',
    valorGuia: fgts ? centavosDe(f.valorGuia) : null,
    acrescimos: fgts ? (centavosDe(f.acrescimos) ?? 0) : null,
  });
  if (r.success) return { ok: true, dados: r.data };
  return { ok: false, campos: [...new Set(r.error.issues.map((i) => String(i.path[0] ?? '')))] };
}

/** O que a situação libera para quem tem `pessoas.obrigacao.gerar` (o servidor confere de novo). */
export function acoesDaObrigacao(
  o: Pick<ObrigacaoLegal, 'situacao' | 'leiauteConferido'>,
  pode: boolean,
): { baixar: boolean; entregar: boolean; cancelar: boolean } {
  const gerada = o.situacao === 'gerada';
  return {
    baixar: pode && (gerada || o.situacao === 'entregue'),
    entregar: pode && gerada && o.leiauteConferido,
    cancelar: pode && gerada,
  };
}
