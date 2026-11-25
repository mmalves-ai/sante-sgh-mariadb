// Profissional provisório no banco próprio (F8, 02-CAD linha 21): quem atende antes de completar o cadastro e
// regulariza depois. Cadastro mínimo em `profissional_provisorio` (conselho, número e UF da inscrição, motivo e prazo
// curto), registros ligados em `profissional_provisorio_uso` (atendimento, paciente, agenda cirúrgica e de internação) e
// a regularização, que liga o provisório ao cadastro definitivo e transfere o profissional dos registros ligados (o
// atendimento passa a ser do definitivo, com a trilha na mesma transação). A autoria não se perde: ao ligar, o registro
// guarda o substituto declarado (em cujo nome ele foi feito); ao transferir, guarda o profissional anterior, a situação
// do registro e se a transferência foi confirmada; registro fechado, faturado ou com outro profissional só passa com
// confirmação explícita (pendenciasTransferencia). O prazo vencido é só alerta (ADR 0002): a
// lista mostra os vencidos e os que vencem logo, sem trava. Nada é apagado: regularizado e cancelado ficam.
// A regra é a do domínio (@sgh/dominio-cadastro, profissional/provisorio); aqui só leitura, conferência no banco e
// gravação pelo executor (trilha e idempotência na mesma transação).
import { randomUUID } from 'node:crypto';
import {
  type EntradaProvisorio,
  errosCancelamento,
  errosPrazo,
  errosProvisorio,
  errosRegularizacao,
  errosTransferencia,
  errosUso,
  estadoDoPrazo,
  type EstadoPrazo,
  normalizarNumeroConselho,
  type PendenciaTransferencia,
  pendenciasTransferencia,
  prazoSugerido,
  SITUACOES_CONTA_FATURADA,
  type SituacaoProvisorio,
  somenteDigitos,
  type TipoUsoProvisorio,
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

export const PROFISSIONAL_PROVISORIO = Symbol('PROFISSIONAL_PROVISORIO');

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const data = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);
const bool = (v: unknown): boolean => v === true || Number(v) === 1;
const hojeLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const MENSAGENS: Record<string, [string, string]> = {
  'nome-curto': ['Escreva o nome com ao menos 3 letras.', 'nome'],
  'nome-longo': ['O nome tem no máximo 150 letras.', 'nome'],
  'nome-incompleto': ['Escreva o nome e o sobrenome.', 'nome'],
  'cpf-invalido': ['CPF inválido: confira os dígitos.', 'cpf'],
  'conselho-ausente': ['Escolha o conselho profissional.', 'conselho'],
  'numero-conselho-ausente': ['Informe o número da inscrição no conselho.', 'numeroConselho'],
  'numero-conselho-longo': ['O número da inscrição tem no máximo 20 caracteres.', 'numeroConselho'],
  'uf-conselho-ausente': ['Escolha a UF da inscrição no conselho.', 'ufConselho'],
  'motivo-curto': ['Escreva o motivo com ao menos 10 letras.', 'motivo'],
  'motivo-longo': ['O motivo tem no máximo 500 letras.', 'motivo'],
  'inicio-invalido': ['Informe uma data de início válida.', 'dataInicio'],
  'inicio-futuro': ['O início não pode ser depois de hoje.', 'dataInicio'],
  'inicio-antigo': ['O início vai até 30 dias para trás.', 'dataInicio'],
  'prazo-invalido': ['Informe um prazo válido.', 'prazo'],
  'prazo-antes-do-inicio': ['O prazo vem depois do início.', 'prazo'],
  'prazo-longo': ['O prazo é de no máximo 90 dias a partir do início.', 'prazo'],
  'prazo-nao-prorroga': ['O novo prazo vem depois do prazo atual.', 'prazo'],
  'tipo-uso-invalido': ['Escolha o tipo do registro.', 'tipo'],
  'provisorio-encerrado': ['O provisório já foi regularizado ou cancelado.', 'situacao'],
  'definitivo-inativo': ['O cadastro definitivo não está ativo.', 'profissional'],
  'cpf-diferente': ['O CPF do cadastro definitivo é outro.', 'profissional'],
  'inscricao-diferente': [
    'O cadastro definitivo não tem a mesma inscrição ativa no conselho (conselho, número e UF).',
    'profissional',
  ],
  'transferencia-a-confirmar': [
    'Há registro fechado, faturado ou hoje em nome de outro profissional que não o substituto declarado: confira e confirme a transferência.',
    'confirmar',
  ],
  'usos-pendentes': [
    'Há registros ligados ao provisório: regularize-o para o cadastro definitivo em vez de cancelar.',
    'situacao',
  ],
};
function recusarErros(erros: readonly string[]): void {
  if (!erros.length) return;
  throw recusa(erros[0]!, erros.map((e) => MENSAGENS[e]?.[0] ?? e).join(' '), {
    campos: [...new Set(erros.map((e) => MENSAGENS[e]?.[1] ?? e))],
  });
}
const naoAchado = () =>
  new ErroOperacao(
    404,
    'provisorio-inexistente',
    'Não encontrado',
    'Profissional provisório não encontrado neste estabelecimento.',
  );

const idPos = z.number().int().positive();
const esquemaEntrada = z
  .object({
    nome: z.string().max(400),
    cpf: z.string().max(20).nullable(),
    conselhoId: idPos.nullable(),
    numeroConselho: z.string().max(40).nullable(),
    ufConselhoId: idPos.nullable(),
    ocupacaoId: idPos.nullable(),
    especialidadeId: idPos.nullable(),
    telefone: z.string().max(20).nullable(),
    motivo: z.string().max(1000),
    dataInicio: z.string().max(10),
    prazo: z.string().max(10).nullable(),
    observacao: z.string().max(1000).nullable(),
  })
  .strict();
export type EntradaProvisorioTela = z.infer<typeof esquemaEntrada>;

/** Lê e trava o provisório do estabelecimento. */
async function lerProvisorio(tx: TxOperacao, id: number, est: number): Promise<Record<string, unknown>> {
  const [x] = await tx.consultarParaAtualizar(
    `SELECT id, situacao, cpf, conselho_classe_id, numero_conselho, conselho_unidade_federativa_id, data_inicio,
            prazo_regularizacao, versao
       FROM profissional_provisorio WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est],
  );
  if (!x) throw naoAchado();
  return x;
}

const opCriar = (t: RegistroTrilhaTela, est: number, hoje: string) =>
  definirOperacao({
    nome: 'cadastro.profissional-provisorio.criar',
    tabelas: ['profissional_provisorio'],
    entrada: esquemaEntrada,
    acao: 'inclusao',
    async gravar(tx, e) {
      const prazo = e.prazo ?? (e.dataInicio ? prazoSugerido(e.dataInicio) : '');
      let porUf = true;
      if (e.conselhoId !== null) {
        const c = await tx.uma('SELECT inscricao_por_uf FROM conselho_classe WHERE id = ? AND ativo', [
          e.conselhoId,
        ]);
        if (!c) throw recusa('conselho-inexistente', 'Conselho não encontrado.', { campos: ['conselho'] });
        porUf = bool(c['inscricao_por_uf']);
      }
      const dom: EntradaProvisorio = {
        nome: e.nome,
        cpf: e.cpf,
        conselhoId: e.conselhoId,
        numeroConselho: e.numeroConselho,
        ufConselhoId: e.ufConselhoId,
        motivo: e.motivo,
        dataInicio: e.dataInicio,
        prazo,
      };
      recusarErros(errosProvisorio(dom, hoje, porUf));
      if (
        e.ufConselhoId !== null &&
        !(await tx.uma('SELECT id FROM unidade_federativa WHERE id = ?', [e.ufConselhoId]))
      )
        throw recusa('uf-inexistente', 'UF não encontrada.', { campos: ['ufConselho'] });
      const numero = normalizarNumeroConselho(e.numeroConselho);
      // Um provisório aberto por inscrição no estabelecimento: o segundo atendimento usa o mesmo.
      const abertos = await tx.consultarParaAtualizar(
        `SELECT id, numero_conselho, conselho_unidade_federativa_id FROM profissional_provisorio
          WHERE estabelecimento_id = ? AND conselho_classe_id = ? AND situacao IN ('provisorio','expirado')
            AND excluido_em IS NULL`,
        [est, e.conselhoId],
      );
      const dup = abertos.find(
        (a) =>
          normalizarNumeroConselho(txt(a['numero_conselho'])) === numero &&
          num(a['conselho_unidade_federativa_id']) === e.ufConselhoId,
      );
      if (dup)
        throw recusa(
          'provisorio-ja-aberto',
          'Já há um provisório aberto com esta inscrição neste estabelecimento: ligue o registro a ele.',
          { campos: ['numeroConselho'] },
        );
      const id = await tx.incluir('profissional_provisorio', {
        estabelecimento_id: est,
        nome: e.nome.trim().replace(/\s+/g, ' '),
        cpf: e.cpf && e.cpf.trim() ? somenteDigitos(e.cpf) : null,
        conselho_classe_id: e.conselhoId,
        numero_conselho: numero,
        conselho_unidade_federativa_id: e.ufConselhoId,
        ocupacao_cbo_id: e.ocupacaoId,
        especialidade_medica_id: e.especialidadeId,
        telefone: e.telefone?.trim() || null,
        motivo: e.motivo.trim(),
        data_inicio: e.dataInicio,
        prazo_regularizacao: prazo,
        situacao: 'provisorio',
        observacao: e.observacao?.trim() || null,
        origem: 'sistema',
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'profissional_provisorio', id: Number(r.id) }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

const esquemaUso = z
  .object({
    id: idPos,
    tipo: z.enum(['atendimento', 'paciente', 'agendamento_cirurgico', 'agendamento_internacao']),
    registroId: idPos,
  })
  .strict();
export type EntradaUso = z.infer<typeof esquemaUso>;

/**
 * Confere que o registro existe e é do estabelecimento (o paciente é da rede: só existir) e devolve o profissional em
 * cujo nome ele está (o substituto declarado, que a regularização confere antes de transferir).
 */
async function conferirRegistro(
  tx: TxOperacao,
  tipo: TipoUsoProvisorio,
  id: number,
  est: number,
): Promise<number | null> {
  let achou: Record<string, unknown> | null;
  if (tipo === 'atendimento')
    achou = await tx.uma(
      'SELECT id, profissional_id AS atual FROM atendimento WHERE id = ? AND estabelecimento_id = ?',
      [id, est],
    );
  else if (tipo === 'paciente')
    achou = await tx.uma('SELECT id, NULL AS atual FROM paciente WHERE id = ?', [id]);
  else if (tipo === 'agendamento_cirurgico')
    achou = await tx.uma(
      `SELECT id, cirurgiao_profissional_id AS atual FROM agendamento_cirurgico
        WHERE id = ? AND estabelecimento_id = ?`,
      [id, est],
    );
  else
    achou = await tx.uma(
      `SELECT id, medico_profissional_id AS atual FROM agendamento_internacao
        WHERE id = ? AND estabelecimento_id = ?`,
      [id, est],
    );
  if (!achou)
    throw recusa('registro-inexistente', 'Registro não encontrado neste estabelecimento.', {
      campos: ['registroId'],
    });
  return num(achou['atual']);
}

/** Os registros ligados ao provisório, com o número, o paciente, a situação e o profissional atual de cada um. */
const SQL_USOS = `SELECT u.id, u.sequencia, u.tipo, u.atendimento_id, u.paciente_id, u.agendamento_cirurgico_id,
        u.agendamento_internacao_id, u.regularizado, u.versao, u.substituto_profissional_id,
        u.anterior_profissional_id, u.situacao_registro_transferencia, u.transferencia_confirmada, u.transferido_em,
        COALESCE(a.numero, ac.numero, ai.numero) AS numero,
        COALESCE(a.situacao, ac.situacao, ai.situacao) AS situacao,
        COALESCE(a.profissional_id, ac.cirurgiao_profissional_id, ai.medico_profissional_id) AS atual,
        COALESCE(a.versao, ac.versao, ai.versao) AS registro_versao,
        COALESCE(a.entrada_em, ac.inicio_previsto_em, ai.previsto_para, u.vigencia_inicio) AS quando,
        pa.numero_prontuario,
        IF(pa.usa_nome_social AND pa.nome_social IS NOT NULL, pa.nome_social, ppf.nome) AS paciente_nome,
        (SELECT COUNT(*) FROM conta_hospitalar ch
          WHERE ch.atendimento_id = u.atendimento_id AND ch.excluido_em IS NULL
            AND ch.situacao IN (?, ?, ?, ?)) AS faturadas
   FROM profissional_provisorio_uso u
   LEFT JOIN atendimento a ON a.id = u.atendimento_id
   LEFT JOIN agendamento_cirurgico ac ON ac.id = u.agendamento_cirurgico_id
   LEFT JOIN agendamento_internacao ai ON ai.id = u.agendamento_internacao_id
   LEFT JOIN paciente pa ON pa.id = COALESCE(u.paciente_id, a.paciente_id, ac.paciente_id, ai.paciente_id)
   LEFT JOIN pessoa_fisica ppf ON ppf.id = pa.pessoa_fisica_id
  WHERE u.profissional_provisorio_id = ? AND u.excluido_em IS NULL`;
const paramsUsos = (provisorio: number): unknown[] => [...SITUACOES_CONTA_FATURADA.slice(0, 4), provisorio];

/** Uma linha de SQL_USOS na forma da regra do domínio. */
const registroDoUso = (u: Record<string, unknown>) => ({
  tipo: String(u['tipo']) as TipoUsoProvisorio,
  situacao: txt(u['situacao']),
  faturado: Number(u['faturadas'] ?? 0) > 0,
  profissionalAtualId: num(u['atual']),
  substitutoId: num(u['substituto_profissional_id']),
});

const COLUNA_USO: Record<TipoUsoProvisorio, string> = {
  atendimento: 'atendimento_id',
  paciente: 'paciente_id',
  agendamento_cirurgico: 'agendamento_cirurgico_id',
  agendamento_internacao: 'agendamento_internacao_id',
};

const opUso = (t: RegistroTrilhaTela, est: number) =>
  definirOperacao({
    nome: 'cadastro.profissional-provisorio.ligar',
    tabelas: ['profissional_provisorio_uso'],
    entrada: esquemaUso,
    acao: 'inclusao',
    async gravar(tx, e) {
      const p = await lerProvisorio(tx, e.id, est);
      recusarErros(errosUso(String(p['situacao']) as SituacaoProvisorio, e.tipo));
      const substituto = await conferirRegistro(tx, e.tipo, e.registroId, est);
      const usos = await tx.consultar(
        `SELECT sequencia, tipo, atendimento_id, paciente_id, agendamento_cirurgico_id, agendamento_internacao_id
           FROM profissional_provisorio_uso WHERE profissional_provisorio_id = ? AND excluido_em IS NULL`,
        [e.id],
      );
      const coluna = COLUNA_USO[e.tipo];
      if (usos.some((u) => u['tipo'] === e.tipo && num(u[coluna]) === e.registroId))
        throw recusa('uso-ja-ligado', 'Este registro já está ligado ao provisório.', {
          campos: ['registroId'],
        });
      const sequencia = usos.reduce((m, u) => Math.max(m, Number(u['sequencia'])), 0) + 1;
      const id = await tx.incluir('profissional_provisorio_uso', {
        profissional_provisorio_id: e.id,
        sequencia,
        tipo: e.tipo,
        atendimento_id: e.tipo === 'atendimento' ? e.registroId : null,
        paciente_id: e.tipo === 'paciente' ? e.registroId : null,
        agendamento_cirurgico_id: e.tipo === 'agendamento_cirurgico' ? e.registroId : null,
        agendamento_internacao_id: e.tipo === 'agendamento_internacao' ? e.registroId : null,
        substituto_profissional_id: substituto,
        vigencia_inicio: e.tipo === 'paciente' ? new Date() : null,
        regularizado: false,
        origem: 'sistema',
      });
      return { id, sequencia };
    },
    alvo: (_e, r) => ({ tabela: 'profissional_provisorio_uso', id: Number(r.id) }),
    trilha: (e) => ({ dados: { ...(t.dadosDepois ?? {}), provisorio: e.id, tipo: e.tipo }, motivo: null }),
  });

const esquemaPrazo = z
  .object({ id: idPos, versao: idPos, prazo: z.string().max(10), motivo: z.string().max(500) })
  .strict();
const opProrrogar = (t: RegistroTrilhaTela, est: number) =>
  definirOperacao({
    nome: 'cadastro.profissional-provisorio.prorrogar',
    tabelas: ['profissional_provisorio'],
    entrada: esquemaPrazo,
    acao: 'alteracao',
    async gravar(tx, e) {
      const p = await lerProvisorio(tx, e.id, est);
      const erros = errosUso(String(p['situacao']) as SituacaoProvisorio, 'atendimento');
      erros.push(...errosPrazo(data(p['data_inicio']), e.prazo, data(p['prazo_regularizacao'])));
      if (e.motivo.trim().length < 10) erros.push('motivo-curto');
      recusarErros(erros);
      await tx.alterar('profissional_provisorio', e.id, e.versao, {
        prazo_regularizacao: e.prazo,
        situacao: 'provisorio',
      });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'profissional_provisorio', id: e.id }),
    trilha: (e) => ({ dados: { ...(t.dadosDepois ?? {}), prazo: e.prazo }, motivo: e.motivo.trim() }),
  });

const esquemaRegularizar = z
  .object({ id: idPos, versao: idPos, profissional: idPos, confirmar: z.boolean() })
  .strict();

/** Lê o definitivo para a regra: situação, CPF e inscrições no conselho. */
async function lerDefinitivo(l: Pick<Leitor, 'uma' | 'consultar'>, id: number) {
  const pr = await l.uma(
    `SELECT pr.situacao, pf.cpf FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
      WHERE pr.id = ? AND pr.excluido_em IS NULL`,
    [id],
  );
  if (!pr) return null;
  const ins = await l.consultar(
    `SELECT conselho_classe_id, unidade_federativa_id, numero_inscricao, situacao FROM inscricao_conselho
      WHERE profissional_id = ? AND excluido_em IS NULL`,
    [id],
  );
  return {
    situacao: String(pr['situacao']),
    cpf: txt(pr['cpf']),
    inscricoes: ins.map((i) => ({
      conselhoId: Number(i['conselho_classe_id']),
      ufId: Number(i['unidade_federativa_id']),
      numero: String(i['numero_inscricao']),
      ativa: ['ativa', 'provisoria'].includes(String(i['situacao'])),
    })),
  };
}

const opRegularizar = (t: RegistroTrilhaTela, est: number) =>
  definirOperacao({
    nome: 'cadastro.profissional-provisorio.regularizar',
    tabelas: [
      'profissional_provisorio',
      'profissional_provisorio_uso',
      'atendimento',
      'agendamento_cirurgico',
      'agendamento_internacao',
    ],
    entrada: esquemaRegularizar,
    acao: 'alteracao',
    async gravar(tx, e) {
      const p = await lerProvisorio(tx, e.id, est);
      const d = await lerDefinitivo(tx, e.profissional);
      if (!d)
        throw recusa('definitivo-inexistente', 'Cadastro definitivo não encontrado.', {
          campos: ['profissional'],
        });
      recusarErros(
        errosRegularizacao(
          {
            situacao: String(p['situacao']) as SituacaoProvisorio,
            cpf: txt(p['cpf']),
            conselhoId: num(p['conselho_classe_id']),
            numeroConselho: txt(p['numero_conselho']),
            ufConselhoId: num(p['conselho_unidade_federativa_id']),
          },
          d,
        ),
      );
      // Os registros ligados pendentes, travados, com a situação, a conta e o profissional atual de cada um.
      const usos = await tx.consultarParaAtualizar(
        `${SQL_USOS} AND NOT u.regularizado ORDER BY u.sequencia`,
        [...paramsUsos(e.id)],
      );
      recusarErros(errosTransferencia(usos.map(registroDoUso), e.confirmar));
      // Cada registro guarda, no próprio uso, quem estava nele antes, a situação e se a transferência foi confirmada;
      // a trilha da operação leva a lista (registro, antes e depois).
      const agora = new Date();
      const transferencias: Record<string, unknown>[] = [];
      for (const u of usos) {
        const tipo = String(u['tipo']) as TipoUsoProvisorio;
        const anterior = num(u['atual']);
        const versaoRegistro = Number(u['registro_versao']);
        let registro: number | null = null;
        if (tipo === 'atendimento') {
          registro = Number(u['atendimento_id']);
          await tx.alterar('atendimento', registro, versaoRegistro, { profissional_id: e.profissional });
        } else if (tipo === 'agendamento_cirurgico') {
          registro = Number(u['agendamento_cirurgico_id']);
          await tx.alterar('agendamento_cirurgico', registro, versaoRegistro, {
            cirurgiao_profissional_id: e.profissional,
          });
        } else if (tipo === 'agendamento_internacao') {
          registro = Number(u['agendamento_internacao_id']);
          await tx.alterar('agendamento_internacao', registro, versaoRegistro, {
            medico_profissional_id: e.profissional,
          });
        }
        const pend = pendenciasTransferencia(registroDoUso(u));
        await tx.alterar('profissional_provisorio_uso', Number(u['id']), Number(u['versao']), {
          regularizado: true,
          ...(registro !== null
            ? {
                anterior_profissional_id: anterior,
                situacao_registro_transferencia: txt(u['situacao']),
                transferencia_confirmada: pend.length > 0,
                transferido_em: agora,
              }
            : { vigencia_fim: agora }),
        });
        if (registro !== null)
          transferencias.push({ tipo, registro, antes: anterior, depois: e.profissional, pendencias: pend });
      }
      await tx.alterar('profissional_provisorio', e.id, e.versao, {
        situacao: 'regularizado',
        profissional_id: e.profissional,
        regularizado_em: new Date(),
      });
      return {
        id: e.id,
        usos: usos.length,
        transferidos: transferencias.length,
        // O resultado do executor é plano: a lista vai serializada e volta inteira na trilha.
        transferencias: JSON.stringify(transferencias),
      };
    },
    alvo: (e) => ({ tabela: 'profissional_provisorio', id: e.id }),
    trilha: (e, r) => ({
      dados: {
        ...(t.dadosDepois ?? {}),
        profissional: e.profissional,
        usos: r.usos,
        transferidos: r.transferidos,
        confirmado: e.confirmar,
        transferencias: JSON.parse(String(r.transferencias)) as unknown,
      },
      motivo: null,
    }),
  });

const esquemaCancelar = z.object({ id: idPos, versao: idPos, motivo: z.string().max(500) }).strict();
const opCancelar = (t: RegistroTrilhaTela, est: number) =>
  definirOperacao({
    nome: 'cadastro.profissional-provisorio.cancelar',
    tabelas: ['profissional_provisorio'],
    entrada: esquemaCancelar,
    acao: 'alteracao',
    async gravar(tx, e) {
      const p = await lerProvisorio(tx, e.id, est);
      const pend = await tx.uma(
        `SELECT COUNT(*) AS n FROM profissional_provisorio_uso
          WHERE profissional_provisorio_id = ? AND NOT regularizado AND excluido_em IS NULL`,
        [e.id],
      );
      recusarErros(
        errosCancelamento(String(p['situacao']) as SituacaoProvisorio, Number(pend?.['n'] ?? 0), e.motivo),
      );
      const obs = `Cancelado: ${e.motivo.trim()}`.slice(0, 1000);
      await tx.alterar('profissional_provisorio', e.id, e.versao, { situacao: 'cancelado', observacao: obs });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'profissional_provisorio', id: e.id }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

export interface UsoProvisorio {
  readonly id: number;
  readonly sequencia: number;
  readonly tipo: TipoUsoProvisorio;
  readonly registroId: number;
  readonly regularizado: boolean;
  /** Número de negócio do atendimento ou do agendamento (nulo no vínculo com o paciente). */
  readonly numero: string | null;
  readonly prontuario: number | null;
  readonly paciente: string | null;
  /** Data do atendimento, da cirurgia prevista, da internação prevista ou do início do vínculo. */
  readonly quando: string | null;
  readonly situacaoRegistro: string | null;
  readonly profissionalAtual: string | null;
  readonly substituto: string | null;
  /** Depois da transferência: quem estava no registro antes, e se ela foi confirmada. */
  readonly anterior: string | null;
  readonly transferenciaConfirmada: boolean;
  /** O que a regularização pede para confirmar neste registro (vazio: transfere sem pergunta). */
  readonly pendencias: readonly PendenciaTransferencia[];
}

/** Um registro do estabelecimento que pode ser ligado ao provisório, achado pelo número ou pelo paciente. */
export interface RegistroCandidato {
  readonly id: number;
  readonly numero: string | null;
  readonly prontuario: number | null;
  readonly paciente: string;
  readonly quando: string | null;
  readonly profissional: string | null;
}

export interface CandidatoDefinitivo {
  readonly id: number;
  readonly nome: string;
  /** Por que é candidato: a mesma inscrição no conselho ou o mesmo CPF. */
  readonly por: 'inscricao' | 'cpf';
}

export interface ItemProvisorio {
  readonly id: number;
  readonly versao: number;
  readonly nome: string;
  readonly cpfInformado: boolean;
  readonly conselhoId: number | null;
  readonly conselhoSigla: string | null;
  readonly numeroConselho: string | null;
  readonly ufConselhoId: number | null;
  readonly ufSigla: string | null;
  readonly motivo: string;
  readonly dataInicio: string;
  readonly prazo: string;
  readonly situacao: SituacaoProvisorio;
  readonly estadoPrazo: EstadoPrazo;
  readonly diasParaPrazo: number;
  readonly profissionalId: number | null;
  readonly usos: number;
  readonly usosPendentes: number;
}

export interface VisaoProvisorios {
  readonly hoje: string;
  readonly prazoSugerido: string;
  readonly itens: readonly ItemProvisorio[];
  readonly resumo: { abertos: number; vencidos: number; venceLogo: number };
  readonly conselhos: readonly { id: number; sigla: string; porUf: boolean }[];
  readonly ufs: readonly { id: number; sigla: string }[];
}

/** O nome de exibição de cada profissional citado (atual, substituto, anterior). */
async function nomesProfissionais(
  l: Pick<Leitor, 'consultar'>,
  ids: unknown[],
): Promise<Map<number, string>> {
  const unicos = [...new Set(ids.map(num).filter((v): v is number => v !== null))];
  const m = new Map<number, string>();
  if (!unicos.length) return m;
  const linhas = await l.consultar(
    `SELECT pr.id, COALESCE(pr.nome_exibicao, pf.nome) AS nome FROM profissional pr
       JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id WHERE pr.id IN (${unicos.map(() => '?').join(', ')})`,
    unicos,
    { teto: 3000 },
  );
  for (const x of linhas) m.set(Number(x['id']), String(x['nome']));
  return m;
}

export class ProfissionalProvisorioProprio {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoCadastro,
    private readonly cliente: string,
    executor?: Executor,
    private readonly hoje: () => string = hojeLocal,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'provisorio' }, fn);
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

  private async executar<E>(
    c: ContextoPorta,
    op: Parameters<Executor['executar']>[0],
    entrada: E,
    t: RegistroTrilhaTela,
    est: number,
  ): Promise<Record<string, unknown>> {
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: t.estabelecimento ?? est,
      usuario: t.usuario ?? c.usuario,
      correlacao: (t.correlacao ?? c.correlacao).slice(0, 64) || 'provisorio',
      chaveIdempotencia: `direta:${randomUUID()}`,
    };
    const x = await this.executor.executar(op, this.cliente, entrada, ctx);
    return x.resultado as Record<string, unknown>;
  }

  /** Os provisórios do estabelecimento: abertos primeiro (vencidos no topo), com o alerta do prazo. */
  async visao(c: ContextoPorta, filtro: 'abertos' | 'vencidos' | 'todos'): Promise<VisaoProvisorios> {
    const est = await this.estabelecimento(c);
    const hoje = this.hoje();
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT p.id, p.versao, p.nome, p.cpf, p.conselho_classe_id, cc.sigla AS conselho_sigla, p.numero_conselho,
                p.conselho_unidade_federativa_id, u.sigla AS uf_sigla, p.motivo, p.data_inicio, p.prazo_regularizacao,
                p.situacao, p.profissional_id,
                (SELECT COUNT(*) FROM profissional_provisorio_uso x
                  WHERE x.profissional_provisorio_id = p.id AND x.excluido_em IS NULL) AS usos,
                (SELECT COUNT(*) FROM profissional_provisorio_uso x
                  WHERE x.profissional_provisorio_id = p.id AND x.excluido_em IS NULL AND NOT x.regularizado) AS pendentes
           FROM profissional_provisorio p
           LEFT JOIN conselho_classe cc ON cc.id = p.conselho_classe_id
           LEFT JOIN unidade_federativa u ON u.id = p.conselho_unidade_federativa_id
          WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL
            AND (? = 'todos' OR p.situacao IN ('provisorio','expirado'))
          ORDER BY p.situacao IN ('provisorio','expirado') DESC, p.prazo_regularizacao, p.id`,
        [est, filtro],
        { teto: 1000 },
      );
      const todos: ItemProvisorio[] = linhas.map((x) => {
        const situacao = String(x['situacao']) as SituacaoProvisorio;
        const prazo = data(x['prazo_regularizacao']);
        const ep = estadoDoPrazo(situacao, prazo, hoje);
        return {
          id: Number(x['id']),
          versao: Number(x['versao']),
          nome: String(x['nome']),
          cpfInformado: txt(x['cpf']) !== null,
          conselhoId: num(x['conselho_classe_id']),
          conselhoSigla: txt(x['conselho_sigla']),
          numeroConselho: txt(x['numero_conselho']),
          ufConselhoId: num(x['conselho_unidade_federativa_id']),
          ufSigla: txt(x['uf_sigla']),
          motivo: String(x['motivo']),
          dataInicio: data(x['data_inicio']),
          prazo,
          situacao,
          estadoPrazo: ep.estado,
          diasParaPrazo: ep.dias,
          profissionalId: num(x['profissional_id']),
          usos: Number(x['usos']),
          usosPendentes: Number(x['pendentes']),
        };
      });
      const itens = filtro === 'vencidos' ? todos.filter((i) => i.estadoPrazo === 'vencido') : todos;
      const abertos = todos.filter((i) => i.estadoPrazo !== 'encerrado');
      const conselhos = (
        await l.consultar(
          'SELECT id, sigla, inscricao_por_uf FROM conselho_classe WHERE ativo ORDER BY sigla',
          [],
          {
            teto: 200,
          },
        )
      ).map((x) => ({ id: Number(x['id']), sigla: String(x['sigla']), porUf: bool(x['inscricao_por_uf']) }));
      const ufs = (
        await l.consultar('SELECT id, sigla FROM unidade_federativa ORDER BY sigla', [], { teto: 100 })
      ).map((x) => ({ id: Number(x['id']), sigla: String(x['sigla']) }));
      return {
        hoje,
        prazoSugerido: prazoSugerido(hoje),
        itens,
        resumo: {
          abertos: abertos.length,
          vencidos: abertos.filter((i) => i.estadoPrazo === 'vencido').length,
          venceLogo: abertos.filter((i) => i.estadoPrazo === 'vence_logo').length,
        },
        conselhos,
        ufs,
      };
    });
  }

  /** Os registros ligados e os candidatos a cadastro definitivo (mesma inscrição ou mesmo CPF), para regularizar. */
  async detalhe(
    c: ContextoPorta,
    id: number,
  ): Promise<{ usos: UsoProvisorio[]; candidatos: CandidatoDefinitivo[] }> {
    const est = await this.estabelecimento(c);
    return this.ler(c, async (l) => {
      const p = await l.uma(
        `SELECT cpf, conselho_classe_id, numero_conselho, conselho_unidade_federativa_id FROM profissional_provisorio
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [id, est],
      );
      if (!p) throw naoAchado();
      const linhas = await l.consultar(`${SQL_USOS} ORDER BY u.sequencia`, paramsUsos(id), { teto: 2000 });
      const nomes = await nomesProfissionais(
        l,
        linhas.flatMap((u) => [u['atual'], u['substituto_profissional_id'], u['anterior_profissional_id']]),
      );
      const nome = (v: unknown) => (num(v) === null ? null : (nomes.get(Number(v)) ?? null));
      const usos: UsoProvisorio[] = linhas.map((u) => {
        const tipo = String(u['tipo']) as TipoUsoProvisorio;
        const regularizado = bool(u['regularizado']);
        return {
          id: Number(u['id']),
          sequencia: Number(u['sequencia']),
          tipo,
          registroId: Number(u[COLUNA_USO[tipo]]),
          regularizado,
          numero: txt(u['numero']),
          prontuario: num(u['numero_prontuario']),
          paciente: txt(u['paciente_nome']),
          quando: u['quando'] ? data(u['quando']) : null,
          situacaoRegistro: txt(
            regularizado ? (u['situacao_registro_transferencia'] ?? u['situacao']) : u['situacao'],
          ),
          profissionalAtual: nome(u['atual']),
          substituto: nome(u['substituto_profissional_id']),
          anterior: nome(u['anterior_profissional_id']),
          transferenciaConfirmada: bool(u['transferencia_confirmada']),
          pendencias: regularizado ? [] : pendenciasTransferencia(registroDoUso(u)),
        };
      });
      const numero = normalizarNumeroConselho(txt(p['numero_conselho']));
      const porInscricao = await l.consultar(
        `SELECT DISTINCT pr.id, COALESCE(pr.nome_exibicao, pf.nome) AS nome, i.numero_inscricao
           FROM inscricao_conselho i
           JOIN profissional pr ON pr.id = i.profissional_id AND pr.excluido_em IS NULL AND pr.situacao = 'ativo'
           JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
          WHERE i.conselho_classe_id = ? AND i.unidade_federativa_id <=> COALESCE(?, i.unidade_federativa_id)
            AND i.excluido_em IS NULL AND i.situacao IN ('ativa','provisoria')
            AND TRIM(LEADING '0' FROM i.numero_inscricao) LIKE ?`,
        [num(p['conselho_classe_id']), num(p['conselho_unidade_federativa_id']), `%${numero}%`],
        { teto: 20 },
      );
      const candidatos: CandidatoDefinitivo[] = porInscricao
        .filter((x) => normalizarNumeroConselho(String(x['numero_inscricao'])) === numero)
        .map((x) => ({ id: Number(x['id']), nome: String(x['nome']), por: 'inscricao' as const }));
      const cpf = txt(p['cpf']);
      if (cpf) {
        const porCpf = await l.consultar(
          `SELECT pr.id, COALESCE(pr.nome_exibicao, pf.nome) AS nome FROM profissional pr
             JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
            WHERE pf.cpf = ? AND pr.excluido_em IS NULL AND pr.situacao = 'ativo'`,
          [cpf],
          { teto: 5 },
        );
        for (const x of porCpf)
          if (!candidatos.some((k) => k.id === Number(x['id'])))
            candidatos.push({ id: Number(x['id']), nome: String(x['nome']), por: 'cpf' });
      }
      return { usos, candidatos };
    });
  }

  /**
   * Os registros do estabelecimento que podem ser ligados ao provisório, pelo número do atendimento ou do agendamento,
   * pelo prontuário ou pelo começo do nome do paciente (sem busca: os mais recentes). No máximo 30.
   */
  async buscarRegistros(
    c: ContextoPorta,
    tipo: TipoUsoProvisorio,
    busca: string,
  ): Promise<RegistroCandidato[]> {
    const est = await this.estabelecimento(c);
    const termo = busca.trim().slice(0, 80);
    const digitos = /^\d{1,20}$/.test(termo) ? termo : null;
    const nomePrefixo = digitos === null && termo.length >= 3 ? `${termo.replace(/[%_\\]/g, '')}%` : null;
    const semBusca = termo === '' ? 1 : 0;
    // O mesmo filtro em todos os tipos: sem busca, número/prontuário exato ou começo do nome.
    const filtro = `(? = 1 OR x.numero = ? OR pa.numero_prontuario = ? OR pf.nome LIKE ? OR pa.nome_social LIKE ?)`;
    const p = [semBusca, digitos ?? termo, digitos ?? -1, nomePrefixo ?? '', nomePrefixo ?? ''];
    if (!semBusca && digitos === null && nomePrefixo === null) return [];
    return this.ler(c, async (l) => {
      let linhas: Record<string, unknown>[];
      if (tipo === 'atendimento')
        linhas = await l.consultar(
          `SELECT x.id, x.numero, x.entrada_em AS quando, x.profissional_id AS atual, pa.numero_prontuario,
                  IF(pa.usa_nome_social AND pa.nome_social IS NOT NULL, pa.nome_social, pf.nome) AS paciente
             FROM atendimento x JOIN paciente pa ON pa.id = x.paciente_id
             JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
            WHERE x.estabelecimento_id = ? AND ${filtro} ORDER BY x.id DESC LIMIT 30`,
          [est, ...p],
        );
      else if (tipo === 'agendamento_cirurgico')
        linhas = await l.consultar(
          `SELECT x.id, x.numero, x.inicio_previsto_em AS quando, x.cirurgiao_profissional_id AS atual,
                  pa.numero_prontuario,
                  IF(pa.usa_nome_social AND pa.nome_social IS NOT NULL, pa.nome_social, pf.nome) AS paciente
             FROM agendamento_cirurgico x JOIN paciente pa ON pa.id = x.paciente_id
             JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
            WHERE x.estabelecimento_id = ? AND ${filtro} ORDER BY x.id DESC LIMIT 30`,
          [est, ...p],
        );
      else if (tipo === 'agendamento_internacao')
        linhas = await l.consultar(
          `SELECT x.id, x.numero, x.previsto_para AS quando, x.medico_profissional_id AS atual, pa.numero_prontuario,
                  IF(pa.usa_nome_social AND pa.nome_social IS NOT NULL, pa.nome_social, pf.nome) AS paciente
             FROM agendamento_internacao x JOIN paciente pa ON pa.id = x.paciente_id
             JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
            WHERE x.estabelecimento_id = ? AND ${filtro} ORDER BY x.id DESC LIMIT 30`,
          [est, ...p],
        );
      else
        linhas = await l.consultar(
          `SELECT pa.id, NULL AS quando, NULL AS atual, pa.numero_prontuario,
                  IF(pa.usa_nome_social AND pa.nome_social IS NOT NULL, pa.nome_social, pf.nome) AS paciente
             FROM paciente pa JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
            WHERE (? = 1 OR pa.numero_prontuario = ? OR pf.nome LIKE ? OR pa.nome_social LIKE ?)
            ORDER BY pa.id DESC LIMIT 30`,
          [semBusca, digitos ?? -1, nomePrefixo ?? '', nomePrefixo ?? ''],
        );
      const nomes = await nomesProfissionais(
        l,
        linhas.map((x) => x['atual']),
      );
      return linhas.map((x) => ({
        id: Number(x['id']),
        numero: txt(x['numero']),
        prontuario: num(x['numero_prontuario']),
        paciente: String(x['paciente'] ?? ''),
        quando: x['quando'] ? data(x['quando']) : null,
        profissional: num(x['atual']) === null ? null : (nomes.get(Number(x['atual'])) ?? null),
      }));
    });
  }

  async criar(c: ContextoPorta, e: EntradaProvisorioTela, t: RegistroTrilhaTela): Promise<number> {
    const est = await this.estabelecimento(c);
    return Number((await this.executar(c, opCriar(t, est, this.hoje()), e, t, est))['id']);
  }
  async ligar(c: ContextoPorta, e: EntradaUso, t: RegistroTrilhaTela): Promise<number> {
    const est = await this.estabelecimento(c);
    return Number((await this.executar(c, opUso(t, est), e, t, est))['id']);
  }
  async prorrogar(
    c: ContextoPorta,
    e: { id: number; versao: number; prazo: string; motivo: string },
    t: RegistroTrilhaTela,
  ): Promise<number> {
    const est = await this.estabelecimento(c);
    return Number((await this.executar(c, opProrrogar(t, est), e, t, est))['id']);
  }
  async regularizar(
    c: ContextoPorta,
    e: { id: number; versao: number; profissional: number; confirmar: boolean },
    t: RegistroTrilhaTela,
  ): Promise<{ id: number; usos: number; transferidos: number }> {
    const est = await this.estabelecimento(c);
    const r = await this.executar(c, opRegularizar(t, est), e, t, est);
    return { id: Number(r['id']), usos: Number(r['usos']), transferidos: Number(r['transferidos']) };
  }
  async cancelar(
    c: ContextoPorta,
    e: { id: number; versao: number; motivo: string },
    t: RegistroTrilhaTela,
  ): Promise<number> {
    const est = await this.estabelecimento(c);
    return Number((await this.executar(c, opCancelar(t, est), e, t, est))['id']);
  }
}
