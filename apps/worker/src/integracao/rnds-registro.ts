// C2-085 (08-INTG L130): o registro do envio à Rede Nacional de Dados em Saúde no banco próprio e o envio do sumário de
// alta e do resultado de exame pelo worker.
//   - Cada documento (vacina, sumário, resultado) tem um envio em `envio_rnds` (identificador local estável) e uma linha
//     por versão em `envio_rnds_versao` (original, substituição, cancelamento) com a situação, o retorno e o
//     identificador nacional recebido. Nada é apagado: a resposta nova atualiza a versão e o envio.
//   - Os perfis BR Core que os documentos usam ficam fixados em `perfil_fhir` (url canônica e versão do pacote).
//   - O CNS usado com a RNDS fica em `identificador_externo_pessoa` (sistema "rnds"); sem CNS no cadastro, ele é a
//     segunda via de identificação do paciente (CPF primeiro).
//   - O sumário e o resultado saem do evento `fato.rnds.documento` posto na fila pela API (o objeto é o envio); o
//     destino é o mesmo do RIA: em dev e ci, SEMPRE o simulador local (regra 6); fora dele, só com a credencial.
// O conteúdo do documento nunca vai ao log. As gravações são uma operação declarada do executor.
import {
  destinoRia,
  documentoResultadoExameRnds,
  documentoSumarioAltaRnds,
  type EntradaDocumentoRnds,
  identificacaoRnds,
  type IdentificacaoRnds,
  identificadorLocalRnds,
  motivoBloqueioRnds,
  motivoDaRecusaRnds,
  PERFIL_DO_DOCUMENTO,
  PERFIS_FHIR_RNDS,
  reciboDaRnds,
  type RespostaRnds,
  SISTEMA_EXTERNO_RNDS,
  situacoesDaResposta,
  type TipoDocumentoRnds,
  type TipoVersaoRnds,
  versaoDoEventoVacina,
} from '@sgh/dominio-integracao';
import type { Leitor, TxOperacao } from '@sgh/nucleo';
import { ErroEntrega } from './entrega.js';
import type { ConfiguracaoEnviadores } from './enviadores.js';
import type { EnvioEntrega } from './porta-propria.js';

export const OPERACAO_REGISTRO_RNDS = 'integracao.rnds.registro';
export const TABELAS_REGISTRO_RNDS: readonly string[] = [
  'envio_rnds',
  'envio_rnds_versao',
  'perfil_fhir',
  'padrao_troca',
  'sistema_externo',
  'identificador_externo_pessoa',
];

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const dataDe = (v: unknown): Date | null =>
  v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v));

// ---- perfis, sistema e identificador do paciente ----

/** Fixa os perfis BR Core dos documentos (inclui os que faltam; os já fixados ficam como estão). */
export async function fixarPerfisFhir(tx: TxOperacao, agora: Date): Promise<Map<string, number>> {
  let padrao = await tx.uma<{ id: unknown }>(
    "SELECT id FROM padrao_troca WHERE familia = 'fhir' AND ativo = TRUE ORDER BY id LIMIT 1",
    [],
  );
  if (!padrao)
    padrao = {
      id: await tx.incluir('padrao_troca', {
        codigo: 'fhir-r4',
        descricao: 'HL7 FHIR R4',
        familia: 'fhir',
        versao_padrao: '4.0.1',
        tipo_conteudo: 'application/fhir+json',
      }),
    };
  const ja = new Map<string, number>(
    (
      await tx.consultar('SELECT id, codigo FROM perfil_fhir WHERE codigo LIKE ?', ['br-core-%'], {
        teto: 500,
      })
    ).map((x) => [String(x['codigo']), Number(x['id'])]),
  );
  for (const p of PERFIS_FHIR_RNDS) {
    if (ja.has(p.codigo)) continue;
    const id = await tx.incluir('perfil_fhir', {
      codigo: p.codigo,
      nome: p.nome,
      padrao_troca_id: Number(padrao.id),
      url_canonica: p.urlCanonica,
      versao_perfil: p.versaoPerfil,
      versao_fhir: 'R4',
      recurso: p.recurso,
      fixado_em: agora,
      ativo: true,
    });
    ja.set(p.codigo, id);
  }
  return ja;
}

/** O sistema externo da rede nacional (criado na primeira vez). */
export async function sistemaRnds(tx: TxOperacao): Promise<number> {
  const s = await tx.uma<{ id: unknown }>(
    'SELECT id FROM sistema_externo WHERE codigo = ? AND excluido_em IS NULL',
    [SISTEMA_EXTERNO_RNDS],
  );
  if (s) return Number(s.id);
  return tx.incluir('sistema_externo', {
    codigo: SISTEMA_EXTERNO_RNDS,
    nome: 'Rede Nacional de Dados em Saúde',
    categoria: 'governo',
    finalidade: 'Envio de vacina, sumário de alta e resultado de exame (Portaria GM/MS 1.434/2020)',
    ambiente: 'teste',
  });
}

/** A identificação do paciente na RNDS (CPF, CNS do cadastro e o CNS já usado com a rede) e a pessoa. */
export const SQL_IDENTIFICACAO_RNDS = `SELECT pf.id AS pessoa, pf.cpf, pf.cns,
    (SELECT i.identificador FROM identificador_externo_pessoa i JOIN sistema_externo s ON s.id = i.sistema_externo_id
      WHERE i.pessoa_fisica_id = pf.id AND s.codigo = 'rnds' AND i.tipo_identificador IN ('cns','cns_provisorio')
        AND i.situacao = 'ativo' AND i.excluido_em IS NULL ORDER BY i.principal DESC, i.id DESC LIMIT 1) AS cns_rnds
  FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE p.id = ?`;

export function identificacaoDaLinha(x: Record<string, unknown> | null): {
  pessoa: number | null;
  identificacao: IdentificacaoRnds;
} {
  if (!x) return { pessoa: null, identificacao: identificacaoRnds({ cpf: null, cns: null }) };
  return {
    pessoa: Number(x['pessoa']),
    identificacao: identificacaoRnds({ cpf: texto(x['cpf']), cns: texto(x['cns']) ?? texto(x['cns_rnds']) }),
  };
}

/** Guarda o CNS usado com a rede (o mesmo CNS de outra pessoa não é sobrescrito: devolve "conflito"). */
export async function registrarIdentificadorRnds(
  tx: TxOperacao,
  pessoa: number,
  cns: string,
  agora: Date,
): Promise<'incluido' | 'existente' | 'conflito'> {
  const sistema = await sistemaRnds(tx);
  const tipo = /^[789]/.test(cns) ? 'cns_provisorio' : 'cns';
  const ja = await tx.uma<{ pessoa_fisica_id: unknown }>(
    `SELECT pessoa_fisica_id FROM identificador_externo_pessoa
      WHERE sistema_externo_id = ? AND tipo_identificador = ? AND identificador = ?`,
    [sistema, tipo, cns],
  );
  if (ja) return Number(ja.pessoa_fisica_id) === pessoa ? 'existente' : 'conflito';
  const principal = await tx.uma(
    `SELECT id FROM identificador_externo_pessoa WHERE pessoa_fisica_id = ? AND sistema_externo_id = ?
        AND principal = TRUE AND situacao = 'ativo' AND excluido_em IS NULL LIMIT 1`,
    [pessoa, sistema],
  );
  await tx.incluir('identificador_externo_pessoa', {
    pessoa_fisica_id: pessoa,
    sistema_externo_id: sistema,
    tipo_identificador: tipo,
    identificador: cns,
    principal: !principal,
    situacao: 'ativo',
    validado_em: agora,
  });
  return 'incluido';
}

// ---- envio e versões ----

export interface DadosEnvioRnds {
  readonly hospital: string;
  readonly tipo: TipoDocumentoRnds;
  readonly registro: number;
  readonly paciente: number;
  readonly atendimento: number | null;
  readonly profissional: number | null;
  readonly numero: number;
  readonly tipoVersao: TipoVersaoRnds;
}

const OPERACAO_DA_VERSAO: Readonly<Record<TipoVersaoRnds, string>> = {
  original: 'inclusao',
  substituicao: 'alteracao',
  cancelamento: 'exclusao',
};
const COLUNA_DO_REGISTRO: Readonly<Record<TipoDocumentoRnds, string>> = {
  imunizacao: 'vacina_aplicada_id',
  sumario_alta: 'sumario_alta_id',
  resultado_exame: 'resultado_exame_id',
};

/** O envio do documento e a linha da versão (cria os que faltam; o reenvio da mesma versão reaproveita). */
export async function garantirEnvioRnds(tx: TxOperacao, d: DadosEnvioRnds, agora: Date): Promise<number> {
  const est = await tx.uma<{ id: unknown }>(
    'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
    [d.hospital],
  );
  if (!est) throw new ErroEntrega('estabelecimento do envio à RNDS não encontrado');
  const perfis = await fixarPerfisFhir(tx, agora);
  const local = identificadorLocalRnds(d.hospital, d.tipo, d.registro);
  const [x] = await tx.consultarParaAtualizar(
    'SELECT id, versao_atual, versao FROM envio_rnds WHERE identificador_local = ?',
    [local],
    { teto: 1 },
  );
  let envio: number;
  if (!x)
    envio = await tx.incluir('envio_rnds', {
      estabelecimento_id: Number(est.id),
      paciente_id: d.paciente,
      atendimento_id: d.atendimento,
      profissional_id: d.profissional,
      perfil_fhir_id: perfis.get(PERFIL_DO_DOCUMENTO[d.tipo]) ?? null,
      [COLUNA_DO_REGISTRO[d.tipo]]: d.registro,
      tipo_documento: d.tipo,
      identificador_local: local,
      versao_atual: d.numero,
      situacao: 'pendente',
    });
  else {
    envio = Number(x['id']);
    if (Number(x['versao_atual']) < d.numero)
      await tx.alterar('envio_rnds', envio, Number(x['versao']), {
        versao_atual: d.numero,
        situacao: 'pendente',
      });
  }
  const v = await tx.uma('SELECT id FROM envio_rnds_versao WHERE envio_rnds_id = ? AND numero_versao = ?', [
    envio,
    d.numero,
  ]);
  if (!v)
    await tx.incluir('envio_rnds_versao', {
      envio_rnds_id: envio,
      operacao: OPERACAO_DA_VERSAO[d.tipoVersao],
      ocorrido_em: agora,
      numero_versao: d.numero,
      tipo_versao: d.tipoVersao,
      situacao: 'pendente',
    });
  return envio;
}

export interface RespostaRegistrada {
  readonly envio: number;
  readonly numero: number;
  readonly resposta: RespostaRnds;
  readonly identificadorNacional: string | null;
  readonly mensagem: string | null;
}

/** Aplica a resposta da RNDS à versão e ao envio (e guarda o CNS usado quando aceito). Devolve a situação nova. */
export async function registrarRespostaRnds(
  tx: TxOperacao,
  r: RespostaRegistrada,
  agora: Date,
): Promise<string> {
  const [e] = await tx.consultarParaAtualizar(
    `SELECT id, paciente_id, tentativas, versao, aceito_em, identificador_nacional FROM envio_rnds
      WHERE id = ? AND excluido_em IS NULL`,
    [r.envio],
    { teto: 1 },
  );
  // Sem lançar dentro da transação (o executor traduziria em erro interno): a recusa volta no texto.
  if (!e) return 'recusado: envio à RNDS não encontrado';
  const [v] = await tx.consultarParaAtualizar(
    'SELECT id, tipo_versao, versao FROM envio_rnds_versao WHERE envio_rnds_id = ? AND numero_versao = ?',
    [r.envio, r.numero],
    { teto: 1 },
  );
  if (!v) return 'recusado: versão do envio à RNDS não encontrada';
  const tipo = String(v['tipo_versao']) as TipoVersaoRnds;
  const s = situacoesDaResposta(tipo, r.resposta);
  const aceito = s.versao === 'aceito';
  const codigo = 'falha' in r.resposta ? 'transporte' : `HTTP ${r.resposta.status}`;
  const mensagem = r.mensagem?.slice(0, 1000) ?? null;
  await tx.alterar('envio_rnds_versao', Number(v['id']), Number(v['versao']), {
    situacao: s.versao,
    enviado_em: 'falha' in r.resposta ? null : agora,
    respondido_em: 'falha' in r.resposta ? null : agora,
    codigo_retorno: codigo,
    mensagem_retorno: aceito ? null : mensagem,
    identificador_nacional: aceito ? r.identificadorNacional : null,
  });
  await tx.alterar('envio_rnds', r.envio, Number(e['versao']), {
    situacao: s.envio,
    tentativas: Number(e['tentativas']) + 1,
    enviado_em: agora,
    aceito_em: aceito ? agora : (dataDe(e['aceito_em']) ?? null),
    identificador_nacional: aceito
      ? (r.identificadorNacional ?? texto(e['identificador_nacional']))
      : texto(e['identificador_nacional']),
    codigo_erro: aceito ? null : codigo,
    mensagem_erro: aceito ? null : mensagem,
  });
  if (aceito) {
    const p = identificacaoDaLinha(await tx.uma(SQL_IDENTIFICACAO_RNDS, [Number(e['paciente_id'])]));
    if (p.pessoa !== null && p.identificacao.tipo !== 'nenhuma' && p.identificacao.cns)
      await registrarIdentificadorRnds(tx, p.pessoa, p.identificacao.cns, agora);
  }
  return s.envio;
}

// ---- transporte ----

export interface RespostaHttpRnds {
  readonly status: number;
  readonly corpo: string;
  readonly location: string | null;
  readonly ambiente: string;
}

/** O POST do documento ao destino da RNDS (simulador em dev e ci; certificado fora dele). Falha de transporte lança. */
export async function postarRnds(
  c: ConfiguracaoEnviadores,
  conteudo: string,
  chave: string,
): Promise<RespostaHttpRnds> {
  const destino = (() => {
    try {
      return destinoRia({
        ambiente: c.ambiente,
        homologacaoAutorizada: c.rnds?.homologacaoAutorizada ?? false,
        credencial: c.rnds?.credencial ?? false,
        simulador: c.simuladorRnds,
      });
    } catch (x) {
      throw new ErroEntrega(x instanceof Error ? x.message.slice(0, 200) : 'destino da RNDS indisponível');
    }
  })();
  if (!destino.certificado) {
    const u = new URL(destino.url);
    if (!LOOPBACK.has(u.hostname))
      throw new ErroEntrega('simulador da RNDS fora do loopback: nada enviado', conteudo);
    const h = await fetch(destino.url, {
      method: 'POST',
      headers: { 'content-type': 'application/fhir+json', 'idempotency-key': chave.slice(0, 120) },
      body: conteudo,
      signal: AbortSignal.timeout(10_000),
    }).catch((x: unknown) => {
      throw new ErroEntrega(
        `simulador da RNDS indisponível (${x instanceof Error ? x.name : 'erro'})`,
        conteudo,
      );
    });
    return {
      status: h.status,
      corpo: await h.text().catch(() => ''),
      location: h.headers.get('location'),
      ambiente: destino.ambiente,
    };
  }
  const enviar = c.rnds?.enviarComCertificado;
  if (!enviar || !destino.autenticacao)
    throw new ErroEntrega('cliente com o certificado da RNDS não configurado: nada enviado', conteudo);
  const r = await enviar({ url: destino.url, autenticacao: destino.autenticacao }, conteudo).catch(
    (x: unknown) => {
      throw new ErroEntrega(`RNDS indisponível (${x instanceof Error ? x.name : 'erro'})`, conteudo);
    },
  );
  return { ...r, ambiente: destino.ambiente };
}

/**
 * Posta e registra: a resposta (aceita, recusada ou a falha de transporte) fica na versão e no envio; a recusa e a
 * falha voltam como ErroEntrega (a fila tenta de novo ou põe no monitor). Sem a gravação configurada, nada sai.
 */
export async function postarERegistrar(
  c: ConfiguracaoEnviadores,
  hospital: string,
  conteudo: string,
  chave: string,
  preparar: (tx: TxOperacao) => Promise<{ envio: number; numero: number }>,
): Promise<{ recibo: string | null; resposta: string; conteudo: string }> {
  const gravar = c.gravar;
  if (!gravar) throw new ErroEntrega('gravação do envio à RNDS não configurada: nada enviado', conteudo);
  const op = { operacao: OPERACAO_REGISTRO_RNDS, tabelas: TABELAS_REGISTRO_RNDS };
  const alvo = await gravar(hospital, preparar, op);
  let r: RespostaHttpRnds;
  try {
    r = await postarRnds(c, conteudo, chave);
  } catch (x) {
    const motivo = x instanceof Error ? x.message : 'falha';
    await gravar(
      hospital,
      (tx) =>
        registrarRespostaRnds(
          tx,
          { ...alvo, resposta: { falha: motivo }, identificadorNacional: null, mensagem: motivo },
          c.agora(),
        ),
      op,
    );
    throw x;
  }
  const ok = r.status >= 200 && r.status < 300;
  const recibo = ok ? reciboDaRnds(r.location, r.corpo) : null;
  const motivo = ok ? null : motivoDaRecusaRnds(r.status, r.corpo);
  await gravar(
    hospital,
    (tx) =>
      registrarRespostaRnds(
        tx,
        { ...alvo, resposta: { status: r.status }, identificadorNacional: recibo, mensagem: motivo },
        c.agora(),
      ),
    op,
  );
  if (!ok) throw new ErroEntrega(motivo ?? `HTTP ${r.status}`, conteudo);
  return { recibo: recibo ?? `HTTP ${r.status}`, resposta: `HTTP ${r.status} (${r.ambiente})`, conteudo };
}

/** O envio da vacina (RIA) como fica na tabela: tipo e número da versão do evento. */
export function dadosEnvioVacina(
  hospital: string,
  evento: string,
  versaoEvento: number,
  vacina: number,
  paciente: number,
  vacinador: string,
): DadosEnvioRnds {
  const v = versaoDoEventoVacina(evento, versaoEvento);
  const prof = Number(vacinador);
  return {
    hospital,
    tipo: 'imunizacao',
    registro: vacina,
    paciente,
    atendimento: null,
    profissional: Number.isInteger(prof) && prof > 0 ? prof : null,
    numero: v.numero,
    tipoVersao: v.tipo,
  };
}

// ---- sumário de alta e resultado de exame ----

const SQL_ENVIO_DOCUMENTO = `SELECT en.id, en.tipo_documento, en.paciente_id, en.profissional_id, en.sumario_alta_id,
    en.resultado_exame_id, en.versao_atual, v.tipo_versao, v.situacao AS situacao_versao
  FROM envio_rnds en
  JOIN estabelecimento e ON e.id = en.estabelecimento_id
  JOIN envio_rnds_versao v ON v.envio_rnds_id = en.id AND v.numero_versao = en.versao_atual
  WHERE en.id = ? AND e.codigo = ? AND en.excluido_em IS NULL`;

const SQL_SUMARIO = `SELECT id, situacao, alta_medica_em, codigo_cid10_principal, situacao_diagnostico, motivo_internacao,
    evolucao, plano_pos_alta, condicao_alta, obito FROM sumario_alta WHERE id = ? AND excluido_em IS NULL`;

const SQL_RESULTADO = `SELECT r.id, r.situacao, r.liberado_em, r.conclusao, r.texto_resultado, r.anormal,
    ex.codigo AS exame_codigo, ex.nome AS exame_nome
  FROM resultado_exame r JOIN exame_item ei ON ei.id = r.exame_item_id JOIN exame ex ON ex.id = ei.exame_id
  WHERE r.id = ? AND r.excluido_em IS NULL`;

interface DocumentoLido {
  readonly envio: number;
  readonly numero: number;
  readonly tipoVersao: TipoVersaoRnds;
  readonly conteudo: Record<string, unknown>;
}

/** Lê o envio, o registro e a identificação e monta o documento da versão atual (ou o motivo de não enviar). */
export async function documentoDoEnvio(
  l: Leitor,
  hospital: string,
  envio: number,
  emitidoEm: Date,
): Promise<DocumentoLido | string> {
  const en = await l.uma(SQL_ENVIO_DOCUMENTO, [envio, hospital]);
  if (!en) return 'envio à RNDS do evento não encontrado';
  if (String(en['situacao_versao']) === 'aceito') return 'versão já aceita pela RNDS: nada a enviar';
  const tipo = String(en['tipo_documento']) as TipoDocumentoRnds;
  if (tipo !== 'sumario_alta' && tipo !== 'resultado_exame') return 'documento sem envio pelo worker';
  const { identificacao } = identificacaoDaLinha(
    await l.uma(SQL_IDENTIFICACAO_RNDS, [Number(en['paciente_id'])]),
  );
  const numero = Number(en['versao_atual']);
  const tipoVersao = String(en['tipo_versao']) as TipoVersaoRnds;
  const base: EntradaDocumentoRnds = {
    hospital,
    numeroVersao: numero,
    tipoVersao,
    identificacao,
    profissional: en['profissional_id'] === null ? null : Number(en['profissional_id']),
    emitidoEm,
  };
  if (tipo === 'sumario_alta') {
    const s = await l.uma(SQL_SUMARIO, [Number(en['sumario_alta_id'])]);
    if (!s) return 'sumário de alta do envio não encontrado';
    // O cancelamento vale para o registro em qualquer situação; a original e a substituição, só do registro liberado.
    const bloqueio = motivoBloqueioRnds(
      tipo,
      tipoVersao === 'cancelamento' ? 'assinado' : String(s['situacao']),
      identificacao,
    );
    if (bloqueio) return bloqueio;
    return {
      envio,
      numero,
      tipoVersao,
      conteudo: documentoSumarioAltaRnds(base, {
        id: Number(s['id']),
        altaEm: dataDe(s['alta_medica_em']),
        cid10Principal: texto(s['codigo_cid10_principal']),
        situacaoDiagnostico: texto(s['situacao_diagnostico']),
        motivoInternacao: texto(s['motivo_internacao']),
        evolucao: texto(s['evolucao']),
        planoPosAlta: texto(s['plano_pos_alta']),
        condicaoAlta: texto(s['condicao_alta']),
        obito: Boolean(Number(s['obito'])),
      }),
    };
  }
  const r = await l.uma(SQL_RESULTADO, [Number(en['resultado_exame_id'])]);
  if (!r) return 'resultado de exame do envio não encontrado';
  const bloqueio = motivoBloqueioRnds(
    tipo,
    tipoVersao === 'cancelamento' ? 'liberado' : String(r['situacao']),
    identificacao,
  );
  if (bloqueio) return bloqueio;
  return {
    envio,
    numero,
    tipoVersao,
    conteudo: documentoResultadoExameRnds(base, {
      id: Number(r['id']),
      exameCodigo: String(r['exame_codigo']),
      exameNome: String(r['exame_nome']),
      liberadoEm: dataDe(r['liberado_em']) ?? emitidoEm,
      conclusao: texto(r['conclusao']),
      texto: texto(r['texto_resultado']),
      anormal: Boolean(Number(r['anormal'])),
    }),
  };
}

/** O envio do sumário de alta ou do resultado de exame (evento `fato.rnds.documento`; o objeto é o envio). */
export async function enviarDocumentoRnds(
  c: ConfiguracaoEnviadores,
  e: EnvioEntrega,
  hospital: string,
): Promise<{ recibo: string | null; resposta: string; conteudo: string }> {
  const envio = Number(e.objeto);
  if (!Number.isInteger(envio) || envio <= 0) throw new ErroEntrega('evento da RNDS sem o envio');
  const d = await c.ler(hospital, (l) => documentoDoEnvio(l, hospital, envio, c.agora()));
  if (typeof d === 'string') throw new ErroEntrega(d);
  const conteudo = JSON.stringify(d.conteudo);
  return postarERegistrar(c, hospital, conteudo, `${hospital}-rnds-${d.envio}-v${d.numero}`, async () => ({
    envio: d.envio,
    numero: d.numero,
  }));
}
