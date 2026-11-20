// Orquestração entre os bancos da rede (M57, etapa 1; regras 1, 4 e 5; ficha, seção 4): o ciclo de pareamento, a
// execução de um plano do índice banco a banco, o relatório de divergência e o reparo. É a mesma para a API (o botão
// "Atualizar a fila" e as decisões) e para o worker (a carga noturna em lotes e o relatório diário): só regras e a ordem
// das chamadas, sobre uma porta abstrata, um banco por chamada. Nenhuma transação cruza os bancos: cada `gravar` é uma
// transação no banco de UM estabelecimento, na ordem dos estabelecimentos; o banco que falhar fica `pendente` e o
// reparo (idempotente) completa depois. Nenhum dado pessoal sai daqui: só contagens, chaves e situações.
import type { CicloPareamentoRede, SituacaoParAnteriorRede, TipoDivergenciaIndiceRede } from '@sgh/contratos';
import { decidirPar } from './automatico.js';
import { type CadastroRede, comparavel } from './cadastro.js';
import { chavePar } from './chave.js';
import { compararIndices } from './divergencia.js';
import { planejarReparo } from './divergencia.js';
import { separarDuplicadosLocais } from './duplicado-local.js';
import { type EscritaIndice, garantirSomenteIndice, type PlanoIndice, type VinculoIndice } from './indice.js';
import { planejarVinculo } from './vincular.js';

/** O cadastro como a leitura do banco o entrega (mais a fonética do próprio cadastro e o carimbo de atualização). */
export interface CadastroLidoRede extends CadastroRede {
  readonly nomeFoneticoBanco: string | null;
  readonly maeFoneticaBanco: string | null;
  /** AAAA-MM-DDThh:mm:ss.sss, com ou sem o Z (o processo roda em UTC). */
  readonly atualizadoEm: string | null;
}

/** Um par para a fila (ou já vinculado pelo automático), na forma do banco do lado local. */
export interface CandidatoParaGravar {
  readonly chave: string;
  readonly idLocal: number;
  readonly prontuarioLocal: number;
  readonly estabelecimentoRemoto: string;
  readonly idRemoto: number;
  readonly prontuarioRemoto: number;
  readonly pontuacao: number;
  readonly criterios: readonly string[];
  readonly divergencias: readonly string[];
  readonly situacao: 'aberto' | 'vinculado';
  readonly por: string;
  readonly em: string;
}

export interface ParDuplicidadeLocal {
  readonly a: { readonly id: number; readonly pront: number };
  readonly b: { readonly id: number; readonly pront: number };
  readonly escore: number;
  readonly criterios: readonly string[];
}

export interface MarcaPareamento {
  readonly ultimoId: number;
  /** O cursor dos alterados: o carimbo e o ID do último cadastro lido por ele (keyset por carimbo e ID). */
  readonly ultimaAtualizacao: string | null;
  /** O ID do último alterado lido no carimbo `ultimaAtualizacao` (0: nenhum; ausente nas marcas antigas). */
  readonly ultimoIdAlterado?: number;
}

/** As gravações de UM banco numa transação (quem implementa abre a transação e grava a trilha junto). */
export interface GravadorIndiceRede {
  escritas(ws: readonly EscritaIndice[]): Promise<{ gravadas: number; jaEstavam: number }>;
  candidatos(cs: readonly CandidatoParaGravar[]): Promise<unknown>;
  marca(m: MarcaPareamento, por: string): Promise<void>;
  duplicidadesLocais(pares: readonly ParDuplicidadeLocal[]): Promise<number>;
}

/** O que a trilha da gravação registra (o adaptador monta a linha no banco em que grava). */
export interface RotuloGravacao {
  readonly evento: string;
  readonly operacao: string;
  readonly chave: string;
  readonly pessoa: string | null;
}

/** A porta de leitura e gravação por banco que a orquestração usa (o estabelecimento é o banco). */
export interface PortaIndiceRede {
  marca(est: string): Promise<MarcaPareamento | null>;
  loteCadastros(
    est: string,
    depoisDoId: number,
    tamanho: number,
  ): Promise<{ itens: CadastroLidoRede[]; ultimoId: number }>;
  /**
   * Os alterados DEPOIS do cursor (carimbo, ID): carimbo maior que `desde`, ou igual com ID maior que `depoisDoId`, em
   * ordem de carimbo e ID, até `tamanho`.
   */
  cadastrosAlterados(
    est: string,
    desde: Date,
    depoisDoId: number,
    tamanho: number,
  ): Promise<CadastroLidoRede[]>;
  procurarCandidatos(
    est: string,
    chaves: {
      cpf: string | null;
      cns: string | null;
      nomeFoneticoBanco: string | null;
      maeFoneticaBanco: string | null;
      nascimento: string | null;
    },
  ): Promise<number[]>;
  cadastrosPorIds(est: string, ids: readonly number[]): Promise<CadastroLidoRede[]>;
  /** A situação dos pares já gravados (`reaberto`: aberto por uma pessoa que desfez o vínculo; o automático não religa). */
  situacoes(est: string, chaves: readonly string[]): Promise<ReadonlyMap<string, SituacaoParAnteriorRede>>;
  pessoasDosCadastros(est: string, ids: readonly number[]): Promise<ReadonlyMap<number, string>>;
  loteVinculos(
    est: string,
    depoisDoId: number,
    tamanho: number,
  ): Promise<{ itens: VinculoIndice[]; ultimoId: number }>;
  gravar<T>(est: string, fn: (g: GravadorIndiceRede) => Promise<T>, rotulo: RotuloGravacao): Promise<T>;
}

export class ErroBancosIndisponiveis extends Error {
  override readonly name = 'ErroBancosIndisponiveis';
}

export type SituacaoGravacaoBanco = 'gravado' | 'ja_estava' | 'pendente';

export interface ResultadoPlano {
  readonly chave: string;
  readonly pessoa: string | null;
  readonly bancos: readonly { readonly estabelecimento: string; readonly situacao: SituacaoGravacaoBanco }[];
}

export type Aviso = (mensagem: string) => void;

/** Executa um plano banco a banco (uma transação por banco, na ordem do plano); todos fora: ErroBancosIndisponiveis. */
export async function executarPlanoRede(
  porta: Pick<PortaIndiceRede, 'gravar'>,
  plano: PlanoIndice,
  rotulo: Omit<RotuloGravacao, 'chave' | 'pessoa'>,
  aviso: Aviso = () => undefined,
): Promise<ResultadoPlano> {
  garantirSomenteIndice(plano);
  const bancos: { estabelecimento: string; situacao: SituacaoGravacaoBanco }[] = [];
  for (const b of plano.bancos) {
    try {
      const r = await porta.gravar(b.estabelecimento, (g) => g.escritas(b.escritas), {
        ...rotulo,
        chave: plano.chave,
        pessoa: plano.pessoa,
      });
      bancos.push({ estabelecimento: b.estabelecimento, situacao: r.gravadas > 0 ? 'gravado' : 'ja_estava' });
    } catch (e) {
      aviso(`[rede] gravação no banco ${b.estabelecimento} ficou pendente: ${(e as Error).message}`);
      bancos.push({ estabelecimento: b.estabelecimento, situacao: 'pendente' });
    }
  }
  if (bancos.length > 0 && bancos.every((b) => b.situacao === 'pendente'))
    throw new ErroBancosIndisponiveis(
      'Nenhum banco dos estabelecimentos do par respondeu: nada foi gravado.',
    );
  return { chave: plano.chave, pessoa: plano.pessoa, bancos };
}

export interface OpcoesCiclo {
  readonly lote: number;
  readonly por: string;
  readonly em: string;
  readonly usuarioAutomatico: string;
  readonly novaPessoa: () => string;
  readonly eventoCiclo: string;
  readonly aviso?: Aviso;
}

const semZ = (v: string) => v.replace(/Z$/, '');

/** Cursor dos alterados: (carimbo sem o Z, ID). */
type Cursor = { readonly em: string; readonly id: number };
const depois = (a: Cursor, b: Cursor | null) => !b || a.em > b.em || (a.em === b.em && a.id > b.id);

/**
 * O novo cursor dos alterados. Com o lote de alterados CHEIO, o cursor vai só até o último alterado lido (os seguintes,
 * mesmo com carimbo menor que o de um cadastro novo, são lidos no próximo ciclo). Com o lote incompleto, todos os
 * alterados até agora foram lidos, e os novos (lidos pelo ID) também podem empurrar o cursor (não são relidos como
 * alterados). Nunca anda para trás.
 */
export function proximoCursorAlterados(
  marca: Pick<MarcaPareamento, 'ultimaAtualizacao' | 'ultimoIdAlterado'>,
  alterados: readonly Pick<CadastroLidoRede, 'id' | 'atualizadoEm'>[],
  novos: readonly Pick<CadastroLidoRede, 'id' | 'atualizadoEm'>[],
  tamanho: number,
): { ultimaAtualizacao: string | null; ultimoIdAlterado: number } {
  let c: Cursor | null = marca.ultimaAtualizacao
    ? { em: semZ(marca.ultimaAtualizacao), id: marca.ultimoIdAlterado ?? 0 }
    : null;
  const cheio = alterados.length >= tamanho;
  for (const x of cheio ? alterados : [...alterados, ...novos]) {
    if (!x.atualizadoEm) continue;
    const k = { em: semZ(x.atualizadoEm), id: x.id };
    if (depois(k, c)) c = k;
  }
  return c
    ? { ultimaAtualizacao: `${c.em}Z`, ultimoIdAlterado: c.id }
    : { ultimaAtualizacao: null, ultimoIdAlterado: 0 };
}

/**
 * Um ciclo de pareamento: para cada banco, um lote acima da marca d'água (e os alterados desde o último carimbo visto),
 * os candidatos procurados em cada OUTRO banco, o destino pelas regras puras e as gravações: uma transação por banco
 * (candidatos, vínculos automáticos, duplicidades locais à fila do cadastro e a marca). O banco que falhar não avança a
 * marca (o próximo ciclo refaz; tudo idempotente).
 */
export async function cicloPareamentoRede(
  porta: PortaIndiceRede,
  ests: readonly string[],
  o: OpcoesCiclo,
): Promise<CicloPareamentoRede> {
  const tamanho = Math.max(1, Math.min(2000, Math.trunc(o.lote)));
  const r = { lidos: 0, automaticos: 0, naFila: 0, descartados: 0, duplicadosLocais: 0, inelegiveis: 0 };
  const candidatos = new Map<string, Map<string, CandidatoParaGravar>>(ests.map((e) => [e, new Map()]));
  const escritas = new Map<string, EscritaIndice[]>(ests.map((e) => [e, []]));
  const duplicidades = new Map<string, ParDuplicidadeLocal[]>(ests.map((e) => [e, []]));
  const pessoaDe = new Map<string, string | null>();
  const marcaNova = new Map<string, MarcaPareamento>();

  const pessoa = async (est: string, id: number): Promise<string | null> => {
    const k = `${est}:${id}`;
    if (!pessoaDe.has(k)) pessoaDe.set(k, (await porta.pessoasDosCadastros(est, [id])).get(id) ?? null);
    return pessoaDe.get(k) ?? null;
  };

  for (const est of ests) {
    const marca = (await porta.marca(est)) ?? { ultimoId: 0, ultimaAtualizacao: null };
    const novos = await porta.loteCadastros(est, marca.ultimoId, tamanho);
    const alterados = marca.ultimaAtualizacao
      ? await porta.cadastrosAlterados(
          est,
          new Date(marca.ultimaAtualizacao),
          marca.ultimoIdAlterado ?? 0,
          tamanho,
        )
      : [];
    const lidos = new Map<number, CadastroLidoRede>();
    for (const x of [...novos.itens, ...alterados]) lidos.set(x.id, x);
    r.lidos += lidos.size;
    marcaNova.set(est, {
      ultimoId: Math.max(marca.ultimoId, novos.ultimoId),
      ...proximoCursorAlterados(marca, alterados, novos.itens, tamanho),
    });

    const comparaveis = [...lidos.values()].map(comparavel);
    r.inelegiveis += comparaveis.filter((c) => !c.elegivel).length;
    const sep = separarDuplicadosLocais(comparaveis);
    for (const g of sep.gruposLocais) {
      r.duplicadosLocais++;
      const [primeiro, ...outros] = g.ids;
      const p = lidos.get(primeiro as number) as CadastroLidoRede;
      for (const id of outros) {
        const q = lidos.get(id) as CadastroLidoRede;
        duplicidades.get(est)?.push({
          a: { id: p.id, pront: p.prontuario },
          b: { id: q.id, pront: q.prontuario },
          escore: 90,
          criterios: ['cpf'],
        });
      }
    }

    for (const ac of sep.paraARede) {
      const a = lidos.get(ac.id) as CadastroLidoRede;
      for (const outro of ests) {
        if (outro === est) continue;
        const ids = await porta.procurarCandidatos(outro, {
          cpf: ac.cpf,
          cns: ac.cns,
          nomeFoneticoBanco: a.nomeFoneticoBanco,
          maeFoneticaBanco: a.maeFoneticaBanco,
          nascimento: ac.nascimento,
        });
        if (ids.length === 0) continue;
        const bs = await porta.cadastrosPorIds(outro, ids);
        const chaveDe = (b: CadastroLidoRede) =>
          chavePar({ estabelecimento: est, id: a.id }, { estabelecimento: outro, id: b.id });
        const sits = await porta.situacoes(est, bs.map(chaveDe));
        for (const b of bs) {
          const chave = chaveDe(b);
          if (candidatos.get(est)?.has(chave)) continue;
          const dec = decidirPar(ac, comparavel(b), sits.get(chave) ?? null);
          if (dec.destino === 'inelegivel') {
            r.inelegiveis++;
            continue;
          }
          if (dec.destino === 'descartar' || dec.destino === 'ja_decidido') {
            r.descartados++;
            continue;
          }
          if (dec.destino === 'fila_duplicidade_local') continue;
          let situacao: 'aberto' | 'vinculado' = 'aberto';
          if (dec.destino === 'vincular_automatico') {
            const plano = planejarVinculo({
              a: {
                estabelecimento: est,
                id: a.id,
                prontuario: a.prontuario,
                pessoaAtual: await pessoa(est, a.id),
              },
              b: {
                estabelecimento: outro,
                id: b.id,
                prontuario: b.prontuario,
                pessoaAtual: await pessoa(outro, b.id),
              },
              origem: 'automatico',
              por: o.usuarioAutomatico,
              em: o.em,
              justificativa: null,
              novaPessoa: o.novaPessoa,
            });
            if (plano.resultado === 'plano') {
              garantirSomenteIndice(plano.plano);
              for (const pb of plano.plano.bancos)
                escritas
                  .get(pb.estabelecimento)
                  ?.push(...pb.escritas.filter((w) => w.tabela !== 'SGH_REDE_CANDIDATO'));
              pessoaDe.set(`${est}:${a.id}`, plano.plano.pessoa);
              pessoaDe.set(`${outro}:${b.id}`, plano.plano.pessoa);
              situacao = 'vinculado';
              r.automaticos++;
            } else if (plano.resultado === 'ja_vinculado') {
              situacao = 'vinculado';
              r.automaticos++;
            } else r.naFila++; // pessoas diferentes nos dois lados: fica na fila para uma pessoa decidir
          } else r.naFila++;
          const base = {
            chave,
            pontuacao: dec.pontuacao,
            criterios: dec.criterios,
            divergencias: dec.divergencias,
            situacao,
            por: o.usuarioAutomatico,
            em: o.em,
          };
          candidatos.get(est)?.set(chave, {
            ...base,
            idLocal: a.id,
            prontuarioLocal: a.prontuario,
            estabelecimentoRemoto: outro,
            idRemoto: b.id,
            prontuarioRemoto: b.prontuario,
          });
          candidatos.get(outro)?.set(chave, {
            ...base,
            idLocal: b.id,
            prontuarioLocal: b.prontuario,
            estabelecimentoRemoto: est,
            idRemoto: a.id,
            prontuarioRemoto: a.prontuario,
          });
        }
      }
    }
  }

  const contagem = `lidos=${r.lidos};auto=${r.automaticos};fila=${r.naFila};descartados=${r.descartados}`;
  const marcas: CicloPareamentoRede['marcas'] = [];
  for (const est of ests) {
    const m = marcaNova.get(est) as MarcaPareamento;
    try {
      await porta.gravar(
        est,
        async (g) => {
          const cs = [...(candidatos.get(est)?.values() ?? [])];
          if (cs.length) await g.candidatos(cs);
          const ws = escritas.get(est) ?? [];
          if (ws.length) await g.escritas(ws);
          const ds = duplicidades.get(est) ?? [];
          if (ds.length) await g.duplicidadesLocais(ds);
          await g.marca(m, o.por);
        },
        { evento: o.eventoCiclo, operacao: 'rede.parearCadastros', chave: contagem, pessoa: null },
      );
      marcas.push({ estabelecimento: est, ultimoId: m.ultimoId, ultimaAtualizacao: m.ultimaAtualizacao });
    } catch (e) {
      o.aviso?.(`[rede] ciclo no banco ${est} ficou pendente: ${(e as Error).message}`);
      const antiga = await porta.marca(est).catch(() => null);
      marcas.push({
        estabelecimento: est,
        ultimoId: antiga?.ultimoId ?? 0,
        ultimaAtualizacao: antiga?.ultimaAtualizacao ?? null,
      });
    }
  }
  return { ...r, marcas };
}

/** Teto de vínculos lidos por banco no relatório de divergência (keyset em lotes de 2.000). */
export const TETO_VINCULOS_DIVERGENCIA = 200_000;

/** As linhas de SGH_REDE_VINCULO de cada banco, lidas separadamente (uma série de lotes por banco). */
export async function vinculosPorBanco(
  porta: Pick<PortaIndiceRede, 'loteVinculos'>,
  ests: readonly string[],
): Promise<Map<string, VinculoIndice[]>> {
  const m = new Map<string, VinculoIndice[]>();
  for (const est of ests) {
    const linhas: VinculoIndice[] = [];
    let depois = 0;
    for (;;) {
      const lote = await porta.loteVinculos(est, depois, 2000);
      linhas.push(...lote.itens);
      if (lote.itens.length < 2000 || linhas.length >= TETO_VINCULOS_DIVERGENCIA) break;
      depois = lote.ultimoId;
    }
    m.set(est, linhas);
  }
  return m;
}

export interface ItemDivergenciaRede {
  readonly chave: string;
  readonly tipo: TipoDivergenciaIndiceRede;
  readonly porBanco: readonly {
    readonly estabelecimento: string;
    readonly situacao: VinculoIndice['situacao'] | null;
    readonly pessoa: string | null;
  }[];
}

export async function divergenciasRede(
  porta: Pick<PortaIndiceRede, 'loteVinculos'>,
  ests: readonly string[],
): Promise<ItemDivergenciaRede[]> {
  return compararIndices(ests, await vinculosPorBanco(porta, ests));
}

/**
 * O reparo das divergências: o banco que ficou para trás recebe a linha mais recente (e, no vínculo ativo, o par sai da
 * fila dele também); pessoa diferente nos dois fica para revisão humana. Idempotente: rodar de novo não grava nada.
 */
export async function repararIndiceRede(
  porta: Pick<PortaIndiceRede, 'loteVinculos' | 'gravar'>,
  ests: readonly string[],
  eventoReparo: string,
  aviso: Aviso = () => undefined,
): Promise<{ reparados: number; pendentes: number; manuais: string[] }> {
  const linhas = await vinculosPorBanco(porta, ests);
  const plano = planejarReparo(compararIndices(ests, linhas), linhas);
  let reparados = 0;
  let pendentes = 0;
  for (const p0 of plano.planos) {
    const p: PlanoIndice = {
      ...p0,
      bancos: p0.bancos.map((b) => {
        const v = b.escritas.find((w) => w.tabela === 'SGH_REDE_VINCULO');
        if (!v || v.tabela !== 'SGH_REDE_VINCULO' || v.linha.situacao !== 'ativo') return b;
        return {
          ...b,
          escritas: [
            ...b.escritas,
            {
              tabela: 'SGH_REDE_CANDIDATO' as const,
              acao: 'mudar_situacao' as const,
              chave: p0.chave,
              situacao: 'vinculado' as const,
              origem: v.linha.origem,
              por: v.linha.criadoPor,
              em: v.linha.criadoEm,
              justificativa: v.linha.justificativa,
            },
          ],
        };
      }),
    };
    const r = await executarPlanoRede(
      porta,
      p,
      { evento: eventoReparo, operacao: 'rede.repararIndice' },
      aviso,
    ).catch(() => null);
    if (r && r.bancos.every((b) => b.situacao !== 'pendente')) reparados++;
    else pendentes++;
  }
  return { reparados, pendentes, manuais: [...plano.manuais] };
}
