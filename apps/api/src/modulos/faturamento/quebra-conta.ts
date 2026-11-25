// F8 (06-FAT linha 13): a regra comercial de conta ligada à entrada e à rotina diária, sobre o banco próprio.
// - Criação: na abertura da conta da entrada (conta-entrada.ts), a regra "criar_conta" que vale para a situação do
//   atendimento (origem da entrada, categoria, setor, acomodação, fonte e plano de origem, horário especial, vigência
//   na data da entrada) decide a fonte pagadora e o plano da conta; sem regra, a conta fica na fonte do atendimento.
// - Quebra: a rotina diária (faturamento.apurar-lancamentos-do-dia) aplica a regra "quebrar_conta" com período às
//   contas de internação abertas: cada período vencido fecha o trecho da conta (fim_em no último instante do dia local)
//   e abre a conta do trecho seguinte (tipo de cobrança "parcial", conta_pai_id na conta original, mesma fonte, plano,
//   tabela, tipo e acomodação, competência do novo início, número seguinte do atendimento e vínculo atendimento_conta).
//   A apuração lança em cada conta só o devido do seu trecho (o resto é estornado dela e lançado na do trecho certo).
//   Nada se apaga; a internação com alta só se quebra até o dia da alta. A regra é do domínio (@sgh/dominio-faturamento,
//   conta/regras-comerciais: destinoDaConta e trechosDaQuebra); aqui só se lê e se grava.
import { dataHoraParaInstante, FUSO_PADRAO, instanteParaDataHora } from '@sgh/contratos';
import {
  competenciaDaConta,
  type DestinoConta,
  destinoDaConta,
  escolherRegraConta,
  numeroDaConta,
  type PeriodicidadeConta,
  trechosDaQuebra,
} from '@sgh/dominio-faturamento';
import type { TxOperacao } from '@sgh/nucleo';
import { regrasContaDo } from './regras-conta-leitura.js';
import { contaAceitaLancamento } from './regras-conta.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const bool = (v: unknown) => v === true || v === 1 || v === '1';

async function fusoDo(tx: Pick<TxOperacao, 'uma'>, est: number): Promise<string> {
  const l = await tx.uma<Linha>('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
  return texto(l?.['fuso_horario']) || FUSO_PADRAO;
}
const diaLocal = (d: unknown, fuso: string) =>
  instanteParaDataHora(new Date(d as Date).toISOString(), fuso).data;

/** A situação do atendimento na entrada, comparada às regras de criação de conta. */
export interface SituacaoEntradaConta {
  readonly fonteOrigem: number;
  readonly planoOrigem: number | null;
  readonly categoriaAcomodacao: number | null;
}

/** A fonte e o plano da conta aberta na entrada, pela regra de criação que vale (sem regra, os do atendimento). */
export async function destinoDaContaNaEntrada(
  tx: TxOperacao,
  est: number,
  atendimento: Linha,
  s: SituacaoEntradaConta,
): Promise<DestinoConta> {
  const regras = await regrasContaDo(tx, est);
  if (!regras.some((r) => r.acao === 'criar_conta'))
    return { fonte: s.fonteOrigem, plano: s.planoOrigem, regraId: null };
  const fuso = await fusoDo(tx, est);
  return destinoDaConta(regras, {
    data: diaLocal(atendimento['entrada_em'], fuso),
    categoriaAtendimento: nn(atendimento['categoria_atendimento_id']),
    origemEntrada: nn(atendimento['origem_entrada_atendimento_id']),
    setor: nn(atendimento['setor_funcional_id']),
    categoriaAcomodacao: s.categoriaAcomodacao,
    fonteOrigem: s.fonteOrigem,
    planoOrigem: s.planoOrigem,
    horarioEspecial: bool(atendimento['horario_especial']),
  });
}

/** O trecho (dias locais) que a conta cobre na quebra por período; nulo quando a conta nunca foi quebrada. */
export async function trechoDaConta(
  tx: Pick<TxOperacao, 'uma'>,
  conta: Linha,
  fuso: string,
): Promise<{ inicio: string | null; fim: string | null } | null> {
  const filha = conta['conta_pai_id'] !== null && texto(conta['tipo_cobranca']) === 'parcial';
  const mae = filha
    ? null
    : await tx.uma<Linha>(
        `SELECT id FROM conta_hospitalar WHERE conta_pai_id = ? AND tipo_cobranca = 'parcial' AND excluido_em IS NULL
          LIMIT 1`,
        [n(conta['id'])],
      );
  if (!filha && !mae) return null;
  return {
    inicio: filha ? diaLocal(conta['inicio_em'], fuso) : null,
    fim: conta['fim_em'] === null || conta['fim_em'] === undefined ? null : diaLocal(conta['fim_em'], fuso),
  };
}

export interface ResultadoQuebra {
  readonly quebradas: number;
  readonly abertas: number;
}

/**
 * Quebra as contas de internação abertas pelo período da regra "quebrar_conta" que vale para cada uma (idempotente:
 * a conta do trecho de hoje não tem período vencido). Chamada pela rotina diária, na mesma transação da apuração.
 */
export async function quebrarContasPorPeriodo(
  tx: TxOperacao,
  est: number,
  agora: Date = new Date(),
): Promise<ResultadoQuebra> {
  const regras = (await regrasContaDo(tx, est)).filter(
    (r) => r.acao === 'quebrar_conta' && r.ativo && r.periodicidade,
  );
  if (regras.length === 0) return { quebradas: 0, abertas: 0 };
  const fuso = await fusoDo(tx, est);
  const hoje = instanteParaDataHora(agora.toISOString(), fuso).data;
  const contas = await tx.consultar<Linha>(
    `SELECT c.id, c.versao, c.numero, c.situacao, c.atendimento_id, c.paciente_id, c.fonte_pagadora_id,
            c.plano_fonte_pagadora_id, c.cobertura_paciente_id, c.contrato_fonte_pagadora_id, c.tabela_preco_id,
            c.tipo_conta_id, c.categoria_acomodacao_id, c.conta_pai_id, c.tipo_cobranca, c.natureza, c.inicio_em,
            c.senha_autorizacao, a.numero AS atendimento_numero, a.categoria_atendimento_id,
            a.origem_entrada_atendimento_id, a.setor_funcional_id, a.horario_especial,
            (SELECT i.data_hora_alta FROM internacao i WHERE i.atendimento_id = a.id AND i.excluido_em IS NULL
              ORDER BY i.id DESC LIMIT 1) AS alta_em
       FROM conta_hospitalar c JOIN atendimento a ON a.id = c.atendimento_id
      WHERE c.estabelecimento_id = ? AND c.natureza = 'internacao' AND c.fim_em IS NULL
        AND c.situacao <> 'cancelada' AND c.excluido_em IS NULL AND a.excluido_em IS NULL
      ORDER BY c.id`,
    [est],
    { teto: 20000 },
  );
  let quebradas = 0;
  let abertas = 0;
  for (const c of contas) {
    if (!contaAceitaLancamento(texto(c['situacao']))) continue;
    const ate = c['alta_em'] === null || c['alta_em'] === undefined ? hoje : diaLocal(c['alta_em'], fuso);
    const { regra } = escolherRegraConta(
      regras,
      {
        data: ate < hoje ? ate : hoje,
        categoriaAtendimento: nn(c['categoria_atendimento_id']),
        origemEntrada: nn(c['origem_entrada_atendimento_id']),
        setor: nn(c['setor_funcional_id']),
        categoriaAcomodacao: nn(c['categoria_acomodacao_id']),
        fonteOrigem: nn(c['fonte_pagadora_id']),
        planoOrigem: nn(c['plano_fonte_pagadora_id']),
        horarioEspecial: bool(c['horario_especial']),
      },
      'quebrar_conta',
    );
    if (!regra?.periodicidade) continue;
    const trechos = trechosDaQuebra(
      regra.periodicidade as PeriodicidadeConta,
      diaLocal(c['inicio_em'], fuso),
      ate < hoje ? ate : hoje,
    );
    if (trechos.length < 2) continue;
    const raiz =
      c['conta_pai_id'] !== null && texto(c['tipo_cobranca']) === 'parcial'
        ? n(c['conta_pai_id'])
        : n(c['id']);
    let atual = { id: n(c['id']), versao: n(c['versao']) };
    for (let k = 0; k < trechos.length - 1; k += 1) {
      const fim = new Date(Date.parse(dataHoraParaInstante(trechos[k]!.fim, '23:59', fuso)) + 59_999);
      await tx.alterar('conta_hospitalar', atual.id, atual.versao, { fim_em: fim });
      quebradas += 1;
      const prox = trechos[k + 1]!;
      const ordem = await tx.uma<Linha>(
        'SELECT COUNT(*) AS n FROM conta_hospitalar WHERE atendimento_id = ?',
        [n(c['atendimento_id'])],
      );
      const nova = await tx.incluir('conta_hospitalar', {
        estabelecimento_id: est,
        numero: numeroDaConta(texto(c['atendimento_numero']), n(ordem?.['n']) + 1),
        atendimento_id: n(c['atendimento_id']),
        paciente_id: n(c['paciente_id']),
        fonte_pagadora_id: n(c['fonte_pagadora_id']),
        plano_fonte_pagadora_id: nn(c['plano_fonte_pagadora_id']),
        cobertura_paciente_id: nn(c['cobertura_paciente_id']),
        contrato_fonte_pagadora_id: nn(c['contrato_fonte_pagadora_id']),
        tabela_preco_id: nn(c['tabela_preco_id']),
        tipo_conta_id: n(c['tipo_conta_id']),
        categoria_acomodacao_id: nn(c['categoria_acomodacao_id']),
        conta_pai_id: raiz,
        natureza: texto(c['natureza']),
        tipo_cobranca: 'parcial',
        competencia: competenciaDaConta(prox.inicio),
        inicio_em: new Date(dataHoraParaInstante(prox.inicio, '00:00', fuso)),
        senha_autorizacao: c['senha_autorizacao'] ?? null,
        situacao: 'aberta',
        origem: 'sistema',
      });
      const v = await tx.uma<Linha>(
        'SELECT id FROM atendimento_conta WHERE atendimento_id = ? AND conta_hospitalar_id = ? AND excluido_em IS NULL',
        [n(c['atendimento_id']), nova],
      );
      if (!v)
        await tx.incluir('atendimento_conta', {
          atendimento_id: n(c['atendimento_id']),
          conta_hospitalar_id: nova,
        });
      abertas += 1;
      const lida = await tx.uma<Linha>('SELECT versao FROM conta_hospitalar WHERE id = ?', [nova]);
      atual = { id: nova, versao: n(lida?.['versao']) };
    }
  }
  return { quebradas, abertas };
}
