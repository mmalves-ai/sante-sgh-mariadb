// Consolidação dos avisos, histórico de envio e "meus avisos" na tela (01-ADM L76). O formulário da regra de
// consolidação é conferido ENQUANTO se digita pela mesma regra do servidor (`validarRegraConsolidacao` do domínio);
// editar parte da regra LIDA inteira. O histórico mostra a medição por canal (taxa de leitura e tempo até a leitura) e
// os envios com a situação; "meus avisos" separa o que espera resposta do que já foi lido. Funções puras, sem rede.
import {
  CAMPOS_AGRUPAMENTO,
  type CampoAgrupamento,
  FORMATOS_CONSOLIDACAO,
  MENSAGEM_NOTIFICACAO,
  validarRegraConsolidacao,
} from '@sgh/dominio-acesso/autorizacao';
import type { EnvioNotificacao, PainelNotificacao } from './api-notificacao-regras.js';

export { CAMPOS_AGRUPAMENTO, FORMATOS_CONSOLIDACAO };
export type ConsolidacaoLida = PainelNotificacao['consolidacoes'][number];

export interface FormConsolidacao {
  id: number | null;
  versao: number | null;
  codigo: string;
  nome: string;
  janelaMinutos: string;
  campos: CampoAgrupamento[];
  comLimite: boolean;
  limitePorUsuario: string;
  periodoLimiteMinutos: string;
  horarioResumo: string;
  formato: (typeof FORMATOS_CONSOLIDACAO)[number];
  ativo: boolean;
}

export const formConsolidacaoNova = (): FormConsolidacao => ({
  id: null,
  versao: null,
  codigo: '',
  nome: '',
  janelaMinutos: '60',
  campos: ['regra', 'paciente'],
  comLimite: false,
  limitePorUsuario: '',
  periodoLimiteMinutos: '',
  horarioResumo: '',
  formato: 'lista',
  ativo: true,
});

export function formDaConsolidacao(c: ConsolidacaoLida): FormConsolidacao {
  return {
    id: c.id,
    versao: c.versao,
    codigo: c.codigo,
    nome: c.nome,
    janelaMinutos: String(c.janelaMinutos),
    campos: c.campos.filter((x): x is CampoAgrupamento =>
      (CAMPOS_AGRUPAMENTO as readonly string[]).includes(x),
    ),
    comLimite: c.limitePorUsuario !== null,
    limitePorUsuario: c.limitePorUsuario === null ? '' : String(c.limitePorUsuario),
    periodoLimiteMinutos: c.periodoLimiteMinutos === null ? '' : String(c.periodoLimiteMinutos),
    horarioResumo: c.horarioResumo ?? '',
    formato: c.formato === 'contagem' ? 'contagem' : 'lista',
    ativo: c.ativo,
  };
}

/** Texto do campo numérico: vazio é nulo; o que não é inteiro vira NaN (a regra do domínio recusa). */
const inteiro = (s: string): number | null =>
  s.trim() === '' ? null : /^\d+$/.test(s.trim()) ? Number(s) : NaN;

export function corpoDaConsolidacao(f: FormConsolidacao): Record<string, unknown> {
  return {
    ...(f.id !== null ? { id: f.id, versao: f.versao } : {}),
    codigo: f.codigo.trim(),
    nome: f.nome.trim(),
    janelaMinutos: inteiro(f.janelaMinutos) ?? NaN,
    campos: [...f.campos],
    limitePorUsuario: f.comLimite ? inteiro(f.limitePorUsuario) : null,
    periodoLimiteMinutos: f.comLimite ? inteiro(f.periodoLimiteMinutos) : null,
    horarioResumo: f.horarioResumo.trim() === '' ? null : f.horarioResumo.trim(),
    formato: f.formato,
    ativo: f.ativo,
  };
}

/** A pendência do formulário (a mesma regra do servidor) ou null quando pode gravar. */
export function conferirConsolidacao(f: FormConsolidacao): string | null {
  const c = corpoDaConsolidacao(f);
  const r = validarRegraConsolidacao({
    codigo: String(c['codigo']),
    nome: String(c['nome']),
    janelaMinutos: Number(c['janelaMinutos']),
    campos: f.campos,
    limitePorUsuario: c['limitePorUsuario'] as number | null,
    periodoLimiteMinutos: c['periodoLimiteMinutos'] as number | null,
    horarioResumo: c['horarioResumo'] as string | null,
    formato: f.formato,
  });
  return r === null ? null : MENSAGEM_NOTIFICACAO[r];
}

/** Marca ou desmarca um campo de agrupamento, mantendo a ordem padrão. */
export function alternarCampo(campos: readonly CampoAgrupamento[], c: CampoAgrupamento): CampoAgrupamento[] {
  const tem = campos.includes(c);
  return CAMPOS_AGRUPAMENTO.filter((x) => (x === c ? !tem : campos.includes(x)));
}

/** Os avisos que esperam resposta do destinatário (ainda não lidos e não cancelados) primeiro, depois os demais. */
export const SITUACOES_SEM_RESPOSTA = ['entregue', 'enviado', 'capturado'] as const;
export function separarMeusEnvios(envios: readonly EnvioNotificacao[]): {
  aResponder: EnvioNotificacao[];
  respondidos: EnvioNotificacao[];
} {
  const aResponder = envios.filter(
    (e) => e.lidoEm === null && (SITUACOES_SEM_RESPOSTA as readonly string[]).includes(e.situacao),
  );
  return { aResponder, respondidos: envios.filter((e) => !aResponder.includes(e)) };
}

/** Percentual com uma casa (ou traço quando não há base). */
export const percentual = (v: number | null): string =>
  v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

/** Data e hora curtas (dd/mm hh:mm) do instante ISO, no fuso do navegador; traço quando nulo. */
export function quando(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
