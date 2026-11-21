// M58-F4: a ação POST /acoes/convenios/situacao servida pela fachada (services/acoes-convenio-situacao.js da versão
// 0.23.0): suspender (A → I) ou reativar (I → A). O primeiro tempo devolve o convênio, o efeito, o impacto, a
// reversão e os alertas, sem escrever; a confirmação grava pela operação `convenio.alterarSituacao` do executor
// (receita com compare-and-swap e a autoria em SGH_), assinada pelo usuário de integração. Aqui só as regras puras:
// a validação do corpo, as recusas do primeiro tempo e o corpo da proposta e do resultado.
import { CODIGOS_ERRO_FACHADA as E } from '@sgh/contratos';
import { erroFachada, erroValidacao, smallint } from './erros.js';

export const OPERACOES_SITUACAO = ['suspender', 'reativar'] as const;
export type OperacaoSituacao = (typeof OPERACOES_SITUACAO)[number];
const ORIGEM = { suspender: 'A', reativar: 'I' } as const;
const ALVO = { suspender: 'I', reativar: 'A' } as const;
const ROTULO: Readonly<Record<string, string>> = { A: 'ativo', I: 'suspenso' };
/** O código do contrato da fachada → o valor que a coluna `situacao` da fonte pagadora guarda de fato. */
const NA_COLUNA: Readonly<Record<string, string>> = { A: 'ativa', I: 'suspensa' };

export const MOTIVOS_SITUACAO = {
  jaNoAlvo: 'ja_esta_no_estado_pedido',
  situacaoDesconhecida: 'situacao_desconhecida',
  bloqueioDth: 'bloqueado_pelo_gatilho_dth',
  recusaDoBanco: 'recusado_pelo_banco',
  updateSemEfeito: 'update_sem_efeito',
} as const;

/** O retrato do convênio que a proposta guarda e a confirmação relê (a mesma forma da API original). */
export type RetratoConvenio =
  | { readonly existe: false; readonly cod: number }
  | {
      readonly existe: true;
      readonly cod: number;
      readonly situacao: string | null;
      readonly nome: string | null;
      readonly permiteAtend: number | null;
      readonly classifC: number | null;
      readonly thm: number | null;
      readonly thmE: number | null;
      readonly idDth: number | null;
      readonly agendasConsulta: number;
      readonly agendasExame: number;
    };

export interface ImpactoConvenio {
  readonly consulta: number;
  readonly exame: number;
  readonly contasAbertas: number;
  readonly carteira: number;
  readonly profissionais: number;
}

/** A diária de acompanhante apontada (null: nenhuma; o gatilho só aceita TIPO 1 e SUBTIPO 5). */
export type DiariaAcompanhante = { readonly tipo: number | null; readonly subtipo: number | null } | null;

/** O corpo (convenio inteiro, operacao no domínio): o AJV valida antes do handler. */
export function lerCorpoSituacao(corpo: unknown): { cod: number; operacao: OperacaoSituacao } {
  const b = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  if (b['convenio'] === undefined) throw erroValidacao('body', [{ tipo: 'required', campo: 'convenio' }]);
  if (b['operacao'] === undefined) throw erroValidacao('body', [{ tipo: 'required', campo: 'operacao' }]);
  const c = b['convenio'];
  const n = typeof c === 'string' && c.trim() !== '' ? Number(c) : c;
  if (typeof n !== 'number' || !Number.isInteger(n))
    throw erroValidacao('body', [{ tipo: 'type', campo: 'convenio', esperado: 'integer' }]);
  const op = b['operacao'];
  if (typeof op !== 'string')
    throw erroValidacao('body', [{ tipo: 'type', campo: 'operacao', esperado: 'string' }]);
  if (!(OPERACOES_SITUACAO as readonly string[]).includes(op))
    throw erroValidacao('body', [{ tipo: 'enum', campo: 'operacao', valores: [...OPERACOES_SITUACAO] }]);
  return { cod: smallint(n, 'convenio'), operacao: op as OperacaoSituacao };
}

/** A pré-checagem do cadastro do convênio: diária apontada que não é TIPO 1/SUBTIPO 5 recusa qualquer alteração. */
export function conferirDiaria(cod: number, nome: string | null, d: DiariaAcompanhante): void {
  // Como no PSQL do gatilho (`tipo <> 1 or subtipo <> 5`): valor nulo não dispara a recusa.
  if (!d || ((d.tipo === null || d.tipo === 1) && (d.subtipo === null || d.subtipo === 5))) return;
  throw erroFachada(
    409,
    `O convênio ${cod} (${nome ?? 'sem nome'}) não pode ser alterado enquanto a diária de acompanhante ` +
      'apontada no contrato não for do tipo Diária/Acompanhante ' +
      `(exigido TIPO=1 e SUBTIPO=5; a apontada tem TIPO=${d.tipo}, SUBTIPO=${d.subtipo}). ` +
      'A regra do banco recusa QUALQUER alteração nesta linha. Corrija a diária no cadastro do convênio ' +
      'antes de tentar de novo. Nada foi escrito.',
    E.acaoSemEfeito,
    {
      motivo: MOTIVOS_SITUACAO.bloqueioDth,
      convenio: cod,
      dth: { tipo: d.tipo, subtipo: d.subtipo, exigido: { tipo: 1, subtipo: 5 } },
    },
  );
}

function alertas(
  op: OperacaoSituacao,
  cod: number,
  nome: string,
  r: RetratoConvenio & { existe: true },
  i: ImpactoConvenio,
) {
  const out: string[] = [];
  if (op === 'suspender')
    out.push(
      'Suspender bloqueia NOVO atendimento e NOVO agendamento com este convênio no Sante SGH; as ' +
        `${r.agendasConsulta} agenda(s) de consulta e ${r.agendasExame} de exame que o listam continuam com ele ` +
        'na lista de cobertura. Para tirá-lo de uma agenda, use /acoes/cobertura/convenio (operacao="remover").',
    );
  const futuros = i.consulta + i.exame;
  if (futuros > 0)
    out.push(
      `${futuros} agendamento(s) futuro(s) com este convênio: ${i.consulta} de consulta e ${i.exame} de exame. ` +
        (op === 'suspender'
          ? 'Suspender não cancela nenhum deles: os pacientes seguem na agenda.'
          : 'Reativar não altera nenhum deles; eles já estavam marcados.'),
    );
  if (i.contasAbertas > 0)
    out.push(
      `${i.contasAbertas} conta(s) ainda aberta(s) com este convênio. Mudar a situação não as fecha, não as ` +
        'cancela e não impede o faturamento delas.',
    );
  if (i.carteira > 0)
    out.push(
      `${i.carteira} paciente(s) têm este plano na carteira. O cadastro deles não muda: continuam com o plano registrado.`,
    );
  if (op === 'reativar')
    out.push(
      'Reativar NÃO refaz os vínculos de profissionais com o convênio (eles só nascem na inclusão do convênio). ' +
        `Hoje este convênio tem ${i.profissionais} profissional(is) vinculado(s)` +
        (i.profissionais === 0
          ? ' — zero. Reativar não conserta isso; o vínculo tem de ser refeito no cadastro.'
          : '. O que já estava vinculado continua vinculado.'),
    );
  out.push(
    'A mudança fica registrada na trilha de auditoria do Sante SGH, com a autoria do usuário de integração ' +
      `(hal-ai). Suspender e reativar o convênio ${cod} (${nome}) devolve o cadastro exatamente ao estado atual.`,
  );
  return out;
}

/** O primeiro tempo: recusas (404, 409) ou a proposta com efeito, impacto, reversão e alertas. */
export function prepararSituacao(
  pedido: { cod: number; operacao: OperacaoSituacao },
  retrato: RetratoConvenio,
  diaria: DiariaAcompanhante,
  impacto: ImpactoConvenio,
) {
  const { cod, operacao } = pedido;
  if (!retrato.existe) throw erroFachada(404, `Convênio ${cod} não existe`, E.convenioNaoEncontrado);
  const nome = retrato.nome ?? `convênio ${cod}`;
  const atual = retrato.situacao;
  const origem = ORIGEM[operacao];
  const alvo = ALVO[operacao];
  if (atual === alvo)
    throw erroFachada(
      409,
      `O convênio ${cod} (${nome}) já está ${ROTULO[alvo]}. Nada a fazer.`,
      E.acaoSemEfeito,
      {
        motivo: MOTIVOS_SITUACAO.jaNoAlvo,
        convenio: cod,
        situacaoAtual: atual,
      },
    );
  if (atual !== origem)
    throw erroFachada(
      409,
      `O convênio ${cod} (${nome}) está com a situação ${atual === null ? 'vazia' : `"${atual}"`}, que não é nem ` +
        '"A" (ativo) nem "I" (inativo). Corrija o cadastro do convênio antes. Nada foi escrito.',
      E.acaoSemEfeito,
      {
        motivo: MOTIVOS_SITUACAO.situacaoDesconhecida,
        convenio: cod,
        situacaoAtual: atual,
        esperado: origem,
      },
    );
  conferirDiaria(cod, nome, diaria);
  const inversa: OperacaoSituacao = operacao === 'suspender' ? 'reativar' : 'suspender';
  const reversao = {
    descricao:
      `Para desfazer, repita esta ação com operacao="${inversa}". A inversa é exata — a situação volta ao ` +
      'valor atual e nenhum outro campo é tocado.',
    corpo: { convenio: cod, operacao: inversa },
    rota: '/acoes/convenios/situacao',
  };
  const corpo = {
    convenio: { codigo: cod, nome, situacaoAtual: atual, situacaoDepois: alvo },
    operacao,
    efeito: {
      tabela: 'fonte_pagadora_estabelecimento',
      coluna: 'situacao',
      antes: NA_COLUNA[origem],
      depois: NA_COLUNA[alvo],
      observacao:
        'Uma linha, uma coluna: a situação do vínculo do convênio com o estabelecimento. Nenhuma exclusão é exposta.',
    },
    impacto: {
      agendasDeConsultaQueAceitamOConvenio: retrato.agendasConsulta,
      agendasDeExameQueAceitamOConvenio: retrato.agendasExame,
      agendamentosFuturosConsulta: impacto.consulta,
      agendamentosFuturosExame: impacto.exame,
      contasAbertasComEsteConvenio: impacto.contasAbertas,
      pacientesComOPlanoNaCarteira: impacto.carteira,
      profissionaisVinculados: impacto.profissionais,
      observacao:
        operacao === 'suspender'
          ? 'Suspender muda o cadastro: não cancela agendamento, não fecha conta, não altera carteira de ' +
            'paciente e não remove o convênio de nenhuma agenda.'
          : 'Reativar apenas devolve a situação a "A": não recria vínculos, não reabre conta e não inclui o ' +
            'convênio em agenda nenhuma.',
    },
    reversao,
    alertas: alertas(operacao, cod, nome, retrato, impacto),
  };
  return { params: { cod }, nome, origem, alvo, corpo, reversao };
}

/** O corpo do segundo tempo, depois da gravação provada (situação relida = alvo). */
export function resultadoSituacao(
  p: { cod: number; operacao: OperacaoSituacao; nome: string; origem: string; reversao: unknown },
  situacaoRelida: string | null,
) {
  const alvo = ALVO[p.operacao];
  if (situacaoRelida !== alvo)
    throw erroFachada(
      409,
      `A alteração não teve efeito: o convênio ${p.cod} (${p.nome}) continua com a situação ` +
        `${situacaoRelida === null ? 'vazia' : `"${situacaoRelida}"`}, e não "${alvo}". Nada permaneceu escrito.`,
      E.acaoSemEfeito,
      {
        motivo: MOTIVOS_SITUACAO.updateSemEfeito,
        convenio: p.cod,
        pretendido: alvo,
        encontrado: situacaoRelida,
      },
    );
  return {
    convenio: { codigo: p.cod, nome: p.nome },
    operacao: p.operacao,
    situacaoAnterior: p.origem,
    situacaoAtual: situacaoRelida,
    efeito: {
      tabela: 'fonte_pagadora_estabelecimento',
      coluna: 'situacao',
      antes: NA_COLUNA[p.origem] ?? p.origem,
      depois: NA_COLUNA[alvo],
    },
    reversao: p.reversao,
    aviso:
      p.operacao === 'suspender'
        ? 'O convênio está suspenso: não aceita novo atendimento nem novo agendamento, e continua na lista das ' +
          'agendas que o listam.'
        : 'O convênio está ativo no cadastro. Isso não o incluiu em agenda nenhuma nem recriou vínculo de profissional.',
  };
}

/** A recusa de conteúdo do banco na confirmação (CHECK ou regra do banco): 409 sem o texto do banco. */
export const recusaDoBancoSituacao = (cod: number, nome: string) =>
  erroFachada(
    409,
    `O banco recusou a alteração do convênio ${cod} (${nome}). A recusa veio de uma regra de validação da ` +
      'tabela, que é conferida contra a linha INTEIRA em qualquer alteração, e pode vir de um campo que nada tem ' +
      'a ver com a situação. Nada foi escrito; o cadastro precisa ser corrigido.',
    E.acaoSemEfeito,
    { motivo: MOTIVOS_SITUACAO.recusaDoBanco, convenio: cod },
  );
