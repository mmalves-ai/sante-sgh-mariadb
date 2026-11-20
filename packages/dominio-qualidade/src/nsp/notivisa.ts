// Campos do Notivisa (DP-47.8: sem API conhecida, só o formulário web do módulo Assistência à Saúde, Notivisa 2.0;
// ficha, seção 7: "Prazos e exportação Notivisa"): o Sante separa o que o formulário pede, pronto para a equipe do
// NSP digitar no portal, e controla o prazo. O paciente vai só com iniciais, sexo e idade na data da ocorrência
// (nunca nome nem documento); o texto vai como o NSP revisou. Nada sai sozinho para fora (regra 10: envio real só
// em produção e com autorização do dono para cada canal; aqui é transcrição manual).
import {
  rotuloClassificacaoOms,
  rotuloGrauDano,
  rotuloTipoIncidente,
  type CamposNotivisa,
  type ClassificacaoOms,
  type GrauDano,
  type PrazoRegulatorio,
  type TipoIncidente,
} from '@sgh/contratos';
import { ehObito } from './classificacao.js';

const PARTICULAS = new Set(['DA', 'DE', 'DI', 'DO', 'DU', 'DAS', 'DOS', 'E', 'D']);

/** Iniciais do nome (sem as partículas): "Paciente da Silva Exemplo" → "P.S.E.". */
export function iniciais(nome: string): string {
  const partes = nome
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((p) => p.length > 0 && !PARTICULAS.has(p));
  return partes.map((p) => `${p[0]}.`).join('');
}

/** Idade em anos completos na data (AAAA-MM-DD), ou null sem nascimento. */
export function idadeNaData(nascimento: string | null, data: string): number | null {
  if (nascimento === null) return null;
  const [an, mn, dn] = nascimento.slice(0, 10).split('-').map(Number) as [number, number, number];
  const [a, m, d] = data.slice(0, 10).split('-').map(Number) as [number, number, number];
  let idade = a - an;
  if (m < mn || (m === mn && d < dn)) idade--;
  return idade >= 0 && idade < 150 ? idade : null;
}

/** Período do dia do formulário (manhã 06–12, tarde 12–18, noite 18–24, madrugada 00–06). */
export function periodoDoDia(instante: string): CamposNotivisa['periodo'] {
  const h = Number(instante.slice(11, 13));
  if (h < 6) return 'madrugada';
  if (h < 12) return 'manha';
  if (h < 18) return 'tarde';
  return 'noite';
}

export interface NotificacaoParaNotivisa {
  readonly protocolo: string;
  readonly tipo: TipoIncidente;
  readonly tipoOutro: string | null;
  readonly classificacao: ClassificacaoOms;
  readonly dano: GrauDano;
  readonly neverEvent: boolean;
  readonly ocorridoEm: string;
  readonly unidade: string | null;
  readonly local: string | null;
  readonly descricao: string;
  readonly paciente: {
    readonly nome: string;
    readonly sexo: 'F' | 'M' | 'I';
    readonly nascimento: string | null;
  } | null;
}

/** Os campos para transcrição, com o prazo do Notivisa (o de 72 h ou o mensal) quando houver. */
export function camposNotivisa(
  n: NotificacaoParaNotivisa,
  prazos: readonly PrazoRegulatorio[],
): CamposNotivisa {
  const prazo = prazos.find((p) => p.tipo === 'notivisaObito' || p.tipo === 'notivisaMensal') ?? null;
  return {
    protocoloInterno: n.protocolo,
    tipoIncidente: n.tipo === 'outro' && n.tipoOutro ? `Outro: ${n.tipoOutro}` : rotuloTipoIncidente(n.tipo),
    classificacao: rotuloClassificacaoOms(n.classificacao),
    ocorridoEm: n.ocorridoEm,
    periodo: periodoDoDia(n.ocorridoEm),
    unidade: n.unidade,
    local: n.local,
    descricao: n.descricao,
    dano: rotuloGrauDano(n.dano),
    obito: ehObito(n.classificacao, n.dano),
    neverEvent: n.neverEvent,
    paciente: n.paciente
      ? {
          iniciais: iniciais(n.paciente.nome),
          sexo: n.paciente.sexo,
          idade: idadeNaData(n.paciente.nascimento, n.ocorridoEm),
        }
      : null,
    prazo,
  };
}
