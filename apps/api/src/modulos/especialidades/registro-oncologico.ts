// Registro oncológico e radioterapia (09-AREA linha 69): o tumor do paciente (CID-10, topografia e morfologia da
// CID-O-3, base do diagnóstico, lateralidade, ECOG), o estadiamento TNM com os sítios de metástase e o plano de
// radioterapia (região irradiada, aparelho, dose, frações) com as sessões. As regras são do domínio (`@sgh/dominio-pep`,
// registro-oncologico); aqui ficam a leitura e a gravação:
//   - `banco`: diagnostico_oncologico, estadiamento_tumor (um evento por estadiamento, nunca alterado), metastase_paciente,
//     tratamento_radioterapia, sessao_radioterapia e aparelho_radioterapia no MariaDB do cliente pelo Executor do
//     núcleo (trilha na mesma transação, versão conferida, Idempotency-Key honrada);
//   - indisponível: 503 em tudo (falha fechada). O E2E roda com as respostas simuladas.
// Nada é apagado: o estadiamento novo não apaga o anterior (a linha do tempo fica), a sessão que faltou fica com o
// motivo e o plano encerrado antes do fim guarda o motivo.
import {
  BASES_DIAGNOSTICO,
  categoriaTnm,
  conferirAprovacaoPlano,
  conferirEncerramentoPlano,
  conferirEstadiamento,
  conferirPlanoRadioterapia,
  conferirSessaoRadioterapia,
  conferirTumor,
  DESFECHOS_SESSAO_RT,
  type ErroCampoOnco,
  LATERALIDADES_TUMOR,
  normalizarMorfologia,
  rotuloTnm,
  type SituacaoPlanoRt,
  TECNICAS_RADIOTERAPIA,
  TIPOS_ESTADIAMENTO,
  type BaseDiagnostico,
  type TipoEstadiamento,
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

export const PORTA_REGISTRO_ONCOLOGICO = Symbol('PORTA_REGISTRO_ONCOLOGICO');
export const OPERACOES_REGISTRO_ONCOLOGICO = {
  tumor: 'pep.oncologia.tumor.registrar',
  estadiar: 'pep.oncologia.tumor.estadiar',
  planejar: 'pep.radioterapia.plano.registrar',
  aprovar: 'pep.radioterapia.plano.aprovar',
  encerrar: 'pep.radioterapia.plano.encerrar',
  sessao: 'pep.radioterapia.sessao.registrar',
  aparelho: 'pep.radioterapia.aparelho.incluir',
} as const;
const TETO = 200;

export interface EstadiamentoLido {
  readonly id: number;
  readonly tipo: TipoEstadiamento;
  readonly data: string;
  readonly tnm: string;
  readonly t: string;
  readonly n: string;
  readonly m: string;
  readonly estadio: string | null;
  readonly metastases: string | null;
}
export interface TumorLido {
  readonly id: number;
  readonly versao: number;
  readonly cid: string;
  readonly cidDescricao: string;
  readonly topografia: string;
  readonly topografiaDescricao: string;
  readonly morfologia: string | null;
  readonly morfologiaDescricao: string | null;
  readonly lateralidade: string;
  readonly diagnosticadoEm: string;
  readonly baseDiagnostica: BaseDiagnostico;
  readonly ecog: number | null;
  readonly situacao: string;
  readonly estadiamentos: EstadiamentoLido[];
  readonly metastases: { sequencia: number; topografia: string | null; descricao: string | null }[];
}
export interface SessaoLida {
  readonly sequencia: number;
  readonly situacao: string;
  readonly realizadaEm: string | null;
  readonly doseAplicadaCgy: number | null;
  readonly motivo: string | null;
}
export interface PlanoLido {
  readonly id: number;
  readonly versao: number;
  readonly numero: string;
  readonly tumor: number;
  readonly regiao: string;
  readonly aparelho: string | null;
  readonly intencao: string;
  readonly tecnica: string;
  readonly doseTotalCgy: number;
  readonly doseFracaoCgy: number;
  readonly fracoesPrevistas: number;
  readonly fracoesPorSemana: number | null;
  readonly situacao: SituacaoPlanoRt;
  readonly inicioPrevisto: string | null;
  readonly inicio: string | null;
  readonly fim: string | null;
  readonly fisico: boolean;
  readonly realizadas: number;
  readonly doseAcumuladaCgy: number;
  readonly motivoEncerramento: string | null;
  readonly sessoes: SessaoLida[];
}
export interface RegistroOncologicoPaciente {
  readonly hoje: string;
  readonly tumores: TumorLido[];
  readonly planos: PlanoLido[];
}
export interface ItemCadastro {
  readonly codigo: string;
  readonly descricao: string;
}
export interface CadastrosOncologia {
  readonly intencoes: ItemCadastro[];
  readonly regioes: ItemCadastro[];
  readonly aparelhos: (ItemCadastro & { modalidade: string })[];
  readonly estadios: ItemCadastro[];
}
export type CatalogoBusca = 'topografia' | 'morfologia' | 'cid';

export interface Autor {
  readonly paciente: number;
  /** A internação de onde veio o pedido (o atendimento gravado é o dela). */
  readonly internacao: number;
  readonly profissional: number;
}
export type NovoTumor = z.infer<typeof esquemaTumor>;
export type NovoEstadiamento = z.infer<typeof esquemaEstadiamento>;
export type NovoPlano = z.infer<typeof esquemaPlano>;
export type NovaSessao = z.infer<typeof esquemaSessao>;
export type NovoAparelho = z.infer<typeof esquemaAparelho>;
type Res = { id: number; aviso?: string | null; situacao?: string; numero?: string };

export interface PortaRegistroOncologico {
  readonly destino: 'banco' | 'indisponivel';
  doPaciente(c: ContextoPortaM18, paciente: number): Promise<RegistroOncologicoPaciente>;
  cadastros(c: ContextoPortaM18): Promise<CadastrosOncologia>;
  buscar(c: ContextoPortaM18, catalogo: CatalogoBusca, termo: string, cid?: string): Promise<ItemCadastro[]>;
  registrarTumor(c: ContextoPortaM18, a: Autor, e: NovoTumor, chave: string): Promise<Res>;
  estadiar(c: ContextoPortaM18, a: Autor, e: NovoEstadiamento, chave: string): Promise<Res>;
  planejar(c: ContextoPortaM18, a: Autor, e: NovoPlano, chave: string): Promise<Res>;
  aprovar(
    c: ContextoPortaM18,
    a: Autor,
    x: { id: number; fisico: number; versao: number },
    chave: string,
  ): Promise<Res>;
  encerrar(
    c: ContextoPortaM18,
    a: Autor,
    x: z.infer<typeof esquemaEncerramento> & { id: number },
    chave: string,
  ): Promise<Res>;
  registrarSessao(
    c: ContextoPortaM18,
    a: Autor,
    e: NovaSessao & { plano: number },
    chave: string,
  ): Promise<Res>;
  incluirAparelho(c: ContextoPortaM18, e: NovoAparelho, chave: string): Promise<Res>;
}

const n = (v: unknown) => Number(v);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const tx_ = (v: unknown) => (v === null || v === undefined ? null : String(v));
/** "C50.4" ↔ "C504" (o termo da CID-10 é guardado sem ponto, como na fonte oficial). */
const semPonto = (cid: string) => cid.replace('.', '').toUpperCase();
const comPonto = (cid: string) => (cid.length > 3 ? `${cid.slice(0, 3)}.${cid.slice(3)}` : cid);

function recusarErros(erros: readonly ErroCampoOnco[], codigo: string): void {
  if (erros.length)
    throw recusa(codigo, erros.map((x) => x.mensagem).join(' '), {
      campos: [...new Set(erros.map((x) => x.campo))],
    });
}
const naoEncontrado = (o: string) =>
  new ErroOperacao(404, 'registro-inexistente', `${o} não encontrado`, `${o} não existe para este paciente.`);

async function hojeDe(l: Pick<Leitor, 'uma'>): Promise<string> {
  const r = await l.uma<Linha>("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') AS hoje", []);
  return String(r?.['hoje']);
}

const SQL_TUMOR = `SELECT d.id, d.versao, d.situacao, d.lateralidade, d.base_diagnostica, d.desempenho_ecog,
    DATE_FORMAT(d.diagnosticado_em, '%Y-%m-%d') AS diagnosticado_em, cid.codigo_termo AS cid, cid.descricao AS cid_descricao,
    tp.codigo_cid_o, tp.descricao AS topografia_descricao, mo.codigo_termo AS morfologia, mo.descricao AS morfologia_descricao
  FROM diagnostico_oncologico d
  JOIN termo_terminologia cid ON cid.id = d.cid_termo_terminologia_id
  JOIN topografia_tumor tp ON tp.id = d.topografia_tumor_id
  LEFT JOIN termo_terminologia mo ON mo.id = d.morfologia_termo_terminologia_id
 WHERE d.estabelecimento_id = ? AND d.paciente_id = ? AND d.excluido_em IS NULL`;

const SQL_PLANO = `SELECT r.id, r.versao, r.numero, r.diagnostico_oncologico_id, r.tecnica, r.dose_total_cgy, r.dose_fracao_cgy,
    r.fracoes_previstas, r.fracoes_por_semana, r.situacao, r.fisico_profissional_id, r.motivo_encerramento,
    DATE_FORMAT(r.data_inicio_prevista, '%Y-%m-%d') AS inicio_previsto, DATE_FORMAT(r.data_inicio, '%Y-%m-%d') AS inicio,
    DATE_FORMAT(r.data_fim, '%Y-%m-%d') AS fim, ri.descricao AS regiao, ap.descricao AS aparelho, it.descricao AS intencao
  FROM tratamento_radioterapia r
  JOIN regiao_irradiada ri ON ri.id = r.regiao_irradiada_id
  JOIN intencao_tratamento_oncologico it ON it.id = r.intencao_tratamento_oncologico_id
  LEFT JOIN aparelho_radioterapia ap ON ap.id = r.aparelho_radioterapia_id
 WHERE r.estabelecimento_id = ? AND r.paciente_id = ? AND r.excluido_em IS NULL`;

export class PortaRegistroOncologicoPropria implements PortaRegistroOncologico {
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
      correlacao: c.correlacao || 'registro-oncologico',
    };
  }

  private async executar<R extends Readonly<Record<string, string | number | null>> & { id: number }>(
    c: ContextoPortaM18,
    nome: string,
    tabelas: readonly string[],
    entrada: Record<string, unknown>,
    chave: string,
    gravar: (tx: TxOperacao, est: number) => Promise<R>,
    motivo: string | null = null,
  ): Promise<R> {
    const ctxN = this.contexto(c);
    const alvo = tabelas[0]!;
    const op = definirOperacao({
      nome,
      tabelas,
      entrada: z.unknown(),
      gravar: (tx: TxOperacao) => gravar(tx, ctxN.estabelecimento),
      alvo: (_e, r: R) => ({ tabela: alvo, id: r.id }),
      trilha: () => ({ dados: entrada, motivo }),
    });
    const ctx: ContextoOperacao = { ...ctxN, chaveIdempotencia: chave };
    const { resultado } = await this.executor.executar(op, c.cliente, entrada, ctx);
    return resultado as R;
  }

  doPaciente(c: ContextoPortaM18, paciente: number): Promise<RegistroOncologicoPaciente> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const hoje = await hojeDe(l);
      const ts = await l.consultar<Linha>(
        `${SQL_TUMOR} ORDER BY d.diagnosticado_em DESC, d.id DESC LIMIT ${TETO}`,
        [ctx.estabelecimento, paciente],
      );
      const ids = ts.map((r) => n(r['id']));
      const marcas = ids.map(() => '?').join(', ') || 'NULL';
      const es = ids.length
        ? await l.consultar<Linha>(
            `SELECT e.id, e.diagnostico_oncologico_id, e.tipo_estadiamento, DATE_FORMAT(e.data_estadiamento, '%Y-%m-%d') AS data,
                    e.categoria_t, e.categoria_n, e.categoria_m, ec.codigo AS estadio, e.locais_metastase
               FROM estadiamento_tumor e LEFT JOIN estadio_clinico ec ON ec.id = e.estadio_clinico_id
              WHERE e.diagnostico_oncologico_id IN (${marcas}) AND e.operacao = 'inclusao'
              ORDER BY e.data_estadiamento DESC, e.id DESC`,
            ids,
            { teto: 2000 },
          )
        : [];
      const ms = ids.length
        ? await l.consultar<Linha>(
            `SELECT m.diagnostico_oncologico_id, m.sequencia, tp.codigo_cid_o, tp.descricao FROM metastase_paciente m
               LEFT JOIN topografia_tumor tp ON tp.id = m.topografia_tumor_id
              WHERE m.diagnostico_oncologico_id IN (${marcas}) AND m.excluido_em IS NULL ORDER BY m.sequencia`,
            ids,
            { teto: 2000 },
          )
        : [];
      const ps = await l.consultar<Linha>(`${SQL_PLANO} ORDER BY r.criado_em DESC, r.id DESC LIMIT ${TETO}`, [
        ctx.estabelecimento,
        paciente,
      ]);
      const pids = ps.map((r) => n(r['id']));
      const ss = pids.length
        ? await l.consultar<Linha>(
            `SELECT tratamento_radioterapia_id, sequencia, situacao, DATE_FORMAT(realizada_em, '%Y-%m-%dT%H:%i') AS realizada_em,
                    dose_aplicada_cgy, motivo FROM sessao_radioterapia
              WHERE tratamento_radioterapia_id IN (${pids.map(() => '?').join(', ')}) AND excluido_em IS NULL
              ORDER BY tratamento_radioterapia_id, sequencia`,
            pids,
            { teto: 5000 },
          )
        : [];
      return {
        hoje,
        tumores: ts.map((r) => {
          const id = n(r['id']);
          return {
            id,
            versao: n(r['versao']),
            cid: comPonto(String(r['cid'])),
            cidDescricao: String(r['cid_descricao']),
            topografia: String(r['codigo_cid_o']),
            topografiaDescricao: String(r['topografia_descricao']),
            morfologia: tx_(r['morfologia']),
            morfologiaDescricao: tx_(r['morfologia_descricao']),
            lateralidade: String(r['lateralidade']),
            diagnosticadoEm: String(r['diagnosticado_em']),
            baseDiagnostica: String(r['base_diagnostica']) as BaseDiagnostico,
            ecog: nn(r['desempenho_ecog']),
            situacao: String(r['situacao']),
            estadiamentos: es
              .filter((e) => n(e['diagnostico_oncologico_id']) === id)
              .map((e) => {
                const tipo = String(e['tipo_estadiamento']) as TipoEstadiamento;
                const [t, nx, m] = ['categoria_t', 'categoria_n', 'categoria_m'].map((k) =>
                  String(e[k] ?? ''),
                );
                return {
                  id: n(e['id']),
                  tipo,
                  data: String(e['data']),
                  tnm: rotuloTnm(tipo, t!, nx!, m!),
                  t: t!,
                  n: nx!,
                  m: m!,
                  estadio: tx_(e['estadio']),
                  metastases: tx_(e['locais_metastase']),
                };
              }),
            metastases: ms
              .filter((m) => n(m['diagnostico_oncologico_id']) === id)
              .map((m) => ({
                sequencia: n(m['sequencia']),
                topografia: tx_(m['codigo_cid_o']),
                descricao: tx_(m['descricao']),
              })),
          };
        }),
        planos: ps.map((r) => {
          const id = n(r['id']);
          const sessoes = ss
            .filter((s) => n(s['tratamento_radioterapia_id']) === id)
            .map((s) => ({
              sequencia: n(s['sequencia']),
              situacao: String(s['situacao']),
              realizadaEm: tx_(s['realizada_em']),
              doseAplicadaCgy: nn(s['dose_aplicada_cgy']),
              motivo: tx_(s['motivo']),
            }));
          const feitas = sessoes.filter((s) => s.situacao === 'realizada');
          return {
            id,
            versao: n(r['versao']),
            numero: String(r['numero']),
            tumor: n(r['diagnostico_oncologico_id']),
            regiao: String(r['regiao']),
            aparelho: tx_(r['aparelho']),
            intencao: String(r['intencao']),
            tecnica: String(r['tecnica']),
            doseTotalCgy: n(r['dose_total_cgy']),
            doseFracaoCgy: n(r['dose_fracao_cgy']),
            fracoesPrevistas: n(r['fracoes_previstas']),
            fracoesPorSemana: nn(r['fracoes_por_semana']),
            situacao: String(r['situacao']) as SituacaoPlanoRt,
            inicioPrevisto: tx_(r['inicio_previsto']),
            inicio: tx_(r['inicio']),
            fim: tx_(r['fim']),
            fisico: r['fisico_profissional_id'] !== null,
            realizadas: feitas.length,
            doseAcumuladaCgy: feitas.reduce((a, s) => a + (s.doseAplicadaCgy ?? 0), 0),
            motivoEncerramento: tx_(r['motivo_encerramento']),
            sessoes,
          };
        }),
      };
    });
  }

  cadastros(c: ContextoPortaM18): Promise<CadastrosOncologia> {
    const ctx = this.contexto(c);
    return this.nucleo.lerSomente(ctx, async (l) => {
      const item = (r: Linha) => ({ codigo: String(r['codigo']), descricao: String(r['descricao']) });
      const [intencoes, regioes, aparelhos, estadios] = await Promise.all([
        l.consultar<Linha>(
          'SELECT codigo, descricao FROM intencao_tratamento_oncologico WHERE ativo ORDER BY ordem, descricao',
          [],
        ),
        l.consultar<Linha>(
          'SELECT codigo, descricao FROM regiao_irradiada WHERE ativo ORDER BY descricao',
          [],
        ),
        l.consultar<Linha>(
          'SELECT codigo, descricao, modalidade FROM aparelho_radioterapia WHERE ativo AND estabelecimento_id = ? ORDER BY descricao',
          [ctx.estabelecimento],
        ),
        l.consultar<Linha>(
          "SELECT codigo, descricao FROM estadio_clinico WHERE ativo AND sistema = 'tnm' AND tipo = 'grupo' ORDER BY ordem, codigo",
          [],
        ),
      ]);
      return {
        intencoes: intencoes.map(item),
        regioes: regioes.map(item),
        aparelhos: aparelhos.map((r) => ({ ...item(r), modalidade: String(r['modalidade']) })),
        estadios: estadios.map(item),
      };
    });
  }

  buscar(c: ContextoPortaM18, catalogo: CatalogoBusca, termo: string, cid?: string): Promise<ItemCadastro[]> {
    const ctx = this.contexto(c);
    const t = termo.trim();
    const like = `%${t.replace(/[%_\\]/g, '\\$&')}%`;
    return this.nucleo.lerSomente(ctx, async (l) => {
      let rs: Linha[];
      if (catalogo === 'topografia')
        rs = await l.consultar<Linha>(
          `SELECT codigo_cid_o AS codigo, descricao FROM topografia_tumor
            WHERE ativo AND (codigo_cid_o LIKE ? OR descricao LIKE ?) ORDER BY codigo_cid_o LIMIT 30`,
          [`${t.toUpperCase()}%`, like],
        );
      else if (catalogo === 'morfologia')
        // As morfologias que a correspondência oficial liga ao CID vêm primeiro.
        rs = await l.consultar<Linha>(
          `SELECT t.codigo_termo AS codigo, t.descricao,
                  EXISTS (SELECT 1 FROM correspondencia_cid_morfologia x
                           WHERE x.codigo_morfologia = t.codigo_termo AND x.codigo_cid IN (?, ?)) AS corresponde
             FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id
            WHERE g.codigo = 'cid_o' AND t.nivel = 2 AND t.ativo AND (t.codigo_termo LIKE ? OR t.descricao LIKE ?)
            ORDER BY corresponde DESC, t.codigo_termo LIMIT 30`,
          [semPonto(cid ?? ''), semPonto(cid ?? '').slice(0, 3), `%${t}%`, like],
        );
      else
        rs = await l.consultar<Linha>(
          `SELECT t.codigo_termo AS codigo, t.descricao FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id
            WHERE g.codigo = 'cid10' AND t.nivel IN (3, 4) AND t.ativo AND t.codigo_termo REGEXP '^(C|D[0-4])'
              AND (t.codigo_termo LIKE ? OR t.descricao LIKE ?) ORDER BY t.codigo_termo LIMIT 30`,
          [`${semPonto(t)}%`, like],
        );
      return rs.map((r) => ({
        codigo: catalogo === 'cid' ? comPonto(String(r['codigo'])) : String(r['codigo']),
        descricao: String(r['descricao']),
      }));
    });
  }

  private async tumorDoPaciente(tx: TxOperacao, id: number, paciente: number, est: number) {
    const [d] = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, situacao, base_diagnostica, DATE_FORMAT(diagnosticado_em, '%Y-%m-%d') AS diagnosticado_em
         FROM diagnostico_oncologico WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [id, paciente, est],
    );
    if (!d) throw naoEncontrado('Tumor');
    if (String(d['situacao']) === 'inativado')
      throw recusa('tumor-inativado', 'O registro do tumor está inativado.');
    return d;
  }

  /** O atendimento da internação, conferida no estabelecimento e no paciente. */
  private async atendimentoDa(tx: TxOperacao, a: Autor, est: number): Promise<number | null> {
    const i = await tx.uma<Linha>(
      'SELECT atendimento_id, paciente_id FROM internacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [a.internacao, est],
    );
    if (!i || n(i['paciente_id']) !== a.paciente)
      throw recusa(
        'paciente-divergente',
        'A internação não é deste paciente neste estabelecimento: recarregue a tela.',
      );
    return nn(i['atendimento_id']);
  }

  private async topografiaId(tx: TxOperacao, codigo: string): Promise<number> {
    const r = await tx.uma<Linha>('SELECT id FROM topografia_tumor WHERE codigo_cid_o = ? AND ativo', [
      codigo.toUpperCase(),
    ]);
    if (!r)
      throw recusa('topografia-inexistente', `A topografia ${codigo} não está no catálogo da CID-O-3.`, {
        campos: ['topografia'],
      });
    return n(r['id']);
  }

  registrarTumor(c: ContextoPortaM18, a: Autor, e: NovoTumor, chave: string): Promise<Res> {
    return this.executar(
      c,
      OPERACOES_REGISTRO_ONCOLOGICO.tumor,
      ['diagnostico_oncologico'],
      { ...a, ...e },
      chave,
      async (tx, est) => {
        recusarErros(conferirTumor(e, await hojeDe(tx)), 'tumor-invalido');
        const cid = await tx.uma<Linha>(
          `SELECT t.id FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id
            WHERE g.codigo = 'cid10' AND t.codigo_termo = ? AND t.ativo`,
          [semPonto(e.cid)],
        );
        if (!cid)
          throw recusa('cid-inexistente', `O CID ${e.cid} não está na CID-10 carregada.`, {
            campos: ['cid'],
          });
        const topografia = await this.topografiaId(tx, e.topografia);
        let morfologia: number | null = null;
        let aviso: string | null = null;
        if (e.morfologia) {
          const cod = normalizarMorfologia(e.morfologia)!;
          const m = await tx.uma<Linha>(
            `SELECT t.id FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id
              WHERE g.codigo = 'cid_o' AND t.codigo_termo = ? AND t.ativo`,
            [cod],
          );
          if (!m)
            throw recusa('morfologia-inexistente', `A morfologia ${cod} não está na CID-O carregada.`, {
              campos: ['morfologia'],
            });
          morfologia = n(m['id']);
          const corr = await tx.uma<Linha>(
            `SELECT COUNT(*) AS total, SUM(codigo_morfologia = ?) AS bate FROM correspondencia_cid_morfologia
              WHERE codigo_cid IN (?, ?)`,
            [cod, semPonto(e.cid), semPonto(e.cid).slice(0, 3)],
          );
          if (n(corr?.['total'] ?? 0) > 0 && n(corr?.['bate'] ?? 0) === 0)
            aviso = `A morfologia ${cod} não está entre as que a classificação oficial associa ao CID ${e.cid}: confira.`;
        }
        const dup = await tx.uma<Linha>(
          `SELECT id FROM diagnostico_oncologico WHERE paciente_id = ? AND estabelecimento_id = ? AND topografia_tumor_id = ?
              AND morfologia_termo_terminologia_id <=> ? AND situacao <> 'inativado' AND excluido_em IS NULL`,
          [a.paciente, est, topografia, morfologia],
        );
        if (dup)
          throw recusa(
            'tumor-ja-registrado',
            'Este tumor (mesma topografia e morfologia) já está registrado: estadie o existente.',
          );
        const multiplo = await tx.uma<Linha>(
          `SELECT id FROM diagnostico_oncologico WHERE paciente_id = ? AND estabelecimento_id = ? AND situacao <> 'inativado'
              AND excluido_em IS NULL LIMIT 1`,
          [a.paciente, est],
        );
        const id = await tx.incluir('diagnostico_oncologico', {
          estabelecimento_id: est,
          paciente_id: a.paciente,
          atendimento_id: await this.atendimentoDa(tx, a, est),
          cid_termo_terminologia_id: n(cid['id']),
          topografia_tumor_id: topografia,
          morfologia_termo_terminologia_id: morfologia,
          lateralidade: e.lateralidade,
          diagnosticado_em: e.diagnosticadoEm,
          base_diagnostica: e.baseDiagnostica,
          tumor_primario_multiplo: multiplo !== null,
          desempenho_ecog: e.ecog,
          profissional_id: a.profissional,
          situacao: 'ativo',
          observacao: e.observacao,
        });
        return { id, aviso };
      },
    );
  }

  estadiar(c: ContextoPortaM18, a: Autor, e: NovoEstadiamento, chave: string): Promise<Res> {
    return this.executar(
      c,
      OPERACOES_REGISTRO_ONCOLOGICO.estadiar,
      ['estadiamento_tumor', 'metastase_paciente'],
      { ...a, ...e },
      chave,
      async (tx, est) => {
        const d = await this.tumorDoPaciente(tx, e.tumor, a.paciente, est);
        const hoje = await hojeDe(tx);
        recusarErros(
          conferirEstadiamento(
            e,
            {
              diagnosticadoEm: String(d['diagnosticado_em']),
              base: String(d['base_diagnostica']) as BaseDiagnostico,
            },
            hoje,
          ),
          'estadiamento-invalido',
        );
        let estadio: number | null = null;
        if (e.estadio) {
          const r = await tx.uma<Linha>(
            "SELECT id FROM estadio_clinico WHERE codigo = ? AND sistema = 'tnm' AND tipo = 'grupo' AND ativo",
            [e.estadio],
          );
          if (!r)
            throw recusa('estadio-inexistente', `O estádio ${e.estadio} não está no cadastro.`, {
              campos: ['estadio'],
            });
          estadio = n(r['id']);
        }
        const usuario = tx.contexto.usuario;
        if (usuario === null)
          throw recusa('sem-usuario', 'A sessão não tem usuário para assinar o estadiamento.');
        const sitios: { codigo: string; id: number }[] = [];
        for (const s of [...new Set(e.metastases.map((x) => x.toUpperCase()))])
          sitios.push({ codigo: s, id: await this.topografiaId(tx, s) });
        const t = categoriaTnm('T', e.t)!;
        const nn_ = categoriaTnm('N', e.n)!;
        const m = categoriaTnm('M', e.m)!;
        const id = await tx.incluir('estadiamento_tumor', {
          diagnostico_oncologico_id: e.tumor,
          tipo_estadiamento: e.tipo,
          data_estadiamento: e.data,
          sistema: 'tnm',
          edicao_sistema: '8',
          categoria_t: t,
          categoria_n: nn_,
          categoria_m: m,
          estadio_clinico_id: estadio,
          locais_metastase: sitios.map((s) => s.codigo).join(', ') || null,
          profissional_id: a.profissional,
          operacao: 'inclusao',
          dados: JSON.stringify({
            tnm: rotuloTnm(e.tipo, t, nn_, m),
            estadio: e.estadio,
            metastases: sitios.map((s) => s.codigo),
          }),
          ocorrido_em: new Date(),
          usuario_id: usuario,
        });
        // Cada sítio novo entra uma vez na lista de metástases do tumor (numerada); o já registrado fica como está.
        const ja = await tx.consultar<Linha>(
          'SELECT topografia_tumor_id, sequencia FROM metastase_paciente WHERE diagnostico_oncologico_id = ? AND excluido_em IS NULL',
          [e.tumor],
        );
        let seq = ja.reduce((x, r) => Math.max(x, n(r['sequencia'])), 0);
        for (const s of sitios)
          if (!ja.some((r) => nn(r['topografia_tumor_id']) === s.id))
            await tx.incluir('metastase_paciente', {
              diagnostico_oncologico_id: e.tumor,
              sequencia: ++seq,
              topografia_tumor_id: s.id,
              detectada_em: e.data,
              metodo_deteccao: `Estadiamento ${e.tipo}`,
            });
        return { id };
      },
    );
  }

  planejar(c: ContextoPortaM18, a: Autor, e: NovoPlano, chave: string): Promise<Res> {
    return this.executar(
      c,
      OPERACOES_REGISTRO_ONCOLOGICO.planejar,
      ['tratamento_radioterapia', 'sequencia_negocio'],
      { ...a, ...e },
      chave,
      async (tx, est) => {
        await this.tumorDoPaciente(tx, e.tumor, a.paciente, est);
        recusarErros(conferirPlanoRadioterapia(e, await hojeDe(tx)), 'plano-radioterapia-invalido');
        const regiao = await tx.uma<Linha>('SELECT id FROM regiao_irradiada WHERE codigo = ? AND ativo', [
          e.regiao,
        ]);
        if (!regiao)
          throw recusa('regiao-inexistente', 'A região irradiada não está no cadastro.', {
            campos: ['regiao'],
          });
        const intencao = await tx.uma<Linha>(
          'SELECT id FROM intencao_tratamento_oncologico WHERE codigo = ? AND ativo',
          [e.intencao],
        );
        if (!intencao)
          throw recusa('intencao-inexistente', 'A intenção do tratamento não está no cadastro.', {
            campos: ['intencao'],
          });
        let aparelho: number | null = null;
        if (e.aparelho) {
          const r = await tx.uma<Linha>(
            'SELECT id FROM aparelho_radioterapia WHERE codigo = ? AND estabelecimento_id = ? AND ativo',
            [e.aparelho, est],
          );
          if (!r)
            throw recusa('aparelho-inexistente', 'O aparelho não está ativo neste estabelecimento.', {
              campos: ['aparelho'],
            });
          aparelho = n(r['id']);
        }
        const seq = await tx.uma(
          'SELECT id FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id = ?',
          ['tratamento_radioterapia', est],
        );
        if (!seq)
          await tx.incluir('sequencia_negocio', {
            estabelecimento_id: est,
            tipo: 'tratamento_radioterapia',
            prefixo: 'RT',
            proximo_valor: 1,
            incremento: 1,
            ativo: true,
          });
        const numero = (await tx.proximoNumero('tratamento_radioterapia')).formatado;
        const id = await tx.incluir('tratamento_radioterapia', {
          estabelecimento_id: est,
          numero,
          paciente_id: a.paciente,
          diagnostico_oncologico_id: e.tumor,
          atendimento_id: await this.atendimentoDa(tx, a, est),
          regiao_irradiada_id: n(regiao['id']),
          aparelho_radioterapia_id: aparelho,
          intencao_tratamento_oncologico_id: n(intencao['id']),
          responsavel_profissional_id: a.profissional,
          tecnica: e.tecnica,
          descricao_area: e.descricaoArea,
          dose_total_cgy: e.doseTotalCgy,
          dose_fracao_cgy: e.doseFracaoCgy,
          fracoes_previstas: e.fracoesPrevistas,
          fracoes_por_semana: e.fracoesPorSemana,
          energia: e.energia,
          concomitante_quimioterapia: e.concomitanteQuimioterapia,
          data_inicio_prevista: e.inicioPrevisto,
          situacao: 'em_planejamento',
        });
        return { id, numero };
      },
    );
  }

  private async planoDoPaciente(tx: TxOperacao, id: number, paciente: number, est: number) {
    const [r] = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, situacao, dose_total_cgy, dose_fracao_cgy, fracoes_previstas, regiao_irradiada_id, atendimento_id,
              DATE_FORMAT(data_inicio, '%Y-%m-%d') AS data_inicio
         FROM tratamento_radioterapia WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [id, paciente, est],
    );
    if (!r) throw naoEncontrado('Plano de radioterapia');
    return r;
  }

  aprovar(c: ContextoPortaM18, a: Autor, x: { id: number; fisico: number; versao: number }, chave: string) {
    return this.executar(
      c,
      OPERACOES_REGISTRO_ONCOLOGICO.aprovar,
      ['tratamento_radioterapia'],
      { ...a, ...x },
      chave,
      async (tx, est) => {
        const p = await this.planoDoPaciente(tx, x.id, a.paciente, est);
        recusarErros(
          conferirAprovacaoPlano(String(p['situacao']) as SituacaoPlanoRt, x.fisico > 0),
          'aprovacao-plano-invalida',
        );
        await tx.alterar('tratamento_radioterapia', x.id, x.versao, {
          situacao: 'aprovado',
          fisico_profissional_id: x.fisico,
        });
        return { id: x.id, situacao: 'aprovado' };
      },
    );
  }

  encerrar(
    c: ContextoPortaM18,
    a: Autor,
    x: z.infer<typeof esquemaEncerramento> & { id: number },
    chave: string,
  ) {
    return this.executar(
      c,
      OPERACOES_REGISTRO_ONCOLOGICO.encerrar,
      ['tratamento_radioterapia'],
      { ...a, ...x },
      chave,
      async (tx, est) => {
        const p = await this.planoDoPaciente(tx, x.id, a.paciente, est);
        recusarErros(
          conferirEncerramentoPlano(String(p['situacao']) as SituacaoPlanoRt, x.motivo),
          'encerramento-plano-invalido',
        );
        await tx.alterar('tratamento_radioterapia', x.id, x.versao, {
          situacao: x.situacao,
          motivo_encerramento: x.motivo.trim(),
          data_fim: p['data_inicio'] ? await hojeDe(tx) : null,
        });
        return { id: x.id, situacao: x.situacao };
      },
      x.motivo.trim(),
    );
  }

  registrarSessao(
    c: ContextoPortaM18,
    a: Autor,
    e: NovaSessao & { plano: number },
    chave: string,
  ): Promise<Res> {
    return this.executar(
      c,
      OPERACOES_REGISTRO_ONCOLOGICO.sessao,
      ['sessao_radioterapia', 'tratamento_radioterapia'],
      { ...a, ...e },
      chave,
      async (tx, est) => {
        const p = await this.planoDoPaciente(tx, e.plano, a.paciente, est);
        const soma = await tx.uma<Linha>(
          `SELECT COALESCE(MAX(sequencia), 0) AS ultima, SUM(situacao = 'realizada') AS realizadas,
                  COALESCE(SUM(CASE WHEN situacao = 'realizada' THEN dose_aplicada_cgy END), 0) AS acumulada
             FROM sessao_radioterapia WHERE tratamento_radioterapia_id = ? AND excluido_em IS NULL`,
          [e.plano],
        );
        const r = conferirSessaoRadioterapia(
          {
            situacao: String(p['situacao']) as SituacaoPlanoRt,
            doseTotalCgy: n(p['dose_total_cgy']),
            doseFracaoCgy: n(p['dose_fracao_cgy']),
            fracoesPrevistas: n(p['fracoes_previstas']),
            realizadas: n(soma?.['realizadas'] ?? 0),
            doseAcumuladaCgy: n(soma?.['acumulada'] ?? 0),
          },
          e,
        );
        recusarErros(r.erros, 'sessao-radioterapia-invalida');
        const hoje = await hojeDe(tx);
        const realizada = e.desfecho === 'realizada';
        const id = await tx.incluir('sessao_radioterapia', {
          tratamento_radioterapia_id: e.plano,
          sequencia: n(soma?.['ultima'] ?? 0) + 1,
          regiao_irradiada_id: nn(p['regiao_irradiada_id']),
          prevista_em: hoje,
          realizada_em: realizada ? new Date() : null,
          atendimento_id: (await this.atendimentoDa(tx, a, est)) ?? nn(p['atendimento_id']),
          dose_prescrita_cgy: n(p['dose_fracao_cgy']),
          dose_aplicada_cgy: realizada ? e.doseAplicadaCgy : null,
          numero_campos: e.numeroCampos,
          situacao: e.desfecho,
          motivo: realizada ? null : e.motivo?.trim() || null,
          intercorrencias: e.intercorrencias,
          responsavel_profissional_id: a.profissional,
        });
        if (r.situacaoPlano !== p['situacao'] || (realizada && !p['data_inicio']))
          await tx.alterar('tratamento_radioterapia', e.plano, n(p['versao']), {
            situacao: r.situacaoPlano,
            ...(realizada && !p['data_inicio'] ? { data_inicio: hoje } : {}),
            ...(r.situacaoPlano === 'concluido' ? { data_fim: hoje } : {}),
          });
        return { id, situacao: r.situacaoPlano };
      },
      e.desfecho === 'realizada' ? null : (e.motivo?.trim() ?? null),
    );
  }

  incluirAparelho(c: ContextoPortaM18, e: NovoAparelho, chave: string): Promise<Res> {
    return this.executar(
      c,
      OPERACOES_REGISTRO_ONCOLOGICO.aparelho,
      ['aparelho_radioterapia'],
      { ...e },
      chave,
      async (tx, est) => {
        const ja = await tx.uma<Linha>('SELECT id FROM aparelho_radioterapia WHERE codigo = ?', [e.codigo]);
        if (ja)
          throw recusa('aparelho-duplicado', 'Já existe aparelho com este código.', { campos: ['codigo'] });
        const id = await tx.incluir('aparelho_radioterapia', {
          estabelecimento_id: est,
          codigo: e.codigo,
          descricao: e.descricao,
          modalidade: e.modalidade,
          modelo: e.modelo,
          numero_serie: e.numeroSerie,
          energia_maxima_mev: e.energiaMaximaMev,
          ativo: true,
        });
        return { id };
      },
    );
  }
}

const indisponivel = (): Promise<never> =>
  Promise.reject(
    new ErroProblema(
      'indisponivel',
      503,
      'Serviço indisponível',
      'O registro oncológico precisa do banco do cliente.',
    ),
  );

export function portaRegistroOncologicoIndisponivel(): PortaRegistroOncologico {
  return {
    destino: 'indisponivel',
    doPaciente: indisponivel,
    cadastros: indisponivel,
    buscar: indisponivel,
    registrarTumor: indisponivel,
    estadiar: indisponivel,
    planejar: indisponivel,
    aprovar: indisponivel,
    encerrar: indisponivel,
    registrarSessao: indisponivel,
    incluirAparelho: indisponivel,
  };
}

// ── Entrada da API (a forma; as regras clínicas ficam no domínio) ──
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const texto = (max: number) => z.string().trim().max(max).nullable().default(null);
const dose = z.number().finite().positive().max(20000);

export const esquemaTumor = z
  .object({
    cid: z
      .string()
      .trim()
      .regex(/^[CD]\d{2}(\.?\d)?$/i),
    topografia: z
      .string()
      .trim()
      .regex(/^C\d{2}\.\d$/i),
    morfologia: z.string().trim().max(10).nullable().default(null),
    diagnosticadoEm: data,
    baseDiagnostica: z.enum(BASES_DIAGNOSTICO),
    lateralidade: z.enum(LATERALIDADES_TUMOR).default('nao_se_aplica'),
    ecog: z.number().int().nullable().default(null),
    observacao: texto(2000),
  })
  .strict();

export const esquemaEstadiamento = z
  .object({
    tumor: z.number().int().positive(),
    tipo: z.enum(TIPOS_ESTADIAMENTO),
    data,
    t: z.string().trim().min(1).max(10),
    n: z.string().trim().min(1).max(10),
    m: z.string().trim().min(1).max(10),
    estadio: z.string().trim().min(1).max(30).nullable().default(null),
    metastases: z
      .array(
        z
          .string()
          .trim()
          .regex(/^C\d{2}\.\d$/i),
      )
      .max(20)
      .default([]),
  })
  .strict();

export const esquemaPlano = z
  .object({
    tumor: z.number().int().positive(),
    regiao: z.string().trim().min(1).max(30),
    aparelho: z.string().trim().min(1).max(30).nullable().default(null),
    intencao: z.string().trim().min(1).max(30),
    tecnica: z.enum(TECNICAS_RADIOTERAPIA),
    descricaoArea: texto(500),
    doseTotalCgy: dose,
    doseFracaoCgy: dose,
    fracoesPrevistas: z.number().int().positive().max(100),
    fracoesPorSemana: z.number().int().nullable().default(null),
    energia: texto(30),
    concomitanteQuimioterapia: z.boolean().default(false),
    inicioPrevisto: data.nullable().default(null),
  })
  .strict();

export const esquemaAprovacao = z
  .object({ fisico: z.number().int().positive(), versao: z.number().int().positive() })
  .strict();

export const esquemaEncerramento = z
  .object({
    situacao: z.enum(['interrompido', 'cancelado']),
    motivo: z.string().trim().min(1).max(1000),
    versao: z.number().int().positive(),
  })
  .strict();

export const esquemaSessao = z
  .object({
    desfecho: z.enum(DESFECHOS_SESSAO_RT),
    doseAplicadaCgy: z.number().finite().nonnegative().max(20000).nullable().default(null),
    numeroCampos: z.number().int().positive().max(99).nullable().default(null),
    motivo: texto(500),
    intercorrencias: texto(2000),
  })
  .strict();

export const esquemaAparelho = z
  .object({
    codigo: z.string().trim().min(1).max(30),
    descricao: z.string().trim().min(1).max(150),
    modalidade: z.enum([
      'acelerador_linear',
      'cobaltoterapia',
      'braquiterapia',
      'ortovoltagem',
      'tomoterapia',
      'outro',
    ]),
    modelo: texto(100),
    numeroSerie: texto(50),
    energiaMaximaMev: z.number().finite().positive().max(100).nullable().default(null),
  })
  .strict();
