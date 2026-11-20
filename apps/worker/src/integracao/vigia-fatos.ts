// Vigia dos fatos do legado para as integrações novas (M34; ficha, regra 11; cap-10 §10.6; cap-12 §12.3): o fato que
// o outro sistema grava (o resultado liberado, o exame marcado para o laboratório de apoio) chega à integração nova por
// LEITURA INCREMENTAL — a marca d'água (o último carimbo e ID lidos, em SGH_INTG_MARCA_FATO) com sobreposição — e vira
// evento na SGH_OUTBOX com a chave anti-duplicação (fato, estabelecimento, ID e carimbo): a mesma versão do fato nunca
// gera dois eventos, mesmo relida. Nenhum trigger novo. Só lê o fato que algum parceiro ATIVO assina (sem assinante,
// nada é lido). A marca anda na mesma transação dos eventos.
// Revisão do M34 (D-VIGIA2-34): o AVANÇO lê pela chave composta (carimbo, ID) depois da marca e a marca só anda (nunca
// recua), mesmo com mais de um lote de linhas no mesmo carimbo; a sobreposição de 5 s é uma RELEITURA limitada e à
// parte (da marca menos 5 s até a marca), que só acrescenta o evento que faltar e nunca move a marca.
import { chaveEventoFato, inicioDaReleitura } from '@sgh/dominio-integracao';
import {
  chaveEvento,
  type FatoDoExame,
  fatosExameApoio,
  fatosResultadoLiberado,
  gravarMarcaFato,
  gravarOutbox,
  type Leitor,
  type OpcoesLeituraFato,
  lerMarcaFato,
  lerParceiros,
  outboxTemChave,
} from '@sgh/legado';
import type { AcessoIntegracao } from './acesso.js';

export interface FatoVigiado {
  /** O nome do fato na marca d'água e na chave do evento. */
  readonly fato: string;
  /** O tipo do evento na outbox (o que o parceiro assina). */
  readonly evento: string;
  readonly ler: (
    l: Leitor,
    desde: Date | null,
    lote: number,
    o?: OpcoesLeituraFato,
  ) => Promise<FatoDoExame[]>;
}

export const FATOS_VIGIADOS: readonly FatoVigiado[] = [
  { fato: 'resultado.liberado', evento: 'fato.resultado.liberado', ler: fatosResultadoLiberado },
  { fato: 'exame.apoio', evento: 'fato.exame.apoio', ler: fatosExameApoio },
];

export interface ResultadoVigiaFatos {
  readonly fato: string;
  readonly lidos: number;
  readonly eventos: number;
  readonly repetidos: number;
}

export async function cicloVigiaFatos(
  acesso: AcessoIntegracao,
  rede: string,
  hospital: string,
  lote: number,
  fatos: readonly FatoVigiado[] = FATOS_VIGIADOS,
): Promise<ResultadoVigiaFatos[]> {
  const parceiros = await acesso.ler(hospital, (l) => lerParceiros(l, hospital));
  const assinados = new Set(parceiros.filter((p) => p.ativo).flatMap((p) => p.eventos));
  const r: ResultadoVigiaFatos[] = [];
  for (const f of fatos) {
    if (!assinados.has(f.evento)) continue;
    const { marca, linhas, avanco } = await acesso.ler(hospital, async (l) => {
      const m = await lerMarcaFato(l, hospital, f.fato);
      const depoisDoId = Number(m.ultimoId) || 0;
      const av = await f.ler(l, m.ultimoCarimbo, lote, { depoisDoId });
      const inicio = inicioDaReleitura(m.ultimoCarimbo);
      const re = inicio && m.ultimoCarimbo ? await f.ler(l, inicio, lote, { ate: m.ultimoCarimbo }) : [];
      return { marca: m, linhas: unicas([...re, ...av]), avanco: av };
    });
    if (linhas.length === 0) {
      r.push({ fato: f.fato, lidos: 0, eventos: 0, repetidos: 0 });
      continue;
    }
    const feito = await acesso.gravar(hospital, async (e) => {
      let eventos = 0;
      let repetidos = 0;
      for (const x of linhas) {
        const composta = chaveEventoFato(f.fato, hospital, x.id, x.carimbo);
        if (await outboxTemChave(e, chaveEvento(composta))) {
          repetidos++;
          continue;
        }
        await gravarOutbox(e, {
          rede,
          hospital,
          tipo: f.evento,
          chave: composta,
          carga: { exame: x.id, paciente: x.paciente, atendimento: x.atendimento, ato: x.ato },
        });
        eventos++;
      }
      const nova = proximaMarca(marca, avanco.at(-1));
      await gravarMarcaFato(e, hospital, f.fato, { ...nova, lidos: linhas.length });
      return { eventos, repetidos };
    });
    r.push({ fato: f.fato, lidos: linhas.length, ...feito });
  }
  return r;
}

/** As linhas sem repetir a mesma versão (ID e carimbo) que a releitura e o avanço trouxerem. */
function unicas(linhas: readonly FatoDoExame[]): FatoDoExame[] {
  const vistas = new Set<string>();
  return linhas.filter((x) => {
    const k = `${x.id}|${x.carimbo?.getTime() ?? ''}`;
    if (vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
}

/** A marca nova: a última linha do avanço, se ela passa da marca em (carimbo, ID); senão a marca fica (nunca recua). */
export function proximaMarca(
  marca: { ultimoId: string; ultimoCarimbo: Date | null },
  ultimo: FatoDoExame | undefined,
): { ultimoId: string; ultimoCarimbo: Date | null } {
  const atual = { ultimoId: marca.ultimoId, ultimoCarimbo: marca.ultimoCarimbo };
  if (!ultimo?.carimbo) return atual;
  if (!marca.ultimoCarimbo) return { ultimoId: String(ultimo.id), ultimoCarimbo: ultimo.carimbo };
  const c = ultimo.carimbo.getTime() - marca.ultimoCarimbo.getTime();
  const passa = c > 0 || (c === 0 && ultimo.id > (Number(marca.ultimoId) || 0));
  return passa ? { ultimoId: String(ultimo.id), ultimoCarimbo: ultimo.carimbo } : atual;
}
