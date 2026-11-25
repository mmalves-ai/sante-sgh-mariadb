// Documentos obrigatórios antes da cirurgia, com bloqueio do início (F8, 04-CC linha 104), no banco do cliente
// (`tipo_documento_pre_operatorio`, `documento_exigido_cirurgia`, `documento_cirurgia_apresentado`). A regra fica no
// @sgh/dominio-cirurgia (documentos-pre-operatorio); a mudança de estado do agendamento (operacoes.ts) usa
// `exigenciasDaCirurgia` para recusar a confirmação e o início com documento em falta.
// Contrato de efeito:
//   - leitura: os documentos que a cirurgia exige (o tipo obrigatório para toda cirurgia e as regras do estabelecimento
//     por procedimento, fonte pagadora e faixa etária), o estado de cada um na data da cirurgia, o histórico de
//     registros e os documentos digitalizados do paciente que podem ser ligados. Só leitura;
//   - registrar: uma linha nova em documento_cirurgia_apresentado com a sequência seguinte (apresentado, dispensado ou
//     recusado), o conferente e o instante da conferência; o apresentado pode levar o arquivo do documento
//     digitalizado do mesmo paciente. O registro anterior fica (o mais recente é o que vale); nada é apagado;
//   - configuração: o tipo de documento (código único) e a regra do estabelecimento (sem regra igual; consentimento e
//     avaliação sempre bloqueiam); a regra é desativada pela versão, nunca apagada.
// Cirurgia de outro estabelecimento: 404 do agendamento, sem escrita.
import {
  conferirRegistroDocumento,
  conferirRegraDocumento,
  conferirTipoDocumento,
  type DocumentoExigido,
  documentosExigidos,
  estadoDoDocumento,
  type EstadoDocumentoCirurgia,
  type FaixaEtariaRegra,
  type RegraDocumentoCirurgia,
  type RegistroDocumento,
  registroVigente,
} from '@sgh/dominio-cirurgia';
import { ErroOperacao, type Leitor } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_DOCUMENTOS_CIRURGIA = Symbol('PORTA_DOCUMENTOS_CIRURGIA');

const TIPO = 'tipo_documento_pre_operatorio';
const REGRA = 'documento_exigido_cirurgia';
const APRESENTADO = 'documento_cirurgia_apresentado';

type Linha = Record<string, unknown>;

const SQL_AGENDAMENTO = `
  SELECT a.id, a.numero, a.situacao, a.paciente_id, a.fonte_pagadora_id, cc.natureza,
         DATE_FORMAT(a.inicio_previsto_em, '%Y-%m-%d') AS data_cirurgia,
         TIMESTAMPDIFF(DAY, pf.data_nascimento, COALESCE(DATE(a.inicio_previsto_em), CURDATE())) AS idade_dias,
         TIMESTAMPDIFF(MONTH, pf.data_nascimento, COALESCE(DATE(a.inicio_previsto_em), CURDATE())) AS idade_meses,
         TIMESTAMPDIFF(YEAR, pf.data_nascimento, COALESCE(DATE(a.inicio_previsto_em), CURDATE())) AS idade_anos
    FROM agendamento_cirurgico a
    LEFT JOIN carater_cirurgia cc ON cc.id = a.carater_cirurgia_id
    LEFT JOIN paciente p ON p.id = a.paciente_id
    LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
   WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`;

const SQL_REGRAS = `
  SELECT r.tipo_documento_pre_operatorio_id AS tipo, t.categoria, r.procedimento_cirurgico_id AS procedimento,
         r.fonte_pagadora_id AS fonte, r.validade_dias, r.obrigatorio, r.bloqueia_entrada_sala, r.gera_pendencia,
         f.idade_inicial, f.idade_final, u.codigo AS unidade
    FROM documento_exigido_cirurgia r
    JOIN tipo_documento_pre_operatorio t ON t.id = r.tipo_documento_pre_operatorio_id AND t.ativo
    LEFT JOIN faixa_etaria f ON f.id = r.faixa_etaria_id
    LEFT JOIN unidade_idade u ON u.id = f.unidade_idade_id
   WHERE r.estabelecimento_id = ? AND r.ativo`;

const SQL_TIPOS_GERAIS = `
  SELECT id AS tipo, categoria, validade_dias, gera_pendencia
    FROM tipo_documento_pre_operatorio WHERE ativo AND obrigatorio`;

const SQL_REGISTROS = `
  SELECT d.id, d.versao, d.sequencia, d.tipo_documento_pre_operatorio_id AS tipo, d.situacao,
         DATE_FORMAT(d.apresentado_em, '%Y-%m-%d') AS apresentado_em, DATE_FORMAT(d.valido_ate, '%Y-%m-%d') AS valido_ate,
         d.arquivo_id, d.observacao, DATE_FORMAT(d.conferido_em, '%Y-%m-%d %H:%i') AS conferido_em,
         u.login AS conferente
    FROM documento_cirurgia_apresentado d
    LEFT JOIN usuario u ON u.id = d.conferido_por_usuario_id
   WHERE d.agendamento_cirurgico_id = ? AND d.excluido_em IS NULL
   ORDER BY d.sequencia`;

function unidadeDaFaixa(codigo: unknown): FaixaEtariaRegra['unidade'] {
  const c = String(codigo ?? '').toLowerCase();
  if (c.startsWith('d')) return 'dia';
  if (c.startsWith('m')) return 'mes';
  return 'ano';
}

export interface ExigenciasDaCirurgia {
  readonly agendamento: number;
  readonly numero: string;
  readonly situacao: string;
  readonly natureza: string;
  readonly paciente: number;
  readonly dataCirurgia: string | null;
  readonly exigidos: DocumentoExigido[];
  readonly registros: (RegistroDocumento & { linha: Linha })[];
}

/**
 * Os documentos que a cirurgia exige e os registros dela, lidos no leitor dado (na transação da mudança de estado ou
 * numa leitura). Agendamento de outro estabelecimento: 404.
 */
export async function exigenciasDaCirurgia(
  l: Leitor,
  estabelecimento: number,
  agendamento: number,
): Promise<ExigenciasDaCirurgia> {
  const a = await l.uma(SQL_AGENDAMENTO, [agendamento, estabelecimento]);
  if (!a) throw naoEncontrado('Agendamento cirúrgico');
  const procedimentos = (
    await l.consultar<Linha>(
      `SELECT procedimento_cirurgico_id AS p FROM agendamento_cirurgico_procedimento
        WHERE agendamento_cirurgico_id = ? AND excluido_em IS NULL`,
      [agendamento],
    )
  ).map((r) => num(r['p']));
  const regras: RegraDocumentoCirurgia[] = [
    ...(await l.consultar<Linha>(SQL_TIPOS_GERAIS)).map((r) => ({
      tipo: num(r['tipo']),
      categoria: String(r['categoria']),
      procedimento: null,
      fontePagadora: null,
      faixa: null,
      validadeDias: numOuNull(r['validade_dias']),
      obrigatorio: true,
      bloqueiaEntradaSala: false,
      geraPendencia: bool(r['gera_pendencia']),
    })),
    ...(await l.consultar<Linha>(SQL_REGRAS, [estabelecimento])).map((r) => ({
      tipo: num(r['tipo']),
      categoria: String(r['categoria']),
      procedimento: numOuNull(r['procedimento']),
      fontePagadora: numOuNull(r['fonte']),
      faixa:
        r['idade_inicial'] === null || r['idade_inicial'] === undefined
          ? null
          : {
              unidade: unidadeDaFaixa(r['unidade']),
              inicial: num(r['idade_inicial']),
              final: num(r['idade_final']),
            },
      validadeDias: numOuNull(r['validade_dias']),
      obrigatorio: bool(r['obrigatorio']),
      bloqueiaEntradaSala: bool(r['bloqueia_entrada_sala']),
      geraPendencia: bool(r['gera_pendencia']),
    })),
  ];
  const idade =
    a['idade_anos'] === null || a['idade_anos'] === undefined
      ? null
      : { dias: num(a['idade_dias']), meses: num(a['idade_meses']), anos: num(a['idade_anos']) };
  const registros = (await l.consultar<Linha>(SQL_REGISTROS, [agendamento])).map((r) => ({
    tipo: num(r['tipo']),
    sequencia: num(r['sequencia']),
    situacao: String(r['situacao']),
    apresentadoEm: txtOuNull(r['apresentado_em']),
    validoAte: txtOuNull(r['valido_ate']),
    linha: r,
  }));
  return {
    agendamento,
    numero: String(a['numero']),
    situacao: String(a['situacao']),
    natureza: String(a['natureza'] ?? ''),
    paciente: num(a['paciente_id']),
    dataCirurgia: txtOuNull(a['data_cirurgia']),
    exigidos: documentosExigidos(regras, {
      procedimentos,
      fontePagadora: numOuNull(a['fonte_pagadora_id']),
      idade,
    }),
    registros,
  };
}

export interface DocumentoDaCirurgia {
  readonly tipo: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly categoria: string;
  readonly validadeDias: number | null;
  readonly bloqueia: boolean;
  readonly geraPendencia: boolean;
  readonly estado: EstadoDocumentoCirurgia;
  readonly vigente: RegistroLido | null;
}

export interface RegistroLido {
  readonly id: number;
  readonly sequencia: number;
  readonly tipo: number;
  readonly situacao: string;
  readonly apresentadoEm: string | null;
  readonly validoAte: string | null;
  readonly arquivo: number | null;
  readonly observacao: string | null;
  readonly conferidoEm: string | null;
  readonly conferente: string | null;
}

const registroLido = (r: Linha): RegistroLido => ({
  id: num(r['id']),
  sequencia: num(r['sequencia']),
  tipo: num(r['tipo']),
  situacao: String(r['situacao']),
  apresentadoEm: txtOuNull(r['apresentado_em']),
  validoAte: txtOuNull(r['valido_ate']),
  arquivo: numOuNull(r['arquivo_id']),
  observacao: txtOuNull(r['observacao']),
  conferidoEm: txtOuNull(r['conferido_em']),
  conferente: txtOuNull(r['conferente']),
});

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const esquemaRegistro = z
  .object({
    tipo: id,
    situacao: z.enum(['apresentado', 'dispensado', 'recusado']),
    apresentadoEm: data.nullish(),
    validoAte: data.nullish(),
    observacao: z.string().max(500).nullish(),
    digitalizado: id.nullish(),
  })
  .strict();
const esquemaTipo = z
  .object({
    codigo: z.string().max(30),
    descricao: z.string().max(150),
    categoria: z.string().max(30),
    validadeDias: z.number().int().nullish(),
    obrigatorio: z.boolean().optional(),
    geraPendencia: z.boolean().optional(),
  })
  .strict();
const esquemaRegra = z
  .object({
    tipo: id,
    procedimento: id.nullish(),
    fontePagadora: id.nullish(),
    faixaEtaria: id.nullish(),
    validadeDias: z.number().int().nullish(),
    bloqueiaEntradaSala: z.boolean().optional(),
    geraPendencia: z.boolean().optional(),
  })
  .strict();
const esquemaAtivo = z.object({ versao: id, ativo: z.boolean() }).strict();

const hojeNo = (fuso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(new Date());

export class PortaDocumentosCirurgiaPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, [TIPO, REGRA, APRESENTADO], 'cirurgia.documentos');
  }

  /** Os documentos exigidos pela cirurgia com o estado na data dela, o histórico e os digitalizados do paciente. */
  documentos(c: ContextoPortaPropria, agendamento: number) {
    return this.ler(c, 'leitura', async (l, est) => {
      const x = await exigenciasDaCirurgia(l, est.id, agendamento);
      const tipos = new Map(
        (
          await l.consultar<Linha>(
            'SELECT id, codigo, descricao, categoria, ativo FROM tipo_documento_pre_operatorio ORDER BY descricao',
          )
        ).map((t) => [num(t['id']), t]),
      );
      const documentos: DocumentoDaCirurgia[] = x.exigidos.map((e) => {
        const v = registroVigente(e.tipo, x.registros);
        const t = tipos.get(e.tipo);
        return {
          ...e,
          codigo: String(t?.['codigo'] ?? ''),
          descricao: String(t?.['descricao'] ?? ''),
          estado: estadoDoDocumento(e, v, x.dataCirurgia),
          vigente: v ? registroLido((v as (typeof x.registros)[number]).linha) : null,
        };
      });
      const digitalizados = await l.consultar<Linha>(
        `SELECT d.id, d.descricao, DATE_FORMAT(d.data_documento, '%Y-%m-%d') AS data_documento, t.descricao AS tipo
           FROM documento_digitalizado d
           JOIN tipo_documento_arquivo t ON t.id = d.tipo_documento_arquivo_id
          WHERE d.paciente_id = ? AND d.estabelecimento_id = ? AND d.excluido_em IS NULL
          ORDER BY d.digitalizado_em DESC LIMIT 100`,
        [x.paciente, est.id],
      );
      return {
        agendamento,
        numero: x.numero,
        situacao: x.situacao,
        natureza: x.natureza,
        dataCirurgia: x.dataCirurgia,
        documentos,
        historico: x.registros.map((r) => registroLido(r.linha)),
        tipos: [...tipos.values()]
          .filter((t) => bool(t['ativo']))
          .map((t) => ({
            id: num(t['id']),
            codigo: String(t['codigo']),
            descricao: String(t['descricao']),
            categoria: String(t['categoria']),
          })),
        digitalizados: digitalizados.map((d) => ({
          id: num(d['id']),
          descricao: txtOuNull(d['descricao']),
          data: txtOuNull(d['data_documento']),
          tipo: String(d['tipo']),
        })),
      };
    });
  }

  /** Registra o documento (apresentado, dispensado ou recusado) numa linha nova; o anterior fica no histórico. */
  async registrar(c: ContextoPortaPropria, agendamento: number, entrada: unknown) {
    const e = entradaValida(esquemaRegistro, entrada);
    return this.gravar(c, 'cirurgia.documentos.registrar', [APRESENTADO], async (tx, est, usuario) => {
      const [a] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id FROM agendamento_cirurgico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [agendamento, est.id],
      );
      if (!a) throw naoEncontrado('Agendamento cirúrgico');
      const x = await exigenciasDaCirurgia(tx, est.id, agendamento);
      const t = await tx.uma('SELECT categoria FROM tipo_documento_pre_operatorio WHERE id = ? AND ativo', [
        e.tipo,
      ]);
      const problemas = conferirRegistroDocumento(
        {
          situacao: e.situacao,
          observacao: e.observacao ?? null,
          apresentadoEm: e.apresentadoEm ?? null,
          validoAte: e.validoAte ?? null,
        },
        {
          situacaoCirurgia: x.situacao,
          natureza: x.natureza,
          categoria: t ? String(t['categoria']) : null,
          hoje: hojeNo(est.fuso),
        },
      );
      let arquivo: number | null = null;
      if (e.digitalizado) {
        const d = await tx.uma(
          `SELECT arquivo_id FROM documento_digitalizado
            WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [e.digitalizado, x.paciente, est.id],
        );
        if (!d)
          problemas.push({
            campo: 'digitalizado',
            mensagem: 'O documento digitalizado não é deste paciente neste estabelecimento.',
          });
        else if (e.situacao !== 'apresentado')
          problemas.push({ campo: 'digitalizado', mensagem: 'Só o documento apresentado leva o arquivo.' });
        else arquivo = num(d['arquivo_id']);
      }
      if (problemas.length) throw recusaRegra('Registro do documento recusado', problemas);
      const seq = await tx.uma(
        'SELECT COALESCE(MAX(sequencia), 0) AS s FROM documento_cirurgia_apresentado WHERE agendamento_cirurgico_id = ?',
        [agendamento],
      );
      const novo = await tx.incluir(APRESENTADO, {
        agendamento_cirurgico_id: agendamento,
        sequencia: num(seq?.['s']) + 1,
        tipo_documento_pre_operatorio_id: e.tipo,
        arquivo_id: arquivo,
        situacao: e.situacao,
        apresentado_em: e.situacao === 'apresentado' ? `${e.apresentadoEm} 00:00:00` : null,
        valido_ate: e.situacao === 'apresentado' ? (e.validoAte ?? null) : null,
        conferido_por_usuario_id: usuario,
        conferido_em: new Date(),
        observacao: e.observacao?.trim() || null,
      });
      return { tabela: APRESENTADO, id: novo, agendamento };
    });
  }

  /** Os tipos, as regras do estabelecimento e as opções para montar uma regra. */
  configuracao(c: ContextoPortaPropria) {
    return this.ler(c, 'configuracao', async (l, est) => {
      const tipos = await l.consultar<Linha>(
        `SELECT id, codigo, descricao, categoria, ativo, obrigatorio, validade_dias, gera_pendencia
           FROM tipo_documento_pre_operatorio ORDER BY descricao`,
      );
      const regras = await l.consultar<Linha>(
        `SELECT r.id, r.versao, r.tipo_documento_pre_operatorio_id AS tipo, t.descricao AS tipo_descricao,
                r.procedimento_cirurgico_id AS procedimento, p.descricao AS procedimento_descricao,
                r.fonte_pagadora_id AS fonte, f.nome AS fonte_nome, r.faixa_etaria_id AS faixa,
                fe.descricao AS faixa_descricao, r.validade_dias, r.bloqueia_entrada_sala, r.gera_pendencia, r.ativo
           FROM documento_exigido_cirurgia r
           JOIN tipo_documento_pre_operatorio t ON t.id = r.tipo_documento_pre_operatorio_id
           LEFT JOIN procedimento_cirurgico p ON p.id = r.procedimento_cirurgico_id
           LEFT JOIN fonte_pagadora f ON f.id = r.fonte_pagadora_id
           LEFT JOIN faixa_etaria fe ON fe.id = r.faixa_etaria_id
          WHERE r.estabelecimento_id = ?
          ORDER BY r.ativo DESC, t.descricao, r.id`,
        [est.id],
      );
      const procedimentos = await l.consultar<Linha>(
        'SELECT id, codigo, descricao FROM procedimento_cirurgico WHERE ativo ORDER BY descricao LIMIT 500',
      );
      const fontes = await l.consultar<Linha>(
        'SELECT id, codigo, nome FROM fonte_pagadora ORDER BY nome LIMIT 500',
      );
      const faixas = await l.consultar<Linha>(
        'SELECT id, descricao FROM faixa_etaria WHERE ativo ORDER BY ordem',
      );
      return {
        tipos: tipos.map((t) => ({
          id: num(t['id']),
          codigo: String(t['codigo']),
          descricao: String(t['descricao']),
          categoria: String(t['categoria']),
          ativo: bool(t['ativo']),
          obrigatorio: bool(t['obrigatorio']),
          validadeDias: numOuNull(t['validade_dias']),
          geraPendencia: bool(t['gera_pendencia']),
        })),
        regras: regras.map((r) => ({
          id: num(r['id']),
          versao: num(r['versao']),
          tipo: num(r['tipo']),
          tipoDescricao: String(r['tipo_descricao']),
          procedimento: numOuNull(r['procedimento']),
          procedimentoDescricao: txtOuNull(r['procedimento_descricao']),
          fontePagadora: numOuNull(r['fonte']),
          fonteNome: txtOuNull(r['fonte_nome']),
          faixaEtaria: numOuNull(r['faixa']),
          faixaDescricao: txtOuNull(r['faixa_descricao']),
          validadeDias: numOuNull(r['validade_dias']),
          bloqueiaEntradaSala: bool(r['bloqueia_entrada_sala']),
          geraPendencia: bool(r['gera_pendencia']),
          ativo: bool(r['ativo']),
        })),
        opcoes: {
          procedimentos: procedimentos.map((p) => ({
            id: num(p['id']),
            rotulo: `${String(p['codigo'])} · ${String(p['descricao'])}`,
          })),
          fontes: fontes.map((f) => ({
            id: num(f['id']),
            rotulo: `${String(f['codigo'])} · ${String(f['nome'])}`,
          })),
          faixas: faixas.map((f) => ({ id: num(f['id']), rotulo: String(f['descricao']) })),
        },
      };
    });
  }

  /** Inclui o tipo de documento (código único). */
  async incluirTipo(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaTipo, entrada);
    return this.gravar(c, 'cirurgia.documentos.tipo-incluir', [TIPO], async (tx) => {
      const problemas = conferirTipoDocumento({
        codigo: e.codigo,
        descricao: e.descricao,
        categoria: e.categoria,
        validadeDias: e.validadeDias ?? null,
      });
      if (problemas.length) throw recusaRegra('Tipo de documento recusado', problemas);
      const codigo = e.codigo.trim().toUpperCase();
      if (await tx.uma('SELECT id FROM tipo_documento_pre_operatorio WHERE codigo = ?', [codigo]))
        throw new ErroOperacao(
          409,
          'codigo-repetido',
          'Código repetido',
          'Já existe tipo de documento com este código.',
        );
      const novo = await tx.incluir(TIPO, {
        codigo,
        descricao: e.descricao.trim(),
        categoria: e.categoria,
        validade_dias: e.validadeDias ?? null,
        obrigatorio: e.obrigatorio ?? false,
        gera_pendencia: e.geraPendencia ?? true,
      });
      return { tabela: TIPO, id: novo };
    });
  }

  /** Inclui a regra de documento exigido do estabelecimento (sem regra igual ativa ou inativa). */
  async incluirRegra(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaRegra, entrada);
    return this.gravar(c, 'cirurgia.documentos.regra-incluir', [REGRA], async (tx, est) => {
      const t = await tx.uma('SELECT ativo, categoria FROM tipo_documento_pre_operatorio WHERE id = ?', [
        e.tipo,
      ]);
      const r = {
        tipo: e.tipo,
        procedimento: e.procedimento ?? null,
        fontePagadora: e.fontePagadora ?? null,
        faixaEtaria: e.faixaEtaria ?? null,
        validadeDias: e.validadeDias ?? null,
        bloqueiaEntradaSala: e.bloqueiaEntradaSala ?? false,
        geraPendencia: e.geraPendencia ?? true,
      };
      const problemas = conferirRegraDocumento(
        r,
        t ? { ativo: bool(t['ativo']), categoria: String(t['categoria']) } : null,
      );
      if (problemas.length) throw recusaRegra('Regra de documento recusada', problemas);
      const igual = await tx.uma(
        `SELECT id FROM documento_exigido_cirurgia
          WHERE estabelecimento_id = ? AND tipo_documento_pre_operatorio_id = ?
            AND procedimento_cirurgico_id <=> ? AND fonte_pagadora_id <=> ? AND faixa_etaria_id <=> ?`,
        [est.id, r.tipo, r.procedimento, r.fontePagadora, r.faixaEtaria],
      );
      if (igual)
        throw new ErroOperacao(
          409,
          'regra-repetida',
          'Regra repetida',
          'Já existe regra igual para este documento: reative ou ajuste a existente.',
        );
      const novo = await tx.incluir(REGRA, {
        estabelecimento_id: est.id,
        tipo_documento_pre_operatorio_id: r.tipo,
        procedimento_cirurgico_id: r.procedimento,
        fonte_pagadora_id: r.fontePagadora,
        faixa_etaria_id: r.faixaEtaria,
        validade_dias: r.validadeDias,
        obrigatorio: true,
        bloqueia_entrada_sala: r.bloqueiaEntradaSala,
        gera_pendencia: r.geraPendencia,
      });
      return { tabela: REGRA, id: novo };
    });
  }

  /** Ativa ou desativa a regra pela versão lida (nunca apagada). */
  async ativarRegra(c: ContextoPortaPropria, regra: number, entrada: unknown) {
    const e = entradaValida(esquemaAtivo, entrada);
    return this.gravar(c, 'cirurgia.documentos.regra-ativar', [REGRA], async (tx, est) => {
      const r = await tx.uma(
        'SELECT id FROM documento_exigido_cirurgia WHERE id = ? AND estabelecimento_id = ?',
        [regra, est.id],
      );
      if (!r) throw naoEncontrado('Regra de documento');
      await tx.alterar(REGRA, regra, e.versao, { ativo: e.ativo });
      return { tabela: REGRA, id: regra };
    });
  }
}
