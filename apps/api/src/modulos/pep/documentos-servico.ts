// Regras do prontuário de uso diário na API (M23; ficha, seções 4 e 7): o painel, o cabeçalho com os alertas de
// completude, a linha do tempo com o sigilo da categoria, o documento aberto, as alergias, a lista de problemas, os
// pedidos de exame com os avisos, os resultados com a ciência de crítico, a receita, o atestado, o TCLE, o sumário de
// alta, a transferência, o óbito, os anexos, o registro de tempo, a fila do parecer e as pendências de assinatura.
// Os documentos que gravam no banco do estabelecimento são MONTADOS aqui pelos construtores de @sgh/dominio-pep (o
// texto, o RTF, o XML do documento emitido com o cabeçalho lido dos retratos) e vão ao executor; nada aqui conhece
// tabela: os dados vêm da porta, as regras do domínio.
import {
  GRAVIDADES_ALERGIA,
  type GravidadeAlergia,
  type HistoricoAlergia,
  ORIGENS_ALERGIA,
  type OrigemAlergia,
  type AcaoLiberada,
  type AlergiaPep,
  type AlergiasPaciente,
  type AltaPaciente,
  type AnexarDocumento,
  type AnexosPaciente,
  type AtendimentoPep,
  type AvisoPedidoExame,
  type CategoriaAssistencial,
  type VinculoPainel,
  type CancelamentoObito,
  type DeclaracaoObito,
  type DocumentoAberto,
  type DocumentoGravado,
  type DocumentoResumo,
  type DocumentosPaciente,
  type EmitirAtestado,
  type EmitirReceita,
  type EmitirTcle,
  type EventoLinhaTempo,
  type ExameCatalogo,
  type ExameExterno,
  type FilaPareceres,
  type GravarProblema,
  hashCanonico,
  type LinhaPainel,
  type LinhaTempo,
  type PedidoExame,
  type PedidosExame,
  type PendenciasAssinatura,
  type PreviaAssinatura,
  type ProblemaPep,
  type RegistrarAlergia,
  type RelatorioTransferencia,
  type ResultadoExame,
  type ResultadosPaciente,
  type SalvarSumario,
  type SituacaoAlergias,
  type SolicitarExames,
  type SumarioAltaEstruturado,
  TETO_LINHA_TEMPO,
  type TclesPaciente,
  type TempoEvento,
  TIPOS_EVENTO_LINHA,
  type TipoAtestado,
  type TipoDocumentoAberto,
  type TipoEventoLinha,
  esquemaSumarioAlta,
} from '@sgh/contratos';
import {
  acaoDoAtestado,
  alertasCompletude,
  avisosDoPedido,
  cabecalhoDoAto,
  categoriaDoCbo,
  chaveDoExame,
  comSigilo,
  conferirAtestado,
  conferirNovaAlergia,
  manifestacoesDoPedido,
  RecusaHistoricoAlergia,
  conferirReceita,
  documentoAtestado,
  documentoExameExterno,
  documentoPedidoExame,
  documentoReceita,
  ehCritico,
  faixaDoTexto,
  fhirDoSumario,
  foraDaFaixa,
  grupoDoAto,
  hashDaAlergia,
  itensComKit,
  LIMITES_CRITICOS_PADRAO,
  linhasDaReceita,
  mudancaValida,
  montarSumario,
  episodioNasJanelas,
  linhasDoSumario,
  type SecaoComJanela,
  numeroDoTexto,
  ordenarFila,
  podeVerConteudo,
  paragrafosDoTexto,
  parecerAtrasado,
  pendenciasDoSumario,
  SECOES_PADRAO,
  type SecaoVigente,
  sumarioNasSecoes,
  PERFIL_FHIR_SUMARIO,
  podeGravarPedido,
  podePraticar,
  problemasVigentes,
  rtfDaReceita,
  rtfDoCampo,
  rtfParaTexto,
  situacaoDasAlergias,
  situacaoDasAlergiasDoResumo,
  TEXTO_SIGILO,
  tendencias,
  textoCorrido,
  textoDoAtestado,
  textoDoSumario,
  TIPO_PADRAO_LEGADO,
  tipoDoModelo,
  xmlDoAtestado,
  linhasDaCausa,
  validarCancelamentoObito,
  type LinhaCausaObito,
} from '@sgh/dominio-pep';
import { linhasComMarcaTelemedicina } from '@sgh/dominio-atendimento';
import { type ConteudoPep, type ModeloPep, modeloDoTipo, TITULOS_PEP } from '@sgh/dominio-documento';
import { paragrafosDoRegistroTurno } from '@sgh/dominio-enfermagem';
import type { ContextoOperacao } from '@sgh/nucleo';
import {
  type ContextoGravacaoPep,
  type DocumentoHistoricoLido,
  type DocumentoProprioLido,
  type EpisodioLido,
  SITUACAO_DOC,
  TIPO_ATO,
} from './tipos-pep.js';
import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoDocs, PortaDocumentos, ProfissionalPep } from './documentos-porta.js';

export const TETO_PAINEL = 300;
const DIA = 86_400_000;
const PAGINA_LINHA = 50;

const RECEITA_SGH = {
  simples: 'receita',
  'controle-especial': 'receita-controlada',
  antimicrobiano: 'receita-antimicrobiano',
} as const;

/** Origem do documento do novo (tabela de origem) → tipo do documento aberto na tela. */
export function tipoAbertoDaOrigem(
  d: Pick<DocumentoProprioLido, 'origemTabela' | 'tipo'>,
): TipoDocumentoAberto {
  switch (d.origemTabela) {
    case 'receita_medica':
      return 'receita';
    case 'documento_emitido':
      return d.tipo === 'sumario-alta' ? 'sumario-alta' : 'atestado';
    case 'requisicao_exame':
      return 'pedido-exame';
    case 'exame_lancado_prontuario':
      return 'exame-externo';
    case 'anexo_prontuario':
      return 'anexo';
    case 'SGH_PEP_TCLE':
      return 'tcle';
    case 'SGH_PEP_REL_TRANSF':
      return 'rel-transferencia';
    case 'SGH_PEP_OBITO':
      return 'declaracao-obito';
    default:
      return 'registro';
  }
}

export const TITULO_DOCUMENTO_SGH: Readonly<Record<string, string>> = {
  receita: 'Receita simples',
  'receita-controlada': 'Receita de controle especial',
  'receita-antimicrobiano': 'Receita de antimicrobiano',
  atestado: 'Atestado médico',
  declaracao: 'Declaração',
  requerimento: 'Requerimento',
  'sumario-alta': 'Sumário de alta',
  tcle: 'Termo de consentimento',
  'rel-transferencia': 'Relatório de transferência',
  'declaracao-obito': 'Declaração de óbito',
  anexo: 'Documento anexado',
  'exame-externo': 'Exame externo',
  'pedido-exame': 'Pedido de exames',
  alergia: 'Alergias',
  'registro-clinico': 'Registro clínico',
  'registro-enfermagem-turno': 'Registro de enfermagem do turno',
};

/** O documento se abre pelo próprio id (não pelo da origem): os só do novo e o registro de enfermagem do turno. */
function abrePeloDocumento(d: Pick<DocumentoProprioLido, 'origemTabela' | 'tipo'>): boolean {
  const tipo = tipoAbertoDaOrigem(d);
  return (
    tipo === 'tcle' ||
    tipo === 'rel-transferencia' ||
    tipo === 'declaracao-obito' ||
    d.origemTabela === 'fechamento_checagem_paciente'
  );
}

function idadeEmAnos(nascimento: string | null, agora: Date): number | null {
  if (!nascimento) return null;
  const n = new Date(`${nascimento.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(n.getTime())) return null;
  let i = agora.getUTCFullYear() - n.getUTCFullYear();
  if (
    agora.getUTCMonth() < n.getUTCMonth() ||
    (agora.getUTCMonth() === n.getUTCMonth() && agora.getUTCDate() < n.getUTCDate())
  )
    i--;
  return i;
}

export function idadeTexto(nascimento: string | null, agora: Date): string | null {
  const i = idadeEmAnos(nascimento, agora);
  if (i === null) return null;
  if (i >= 1) return `${i} ${i === 1 ? 'ano' : 'anos'}`;
  const n = new Date(`${nascimento!.slice(0, 10)}T00:00:00Z`);
  const meses = Math.max(0, Math.floor((agora.getTime() - n.getTime()) / (30 * DIA)));
  return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
}

/** Texto do RTF ou do XML do documento em parágrafos (nunca HTML). */
export function paragrafosDoDocumento(rtf: string | null, xml: string | null): string[] {
  const deRtf = (r: string) =>
    textoCorrido(rtfParaTexto(r))
      .split(/\r?\n/)
      .map((l) => l.trimEnd());
  if (rtf) return limpar(deRtf(rtf));
  if (!xml) return [];
  const decod = xml
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
  const i = decod.indexOf('{\\rtf');
  if (i >= 0) {
    const f = decod.lastIndexOf('}');
    if (f > i) return limpar(deRtf(decod.slice(i, f + 1)));
  }
  return limpar(
    decod
      .replace(/<[^>]+>/g, '\n')
      .split('\n')
      .map((l) => l.trim()),
  );
}

function limpar(ls: string[]): string[] {
  const r: string[] = [];
  for (const l of ls) if (l.trim() !== '' || (r.length > 0 && r[r.length - 1] !== '')) r.push(l);
  while (r.length > 0 && r[r.length - 1] === '') r.pop();
  return r;
}

/** Gravidade e origem lidas no vocabulário do contrato; valor fora dele vira null (nunca inventado). */
const gravidadeDe = (v: string | null): GravidadeAlergia | null =>
  (GRAVIDADES_ALERGIA as readonly string[]).includes(v ?? '') ? (v as GravidadeAlergia) : null;
const origemDe = (v: string | null): OrigemAlergia | null =>
  (ORIGENS_ALERGIA as readonly string[]).includes(v ?? '') ? (v as OrigemAlergia) : null;

const liberada = (pode: boolean, motivo: string | null): AcaoLiberada => ({
  pode,
  motivo: pode ? null : motivo,
});

function horaLocal(iso: string): string {
  return iso.slice(0, 16);
}

/**
 * Início (AAAA-MM-DD) da janela do valor crítico sem ciência nos alertas: a entrada do atendimento, no máximo 30 dias
 * para trás; sem entrada, as últimas 24 horas.
 */
export function inicioJanelaCritico(entrada: string | null, agora: Date): string {
  const limite = new Date(agora.getTime() - 30 * DIA).toISOString().slice(0, 10);
  if (!entrada) return new Date(agora.getTime() - DIA).toISOString().slice(0, 10);
  const e = entrada.slice(0, 10);
  return e < limite ? limite : e;
}

/** Categoria do profissional pelo CBO em uso (ocupação do CBO 2002). */
export function categoriaDe(p: ProfissionalPep | null): CategoriaAssistencial | null {
  if (!p) return null;
  const o = p.ocupacoes.find((x) => x.cbo === p.cbo) ?? p.ocupacoes[0];
  return categoriaDoCbo(o?.codigo ?? null);
}

function conselhoDe(p: ProfissionalPep): boolean {
  const o = p.ocupacoes.find((x) => x.cbo === p.cbo) ?? p.ocupacoes[0];
  return o?.conselhoAtivo ?? false;
}

export interface OpcoesGravacao {
  readonly comoSuporte: boolean;
}

export class ServicoDocumentos {
  private readonly logTele = new Logger('DocumentosTelemedicina');
  constructor(readonly porta: PortaDocumentos) {}

  /**
   * M50, etapa 4 (regra 7): o atendimento foi teleconsulta? A receita e o atestado emitidos nele levam a marca "emitido
   * em modalidade de telemedicina" (a telemedicina liga a consulta na montagem; sem ela, nenhuma marca).
   */
  private emTeleconsulta: ((c: ContextoDocs, atendimento: number) => Promise<boolean>) | null = null;

  ligarTelemedicina(fn: (c: ContextoDocs, atendimento: number) => Promise<boolean>): void {
    this.emTeleconsulta = fn;
  }

  /**
   * A falha da leitura não vira "sem marca": o documento não é emitido (a marca é obrigatória na teleconsulta) e o
   * profissional tenta de novo.
   */
  private async marcaTelemedicina(c: ContextoDocs, atendimento: number): Promise<boolean> {
    if (!this.emTeleconsulta) return false;
    try {
      return await this.emTeleconsulta(c, atendimento);
    } catch (e) {
      this.logTele.warn(
        `Leitura da teleconsulta do atendimento falhou: ${e instanceof Error ? e.message : 'erro'}`,
      );
      throw new ErroProblema(
        'indisponivel',
        503,
        'Documento não emitido',
        'Não foi possível conferir se o atendimento é teleconsulta (a marca da telemedicina é obrigatória): tente de novo.',
        { codigo: 'marca-telemedicina-indisponivel' },
      );
    }
  }

  get destino(): 'proprio' | 'memoria' {
    return this.porta.destino;
  }

  profissional(c: ContextoDocs, login: string): Promise<ProfissionalPep | null> {
    return this.porta.profissional(c, login);
  }

  exigirProfissional(p: ProfissionalPep | null): ProfissionalPep {
    if (!p)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem ocupação no cadastro de profissionais',
        'O usuário da sessão não tem ocupação ativa no cadastro de profissionais: o ato clínico fica em consulta.',
        { codigo: 'profissional-sem-cbo' },
      );
    return p;
  }

  /** Regra 2: a matriz ação × categoria pelo CBO (com o conselho ativo). */
  decidir(p: ProfissionalPep | null, acao: Parameters<typeof podePraticar>[1]): AcaoLiberada {
    if (!p) return { pode: false, motivo: 'Sem ocupação no cadastro de profissionais.' };
    return podePraticar({ categoria: categoriaDe(p), conselhoAtivo: conselhoDe(p) }, acao);
  }

  exigirAcao(p: ProfissionalPep, acao: Parameters<typeof podePraticar>[1]): void {
    const d = this.decidir(p, acao);
    if (!d.pode)
      throw new ErroProblema('sem-permissao', 403, 'Ação não permitida para a categoria', d.motivo ?? '', {
        codigo: 'categoria-nao-permitida',
      });
  }

  async podeGravar(c: ContextoDocs, operacao: string, login: string): Promise<AcaoLiberada> {
    try {
      const l = await this.porta.podeGravar(c, operacao, login);
      return liberada(l.pode, l.motivo);
    } catch {
      return { pode: false, motivo: 'Não foi possível conferir a liberação da gravação.' };
    }
  }

  private async agora(c: ContextoDocs): Promise<{ local: string; data: Date }> {
    const local = await this.porta.agora(c);
    return { local, data: new Date(`${local}Z`) };
  }

  // ── Atendimentos ───────────────────────────────────────────────────────────────────────────────

  async atendimentos(c: ContextoDocs, paciente: number): Promise<AtendimentoPep[]> {
    const ls = await this.porta.atendimentos(c, paciente);
    return ls.map((a) => ({
      id: a.id,
      registro: a.registro,
      tipo: a.tipo,
      entrada: a.entrada,
      alta: a.alta,
      aberto: a.alta === null,
      unidade: a.unidade,
    }));
  }

  /** O atendimento é do paciente? (404 igual para inexistente e de outro paciente) */
  async exigirAtendimento(c: ContextoDocs, paciente: number, atendimento: number) {
    const r = await this.porta.retratos(c, atendimento, paciente);
    if (!r || !r.doPaciente)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Atendimento não encontrado',
        'O atendimento não é deste paciente.',
      );
    return { htAtendimento: r.htAtendimento, htPaciente: r.htPaciente };
  }

  async exigirPaciente(c: ContextoDocs, paciente: number) {
    const p = await this.porta.paciente(c, paciente);
    if (!p) throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado');
    return p;
  }

  // ── Painel ─────────────────────────────────────────────────────────────────────────────────────

  async painel(
    c: ContextoDocs,
    login: string,
    f: {
      unidade: number | null;
      busca: string | null;
      favoritos: readonly number[] | null;
      vinculo?: VinculoPainel;
      profissional?: ProfissionalPep | null;
    },
  ): Promise<{
    pacientes: LinhaPainel[];
    total: number;
    limitado: boolean;
    unidades: { id: number; nome: string }[];
    preferenciaUnidade: number | null;
  }> {
    const [{ data: agora }, unidades, pref] = await Promise.all([
      this.agora(c),
      this.porta.unidades(c),
      this.porta.preferenciasPainel(c, login).catch(() => ({ unidade: null, campos: [] })),
    ]);
    // Recorte por vínculo: sem ocupação no cadastro de profissionais, "meus" e "equipe" ficam vazios (nenhum CBO).
    const prof = f.profissional ?? null;
    const r = await this.porta.painel(c, {
      unidade: f.unidade,
      busca: f.busca,
      ...(f.vinculo === 'meus'
        ? { meus: { cbos: prof?.cbos ?? [], login, hospital: c.hospital } }
        : f.vinculo === 'equipe'
          ? { equipe: { especialidades: prof?.especialidades ?? [] } }
          : {}),
    });
    const favoritos = new Set(f.favoritos ?? []);
    const doPainel = r.linhas.filter((l) => f.favoritos === null || favoritos.has(l.paciente));
    // Regra 14: os mesmos alertas do cabeçalho, lidos de uma vez para todas as linhas (teto de 300).
    const desde = doPainel.reduce(
      (m, l) => {
        const d = inicioJanelaCritico(l.entrada, agora);
        return d < m ? d : m;
      },
      inicioJanelaCritico(null, agora),
    );
    const [pendentes, comp] = await Promise.all([
      this.porta.pendencias(c, login).catch(() => []),
      this.porta
        .completudePainel(
          c,
          doPainel.map((l) => l.paciente),
          doPainel.map((l) => l.atendimento),
          new Date(`${desde}T00:00:00`),
        )
        .catch(() => null),
    ]);
    const pendPorPaciente = new Map<number, number>();
    for (const d of pendentes) pendPorPaciente.set(d.paciente, (pendPorPaciente.get(d.paciente) ?? 0) + 1);
    const evolucao = new Map((comp?.evolucoesMedicas ?? []).map((x) => [x.atendimento, x.em]));
    const ultimaAlergia = new Map((comp?.alergiasInformadas ?? []).map((x) => [x.paciente, x.em]));
    const ultimaNega = new Map((comp?.negas ?? []).map((x) => [x.paciente, x.em]));
    const comCiencia = new Set((comp?.ciencias ?? []).map((x) => x.exame));
    const linhas: LinhaPainel[] = doPainel.map((l) => {
      const entrada = l.entrada ? new Date(`${l.entrada.slice(0, 19)}Z`) : null;
      const pend = pendPorPaciente.get(l.paciente) ?? 0;
      const janela = inicioJanelaCritico(l.entrada, agora);
      const porExame = new Map<
        number,
        { elemento: string; numerico: number; minAbe: number | null; maxAbe: number | null }[]
      >();
      for (const v of comp?.valores ?? [])
        if (
          v.paciente === l.paciente &&
          !comCiencia.has(v.exame) &&
          (v.liberadoEm ?? '').slice(0, 10) >= janela
        )
          porExame.set(v.exame, [...(porExame.get(v.exame) ?? []), v]);
      const criticos = [...porExame.values()].filter((vs) => this.criticoDoResultado({ valores: vs })).length;
      const em = evolucao.get(l.atendimento);
      const alergias: SituacaoAlergias = situacaoDasAlergiasDoResumo(
        l.alergiasAtivas,
        ultimaAlergia.get(l.paciente),
        ultimaNega.get(l.paciente),
      );
      return {
        paciente: l.paciente,
        nome: l.nomeSocial ?? l.nome,
        idade: idadeTexto(l.nascimento, agora),
        sexo: l.sexo,
        prontuario: String(l.prontuario),
        atendimento: l.atendimento,
        registro: l.registro,
        tipo: l.tipo,
        entrada: l.entrada,
        dias: entrada ? Math.max(0, Math.floor((agora.getTime() - entrada.getTime()) / DIA)) : null,
        unidade: l.unidade,
        leito: l.leito,
        convenio: l.convenio,
        medico: l.medico,
        alergias,
        alertas: alertasCompletude(
          {
            internado: l.tipo === 'internacao',
            registros: em ? [{ em, cbo: '225', suspenso: false }] : [],
            assinaturasPendentes: pend,
            // A linha do painel é de internação aberta (sem alta médica) ou atendimento externo do dia.
            altaMedica: false,
            sumarioFinalizado: true,
            criticosSemCiencia: criticos,
            pareceresAtrasados: (comp?.pareceres ?? []).filter(
              (p) =>
                p.paciente === l.paciente &&
                parecerAtrasado(p.situacao, p.prazo ? new Date(p.prazo) : null, agora),
            ).length,
            entrada: l.entrada,
          },
          agora,
        ),
        favorito: favoritos.has(l.paciente),
      };
    });
    return {
      pacientes: linhas,
      total: linhas.length,
      limitado: r.limitado,
      unidades,
      preferenciaUnidade: pref.unidade,
    };
  }

  // ── Cabeçalho ──────────────────────────────────────────────────────────────────────────────────

  async situacaoAlergias(
    c: ContextoDocs,
    paciente: number,
  ): Promise<{ situacao: SituacaoAlergias; itens: string[] }> {
    const [als, docs] = await Promise.all([
      this.porta.alergias(c, paciente),
      this.porta.documentosSgh(c, paciente),
    ]);
    // "Nega alergias" no novo: o documento de alergia sem linha no legado (origem própria; o registro clínico nas antigas).
    const negas = docs.filter(
      (d) => d.tipo === 'alergia' && d.origemTabela !== 'alergia_paciente' && d.criadoEm,
    );
    const situacao = situacaoDasAlergias(
      als.map((a) => ({
        id: a.id,
        agenteId: a.agenteId,
        agente: a.agente,
        ativa: a.ativa,
        registradaEm: a.registradaEm,
      })),
      negas.map((d) => ({ em: d.criadoEm as string })),
    );
    return { situacao, itens: [...new Set(als.filter((a) => a.ativa).map((a) => a.agente))] };
  }

  async cabecalho(c: ContextoDocs, paciente: number, prof: ProfissionalPep | null, login: string) {
    const [p, ats, { data: agora }, alergias] = await Promise.all([
      this.exigirPaciente(c, paciente),
      this.atendimentos(c, paciente),
      this.agora(c),
      this.situacaoAlergias(c, paciente),
    ]);
    const lidos = await this.porta.atendimentos(c, paciente);
    const atual = ats.find((a) => a.aberto) ?? ats[0] ?? null;
    const lido = atual ? (lidos.find((a) => a.id === atual.id) ?? null) : null;
    const alertas = atual ? await this.alertasDoAtendimento(c, paciente, atual, login, agora) : [];
    const entrada = atual?.entrada ? new Date(`${atual.entrada.slice(0, 19)}Z`) : null;
    return {
      paciente,
      contexto: {
        identificacao: {
          nomeSocial: p.nomeSocial,
          nomeCivil: p.nome || 'Paciente',
          nascimento: (p.nascimento ?? '1900-01-01').slice(0, 10),
          idade: idadeTexto(p.nascimento, agora) ?? '-',
          sexo: p.sexo === 'F' ? 'Feminino' : p.sexo === 'M' ? 'Masculino' : 'Não informado',
          prontuario: String(p.prontuario),
        },
        localizacao: {
          estabelecimento: c.hospital,
          unidade: atual?.unidade ?? null,
          leito: lido?.leito ?? null,
          diasInternacao:
            atual?.tipo === 'internacao' && entrada
              ? Math.max(0, Math.floor((agora.getTime() - entrada.getTime()) / DIA))
              : null,
          altaProvavel: null,
        },
        atendimento: {
          tipo: atual
            ? atual.tipo === 'internacao'
              ? 'Internação'
              : 'Atendimento externo'
            : 'Sem atendimento',
          numero: atual ? String(atual.registro) : '-',
          convenio: lido?.convenio ?? null,
          medicoResponsavel: lido?.medico ?? null,
        },
        alergias:
          alergias.situacao === 'lista' && alergias.itens.length > 0
            ? { situacao: 'lista' as const, itens: alergias.itens }
            : alergias.situacao === 'nega'
              ? { situacao: 'nega' as const }
              : { situacao: 'nao-avaliadas' as const },
        alertas: alertas.map((a) => ({ id: a.tipo, texto: a.texto })),
        homonimoNaUnidade: false,
        medidas: { peso: null, altura: null },
      },
      atendimentos: ats,
      atendimentoAtual: atual?.id ?? null,
      alertas,
      categoria: categoriaDe(prof),
    };
  }

  /**
   * Alertas do atendimento (regra 14), pela mesma leitura agregada do painel (uma consulta por fonte, sem ler resultado
   * a resultado): evolução médica do episódio, crítico sem ciência na janela do episódio, pareceres atrasados; mais as
   * pendências de assinatura e o sumário.
   */
  private async alertasDoAtendimento(
    c: ContextoDocs,
    paciente: number,
    at: AtendimentoPep,
    login: string,
    agora: Date,
  ) {
    const janela = inicioJanelaCritico(at.entrada, agora);
    const [comp, pend, sumarios] = await Promise.all([
      this.porta.completudePainel(c, [paciente], [at.id], new Date(`${janela}T00:00:00`)).catch(() => null),
      this.porta.pendencias(c, login).catch(() => []),
      this.porta.sumarios(c, at.id).catch(() => []),
    ]);
    const comCiencia = new Set((comp?.ciencias ?? []).map((x) => x.exame));
    const porExame = new Map<
      number,
      { elemento: string; numerico: number; minAbe: number | null; maxAbe: number | null }[]
    >();
    for (const v of comp?.valores ?? [])
      if (!comCiencia.has(v.exame) && (v.liberadoEm ?? '').slice(0, 10) >= janela)
        porExame.set(v.exame, [...(porExame.get(v.exame) ?? []), v]);
    const criticos = [...porExame.values()].filter((vs) => this.criticoDoResultado({ valores: vs })).length;
    const em = comp?.evolucoesMedicas.find((x) => x.atendimento === at.id)?.em;
    return alertasCompletude(
      {
        internado: at.tipo === 'internacao' && at.aberto,
        registros: em ? [{ em, cbo: '225', suspenso: false }] : [],
        assinaturasPendentes: pend.filter((d) => d.paciente === paciente).length,
        altaMedica: at.alta !== null && at.tipo === 'internacao',
        sumarioFinalizado: sumarios.some((s) => s.situacao === 'finalizado'),
        criticosSemCiencia: criticos,
        pareceresAtrasados: (comp?.pareceres ?? []).filter((f) =>
          parecerAtrasado(f.situacao, f.prazo ? new Date(f.prazo) : null, agora),
        ).length,
        entrada: at.entrada,
      },
      agora,
    );
  }

  // ── Linha do tempo ─────────────────────────────────────────────────────────────────────────────

  async linhaTempo(
    c: ContextoDocs,
    paciente: number,
    f: { de?: string | undefined; ate?: string | undefined; tipos?: string | undefined; pagina: number },
    prof: ProfissionalPep | null,
  ): Promise<LinhaTempo> {
    const { data: agora } = await this.agora(c);
    const ate = f.ate ?? agora.toISOString().slice(0, 10);
    const de = f.de ?? new Date(agora.getTime() - 365 * DIA).toISOString().slice(0, 10);
    if (de > ate)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Período inválido',
        'A data inicial é depois da final.',
      );
    const pedidos = f.tipos ? f.tipos.split(',') : [...TIPOS_EVENTO_LINHA];
    const tipos = new Set(pedidos.filter((t) => (TIPOS_EVENTO_LINHA as readonly string[]).includes(t)));
    const limite = Math.min(TETO_LINHA_TEMPO * 5, f.pagina * PAGINA_LINHA + 1);
    const lidos = await this.porta.eventos(c, paciente, { de, ate }, tipos, limite);
    const leitor = categoriaDe(prof);
    const todos: EventoLinhaTempo[] = lidos
      .filter((e) => tipos.has(e.tipo))
      .sort((a, b) => b.quando.localeCompare(a.quando))
      .map((e) => {
        const ev: EventoLinhaTempo = {
          chave: e.chave,
          tipo: e.tipo as TipoEventoLinha,
          quando: e.quando,
          titulo: e.titulo,
          detalhe: e.detalhe,
          profissional: e.profissional,
          categoria: categoriaDoCbo(e.cbo),
          situacao: e.situacao,
          suspenso: e.suspenso,
          sigilo: false,
          documento:
            e.documento &&
            (
              [
                'registro',
                'receita',
                'atestado',
                'pedido-exame',
                'exame-externo',
                'anexo',
                'tcle',
                'sumario-alta',
              ] as string[]
            ).includes(e.documento.tipo)
              ? { tipo: e.documento.tipo as TipoDocumentoAberto, id: e.documento.id }
              : null,
        };
        return comSigilo(ev, leitor, (x) => ({
          ...x,
          titulo: 'Atendimento',
          detalhe: TEXTO_SIGILO,
          documento: null,
        }));
      });
    const inicio = (f.pagina - 1) * PAGINA_LINHA;
    return {
      eventos: todos.slice(inicio, inicio + PAGINA_LINHA),
      pagina: f.pagina,
      temMais: todos.length > inicio + PAGINA_LINHA,
    };
  }

  // ── Documento aberto ───────────────────────────────────────────────────────────────────────────

  private async provaDe(c: ContextoDocs, tabela: string, id: number) {
    const d = await this.porta.documentoSghDaOrigem(c, tabela, id).catch(() => null);
    return d
      ? {
          prova: { hash: d.hash, nivel: d.nivel, assinadoEm: d.assinadoEm, qr: null, via: null },
          marca: d.comoSuporte ? 'Registrado em sessão de suporte técnico.' : null,
        }
      : { prova: null, marca: null };
  }

  private documentoHistorico(
    tipo: TipoDocumentoAberto,
    d: DocumentoHistoricoLido,
    prova: Awaited<ReturnType<ServicoDocumentos['provaDe']>>,
  ): DocumentoAberto {
    return {
      tipo,
      id: d.id,
      titulo: d.titulo,
      emitidoEm: d.emitidoEm,
      profissional: d.profissional,
      situacao: d.suspensoEm ? 'suspenso' : prova.prova?.assinadoEm ? 'assinado' : 'emitido',
      suspensao: d.suspensoEm ? { em: d.suspensoEm, justificativa: d.justificativaSuspensao } : null,
      paragrafos: paragrafosDoDocumento(d.rtf, d.xml),
      prova: prova.prova,
      pdf: tipo !== 'anexo',
      marcaSuporte: prova.marca,
    };
  }

  /**
   * Abre o documento (tipo, id) do paciente; 404 igual para inexistente e de outro paciente. Sigilo da categoria
   * (regra 15): o documento de autor de categoria sigilosa (psicologia) lido por outra categoria sai só com o título,
   * a data, o profissional e o aviso, sem o conteúdo nem a impressão. `'autor'`: a prévia de quem emitiu.
   */
  async abrir(
    c: ContextoDocs,
    paciente: number,
    tipo: TipoDocumentoAberto,
    id: number,
    leitor: ProfissionalPep | null | 'autor',
  ): Promise<DocumentoAberto> {
    const { doc, autor } = await this.abrirComAutor(c, paciente, tipo, id);
    if (leitor === 'autor' || podeVerConteudo(autor, categoriaDe(leitor))) return doc;
    return { ...doc, paragrafos: [TEXTO_SIGILO], pdf: false };
  }

  private async abrirComAutor(
    c: ContextoDocs,
    paciente: number,
    tipo: TipoDocumentoAberto,
    id: number,
  ): Promise<{ doc: DocumentoAberto; autor: CategoriaAssistencial | null }> {
    const nao = () => new ErroProblema('nao-encontrado', 404, 'Documento não encontrado');
    if (tipo === 'receita' || tipo === 'atestado' || tipo === 'sumario-alta') {
      const d = tipo === 'receita' ? await this.porta.lerReceita(c, id) : await this.porta.lerAtestado(c, id);
      if (!d || d.paciente !== paciente) throw nao();
      return {
        doc: this.documentoHistorico(
          tipo,
          d,
          await this.provaDe(c, tipo === 'receita' ? 'receita_medica' : 'documento_emitido', id),
        ),
        autor: categoriaDoCbo(d.cbo),
      };
    }
    if (tipo === 'exame-externo') {
      const d = await this.porta.lerExameExterno(c, id);
      if (!d || d.paciente !== paciente) throw nao();
      return {
        doc: this.documentoHistorico(tipo, d, await this.provaDe(c, 'exame_lancado_prontuario', id)),
        autor: categoriaDoCbo(d.cbo),
      };
    }
    if (tipo === 'anexo') {
      const a = (await this.porta.anexos(c, paciente)).find((x) => x.id === id);
      if (!a) throw nao();
      const p = await this.provaDe(c, 'anexo_prontuario', id);
      const doc: DocumentoAberto = {
        tipo,
        id,
        titulo: a.nome ?? 'Documento anexado',
        emitidoEm: a.em,
        profissional: a.profissional,
        situacao: a.suspenso ? 'suspenso' : 'emitido',
        suspensao: a.suspenso ? { em: null, justificativa: null } : null,
        paragrafos: [
          `Arquivo ${a.extensao ?? ''} de ${a.bytes ?? 0} bytes.`.trim(),
          a.tipo ? `Tipo: ${a.tipo}` : '',
        ].filter(Boolean),
        prova: p.prova,
        pdf: false,
        marcaSuporte: p.marca,
      };
      return { doc, autor: null };
    }
    if (tipo === 'pedido-exame') {
      const ps = (await this.porta.pedidos(c, paciente)).filter((x) => x.agrupamento === id || x.id === id);
      if (ps.length === 0) throw nao();
      const p = await this.provaDe(c, 'requisicao_exame', ps[0]!.agrupamento ?? id);
      const doc: DocumentoAberto = {
        tipo,
        id,
        titulo: 'Pedido de exames',
        emitidoEm: ps[0]!.solicitadoEm,
        profissional: ps[0]!.profissional,
        situacao: 'solicitado',
        suspensao: null,
        paragrafos: ps.map(
          (x) => `${x.nome}${x.urgente ? ' (urgente)' : ''}${x.indicacao ? ` - ${x.indicacao}` : ''}`,
        ),
        prova: p.prova,
        pdf: true,
        marcaSuporte: p.marca,
      };
      return { doc, autor: null };
    }
    // Documentos só do novo (TCLE, transferência, óbito) pelo documento do novo.
    const docs = await this.porta.documentosSgh(c, paciente);
    const d = docs.find((x) => x.id === id && tipoAbertoDaOrigem(x) === tipo);
    if (!d) throw nao();
    const autor = categoriaDe(await this.porta.profissional(c, d.usuario).catch(() => null));
    const doc: DocumentoAberto = {
      tipo,
      id,
      titulo: TITULO_DOCUMENTO_SGH[d.tipo] ?? 'Documento',
      emitidoEm: d.criadoEm,
      profissional: d.usuario,
      situacao: d.suspenso ? 'suspenso' : d.assinadoEm ? 'assinado' : 'pendente',
      suspensao: null,
      paragrafos: await this.paragrafosSgh(c, d),
      prova: { hash: d.hash, nivel: d.nivel, assinadoEm: d.assinadoEm, qr: null, via: null },
      pdf: true,
      marcaSuporte: d.comoSuporte ? 'Registrado em sessão de suporte técnico.' : null,
    };
    return { doc, autor };
  }

  private async paragrafosSgh(c: ContextoDocs, d: DocumentoProprioLido): Promise<string[]> {
    if (d.origemTabela === 'SGH_PEP_TCLE') {
      const t = (await this.porta.tcles(c, d.paciente)).find((x) => x.id === d.origemId);
      return t ? [`Procedimento: ${t.procedimento}`, `Situação: ${t.situacao}`] : [];
    }
    if (d.origemTabela === 'SGH_PEP_REL_TRANSF' && d.atendimento) {
      const t = (await this.porta.transferencias(c, d.atendimento)).find((x) => x.id === d.origemId);
      return t ? [`Destino: ${t.destino}`, `Registrado em ${t.em}`] : [];
    }
    if (d.origemTabela === 'fechamento_checagem_paciente') {
      // O conteúdo gravado no próprio documento (o mesmo que o hash resume), em parágrafos pelo domínio.
      const p = paragrafosDoRegistroTurno((d as DocumentoProprioLido & { registro?: unknown }).registro);
      if (p) return p;
      throw new ErroProblema('indisponivel', 409, 'O conteúdo do registro do turno não está gravado.');
    }
    if (d.origemTabela === 'SGH_PEP_OBITO') {
      const o = await this.porta.obito(c, d.paciente);
      return o
        ? [`Óbito em ${o.em}`, o.numero ? `Declaração nº ${o.numero}` : 'Número da declaração a informar']
        : [];
    }
    return [`${TITULO_DOCUMENTO_SGH[d.tipo] ?? 'Documento'} registrado em ${d.criadoEm ?? ''}.`];
  }

  // ── Alergias ───────────────────────────────────────────────────────────────────────────────────

  async alergias(
    c: ContextoDocs,
    paciente: number,
    prof: ProfissionalPep | null,
    acoes: { criar: AcaoLiberada; inativar: AcaoLiberada },
  ): Promise<AlergiasPaciente> {
    const [als, cat, sit, ats, docs, manifestacoes] = await Promise.all([
      this.porta.alergias(c, paciente),
      this.porta.catalogoAlergias(c),
      this.situacaoAlergias(c, paciente),
      this.atendimentos(c, paciente),
      this.porta.documentosSgh(c, paciente).catch(() => []),
      this.porta.manifestacoesAlergicas(c),
    ]);
    const doNovo = new Set(docs.filter((d) => d.origemTabela === 'alergia_paciente').map((d) => d.origemId));
    const atual = ats.find((a) => a.aberto);
    const registros =
      atual && prof ? await this.porta.registrosParaAlergia(c, atual.id, prof.cbos).catch(() => []) : [];
    const mapa = (a: (typeof als)[number]): AlergiaPep => ({
      id: a.id,
      agente: a.agente,
      agenteId: a.agenteId,
      tipo: a.tipo,
      principios: a.principios,
      observacao: a.observacao,
      reacao: a.reacao,
      gravidade: gravidadeDe(a.gravidade),
      origem: origemDe(a.origemInformacao),
      ativa: a.ativa,
      registradaEm: a.registradaEm,
      profissional: a.profissional,
      registro: a.registro,
      inativacao: a.ativa ? null : { em: a.inativadaEm, motivo: a.motivoInativacao, usuario: null },
      doNovo: doNovo.has(a.id),
    });
    return {
      paciente,
      situacao: sit.situacao,
      ativas: als.filter((a) => a.ativa).map(mapa),
      historico: als.filter((a) => !a.ativa).map(mapa),
      agentes: cat.agentes,
      principios: cat.principios,
      registros,
      manifestacoes,
      criar:
        acoes.criar.pode && registros.length === 0
          ? {
              pode: false,
              motivo: 'Faça antes o registro clínico do atendimento: a alergia é informada dentro dele.',
            }
          : acoes.criar,
      inativar: acoes.inativar,
    };
  }

  async montarAlergia(
    c: ContextoDocs,
    paciente: number,
    e: RegistrarAlergia,
    prof: ProfissionalPep,
    o: OpcoesGravacao,
  ) {
    this.exigirAcao(prof, 'alergia');
    let manifestacoes: number[];
    try {
      manifestacoes = manifestacoesDoPedido(e.nega, e.manifestacoes);
    } catch (erro) {
      if (!(erro instanceof RecusaHistoricoAlergia)) throw erro;
      throw new ErroProblema('entrada-invalida', 400, 'Manifestações inválidas', erro.message, {
        codigo: erro.codigo,
        campos: ['manifestacoes'],
      });
    }
    const ats = await this.atendimentos(c, paciente);
    const abertos = ats.filter((a) => a.aberto);
    let atendimento: number | null = null;
    for (const a of abertos) {
      const rs = await this.porta.registrosParaAlergia(c, a.id, prof.cbos);
      if (rs.some((r) => r.registro === e.registro)) {
        atendimento = a.id;
        break;
      }
    }
    if (atendimento === null)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Registro clínico inválido',
        'A alergia é ligada a um registro clínico seu, do atendimento aberto do paciente.',
        { codigo: 'registro-invalido', campos: ['registro'] },
      );
    const als = await this.porta.alergias(c, paciente);
    const cat = await this.porta.catalogoAlergias(c);
    const conf = conferirNovaAlergia(
      { nega: e.nega, agente: e.agente, gravidade: e.gravidade, origem: e.origem },
      als.map((a) => ({
        id: a.id,
        agenteId: a.agenteId,
        agente: a.agente,
        ativa: a.ativa,
        registradaEm: a.registradaEm,
      })),
      new Set(cat.agentes.map((a) => a.id)),
    );
    if (!conf.ok)
      throw new ErroProblema('recusa-de-negocio', 409, 'Alergia não registrada', conf.motivo ?? '', {
        codigo: conf.codigo ?? 'recusa-de-negocio',
      });
    const cbo = prof.cbo;
    const hashConteudo = await hashDaAlergia({
      paciente,
      registro: e.registro,
      nega: e.nega,
      agente: e.agente ?? null,
      principios: e.principios,
      reacao: e.reacao ?? null,
      gravidade: e.gravidade ?? null,
      origem: e.origem ?? null,
    });
    return {
      paciente,
      atendimento,
      cbo,
      registro: e.registro,
      nega: e.nega,
      ...(e.agente !== undefined && !e.nega ? { agente: e.agente } : {}),
      principios: e.nega ? [] : e.principios,
      ...(e.observacao ? { observacao: e.observacao } : {}),
      ...(e.reacao ? { reacao: e.reacao } : {}),
      ...(e.gravidade ? { gravidade: e.gravidade } : {}),
      ...(e.origem ? { origem: e.origem } : {}),
      ...(manifestacoes.length ? { manifestacoes } : {}),
      versao: e.versao,
      hashConteudo,
      ...(o.comoSuporte ? { comoSuporte: true } : {}),
    };
  }

  /** Linha do tempo e manifestações da alergia (03-PEP L100): nada é apagado, a retirada mostra o histórico. */
  historicoAlergia(c: ContextoDocs, paciente: number, alergia: number): Promise<HistoricoAlergia> {
    return this.porta.historicoAlergia(c, paciente, alergia);
  }

  async executar(c: ContextoDocs, operacao: string, entrada: unknown, ctx: ContextoOperacao) {
    return this.porta.executar(c, operacao, entrada, ctx);
  }

  // ── Lista de problemas ─────────────────────────────────────────────────────────────────────────

  async problemas(c: ContextoDocs, paciente: number): Promise<ProblemaPep[]> {
    const vs = await this.porta.problemas(c, paciente);
    return problemasVigentes(vs).map((p) => ({
      id: p.id,
      descricao: p.descricao,
      cid: p.cid,
      tipo: p.tipo,
      inicio: p.inicio,
      fim: p.fim,
      situacao: p.situacao,
      usuario: p.usuario,
      em: p.em,
      versoes: p.versoes,
    }));
  }

  async incluirProblema(c: ContextoGravacaoPep, paciente: number, g: GravarProblema): Promise<number> {
    if (g.atendimento) await this.exigirAtendimento(c, paciente, g.atendimento);
    return this.porta.gravarProblema(c, {
      paciente,
      atendimento: g.atendimento ?? null,
      descricao: g.descricao,
      cid: g.cid ?? null,
      idCid: null,
      tipo: g.tipo,
      inicio: g.inicio ?? null,
      fim: null,
      situacao: 'ativo',
      anterior: null,
    });
  }

  async mudarProblema(
    c: ContextoGravacaoPep,
    paciente: number,
    id: number,
    m: { situacao: 'ativo' | 'resolvido' | 'descartado'; fim?: string | undefined; versao: number },
  ): Promise<number> {
    const vigentes = await this.problemas(c, paciente);
    const p = vigentes.find((x) => x.id === id);
    if (!p) throw new ErroProblema('nao-encontrado', 404, 'Problema não encontrado');
    if (m.versao !== p.id)
      throw new ErroProblema('conflito-de-versao', 409, 'O problema mudou', 'Releia a lista de problemas.', {
        codigo: 'conflito-versao',
      });
    if (!mudancaValida(p.situacao, m.situacao))
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Mudança não permitida',
        'Esta mudança de situação não é permitida.',
        {
          codigo: 'mudanca-invalida',
        },
      );
    return this.porta.gravarProblema(c, {
      paciente,
      atendimento: null,
      descricao: p.descricao,
      cid: p.cid,
      idCid: null,
      tipo: p.tipo,
      inicio: p.inicio,
      fim: m.situacao === 'ativo' ? null : (m.fim ?? null),
      situacao: m.situacao,
      anterior: p.id,
    });
  }

  // ── Exames ─────────────────────────────────────────────────────────────────────────────────────

  private exameDe(x: {
    id: number;
    codigo: string;
    nome: string;
    ato: number;
    sexo: 'F' | 'M' | null;
    idadeMinima: number | null;
    idadeMaxima: number | null;
  }): ExameCatalogo {
    return {
      id: x.id,
      codigo: x.codigo,
      nome: x.nome,
      ato: x.ato,
      grupo: grupoDoAto(x.ato),
      sexo: x.sexo,
      idadeMinima: x.idadeMinima,
      idadeMaxima: x.idadeMaxima,
    };
  }

  async pedidos(
    c: ContextoDocs,
    paciente: number,
    termo: string | null,
    criar: AcaoLiberada,
  ): Promise<PedidosExame> {
    const [ps, cat, kits, ats] = await Promise.all([
      this.porta.pedidos(c, paciente),
      this.porta.catalogoExames(c, termo),
      this.porta.kits(c),
      this.atendimentos(c, paciente),
    ]);
    const pedidos: PedidoExame[] = ps.map((p) => ({
      pedido: p.agrupamento ?? p.id,
      exame: p.exame,
      nome: p.nome,
      grupo: grupoDoAto(p.ato),
      solicitadoEm: p.solicitadoEm ?? p.data,
      urgente: p.urgente,
      situacao: p.liberado ? 'liberado' : p.pendSadt === 'T' ? 'solicitado' : 'em-andamento',
      profissional: p.profissional,
      indicacao: p.indicacao,
    }));
    return {
      pedidos,
      catalogo: cat.filter((x) => x.ativo).map((x) => this.exameDe(x)),
      kits,
      atendimentos: ats,
      criar:
        criar.pode && !ats.some((a) => a.aberto)
          ? { pode: false, motivo: 'O paciente não tem atendimento aberto.' }
          : criar,
    };
  }

  async montarPedido(
    c: ContextoDocs,
    paciente: number,
    e: SolicitarExames,
    prof: ProfissionalPep,
    o: OpcoesGravacao,
  ): Promise<{ avisos: AvisoPedidoExame[]; entrada: Record<string, unknown> | null }> {
    this.exigirAcao(prof, 'pedido-exame');
    const retratos = await this.exigirAtendimento(c, paciente, e.atendimento);
    const kits = e.kit ? await this.porta.kits(c) : [];
    const kit = e.kit ? (kits.find((k) => k.id === e.kit) ?? null) : null;
    if (e.kit && !kit)
      throw new ErroProblema('entrada-invalida', 400, 'Kit não encontrado', '', { campos: ['kit'] });
    const itens = itensComKit(e.itens, kit);
    const cat = await this.porta.examesPorId(
      c,
      itens.map((i) => i.exame),
    );
    const mapa = new Map(cat.map((x) => [x.id, { ...this.exameDe(x), ativo: x.ativo }]));
    const [pac, anteriores, agora] = await Promise.all([
      this.exigirPaciente(c, paciente),
      this.porta.pedidos(c, paciente),
      this.agora(c),
    ]);
    const avisos = avisosDoPedido(
      itens,
      mapa,
      {
        sexo: pac.sexo === 'F' || pac.sexo === 'M' ? pac.sexo : null,
        idade: idadeEmAnos(pac.nascimento, agora.data),
      },
      anteriores.map((a) => ({
        exame: a.exame,
        em: `${(a.solicitadoEm ?? a.data ?? '1900-01-01').slice(0, 19)}Z`,
        suspenso: false,
      })),
      agora.data,
    );
    if (!podeGravarPedido(avisos, e.confirmarAvisos)) return { avisos, entrada: null };
    const dataHoraClinica = horaLocal(agora.local);
    // M50, etapa 4: no atendimento de teleconsulta, a marca da telemedicina vai nas informações complementares de cada
    // exame do documento (o campo de texto livre que o pedido impresso mostra) e no hash do conteúdo.
    const tele = await this.marcaTelemedicina(c, e.atendimento);
    const cab = cabecalhoDoAto(
      await this.porta.cabecalhoDocumento(
        c,
        retratos,
        prof.cbo,
        SITUACAO_DOC.solicitado,
        TIPO_ATO.pedidoExame,
      ),
      dataHoraClinica,
    );
    const documento = documentoPedidoExame(
      cab,
      '{{ORIGEM}}',
      itens.map((it, i) => {
        const ex = mapa.get(it.exame);
        return {
          controle: it.exame,
          codigoAlfa: ex?.codigo ?? null,
          descricao: ex?.nome ?? `Exame ${it.exame}`,
          material: null,
          seq: i + 1,
          ato: ex?.grupo === 'laboratorio' ? 'Laboratório' : ex?.grupo === 'imagem' ? 'Imagem' : 'Exame',
          previsaoColeta: null,
          urgente: it.urgente,
          informacoes: tele
            ? linhasComMarcaTelemedicina(it.indicacao ? [it.indicacao] : [], true)
                .filter(Boolean)
                .join(' - ')
            : (it.indicacao ?? null),
        };
      }),
    );
    const hashConteudo = await hashCanonico({
      paciente,
      atendimento: e.atendimento,
      itens,
      kit: e.kit ?? null,
      ...(tele ? { telemedicina: true } : {}),
    });
    return {
      avisos,
      entrada: {
        paciente,
        atendimento: e.atendimento,
        cbo: prof.cbo,
        retratos,
        dataHoraClinica,
        itens: itens.map((i) => ({
          exame: i.exame,
          urgente: i.urgente,
          ...(i.indicacao ? { indicacao: i.indicacao } : {}),
        })),
        ...(e.kit ? { kit: e.kit } : {}),
        documento,
        hashConteudo,
        ...(o.comoSuporte ? { comoSuporte: true } : {}),
      },
    };
  }

  // ── Resultados ─────────────────────────────────────────────────────────────────────────────────

  criticoDoResultado(r: {
    valores: readonly {
      elemento: string;
      numerico: number | null;
      minAbe: number | null;
      maxAbe: number | null;
    }[];
  }): boolean {
    return r.valores.some((v) => {
      if (v.numerico === null) return false;
      if (v.minAbe !== null && v.numerico < v.minAbe) return true;
      if (v.maxAbe !== null && v.numerico > v.maxAbe) return true;
      return ehCritico(v.elemento, v.numerico, LIMITES_CRITICOS_PADRAO);
    });
  }

  async resultados(
    c: ContextoDocs,
    paciente: number,
    acoes: { ciencia: AcaoLiberada; externo: AcaoLiberada },
  ): Promise<ResultadosPaciente> {
    const [rs, ciencias, externos] = await Promise.all([
      this.porta.resultados(c, paciente),
      this.porta.ciencias(c, paciente),
      this.porta.examesExternos(c, paciente).catch(() => []),
    ]);
    const cienciaDe = new Map(ciencias.map((x) => [x.exame, x]));
    const resultados: ResultadoExame[] = rs.map((r) => {
      const valores = r.valores.map((v) => {
        const numero = v.numerico ?? numeroDoTexto(v.alfa);
        const faixa =
          v.refIni !== null || v.refFin !== null
            ? { min: v.refIni, max: v.refFin }
            : faixaDoTexto(v.referencia);
        const critico =
          numero !== null &&
          ((v.minAbe !== null && numero < v.minAbe) ||
            (v.maxAbe !== null && numero > v.maxAbe) ||
            ehCritico(v.elemento, numero, LIMITES_CRITICOS_PADRAO));
        return {
          elemento: v.elemento,
          valor: v.numerico !== null ? String(v.numerico).replace('.', ',') : (v.alfa ?? ''),
          numero,
          unidade: v.unidade,
          referencia: v.referencia,
          foraDaFaixa: foraDaFaixa(numero, faixa),
          critico,
        };
      });
      const ci = cienciaDe.get(r.exame);
      return {
        exame: r.exame,
        nome: r.nome,
        liberadoEm: r.liberadoEm,
        origem: 'interno' as const,
        valores,
        texto: r.texto
          ? r.texto.includes('{\\rtf')
            ? paragrafosDoDocumento(r.texto, null)
            : r.texto.split(/\r?\n/)
          : [],
        critico: valores.some((v) => v.critico),
        ciencia: ci ? { usuario: ci.usuario, em: ci.em, conduta: ci.conduta } : null,
      };
    });
    for (const x of externos)
      resultados.push({
        exame: -x.id,
        nome: x.nome,
        liberadoEm: x.em,
        origem: 'externo',
        valores: [],
        texto: x.elementos,
        critico: false,
        ciencia: null,
      });
    const series = tendencias(
      resultados.flatMap((r) =>
        r.valores.map((v) => ({
          elemento: v.elemento,
          em: r.liberadoEm ?? '',
          numero: v.numero,
          unidade: v.unidade,
        })),
      ),
    );
    return {
      resultados,
      tendencias: series,
      pendentesCiencia: resultados.filter((r) => r.critico && !r.ciencia).length,
      ciencia: acoes.ciencia,
      externo: acoes.externo,
    };
  }

  async darCiencia(
    c: ContextoGravacaoPep,
    paciente: number,
    exame: number,
    conduta: string,
    escalonarPara: string | null,
  ): Promise<number> {
    const r = (await this.porta.resultados(c, paciente)).find((x) => x.exame === exame);
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Resultado não encontrado');
    if (!this.criticoDoResultado(r))
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Sem valor crítico',
        'A ciência registrada aqui é a de valor crítico.',
        {
          codigo: 'sem-critico',
        },
      );
    const elemento = r.valores.find((v) => this.criticoDoResultado({ valores: [v] }))?.elemento ?? null;
    return this.porta.registrarCiencia(c, {
      paciente,
      exame,
      chave: chaveDoExame(r.chave),
      resultado: null,
      elemento,
      conduta,
      escalonadoPara: escalonarPara,
    });
  }

  async montarExameExterno(
    c: ContextoDocs,
    paciente: number,
    e: ExameExterno,
    prof: ProfissionalPep,
    o: OpcoesGravacao,
  ) {
    const ats = await this.atendimentos(c, paciente);
    const atendimento = e.atendimento ?? ats.find((a) => a.aberto)?.id ?? ats[0]?.id;
    if (!atendimento)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Sem atendimento',
        'O paciente não tem atendimento para o lançamento.',
        {
          codigo: 'sem-atendimento',
        },
      );
    const retratos = await this.exigirAtendimento(c, paciente, atendimento);
    const agora = await this.agora(c);
    const dataHoraClinica = horaLocal(agora.local);
    const linhas = [
      ...(e.metodo ? [`Método: ${e.metodo}`] : []),
      ...e.itens.map(
        (i) =>
          `${i.elemento}: ${i.resultado}${i.unidade ? ` ${i.unidade}` : ''}${i.faixa ? ` (${i.faixa})` : ''}`,
      ),
      ...(e.laudo ? ['', e.laudo] : []),
    ];
    const rtf = rtfDoCampo(paragrafosDoTexto(linhas.join('\n') || e.nomeExame));
    const itens = e.itens.map((i) => ({ elemento: i.elemento, tipo: i.tipo }));
    const cab = cabecalhoDoAto(
      await this.porta.cabecalhoDocumento(
        c,
        retratos,
        prof.cbo,
        SITUACAO_DOC.lancado,
        TIPO_ATO.resultadoLancado,
      ),
      dataHoraClinica,
    );
    return {
      paciente,
      atendimento,
      cbo: prof.cbo,
      retratos,
      dataHoraClinica,
      realizadoEm: e.realizadoEm,
      nomeExame: e.nomeExame,
      ...(e.metodo ? { metodo: e.metodo } : {}),
      rtf,
      itens,
      documento: documentoExameExterno(cab, e.realizadoEm, e.critico, rtf, itens),
      hashConteudo: await hashCanonico({ paciente, atendimento, ...e }),
      ...(o.comoSuporte ? { comoSuporte: true } : {}),
    };
  }

  // ── Receitas e atestados ───────────────────────────────────────────────────────────────────────

  async documentos(
    c: ContextoDocs,
    paciente: number,
    familia: 'receita' | 'atestado',
    acoes: { emitir: AcaoLiberada; suspender: AcaoLiberada },
  ): Promise<DocumentosPaciente> {
    const [ds, ats, sgh, fichas] = await Promise.all([
      this.porta.documentos(c, paciente, familia),
      this.atendimentos(c, paciente),
      this.porta.documentosSgh(c, paciente).catch(() => []),
      familia === 'atestado' ? this.modelosAtestado(c) : Promise.resolve([]),
    ]);
    const tabela = familia === 'receita' ? 'receita_medica' : 'documento_emitido';
    const doNovo = new Map(sgh.filter((d) => d.origemTabela === tabela).map((d) => [d.origemId, d]));
    const documentos: DocumentoResumo[] = ds.map((d) => {
      const n = doNovo.get(d.id);
      return {
        id: d.id,
        tipo:
          n?.tipo ??
          (familia === 'receita' ? (d.tpPadrao === 4 ? 'receita-controlada' : 'receita') : 'atestado'),
        titulo: d.titulo,
        emitidoEm: d.em,
        profissional: d.profissional,
        atendimento: d.atendimento,
        situacao: d.suspenso ? 'suspenso' : 'emitido',
        doNovo: n !== undefined,
        assinado: n?.assinadoEm !== null && n?.assinadoEm !== undefined,
        corrigeDe: d.corrige,
      };
    });
    return {
      documentos,
      atendimentos: ats,
      emitir: acoes.emitir,
      suspender: acoes.suspender,
      modelos: fichas,
    };
  }

  /** Modelos de impressão do atestado em uso (as fichas com campo de texto, do tipo pelo nome). */
  async modelosAtestado(c: ContextoDocs): Promise<{ codigo: number; nome: string; tipo: TipoAtestado }[]> {
    const fs = await this.porta.fichas(c);
    const ehAtestado = (n: string) => /ATESTAD|DECLARA|REQUERIMENTO|COMPARECIMENTO/i.test(n);
    return fs
      .filter((f) => ehAtestado(f.nome) && f.componentes.length > 0)
      .slice(0, 60)
      .map((f) => ({ codigo: f.codigo, nome: f.nome, tipo: tipoDoModelo(f.nome) }));
  }

  private async retroativo(c: ContextoDocs, dataHora: string | undefined) {
    const agora = await this.agora(c);
    const atual = horaLocal(agora.local);
    if (!dataHora) return { dataHoraClinica: atual };
    if (dataHora > atual)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Horário no futuro',
        'O horário do documento não pode ser no futuro.',
        {
          campos: ['dataHora'],
        },
      );
    return { dataHoraClinica: dataHora };
  }

  async montarReceita(
    c: ContextoDocs,
    paciente: number,
    e: EmitirReceita,
    prof: ProfissionalPep,
    o: OpcoesGravacao,
  ) {
    this.exigirAcao(prof, e.tipo === 'controle-especial' ? 'receita-controlada' : 'receita');
    const problemas = conferirReceita(e.itens, e.orientacoes);
    if (problemas.length > 0)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Receita incompleta',
        problemas.map((p) => p.motivo).join(' '),
        {
          codigo: 'entrada-invalida',
          campos: problemas.map((p) => p.campo),
        },
      );
    const retratos = await this.exigirAtendimento(c, paciente, e.atendimento);
    const { dataHoraClinica } = await this.retroativo(c, e.dataHora);
    // M50, etapa 4: a marca da telemedicina no fim do texto (no RTF e no documento) quando o atendimento foi teleconsulta.
    const tele = await this.marcaTelemedicina(c, e.atendimento);
    const linhasReceita = linhasComMarcaTelemedicina(linhasDaReceita(e.itens, e.orientacoes), tele);
    const rtf = tele
      ? rtfDoCampo(paragrafosDoTexto(linhasReceita.join('\n')))
      : rtfDaReceita(e.itens, e.orientacoes);
    const cab = cabecalhoDoAto(
      await this.porta.cabecalhoDocumento(c, retratos, prof.cbo, SITUACAO_DOC.lancado, TIPO_ATO.receita),
      dataHoraClinica,
    );
    return {
      familia: 'receita' as const,
      paciente,
      atendimento: e.atendimento,
      cbo: prof.cbo,
      retratos,
      dataHoraClinica,
      tipo: RECEITA_SGH[e.tipo],
      tpPadrao: TIPO_PADRAO_LEGADO[e.tipo],
      rtf,
      documento: documentoReceita(cab, linhasReceita.join('\n'), rtf),
      hashConteudo: await hashCanonico({
        paciente,
        atendimento: e.atendimento,
        tipo: e.tipo,
        itens: e.itens,
        orientacoes: e.orientacoes ?? null,
        dataHoraClinica,
        ...(tele ? { modalidade: 'telemedicina' } : {}),
      }),
      ...(o.comoSuporte ? { comoSuporte: true } : {}),
    };
  }

  async montarAtestado(
    c: ContextoDocs,
    paciente: number,
    e: EmitirAtestado,
    prof: ProfissionalPep,
    o: OpcoesGravacao,
  ) {
    this.exigirAcao(prof, acaoDoAtestado(e.tipo));
    const problemas = conferirAtestado(e);
    if (problemas.length > 0)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Documento incompleto',
        problemas.map((p) => p.motivo).join(' '),
        {
          codigo: problemas[0]!.codigo,
          campos: problemas.map((p) => p.campo),
        },
      );
    const retratos = await this.exigirAtendimento(c, paciente, e.atendimento);
    const fichas = await this.porta.fichas(c);
    const ficha = fichas.find((f) => f.codigo === e.modelo);
    if (!ficha)
      throw new ErroProblema('entrada-invalida', 400, 'Modelo não encontrado', '', { campos: ['modelo'] });
    if (e.corrige) {
      const orig = await this.porta.lerAtestado(c, e.corrige);
      if (!orig || orig.paciente !== paciente)
        throw new ErroProblema('nao-encontrado', 404, 'Documento corrigido não encontrado');
      if (!orig.suspensoEm)
        throw new ErroProblema(
          'recusa-de-negocio',
          409,
          'Original não suspenso',
          'Suspenda o documento original antes de emitir a correção.',
          {
            codigo: 'original-nao-suspenso',
          },
        );
    }
    const { dataHoraClinica } = await this.retroativo(c, e.dataHora);
    // M50, etapa 4: a marca da telemedicina no fim do texto quando o atendimento foi teleconsulta.
    const teleAtestado = await this.marcaTelemedicina(c, e.atendimento);
    const texto = linhasComMarcaTelemedicina([textoDoAtestado(e)], teleAtestado).join('\n');
    const conteudoXml = xmlDoAtestado({ codigo: ficha.codigo, nome: ficha.nome }, ficha.componentes, texto);
    const cab = cabecalhoDoAto(
      await this.porta.cabecalhoDocumento(c, retratos, prof.cbo, SITUACAO_DOC.lancado, TIPO_ATO.atestado),
      dataHoraClinica,
    );
    return {
      familia: 'atestado' as const,
      paciente,
      atendimento: e.atendimento,
      cbo: prof.cbo,
      retratos,
      dataHoraClinica,
      tipo: e.tipo,
      modeloNome: ficha.nome.slice(0, 50),
      conteudoXml,
      ...(e.cid ? { cid: e.cid } : {}),
      ...(e.autorizacaoCid ? { autorizacaoCid: e.autorizacaoCid } : {}),
      ...(e.corrige ? { corrige: e.corrige } : {}),
      ...(e.tipo === 'atestado' && e.diasAfastamento !== undefined
        ? { diasAfastamento: e.diasAfastamento }
        : {}),
      documento: documentoAtestado(cab, texto, conteudoXml),
      hashConteudo: await hashCanonico({
        paciente,
        atendimento: e.atendimento,
        tipo: e.tipo,
        modelo: e.modelo,
        texto,
        dataHoraClinica,
      }),
      ...(o.comoSuporte ? { comoSuporte: true } : {}),
    };
  }

  async montarSuspensao(
    c: ContextoDocs,
    paciente: number,
    familia: 'receita' | 'atestado',
    origem: number,
    justificativa: string,
    prof: ProfissionalPep,
  ) {
    const d =
      familia === 'receita'
        ? await this.porta.lerReceita(c, origem)
        : await this.porta.lerAtestado(c, origem);
    if (!d || d.paciente !== paciente)
      throw new ErroProblema('nao-encontrado', 404, 'Documento não encontrado');
    if (d.suspensoEm)
      throw new ErroProblema('recusa-de-negocio', 409, 'Já suspenso', 'O documento já foi suspenso.', {
        codigo: 'ja-suspenso',
      });
    if (!d.retratos)
      throw new ErroProblema('recusa-de-negocio', 409, 'Documento sem atendimento', '', {
        codigo: 'sem-retratos',
      });
    const agora = await this.agora(c);
    const evento = horaLocal(agora.local);
    const cab = await this.porta.cabecalhoDocumento(
      c,
      d.retratos,
      prof.cbo,
      SITUACAO_DOC.suspenso,
      familia === 'receita' ? TIPO_ATO.receita : TIPO_ATO.atestado,
    );
    const cabAto = cabecalhoDoAto(cab, d.emitidoEm ? horaLocal(d.emitidoEm) : evento, {
      profissional: cab.profissional,
      justificativa,
      em: evento,
      gravadoEm: evento,
    });
    const texto = paragrafosDoDocumento(d.rtf, d.xml).join('\n') || d.titulo;
    return {
      familia,
      paciente,
      origem,
      cbo: prof.cbo,
      justificativa,
      documento:
        familia === 'receita'
          ? documentoReceita(cabAto, texto, d.rtf ?? rtfDoCampo(paragrafosDoTexto(texto)))
          : documentoAtestado(cabAto, texto, d.xml ?? '<atestado/>'),
    };
  }

  // ── TCLE ───────────────────────────────────────────────────────────────────────────────────────

  async tcles(c: ContextoDocs, paciente: number, emitir: AcaoLiberada): Promise<TclesPaciente> {
    const [ts, tipos, ats] = await Promise.all([
      this.porta.tcles(c, paciente),
      this.porta.tiposTermo(c),
      this.atendimentos(c, paciente),
    ]);
    const substituidos = new Set(ts.map((t) => t.anterior).filter((x): x is number => x !== null));
    const nomeTipo = new Map(tipos.map((t) => [t.id, t.nome]));
    const atual = ats.find((a) => a.aberto);
    const herdado = atual ? await this.porta.tcleHerdado(c, atual.id).catch(() => null) : null;
    return {
      termos: ts
        .filter((t) => !substituidos.has(t.id))
        .map((t) => ({
          id: t.id,
          procedimento: t.procedimento,
          tipo: t.tipo !== null ? (nomeTipo.get(t.tipo) ?? null) : null,
          situacao: t.situacao,
          em: t.em,
          usuario: t.usuario,
          documento: t.documento,
          motivo: t.motivo,
        }))
        .reverse(),
      tipos,
      atendimentos: ats,
      herdado: atual
        ? { valor: herdado, legenda: 'Valor herdado do atendimento, a confirmar com o paciente.' }
        : null,
      emitir,
    };
  }

  async emitirTcle(
    c: ContextoGravacaoPep,
    paciente: number,
    e: EmitirTcle,
    prof: ProfissionalPep,
    comoSuporte: boolean,
  ) {
    this.exigirAcao(prof, 'tcle');
    await this.exigirAtendimento(c, paciente, e.atendimento);
    return this.porta.emitirTcle(c, {
      paciente,
      atendimento: e.atendimento,
      tipo: e.tipo ?? null,
      procedimento: e.procedimento,
      texto: e.texto ?? null,
      cbo: prof.cbo,
      hashConteudo: await hashCanonico({
        paciente,
        atendimento: e.atendimento,
        procedimento: e.procedimento,
        texto: e.texto,
      }),
      ...(comoSuporte ? { comoSuporte: true } : {}),
    });
  }

  // ── Alta, transferência e óbito ────────────────────────────────────────────────────────────────

  async alta(
    c: ContextoDocs,
    paciente: number,
    atendimentoPedido: number | null,
    acoes: { finalizar: AcaoLiberada; obito: AcaoLiberada },
    /** F3.3 (L124): as seções do atendimento com a janela de cada uma; nulo (sem banco próprio): o episódio inteiro. */
    secoesComJanela: ((atendimento: number) => Promise<readonly SecaoComJanela[]>) | null = null,
  ): Promise<AltaPaciente> {
    const ats = await this.atendimentos(c, paciente);
    const at =
      (atendimentoPedido !== null ? ats.find((a) => a.id === atendimentoPedido) : null) ??
      ats.find((a) => a.aberto && a.tipo === 'internacao') ??
      ats.find((a) => a.tipo === 'internacao') ??
      ats[0] ??
      null;
    if (!at)
      return {
        atendimento: null,
        atendimentos: ats,
        sumario: montarSumario({
          motivoInternacao: null,
          diagnosticos: [],
          procedimentos: [],
          alergias: [],
          medicamentos: [],
          exames: [],
        }),
        versoes: [],
        finalizado: false,
        transferencias: [],
        obito: null,
        finalizar: { pode: false, motivo: 'O paciente não tem atendimento.' },
        obitoAcao: { pode: false, motivo: 'O paciente não tem atendimento.' },
        cancelarObitoAcao: { pode: false, motivo: 'O paciente não tem atendimento.' },
      };
    const [sumarios, transf, obito, problemas, alergias, episodio0, janelas] = await Promise.all([
      this.porta.sumarios(c, at.id),
      this.porta.transferencias(c, at.id),
      this.porta.obito(c, paciente),
      this.problemas(c, paciente),
      this.porta.alergias(c, paciente),
      this.porta
        .episodio(c, at.id)
        .catch(() => ({ motivoInternacao: null, procedimentos: [], exames: [] }) as EpisodioLido),
      secoesComJanela ? secoesComJanela(at.id) : Promise.resolve(null),
    ]);
    // A janela de cada seção (atendimento inteiro, últimas horas, último registro) recorta o episódio (regra do domínio).
    const episodio =
      janelas && episodio0.datados
        ? { ...episodio0, ...episodioNasJanelas(episodio0.datados, janelas) }
        : episodio0;
    const ultima = sumarios[sumarios.length - 1];
    let sumario: SumarioAltaEstruturado | null = null;
    if (ultima?.conteudo) {
      try {
        const p = esquemaSumarioAlta.safeParse(JSON.parse(ultima.conteudo));
        if (p.success) sumario = p.data;
      } catch {
        sumario = null;
      }
    }
    // Regra 13: montado do episódio (motivo da internação, cirurgias e exames DO atendimento, diagnósticos e alergias
    // ativos); os medicamentos na alta vêm da prescrição (M24) e ficam para o médico completar até lá (D-SUM-1).
    sumario ??= montarSumario({
      motivoInternacao: episodio.motivoInternacao,
      diagnosticos: problemas
        .filter((p) => p.situacao === 'ativo' && p.tipo === 'diagnostico')
        .map((p) => ({ cid: p.cid, descricao: p.descricao })),
      procedimentos: [...episodio.procedimentos],
      alergias: alergias.filter((a) => a.ativa).map((a) => a.agente),
      medicamentos: [],
      exames: [...episodio.exames].slice(0, 10),
    });
    const finalizado = sumarios.some((s) => s.situacao === 'finalizado');
    return {
      atendimento: at,
      atendimentos: ats,
      sumario,
      versoes: sumarios.map((s) => ({
        versao: s.versao,
        situacao: s.situacao,
        em: s.em,
        usuario: s.usuario,
        documento: s.documento,
      })),
      finalizado,
      transferencias: transf,
      obito: obito ? { id: obito.id, em: obito.em, numero: obito.numero, documento: obito.documento } : null,
      finalizar: finalizado
        ? { pode: false, motivo: 'O sumário de alta deste atendimento já foi finalizado.' }
        : acoes.finalizar,
      obitoAcao: obito ? { pode: false, motivo: 'O óbito do paciente já foi registrado.' } : acoes.obito,
      cancelarObitoAcao: obito
        ? acoes.obito
        : { pode: false, motivo: 'O paciente não tem declaração de óbito vigente.' },
    };
  }

  async salvarRascunhoSumario(c: ContextoGravacaoPep, paciente: number, s: SalvarSumario) {
    await this.exigirAtendimento(c, paciente, s.atendimento);
    const vs = await this.porta.sumarios(c, s.atendimento);
    if (vs.some((v) => v.situacao === 'finalizado'))
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Sumário finalizado',
        'O sumário deste atendimento já foi finalizado.',
        {
          codigo: 'ja-finalizado',
        },
      );
    const atual = vs.length ? vs[vs.length - 1]!.versao : 0;
    if (s.versao !== atual)
      throw new ErroProblema(
        'conflito-de-versao',
        409,
        'O sumário mudou',
        'Outra versão foi salva. Releia o sumário.',
        {
          codigo: 'conflito-versao',
        },
      );
    const conteudo = JSON.stringify(s.sumario);
    return this.porta.salvarRascunhoSumario(c, {
      paciente,
      atendimento: s.atendimento,
      versao: atual + 1,
      conteudo,
      hashConteudo: await hashCanonico({ atendimento: s.atendimento, versao: atual + 1, sumario: s.sumario }),
    });
  }

  async montarFinalizacao(
    c: ContextoDocs,
    paciente: number,
    s: SalvarSumario,
    prof: ProfissionalPep,
    login: string,
    o: OpcoesGravacao,
    /** F3.3 (L124): as seções que valem para o atendimento conferido; nulo (sem banco próprio): o conjunto padrão. */
    resolverSecoes: ((atendimento: number) => Promise<readonly SecaoVigente[]>) | null,
  ) {
    this.exigirAcao(prof, 'sumario-alta');
    const retratos = await this.exigirAtendimento(c, paciente, s.atendimento);
    const secoes = resolverSecoes ? await resolverSecoes(s.atendimento) : SECOES_PADRAO;
    const sumario = sumarioNasSecoes(s.sumario, secoes);
    const pend = pendenciasDoSumario(sumario, secoes);
    if (pend.length > 0)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Sumário incompleto',
        pend.map((p) => p.motivo).join(' '),
        {
          codigo: 'sumario-incompleto',
          campos: pend.map((p) => p.campo),
        },
      );
    const vs = await this.porta.sumarios(c, s.atendimento);
    if (vs.some((v) => v.situacao === 'finalizado'))
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Sumário finalizado',
        'O sumário deste atendimento já foi finalizado.',
        {
          codigo: 'ja-finalizado',
        },
      );
    const atual = vs.length ? vs[vs.length - 1]!.versao : 0;
    if (s.versao !== atual)
      throw new ErroProblema(
        'conflito-de-versao',
        409,
        'O sumário mudou',
        'Outra versão foi salva. Releia o sumário.',
        {
          codigo: 'conflito-versao',
        },
      );
    const fichas = await this.porta.fichas(c);
    const ficha =
      fichas.find((f) => /RESUMO DE ALTA/i.test(f.nome)) ?? fichas.find((f) => /ALTA/i.test(f.nome));
    if (!ficha)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Modelo de impressão ausente',
        'O modelo de impressão do resumo de alta não está cadastrado.',
        {
          codigo: 'sem-modelo',
        },
      );
    const agora = await this.agora(c);
    const dataHoraClinica = horaLocal(agora.local);
    const texto = textoDoSumario(sumario, secoes);
    const conteudoXml = xmlDoAtestado({ codigo: ficha.codigo, nome: ficha.nome }, ficha.componentes, texto);
    const cab = cabecalhoDoAto(
      await this.porta.cabecalhoDocumento(c, retratos, prof.cbo, SITUACAO_DOC.lancado, TIPO_ATO.atestado),
      dataHoraClinica,
    );
    const versao = atual + 1;
    return {
      paciente,
      atendimento: s.atendimento,
      cbo: prof.cbo,
      retratos,
      dataHoraClinica,
      modeloNome: ficha.nome.slice(0, 50),
      conteudoXml,
      documento: documentoAtestado(cab, texto, conteudoXml),
      hashConteudo: await hashCanonico({ atendimento: s.atendimento, versao, sumario }),
      versao,
      sumario: JSON.stringify(sumario),
      // F3.3 (L124): o sumário por seção, na ordem e com o título do cadastro, gravado linha a linha.
      linhas: linhasDoSumario(sumario, secoes),
      fhir: fhirDoSumario({
        id: `${c.hospital}-${s.atendimento}-${versao}`,
        paciente,
        atendimento: s.atendimento,
        autor: login,
        data: `${dataHoraClinica}:00-03:00`,
        sumario,
      }),
      perfilFhir: PERFIL_FHIR_SUMARIO,
      ...(o.comoSuporte ? { comoSuporte: true } : {}),
    };
  }

  async transferencia(
    c: ContextoGravacaoPep,
    paciente: number,
    t: RelatorioTransferencia,
    prof: ProfissionalPep,
    comoSuporte: boolean,
  ) {
    this.exigirAcao(prof, 'relatorio-transferencia');
    await this.exigirAtendimento(c, paciente, t.atendimento);
    return this.porta.registrarTransferencia(c, {
      paciente,
      atendimento: t.atendimento,
      destino: t.destino,
      motivo: t.motivo,
      conteudo: t.resumo,
      cbo: prof.cbo,
      hashConteudo: await hashCanonico({ paciente, ...t }),
      ...(comoSuporte ? { comoSuporte: true } : {}),
    });
  }

  /**
   * Cancela a declaração de óbito vigente, com motivo (03-PEP L126): a mesma ação clínica de quem emite; aqui só o motivo
   * é conferido, e a porta recusa (403) quem não emitiu a declaração, salvo com a permissão do responsável técnico ou
   * diretor clínico (`podeCancelarDeOutro`, 04-INT L74).
   */
  async cancelarObito(
    c: ContextoGravacaoPep,
    paciente: number,
    o: CancelamentoObito,
    prof: ProfissionalPep,
    podeCancelarDeOutro = false,
  ) {
    this.exigirAcao(prof, 'declaracao-obito');
    const v = validarCancelamentoObito('emitida', o.motivo);
    if (!v.ok)
      throw new ErroProblema('entrada-invalida', 400, 'Motivo do cancelamento', v.mensagem, {
        campos: ['motivo'],
      });
    return this.porta.cancelarObito(c, { paciente, motivo: v.motivo, cbo: prof.cbo, podeCancelarDeOutro });
  }

  async obito(
    c: ContextoGravacaoPep,
    paciente: number,
    o: DeclaracaoObito,
    prof: ProfissionalPep,
    comoSuporte: boolean,
  ) {
    this.exigirAcao(prof, 'declaracao-obito');
    await this.exigirAtendimento(c, paciente, o.atendimento);
    const agora = await this.agora(c);
    if (o.dataHora > horaLocal(agora.local))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Horário no futuro',
        'A data do óbito não pode ser no futuro.',
        {
          campos: ['dataHora'],
        },
      );
    const causas = [o.causas.a, o.causas.b, o.causas.c, o.causas.d, o.causas.parteII]
      .filter(Boolean)
      .join(' | ');
    let causasLinhas: LinhaCausaObito[];
    try {
      causasLinhas = linhasDaCausa(o.causas);
    } catch (x) {
      throw new ErroProblema('entrada-invalida', 400, 'Causas do óbito', (x as Error).message, {
        campos: ['causas'],
      });
    }
    return this.porta.registrarObito(c, {
      paciente,
      atendimento: o.atendimento,
      dataHora: new Date(`${o.dataHora}:00`),
      numero: o.numero ?? null,
      causas,
      causasLinhas,
      cbo: prof.cbo,
      hashConteudo: await hashCanonico({
        paciente,
        atendimento: o.atendimento,
        dataHora: o.dataHora,
        numero: o.numero ?? null,
        causas: o.causas,
      }),
      ...(comoSuporte ? { comoSuporte: true } : {}),
    });
  }

  // ── Anexos e tempos ────────────────────────────────────────────────────────────────────────────

  async anexos(c: ContextoDocs, paciente: number, criar: AcaoLiberada): Promise<AnexosPaciente> {
    const [as, tipos, ats] = await Promise.all([
      this.porta.anexos(c, paciente),
      this.porta.tiposAnexo(c),
      this.atendimentos(c, paciente),
    ]);
    return { anexos: as, tipos, atendimentos: ats, criar };
  }

  async montarAnexo(
    c: ContextoDocs,
    paciente: number,
    a: AnexarDocumento,
    prof: ProfissionalPep,
    estacao: string,
    o: OpcoesGravacao,
  ) {
    this.exigirAcao(prof, 'anexo');
    if (a.extensao !== 'pdf')
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Formato não aceito',
        'Anexe o documento em PDF (o prontuário guarda os anexos em PDF).',
        { codigo: 'arquivo-invalido', campos: ['extensao'] },
      );
    const bytes = Buffer.from(a.conteudo, 'base64');
    if (bytes.length < 8 || bytes.subarray(0, 5).toString('latin1') !== '%PDF-')
      throw new ErroProblema('entrada-invalida', 400, 'Arquivo inválido', 'O arquivo não é um PDF.', {
        codigo: 'arquivo-invalido',
        campos: ['conteudo'],
      });
    const retratos = await this.exigirAtendimento(c, paciente, a.atendimento);
    const agora = await this.agora(c);
    return {
      paciente,
      atendimento: a.atendimento,
      cbo: prof.cbo,
      retratos,
      dataHoraClinica: horaLocal(agora.local),
      nome: a.nome,
      ...(a.tipo ? { tipoAnexo: a.tipo } : {}),
      ...(a.referencia ? { referencia: a.referencia } : {}),
      estacao: (estacao || 'navegador').slice(0, 100).padEnd(2, '-'),
      conteudo: a.conteudo,
      hashConteudo: createHash('sha256').update(bytes).digest('hex'),
      ...(o.comoSuporte ? { comoSuporte: true } : {}),
    };
  }

  async tempos(c: ContextoDocs, paciente: number): Promise<TempoEvento[]> {
    return this.porta.tempos(c, paciente);
  }

  // ── Parecer ────────────────────────────────────────────────────────────────────────────────────

  async fila(
    c: ContextoDocs,
    f: { especialidade?: number | undefined; categoria?: string | undefined; situacao?: string | undefined },
    acoes: { criar: AcaoLiberada; responder: AcaoLiberada },
  ): Promise<FilaPareceres> {
    const [itens, esp, hist, { data: agora }] = await Promise.all([
      this.porta.fila(c, {
        ...(f.especialidade ? { especialidade: f.especialidade } : {}),
        ...(f.categoria ? { categoria: f.categoria } : {}),
        ...(f.situacao ? { situacao: f.situacao } : {}),
      }),
      this.porta.especialidades(c),
      this.porta.historicoPareceres(c, null).catch(() => ({ pedidos: 0, respostas: 0, encaminhamentos: 0 })),
      this.agora(c),
    ]);
    const nomes = await this.porta.nomes(c, [...new Set(itens.map((i) => i.paciente))]);
    const nomeEsp = new Map(esp.map((e) => [e.id, e.nome]));
    const lista = itens.map((i) => ({
      id: i.id,
      paciente: i.paciente,
      nome: nomes.get(i.paciente) ?? 'Paciente',
      leito: null,
      especialidade: i.especialidade !== null ? (nomeEsp.get(i.especialidade) ?? null) : null,
      categoria: (i.categoria as CategoriaAssistencial | null) ?? null,
      prioridade: i.prioridade,
      prazo: i.prazo,
      atrasado: parecerAtrasado(i.situacao, i.prazo ? new Date(i.prazo) : null, agora),
      situacao: i.situacao,
      solicitante: i.solicitante,
      pedidoEm: i.criadoEm,
      pedido: i.pedido,
      resposta: i.resposta,
      origem: i.origem,
    }));
    return {
      itens: ordenarFila(lista),
      especialidades: esp,
      historico: hist,
      criar: acoes.criar,
      responder: acoes.responder,
    };
  }

  // ── Assinaturas ────────────────────────────────────────────────────────────────────────────────

  async pendencias(c: ContextoDocs, login: string): Promise<PendenciasAssinatura> {
    const [ds, sup] = await Promise.all([
      this.porta.pendencias(c, login),
      this.porta.coassinaturas(c, login).catch(() => []),
    ]);
    const nomes = await this.porta.nomes(c, [
      ...new Set([...ds.map((d) => d.paciente), ...sup.map((x) => x.paciente)]),
    ]);
    const itens = ds.map((d) => ({
      documento: d.id,
      tipo: d.tipo,
      titulo: TITULO_DOCUMENTO_SGH[d.tipo] ?? 'Documento',
      paciente: d.paciente,
      nome: nomes.get(d.paciente) ?? 'Paciente',
      emitidoEm: d.criadoEm ?? '',
      hash: d.hash,
    }));
    const coassinaturas = sup.map((x) => ({
      id: x.id,
      registro: x.registro,
      paciente: x.paciente,
      nome: nomes.get(x.paciente) ?? 'Paciente',
      residente: x.residente,
      em: x.em,
    }));
    return { itens, total: itens.length, coassinaturas };
  }

  async previa(c: ContextoDocs, documento: number, login: string): Promise<PreviaAssinatura> {
    const d = await this.porta.documentoSgh(c, documento);
    if (!d || d.usuario !== login) throw new ErroProblema('nao-encontrado', 404, 'Documento não encontrado');
    const tipo = tipoAbertoDaOrigem(d);
    let paragrafos: string[];
    try {
      paragrafos = [
        ...(await this.abrir(c, d.paciente, tipo, abrePeloDocumento(d) ? d.id : d.origemId, 'autor'))
          .paragrafos,
      ];
    } catch {
      paragrafos = [`${TITULO_DOCUMENTO_SGH[d.tipo] ?? 'Documento'} de ${d.criadoEm ?? ''}.`];
    }
    return { documento: d.id, titulo: TITULO_DOCUMENTO_SGH[d.tipo] ?? 'Documento', paragrafos, hash: d.hash };
  }

  // ── M49, etapa 2: o conteúdo do documento para a prévia exata da assinatura ICP ────────────────────────────

  /**
   * O conteúdo do documento do novo como a impressão o monta (identificação do paciente, profissional, corpo e
   * extras), no modelo do tipo gravado (receita de controle especial, atestado…): é o que a prévia exata mostra e o
   * que é assinado. Leitura do autor (o serviço da assinatura confere que é o autor antes).
   */
  async conteudoParaAssinatura(
    c: ContextoDocs,
    d: DocumentoProprioLido,
  ): Promise<{ modelo: ModeloPep; titulo: string; profissional: string; conteudo: ConteudoPep }> {
    const tipo = tipoAbertoDaOrigem(d);
    const modelo = modeloDoTipo(d.tipo);
    // Sem substituto: se o conteúdo emitido não se lê, o erro sobe e não há prévia (o que se assina com ICP é
    // exatamente o documento emitido, regras 4 e 8; o serviço da assinatura recusa com "conteudo-indisponivel").
    const a = await this.abrir(c, d.paciente, tipo, abrePeloDocumento(d) ? d.id : d.origemId, 'autor');
    const paragrafos = [...a.paragrafos];
    const profissional = a.profissional ?? d.usuario;
    const emitidoEm = a.emitidoEm ?? d.criadoEm ?? '';
    const pac = await this.exigirPaciente(c, d.paciente);
    return {
      modelo,
      titulo: TITULOS_PEP[modelo],
      profissional,
      conteudo: {
        modelo,
        identificacao: {
          paciente: pac.nomeSocial ?? pac.nome,
          prontuario: String(pac.prontuario),
          nascimento: pac.nascimento ? pac.nascimento.slice(0, 10) : null,
          atendimento: d.atendimento ? String(d.atendimento) : null,
          profissional,
          conselho: null,
          dataHora: emitidoEm.slice(0, 16).replace('T', ' '),
        },
        corpo: paragrafos,
      },
    };
  }

  // ── Gravado (resposta comum) ───────────────────────────────────────────────────────────────────

  gravado(r: Record<string, unknown>, hash: string): DocumentoGravado {
    return {
      documento: Number(r['documento'] ?? 0),
      origem: Number(r['origem'] ?? r['lancamento'] ?? r['agrupamento'] ?? r['alergia'] ?? r['anexo'] ?? 0),
      hash,
      pdf: false,
      qr: null,
    };
  }
}
