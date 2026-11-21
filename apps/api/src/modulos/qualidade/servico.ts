// Composição da notificação de incidentes (M48, etapa 1) sobre as regras puras de @sgh/dominio-qualidade: a linha lida
// do banco (notificacao_incidente) vira o resumo da lista, o detalhe projetado para o leitor (regra 1), o estado do fluxo,
// os prazos com o calendário de feriados (regra 3) e o resumo da fila de prazos. Também o código de acompanhamento
// (D-ANON-48.1): com a chave do pedido, o código é derivado dela (o reenvio devolve o mesmo código sem o banco
// guardar nem a chave nem o código: só os resumos SHA-256).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  ClassificacaoOms,
  ContextoNotificacaoLido,
  EventoNotificacaoLido,
  GrauDano,
  NotificacaoDetalhe,
  NotificacaoResumo,
  PrazoRegulatorio,
  SituacaoNotificacao,
  SituacaoPrazo,
  TipoEventoNotificacao,
  TipoIncidente,
} from '@sgh/contratos';
import {
  calendarioDeFeriados,
  type EstadoNotificacao,
  feriadosMoveisAusentes,
  gerarCodigoAcompanhamento,
  prazosDaNotificacao,
  proximoPrazoAberto,
  situacaoNotivisa,
} from '@sgh/dominio-qualidade';
import { marcaSuporteTecnico } from '@sgh/contratos';
import type { EventoNotificacaoRegistrado, NotificacaoRegistrada } from './tipos.js';

export const resumoSha256 = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

/** O código de acompanhamento: derivado da chave do pedido (reenvio igual) ou ao acaso, sem a chave. */
export function codigoAcompanhamento(hospital: string, chave: string | null): string {
  if (!chave) return gerarCodigoAcompanhamento((n) => new Uint8Array(randomBytes(n)));
  // Fluxo determinístico: SHA-256 da semente com um contador a cada pedido de bytes (a rejeição do gerador pode pedir
  // mais de uma vez).
  let contador = 0;
  return gerarCodigoAcompanhamento((n) => {
    const bloco = createHash('sha256')
      .update(`sante-nsp-codigo:${hospital}:${chave}:${String(contador++)}`, 'utf8')
      .digest();
    return new Uint8Array(bloco.subarray(0, n));
  });
}

/** O resumo da chave guardado no banco (distinto da semente do código: ninguém deriva o código do banco). */
export const resumoDaChave = (hospital: string, chave: string): string =>
  resumoSha256(`sante-nsp-chave:${hospital}:${chave}`);

/** Compara o resumo do código informado com o guardado, em tempo constante. */
export function codigoConfere(codigo: string, resumoGuardado: string): boolean {
  const a = Buffer.from(resumoSha256(codigo), 'hex');
  const b = Buffer.from(resumoGuardado.trim(), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** O estado do fluxo para as regras puras. */
export function estadoDe(n: NotificacaoRegistrada): EstadoNotificacao {
  return {
    protocolo: n.protocolo,
    situacao: n.situacao as SituacaoNotificacao,
    versao: n.versao,
    ocorridoEm: n.ocorridoEm,
    tipo: n.tipo as TipoIncidente,
    classificacao: n.classificacao as ClassificacaoOms,
    dano: n.dano as GrauDano,
    neverEvent: n.neverEvent,
    triada: n.triada,
    notivisaExportadaEm: n.notivisaExportadaEm,
    notivisaTranscritaEm: n.notivisaTranscritaEm,
  };
}

/** O calendário dos anos que os prazos alcançam (o da ocorrência mais antiga até o seguinte ao atual). */
export function calendario(
  feriados: readonly { data: string }[],
  anos: readonly number[],
): ReadonlySet<string> {
  return calendarioDeFeriados(feriados, anos);
}

export function prazosDe(
  n: NotificacaoRegistrada,
  agora: string,
  feriados: ReadonlySet<string>,
): PrazoRegulatorio[] {
  return prazosDaNotificacao(
    {
      ocorridoEm: n.ocorridoEm,
      classificacao: n.classificacao as ClassificacaoOms,
      dano: n.dano as GrauDano,
      neverEvent: n.neverEvent,
      notivisaTranscritaEm: n.notivisaTranscritaEm,
      analiseConcluidaEm: n.analiseConcluidaEm,
      descartada: n.situacao === 'descartada',
    },
    agora,
    feriados,
  );
}

/** Os anos de que os prazos de um conjunto de notificações precisam (mês seguinte pode virar o ano). */
export function anosDosPrazos(ns: readonly NotificacaoRegistrada[], agora: string): number[] {
  const anos = new Set<number>([Number(agora.slice(0, 4)), Number(agora.slice(0, 4)) + 1]);
  for (const n of ns) {
    const a = Number(n.ocorridoEm.slice(0, 4));
    anos.add(a);
    anos.add(a + 1);
  }
  return [...anos].filter((a) => Number.isInteger(a) && a > 1900).sort();
}

export function resumoDe(
  n: NotificacaoRegistrada,
  agora: string,
  feriados: ReadonlySet<string>,
  nomeUnidade: (codigo: number | null) => string | null,
): NotificacaoResumo {
  const prazos = prazosDe(n, agora, feriados);
  return {
    id: n.id,
    protocolo: n.protocolo,
    notificadaEm: n.notificadaEm,
    ocorridoEm: n.ocorridoEm,
    tipo: n.tipo as TipoIncidente,
    classificacao: n.classificacao as ClassificacaoOms,
    dano: n.dano as GrauDano,
    situacao: n.situacao as SituacaoNotificacao,
    notivisa: situacaoNotivisa({
      classificacao: n.classificacao as ClassificacaoOms,
      situacao: n.situacao as SituacaoNotificacao,
      notivisaExportadaEm: n.notivisaExportadaEm,
      notivisaTranscritaEm: n.notivisaTranscritaEm,
    }),
    unidade: nomeUnidade(n.unidadeAnalise ?? n.unidade),
    comPaciente: n.paciente !== null,
    anonima: n.anonima,
    proximoPrazo: proximoPrazoAberto(prazos),
  };
}

/** O detalhe completo (a projeção da regra 1 decide depois o que cada leitor vê). */
/** O evento foi gravado numa sessão "como" (a marca `suporte` em DADOS). */
function peloSuporte(e: EventoNotificacaoRegistrado): boolean {
  if (e.dados === null || !e.dados.includes('suporte')) return false;
  try {
    return (JSON.parse(e.dados) as { suporte?: unknown }).suporte === true;
  } catch {
    return false;
  }
}

export function detalheDe(
  n: NotificacaoRegistrada,
  eventos: readonly EventoNotificacaoRegistrado[],
  contexto: ContextoNotificacaoLido | null,
  agora: string,
  feriados: ReadonlySet<string>,
  nomeUnidade: (codigo: number | null) => string | null,
): NotificacaoDetalhe {
  const r = resumoDe(n, agora, feriados, nomeUnidade);
  const prazos = prazosDe(n, agora, feriados);
  // O registro feito numa sessão "como" leva a marca do suporte técnico (ADR 0021, R1): o notificador e o autor de
  // cada passo aparecem como "Registrado pelo suporte técnico em nome de …", nunca só como o alvo.
  const recebidaPeloSuporte = eventos.some((e) => e.tipo === 'recebida' && peloSuporte(e));
  return {
    ...r,
    versao: n.versao,
    descricao: n.descricao,
    local: n.local,
    chegouAoPaciente: n.chegouAoPaciente,
    danoPercebido: n.danoPercebido as GrauDano,
    tipoOutro: n.tipoOutro,
    neverEvent: n.neverEvent,
    notificador:
      n.anonima || n.notificador === null
        ? null
        : recebidaPeloSuporte
          ? marcaSuporteTecnico(n.notificador)
          : n.notificador,
    paciente:
      n.paciente !== null
        ? {
            id: n.paciente,
            nome: contexto?.nomePaciente ?? '',
            prontuario: contexto?.prontuario ?? null,
            leito: n.leito,
          }
        : null,
    gestor: n.gestor,
    prazoAnalise: n.prazoAnalise,
    prazos,
    eventos: eventos.map((e): EventoNotificacaoLido => ({
      tipo: e.tipo as TipoEventoNotificacao,
      em: e.em,
      por: peloSuporte(e) ? marcaSuporteTecnico(e.por) : e.por,
      texto: e.texto,
    })),
  };
}

/** O resumo da fila de prazos (o cartão da página inicial): contagem por situação e os móveis fora do cadastro. */
export function resumoDosPrazos(
  itens: readonly { readonly proximoPrazo: PrazoRegulatorio | null }[],
  ano: number,
  feriados: ReadonlySet<string>,
): {
  readonly porSituacao: Readonly<Record<Exclude<SituacaoPrazo, 'cumprido'>, number>>;
  readonly feriadosAusentes: readonly { readonly data: string; readonly nome: string }[];
} {
  const porSituacao = { noPrazo: 0, venceEmBreve: 0, vencido: 0 };
  for (const i of itens) {
    const s = i.proximoPrazo?.situacao;
    if (s && s !== 'cumprido') porSituacao[s] += 1;
  }
  return {
    porSituacao,
    feriadosAusentes: [
      ...feriadosMoveisAusentes(ano, feriados),
      ...feriadosMoveisAusentes(ano + 1, feriados),
    ],
  };
}
