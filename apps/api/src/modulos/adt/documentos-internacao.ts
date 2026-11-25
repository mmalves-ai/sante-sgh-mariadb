// F3.4 (04-INT linha 69): os documentos da internação (fichas, termos, guias) escolhidos pela regra de convênio,
// especialidade e modalidade, sobre o banco do cliente. Os modelos (`modelo_documento_internacao`, do estabelecimento ou
// de todos) e as regras (`regra_documento_internacao`, do estabelecimento) são mantidos aqui; a escolha é a do domínio
// (`documentosDaInternacao`). Nada se apaga: o modelo e a regra saem de uso por `ativo = FALSE`, com a versão conferida.
// Cada gravação é uma operação do executor, com a linha da trilha na mesma transação. O modelo comum a todos os
// estabelecimentos (estabelecimento nulo) só é incluído ou alterado pela administração da plataforma, e o dono do modelo
// não muda numa alteração (o estabelecimento não toma o modelo dos outros nem o comum vira de um só). O momento e as
// cópias do modelo são o padrão da regra nova; o modelo `sob_demanda` é oferecido na emissão sem regra.
import { randomUUID } from 'node:crypto';
import {
  documentosDaInternacao,
  idadeEm,
  modelosSobDemanda,
  momentoPadraoDaRegra,
  MOMENTOS_DOCUMENTO_INTERNACAO,
  MOMENTOS_MODELO_DOCUMENTO,
  type DocumentoDaInternacao,
  type ModeloDocumentoInternacao,
  type MomentoDocumentoInternacao,
  type RegraDocumentoInternacao,
  validarModeloDocumento,
  validarRegraDocumento,
} from '@sgh/dominio-internacao';
import {
  type ContextoNucleo,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoAdt } from './porta.js';
import type { NucleoAdt } from './porta-propria.js';

const id = z.number().int().positive();
const opcional = id.nullable().default(null);

export const esquemaModeloDocumento = z.object({
  id: id.optional(),
  versao: z.number().int().positive().optional(),
  codigo: z.string().trim().min(1).max(30),
  titulo: z.string().trim().min(1).max(150),
  conteudo: z.string().trim().min(1).max(60000),
  /** Padrão da regra nova deste modelo; `sob_demanda`: sai quando escolhido na emissão (CHECK do banco). */
  momento: z.enum(MOMENTOS_MODELO_DOCUMENTO).default('admissao'),
  copias: z.number().int().min(1).max(20).default(1),
  especialidade: opcional,
  idadeMinima: z.number().int().min(0).max(150).nullable().default(null),
  idadeMaxima: z.number().int().min(0).max(150).nullable().default(null),
  /** Verdadeiro: vale para todos os estabelecimentos do cliente. */
  todosEstabelecimentos: z.boolean().default(false),
  ativo: z.boolean().default(true),
});
export type EntradaModeloDocumento = z.infer<typeof esquemaModeloDocumento>;

export const esquemaRegraDocumento = z.object({
  id: id.optional(),
  versao: z.number().int().positive().optional(),
  modelo: id,
  /** Ausente: o momento do modelo (sob demanda: admissão). */
  momento: z.enum(MOMENTOS_DOCUMENTO_INTERNACAO).optional(),
  convenio: opcional,
  especialidade: opcional,
  modalidade: opcional,
  obrigatorio: z.boolean().default(false),
  selecionadoPorPadrao: z.boolean().default(true),
  /** Ausente: as cópias do modelo. */
  copias: z.number().int().min(1).max(20).optional(),
  ordem: z.number().int().min(0).max(999).default(0),
  ativo: z.boolean().default(true),
});
export type EntradaRegraDocumento = z.infer<typeof esquemaRegraDocumento>;

export interface ModeloDocumentoLinha extends ModeloDocumentoInternacao {
  readonly codigo: string;
  readonly conteudo: string;
  readonly momento: string;
  readonly copias: number;
  readonly todosEstabelecimentos: boolean;
  readonly versao: number;
}
export interface RegraDocumentoLinha extends RegraDocumentoInternacao {
  readonly versao: number;
}
export interface DocumentoParaEmitir extends DocumentoDaInternacao {
  readonly texto: string;
  readonly sobDemanda: boolean;
}

const n = (v: unknown) => Number(v);
const nulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const sim = (v: unknown) => v === true || v === 1 || v === '1';

/**
 * O texto do modelo para a emissão: o negrito do editor vira `**...**` (o PDF o leva como texto marcado), as quebras
 * e os parágrafos viram linhas, e as demais marcas saem.
 */
export function textoDoModelo(conteudo: string): string {
  return conteudo
    .replace(/<\/?(strong|b)(\s[^>]*)?>/gi, '**')
    .replace(/\*\*(\s*)\*\*/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function invalida(problemas: readonly { campo: string; mensagem: string }[]): never {
  throw new ErroOperacao(
    400,
    'entrada-invalida',
    'Dados inválidos',
    problemas.map((p) => p.mensagem).join(' '),
    {
      campos: problemas.map((p) => p.campo),
    },
  );
}

export class PortaDocumentosInternacao {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoAdt,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ctx(c: ContextoAdt): ContextoNucleo {
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: c.correlacao,
    };
  }

  private est(c: ContextoAdt): number {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return c.estabelecimento;
  }

  private async modelosDe(l: Leitor, est: number): Promise<ModeloDocumentoLinha[]> {
    const linhas = await l.consultar(
      `SELECT id, estabelecimento_id, codigo, titulo, conteudo, momento_impressao, quantidade_copias,
              especialidade_medica_id, idade_minima_anos, idade_maxima_anos, ativo, versao
         FROM modelo_documento_internacao
        WHERE estabelecimento_id = ? OR estabelecimento_id IS NULL
        ORDER BY titulo, id`,
      [est],
    );
    return linhas.map((r) => ({
      id: n(r['id']),
      codigo: String(r['codigo']),
      titulo: String(r['titulo']),
      conteudo: String(r['conteudo'] ?? ''),
      momento: String(r['momento_impressao']),
      copias: n(r['quantidade_copias']),
      especialidade: nulo(r['especialidade_medica_id']),
      idadeMinima: nulo(r['idade_minima_anos']),
      idadeMaxima: nulo(r['idade_maxima_anos']),
      ativo: sim(r['ativo']),
      todosEstabelecimentos: r['estabelecimento_id'] === null,
      versao: n(r['versao']),
    }));
  }

  private async regrasDe(l: Leitor, est: number): Promise<RegraDocumentoLinha[]> {
    const linhas = await l.consultar(
      `SELECT id, modelo_documento_internacao_id, momento, fonte_pagadora_id, especialidade_medica_id,
              modalidade_internacao_id, obrigatorio, selecionado_por_padrao, copias, ordem, ativo, versao
         FROM regra_documento_internacao WHERE estabelecimento_id = ? ORDER BY ordem, id`,
      [est],
    );
    return linhas.map((r) => ({
      id: n(r['id']),
      modelo: n(r['modelo_documento_internacao_id']),
      momento: String(r['momento']) as MomentoDocumentoInternacao,
      convenio: nulo(r['fonte_pagadora_id']),
      especialidade: nulo(r['especialidade_medica_id']),
      modalidade: nulo(r['modalidade_internacao_id']),
      obrigatorio: sim(r['obrigatorio']),
      selecionadoPorPadrao: sim(r['selecionado_por_padrao']),
      copias: n(r['copias']),
      ordem: n(r['ordem']),
      ativo: sim(r['ativo']),
      versao: n(r['versao']),
    }));
  }

  /** Modelos (do estabelecimento e os comuns) e regras do estabelecimento da sessão (a tela de configuração). */
  listar(c: ContextoAdt): Promise<{
    modelos: ModeloDocumentoLinha[];
    regras: RegraDocumentoLinha[];
    modalidades: { codigo: number; nome: string }[];
  }> {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctx(c), async (l) => ({
      modelos: await this.modelosDe(l, est),
      regras: await this.regrasDe(l, est),
      modalidades: (
        await l.consultar(
          'SELECT id, descricao FROM modalidade_internacao WHERE ativo = TRUE ORDER BY descricao',
        )
      ).map((r) => ({ codigo: n(r['id']), nome: String(r['descricao']) })),
    }));
  }

  /** Os documentos que saem para a internação no momento (null: internação não encontrada). */
  documentos(
    c: ContextoAdt,
    reg: number,
    momento: MomentoDocumentoInternacao = 'admissao',
  ): Promise<DocumentoParaEmitir[] | null> {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctx(c), async (l) => {
      const i = await l.uma(
        `SELECT i.fonte_pagadora_id, i.especialidade_medica_id, i.modalidade_internacao_id, i.data_hora_entrada,
                pf.data_nascimento
           FROM internacao i JOIN paciente p ON p.id = i.paciente_id JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE i.id = ? AND i.estabelecimento_id = ? AND i.excluido_em IS NULL`,
        [reg, est],
      );
      if (!i) return null;
      const modelos = await this.modelosDe(l, est);
      const internacao = {
        convenio: n(i['fonte_pagadora_id']),
        especialidade: n(i['especialidade_medica_id']),
        modalidade: n(i['modalidade_internacao_id']),
        idade: idadeEm((i['data_nascimento'] as Date | null) ?? null, i['data_hora_entrada'] as Date),
      };
      const pelaRegra = documentosDaInternacao(momento, internacao, modelos, await this.regrasDe(l, est));
      const docs = [...pelaRegra, ...modelosSobDemanda(internacao, modelos, pelaRegra)];
      const conteudo = new Map(modelos.map((m) => [m.id, m.conteudo]));
      return docs.map((d) => ({
        ...d,
        sobDemanda: d.sobDemanda === true,
        texto: textoDoModelo(conteudo.get(d.modelo) ?? ''),
      }));
    });
  }

  private async gravar<T extends Record<string, number | string | boolean | null>>(
    c: ContextoAdt,
    nome: string,
    tabela: string,
    fn: (tx: TxOperacao, est: number) => Promise<T & { id: number }>,
  ): Promise<T & { id: number }> {
    const est = this.est(c);
    const op = definirOperacao({
      nome,
      tabelas: [tabela],
      entrada: z.object({ chave: z.string() }),
      gravar: (tx) => fn(tx, est),
      alvo: (_e, r) => ({ tabela, id: r.id }),
    });
    const chave = (c as { idempotencia?: string }).idempotencia || `${nome}:${randomUUID()}`;
    const r = await this.executor.executar(
      op,
      c.cliente,
      { chave },
      {
        ...this.ctx(c),
        correlacao: c.correlacao || 'documentos-internacao',
        chaveIdempotencia: chave.slice(0, 120),
      },
    );
    return r.resultado as T & { id: number };
  }

  /**
   * Inclui ou altera o modelo (a alteração confere a versão lida). `modeloComum`: a sessão é da administração da
   * plataforma, a única que inclui ou altera o modelo comum a todos os estabelecimentos.
   */
  async salvarModelo(c: ContextoAdt, e: EntradaModeloDocumento, modeloComum = false) {
    const p = validarModeloDocumento({
      codigo: e.codigo,
      titulo: e.titulo,
      conteudo: e.conteudo,
      idadeMinima: e.idadeMinima,
      idadeMaxima: e.idadeMaxima,
      copias: e.copias,
    });
    if (p.length) invalida(p);
    return this.gravar(
      c,
      'internacao.documento.salvar_modelo',
      'modelo_documento_internacao',
      async (tx, est) => {
        const valores = {
          estabelecimento_id: e.todosEstabelecimentos ? null : est,
          codigo: e.codigo,
          titulo: e.titulo,
          conteudo: e.conteudo,
          formato: /<[a-z][^>]*>/i.test(e.conteudo) ? 'html' : 'texto',
          momento_impressao: e.momento,
          quantidade_copias: e.copias,
          especialidade_medica_id: e.especialidade,
          idade_minima_anos: e.idadeMinima,
          idade_maxima_anos: e.idadeMaxima,
          ativo: e.ativo,
        };
        const dono = e.todosEstabelecimentos ? null : est;
        if (dono === null && !modeloComum)
          throw recusa(
            'modelo-comum',
            'O modelo comum a todos os estabelecimentos só é incluído ou alterado pela administração da plataforma: crie um modelo deste estabelecimento.',
          );
        const igual = await tx.uma<{ id: number }>(
          'SELECT id FROM modelo_documento_internacao WHERE codigo = ? AND estabelecimento_id <=> ? AND id <> ?',
          [e.codigo, dono, e.id ?? 0],
        );
        if (igual) throw recusa('codigo-repetido', 'Já existe um modelo com este código.');
        if (e.id === undefined)
          return { id: await tx.incluir('modelo_documento_internacao', valores), versao: 1 };
        const atual = await tx.uma<{ estabelecimento_id: number | null }>(
          'SELECT estabelecimento_id FROM modelo_documento_internacao WHERE id = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)',
          [e.id, est],
        );
        if (!atual) throw recusa('nao-encontrado', 'O modelo não existe mais.');
        const donoAtual = atual.estabelecimento_id === null ? null : Number(atual.estabelecimento_id);
        // O dono do modelo não muda numa alteração: nem o comum vira de um estabelecimento (as regras dos outros
        // deixariam de achá-lo), nem o do estabelecimento vira comum por fora da administração.
        if (donoAtual !== dono)
          throw recusa(
            'troca-de-dono',
            'Um modelo não troca de estabelecimento: crie um modelo novo para o outro alcance.',
          );
        const versao = await tx.alterar('modelo_documento_internacao', e.id, e.versao ?? 0, valores);
        return { id: e.id, versao };
      },
    );
  }

  /** Inclui ou altera a regra; a mesma combinação já existente é recusada (sem duplicar o documento). */
  async salvarRegra(c: ContextoAdt, e: EntradaRegraDocumento) {
    const p = validarRegraDocumento({ momento: e.momento ?? 'admissao', copias: e.copias ?? 1 });
    if (p.length) invalida(p);
    return this.gravar(
      c,
      'internacao.documento.salvar_regra',
      'regra_documento_internacao',
      async (tx, est) => {
        const modelo = await tx.uma<{ ativo: number; momento_impressao: string; quantidade_copias: number }>(
          'SELECT ativo, momento_impressao, quantidade_copias FROM modelo_documento_internacao WHERE id = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)',
          [e.modelo, est],
        );
        if (!modelo)
          throw recusa('modelo-inexistente', 'Escolha um modelo de documento deste estabelecimento.');
        if (!sim(modelo.ativo) && e.ativo)
          throw recusa('modelo-inativo', 'O modelo está fora de uso: reative-o antes.');
        const momento = e.momento ?? momentoPadraoDaRegra(modelo.momento_impressao);
        const copias = e.copias ?? Number(modelo.quantidade_copias);
        const repetida = await tx.uma<{ id: number }>(
          `SELECT id FROM regra_documento_internacao
          WHERE estabelecimento_id = ? AND modelo_documento_internacao_id = ? AND momento = ?
            AND fonte_pagadora_id <=> ? AND especialidade_medica_id <=> ? AND modalidade_internacao_id <=> ? AND id <> ?`,
          [est, e.modelo, momento, e.convenio, e.especialidade, e.modalidade, e.id ?? 0],
        );
        if (repetida)
          throw recusa(
            'regra-repetida',
            'Já existe uma regra deste documento para o mesmo convênio, especialidade e modalidade.',
          );
        const valores = {
          estabelecimento_id: est,
          modelo_documento_internacao_id: e.modelo,
          momento,
          fonte_pagadora_id: e.convenio,
          especialidade_medica_id: e.especialidade,
          modalidade_internacao_id: e.modalidade,
          obrigatorio: e.obrigatorio,
          selecionado_por_padrao: e.selecionadoPorPadrao,
          copias,
          ordem: e.ordem,
          ativo: e.ativo,
        };
        if (e.id === undefined)
          return { id: await tx.incluir('regra_documento_internacao', valores), versao: 1 };
        const atual = await tx.uma<{ id: number }>(
          'SELECT id FROM regra_documento_internacao WHERE id = ? AND estabelecimento_id = ?',
          [e.id, est],
        );
        if (!atual) throw recusa('nao-encontrado', 'A regra não existe mais.');
        const versao = await tx.alterar('regra_documento_internacao', e.id, e.versao ?? 0, valores);
        return { id: e.id, versao };
      },
    );
  }
}
