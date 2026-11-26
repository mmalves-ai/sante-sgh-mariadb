// Conferência do cadastro do estabelecimento com a base oficial do cadastro nacional (C3-011, 02-CAD linha 29).
// Função pura: recebe o cadastro local vigente na competência e o que a base oficial da mesma competência tem para o
// número nacional do estabelecimento, e devolve as críticas (categoria e gravidade dentro do que a remessa aceita).
// A prática de mercado é a mesma da conferência mensal antes do faturamento SUS: o que o hospital fatura tem de estar
// habilitado e cadastrado na base nacional da competência, senão o gestor glosa.
import { normalHabilitacao } from './estabelecimento-sus.js';

export const CATEGORIAS_CRITICA_CNES = [
  'profissional',
  'cartao_saude',
  'carga_horaria',
  'vinculo',
  'estabelecimento',
  'equipamento',
  'leito',
  'servico',
  'equipe',
  'outro',
] as const;
export type CategoriaCriticaCnes = (typeof CATEGORIAS_CRITICA_CNES)[number];
export type GravidadeCriticaCnes = 'erro' | 'alerta' | 'informacao';

export interface CriticaCnes {
  readonly categoria: CategoriaCriticaCnes;
  readonly gravidade: GravidadeCriticaCnes;
  readonly mensagem: string;
}

export interface CadastroLocalParaCnes {
  readonly codigoCnes: string | null;
  readonly cnpj: string | null;
  /** Códigos das habilitações vigentes na competência. */
  readonly habilitacoes: readonly string[];
  /** Serviço e classificação (3 dígitos cada) vigentes na competência. */
  readonly servicos: readonly { servico: string; classificacao: string }[];
}

export interface BaseOficialCnes {
  readonly estabelecimento: { cnpj: string | null; razaoSocial: string } | null;
  readonly habilitacoes: readonly {
    codigo: string;
    competenciaInicio: string | null;
    competenciaFim: string | null;
  }[];
  readonly servicos: readonly { servico: string; classificacao: string }[];
  readonly leitos: readonly { quantidadeExistente: number; quantidadeSus: number }[];
}

const tres = (s: string): string => s.trim().replace(/^\D+/, '').padStart(3, '0').slice(-3);

/** A habilitação da base oficial vale na competência (AAAA-MM-01) pelas competências inicial e final. */
function habilitacaoValeNaCompetencia(
  h: BaseOficialCnes['habilitacoes'][number],
  competencia: string,
): boolean {
  return (
    (h.competenciaInicio === null || h.competenciaInicio <= competencia) &&
    (h.competenciaFim === null || h.competenciaFim >= competencia)
  );
}

/**
 * Compara o cadastro local com a base oficial da competência. Erro: o que o hospital fatura e a base não tem
 * (habilitação ou serviço só no cadastro local; estabelecimento ausente). Alerta: o que a base tem e o cadastro local
 * não (deixa de faturar) e o CNPJ divergente. Informação: os leitos da base oficial, para a conferência do censo.
 */
export function conferirComCadastroNacional(
  local: CadastroLocalParaCnes,
  oficial: BaseOficialCnes,
  competencia: string,
): CriticaCnes[] {
  if (!/^\d{4}-\d{2}-01$/.test(competencia)) throw new Error('competência inválida');
  const c: CriticaCnes[] = [];
  if (!local.codigoCnes || !/^\d{7}$/.test(local.codigoCnes))
    return [
      {
        categoria: 'estabelecimento',
        gravidade: 'erro',
        mensagem:
          'O estabelecimento não tem o número do cadastro nacional (7 dígitos): preencha antes de conferir.',
      },
    ];
  if (!oficial.estabelecimento) {
    c.push({
      categoria: 'estabelecimento',
      gravidade: 'erro',
      mensagem: `O número ${local.codigoCnes} não está na base oficial da competência ${competencia.slice(0, 7)}: confira o número ou carregue a base da competência.`,
    });
    return c;
  }
  const cnpjOficial = oficial.estabelecimento.cnpj?.replace(/\D/g, '') || null;
  const cnpjLocal = local.cnpj?.replace(/\D/g, '') || null;
  if (cnpjOficial && cnpjLocal && cnpjOficial !== cnpjLocal)
    c.push({
      categoria: 'estabelecimento',
      gravidade: 'alerta',
      mensagem: 'O CNPJ do cadastro local é diferente do CNPJ da base oficial.',
    });
  const habOficial = new Set(
    oficial.habilitacoes
      .filter((h) => habilitacaoValeNaCompetencia(h, competencia))
      .map((h) => normalHabilitacao(h.codigo)),
  );
  const habLocal = new Set(local.habilitacoes.map(normalHabilitacao));
  for (const h of [...habLocal].sort((a, b) => Number(a) - Number(b)))
    if (!habOficial.has(h))
      c.push({
        categoria: 'estabelecimento',
        gravidade: 'erro',
        mensagem: `Habilitação ${h.padStart(4, '0')} vigente no cadastro local e ausente da base oficial: a produção que depende dela será glosada.`,
      });
  for (const h of [...habOficial].sort((a, b) => Number(a) - Number(b)))
    if (!habLocal.has(h))
      c.push({
        categoria: 'estabelecimento',
        gravidade: 'alerta',
        mensagem: `Habilitação ${h.padStart(4, '0')} da base oficial ausente do cadastro local: inclua-a para faturar o que ela permite.`,
      });
  const chave = (s: { servico: string; classificacao: string }) =>
    `${tres(s.servico)}/${tres(s.classificacao)}`;
  const srvOficial = new Set(oficial.servicos.map(chave));
  const srvLocal = new Set(local.servicos.map(chave));
  for (const s of [...srvLocal].sort())
    if (!srvOficial.has(s))
      c.push({
        categoria: 'servico',
        gravidade: 'erro',
        mensagem: `Serviço e classificação ${s} no cadastro local e ausentes da base oficial.`,
      });
  for (const s of [...srvOficial].sort())
    if (!srvLocal.has(s))
      c.push({
        categoria: 'servico',
        gravidade: 'alerta',
        mensagem: `Serviço e classificação ${s} da base oficial ausentes do cadastro local.`,
      });
  if (oficial.leitos.length) {
    const ex = oficial.leitos.reduce((a, l) => a + l.quantidadeExistente, 0);
    const sus = oficial.leitos.reduce((a, l) => a + l.quantidadeSus, 0);
    c.push({
      categoria: 'leito',
      gravidade: 'informacao',
      mensagem: `Base oficial: ${ex} leitos existentes, ${sus} para o SUS, em ${oficial.leitos.length} tipos.`,
    });
  }
  return c;
}

/** Resumo da conferência por gravidade, para a remessa e a tela. */
export function resumoCriticasCnes(c: readonly CriticaCnes[]): Record<GravidadeCriticaCnes, number> {
  const r: Record<GravidadeCriticaCnes, number> = { erro: 0, alerta: 0, informacao: 0 };
  for (const x of c) r[x.gravidade]++;
  return r;
}
