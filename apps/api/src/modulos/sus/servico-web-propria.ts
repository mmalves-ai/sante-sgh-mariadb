// F7, 08-INTG linha 131: troca por serviço web com o SUS (rastreamento de câncer e cadastro de prestador) no banco
// próprio, pelo executor do @sgh/nucleo (trilha e idempotência na mesma transação). As regras são do
// @sgh/dominio-faturamento (sus/servico-web.ts); aqui ficam as leituras e a gravação nas tabelas do modelo:
//   envio_webservice_sus (um por registro enviado: conteúdo como foi transmitido, cartão informado e confirmado,
//   protocolo, situação e tentativas) e envio_webservice_sus_retorno (uma linha por resposta ou crítica, em sequência).
// O transporte (simulador fora de produção) fica fora da transação: o controlador lê o envio, chama o enviador e grava
// a resposta pela operação, que confere de novo a situação e a versão sob a trava. Nada é apagado: o cancelado e o
// rejeitado ficam, com o motivo do cancelamento na trilha.
import {
  conferirCancelamentoWebSus,
  conferirEnvioRepetidoWebSus,
  conferirEnvioWebSus,
  type DadosServicoWebSus,
  efeitoDaRespostaWebSus,
  LINHAS_RASTREAMENTO_CANCER,
  montarPedidoServicoWebSus,
  type RecusaServicoWebSus,
  type RespostaServicoWebSus,
  SERVICOS_WEB_SUS,
  type ServicoWebSus,
  SITUACOES_ENVIO_WEB_SUS,
} from '@sgh/dominio-faturamento';
import {
  type ContextoOperacao,
  definirOperacao,
  type Leitor,
  recusa,
  type ResultadoOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';

const T_ENVIO = 'envio_webservice_sus';
const T_RETORNO = 'envio_webservice_sus_retorno';
export const TABELAS_SERVICO_WEB_SUS = [T_ENVIO, T_RETORNO] as const;

const id = z.number().int().positive();
const n = (v: unknown): number => Number(v ?? 0);
const s = (v: unknown): string | null => (v == null ? null : String(v));
const iso = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
const dia = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);

function recusar(r: RecusaServicoWebSus | null): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: [...r.campos] } : {});
}
function recusarPedido(r: RecusaServicoWebSus): never {
  recusar(r);
  throw new Error('inalcançável');
}
function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}

// ── Leituras ────────────────────────────────────────────────────────────────────────────────────────────────────

export const esquemaFiltroServicoWebSus = z
  .object({
    servico: z.enum(SERVICOS_WEB_SUS).optional(),
    situacao: z.enum(SITUACOES_ENVIO_WEB_SUS).optional(),
    paciente: id.optional(),
  })
  .strict();
export type FiltroServicoWebSus = z.infer<typeof esquemaFiltroServicoWebSus>;

export interface RetornoWebSusLido {
  sequencia: number;
  recebidoEm: string | null;
  tipo: string;
  codigo: string | null;
  campo: string | null;
  mensagem: string | null;
}
export interface EnvioWebSusLido {
  id: number;
  servico: string;
  situacao: string;
  tentativas: number;
  protocolo: string | null;
  cnsInformado: string | null;
  cnsConfirmado: string | null;
  paciente: number | null;
  pacienteNome: string | null;
  prontuario: string | null;
  exameItem: number | null;
  exameNome: string | null;
  profissional: number | null;
  profissionalNome: string | null;
  criadoEm: string | null;
  enviadoEm: string | null;
  respondidoEm: string | null;
  versao: number;
  retornos: RetornoWebSusLido[];
}

/** Os envios do estabelecimento (mais recentes primeiro; até 200), com as respostas de cada um. */
export async function painelServicoWebSus(
  l: Leitor,
  est: number,
  f: FiltroServicoWebSus,
): Promise<{ itens: EnvioWebSusLido[]; modo?: string }> {
  const onde = ['w.estabelecimento_id = ?', 'w.excluido_em IS NULL'];
  const p: unknown[] = [est];
  if (f.servico) {
    onde.push('w.tipo_servico = ?');
    p.push(f.servico);
  }
  if (f.situacao) {
    onde.push('w.situacao = ?');
    p.push(f.situacao);
  }
  if (f.paciente) {
    onde.push('w.paciente_id = ?');
    p.push(f.paciente);
  }
  const linhas = await l.consultar(
    `SELECT w.id, w.tipo_servico, w.situacao, w.tentativas, w.protocolo, w.cns_informado, w.cns_confirmado,
            w.paciente_id, pp.nome AS paciente_nome, pa.numero_prontuario, w.exame_item_id, ex.nome AS exame_nome,
            w.profissional_id, pr.nome AS profissional_nome, w.criado_em, w.enviado_em, w.respondido_em, w.versao
       FROM envio_webservice_sus w
       LEFT JOIN paciente pa ON pa.id = w.paciente_id
       LEFT JOIN pessoa_fisica pp ON pp.id = pa.pessoa_fisica_id
       LEFT JOIN exame_item ei ON ei.id = w.exame_item_id
       LEFT JOIN exame ex ON ex.id = ei.exame_id
       LEFT JOIN profissional pf ON pf.id = w.profissional_id
       LEFT JOIN pessoa_fisica pr ON pr.id = pf.pessoa_fisica_id
      WHERE ${onde.join(' AND ')}
      ORDER BY w.id DESC LIMIT 200`,
    p,
  );
  const ids = linhas.map((x) => n(x['id']));
  const rets = ids.length
    ? await l.consultar(
        `SELECT envio_webservice_sus_id, sequencia, recebido_em, tipo, codigo_retorno, campo, mensagem
           FROM envio_webservice_sus_retorno WHERE excluido_em IS NULL
            AND envio_webservice_sus_id IN (${ids.map(() => '?').join(', ')}) ORDER BY sequencia`,
        ids,
      )
    : [];
  return {
    itens: linhas.map((x) => ({
      id: n(x['id']),
      servico: String(x['tipo_servico']),
      situacao: String(x['situacao']),
      tentativas: n(x['tentativas']),
      protocolo: s(x['protocolo']),
      cnsInformado: s(x['cns_informado']),
      cnsConfirmado: s(x['cns_confirmado']),
      paciente: x['paciente_id'] == null ? null : n(x['paciente_id']),
      pacienteNome: s(x['paciente_nome']),
      prontuario: s(x['numero_prontuario']),
      exameItem: x['exame_item_id'] == null ? null : n(x['exame_item_id']),
      exameNome: s(x['exame_nome']),
      profissional: x['profissional_id'] == null ? null : n(x['profissional_id']),
      profissionalNome: s(x['profissional_nome']),
      criadoEm: iso(x['criado_em']),
      enviadoEm: iso(x['enviado_em']),
      respondidoEm: iso(x['respondido_em']),
      versao: n(x['versao']),
      retornos: rets
        .filter((r) => n(r['envio_webservice_sus_id']) === n(x['id']))
        .map((r) => ({
          sequencia: n(r['sequencia']),
          recebidoEm: iso(r['recebido_em']),
          tipo: String(r['tipo']),
          codigo: s(r['codigo_retorno']),
          campo: s(r['campo']),
          mensagem: s(r['mensagem']),
        })),
    })),
  };
}

/** Visão por paciente (pelo prontuário): o paciente, o cartão (só se há e se vale) e os exames pedidos aqui. */
export async function candidatosRastreamento(
  l: Leitor,
  est: number,
  prontuario: string,
): Promise<{
  paciente: { id: number; nome: string; temCns: boolean } | null;
  exames: {
    exameItem: number;
    exame: string;
    requisicao: string;
    solicitadoEm: string;
    situacao: string;
    envio: number | null;
    envioSituacao: string | null;
  }[];
}> {
  const pac = await l.uma(
    `SELECT pa.id, pf.nome, pf.cns FROM paciente pa JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
      WHERE pa.numero_prontuario = ? LIMIT 1`,
    [prontuario],
  );
  if (!pac) return { paciente: null, exames: [] };
  const exames = await l.consultar(
    `SELECT ei.id, ex.nome, rq.numero, rq.solicitado_em, ei.situacao,
            (SELECT MAX(w.id) FROM envio_webservice_sus w WHERE w.exame_item_id = ei.id
                AND w.tipo_servico = 'rastreamento_cancer') AS envio
       FROM exame_item ei JOIN requisicao_exame rq ON rq.id = ei.requisicao_exame_id
       LEFT JOIN exame ex ON ex.id = ei.exame_id
      WHERE rq.paciente_id = ? AND rq.estabelecimento_id = ?
      ORDER BY rq.solicitado_em DESC, ei.sequencia LIMIT 100`,
    [n(pac['id']), est],
  );
  const envios = exames.map((e) => e['envio']).filter((x) => x != null);
  const sit = envios.length
    ? await l.consultar(
        `SELECT id, situacao FROM envio_webservice_sus WHERE id IN (${envios.map(() => '?').join(', ')})`,
        envios,
      )
    : [];
  return {
    paciente: { id: n(pac['id']), nome: String(pac['nome']), temCns: !!s(pac['cns'])?.trim() },
    exames: exames.map((e) => ({
      exameItem: n(e['id']),
      exame: s(e['nome']) ?? '',
      requisicao: String(e['numero']),
      solicitadoEm: dia(e['solicitado_em']),
      situacao: String(e['situacao']),
      envio: e['envio'] == null ? null : n(e['envio']),
      envioSituacao: s(sit.find((x) => n(x['id']) === n(e['envio']))?.['situacao']),
    })),
  };
}

/** Profissionais pelo nome (até 20), com o cartão e a ocupação principal, para o cadastro de prestador. */
export async function candidatosPrestador(
  l: Leitor,
  termo: string,
): Promise<{ id: number; nome: string; temCns: boolean; cbo: string | null; ativo: boolean }[]> {
  const linhas = await l.consultar(
    `SELECT pf.id, pe.nome, pe.cns, pf.situacao,
            (SELECT oc.codigo_cbo FROM profissional_ocupacao po JOIN ocupacao_cbo oc ON oc.id = po.ocupacao_cbo_id
              WHERE po.profissional_id = pf.id AND po.ativo = 1 ORDER BY po.principal DESC, po.id LIMIT 1) AS cbo
       FROM profissional pf JOIN pessoa_fisica pe ON pe.id = pf.pessoa_fisica_id
      WHERE pe.nome LIKE ? ORDER BY pe.nome LIMIT 20`,
    [`%${termo.replace(/[%_\\]/g, '')}%`],
  );
  return linhas.map((x) => ({
    id: n(x['id']),
    nome: String(x['nome']),
    temCns: !!s(x['cns'])?.trim(),
    cbo: s(x['cbo']),
    ativo: x['situacao'] === 'ativo',
  }));
}

/** O envio a transmitir (o conteúdo gravado, como vai ao serviço), ou null. */
export async function envioParaTransmitir(
  l: Leitor,
  est: number,
  envio: number,
): Promise<{
  servico: ServicoWebSus;
  situacao: string;
  tentativas: number;
  versao: number;
  conteudo: Record<string, unknown>;
} | null> {
  const x = await l.uma(
    `SELECT tipo_servico, situacao, tentativas, versao, conteudo_enviado FROM envio_webservice_sus
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [envio, est],
  );
  if (!x) return null;
  const c = x['conteudo_enviado'];
  return {
    servico: String(x['tipo_servico']) as ServicoWebSus,
    situacao: String(x['situacao']),
    tentativas: n(x['tentativas']),
    versao: n(x['versao']),
    conteudo: (typeof c === 'string' ? JSON.parse(c) : (c ?? {})) as Record<string, unknown>,
  };
}

// ── Operações ───────────────────────────────────────────────────────────────────────────────────────────────────

export const esquemaRegistrarServicoWebSus = z.discriminatedUnion('servico', [
  z
    .object({
      servico: z.literal('rastreamento_cancer'),
      exameItem: id,
      linha: z.enum(LINHAS_RASTREAMENTO_CANCER),
    })
    .strict(),
  z.object({ servico: z.literal('cadastro_prestador'), profissional: id }).strict(),
]);
export type RegistrarServicoWebSusEntrada = z.infer<typeof esquemaRegistrarServicoWebSus>;

const registrar = definirOperacao<RegistrarServicoWebSusEntrada, ResultadoOperacao>({
  nome: 'faturamento.sus_servico_web_registrar',
  tabelas: [T_ENVIO],
  entrada: esquemaRegistrarServicoWebSus as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const estab = await tx.uma('SELECT codigo_cnes FROM estabelecimento WHERE id = ?', [est]);
    const cnes = s(estab?.['codigo_cnes']);
    let dados: DadosServicoWebSus;
    let ligacao: Record<string, unknown>;
    let repetidos;
    if (e.servico === 'rastreamento_cancer') {
      const x = await tx.uma(
        `SELECT ei.id, ei.sequencia, ei.situacao, ex.codigo, rq.numero, rq.solicitado_em, rq.paciente_id,
                rq.atendimento_id, pf.cns
           FROM exame_item ei JOIN requisicao_exame rq ON rq.id = ei.requisicao_exame_id
           JOIN exame ex ON ex.id = ei.exame_id
           JOIN paciente pa ON pa.id = rq.paciente_id JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
          WHERE ei.id = ? AND rq.estabelecimento_id = ?`,
        [e.exameItem, est],
      );
      if (!x)
        throw recusa('exame-inexistente', 'Exame não encontrado neste estabelecimento.', {
          campos: ['exameItem'],
        });
      dados = {
        servico: 'rastreamento_cancer',
        cnes,
        linha: e.linha,
        cnsPaciente: s(x['cns']),
        exameSituacao: String(x['situacao']),
        exameCodigo: String(x['codigo']),
        requisicaoNumero: String(x['numero']),
        sequencia: n(x['sequencia']),
        solicitadoEm: dia(x['solicitado_em']),
      };
      ligacao = {
        paciente_id: n(x['paciente_id']),
        atendimento_id: n(x['atendimento_id']),
        exame_item_id: e.exameItem,
      };
      repetidos = await tx.consultarParaAtualizar(
        `SELECT id, situacao FROM envio_webservice_sus
          WHERE estabelecimento_id = ? AND tipo_servico = 'rastreamento_cancer' AND exame_item_id = ?`,
        [est, e.exameItem],
      );
    } else {
      const x = await tx.uma(
        `SELECT pf.id, pf.situacao, pe.cns,
                (SELECT oc.codigo_cbo FROM profissional_ocupacao po JOIN ocupacao_cbo oc ON oc.id = po.ocupacao_cbo_id
                  WHERE po.profissional_id = pf.id AND po.ativo = 1 ORDER BY po.principal DESC, po.id LIMIT 1) AS cbo
           FROM profissional pf JOIN pessoa_fisica pe ON pe.id = pf.pessoa_fisica_id WHERE pf.id = ?`,
        [e.profissional],
      );
      if (!x)
        throw recusa('profissional-inexistente', 'Profissional não encontrado.', {
          campos: ['profissional'],
        });
      dados = {
        servico: 'cadastro_prestador',
        cnes,
        profissionalAtivo: x['situacao'] === 'ativo',
        cnsProfissional: s(x['cns']),
        cbo: s(x['cbo']),
      };
      ligacao = { profissional_id: e.profissional };
      repetidos = await tx.consultarParaAtualizar(
        `SELECT id, situacao FROM envio_webservice_sus
          WHERE estabelecimento_id = ? AND tipo_servico = 'cadastro_prestador' AND profissional_id = ?`,
        [est, e.profissional],
      );
    }
    const pedido = montarPedidoServicoWebSus(dados);
    if (!pedido.ok) return recusarPedido(pedido.recusa);
    recusar(
      conferirEnvioRepetidoWebSus(
        e.servico,
        repetidos.map((r) => ({ id: n(r['id']), situacao: String(r['situacao']) })),
      ),
    );
    const envio = await tx.incluir(T_ENVIO, {
      estabelecimento_id: est,
      ...ligacao,
      tipo_servico: e.servico,
      cns_informado: pedido.cnsInformado,
      situacao: 'pendente',
      conteudo_enviado: JSON.stringify(pedido.conteudo),
      tentativas: 0,
      origem: 'sistema',
    });
    return { envio, servico: e.servico, situacao: 'pendente' };
  },
  alvo: (_e, r) => ({ tabela: T_ENVIO, id: n(r['envio']) || null }),
});

const esquemaCritica = z
  .object({
    tipo: z.enum(['aviso', 'erro']),
    codigo: z.string().max(30).nullable(),
    campo: z.string().max(150).nullable(),
    mensagem: z.string().max(1000),
  })
  .strict();
export const esquemaRespostaServicoWebSus = z
  .object({
    envio: id,
    versao: z.number().int().positive(),
    resposta: z.discriminatedUnion('chegou', [
      z
        .object({
          chegou: z.literal(true),
          protocolo: z.string().max(60).nullable(),
          tipoProtocolo: z.string().max(30).nullable(),
          cnsConfirmado: z.string().max(20).nullable(),
          criticas: z.array(esquemaCritica).max(50),
        })
        .strict(),
      z.object({ chegou: z.literal(false), mensagem: z.string().max(1000) }).strict(),
    ]),
  })
  .strict();
export type RespostaServicoWebSusEntrada = z.infer<typeof esquemaRespostaServicoWebSus>;

/** Grava o que o transporte devolveu (só chamada pelo controlador, depois do enviador; nunca pelo corpo da rota). */
const gravarResposta = definirOperacao<RespostaServicoWebSusEntrada, ResultadoOperacao>({
  nome: 'faturamento.sus_servico_web_resposta',
  tabelas: [T_ENVIO, T_RETORNO],
  entrada: esquemaRespostaServicoWebSus as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const [x] = await tx.consultarParaAtualizar(
      'SELECT id, situacao, tentativas, versao FROM envio_webservice_sus WHERE id = ? AND estabelecimento_id = ?',
      [e.envio, est],
    );
    if (!x) throw recusa('envio-inexistente', 'Envio não encontrado.', { campos: ['envio'] });
    if (n(x['versao']) !== e.versao)
      throw recusa('envio-alterado', 'O envio mudou enquanto ia ao serviço: confira e tente de novo.', {
        campos: ['envio'],
      });
    recusar(conferirEnvioWebSus(String(x['situacao']), n(x['tentativas'])));
    const ef = efeitoDaRespostaWebSus(e.resposta as RespostaServicoWebSus);
    const agora = new Date();
    await tx.alterar(T_ENVIO, e.envio, e.versao, {
      situacao: ef.situacao,
      tentativas: n(x['tentativas']) + 1,
      enviado_em: agora,
      respondido_em: e.resposta.chegou ? agora : null,
      protocolo: ef.protocolo,
      tipo_protocolo: ef.tipoProtocolo,
      cns_confirmado: ef.cnsConfirmado,
    });
    const seq = await tx.uma(
      'SELECT COALESCE(MAX(sequencia), 0) AS s FROM envio_webservice_sus_retorno WHERE envio_webservice_sus_id = ?',
      [e.envio],
    );
    let sequencia = n(seq?.['s']);
    for (const r of ef.retornos)
      await tx.incluir(T_RETORNO, {
        envio_webservice_sus_id: e.envio,
        sequencia: ++sequencia,
        recebido_em: agora,
        tipo: r.tipo,
        codigo_retorno: r.codigo,
        campo: r.campo,
        mensagem: r.mensagem,
        conteudo: JSON.stringify(e.resposta),
        origem: 'integracao',
      });
    return {
      envio: e.envio,
      situacao: ef.situacao,
      protocolo: ef.protocolo,
      retornos: ef.retornos.length,
      tentativas: n(x['tentativas']) + 1,
    };
  },
  alvo: (e) => ({ tabela: T_ENVIO, id: e.envio }),
});

export const esquemaCancelarServicoWebSus = z
  .object({ envio: id, versao: z.number().int().positive(), motivo: z.string().max(500) })
  .strict();
export type CancelarServicoWebSusEntrada = z.infer<typeof esquemaCancelarServicoWebSus>;

const cancelar = definirOperacao<CancelarServicoWebSusEntrada, ResultadoOperacao>({
  nome: 'faturamento.sus_servico_web_cancelar',
  tabelas: [T_ENVIO],
  entrada: esquemaCancelarServicoWebSus as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const [x] = await tx.consultarParaAtualizar(
      'SELECT id, situacao FROM envio_webservice_sus WHERE id = ? AND estabelecimento_id = ?',
      [e.envio, est],
    );
    if (!x) throw recusa('envio-inexistente', 'Envio não encontrado.', { campos: ['envio'] });
    recusar(conferirCancelamentoWebSus(String(x['situacao']), e.motivo));
    await tx.alterar(T_ENVIO, e.envio, e.versao, { situacao: 'cancelado' });
    return { envio: e.envio, situacao: 'cancelado', anterior: String(x['situacao']) };
  },
  alvo: (e) => ({ tabela: T_ENVIO, id: e.envio }),
  trilha: (e) => ({ motivo: e.motivo.trim() }),
});

export const OPERACOES_SERVICO_WEB_SUS = {
  'faturamento.susServicoWebRegistrar': registrar,
  'faturamento.susServicoWebResposta': gravarResposta,
  'faturamento.susServicoWebCancelar': cancelar,
} as const;
