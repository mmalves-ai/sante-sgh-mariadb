// Painel de indicadores de pessoas (W0-06, parte 7; M4 de mercado; itens 193 e 215 juntos): turnover, absenteísmo,
// horas extras, horas de enfermagem por paciente-dia contra a referência da COFEN 543/2017, horas de treinamento per
// capita e taxa de frequência de acidentes, por unidade e setor, cada um com a ficha técnica e as parcelas impressas.
// A conta é a do domínio (`calcularIndicadoresPessoas`: Σ numeradores ÷ Σ denominadores); aqui ficam o recorte da
// sessão (só o estabelecimento ativo: D-W006-IND-UNIDADE), as horas da COFEN pelo parâmetro e os avisos das fontes que
// não puderam ser lidas. Só leitura: nada se grava.
import {
  CATEGORIAS_SCP,
  type CategoriaScp,
  CODIGOS_CATEGORIA_SCP,
  definicaoParametro,
  esquemaFiltroIndicadoresPessoas,
  type ApoioIndicadoresPessoas,
  FONTES_INDICADOR_PESSOAS,
  type PainelIndicadoresPessoas,
} from '@sgh/contratos';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';
import { calcularIndicadoresPessoas, FICHAS_INDICADOR_PESSOAS } from '@sgh/dominio-pessoas';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { FonteConfiguracao } from '../../config/public-api.js';
import { corpo } from '../../exames/public-api.js';
import type { PortaIndicadoresPessoas } from './porta-indicadores.js';

export const PERMISSOES_INDICADORES_PESSOAS = { ler: 'pessoas.indicadores.ler' } as const;

/** A chave do parâmetro das horas da COFEN de cada categoria. */
export const chaveHorasCofen = (c: CategoriaScp) => `pessoas.indicadores.horasCofen.${c}`;

export class ServicoIndicadoresPessoas {
  constructor(
    readonly porta: PortaIndicadoresPessoas,
    private readonly configuracao: FonteConfiguracao | null,
  ) {}

  /** As horas por categoria que valem para a sessão: o parâmetro ajustado ou o padrão da COFEN (fonte fora: padrão). */
  async horasCofen(
    s: SessaoCadastro,
  ): Promise<{ categoria: CategoriaScp; horas: number; ajustada: boolean }[]> {
    let valores: Awaited<ReturnType<FonteConfiguracao['valoresParametro']>> = [];
    try {
      if (this.configuracao) valores = await this.configuracao.valoresParametro(s.rede, s.hospital);
    } catch {
      valores = [];
    }
    const agora = new Date();
    return CODIGOS_CATEGORIA_SCP.map((categoria) => {
      const padrao = CATEGORIAS_SCP[categoria].horas;
      const def = definicaoParametro(chaveHorasCofen(categoria));
      if (!def) return { categoria, horas: padrao, ajustada: false };
      const v = Number(
        valorTipado(
          def,
          resolverParametro(
            def,
            valores,
            {
              rede: s.rede,
              empresa: null,
              estabelecimento: s.hospital,
              unidade: null,
              perfis: [],
              usuario: s.login,
            },
            agora,
          ).valor,
        ),
      );
      const horas = Number.isFinite(v) && v > 0 ? v : padrao;
      return { categoria, horas, ajustada: horas !== padrao };
    });
  }

  async apoio(s: SessaoCadastro): Promise<ApoioIndicadoresPessoas> {
    const [hoje, setores, horas] = await Promise.all([
      this.porta.hoje(s.porta),
      this.porta.setores(s.porta),
      this.horasCofen(s),
    ]);
    return {
      hoje,
      hospital: s.hospital,
      setores,
      horasCofen: horas.map((h) => ({ ...h, rotulo: CATEGORIAS_SCP[h.categoria].rotulo })),
    };
  }

  async painel(s: SessaoCadastro, entrada: unknown): Promise<PainelIndicadoresPessoas> {
    const f = corpo(esquemaFiltroIndicadoresPessoas, entrada);
    if (f.hospital !== null && f.hospital !== s.hospital)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Outro estabelecimento',
        'O painel mostra o estabelecimento em que você entrou. Troque de estabelecimento para ver o de outra unidade.',
        { codigo: 'fora-do-estabelecimento' },
      );
    const recorte = { inicio: f.inicio, fim: f.fim, hospital: s.hospital, setor: f.setor };
    const [lida, horas] = await Promise.all([this.porta.base(s.porta, recorte), this.horasCofen(s)]);
    const horasCofen = Object.fromEntries(
      horas.filter((h) => h.ajustada).map((h) => [h.categoria, h.horas]),
    ) as Partial<Record<CategoriaScp, number>>;
    const indicadores = calcularIndicadoresPessoas({ ...lida.base, horasCofen });
    const avisos = lida.indisponiveis.map(({ fonte, motivo }) => {
      const afetados = Object.values(FICHAS_INDICADOR_PESSOAS)
        .filter((x) => x.fontes.includes(fonte))
        .map((x) => x.rotulo);
      return `${FONTES_INDICADOR_PESSOAS[fonte]}: não foi possível ler (${motivo}). Afeta: ${afetados.join(', ')}.`;
    });
    return { inicio: f.inicio, fim: f.fim, hospital: s.hospital, setor: f.setor, indicadores, avisos };
  }
}
