// Ligações do cadastro no banco próprio (F3.1, 02-CAD linhas 17, 18 e 20):
// - especialidade: procedimentos permitidos com vigência (`especialidade_procedimento`) e ocupações do CBO com uma
//   principal (`especialidade_ocupacao`); encerrar a vigência e retirar a ocupação nunca apagam a linha;
// - lotação do profissional por estabelecimento e unidade, com ocupação, carga semanal por tipo, vínculo de trabalho
//   do cadastro nacional e vigência (`lotacao_profissional`), uma ocupação padrão por estabelecimento;
// - solicitante externo: alterar, inativar e reativar (nunca apagar), código do solicitante em cada fonte pagadora
//   (`solicitante_externo_fonte_pagadora`) e os parecidos e os campos da guia pela regra do domínio.
// A regra é a do domínio (@sgh/dominio-cadastro); aqui só leitura, conferência no banco e gravação pelo executor
// (trilha e idempotência na mesma transação).
import { randomUUID } from 'node:crypto';
import {
  CARGA_SEMANAL_ALTA,
  camposFaltantes,
  chaveSolicitante,
  conflitosLotacao,
  errosCodigoNaFonte,
  errosInativacao,
  errosLotacao,
  errosPeriodoProcedimento,
  parecidos,
  periodosSobrepostos,
  principaisADesmarcar,
  type SolicitanteParecido,
} from '@sgh/dominio-cadastro';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPorta } from './porta.js';
import type { NucleoCadastro } from './porta-propria.js';
import type { RegistroTrilhaTela } from './tipos.js';

export const LIGACOES_CADASTRO = Symbol('LIGACOES_CADASTRO');

const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const data = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      : String(v).slice(0, 10);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean => v === true || v === 1 || v === '1';
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const idPos = z.number().int().positive();

async function hojeDe(x: Leitor | TxOperacao): Promise<string> {
  const r = await x.uma<{ d: unknown }>('SELECT CURRENT_DATE AS d', []);
  return data(r?.d) ?? new Date().toISOString().slice(0, 10);
}

const MENSAGENS: Record<string, [string, string]> = {
  'vigencia-invertida': ['O fim da vigência é anterior ao início.', 'vigenciaFim'],
  'carga-invalida': ['A carga horária é em horas inteiras por semana (0 a 168).', 'cargaAmbulatorial'],
  'carga-zerada': ['Informe ao menos uma hora semanal de carga.', 'cargaAmbulatorial'],
  'carga-acima-da-semana': ['A soma das cargas passa das 168 horas da semana.', 'cargaAmbulatorial'],
  'codigo-vazio': ['Informe o código do solicitante na fonte pagadora.', 'codigo'],
  'codigo-invalido': ['O código tem até 20 letras, dígitos, ponto, barra ou hífen, sem espaço.', 'codigo'],
  'motivo-curto': ['Escreva o motivo com ao menos 10 letras.', 'motivo'],
  'inativacao-antes-da-inscricao': ['A inativação não pode ser anterior à inscrição.', 'data'],
};
/** Recusa com todos os erros do domínio de uma vez (a tela marca cada campo). */
function recusarErros(erros: readonly string[]): void {
  if (!erros.length) return;
  throw recusa(erros[0]!, erros.map((e) => MENSAGENS[e]?.[0] ?? e).join(' '), {
    campos: [...new Set(erros.map((e) => MENSAGENS[e]?.[1] ?? e))],
  });
}
const naoAchado = (o: string) =>
  new ErroOperacao(404, `${o}-inexistente`, 'Não encontrado', `${o} não encontrado.`);
const recusaCampo = (codigo: string, msg: string, campo: string) => recusa(codigo, msg, { campos: [campo] });

// ── Especialidade: procedimentos permitidos e ocupações ──

const esquemaProcedimento = z
  .object({ especialidade: idPos, procedimento: idPos, vigenciaInicio: dia, vigenciaFim: dia.nullable() })
  .strict();
export type EntradaProcedimentoEspecialidade = z.infer<typeof esquemaProcedimento>;

const opIncluirProcedimento = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.especialidade.incluir-procedimento',
    tabelas: ['especialidade_procedimento'],
    entrada: esquemaProcedimento,
    acao: 'inclusao',
    async gravar(tx, e) {
      if (!(await tx.uma('SELECT id FROM especialidade_medica WHERE id = ?', [e.especialidade])))
        throw naoAchado('Especialidade');
      if (
        !(await tx.uma('SELECT id FROM item_faturavel WHERE id = ? AND excluido_em IS NULL', [
          e.procedimento,
        ]))
      )
        throw recusaCampo('procedimento-inexistente', 'Procedimento não encontrado.', 'procedimento');
      recusarErros(errosPeriodoProcedimento({ inicio: e.vigenciaInicio, fim: e.vigenciaFim }));
      const atuais = await tx.consultar(
        `SELECT id, item_faturavel_id, vigencia_inicio, vigencia_fim FROM especialidade_procedimento
          WHERE especialidade_medica_id = ? AND item_faturavel_id = ? AND ativo AND excluido_em IS NULL FOR UPDATE`,
        [e.especialidade, e.procedimento],
      );
      const cruzam = periodosSobrepostos(
        atuais.map((a) => ({
          id: Number(a['id']),
          procedimento: Number(a['item_faturavel_id']),
          inicio: data(a['vigencia_inicio'])!,
          fim: data(a['vigencia_fim']),
        })),
        { procedimento: e.procedimento, inicio: e.vigenciaInicio, fim: e.vigenciaFim },
      );
      if (cruzam.length)
        throw recusaCampo(
          'vigencia-sobreposta',
          'O procedimento já é permitido neste período: encerre a vigência anterior antes.',
          'vigenciaInicio',
        );
      const id = await tx.incluir('especialidade_procedimento', {
        especialidade_medica_id: e.especialidade,
        item_faturavel_id: e.procedimento,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
        ativo: true,
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'especialidade_procedimento', id: Number(r.id) }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

const esquemaEncerrar = z.object({ dono: idPos, id: idPos, versao: idPos, fim: dia.nullable() }).strict();
export type EntradaEncerrar = z.infer<typeof esquemaEncerrar>;

/** Encerra a vigência (procedimento da especialidade ou lotação); a linha fica, com o fim gravado. */
const opEncerrar = (
  tabela: 'especialidade_procedimento' | 'lotacao_profissional',
  t: RegistroTrilhaTela,
  restrito: number | null,
) =>
  definirOperacao({
    nome: `cadastro.encerrar-${tabela}`,
    tabelas: [tabela],
    entrada: esquemaEncerrar,
    acao: 'alteracao',
    async gravar(tx, e) {
      const dono = tabela === 'lotacao_profissional' ? 'profissional_id' : 'especialidade_medica_id';
      const x = await tx.uma(`SELECT * FROM ${tabela} WHERE id = ? AND ${dono} = ? AND excluido_em IS NULL`, [
        e.id,
        e.dono,
      ]);
      if (!x) throw naoAchado('Registro');
      if (restrito !== null && Number(x['estabelecimento_id']) !== restrito) throw recusaEstabelecimento();
      const fim = e.fim ?? (await hojeDe(tx));
      const atual = data(x['vigencia_fim']);
      if (atual !== null && atual <= fim)
        throw recusaCampo('ja-encerrado', 'A vigência já está encerrada nesta data ou antes.', 'fim');
      if (fim < data(x['vigencia_inicio'])!)
        throw recusaCampo('vigencia-invertida', 'O fim da vigência é anterior ao início.', 'fim');
      await tx.alterar(tabela, e.id, e.versao, { vigencia_fim: fim });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela, id: e.id }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

const esquemaOcupacao = z.object({ especialidade: idPos, ocupacao: idPos, principal: z.boolean() }).strict();
export type EntradaOcupacaoEspecialidade = z.infer<typeof esquemaOcupacao>;

const opGravarOcupacao = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.especialidade.gravar-ocupacao',
    tabelas: ['especialidade_ocupacao'],
    entrada: esquemaOcupacao,
    acao: 'inclusao',
    async gravar(tx, e) {
      if (!(await tx.uma('SELECT id FROM especialidade_medica WHERE id = ?', [e.especialidade])))
        throw naoAchado('Especialidade');
      if (!(await tx.uma('SELECT id FROM ocupacao_cbo WHERE id = ?', [e.ocupacao])))
        throw recusaCampo('cbo-inexistente', 'Ocupação (CBO) não encontrada.', 'ocupacao');
      const linhas = await tx.consultar(
        `SELECT id, ocupacao_cbo_id, principal, versao, excluido_em FROM especialidade_ocupacao
          WHERE especialidade_medica_id = ? FOR UPDATE`,
        [e.especialidade],
      );
      const ativas = linhas.filter((l) => l['excluido_em'] === null);
      const mesma = linhas.find((l) => Number(l['ocupacao_cbo_id']) === e.ocupacao) ?? null;
      if (mesma && mesma['excluido_em'] === null && bool(mesma['principal']) === e.principal)
        throw recusaCampo('sem-alteracao', 'A ocupação já está ligada assim.', 'ocupacao');
      const d = principaisADesmarcar(
        ativas.map((a) => ({ id: Number(a['id']), principal: bool(a['principal']) })),
        { id: mesma ? Number(mesma['id']) : null, principal: e.principal },
      );
      for (const id of d.desmarcar) {
        const v = ativas.find((a) => Number(a['id']) === id)!;
        await tx.alterar('especialidade_ocupacao', id, Number(v['versao']), { principal: false });
      }
      // Ocupação retirada antes volta na mesma linha (o par é único), com o histórico de versões.
      const id = mesma
        ? (await tx.alterar('especialidade_ocupacao', Number(mesma['id']), Number(mesma['versao']), {
            principal: d.principal,
            excluido_em: null,
            excluido_por: null,
          }),
          Number(mesma['id']))
        : await tx.incluir('especialidade_ocupacao', {
            especialidade_medica_id: e.especialidade,
            ocupacao_cbo_id: e.ocupacao,
            principal: d.principal,
          });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'especialidade_ocupacao', id: Number(r.id) }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

const esquemaRetirar = z.object({ dono: idPos, id: idPos, versao: idPos }).strict();

/** Retira a ocupação da especialidade (exclusão lógica; a principal passa à mais antiga que fica). */
const opRetirarOcupacao = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.especialidade.retirar-ocupacao',
    tabelas: ['especialidade_ocupacao'],
    entrada: esquemaRetirar,
    acao: 'exclusao',
    async gravar(tx, e) {
      const x = await tx.uma(
        `SELECT id, principal FROM especialidade_ocupacao
          WHERE id = ? AND especialidade_medica_id = ? AND excluido_em IS NULL`,
        [e.id, e.dono],
      );
      if (!x) throw naoAchado('Registro');
      await tx.excluir('especialidade_ocupacao', e.id, e.versao);
      if (bool(x['principal'])) {
        const s = await tx.uma(
          `SELECT id, versao FROM especialidade_ocupacao WHERE especialidade_medica_id = ? AND excluido_em IS NULL
            ORDER BY id LIMIT 1`,
          [e.dono],
        );
        if (s)
          await tx.alterar('especialidade_ocupacao', Number(s['id']), Number(s['versao']), {
            principal: true,
          });
      }
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'especialidade_ocupacao', id: e.id }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

// ── Lotação do profissional ──

const horas = z.number().int().min(0).max(168);
const esquemaLotacao = z
  .object({
    profissional: idPos,
    estabelecimento: idPos,
    unidade: idPos.nullable(),
    ocupacao: idPos,
    inscricao: idPos.nullable(),
    tipoVinculo: idPos.nullable(),
    cargaAmbulatorial: horas,
    cargaHospitalar: horas,
    cargaOutros: horas,
    ocupacaoPadrao: z.boolean(),
    atendeSus: z.boolean(),
    geraRepasse: z.boolean(),
    vigenciaInicio: dia,
    vigenciaFim: dia.nullable(),
  })
  .strict();
export type EntradaLotacao = z.infer<typeof esquemaLotacao>;

/** A lotação de outro estabelecimento só pelo acesso total (administrador da plataforma). */
const recusaEstabelecimento = () =>
  new ErroOperacao(
    403,
    'estabelecimento-fora-da-sessao',
    'Outro estabelecimento',
    'A lotação só pode ser gravada no estabelecimento da sessão.',
  );

const opIncluirLotacao = (t: RegistroTrilhaTela, restrito: number | null) =>
  definirOperacao({
    nome: 'cadastro.profissional.incluir-lotacao',
    tabelas: ['lotacao_profissional'],
    entrada: esquemaLotacao,
    acao: 'inclusao',
    async gravar(tx, e) {
      if (
        !(await tx.uma('SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL', [e.profissional]))
      )
        throw naoAchado('Profissional');
      recusarErros(errosLotacao(e));
      if (restrito !== null && e.estabelecimento !== restrito) throw recusaEstabelecimento();
      if (
        !(await tx.uma('SELECT id FROM estabelecimento WHERE id = ? AND excluido_em IS NULL', [
          e.estabelecimento,
        ]))
      )
        throw recusaCampo('estabelecimento-inexistente', 'O estabelecimento não existe.', 'estabelecimento');
      if (
        e.unidade !== null &&
        !(await tx.uma(
          'SELECT id FROM unidade_assistencial WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.unidade, e.estabelecimento],
        ))
      )
        throw recusaCampo(
          'unidade-de-outro-estabelecimento',
          'A unidade não é deste estabelecimento.',
          'unidade',
        );
      if (!(await tx.uma('SELECT id FROM ocupacao_cbo WHERE id = ?', [e.ocupacao])))
        throw recusaCampo('cbo-inexistente', 'Ocupação (CBO) não encontrada.', 'ocupacao');
      if (
        e.inscricao !== null &&
        !(await tx.uma(
          'SELECT id FROM inscricao_conselho WHERE id = ? AND profissional_id = ? AND excluido_em IS NULL',
          [e.inscricao, e.profissional],
        ))
      )
        throw recusaCampo(
          'registro-de-outro-profissional',
          'O registro no conselho não é deste profissional.',
          'inscricao',
        );
      if (
        e.tipoVinculo !== null &&
        !(await tx.uma("SELECT id FROM tipo_vinculo_trabalho WHERE id = ? AND ativo AND nivel <> 'vinculo'", [
          e.tipoVinculo,
        ]))
      )
        throw recusaCampo(
          'vinculo-inexistente',
          'Escolha o tipo ou o subtipo do vínculo de trabalho.',
          'tipoVinculo',
        );
      const atuais = await tx.consultar(
        `SELECT id, estabelecimento_id, unidade_assistencial_id, ocupacao_cbo_id, vigencia_inicio, vigencia_fim,
                carga_horaria_ambulatorial + carga_horaria_hospitalar + carga_horaria_outros AS carga,
                ocupacao_padrao, versao
           FROM lotacao_profissional WHERE profissional_id = ? AND ativo AND excluido_em IS NULL FOR UPDATE`,
        [e.profissional],
      );
      const c = conflitosLotacao(
        atuais.map((a) => ({
          id: Number(a['id']),
          estabelecimento: Number(a['estabelecimento_id']),
          unidade: num(a['unidade_assistencial_id']),
          ocupacao: Number(a['ocupacao_cbo_id']),
          inicio: data(a['vigencia_inicio'])!,
          fim: data(a['vigencia_fim']),
          cargaSemanal: Number(a['carga']),
        })),
        { ...e, unidade: e.unidade },
      );
      if (c.sobrepostas.length)
        throw recusaCampo(
          'vigencia-sobreposta',
          'Já há lotação desta ocupação nesta unidade no período: encerre a anterior antes.',
          'vigenciaInicio',
        );
      if (c.excedeSemana)
        throw recusaCampo(
          'carga-acima-da-semana',
          `Com as outras lotações do período, a carga chega a ${c.cargaNoPeriodo} horas semanais (máximo 168).`,
          'cargaAmbulatorial',
        );
      if (e.ocupacaoPadrao)
        for (const a of atuais)
          if (Number(a['estabelecimento_id']) === e.estabelecimento && bool(a['ocupacao_padrao']))
            await tx.alterar('lotacao_profissional', Number(a['id']), Number(a['versao']), {
              ocupacao_padrao: false,
            });
      const id = await tx.incluir('lotacao_profissional', {
        profissional_id: e.profissional,
        estabelecimento_id: e.estabelecimento,
        unidade_assistencial_id: e.unidade,
        ocupacao_cbo_id: e.ocupacao,
        inscricao_conselho_id: e.inscricao,
        tipo_vinculo_trabalho_id: e.tipoVinculo,
        carga_horaria_ambulatorial: e.cargaAmbulatorial,
        carga_horaria_hospitalar: e.cargaHospitalar,
        carga_horaria_outros: e.cargaOutros,
        ocupacao_padrao: e.ocupacaoPadrao,
        atende_sus: e.atendeSus,
        gera_repasse: e.geraRepasse,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
        ativo: true,
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'lotacao_profissional', id: Number(r.id) }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

// ── Solicitante externo ──

const opcional = (max: number) => z.string().trim().max(max).nullable();
const esquemaAlterarSolicitante = z
  .object({
    id: idPos,
    versao: idPos,
    nome: z.string().trim().min(3).max(150),
    // O registro no conselho corrige o erro de digitação (o que a regra 'numero-proximo' aponta) sem criar outro
    // cadastro; ausente, fica o gravado.
    conselho: z.string().trim().min(1).max(10).optional(),
    uf: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .optional(),
    numero: z
      .string()
      .regex(/^\d{1,15}$/)
      .optional(),
    cpf: z
      .string()
      .regex(/^\d{11}$/)
      .nullable(),
    cns: z
      .string()
      .regex(/^\d{15}$/)
      .nullable(),
    ocupacao: idPos.nullable(),
    especialidade: idPos.nullable(),
    instituicaoNome: opcional(150),
    instituicaoCnpj: z
      .string()
      .regex(/^\d{14}$/)
      .nullable(),
    instituicaoCnes: z
      .string()
      .regex(/^\d{7}$/)
      .nullable(),
    telefone: opcional(20),
    email: z.string().trim().email().max(254).nullable(),
    observacao: opcional(500),
  })
  .strict();
export type EntradaAlterarSolicitante = z.infer<typeof esquemaAlterarSolicitante>;

const opAlterarSolicitante = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.solicitante.alterar',
    tabelas: ['solicitante_externo'],
    entrada: esquemaAlterarSolicitante,
    acao: 'alteracao',
    async gravar(tx, e) {
      const atual = await tx.uma(
        `SELECT s.conselho_classe_id, s.conselho_unidade_federativa_id, s.numero_conselho, cc.sigla AS conselho,
                uf.sigla AS uf
           FROM solicitante_externo s JOIN conselho_classe cc ON cc.id = s.conselho_classe_id
           JOIN unidade_federativa uf ON uf.id = s.conselho_unidade_federativa_id
          WHERE s.id = ? AND s.excluido_em IS NULL`,
        [e.id],
      );
      if (!atual) throw naoAchado('Solicitante');
      const sigla = (e.conselho ?? String(atual['conselho'])).toUpperCase();
      const ufSigla = (e.uf ?? String(atual['uf'])).toUpperCase();
      const numero = e.numero ?? String(atual['numero_conselho']);
      const conselho = await tx.uma('SELECT id FROM conselho_classe WHERE sigla = ? AND ativo', [sigla]);
      if (!conselho) throw recusaCampo('conselho-inexistente', 'Conselho não encontrado.', 'conselho');
      const uf = await tx.uma('SELECT id FROM unidade_federativa WHERE sigla = ?', [ufSigla]);
      if (!uf) throw recusaCampo('uf-inexistente', 'UF não encontrada.', 'uf');
      // Colisão pela chave do domínio (conselho, UF e número normalizados), não pela comparação exata do texto.
      const chave = chaveSolicitante({
        id: e.id,
        conselho: sigla,
        uf: ufSigla,
        numero: Number(numero),
        cbo: null,
      });
      const outros = (
        await tx.consultar(`${SQL_SOLICITANTES} AND uf.sigla = ? AND s.id <> ?`, [ufSigla, e.id])
      ).map(comparavel);
      const iguais = outros.filter((o) => chave !== null && chaveSolicitante(o) === chave).map((o) => o.id);
      if (iguais.length)
        throw recusa(
          'solicitante-existente',
          `Já existe outro solicitante com este conselho, UF e número (cadastro ${iguais.join(', ')}).`,
          { campos: ['numero'] },
        );
      if (e.ocupacao !== null && !(await tx.uma('SELECT id FROM ocupacao_cbo WHERE id = ?', [e.ocupacao])))
        throw recusaCampo('cbo-inexistente', 'Ocupação (CBO) não encontrada.', 'ocupacao');
      if (
        e.especialidade !== null &&
        !(await tx.uma('SELECT id FROM especialidade_medica WHERE id = ?', [e.especialidade]))
      )
        throw recusaCampo('especialidade-inexistente', 'Especialidade não encontrada.', 'especialidade');
      await tx.alterar('solicitante_externo', e.id, e.versao, {
        nome: e.nome,
        conselho_classe_id: Number(conselho['id']),
        conselho_unidade_federativa_id: Number(uf['id']),
        numero_conselho: numero,
        cpf: e.cpf,
        cns: e.cns,
        ocupacao_cbo_id: e.ocupacao,
        especialidade_medica_id: e.especialidade,
        instituicao_nome: e.instituicaoNome || null,
        instituicao_cnpj: e.instituicaoCnpj,
        instituicao_codigo_cnes: e.instituicaoCnes,
        telefone: e.telefone || null,
        email: e.email,
        observacao: e.observacao || null,
      });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'solicitante_externo', id: e.id }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

const esquemaSituacao = z
  .object({ id: idPos, versao: idPos, ativo: z.boolean(), motivo: z.string().max(200), data: dia.nullable() })
  .strict();
export type EntradaSituacaoSolicitante = z.infer<typeof esquemaSituacao>;

const opSituacaoSolicitante = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.solicitante.mudar-situacao',
    tabelas: ['solicitante_externo'],
    entrada: esquemaSituacao,
    acao: 'alteracao',
    async gravar(tx, e) {
      const s = await tx.uma(
        'SELECT ativo, data_inscricao FROM solicitante_externo WHERE id = ? AND excluido_em IS NULL',
        [e.id],
      );
      if (!s) throw naoAchado('Solicitante');
      if (bool(s['ativo']) === e.ativo)
        throw recusaCampo(
          'sem-alteracao',
          e.ativo ? 'O solicitante já está ativo.' : 'O solicitante já está inativo.',
          'ativo',
        );
      const quando = e.data ?? (await hojeDe(tx));
      recusarErros(errosInativacao({ motivo: e.motivo, data: quando, inscricao: data(s['data_inscricao']) }));
      await tx.alterar(
        'solicitante_externo',
        e.id,
        e.versao,
        e.ativo ? { ativo: true, data_inativacao: null } : { ativo: false, data_inativacao: quando },
      );
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'solicitante_externo', id: e.id }),
    trilha: (e) => ({ dados: t.dadosDepois ?? null, motivo: e.motivo.replace(/\s+/g, ' ').trim() }),
  });

const esquemaCodigoFonte = z
  .object({ solicitante: idPos, fonte: idPos, codigo: z.string().max(40), ativo: z.boolean() })
  .strict();
export type EntradaCodigoFonte = z.infer<typeof esquemaCodigoFonte>;

/** Grava o código do solicitante na fonte pagadora (um por fonte): inclui, troca o código ou inativa. */
const opCodigoFonte = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.solicitante.codigo-na-fonte',
    tabelas: ['solicitante_externo_fonte_pagadora'],
    entrada: esquemaCodigoFonte,
    acao: 'operacao',
    async gravar(tx, e) {
      if (
        !(await tx.uma('SELECT id FROM solicitante_externo WHERE id = ? AND excluido_em IS NULL', [
          e.solicitante,
        ]))
      )
        throw naoAchado('Solicitante');
      if (!(await tx.uma('SELECT id FROM fonte_pagadora WHERE id = ? AND excluido_em IS NULL', [e.fonte])))
        throw recusaCampo('fonte-inexistente', 'Fonte pagadora não encontrada.', 'fonte');
      const codigo = e.codigo.trim();
      if (e.ativo) recusarErros(errosCodigoNaFonte(codigo));
      const atual = await tx.uma(
        `SELECT id, codigo_na_fonte, ativo, versao FROM solicitante_externo_fonte_pagadora
          WHERE solicitante_externo_id = ? AND fonte_pagadora_id = ? AND excluido_em IS NULL FOR UPDATE`,
        [e.solicitante, e.fonte],
      );
      if (!atual) {
        if (!e.ativo) throw naoAchado('Código');
        const id = await tx.incluir('solicitante_externo_fonte_pagadora', {
          solicitante_externo_id: e.solicitante,
          fonte_pagadora_id: e.fonte,
          codigo_na_fonte: codigo,
          ativo: true,
        });
        return { id };
      }
      const novoCodigo = e.ativo ? codigo : String(atual['codigo_na_fonte']);
      if (bool(atual['ativo']) === e.ativo && String(atual['codigo_na_fonte']) === novoCodigo)
        throw recusaCampo('sem-alteracao', 'O código já está assim.', 'codigo');
      await tx.alterar('solicitante_externo_fonte_pagadora', Number(atual['id']), Number(atual['versao']), {
        codigo_na_fonte: novoCodigo,
        ativo: e.ativo,
      });
      return { id: Number(atual['id']) };
    },
    alvo: (_e, r) => ({ tabela: 'solicitante_externo_fonte_pagadora', id: Number(r.id) }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

// ── Leituras ──

export interface LigacoesEspecialidade {
  hoje: string;
  procedimentos: {
    id: number;
    versao: number;
    procedimento: number;
    codigo: string;
    descricao: string;
    vigenciaInicio: string;
    vigenciaFim: string | null;
    vigente: boolean;
  }[];
  ocupacoes: {
    id: number;
    versao: number;
    ocupacao: number;
    codigo: string;
    descricao: string;
    principal: boolean;
  }[];
}

export interface LotacaoLida {
  id: number;
  versao: number;
  estabelecimento: number;
  estabelecimentoNome: string;
  unidade: number | null;
  unidadeNome: string | null;
  ocupacao: number;
  ocupacaoCodigo: string;
  ocupacaoDescricao: string;
  inscricao: number | null;
  tipoVinculo: number | null;
  tipoVinculoDescricao: string | null;
  cargaAmbulatorial: number;
  cargaHospitalar: number;
  cargaOutros: number;
  cargaSemanal: number;
  ocupacaoPadrao: boolean;
  atendeSus: boolean;
  geraRepasse: boolean;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  vigente: boolean;
}

export interface FichaSolicitante {
  id: number;
  versao: number;
  nome: string;
  conselho: string;
  uf: string;
  numero: string;
  cpf: string | null;
  cns: string | null;
  ocupacao: number | null;
  ocupacaoCodigo: string | null;
  especialidade: number | null;
  instituicaoNome: string | null;
  instituicaoCnpj: string | null;
  instituicaoCnes: string | null;
  telefone: string | null;
  email: string | null;
  observacao: string | null;
  ativo: boolean;
  dataInativacao: string | null;
  faltaParaGuia: string[];
  parecidos: { id: number; nome: string; registro: string; ativo: boolean; motivo: string }[];
  codigos: { id: number; versao: number; fonte: number; fonteNome: string; codigo: string; ativo: boolean }[];
}

const SQL_SOLICITANTES = `SELECT s.id, s.nome, cc.sigla AS conselho, uf.sigla AS uf, s.numero_conselho, o.codigo_cbo, s.ativo
  FROM solicitante_externo s JOIN conselho_classe cc ON cc.id = s.conselho_classe_id
  JOIN unidade_federativa uf ON uf.id = s.conselho_unidade_federativa_id
  LEFT JOIN ocupacao_cbo o ON o.id = s.ocupacao_cbo_id WHERE s.excluido_em IS NULL`;
const comparavel = (r: Record<string, unknown>): SolicitanteParecido & { ativo: boolean } => ({
  id: Number(r['id']),
  nome: String(r['nome']),
  conselho: texto(r['conselho']),
  uf: texto(r['uf']),
  numero: /^\d+$/.test(String(r['numero_conselho'] ?? '')) ? Number(r['numero_conselho']) : null,
  cbo: texto(r['codigo_cbo']),
  ativo: bool(r['ativo']),
});

export class CadastroLigacoesProprio {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoCadastro,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'cadastro' }, fn);
  }

  private async estabelecimento(c: ContextoPorta): Promise<number> {
    if (c.estabelecimento !== null) return c.estabelecimento;
    const r = c.hospital
      ? await this.ler(c, (l) =>
          l.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
            c.hospital,
          ]),
        )
      : null;
    if (!r)
      throw new ErroOperacao(
        403,
        'sem-estabelecimento',
        'Sem estabelecimento',
        'A sessão não tem estabelecimento.',
      );
    return Number(r.id);
  }

  /** O estabelecimento a que a lotação se limita: o da sessão; null só no acesso total (administrador). */
  private async escopo(c: ContextoPorta, todos: boolean): Promise<number | null> {
    return todos ? null : this.estabelecimento(c);
  }

  private async executar<E>(
    c: ContextoPorta,
    op: Parameters<Executor['executar']>[0],
    entrada: E,
    t: RegistroTrilhaTela,
  ): Promise<number> {
    const est = await this.estabelecimento(c);
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: t.estabelecimento ?? est,
      usuario: t.usuario ?? c.usuario,
      correlacao: (t.correlacao ?? c.correlacao).slice(0, 64) || 'cadastro',
      chaveIdempotencia: `direta:${randomUUID()}`,
    };
    const x = await this.executor.executar(op, this.cliente, entrada, ctx);
    return Number((x.resultado as { id: unknown }).id);
  }

  incluirProcedimento(c: ContextoPorta, e: EntradaProcedimentoEspecialidade, t: RegistroTrilhaTela) {
    return this.executar(c, opIncluirProcedimento(t), e, t);
  }
  encerrarProcedimento(c: ContextoPorta, e: EntradaEncerrar, t: RegistroTrilhaTela) {
    return this.executar(c, opEncerrar('especialidade_procedimento', t, null), e, t);
  }
  gravarOcupacao(c: ContextoPorta, e: EntradaOcupacaoEspecialidade, t: RegistroTrilhaTela) {
    return this.executar(c, opGravarOcupacao(t), e, t);
  }
  retirarOcupacao(c: ContextoPorta, e: { dono: number; id: number; versao: number }, t: RegistroTrilhaTela) {
    return this.executar(c, opRetirarOcupacao(t), e, t);
  }
  async incluirLotacao(c: ContextoPorta, e: EntradaLotacao, t: RegistroTrilhaTela, todos = false) {
    return this.executar(c, opIncluirLotacao(t, await this.escopo(c, todos)), e, t);
  }
  async encerrarLotacao(c: ContextoPorta, e: EntradaEncerrar, t: RegistroTrilhaTela, todos = false) {
    return this.executar(c, opEncerrar('lotacao_profissional', t, await this.escopo(c, todos)), e, t);
  }
  alterarSolicitante(c: ContextoPorta, e: EntradaAlterarSolicitante, t: RegistroTrilhaTela) {
    return this.executar(c, opAlterarSolicitante(t), e, t);
  }
  mudarSituacaoSolicitante(c: ContextoPorta, e: EntradaSituacaoSolicitante, t: RegistroTrilhaTela) {
    return this.executar(c, opSituacaoSolicitante(t), e, t);
  }
  gravarCodigoFonte(c: ContextoPorta, e: EntradaCodigoFonte, t: RegistroTrilhaTela) {
    return this.executar(c, opCodigoFonte(t), e, t);
  }

  ligacoesEspecialidade(c: ContextoPorta, especialidade: number): Promise<LigacoesEspecialidade> {
    return this.ler(c, async (l) => {
      const hoje = await hojeDe(l);
      const ps = await l.consultar(
        `SELECT ep.id, ep.versao, ep.item_faturavel_id, i.codigo, i.descricao, ep.vigencia_inicio, ep.vigencia_fim
           FROM especialidade_procedimento ep JOIN item_faturavel i ON i.id = ep.item_faturavel_id
          WHERE ep.especialidade_medica_id = ? AND ep.ativo AND ep.excluido_em IS NULL
          ORDER BY i.descricao, ep.vigencia_inicio DESC`,
        [especialidade],
      );
      const os = await l.consultar(
        `SELECT eo.id, eo.versao, eo.ocupacao_cbo_id, o.codigo_cbo, o.descricao, eo.principal
           FROM especialidade_ocupacao eo JOIN ocupacao_cbo o ON o.id = eo.ocupacao_cbo_id
          WHERE eo.especialidade_medica_id = ? AND eo.excluido_em IS NULL ORDER BY eo.principal DESC, o.descricao`,
        [especialidade],
      );
      return {
        hoje,
        procedimentos: ps.map((p) => {
          const inicio = data(p['vigencia_inicio'])!;
          const fim = data(p['vigencia_fim']);
          return {
            id: Number(p['id']),
            versao: Number(p['versao']),
            procedimento: Number(p['item_faturavel_id']),
            codigo: String(p['codigo']),
            descricao: String(p['descricao']),
            vigenciaInicio: inicio,
            vigenciaFim: fim,
            vigente: inicio <= hoje && (fim === null || fim >= hoje),
          };
        }),
        ocupacoes: os.map((o) => ({
          id: Number(o['id']),
          versao: Number(o['versao']),
          ocupacao: Number(o['ocupacao_cbo_id']),
          codigo: String(o['codigo_cbo']),
          descricao: String(o['descricao']),
          principal: bool(o['principal']),
        })),
      };
    });
  }

  /**
   * Lotações do profissional. Fora do acesso total (administrador da plataforma), só as do estabelecimento da sessão.
   * `cargaHoje` é a soma das lotações que valem hoje (todas as do profissional, para o aviso de jornada alta).
   */
  async lotacoes(
    c: ContextoPorta,
    profissional: number,
    todos = false,
  ): Promise<{ hoje: string; itens: LotacaoLida[]; cargaHoje: number; cargaAlta: boolean }> {
    const restrito = await this.escopo(c, todos);
    return this.ler(c, async (l) => {
      const soma = await l.uma<{ carga: unknown }>(
        `SELECT COALESCE(SUM(carga_horaria_ambulatorial + carga_horaria_hospitalar + carga_horaria_outros), 0) AS carga
           FROM lotacao_profissional WHERE profissional_id = ? AND ativo AND excluido_em IS NULL
            AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)`,
        [profissional],
      );
      const cargaHoje = Number(soma?.carga ?? 0);
      const hoje = await hojeDe(l);
      const rs = await l.consultar(
        `SELECT lp.*, e.nome_fantasia AS est_nome, u.nome AS un_nome, o.codigo_cbo, o.descricao AS cbo_desc, tv.descricao AS tv_desc
           FROM lotacao_profissional lp JOIN estabelecimento e ON e.id = lp.estabelecimento_id
           JOIN ocupacao_cbo o ON o.id = lp.ocupacao_cbo_id
           LEFT JOIN unidade_assistencial u ON u.id = lp.unidade_assistencial_id
           LEFT JOIN tipo_vinculo_trabalho tv ON tv.id = lp.tipo_vinculo_trabalho_id
          WHERE lp.profissional_id = ? AND lp.ativo AND lp.excluido_em IS NULL${restrito === null ? '' : ' AND lp.estabelecimento_id = ?'}
          ORDER BY lp.vigencia_fim IS NULL DESC, lp.vigencia_inicio DESC, lp.id DESC`,
        restrito === null ? [profissional] : [profissional, restrito],
      );
      return {
        hoje,
        cargaHoje,
        cargaAlta: cargaHoje > CARGA_SEMANAL_ALTA,
        itens: rs.map((r) => {
          const inicio = data(r['vigencia_inicio'])!;
          const fim = data(r['vigencia_fim']);
          const a = Number(r['carga_horaria_ambulatorial']);
          const h = Number(r['carga_horaria_hospitalar']);
          const o = Number(r['carga_horaria_outros']);
          return {
            id: Number(r['id']),
            versao: Number(r['versao']),
            estabelecimento: Number(r['estabelecimento_id']),
            estabelecimentoNome: String(r['est_nome']),
            unidade: num(r['unidade_assistencial_id']),
            unidadeNome: texto(r['un_nome']),
            ocupacao: Number(r['ocupacao_cbo_id']),
            ocupacaoCodigo: String(r['codigo_cbo']),
            ocupacaoDescricao: String(r['cbo_desc']),
            inscricao: num(r['inscricao_conselho_id']),
            tipoVinculo: num(r['tipo_vinculo_trabalho_id']),
            tipoVinculoDescricao: texto(r['tv_desc']),
            cargaAmbulatorial: a,
            cargaHospitalar: h,
            cargaOutros: o,
            cargaSemanal: a + h + o,
            ocupacaoPadrao: bool(r['ocupacao_padrao']),
            atendeSus: bool(r['atende_sus']),
            geraRepasse: bool(r['gera_repasse']),
            vigenciaInicio: inicio,
            vigenciaFim: fim,
            vigente: inicio <= hoje && (fim === null || fim >= hoje),
          };
        }),
      };
    });
  }

  /** Listas da tela da lotação e da especialidade (busca por termo nas ocupações e nos procedimentos). */
  async opcoes(c: ContextoPorta, termo: string | null, todos = false) {
    const restrito = await this.escopo(c, todos);
    const soEst = restrito === null ? '' : ' AND id = ?';
    const estP = restrito === null ? [] : [restrito];
    return this.ler(c, async (l) => {
      const like = `%${(termo ?? '').replace(/[%_]/g, '')}%`;
      const [ests, unids, vincs, cbos, procs, esps] = await Promise.all([
        l.consultar(
          'SELECT id, nome_fantasia AS nome FROM estabelecimento WHERE excluido_em IS NULL${soEst} ORDER BY nome_fantasia',
          estP,
        ),
        l.consultar(
          `SELECT id, estabelecimento_id, nome FROM unidade_assistencial WHERE excluido_em IS NULL${soEst.replace('id', 'estabelecimento_id')} ORDER BY nome`,
          estP,
        ),
        l.consultar(
          "SELECT id, codigo_cnes, descricao FROM tipo_vinculo_trabalho WHERE ativo AND nivel <> 'vinculo' ORDER BY codigo_cnes",
          [],
        ),
        termo
          ? l.consultar(
              'SELECT id, codigo_cbo, descricao FROM ocupacao_cbo WHERE codigo_cbo LIKE ? OR descricao LIKE ? ORDER BY descricao LIMIT 30',
              [like, like],
            )
          : Promise.resolve([]),
        termo
          ? l.consultar(
              "SELECT id, codigo, descricao FROM item_faturavel WHERE excluido_em IS NULL AND tipo_item = 'procedimento' AND (codigo LIKE ? OR descricao LIKE ?) ORDER BY descricao LIMIT 30",
              [like, like],
            )
          : Promise.resolve([]),
        termo
          ? l.consultar(
              'SELECT id, codigo, descricao FROM especialidade_medica WHERE excluido_em IS NULL AND (codigo LIKE ? OR descricao LIKE ?) ORDER BY descricao LIMIT 30',
              [like, like],
            )
          : Promise.resolve([]),
      ]);
      return {
        estabelecimentos: ests.map((e) => ({ id: Number(e['id']), nome: String(e['nome']) })),
        unidades: unids.map((u) => ({
          id: Number(u['id']),
          estabelecimento: Number(u['estabelecimento_id']),
          nome: String(u['nome']),
        })),
        tiposVinculo: vincs.map((v) => ({
          id: Number(v['id']),
          codigo: String(v['codigo_cnes']),
          descricao: String(v['descricao']),
        })),
        ocupacoes: cbos.map((o) => ({
          id: Number(o['id']),
          codigo: String(o['codigo_cbo']),
          descricao: String(o['descricao']),
        })),
        procedimentos: procs.map((p) => ({
          id: Number(p['id']),
          codigo: String(p['codigo']),
          descricao: String(p['descricao']),
        })),
        especialidades: esps.map((p) => ({
          id: Number(p['id']),
          codigo: String(p['codigo']),
          descricao: String(p['descricao']),
        })),
      };
    });
  }

  /** Parecidos com o solicitante proposto (antes de incluir: a tela avisa na hora, sem gravar nada). */
  parecidosCom(
    c: ContextoPorta,
    alvo: { id?: number; nome: string; conselho: string | null; uf: string | null; numero: number | null },
  ) {
    return this.ler(c, async (l) => {
      const ufs = alvo.uf ? [alvo.uf.toUpperCase()] : [];
      const rs = await l.consultar(`${SQL_SOLICITANTES}${ufs.length ? ' AND uf.sigla = ?' : ''}`, ufs);
      const lista = rs.map(comparavel);
      const por = new Map(lista.map((s) => [s.id, s]));
      return parecidos(lista, { ...alvo, cbo: null }).map((p) => {
        const s = por.get(p.id)!;
        return {
          id: s.id,
          nome: s.nome,
          registro: `${s.conselho} ${s.numero ?? ''}/${s.uf}`,
          ativo: s.ativo,
          motivo: p.motivo,
        };
      });
    });
  }

  async fichaSolicitante(c: ContextoPorta, id: number): Promise<FichaSolicitante> {
    const f = await this.ler(c, async (l) => {
      const s = await l.uma(
        `SELECT s.*, cc.sigla AS conselho, uf.sigla AS uf, o.codigo_cbo FROM solicitante_externo s
           JOIN conselho_classe cc ON cc.id = s.conselho_classe_id
           JOIN unidade_federativa uf ON uf.id = s.conselho_unidade_federativa_id
           LEFT JOIN ocupacao_cbo o ON o.id = s.ocupacao_cbo_id WHERE s.id = ? AND s.excluido_em IS NULL`,
        [id],
      );
      if (!s) return null;
      const cods = await l.consultar(
        `SELECT x.id, x.versao, x.fonte_pagadora_id, f.nome, x.codigo_na_fonte, x.ativo
           FROM solicitante_externo_fonte_pagadora x JOIN fonte_pagadora f ON f.id = x.fonte_pagadora_id
          WHERE x.solicitante_externo_id = ? AND x.excluido_em IS NULL ORDER BY x.ativo DESC, f.nome`,
        [id],
      );
      return { s, cods };
    });
    if (!f) throw naoAchado('Solicitante');
    const s = f.s;
    const cmp = comparavel(s);
    return {
      id,
      versao: Number(s['versao']),
      nome: String(s['nome']),
      conselho: String(s['conselho']),
      uf: String(s['uf']),
      numero: String(s['numero_conselho']),
      cpf: texto(s['cpf']),
      cns: texto(s['cns']),
      ocupacao: num(s['ocupacao_cbo_id']),
      ocupacaoCodigo: texto(s['codigo_cbo']),
      especialidade: num(s['especialidade_medica_id']),
      instituicaoNome: texto(s['instituicao_nome']),
      instituicaoCnpj: texto(s['instituicao_cnpj']),
      instituicaoCnes: texto(s['instituicao_codigo_cnes']),
      telefone: texto(s['telefone']),
      email: texto(s['email']),
      observacao: texto(s['observacao']),
      ativo: bool(s['ativo']),
      dataInativacao: data(s['data_inativacao']),
      faltaParaGuia: camposFaltantes(cmp),
      parecidos: await this.parecidosCom(c, {
        id,
        nome: cmp.nome,
        conselho: cmp.conselho,
        uf: cmp.uf,
        numero: cmp.numero,
      }),
      codigos: f.cods.map((x) => ({
        id: Number(x['id']),
        versao: Number(x['versao']),
        fonte: Number(x['fonte_pagadora_id']),
        fonteNome: String(x['nome']),
        codigo: String(x['codigo_na_fonte']),
        ativo: bool(x['ativo']),
      })),
    };
  }
}
