// Turma do ambiente de treino (M37, regra 5): recria as contas fictícias da turma no banco próprio do cliente de
// treino, pelo Executor (trilha, idempotência e versão na mesma transação), com o acesso ao estabelecimento de treino e a
// senha inicial. Contas só de treino: o nome começa por "Turma de treino" e qualquer outro login com o mesmo nome é
// recusado (nunca reativa conta de pessoa real). Só roda em cliente de treino (treino_<código>).
// Melhoria: idempotente por login (reativa a conta existente em vez de criar outra), com validade de 7 dias e troca de
//   senha obrigatória no primeiro acesso; antes, cada reinício criava contas novas sem prazo.
// Melhoria: o vínculo ao estabelecimento de treino (usuario_estabelecimento, padrão, vigente até a validade da conta) e a
//   credencial inicial (credencial_usuario, resumo argon2id, troca obrigatória, mesma validade) ficam na mesma operação:
//   a conta recriada consegue entrar no hospital de treino.
// Melhoria: conta sem CPF por dispensa registrada (pessoa fictícia), conferida pela restrição ck_usuario_cpf_pessoa, com
//   o motivo da dispensa na trilha (o comentário de usuario.dispensa_cpf exige).
// Melhoria: a trava do cliente de treino mora aqui (antes só a linha de comando conferia).
// A senha inicial chega já resumida (cifrarSenha de @sgh/dominio-acesso, fora da transação); a senha em claro nunca entra
// na operação, na trilha nem no log.
import { randomUUID } from 'node:crypto';
import { definirOperacao, type Executor } from '@sgh/nucleo';
import { z } from 'zod';

export const NOME_TURMA = 'Turma de treino';
export const LOGIN_TURMA = /^[A-Za-z0-9._-]{3,60}$/;
export const VALIDADE_TURMA_DIAS = 7;
/** O cliente de treino no banco próprio: nunca outro cliente. */
export const CLIENTE_TREINO = /^treino_[a-z0-9_]{1,40}$/;
export const MOTIVO_DISPENSA_CPF =
  'Turma de treino: contas fictícias, sem pessoa real; CPF dispensado (dispensa_cpf).';

const entrada = z.object({
  logins: z.array(z.string().regex(LOGIN_TURMA)).min(1).max(200),
  validadeDias: z.number().int().min(1).max(31),
  /** Resumo argon2id da senha inicial (formato PHC); nunca a senha em claro. */
  resumoSenha: z
    .string()
    .max(255)
    .regex(/^\$argon2id\$v=19\$m=(\d{4,7}),t=\d{1,2},p=\d{1,2}\$[A-Za-z0-9+/]{16,}\$[A-Za-z0-9+/]{16,}$/)
    .refine(
      (x) => Number(/m=(\d+)/.exec(x)?.[1]) >= 8192,
      'Resumo de senha fraco (memória do argon2id abaixo de 8192).',
    ),
});
export type EntradaTurma = z.infer<typeof entrada>;

interface ContaLida {
  readonly id: number | string;
  readonly nome: string;
  readonly versao: number | string;
}

export class ErroTurma extends Error {
  override readonly name = 'ErroTurma';
}

const dia = (d: Date) => d.toISOString().slice(0, 10);

export const OPERACAO_RECRIAR_TURMA = definirOperacao({
  nome: 'treino.turma.recriar',
  tabelas: ['usuario', 'usuario_estabelecimento', 'credencial_usuario'],
  entrada,
  async gravar(tx, e, ctx) {
    const est = ctx.estabelecimento;
    if (est === null || est === undefined)
      throw new ErroTurma('A turma é recriada no estabelecimento de treino: informe o estabelecimento.');
    const agora = new Date();
    const expira = new Date(agora.getTime() + e.validadeDias * 86_400_000);
    let criados = 0;
    let reativados = 0;
    for (const login of [...new Set(e.logins)]) {
      // Sem o filtro de excluido_em de propósito: o login é único também entre as contas excluídas, e a conta de
      // treino excluída volta a valer (a exclusão é desfeita na alteração).
      const u = await tx.uma<ContaLida & Record<string, unknown>>(
        'SELECT id, nome, versao FROM usuario WHERE login = ?',
        [login],
      );
      let idUsuario: number;
      if (!u) {
        idUsuario = await tx.incluir('usuario', {
          login,
          nome: `${NOME_TURMA} ${login}`,
          tipo_conta: 'pessoa',
          dispensa_cpf: true,
          situacao: 'ativo',
          exige_troca_senha: true,
          expira_em: expira,
          origem: 'sistema',
        });
        criados++;
      } else {
        if (!String(u.nome).startsWith(NOME_TURMA))
          throw new ErroTurma(`Recusado: o login ${login} já existe e não é de turma de treino.`);
        idUsuario = Number(u.id);
        await tx.alterar('usuario', idUsuario, Number(u.versao), {
          situacao: 'ativo',
          bloqueado_em: null,
          tentativas_login_invalidas: 0,
          exige_troca_senha: true,
          expira_em: expira,
          excluido_em: null,
          excluido_por: null,
        });
        reativados++;
      }
      // Acesso ao estabelecimento de treino (padrão de entrada), vigente até a validade da conta.
      const v = await tx.uma<{ id: number | string; versao: number | string } & Record<string, unknown>>(
        `SELECT id, versao FROM usuario_estabelecimento WHERE usuario_id = ? AND estabelecimento_id = ?
          ORDER BY vigencia_inicio DESC, id DESC LIMIT 1`,
        [idUsuario, est],
      );
      if (!v)
        await tx.incluir('usuario_estabelecimento', {
          usuario_id: idUsuario,
          estabelecimento_id: est,
          padrao: true,
          vigencia_inicio: dia(agora),
          vigencia_fim: dia(expira),
        });
      else
        await tx.alterar('usuario_estabelecimento', Number(v.id), Number(v.versao), {
          padrao: true,
          vigencia_fim: dia(expira),
          excluido_em: null,
          excluido_por: null,
        });
      // Credencial inicial (uma por usuário, inclusive a excluída: chave única).
      const c = await tx.uma<{ id: number | string; versao: number | string } & Record<string, unknown>>(
        'SELECT id, versao FROM credencial_usuario WHERE usuario_id = ?',
        [idUsuario],
      );
      const credencial = {
        algoritmo: 'argon2id',
        resumo_senha: e.resumoSenha,
        senha_alterada_em: agora,
        troca_obrigatoria: true,
        expira_em: expira,
        tentativas_invalidas: 0,
        ultima_tentativa_invalida_em: null,
      };
      if (!c) await tx.incluir('credencial_usuario', { usuario_id: idUsuario, ...credencial });
      else
        await tx.alterar('credencial_usuario', Number(c.id), Number(c.versao), {
          ...credencial,
          excluido_em: null,
          excluido_por: null,
        });
    }
    return { criados, reativados };
  },
  alvo: () => ({ tabela: 'usuario', id: null }),
  trilha: () => ({ motivo: MOTIVO_DISPENSA_CPF }),
});

export interface PedidoTurma {
  readonly estabelecimento: number;
  readonly logins: readonly string[];
  readonly resumoSenha: string;
  readonly validadeDias?: number;
}

/** Recria a turma no cliente de treino (só treino_<código>); devolve a saída do executor (resultado e trilha). */
export async function recriarTurmaTreino(
  executor: Pick<Executor, 'executar'>,
  cliente: string,
  p: PedidoTurma,
) {
  if (!CLIENTE_TREINO.test(cliente))
    throw new ErroTurma(`Recusado: ${cliente} não é cliente de treino (treino_<código>).`);
  return executarRecriarTurma(executor, cliente, p);
}

/**
 * A operação sem a trava do nome do cliente: só para o teste de integração no cliente de teste da obra. O código de
 * produto chama recriarTurmaTreino.
 */
export function executarRecriarTurma(executor: Pick<Executor, 'executar'>, cliente: string, p: PedidoTurma) {
  return executor.executar(
    OPERACAO_RECRIAR_TURMA,
    cliente,
    {
      logins: [...p.logins],
      validadeDias: p.validadeDias ?? VALIDADE_TURMA_DIAS,
      resumoSenha: p.resumoSenha,
    },
    {
      cliente,
      estabelecimento: p.estabelecimento,
      usuario: null,
      correlacao: 'treino-reiniciar',
      chaveIdempotencia: `treino-turma-${randomUUID()}`,
    },
  );
}
