// Registro dos serviços compartilhados da Rede (M57, etapa 3; ficha, seção 7 "Serviços compartilhados (registro)";
// regra 11; DP-14 decidida: catálogos e cadastros por estabelecimento, cada um no seu banco): oportunidades registradas
// sem compromisso de escopo (catálogo, fornecedores, compras, laudos). Cada registro mora no banco do estabelecimento
// em que foi feito; a lista da Rede lê cada banco em separado (nenhuma consulta cruza os bancos) e junta em memória.
//   - Regra 12: só os estabelecimentos da rede da sessão (lista configurada); os envolvidos têm de ser da rede.
//   - A chave `rede.bi` vale por estabelecimento: o desligado fica fora da lista e não recebe gravação.
//   - Sessão "como": alterar um registro de OUTRO banco é recusado (`como-entre-bancos`, como no MPI, D-COMO-57); no
//     banco da sessão, vale o "como" de sempre (imagem antes/depois na transação).
import {
  type AlterarServicoCompartilhado,
  type ConsultaServicosRede,
  EVENTOS_AUDITAVEIS,
  type ListaServicosRede,
  type NovoServicoCompartilhado,
  type ServicoCompartilhado,
} from '@sgh/contratos';
import { ErroIsolamentoRede, estabelecimentosDaRede } from '@sgh/dominio-rede';
import { type LinhaTrilha, type MudancaServicoParaGravar, TETO_SERVICOS_POR_BANCO } from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import type { PortaServicosRede } from './porta.js';

export interface SessaoServicosRede {
  readonly rede: string;
  readonly hospital: string;
  readonly login: string;
  readonly como: boolean;
  /** A chave `rede.bi` em cada estabelecimento (o da sessão já foi conferido pelo controlador). */
  readonly liberados: ReadonlySet<string>;
  /** A linha da trilha de uma gravação (o banco é o do registro). */
  trilha(evento: string, operacao: string, id: number | null): LinhaTrilha;
}

export interface ListaDaRedeServicos {
  redeConfigurada(): string | null;
  estabelecimentos(): readonly { codigo: string; nome: string }[];
}

/** Só os campos informados (sem `undefined`); a descrição vazia vira null. */
function mudancaParaGravar(m: AlterarServicoCompartilhado): MudancaServicoParaGravar {
  return {
    ...(m.area !== undefined ? { area: m.area } : {}),
    ...(m.titulo !== undefined ? { titulo: m.titulo } : {}),
    ...(m.descricao !== undefined ? { descricao: m.descricao.trim() ? m.descricao.trim() : null } : {}),
    ...(m.estabelecimentos !== undefined ? { estabelecimentos: m.estabelecimentos } : {}),
    ...(m.situacao !== undefined ? { situacao: m.situacao } : {}),
  };
}

function foraDaRede(detalhe: string, codigo = 'fora-da-rede'): ErroProblema {
  return new ErroProblema('sem-permissao', 403, 'Fora da rede', detalhe, { codigo });
}

export class ServicoServicosRede {
  constructor(
    private readonly porta: PortaServicosRede,
    private readonly lista: ListaDaRedeServicos,
  ) {}

  /** Regra 12: os estabelecimentos da rede da sessão, recusa antes de qualquer leitura. */
  private daRede(s: SessaoServicosRede): { codigo: string; nome: string }[] {
    let codigos: readonly string[];
    try {
      codigos = estabelecimentosDaRede({
        redeSessao: s.rede,
        redeConfigurada: this.lista.redeConfigurada(),
        estabelecimentos: this.lista.estabelecimentos().map((e) => e.codigo),
      });
    } catch (e) {
      if (e instanceof ErroIsolamentoRede)
        throw foraDaRede(
          e.codigo === 'rede-ausente'
            ? 'O registro da Rede precisa do código da rede da sessão.'
            : 'A rede da sessão não é a desta configuração.',
          e.codigo,
        );
      throw e;
    }
    if (!codigos.includes(s.hospital))
      throw foraDaRede('O estabelecimento da sessão não é um estabelecimento desta rede.');
    const nomes = new Map(this.lista.estabelecimentos().map((e) => [e.codigo, e.nome]));
    return codigos.map((codigo) => ({ codigo, nome: nomes.get(codigo) ?? codigo }));
  }

  private conferirEnvolvidos(ests: readonly string[], daRede: readonly { codigo: string }[]): void {
    const s = new Set(daRede.map((e) => e.codigo));
    const fora = ests.filter((e) => !s.has(e));
    if (fora.length > 0)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Estabelecimento fora da rede',
        'Os estabelecimentos envolvidos têm de ser desta rede.',
        { campos: ['estabelecimentos'] },
      );
  }

  /**
   * A lista da Rede: os `ate` mais recentes de cada banco, juntos em memória. A junção só é exata até o teto de
   * leitura por banco (os N mais recentes da Rede estão entre os N mais recentes de cada banco), então o total
   * paginável é o teto, e a lista avisa (`truncado`) quando havia mais; a página além do teto já é recusada no contrato.
   */
  async listar(s: SessaoServicosRede, q: ConsultaServicosRede): Promise<ListaServicosRede> {
    const daRede = this.daRede(s);
    if ((q.pagina - 1) * q.porPagina >= TETO_SERVICOS_POR_BANCO)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Página fora da lista',
        `A lista mostra só os ${TETO_SERVICOS_POR_BANCO} registros mais recentes; refine pelos filtros ou pela busca.`,
        { campos: ['pagina'] },
      );
    const ate = Math.min(q.pagina * q.porPagina, TETO_SERVICOS_POR_BANCO);
    const itens: ServicoCompartilhado[] = [];
    const foraDoAr: string[] = [];
    let total = 0;
    for (const e of daRede) {
      if (!s.liberados.has(e.codigo)) continue;
      try {
        const r = await this.porta.listar(
          { rede: s.rede, hospital: e.codigo },
          {
            ...(q.area ? { area: q.area } : {}),
            ...(q.situacao ? { situacao: q.situacao } : {}),
            ...(q.busca ? { busca: q.busca } : {}),
            ate,
          },
        );
        itens.push(...r.itens.map((x) => ({ ...x, estabelecimentos: [...x.estabelecimentos] })));
        total += r.total;
      } catch {
        foraDoAr.push(e.codigo);
      }
    }
    itens.sort(
      (a, b) =>
        b.registradoEm.localeCompare(a.registradoEm) ||
        a.estabelecimento.localeCompare(b.estabelecimento) ||
        b.id - a.id,
    );
    const inicio = (q.pagina - 1) * q.porPagina;
    return {
      itens: itens.slice(inicio, inicio + q.porPagina),
      total: Math.min(total, TETO_SERVICOS_POR_BANCO),
      truncado: total > TETO_SERVICOS_POR_BANCO,
      estabelecimentos: daRede.filter((e) => s.liberados.has(e.codigo)),
      foraDoAr,
    };
  }

  /** Registra no banco do estabelecimento da sessão. */
  async registrar(s: SessaoServicosRede, novo: NovoServicoCompartilhado): Promise<ServicoCompartilhado> {
    const daRede = this.daRede(s);
    this.conferirEnvolvidos(novo.estabelecimentos, daRede);
    const r = await this.porta.registrar(
      { rede: s.rede, hospital: s.hospital },
      {
        area: novo.area,
        titulo: novo.titulo,
        descricao: novo.descricao?.trim() ? novo.descricao.trim() : null,
        estabelecimentos: novo.estabelecimentos,
      },
      s.login,
      s.trilha(EVENTOS_AUDITAVEIS.redeServicoRegistrado.codigo, 'rede.registrarServicoCompartilhado', null),
    );
    return { ...r, estabelecimentos: [...r.estabelecimentos] };
  }

  /** Altera o registro no banco em que ele mora (só o que mudou; repetir não grava). */
  async alterar(
    s: SessaoServicosRede,
    estabelecimento: string,
    id: number,
    m: AlterarServicoCompartilhado,
  ): Promise<{ registro: ServicoCompartilhado; mudou: boolean }> {
    const daRede = this.daRede(s);
    if (!daRede.some((e) => e.codigo === estabelecimento))
      throw foraDaRede('O registro é de um estabelecimento fora da rede desta sessão.');
    if (!s.liberados.has(estabelecimento))
      throw new ErroProblema(
        'recurso-desligado',
        403,
        'Funcionalidade desligada',
        'O BI da Rede ainda não foi liberado no estabelecimento deste registro.',
        { codigo: 'recurso-desligado' },
      );
    if (s.como && estabelecimento !== s.hospital)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sessão de suporte',
        'Numa sessão de suporte, só os registros do estabelecimento desta sessão podem ser alterados (o Corrigir do suporte só alcança este banco).',
        { codigo: 'como-entre-bancos' },
      );
    if (m.estabelecimentos) this.conferirEnvolvidos(m.estabelecimentos, daRede);
    const r = await this.porta.alterar(
      { rede: s.rede, hospital: estabelecimento },
      id,
      mudancaParaGravar(m),
      s.login,
      s.trilha(EVENTOS_AUDITAVEIS.redeServicoAlterado.codigo, 'rede.alterarServicoCompartilhado', id),
    );
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Registro não encontrado');
    return { registro: { ...r.depois, estabelecimentos: [...r.depois.estabelecimentos] }, mudou: r.mudou };
  }
}
