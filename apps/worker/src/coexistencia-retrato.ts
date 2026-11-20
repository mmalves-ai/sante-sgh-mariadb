// Ciclo do retrato das conexões do outro sistema (M37, regra 1; ficha, seção 4): a cada 15 min, por estabelecimento,
// lê a tabela de conexões inteira (pequena: a ÚLTIMA conexão por usuário e módulo), compara com o último retrato
// gravado e grava o do dia em SGH_CFG_COEX_CONEXAO (uma linha por login e módulo, `mudou` quando a conexão avançou);
// e, uma vez por ciclo, as contagens do dia por operação (regra 2) em SGH_CFG_COEX_USO_DIA. O novo nunca grava a tabela
// de conexões do outro sistema. Log só com contagens.
// M43 (regra 3): no mesmo ciclo, as conexões ao banco do programa do outro sistema (MON$ATTACHMENTS, fora das estações
// técnicas combinadas) e o pico do dia em SGH_CFG_COEX_USO_DIA (a série diária que completa o retrato: dia sem coleta
// fica "sem medida" no painel de fim).
import { calcularParcela, retratoDoDia } from '@sgh/dominio-config';
import {
  contarConexoesOutroSistemaAgora,
  contarUsoDoDia,
  type Escritor,
  gravarPicoConexoesOutro,
  gravarRetratoConexoes,
  gravarTrilha,
  gravarUsoDia,
  type Leitor,
  lerConexoesOutroSistema,
  lerRetratoAnterior,
  MEDIDAS_USO,
  relogioDoBanco,
} from '@sgh/legado';

export interface DepsRetrato {
  readonly rede: string;
  readonly hospitais: readonly string[];
  readonly ler: <T>(hospital: string, fn: (l: Leitor) => Promise<T>) => Promise<T>;
  readonly gravarSgh: <T>(hospital: string, fn: (e: Escritor) => Promise<T>) => Promise<T>;
  /** M43: endereços das estações técnicas e de contingência combinadas (fora da contagem de sessões; regra 3). */
  readonly estacoesTecnicas?: readonly string[];
}

export interface ResultadoRetrato {
  readonly hospital: string;
  readonly situacao: 'feito' | 'falhou';
  readonly conexoes?: number;
  readonly mudaram?: number;
  readonly operacoes?: number;
  /** M43: conexões do outro sistema ao banco no momento (fora das estações técnicas); null sem coleta. */
  readonly conexoesOutroSistema?: number | null;
  readonly erro?: string;
}

export async function cicloRetrato(d: DepsRetrato): Promise<ResultadoRetrato[]> {
  const r: ResultadoRetrato[] = [];
  for (const hospital of d.hospitais) {
    try {
      const lido = await d.ler(hospital, async (l) => {
        const agora = await relogioDoBanco(l);
        const hoje = agora.toISOString().slice(0, 10);
        const uso = [];
        for (const m of MEDIDAS_USO) uso.push({ m, ...(await contarUsoDoDia(l, hospital, m, hoje)) });
        // MON$ falha só a série (o dia fica sem medida), nunca o retrato.
        const mon = await contarConexoesOutroSistemaAgora(l, d.estacoesTecnicas ?? []).catch(() => null);
        return {
          hoje,
          conexoes: await lerConexoesOutroSistema(l),
          anterior: await lerRetratoAnterior(l, hospital, hoje),
          uso,
          mon,
        };
      });
      // As datas do banco chegam como relógio de parede nos campos UTC.
      const retrato = retratoDoDia(lido.hoje, lido.conexoes, lido.anterior, 'UTC');
      const usoDia = lido.uso.map((u) => {
        const p = calcularParcela(u.linhasDoDia, u.doNovo);
        return {
          dia: lido.hoje,
          setor: u.m.setor,
          operacao: u.m.operacao,
          noNovo: p.novo,
          noLegado: p.legado,
        };
      });
      await d.gravarSgh(hospital, async (e) => {
        await gravarRetratoConexoes(e, hospital, retrato);
        await gravarUsoDia(e, hospital, usoDia);
        if (lido.mon) await gravarPicoConexoesOutro(e, hospital, lido.hoje, lido.mon.conexoes);
        await gravarTrilha(e, {
          rede: d.rede,
          hospital,
          usuario: 'sgh.worker',
          evento: 'coexistencia.retrato.gravado',
          recurso: 'config.coexistencia',
          operacao: 'retrato',
          tabelaAlvo: 'SGH_CFG_COEX_CONEXAO',
          idAlvo: lido.hoje,
          chaveNaturalAlvo: `conexoes:${retrato.length}:mudaram:${retrato.filter((x) => x.mudou).length}`,
          resultado: 'sucesso',
          estacao: 'worker',
          correlacao: `coex-retrato-${Date.now()}`,
        });
      });
      r.push({
        hospital,
        situacao: 'feito',
        conexoes: retrato.length,
        mudaram: retrato.filter((x) => x.mudou).length,
        operacoes: usoDia.length,
        conexoesOutroSistema: lido.mon?.conexoes ?? null,
      });
    } catch (e) {
      r.push({ hospital, situacao: 'falhou', erro: e instanceof Error ? e.name : 'erro' });
    }
  }
  return r;
}
