// Envio agendado de relatório (M34; ficha, regra 5; cap-07 §7.5 e §7.5.1): o e-mail leva só o LINK autenticado do
// relatório (quem abre entra no sistema e precisa da permissão do relatório; nunca o arquivo nem os dados); a falha é
// registrada, conta as seguidas e alerta o dono do envio (o legado acumulou 2.600 "não enviado" sem ninguém saber);
// fora de produção, o e-mail só vai ao coletor local. As horas são do relógio de parede (os campos UTC do Date
// carregam a hora local, como no banco). Regras puras.
import type { Periodicidade } from '@sgh/contratos';

export interface Agenda {
  readonly periodicidade: Periodicidade;
  /** HHMM. */
  readonly hora: number;
  /** 1 (segunda) a 7 (domingo), no semanal. */
  readonly diaSemana: number | null;
  /** 1 a 28, no mensal. */
  readonly diaMes: number | null;
}

/** O próximo envio estritamente depois de `depoisDe` (relógio de parede). */
export function proximoEnvio(a: Agenda, depoisDe: Date): Date {
  const h = Math.floor(a.hora / 100);
  const m = a.hora % 100;
  if (h > 23 || m > 59) throw new Error('Hora do envio inválida.');
  const base = new Date(
    Date.UTC(depoisDe.getUTCFullYear(), depoisDe.getUTCMonth(), depoisDe.getUTCDate(), h, m, 0),
  );
  if (a.periodicidade === 'diaria') {
    return base.getTime() > depoisDe.getTime() ? base : new Date(base.getTime() + 86_400_000);
  }
  if (a.periodicidade === 'semanal') {
    if (!a.diaSemana || a.diaSemana < 1 || a.diaSemana > 7) throw new Error('Dia da semana inválido.');
    // getUTCDay: 0 domingo … 6 sábado → 1 segunda … 7 domingo.
    for (let i = 0; i <= 7; i++) {
      const c = new Date(base.getTime() + i * 86_400_000);
      const dow = c.getUTCDay() === 0 ? 7 : c.getUTCDay();
      if (dow === a.diaSemana && c.getTime() > depoisDe.getTime()) return c;
    }
    throw new Error('Sem próximo envio semanal.');
  }
  if (!a.diaMes || a.diaMes < 1 || a.diaMes > 28) throw new Error('Dia do mês inválido (1 a 28).');
  for (let i = 0; i <= 2; i++) {
    const c = new Date(Date.UTC(depoisDe.getUTCFullYear(), depoisDe.getUTCMonth() + i, a.diaMes, h, m, 0));
    if (c.getTime() > depoisDe.getTime()) return c;
  }
  throw new Error('Sem próximo envio mensal.');
}

/** O link autenticado do relatório com os parâmetros do envio (abre a tela do catálogo, que pede entrar). */
export function linkDoRelatorio(
  baseWeb: string,
  codigo: string,
  parametros: Readonly<Record<string, string | number>>,
): string {
  const u = new URL('/relatorios', baseWeb);
  u.searchParams.set('relatorio', codigo);
  for (const [k, v] of Object.entries(parametros).sort(([a], [b]) => a.localeCompare(b)))
    u.searchParams.set(`p.${k}`, String(v));
  return u.toString();
}

export interface MensagemDoEnvio {
  readonly assunto: string;
  readonly texto: string;
}

/** O e-mail do envio: título, o link e o aviso de que é preciso entrar (nunca o arquivo, nunca os dados). */
export function mensagemDoEnvio(c: {
  readonly titulo: string;
  readonly relatorio: string;
  readonly link: string;
  readonly produto: string;
  readonly estabelecimento: string;
}): MensagemDoEnvio {
  return {
    assunto: `${c.titulo} (${c.estabelecimento})`,
    texto: [
      `O relatório "${c.relatorio}" está disponível no ${c.produto}.`,
      '',
      `Abrir: ${c.link}`,
      '',
      'Para ver o resultado é preciso entrar com o seu usuário e ter a permissão do relatório.',
      'Este e-mail não leva o arquivo nem os dados do relatório.',
    ].join('\n'),
  };
}

/** A mensagem do alerta de falha ao dono do envio (só o título, a contagem e o motivo técnico curto). */
export function mensagemDeFalha(c: {
  readonly titulo: string;
  readonly falhasSeguidas: number;
  readonly motivo: string;
  readonly estabelecimento: string;
}): MensagemDoEnvio {
  return {
    assunto: `Falha no envio agendado: ${c.titulo} (${c.estabelecimento})`,
    texto: [
      `O envio agendado "${c.titulo}" falhou ${c.falhasSeguidas === 1 ? 'uma vez' : `${c.falhasSeguidas} vezes seguidas`}.`,
      `Motivo: ${c.motivo.slice(0, 200)}`,
      '',
      'Confira em Relatórios e BI > Envio agendado por e-mail.',
    ].join('\n'),
  };
}

/** Depois do envio: zera as falhas no sucesso; na falha, soma e alerta o dono (toda falha alerta). */
export function depoisDoEnvio(
  falhasSeguidas: number,
  ok: boolean,
): { falhasSeguidas: number; situacao: 'enviado' | 'falhou'; alertarDono: boolean } {
  return ok
    ? { falhasSeguidas: 0, situacao: 'enviado', alertarDono: false }
    : { falhasSeguidas: falhasSeguidas + 1, situacao: 'falhou', alertarDono: true };
}
