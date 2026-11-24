// Porta PRÓPRIA dos pacotes de dados de parceiros e das entregas agendadas (F3.9, linha 08-INTG L134):
//   - o pacote (`pacote_parceiro`) do parceiro (`parceiro_dados`): conteúdo, formato, meio, agenda, anonimização,
//     janela e revisão da minimização; os campos (`pacote_parceiro_campo`) com tratamento e justificativa — o campo
//     tirado do pacote fica registrado como excluído (nada é apagado);
//   - cada entrega (`entrega_pacote_parceiro`): o período devido pela agenda (regra do domínio), volume, tamanho e hash;
//     depois enviada, confirmada (protocolo) ou rejeitada/falhou (mensagem); a entrega nunca é apagada.
// Recusa entregar pacote inativo, de parceiro inativo ou com a revisão da minimização vencida.
import {
  ANONIMIZACOES,
  entregaDevida,
  FORMATOS_PACOTE,
  MEIOS_ENTREGA,
  PERIODICIDADES_PACOTE,
  podeMudarEntrega,
  revisaoVencida,
  type SituacaoEntrega,
  SITUACOES_ENTREGA,
  TRATAMENTOS_CAMPO,
  validarPacote,
} from '@sgh/dominio-integracao';
import { ErroOperacao } from '@sgh/nucleo';
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

export const PORTA_PACOTES_PARCEIRO = Symbol('PORTA_PACOTES_PARCEIRO');

export const esquemaCampoPacote = z
  .object({
    sequencia: z.number().int().min(1).max(9999),
    entidade: z.string().min(1).max(64),
    campo: z.string().min(1).max(64),
    rotuloSaida: z.string().min(1).max(100),
    tratamento: z.enum(TRATAMENTOS_CAMPO).default('original'),
    dadoSensivel: z.boolean().default(false),
    justificativa: z.string().max(500),
  })
  .strict();

export const esquemaPacote = z
  .object({
    id: z.number().int().positive().nullable().default(null),
    parceiroCodigo: z.string().min(1).max(40),
    codigo: z.string().min(1).max(40),
    nome: z.string().min(1).max(150),
    conteudo: z.string().min(1).max(1000),
    formato: z.enum(FORMATOS_PACOTE),
    meioEntrega: z.enum(MEIOS_ENTREGA),
    periodicidade: z.enum(PERIODICIDADES_PACOTE).default('sob_demanda'),
    agenda: z.string().max(60).nullable().default(null),
    anonimizacao: z.enum(ANONIMIZACOES).default('pseudonimizada'),
    janelaDias: z.number().int().nullable().default(null),
    campos: z.array(esquemaCampoPacote).max(200),
    /** true: registra a revisão da minimização agora (próxima em 12 meses). */
    revisado: z.boolean().default(true),
    ativo: z.boolean().default(true),
    versao: z.number().int().positive().nullable().default(null),
  })
  .strict();

export const esquemaEntrega = z
  .object({
    periodoInicio: z.string().datetime({ offset: true }).nullable().default(null),
    periodoFim: z.string().datetime({ offset: true }).nullable().default(null),
    quantidadeRegistros: z.number().int().min(0),
    tamanhoBytes: z.number().int().min(0).nullable().default(null),
    hashSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable()
      .default(null),
  })
  .strict();

export const esquemaSituacaoEntrega = z
  .object({
    situacao: z.enum(SITUACOES_ENTREGA),
    protocolo: z.string().max(100).nullable().default(null),
    mensagem: z.string().max(1000).nullable().default(null),
  })
  .strict();

export interface PacoteLido {
  readonly id: number;
  readonly parceiroCodigo: string;
  readonly parceiro: string;
  readonly codigo: string;
  readonly nome: string;
  readonly conteudo: string;
  readonly formato: string;
  readonly meioEntrega: string;
  readonly periodicidade: string;
  readonly agenda: string | null;
  readonly anonimizacao: string;
  readonly janelaDias: number | null;
  readonly revisadoEm: string | null;
  readonly proximaRevisao: string | null;
  readonly revisaoVencida: boolean;
  readonly ativo: boolean;
  readonly versao: number;
  readonly campos: z.infer<typeof esquemaCampoPacote>[];
  readonly ultimaEntrega: { id: number; situacao: string; periodoFim: string } | null;
  readonly proximaDevida: { inicio: string; fim: string } | null;
}

const hoje = (d: Date) => d.toISOString().slice(0, 10);
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? hoje(v) : String(v).slice(0, 10);

export class PortaPacotesParceiroPropria extends BaseComunicacaoPropria {
  pacotes(c: ContextoComunicacao, agora: Date = new Date()): Promise<PacoteLido[]> {
    return this.ler(c, 'pacotes.listar', async (l) => {
      const ps = await l.consultar(
        `SELECT p.*, d.codigo AS parceiro_codigo, d.nome AS parceiro_nome
           FROM pacote_parceiro p JOIN parceiro_dados d ON d.id = p.parceiro_dados_id
          WHERE d.excluido_em IS NULL ORDER BY d.nome, p.nome LIMIT 300`,
      );
      if (!ps.length) return [];
      const ids = ps.map((x) => num(x['id']));
      const marca = ids.map(() => '?').join(',');
      const campos = await l.consultar(
        `SELECT pacote_parceiro_id AS p, sequencia, entidade, campo, rotulo_saida, tratamento, dado_sensivel,
                justificativa
           FROM pacote_parceiro_campo WHERE pacote_parceiro_id IN (${marca}) AND excluido_em IS NULL
          ORDER BY sequencia`,
        ids,
      );
      const ultimas = await l.consultar(
        `SELECT e.pacote_parceiro_id AS p, e.id, e.situacao, e.periodo_fim
           FROM entrega_pacote_parceiro e
          WHERE e.pacote_parceiro_id IN (${marca})
            AND e.id = (SELECT MAX(x.id) FROM entrega_pacote_parceiro x WHERE x.pacote_parceiro_id = e.pacote_parceiro_id)`,
        ids,
      );
      const fins = await l.consultar(
        `SELECT pacote_parceiro_id AS p, MAX(periodo_fim) AS fim FROM entrega_pacote_parceiro
          WHERE pacote_parceiro_id IN (${marca}) AND situacao NOT IN ('rejeitada','falhou') GROUP BY pacote_parceiro_id`,
        ids,
      );
      return ps.map((x) => {
        const id = num(x['id']);
        const u = ultimas.find((e) => num(e['p']) === id);
        const f = fins.find((e) => num(e['p']) === id);
        const devida = entregaDevida({
          periodicidade: String(x['periodicidade']) as never,
          agenda: txtOuNull(x['agenda']),
          janelaDias: numOuNull(x['janela_dias']),
          ultimoFim: f?.['fim'] ? new Date(f['fim'] as string) : null,
          agora,
        });
        const proxima = dataIso(x['proxima_revisao_em']);
        return {
          id,
          parceiroCodigo: String(x['parceiro_codigo']),
          parceiro: String(x['parceiro_nome']),
          codigo: String(x['codigo']),
          nome: String(x['nome']),
          conteudo: String(x['conteudo']),
          formato: String(x['formato']),
          meioEntrega: String(x['meio_entrega']),
          periodicidade: String(x['periodicidade']),
          agenda: txtOuNull(x['agenda']),
          anonimizacao: String(x['anonimizacao']),
          janelaDias: numOuNull(x['janela_dias']),
          revisadoEm: dataOuNull(x['revisado_em']),
          proximaRevisao: proxima,
          revisaoVencida: revisaoVencida(proxima, hoje(agora)),
          ativo: bool(x['ativo']),
          versao: num(x['versao']),
          campos: campos
            .filter((k) => num(k['p']) === id)
            .map((k) => ({
              sequencia: num(k['sequencia']),
              entidade: String(k['entidade']),
              campo: String(k['campo']),
              rotuloSaida: String(k['rotulo_saida']),
              tratamento: String(k['tratamento']) as never,
              dadoSensivel: bool(k['dado_sensivel']),
              justificativa: String(k['justificativa']),
            })),
          ultimaEntrega: u
            ? { id: num(u['id']), situacao: String(u['situacao']), periodoFim: dataOuNull(u['periodo_fim'])! }
            : null,
          proximaDevida: devida
            ? { inicio: devida.inicio.toISOString(), fim: devida.fim.toISOString() }
            : null,
        };
      });
    });
  }

  /** Inclui ou altera (com a versão lida) o pacote e os seus campos; o campo tirado fica como excluído. */
  gravarPacote(c: ContextoComunicacao, entrada: unknown, agora: Date = new Date()): Promise<{ id: number }> {
    const x = entradaValida(esquemaPacote, entrada);
    const erros = validarPacote(x, x.campos);
    if (erros.length) throw recusa(erros, 'Pacote recusado');
    return this.gravar(
      c,
      'integracao.parceiro.configurarPacote',
      ['pacote_parceiro', 'pacote_parceiro_campo'],
      async (tx, _est, usuario) => {
        const d = await tx.uma('SELECT id FROM parceiro_dados WHERE codigo = ? AND excluido_em IS NULL', [
          x.parceiroCodigo,
        ]);
        if (!d) throw naoEncontrado('Parceiro');
        const proxima = new Date(agora);
        proxima.setUTCFullYear(proxima.getUTCFullYear() + 1);
        const valores: Record<string, unknown> = {
          nome: x.nome.trim(),
          conteudo: x.conteudo.trim(),
          formato: x.formato,
          meio_entrega: x.meioEntrega,
          periodicidade: x.periodicidade,
          agenda: x.agenda?.trim() || null,
          anonimizacao: x.anonimizacao,
          janela_dias: x.janelaDias,
          ativo: x.ativo,
          ...(x.revisado
            ? { revisado_em: agora, revisado_por_usuario_id: usuario, proxima_revisao_em: hoje(proxima) }
            : {}),
        };
        const a = await tx.uma(
          'SELECT id, versao FROM pacote_parceiro WHERE parceiro_dados_id = ? AND codigo = ? FOR UPDATE',
          [num(d['id']), x.codigo],
        );
        let id: number;
        if (a) {
          if (x.versao === null || x.versao !== num(a['versao']) || (x.id !== null && x.id !== num(a['id'])))
            throw conflito();
          id = num(a['id']);
          await tx.alterar('pacote_parceiro', id, x.versao, valores);
        } else {
          if (x.id !== null) throw conflito();
          id = await tx.incluir('pacote_parceiro', {
            parceiro_dados_id: num(d['id']),
            codigo: x.codigo,
            ...valores,
          });
        }
        const atuais = await tx.consultar(
          'SELECT id, entidade, campo, versao, excluido_em FROM pacote_parceiro_campo WHERE pacote_parceiro_id = ? ORDER BY id FOR UPDATE',
          [id],
        );
        // Primeiro afasta as sequências (a chave única vale também para os excluídos), depois grava o que veio.
        const versoes = new Map<number, number>();
        for (const [i, k] of atuais.entries())
          versoes.set(
            num(k['id']),
            await tx.alterar('pacote_parceiro_campo', num(k['id']), num(k['versao']), {
              sequencia: 30000 + i,
            }),
          );
        const usados = new Set<number>();
        for (const k of x.campos) {
          const v = {
            sequencia: k.sequencia,
            rotulo_saida: k.rotuloSaida.trim(),
            tratamento: k.tratamento,
            dado_sensivel: k.dadoSensivel,
            justificativa: k.justificativa.trim(),
            excluido_em: null,
            excluido_por: null,
          };
          const e = atuais.find(
            (z1) => String(z1['entidade']) === k.entidade && String(z1['campo']) === k.campo,
          );
          if (e) {
            usados.add(num(e['id']));
            await tx.alterar('pacote_parceiro_campo', num(e['id']), versoes.get(num(e['id']))!, v);
          } else
            await tx.incluir('pacote_parceiro_campo', {
              pacote_parceiro_id: id,
              entidade: k.entidade,
              campo: k.campo,
              ...v,
            });
        }
        for (const k of atuais)
          if (!usados.has(num(k['id'])) && k['excluido_em'] === null)
            await tx.alterar('pacote_parceiro_campo', num(k['id']), versoes.get(num(k['id']))!, {
              excluido_em: agora,
              excluido_por: usuario,
            });
        return { id };
      },
    );
  }

  /** Registra a entrega: o período devido pela agenda (ou o informado, no pacote sob demanda), volume e hash. */
  registrarEntrega(
    c: ContextoComunicacao,
    pacote: number,
    entrada: unknown,
    agora: Date = new Date(),
  ): Promise<{ id: number; periodoInicio: string; periodoFim: string }> {
    const x = entradaValida(esquemaEntrega, entrada);
    return this.gravar(
      c,
      'integracao.parceiro.registrarEntrega',
      ['entrega_pacote_parceiro'],
      async (tx, _est, usuario) => {
        const p = await tx.uma(
          `SELECT p.id, p.periodicidade, p.agenda, p.janela_dias, p.ativo, p.proxima_revisao_em, d.ativo AS parceiro_ativo
             FROM pacote_parceiro p JOIN parceiro_dados d ON d.id = p.parceiro_dados_id
            WHERE p.id = ? AND d.excluido_em IS NULL FOR UPDATE`,
          [pacote],
        );
        if (!p) throw naoEncontrado('Pacote');
        const erros: { campo: string; codigo: string; mensagem: string }[] = [];
        if (!bool(p['ativo']) || !bool(p['parceiro_ativo']))
          erros.push({
            campo: 'pacote',
            codigo: 'pacote-inativo',
            mensagem: 'Pacote ou parceiro fora de uso.',
          });
        if (revisaoVencida(dataIso(p['proxima_revisao_em']), hoje(agora)))
          erros.push({
            campo: 'pacote',
            codigo: 'revisao-vencida',
            mensagem: 'A revisão da minimização do pacote venceu: revise os campos antes de entregar.',
          });
        let inicio: Date | null = null;
        let fim: Date | null = null;
        if (String(p['periodicidade']) === 'sob_demanda') {
          if (!x.periodoInicio || !x.periodoFim)
            erros.push({
              campo: 'periodoInicio',
              codigo: 'periodo-obrigatorio',
              mensagem: 'Informe o período.',
            });
          else {
            inicio = new Date(x.periodoInicio);
            fim = new Date(x.periodoFim);
            if (fim < inicio)
              erros.push({
                campo: 'periodoFim',
                codigo: 'periodo-invertido',
                mensagem: 'O fim é antes do início.',
              });
          }
        } else {
          const u = await tx.uma(
            `SELECT MAX(periodo_fim) AS fim FROM entrega_pacote_parceiro
              WHERE pacote_parceiro_id = ? AND situacao NOT IN ('rejeitada','falhou')`,
            [pacote],
          );
          const d = entregaDevida({
            periodicidade: String(p['periodicidade']) as never,
            agenda: txtOuNull(p['agenda']),
            janelaDias: numOuNull(p['janela_dias']),
            ultimoFim: u?.['fim'] ? new Date(u['fim'] as string) : null,
            agora,
          });
          if (!d)
            erros.push({
              campo: 'pacote',
              codigo: 'nada-devido',
              mensagem: 'Nenhuma entrega devida: o período agendado já foi entregue.',
            });
          else ({ inicio, fim } = d);
        }
        if (erros.length) throw recusa(erros, 'Entrega recusada');
        const id = await tx.incluir('entrega_pacote_parceiro', {
          pacote_parceiro_id: pacote,
          operacao: 'inclusao',
          ocorrido_em: agora,
          usuario_id: usuario,
          periodo_inicio: inicio,
          periodo_fim: fim,
          quantidade_registros: x.quantidadeRegistros,
          tamanho_bytes: x.tamanhoBytes,
          hash_sha256: x.hashSha256,
          situacao: 'gerada',
        });
        return { id, periodoInicio: inicio!.toISOString(), periodoFim: fim!.toISOString() };
      },
    );
  }

  /** Enviada, confirmada (com protocolo), rejeitada ou falhou (com a mensagem): só para a frente. */
  mudarEntrega(c: ContextoComunicacao, entrega: number, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(esquemaSituacaoEntrega, entrada);
    return this.gravar(c, 'integracao.parceiro.situacaoEntrega', ['entrega_pacote_parceiro'], async (tx) => {
      const e = await tx.uma(
        'SELECT id, situacao, versao FROM entrega_pacote_parceiro WHERE id = ? FOR UPDATE',
        [entrega],
      );
      if (!e) throw naoEncontrado('Entrega');
      const atual = String(e['situacao']) as SituacaoEntrega;
      if (!podeMudarEntrega(atual, x.situacao))
        throw new ErroOperacao(
          409,
          'transicao-invalida',
          'Situação não permitida',
          `A entrega ${atual} não passa a ${x.situacao}.`,
        );
      if (x.situacao === 'confirmada' && !x.protocolo?.trim())
        throw recusa([
          { campo: 'protocolo', codigo: 'protocolo-obrigatorio', mensagem: 'Informe o protocolo.' },
        ]);
      if ((x.situacao === 'rejeitada' || x.situacao === 'falhou') && !x.mensagem?.trim())
        throw recusa([{ campo: 'mensagem', codigo: 'mensagem-obrigatoria', mensagem: 'Informe o motivo.' }]);
      const agora = new Date();
      await tx.alterar('entrega_pacote_parceiro', entrega, num(e['versao']), {
        situacao: x.situacao,
        ...(x.situacao === 'enviada' ? { enviado_em: agora } : {}),
        ...(x.situacao === 'confirmada' ? { confirmado_em: agora, protocolo_confirmacao: x.protocolo } : {}),
        ...(x.mensagem ? { mensagem_retorno: x.mensagem } : {}),
      });
      return { id: entrega };
    });
  }

  entregas(c: ContextoComunicacao, pacote: number) {
    return this.ler(c, 'pacotes.entregas', async (l) =>
      (
        await l.consultar(
          `SELECT id, periodo_inicio, periodo_fim, quantidade_registros, tamanho_bytes, situacao, enviado_em,
                  confirmado_em, protocolo_confirmacao, mensagem_retorno, ocorrido_em
             FROM entrega_pacote_parceiro WHERE pacote_parceiro_id = ? ORDER BY id DESC LIMIT 200`,
          [pacote],
        )
      ).map((x) => ({
        id: num(x['id']),
        periodoInicio: dataOuNull(x['periodo_inicio']),
        periodoFim: dataOuNull(x['periodo_fim']),
        quantidadeRegistros: num(x['quantidade_registros']),
        tamanhoBytes: numOuNull(x['tamanho_bytes']),
        situacao: String(x['situacao']),
        enviadoEm: dataOuNull(x['enviado_em']),
        confirmadoEm: dataOuNull(x['confirmado_em']),
        protocolo: txtOuNull(x['protocolo_confirmacao']),
        mensagem: txtOuNull(x['mensagem_retorno']),
        ocorridoEm: dataOuNull(x['ocorrido_em']),
      })),
    );
  }
}
