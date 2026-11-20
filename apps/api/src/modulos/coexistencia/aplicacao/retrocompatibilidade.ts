// Decisão sobre a retrocompatibilidade e plano de evolução do modelo por hospital (M59, etapa 6; ficha, regras 1, 6, 11
// e 12; ADR 0033). Só leitura: junta o registro versionado da retrocompatibilidade
// (docs/coexistencia/retrocompatibilidade/<h>.yaml), o registro do fim (M43), o registro dos passos do desligamento
// (M58), o parâmetro `legado.contingencia` (DP-6) e o catálogo do banco (estrutura, nunca valor), e mostra as condições
// da extinção, a decisão vigente, os cinco passos do plano com o tamanho de cada um e o estado esperado das retiradas, comparado com o do catálogo de
// operações.
// A decisão é do dono, por PR no registro (falha fechada: extinção sem as condições vale "mantida").
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADR_RETROCOMPATIBILIDADE,
  caminhoRegistroRetrocompatibilidade,
  esquemaPainelRetrocompatibilidade,
  esquemaRegistroRetrocompatibilidade,
  type EstadoOperacao,
  type InventarioRetrocompatibilidade,
  type OperacaoDeRetirada,
  type PainelRetrocompatibilidade,
  type RegistroRetrocompatibilidade,
  TABELAS_CLINICAS_LEGADO,
} from '@sgh/contratos';
import {
  avaliarCondicoesExtincao,
  avaliarPassosEvolucao,
  decisaoVigente,
  estadoEsperadoRetiradas,
  medirInventarioRetrocompatibilidade,
} from '@sgh/dominio-config';
import { parse } from 'yaml';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { PortaCoexistencia } from '../porta.js';
import { lerRegistroDesligamento } from './desligamento.js';
import { lerRegistroFim } from './fim.js';
import { gravadoOuArquivo, type RegistroGravadoCoex } from './registro.js';

/** O catálogo muda só com script SGH_ ou janela: 1 h de cache por hospital (a leitura leva segundos). */
const TTL_CATALOGO_MS = 60 * 60_000;

export interface DependenciasRetrocompatibilidade {
  readonly porta: PortaCoexistencia;
  /** docs/coexistencia/retrocompatibilidade. */
  readonly raizRetrocompatibilidade: string;
  /** docs/coexistencia/fim (M43). */
  readonly raizFim: string;
  /** docs/coexistencia/desligamento (M58). */
  readonly raizDesligamento: string;
  /** `legado.contingencia` do estabelecimento; ligado na dúvida (falha fechada). */
  readonly contingenciaLigada: (rede: string, hospital: string) => Promise<boolean>;
  /**
   * O estado que o catálogo de operações (docs/operacoes/catalogo) declara para a retirada no hospital (null:
   * operação ausente); sem a fonte, o painel mostra a retirada sem leitura e com o aviso de divergência.
   */
  readonly estadoOperacao?: (operacao: OperacaoDeRetirada, hospital: string) => EstadoOperacao | null;
  readonly agora?: () => number;
  /** W0-09: o registro gravado pela tela que vale sobre o arquivo (null: vale o arquivo). */
  readonly registroGravado?: RegistroGravadoCoex | undefined;
}

export interface RegistroRetrocompatibilidadeLido {
  readonly registro: RegistroRetrocompatibilidade;
  readonly invalido: string | null;
}

/**
 * O registro do hospital (ausente ou fora do esquema: decisão pendente, com o aviso; falha fechada). W0-09
 * (D-RETRO-REGISTRO-F6): `gravado` é o registro gravado pela tela e vale sobre o arquivo.
 */
export function lerRegistroRetrocompatibilidade(
  raiz: string,
  hospital: string,
  gravado: Record<string, unknown> | null = null,
): RegistroRetrocompatibilidadeLido {
  const vazio = esquemaRegistroRetrocompatibilidade.parse({ formato: 1, estabelecimento: hospital });
  const p = join(raiz, `${hospital}.yaml`);
  if (!gravado && !existsSync(p))
    return { registro: vazio, invalido: 'registro da retrocompatibilidade ausente' };
  try {
    const r = esquemaRegistroRetrocompatibilidade.safeParse(gravado ?? parse(readFileSync(p, 'utf8')));
    if (!r.success)
      return {
        registro: vazio,
        invalido: `registro fora do esquema: ${r.error.issues[0]?.message ?? 'inválido'}`,
      };
    if (r.data.estabelecimento !== hospital)
      return { registro: vazio, invalido: 'registro de outro estabelecimento' };
    return { registro: r.data, invalido: null };
  } catch {
    return { registro: vazio, invalido: 'registro ilegível' };
  }
}

export class ServicoRetrocompatibilidade {
  private readonly inventarios = new Map<string, { em: number; inv: InventarioRetrocompatibilidade }>();

  constructor(private readonly d: DependenciasRetrocompatibilidade) {}

  private agora(): number {
    return this.d.agora ? this.d.agora() : Date.now();
  }

  private async contingencia(rede: string, hospital: string): Promise<boolean> {
    try {
      return await this.d.contingenciaLigada(rede, hospital);
    } catch {
      return true;
    }
  }

  /** O inventário do catálogo (com cache); a falha da leitura não derruba o painel: o tamanho fica sem medida. */
  private async inventario(
    s: SessaoCadastro,
  ): Promise<{ inv: InventarioRetrocompatibilidade | null; em: number | null }> {
    const c = s.porta;
    const k = `${c.rede}|${c.hospital}`;
    const g = this.inventarios.get(k);
    if (g && this.agora() - g.em < TTL_CATALOGO_MS) return { inv: g.inv, em: g.em };
    try {
      const cat = await this.d.porta.catalogoRetrocompatibilidade(c);
      const inv = medirInventarioRetrocompatibilidade(cat, TABELAS_CLINICAS_LEGADO);
      const em = this.agora();
      this.inventarios.set(k, { em, inv });
      return { inv, em };
    } catch {
      return { inv: null, em: null };
    }
  }

  async painel(s: SessaoCadastro): Promise<PainelRetrocompatibilidade> {
    const c = s.porta;
    const [gravado, gravadoFim] = await Promise.all([
      gravadoOuArquivo(this.d.registroGravado, c, 'retrocompatibilidade'),
      gravadoOuArquivo(this.d.registroGravado, c, 'fim'),
    ]);
    const { registro, invalido } = lerRegistroRetrocompatibilidade(
      this.d.raizRetrocompatibilidade,
      c.hospital,
      gravado,
    );
    const fim = lerRegistroFim(this.d.raizFim, c.hospital, gravadoFim).registro;
    const deslig = lerRegistroDesligamento(this.d.raizDesligamento, c.hospital).registro;
    const [contingenciaLigada, { inv, em }] = await Promise.all([
      this.contingencia(c.rede, c.hospital),
      this.inventario(s),
    ]);
    const dp6 = fim.dp6;
    const condicoes = avaliarCondicoesExtincao({
      fimRegistradoEm: fim.fimRegistrado?.data ?? null,
      desligamentoExecutadoEm: deslig.passos.desligamento.execucao?.data ?? null,
      dp6DecididaEm: dp6 && 'decididaEm' in dp6 ? dp6.decididaEm : null,
      contingenciaLigada,
    });
    const decisao = decisaoVigente(registro, condicoes);
    const d = registro.decisao;
    return esquemaPainelRetrocompatibilidade.parse({
      hospital: c.hospital,
      em: new Date(this.agora()).toISOString(),
      adr: { numero: ADR_RETROCOMPATIBILIDADE.numero, caminho: ADR_RETROCOMPATIBILIDADE.caminho },
      decisaoRegistrada: d.situacao,
      decisaoVigente: decisao.vigente,
      decididaEm: d.situacao === 'pendente' ? null : d.data,
      referencia: d.situacao === 'pendente' ? null : d.referencia,
      contingenciaLonga: d.situacao === 'mantida' ? d.contingenciaLonga : false,
      revisarEm: d.situacao === 'mantida' ? d.revisarEm : null,
      extincaoSemCondicoes: decisao.extincaoSemCondicoes,
      condicoes,
      podeDecidirExtincao: condicoes.every((x) => x.cumprida),
      passos: avaliarPassosEvolucao(registro, decisao.vigente, inv),
      operacoesDeRetirada: estadoEsperadoRetiradas(registro, (o) =>
        this.d.estadoOperacao ? this.d.estadoOperacao(o, c.hospital) : null,
      ),
      inventario: inv,
      inventarioMedidoEm: em === null ? null : new Date(em).toISOString(),
      inventarioIndisponivel: inv === null,
      registro: caminhoRegistroRetrocompatibilidade(c.hospital),
      registroInvalido: invalido,
    });
  }
}
