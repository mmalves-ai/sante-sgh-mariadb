// Porta do prontuário ao vivo sobre o banco PRÓPRIO do cliente (MariaDB, pelo @sgh/nucleo), só leitura: a lista dos
// registros clínicos do paciente, o resumo dos filtros, as exceções agregadas, o registro aberto, o texto, as
// respostas com a definição do modelo, o contexto do ato, os textos da busca por palavra e o registro de acessos.
//
// Tabelas: registro_assistencial (gravado pelo sistema e importado pelo conector, origem 'migracao'),
// registro_assistencial_resposta, registro_assistencial_supervisao, modelo_documento_clinico,
// modelo_documento_versao, modelo_campo, modelo_campo_opcao, profissional, pessoa_fisica, ocupacao_cbo, paciente,
// atendimento, unidade_assistencial, fonte_pagadora, usuario, estabelecimento e trilha_auditoria (acessos).
//
// - Toda leitura filtra pelo estabelecimento da sessão e pela exclusão lógica (sem prontuário cruzado).
// - Registro confidencial (visível só a quem tem acesso ao prontuário restrito) fica fora de toda leitura desta porta
//   (falha fechada): a liberação do prontuário restrito por registro ainda não chega à porta.
// - Datas e horas no fuso do estabelecimento (o banco guarda instantes em UTC); os filtros de data (dia civil local)
//   viram limites em UTC.
// - O texto do registro (texto_consolidado) volta como texto formatado: o importado já vem nesse formato; o texto
//   simples gravado pelo sistema é embrulhado com escapes Unicode (o leitor do domínio não muda).
// - O banco próprio não guarda o formulário da época nem o documento emitido comprimido: as fontes "layout" e
//   "documento" ficam vazias (o documento do prontuário é lido pela porta dos documentos).
// - As respostas viram linhas no formato do leitor do domínio (valor já em texto), com a definição montada de
//   modelo_campo; a ordem é a sequência do campo seguida do id, sempre com tamanho ímpar (cada campo é raiz).
// Regra de negócio (marcas, sigilo, categoria pelo CBO, busca da palavra) fica no serviço e no domínio.
import { ErroOperacao, type Leitor } from '@sgh/nucleo';
import type { ContextoProntuario, PortaProntuario, ResumoProntuarioLido } from './porta.js';
import { dataHora, fusoValido, type NucleoLeituraPep } from './registro-porta-propria.js';
import {
  type AcessoLido,
  type ConteudoLido,
  type ContextoLido,
  type DefinicaoFormularioLida,
  EVENTO_ALERTA_LEITURA,
  EVENTOS_LEITURA_PRONTUARIO,
  type ExcecaoAgregadaLida,
  type FiltroAcessos,
  type FiltroRegistros,
  type FontesLidas,
  type RegistroProntuarioLido,
  type RespostaLida,
} from './tipos-pep.js';

/** Selo do modelo sem versão publicada (o registro antigo continua legível). */
export const SELO_SEM_VERSAO = 'sem-versao';
/** Tipo de pergunta do leitor do domínio que mostra o valor em texto (com unidade). */
export const TIPO_PERGUNTA_TEXTO = '11';
/** Tipo de pergunta do leitor do domínio que é título de seção. */
export const TIPO_PERGUNTA_TITULO = '1';
const TIPOS_CAMPO_TITULO = new Set(['grupo', 'secao', 'titulo', 'rotulo']);

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const textoOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const DIA = /^\d{4}-\d{2}-\d{2}$/;

interface Estabelecimento {
  readonly id: number;
  readonly fuso: string;
}

/** Instante em UTC do início do dia civil local (AAAA-MM-DD) no fuso; independe do TZ da máquina. */
export function inicioDoDiaUtc(dia: string, fuso: string): Date {
  if (!DIA.test(dia))
    throw new ErroOperacao(400, 'data-invalida', 'Data inválida', 'A data do filtro não está no formato AAAA-MM-DD.');
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  const alvo = Date.UTC(a, m - 1, d);
  const local = (t: number) => Date.parse(`${dataHora(new Date(t), fuso)}Z`);
  let t = alvo - (local(alvo) - alvo);
  t += alvo - local(t);
  return new Date(t);
}

/** Dia seguinte (AAAA-MM-DD), para o limite exclusivo do "até". */
export function diaSeguinte(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Texto formatado do registro: o que já é texto formatado passa; o texto simples é embrulhado (escape Unicode). */
export function comoTextoFormatado(texto: string): string {
  if (/^\s*\{\\rtf/.test(texto)) return texto;
  const esc = (linha: string) =>
    [...linha]
      .map((ch) => {
        if (ch === '\\' || ch === '{' || ch === '}') return `\\${ch}`;
        const c = ch.codePointAt(0) ?? 0x3f;
        if (c < 0x80) return ch;
        if (c > 0xffff) return '\\u63?';
        return `\\u${c > 0x7fff ? c - 0x10000 : c}?`;
      })
      .join('');
  return `{\\rtf1\\ansi\\uc1 ${texto
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => `${esc(l)}\\par`)
    .join('\n')}}`;
}

/** Ordem da resposta e do vínculo: sequência do campo (5) + id (10), tamanho ímpar (o leitor trata como raiz). */
export function ordemDoCampo(sequencia: unknown, id: unknown): string {
  return `${String(num(sequencia)).padStart(5, '0')}${String(num(id)).padStart(10, '0')}`;
}

const DATA_BR = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  const [a, m, d] = s.split('-');
  return a && m && d ? `${d}/${m}/${a}` : s;
};
const NUMERO_BR = (v: unknown): string => {
  const s = String(v);
  const n = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  return n.replace('.', ',');
};

/** Valor da resposta em texto, pela coluna que o tipo diz estar preenchida. */
export function valorDaResposta(x: Record<string, unknown>, fuso: string): string | null {
  const t = textoOuNull(x['valor_texto']);
  switch (x['tipo_valor']) {
    case 'numero':
      return x['valor_numero'] === null || x['valor_numero'] === undefined ? t : NUMERO_BR(x['valor_numero']);
    case 'data':
      return DATA_BR(x['valor_data']) ?? t;
    case 'data_hora': {
      const v = dataHora(x['valor_data_hora'], fuso);
      return v ? `${DATA_BR(v.slice(0, 10))} ${v.slice(11, 16)}` : t;
    }
    case 'hora':
      return x['valor_hora'] === null || x['valor_hora'] === undefined ? t : String(x['valor_hora']).slice(0, 5);
    case 'booleano':
      return x['valor_booleano'] === null || x['valor_booleano'] === undefined
        ? t
        : Number(x['valor_booleano'])
          ? 'Sim'
          : 'Não';
    case 'opcao': {
      const r = textoOuNull(x['opcao_rotulo']);
      return r && t ? `${r}: ${t}` : (r ?? t);
    }
    case 'cid':
      return textoOuNull(x['codigo_cid10']) ?? t;
    default: {
      if (t !== null) return t;
      const e = x['valor_estruturado'];
      if (e === null || e === undefined) return null;
      return typeof e === 'string' ? e : JSON.stringify(e);
    }
  }
}

const COLUNAS_REGISTRO = `r.id, r.paciente_id, r.atendimento_id, r.data_hora_clinica, r.data_hora_lancamento,
       r.modelo_documento_clinico_id AS modelo, m.codigo AS modelo_codigo, m.titulo AS modelo_nome,
       r.autor_profissional_id, COALESCE(p.nome_exibicao, pf.nome) AS profissional_nome, o.codigo_cbo,
       r.suspenso_em, r.justificativa_suspensao, r.corrige_registro_assistencial_id, r.justificativa_retroativo,
       (SELECT s.preceptor_profissional_id FROM registro_assistencial_supervisao s
         WHERE s.registro_assistencial_id = r.id AND s.situacao = 'coassinado' AND s.excluido_em IS NULL
         ORDER BY s.sequencia DESC LIMIT 1) AS supervisor,
       (r.texto_consolidado IS NOT NULL AND r.texto_consolidado <> '') AS tem_texto`;
const DE_REGISTRO = `FROM registro_assistencial r
  JOIN modelo_documento_clinico m ON m.id = r.modelo_documento_clinico_id
  LEFT JOIN profissional p ON p.id = r.autor_profissional_id
  LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
  LEFT JOIN ocupacao_cbo o ON o.id = r.ocupacao_cbo_id`;
/** Registro visível nesta porta: do estabelecimento, não excluído e não confidencial. */
const VISIVEL = 'r.estabelecimento_id = ? AND r.excluido_em IS NULL AND r.confidencial = FALSE';

export class PortaProntuarioPropria implements PortaProntuario {
  readonly destino = 'proprio' as const;

  constructor(
    private readonly nucleo: NucleoLeituraPep,
    /** Cliente desta API (configuração; um banco por cliente), quando o contexto da sessão não o traz. */
    private readonly cliente: string,
  ) {}

  private ler<T>(
    c: ContextoProntuario,
    rotulo: string,
    fn: (l: Leitor, estabelecimento: Estabelecimento) => Promise<T>,
  ): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: c.cliente || this.cliente, correlacao: `pep.prontuario.${rotulo}` },
      async (l) => fn(l, await this.estabelecimento(l, c.hospital)),
    );
  }

  private async estabelecimento(l: Leitor, codigo: string): Promise<Estabelecimento> {
    const e = await l.uma<{ id: unknown; fuso_horario: unknown }>(
      'SELECT id, fuso_horario FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
      [codigo],
    );
    if (!e)
      throw new ErroOperacao(
        404,
        'estabelecimento-inexistente',
        'Estabelecimento não encontrado',
        'O estabelecimento da sessão não existe neste cliente.',
      );
    return { id: num(e.id), fuso: fusoValido(e.fuso_horario) };
  }

  /** Condições de data (dia civil local) sobre uma coluna de instante em UTC. */
  private periodo(
    coluna: string,
    f: { de?: string | undefined; ate?: string | undefined },
    fuso: string,
  ): { sql: string; p: unknown[] } {
    const partes: string[] = [];
    const p: unknown[] = [];
    if (f.de) {
      partes.push(`${coluna} >= ?`);
      p.push(inicioDoDiaUtc(f.de, fuso));
    }
    if (f.ate) {
      inicioDoDiaUtc(f.ate, fuso);
      partes.push(`${coluna} < ?`);
      p.push(inicioDoDiaUtc(diaSeguinte(f.ate), fuso));
    }
    return { sql: partes.map((x) => ` AND ${x}`).join(''), p };
  }

  private registroLido(x: Record<string, unknown>, fuso: string): RegistroProntuarioLido {
    return {
      id: num(x['id']),
      // No banco próprio não há retratos: o paciente e o atendimento são os próprios registros.
      idHtPaciente: num(x['paciente_id']),
      idHtAtendimento: numOuNull(x['atendimento_id']),
      dataHora: dataHora(x['data_hora_clinica'], fuso),
      lancadoEm: dataHora(x['data_hora_lancamento'], fuso),
      modelo: num(x['modelo']),
      modeloCodigo: textoOuNull(x['modelo_codigo']),
      modeloNome: textoOuNull(x['modelo_nome']),
      registroProfissional: null,
      profissional: numOuNull(x['autor_profissional_id']),
      profissionalNome: textoOuNull(x['profissional_nome']),
      cbo: textoOuNull(x['codigo_cbo']),
      suspensoEm: dataHora(x['suspenso_em'], fuso),
      justificativaSuspensao: textoOuNull(x['justificativa_suspensao']),
      corrigeRegistro: numOuNull(x['corrige_registro_assistencial_id']),
      justificativaRetroativo: textoOuNull(x['justificativa_retroativo']),
      supervisor: numOuNull(x['supervisor']),
    };
  }

  private fontes(x: Record<string, unknown>): FontesLidas {
    return {
      temConteudo: Number(x['tem_texto']) === 1,
      temXml: false,
      temDocumento: false,
      situacoes: [],
      tiposDocumento: [],
    };
  }

  listar(c: ContextoProntuario, paciente: number, f: FiltroRegistros, pagina: number, porPagina: number) {
    return this.ler(c, 'listar', async (l, est) => {
      const por = Math.max(1, Math.trunc(porPagina));
      const ini = (Math.max(1, Math.trunc(pagina)) - 1) * por;
      const per = this.periodo('r.data_hora_clinica', f, est.fuso);
      let sql = `SELECT ${COLUNAS_REGISTRO} ${DE_REGISTRO} WHERE r.paciente_id = ? AND ${VISIVEL}${per.sql}`;
      const p: unknown[] = [paciente, est.id, ...per.p];
      if (f.modelo) {
        sql += ' AND r.modelo_documento_clinico_id = ?';
        p.push(f.modelo);
      }
      if (f.profissional) {
        sql += ' AND r.autor_profissional_id = ?';
        p.push(f.profissional);
      }
      if (f.cboIncluir?.length) {
        sql += ` AND (${f.cboIncluir.map(() => 'o.codigo_cbo LIKE ?').join(' OR ')})`;
        p.push(...f.cboIncluir.map((x) => `${x}%`));
      }
      if (f.cboExcluir?.length) {
        sql += ` AND (o.codigo_cbo IS NULL OR NOT (${f.cboExcluir.map(() => 'o.codigo_cbo LIKE ?').join(' OR ')}))`;
        p.push(...f.cboExcluir.map((x) => `${x}%`));
      }
      sql += ` ORDER BY r.data_hora_clinica DESC, r.id DESC LIMIT ${por + 1} OFFSET ${ini}`;
      const linhas = await l.consultar(sql, p);
      const pag = linhas.slice(0, por);
      return {
        registros: pag.map((x) => this.registroLido(x, est.fuso)),
        haMais: linhas.length > por,
        fontes: new Map(pag.map((x) => [num(x['id']), this.fontes(x)])),
      };
    });
  }

  resumo(c: ContextoProntuario, paciente: number): Promise<ResumoProntuarioLido> {
    return this.ler(c, 'resumo', async (l, est) => {
      const modelos = await l.consultar(
        `SELECT DISTINCT m.id, m.codigo, m.titulo FROM registro_assistencial r
           JOIN modelo_documento_clinico m ON m.id = r.modelo_documento_clinico_id
          WHERE r.paciente_id = ? AND ${VISIVEL} ORDER BY m.titulo, m.id`,
        [paciente, est.id],
      );
      const profissionais = await l.consultar(
        `SELECT DISTINCT p.id, COALESCE(p.nome_exibicao, pf.nome) AS nome FROM registro_assistencial r
           JOIN profissional p ON p.id = r.autor_profissional_id
           LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE r.paciente_id = ? AND ${VISIVEL} ORDER BY nome, p.id`,
        [paciente, est.id],
      );
      const sem = await l.uma(
        `SELECT COUNT(*) AS n FROM registro_assistencial r
          WHERE r.paciente_id = ? AND ${VISIVEL} AND (r.texto_consolidado IS NULL OR r.texto_consolidado = '')`,
        [paciente, est.id],
      );
      return {
        modelos: modelos.map((x) => ({
          id: num(x['id']),
          codigo: textoOuNull(x['codigo']),
          nome: textoOuNull(x['titulo']),
        })),
        profissionais: profissionais.map((x) => ({ id: num(x['id']), nome: textoOuNull(x['nome']) ?? '' })),
        semConteudo: num(sem?.['n'] ?? 0),
        // A data impossível é marcada pelo serviço registro a registro (o banco próprio exige a data clínica).
        dataImpossivel: 0,
      };
    });
  }

  excecoes(c: ContextoProntuario): Promise<ExcecaoAgregadaLida[]> {
    return this.ler(c, 'excecoes', async (l, est) => {
      // Só contagens (regra 9): agrupadas por modelo e hora UTC no banco, dobradas no mês local aqui.
      const linhas = await l.consultar(
        `SELECT r.modelo_documento_clinico_id AS modelo, m.codigo, m.titulo,
                DATE_FORMAT(r.data_hora_lancamento, '%Y-%m-%dT%H:00:00Z') AS hora, COUNT(*) AS n
           FROM registro_assistencial r
           JOIN modelo_documento_clinico m ON m.id = r.modelo_documento_clinico_id
          WHERE ${VISIVEL} AND (r.texto_consolidado IS NULL OR r.texto_consolidado = '')
          GROUP BY r.modelo_documento_clinico_id, m.codigo, m.titulo, hora`,
        [est.id],
      );
      const grupos = new Map<string, ExcecaoAgregadaLida>();
      for (const x of linhas) {
        const h = textoOuNull(x['hora']);
        const mes = h ? (dataHora(new Date(h), est.fuso)?.slice(0, 7) ?? null) : null;
        const k = `${num(x['modelo'])}|${mes}`;
        const g = grupos.get(k);
        grupos.set(k, {
          tipo: 'sem-conteudo',
          modelo: num(x['modelo']),
          codigo: textoOuNull(x['codigo']),
          nome: textoOuNull(x['titulo']),
          mes,
          registros: (g?.registros ?? 0) + num(x['n']),
        });
      }
      return [...grupos.values()];
    });
  }

  registro(c: ContextoProntuario, paciente: number, registro: number) {
    return this.ler(c, 'registro', async (l, est) => {
      const x = await l.uma(
        `SELECT ${COLUNAS_REGISTRO} ${DE_REGISTRO} WHERE r.id = ? AND r.paciente_id = ? AND ${VISIVEL}`,
        [registro, paciente, est.id],
      );
      return x ? { registro: this.registroLido(x, est.fuso), fontes: this.fontes(x) } : null;
    });
  }

  conteudo(
    c: ContextoProntuario,
    registro: number,
    partes: { rtf: boolean; xml: boolean },
  ): Promise<ConteudoLido | null> {
    return this.ler(c, 'conteudo', async (l, est) => {
      const x = await l.uma(`SELECT r.texto_consolidado FROM registro_assistencial r WHERE r.id = ? AND ${VISIVEL}`, [
        registro,
        est.id,
      ]);
      const texto = textoOuNull(x?.['texto_consolidado']);
      if (!texto) return null;
      // O banco próprio não guarda o formulário da época (XML): a parte xml volta vazia.
      return { rtf: partes.rtf ? comoTextoFormatado(texto) : null, xml: null, bytes: texto.length };
    });
  }

  /** O documento emitido é da porta dos documentos (documento_prontuario): aqui não há eventos. */
  async eventosDocumento(): Promise<[]> {
    return [];
  }

  async documentoXml(): Promise<null> {
    return null;
  }

  respostas(c: ContextoProntuario, registro: number): Promise<RespostaLida[]> {
    return this.ler(c, 'respostas', async (l, est) => {
      const linhas = await l.consultar(
        `SELECT x.sequencia, x.tipo_valor, x.valor_texto, x.valor_numero, x.valor_data, x.valor_data_hora,
                x.valor_hora, x.valor_booleano, x.valor_estruturado, x.codigo_cid10, x.unidade, x.observacao,
                x.autopreenchido, c.id AS campo_id, c.sequencia AS campo_sequencia, op.rotulo AS opcao_rotulo
           FROM registro_assistencial_resposta x
           JOIN registro_assistencial r ON r.id = x.registro_assistencial_id
           JOIN modelo_campo c ON c.id = x.modelo_campo_id
           LEFT JOIN modelo_campo_opcao op ON op.id = x.modelo_campo_opcao_id
          WHERE x.registro_assistencial_id = ? AND ${VISIVEL} AND x.excluido_em IS NULL
          ORDER BY x.sequencia`,
        [registro, est.id],
      );
      return linhas.map((x) => ({
        ordem: ordemDoCampo(x['campo_sequencia'], x['campo_id']),
        seq: num(x['sequencia']),
        idResposta: null,
        data: null,
        hora: null,
        indice: null,
        valor: null,
        alfa: valorDaResposta(x, est.fuso),
        texto: null,
        unidade: textoOuNull(x['unidade']),
        cid: textoOuNull(x['codigo_cid10']),
        procedimento: null,
        observacao: textoOuNull(x['observacao']),
        autopreenchido: Number(x['autopreenchido']) === 1,
      }));
    });
  }

  seloDoModelo(c: ContextoProntuario, modelo: number): Promise<string> {
    return this.ler(c, 'selo', async (l) => {
      const x = await l.uma(
        `SELECT v.hash_definicao, v.numero_versao FROM modelo_documento_clinico m
           LEFT JOIN modelo_documento_versao v ON v.id = m.publicada_modelo_documento_versao_id
          WHERE m.id = ?`,
        [modelo],
      );
      if (!x || x['numero_versao'] === null || x['numero_versao'] === undefined) return SELO_SEM_VERSAO;
      return textoOuNull(x['hash_definicao']) ?? `versao-${num(x['numero_versao'])}`;
    });
  }

  /** O banco próprio não guarda a representação convertida: o serviço a monta da definição. */
  async representacaoGravada(): Promise<null> {
    return null;
  }

  definicaoModelo(c: ContextoProntuario, modelo: number): Promise<DefinicaoFormularioLida | null> {
    return this.ler(c, 'definicao', async (l) => {
      const m = await l.uma(
        'SELECT id, codigo, titulo, publicada_modelo_documento_versao_id AS publicada FROM modelo_documento_clinico WHERE id = ?',
        [modelo],
      );
      if (!m) return null;
      // Os campos de todas as versões: o registro antigo responde campos de versões anteriores.
      const campos = await l.consultar(
        `SELECT c.id, c.sequencia, c.titulo, c.tipo_campo, c.obrigatorio, c.modelo_documento_versao_id AS versao_id,
                v.numero_versao
           FROM modelo_campo c JOIN modelo_documento_versao v ON v.id = c.modelo_documento_versao_id
          WHERE v.modelo_documento_clinico_id = ? AND c.excluido_em IS NULL
          ORDER BY v.numero_versao, c.sequencia, c.id`,
        [modelo],
      );
      const publicada = numOuNull(m['publicada']);
      const versoes = new Map<number, number>();
      for (const x of campos) versoes.set(num(x['numero_versao']), (versoes.get(num(x['numero_versao'])) ?? 0) + 1);
      return {
        modelo: { id: num(m['id']), codigo: textoOuNull(m['codigo']), descricao: textoOuNull(m['titulo']), fase: null },
        vinculos: campos.map((x) => ({
          id: num(x['id']),
          idPergunta: num(x['id']),
          ordem: ordemDoCampo(x['sequencia'], x['id']),
          obrigatorio: Number(x['obrigatorio']) === 1 ? 'T' : 'F',
          ativo: publicada === null || num(x['versao_id']) === publicada ? 'T' : 'F',
        })),
        perguntas: campos.map((x) => ({
          id: num(x['id']),
          codPergunta: num(x['sequencia']),
          descricao: textoOuNull(x['titulo']),
          tipo: TIPOS_CAMPO_TITULO.has(String(x['tipo_campo'])) ? TIPO_PERGUNTA_TITULO : TIPO_PERGUNTA_TEXTO,
          unidade: null,
          ativo: 'T',
          manterHist: null,
        })),
        respostas: [],
        componentes: [],
        versoes: [...versoes.entries()].map(([versao, componentes]) => ({ versao, componentes })),
        colunasGrade: [],
        bytesDfm: 0,
      };
    });
  }

  contexto(c: ContextoProntuario, registro: number): Promise<ContextoLido | null> {
    return this.ler(c, 'contexto', async (l, est) => {
      const x = await l.uma(
        `SELECT pp.nome AS paciente_nome, pp.nome_social, pp.data_nascimento, a.numero, a.entrada_em,
                u.nome AS unidade, fp.nome AS convenio, COALESCE(pa.nome_exibicao, pfa.nome) AS assistente,
                COALESCE(p.nome_exibicao, pf.nome) AS profissional_nome, o.codigo_cbo
           FROM registro_assistencial r
           JOIN paciente pc ON pc.id = r.paciente_id
           JOIN pessoa_fisica pp ON pp.id = pc.pessoa_fisica_id
           LEFT JOIN atendimento a ON a.id = r.atendimento_id
           LEFT JOIN unidade_assistencial u ON u.id = a.unidade_assistencial_id
           LEFT JOIN fonte_pagadora fp ON fp.id = a.fonte_pagadora_id
           LEFT JOIN profissional pa ON pa.id = a.profissional_id
           LEFT JOIN pessoa_fisica pfa ON pfa.id = pa.pessoa_fisica_id
           LEFT JOIN profissional p ON p.id = r.autor_profissional_id
           LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           LEFT JOIN ocupacao_cbo o ON o.id = r.ocupacao_cbo_id
          WHERE r.id = ? AND ${VISIVEL}`,
        [registro, est.id],
      );
      if (!x) return null;
      const numero = textoOuNull(x['numero']);
      const nasc = x['data_nascimento'];
      return {
        pacienteNome: textoOuNull(x['paciente_nome']),
        pacienteNomeSocial: textoOuNull(x['nome_social']),
        pacienteNascimento:
          nasc === null || nasc === undefined
            ? null
            : nasc instanceof Date
              ? nasc.toISOString().slice(0, 10)
              : String(nasc).slice(0, 10),
        atendimentoNumero: numero !== null && /^\d{1,15}$/.test(numero) ? Number(numero) : null,
        entrada: dataHora(x['entrada_em'], est.fuso),
        unidade: textoOuNull(x['unidade']),
        // O leito vem da ocupação de leito (porta da internação); o CID, da terminologia do atendimento.
        leito: null,
        convenio: textoOuNull(x['convenio']),
        cidPrincipal: null,
        cidSecundario: null,
        medicoAssistente: textoOuNull(x['assistente']),
        responsavelNome: null,
        responsavelParentesco: null,
        profissionalNome: textoOuNull(x['profissional_nome']),
        profissionalConselho: null,
        cbo: textoOuNull(x['codigo_cbo']),
      };
    });
  }

  textos(c: ContextoProntuario, paciente: number, f: Pick<FiltroRegistros, 'de' | 'ate'>, teto: number) {
    return this.ler(c, 'textos', async (l, est) => {
      const t = Math.max(0, Math.trunc(teto));
      const per = this.periodo('r.data_hora_clinica', f, est.fuso);
      const linhas = await l.consultar(
        `SELECT r.id, r.data_hora_clinica, m.codigo AS modelo_codigo, o.codigo_cbo, r.texto_consolidado
           FROM registro_assistencial r
           JOIN modelo_documento_clinico m ON m.id = r.modelo_documento_clinico_id
           LEFT JOIN ocupacao_cbo o ON o.id = r.ocupacao_cbo_id
          WHERE r.paciente_id = ? AND ${VISIVEL}${per.sql}
          ORDER BY r.data_hora_clinica DESC, r.id DESC LIMIT ${t + 1}`,
        [paciente, est.id, ...per.p],
      );
      return {
        registros: linhas.slice(0, t).map((x) => {
          const texto = textoOuNull(x['texto_consolidado']);
          return {
            id: num(x['id']),
            dataHora: dataHora(x['data_hora_clinica'], est.fuso),
            modelo: textoOuNull(x['modelo_codigo']),
            cbo: textoOuNull(x['codigo_cbo']),
            rtf: texto ? comoTextoFormatado(texto) : null,
          };
        }),
        truncado: linhas.length > t,
      };
    });
  }

  acessos(c: ContextoProntuario, f: FiltroAcessos, pagina: number, porPagina: number) {
    return this.ler(c, 'acessos', async (l, est) => {
      const por = Math.max(1, Math.trunc(porPagina));
      const ini = (Math.max(1, Math.trunc(pagina)) - 1) * por;
      const evento = "JSON_VALUE(t.dados_depois, '$.evento')";
      const eventos = f.soAlertas ? [EVENTO_ALERTA_LEITURA] : [...EVENTOS_LEITURA_PRONTUARIO];
      const per = this.periodo('t.ocorrido_em', f, est.fuso);
      let sql = `SELECT t.id, t.ocorrido_em, t.entidade, t.entidade_id, u.login, ${evento} AS evento,
                        JSON_VALUE(t.dados_depois, '$.estacao') AS estacao,
                        JSON_VALUE(t.dados_depois, '$.paciente') AS paciente,
                        JSON_VALUE(t.dados_depois, '$.chaveNatural') AS chave,
                        JSON_VALUE(t.dados_depois, '$.resultado') AS resultado,
                        JSON_VALUE(t.dados_depois, '$.como.atorTipo') AS como
                   FROM trilha_auditoria t LEFT JOIN usuario u ON u.id = t.usuario_id
                  WHERE t.estabelecimento_id = ? AND ${evento} IN (${eventos.map(() => '?').join(', ')})${per.sql}`;
      const p: unknown[] = [est.id, ...eventos, ...per.p];
      if (f.paciente) {
        sql += " AND JSON_VALUE(t.dados_depois, '$.paciente') = ?";
        p.push(String(f.paciente));
      }
      if (f.usuario) {
        sql += ' AND u.login = ?';
        p.push(f.usuario);
      }
      sql += ` ORDER BY t.id DESC LIMIT ${por + 1} OFFSET ${ini}`;
      const linhas = await l.consultar(sql, p);
      const itens: AcessoLido[] = linhas.slice(0, por).map((x) => ({
        id: String(x['id']),
        em: dataHora(x['ocorrido_em'], est.fuso),
        usuario: textoOuNull(x['login']) ?? '(desconhecido)',
        evento: String(x['evento']),
        estacao: textoOuNull(x['estacao']),
        paciente: numOuNull(x['paciente']),
        tabela: textoOuNull(x['entidade']),
        alvo: textoOuNull(x['entidade_id']),
        chave: textoOuNull(x['chave']),
        resultado: textoOuNull(x['resultado']) ?? '',
        origem: x['como'] ? `SUPORTE:${String(x['como'])}` : null,
      }));
      return { itens, haMais: linhas.length > por };
    });
  }
}
