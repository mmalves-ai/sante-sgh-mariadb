// W0-09 (programa CRUD completo; script 1122): o ciclo de vida dos registros de governança da implantação. Cada
// mudança é FATO NOVO com motivo: o motivo e o valor anterior vão à SGH_CRUD_EVENTO e quem/quando/estação à SGH_TRILHA,
// na mesma transação SGH_ (nada do outro sistema é tocado):
//   - voltar a pendente o item do critério de liberação (qualquer onda) ou da checklist do desligamento (este com a
//     senha de novo, pelo controlador);
//   - estornar a conclusão de treinamento (a conclusão fica; deixa de contar). Ninguém estorna a própria;
//   - retirar a versão da trilha: sem vínculo, exclusão física com retrato (SGH_HIST_EXCLUSAO); com turmas ou
//     conclusões (o mapa de dependências de packages/legado), 409 com a contagem e a oferta de inativar; a inativação
//     ('retirada') pede o pedido explícito. Retirada a vigente, a anterior mais nova volta a vigente.
import {
  esquemaEstornarConclusao,
  esquemaRetirarVersaoTrilha,
  esquemaVoltarItemDesligamentoPendente,
  esquemaVoltarItemPendente,
  EVENTOS_AUDITAVEIS,
  INVENTARIO_DESLIGAMENTO,
  PAPEIS_TREINAMENTO,
  type ResultadoRetirarVersaoTrilha,
} from '@sgh/contratos';
import { ITENS_LIGAR_CALCULADOS, totalVinculosTrilhaCoex } from '@sgh/legado';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../../autorizacao/estacao.js';
import { ErroProblema } from '../../../problema.filter.js';
import { linhaTrilha, type SessaoCadastro } from '../../cadastro/comum.js';
import type { EventoCicloCoex, PortaCoexistencia } from '../porta.js';

const invalido = (issues: readonly { message: string }[], detalhe: string) =>
  new ErroProblema('entrada-invalida', 400, 'Dados inválidos', issues[0]?.message ?? detalhe);
const recusa = (titulo: string, detalhe: string, codigo: string, extras: Record<string, unknown> = {}) =>
  new ErroProblema('recusa-de-negocio', 409, titulo, detalhe, { codigo, ...extras });
const naoEncontrado = (titulo: string) => new ErroProblema('nao-encontrado', 404, titulo);

const CODIGO = /^[a-z0-9][a-z0-9-]{0,39}$/;

export class ServicoCicloCoex {
  constructor(private readonly porta: PortaCoexistencia) {}

  private evento(
    s: SessaoCadastro,
    e: Omit<EventoCicloCoex, 'idempotencia' | 'estacao' | 'usuario'>,
  ): EventoCicloCoex {
    return {
      ...e,
      idempotencia: correlacaoDaRequisicao(s.req, e.operacao).slice(0, 80),
      estacao: estacaoDaRequisicao(s.req).slice(0, 80),
      usuario: s.login,
    };
  }

  /** Volta o item do critério de liberação do setor a pendente, com motivo. */
  async voltarItemCriterioPendente(
    s: SessaoCadastro,
    setor: string,
    item: string,
    corpo: unknown,
  ): Promise<{ setor: string; item: string; situacao: 'pendente' }> {
    if (!CODIGO.test(setor) || !CODIGO.test(item)) throw naoEncontrado('Item não encontrado');
    if (ITENS_LIGAR_CALCULADOS.includes(item))
      throw recusa(
        'Item calculado',
        'Este item é calculado pelo sistema: não se registra.',
        'item-calculado',
      );
    const p = esquemaVoltarItemPendente.safeParse(corpo);
    if (!p.success) throw invalido(p.error.issues, 'Informe o motivo.');
    const chave = `${s.porta.hospital}:${setor}:${item}`.slice(0, 120);
    await this.porta.gravarSgh(
      s.porta,
      linhaTrilha(
        s,
        EVENTOS_AUDITAVEIS.coexistenciaItemVoltouPendente.codigo,
        'config.coexistencia',
        `criterio:${setor}:${item}:pendente`.slice(0, 80),
        { tabela: 'SGH_CFG_COEX_LIGAR', id: null, chave },
      ),
      async (g) => {
        const anterior = await g.voltarItemLigarPendente(setor, item, s.login);
        if (!anterior)
          throw recusa(
            'Item já pendente',
            'O item não está registrado como cumprido nem como "não se aplica": não há o que voltar.',
            'item-ja-pendente',
          );
        await g.registrarEvento(
          this.evento(s, {
            operacao: 'coexistencia.criterio.pendente',
            recurso: 'config.coexistencia',
            evento: 'alterado',
            tabela: 'SGH_CFG_COEX_LIGAR',
            chave,
            motivo: p.data.motivo,
            valorAnterior: { ...anterior },
          }),
        );
      },
    );
    return { setor, item, situacao: 'pendente' };
  }

  /** Volta o item da checklist do desligamento a pendente, com motivo (a senha é conferida pelo controlador). */
  async voltarItemDesligamentoPendente(
    s: SessaoCadastro,
    item: string,
    corpo: unknown,
  ): Promise<{ item: string; situacao: 'pendente' }> {
    if (!INVENTARIO_DESLIGAMENTO.some((i) => i.id === item)) throw naoEncontrado('Item fora do inventário');
    const p = esquemaVoltarItemDesligamentoPendente.safeParse(corpo);
    if (!p.success) throw invalido(p.error.issues, 'Informe o motivo.');
    const chave = `${s.porta.hospital}:${item}`.slice(0, 120);
    await this.porta.gravarSgh(
      s.porta,
      linhaTrilha(
        s,
        EVENTOS_AUDITAVEIS.coexistenciaItemVoltouPendente.codigo,
        'config.desligamento',
        `desligamento:${item}:pendente`.slice(0, 80),
        { tabela: 'SGH_CFG_COEX_DESLIG', id: null, chave },
      ),
      async (g) => {
        const anterior = await g.voltarItemDesligamentoPendente(item, s.login);
        if (!anterior)
          throw recusa(
            'Item já pendente',
            'O item ainda não tem registro do substituto nem do aceite da área: não há o que voltar.',
            'item-ja-pendente',
          );
        await g.registrarEvento(
          this.evento(s, {
            operacao: 'coexistencia.desligamento.pendente',
            recurso: 'config.desligamento',
            evento: 'alterado',
            tabela: 'SGH_CFG_COEX_DESLIG',
            chave,
            motivo: p.data.motivo,
            valorAnterior: { ...anterior },
          }),
        );
      },
    );
    return { item, situacao: 'pendente' };
  }

  /** Estorna a conclusão de treinamento (fato novo; a conclusão fica e deixa de contar). */
  async estornarConclusao(
    s: SessaoCadastro,
    id: string,
    corpo: unknown,
  ): Promise<{ id: string; estornada: true }> {
    if (!/^\d{1,18}$/.test(id)) throw naoEncontrado('Conclusão não encontrada');
    const p = esquemaEstornarConclusao.safeParse(corpo);
    if (!p.success) throw invalido(p.error.issues, 'Informe o motivo.');
    await this.porta.gravarSgh(
      s.porta,
      linhaTrilha(
        s,
        EVENTOS_AUDITAVEIS.coexistenciaTreinoEstornado.codigo,
        'config.coexistencia',
        'treino:estorno',
        { tabela: 'SGH_CFG_COEX_TREINO', id, chave: null },
      ),
      async (g) => {
        const c = await g.lerConclusaoParaEstorno(id);
        if (!c) throw naoEncontrado('Conclusão não encontrada');
        if (c.estornadaEm)
          throw recusa(
            'Conclusão já estornada',
            'Esta conclusão já foi estornada.',
            'conclusao-ja-estornada',
          );
        if (c.login.toUpperCase() === s.login.toUpperCase())
          throw recusa(
            'Conclusão da própria pessoa',
            'Ninguém estorna a própria conclusão do treinamento (segregação de funções).',
            'a-si-mesmo',
          );
        await g.estornarConclusao(id, p.data.motivo, s.login);
        await g.registrarEvento(
          this.evento(s, {
            operacao: 'coexistencia.treino.estorno',
            recurso: 'config.coexistencia',
            evento: 'inativado',
            tabela: 'SGH_CFG_COEX_TREINO',
            chave: id,
            motivo: p.data.motivo,
            valorAnterior: { ...c },
          }),
        );
      },
    );
    return { id, estornada: true };
  }

  /**
   * Retira a versão da trilha: sem vínculos, exclusão física (com retrato); com turmas ou conclusões, 409 com a
   * contagem e a oferta de inativar (`inativar: true` no pedido seguinte).
   */
  async retirarVersaoTrilha(
    s: SessaoCadastro,
    papel: string,
    onda: string,
    versao: string,
    corpo: unknown,
  ): Promise<ResultadoRetirarVersaoTrilha> {
    if (!(PAPEIS_TREINAMENTO as readonly string[]).includes(papel))
      throw naoEncontrado('Papel não encontrado');
    const v = { papel, onda: Number(onda), versao: Number(versao) };
    if (!Number.isInteger(v.onda) || v.onda < 0 || v.onda > 5 || !Number.isInteger(v.versao) || v.versao < 1)
      throw naoEncontrado('Versão não encontrada');
    const p = esquemaRetirarVersaoTrilha.safeParse(corpo);
    if (!p.success) throw invalido(p.error.issues, 'Informe o motivo.');
    const inativar = p.data.inativar === true;
    const chave = `${papel}:${v.onda}:${v.versao}`;
    return this.porta.gravarSgh(
      s.porta,
      (r: ResultadoRetirarVersaoTrilha) =>
        linhaTrilha(
          s,
          EVENTOS_AUDITAVEIS.coexistenciaTrilhaRetirada.codigo,
          'config.coexistencia',
          `trilha:${r.resultado}`,
          { tabela: 'SGH_CFG_COEX_TRILHA', id: null, chave },
        ),
      async (g) => {
        const atual = await g.lerVersaoTrilha(v);
        if (!atual) throw naoEncontrado('Versão não encontrada');
        if (atual.situacao === 'retirada')
          throw recusa('Versão já retirada', 'Esta versão da trilha já foi retirada.', 'trilha-ja-retirada');
        const vinculos = await g.contarVinculosTrilha(v);
        if (!inativar && vinculos.length > 0) {
          // As turmas agrupam as mesmas conclusões: aparecem nos dependentes, fora do total (revisão W0-09).
          const total = totalVinculosTrilhaCoex(vinculos);
          throw recusa(
            'Versão com vínculos',
            `A versão tem ${vinculos.map((x) => `${x.quantidade} ${x.grupo}`).join(' e ')}: não pode ser excluída. ` +
              'Inative a versão: ela fica visível com a história e não recebe conclusão nova.',
            'trilha-com-vinculos',
            {
              dependentes: vinculos.map((x) => ({
                rotulo: x.grupo,
                quantidade: x.quantidade,
                amostra: [],
                origem: 'fk' as const,
              })),
              total,
              podeInativar: true,
            },
          );
        }
        const modo = inativar ? 'inativar' : 'excluir';
        const operacao = `coexistencia.trilha.${modo === 'excluir' ? 'exclusao' : 'inativacao'}`;
        if (modo === 'excluir')
          await g.retratarVersaoTrilha(v, { operacao, motivo: p.data.motivo, usuario: s.login });
        const r = await g.retirarVersaoTrilha({ ...v, eraVigente: atual.situacao === 'vigente' }, modo);
        await g.registrarEvento(
          this.evento(s, {
            operacao,
            recurso: 'config.coexistencia',
            evento: modo === 'excluir' ? 'excluido' : 'inativado',
            tabela: 'SGH_CFG_COEX_TRILHA',
            chave,
            motivo: p.data.motivo,
            valorAnterior: { ...atual, vinculos },
          }),
        );
        return {
          ...v,
          resultado: modo === 'excluir' ? ('excluida' as const) : ('inativada' as const),
          promovida: r.promovida,
        };
      },
    );
  }
}
