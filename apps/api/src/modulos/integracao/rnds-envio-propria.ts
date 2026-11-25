// Porta PRÓPRIA do envio de documentos à Rede Nacional de Dados em Saúde (C2-085, 08-INTG L130; Portaria GM/MS
// 1.434/2020), sobre o banco do cliente. As regras são do @sgh/dominio-integracao (rnds-envio.ts):
//   - a VISÃO POR PACIENTE: a identificação usada (só o tipo: CPF, CNS ou nenhuma; nunca o número), os sumários de
//     alta finalizados ou assinados e os resultados liberados, cada um com o envio, a versão atual, o bloqueio dito
//     antes do clique e as ações possíveis (enviar, substituir, cancelar);
//   - SOLICITAR o envio: cria o envio (identificador local estável) e a versão pendente com o motivo e quem pediu, e
//     põe o evento `fato.rnds.documento` na fila de saída na MESMA transação (o worker monta o FHIR e envia: em dev e
//     ci, SEMPRE o simulador local; regra 6). A versão nova só depois da anterior aceita; nada é apagado.
//   - o MONITOR dos envios (vacina, sumário e resultado) com as versões de cada um.
import {
  EVENTO_DOCUMENTO_RNDS,
  identificacaoRnds,
  identificadorLocalRnds,
  motivoBloqueioRnds,
  PERFIL_DO_DOCUMENTO,
  proximaVersaoRnds,
  type SituacaoEnvioRnds,
  type SituacaoVersaoRnds,
  TIPOS_VERSAO_RNDS,
  type TipoVersaoRnds,
} from '@sgh/dominio-integracao';
import { gravarOutbox } from '@sgh/nucleo';
import { z } from 'zod';
import {
  BaseComunicacaoPropria,
  type ContextoComunicacao,
  dataOuNull,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  recusa,
  txtOuNull,
} from './comunicacao-base-propria.js';

export const PORTA_RNDS_ENVIO = Symbol('PORTA_RNDS_ENVIO');
export const TABELAS_RNDS_ENVIO = ['envio_rnds', 'envio_rnds_versao', 'integracao_mensagem'] as const;
export const OPERACAO_SOLICITAR_RNDS = 'integracao.rnds.solicitar';

export const esquemaSolicitarRnds = z
  .object({
    tipo: z.enum(['sumario_alta', 'resultado_exame']),
    registro: z.number().int().positive(),
    operacao: z.enum(TIPOS_VERSAO_RNDS),
    motivo: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

const OPERACAO_DA_VERSAO: Readonly<Record<TipoVersaoRnds, string>> = {
  original: 'inclusao',
  substituicao: 'alteracao',
  cancelamento: 'exclusao',
};

export interface EnvioRndsLido {
  readonly id: number;
  readonly tipo: string;
  readonly paciente: number;
  readonly registro: number | null;
  readonly identificadorLocal: string;
  readonly identificadorNacional: string | null;
  readonly versaoAtual: number;
  readonly situacao: SituacaoEnvioRnds;
  readonly situacaoVersao: SituacaoVersaoRnds | null;
  readonly tipoVersao: TipoVersaoRnds | null;
  readonly tentativas: number;
  readonly enviadoEm: string | null;
  readonly aceitoEm: string | null;
  readonly motivo: string | null;
}

export interface VersaoRndsLida {
  readonly numero: number;
  readonly tipo: TipoVersaoRnds;
  readonly situacao: SituacaoVersaoRnds;
  readonly ocorridoEm: string | null;
  readonly respondidoEm: string | null;
  readonly codigoRetorno: string | null;
  readonly mensagem: string | null;
  readonly identificadorNacional: string | null;
  readonly motivo: string | null;
}

export interface DocumentoPacienteRnds {
  readonly tipo: 'sumario_alta' | 'resultado_exame';
  readonly registro: number;
  readonly descricao: string;
  readonly data: string | null;
  readonly situacaoRegistro: string;
  readonly envio: EnvioRndsLido | null;
  /** O motivo de não poder ir agora (null: pode). */
  readonly bloqueio: string | null;
  readonly acoes: readonly TipoVersaoRnds[];
}

export interface PacienteRnds {
  readonly paciente: number;
  /** Só o tipo da identificação (o número nunca sai na tela). */
  readonly identificacao: 'cpf' | 'cns' | 'nenhuma';
  readonly documentos: readonly DocumentoPacienteRnds[];
}

const SQL_ENVIO = `SELECT en.id, en.tipo_documento, en.paciente_id, en.vacina_aplicada_id, en.sumario_alta_id,
    en.resultado_exame_id, en.identificador_local, en.identificador_nacional, en.versao_atual, en.situacao,
    en.tentativas, en.enviado_em, en.aceito_em, en.mensagem_erro, en.codigo_erro, v.situacao AS situacao_versao,
    v.tipo_versao
  FROM envio_rnds en
  LEFT JOIN envio_rnds_versao v ON v.envio_rnds_id = en.id AND v.numero_versao = en.versao_atual
  WHERE en.estabelecimento_id = ? AND en.excluido_em IS NULL`;

const SQL_IDENTIFICACAO = `SELECT pf.cpf, pf.cns,
    (SELECT i.identificador FROM identificador_externo_pessoa i JOIN sistema_externo s ON s.id = i.sistema_externo_id
      WHERE i.pessoa_fisica_id = pf.id AND s.codigo = 'rnds' AND i.tipo_identificador IN ('cns','cns_provisorio')
        AND i.situacao = 'ativo' AND i.excluido_em IS NULL ORDER BY i.principal DESC, i.id DESC LIMIT 1) AS cns_rnds
  FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE p.id = ? AND p.excluido_em IS NULL`;

const SQL_SUMARIOS = `SELECT id, situacao, alta_medica_em, registrado_em FROM sumario_alta
  WHERE paciente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao IN ('finalizado','assinado')
  ORDER BY registrado_em DESC, id DESC LIMIT 200`;

const SQL_RESULTADOS = `SELECT r.id, r.situacao, r.liberado_em, ex.nome AS exame_nome FROM resultado_exame r
  JOIN setor_diagnostico sd ON sd.id = r.setor_diagnostico_id AND sd.estabelecimento_id = ?
  JOIN exame_item ei ON ei.id = r.exame_item_id JOIN exame ex ON ex.id = ei.exame_id
  WHERE r.paciente_id = ? AND r.excluido_em IS NULL AND r.situacao = 'liberado'
  ORDER BY r.liberado_em DESC, r.id DESC LIMIT 200`;

function envioDaLinha(r: Record<string, unknown>): EnvioRndsLido {
  const tipo = String(r['tipo_documento']);
  const registro =
    tipo === 'imunizacao'
      ? numOuNull(r['vacina_aplicada_id'])
      : tipo === 'sumario_alta'
        ? numOuNull(r['sumario_alta_id'])
        : numOuNull(r['resultado_exame_id']);
  return {
    id: num(r['id']),
    tipo,
    paciente: num(r['paciente_id']),
    registro,
    identificadorLocal: String(r['identificador_local']),
    identificadorNacional: txtOuNull(r['identificador_nacional']),
    versaoAtual: num(r['versao_atual']),
    situacao: String(r['situacao']) as SituacaoEnvioRnds,
    situacaoVersao: (txtOuNull(r['situacao_versao']) as SituacaoVersaoRnds | null) ?? null,
    tipoVersao: (txtOuNull(r['tipo_versao']) as TipoVersaoRnds | null) ?? null,
    tentativas: num(r['tentativas']),
    enviadoEm: dataOuNull(r['enviado_em']),
    aceitoEm: dataOuNull(r['aceito_em']),
    motivo: txtOuNull(r['mensagem_erro']) ?? txtOuNull(r['codigo_erro']),
  };
}

/** As ações possíveis no documento (o servidor confere de novo na solicitação). */
function acoesDo(envio: EnvioRndsLido | null, bloqueio: string | null): TipoVersaoRnds[] {
  if (bloqueio)
    return envio && envio.situacaoVersao === 'aceito' && envio.situacao !== 'cancelado'
      ? ['cancelamento']
      : [];
  const atual = envio
    ? {
        situacao: envio.situacao,
        versaoAtual: envio.versaoAtual,
        situacaoVersao: envio.situacaoVersao ?? 'pendente',
      }
    : null;
  return TIPOS_VERSAO_RNDS.filter((t) => proximaVersaoRnds(atual, t).ok);
}

export class PortaRndsEnvioPropria extends BaseComunicacaoPropria {
  /** O monitor dos envios do estabelecimento (filtro por paciente e situação). */
  envios(
    c: ContextoComunicacao,
    f: { readonly paciente: number | null; readonly situacao: string | null },
  ): Promise<EnvioRndsLido[]> {
    return this.ler(c, 'rnds.envios', async (l, est) => {
      const p: unknown[] = [est];
      let sql = SQL_ENVIO;
      if (f.paciente !== null) {
        sql += ' AND en.paciente_id = ?';
        p.push(f.paciente);
      }
      if (f.situacao !== null) {
        sql += ' AND en.situacao = ?';
        p.push(f.situacao);
      }
      return (await l.consultar(`${sql} ORDER BY en.id DESC LIMIT 500`, p, { teto: 500 })).map(envioDaLinha);
    });
  }

  /** As versões de um envio (a mais antiga primeiro). */
  versoes(c: ContextoComunicacao, envio: number): Promise<VersaoRndsLida[]> {
    return this.ler(c, 'rnds.versoes', async (l, est) => {
      const en = await l.uma('SELECT id FROM envio_rnds WHERE id = ? AND estabelecimento_id = ?', [
        envio,
        est,
      ]);
      if (!en) throw naoEncontrado('Envio à rede nacional');
      return (
        await l.consultar(
          `SELECT numero_versao, tipo_versao, situacao, ocorrido_em, respondido_em, codigo_retorno, mensagem_retorno,
                  identificador_nacional, motivo
             FROM envio_rnds_versao WHERE envio_rnds_id = ? ORDER BY numero_versao`,
          [envio],
          { teto: 200 },
        )
      ).map((r) => ({
        numero: num(r['numero_versao']),
        tipo: String(r['tipo_versao']) as TipoVersaoRnds,
        situacao: String(r['situacao']) as SituacaoVersaoRnds,
        ocorridoEm: dataOuNull(r['ocorrido_em']),
        respondidoEm: dataOuNull(r['respondido_em']),
        codigoRetorno: txtOuNull(r['codigo_retorno']),
        mensagem: txtOuNull(r['mensagem_retorno']),
        identificadorNacional: txtOuNull(r['identificador_nacional']),
        motivo: txtOuNull(r['motivo']),
      }));
    });
  }

  /** A visão por paciente: identificação (só o tipo), documentos elegíveis, envio, bloqueio e ações. */
  paciente(c: ContextoComunicacao, paciente: number): Promise<PacienteRnds> {
    return this.ler(c, 'rnds.paciente', async (l, est) => {
      const x = await l.uma(SQL_IDENTIFICACAO, [paciente]);
      if (!x) throw naoEncontrado('Paciente');
      const id = identificacaoRnds({
        cpf: txtOuNull(x['cpf']),
        cns: txtOuNull(x['cns']) ?? txtOuNull(x['cns_rnds']),
      });
      const envios = (
        await l.consultar(`${SQL_ENVIO} AND en.paciente_id = ? LIMIT 500`, [est, paciente], { teto: 500 })
      ).map(envioDaLinha);
      const porRegistro = new Map(envios.map((e) => [`${e.tipo}:${e.registro}`, e]));
      const documentos: DocumentoPacienteRnds[] = [];
      for (const s of await l.consultar(SQL_SUMARIOS, [paciente, est], { teto: 200 })) {
        const envio = porRegistro.get(`sumario_alta:${num(s['id'])}`) ?? null;
        const bloqueio = motivoBloqueioRnds('sumario_alta', String(s['situacao']), id);
        documentos.push({
          tipo: 'sumario_alta',
          registro: num(s['id']),
          descricao: 'Sumário de alta',
          data: dataOuNull(s['alta_medica_em']) ?? dataOuNull(s['registrado_em']),
          situacaoRegistro: String(s['situacao']),
          envio,
          bloqueio,
          acoes: acoesDo(envio, bloqueio),
        });
      }
      for (const r of await l.consultar(SQL_RESULTADOS, [est, paciente], { teto: 200 })) {
        const envio = porRegistro.get(`resultado_exame:${num(r['id'])}`) ?? null;
        const bloqueio = motivoBloqueioRnds('resultado_exame', String(r['situacao']), id);
        documentos.push({
          tipo: 'resultado_exame',
          registro: num(r['id']),
          descricao: String(r['exame_nome']),
          data: dataOuNull(r['liberado_em']),
          situacaoRegistro: String(r['situacao']),
          envio,
          bloqueio,
          acoes: acoesDo(envio, bloqueio),
        });
      }
      return { paciente, identificacao: id.tipo, documentos };
    });
  }

  /** Pede o envio (original, substituição ou cancelamento): versão pendente e o evento na fila, na mesma transação. */
  async solicitar(
    c: ContextoComunicacao,
    entrada: unknown,
    agora: Date = new Date(),
  ): Promise<{ id: number; versao: number; tipoVersao: TipoVersaoRnds; mensagem: number }> {
    const e = entradaValida(esquemaSolicitarRnds, entrada);
    const motivo = e.motivo?.trim() || null;
    if (e.operacao !== 'original' && (!motivo || motivo.length < 10))
      throw recusa([
        {
          campo: 'motivo',
          codigo: 'motivo-obrigatorio',
          mensagem: 'A substituição e o cancelamento pedem o motivo (10 caracteres ou mais).',
        },
      ]);
    return this.gravar(c, OPERACAO_SOLICITAR_RNDS, TABELAS_RNDS_ENVIO, async (tx, est, usuario) => {
      const reg =
        e.tipo === 'sumario_alta'
          ? await tx.uma(
              `SELECT id, paciente_id, atendimento_id, responsavel_profissional_id AS profissional, situacao
                 FROM sumario_alta WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
              [e.registro, est],
            )
          : await tx.uma(
              // O resultado pertence ao estabelecimento pelo setor diagnóstico que o liberou.
              `SELECT r.id, r.paciente_id, NULL AS atendimento_id, r.liberado_por_profissional_id AS profissional,
                  r.situacao
                 FROM resultado_exame r
                 JOIN setor_diagnostico sd ON sd.id = r.setor_diagnostico_id AND sd.estabelecimento_id = ?
                WHERE r.id = ? AND r.excluido_em IS NULL`,
              [est, e.registro],
            );
      if (!reg) throw naoEncontrado(e.tipo === 'sumario_alta' ? 'Sumário de alta' : 'Resultado de exame');
      const paciente = num(reg['paciente_id']);
      const x = await tx.uma(SQL_IDENTIFICACAO, [paciente]);
      const identificacao = identificacaoRnds({
        cpf: txtOuNull(x?.['cpf']),
        cns: txtOuNull(x?.['cns']) ?? txtOuNull(x?.['cns_rnds']),
      });
      // O cancelamento vale para o registro em qualquer situação; a original e a substituição, só do registro liberado.
      const bloqueio = motivoBloqueioRnds(
        e.tipo,
        e.operacao === 'cancelamento'
          ? e.tipo === 'sumario_alta'
            ? 'assinado'
            : 'liberado'
          : String(reg['situacao']),
        identificacao,
      );
      if (bloqueio)
        throw recusa([{ campo: 'registro', codigo: 'bloqueado', mensagem: bloqueio }], 'Envio recusado');
      const hospital = c.hospital;
      const local = identificadorLocalRnds(hospital, e.tipo, e.registro);
      const [en] = await tx.consultarParaAtualizar(
        `SELECT en.id, en.situacao, en.versao_atual, en.versao, v.situacao AS situacao_versao
           FROM envio_rnds en LEFT JOIN envio_rnds_versao v ON v.envio_rnds_id = en.id
                                AND v.numero_versao = en.versao_atual
          WHERE en.identificador_local = ?`,
        [local],
        { teto: 1 },
      );
      const prox = proximaVersaoRnds(
        en
          ? {
              situacao: String(en['situacao']) as SituacaoEnvioRnds,
              versaoAtual: num(en['versao_atual']),
              situacaoVersao: (txtOuNull(en['situacao_versao']) ?? 'pendente') as SituacaoVersaoRnds,
            }
          : null,
        e.operacao,
      );
      if (!prox.ok)
        throw recusa([{ campo: 'operacao', codigo: prox.codigo, mensagem: prox.motivo }], 'Envio recusado');
      let id: number;
      if (!en) {
        const perfil = await tx.uma('SELECT id FROM perfil_fhir WHERE codigo = ? AND ativo = TRUE', [
          PERFIL_DO_DOCUMENTO[e.tipo],
        ]);
        id = await tx.incluir('envio_rnds', {
          estabelecimento_id: est,
          paciente_id: paciente,
          atendimento_id: numOuNull(reg['atendimento_id']),
          profissional_id: numOuNull(reg['profissional']),
          perfil_fhir_id: perfil ? num(perfil['id']) : null,
          [e.tipo === 'sumario_alta' ? 'sumario_alta_id' : 'resultado_exame_id']: e.registro,
          tipo_documento: e.tipo,
          identificador_local: local,
          versao_atual: prox.numero,
          situacao: 'pendente',
        });
      } else {
        id = num(en['id']);
        await tx.alterar('envio_rnds', id, num(en['versao']), {
          versao_atual: prox.numero,
          situacao: 'pendente',
        });
      }
      await tx.incluir('envio_rnds_versao', {
        envio_rnds_id: id,
        operacao: OPERACAO_DA_VERSAO[prox.tipo],
        ocorrido_em: agora,
        usuario_id: usuario,
        numero_versao: prox.numero,
        tipo_versao: prox.tipo,
        situacao: 'pendente',
        motivo,
      });
      const mensagem = await gravarOutbox(tx, {
        estabelecimento: est,
        ponto: EVENTO_DOCUMENTO_RNDS,
        entidade: 'envio_rnds',
        entidadeId: id,
        chave: `rnds:${id}:v${prox.numero}`,
        carga: { envio: id, versao: prox.numero, tipo: e.tipo },
        usuario,
        agora,
      });
      return { id, versao: prox.numero, tipoVersao: prox.tipo, mensagem };
    });
  }
}
