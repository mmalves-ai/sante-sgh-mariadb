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
  notificacaoDaIntercorrencia,
  type SituacaoDescricao,
} from '@sgh/dominio-cirurgia';
import { definirOperacao, type Operacao, recusa, type ResultadoOperacao, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import { formatarProtocolo } from '@sgh/dominio-qualidade';
import { relogioDoEstabelecimento } from '../qualidade/apoio-propria.js';
import { gravarNotificacaoIncidente, TABELAS_NOTIFICACAO } from '../qualidade/porta-propria.js';
import { codigoAcompanhamento, resumoDaChave, resumoSha256 } from '../qualidade/servico.js';
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
  const [a] = await tx.consultarParaAtualizar(
    `SELECT id, situacao, entrada_sala_em, saida_sala_em FROM ato_cirurgico
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [ato, e],
    { teto: 1 },
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

/**
 * O tipo de documento que a fila ICP do autor reconhece para o registro cirúrgico. Todo cliente o recebe pela migração
 * 08_CC/94_descricao_tipo_documento (com a categoria registro cirúrgico); a política de assinatura do estabelecimento
 * decide se ele vai à fila com certificado (regra do tipo com nível icp-brasil).
 */
export const CODIGO_TIPO_REGISTRO_CIRURGICO = 'registro-clinico';

/** O documento do prontuário que representa um registro do ato (a descrição ou o adendo). */
interface DocumentoDoAto {
  readonly origem: 'descricao_cirurgica' | 'descricao_cirurgica_adendo';
  readonly origemId: number;
  readonly ato: number;
  readonly prof: number;
  readonly titulo: string;
  readonly conteudo: Readonly<Record<string, unknown>>;
}

/**
 * Grava no prontuário (linha do tempo do paciente) o documento do cirurgião ligado à origem: é por ele que o cirurgião
 * com certificado ICP-Brasil assina na fila de assinaturas (CFM 1.821/2007 e 2.299/2021, SBIS NGS2); sem certificado,
 * vale a assinatura eletrônica avançada com a senha conferida de novo (Lei 14.063/2020). A descrição e cada adendo têm
 * o seu documento, com o mesmo tipo e o mesmo nível de assinatura. O tipo é o do código que a fila ICP conhece (a
 * migração o garante); na falta dele (cadastro alterado pelo cliente), o da categoria registro cirúrgico, que entra
 * na linha do tempo mas não na fila. Sem tipo nem situação "lançado", fica só a eletrônica (devolve null).
 */
async function documentoNoProntuario(tx: TxOperacao, d: DocumentoDoAto): Promise<number | null> {
  const tipo = await tx.uma(
    `SELECT id FROM tipo_documento_clinico
      WHERE ativo = TRUE AND (codigo = ? OR categoria = 'registro_cirurgico')
      ORDER BY (codigo = ?) DESC, (ordem IS NULL), ordem, id LIMIT 1`,
    [CODIGO_TIPO_REGISTRO_CIRURGICO, CODIGO_TIPO_REGISTRO_CIRURGICO],
  );
  const situacao = await tx.uma(
    `SELECT id FROM situacao_documento_prontuario WHERE categoria = 'lancado' AND ativo = TRUE
      ORDER BY (ordem IS NULL), ordem, id LIMIT 1`,
  );
  if (!tipo || !situacao) return null;
  const a = await tx.uma(
    'SELECT paciente_id, atendimento_id, inicio_cirurgia_em, entrada_sala_em FROM ato_cirurgico WHERE id = ?',
    [d.ato],
  );
  if (!a) return null;
  const [ja] = await tx.consultar(
    `SELECT id FROM documento_prontuario
      WHERE entidade_origem = ? AND entidade_origem_id = ? AND numero_versao = 1`,
    [d.origem, d.origemId],
  );
  if (ja) return n(ja['id']);
  const agora = new Date();
  const documento = await tx.incluir('documento_prontuario', {
    estabelecimento_id: est(tx),
    paciente_id: n(a['paciente_id']),
    atendimento_id: a['atendimento_id'] === null ? null : n(a['atendimento_id']),
    tipo_documento_clinico_id: n(tipo['id']),
    situacao_documento_prontuario_id: n(situacao['id']),
    entidade_origem: d.origem,
    entidade_origem_id: d.origemId,
    titulo: d.titulo,
    profissional_id: d.prof,
    // O adendo entra na linha do tempo quando é registrado; a descrição, no momento do ato.
    referencia_em:
      d.origem === 'descricao_cirurgica' ? (a['inicio_cirurgia_em'] ?? a['entrada_sala_em'] ?? agora) : agora,
    lancado_em: agora,
    fechado_em: agora,
    numero_versao: 1,
    confidencial: false,
    conteudo: JSON.stringify({
      ...d.conteudo,
      assinatura_eletronica: { nivel: 'eletronica-avancada', reautenticacao: true },
    }),
    origem: 'sistema',
  });
  await tx.incluir('documento_prontuario_evento', {
    documento_prontuario_id: documento,
    operacao: 'inclusao',
    acao: 'criacao',
    situacao_documento_prontuario_id: n(situacao['id']),
    profissional_id: d.prof,
    evento_em: agora,
    dados: JSON.stringify({ origem: d.origem, nivel: 'eletronica-avancada' }),
    ocorrido_em: agora,
    usuario_id: n(tx.contexto.usuario),
  });
  return documento;
}

/** A descrição assinada no prontuário (o texto e os achados que foram assinados). */
function documentoDaDescricao(
  tx: TxOperacao,
  descricao: number,
  ato: number,
  prof: number,
  e: SalvarDescricaoEntrada,
): Promise<number | null> {
  return documentoNoProntuario(tx, {
    origem: 'descricao_cirurgica',
    origemId: descricao,
    ato,
    prof,
    titulo: 'Descrição cirúrgica',
    conteudo: {
      descricao_tecnica: e.descricaoTecnica,
      achados: e.achadosTexto,
      acidentes_intraoperatorios: e.acidentes,
      sangramento_estimado_ml: e.sangramentoMl,
      envio_anatomopatologico: e.envioAnatomopatologico,
      descricao_pecas: e.envioAnatomopatologico ? e.descricaoPecas : null,
      achados_padrao: e.achados.map((x) => x.achado),
    },
  });
}

const salvar = definirOperacao<SalvarDescricaoEntrada, ResultadoOperacao>({
  nome: 'cirurgia.salvar-descricao',
  tabelas: [...TABELAS_DESCRICAO, 'documento_prontuario', 'documento_prontuario_evento'],
  entrada: esquemaSalvarDescricao as never,
  async gravar(tx, e) {
    const ato = await atoTravado(tx, e.ato);
    const conta = await profissionalDaConta(tx, ato.est);
    const prof = regra(() => conferirAutorDaDescricao(conta, ato.equipe));
    const [linha] = await tx.consultarParaAtualizar(
      'SELECT * FROM descricao_cirurgica WHERE ato_cirurgico_id = ? AND cirurgiao_profissional_id = ?',
      [e.ato, prof],
      { teto: 1 },
    );
    regra(() =>
      conferirGravacaoDescricao(
        atual(linha ?? null),
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
    const documento = e.assinar ? await documentoDaDescricao(tx, id, e.ato, prof, e) : null;
    return {
      descricao: id,
      situacao: e.assinar ? 'assinada' : 'rascunho',
      documento,
    } as ResultadoOperacao;
  },
  alvo: (_e, r) => ({ tabela: 'descricao_cirurgica', id: n((r as Linha)['descricao']) }),
  trilha: (e) => ({ dados: { ato: e.ato, assinada: e.assinar, achados: e.achados.length }, motivo: null }),
});

const adendo = definirOperacao<AdendoDescricaoEntrada, ResultadoOperacao>({
  nome: 'cirurgia.adendo-descricao',
  tabelas: [
    'descricao_cirurgica',
    'descricao_cirurgica_adendo',
    'documento_prontuario',
    'documento_prontuario_evento',
  ],
  entrada: esquemaAdendoDescricao as never,
  async gravar(tx, e) {
    const [linha] = await tx.consultarParaAtualizar(
      `SELECT d.* FROM descricao_cirurgica d JOIN ato_cirurgico a ON a.id = d.ato_cirurgico_id
        WHERE d.id = ? AND a.estabelecimento_id = ? AND d.excluido_em IS NULL`,
      [e.descricao, est(tx)],
      { teto: 1 },
    );
    const conta = await profissionalDaConta(tx, est(tx));
    regra(() => conferirAdendoDescricao(atual(linha ?? null), conta, e));
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
    // A retificação entra no prontuário como documento próprio do cirurgião, ligado à descrição, com o mesmo tipo e o
    // mesmo nível de assinatura (eletrônica avançada já conferida; ICP-Brasil pela fila, como a descrição): CFM
    // 1.821/2007 e SBIS NGS2. O documento da descrição original não muda.
    const original = await tx.uma(
      `SELECT id FROM documento_prontuario
        WHERE entidade_origem = 'descricao_cirurgica' AND entidade_origem_id = ? AND excluido_em IS NULL
        ORDER BY numero_versao DESC LIMIT 1`,
      [e.descricao],
    );
    const documento = await documentoNoProntuario(tx, {
      origem: 'descricao_cirurgica_adendo',
      origemId: id,
      ato: n(d['ato_cirurgico_id']),
      prof: n(conta),
      titulo: `Adendo à descrição cirúrgica (${n(s?.s) + 1})`,
      conteudo: {
        descricao_cirurgica_id: e.descricao,
        documento_descricao_id: original ? n(original['id']) : null,
        sequencia: n(s?.s) + 1,
        texto: e.texto,
        motivo: e.motivo,
      },
    });
    return { adendo: id, descricao: e.descricao, documento } as ResultadoOperacao;
  },
  alvo: (_e, r) => ({ tabela: 'descricao_cirurgica_adendo', id: n((r as Linha)['adendo']) }),
  trilha: (e) => ({ dados: { descricao: e.descricao }, motivo: e.motivo.slice(0, 500) }),
});

const intercorrencia = definirOperacao<IntercorrenciaEntrada, ResultadoOperacao>({
  nome: 'cirurgia.registrar-intercorrencia',
  // A grave, o óbito e o tipo de evento adverso abrem a notificação ao núcleo de segurança do paciente na mesma
  // transação (RDC 36/2013): a intercorrência fica ligada a ela e nenhuma das duas fica sem a outra.
  tabelas: ['intercorrencia_cirurgica', ...TABELAS_NOTIFICACAO],
  entrada: esquemaIntercorrencia as never,
  async gravar(tx, e) {
    const ato = await atoTravado(tx, e.ato);
    const prof = await profissionalDaConta(tx, ato.est);
    if (prof === null)
      throw recusa('sem-profissional', 'A sua conta não tem vínculo de profissional neste estabelecimento.');
    const t = await tx.uma(
      'SELECT ativo, exige_conduta, evento_adverso, descricao FROM tipo_intercorrencia_cirurgica WHERE id = ?',
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
    const nota = notificacaoDaIntercorrencia(r.pedeNotificacao, {
      gravidade: e.gravidade,
      tipoNome: textoOuNulo(t?.['descricao']) ?? 'tipo não informado',
      fase: e.fase,
      descricao: e.descricao,
      conduta: e.conduta,
    });
    if (!nota)
      return {
        intercorrencia: id,
        pedeNotificacao: false,
        notificacao: null,
        protocoloNotificacao: null,
      } as ResultadoOperacao;
    const dados = await tx.uma(
      `SELECT a.atendimento_id, a.paciente_id, u.login FROM ato_cirurgico a JOIN usuario u ON u.id = ?
        WHERE a.id = ?`,
      [n(tx.contexto.usuario), e.ato],
    );
    if (!dados?.['login']) throw recusa('usuario-inexistente', 'A conta da sessão não existe neste cliente.');
    // A chave da notificação é a da intercorrência: o mesmo ato nunca abre duas notificações.
    const chave = `intercorrencia-cirurgica:${String(id)}`;
    const aberta = await gravarNotificacaoIncidente(tx, ato.est, {
      agora: await relogioDoEstabelecimento(tx, ato.est),
      protocoloDe: formatarProtocolo,
      codigoResumo: resumoSha256(codigoAcompanhamento(String(ato.est), chave)),
      chaveResumo: resumoDaChave(String(ato.est), chave),
      ocorridoEm: e.ocorridoEm.replace(' ', 'T'),
      atendimento: n(dados['atendimento_id']),
      paciente: n(dados['paciente_id']),
      unidade: null,
      leito: null,
      local: 'Centro cirúrgico',
      tipo: nota.tipo,
      tipoOutro: null,
      chegouAoPaciente: nota.chegouAoPaciente,
      danoPercebido: nota.danoPercebido,
      classificacao: nota.classificacao,
      descricao: nota.descricao,
      anonima: false,
      notificador: texto(dados['login']),
      origemTela: 'cirurgia.intercorrencia',
      origemSugestao: null,
    });
    const linha = await tx.uma<{ versao: number }>(
      'SELECT versao FROM intercorrencia_cirurgica WHERE id = ?',
      [id],
    );
    await tx.alterar('intercorrencia_cirurgica', id, n(linha?.versao), {
      notificacao_incidente_id: aberta.id,
    });
    return {
      intercorrencia: id,
      pedeNotificacao: true,
      notificacao: aberta.id,
      protocoloNotificacao: aberta.protocolo,
    } as ResultadoOperacao;
  },
  alvo: (_e, r) => ({ tabela: 'intercorrencia_cirurgica', id: n((r as Linha)['intercorrencia']) }),
  trilha: (e) => ({ dados: { ato: e.ato, gravidade: e.gravidade, fase: e.fase }, motivo: null }),
});

export const OPERACOES_DESCRICAO: Readonly<Record<string, Operacao<never, ResultadoOperacao>>> = {
  'cirurgia.salvarDescricao': salvar as Operacao<never, ResultadoOperacao>,
  'cirurgia.adendoDescricao': adendo as Operacao<never, ResultadoOperacao>,
  'cirurgia.registrarIntercorrencia': intercorrencia as Operacao<never, ResultadoOperacao>,
};
