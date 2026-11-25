// Regra de campo do cadastro na abertura do atendimento (F3.1, 02-CAD linha 2). A conferência roda DENTRO da
// transação que abre o atendimento (recepção ambulatorial, pronto atendimento, exames): lê as regras de campo ativas do
// estabelecimento e da rede e os dados atuais do cadastro do paciente, e recusa com os campos que faltam no escopo
// (módulo de recepção, tipo de atendimento e fonte pagadora). Recusada, nada do atendimento é gravado. A regra é a do
// domínio (recusaAberturaPorCadastro); aqui só a leitura. O cadastro provisório (paciente não identificado da
// urgência) não é barrado: a identificação fica pendente. A admissão da internação (internacao.internar) confere do
// mesmo jeito, com o tipo "internacao". O módulo de recepção sai da origem da abertura (moduloDaAbertura, no domínio):
// o local em que a recepção abre, o local da marcação da agenda ou da senha chamada, o módulo informado, o canal de
// entrada (modulo_recepcao.canal_entrada) e o guichê que o usuário ocupa na sessão.
import {
  canalDaAbertura,
  type ModuloDaAbertura,
  moduloDaAbertura,
  recusaAberturaPorCadastro,
  type TipoAtendimentoRegra,
  tipoAtendimentoDaAbertura,
} from '@sgh/dominio-cadastro';
import { type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import {
  lerDadosDoCadastro,
  lerRegrasCampoAtivas,
  moduloRecepcaoDoLocal,
} from './ficha-complementar-proprio.js';

export interface EscopoDaAbertura {
  readonly estabelecimento: number;
  readonly paciente: number;
  /** Código do tipo com que a recepção abre (consulta, pa, exame, requisicaoLab, internacao). */
  readonly tipo: string;
  readonly fontePagadora: number | null;
  /**
   * Local de atendimento em que a recepção abre (a senha chamada no guichê traz o local): o módulo de recepção do
   * local é o escopo da regra, sem a tela precisar informá-lo.
   */
  readonly local?: number | null;
  /** Módulo de recepção informado à parte: vale depois do local e da origem registrada (marcação, senha). */
  readonly modulo?: number | null;
  /** Marcação da agenda de onde a abertura vem (o local do horário dá o módulo; o canal é a agenda). */
  readonly marcacao?: number | null;
  /** Senha da recepção de onde a abertura vem (o local da senha ou do guichê que a chamou dá o módulo). */
  readonly senha?: number | null;
  /** Usuário da sessão (o guichê que ele ocupa dá o módulo na agenda e na demanda espontânea). */
  readonly usuario?: number | null;
  /** Cadastro provisório (paciente ainda não identificado): a abertura não é barrada. */
  readonly provisorio?: boolean;
}

/** Recusa (`cadastro-incompleto`, com os campos do cadastro que faltam) a abertura do atendimento no escopo. */
export async function conferirCadastroNaAbertura(l: Leitor | TxOperacao, e: EscopoDaAbertura): Promise<void> {
  if (e.provisorio) return;
  const regras = await lerRegrasCampoAtivas(l, e.estabelecimento);
  if (regras.length === 0) return;
  const r = recusaAberturaPorCadastro(
    regras,
    {
      estabelecimento: e.estabelecimento,
      modulo: (
        await moduloRecepcaoDaAbertura(l, e.estabelecimento, {
          ...e,
          tipoAtendimento: tipoAtendimentoDaAbertura(e.tipo),
        })
      ).modulo,
      tipoAtendimento: tipoAtendimentoDaAbertura(e.tipo),
      fontePagadora: e.fontePagadora,
    },
    await lerDadosDoCadastro(l, e.paciente),
  );
  if (r) throw recusa(r.codigo, r.detalhe, { campos: [...r.campos] });
}

const idOuNulo = (v: unknown): number | null => {
  const n = v === null || v === undefined ? NaN : Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export interface OrigemDaAbertura {
  readonly tipoAtendimento: TipoAtendimentoRegra | null;
  readonly local?: number | null;
  readonly marcacao?: number | null;
  readonly senha?: number | null;
  readonly modulo?: number | null;
  readonly usuario?: number | null;
}

/**
 * O módulo de recepção da abertura pela origem (a mesma resolução na gravação e no aviso prévio da tela): lê o módulo
 * de cada fonte no banco e o domínio escolhe (moduloDaAbertura). Só módulos ativos; locais do estabelecimento.
 */
export async function moduloRecepcaoDaAbertura(
  l: Leitor | TxOperacao,
  estabelecimento: number,
  o: OrigemDaAbertura,
): Promise<ModuloDaAbertura> {
  const canal = canalDaAbertura({
    tipoAtendimento: o.tipoAtendimento,
    marcacao: idOuNulo(o.marcacao) !== null,
  });
  const umModulo = async (sql: string, p: readonly unknown[]) => idOuNulo((await l.uma(sql, p))?.['m']);
  const local = await moduloRecepcaoDoLocal(l, estabelecimento, o.local);
  const marcacao =
    idOuNulo(o.marcacao) === null
      ? null
      : await umModulo(
          `SELECT la.modulo_recepcao_id AS m
             FROM marcacao_horario mh JOIN horario_agenda ha ON ha.id = mh.horario_agenda_id
             JOIN local_atendimento la ON la.id = ha.local_atendimento_id AND la.estabelecimento_id = mh.estabelecimento_id
            WHERE mh.id = ? AND mh.estabelecimento_id = ? AND mh.excluido_em IS NULL AND la.excluido_em IS NULL`,
          [o.marcacao, estabelecimento],
        );
  const senha =
    idOuNulo(o.senha) === null
      ? null
      : await umModulo(
          `SELECT COALESCE(lg.modulo_recepcao_id, ls.modulo_recepcao_id) AS m
             FROM senha_emitida se
             LEFT JOIN guiche_recepcao gr ON gr.id = se.guiche_recepcao_id AND gr.excluido_em IS NULL
             LEFT JOIN local_atendimento lg ON lg.id = gr.local_atendimento_id AND lg.estabelecimento_id = se.estabelecimento_id
                   AND lg.excluido_em IS NULL
             LEFT JOIN local_atendimento ls ON ls.id = se.local_atendimento_id AND ls.estabelecimento_id = se.estabelecimento_id
                   AND ls.excluido_em IS NULL
            WHERE se.id = ? AND se.estabelecimento_id = ? AND se.excluido_em IS NULL`,
          [o.senha, estabelecimento],
        );
  const doCanal = await umModulo('SELECT id AS m FROM modulo_recepcao WHERE canal_entrada = ? AND ativo', [
    canal,
  ]);
  const guiche =
    idOuNulo(o.usuario) === null
      ? null
      : await umModulo(
          `SELECT la.modulo_recepcao_id AS m
             FROM ocupacao_guiche og JOIN guiche_recepcao gr ON gr.id = og.guiche_recepcao_id AND gr.excluido_em IS NULL
             JOIN local_atendimento la ON la.id = COALESCE(og.local_atendimento_id, gr.local_atendimento_id)
                   AND la.estabelecimento_id = ? AND la.excluido_em IS NULL
            WHERE og.ocupante_usuario_id = ? AND og.fim_em IS NULL
            ORDER BY og.inicio_em DESC, og.id DESC LIMIT 1`,
          [estabelecimento, o.usuario],
        );
  const ativo = async (m: number | null) =>
    m === null ? null : await umModulo('SELECT id AS m FROM modulo_recepcao WHERE id = ? AND ativo', [m]);
  return moduloDaAbertura({
    canal,
    local: await ativo(local),
    marcacao: await ativo(marcacao),
    senha: await ativo(senha),
    informado: await ativo(idOuNulo(o.modulo)),
    doCanal,
    guiche: await ativo(guiche),
  });
}
