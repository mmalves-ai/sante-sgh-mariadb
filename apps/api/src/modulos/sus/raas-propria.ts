// RAAS da atenção psicossocial e da atenção domiciliar no banco do cliente (F8, 06-SUS linha 64). As regras são as puras
// de @sgh/dominio-faturamento (raas.ts); aqui ficam a leitura e a gravação.
// Contrato de efeito:
//   - incluir o registro: uma linha em `registro_raas` (aberto, número pela sequencia_negocio) na competência SUS do
//     instrumento RAAS (aberta aqui quando ainda não existe; fechada ou enviada recusa); o mesmo paciente, tipo e
//     competência é recusado; o CID principal é resolvido pelo código na CID-10;
//   - lançar ação: uma linha em `registro_raas_procedimento` (sequência seguinte), com o procedimento da tabela unificada
//     que tem o instrumento do tipo (08 ou 09) e o CBO resolvidos pelo código; retirar marca `excluido_em` (nada apagado);
//   - concluir: data de conclusão e destino; continuar: o registro novo na competência seguinte, ligado ao anterior;
//   - criticar a competência: `critica_sus` por registro (regra, chave estável, gravidade); a crítica que não volta passa
//     a corrigida; a competência guarda `criticada_em`;
//   - gerar a remessa: o arquivo guardado (imutável), o registro em `arquivo` com a guarda legal, a `remessa_raas`
//     gerada com o hash e as contagens, a remessa anterior da mesma competência e tipo substituída e os registros
//     exportados ligados à remessa. Crítica bloqueante aberta recusa sem gravar.
// A trilha de cada gravação vai pelo executor (mesma transação).
import { createHash } from 'node:crypto';
import {
  type AcaoRaas,
  chaveCriticaRaas,
  conferirAcaoRaas,
  conferirCabecalhoRaas,
  conferirConclusaoRaas,
  continuacaoRaas,
  criticarRegistroRaas,
  gerarArquivoRaas,
  intervaloDaCompetencia,
  LEIAUTE_RAAS,
  type LocalRaas,
  recusaGerarRemessaRaas,
  registroSigtap,
  type RegistroSigtap,
  TIPOS_RAAS,
  type TipoRaas,
} from '@sgh/dominio-faturamento';
import { garantirSequencia, type Leitor, type TxOperacao } from '@sgh/nucleo';
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
import type { ArmazemArquivoSus } from './servico.js';

export const PORTA_RAAS = Symbol('PORTA_RAAS');

const T_REGISTRO = 'registro_raas';
const T_ACAO = 'registro_raas_procedimento';
const T_REMESSA = 'remessa_raas';
const T_COMPETENCIA = 'competencia_sus';
const T_CRITICA = 'critica_sus';
const T_ARQUIVO = 'arquivo';
const T_SEQUENCIA = 'sequencia_negocio';
const TABELAS = [T_REGISTRO, T_ACAO, T_REMESSA, T_COMPETENCIA, T_CRITICA, T_ARQUIVO, T_SEQUENCIA];
export const SEQUENCIA_REGISTRO_RAAS = 'registro_raas';
export const SEQUENCIA_REMESSA_RAAS = 'remessa_raas';
const ANOS_GUARDA = 5;

type Consulta = Pick<Leitor, 'consultar' | 'uma'>;

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const competencia = z.string().regex(/^\d{4}(0[1-9]|1[0-2])$/);
const cid = z
  .string()
  .trim()
  .regex(/^[A-Za-z]\d{2}\.?\d?$/);
const versao = z.number().int().positive();
const tipo = z.enum(TIPOS_RAAS);

const esquemaRegistro = z
  .object({
    tipo,
    competencia,
    paciente: z.number().int().positive(),
    atendimento: z.number().int().positive().nullable().default(null),
    dataAdmissao: dia,
    cidPrincipal: cid,
    cidSecundarios: z.array(cid).max(3).default([]),
    cidAssociado: cid.nullable().default(null),
    estrategiaSaudeFamilia: z.boolean().default(false),
    cnesSaudeFamilia: z
      .string()
      .regex(/^\d{7}$/)
      .nullable()
      .default(null),
    responsavel: z.string().trim().max(150).nullable().default(null),
  })
  .strict();
const esquemaAcao = z
  .object({
    procedimento: z.string().regex(/^\d{10}$/),
    cbo: z.string().regex(/^[0-9A-Za-z]{6}$/),
    profissional: z.number().int().positive().nullable().default(null),
    dataInicio: dia,
    dataFim: dia.nullable().default(null),
    quantidade: z.number().int().positive().max(9999),
    local: z.enum(['unidade', 'territorio', 'domicilio']).default('unidade'),
    cid: cid.nullable().default(null),
    versao,
  })
  .strict();
const esquemaConclusao = z
  .object({ dataConclusao: dia, destino: z.number().int().positive(), versao })
  .strict();
const esquemaVersao = z.object({ versao }).strict();
const esquemaCompetenciaTipo = z.object({ competencia, tipo }).strict();
const esquemaRemessa = z
  .object({
    competencia,
    tipo,
    orgaoDestino: z.string().trim().min(3).max(40),
    indicadorDestino: z.enum(['M', 'E']),
  })
  .strict();

const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const semPonto = (c: string) => c.replace('.', '').toUpperCase();

export interface RegistroRaasLido {
  readonly id: number;
  readonly numero: string;
  readonly tipo: TipoRaas;
  readonly competencia: string;
  readonly paciente: number;
  readonly pacienteNome: string;
  readonly prontuario: string;
  readonly dataAdmissao: string;
  readonly dataConclusao: string | null;
  readonly situacao: string;
  readonly cidPrincipal: string | null;
  readonly continuacao: number | null;
  readonly remessa: number | null;
  readonly acoes: number;
  readonly criticasAbertas: number;
  readonly bloqueantes: number;
  readonly versao: number;
}

export interface AcaoRaasLida {
  readonly id: number;
  readonly sequencia: number;
  readonly procedimento: string;
  readonly procedimentoDescricao: string;
  readonly cbo: string;
  readonly profissional: number | null;
  readonly dataInicio: string;
  readonly dataFim: string | null;
  readonly quantidade: number;
  readonly local: LocalRaas;
  readonly cid: string | null;
  readonly versao: number;
}

const SQL_REGISTRO = `SELECT r.id, r.numero, r.tipo_raas, cs.competencia, r.paciente_id, pf.nome, p.numero_prontuario,
         r.data_admissao, r.data_conclusao, r.situacao, t.codigo_termo AS cid, r.continuacao_registro_raas_id,
         r.remessa_raas_id, r.versao,
         (SELECT COUNT(*) FROM registro_raas_procedimento a WHERE a.registro_raas_id = r.id AND a.excluido_em IS NULL) AS acoes,
         (SELECT COUNT(*) FROM critica_sus k WHERE k.registro_raas_id = r.id AND k.situacao = 'aberta') AS abertas,
         (SELECT COUNT(*) FROM critica_sus k WHERE k.registro_raas_id = r.id AND k.situacao = 'aberta'
             AND k.gravidade = 'bloqueante') AS bloqueantes
    FROM registro_raas r
    JOIN competencia_sus cs ON cs.id = r.competencia_sus_id
    JOIN paciente p ON p.id = r.paciente_id
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    LEFT JOIN termo_terminologia t ON t.id = r.cid_principal_termo_terminologia_id
   WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL`;

const registroDe = (r: Record<string, unknown>): RegistroRaasLido => ({
  id: num(r['id']),
  numero: String(r['numero']),
  tipo: String(r['tipo_raas']) as TipoRaas,
  competencia: String(r['competencia']),
  paciente: num(r['paciente_id']),
  pacienteNome: String(r['nome'] ?? ''),
  prontuario: String(r['numero_prontuario'] ?? ''),
  dataAdmissao: dataIso(r['data_admissao'])!,
  dataConclusao: dataIso(r['data_conclusao']),
  situacao: String(r['situacao']),
  cidPrincipal: txtOuNull(r['cid']),
  continuacao: numOuNull(r['continuacao_registro_raas_id']),
  remessa: numOuNull(r['remessa_raas_id']),
  acoes: num(r['acoes']),
  criticasAbertas: num(r['abertas']),
  bloqueantes: num(r['bloqueantes']),
  versao: num(r['versao']),
});

const SQL_ACAO = `SELECT a.id, a.sequencia, ps.codigo_sigtap, ps.descricao, o.codigo_cbo, a.profissional_id, a.data_inicio,
         a.data_fim, a.quantidade, a.local_realizacao, t.codigo_termo AS cid, a.versao, pfp.cns AS cns_profissional,
         (SELECT GROUP_CONCAT(d.codigo_sigtap) FROM procedimento_sigtap_registro g
            JOIN dominio_sigtap d ON d.id = g.instrumento_dominio_sigtap_id
           WHERE g.procedimento_sigtap_id = a.procedimento_sigtap_id) AS registros
    FROM registro_raas_procedimento a
    JOIN procedimento_sigtap ps ON ps.id = a.procedimento_sigtap_id
    JOIN ocupacao_cbo o ON o.id = a.ocupacao_cbo_id
    LEFT JOIN profissional pr ON pr.id = a.profissional_id
    LEFT JOIN pessoa_fisica pfp ON pfp.id = pr.pessoa_fisica_id
    LEFT JOIN termo_terminologia t ON t.id = a.cid_termo_terminologia_id
   WHERE a.registro_raas_id = ? AND a.excluido_em IS NULL
   ORDER BY a.sequencia`;

const registrosDoTexto = (v: unknown): RegistroSigtap[] =>
  String(v ?? '')
    .split(',')
    .map((x) => registroSigtap(x))
    .filter((x): x is RegistroSigtap => x !== null);

const acaoDe = (
  r: Record<string, unknown>,
): AcaoRaasLida & { cnsProfissional: string | null; registros: RegistroSigtap[] } => ({
  id: num(r['id']),
  sequencia: num(r['sequencia']),
  procedimento: String(r['codigo_sigtap']),
  procedimentoDescricao: String(r['descricao'] ?? ''),
  cbo: String(r['codigo_cbo']),
  profissional: numOuNull(r['profissional_id']),
  dataInicio: dataIso(r['data_inicio'])!,
  dataFim: dataIso(r['data_fim']),
  quantidade: num(r['quantidade']),
  local: String(r['local_realizacao']) as LocalRaas,
  cid: txtOuNull(r['cid']),
  versao: num(r['versao']),
  cnsProfissional: txtOuNull(r['cns_profissional']),
  registros: registrosDoTexto(r['registros']),
});

async function idDoCid(l: Consulta, codigo: string | null, campo: string): Promise<number | null> {
  if (!codigo) return null;
  const c = semPonto(codigo);
  const t = await l.uma(
    `SELECT t.id FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id
      WHERE g.codigo = 'cid10' AND REPLACE(t.codigo_termo, '.', '') = ? ORDER BY t.ativo DESC, t.id LIMIT 1`,
    [c],
  );
  if (!t)
    throw recusaRegra('CID inexistente', [{ campo, mensagem: `O CID ${codigo} não existe na CID-10.` }]);
  return num(t['id']);
}

export class PortaRaasPropria extends PortaEstabelecimentoPropria {
  constructor(
    nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0],
    cliente: string,
    private readonly armazem: ArmazemArquivoSus,
  ) {
    super(nucleo, cliente, TABELAS, 'faturamento.raas');
  }

  /** O painel da competência: registros (com contagens de ação e crítica) e remessas do tipo, ou de um paciente. */
  painel(c: ContextoPortaPropria, comp: string, tipoRaas: TipoRaas | null, paciente: number | null) {
    if (!competencia.safeParse(comp).success)
      throw recusaRegra('Competência inválida', [
        { campo: 'competencia', mensagem: 'Use a competência AAAAMM.' },
      ]);
    return this.ler(c, 'painel', async (l, est) => {
      const filtros: string[] = [];
      const p: unknown[] = [est.id];
      if (paciente) {
        filtros.push('r.paciente_id = ?');
        p.push(paciente);
      } else {
        filtros.push('cs.competencia = ?');
        p.push(comp);
      }
      if (tipoRaas) {
        filtros.push('r.tipo_raas = ?');
        p.push(tipoRaas);
      }
      const registros = (
        await l.consultar(
          `${SQL_REGISTRO} AND ${filtros.join(' AND ')} ORDER BY cs.competencia DESC, pf.nome, r.id LIMIT 1000`,
          p,
        )
      ).map(registroDe);
      const remessas = (
        await l.consultar(
          `SELECT x.id, x.numero, x.tipo_raas, x.situacao, x.quantidade_registros, x.quantidade_procedimentos,
                  x.nome_arquivo, x.hash_sha256, x.conferido_contra_oficial, x.gerada_em, x.versao
             FROM remessa_raas x JOIN competencia_sus cs ON cs.id = x.competencia_sus_id
            WHERE x.estabelecimento_id = ? AND cs.competencia = ? AND x.excluido_em IS NULL
            ORDER BY x.id DESC`,
          [est.id, comp],
        )
      ).map((x) => ({
        id: num(x['id']),
        numero: String(x['numero']),
        tipo: String(x['tipo_raas']),
        situacao: String(x['situacao']),
        registros: num(x['quantidade_registros']),
        procedimentos: Number(x['quantidade_procedimentos'] ?? 0),
        nomeArquivo: txtOuNull(x['nome_arquivo']),
        hash: txtOuNull(x['hash_sha256']),
        conferidoContraOficial: bool(x['conferido_contra_oficial']),
        geradaEm: x['gerada_em'] instanceof Date ? x['gerada_em'].toISOString() : txtOuNull(x['gerada_em']),
        versao: num(x['versao']),
      }));
      const cmp = await l.uma(
        `SELECT situacao, criticada_em FROM competencia_sus
          WHERE estabelecimento_id = ? AND instrumento = 'raas' AND competencia = ? AND excluido_em IS NULL`,
        [est.id, comp],
      );
      return {
        competencia: comp,
        situacaoCompetencia: cmp ? String(cmp['situacao']) : null,
        criticadaEm: cmp?.['criticada_em'] instanceof Date ? cmp['criticada_em'].toISOString() : null,
        conferidoContraOficial: LEIAUTE_RAAS.conferidoContraOficial,
        registros,
        remessas,
      };
    });
  }

  /** O registro com as ações e as críticas abertas. */
  detalhe(c: ContextoPortaPropria, id: number) {
    return this.ler(c, 'detalhe', async (l, est) => {
      const r = await l.uma(`${SQL_REGISTRO} AND r.id = ?`, [est.id, id]);
      if (!r) throw naoEncontrado('Registro RAAS');
      // O CNS do profissional e os instrumentos ficam no servidor (a crítica usa); a tela recebe a ação.
      const acoes = (await l.consultar(SQL_ACAO, [id])).map((a): AcaoRaasLida => {
        const x = acaoDe(a);
        return {
          id: x.id,
          sequencia: x.sequencia,
          procedimento: x.procedimento,
          procedimentoDescricao: x.procedimentoDescricao,
          cbo: x.cbo,
          profissional: x.profissional,
          dataInicio: x.dataInicio,
          dataFim: x.dataFim,
          quantidade: x.quantidade,
          local: x.local,
          cid: x.cid,
          versao: x.versao,
        };
      });
      const criticas = (
        await l.consultar(
          `SELECT id, codigo_regra, gravidade, descricao, situacao FROM critica_sus
            WHERE registro_raas_id = ? AND situacao IN ('aberta','justificada') ORDER BY gravidade, id`,
          [id],
        )
      ).map((k) => ({
        id: num(k['id']),
        regra: String(k['codigo_regra'] ?? ''),
        gravidade: String(k['gravidade']),
        descricao: String(k['descricao']),
        situacao: String(k['situacao']),
      }));
      return { ...registroDe(r), acoes, criticas };
    });
  }

  /** Opções do formulário: o destino do paciente na conclusão (motivo de saída da tabela do SUS). */
  opcoes(c: ContextoPortaPropria) {
    return this.ler(c, 'opcoes', async (l) => {
      const lista = async (nome: string) =>
        (
          await l.consultar(
            `SELECT id, codigo, descricao FROM dominio_sus WHERE lista = ? AND ativo = TRUE ORDER BY ordem, codigo`,
            [nome],
          )
        ).map((x) => ({ id: num(x['id']), descricao: `${String(x['codigo'])} · ${String(x['descricao'])}` }));
      return { destinos: await lista('motivo_saida') };
    });
  }

  buscarPacientes(c: ContextoPortaPropria, busca: string) {
    const b = busca.trim();
    if (b.length < 2) return Promise.resolve([]);
    const porNumero = /^\d+$/.test(b);
    return this.ler(c, 'pacientes', async (l) =>
      (
        await l.consultar(
          `SELECT p.id, pf.nome, p.numero_prontuario FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
            WHERE p.excluido_em IS NULL AND ${porNumero ? 'p.numero_prontuario = ?' : 'pf.nome LIKE ?'}
            ORDER BY pf.nome LIMIT 20`,
          [porNumero ? Number(b) : `${b.replace(/[%_\\]/g, '\\$&')}%`],
        )
      ).map((r) => ({
        id: num(r['id']),
        nome: String(r['nome']),
        prontuario: String(r['numero_prontuario']),
      })),
    );
  }

  /** A competência SUS do instrumento RAAS, aberta aqui quando falta; fechada ou enviada recusa o lançamento. */
  private async competenciaAberta(tx: TxOperacao, est: number, comp: string): Promise<number> {
    const [x] = await tx.consultarParaAtualizar(
      `SELECT id, situacao FROM competencia_sus
        WHERE estabelecimento_id = ? AND instrumento = 'raas' AND competencia = ? AND excluido_em IS NULL`,
      [est, comp],
    );
    if (x) {
      if (!['aberta', 'reaberta'].includes(String(x['situacao'])))
        throw recusaRegra('Competência fechada', [
          {
            campo: 'competencia',
            mensagem: `A competência ${comp} da RAAS não aceita lançamento (${String(x['situacao'])}).`,
          },
        ]);
      return num(x['id']);
    }
    const { inicio, fim } = intervaloDaCompetencia(comp);
    return tx.incluir(T_COMPETENCIA, {
      estabelecimento_id: est,
      instrumento: 'raas',
      competencia: comp,
      periodo_inicio: inicio,
      periodo_fim: fim,
      situacao: 'aberta',
      aberta_em: new Date(),
      aberta_por_usuario_id: tx.contexto.usuario,
    });
  }

  private async registroParaAtualizar(tx: TxOperacao, est: number, id: number) {
    const [r] = await tx.consultarParaAtualizar(
      `SELECT r.*, cs.competencia FROM registro_raas r JOIN competencia_sus cs ON cs.id = r.competencia_sus_id
        WHERE r.id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL`,
      [id, est],
    );
    if (!r) throw naoEncontrado('Registro RAAS');
    return r;
  }

  private static aberto(r: Record<string, unknown>) {
    if (String(r['situacao']) !== 'aberto')
      throw recusaRegra('Registro não aceita mudança', [
        {
          campo: 'situacao',
          mensagem: `O registro está ${String(r['situacao'])}: só o aberto aceita mudança.`,
        },
      ]);
  }

  async incluirRegistro(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number; numero: string }> {
    const e = entradaValida(esquemaRegistro, entrada);
    const p = conferirCabecalhoRaas({ ...e, dataConclusao: null, destino: null });
    if (p.length) throw recusaRegra('Registro RAAS recusado', p);
    return this.gravar(c, 'faturamento.sus.raas.incluir', TABELAS, async (tx, est, usuario) => {
      const pac = await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [e.paciente]);
      if (!pac) throw naoEncontrado('Paciente');
      if (e.atendimento !== null) {
        const at = await tx.uma(
          'SELECT id FROM atendimento WHERE id = ? AND paciente_id = ? AND excluido_em IS NULL',
          [e.atendimento, e.paciente],
        );
        if (!at) throw naoEncontrado('Atendimento do paciente');
      }
      const comp = await this.competenciaAberta(tx, est.id, e.competencia);
      const igual = await tx.uma(
        `SELECT numero FROM registro_raas WHERE competencia_sus_id = ? AND paciente_id = ? AND tipo_raas = ?`,
        [comp, e.paciente, e.tipo],
      );
      if (igual)
        throw recusaRegra('Registro RAAS recusado', [
          {
            campo: 'paciente',
            mensagem: `O paciente já tem o registro ${String(igual['numero'])} deste tipo nesta competência: lance a ação nele.`,
          },
        ]);
      const cids = [
        await idDoCid(tx, e.cidPrincipal, 'cidPrincipal'),
        ...(await Promise.all(e.cidSecundarios.map((x) => idDoCid(tx, x, 'cidSecundarios')))),
      ];
      await garantirSequencia(
        tx,
        { tipo: SEQUENCIA_REGISTRO_RAAS, estabelecimento: est.id, prefixo: 'RA-' },
        { usuario, agora: new Date() },
      );
      const numero = (await tx.proximoNumero(SEQUENCIA_REGISTRO_RAAS)).formatado;
      const id = await tx.incluir(T_REGISTRO, {
        estabelecimento_id: est.id,
        numero,
        tipo_raas: e.tipo,
        competencia_sus_id: comp,
        paciente_id: e.paciente,
        atendimento_id: e.atendimento,
        data_admissao: e.dataAdmissao,
        cid_principal_termo_terminologia_id: cids[0],
        cid_secundario1_termo_terminologia_id: cids[1] ?? null,
        cid_secundario2_termo_terminologia_id: cids[2] ?? null,
        cid_secundario3_termo_terminologia_id: cids[3] ?? null,
        cid_causa_associada_termo_terminologia_id: await idDoCid(tx, e.cidAssociado, 'cidAssociado'),
        estrategia_saude_familia: e.estrategiaSaudeFamilia,
        cnes_unidade_saude_familia: e.cnesSaudeFamilia,
        responsavel_nome: e.responsavel,
        situacao: 'aberto',
      });
      return { tabela: T_REGISTRO, id, numero };
    });
  }

  async lancarAcao(
    c: ContextoPortaPropria,
    registro: number,
    entrada: unknown,
  ): Promise<{ id: number; sequencia: number }> {
    const e = entradaValida(esquemaAcao, entrada);
    return this.gravar(c, 'faturamento.sus.raas.lancar', TABELAS, async (tx, est) => {
      const r = await this.registroParaAtualizar(tx, est.id, registro);
      PortaRaasPropria.aberto(r);
      const proc = await tx.uma(
        `SELECT ps.id, (SELECT GROUP_CONCAT(d.codigo_sigtap) FROM procedimento_sigtap_registro g
                          JOIN dominio_sigtap d ON d.id = g.instrumento_dominio_sigtap_id
                         WHERE g.procedimento_sigtap_id = ps.id AND g.vigencia_fim IS NULL) AS registros
           FROM procedimento_sigtap ps WHERE ps.codigo_sigtap = ? ORDER BY ps.vigencia_fim IS NULL DESC, ps.id DESC LIMIT 1`,
        [e.procedimento],
      );
      if (!proc) throw naoEncontrado('Procedimento da tabela unificada');
      const cbo = await tx.uma('SELECT id FROM ocupacao_cbo WHERE codigo_cbo = ? ORDER BY id LIMIT 1', [
        e.cbo,
      ]);
      if (!cbo) throw naoEncontrado('Ocupação (CBO)');
      if (e.profissional !== null) {
        const pr = await tx.uma('SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL', [
          e.profissional,
        ]);
        if (!pr) throw naoEncontrado('Profissional');
      }
      const tipoR = String(r['tipo_raas']) as TipoRaas;
      const p = conferirAcaoRaas(
        tipoR,
        String(r['competencia']),
        dataIso(r['data_admissao'])!,
        {
          procedimento: e.procedimento,
          registros: registrosDoTexto(proc['registros']),
          cbo: e.cbo,
          cnsProfissional: null,
          dataInicio: e.dataInicio,
          dataFim: e.dataFim,
          quantidade: e.quantidade,
          local: e.local,
          cid: e.cid,
        },
        dataIso(r['data_conclusao']),
      );
      if (p.length) throw recusaRegra('Ação recusada', p);
      const seq = await tx.uma(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM registro_raas_procedimento WHERE registro_raas_id = ?',
        [registro],
      );
      const sequencia = num(seq?.['s']);
      const id = await tx.incluir(T_ACAO, {
        registro_raas_id: registro,
        sequencia,
        procedimento_sigtap_id: num(proc['id']),
        ocupacao_cbo_id: num(cbo['id']),
        profissional_id: e.profissional,
        data_inicio: e.dataInicio,
        data_fim: e.dataFim,
        quantidade: e.quantidade,
        local_realizacao: e.local,
        cid_termo_terminologia_id: await idDoCid(tx, e.cid, 'cid'),
      });
      await tx.alterar(T_REGISTRO, registro, e.versao, {});
      return { tabela: T_ACAO, id, sequencia };
    });
  }

  /** Retira a ação lançada por engano: marca `excluido_em` (nada apagado); só no registro aberto. */
  async retirarAcao(c: ContextoPortaPropria, acao: number, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaVersao, entrada);
    return this.gravar(c, 'faturamento.sus.raas.retirar', TABELAS, async (tx, est, usuario) => {
      const a = await tx.uma(
        `SELECT a.registro_raas_id FROM registro_raas_procedimento a JOIN registro_raas r ON r.id = a.registro_raas_id
          WHERE a.id = ? AND r.estabelecimento_id = ? AND a.excluido_em IS NULL`,
        [acao, est.id],
      );
      if (!a) throw naoEncontrado('Ação da RAAS');
      PortaRaasPropria.aberto(await this.registroParaAtualizar(tx, est.id, num(a['registro_raas_id'])));
      await tx.alterar(T_ACAO, acao, e.versao, { excluido_em: new Date(), excluido_por: usuario });
      return { tabela: T_ACAO, id: acao };
    });
  }

  async concluir(c: ContextoPortaPropria, id: number, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaConclusao, entrada);
    return this.gravar(c, 'faturamento.sus.raas.concluir', TABELAS, async (tx, est) => {
      const r = await this.registroParaAtualizar(tx, est.id, id);
      PortaRaasPropria.aberto(r);
      const d = await tx.uma(`SELECT id FROM dominio_sus WHERE id = ? AND lista = 'motivo_saida'`, [
        e.destino,
      ]);
      if (!d) throw naoEncontrado('Destino do paciente');
      const p = conferirCabecalhoRaas({
        tipo: String(r['tipo_raas']) as TipoRaas,
        competencia: String(r['competencia']),
        dataAdmissao: dataIso(r['data_admissao'])!,
        dataConclusao: e.dataConclusao,
        destino: e.destino,
        estrategiaSaudeFamilia: bool(r['estrategia_saude_familia']),
        cnesSaudeFamilia: txtOuNull(r['cnes_unidade_saude_familia']),
      });
      p.push(...conferirConclusaoRaas(e.dataConclusao, (await tx.consultar(SQL_ACAO, [id])).map(acaoDe)));
      if (p.length) throw recusaRegra('Conclusão recusada', p);
      await tx.alterar(T_REGISTRO, id, e.versao, {
        data_conclusao: e.dataConclusao,
        destino_dominio_sus_id: e.destino,
      });
      return { tabela: T_REGISTRO, id };
    });
  }

  /** O acompanhamento continua na competência seguinte: registro novo ligado ao anterior, mesma admissão e CID. */
  async continuar(
    c: ContextoPortaPropria,
    id: number,
    entrada: unknown,
  ): Promise<{ id: number; numero: string; competencia: string }> {
    entradaValida(esquemaVersao, entrada);
    return this.gravar(c, 'faturamento.sus.raas.continuar', TABELAS, async (tx, est, usuario) => {
      const r = await this.registroParaAtualizar(tx, est.id, id);
      const prox = continuacaoRaas({
        competencia: String(r['competencia']),
        dataConclusao: dataIso(r['data_conclusao']),
        situacao: String(r['situacao']),
      });
      if ('campo' in prox) throw recusaRegra('Continuação recusada', [prox]);
      const ja = await tx.uma('SELECT numero FROM registro_raas WHERE continuacao_registro_raas_id = ?', [
        id,
      ]);
      if (ja)
        throw recusaRegra('Continuação recusada', [
          { campo: 'continuacao', mensagem: `O registro já continua em ${String(ja['numero'])}.` },
        ]);
      const comp = await this.competenciaAberta(tx, est.id, prox.competencia);
      const igual = await tx.uma(
        'SELECT numero FROM registro_raas WHERE competencia_sus_id = ? AND paciente_id = ? AND tipo_raas = ?',
        [comp, r['paciente_id'], r['tipo_raas']],
      );
      if (igual)
        throw recusaRegra('Continuação recusada', [
          {
            campo: 'paciente',
            mensagem: `O paciente já tem o registro ${String(igual['numero'])} em ${prox.competencia}.`,
          },
        ]);
      await garantirSequencia(
        tx,
        { tipo: SEQUENCIA_REGISTRO_RAAS, estabelecimento: est.id, prefixo: 'RA-' },
        { usuario, agora: new Date() },
      );
      const numero = (await tx.proximoNumero(SEQUENCIA_REGISTRO_RAAS)).formatado;
      const copia = [
        'paciente_id',
        'atendimento_id',
        'data_admissao',
        'origem_paciente_dominio_sus_id',
        'cid_principal_termo_terminologia_id',
        'cid_secundario1_termo_terminologia_id',
        'cid_secundario2_termo_terminologia_id',
        'cid_secundario3_termo_terminologia_id',
        'cid_causa_associada_termo_terminologia_id',
        'estrategia_saude_familia',
        'cnes_unidade_saude_familia',
        'responsavel_nome',
      ];
      const novo = await tx.incluir(T_REGISTRO, {
        ...Object.fromEntries(copia.map((k) => [k, k === 'data_admissao' ? dataIso(r[k]) : r[k]])),
        estrategia_saude_familia: bool(r['estrategia_saude_familia']),
        estabelecimento_id: est.id,
        numero,
        tipo_raas: r['tipo_raas'],
        competencia_sus_id: comp,
        continuacao_registro_raas_id: id,
        situacao: 'aberto',
      });
      return { tabela: T_REGISTRO, id: novo, numero, competencia: prox.competencia };
    });
  }

  private async paraCritica(l: Consulta, est: number, comp: string, tipoRaas: TipoRaas) {
    const regs = await l.consultar(
      `SELECT r.id, r.tipo_raas, r.data_admissao, r.data_conclusao, r.destino_dominio_sus_id, r.estrategia_saude_familia,
              r.cnes_unidade_saude_familia, t.codigo_termo AS cid, pf.cns, pf.cpf, pf.nome, pf.data_nascimento, pf.nome_mae,
              r.numero, r.situacao, r.competencia_sus_id, ds.codigo AS destino, os.codigo AS origem,
              t1.codigo_termo AS cid1, t2.codigo_termo AS cid2, t3.codigo_termo AS cid3, ta.codigo_termo AS cida,
              ant.numero AS continuacao
         FROM registro_raas r
         JOIN competencia_sus cs ON cs.id = r.competencia_sus_id
         JOIN paciente p ON p.id = r.paciente_id
         JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
         LEFT JOIN termo_terminologia t ON t.id = r.cid_principal_termo_terminologia_id
         LEFT JOIN termo_terminologia t1 ON t1.id = r.cid_secundario1_termo_terminologia_id
         LEFT JOIN termo_terminologia t2 ON t2.id = r.cid_secundario2_termo_terminologia_id
         LEFT JOIN termo_terminologia t3 ON t3.id = r.cid_secundario3_termo_terminologia_id
         LEFT JOIN termo_terminologia ta ON ta.id = r.cid_causa_associada_termo_terminologia_id
         LEFT JOIN dominio_sus ds ON ds.id = r.destino_dominio_sus_id
         LEFT JOIN dominio_sus os ON os.id = r.origem_paciente_dominio_sus_id
         LEFT JOIN registro_raas ant ON ant.id = r.continuacao_registro_raas_id
        WHERE r.estabelecimento_id = ? AND cs.competencia = ? AND cs.instrumento = 'raas' AND r.tipo_raas = ?
          AND r.situacao IN ('aberto','fechado','exportado') AND r.excluido_em IS NULL
          AND NOT EXISTS (SELECT 1 FROM remessa_raas rr WHERE rr.id = r.remessa_raas_id AND rr.situacao = 'enviada')
        ORDER BY r.id`,
      [est, comp, tipoRaas],
    );
    const out = [];
    for (const r of regs) {
      const acoes = (await l.consultar(SQL_ACAO, [r['id']])).map(acaoDe);
      out.push({ linha: r, acoes });
    }
    return out;
  }

  /** A crítica do domínio sobre o estado atual dos registros lidos (usada na crítica e de novo na remessa). */
  private static criticasDe(
    lidos: Awaited<ReturnType<PortaRaasPropria['paraCritica']>>,
    tipo: TipoRaas,
    competencia: string,
  ) {
    return lidos.flatMap(({ linha: r, acoes }) =>
      criticarRegistroRaas({
        id: num(r['id']),
        tipo,
        competencia,
        dataAdmissao: dataIso(r['data_admissao'])!,
        dataConclusao: dataIso(r['data_conclusao']),
        destino: numOuNull(r['destino_dominio_sus_id']),
        estrategiaSaudeFamilia: bool(r['estrategia_saude_familia']),
        cnesSaudeFamilia: txtOuNull(r['cnes_unidade_saude_familia']),
        cidPrincipal: txtOuNull(r['cid']),
        cnsPaciente: txtOuNull(r['cns']),
        cpfPaciente: txtOuNull(r['cpf']),
        acoes: acoes.map((a): AcaoRaas => ({
          sequencia: a.sequencia,
          procedimento: a.procedimento,
          registros: a.registros,
          cbo: a.cbo,
          cnsProfissional: a.cnsProfissional,
          dataInicio: a.dataInicio,
          dataFim: a.dataFim,
          quantidade: a.quantidade,
          local: a.local,
          cid: a.cid,
        })),
      }),
    );
  }

  /** A crítica da competência e tipo: grava as críticas novas, reabre as que voltaram e corrige as que sumiram. */
  async criticar(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{ registros: number; criticas: number; bloqueantes: number; corrigidas: number }> {
    const e = entradaValida(esquemaCompetenciaTipo, entrada);
    return this.gravar(c, 'faturamento.sus.raas.criticar', TABELAS, async (tx, est, usuario) => {
      const comp = await this.competenciaAberta(tx, est.id, e.competencia);
      const lidos = await this.paraCritica(tx, est.id, e.competencia, e.tipo);
      const criticas = PortaRaasPropria.criticasDe(lidos, e.tipo, e.competencia);
      const ids = lidos.map((x) => num(x.linha['id']));
      const existentes = ids.length
        ? await tx.consultarParaAtualizar(
            `SELECT id, chave_critica, situacao, versao FROM critica_sus
              WHERE competencia_sus_id = ? AND registro_raas_id IN (${ids.map(() => '?').join(',')})`,
            [comp, ...ids],
          )
        : [];
      const porChave = new Map(existentes.map((x) => [String(x['chave_critica']), x]));
      const agora = new Date();
      const seq = await tx.uma(
        'SELECT COALESCE(MAX(sequencia), 0) AS s FROM critica_sus WHERE competencia_sus_id = ?',
        [comp],
      );
      let proxima = num(seq?.['s']);
      const vistas = new Set<string>();
      for (const k of criticas) {
        const chave = chaveCriticaRaas(k);
        vistas.add(chave);
        const ja = porChave.get(chave);
        if (ja) {
          if (String(ja['situacao']) === 'corrigida')
            await tx.alterar(T_CRITICA, num(ja['id']), num(ja['versao']), {
              situacao: 'aberta',
              criticada_em: agora,
              tratada_em: null,
              tratada_por_usuario_id: null,
            });
          continue;
        }
        await tx.incluir(T_CRITICA, {
          competencia_sus_id: comp,
          sequencia: ++proxima,
          registro_raas_id: k.registro,
          codigo_regra: k.regra,
          chave_critica: chave,
          descricao: k.mensagem.slice(0, 1000),
          gravidade: k.gravidade,
          situacao: 'aberta',
          criticada_em: agora,
          detalhe: JSON.stringify({ campo: k.campo, sequencia: k.sequencia }),
        });
      }
      let corrigidas = 0;
      for (const x of existentes)
        if (String(x['situacao']) === 'aberta' && !vistas.has(String(x['chave_critica']))) {
          corrigidas++;
          await tx.alterar(T_CRITICA, num(x['id']), num(x['versao']), {
            situacao: 'corrigida',
            tratada_em: agora,
            tratada_por_usuario_id: usuario,
          });
        }
      const cv = await tx.uma('SELECT versao FROM competencia_sus WHERE id = ?', [comp]);
      await tx.alterar(T_COMPETENCIA, comp, num(cv?.['versao']), { criticada_em: agora });
      return {
        tabela: T_COMPETENCIA,
        id: comp,
        registros: lidos.length,
        criticas: criticas.length,
        bloqueantes: criticas.filter((k) => k.gravidade === 'bloqueante').length,
        corrigidas,
      };
    });
  }

  /**
   * Gera a remessa da competência e tipo: recusa com crítica bloqueante aberta; guarda o arquivo (imutável), registra
   * em `arquivo` com a guarda legal, grava a remessa, substitui a anterior e liga os registros exportados.
   */
  async gerarRemessa(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{
    id: number;
    numero: string;
    nome: string;
    hash: string;
    registros: number;
    conteudo: string;
    substituidas: number;
  }> {
    const e = entradaValida(esquemaRemessa, entrada);
    let chave: string | null = null;
    try {
      const r = await this.gravar(c, 'faturamento.sus.raas.remessa', TABELAS, async (tx, est, usuario) => {
        const comp = await this.competenciaAberta(tx, est.id, e.competencia);
        const lidos = await this.paraCritica(tx, est.id, e.competencia, e.tipo);
        const ids = lidos.map((x) => num(x.linha['id']));
        const bloq = ids.length
          ? await tx.uma(
              `SELECT COUNT(*) AS n FROM critica_sus WHERE competencia_sus_id = ? AND situacao = 'aberta'
                 AND gravidade = 'bloqueante' AND registro_raas_id IN (${ids.map(() => '?').join(',')})`,
              [comp, ...ids],
            )
          : null;
        // A crítica gravada pode estar velha (ação lançada ou conclusão depois dela): roda de novo sobre o estado atual.
        const atuais = PortaRaasPropria.criticasDe(lidos, e.tipo, e.competencia).filter(
          (k) => k.gravidade === 'bloqueante',
        );
        const recusa = recusaGerarRemessaRaas(ids.length, Math.max(num(bloq?.['n']), atuais.length));
        if (recusa) throw recusaRegra('Remessa recusada', [recusa]);
        const semCritica = await tx.uma('SELECT criticada_em FROM competencia_sus WHERE id = ?', [comp]);
        if (!semCritica?.['criticada_em'])
          throw recusaRegra('Remessa recusada', [
            { campo: 'criticas', mensagem: 'Rode a crítica antes de gerar.' },
          ]);
        const e2 = await tx.uma('SELECT codigo_cnes, cnpj, razao_social FROM estabelecimento WHERE id = ?', [
          est.id,
        ]);
        if (!/^\d{7}$/.test(String(e2?.['codigo_cnes'] ?? '')))
          throw recusaRegra('Remessa recusada', [
            { campo: 'cnes', mensagem: 'O estabelecimento não tem CNES de 7 dígitos no cadastro.' },
          ]);
        const arq = gerarArquivoRaas(
          {
            competencia: e.competencia,
            tipo: e.tipo,
            cnes: String(e2!['codigo_cnes']),
            cnpj: txtOuNull(e2!['cnpj']),
            orgaoOrigem: String(e2!['razao_social']).slice(0, 30),
            orgaoDestino: e.orgaoDestino,
            indicadorDestino: e.indicadorDestino,
          },
          lidos.map(({ linha: x, acoes }) => ({
            numero: String(x['numero']),
            cnsPaciente: txtOuNull(x['cns']),
            cpfPaciente: txtOuNull(x['cpf']),
            nomePaciente: String(x['nome']).slice(0, 60),
            nascimento: dataIso(x['data_nascimento']),
            nomeMae: txtOuNull(x['nome_mae'])?.slice(0, 60) ?? null,
            dataAdmissao: dataIso(x['data_admissao'])!,
            dataConclusao: dataIso(x['data_conclusao']),
            destino: txtOuNull(x['destino'])?.slice(0, 2) ?? null,
            origem: txtOuNull(x['origem'])?.slice(0, 2) ?? null,
            cids: [txtOuNull(x['cid']), txtOuNull(x['cid1']), txtOuNull(x['cid2']), txtOuNull(x['cid3'])],
            cidAssociado: txtOuNull(x['cida']),
            estrategiaSaudeFamilia: bool(x['estrategia_saude_familia']),
            cnesSaudeFamilia: txtOuNull(x['cnes_unidade_saude_familia']),
            continuacao: txtOuNull(x['continuacao']),
            acoes: acoes.map((a) => ({
              sequencia: a.sequencia,
              procedimento: a.procedimento,
              cbo: a.cbo,
              cnsProfissional: a.cnsProfissional ?? '',
              dataInicio: a.dataInicio,
              dataFim: a.dataFim,
              quantidade: a.quantidade,
              local: a.local,
              cid: a.cid,
            })),
          })),
        );
        await garantirSequencia(
          tx,
          { tipo: SEQUENCIA_REMESSA_RAAS, estabelecimento: est.id, prefixo: 'RAAS-' },
          { usuario, agora: new Date() },
        );
        const numero = (await tx.proximoNumero(SEQUENCIA_REMESSA_RAAS)).formatado;
        const bytes = new TextEncoder().encode(arq.conteudo);
        const hash = createHash('sha256').update(bytes).digest('hex');
        const nome = `RAAS${e.tipo === 'atencao_psicossocial' ? 'P' : 'D'}${e.competencia}_${numero}.TXT`;
        chave = `raas/${e.competencia}/${numero}-${hash.slice(0, 12)}.txt`;
        await this.armazem.guardar(chave, bytes);
        const agora = new Date();
        const guarda = new Date(agora);
        guarda.setUTCFullYear(guarda.getUTCFullYear() + ANOS_GUARDA);
        const arquivoId = await tx.incluir(T_ARQUIVO, {
          estabelecimento_id: est.id,
          entidade: T_REMESSA,
          finalidade: 'arquivo_faturamento_sus',
          nome_original: nome,
          tipo_mime: 'text/plain',
          tamanho_bytes: bytes.length,
          hash_sha256: hash,
          chave_armazenamento: chave,
          retencao_ate: guarda.toISOString().slice(0, 10),
          imutavel: true,
        });
        const anteriores = await tx.consultarParaAtualizar(
          `SELECT id, versao FROM remessa_raas WHERE competencia_sus_id = ? AND estabelecimento_id = ? AND tipo_raas = ?
              AND situacao IN ('gerada','conferida') AND excluido_em IS NULL`,
          [comp, est.id, e.tipo],
        );
        const remessa = await tx.incluir(T_REMESSA, {
          estabelecimento_id: est.id,
          competencia_sus_id: comp,
          numero,
          tipo_raas: e.tipo,
          situacao: 'gerada',
          aberta_em: agora,
          criticada_em: semCritica['criticada_em'],
          quantidade_registros: ids.length,
          quantidade_procedimentos: arq.procedimentos,
          leiaute: LEIAUTE_RAAS.nome,
          versao_leiaute: LEIAUTE_RAAS.versao,
          conferido_contra_oficial: LEIAUTE_RAAS.conferidoContraOficial,
          arquivo_id: arquivoId,
          nome_arquivo: nome,
          hash_sha256: hash,
          tamanho_bytes: bytes.length,
          quantidade_linhas: arq.linhas,
          gerada_em: agora,
          gerador_usuario_id: usuario,
        });
        await tx.alterar(T_ARQUIVO, arquivoId, 1, { entidade_id: remessa });
        for (const x of anteriores)
          await tx.alterar(T_REMESSA, num(x['id']), num(x['versao']), {
            situacao: 'substituida',
            substituta_remessa_raas_id: remessa,
          });
        for (const { linha: x } of lidos) {
          const v = await tx.uma('SELECT versao FROM registro_raas WHERE id = ?', [x['id']]);
          await tx.alterar(T_REGISTRO, num(x['id']), num(v?.['versao']), {
            situacao: 'exportado',
            remessa_raas_id: remessa,
          });
        }
        return {
          tabela: T_REMESSA,
          id: remessa,
          numero,
          nome,
          hash,
          registros: ids.length,
          conteudo: arq.conteudo,
          substituidas: anteriores.length,
        };
      });
      await this.armazem.fixar(chave!, null);
      return r;
    } catch (erro) {
      if (chave) await this.armazem.remover(chave, null).catch(() => undefined);
      throw erro;
    }
  }
}
