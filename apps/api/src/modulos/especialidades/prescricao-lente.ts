// Prescrição de lentes da oftalmologia (03-PEP linha 139): óculos ou lentes de contato com o grau por olho, a adição,
// a distância pupilar e a validade, emitidos pelo médico sobre a internação do paciente. As regras são do domínio
// (`@sgh/dominio-pep`, prescricao-lente); aqui ficam a leitura e a gravação:
//   - `banco`: prescricao_lente no MariaDB do cliente pelo Executor do núcleo (trilha na mesma transação, versão
//     conferida, Idempotency-Key honrada); o atendimento vem da internação, conferida no estabelecimento e no paciente;
//   - `memoria`: a sessão sintética de dev/ci (E2E);
//   - indisponível: 503 em tudo (falha fechada).
// Nada é apagado: o cancelamento muda a situação e leva o motivo à trilha; o histórico do paciente mostra todas.
import {
  BASES_PRISMA,
  conferirCancelamentoLente,
  conferirPrescricaoLente,
  type ErroCampoLente,
  type GrauOlho,
  lenteVigente,
  type PrescricaoLenteEntrada,
  type SituacaoPrescricaoLente,
  TIPOS_LENTE,
  type TipoLente,
  USOS_LENTE,
  type UsoLente,
  validadeDaLente,
} from '@sgh/dominio-pep';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Linha,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';

export const PORTA_PRESCRICAO_LENTE = Symbol('PORTA_PRESCRICAO_LENTE');
export const OPERACOES_PRESCRICAO_LENTE = {
  emitir: 'pep.prescricao-lente.emitir',
  cancelar: 'pep.prescricao-lente.cancelar',
} as const;
const TETO_PRESCRICOES = 200;

export interface PrescricaoLenteLida {
  readonly id: number;
  readonly versao: number;
  readonly internacao: number | null;
  readonly prescritoEm: string;
  readonly tipo: TipoLente;
  readonly uso: UsoLente;
  readonly od: GrauOlho;
  readonly oe: GrauOlho;
  readonly adicao: number | null;
  readonly distanciaPupilarMm: number | null;
  readonly curvaBase: number | null;
  readonly diametro: number | null;
  readonly validadeAte: string | null;
  readonly observacao: string | null;
  readonly situacao: SituacaoPrescricaoLente;
  readonly vigente: boolean;
  readonly profissional: string;
  readonly registroConselho: string | null;
}

export interface EmissaoLente {
  readonly internacao: number;
  readonly paciente: number;
  /** O vínculo profissional (médico) de quem prescreve. */
  readonly profissional: number;
  readonly prescricao: PrescricaoLenteEntrada;
}

export interface PortaPrescricaoLente {
  readonly destino: 'banco' | 'memoria' | 'indisponivel';
  /** As prescrições do paciente no estabelecimento, da mais nova para a mais antiga (canceladas incluídas). */
  doPaciente(c: ContextoPortaM18, paciente: number): Promise<{ hoje: string; itens: PrescricaoLenteLida[] }>;
  emitir(c: ContextoPortaM18, e: EmissaoLente, chave: string): Promise<{ id: number; validadeAte: string }>;
  cancelar(
    c: ContextoPortaM18,
    x: { id: number; paciente: number; motivo: string; versao: number },
    chave: string,
  ): Promise<{ id: number }>;
}

const n = (v: unknown) => Number(v);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const tx_ = (v: unknown) => (v === null || v === undefined ? null : String(v));

function recusarErros(erros: readonly ErroCampoLente[], codigo = 'prescricao-lente-invalida'): void {
  if (erros.length)
    throw recusa(codigo, erros.map((x) => x.mensagem).join(' '), {
      campos: [...new Set(erros.map((x) => x.campo))],
    });
}

const SQL_LENTE = `SELECT p.id, p.versao, i.id AS internacao_id, DATE_FORMAT(p.prescrito_em, '%Y-%m-%dT%H:%i') AS prescrito_em,
    p.tipo, p.uso, p.esferico_olho_direito, p.cilindrico_olho_direito, p.eixo_olho_direito, p.prisma_olho_direito,
    p.base_prisma_olho_direito, p.acuidade_olho_direito, p.esferico_olho_esquerdo, p.cilindrico_olho_esquerdo,
    p.eixo_olho_esquerdo, p.prisma_olho_esquerdo, p.base_prisma_olho_esquerdo, p.acuidade_olho_esquerdo, p.adicao,
    p.distancia_pupilar_mm, p.curva_base_lente_contato, p.diametro_lente_contato,
    DATE_FORMAT(p.validade_ate, '%Y-%m-%d') AS validade_ate, p.observacao, p.situacao,
    COALESCE(pr.nome_exibicao, pf.nome) AS profissional_nome,
    (SELECT CONCAT(cc.sigla, ' ', ic.numero_inscricao, '/', uf.sigla)
       FROM inscricao_conselho ic
       JOIN conselho_classe cc ON cc.id = ic.conselho_classe_id
       JOIN unidade_federativa uf ON uf.id = ic.unidade_federativa_id
      WHERE ic.profissional_id = p.profissional_id AND ic.excluido_em IS NULL
      ORDER BY ic.principal DESC, ic.sequencia LIMIT 1) AS registro_conselho
  FROM prescricao_lente p
  JOIN profissional pr ON pr.id = p.profissional_id
  JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
  LEFT JOIN internacao i ON i.atendimento_id = p.atendimento_id AND i.excluido_em IS NULL
 WHERE p.estabelecimento_id = ? AND p.paciente_id = ? AND p.excluido_em IS NULL`;

function grauDaLinha(r: Linha, lado: 'direito' | 'esquerdo'): GrauOlho {
  return {
    esferico: nn(r[`esferico_olho_${lado}`]),
    cilindrico: nn(r[`cilindrico_olho_${lado}`]),
    eixo: nn(r[`eixo_olho_${lado}`]),
    prisma: nn(r[`prisma_olho_${lado}`]),
    basePrisma: tx_(r[`base_prisma_olho_${lado}`]) as GrauOlho['basePrisma'],
    acuidade: tx_(r[`acuidade_olho_${lado}`]),
  };
}

function lenteDaLinha(r: Linha, hoje: string): PrescricaoLenteLida {
  const situacao = String(r['situacao']) as SituacaoPrescricaoLente;
  const validadeAte = tx_(r['validade_ate']);
  return {
    id: n(r['id']),
    versao: n(r['versao']),
    internacao: nn(r['internacao_id']),
    prescritoEm: String(r['prescrito_em']),
    tipo: String(r['tipo']) as TipoLente,
    uso: String(r['uso']) as UsoLente,
    od: grauDaLinha(r, 'direito'),
    oe: grauDaLinha(r, 'esquerdo'),
    adicao: nn(r['adicao']),
    distanciaPupilarMm: nn(r['distancia_pupilar_mm']),
    curvaBase: nn(r['curva_base_lente_contato']),
    diametro: nn(r['diametro_lente_contato']),
    validadeAte,
    observacao: tx_(r['observacao']),
    situacao,
    vigente: lenteVigente({ situacao, validadeAte }, hoje),
    profissional: String(r['profissional_nome']),
    registroConselho: tx_(r['registro_conselho']),
  };
}

/** As colunas do grau de um olho, como o banco as guarda. */
function colunasDoOlho(o: GrauOlho, lado: 'direito' | 'esquerdo'): Record<string, unknown> {
  return {
    [`esferico_olho_${lado}`]: o.esferico,
    [`cilindrico_olho_${lado}`]: o.cilindrico,
    [`eixo_olho_${lado}`]: o.cilindrico !== null && o.cilindrico !== 0 ? o.eixo : null,
    [`prisma_olho_${lado}`]: o.prisma,
    [`base_prisma_olho_${lado}`]: o.prisma !== null && o.prisma > 0 ? o.basePrisma : null,
    [`acuidade_olho_${lado}`]: o.acuidade?.trim() || null,
  };
}

async function hojeDe(l: Pick<Leitor, 'uma'>): Promise<string> {
  const r = await l.uma<Linha>("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') AS hoje", []);
  return String(r?.['hoje']);
}

export class PortaPrescricaoLentePropria implements PortaPrescricaoLente {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private contexto(c: ContextoPortaM18): ContextoNucleo & { estabelecimento: number } {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: c.correlacao || 'prescricao-lente',
    };
  }

  private async executar<R extends Readonly<Record<string, string | number | null>> & { id: number }>(
    c: ContextoPortaM18,
    nome: string,
    entrada: Record<string, unknown>,
    chave: string,
    gravar: (tx: TxOperacao, est: number) => Promise<R>,
    motivo: string | null = null,
  ): Promise<R> {
    const ctxN = this.contexto(c);
    const op = definirOperacao({
      nome,
      tabelas: ['prescricao_lente'],
      entrada: z.unknown(),
      gravar: (tx: TxOperacao) => gravar(tx, ctxN.estabelecimento),
      alvo: (_e, r: R) => ({ tabela: 'prescricao_lente', id: r.id }),
      trilha: () => ({ dados: entrada, motivo }),
    });
    const ctx: ContextoOperacao = { ...ctxN, chaveIdempotencia: chave };
    const { resultado } = await this.executor.executar(op, c.cliente, entrada, ctx);
    return resultado as R;
  }

  doPaciente(c: ContextoPortaM18, paciente: number) {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const hoje = await hojeDe(l);
      const rs = await l.consultar<Linha>(
        `${SQL_LENTE} ORDER BY p.prescrito_em DESC, p.id DESC LIMIT ${TETO_PRESCRICOES}`,
        [ctx.estabelecimento, paciente],
      );
      return { hoje, itens: rs.map((r) => lenteDaLinha(r, hoje)) };
    });
  }

  emitir(c: ContextoPortaM18, e: EmissaoLente, chave: string) {
    const p = e.prescricao;
    return this.executar(
      c,
      OPERACOES_PRESCRICAO_LENTE.emitir,
      { internacao: e.internacao, paciente: e.paciente, profissional: e.profissional, ...p },
      chave,
      async (tx, est) => {
        const [i] = await tx.consultarParaAtualizar<Linha>(
          `SELECT id, atendimento_id, paciente_id, situacao FROM internacao
            WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [e.internacao, est],
        );
        if (!i)
          throw new ErroOperacao(
            404,
            'registro-inexistente',
            'Internação não encontrada',
            'A internação não existe neste estabelecimento.',
          );
        if (n(i['paciente_id']) !== e.paciente)
          throw recusa('paciente-divergente', 'A internação é de outro paciente: recarregue a tela.');
        // Prescrição nova só na internação aberta (ativa ou com alta médica ainda não efetivada), como as demais
        // gravações clínicas da especialidade: depois da alta, a receita sai no ambulatório.
        if (!['ativa', 'alta_medica'].includes(String(i['situacao'])))
          throw recusa(
            'internacao-encerrada',
            'A internação já teve alta: a prescrição de lentes não é emitida.',
          );
        const hoje = await hojeDe(tx);
        recusarErros(conferirPrescricaoLente(p, hoje));
        const validadeAte = validadeDaLente(p, hoje);
        const id = await tx.incluir('prescricao_lente', {
          estabelecimento_id: est,
          paciente_id: e.paciente,
          atendimento_id: nn(i['atendimento_id']),
          profissional_id: e.profissional,
          prescrito_em: new Date(),
          tipo: p.tipo,
          uso: p.uso,
          ...colunasDoOlho(p.od, 'direito'),
          ...colunasDoOlho(p.oe, 'esquerdo'),
          adicao: p.adicao,
          distancia_pupilar_mm: p.distanciaPupilarMm,
          curva_base_lente_contato: p.tipo === 'lente_contato' ? p.curvaBase : null,
          diametro_lente_contato: p.tipo === 'lente_contato' ? p.diametro : null,
          validade_ate: validadeAte,
          observacao: p.observacao?.trim() || null,
          situacao: 'emitida',
        });
        return { id, validadeAte };
      },
    );
  }

  cancelar(
    c: ContextoPortaM18,
    x: { id: number; paciente: number; motivo: string; versao: number },
    chave: string,
  ) {
    return this.executar(
      c,
      OPERACOES_PRESCRICAO_LENTE.cancelar,
      { ...x },
      chave,
      async (tx, est) => {
        const [r] = await tx.consultarParaAtualizar<Linha>(
          `SELECT id, situacao FROM prescricao_lente
            WHERE id = ? AND estabelecimento_id = ? AND paciente_id = ? AND excluido_em IS NULL`,
          [x.id, est, x.paciente],
        );
        if (!r)
          throw new ErroOperacao(
            404,
            'registro-inexistente',
            'Prescrição não encontrada',
            'A prescrição de lentes não existe para este paciente.',
          );
        recusarErros(
          conferirCancelamentoLente(String(r['situacao']) as SituacaoPrescricaoLente, x.motivo),
          'cancelamento-lente-invalido',
        );
        await tx.alterar('prescricao_lente', x.id, x.versao, { situacao: 'cancelada' });
        return { id: x.id };
      },
      x.motivo.trim(),
    );
  }
}

/** A porta de dev/ci sobre a sessão sintética (E2E): as mesmas regras do domínio, sem banco. */
export class PortaPrescricaoLenteMemoria implements PortaPrescricaoLente {
  readonly destino = 'memoria' as const;
  private seq = 0;
  private readonly itens: (PrescricaoLenteLida & { paciente: number; estab: number | null })[] = [];
  private readonly chaves = new Map<string, unknown>();
  constructor(private readonly relogio: () => Date = () => new Date()) {}

  private hoje(): string {
    return this.relogio().toISOString().slice(0, 10);
  }

  doPaciente(c: ContextoPortaM18, paciente: number) {
    const hoje = this.hoje();
    return Promise.resolve({
      hoje,
      itens: this.itens
        .filter((x) => x.paciente === paciente && x.estab === c.estabelecimento)
        .map((x): PrescricaoLenteLida => {
          const lida: PrescricaoLenteLida & { paciente?: number; estab?: number | null } = {
            ...x,
            vigente: lenteVigente(x, hoje),
          };
          delete lida.paciente;
          delete lida.estab;
          return lida;
        })
        .reverse(),
    });
  }

  emitir(c: ContextoPortaM18, e: EmissaoLente, chave: string) {
    const ja = this.chaves.get(chave);
    if (ja) return Promise.resolve(ja as { id: number; validadeAte: string });
    const hoje = this.hoje();
    recusarErros(conferirPrescricaoLente(e.prescricao, hoje));
    const p = e.prescricao;
    const validadeAte = validadeDaLente(p, hoje);
    const id = ++this.seq;
    this.itens.push({
      id,
      versao: 1,
      paciente: e.paciente,
      estab: c.estabelecimento,
      internacao: e.internacao,
      prescritoEm: this.relogio().toISOString().slice(0, 16),
      tipo: p.tipo,
      uso: p.uso,
      od: p.od,
      oe: p.oe,
      adicao: p.adicao,
      distanciaPupilarMm: p.distanciaPupilarMm,
      curvaBase: p.tipo === 'lente_contato' ? p.curvaBase : null,
      diametro: p.tipo === 'lente_contato' ? p.diametro : null,
      validadeAte,
      observacao: p.observacao?.trim() || null,
      situacao: 'emitida',
      vigente: true,
      profissional: `PROFISSIONAL SINTETICO ${e.profissional}`,
      registroConselho: null,
    });
    const r = { id, validadeAte };
    this.chaves.set(chave, r);
    return Promise.resolve(r);
  }

  cancelar(
    c: ContextoPortaM18,
    x: { id: number; paciente: number; motivo: string; versao: number },
    chave: string,
  ) {
    const ja = this.chaves.get(chave);
    if (ja) return Promise.resolve(ja as { id: number });
    const i = this.itens.findIndex(
      (p) => p.id === x.id && p.paciente === x.paciente && p.estab === c.estabelecimento,
    );
    const atual = this.itens[i];
    if (!atual)
      return Promise.reject(
        new ErroOperacao(
          404,
          'registro-inexistente',
          'Prescrição não encontrada',
          'A prescrição de lentes não existe para este paciente.',
        ),
      );
    if (atual.versao !== x.versao)
      return Promise.reject(
        new ErroOperacao(
          409,
          'conflito-versao',
          'Registro alterado por outra pessoa',
          'Releia a prescrição.',
        ),
      );
    recusarErros(conferirCancelamentoLente(atual.situacao, x.motivo), 'cancelamento-lente-invalido');
    this.itens[i] = { ...atual, situacao: 'cancelada', versao: atual.versao + 1 };
    const r = { id: x.id };
    this.chaves.set(chave, r);
    return Promise.resolve(r);
  }
}

const indisponivel = (): Promise<never> =>
  Promise.reject(
    new ErroProblema(
      'indisponivel',
      503,
      'Serviço indisponível',
      'A prescrição de lentes precisa do banco do cliente.',
    ),
  );

export function portaPrescricaoLenteIndisponivel(): PortaPrescricaoLente {
  return { destino: 'indisponivel', doPaciente: indisponivel, emitir: indisponivel, cancelar: indisponivel };
}

// ── Entrada da API (a forma; as regras clínicas ficam no domínio) ──
const dioptria = z.number().finite().nullable().default(null);
const esquemaGrauOlho = z
  .object({
    esferico: dioptria,
    cilindrico: dioptria,
    eixo: z.number().int().nullable().default(null),
    prisma: dioptria,
    basePrisma: z.enum(BASES_PRISMA).nullable().default(null),
    acuidade: z.string().trim().max(10).nullable().default(null),
  })
  .strict();

export const esquemaEmissaoLente = z
  .object({
    internacao: z.number().int().positive(),
    tipo: z.enum(TIPOS_LENTE),
    uso: z.enum(USOS_LENTE),
    od: esquemaGrauOlho,
    oe: esquemaGrauOlho,
    adicao: dioptria,
    distanciaPupilarMm: dioptria,
    curvaBase: dioptria,
    diametro: dioptria,
    validadeAte: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    observacao: z.string().trim().max(1000).nullable().default(null),
  })
  .strict();

export const esquemaCancelamentoLente = z
  .object({ motivo: z.string().trim().min(1).max(500), versao: z.number().int().positive() })
  .strict();
