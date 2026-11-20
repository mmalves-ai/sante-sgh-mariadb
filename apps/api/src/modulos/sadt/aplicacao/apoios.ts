// As funcionalidades do SADT (ficha do M26, seção 12): uma chave de liberação por setor (laboratório, imagem, métodos
// gráficos, endoscopia) e as do novo (rastreio, valor crítico, portal) e da recepção (requisição, orçamento). Cada uma
// é um apoio de gravação do M18 (POL-3: completa e DESLIGADA até a conferência; o administrador liga por
// estabelecimento, setor ou pessoa), com o mapa operação → permissão de agir que vale também no servidor.
import {
  CHAVES_SADT,
  type GravacaoSadt,
  podeLaudar,
  podeLiberar,
  SETORES_SADT,
  type SetorSadt,
  setorDoAto,
} from '@sgh/contratos';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../../config/public-api.js';
import { ApoioGravacao } from '../../exames/public-api.js';
import type { GravadorSghSadt, PortaSadt, VinculoDaSessao } from '../porta.js';

/** As operações do laboratório e a permissão de agir de cada uma. */
const OPERACOES_LABORATORIO: Readonly<Record<string, string>> = {
  'sadt.receberSolicitacao': 'sadt.lancamento.receber',
  'sadt.lancarExame': 'sadt.lancamento.lancar',
  'sadt.registrarResultado': 'sadt.resultado.digitar',
  'sadt.liberarExame': 'sadt.resultado.liberar',
  'sadt.retificarResultado': 'sadt.resultado.retificar',
  'sadt.emitirLaudo': 'sadt.laudo.imprimir',
};
/** Imagem, métodos gráficos e endoscopia: o laudo (escrever e assinar) é privativo de médico (regra 8). */
const OPERACOES_LAUDO: Readonly<Record<string, string>> = {
  'sadt.receberSolicitacao': 'sadt.lancamento.receber',
  'sadt.lancarExame': 'sadt.lancamento.lancar',
  'sadt.registrarLaudo': 'sadt.laudo.criar',
  'sadt.liberarExame': 'sadt.laudo.assinar',
  'sadt.retificarResultado': 'sadt.resultado.retificar',
  'sadt.emitirLaudo': 'sadt.laudo.imprimir',
};

const NOMES_SETOR: Readonly<Record<SetorSadt, string>> = {
  laboratorio: 'o laboratório',
  imagem: 'a imagem',
  metodosGraficos: 'os métodos gráficos',
  endoscopia: 'a endoscopia',
};

export class ApoiosSadt {
  readonly setores: Readonly<Record<SetorSadt, ApoioGravacao<GravadorSghSadt>>>;
  readonly requisicao: ApoioGravacao<GravadorSghSadt>;
  readonly orcamento: ApoioGravacao<GravadorSghSadt>;
  readonly rastreio: ApoioGravacao<GravadorSghSadt>;
  readonly critico: ApoioGravacao<GravadorSghSadt>;
  readonly portal: ApoioGravacao<GravadorSghSadt>;

  constructor(
    readonly porta: PortaSadt,
    trilha: RegistradorTrilha,
    readonly configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
  ) {
    const apoio = (chave: string, nome: string, operacoes: Readonly<Record<string, string>>) =>
      new ApoioGravacao<GravadorSghSadt>({ chave, nome, operacoes }, porta, trilha, configuracao, cache);
    this.setores = {
      laboratorio: apoio(CHAVES_SADT.laboratorio, NOMES_SETOR.laboratorio, OPERACOES_LABORATORIO),
      imagem: apoio(CHAVES_SADT.imagem, NOMES_SETOR.imagem, OPERACOES_LAUDO),
      metodosGraficos: apoio(CHAVES_SADT.metodosGraficos, NOMES_SETOR.metodosGraficos, OPERACOES_LAUDO),
      endoscopia: apoio(CHAVES_SADT.endoscopia, NOMES_SETOR.endoscopia, OPERACOES_LAUDO),
    };
    this.requisicao = apoio(CHAVES_SADT.requisicao, 'a requisição de exames', {
      'sadt.abrirRequisicao': 'sadt.requisicao.criar',
    });
    this.orcamento = apoio(CHAVES_SADT.orcamento, 'o orçamento de exames', {
      'sadt.criarOrcamento': 'sadt.orcamento.criar',
    });
    this.rastreio = apoio(CHAVES_SADT.rastreio, 'o rastreio de amostra', {});
    this.critico = apoio(CHAVES_SADT.critico, 'o aviso de valor crítico', {});
    this.portal = apoio(CHAVES_SADT.portal, 'o portal de resultados', {
      'sadt.registrarVisualizacaoPortal': 'sadt.portal.ler',
      'cadastro.cadastrarSolicitante': 'sadt.solicitanteWeb.aprovar',
    });
  }

  /** O apoio do setor do ato (recusa o ato fora do diagnóstico). */
  doAto(ato: number): ApoioGravacao<GravadorSghSadt> {
    const s = setorDoAto(ato);
    if (!s)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Fora do diagnóstico',
        'O exame não é de um setor do diagnóstico.',
        {
          codigo: 'setor-invalido',
        },
      );
    return this.setores[s];
  }

  /** O vínculo da sessão habilitado para liberar ou laudar o ato (regra 8: decidido aqui, nunca pela tela). */
  habilitado(
    vinculos: readonly VinculoDaSessao[],
    ato: number,
  ): { vinculo: VinculoDaSessao | null; motivo: string | null } {
    let motivo: string | null = 'A sessão não tem vínculo profissional ativo.';
    for (const v of vinculos) {
      const r = podeLiberar(ato, { cbo: v.codigoCbo, conselhoAtivo: v.ativo });
      if (r.pode) return { vinculo: v, motivo: null };
      motivo = r.motivo;
    }
    return { vinculo: null, motivo };
  }

  async gravacao(s: SessaoCadastro): Promise<GravacaoSadt> {
    const extras = {
      rastreio: {
        coletar: 'sadt.amostra.coletar',
        receber: 'sadt.amostra.receber',
        rejeitar: 'sadt.amostra.rejeitar',
      },
      critico: { comunicar: 'sadt.avisoCritico.comunicar', valorCritico: 'sadt.valorCritico.editar' },
      portal: { protocolo: 'sadt.requisicao.criar', decidirAutocadastro: 'sadt.solicitanteWeb.aprovar' },
      orcamento: { converter: 'sadt.orcamento.converter' },
    };
    const [setores, req, orc, ras, cri, por, vinculos] = await Promise.all([
      Promise.all(
        SETORES_SADT.map(async (x) => [x.codigo, await this.setores[x.codigo].gravacao(s)] as const),
      ),
      this.requisicao.gravacao(s),
      this.orcamento.gravacao(s, extras.orcamento),
      this.rastreio.gravacao(s, extras.rastreio),
      this.critico.gravacao(s, extras.critico),
      this.portal.gravacao(s, extras.portal),
      this.porta.vinculos(s.porta, s.login).catch(() => [] as VinculoDaSessao[]),
    ]);
    const operacoes: GravacaoSadt['operacoes'] = {};
    const juntar = (prefixo: string, ops: Record<string, { pode: boolean; motivo: string | null }>) => {
      for (const [k, v] of Object.entries(ops))
        operacoes[`${prefixo}:${k}`] = { ligada: v.pode, motivo: v.motivo };
    };
    for (const [codigo, g] of setores) juntar(codigo, g.operacoes);
    juntar('requisicao', req.operacoes);
    juntar('orcamento', orc.operacoes);
    juntar('rastreio', ras.operacoes);
    juntar('critico', cri.operacoes);
    juntar('portal', por.operacoes);
    const lab = this.habilitado(vinculos, 15);
    const laudo =
      vinculos.find((v) => podeLaudar(24, { cbo: v.codigoCbo, conselhoAtivo: v.ativo }).pode) ?? null;
    return {
      setores: Object.fromEntries(
        setores.map(([c, g]) => [c, { ligada: g.ligada, motivo: g.motivo }]),
      ) as GravacaoSadt['setores'],
      rastreio: { ligada: ras.ligada, motivo: ras.motivo },
      critico: { ligada: cri.ligada, motivo: cri.motivo },
      portal: { ligada: por.ligada, motivo: por.motivo },
      orcamento: { ligada: orc.ligada, motivo: orc.motivo },
      requisicao: { ligada: req.ligada, motivo: req.motivo },
      operacoes,
      habilitacao: {
        liberarLaboratorio: lab.vinculo !== null,
        laudarImagem: laudo !== null,
        motivo: lab.vinculo || laudo ? null : lab.motivo,
        vinculo: lab.vinculo?.vinculo ?? laudo?.vinculo ?? vinculos.find((v) => v.ativo)?.vinculo ?? null,
      },
    };
  }
}
