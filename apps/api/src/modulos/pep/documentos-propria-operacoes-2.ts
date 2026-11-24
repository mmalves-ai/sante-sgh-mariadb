// Porta PRÓPRIA dos documentos do prontuário, família "pep-resto2" (modulos-proprios-3): as duas gravações do executar
// de documentos que ainda recusavam com 501 no banco próprio. O integrador as registra em `outras` de
// documentos-propria-painel.ts `executar` (mesma assinatura de GravacaoDocumentos). A especificação é a porta de
// memória (documentos-porta-memoria.ts, `executar`): mesmos esquemas, erros de domínio e retorno.
//   - pep.anexarDocumento: o PDF vai para a porta de armazenamento de arquivos (disco da máquina que hospeda o sistema,
//     ADR 0004; registro em `arquivo`, imutável, guarda legal do prontuário) e o metadado para anexo_prontuario;
//   - pep.solicitarExame: requisicao_exame (uma por setor executante padrão do exame no estabelecimento, número pela
//     sequencia_negocio "requisicao_exame") + exame_item (um por exame pedido).
// Cada gravação cria o documento do prontuário (documento_prontuario, situação "lançado", evento "criacao") com o
// resumo do conteúdo, como a memória devolve `documento`. A gravação exige o profissional da sessão com inscrição ativa
// no conselho (a indicada em `cbo`). Trilha, versão e idempotência pelo executor, na mesma transação. Registro clínico
// nunca é apagado (SBIS-26).
import { createHash } from 'node:crypto';
import {
  type ArmazemArquivos,
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoDocs } from './documentos-porta.js';
import type { NucleoDocumentosPep } from './documentos-porta-propria.js';
import type { GravacaoDocumentos } from './documentos-propria-painel.js';
import {
  conferirAtendimento,
  documentoProntuario,
  entradaValida,
  type Resultado,
  sessao,
  TABELAS_DOCUMENTO,
} from './documentos-propria-operacoes.js';
import { instanteLocal } from './prescricao-propria-gravacao.js';
import { fusoValido } from './registro-porta-propria.js';
import { esquemaAnexo, esquemaPedidoExames } from './tipos-pep.js';

/** Operações do executor de documentos que esta família grava no banco próprio. */
export const OPERACOES_PEP_RESTO_2: readonly string[] = ['pep.anexarDocumento', 'pep.solicitarExame'];

/** Sequência de negócio do número da requisição de exames (por estabelecimento). */
export const SEQUENCIA_REQUISICAO_EXAME = 'requisicao_exame';

/** Guarda legal do prontuário (anos): o arquivo anexado não pode ser excluído antes dela. */
export const ANOS_GUARDA_PRONTUARIO = 20;

/** O que a família usa do armazenamento de arquivos (só a gravação). */
export type GravadorArquivos = Pick<ArmazemArquivos, 'guardar'>;

const num = (v: unknown): number => Number(v);
const marcadores = (n: number): string => Array.from({ length: n }, () => '?').join(', ');
const recusar = (status: number, codigo: string, detalhe: string): ErroOperacao =>
  new ErroOperacao(status, codigo, 'Operação recusada', detalhe);

/**
 * Chave de idempotência do registro do arquivo, derivada da chave da requisição: sempre no formato do núcleo (8 a 80
 * caracteres), qualquer que seja o tamanho da chave de origem. A mesma requisição gera a mesma chave.
 */
export function chaveDoArquivoDoAnexo(chaveRequisicao: string): string {
  return `pep.anexo.arquivo:${createHash('sha256').update(chaveRequisicao).digest('hex').slice(0, 48)}`;
}

/** O conteúdo do anexo (base64) como PDF; outro formato é recusado como a memória (422 arquivo-invalido). */
export function pdfDoAnexo(conteudo: string): Buffer {
  const pdf = Buffer.from(conteudo, 'base64');
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-')
    throw new ErroOperacao(422, 'arquivo-invalido', 'Arquivo inválido', 'O arquivo não é um PDF.');
  return pdf;
}

/** Data da guarda legal (AAAA-MM-DD, UTC) a partir de hoje. */
export function guardaLegal(agora: Date, anos = ANOS_GUARDA_PRONTUARIO): string {
  return new Date(Date.UTC(agora.getUTCFullYear() + anos, agora.getUTCMonth(), agora.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

/** Nome do arquivo guardado: o nome informado (sem caracteres de caminho) com a extensão .pdf. */
export function nomeDoArquivo(nome: string): string {
  const base =
    [...nome]
      .map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch))
      .join('')
      .trim() || 'anexo';
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

/** Itens do pedido agrupados pelo setor executante (ordem de entrada preservada). */
export function agruparPorSetor<T extends { readonly exame: number }>(
  itens: readonly T[],
  setorDoExame: ReadonlyMap<number, number>,
): Map<number, T[]> {
  const grupos = new Map<number, T[]>();
  for (const it of itens) {
    const setor = setorDoExame.get(it.exame);
    if (setor === undefined)
      throw recusar(
        409,
        'exame-sem-setor-executante',
        'Há exame no pedido sem setor executante ativo neste estabelecimento.',
      );
    const g = grupos.get(setor) ?? [];
    g.push(it);
    grupos.set(setor, g);
  }
  return grupos;
}

/** As gravações desta família, por nome de operação, para o `outras` do executar de documentos. */
export function operacoesDocumentosPropria2(
  nucleo: NucleoDocumentosPep,
  cliente: string,
  /** Porta de armazenamento de arquivos (ADR 0004); sem ela, anexar recusa com 503 (falha fechada, nada gravado). */
  arquivos: Partial<GravadorArquivos> | null = null,
  executor: Executor = nucleo.criarExecutor(),
): Readonly<Record<string, GravacaoDocumentos>> {
  async function estabelecimento(c: ContextoDocs, banco: string, nome: string) {
    return nucleo.lerSomente({ cliente: banco, correlacao: `pep.documentos.${nome}` }, async (l) => {
      const e = await l.uma(
        'SELECT id, fuso_horario FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
        [c.hospital],
      );
      if (!e)
        throw new ErroOperacao(
          404,
          'estabelecimento-inexistente',
          'Estabelecimento não encontrado',
          'O estabelecimento da sessão não existe neste cliente.',
        );
      return { id: num(e['id']), fuso: fusoValido(e['fuso_horario']) };
    });
  }

  /** Grava pela operação do executor com a ENTRADA VALIDADA (o hash da idempotência é o dela). */
  async function gravar(
    c: ContextoDocs,
    ctx: ContextoOperacao,
    nome: string,
    entrada: Record<string, unknown>,
    tabelas: readonly string[],
    fn: (
      tx: TxOperacao,
      est: { id: number; fuso: string },
    ) => Promise<Resultado & { tabela: string; id: number }>,
    trilha: (r: Resultado) => Record<string, unknown>,
    antes?: (est: { id: number; fuso: string }, banco: string) => Promise<void>,
  ): Promise<Record<string, unknown>> {
    const banco = c.cliente || cliente;
    const est = await estabelecimento(c, banco, nome);
    if (antes) await antes(est, banco);
    const op = definirOperacao({
      nome,
      tabelas: [...tabelas, ...TABELAS_DOCUMENTO],
      entrada: z.object({}).passthrough(),
      gravar: (tx: TxOperacao) => fn(tx, est),
      alvo: (_e, x) => ({ tabela: String(x['tabela']), id: Number(x['id']) }),
      trilha: (_e, x) => ({ dados: trilha(x) }),
    });
    const saida = await executor.executar(op, banco, entrada, {
      ...ctx,
      cliente: banco,
      estabelecimento: est.id,
    });
    const resto: Record<string, unknown> = { ...saida.resultado };
    delete resto['tabela'];
    delete resto['id'];
    return resto;
  }

  const anexarDocumento: GravacaoDocumentos = async (c, entrada, ctx) => {
    const x = entradaValida(esquemaAnexo, entrada);
    const pdf = pdfDoAnexo(x.conteudo);
    const guardar = arquivos?.guardar?.bind(arquivos);
    if (!guardar)
      throw new ErroOperacao(
        503,
        'armazenamento-indisponivel',
        'Armazenamento de arquivos indisponível',
        'A porta de armazenamento de arquivos não está configurada nesta API.',
      );
    let arquivo = 0;
    return gravar(
      c,
      ctx,
      'pep.anexo.incluir',
      x,
      ['anexo_prontuario'],
      async (tx, est) => {
        const s = await sessao(tx, est, x.cbo, true);
        await conferirAtendimento(tx, s, x.atendimento, x.paciente);
        const tipo = await tx.uma(
          x.tipoAnexo !== undefined
            ? 'SELECT id FROM tipo_anexo WHERE id = ? AND ativo = TRUE'
            : `SELECT id FROM tipo_anexo WHERE ativo = TRUE ORDER BY (finalidade = 'outro') DESC, id LIMIT 1`,
          x.tipoAnexo !== undefined ? [x.tipoAnexo] : [],
        );
        if (!tipo) {
          if (x.tipoAnexo !== undefined)
            throw new ErroOperacao(
              400,
              'entrada-invalida',
              'Entrada inválida',
              'Confira os campos indicados.',
              {
                campos: ['tipoAnexo'],
              },
            );
          throw recusar(409, 'tipo-anexo-sem-cadastro', 'O cliente não tem tipo de anexo ativo.');
        }
        const agora = new Date();
        const clinico = instanteLocal(x.dataHoraClinica, s.fuso);
        if (clinico.getTime() > agora.getTime() + 5 * 60_000)
          throw recusar(422, 'horario-futuro', 'O horário clínico não pode estar no futuro.');
        const id = await tx.incluir('anexo_prontuario', {
          estabelecimento_id: s.est,
          paciente_id: x.paciente,
          atendimento_id: x.atendimento,
          tipo_anexo_id: num(tipo['id']),
          arquivo_id: arquivo,
          titulo: x.nome,
          referencia_em: x.referencia ?? null,
          evento_em: clinico,
          canal_entrada: 'upload',
          local_origem: x.estacao,
          importado_em: agora,
          importado_profissional_id: s.profissional,
          situacao: 'ativo',
          origem: 'sistema',
        });
        const documento = await documentoProntuario(tx, s, {
          categoria: 'outro',
          paciente: x.paciente,
          atendimento: x.atendimento,
          tabela: 'anexo_prontuario',
          id,
          titulo: x.nome,
          referencia: clinico,
          hash: x.hashConteudo,
          comoSuporte: x.comoSuporte === true,
        });
        return { tabela: 'anexo_prontuario', id, anexo: id, origem: id, documento, trilha: null };
      },
      (r) => ({ evento: 'pep.anexo.incluido', paciente: x.paciente, documento: r['documento'], arquivo }),
      // O arquivo vai ao disco ANTES da transação (endereçado pelo hash: o mesmo conteúdo no mesmo dia reaproveita o
      // mesmo registro de `arquivo`, e cada anexo é uma linha própria de anexo_prontuario; o mesmo PDF pode ser anexado
      // de novo, a outro atendimento ou a outro paciente, como na memória, e nada revela onde mais ele está). Se a
      // gravação do anexo falhar, sobra um arquivo sem anexo, que nunca é servido (a leitura parte do anexo).
      async (est, banco) => {
        const g = await guardar(
          {
            conteudo: pdf,
            nomeOriginal: nomeDoArquivo(x.nome),
            tipoMime: 'application/pdf',
            finalidade: 'anexo',
            entidade: 'anexo_prontuario',
            retencaoAte: guardaLegal(new Date()),
            imutavel: true,
          },
          {
            ...ctx,
            cliente: banco,
            estabelecimento: est.id,
            chaveIdempotencia: chaveDoArquivoDoAnexo(ctx.chaveIdempotencia),
          },
        );
        arquivo = g.id;
      },
    );
  };

  const solicitarExame: GravacaoDocumentos = async (c, entrada, ctx) => {
    const x = entradaValida(esquemaPedidoExames, entrada);
    return gravar(
      c,
      ctx,
      'pep.exame.solicitar',
      x,
      ['requisicao_exame', 'exame_item', 'sequencia_negocio'],
      async (tx, est) => {
        const s = await sessao(tx, est, x.cbo, true);
        await conferirAtendimento(tx, s, x.atendimento, x.paciente);
        const agora = new Date();
        const clinico = instanteLocal(x.dataHoraClinica, s.fuso);
        if (clinico.getTime() > agora.getTime() + 5 * 60_000)
          throw recusar(422, 'horario-futuro', 'O horário clínico não pode estar no futuro.');
        const ids = [...new Set(x.itens.map((i) => i.exame))];
        const exames = await tx.consultar(
          `SELECT id, ativo FROM exame WHERE id IN (${marcadores(ids.length)}) AND excluido_em IS NULL`,
          ids,
        );
        const ativos = new Set(exames.filter((e) => Number(e['ativo']) === 1).map((e) => num(e['id'])));
        if (ids.some((i) => !ativos.has(i)))
          throw new ErroOperacao(422, 'exame-inativo', 'Exame inativo', 'Há exame inativo no pedido.');
        const setores = await tx.consultar(
          `SELECT ese.exame_id, ese.setor_diagnostico_id FROM exame_setor_executante ese
             JOIN setor_diagnostico sd ON sd.id = ese.setor_diagnostico_id AND sd.estabelecimento_id = ?
              AND sd.ativo = TRUE AND sd.excluido_em IS NULL
            WHERE ese.exame_id IN (${marcadores(ids.length)}) AND ese.ativo = TRUE AND ese.excluido_em IS NULL
            ORDER BY ese.padrao DESC, ese.id`,
          [s.est, ...ids],
        );
        const setorDoExame = new Map<number, number>();
        for (const l of setores)
          if (!setorDoExame.has(num(l['exame_id'])))
            setorDoExame.set(num(l['exame_id']), num(l['setor_diagnostico_id']));
        const grupos = agruparPorSetor(x.itens, setorDoExame);
        const at = await tx.uma('SELECT fonte_pagadora_id FROM atendimento WHERE id = ?', [x.atendimento]);
        let agrupamento = 0;
        let primeiro = 0;
        const requisicoes: number[] = [];
        for (const [setor, itens] of grupos) {
          const numero = await tx.proximoNumero(SEQUENCIA_REQUISICAO_EXAME);
          const indicacoes = [
            ...new Set(itens.map((i) => i.indicacao?.trim()).filter((i): i is string => !!i)),
          ];
          const requisicao = await tx.incluir('requisicao_exame', {
            estabelecimento_id: s.est,
            numero: numero.formatado,
            paciente_id: x.paciente,
            atendimento_id: x.atendimento,
            setor_diagnostico_id: setor,
            solicitante_profissional_id: s.profissional,
            fonte_pagadora_id: num(at?.['fonte_pagadora_id']),
            tipo_solicitacao: 'pedido_prontuario',
            prioridade: itens.some((i) => i.urgente) ? 'urgente' : 'rotina',
            situacao: 'solicitada',
            solicitado_em: clinico,
            indicacao_clinica: indicacoes.length ? indicacoes.join('; ').slice(0, 2000) : null,
            origem: 'sistema',
          });
          agrupamento ||= requisicao;
          requisicoes.push(requisicao);
          for (const [i, it] of itens.entries()) {
            const item = await tx.incluir('exame_item', {
              requisicao_exame_id: requisicao,
              sequencia: i + 1,
              exame_id: it.exame,
              setor_diagnostico_id: setor,
              urgente: it.urgente,
              situacao: 'solicitado',
              observacao: it.indicacao?.trim() || null,
              origem: 'sistema',
            });
            primeiro ||= item;
          }
        }
        const documento = await documentoProntuario(tx, s, {
          categoria: 'outro',
          paciente: x.paciente,
          atendimento: x.atendimento,
          tabela: 'requisicao_exame',
          id: agrupamento,
          titulo: 'Pedido de exames',
          referencia: clinico,
          hash: x.hashConteudo,
          comoSuporte: x.comoSuporte === true,
        });
        return {
          tabela: 'requisicao_exame',
          id: agrupamento,
          agrupamento,
          primeiro,
          exames: x.itens.length,
          requisicoes: requisicoes.length,
          documentoTrilha: agrupamento,
          documento,
          trilha: null,
        };
      },
      (r) => ({
        evento: 'pep.exame.solicitado',
        paciente: x.paciente,
        documento: r['documento'],
        exames: r['exames'],
        requisicoes: r['requisicoes'],
      }),
    );
  };

  return { 'pep.anexarDocumento': anexarDocumento, 'pep.solicitarExame': solicitarExame };
}
