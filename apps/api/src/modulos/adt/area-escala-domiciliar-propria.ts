// Áreas e escala da atenção domiciliar (C2-105, 03-PEP linha 143) no banco do cliente. As regras são as puras de
// @sgh/dominio-internacao (area-escala-domiciliar.ts). Contrato de efeito:
//   - área: `area_atendimento_domiciliar` (código único no estabelecimento) com as faixas de CEP em
//     `area_atendimento_domiciliar_cep`; trocar as faixas marca as antigas como excluídas (excluido_em/excluido_por)
//     e grava as novas na sequência seguinte; inativar e reativar mudam só `ativo` (a área inativa sai das escolhas e
//     da busca pelo CEP, e as faixas dela deixam de contar na sobreposição);
//   - profissional da área: `area_atendimento_domiciliar_profissional` com prioridade e vigência; encerrar grava o fim
//     da vigência (o vínculo fica no histórico);
//   - escala: `escala_atendimento_domiciliar` (dia, turno, quantidade, extra, feriado, vigência, área e tipo de
//     chamado opcionais); encerrar grava o fim da vigência, inativar e reativar mudam `ativo`;
//   - grade: os turnos vigentes de cada dia com as visitas não canceladas ligadas a eles (a visita agendada pela
//     internação domiciliar acha o turno pelo domínio e grava `escala_atendimento_domiciliar_id`).
// Nada se apaga; cada ação confere a versão lida e grava a trilha pelo executor.
import {
  areaDoCep,
  conferirAreaDomiciliar,
  conferirEscalaDomiciliar,
  conferirProfissionalArea,
  type EscalaVigente,
  gradeDoDia,
  normalizarCep,
} from '@sgh/dominio-internacao';
import type { Leitor } from '@sgh/nucleo';
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

export const PORTA_AREA_ESCALA_DOMICILIAR = Symbol('PORTA_AREA_ESCALA_DOMICILIAR');

const T_AREA = 'area_atendimento_domiciliar';
const T_CEP = 'area_atendimento_domiciliar_cep';
const T_PROF = 'area_atendimento_domiciliar_profissional';
const T_ESCALA = 'escala_atendimento_domiciliar';
const TABELAS = [T_AREA, T_CEP, T_PROF, T_ESCALA];

export const ACOES_AREA_DOMICILIAR = ['inativar', 'reativar'] as const;
export const ACOES_ESCALA_DOMICILIAR = ['encerrar', 'inativar', 'reativar'] as const;
export type AcaoAreaDomiciliar = (typeof ACOES_AREA_DOMICILIAR)[number];
export type AcaoEscalaDomiciliar = (typeof ACOES_ESCALA_DOMICILIAR)[number];

const dataTxt = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const horaTxt = (v: unknown): string => String(v ?? '').slice(0, 5);
const diaNoFuso = (d: Date, fuso: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(d);
const somarDias = (dia: string, n: number): string => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const id = z.number().int().positive();
const idOuNull = id.nullable().default(null);
const versao = z.number().int().positive();

const esquemaArea = z
  .object({
    codigo: z.string().trim().min(1).max(30),
    descricao: z.string().trim().min(1).max(150),
    programa: idOuNull,
    faixas: z
      .array(
        z
          .object({
            cepInicial: z.string().trim().max(9),
            cepFinal: z.string().trim().max(9),
            municipio: idOuNull,
            bairro: idOuNull,
          })
          .strict(),
      )
      .max(200)
      .default([]),
    versao: versao.optional(),
  })
  .strict();
const esquemaVersao = z.object({ versao }).strict();
const esquemaVinculo = z
  .object({
    profissional: id,
    prioridade: z.number().int().default(1),
    vigenciaInicio: data,
    vigenciaFim: data.nullable().default(null),
  })
  .strict();
const esquemaEncerrar = z.object({ versao, vigenciaFim: data }).strict();
const esquemaEscala = z
  .object({
    area: idOuNull,
    profissional: id,
    tipoChamado: idOuNull,
    diaSemana: z.number().int(),
    horaInicio: hora,
    horaFim: hora,
    quantidade: z.number().int(),
    permiteExtra: z.boolean().default(false),
    atendeFeriado: z.boolean().default(false),
    vigenciaInicio: data,
    vigenciaFim: data.nullable().default(null),
  })
  .strict();
const esquemaAcaoEscala = z.object({ versao, vigenciaFim: data.nullable().default(null) }).strict();

const escalaLida = (x: Record<string, unknown>) => ({
  id: num(x['id']),
  versao: num(x['versao']),
  area: numOuNull(x['area_atendimento_domiciliar_id']),
  areaNome: txtOuNull(x['area_nome']),
  profissional: num(x['profissional_id']),
  profissionalNome: txtOuNull(x['profissional_nome']),
  tipoChamado: numOuNull(x['tipo_chamado_domiciliar_id']),
  tipoNome: txtOuNull(x['tipo_nome']),
  diaSemana: num(x['dia_semana']),
  horaInicio: horaTxt(x['hora_inicio']),
  horaFim: horaTxt(x['hora_fim']),
  quantidade: num(x['quantidade_atendimentos']),
  permiteExtra: bool(x['permite_atendimento_extra']),
  atendeFeriado: bool(x['atende_feriado']),
  vigenciaInicio: String(dataTxt(x['vigencia_inicio'])),
  vigenciaFim: dataTxt(x['vigencia_fim']),
  ativo: bool(x['ativo']),
});
export type EscalaDomiciliarLida = ReturnType<typeof escalaLida>;

const SELECT_ESCALA = `SELECT x.*, a.descricao AS area_nome, t.descricao AS tipo_nome,
       COALESCE(pr.nome_exibicao, pf.nome) AS profissional_nome
  FROM escala_atendimento_domiciliar x
  LEFT JOIN area_atendimento_domiciliar a ON a.id = x.area_atendimento_domiciliar_id
  LEFT JOIN tipo_chamado_domiciliar t ON t.id = x.tipo_chamado_domiciliar_id
  LEFT JOIN profissional pr ON pr.id = x.profissional_id
  LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id`;

async function exigir(l: Leitor, sql: string, p: unknown[], oQue: string): Promise<Record<string, unknown>> {
  const r = await l.uma(sql, p);
  if (!r) throw naoEncontrado(oQue);
  return r;
}
const recusa = (titulo: string, problemas: readonly { campo: string; mensagem: string }[]) => {
  if (problemas.length) throw recusaRegra(titulo, problemas);
};

export class PortaAreaEscalaDomiciliarPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'internacao.domiciliar.area');
  }

  /** Áreas do estabelecimento (ativas e inativas) com faixas e profissionais vigentes ou futuros, e as escolhas. */
  areas(c: ContextoPortaPropria) {
    return this.ler(c, 'areas', async (l, est) => {
      const areas = await l.consultar(
        `SELECT a.id, a.versao, a.codigo, a.descricao, a.ativo, a.programa_atencao_domiciliar_id,
                p.descricao AS programa_nome
           FROM area_atendimento_domiciliar a
           LEFT JOIN programa_atencao_domiciliar p ON p.id = a.programa_atencao_domiciliar_id
          WHERE a.estabelecimento_id = ? ORDER BY a.ativo DESC, a.descricao LIMIT 500`,
        [est.id],
      );
      const ids = areas.map((a) => num(a['id']));
      const marcas = ids.map(() => '?').join(',') || 'NULL';
      const faixas = ids.length
        ? await l.consultar(
            `SELECT area_atendimento_domiciliar_id AS area, sequencia, cep_inicial, cep_final, municipio_ibge_id, bairro_id
               FROM area_atendimento_domiciliar_cep
              WHERE excluido_em IS NULL AND area_atendimento_domiciliar_id IN (${marcas}) ORDER BY sequencia`,
            ids,
          )
        : [];
      const vinculos = ids.length
        ? await l.consultar(
            `SELECT v.id, v.versao, v.area_atendimento_domiciliar_id AS area, v.profissional_id, v.prioridade,
                    v.vigencia_inicio, v.vigencia_fim, COALESCE(pr.nome_exibicao, pf.nome) AS nome
               FROM area_atendimento_domiciliar_profissional v
               LEFT JOIN profissional pr ON pr.id = v.profissional_id
               LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
              WHERE v.excluido_em IS NULL AND v.area_atendimento_domiciliar_id IN (${marcas})
              ORDER BY v.prioridade, v.vigencia_inicio`,
            ids,
          )
        : [];
      const lista = async (sql: string, p: unknown[] = []) =>
        (await l.consultar(sql, p)).map((x) => ({ id: num(x['id']), nome: String(x['nome']) }));
      return {
        areas: areas.map((a) => {
          const aid = num(a['id']);
          return {
            id: aid,
            versao: num(a['versao']),
            codigo: String(a['codigo']),
            descricao: String(a['descricao']),
            ativo: bool(a['ativo']),
            programa: numOuNull(a['programa_atencao_domiciliar_id']),
            programaNome: txtOuNull(a['programa_nome']),
            faixas: faixas
              .filter((f) => num(f['area']) === aid)
              .map((f) => ({
                sequencia: num(f['sequencia']),
                cepInicial: String(f['cep_inicial']),
                cepFinal: String(f['cep_final']),
                municipio: numOuNull(f['municipio_ibge_id']),
                bairro: numOuNull(f['bairro_id']),
              })),
            profissionais: vinculos
              .filter((v) => num(v['area']) === aid)
              .map((v) => ({
                id: num(v['id']),
                versao: num(v['versao']),
                profissional: num(v['profissional_id']),
                nome: txtOuNull(v['nome']),
                prioridade: num(v['prioridade']),
                vigenciaInicio: String(dataTxt(v['vigencia_inicio'])),
                vigenciaFim: dataTxt(v['vigencia_fim']),
              })),
          };
        }),
        programas: await lista(
          'SELECT id, descricao AS nome FROM programa_atencao_domiciliar WHERE ativo = TRUE ORDER BY descricao LIMIT 200',
        ),
        tiposChamado: await lista(
          'SELECT id, descricao AS nome FROM tipo_chamado_domiciliar WHERE ativo = TRUE ORDER BY descricao LIMIT 200',
        ),
        profissionais: await lista(
          `SELECT pr.id, COALESCE(pr.nome_exibicao, pf.nome) AS nome FROM profissional pr
             LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
            WHERE pr.excluido_em IS NULL ORDER BY nome LIMIT 1000`,
        ),
      };
    });
  }

  /** A área ativa do CEP (faixa mais estreita), para sugerir na transferência e no chamado. */
  areaPorCep(c: ContextoPortaPropria, cep: string) {
    return this.ler(c, 'cep', async (l, est) => {
      const faixas = (
        await l.consultar(
          `SELECT f.area_atendimento_domiciliar_id AS area, f.cep_inicial, f.cep_final
             FROM area_atendimento_domiciliar_cep f
             JOIN area_atendimento_domiciliar a ON a.id = f.area_atendimento_domiciliar_id
            WHERE a.estabelecimento_id = ? AND a.ativo = TRUE AND f.excluido_em IS NULL`,
          [est.id],
        )
      ).map((f) => ({
        area: num(f['area']),
        cepInicial: String(f['cep_inicial']),
        cepFinal: String(f['cep_final']),
      }));
      return { cep: normalizarCep(cep), area: areaDoCep(cep, faixas) };
    });
  }

  /** Escalas do estabelecimento (todas, as encerradas e inativas ao fim). */
  escalas(c: ContextoPortaPropria) {
    return this.ler(c, 'escalas', async (l, est) =>
      (
        await l.consultar(
          `${SELECT_ESCALA} WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL
           ORDER BY x.ativo DESC, x.dia_semana, x.hora_inicio, profissional_nome LIMIT 2000`,
          [est.id],
        )
      ).map(escalaLida),
    );
  }

  /** Grade dos `dias` dias a partir de `inicio` (data local): turnos vigentes com as visitas ligadas e as vagas. */
  grade(c: ContextoPortaPropria, inicio: string | null, dias: number) {
    return this.ler(c, 'grade', async (l, est) => {
      const primeiro =
        inicio && /^\d{4}-\d{2}-\d{2}$/.test(inicio) ? inicio : diaNoFuso(new Date(), est.fuso);
      const n = Math.min(Math.max(Math.trunc(dias) || 7, 1), 31);
      const escalas = (
        await l.consultar(
          `${SELECT_ESCALA} WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL AND x.ativo = TRUE`,
          [est.id],
        )
      ).map(escalaLida);
      const visitas = await l.consultar(
        `SELECT escala_atendimento_domiciliar_id AS escala, agendada_para FROM visita_domiciliar
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND escala_atendimento_domiciliar_id IS NOT NULL
            AND situacao NOT IN ('cancelada', 'nao_realizada')
            AND agendada_para BETWEEN ? - INTERVAL 1 DAY AND ? + INTERVAL 2 DAY`,
        [est.id, primeiro, somarDias(primeiro, n)],
      );
      const ocupacao = new Map<string, number>();
      for (const v of visitas) {
        const quando = v['agendada_para'];
        const dia = diaNoFuso(quando instanceof Date ? quando : new Date(String(quando)), est.fuso);
        const chave = `${num(v['escala'])}|${dia}`;
        ocupacao.set(chave, (ocupacao.get(chave) ?? 0) + 1);
      }
      return {
        inicio: primeiro,
        dias: Array.from({ length: n }, (_, i) => {
          const dia = somarDias(primeiro, i);
          return {
            data: dia,
            turnos: gradeDoDia(escalas, dia, (e) => ocupacao.get(`${e}|${dia}`) ?? 0),
          };
        }),
      };
    });
  }

  // ------------------------------------------------------------ áreas
  salvarArea(c: ContextoPortaPropria, alvo: number | null, entrada: unknown) {
    const e = entradaValida(esquemaArea, entrada);
    const nome = alvo === null ? 'internacao.domiciliar.area.criar' : 'internacao.domiciliar.area.alterar';
    return this.gravar(c, nome, TABELAS, async (tx, est, usuario) => {
      const codigo = e.codigo.trim().toUpperCase();
      const outras = await tx.consultar(
        `SELECT a.codigo, f.cep_inicial, f.cep_final FROM area_atendimento_domiciliar_cep f
           JOIN area_atendimento_domiciliar a ON a.id = f.area_atendimento_domiciliar_id
          WHERE a.estabelecimento_id = ? AND a.ativo = TRUE AND f.excluido_em IS NULL AND a.id <> ?`,
        [est.id, alvo ?? 0],
      );
      const problemas = conferirAreaDomiciliar({
        codigo,
        descricao: e.descricao,
        faixas: e.faixas,
        faixasOutrasAreas: outras.map((o) => ({
          area: String(o['codigo']),
          cepInicial: String(o['cep_inicial']),
          cepFinal: String(o['cep_final']),
        })),
      });
      const mesmo = await tx.uma(
        'SELECT id FROM area_atendimento_domiciliar WHERE estabelecimento_id = ? AND codigo = ? AND id <> ?',
        [est.id, codigo, alvo ?? 0],
      );
      if (mesmo)
        problemas.push({ campo: 'codigo', mensagem: `Já existe a área ${codigo} neste estabelecimento.` });
      if (
        e.programa !== null &&
        !(await tx.uma('SELECT id FROM programa_atencao_domiciliar WHERE id = ?', [e.programa]))
      )
        problemas.push({ campo: 'programa', mensagem: 'Programa de atenção domiciliar inexistente.' });
      recusa('Área recusada', problemas);
      const campos = {
        codigo,
        descricao: e.descricao.trim(),
        programa_atencao_domiciliar_id: e.programa,
      };
      let areaId: number;
      let proxima = 1;
      if (alvo === null) {
        areaId = await tx.incluir(T_AREA, { estabelecimento_id: est.id, ...campos, ativo: true });
      } else {
        const [a] = await tx.consultarParaAtualizar(
          'SELECT id, versao FROM area_atendimento_domiciliar WHERE id = ? AND estabelecimento_id = ?',
          [alvo, est.id],
          { teto: 1 },
        );
        if (!a) throw naoEncontrado('Área domiciliar');
        if (e.versao === undefined)
          recusa('Área recusada', [{ campo: 'versao', mensagem: 'Informe a versão lida.' }]);
        await tx.alterar(T_AREA, alvo, e.versao!, campos);
        areaId = alvo;
        const antigas = await tx.consultar(
          'SELECT id, versao FROM area_atendimento_domiciliar_cep WHERE area_atendimento_domiciliar_id = ? AND excluido_em IS NULL',
          [alvo],
        );
        const agora = new Date();
        for (const f of antigas)
          await tx.alterar(T_CEP, num(f['id']), num(f['versao']), {
            excluido_em: agora,
            excluido_por: usuario,
          });
        proxima =
          num(
            (
              await tx.uma(
                'SELECT MAX(sequencia) AS m FROM area_atendimento_domiciliar_cep WHERE area_atendimento_domiciliar_id = ?',
                [alvo],
              )
            )?.['m'],
          ) + 1;
      }
      for (const f of e.faixas)
        await tx.incluir(T_CEP, {
          area_atendimento_domiciliar_id: areaId,
          sequencia: proxima++,
          cep_inicial: normalizarCep(f.cepInicial),
          cep_final: normalizarCep(f.cepFinal),
          municipio_ibge_id: f.municipio,
          bairro_id: f.bairro,
          origem: 'sistema',
        });
      return { tabela: T_AREA, id: areaId };
    });
  }

  acaoArea(c: ContextoPortaPropria, alvo: number, acao: AcaoAreaDomiciliar, entrada: unknown) {
    const x = entradaValida(esquemaVersao, entrada);
    return this.gravar(c, `internacao.domiciliar.area.${acao}`, TABELAS, async (tx, est) => {
      const [a] = await tx.consultarParaAtualizar(
        'SELECT id, codigo, ativo FROM area_atendimento_domiciliar WHERE id = ? AND estabelecimento_id = ?',
        [alvo, est.id],
        { teto: 1 },
      );
      if (!a) throw naoEncontrado('Área domiciliar');
      const ativa = bool(a['ativo']);
      if (acao === 'inativar' && !ativa)
        recusa('Área recusada', [{ campo: 'acao', mensagem: 'A área já está inativa.' }]);
      if (acao === 'reativar') {
        if (ativa) recusa('Área recusada', [{ campo: 'acao', mensagem: 'A área já está ativa.' }]);
        // Reativar volta a ocupar as faixas: elas não podem cruzar as de outra área ativa.
        const minhas = await tx.consultar(
          'SELECT cep_inicial, cep_final FROM area_atendimento_domiciliar_cep WHERE area_atendimento_domiciliar_id = ? AND excluido_em IS NULL',
          [alvo],
        );
        const outras = await tx.consultar(
          `SELECT a.codigo, f.cep_inicial, f.cep_final FROM area_atendimento_domiciliar_cep f
             JOIN area_atendimento_domiciliar a ON a.id = f.area_atendimento_domiciliar_id
            WHERE a.estabelecimento_id = ? AND a.ativo = TRUE AND f.excluido_em IS NULL AND a.id <> ?`,
          [est.id, alvo],
        );
        recusa(
          'Área recusada',
          conferirAreaDomiciliar({
            codigo: String(a['codigo']),
            descricao: 'reativar',
            faixas: minhas.map((f) => ({
              cepInicial: String(f['cep_inicial']),
              cepFinal: String(f['cep_final']),
            })),
            faixasOutrasAreas: outras.map((o) => ({
              area: String(o['codigo']),
              cepInicial: String(o['cep_inicial']),
              cepFinal: String(o['cep_final']),
            })),
          }),
        );
      }
      await tx.alterar(T_AREA, alvo, x.versao, { ativo: acao === 'reativar' });
      return { tabela: T_AREA, id: alvo, ativo: acao === 'reativar' };
    });
  }

  vincularProfissional(c: ContextoPortaPropria, area: number, entrada: unknown) {
    const e = entradaValida(esquemaVinculo, entrada);
    return this.gravar(c, 'internacao.domiciliar.area.vincular', TABELAS, async (tx, est) => {
      await exigir(
        tx,
        'SELECT id FROM area_atendimento_domiciliar WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE',
        [area, est.id],
        'Área domiciliar ativa',
      );
      await exigir(
        tx,
        'SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL',
        [e.profissional],
        'Profissional',
      );
      const outros = await tx.consultar(
        `SELECT vigencia_inicio, vigencia_fim FROM area_atendimento_domiciliar_profissional
          WHERE area_atendimento_domiciliar_id = ? AND profissional_id = ? AND excluido_em IS NULL`,
        [area, e.profissional],
      );
      recusa(
        'Vínculo recusado',
        conferirProfissionalArea({
          prioridade: e.prioridade,
          vigenciaInicio: e.vigenciaInicio,
          vigenciaFim: e.vigenciaFim,
          outrosVinculos: outros.map((o) => ({
            inicio: String(dataTxt(o['vigencia_inicio'])),
            fim: dataTxt(o['vigencia_fim']),
          })),
        }),
      );
      const novo = await tx.incluir(T_PROF, {
        area_atendimento_domiciliar_id: area,
        profissional_id: e.profissional,
        prioridade: e.prioridade,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
      });
      return { tabela: T_PROF, id: novo };
    });
  }

  encerrarVinculo(c: ContextoPortaPropria, alvo: number, entrada: unknown) {
    const x = entradaValida(esquemaEncerrar, entrada);
    return this.gravar(c, 'internacao.domiciliar.area.encerrar_vinculo', TABELAS, async (tx, est) => {
      const [v] = await tx.consultarParaAtualizar(
        `SELECT v.id, v.vigencia_inicio, v.vigencia_fim FROM area_atendimento_domiciliar_profissional v
           JOIN area_atendimento_domiciliar a ON a.id = v.area_atendimento_domiciliar_id
          WHERE v.id = ? AND a.estabelecimento_id = ? AND v.excluido_em IS NULL`,
        [alvo, est.id],
        { teto: 1 },
      );
      if (!v) throw naoEncontrado('Vínculo do profissional');
      const inicio = String(dataTxt(v['vigencia_inicio']));
      const fimAtual = dataTxt(v['vigencia_fim']);
      const p: { campo: string; mensagem: string }[] = [];
      if (x.vigenciaFim < inicio)
        p.push({ campo: 'vigenciaFim', mensagem: 'O fim da vigência não pode ser antes do início.' });
      if (fimAtual !== null && x.vigenciaFim > fimAtual)
        p.push({ campo: 'vigenciaFim', mensagem: 'O vínculo já termina antes; encerrar só antecipa o fim.' });
      recusa('Vínculo recusado', p);
      await tx.alterar(T_PROF, alvo, x.versao, { vigencia_fim: x.vigenciaFim });
      return { tabela: T_PROF, id: alvo };
    });
  }

  // ------------------------------------------------------------ escala
  criarEscala(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaEscala, entrada);
    return this.gravar(c, 'internacao.domiciliar.escala.criar', TABELAS, async (tx, est) => {
      await exigir(
        tx,
        'SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL',
        [e.profissional],
        'Profissional',
      );
      if (e.tipoChamado !== null)
        await exigir(
          tx,
          'SELECT id FROM tipo_chamado_domiciliar WHERE id = ? AND ativo = TRUE',
          [e.tipoChamado],
          'Tipo de chamado',
        );
      let naArea: boolean | null = null;
      if (e.area !== null) {
        await exigir(
          tx,
          'SELECT id FROM area_atendimento_domiciliar WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE',
          [e.area, est.id],
          'Área domiciliar ativa',
        );
        naArea = Boolean(
          await tx.uma(
            `SELECT id FROM area_atendimento_domiciliar_profissional
              WHERE area_atendimento_domiciliar_id = ? AND profissional_id = ? AND excluido_em IS NULL
                AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
            [e.area, e.profissional, e.vigenciaInicio, e.vigenciaInicio],
          ),
        );
      }
      const outros = (
        await tx.consultar(
          `${SELECT_ESCALA} WHERE x.profissional_id = ? AND x.excluido_em IS NULL AND x.ativo = TRUE`,
          [e.profissional],
        )
      ).map(escalaLida);
      const problemas = conferirEscalaDomiciliar({
        diaSemana: e.diaSemana,
        horaInicio: e.horaInicio,
        horaFim: e.horaFim,
        vigenciaInicio: e.vigenciaInicio,
        vigenciaFim: e.vigenciaFim,
        quantidade: e.quantidade,
        profissionalNaArea: naArea,
        outrosTurnos: outros,
      });
      if (
        !problemas.length &&
        (await tx.uma(
          `SELECT id FROM escala_atendimento_domiciliar
            WHERE profissional_id = ? AND dia_semana = ? AND hora_inicio = ? AND vigencia_inicio = ?`,
          [e.profissional, e.diaSemana, `${e.horaInicio}:00`, e.vigenciaInicio],
        ))
      )
        problemas.push({
          campo: 'horaInicio',
          mensagem: 'Já existe este turno (inativo) com o mesmo início de vigência; reative-o.',
        });
      recusa('Escala recusada', problemas);
      const novo = await tx.incluir(T_ESCALA, {
        estabelecimento_id: est.id,
        area_atendimento_domiciliar_id: e.area,
        profissional_id: e.profissional,
        tipo_chamado_domiciliar_id: e.tipoChamado,
        dia_semana: e.diaSemana,
        hora_inicio: e.horaInicio,
        hora_fim: e.horaFim,
        quantidade_atendimentos: e.quantidade,
        permite_atendimento_extra: e.permiteExtra,
        atende_feriado: e.atendeFeriado,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
        ativo: true,
        origem: 'sistema',
      });
      return { tabela: T_ESCALA, id: novo };
    });
  }

  acaoEscala(c: ContextoPortaPropria, alvo: number, acao: AcaoEscalaDomiciliar, entrada: unknown) {
    const x = entradaValida(esquemaAcaoEscala, entrada);
    return this.gravar(c, `internacao.domiciliar.escala.${acao}`, TABELAS, async (tx, est) => {
      const [s] = await tx.consultarParaAtualizar(
        `${SELECT_ESCALA} WHERE x.id = ? AND x.estabelecimento_id = ? AND x.excluido_em IS NULL`,
        [alvo, est.id],
        { teto: 1 },
      );
      if (!s) throw naoEncontrado('Turno da escala');
      const e = escalaLida(s);
      if (acao === 'encerrar') {
        const p: { campo: string; mensagem: string }[] = [];
        if (!x.vigenciaFim) p.push({ campo: 'vigenciaFim', mensagem: 'Informe o último dia do turno.' });
        else if (x.vigenciaFim < e.vigenciaInicio)
          p.push({ campo: 'vigenciaFim', mensagem: 'O fim da vigência não pode ser antes do início.' });
        else if (e.vigenciaFim !== null && x.vigenciaFim > e.vigenciaFim)
          p.push({ campo: 'vigenciaFim', mensagem: 'O turno já termina antes; encerrar só antecipa o fim.' });
        recusa('Escala recusada', p);
        await tx.alterar(T_ESCALA, alvo, x.versao, { vigencia_fim: x.vigenciaFim });
        return { tabela: T_ESCALA, id: alvo };
      }
      if (acao === 'inativar' && !e.ativo)
        recusa('Escala recusada', [{ campo: 'acao', mensagem: 'O turno já está inativo.' }]);
      if (acao === 'reativar') {
        if (e.ativo) recusa('Escala recusada', [{ campo: 'acao', mensagem: 'O turno já está ativo.' }]);
        const outros = (
          await tx.consultar(
            `${SELECT_ESCALA} WHERE x.profissional_id = ? AND x.excluido_em IS NULL AND x.ativo = TRUE AND x.id <> ?`,
            [e.profissional, alvo],
          )
        ).map(escalaLida);
        recusa(
          'Escala recusada',
          conferirEscalaDomiciliar({ ...e, profissionalNaArea: null, outrosTurnos: outros }),
        );
      }
      await tx.alterar(T_ESCALA, alvo, x.versao, { ativo: acao === 'reativar' });
      return { tabela: T_ESCALA, id: alvo };
    });
  }
}

/** As escalas ativas do profissional no formato do domínio (usado ao agendar a visita). */
export async function escalasDoProfissional(
  l: Leitor,
  estabelecimento: number,
  profissional: number,
): Promise<EscalaVigente[]> {
  return (
    await l.consultar(
      `${SELECT_ESCALA} WHERE x.estabelecimento_id = ? AND x.profissional_id = ? AND x.excluido_em IS NULL
         AND x.ativo = TRUE`,
      [estabelecimento, profissional],
    )
  ).map(escalaLida);
}
