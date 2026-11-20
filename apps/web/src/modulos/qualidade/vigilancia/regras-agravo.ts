// Regras de tela da notificação compulsória (M48, etapa 4; regras 3 e 8): o texto do prazo, a entrada de cada gravação
// montada e conferida pelos mesmos esquemas da API (o servidor decide; a tela só evita a ida e volta), e o que cada
// situação do caso permite. Funções puras, testadas em regras-agravo.spec.ts.
import {
  type AbrirCasoAgravoEntrada,
  canalExigeNumero,
  type ConfigurarGatilhoExameEntrada,
  type DescartarCasoAgravoEntrada,
  esquemaAbrirCasoAgravo,
  esquemaConfigurarGatilhoExame,
  esquemaDescartarCasoAgravo,
  esquemaRegistrarNotificacaoAgravo,
  type RegistrarNotificacaoAgravoEntrada,
} from '@sgh/contratos';
import type { z } from 'zod';
import { duracaoCurta, instanteDosCampos } from '../regras-qualidade.js';
import type { CasoTela, GatilhoTela } from './api-agravo.js';

export type EstadoPrazo = CasoTela['estadoPrazo'];

/** A classe visual do prazo (vermelho, âmbar, neutro, verde); a cor nunca sozinha (o texto acompanha). */
export function classeDoPrazoAgravo(e: EstadoPrazo): string {
  const mapa: Record<EstadoPrazo, string> = {
    vencido: 'prazo prazo--vencido',
    vencendo: 'prazo prazo--venceEmBreve',
    noPrazo: 'prazo',
    cumprido: 'prazo prazo--cumprido',
    naoSeAplica: 'prazo',
  };
  return mapa[e];
}

/** Horas (com fração) até o prazo a partir do relógio do servidor; negativas depois dele. */
export function horasAte(prazoEm: string, agora: string): number {
  const t = (x: string) => new Date(`${x.length === 16 ? `${x}:00` : x.slice(0, 19)}Z`).getTime();
  return (t(prazoEm) - t(agora)) / 3_600_000;
}

/** "Vence em 3 h 20 min" / "Vencido há 2 d 1 h": a chave do texto e o tempo já formatado. */
export function tempoDoPrazo(horas: number | null): { chave: 'venceEm' | 'vencidoHa'; tempo: string } | null {
  if (horas === null || !Number.isFinite(horas)) return null;
  return { chave: horas < 0 ? 'vencidoHa' : 'venceEm', tempo: duracaoCurta(horas * 60) };
}

/** O que a situação do caso permite (só o aberto se notifica ou descarta; a ficha imprime sempre). */
export function acoesDoCaso(
  situacao: CasoTela['situacao'],
  podeNotificar: boolean,
): { notificar: boolean; descartar: boolean } {
  const aberto = situacao === 'aberto' && podeNotificar;
  return { notificar: aberto, descartar: aberto };
}

export type Montagem<T> =
  | { readonly ok: true; readonly entrada: T }
  | { readonly ok: false; readonly erros: Readonly<Record<string, string>> };

function conferir<S extends z.ZodTypeAny>(
  esquema: S,
  bruto: unknown,
  extras: Record<string, string>,
): Montagem<z.infer<S>> {
  const erros: Record<string, string> = { ...extras };
  const r = esquema.safeParse(bruto);
  if (!r.success)
    for (const i of r.error.issues) {
      const campo = String(i.path[0] ?? 'geral');
      erros[campo] ??= i.message;
    }
  return Object.keys(erros).length || !r.success
    ? { ok: false, erros }
    : { ok: true, entrada: r.data as z.infer<S> };
}
/** A entrada sem o caso (ele vai no endereço da rota; o esquema o pede só para a conferência). */
function semCaso<T extends { caso: number }>(e: T): Omit<T, 'caso'> {
  const r: Partial<T> = { ...e };
  delete r.caso;
  return r as Omit<T, 'caso'>;
}
const vazio = (x: string | null | undefined) => (x ?? '').trim() === '';
const ouNulo = (x: string | null | undefined) => (vazio(x) ? null : (x as string).trim());

/** O caso a partir de um gatilho da fila: tudo vem do gatilho (a vigilância só decide abrir). */
export function entradaDoGatilho(g: GatilhoTela, observacao: string | null = null): AbrirCasoAgravoEntrada {
  return {
    origem: g.origem,
    exame: g.origem === 'exame' ? g.exame : null,
    atendimento: g.atendimento,
    paciente: g.paciente.id,
    cid: g.cid,
    gatilhoEm: g.gatilhoEm.slice(0, 16),
    observacao: ouNulo(observacao),
  };
}

export interface FormularioCasoManual {
  readonly paciente: number | null;
  readonly cid: string;
  readonly data: string | null;
  readonly hora: string | null;
  readonly observacao: string;
}

/** O caso aberto pela vigilância (busca ativa, telefonema, suspeita clínica): exige a descrição da suspeita. */
export function montarCasoManual(f: FormularioCasoManual): Montagem<AbrirCasoAgravoEntrada> {
  const extras: Record<string, string> = {};
  if (f.paciente === null) extras.paciente = 'Escolha o paciente.';
  if (vazio(f.cid)) extras.cid = 'Escolha o agravo (CID).';
  const gatilhoEm = instanteDosCampos(f.data, f.hora);
  if (!gatilhoEm) extras.gatilhoEm = 'Informe a data e a hora da suspeita.';
  return conferir(
    esquemaAbrirCasoAgravo,
    {
      origem: 'manual',
      exame: null,
      atendimento: null,
      paciente: f.paciente ?? 0,
      cid: f.cid,
      gatilhoEm: gatilhoEm ?? '',
      observacao: ouNulo(f.observacao),
    },
    extras,
  );
}

export interface FormularioNotificacaoAgravo {
  readonly autoridade: string;
  readonly canal: string;
  readonly numero: string;
  readonly data: string | null;
  readonly hora: string | null;
  readonly recebidoPor: string;
  readonly observacao: string;
}

/** A notificação entregue: autoridade, canal, número quando o canal dá, quem recebeu no telefone e no e-mail. */
export function montarNotificacaoAgravo(
  f: FormularioNotificacaoAgravo,
  versao: number,
): Montagem<Omit<RegistrarNotificacaoAgravoEntrada, 'caso'>> {
  const extras: Record<string, string> = {};
  if (vazio(f.autoridade)) extras.autoridade = 'Escolha a autoridade sanitária.';
  if (vazio(f.canal)) extras.canal = 'Escolha como a notificação foi entregue.';
  const notificadoEm = instanteDosCampos(f.data, f.hora);
  if (!notificadoEm) extras.notificadoEm = 'Informe a data e a hora da notificação.';
  const r = conferir(
    esquemaRegistrarNotificacaoAgravo,
    {
      caso: 1,
      versao,
      autoridade: f.autoridade,
      canal: f.canal,
      numero: ouNulo(f.numero),
      notificadoEm: notificadoEm ?? '',
      recebidoPor: ouNulo(f.recebidoPor),
      observacao: ouNulo(f.observacao),
    },
    extras,
  );
  if (!r.ok) return r;
  return { ok: true, entrada: semCaso(r.entrada) };
}

/** O canal pede o número da notificação (Sinan, e-SUS Sinan) ou quem recebeu (telefone, e-mail). */
export function camposDoCanal(canal: string): { numero: boolean; recebidoPor: boolean } {
  const c = canal as Parameters<typeof canalExigeNumero>[0];
  return {
    numero: canal !== '' && canalExigeNumero(c),
    recebidoPor: canal === 'telefone' || canal === 'email',
  };
}

export interface FormularioDescarte {
  readonly motivo: string;
  readonly justificativa: string;
}

export function montarDescarte(
  f: FormularioDescarte,
  versao: number,
): Montagem<Omit<DescartarCasoAgravoEntrada, 'caso'>> {
  const extras: Record<string, string> = {};
  if (vazio(f.motivo)) extras.motivo = 'Escolha o motivo do descarte.';
  if (f.justificativa.trim().length < 10)
    extras.justificativa = 'Justifique o descarte (pelo menos 10 caracteres).';
  const r = conferir(
    esquemaDescartarCasoAgravo,
    { caso: 1, versao, motivo: f.motivo, justificativa: f.justificativa.trim() },
    extras,
  );
  if (!r.ok) return r;
  return { ok: true, entrada: semCaso(r.entrada) };
}

export interface FormularioGatilhoExame {
  readonly gatilho: number | null;
  readonly versao: number | null;
  readonly padrao: string;
  readonly exceto: string;
  readonly cid: string;
  readonly ativo: boolean;
}

/** O exame cujo resultado reagente sugere o agravo (nome do exame contém o padrão e não contém a exceção). */
export function montarGatilhoExame(f: FormularioGatilhoExame): Montagem<ConfigurarGatilhoExameEntrada> {
  const extras: Record<string, string> = {};
  if (f.padrao.trim().length < 3) extras.padrao = 'Informe o trecho do nome do exame (pelo menos 3 letras).';
  if (vazio(f.cid)) extras.cid = 'Escolha o agravo (CID).';
  return conferir(
    esquemaConfigurarGatilhoExame,
    {
      gatilho: f.gatilho,
      versao: f.versao,
      padrao: f.padrao.trim(),
      exceto: ouNulo(f.exceto),
      cid: f.cid,
      ativo: f.ativo,
    },
    extras,
  );
}

/** Idade em anos completos na data de referência (a ficha mostra a idade; nunca o nascimento na lista). */
export function idadeEm(nascimento: string | null, referencia: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(nascimento ?? '');
  const r = /^(\d{4})-(\d{2})-(\d{2})/.exec(referencia);
  if (!m || !r) return null;
  let anos = Number(r[1]) - Number(m[1]);
  if (`${r[2]}${r[3]}` < `${m[2]}${m[3]}`) anos -= 1;
  return anos >= 0 ? anos : null;
}
