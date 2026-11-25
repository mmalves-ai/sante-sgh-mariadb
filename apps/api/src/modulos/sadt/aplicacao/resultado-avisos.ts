// Avisos que nascem do ciclo do resultado no banco do cliente (F3.5, 05-SADT linha 10), na mesma transação da
// gravação:
//   - valor crítico: ao digitar (e de novo ao liberar e ao retificar, sem repetir), cada analito crítico ganha o aviso
//     com a regra vigente e o prazo de comunicação; a correção que tira o crítico cancela o aviso ainda pendente (o
//     registro fica, com a situação). O laboratório é acionado antes da liberação, não depois.
//   - retificação: quem já tinha aberto o resultado liberado recebe um aviso clínico na caixa de avisos, com o exame e
//     o motivo (nunca o valor), ligado ao resultado e à versão guardada.
// A decisão é do domínio (dominio-sadt/critico/regra-aviso); aqui só se lê e grava.
import {
  alvosDoAviso,
  alvosJaAvisados,
  avisoDoAlvo,
  avisosSuperados,
  destinatariosDaRetificacao,
  type RegraCriticoCandidata,
} from '@sgh/dominio-sadt';
import type { definirOperacao } from '@sgh/nucleo';

type Tx = Parameters<Parameters<typeof definirOperacao>[0]['gravar']>[0];

const n = (v: unknown) => Number(v);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Tabelas que estes avisos gravam (para a declaração da operação). */
export const TABELAS_AVISOS_RESULTADO = [
  'aviso_valor_critico',
  'aviso_clinico',
  'aviso_clinico_destinatario',
] as const;

export interface AvisosCriticosGravados {
  readonly gerados: number;
  readonly cancelados: number;
}

/** Gera os avisos de valor crítico que faltam ao resultado e cancela os pendentes que a correção superou. */
export async function avisarCriticosDoResultado(
  tx: Tx,
  a: {
    estabelecimento: number;
    resultado: number;
    exame: number;
    paciente: number;
    critico: boolean;
    agora: Date;
  },
): Promise<AvisosCriticosGravados> {
  const criticos = (
    await tx.consultar(
      `SELECT id, analito_id FROM resultado_analito
        WHERE resultado_exame_id = ? AND critico = TRUE AND excluido_em IS NULL ORDER BY sequencia, id`,
      [a.resultado],
    )
  ).map((x) => ({ analito: nn(x['analito_id']), resultadoAnalito: n(x['id']) }));
  const avisos = (
    await tx.consultarParaAtualizar(
      `SELECT id, versao, resultado_analito_id, situacao FROM aviso_valor_critico
        WHERE resultado_exame_id = ? AND excluido_em IS NULL`,
      [a.resultado],
    )
  ).map((x) => ({
    id: n(x['id']),
    versao: n(x['versao']),
    resultadoAnalito: nn(x['resultado_analito_id']),
    situacao: String(x['situacao']),
  }));
  const superados = avisosSuperados(avisos, new Set(criticos.map((c) => c.resultadoAnalito)), a.critico);
  for (const id of superados) {
    const v = avisos.find((x) => x.id === id)!;
    await tx.alterar('aviso_valor_critico', id, v.versao, {
      situacao: 'cancelado',
      observacao: 'Valor corrigido antes da comunicação: deixou de ser crítico.',
    });
  }
  const alvos = alvosDoAviso(criticos, a.critico, alvosJaAvisados(avisos));
  if (!alvos.length) return { gerados: 0, cancelados: superados.length };
  const analitos = [...new Set(alvos.map((x) => x.analito).filter((x): x is number => x !== null))];
  const candidatas: RegraCriticoCandidata[] = (
    await tx.consultar(
      `SELECT id, estabelecimento_id, analito_id, exame_id, prazo_comunicacao_minutos FROM regra_valor_critico
        WHERE (estabelecimento_id = ? OR estabelecimento_id IS NULL) AND ativo = TRUE
          AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
          AND (exame_id = ?${analitos.length ? ` OR analito_id IN (${analitos.map(() => '?').join(', ')})` : ''})`,
      [a.estabelecimento, a.agora, a.agora, a.exame, ...analitos],
    )
  ).map((x) => ({
    id: n(x['id']),
    estabelecimento: nn(x['estabelecimento_id']),
    analito: nn(x['analito_id']),
    exame: nn(x['exame_id']),
    prazoMinutos: nn(x['prazo_comunicacao_minutos']),
  }));
  for (const x of alvos) {
    const aviso = avisoDoAlvo(
      candidatas,
      { estabelecimento: a.estabelecimento, exame: a.exame, analito: x.analito },
      a.agora,
    );
    await tx.incluir('aviso_valor_critico', {
      estabelecimento_id: a.estabelecimento,
      resultado_exame_id: a.resultado,
      resultado_analito_id: x.resultadoAnalito,
      paciente_id: a.paciente,
      regra_valor_critico_id: aviso.regra,
      gerado_em: a.agora,
      prazo_em: aviso.prazoEm,
      situacao: 'pendente',
      nivel_escalonamento: 0,
    });
  }
  return { gerados: alvos.length, cancelados: superados.length };
}

/** Avisa da retificação quem já tinha aberto o resultado; devolve quantos foram avisados. */
export async function avisarQuemViuARetificacao(
  tx: Tx,
  a: {
    estabelecimento: number;
    resultado: number;
    versaoGuardada: number;
    paciente: number;
    motivo: string;
    agora: Date;
  },
): Promise<number> {
  const leituras = (
    await tx.consultar(
      'SELECT usuario_id, visualizado_em FROM visualizacao_resultado_exame WHERE resultado_exame_id = ?',
      [a.resultado],
    )
  ).map((x) => ({ usuario: n(x['usuario_id']), vistoEm: new Date(x['visualizado_em'] as string | Date) }));
  const destinatarios = destinatariosDaRetificacao(leituras, tx.contexto.usuario ?? null, a.agora);
  if (!destinatarios.length) return 0;
  const ex = await tx.uma(
    `SELECT x.nome, r.atendimento_id FROM resultado_exame re
       JOIN exame_item ei ON ei.id = re.exame_item_id
       JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
       JOIN exame x ON x.id = ei.exame_id
      WHERE re.id = ?`,
    [a.resultado],
  );
  const aviso = await tx.incluir('aviso_clinico', {
    estabelecimento_id: a.estabelecimento,
    paciente_id: a.paciente,
    atendimento_id: nn(ex?.['atendimento_id']),
    resultado_exame_id: a.resultado,
    titulo: 'Resultado de exame retificado',
    mensagem:
      `O resultado de ${String(ex?.['nome'] ?? 'exame')} que você já tinha visto foi retificado. Motivo: ${a.motivo}`.slice(
        0,
        2000,
      ),
    prioridade: 'alta',
    canal: 'sistema',
    situacao: 'pendente',
    gerado_em: a.agora,
    modulo_origem: 'sadt.resultado',
    entidade_origem: 'resultado_exame_versao',
    entidade_origem_chave: a.versaoGuardada,
  });
  let sequencia = 0;
  for (const usuario of destinatarios)
    await tx.incluir('aviso_clinico_destinatario', {
      aviso_clinico_id: aviso,
      sequencia: ++sequencia,
      usuario_id: usuario,
      canal: 'sistema',
      situacao: 'pendente',
    });
  return destinatarios.length;
}
