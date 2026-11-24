// Complemento da porta PRÓPRIA do cadastro sobre o banco do cliente (família cadastro, rodada modulos-proprios-2):
// os consentimentos do paciente (termo de proteção de dados no balcão) e os procedimentos permitidos da especialidade.
// A porta principal (PortaCadastroPropria) delega estes métodos a esta classe.
//   - Consentimento: `consentimento_titular` (o termo, numerado pela `sequencia_negocio` do estabelecimento, prefixo
//     "TC-") e `consentimento_titular_historico` (só de acréscimo: cada passo é uma linha nova). Nada é apagado: a
//     revogação muda a situação para "revogado" com a data e o motivo e acrescenta o passo no histórico.
//   - O tipo de termo do balcão é o do catálogo `tipo_termo_lgpd` do cliente (código TIPO_TERMO_BALCAO, finalidade
//     consentimento); sem ele, 503 `catalogo-incompleto` (nada gravado), como no portal.
//   - Signatário representante legal: o responsável legal vigente do paciente (`responsavel_paciente`, papel de
//     representação legal); sem nenhum, recusa `representante-ausente` (o CHECK do modelo exige quem assinou).
//   - Situações e signatários com os códigos da tela (os mesmos do portal): 3 autorizado, 4 recusado; 1 paciente,
//     2 representante legal; revogação 2.
//   - Procedimentos da especialidade: `especialidade_procedimento` vigente e ativa ligada ao `item_faturavel`, pelo
//     código numérico da especialidade (o da rota), em ordem de código do procedimento.
// Leituras: somente leitura. Gravações: uma operação do Executor por chamada (trilha e idempotência na transação).
import { randomUUID } from 'node:crypto';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPorta } from './porta.js';
import type { NucleoCadastro } from './porta-propria.js';
import type { ConsentimentoPaciente, OpcaoDominio, RegistroTrilhaTela } from './tipos.js';

/** Código do tipo de termo LGPD do consentimento registrado no balcão (catálogo tipo_termo_lgpd do cliente). */
export const TIPO_TERMO_BALCAO = 'cadastro_paciente';

const SITUACOES: readonly OpcaoDominio[] = [
  { codigo: 3, rotulo: 'Consentimento Autorizado' },
  { codigo: 4, rotulo: 'Não autorizado' },
];
const SIGNATARIOS: readonly OpcaoDominio[] = [
  { codigo: 1, rotulo: 'Paciente' },
  { codigo: 2, rotulo: 'Representante Legal' },
];
const REVOGACOES: readonly OpcaoDominio[] = [
  { codigo: 2, rotulo: 'Termo de revogação para acesso aos dados pessoais' },
];
const SITUACAO_DO_BANCO: Readonly<Record<number, 'autorizado' | 'recusado'>> = {
  3: 'autorizado',
  4: 'recusado',
};
const SITUACAO_DA_TELA: Readonly<Record<string, number>> = { emitido: 1, autorizado: 3, recusado: 4 };
const SIGNATARIO_DO_BANCO: Readonly<Record<number, 'paciente' | 'representante_legal'>> = {
  1: 'paciente',
  2: 'representante_legal',
};
const SIGNATARIO_DA_TELA: Readonly<Record<string, number>> = { paciente: 1, representante_legal: 2 };
/** Papéis do responsável que representam o paciente legalmente. */
const PAPEIS_REPRESENTANTE = ['responsavel_legal', 'guardiao_legal', 'curador', 'tutor'] as const;
/** Teto de termos lidos por paciente. */
const TETO_TERMOS = 500;

const instante = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString()
      : new Date(String(v)).toISOString();

const esquemaRegistro = z
  .object({
    estabelecimento: z.number().int().positive(),
    paciente: z.number().int().positive(),
    finalidade: z.string().trim().min(1).max(500),
    versao: z.string().trim().max(40),
    situacao: z.enum(['autorizado', 'recusado']),
    signatario: z.enum(['paciente', 'representante_legal']),
  })
  .strict();
const esquemaRevogacao = z
  .object({
    estabelecimento: z.number().int().positive(),
    paciente: z.number().int().positive(),
    id: z.number().int().positive(),
    motivo: z.number().int(),
  })
  .strict();

async function pacienteExiste(tx: TxOperacao, id: number): Promise<void> {
  const p = await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [id]);
  if (!p) throw recusa('paciente-inexistente', 'O paciente não existe.', { campos: ['idPaciente'] });
}

const operacaoRegistrar = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.registrar-consentimento',
    tabelas: ['consentimento_titular', 'consentimento_titular_historico', 'sequencia_negocio'],
    entrada: esquemaRegistro,
    acao: 'inclusao',
    async gravar(tx, e) {
      await pacienteExiste(tx, e.paciente);
      const termo = await tx.uma(
        "SELECT id FROM tipo_termo_lgpd WHERE codigo = ? AND ativo AND finalidade = 'consentimento'",
        [TIPO_TERMO_BALCAO],
      );
      if (!termo)
        throw new ErroOperacao(
          503,
          'catalogo-incompleto',
          'Catálogo incompleto',
          'O tipo de termo do consentimento no balcão não está cadastrado neste cliente. Nada foi gravado.',
        );
      let responsavel: number | null = null;
      if (e.signatario === 'representante_legal') {
        const r = await tx.uma(
          `SELECT id FROM responsavel_paciente
            WHERE paciente_id = ? AND papel IN (${PAPEIS_REPRESENTANTE.map(() => '?').join(', ')})
              AND excluido_em IS NULL AND vigencia_inicio <= CURRENT_DATE
              AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
            ORDER BY contato_principal DESC, id LIMIT 1`,
          [e.paciente, ...PAPEIS_REPRESENTANTE],
        );
        if (!r)
          throw recusa(
            'representante-ausente',
            'O paciente não tem representante legal vigente no cadastro de responsáveis.',
            { campos: ['signatario'] },
          );
        responsavel = Number(r['id']);
      }
      const agora = new Date();
      await garantirSequencia(
        tx,
        { tipo: 'consentimento_titular', estabelecimento: e.estabelecimento, prefixo: 'TC-' },
        { usuario: tx.contexto.usuario, agora },
      );
      const numero = await tx.proximoNumero('consentimento_titular');
      const id = await tx.incluir('consentimento_titular', {
        estabelecimento_id: e.estabelecimento,
        numero: numero.formatado,
        tipo_termo_lgpd_id: Number(termo['id']),
        paciente_id: e.paciente,
        finalidade: e.finalidade,
        versao_termo: e.versao || null,
        tipo_signatario: e.signatario,
        responsavel_paciente_id: responsavel,
        situacao: e.situacao,
        emitido_em: agora,
        autorizado_em: e.situacao === 'autorizado' ? agora : null,
        canal_registro: 'balcao',
      });
      await tx.incluir('consentimento_titular_historico', {
        consentimento_titular_id: id,
        operacao: 'inclusao',
        situacao_nova: e.situacao,
        dados: JSON.stringify({ canal: 'balcao', versao: e.versao }),
        ocorrido_em: agora,
        usuario_id: tx.contexto.usuario,
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'consentimento_titular', id: Number(r.id) }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

const operacaoRevogar = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.revogar-consentimento',
    tabelas: ['consentimento_titular', 'consentimento_titular_historico'],
    entrada: esquemaRevogacao,
    acao: 'alteracao',
    async gravar(tx, e) {
      const [k] = await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao FROM consentimento_titular
          WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ? AND revogado_em IS NULL AND excluido_em IS NULL`,
        [e.id, e.paciente, e.estabelecimento],
        { teto: 1 },
      );
      if (!k) throw recusa('consentimento-revogado', 'O consentimento não existe ou já foi revogado.');
      const motivo = REVOGACOES.find((d) => d.codigo === e.motivo);
      if (!motivo) throw recusa('motivo-invalido', 'Tipo de revogação desconhecido.', { campos: ['motivo'] });
      const agora = new Date();
      await tx.alterar('consentimento_titular', e.id, Number(k['versao']), {
        situacao: 'revogado',
        revogado_em: agora,
        motivo_revogacao: motivo.rotulo,
      });
      await tx.incluir('consentimento_titular_historico', {
        consentimento_titular_id: e.id,
        operacao: 'alteracao',
        situacao_anterior: String(k['situacao']),
        situacao_nova: 'revogado',
        dados: JSON.stringify({ canal: 'balcao', motivo: e.motivo }),
        ocorrido_em: agora,
        usuario_id: tx.contexto.usuario,
      });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'consentimento_titular', id: e.id }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });

export class CadastroProprioConsentimento {
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

  /** O estabelecimento da sessão (id, ou pelo código); sem ele, 403 (nada lido nem gravado). */
  private async estabelecimento(c: ContextoPorta, l?: Leitor): Promise<number> {
    if (c.estabelecimento !== null) return c.estabelecimento;
    const buscar = (x: Leitor) =>
      x.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
        c.hospital,
      ]);
    const r = c.hospital ? (l ? await buscar(l) : await this.ler(c, buscar)) : null;
    if (!r)
      throw new ErroOperacao(
        403,
        'sem-estabelecimento',
        'Sem estabelecimento',
        'A sessão não tem estabelecimento.',
      );
    return Number(r.id);
  }

  private async contexto(
    c: ContextoPorta,
    est: number,
    trilha: RegistroTrilhaTela,
  ): Promise<ContextoOperacao> {
    return {
      cliente: this.cliente,
      estabelecimento: trilha.estabelecimento ?? est,
      usuario: trilha.usuario ?? c.usuario,
      correlacao: (trilha.correlacao ?? c.correlacao).slice(0, 64) || 'cadastro',
      chaveIdempotencia: `direta:${randomUUID()}`,
    };
  }

  async opcoesConsentimento(): Promise<{
    situacoes: OpcaoDominio[];
    signatarios: OpcaoDominio[];
    revogacoes: OpcaoDominio[];
  }> {
    return { situacoes: [...SITUACOES], signatarios: [...SIGNATARIOS], revogacoes: [...REVOGACOES] };
  }

  /** Os termos do paciente no estabelecimento da sessão, do mais recente ao mais antigo. */
  async consentimentos(c: ContextoPorta, id: number): Promise<ConsentimentoPaciente[]> {
    if (!Number.isSafeInteger(id) || id <= 0) return [];
    return this.ler(c, async (l) => {
      const est = await this.estabelecimento(c, l);
      const linhas = await l.consultar(
        `SELECT ct.id, ct.finalidade, ct.versao_termo, ct.situacao, ct.tipo_signatario, ct.emitido_em, ct.revogado_em,
                u.login AS registrado_por,
                (SELECT h.situacao_anterior FROM consentimento_titular_historico h
                  WHERE h.consentimento_titular_id = ct.id AND h.situacao_nova = 'revogado'
                  ORDER BY h.id DESC LIMIT 1) AS situacao_antes_revogacao
           FROM consentimento_titular ct
           LEFT JOIN usuario u ON u.id = ct.criado_por
          WHERE ct.paciente_id = ? AND ct.estabelecimento_id = ? AND ct.excluido_em IS NULL
          ORDER BY ct.emitido_em DESC, ct.id DESC`,
        [id, est],
        { teto: TETO_TERMOS },
      );
      return linhas.map((x) => {
        const revogado = x['revogado_em'] !== null && x['revogado_em'] !== undefined;
        const situacao = String(revogado ? (x['situacao_antes_revogacao'] ?? 'emitido') : x['situacao']);
        return {
          id: Number(x['id']),
          finalidade: String(x['finalidade']),
          versao:
            x['versao_termo'] === null || x['versao_termo'] === undefined ? '' : String(x['versao_termo']),
          situacao: SITUACAO_DA_TELA[situacao] ?? 1,
          signatario: SIGNATARIO_DA_TELA[String(x['tipo_signatario'])] ?? 1,
          registradoEm: instante(x['emitido_em']) ?? '',
          registradoPor:
            x['registrado_por'] === null || x['registrado_por'] === undefined
              ? ''
              : String(x['registrado_por']),
          revogadoEm: instante(x['revogado_em']),
          revogacao: revogado ? (REVOGACOES[0]?.codigo ?? null) : null,
        };
      });
    });
  }

  async registrarConsentimento(
    c: ContextoPorta,
    r: {
      idPaciente: number;
      pront: number;
      finalidade: string;
      versao: string;
      situacao: number;
      signatario: number;
      usuario: string;
    },
    trilha: RegistroTrilhaTela,
  ): Promise<number> {
    const situacao = SITUACAO_DO_BANCO[r.situacao];
    if (!situacao)
      throw recusa('situacao-invalida', 'Situação do termo desconhecida.', { campos: ['situacao'] });
    const signatario = SIGNATARIO_DO_BANCO[r.signatario];
    if (!signatario)
      throw recusa('signatario-invalido', 'Signatário desconhecido.', { campos: ['signatario'] });
    const est = await this.estabelecimento(c);
    const x = await this.executor.executar(
      operacaoRegistrar(trilha),
      this.cliente,
      {
        estabelecimento: est,
        paciente: r.idPaciente,
        finalidade: r.finalidade.slice(0, 500),
        versao: r.versao.slice(0, 40),
        situacao,
        signatario,
      },
      await this.contexto(c, est, trilha),
    );
    return Number(x.resultado.id);
  }

  async revogarConsentimento(
    c: ContextoPorta,
    r: { idPaciente: number; id: number; motivo: number; usuario: string },
    trilha: RegistroTrilhaTela,
  ): Promise<void> {
    if (!REVOGACOES.some((d) => d.codigo === r.motivo))
      throw recusa('motivo-invalido', 'Tipo de revogação desconhecido.', { campos: ['motivo'] });
    const est = await this.estabelecimento(c);
    await this.executor.executar(
      operacaoRevogar(trilha),
      this.cliente,
      { estabelecimento: est, paciente: r.idPaciente, id: r.id, motivo: r.motivo },
      await this.contexto(c, est, trilha),
    );
  }

  /** Os procedimentos permitidos e vigentes da especialidade (pelo código numérico), por código do procedimento. */
  async procedimentosDaEspecialidade(
    c: ContextoPorta,
    especialidade: number,
    pagina: number,
    porPagina: number,
  ): Promise<{ itens: { procedimento: number; descricao: string | null }[]; total: number }> {
    const tam = Math.max(1, Math.min(Math.trunc(porPagina), 200));
    const inicio = (Math.max(1, Math.trunc(pagina)) - 1) * tam;
    // Código exato da especialidade (o conector grava o número como texto, sem zero à esquerda): '1' e '01' não se
    // fundem. Só especialidade ativa e item faturável vivo (não excluído, situação ativa) contam como permitidos.
    if (!Number.isInteger(especialidade) || especialidade < 0) return { itens: [], total: 0 };
    const codigo = String(especialidade);
    return this.ler(c, async (l) => {
      const onde = `FROM especialidade_procedimento ep
          JOIN especialidade_medica em ON em.id = ep.especialidade_medica_id
          JOIN item_faturavel i ON i.id = ep.item_faturavel_id
         WHERE em.codigo = ? AND em.ativo
           AND ep.ativo AND ep.excluido_em IS NULL
           AND ep.vigencia_inicio <= CURRENT_DATE AND (ep.vigencia_fim IS NULL OR ep.vigencia_fim >= CURRENT_DATE)
           AND i.excluido_em IS NULL AND i.situacao = 'ativo'
           AND i.codigo REGEXP '^[0-9]{1,15}$'`;
      const [t] = await l.consultar(`SELECT COUNT(DISTINCT i.id) AS n ${onde}`, [codigo], { teto: 1 });
      const total = Number(t?.['n'] ?? 0);
      if (total === 0 || inicio >= total) return { itens: [], total };
      const linhas = await l.consultar(
        `SELECT DISTINCT CAST(i.codigo AS UNSIGNED) AS procedimento, i.descricao, i.id
           ${onde}
          ORDER BY procedimento, i.id LIMIT ${tam} OFFSET ${inicio}`,
        [codigo],
        { teto: tam },
      );
      return {
        itens: linhas.map((x) => ({
          procedimento: Number(x['procedimento']),
          descricao: x['descricao'] === null || x['descricao'] === undefined ? null : String(x['descricao']),
        })),
        total,
      };
    });
  }
}
