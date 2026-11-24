// Porta PRÓPRIA da classificação de risco externa (F3.9, linha 08-INTG L140), sobre o banco do cliente:
//   - os perfis de prioridade (`perfil_prioridade_externa`) com o código que o sistema de triagem conhece, e o pacote
//     de perfis que vai a ele (ativos, na ordem de prioridade: regra do domínio);
//   - o recebimento da classificação (`classificacao_externa_recebida`) ligada ao atendimento do pronto atendimento:
//     idempotente pelo sistema e pelo identificador externo; a que não confere fica gravada como rejeitada, com o
//     motivo; a mais nova do atendimento vale e as anteriores passam a substituídas (nada é apagado);
//   - a visão do atendimento: as classificações recebidas, com o prazo do atendimento médico.
import {
  CONDICOES_PREFERENCIAIS,
  type CondicaoPreferencial,
  conferirClassificacaoRecebida,
  perfisParaEnvio,
  prazoAtendimento,
  situacaoNaChegada,
  validarPerfilPrioridade,
} from '@sgh/dominio-integracao';
import { z } from 'zod';
import {
  BaseComunicacaoPropria,
  bool,
  conflito,
  type ContextoComunicacao,
  dataOuNull,
  entradaValida,
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
      'integracao.classificacaoExterna.configurarPerfil',
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
        const a = await tx.uma(
          'SELECT id, versao FROM perfil_prioridade_externa WHERE codigo = ? FOR UPDATE',
          [x.codigo],
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
      'integracao.classificacaoExterna.receber',
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
        const vigentes = await tx.consultar(
          `SELECT id, versao, classificado_em FROM classificacao_externa_recebida
            WHERE atendimento_id = ? AND situacao IN ('recebida','aplicada') AND excluido_em IS NULL FOR UPDATE`,
          [x.atendimentoId],
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
}
