// Vigia dos fatos para as integrações (M34; ficha, regra 11; cap-10 §10.6; cap-12 §12.3): o fato gravado no banco do
// cliente sem evento de origem (o resultado liberado, o exame enviado ao laboratório de apoio por remessa, inclusive o
// que chegou pelo conector) chega à integração por LEITURA INCREMENTAL — a marca d'água (o último carimbo e a linha
// lidos) com sobreposição — e vira evento na fila comum com a chave anti-duplicação (fato, estabelecimento, linha e
// carimbo): a mesma versão do fato nunca gera dois eventos, mesmo relida. Nenhum gatilho. Só lê o fato que algum
// parceiro ATIVO assina (sem assinante, nada é lido). A marca anda na mesma operação dos eventos.
// O AVANÇO lê pela chave composta (carimbo, linha) depois da marca e a marca só anda (nunca recua), mesmo com mais de
// um lote no mesmo carimbo; a sobreposição de 5 s é uma RELEITURA limitada (da marca menos 5 s até a marca), que só
// acrescenta o evento que faltar e nunca move a marca.
// Melhoria: o fato que a operação de origem já publicou (evento do exame desde o carimbo) não é publicado de novo; a
// carga leva só ids do modelo (exame, paciente, atendimento); a marca fica no ponto de corte por tabela.
// Melhoria: o resultado segue o estado da liberação (a linha decide o evento: liberado, revogado ou nenhum); a
// revogação só sai depois de o resultado liberado ter ido à fila comum. A linha sem fato conta em "ignorados".
import { chaveEventoFato, EVENTO_RESULTADO_REVOGADO, inicioDaReleitura } from '@sgh/dominio-integracao';
import type { Leitor } from '@sgh/nucleo';
import type { AcessoIntegracao } from './acesso.js';
import {
  chaveEvento,
  type FatoDoExame,
  fatoJaPublicado,
  fatosExameApoio,
  liberacaoPublicada,
  fatosResultadoLiberado,
  gravarMarcaFato,
  lerMarcaFato,
  lerParceiros,
  type MarcaFato,
  type OpcoesLeituraFato,
  outboxTemChave,
  publicarFato,
} from './porta-propria.js';

export interface FatoVigiado {
  /** O nome do fato na marca d'água e na chave do evento. */
  readonly fato: string;
  /** O tipo do evento na fila comum (o que o parceiro assina). */
  readonly evento: string;
  /** A tabela da linha do fato (vai como a entidade do evento). */
  readonly entidade: string;
  readonly ler: (
    l: Leitor,
    hospital: string,
    desde: Date | null,
    lote: number,
    o?: OpcoesLeituraFato,
  ) => Promise<FatoDoExame[]>;
}

export const FATOS_VIGIADOS: readonly FatoVigiado[] = [
  {
    fato: 'resultado.liberado',
    evento: 'fato.resultado.liberado',
    entidade: 'liberacao_exame',
    ler: fatosResultadoLiberado,
  },
  {
    fato: 'exame.apoio',
    evento: 'fato.exame.apoio',
    entidade: 'remessa_laboratorio_apoio_item',
    ler: fatosExameApoio,
  },
];

export interface ResultadoVigiaFatos {
  readonly fato: string;
  readonly lidos: number;
  readonly eventos: number;
  readonly repetidos: number;
  /** Linhas lidas que não geram fato (liberação superada, retirada sem liberação entregue). */
  readonly ignorados: number;
}

export async function cicloVigiaFatos(
  acesso: AcessoIntegracao,
  hospital: string,
  lote: number,
  fatos: readonly FatoVigiado[] = FATOS_VIGIADOS,
): Promise<ResultadoVigiaFatos[]> {
  const parceiros = await acesso.ler(hospital, (l) => lerParceiros(l));
  const assinados = new Set(parceiros.filter((p) => p.ativo).flatMap((p) => p.eventos));
  const r: ResultadoVigiaFatos[] = [];
  for (const f of fatos) {
    if (!assinados.has(f.evento)) continue;
    const { marca, linhas, avanco } = await acesso.ler(hospital, async (l) => {
      const m = await lerMarcaFato(l, hospital, f.fato);
      const depoisDoId = Number(m.ultimoId) || 0;
      const av = await f.ler(l, hospital, m.ultimoCarimbo, lote, { depoisDoId });
      const inicio = inicioDaReleitura(m.ultimoCarimbo);
      const re =
        inicio && m.ultimoCarimbo ? await f.ler(l, hospital, inicio, lote, { ate: m.ultimoCarimbo }) : [];
      return { marca: m, linhas: unicas([...re, ...av]), avanco: av };
    });
    if (linhas.length === 0) {
      r.push({ fato: f.fato, lidos: 0, eventos: 0, repetidos: 0, ignorados: 0 });
      continue;
    }
    const feito = await acesso.gravar(
      hospital,
      async (tx) => {
        let eventos = 0;
        let repetidos = 0;
        let ignorados = 0;
        for (const x of linhas) {
          const tipo = x.evento === undefined ? f.evento : x.evento;
          if (
            tipo === null ||
            (tipo === EVENTO_RESULTADO_REVOGADO && !(await liberacaoPublicada(tx, x.exame)))
          ) {
            ignorados++;
            continue;
          }
          const chave = chaveEvento(chaveEventoFato(f.fato, hospital, x.id, x.carimbo));
          if (
            (await outboxTemChave(tx, chave)) ||
            (await fatoJaPublicado(tx, tipo, x.exame, x.carimbo, f.entidade))
          ) {
            repetidos++;
            continue;
          }
          await publicarFato(tx, {
            tipo,
            chave,
            entidade: f.entidade,
            entidadeId: x.id,
            carga: { exame: x.exame, paciente: x.paciente, atendimento: x.atendimento },
          });
          eventos++;
        }
        await gravarMarcaFato(tx, f.fato, proximaMarca(marca, avanco.at(-1)));
        return { eventos, repetidos, ignorados };
      },
      { operacao: 'integracao.vigia-fatos' },
    );
    r.push({ fato: f.fato, lidos: linhas.length, ...feito });
  }
  return r;
}

/** As linhas sem repetir a mesma versão (linha e carimbo) que a releitura e o avanço trouxerem. */
function unicas(linhas: readonly FatoDoExame[]): FatoDoExame[] {
  const vistas = new Set<string>();
  return linhas.filter((x) => {
    const k = `${x.id}|${x.carimbo.getTime()}`;
    if (vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
}

/** A marca nova: a última linha do avanço, se ela passa da marca em (carimbo, linha); senão a marca fica. */
export function proximaMarca(marca: MarcaFato, ultimo: FatoDoExame | undefined): MarcaFato {
  const atual = { ultimoId: marca.ultimoId, ultimoCarimbo: marca.ultimoCarimbo };
  if (!ultimo) return atual;
  if (!marca.ultimoCarimbo) return { ultimoId: String(ultimo.id), ultimoCarimbo: ultimo.carimbo };
  const c = ultimo.carimbo.getTime() - marca.ultimoCarimbo.getTime();
  const passa = c > 0 || (c === 0 && ultimo.id > (Number(marca.ultimoId) || 0));
  return passa ? { ultimoId: String(ultimo.id), ultimoCarimbo: ultimo.carimbo } : atual;
}
