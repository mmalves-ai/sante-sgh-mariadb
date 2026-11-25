// Porta PRÓPRIA da classificação de risco externa (F3.9, linha 08-INTG L140), sobre o banco do cliente:
//   - os perfis de prioridade (`perfil_prioridade_externa`) com o código que o sistema de triagem conhece, e o pacote
//     de perfis que vai a ele (ativos, na ordem de prioridade: regra do domínio);
//   - o recebimento da classificação (`classificacao_externa_recebida`) ligada ao atendimento do pronto atendimento:
//     idempotente pelo sistema e pelo identificador externo; a que não confere fica gravada como rejeitada, com o
//     motivo; a mais nova do atendimento vale e as anteriores passam a substituídas (nada é apagado);
//   - a aplicação: a recebida vigente gera a classificação interna (`classificacao_risco`, origem integração, concluída,
//     com a versão vigente do protocolo do estabelecimento) e passa a aplicada, ligada à interna; se o atendimento já
//     tinha classificação interna concluída, a nova a reclassifica (nada é apagado);
//   - a visão do atendimento: as classificações recebidas, com o prazo do atendimento médico;
//   - o ENVIO ATIVO dos perfis: a mensagem MFN^M13 montada pelo perfil de mensagem HL7 do sistema de triagem vai à fila
//     de saída (`mensagem_integracao_saida`), que o enviador HL7 do worker entrega por MLLP ao canal do parceiro;
//   - a ENTRADA pela credencial do sistema de triagem (cliente da API ligado ao sistema, usuário técnico na trilha):
//     o sistema que envia é o da credencial, nunca o informado no corpo.
import { createHash } from 'node:crypto';
import {
  canalOie,
  CONDICOES_PREFERENCIAIS,
  type CondicaoPreferencial,
  conferirClassificacaoRecebida,
  conferirCredencialTriagem,
  conferirEnvioPerfis,
  decidirEnvioPerfis,
  EVENTO_ENVIO_PERFIS_TRIAGEM,
  EVENTO_HL7_PERFIS_TRIAGEM,
  montarPerfisHl7,
  perfisParaEnvio,
  planoAplicacao,
  prazoAtendimento,
  situacaoNaChegada,
  validarPerfilPrioridade,
} from '@sgh/dominio-integracao';
import { ErroOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import { lerAutorizacaoBasica, segredoConfere } from './aplicacao/credencial.js';
import {
  BaseComunicacaoPropria,
  bool,
  conflito,
  type ContextoComunicacao,
  dataOuNull,
  entradaValida,
  fusoDoEstabelecimento,
  naoEncontrado,
  num,
  numOuNull,
  recusa,
  txtOuNull,
} from './comunicacao-base-propria.js';

export const PORTA_CLASSIFICACAO_EXTERNA = Symbol('PORTA_CLASSIFICACAO_EXTERNA');

export const esquemaPerfilPrioridade = z
  .object({
    id: z.number().int().positive().nullable().default(null),
    codigo: z.string().min(1).max(30),
    descricao: z.string().min(1).max(150),
    sistemaCodigo: z.string().max(40).nullable().default(null),
    codigoExterno: z.string().max(30).nullable().default(null),
    condicaoPreferencial: z.enum(CONDICOES_PREFERENCIAIS).nullable().default(null),
    ordemPrioridade: z.number().int().default(0),
    ativo: z.boolean().default(true),
    versao: z.number().int().positive().nullable().default(null),
  })
  .strict();

export const esquemaClassificacaoRecebida = z
  .object({
    sistemaCodigo: z.string().min(1).max(40),
    atendimentoId: z.number().int().positive(),
    identificadorExterno: z.string().min(1).max(100),
    codigoPrioridade: z.string().min(1).max(30),
    descricaoPrioridade: z.string().max(150).nullable().default(null),
    cor: z.string().max(30).nullable().default(null),
    tempoAlvoMinutos: z.number().int().nullable().default(null),
    protocolo: z.string().max(60).nullable().default(null),
    queixaPrincipal: z.string().max(500).nullable().default(null),
    discriminador: z.string().max(255).nullable().default(null),
    identificadorProfissionalExterno: z.string().max(60).nullable().default(null),
    perfilCodigoExterno: z.string().max(30).nullable().default(null),
    classificadoEm: z.string().datetime({ offset: true }),
  })
  .strict();

export interface PerfilPrioridadeLido {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly sistemaCodigo: string | null;
  readonly codigoExterno: string | null;
  readonly condicaoPreferencial: CondicaoPreferencial | null;
  readonly ordemPrioridade: number;
  readonly ativo: boolean;
  readonly versao: number;
}

export interface ClassificacaoRecebidaLida {
  readonly id: number;
  readonly sistema: string;
  readonly identificadorExterno: string;
  readonly codigoPrioridade: string;
  readonly descricaoPrioridade: string | null;
  readonly cor: string | null;
  readonly tempoAlvoMinutos: number | null;
  readonly perfil: string | null;
  readonly classificadoEm: string;
  readonly recebidoEm: string;
  readonly prazoAtendimento: string | null;
  readonly situacao: string;
  readonly motivoRejeicao: string | null;
}

export class PortaClassificacaoExternaPropria extends BaseComunicacaoPropria {
  perfis(c: ContextoComunicacao): Promise<PerfilPrioridadeLido[]> {
    return this.ler(c, 'classificacaoExterna.perfis', async (l) =>
      (
        await l.consultar(
          `SELECT p.id, p.codigo, p.descricao, s.codigo AS sistema_codigo, p.codigo_externo, p.condicao_preferencial,
                  p.ordem_prioridade, p.ativo, p.versao
             FROM perfil_prioridade_externa p LEFT JOIN sistema_externo s ON s.id = p.sistema_externo_id
            ORDER BY p.ordem_prioridade, p.codigo LIMIT 300`,
        )
      ).map((x) => ({
        id: num(x['id']),
        codigo: String(x['codigo']),
        descricao: String(x['descricao']),
        sistemaCodigo: txtOuNull(x['sistema_codigo']),
        codigoExterno: txtOuNull(x['codigo_externo']),
        condicaoPreferencial: txtOuNull(x['condicao_preferencial']) as CondicaoPreferencial | null,
        ordemPrioridade: num(x['ordem_prioridade']),
        ativo: bool(x['ativo']),
        versao: num(x['versao']),
      })),
    );
  }

  /** O que vai ao sistema de triagem: os perfis ativos dele (ou sem sistema), na ordem, com o código que ele conhece. */
  async perfisParaSistema(c: ContextoComunicacao, sistema: string) {
    const todos = await this.perfis(c);
    return perfisParaEnvio(todos.filter((p) => p.sistemaCodigo === null || p.sistemaCodigo === sistema));
  }

  gravarPerfil(c: ContextoComunicacao, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(esquemaPerfilPrioridade, entrada);
    const erros = validarPerfilPrioridade(x);
    if (erros.length) throw recusa(erros, 'Perfil recusado');
    return this.gravar(
      c,
      'integracao.classificacao_externa.configurar_perfil',
      ['perfil_prioridade_externa'],
      async (tx) => {
        let sistema: number | null = null;
        if (x.sistemaCodigo) {
          const s = await tx.uma('SELECT id FROM sistema_externo WHERE codigo = ? AND excluido_em IS NULL', [
            x.sistemaCodigo,
          ]);
          if (!s) throw naoEncontrado('Sistema externo');
          sistema = num(s['id']);
        }
        if (x.codigoExterno && sistema === null)
          throw recusa([
            {
              campo: 'sistemaCodigo',
              codigo: 'sistema-obrigatorio',
              mensagem: 'Código externo exige o sistema de triagem.',
            },
          ]);
        const valores = {
          descricao: x.descricao.trim(),
          sistema_externo_id: sistema,
          codigo_externo: x.codigoExterno?.trim() || null,
          condicao_preferencial: x.condicaoPreferencial,
          ordem_prioridade: x.ordemPrioridade,
          ativo: x.ativo,
        };
        const [a] = await tx.consultarParaAtualizar(
          'SELECT id, versao FROM perfil_prioridade_externa WHERE codigo = ?',
          [x.codigo],
          { teto: 1 },
        );
        if (a) {
          if (x.versao === null || x.versao !== num(a['versao'])) throw conflito();
          await tx.alterar('perfil_prioridade_externa', num(a['id']), x.versao, valores);
          return { id: num(a['id']) };
        }
        if (x.id !== null) throw conflito();
        return { id: await tx.incluir('perfil_prioridade_externa', { codigo: x.codigo, ...valores }) };
      },
    );
  }

  /**
   * Recebe a classificação do sistema de triagem para o atendimento: idempotente (a repetida devolve a gravada);
   * a que não confere fica rejeitada, com o motivo; a mais nova vale e substitui as anteriores.
   */
  receber(
    c: ContextoComunicacao,
    entrada: unknown,
    agora: Date = new Date(),
  ): Promise<{ id: number; situacao: string; repetida: boolean; motivos: string[] }> {
    const x = entradaValida(esquemaClassificacaoRecebida, entrada);
    return this.gravar(
      c,
      'integracao.classificacao_externa.receber',
      ['classificacao_externa_recebida'],
      async (tx, est) => {
        const s = await tx.uma('SELECT id FROM sistema_externo WHERE codigo = ? AND excluido_em IS NULL', [
          x.sistemaCodigo,
        ]);
        if (!s) throw naoEncontrado('Sistema externo');
        const sistema = num(s['id']);
        const ja = await tx.uma(
          'SELECT id, situacao FROM classificacao_externa_recebida WHERE sistema_externo_id = ? AND identificador_externo = ?',
          [sistema, x.identificadorExterno],
        );
        if (ja) return { id: num(ja['id']), situacao: String(ja['situacao']), repetida: true, motivos: [] };
        const a = await tx.uma(
          `SELECT a.id, a.entrada_em, a.saida_em, k.tipo_base
             FROM atendimento a JOIN categoria_atendimento k ON k.id = a.categoria_atendimento_id
            WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
          [x.atendimentoId, est],
        );
        if (!a) throw naoEncontrado('Atendimento');
        const classificadoEm = new Date(x.classificadoEm);
        const erros = conferirClassificacaoRecebida(
          { ...x, classificadoEm, recebidoEm: agora },
          {
            existe: true,
            prontoAtendimento: String(a['tipo_base']) === 'pronto_atendimento',
            entradaEm: a['entrada_em'] ? new Date(a['entrada_em'] as string) : null,
            encerrado: a['saida_em'] !== null,
          },
        );
        const vigentes = await tx.consultarParaAtualizar(
          `SELECT id, versao, classificado_em FROM classificacao_externa_recebida
            WHERE atendimento_id = ? AND situacao IN ('recebida','aplicada') AND excluido_em IS NULL`,
          [x.atendimentoId],
          { teto: 500 },
        );
        const chegada = situacaoNaChegada(
          erros.length > 0,
          classificadoEm,
          vigentes.map((v) => ({
            id: num(v['id']),
            classificadoEm: new Date(v['classificado_em'] as string),
          })),
        );
        let perfil: number | null = null;
        if (x.perfilCodigoExterno) {
          const p = await tx.uma(
            'SELECT id FROM perfil_prioridade_externa WHERE sistema_externo_id = ? AND codigo_externo = ?',
            [sistema, x.perfilCodigoExterno],
          );
          perfil = p ? num(p['id']) : null;
        }
        const id = await tx.incluir('classificacao_externa_recebida', {
          estabelecimento_id: est,
          atendimento_id: x.atendimentoId,
          sistema_externo_id: sistema,
          perfil_prioridade_externa_id: perfil,
          identificador_externo: x.identificadorExterno,
          identificador_profissional_externo: x.identificadorProfissionalExterno,
          protocolo: x.protocolo,
          codigo_prioridade: x.codigoPrioridade,
          descricao_prioridade: x.descricaoPrioridade,
          cor: x.cor,
          tempo_alvo_minutos:
            x.tempoAlvoMinutos !== null && x.tempoAlvoMinutos >= 0 && x.tempoAlvoMinutos <= 1440
              ? x.tempoAlvoMinutos
              : null,
          queixa_principal: x.queixaPrincipal,
          discriminador: x.discriminador,
          classificado_em: classificadoEm,
          recebido_em: agora,
          situacao: chegada.situacao,
          motivo_rejeicao: erros.length
            ? erros
                .map((e) => e.mensagem)
                .join(' ')
                .slice(0, 500)
            : null,
          origem: 'integracao',
        });
        for (const v of vigentes)
          if (chegada.substitui.includes(num(v['id'])))
            await tx.alterar('classificacao_externa_recebida', num(v['id']), num(v['versao']), {
              situacao: 'substituida',
            });
        return { id, situacao: chegada.situacao, repetida: false, motivos: erros.map((e) => e.codigo) };
      },
    );
  }

  /**
   * Aplica a classificação recebida ao atendimento: gera a classificação interna e liga as duas. O classificador é o
   * profissional identificado na recebida ou, sem ele, o profissional de quem aplica (que confere e assume).
   */
  aplicar(
    c: ContextoComunicacao,
    recebida: number,
    agora: Date = new Date(),
  ): Promise<{ id: number; classificacaoRiscoId: number; reclassificou: number | null }> {
    return this.gravar(
      c,
      'integracao.classificacao_externa.aplicar',
      ['classificacao_externa_recebida', 'classificacao_risco'],
      async (tx, est, usuario) => {
        const [r] = await tx.consultarParaAtualizar(
          `SELECT r.id, r.versao, r.atendimento_id, r.profissional_id, r.situacao, r.cor, r.tempo_alvo_minutos,
                  r.classificado_em, r.queixa_principal, r.descricao_prioridade, r.codigo_prioridade, a.paciente_id
             FROM classificacao_externa_recebida r JOIN atendimento a ON a.id = r.atendimento_id
            WHERE r.id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL`,
          [recebida, est],
          { teto: 1 },
        );
        if (!r) throw naoEncontrado('Classificação recebida');
        const classificadoEm = new Date(r['classificado_em'] as string);
        const { erros, plano } = planoAplicacao({
          situacao: String(r['situacao']) as 'recebida',
          cor: txtOuNull(r['cor']),
          tempoAlvoMinutos: numOuNull(r['tempo_alvo_minutos']),
          classificadoEm,
          queixaPrincipal: txtOuNull(r['queixa_principal']),
          descricaoPrioridade: txtOuNull(r['descricao_prioridade']),
          codigoPrioridade: String(r['codigo_prioridade']),
        });
        if (!plano) throw recusa(erros);
        const n = await tx.uma(
          "SELECT id FROM nivel_prioridade WHERE codigo = ? AND contexto = 'classificacao_risco' AND ativo = TRUE",
          [plano.cor],
        );
        if (!n)
          throw recusa([
            {
              campo: 'cor',
              codigo: 'nivel-nao-cadastrado',
              mensagem: `O nível "${plano.cor}" não está cadastrado.`,
            },
          ]);
        const v = await tx.uma(
          `SELECT v.id FROM protocolo_classificacao_risco_versao v
             JOIN protocolo_classificacao_estabelecimento pe
               ON pe.protocolo_classificacao_risco_id = v.protocolo_classificacao_risco_id
              AND pe.estabelecimento_id = ? AND pe.excluido_em IS NULL
              AND pe.vigencia_inicio <= ? AND (pe.vigencia_fim IS NULL OR pe.vigencia_fim > ?)
            WHERE v.vigencia_inicio <= ? AND (v.vigencia_fim IS NULL OR v.vigencia_fim > ?)
            ORDER BY v.vigencia_inicio DESC, v.id DESC LIMIT 1`,
          [est, agora, agora, agora, agora],
        );
        if (!v)
          throw recusa([
            {
              campo: 'protocolo',
              codigo: 'sem-protocolo-vigente',
              mensagem: 'O estabelecimento não tem protocolo de classificação de risco vigente.',
            },
          ]);
        let prof = numOuNull(r['profissional_id']);
        if (prof === null) {
          const p = await tx.uma(
            `SELECT p.id FROM usuario u JOIN pessoa_fisica pf ON pf.cpf = u.cpf AND pf.excluido_em IS NULL
               JOIN profissional p ON p.pessoa_fisica_id = pf.id AND p.situacao = 'ativo' AND p.excluido_em IS NULL
              WHERE u.id = ? AND u.cpf IS NOT NULL LIMIT 1`,
            [usuario],
          );
          if (!p)
            throw recusa([
              {
                campo: 'profissional',
                codigo: 'sem-vinculo-assistencial',
                mensagem:
                  'A recebida não identifica o classificador e quem aplica não tem vínculo profissional ativo.',
              },
            ]);
          prof = num(p['id']);
        }
        const atendimento = num(r['atendimento_id']);
        const [ant] = await tx.consultarParaAtualizar(
          `SELECT id, versao FROM classificacao_risco WHERE atendimento_id = ? AND situacao = 'concluida'
              AND excluido_em IS NULL ORDER BY inicio_em DESC, id DESC`,
          [atendimento],
          { teto: 1 },
        );
        let motivo: number | null = null;
        if (ant) {
          const m = await tx.uma(
            "SELECT id FROM motivo_reclassificacao WHERE tipo = 'outro' AND ativo = TRUE ORDER BY id LIMIT 1",
            [],
          );
          if (!m)
            throw recusa([
              {
                campo: 'motivo',
                codigo: 'motivo-nao-cadastrado',
                mensagem: 'O motivo de reclassificação "outro" não está cadastrado.',
              },
            ]);
          motivo = num(m['id']);
          await tx.alterar('classificacao_risco', num(ant['id']), num(ant['versao']), {
            situacao: 'reclassificada',
          });
        }
        const interna = await tx.incluir('classificacao_risco', {
          estabelecimento_id: est,
          atendimento_id: atendimento,
          paciente_id: num(r['paciente_id']),
          protocolo_classificacao_risco_versao_id: num(v['id']),
          proposto_nivel_prioridade_id: num(n['id']),
          nivel_prioridade_id: num(n['id']),
          sobreposta: false,
          tempo_alvo_minutos: plano.tempoAlvoMinutos,
          prazo_atendimento_em: plano.prazo,
          queixa_principal: plano.queixa,
          classificador_profissional_id: prof,
          inicio_em: classificadoEm,
          classificado_em: classificadoEm,
          situacao: 'concluida',
          anterior_classificacao_risco_id: ant ? num(ant['id']) : null,
          motivo_reclassificacao_id: motivo,
          descricao_mudanca_quadro: ant ? 'Classificação recebida do sistema de triagem' : null,
          origem: 'integracao',
        });
        await tx.alterar('classificacao_externa_recebida', recebida, num(r['versao']), {
          situacao: 'aplicada',
          classificacao_risco_id: interna,
        });
        return { id: recebida, classificacaoRiscoId: interna, reclassificou: ant ? num(ant['id']) : null };
      },
    );
  }

  doAtendimento(c: ContextoComunicacao, atendimento: number): Promise<ClassificacaoRecebidaLida[]> {
    return this.ler(c, 'classificacaoExterna.atendimento', async (l, est) =>
      (
        await l.consultar(
          `SELECT r.id, s.codigo AS sistema, r.identificador_externo, r.codigo_prioridade, r.descricao_prioridade, r.cor,
                  r.tempo_alvo_minutos, p.descricao AS perfil, r.classificado_em, r.recebido_em, r.situacao,
                  r.motivo_rejeicao
             FROM classificacao_externa_recebida r
             JOIN sistema_externo s ON s.id = r.sistema_externo_id
             LEFT JOIN perfil_prioridade_externa p ON p.id = r.perfil_prioridade_externa_id
            WHERE r.atendimento_id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL
            ORDER BY r.classificado_em DESC, r.id DESC LIMIT 100`,
          [atendimento, est],
        )
      ).map((x) => {
        const tempo = numOuNull(x['tempo_alvo_minutos']);
        const classificadoEm = new Date(x['classificado_em'] as string);
        return {
          id: num(x['id']),
          sistema: String(x['sistema']),
          identificadorExterno: String(x['identificador_externo']),
          codigoPrioridade: String(x['codigo_prioridade']),
          descricaoPrioridade: txtOuNull(x['descricao_prioridade']),
          cor: txtOuNull(x['cor']),
          tempoAlvoMinutos: tempo,
          perfil: txtOuNull(x['perfil']),
          classificadoEm: classificadoEm.toISOString(),
          recebidoEm: dataOuNull(x['recebido_em'])!,
          prazoAtendimento: prazoAtendimento(classificadoEm, tempo)?.toISOString() ?? null,
          situacao: String(x['situacao']),
          motivoRejeicao: txtOuNull(x['motivo_rejeicao']),
        };
      }),
    );
  }

  /**
   * Envio ativo dos perfis ao sistema de triagem: monta a MFN^M13 pelo perfil de mensagem HL7 do sistema e põe na
   * fila de saída do parceiro HL7 dele (o worker entrega por MLLP). O mesmo pacote de perfis no mesmo dia não entra
   * duas vezes enquanto a mensagem dele está viva (a chave é o resumo do pacote e a data local); se ela morreu, o
   * pedido é recusado apontando o reprocessamento; se foi descartada, entra uma nova. Pacote mudado entra de novo.
   */
  enviarPerfis(
    c: ContextoComunicacao,
    entrada: unknown,
    agora: Date = new Date(),
  ): Promise<{ id: number; repetida: boolean; perfis: number; chave: string }> {
    const { sistema } = entradaValida(z.object({ sistema: z.string().min(1).max(40) }).strict(), entrada);
    return this.gravar(
      c,
      'integracao.classificacao_externa.enviar_perfis',
      ['mensagem_integracao_saida', 'ponto_integracao'],
      async (tx, est) => {
        const s = await tx.uma(
          'SELECT id, categoria, ativo FROM sistema_externo WHERE codigo = ? AND excluido_em IS NULL',
          [sistema],
        );
        if (!s) throw naoEncontrado('Sistema externo');
        const sid = num(s['id']);
        const par = await tx.uma(
          `SELECT id, codigo, nome, canal, limite_tentativas FROM parceiro_dados
            WHERE sistema_externo_id = ? AND tipo IN ('hl7','apoio') AND ativo = TRUE AND excluido_em IS NULL
            ORDER BY id LIMIT 1`,
          [sid],
        );
        const pm = await tx.uma(
          `SELECT pm.versao_hl7, pm.separador_campo, pm.caracteres_codificacao, pm.ativo, pm.evento_hl7_id,
                  pm.canal_hl7_id
             FROM perfil_mensagem_hl7 pm JOIN evento_hl7 ev ON ev.id = pm.evento_hl7_id
            WHERE pm.sistema_externo_id = ? AND ev.codigo_hl7 = ?
            ORDER BY pm.ativo DESC, pm.id DESC LIMIT 1`,
          [sid, EVENTO_HL7_PERFIS_TRIAGEM],
        );
        const lidos = await tx.consultar(
          `SELECT codigo, descricao, codigo_externo, condicao_preferencial, ordem_prioridade, ativo
             FROM perfil_prioridade_externa
            WHERE (sistema_externo_id IS NULL OR sistema_externo_id = ?) AND ativo = TRUE
            ORDER BY ordem_prioridade, codigo LIMIT 300`,
          [sid],
        );
        const perfis = perfisParaEnvio(
          lidos.map((x) => ({
            codigo: String(x['codigo']),
            descricao: String(x['descricao']),
            codigoExterno: txtOuNull(x['codigo_externo']),
            condicaoPreferencial: txtOuNull(x['condicao_preferencial']) as CondicaoPreferencial | null,
            ordemPrioridade: num(x['ordem_prioridade']),
            ativo: bool(x['ativo']),
          })),
        );
        const perfilMensagem = pm
          ? {
              versaoHl7: String(pm['versao_hl7']),
              separadorCampo: String(pm['separador_campo']),
              caracteresCodificacao: String(pm['caracteres_codificacao']),
              ativo: bool(pm['ativo']),
            }
          : null;
        const erros = conferirEnvioPerfis({
          sistemaTriagemAtivo: String(s['categoria']) === 'triagem' && bool(s['ativo']),
          // O canal tem de ser um canal do motor que o enviador HL7 do worker conhece (senão a mensagem morreria lá).
          parceiroHl7ComCanal: !!par && canalOie(txtOuNull(par['canal']) ?? '') !== undefined,
          perfilMensagem,
          perfis,
        });
        if (erros.length > 0 || !par || !pm || !perfilMensagem) throw recusa(erros, 'Envio recusado');
        const fuso = await fusoDoEstabelecimento(tx, est, agora);
        const local = new Date(agora.getTime() + fuso * 60_000);
        const resumoPacote = createHash('sha256')
          .update(JSON.stringify({ v: perfilMensagem.versaoHl7, perfis }))
          .digest('hex');
        const chave = `perfis:${sistema}:${resumoPacote.slice(0, 32)}:${local.toISOString().slice(0, 10)}`;
        const codigoPonto = `parceiro.${String(par['codigo'])}.saida`;
        let ponto = await tx.uma(
          'SELECT id, ativo FROM ponto_integracao WHERE estabelecimento_id = ? AND codigo = ? AND excluido_em IS NULL',
          [est, codigoPonto],
        );
        if (ponto && !bool(ponto['ativo']))
          throw recusa([
            {
              campo: 'ponto',
              codigo: 'ponto-desativado',
              mensagem: 'O ponto de saída do sistema de triagem está desativado.',
            },
          ]);
        // As mensagens do mesmo pacote no mesmo dia (a chave base e as reenviadas ":r<n>"), com a situação: o domínio
        // decide entre repetida (viva), recusada (morta, a reprocessar) e nova (a anterior foi descartada).
        const anteriores = ponto
          ? await tx.consultar(
              `SELECT id, chave_idempotencia, situacao FROM mensagem_integracao_saida
                WHERE ponto_integracao_id = ? AND LEFT(chave_idempotencia, ?) = ? ORDER BY id LIMIT 200`,
              [num(ponto['id']), chave.length, chave],
              { teto: 200 },
            )
          : [];
        const decisao = decidirEnvioPerfis(
          chave,
          anteriores.map((a) => ({
            chave: String(a['chave_idempotencia']),
            situacao: String(a['situacao']),
          })),
        );
        if (decisao.acao === 'recusar') throw recusa([decisao.erro], 'Envio recusado');
        if (decisao.acao === 'repetida') {
          const ja = anteriores.find((a) => String(a['chave_idempotencia']) === decisao.chave)!;
          return { id: num(ja['id']), repetida: true, perfis: perfis.length, chave: decisao.chave };
        }
        if (!ponto) {
          const padrao = await tx.uma(
            "SELECT id FROM padrao_troca WHERE familia = 'hl7v2' AND ativo = TRUE ORDER BY id LIMIT 1",
            [],
          );
          if (!padrao)
            throw recusa([
              {
                campo: 'ponto',
                codigo: 'padrao-troca-nao-cadastrado',
                mensagem: 'O padrão de troca HL7 v2 não está cadastrado neste cliente.',
              },
            ]);
          ponto = {
            id: await tx.incluir('ponto_integracao', {
              estabelecimento_id: est,
              codigo: codigoPonto,
              nome: `${String(par['nome'])} (saida)`.slice(0, 150),
              sistema_externo_id: sid,
              padrao_troca_id: num(padrao['id']),
              direcao: 'saida',
              transporte: 'mllp',
              formato_conteudo: 'hl7v2',
              versao_padrao: perfilMensagem.versaoHl7,
              ativo: true,
            }),
            ativo: true,
          };
        }
        const conteudo = montarPerfisHl7(
          {
            aplicacaoOrigem: 'SGH',
            instituicaoOrigem: c.hospital.toUpperCase().slice(0, 20),
            aplicacaoDestino: sistema.toUpperCase().slice(0, 20),
            dataHora: local,
            controle: decisao.sufixoControle
              ? `PRF${resumoPacote.slice(0, 10)}${local.toISOString().slice(5, 10).replace('-', '')}${decisao.sufixoControle}`
              : `PRF${resumoPacote.slice(0, 12)}${local.toISOString().slice(5, 10).replace('-', '')}`,
            processamento: process.env['SGH_AMBIENTE'] === 'producao' ? 'P' : 'T',
          },
          perfilMensagem,
          perfis,
        );
        const id = await tx.incluir('mensagem_integracao_saida', {
          estabelecimento_id: est,
          ponto_integracao_id: num(ponto['id']),
          sistema_externo_id: sid,
          canal_hl7_id: numOuNull(pm['canal_hl7_id']),
          evento_hl7_id: num(pm['evento_hl7_id']),
          chave_idempotencia: decisao.chave,
          correlacao: `perfis.${sistema}`.slice(0, 64),
          tipo_mensagem: EVENTO_ENVIO_PERFIS_TRIAGEM,
          formato: 'hl7v2',
          conteudo,
          hash_sha256: createHash('sha256').update(conteudo).digest('hex'),
          situacao: 'pendente',
          tentativas: 0,
          tentativas_maximas: Math.max(1, num(par['limite_tentativas']) || 5),
        });
        return { id, repetida: false, perfis: perfis.length, chave: decisao.chave };
      },
    );
  }

  /**
   * Entrada da classificação pela credencial do sistema de triagem (Basic cliente:segredo): conferida em tempo
   * constante pelo resumo da chave ativa; a credencial tem de ser de um sistema de triagem ativo, no estabelecimento,
   * com usuário técnico (autor da trilha) e o escopo. O sistema é o da credencial: corpo com outro sistema é recusado.
   */
  async receberPelaCredencial(
    hospital: string,
    autorizacao: unknown,
    corpo: unknown,
    agora: Date = new Date(),
  ): Promise<{ id: number; situacao: string; repetida: boolean; motivos: string[] }> {
    const negar = () =>
      new ErroOperacao(401, 'nao-autenticado', 'Credencial inválida', 'Confira o cliente e o segredo.');
    const cred = lerAutorizacaoBasica(autorizacao);
    if (!cred) throw negar();
    const base: ContextoComunicacao = {
      cliente: this.cliente,
      hospital,
      usuario: null,
      correlacao: 'integracao.triagem.entrada',
    };
    const x = await this.ler(base, 'classificacaoExterna.credencial', async (l, est) => {
      const r = await l.uma(
        `SELECT ca.situacao, ca.estabelecimento_id, ca.usuario_id, s.codigo AS sistema, s.categoria,
                s.ativo AS sistema_ativo, k.hash_chave, p.escopos
           FROM cliente_api ca
           JOIN chave_api k ON k.cliente_api_id = ca.id AND k.situacao = 'ativa' AND k.excluido_em IS NULL
                AND k.valida_desde <= CURRENT_TIMESTAMP(3) AND (k.valida_ate IS NULL OR k.valida_ate > CURRENT_TIMESTAMP(3))
           LEFT JOIN sistema_externo s ON s.id = ca.sistema_externo_id AND s.excluido_em IS NULL
           LEFT JOIN parceiro_dados p ON p.cliente_api_id = ca.id AND p.ativo = TRUE AND p.excluido_em IS NULL
          WHERE ca.identificador_cliente = ? AND ca.excluido_em IS NULL
          ORDER BY k.sequencia DESC, p.id LIMIT 1`,
        [cred.clienteId],
      );
      return r ? { r, est } : null;
    });
    if (!x || !segredoConfere(cred.segredo, String(x.r['hash_chave']))) throw negar();
    const erros = conferirCredencialTriagem({
      categoriaSistema: txtOuNull(x.r['categoria']),
      sistemaAtivo: bool(x.r['sistema_ativo']),
      situacaoCliente: String(x.r['situacao']),
      restritoA: numOuNull(x.r['estabelecimento_id']),
      estabelecimento: x.est,
      usuarioTecnico: numOuNull(x.r['usuario_id']),
      escopos: listaEscopos(x.r['escopos']),
    });
    if (erros.length > 0)
      throw new ErroOperacao(
        403,
        erros[0]!.codigo,
        'Credencial recusada',
        erros.map((e) => e.mensagem).join(' '),
      );
    const sistema = String(x.r['sistema']);
    const dados = (corpo !== null && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
    if (dados['sistemaCodigo'] !== undefined && dados['sistemaCodigo'] !== sistema)
      throw new ErroOperacao(
        403,
        'sistema-da-credencial',
        'Sistema diferente da credencial',
        'A classificação só entra em nome do sistema de triagem da credencial.',
      );
    return this.receber(
      { ...base, usuario: num(x.r['usuario_id']), correlacao: `triagem.${sistema}`.slice(0, 64) },
      { ...dados, sistemaCodigo: sistema },
      agora,
    );
  }
}

/** A lista de escopos gravada em JSON (o driver devolve texto ou já a lista). */
function listaEscopos(v: unknown): string[] {
  let x: unknown = v;
  if (typeof v === 'string') {
    try {
      x = JSON.parse(v);
    } catch {
      return [];
    }
  }
  return Array.isArray(x) ? x.filter((e): e is string => typeof e === 'string') : [];
}
