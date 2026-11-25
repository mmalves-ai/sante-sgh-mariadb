// Valores habituais da abertura do atendimento sobre o banco do cliente (padrao_abertura_atendimento): a leitura dos
// dois escopos (o do estabelecimento e o do usuário da sessão), com o nome de cada item e se ele ainda pode ser usado
// na abertura, e a gravação de um escopo.
// Melhoria: a linha nunca é apagada (limpar grava nulo no campo, e a trilha guarda quem mudou o quê); o item tem de
// existir e estar em uso no estabelecimento na hora da gravação; a gravação trava a linha do estabelecimento (duas
// estações não incluem o mesmo escopo) e a coluna escopo_unico garante a unicidade no banco; o controle otimista é a
// versão da linha do escopo (0: ainda sem linha).
import {
  CAMPOS_PADRAO_ABERTURA,
  type CampoPadraoAbertura,
  type DefinirPadraoAberturaEntrada,
  esquemaDefinirPadraoAbertura,
} from '@sgh/contratos';
import { type ItemPadrao, mudancasDoPadrao, type PadraoAbertura } from '@sgh/dominio-atendimento';
import { definirOperacao, ErroOperacao, type Leitor, type Linha, recusa, type TxOperacao } from '@sgh/nucleo';

const TABELA = 'padrao_abertura_atendimento';
const COLUNA: Readonly<Record<CampoPadraoAbertura, string>> = {
  unidade: 'unidade_assistencial_id',
  centroCusto: 'centro_custo_id',
  convenio: 'fonte_pagadora_id',
  especialidade: 'especialidade_medica_id',
};
/** O item pode ser usado na abertura deste estabelecimento? (uma linha: pode; nenhuma: não existe ou não está em uso) */
const SQL_VALE: Readonly<Record<CampoPadraoAbertura, { sql: string; doEstabelecimento: boolean }>> = {
  unidade: {
    sql: 'SELECT id FROM unidade_assistencial WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
    doEstabelecimento: true,
  },
  centroCusto: {
    sql: 'SELECT id FROM centro_custo WHERE id = ? AND estabelecimento_id = ? AND analitico AND ativo AND excluido_em IS NULL',
    doEstabelecimento: true,
  },
  convenio: {
    sql: "SELECT id FROM fonte_pagadora WHERE id = ? AND situacao = 'ativa' AND excluido_em IS NULL",
    doEstabelecimento: false,
  },
  especialidade: {
    sql: 'SELECT id FROM especialidade_medica WHERE id = ? AND ativo',
    doEstabelecimento: false,
  },
};

const SQL_LER = `SELECT p.id, p.usuario_id, p.versao,
    p.unidade_assistencial_id AS unidade, ua.nome AS unidade_rotulo,
    COALESCE(ua.ativo AND ua.excluido_em IS NULL AND ua.estabelecimento_id = p.estabelecimento_id, 0) AS unidade_vale,
    p.centro_custo_id AS centroCusto, cc.nome AS centroCusto_rotulo,
    COALESCE(cc.ativo AND cc.analitico AND cc.excluido_em IS NULL AND cc.estabelecimento_id = p.estabelecimento_id, 0)
      AS centroCusto_vale,
    p.fonte_pagadora_id AS convenio, fp.nome AS convenio_rotulo,
    COALESCE(fp.situacao = 'ativa' AND fp.excluido_em IS NULL, 0) AS convenio_vale,
    p.especialidade_medica_id AS especialidade, em.descricao AS especialidade_rotulo,
    COALESCE(em.ativo, 0) AS especialidade_vale
  FROM padrao_abertura_atendimento p
  LEFT JOIN unidade_assistencial ua ON ua.id = p.unidade_assistencial_id
  LEFT JOIN centro_custo cc ON cc.id = p.centro_custo_id
  LEFT JOIN fonte_pagadora fp ON fp.id = p.fonte_pagadora_id
  LEFT JOIN especialidade_medica em ON em.id = p.especialidade_medica_id
 WHERE p.estabelecimento_id = ? AND (p.usuario_id IS NULL OR p.usuario_id = ?)
 ORDER BY p.id`;

const idOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function escopoDaLinha(x: Linha): PadraoAbertura {
  const r: Partial<Record<CampoPadraoAbertura, ItemPadrao | null>> = {};
  for (const { campo } of CAMPOS_PADRAO_ABERTURA) {
    const id = idOuNulo(x[campo]);
    r[campo] =
      id === null
        ? null
        : { id, rotulo: String(x[`${campo}_rotulo`] ?? ''), vale: Number(x[`${campo}_vale`]) === 1 };
  }
  return r;
}

/** Os valores habituais lidos, por escopo, e a versão da linha de cada um (0: sem linha). */
export interface PadraoAberturaLido {
  readonly estabelecimento: PadraoAbertura | null;
  readonly pessoal: PadraoAbertura | null;
  readonly versaoEstabelecimento: number;
  readonly versaoPessoal: number;
}

export async function lerPadraoAbertura(
  l: Pick<Leitor, 'consultar'>,
  estabelecimento: number,
  usuario: number | null,
): Promise<PadraoAberturaLido> {
  const linhas = await l.consultar(SQL_LER, [estabelecimento, usuario], { teto: 10 });
  const doEst = linhas.find((x) => idOuNulo(x['usuario_id']) === null);
  const doUsuario = usuario === null ? undefined : linhas.find((x) => idOuNulo(x['usuario_id']) === usuario);
  return {
    estabelecimento: doEst ? escopoDaLinha(doEst) : null,
    pessoal: doUsuario ? escopoDaLinha(doUsuario) : null,
    versaoEstabelecimento: doEst ? Number(doEst['versao']) : 0,
    versaoPessoal: doUsuario ? Number(doUsuario['versao']) : 0,
  };
}

const ROTULO = Object.fromEntries(CAMPOS_PADRAO_ABERTURA.map((c) => [c.campo, c.rotulo])) as Record<
  CampoPadraoAbertura,
  string
>;

/** A gravação de um escopo: o do estabelecimento ou o do usuário da sessão. */
function operacaoDefinirPadrao(pessoal: boolean) {
  return definirOperacao({
    nome: pessoal ? 'atendimento.definir-meu-padrao-abertura' : 'atendimento.definir-padrao-abertura',
    tabelas: [TABELA],
    entrada: esquemaDefinirPadraoAbertura,
    acao: 'alteracao',
    async gravar(tx: TxOperacao, e: DefinirPadraoAberturaEntrada) {
      const est = tx.contexto.estabelecimento;
      if (est === null) throw recusa('estabelecimento-obrigatorio', 'Escolha o estabelecimento.');
      const usuario = pessoal ? tx.contexto.usuario : null;
      if (pessoal && usuario === null)
        throw recusa('usuario-obrigatorio', 'Os valores habituais pessoais exigem o usuário da sessão.');
      // Serializa as gravações do estabelecimento: o escopo que ainda não existe não tem linha para travar.
      await tx.consultarParaAtualizar('SELECT id FROM estabelecimento WHERE id = ?', [est], { teto: 1 });
      const linha =
        (
          await tx.consultarParaAtualizar(
            `SELECT id, versao, unidade_assistencial_id, centro_custo_id, fonte_pagadora_id, especialidade_medica_id
               FROM padrao_abertura_atendimento WHERE estabelecimento_id = ? AND usuario_id <=> ?`,
            [est, usuario],
            { teto: 1 },
          )
        )[0] ?? null;
      if ((linha ? Number(linha['versao']) : 0) !== e.versao)
        throw new ErroOperacao(
          409,
          'conflito-versao',
          'Valores habituais alterados em outra estação',
          'Os valores habituais mudaram desde a leitura. Releia e confira antes de salvar.',
        );
      const atual = Object.fromEntries(
        CAMPOS_PADRAO_ABERTURA.map((c) => [c.campo, linha ? idOuNulo(linha[COLUNA[c.campo]]) : null]),
      ) as Record<CampoPadraoAbertura, number | null>;
      const mudancas = mudancasDoPadrao(atual, e.valores);
      if (mudancas.length === 0) throw recusa('nada-a-alterar', 'Nada a alterar.');
      for (const m of mudancas) {
        if (m.depois === null) continue;
        const v = SQL_VALE[m.campo];
        if (!(await tx.uma(v.sql, v.doEstabelecimento ? [m.depois, est] : [m.depois])))
          throw recusa(
            'padrao-invalido',
            `${ROTULO[m.campo]}: o item escolhido não existe ou não está em uso neste estabelecimento.`,
          );
      }
      const valores = Object.fromEntries(mudancas.map((m) => [COLUNA[m.campo], m.depois]));
      let id: number;
      let versao: number;
      if (linha) {
        id = Number(linha['id']);
        versao = await tx.alterar(TABELA, id, Number(linha['versao']), valores);
      } else {
        id = await tx.incluir(TABELA, { estabelecimento_id: est, usuario_id: usuario, ...valores });
        versao = 1;
      }
      // O que mudou vai à trilha da operação (dados_depois.resultado.mudancas, como JSON: o resultado é plano).
      return {
        id,
        versao,
        escopo: pessoal ? 'usuario' : 'estabelecimento',
        campos: mudancas.map((m) => m.campo).join(','),
        mudancas: JSON.stringify(mudancas),
      };
    },
    alvo: (_e, r) => ({ tabela: TABELA, id: Number(r['id']) }),
  });
}

export const OPERACAO_DEFINIR_PADRAO_ABERTURA = operacaoDefinirPadrao(false);
export const OPERACAO_DEFINIR_MEU_PADRAO_ABERTURA = operacaoDefinirPadrao(true);
