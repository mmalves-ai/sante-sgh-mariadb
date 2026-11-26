// Serviço da configuração do faturamento SUS (C1-051, 06-SUS linha 53): a permissão por usuário e setor e os parâmetros
// próprios de cada instrumento. As regras são do domínio (configuracao-sus.ts); aqui, a ordem das conferências, a
// versão vista e a trilha (sem dado pessoal: ids, tipo, vigência e os nomes dos campos mudados, nunca os valores).
import {
  type CamposParametroSus,
  type ConfiguracaoSusTela,
  type EncerrarPermissaoSetorSusEntrada,
  type GravarParametrosInstrumentoSusEntrada,
  type IncluirPermissaoSetorSusEntrada,
  INSTRUMENTOS_PARAMETRO_SUS,
  type InstrumentoParametroSus,
  type ParametrosInstrumentoSus,
  type PermissaoSetorSusLida,
  versaoSus,
} from '@sgh/contratos';
import {
  normalizarParametrosSus,
  permissaoSetorVigente,
  type PermissaoSetorSusVigencia,
  recusaEncerrarPermissaoSetorSus,
  recusaIncluirPermissaoSetorSus,
} from '@sgh/dominio-faturamento';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoSus } from './porta.js';
import type {
  ParametroInstrumentoSusRegistro,
  PermissaoSetorSusRegistro,
  PortaConfiguracaoSus,
} from './porta-configuracao.js';

export interface SessaoConfiguracaoSus extends ContextoSus {
  readonly hoje: string;
  pode(acao: string): boolean;
}

export const ACAO_EDITAR_CONFIGURACAO_SUS = 'faturamento.susConfiguracao.editar';

export const MENSAGENS_CONFIGURACAO_SUS = {
  'sus-setor-sem-permissao': 'Você não tem permissão para a produção SUS deste setor.',
  'sus-setor-nao-informado':
    'O atendimento não tem setor; com permissão por setor, só o setor informado é aceito.',
  'sus-permissao-vigencia-invalida':
    'A vigência é inválida (o fim não pode ficar antes do início nem passar do fim já marcado).',
  'sus-permissao-sobreposta':
    'Esta pessoa já tem permissão neste setor num período que se cruza; encerre a atual antes.',
  'sus-permissao-setor-invalido': 'Escolha um setor ativo deste estabelecimento.',
  'sus-permissao-usuario-invalido': 'Escolha um usuário ativo.',
  'sus-parametro-invalido': 'Há campos inválidos nos parâmetros do instrumento.',
} as const;
export type RecusaConfiguracaoSus = keyof typeof MENSAGENS_CONFIGURACAO_SUS;

export function recusaConfiguracaoSus(
  codigo: RecusaConfiguracaoSus,
  extra: Record<string, unknown> = {},
): ErroProblema {
  if (codigo === 'sus-setor-sem-permissao' || codigo === 'sus-setor-nao-informado')
    return new ErroProblema(
      'sem-permissao',
      403,
      'Setor fora da permissão',
      MENSAGENS_CONFIGURACAO_SUS[codigo],
      {
        codigo,
      },
    );
  return new ErroProblema('recusa-de-negocio', 422, 'Operação recusada', MENSAGENS_CONFIGURACAO_SUS[codigo], {
    codigo,
    ...extra,
  });
}

const alterado = (o: string) =>
  new ErroProblema(
    'conflito-de-versao',
    409,
    'Registro alterado',
    `${o} foi alterado por outra pessoa; recarregue.`,
    {
      codigo: 'versao-alterada',
    },
  );

const CAMPOS_VAZIOS: CamposParametroSus = {
  fontePadrao: null,
  orgaoOrigem: null,
  siglaOrigem: null,
  cnpjPrestador: null,
  orgaoDestino: null,
  indicadorDestino: null,
  uf: null,
  utiPorAcomodacao: null,
  diretorClinicoCns: null,
};

const vigencia = (p: PermissaoSetorSusRegistro): PermissaoSetorSusVigencia => ({
  setor: p.setor,
  tipo: p.tipo,
  vigenciaInicio: p.vigenciaInicio,
  vigenciaFim: p.vigenciaFim,
});

export class ServicoConfiguracaoSus {
  constructor(private readonly porta: PortaConfiguracaoSus) {}

  permissaoLida(p: PermissaoSetorSusRegistro, hoje: string): PermissaoSetorSusLida {
    return {
      id: p.id,
      usuario: { id: p.usuario, login: p.usuarioLogin, nome: p.usuarioNome },
      setor: { id: p.setor, nome: p.setorNome },
      tipo: p.tipo,
      vigenciaInicio: p.vigenciaInicio,
      vigenciaFim: p.vigenciaFim,
      vigente: permissaoSetorVigente(vigencia(p), hoje),
      criadoPor: p.criadoPor,
      criadoEm: p.criadoEm,
      versao: versaoSus(p.versao),
    };
  }

  private parametrosLidos(regs: readonly ParametroInstrumentoSusRegistro[]): ParametrosInstrumentoSus[] {
    return INSTRUMENTOS_PARAMETRO_SUS.map((i) => {
      const r = regs.find((x) => x.instrumento === i);
      return r
        ? {
            instrumento: i,
            campos: r.campos,
            versao: versaoSus(r.versao),
            alteradoPor: r.alteradoPor,
            alteradoEm: r.alteradoEm,
          }
        : { instrumento: i, campos: CAMPOS_VAZIOS, versao: null, alteradoPor: null, alteradoEm: null };
    });
  }

  async tela(s: SessaoConfiguracaoSus): Promise<ConfiguracaoSusTela> {
    return this.porta.ler(s, async (l) => {
      const podeEditar = s.pode(ACAO_EDITAR_CONFIGURACAO_SUS);
      return {
        permissoes: (await l.permissoes()).map((p) => this.permissaoLida(p, s.hoje)),
        parametros: this.parametrosLidos(await l.parametros()),
        setores: await l.setores(),
        usuarios: podeEditar ? await l.usuarios() : [],
        hoje: s.hoje,
        podeEditar,
      };
    });
  }

  /** As permissões de setor do usuário (para a conferência das rotas do faturamento SUS). */
  async permissoesDoUsuario(c: ContextoSus, usuario: number): Promise<PermissaoSetorSusVigencia[]> {
    return this.porta.ler(c, async (l) => (await l.permissoes(usuario)).map(vigencia));
  }

  /**
   * C1-051: as permissões por setor que entram na sessão do faturamento SUS (o caminho do controlador). O administrador
   * da plataforma (usuário sem id) não tem restrição; sem configuração, nenhuma.
   */
  static async daSessao(
    c: ServicoConfiguracaoSus | null,
    contexto: ContextoSus,
    usuario: number | null | undefined,
  ): Promise<PermissaoSetorSusVigencia[]> {
    return c && usuario != null ? c.permissoesDoUsuario(contexto, usuario) : [];
  }

  /** Os parâmetros cadastrados por instrumento (o que não tem cadastro fica de fora: vale o parâmetro geral). */
  async parametrosCadastrados(c: ContextoSus): Promise<ParametroInstrumentoSusRegistro[]> {
    return this.porta.ler(c, (l) => l.parametros());
  }

  async incluirPermissao(
    s: SessaoConfiguracaoSus,
    e: IncluirPermissaoSetorSusEntrada,
  ): Promise<PermissaoSetorSusLida> {
    return this.porta.gravar(s, async (g) => {
      if (!(await g.usuarioAtivo(e.usuario))) throw recusaConfiguracaoSus('sus-permissao-usuario-invalido');
      if (!(await g.setorDoEstabelecimento(e.setor)))
        throw recusaConfiguracaoSus('sus-permissao-setor-invalido');
      const existentes = (await g.permissoes(e.usuario)).map(vigencia);
      const r = recusaIncluirPermissaoSetorSus(
        { setor: e.setor, tipo: e.tipo, vigenciaInicio: e.vigenciaInicio, vigenciaFim: e.vigenciaFim },
        existentes,
      );
      if (r) throw recusaConfiguracaoSus(r);
      const id = await g.incluirPermissao(e);
      g.trilha({
        evento: 'faturamento.sus.permissaoSetor.incluida',
        operacao: 'faturamento.sus.incluirPermissaoSetor',
        tabela: 'permissao_setor_sus',
        id: String(id),
        diferenca: `usuario=${e.usuario};setor=${e.setor};tipo=${e.tipo};inicio=${e.vigenciaInicio};fim=${e.vigenciaFim ?? ''}`,
      });
      const p = await g.permissao(id);
      if (!p) throw new Error('Permissão incluída e não lida.');
      return this.permissaoLida(p, s.hoje);
    });
  }

  async encerrarPermissao(
    s: SessaoConfiguracaoSus,
    id: number,
    e: EncerrarPermissaoSetorSusEntrada,
  ): Promise<PermissaoSetorSusLida> {
    return this.porta.gravar(s, async (g) => {
      const p = await g.permissao(id);
      if (!p) throw new ErroProblema('nao-encontrado', 404, 'Permissão não encontrada');
      if (versaoSus(p.versao) !== e.versao) throw alterado('A permissão');
      const r = recusaEncerrarPermissaoSetorSus(vigencia(p), e.vigenciaFim);
      if (r) throw recusaConfiguracaoSus(r);
      if (!(await g.encerrarPermissao(id, e.vigenciaFim, p.versao))) throw alterado('A permissão');
      g.trilha({
        evento: 'faturamento.sus.permissaoSetor.encerrada',
        operacao: 'faturamento.sus.encerrarPermissaoSetor',
        tabela: 'permissao_setor_sus',
        id: String(id),
        diferenca: `fim=${p.vigenciaFim ?? ''}->${e.vigenciaFim}`,
      });
      const depois = await g.permissao(id);
      if (!depois) throw new Error('Permissão encerrada e não lida.');
      return this.permissaoLida(depois, s.hoje);
    });
  }

  async gravarParametros(
    s: SessaoConfiguracaoSus,
    instrumento: InstrumentoParametroSus,
    e: GravarParametrosInstrumentoSusEntrada,
  ): Promise<ParametrosInstrumentoSus> {
    const n = normalizarParametrosSus(instrumento, e.campos);
    if (n.erros.length) throw recusaConfiguracaoSus('sus-parametro-invalido', { erros: n.erros });
    return this.porta.gravar(s, async (g) => {
      const antes = (await g.parametros()).find((x) => x.instrumento === instrumento) ?? null;
      const versao = e.versao === null ? null : Number(e.versao);
      if (!(await g.gravarParametros(instrumento, n.campos, versao))) throw alterado('O parâmetro');
      const mudaram = (Object.keys(n.campos) as (keyof CamposParametroSus)[]).filter(
        (k) => (antes?.campos[k] ?? null) !== n.campos[k],
      );
      g.trilha({
        evento: 'faturamento.sus.parametroInstrumento.gravado',
        operacao: 'faturamento.sus.gravarParametroInstrumento',
        tabela: 'parametro_instrumento_sus',
        id: instrumento,
        diferenca: `instrumento=${instrumento};campos=${mudaram.join(',')}`,
      });
      const lidos = this.parametrosLidos(await g.parametros());
      return lidos.find((x) => x.instrumento === instrumento)!;
    });
  }
}
