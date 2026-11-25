// Porta PRÓPRIA da hierarquia da CID-10 e do perfil epidemiológico por capítulo (F7, 09-AREA linha 83) sobre o MariaDB
// do cliente, pelo @sgh/nucleo. Só leitura: a hierarquia vem das tabelas carregadas da fonte oficial pelo carregador
// (capitulo_cid10 e agrupamento_cid10, com a faixa de cada nível) e as ocorrências vêm dos diagnósticos do atendimento
// do estabelecimento da sessão (diagnostico_atendimento com o termo da CID-10), contadas por categoria no banco. A
// soma por capítulo, grupo e subgrupo é a regra do domínio (perfilPorCapitulo). Devolve só contagens.
// Melhoria: o perfil separa o diagnóstico principal dos secundários e deixa de fora o descartado e o inativado; o
// suspeito só entra quando pedido; o total traz atendimentos e pacientes distintos do período.
import {
  type AgrupamentoCid,
  type CapituloCid,
  type HierarquiaCid,
  localizarCid,
  type LocalizacaoCid,
  perfilPorCapitulo,
  type PerfilCid,
} from '@sgh/dominio-qualidade';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { type L, lerNoEstabelecimento, type Linha, n, type NucleoQualidade, texto } from './apoio-propria.js';

const TETO_CATEGORIAS = 5000;
const TETO_HIERARQUIA = 2000;

export interface FiltroPerfilCid {
  readonly desde: string;
  readonly ate: string;
  /** Só o diagnóstico principal do atendimento. */
  readonly apenasPrincipal: boolean;
  /** Inclui os diagnósticos suspeitos (o padrão é só o confirmado). */
  readonly incluirSuspeitos: boolean;
}

export interface PerfilCidDoPeriodo extends PerfilCid {
  readonly desde: string;
  readonly ate: string;
  readonly atendimentos: number;
  readonly pacientes: number;
}

async function hierarquiaDe(l: L): Promise<HierarquiaCid> {
  const caps = await l.consultar<Linha>(
    `SELECT c.codigo_cid10, c.numero, c.codigo_inicial, c.codigo_final, c.descricao
       FROM capitulo_cid10 c
      WHERE c.vigencia_fim IS NULL OR c.vigencia_fim >= CURRENT_DATE
      ORDER BY c.numero`,
    [],
    { teto: TETO_HIERARQUIA },
  );
  const agrs = await l.consultar<Linha>(
    `SELECT a.codigo_cid10, c.codigo_cid10 AS capitulo, p.codigo_cid10 AS pai, a.nivel, a.codigo_inicial,
            a.codigo_final, a.descricao
       FROM agrupamento_cid10 a
       JOIN capitulo_cid10 c ON c.id = a.capitulo_cid10_id
       LEFT JOIN agrupamento_cid10 p ON p.id = a.pai_agrupamento_cid10_id
      WHERE a.vigencia_fim IS NULL OR a.vigencia_fim >= CURRENT_DATE
      ORDER BY a.codigo_inicial, a.codigo_final`,
    [],
    { teto: TETO_HIERARQUIA },
  );
  const capitulos: CapituloCid[] = caps.map((c) => ({
    codigo: texto(c['codigo_cid10']),
    numero: n(c['numero']),
    inicial: texto(c['codigo_inicial']),
    final: texto(c['codigo_final']),
    descricao: texto(c['descricao']),
  }));
  const agrupamentos: AgrupamentoCid[] = agrs.map((a) => ({
    codigo: texto(a['codigo_cid10']),
    capitulo: texto(a['capitulo']),
    pai: a['pai'] === null || a['pai'] === undefined ? null : texto(a['pai']),
    nivel: texto(a['nivel']) === 'subgrupo' ? 'subgrupo' : 'grupo',
    inicial: texto(a['codigo_inicial']),
    final: texto(a['codigo_final']),
    descricao: texto(a['descricao']),
  }));
  return { capitulos, agrupamentos };
}

export class PortaPerfilCidPropria {
  constructor(private readonly nucleo: NucleoQualidade) {}

  /** A hierarquia vigente inteira (capítulos e agrupamentos), para a tela montar a árvore. */
  hierarquia(c: ContextoPortaM18): Promise<HierarquiaCid> {
    return lerNoEstabelecimento(this.nucleo, c, (l) => hierarquiaDe(l));
  }

  /** Capítulo, grupo e subgrupos de um código da CID-10 (null se fora da hierarquia), com a descrição do termo. */
  localizar(
    c: ContextoPortaM18,
    cid: string,
  ): Promise<(LocalizacaoCid & { descricao: string | null }) | null> {
    return lerNoEstabelecimento(this.nucleo, c, async (l) => {
      const loc = localizarCid(await hierarquiaDe(l), cid);
      if (!loc) return null;
      const t = await l.uma<Linha>(
        `SELECT t.descricao FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id
          WHERE g.codigo = 'cid10' AND REPLACE(t.codigo_termo, '.', '') = ? ORDER BY t.ativo DESC, t.id LIMIT 1`,
        [loc.cid],
      );
      return { ...loc, descricao: t ? texto(t['descricao']) : null };
    });
  }

  /** As ocorrências de diagnóstico do estabelecimento no período, por capítulo, grupo e subgrupo da CID-10. */
  perfil(c: ContextoPortaM18, f: FiltroPerfilCid): Promise<PerfilCidDoPeriodo> {
    return lerNoEstabelecimento(this.nucleo, c, async (l, est) => {
      const certezas = f.incluirSuspeitos ? ['confirmado', 'suspeito'] : ['confirmado'];
      const filtro = `d.estabelecimento_id = ? AND d.excluido_em IS NULL AND d.situacao <> 'inativado'
          AND d.certeza IN (${certezas.map(() => '?').join(', ')})
          AND d.diagnosticado_em >= ? AND d.diagnosticado_em < DATE_ADD(?, INTERVAL 1 DAY)
          ${f.apenasPrincipal ? "AND d.tipo = 'principal'" : ''}`;
      const p = [est, ...certezas, f.desde, f.ate];
      const cats = await l.consultar<Linha>(
        `SELECT LEFT(REPLACE(t.codigo_termo, '.', ''), 3) AS categoria, COUNT(*) AS diagnosticos
           FROM diagnostico_atendimento d
           JOIN termo_terminologia t ON t.id = d.cid_termo_terminologia_id
          WHERE ${filtro}
          GROUP BY LEFT(REPLACE(t.codigo_termo, '.', ''), 3)`,
        p,
        { teto: TETO_CATEGORIAS },
      );
      const tot = await l.uma<Linha>(
        `SELECT COUNT(DISTINCT d.atendimento_id) AS atendimentos, COUNT(DISTINCT d.paciente_id) AS pacientes
           FROM diagnostico_atendimento d WHERE ${filtro}`,
        p,
      );
      const perfil = perfilPorCapitulo(
        await hierarquiaDe(l),
        cats.map((x) => ({ categoria: texto(x['categoria']), diagnosticos: n(x['diagnosticos']) })),
      );
      return {
        ...perfil,
        desde: f.desde,
        ate: f.ate,
        atendimentos: n(tot?.['atendimentos']),
        pacientes: n(tot?.['pacientes']),
      };
    });
  }
}
