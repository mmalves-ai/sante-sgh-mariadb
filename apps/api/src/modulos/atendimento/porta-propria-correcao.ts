// Porta PRÓPRIA do atendimento: correção da ficha aberta (F3.2, 02-REC linha 30) sobre o MariaDB do cliente.
//   - atendimento.alterarSegurado: carteirinha, validade, guia, senha do convênio e plano da cobertura principal;
//   - atendimento.alterarAtendimento: convênio, profissional, especialidade, procedimento principal, CID, solicitante,
//     responsável, observação e caráter, com justificativa (vai à trilha com a entrada);
//   - atendimento.corrigirProcedimentoExtra / estornarProcedimentoExtra: o extra da recepção e o item que ele gerou na
//     conta mudam juntos, na mesma transação, com o total da conta e a produção do repasse.
// As regras são do domínio (`@sgh/dominio-atendimento`, correcao-ficha.ts); aqui só os fatos e a gravação pelo
// Executor (trilha, outbox e idempotência). Nada é apagado: o estorno marca o item como estornado e encerra o
// procedimento da ficha (exclusão lógica). Controle otimista pela versão da ficha lida pela tela.
import {
  CARATERES,
  dataHoraParaInstante,
  esquemaAlterarAtendimento,
  esquemaAlterarSegurado,
  esquemaCorrigirProcedimentoExtra,
  esquemaEstornarProcedimentoExtra,
} from '@sgh/contratos';
import {
  type Recusa,
  recusaAlteracaoFicha,
  recusaCorrecaoExtra,
  recusaEstornoExtra,
  recusaVersaoDaFicha,
  valorNaQuantidade,
} from '@sgh/dominio-atendimento';
import { definirOperacao, ErroOperacao, type Linha, recusa, type TxOperacao } from '@sgh/nucleo';
import { solicitanteQueRespondeHoje } from '../cadastro/solicitante-vigente.js';
import { totalDosItens } from '../faturamento/operacoes.js';
import { contaAceitaLancamento } from '../faturamento/regras-conta.js';
import { sincronizarProducaoDaConta, TABELAS_SINCRONIZACAO_PRODUCAO } from '../repasse/producao-conta.js';

const FUSO_PADRAO = 'America/Sao_Paulo';

const txt = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const quando = (v: unknown): Date | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};
/** AAAA-MM-DD HH:MM:SS no fuso do estabelecimento. */
const noFuso = (d: Date, fuso: string): string =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
const dataIso = (v: unknown): string | null => {
  const d = quando(v);
  return d ? d.toISOString().slice(0, 10) : null;
};

function recusar(x: Recusa | null, campos?: string[]): void {
  if (!x) return;
  if (x.codigo === 'conflito-versao')
    throw new ErroOperacao(409, 'conflito-versao', 'Ficha alterada por outra pessoa', x.mensagem, {
      campos: ['versao'],
    });
  throw recusa(x.codigo, x.mensagem, campos ? { campos } : undefined);
}

async function fusoDo(tx: TxOperacao): Promise<string> {
  const f = await tx.uma('SELECT fuso_horario AS f FROM estabelecimento WHERE id = ?', [
    tx.contexto.estabelecimento,
  ]);
  return txt(f?.['f']) ?? FUSO_PADRAO;
}

/** Trava o atendimento do estabelecimento da sessão (não excluído nem cancelado). */
async function travarFicha(tx: TxOperacao, id: number): Promise<Linha> {
  if (tx.contexto.estabelecimento === null)
    throw recusa('estabelecimento-obrigatorio', 'Escolha o estabelecimento do atendimento.');
  const [a] = await tx.consultarParaAtualizar(
    `SELECT id, numero, versao, situacao, entrada_em, fonte_pagadora_id, profissional_id, especialidade_medica_id,
            carater_atendimento_tiss_id, cid_principal_termo_terminologia_id, cid_secundario_termo_terminologia_id,
            solicitante_externo_id, observacao, responsavel_nome, responsavel_grau_parentesco_dependente_id,
            responsavel_telefone
       FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, tx.contexto.estabelecimento],
    { teto: 1 },
  );
  if (!a) throw recusa('registro-inexistente', 'O atendimento não existe neste estabelecimento.');
  if (String(a['situacao']) === 'cancelado')
    throw recusa('atendimento-cancelado', 'O atendimento foi cancelado.', { campos: ['atendimento'] });
  return a;
}

async function exigir(
  tx: TxOperacao,
  sql: string,
  p: readonly unknown[],
  codigo: string,
  msg: string,
  campo: string,
) {
  const x = await tx.uma(sql, p);
  if (!x) throw recusa(codigo, msg, { campos: [campo] });
  return x;
}

async function contaDoAtendimento(tx: TxOperacao, atendimento: number): Promise<number | null> {
  const v = await tx.uma(
    `SELECT ac.conta_hospitalar_id AS c FROM atendimento_conta ac
       JOIN conta_hospitalar c ON c.id = ac.conta_hospitalar_id AND c.situacao <> 'cancelada' AND c.excluido_em IS NULL
      WHERE ac.atendimento_id = ? AND ac.excluido_em IS NULL ORDER BY ac.id LIMIT 1`,
    [atendimento],
  );
  return num(v?.['c']);
}

// ── atendimento.alterarSegurado ──────────────────────────────────────────────────────────────────

const CAMPOS_SEGURADO = {
  matricula: 'numero_carteira',
  validadeCarteira: 'validade_carteira',
  guia: 'numero_guia',
  senhaConvenio: 'senha_autorizacao',
  validadeSenha: 'validade_senha',
} as const;

export const OPERACAO_ALTERAR_SEGURADO = definirOperacao({
  nome: 'atendimento.alterar-segurado',
  tabelas: ['atendimento', 'cobertura_atendimento'],
  entrada: esquemaAlterarSegurado,
  acao: 'alteracao',
  async gravar(tx, e) {
    const a = await travarFicha(tx, Number(e.atendimento));
    recusar(recusaVersaoDaFicha(e.versao, Number(a['versao'])));
    const [cob] = await tx.consultarParaAtualizar(
      `SELECT id, versao, fonte_pagadora_id, plano_fonte_pagadora_id, numero_carteira, validade_carteira, numero_guia,
              senha_autorizacao, validade_senha
         FROM cobertura_atendimento WHERE atendimento_id = ? AND excluido_em IS NULL ORDER BY ordem LIMIT 1`,
      [Number(a['id'])],
      { teto: 1 },
    );
    if (!cob) throw recusa('sem-cobertura', 'O atendimento não tem cobertura do convênio gravada.');
    const valores: Record<string, unknown> = {};
    for (const [campo, coluna] of Object.entries(CAMPOS_SEGURADO)) {
      const novo = (e as Record<string, unknown>)[campo];
      if (novo === undefined) continue;
      const valor = novo === '' ? null : novo;
      const atual = coluna.startsWith('validade') ? dataIso(cob[coluna]) : txt(cob[coluna]);
      if ((valor ?? null) !== atual) valores[coluna] = valor;
    }
    if (e.plano !== undefined) {
      const plano = e.plano
        ? num(
            (
              await exigir(
                tx,
                'SELECT id FROM plano_fonte_pagadora WHERE fonte_pagadora_id = ? AND (codigo = ? OR UPPER(descricao) = UPPER(?)) AND excluido_em IS NULL LIMIT 1',
                [Number(cob['fonte_pagadora_id']), e.plano, e.plano],
                'plano-inexistente',
                'O plano não é do convênio do atendimento.',
                'plano',
              )
            )['id'],
          )
        : null;
      if (plano !== num(cob['plano_fonte_pagadora_id'])) valores['plano_fonte_pagadora_id'] = plano;
    }
    if (!Object.keys(valores).length)
      throw recusa('nada-a-alterar', 'Os valores informados são os já gravados.');
    await tx.alterar('cobertura_atendimento', Number(cob['id']), Number(cob['versao']), valores);
    // A versão da ficha acompanha a mudança da cobertura (controle otimista da tela).
    const versao = await tx.alterar('atendimento', Number(a['id']), Number(a['versao']), {});
    return {
      reg: Number(a['id']),
      cabecalho: String(a['numero']),
      alterados: Object.keys(valores).length,
      versao: `v${versao}`,
    };
  },
  alvo: (e) => ({ tabela: 'atendimento', id: Number(e.atendimento) }),
});

// ── atendimento.alterarAtendimento ───────────────────────────────────────────────────────────────

export const OPERACAO_ALTERAR_ATENDIMENTO = definirOperacao({
  nome: 'atendimento.alterar-atendimento',
  tabelas: ['atendimento', 'cobertura_atendimento', 'atendimento_procedimento'],
  entrada: esquemaAlterarAtendimento,
  acao: 'alteracao',
  async gravar(tx, e) {
    const a = await travarFicha(tx, Number(e.atendimento));
    recusar(recusaVersaoDaFicha(e.versao, Number(a['versao'])));
    const id = Number(a['id']);
    const valores: Record<string, unknown> = {};
    const muda = (coluna: string, novo: unknown) => {
      const atual = txt(a[coluna]);
      const igual = novo === null || novo === undefined ? atual === null : String(novo) === atual;
      if (!igual) valores[coluna] = novo ?? null;
    };
    if (e.convenio !== undefined) {
      const c = await exigir(
        tx,
        'SELECT id, situacao FROM fonte_pagadora WHERE id = ? AND excluido_em IS NULL',
        [e.convenio],
        'convenio-inexistente',
        'Convênio não encontrado.',
        'convenio',
      );
      if (c['situacao'] !== 'ativa')
        throw recusa('convenio-inativo', 'O convênio está inativo.', { campos: ['convenio'] });
      muda('fonte_pagadora_id', e.convenio);
    }
    if (e.profissional !== undefined) {
      await exigir(
        tx,
        "SELECT id FROM profissional WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
        [e.profissional],
        'profissional-inativo',
        'O profissional não existe ou está inativo.',
        'profissional',
      );
      muda('profissional_id', e.profissional);
    }
    if (e.especialidade !== undefined) {
      await exigir(
        tx,
        'SELECT id FROM especialidade_medica WHERE id = ? AND ativo',
        [e.especialidade],
        'especialidade-inexistente',
        'Especialidade não encontrada.',
        'especialidade',
      );
      muda('especialidade_medica_id', e.especialidade);
    }
    for (const [campo, coluna] of [
      ['cidPrincipal', 'cid_principal_termo_terminologia_id'],
      ['cidSecundario', 'cid_secundario_termo_terminologia_id'],
    ] as const) {
      const v = e[campo];
      if (v === undefined) continue;
      if (v !== null)
        await exigir(
          tx,
          'SELECT id FROM termo_terminologia WHERE id = ?',
          [v],
          'cid-inexistente',
          'CID não encontrado.',
          campo,
        );
      muda(coluna, v);
    }
    if (e.solicitante !== undefined) {
      if (e.solicitante !== null)
        await exigir(
          tx,
          'SELECT id FROM solicitante_externo WHERE id = ?',
          [e.solicitante],
          'solicitante-inexistente',
          'Solicitante não encontrado.',
          'solicitante',
        );
      // 02-CAD 20: o cadastro unificado em outro não recebe registro novo; a correção grava o cadastro que continua.
      muda('solicitante_externo_id', await solicitanteQueRespondeHoje(tx, e.solicitante));
    }
    if (e.observacao !== undefined) muda('observacao', e.observacao || null);
    if (e.carater !== undefined) {
      const tiss = CARATERES.find((x) => x.codigo === e.carater)?.tiss;
      const car = await exigir(
        tx,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        [String(tiss ?? '')],
        'carater-nao-configurado',
        'Caráter do atendimento não configurado no cliente.',
        'carater',
      );
      muda('carater_atendimento_tiss_id', Number(car['id']));
    }
    if (e.responsavel) {
      const g = await tx.uma('SELECT id FROM grau_parentesco_dependente WHERE codigo = ? AND ativo', [
        String(e.responsavel.parentesco),
      ]);
      muda('responsavel_nome', e.responsavel.nome);
      muda('responsavel_grau_parentesco_dependente_id', num(g?.['id']));
      muda('responsavel_telefone', e.responsavel.telefone ?? null);
    }
    let principal: Linha | null = null;
    if (e.procedimento !== undefined) {
      await exigir(
        tx,
        "SELECT id FROM item_faturavel WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
        [e.procedimento],
        'procedimento-inexistente',
        'Procedimento não encontrado.',
        'procedimento',
      );
      const [p] = await tx.consultarParaAtualizar(
        'SELECT id, versao, item_faturavel_id FROM atendimento_procedimento WHERE atendimento_id = ? AND principal AND excluido_em IS NULL ORDER BY sequencia LIMIT 1',
        [id],
        { teto: 1 },
      );
      principal = p ?? null;
    }
    const mudaProc = e.procedimento !== undefined && num(principal?.['item_faturavel_id']) !== e.procedimento;
    const mudaConvenio = 'fonte_pagadora_id' in valores;
    recusar(
      recusaAlteracaoFicha({
        mudaAlgo: Object.keys(valores).length > 0 || mudaProc,
        mudaConvenio,
        temConta: mudaConvenio ? (await contaDoAtendimento(tx, id)) !== null : false,
      }),
      mudaConvenio ? ['convenio'] : undefined,
    );
    if (mudaConvenio) {
      const [cob] = await tx.consultarParaAtualizar(
        'SELECT id, versao FROM cobertura_atendimento WHERE atendimento_id = ? AND excluido_em IS NULL ORDER BY ordem LIMIT 1',
        [id],
        { teto: 1 },
      );
      if (cob)
        await tx.alterar('cobertura_atendimento', Number(cob['id']), Number(cob['versao']), {
          fonte_pagadora_id: e.convenio,
          plano_fonte_pagadora_id: null,
        });
    }
    if (mudaProc) {
      if (principal)
        await tx.alterar('atendimento_procedimento', Number(principal['id']), Number(principal['versao']), {
          item_faturavel_id: e.procedimento,
        });
      else {
        const s = await tx.uma(
          'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM atendimento_procedimento WHERE atendimento_id = ?',
          [id],
        );
        await tx.incluir('atendimento_procedimento', {
          atendimento_id: id,
          sequencia: Number(s?.['s'] ?? 1),
          item_faturavel_id: e.procedimento,
          quantidade: 1,
          principal: true,
        });
      }
    }
    const versao = await tx.alterar('atendimento', id, Number(a['versao']), valores);
    return {
      reg: id,
      cabecalho: String(a['numero']),
      alterados: Object.keys(valores).length + (mudaProc ? 1 : 0),
      versao: `v${versao}`,
    };
  },
  alvo: (e) => ({ tabela: 'atendimento', id: Number(e.atendimento) }),
});

// ── atendimento.corrigirProcedimentoExtra / estornarProcedimentoExtra ───────────────────────────

const TABELAS_EXTRA = [
  'atendimento',
  'atendimento_procedimento',
  'conta_hospitalar',
  'conta_hospitalar_item',
  'conta_hospitalar_item_memoria',
  ...TABELAS_SINCRONIZACAO_PRODUCAO,
];

interface ExtraTravado {
  readonly ficha: Linha;
  readonly proc: Linha | null;
  readonly item: Linha | null;
  readonly conta: Linha | null;
}

/** Trava a ficha, o procedimento extra pela sequência, a conta e o item da conta que ele gerou. */
async function travarExtra(tx: TxOperacao, atendimento: number, sequencia: number): Promise<ExtraTravado> {
  const ficha = await travarFicha(tx, atendimento);
  const [proc] = await tx.consultarParaAtualizar(
    `SELECT id, versao, quantidade, conta_hospitalar_item_id FROM atendimento_procedimento
      WHERE atendimento_id = ? AND sequencia = ? AND NOT principal AND excluido_em IS NULL
        AND conta_hospitalar_item_id IS NOT NULL`,
    [atendimento, sequencia],
    { teto: 1 },
  );
  if (!proc) return { ficha, proc: null, item: null, conta: null };
  const ref = await tx.uma('SELECT conta_hospitalar_id AS c FROM conta_hospitalar_item WHERE id = ?', [
    Number(proc['conta_hospitalar_item_id']),
  ]);
  const [conta] = await tx.consultarParaAtualizar(
    'SELECT id, versao, situacao FROM conta_hospitalar WHERE id = ? AND excluido_em IS NULL',
    [Number(ref?.['c'] ?? 0)],
    { teto: 1 },
  );
  const [item] = await tx.consultarParaAtualizar(
    `SELECT id, versao, situacao, quantidade, valor_total, valor_honorario, valor_custo_operacional, valor_filme,
            realizado_em
       FROM conta_hospitalar_item WHERE id = ? AND excluido_em IS NULL AND situacao IN ('lancado','conferido')`,
    [Number(proc['conta_hospitalar_item_id'])],
    { teto: 1 },
  );
  return { ficha, proc, item: item ?? null, conta: conta ?? null };
}

async function fecharMudancaNaConta(
  tx: TxOperacao,
  conta: Linha,
  item: number,
  operacao: 'alteracao' | 'exclusao',
  dados: Record<string, unknown>,
): Promise<void> {
  await tx.incluir('conta_hospitalar_item_memoria', {
    conta_hospitalar_item_id: item,
    preco_manual: 0,
    operacao,
    dados: JSON.stringify({ origem: 'recepcao', ...dados }),
    ocorrido_em: new Date(),
    usuario_id: tx.contexto.usuario,
  });
  // O total da conta a partir dos itens, na mesma transação (sem gatilho); a produção do repasse acompanha.
  await tx.alterar(
    'conta_hospitalar',
    Number(conta['id']),
    Number(conta['versao']),
    await totalDosItens(tx, Number(conta['id'])),
  );
  await sincronizarProducaoDaConta(
    tx,
    { conta: Number(conta['id']), itens: [item], evento: 'mudanca-item' },
    { estabelecimento: tx.contexto.estabelecimento, usuario: tx.contexto.usuario },
  );
}

export const OPERACAO_ESTORNAR_EXTRA = definirOperacao({
  nome: 'atendimento.estornar-procedimento-extra',
  tabelas: TABELAS_EXTRA,
  entrada: esquemaEstornarProcedimentoExtra,
  acao: 'alteracao',
  critica: true,
  async gravar(tx, e) {
    const x = await travarExtra(tx, Number(e.atendimento), e.sequencia);
    recusar(
      recusaEstornoExtra({
        existe: x.proc !== null && x.item !== null,
        contaAceita: x.conta !== null && contaAceitaLancamento(String(x.conta['situacao'])),
      }),
      ['sequencia'],
    );
    const item = x.item!;
    const proc = x.proc!;
    await tx.alterar('conta_hospitalar_item', Number(item['id']), Number(item['versao']), {
      situacao: 'estornado',
    });
    await tx.alterar('atendimento_procedimento', Number(proc['id']), Number(proc['versao']), {
      excluido_em: new Date(),
      excluido_por: tx.contexto.usuario,
    });
    await fecharMudancaNaConta(tx, x.conta!, Number(item['id']), 'exclusao', {
      justificativa: e.justificativa,
      valorAntes: Number(item['valor_total']),
    });
    return {
      reg: Number(x.ficha['id']),
      seq: e.sequencia,
      conta: Number(x.conta!['id']),
      quantidade: Number(item['quantidade']),
      valor: Number(item['valor_total']),
    };
  },
  eventos: (_e, r) => [
    {
      tipo: 'faturamento.item.estornado',
      carga: { conta: Number(r['conta']), atendimento: Number(r['reg']) },
    },
  ],
  alvo: (e) => ({ tabela: 'atendimento', id: Number(e.atendimento) }),
});

export const OPERACAO_CORRIGIR_EXTRA = definirOperacao({
  nome: 'atendimento.corrigir-procedimento-extra',
  tabelas: TABELAS_EXTRA,
  entrada: esquemaCorrigirProcedimentoExtra,
  acao: 'alteracao',
  async gravar(tx, e) {
    const x = await travarExtra(tx, Number(e.atendimento), e.sequencia);
    const fuso = await fusoDo(tx);
    const realizado = quando(x.item?.['realizado_em']) ?? new Date();
    const localRealizado = noFuso(realizado, fuso);
    const qAntes = Number(x.item?.['quantidade'] ?? 0);
    recusar(
      recusaCorrecaoExtra(
        {
          existe: x.proc !== null && x.item !== null,
          contaAceita: x.conta !== null && contaAceitaLancamento(String(x.conta['situacao'])),
          quantidadeAtual: qAntes,
          dataAtual: localRealizado.slice(0, 10),
          dataAtendimento: noFuso(quando(x.ficha['entrada_em']) ?? new Date(), fuso).slice(0, 10),
          hoje: noFuso(new Date(), fuso).slice(0, 10),
        },
        { quantidade: e.quantidade, data: e.data },
      ),
      e.data !== undefined && e.quantidade === undefined ? ['data'] : ['quantidade'],
    );
    const item = x.item!;
    const q = e.quantidade ?? qAntes;
    const valores: Record<string, unknown> = { quantidade: q };
    for (const c of ['valor_total', 'valor_honorario', 'valor_custo_operacional', 'valor_filme'])
      valores[c] = valorNaQuantidade(Number(item[c] ?? 0), qAntes, q);
    if (e.data !== undefined)
      valores['realizado_em'] = new Date(dataHoraParaInstante(e.data, localRealizado.slice(11, 16), fuso));
    await tx.alterar('conta_hospitalar_item', Number(item['id']), Number(item['versao']), valores);
    if (q !== qAntes)
      await tx.alterar('atendimento_procedimento', Number(x.proc!['id']), Number(x.proc!['versao']), {
        quantidade: q,
      });
    await fecharMudancaNaConta(tx, x.conta!, Number(item['id']), 'alteracao', {
      justificativa: e.justificativa,
      quantidadeAntes: qAntes,
      quantidade: q,
      valorAntes: Number(item['valor_total']),
      valor: valores['valor_total'],
      ...(e.data !== undefined ? { dataAntes: localRealizado.slice(0, 10), data: e.data } : {}),
    });
    return {
      reg: Number(x.ficha['id']),
      seq: e.sequencia,
      conta: Number(x.conta!['id']),
      quantidadeAntes: qAntes,
      quantidade: q,
      valorAntes: Number(item['valor_total']),
      valor: Number(valores['valor_total']),
    };
  },
  eventos: (_e, r) => [
    {
      tipo: 'faturamento.item.corrigido',
      carga: { conta: Number(r['conta']), atendimento: Number(r['reg']) },
    },
  ],
  alvo: (e) => ({ tabela: 'atendimento', id: Number(e.atendimento) }),
});

/** As operações da correção da ficha pelo nome da tela. */
export const OPERACOES_CORRECAO_FICHA = {
  'atendimento.alterarSegurado': OPERACAO_ALTERAR_SEGURADO,
  'atendimento.alterarAtendimento': OPERACAO_ALTERAR_ATENDIMENTO,
  'atendimento.corrigirProcedimentoExtra': OPERACAO_CORRIGIR_EXTRA,
  'atendimento.estornarProcedimentoExtra': OPERACAO_ESTORNAR_EXTRA,
} as const;
