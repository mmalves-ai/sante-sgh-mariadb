// Operações de gravação da descrição cirúrgica e das intercorrências do ato (04-CC linha 96; F3.4, fatia F3.4-4), pelo
// Executor do @sgh/nucleo: a trilha e a idempotência vão na mesma transação. As regras são as do
// @sgh/dominio-cirurgia (descricao), aplicadas aos dados relidos sob a transação (ato do estabelecimento, equipe do
// ato, descrição travada com FOR UPDATE, tipo de intercorrência).
// Melhoria: salvar e assinar num gesto só; a descrição assinada nunca é alterada (o adendo leva o complemento com
// motivo e a descrição passa a "retificada"); achado retirado do rascunho fica marcado como excluído, nunca apagado.
import {
  conferirAdendoDescricao,
  conferirAutorDaDescricao,
  conferirGravacaoDescricao,
  conferirIntercorrencia,
  type DescricaoAtual,
  ErroDescricaoCirurgica,
  FASES_INTERCORRENCIA,
  funcaoDescreveCirurgia,
  GRAVIDADES_INTERCORRENCIA,
  type MembroEquipeDescricao,
  type SituacaoDescricao,
} from '@sgh/dominio-cirurgia';
import { definirOperacao, type Operacao, recusa, type ResultadoOperacao, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import { FUSO_PADRAO, instante, n, nn, texto, textoOuNulo } from './banco-apoio.js';

type Linha = Record<string, unknown>;

/** A regra do domínio aplicada sob a transação: a recusa dele vira a recusa do núcleo (409 com o código). */
function regra<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ErroDescricaoCirurgica)
      throw recusa(e.recusa.codigo, e.recusa.mensagem, e.recusa.campos ? { campos: e.recusa.campos } : {});
    throw e;
  }
}
const textoOpcional = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null));
const id = z.number().int().positive();

export const esquemaSalvarDescricao = z.object({
  ato: id,
  versao: z.number().int().positive().nullable(),
  assinar: z.boolean().default(false),
  descricaoTecnica: textoOpcional(60000),
  achadosTexto: textoOpcional(20000),
  riscoCirurgico: textoOpcional(5000),
  acidentes: textoOpcional(5000),
  orteseProtese: textoOpcional(5000),
  atoAnestesico: textoOpcional(5000),
  sangramentoMl: z.number().int().nullable().default(null),
  envioAnatomopatologico: z.boolean().default(false),
  descricaoPecas: textoOpcional(500),
  achados: z
    .array(z.object({ achado: id, complemento: textoOpcional(5000) }))
    .max(50)
    .default([]),
});
export type SalvarDescricaoEntrada = z.infer<typeof esquemaSalvarDescricao>;

export const esquemaAdendoDescricao = z.object({
  descricao: id,
  texto: z.string().trim().min(1).max(20000),
  motivo: z.string().trim().min(1).max(500),
});
export type AdendoDescricaoEntrada = z.infer<typeof esquemaAdendoDescricao>;

/** Horário civil "AAAA-MM-DD HH:MM" no fuso do estabelecimento. */
const HORARIO = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/;
export const esquemaIntercorrencia = z.object({
  ato: id,
  tipo: id,
  ocorridoEm: z.string().regex(HORARIO),
  fase: z.enum(FASES_INTERCORRENCIA),
  gravidade: z.enum(GRAVIDADES_INTERCORRENCIA),
  descricao: textoOpcional(5000),
  conduta: textoOpcional(5000),
});
export type IntercorrenciaEntrada = z.infer<typeof esquemaIntercorrencia>;

const est = (tx: TxOperacao) => {
  const e = tx.contexto.estabelecimento;
  if (e === null || e === undefined)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return Number(e);
};

/** O profissional vinculado à conta da sessão neste estabelecimento (vigente), ou null. */
export async function profissionalDaConta(tx: TxOperacao, estabelecimento: number): Promise<number | null> {
  const v = await tx.uma(
    `SELECT v.profissional_id FROM usuario_vinculo_profissional v
       JOIN profissional p ON p.id = v.profissional_id AND p.excluido_em IS NULL
      WHERE v.usuario_id = ? AND v.estabelecimento_id = ? AND v.excluido_em IS NULL
        AND v.vigencia_inicio <= CURRENT_DATE AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
      ORDER BY v.vigencia_inicio DESC, v.id DESC LIMIT 1`,
    [n(tx.contexto.usuario), estabelecimento],
  );
  return nn(v?.['profissional_id']);
}

/** O ato do estabelecimento, travado, com a janela e a equipe; recusa o cancelado e o de outro estabelecimento. */
async function atoTravado(tx: TxOperacao, ato: number) {
  const e = est(tx);
  const a = await tx.uma(
    `SELECT id, situacao, entrada_sala_em, saida_sala_em FROM ato_cirurgico
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL FOR UPDATE`,
    [ato, e],
  );
  if (!a || texto(a['situacao']) === 'cancelado')
    throw recusa('registro-inexistente', 'O ato cirúrgico não existe neste estabelecimento.');
  // A equipe viva do ato (o participante retirado, com excluido_em, não é mais autor) com a função de cada um.
  const equipe = await tx.consultar(
    `SELECT pc.profissional_id, f.funcao_medica, f.grau_participacao_tiss
       FROM participante_cirurgia pc
       JOIN funcao_equipe_cirurgica f ON f.id = pc.funcao_equipe_cirurgica_id
      WHERE pc.ato_cirurgico_id = ? AND pc.excluido_em IS NULL`,
    [ato],
  );
  const data = (v: unknown) =>
    v instanceof Date ? v : v ? new Date(String(v).replace(' ', 'T') + 'Z') : null;
  return {
    est: e,
    entrada: data(a['entrada_sala_em']),
    saida: data(a['saida_sala_em']),
    equipe: equipe.map((l): MembroEquipeDescricao => {
      const medica = l['funcao_medica'] === true || n(l['funcao_medica']) === 1;
      return {
        profissional: n(l['profissional_id']),
        funcaoMedica: medica,
        cirurgica: funcaoDescreveCirurgia(textoOuNulo(l['grau_participacao_tiss']), medica),
      };
    }),
  };
}

const atual = (l: Linha | null): DescricaoAtual | null =>
  l
    ? {
        situacao: texto(l['situacao']) as SituacaoDescricao,
        cirurgiao: n(l['cirurgiao_profissional_id']),
        versao: n(l['versao']),
      }
    : null;

async function gravarAchados(tx: TxOperacao, descricao: number, itens: SalvarDescricaoEntrada['achados']) {
  const existentes = await tx.consultarParaAtualizar(
    'SELECT id, achado_cirurgico_padrao_id, versao, excluido_em FROM descricao_cirurgica_achado WHERE descricao_cirurgica_id = ?',
    [descricao],
  );
  const porAchado = new Map(existentes.map((l) => [n(l['achado_cirurgico_padrao_id']), l]));
  const maior = await tx.uma<{ s: number | null }>(
    'SELECT MAX(sequencia) AS s FROM descricao_cirurgica_achado WHERE descricao_cirurgica_id = ?',
    [descricao],
  );
  let seq = n(maior?.s);
  for (const it of itens) {
    const cat = await tx.uma('SELECT id FROM achado_cirurgico_padrao WHERE id = ? AND ativo = TRUE', [
      it.achado,
    ]);
    if (!cat) throw recusa('achado-inexistente', 'Um dos achados escolhidos não existe ou está inativo.');
    const ex = porAchado.get(it.achado);
    if (ex)
      await tx.alterar('descricao_cirurgica_achado', n(ex['id']), n(ex['versao']), {
        complemento: it.complemento,
        excluido_em: null,
        excluido_por: null,
      });
    else
      await tx.incluir('descricao_cirurgica_achado', {
        descricao_cirurgica_id: descricao,
        sequencia: ++seq,
        achado_cirurgico_padrao_id: it.achado,
        complemento: it.complemento,
      });
  }
  const escolhidos = new Set(itens.map((i) => i.achado));
  for (const l of existentes)
    if (!escolhidos.has(n(l['achado_cirurgico_padrao_id'])) && l['excluido_em'] === null)
      await tx.alterar('descricao_cirurgica_achado', n(l['id']), n(l['versao']), {
        excluido_em: new Date(),
        excluido_por: n(tx.contexto.usuario),
      });
}

export const TABELAS_DESCRICAO = ['descricao_cirurgica', 'descricao_cirurgica_achado'] as const;

const salvar = definirOperacao<SalvarDescricaoEntrada, ResultadoOperacao>({
  nome: 'cirurgia.salvar-descricao',
  tabelas: [...TABELAS_DESCRICAO],
  entrada: esquemaSalvarDescricao as never,
  async gravar(tx, e) {
    const ato = await atoTravado(tx, e.ato);
    const conta = await profissionalDaConta(tx, ato.est);
    const prof = regra(() => conferirAutorDaDescricao(conta, ato.equipe));
    const linha = await tx.uma(
      'SELECT * FROM descricao_cirurgica WHERE ato_cirurgico_id = ? AND cirurgiao_profissional_id = ? FOR UPDATE',
      [e.ato, prof],
    );
    regra(() =>
      conferirGravacaoDescricao(
        atual(linha),
        { profissional: prof, versao: e.versao, assinar: e.assinar },
        {
          descricaoTecnica: e.descricaoTecnica,
          envioAnatomopatologico: e.envioAnatomopatologico,
          descricaoPecas: e.descricaoPecas,
          sangramentoMl: e.sangramentoMl,
          achados: e.achados,
        },
      ),
    );
    const agora = new Date();
    const usuario = n(tx.contexto.usuario);
    const valores = {
      descricao_tecnica: e.descricaoTecnica,
      achados: e.achadosTexto,
      risco_cirurgico: e.riscoCirurgico,
      acidentes_intraoperatorios: e.acidentes,
      ortese_protese: e.orteseProtese,
      ato_anestesico: e.atoAnestesico,
      sangramento_estimado_ml: e.sangramentoMl,
      envio_anatomopatologico: e.envioAnatomopatologico,
      descricao_pecas: e.envioAnatomopatologico ? e.descricaoPecas : null,
      ...(e.assinar
        ? {
            situacao: 'assinada',
            concluida_em: agora,
            concluido_por_usuario_id: usuario,
            assinada_em: agora,
            assinado_por_usuario_id: usuario,
          }
        : { situacao: 'rascunho' }),
    };
    let id: number;
    if (linha) {
      id = n(linha['id']);
      await tx.alterar('descricao_cirurgica', id, n(linha['versao']), valores);
    } else
      id = await tx.incluir('descricao_cirurgica', {
        ...valores,
        ato_cirurgico_id: e.ato,
        cirurgiao_profissional_id: prof,
      });
    await gravarAchados(tx, id, e.achados);
    return { descricao: id, situacao: e.assinar ? 'assinada' : 'rascunho' } as ResultadoOperacao;
  },
  alvo: (_e, r) => ({ tabela: 'descricao_cirurgica', id: n((r as Linha)['descricao']) }),
  trilha: (e) => ({ dados: { ato: e.ato, assinada: e.assinar, achados: e.achados.length }, motivo: null }),
});

const adendo = definirOperacao<AdendoDescricaoEntrada, ResultadoOperacao>({
  nome: 'cirurgia.adendo-descricao',
  tabelas: ['descricao_cirurgica', 'descricao_cirurgica_adendo'],
  entrada: esquemaAdendoDescricao as never,
  async gravar(tx, e) {
    const linha = await tx.uma(
      `SELECT d.* FROM descricao_cirurgica d JOIN ato_cirurgico a ON a.id = d.ato_cirurgico_id
        WHERE d.id = ? AND a.estabelecimento_id = ? AND d.excluido_em IS NULL FOR UPDATE`,
      [e.descricao, est(tx)],
    );
    const conta = await profissionalDaConta(tx, est(tx));
    regra(() => conferirAdendoDescricao(atual(linha), conta, e));
    const d = linha!;
    const s = await tx.uma<{ s: number | null }>(
      'SELECT MAX(sequencia) AS s FROM descricao_cirurgica_adendo WHERE descricao_cirurgica_id = ?',
      [e.descricao],
    );
    const id = await tx.incluir('descricao_cirurgica_adendo', {
      descricao_cirurgica_id: e.descricao,
      sequencia: n(s?.s) + 1,
      texto: e.texto,
      motivo: e.motivo,
      registrado_em: new Date(),
      usuario_id: n(tx.contexto.usuario),
    });
    if (texto(d['situacao']) === 'assinada')
      await tx.alterar('descricao_cirurgica', e.descricao, n(d['versao']), { situacao: 'retificada' });
    return { adendo: id, descricao: e.descricao } as ResultadoOperacao;
  },
  alvo: (_e, r) => ({ tabela: 'descricao_cirurgica_adendo', id: n((r as Linha)['adendo']) }),
  trilha: (e) => ({ dados: { descricao: e.descricao }, motivo: e.motivo.slice(0, 500) }),
});

const intercorrencia = definirOperacao<IntercorrenciaEntrada, ResultadoOperacao>({
  nome: 'cirurgia.registrar-intercorrencia',
  tabelas: ['intercorrencia_cirurgica'],
  entrada: esquemaIntercorrencia as never,
  async gravar(tx, e) {
    const ato = await atoTravado(tx, e.ato);
    const prof = await profissionalDaConta(tx, ato.est);
    if (prof === null)
      throw recusa('sem-profissional', 'A sua conta não tem vínculo de profissional neste estabelecimento.');
    const t = await tx.uma(
      'SELECT ativo, exige_conduta, evento_adverso FROM tipo_intercorrencia_cirurgica WHERE id = ?',
      [e.tipo],
    );
    const f = await tx.uma<{ fuso_horario: string | null }>(
      'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
      [ato.est],
    );
    const ocorridoEm = instante(e.ocorridoEm, f?.fuso_horario || FUSO_PADRAO);
    const r = regra(() =>
      conferirIntercorrencia(
        { ocorridoEm, gravidade: e.gravidade, descricao: e.descricao, conduta: e.conduta },
        t
          ? {
              ativo: t['ativo'] === true || n(t['ativo']) === 1,
              exigeConduta: t['exige_conduta'] === true || n(t['exige_conduta']) === 1,
              eventoAdverso: t['evento_adverso'] === true || n(t['evento_adverso']) === 1,
            }
          : null,
        { entrada: ato.entrada, saida: ato.saida },
        new Date(),
      ),
    );
    const s = await tx.uma<{ s: number | null }>(
      'SELECT MAX(sequencia) AS s FROM intercorrencia_cirurgica WHERE ato_cirurgico_id = ?',
      [e.ato],
    );
    const id = await tx.incluir('intercorrencia_cirurgica', {
      ato_cirurgico_id: e.ato,
      sequencia: n(s?.s) + 1,
      tipo_intercorrencia_cirurgica_id: e.tipo,
      ocorrido_em: ocorridoEm,
      fase: e.fase,
      gravidade: e.gravidade,
      descricao: e.descricao,
      conduta: e.conduta,
      registrado_por_profissional_id: prof,
    });
    return { intercorrencia: id, pedeNotificacao: r.pedeNotificacao } as ResultadoOperacao;
  },
  alvo: (_e, r) => ({ tabela: 'intercorrencia_cirurgica', id: n((r as Linha)['intercorrencia']) }),
  trilha: (e) => ({ dados: { ato: e.ato, gravidade: e.gravidade, fase: e.fase }, motivo: null }),
});

export const OPERACOES_DESCRICAO: Readonly<Record<string, Operacao<never, ResultadoOperacao>>> = {
  'cirurgia.salvarDescricao': salvar as Operacao<never, ResultadoOperacao>,
  'cirurgia.adendoDescricao': adendo as Operacao<never, ResultadoOperacao>,
  'cirurgia.registrarIntercorrencia': intercorrencia as Operacao<never, ResultadoOperacao>,
};
