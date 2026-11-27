// Exportação dos profissionais para o cadastro nacional de estabelecimentos (C3-011, item 3), pela porta própria.
// Lê as lotações vigentes na competência (ocupação, vínculo do cadastro nacional, carga horária e conselho), monta o
// arquivo pelo domínio (montarExportacaoProfissionaisCnes), guarda o arquivo pela porta de armazenamento de arquivos
// (imutável, guarda legal de 5 anos no registro `arquivo`) e grava a remessa_cnes tipo 'exportacao', situação
// 'exportada', com exportada_em e arquivo_id, na mesma transação. O arquivo guardado só é fixado depois do COMMIT; se a
// transação falhar, ele é removido (nada fica órfão).
import { createHash, randomUUID } from 'node:crypto';
import {
  AVISO_LEIAUTE_EXPORTACAO_CNES,
  LEIAUTE_EXPORTACAO_CNES,
  diasDaCompetenciaSus,
  montarExportacaoProfissionaisCnes,
  type PendenciaExportacaoCnes,
} from '@sgh/dominio-faturamento';
import { z } from 'zod';
import {
  PortaEstabelecimentoPropria,
  entradaValida,
  naoEncontrado,
  num,
  recusaRegra,
  txtOuNull,
  type ContextoPortaPropria,
} from '../../porta-estabelecimento-propria.js';
import { registrarArquivoGuardado, retencaoAte } from '../tiss/armazem-xml.js';
import type { ArmazemArquivoSus } from './servico.js';

export const PORTA_EXPORTACAO_CNES = Symbol('PORTA_EXPORTACAO_CNES');

const TABELAS = ['remessa_cnes', 'arquivo'] as const;
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v);

export interface ExportacaoCnesLida {
  readonly id: number;
  readonly competencia: string;
  readonly numeroRemessa: number;
  readonly situacao: string;
  readonly exportadaEm: string | null;
  readonly arquivoId: number | null;
  readonly nomeArquivo: string | null;
  readonly observacao: string | null;
}

export interface ResultadoExportacaoCnesApi {
  readonly id: number;
  readonly arquivoId: number;
  readonly nomeArquivo: string;
  readonly exportados: number;
  readonly pendencias: readonly PendenciaExportacaoCnes[];
  readonly leiaute: { readonly versao: string; readonly aviso: string };
}

export class PortaExportacaoCnesPropria extends PortaEstabelecimentoPropria {
  constructor(
    nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0],
    cliente: string,
    private readonly armazem: ArmazemArquivoSus,
  ) {
    super(nucleo, cliente, TABELAS, 'faturamento.susCnesExportacao');
  }

  /** As exportações do estabelecimento (as 24 mais recentes). */
  exportacoes(c: ContextoPortaPropria): Promise<ExportacaoCnesLida[]> {
    return this.ler(c, 'exportacoes', async (l, est) => {
      const r = await l.consultar(
        `SELECT r.id, r.competencia, r.numero_remessa, r.situacao, r.exportada_em, r.arquivo_id, r.observacao,
                a.nome_original
           FROM remessa_cnes r LEFT JOIN arquivo a ON a.id = r.arquivo_id
          WHERE r.estabelecimento_id = ? AND r.tipo = 'exportacao' AND r.excluido_em IS NULL
          ORDER BY r.competencia DESC, r.numero_remessa DESC LIMIT 24`,
        [est.id],
      );
      return r.map((x) => ({
        id: num(x['id']),
        competencia: (iso(x['competencia']) ?? '').slice(0, 7).replace('-', ''),
        numeroRemessa: num(x['numero_remessa']),
        situacao: txt(x['situacao']),
        exportadaEm: iso(x['exportada_em']),
        arquivoId: x['arquivo_id'] === null ? null : num(x['arquivo_id']),
        nomeArquivo: txtOuNull(x['nome_original']),
        observacao: txtOuNull(x['observacao']),
      }));
    });
  }

  /** O conteúdo do arquivo de uma exportação do estabelecimento (para baixar e importar no cadastro nacional). */
  arquivo(c: ContextoPortaPropria, remessa: number): Promise<{ nomeArquivo: string; conteudo: string }> {
    return this.ler(c, 'arquivo', async (l, est) => {
      const a = await l.uma(
        `SELECT a.chave_armazenamento, a.nome_original FROM remessa_cnes r JOIN arquivo a ON a.id = r.arquivo_id
          WHERE r.id = ? AND r.estabelecimento_id = ? AND r.tipo = 'exportacao' AND r.excluido_em IS NULL`,
        [remessa, est.id],
      );
      if (!a) throw naoEncontrado('Exportação');
      const bytes = await this.armazem.ler(txt(a['chave_armazenamento']));
      if (!bytes) throw naoEncontrado('Arquivo da exportação');
      return { nomeArquivo: txt(a['nome_original']), conteudo: Buffer.from(bytes).toString('utf8') };
    });
  }

  /** Gera o arquivo dos profissionais da competência (AAAAMM), guarda e grava a remessa exportada. */
  async exportar(c: ContextoPortaPropria, entrada: unknown): Promise<ResultadoExportacaoCnesApi> {
    const e = entradaValida(z.object({ competencia: z.string().regex(/^\d{6}$/) }).strict(), entrada);
    const dias = diasDaCompetenciaSus(e.competencia);
    if (!dias)
      throw recusaRegra('Exportação recusada', [{ campo: 'competencia', mensagem: 'Competência inválida.' }]);
    const lido = await this.ler(c, 'profissionais-cnes', async (l, est) => {
      const ident = await l.uma('SELECT codigo_cnes, cnpj FROM estabelecimento WHERE id = ?', [est.id]);
      const lot = await l.consultar(
        `SELECT pf.nome, pf.cpf, pf.cns, oc.codigo_cbo, tv.codigo_vinculo, tv.codigo_tipo, tv.codigo_subtipo,
                lp.carga_horaria_ambulatorial, lp.carga_horaria_hospitalar, lp.carga_horaria_outros, lp.atende_sus,
                cc.sigla AS conselho, uf.sigla AS uf, ic.numero_inscricao
           FROM lotacao_profissional lp
           JOIN profissional p ON p.id = lp.profissional_id AND p.excluido_em IS NULL AND p.situacao = 'ativo'
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           JOIN ocupacao_cbo oc ON oc.id = lp.ocupacao_cbo_id
           LEFT JOIN tipo_vinculo_trabalho tv ON tv.id = lp.tipo_vinculo_trabalho_id
           LEFT JOIN inscricao_conselho ic ON ic.id = lp.inscricao_conselho_id AND ic.excluido_em IS NULL
           LEFT JOIN conselho_classe cc ON cc.id = ic.conselho_classe_id
           LEFT JOIN unidade_federativa uf ON uf.id = ic.unidade_federativa_id
          WHERE lp.estabelecimento_id = ? AND lp.excluido_em IS NULL AND lp.ativo
            AND lp.vigencia_inicio <= ? AND (lp.vigencia_fim IS NULL OR lp.vigencia_fim >= ?)
          ORDER BY pf.nome, lp.id LIMIT 20000`,
        [est.id, dias.fim, dias.inicio],
      );
      return { ident, lot };
    });
    const r = montarExportacaoProfissionaisCnes({
      codigoCnes: txtOuNull(lido.ident?.['codigo_cnes']),
      cnpj: txtOuNull(lido.ident?.['cnpj']),
      competencia: e.competencia,
      profissionais: lido.lot.map((x) => ({
        nome: txt(x['nome']),
        cpf: txtOuNull(x['cpf']),
        cns: txtOuNull(x['cns']),
        cbo: txtOuNull(x['codigo_cbo']),
        vinculo:
          x['codigo_vinculo'] === null || x['codigo_vinculo'] === undefined
            ? null
            : {
                vinculo: txt(x['codigo_vinculo']),
                tipo: txt(x['codigo_tipo']),
                subtipo: txt(x['codigo_subtipo']),
              },
        cargaAmbulatorial: num(x['carga_horaria_ambulatorial']),
        cargaHospitalar: num(x['carga_horaria_hospitalar']),
        cargaOutros: num(x['carga_horaria_outros']),
        conselho: x['conselho']
          ? { sigla: txt(x['conselho']), uf: txt(x['uf']), numero: txt(x['numero_inscricao']) }
          : null,
        atendeSus: x['atende_sus'] === true || x['atende_sus'] === 1 || x['atende_sus'] === '1',
      })),
    });
    if (!r.ok)
      throw recusaRegra('Exportação recusada', [
        { campo: 'competencia', mensagem: r.motivo },
        ...r.pendencias.slice(0, 20).map((p) => ({
          campo: `profissional.${p.sequencia}`,
          mensagem: p.motivos.join(' '),
        })),
      ]);
    const bytes = Buffer.from(r.xml, 'utf8');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const chave = `cnes/exportacao/${e.competencia}/${randomUUID()}-${r.nomeArquivo}`;
    const { versao } = await this.armazem.guardar(chave, new Uint8Array(bytes));
    try {
      const feito = await this.gravar(
        c,
        'faturamento.sus.cnes.exportar',
        TABELAS,
        async (tx, est, usuario) => {
          const agora = new Date();
          const arq = await registrarArquivoGuardado(tx, {
            estabelecimento: est.id,
            entidade: 'remessa_cnes',
            finalidade: 'exportacao_cadastro_nacional',
            nomeOriginal: r.nomeArquivo,
            tipoMime: 'application/xml',
            tamanhoBytes: bytes.length,
            hash,
            chave,
            retencaoAte: retencaoAte(agora),
          });
          const ult = await tx.uma(
            `SELECT COALESCE(MAX(numero_remessa), 0) AS n FROM remessa_cnes
            WHERE estabelecimento_id = ? AND competencia = ? AND tipo = 'exportacao'`,
            [est.id, dias.inicio],
          );
          const id = await tx.incluir('remessa_cnes', {
            estabelecimento_id: est.id,
            competencia: dias.inicio,
            numero_remessa: num(ult?.['n']) + 1,
            tipo: 'exportacao',
            situacao: 'exportada',
            gerada_em: agora,
            exportada_em: agora,
            responsavel_usuario_id: usuario,
            arquivo_id: arq.id,
            quantidade_criticas: r.pendencias.length,
            observacao: `${r.exportados} lotação(ões) exportada(s); ${r.pendencias.length} com pendência; leiaute ${LEIAUTE_EXPORTACAO_CNES.versao}.`,
          });
          await tx.alterar('arquivo', arq.id, 1, { entidade_id: id });
          return { tabela: 'remessa_cnes', id, arquivoId: arq.id };
        },
      );
      await this.armazem.fixar(chave, versao);
      return {
        id: feito.id as number,
        arquivoId: feito.arquivoId,
        nomeArquivo: r.nomeArquivo,
        exportados: r.exportados,
        pendencias: r.pendencias,
        leiaute: { versao: LEIAUTE_EXPORTACAO_CNES.versao, aviso: AVISO_LEIAUTE_EXPORTACAO_CNES },
      };
    } catch (erro) {
      await this.armazem.remover(chave, versao).catch(() => undefined);
      throw erro;
    }
  }
}
