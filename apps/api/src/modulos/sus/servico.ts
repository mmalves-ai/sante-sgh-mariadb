// Faturamento SUS próprio, etapa 1 (ficha do M51, seções 5, 7, 8 e 12): competência SUS por instrumento, crítica prévia
// e exportação da CIHA no leiaute do CIHA01, com o arquivo guardado (dado pessoal: só no armazenamento com retenção) e
// o hash na tabela. Regras que o servidor confere sempre:
//   - a chave de liberação do instrumento no estabelecimento (CIHA na etapa 1; BPA, APAC e AIH desligadas, DP-35);
//   - o escopo por convênio do faturista: lê só as críticas dos seus convênios; fechar, reabrir, gerar, baixar e mexer
//     na equivalência SIGTAP exigem acesso a todos os convênios do estabelecimento (o arquivo e a equivalência valem
//     para todos);
//   - a versão da competência (controle otimista) em fechar, reabrir e gerar; a da equivalência em trocar e desativar;
//   - o fechamento só com as críticas tratadas (nenhuma bloqueante nem aviso aberto);
//   - a auditoria (regra 10) sem dado pessoal: competência, instrumento, contagens por regra e hash, na mesma transação.
// Exportação só em arquivo (regra 9): nada aqui fala com serviço do SUS.
import { createHash } from 'node:crypto';
import {
  type ApacLida,
  type AtendimentoLaudoApac,
  cnsValido,
  type DominiosApac,
  type FiltroApacs,
  type FiltroLinhasApac,
  type GerarApacEntrada,
  type LaudoNefrologia,
  type PaginaApacs,
  type PaginaLinhasApac,
  type RegistrarApacEntrada,
  type SolicitanteApac,
  type AbrirCompetenciaSusEntrada,
  type ArquivoSusGerado,
  type ArquivoSusLido,
  type CompetenciaSus,
  type CompetenciaSusResumo,
  type CriticaSusLida,
  type CriticarSusEntrada,
  type DesativarEquivalenciaSusEntrada,
  type EquivalenciaSusLida,
  EVENTOS_AUDITAVEIS,
  type FecharCompetenciaSusEntrada,
  type FiltroLinhasBpa,
  type GerarBpaEntrada,
  type MedicoSolicitanteAchado,
  type PaginaLinhasBpa,
  type FiltroCriticasSus,
  type FiltroEquivalenciasSus,
  type InstrumentoSus,
  type JustificarCriticaSusEntrada,
  type PaginaCriticasSus,
  type PaginaEquivalenciasSus,
  type ProcedimentoHospitalSus,
  type ReabrirCompetenciaSusEntrada,
  type RegistrarEquivalenciaSusEntrada,
  type RegraCriticaSus,
  type ResultadoCriticaSus,
  type SigtapAchado,
  versaoSus,
} from '@sgh/contratos';
import {
  competenciaDaData,
  competenciaSeguinte,
  exigeLaudoNefrologia,
  gerarArquivoApac,
  normalizarCid,
  LEIAUTE_APAC_MAG,
  recusaAutorizarApac,
  recusaContinuarApac,
  recusaEncerrarApac,
  recusaLaudoApac,
  recusaNegarOuCancelarApac,
  recusaCorrigirApac,
  type RecusaApac,
  conferirEstrutura,
  gerarArquivoBpa,
  gerarArquivoCiha,
  LEIAUTE_BPA_MAG,
  intervaloDaCompetencia,
  LEIAUTE_CIHA01,
  type RecusaCompetenciaSus,
  recusaAbrirCompetencia,
  recusaFecharCompetencia,
  recusaReabrirCompetencia,
  resumoCriticas,
} from '@sgh/dominio-faturamento';
import {
  type ApacSghLinha,
  type MudancaApacSgh,
  type ArquivoSusLinha,
  type CompetenciaSusLinha,
  type CriticaSusLinha,
  type EquivalenciaSusNomeada,
  ErroSusSgh,
  type LinhaTrilha,
  type NovaCriticaSus,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import {
  apacParaMontar,
  montarApacDaCompetencia,
  montarBpaDaCompetencia,
  montarCihaDaCompetencia,
  type ParametrosSus,
} from './montagem.js';
import type { ContextoSus, GravacaoSus, LeituraSus, PortaSus } from './porta.js';
import { SeloSolicitanteApac } from './selo-solicitante.js';

export interface SessaoSus {
  readonly rede: string;
  readonly hospital: string;
  readonly login: string;
  /** AAAA-MM-DD (o relógio do servidor; a competência futura é recusada). */
  readonly hoje: string;
  /** Escopo por convênio (null: todos os convênios do estabelecimento). */
  readonly convenios: readonly number[] | null;
  readonly parametros: ParametrosSus;
  /** A chave de liberação do instrumento ligada no estabelecimento da sessão. */
  liberado(instrumento: InstrumentoSus): Promise<boolean>;
  /** A linha da trilha de uma gravação (o banco é o da sessão). */
  trilha(
    evento: string,
    operacao: string,
    alvo: { tabela: string; id: string | null; diferenca?: string },
  ): LinhaTrilha;
}

/**
 * A guarda do conteúdo do arquivo exportado (S3 com Object Lock fora da memória; o conteúdo tem dado pessoal). Guardar
 * põe uma retenção curta (GOVERNANCE) até o COMMIT; `fixar` aplica a guarda definitiva depois dele; `remover` apaga a
 * versão guardada quando a transação é recusada ou falha (nenhum dado pessoal fica órfão, fora da retenção e do
 * download auditado).
 */
export interface ArmazemArquivoSus {
  guardar(chave: string, bytes: Uint8Array): Promise<{ versao: string | null }>;
  fixar(chave: string, versao: string | null): Promise<void>;
  remover(chave: string, versao: string | null): Promise<void>;
  ler(chave: string): Promise<Uint8Array | null>;
}

/** As recusas da APAC (etapa 3) além das do ciclo do domínio. */
type RecusaApacServico =
  | RecusaApac
  | 'apac-alterada'
  | 'apac-numero-duplicado'
  | 'apac-atendimento-nao-encontrado'
  | 'apac-atendimento-nao-sus'
  | 'apac-procedimento-desconhecido'
  | 'apac-solicitante-desconhecido'
  | 'apac-laudo-nefrologia-ausente'
  | 'apac-dominio-invalido'
  | 'apac-sem-apresentacao';

export const MENSAGENS_RECUSA_SUS: Readonly<
  Record<
    RecusaCompetenciaSus | RecusaApacServico | 'escopo-parcial' | 'versao-alterada' | 'bpa-sem-producao',
    string
  >
> = {
  'apac-alterada': 'A APAC mudou desde que você abriu a tela. Recarregue.',
  'apac-numero-duplicado': 'Este número de APAC já está registrado neste estabelecimento.',
  'apac-situacao-invalida': 'A APAC não está na situação que esta ação exige.',
  'apac-numero-invalido':
    'O número da APAC tem 13 dígitos, e o último é o verificador: confira com a autorização do gestor.',
  'apac-validade-invalida':
    'A validade começa na competência do laudo (ou depois), não passa da competência atual e tem até três competências (a APAC única tem uma).',
  'apac-data-invalida': 'A data não pode ser futura nem anterior ao laudo.',
  'apac-continuidade-fora-da-validade':
    'A continuidade vai até a competência final da validade e só para a competência já começada.',
  'apac-encerramento-invalido':
    'O encerramento usa um motivo de saída e uma data numa competência em que a APAC já foi apresentada.',
  'apac-atendimento-nao-encontrado':
    'Atendimento ambulatorial não encontrado com esse número (a requisição de laboratório não é atendimento).',
  'apac-atendimento-nao-sus': 'O atendimento não tem conta do SUS (a APAC é só do financiador SUS).',
  'apac-procedimento-desconhecido': 'Procedimento não encontrado na tabela SIGTAP.',
  'apac-solicitante-desconhecido': 'Médico solicitante não encontrado no cadastro de solicitantes SUS.',
  'apac-laudo-nefrologia-ausente':
    'Este procedimento exige o laudo de nefrologia (tratamento, transplante e acesso vascular).',
  'apac-dominio-invalido': 'Um valor do laudo de nefrologia não está nos domínios do faturamento SUS.',
  'apac-sem-apresentacao':
    'Nenhuma APAC autorizada da competência tem produção sem crítica bloqueante: não há o que gerar.',
  'bpa-sem-producao':
    'A competência não tem produção ambulatorial do SUS para o BPA (o BPA-Mag não aceita remessa vazia).',
  'avisos-nao-justificados':
    'Há avisos abertos: justifique cada aviso (ou corrija na origem e rode a crítica de novo) antes de fechar.',
  'competencia-futura': 'Não é possível abrir uma competência futura.',
  'competencia-ja-aberta': 'Esta competência já está aberta para o instrumento.',
  'competencia-nao-aberta': 'Abra a competência antes.',
  'competencia-ja-fechada': 'Esta competência já está fechada.',
  'competencia-nao-fechada': 'Só a competência fechada pode ser reaberta.',
  'criticas-bloqueantes-abertas':
    'Há críticas bloqueantes abertas: corrija na origem e rode a crítica de novo.',
  'critica-nao-executada': 'Rode a crítica antes de fechar ou gerar o arquivo.',
  'instrumento-desligado': 'Este instrumento está desligado neste estabelecimento.',
  'escopo-parcial':
    'Seu acesso cobre só parte dos convênios: a geração, o fechamento e a equivalência SIGTAP exigem acesso a todos os convênios do estabelecimento.',
  'versao-alterada': 'A competência mudou desde que você abriu a tela. Recarregue.',
};

function recusa(codigo: keyof typeof MENSAGENS_RECUSA_SUS): ErroProblema {
  if (codigo === 'versao-alterada')
    return new ErroProblema('conflito-de-versao', 409, 'Competência alterada', MENSAGENS_RECUSA_SUS[codigo], {
      codigo,
    });
  if (codigo === 'apac-alterada')
    return new ErroProblema('conflito-de-versao', 409, 'APAC alterada', MENSAGENS_RECUSA_SUS[codigo], {
      codigo,
    });
  if (codigo === 'instrumento-desligado')
    return new ErroProblema(
      'recurso-desligado',
      403,
      'Funcionalidade desligada',
      MENSAGENS_RECUSA_SUS[codigo],
      {
        codigo: 'recurso-desligado',
      },
    );
  if (codigo === 'escopo-parcial')
    return new ErroProblema('sem-permissao', 403, 'Fora do escopo', MENSAGENS_RECUSA_SUS[codigo], { codigo });
  return new ErroProblema('recusa-de-negocio', 422, 'Operação recusada', MENSAGENS_RECUSA_SUS[codigo], {
    codigo,
  });
}

/** Os erros das gravações (ErroSusSgh) em Problem Details. */
function problemaDaGravacao(erro: unknown): never {
  if (erro instanceof ErroSusSgh) {
    if (erro.codigo === 'equivalencia-alterada')
      throw new ErroProblema('conflito-de-versao', 409, 'Equivalência alterada', erro.message, {
        codigo: 'versao-alterada',
      });
    if (erro.codigo === 'versao-alterada') throw recusa('versao-alterada');
    if (erro.codigo === 'apac-alterada') throw recusa('apac-alterada');
    if (erro.codigo === 'nao-encontrado')
      throw new ErroProblema('nao-encontrado', 404, 'Não encontrado', erro.message);
    if (erro.codigo === 'critica-nao-justificavel')
      throw new ErroProblema('recusa-de-negocio', 422, 'Operação recusada', erro.message, {
        codigo: erro.codigo,
      });
    throw recusa(erro.codigo);
  }
  throw erro;
}

const naoEncontrada = () =>
  new ErroProblema('nao-encontrado', 404, 'Competência não encontrada', 'Abra a competência antes.');

function detalheDe(texto: string): Record<string, string | number | null> {
  try {
    const v: unknown = JSON.parse(texto);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const out: Record<string, string | number | null> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>))
        out[k] = typeof x === 'string' || typeof x === 'number' ? x : null;
      return out;
    }
  } catch {
    // detalhe antigo ou cortado: a tela mostra só a regra.
  }
  return {};
}

/** Os procedimentos do hospital que o detalhe da crítica cita (`procedimento` ou a lista curta `procedimentos`). */
export function procedimentosDoDetalhe(d: Readonly<Record<string, string | number | null>>): number[] {
  const lista =
    typeof d['procedimentos'] === 'string'
      ? d['procedimentos'].split(',').map((x) => Number(x.trim()))
      : typeof d['procedimento'] === 'number'
        ? [d['procedimento']]
        : [];
  return lista.filter((x) => Number.isInteger(x) && x > 0);
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
/** Contagens por regra para a trilha (só códigos e números; nunca dado pessoal). */
const contagens = (porRegra: Readonly<Record<string, number>>) =>
  Object.entries(porRegra)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([r, n]) => `${r}=${n}`)
    .join(';');

/**
 * Etapa 4: a montagem da crítica de um instrumento registrada fora deste serviço (a AIH, em servico-aih.ts): lê a
 * competência e devolve as críticas para gravar, o CNES e as contagens, no formato da montagem da CIHA.
 */
export type MontadorCriticaSus = (
  s: SessaoSus,
  competencia: CompetenciaSus,
) => Promise<{
  comp: CompetenciaSusLinha;
  m: {
    criticas: readonly NovaCriticaSus[];
    cnes: string | null;
    resultado: {
      criticas: readonly { regra: RegraCriticaSus; gravidade: 'bloqueante' | 'aviso' }[];
      registros: { length: number };
      foraPorSerSus: number;
    };
  };
}>;

export class ServicoSus {
  private readonly montadores = new Map<InstrumentoSus, MontadorCriticaSus>();

  /** Etapa 4: a crítica do instrumento passa a usar a montagem dada (a AIH registra a dela). */
  registrarMontagem(instrumento: InstrumentoSus, montador: MontadorCriticaSus): void {
    this.montadores.set(instrumento, montador);
  }

  constructor(
    private readonly porta: PortaSus,
    private readonly armazem: ArmazemArquivoSus,
    /** Aviso operacional sem dado pessoal (o controlador liga o log da API). */
    private readonly avisar: (mensagem: string) => void = () => undefined,
    /** A chave opaca do médico solicitante da APAC (o CPF não vai ao navegador; D-SOLICITANTE-513). */
    private readonly selo: SeloSolicitanteApac = new SeloSolicitanteApac(),
  ) {}

  private ctx(s: SessaoSus): ContextoSus {
    return { rede: s.rede, hospital: s.hospital };
  }

  private async exigirLiberado(s: SessaoSus, i: InstrumentoSus): Promise<void> {
    if (!(await s.liberado(i))) throw recusa('instrumento-desligado');
  }

  private exigirEscopoTotal(s: SessaoSus): void {
    if (s.convenios !== null) throw recusa('escopo-parcial');
  }

  resumo(c: CompetenciaSusLinha, liberada: boolean): CompetenciaSusResumo {
    return {
      instrumento: c.instrumento,
      competencia: c.competencia,
      situacao: c.situacao,
      registros: c.registros,
      criticasBloqueantes: c.bloqueantes,
      avisos: c.avisos,
      abertaPor: c.abertaPor,
      abertaEm: c.abertaEm,
      criticadaEm: c.criticadaEm,
      fechadaPor: c.fechadaPor,
      fechadaEm: c.fechadaEm,
      reabertaPor: c.reabertaPor,
      reabertaEm: c.reabertaEm,
      cnes: c.cnes,
      liberada,
      versao: versaoSus(c.versao),
    };
  }

  arquivoLido(a: ArquivoSusLinha): ArquivoSusLido {
    return {
      id: a.id,
      instrumento: a.instrumento,
      competencia: a.competencia,
      leiaute: a.leiaute,
      versaoLeiaute: a.versaoLeiaute,
      conferidoContraOficial: a.conferidoOficial,
      nomeArquivo: a.nome,
      linhas: a.linhas,
      registros: a.registros,
      procedimentos: a.procedimentos,
      semMovimento: a.semMovimento,
      hash: a.hash,
      bytes: a.bytes,
      situacao: a.situacao,
      geradoPor: a.geradoPor,
      geradoEm: a.geradoEm,
    };
  }

  private criticaLida(c: CriticaSusLinha): CriticaSusLida {
    return {
      id: c.id,
      regra: c.regra as CriticaSusLida['regra'],
      gravidade: c.gravidade,
      situacao: c.situacao,
      origem: { conta: c.conta, atendimento: c.atendimento, item: c.item },
      detalhe: detalheDe(c.detalhe),
      justificativa: c.justificativa,
      versao: versaoSus(c.versao),
    };
  }

  private async exigirCompetencia(
    g: LeituraSus,
    i: InstrumentoSus,
    c: CompetenciaSus,
    travar = false,
  ): Promise<CompetenciaSusLinha> {
    const x = await g.competencia(i, c, travar);
    if (!x) throw naoEncontrada();
    return x;
  }

  private async gravar<T>(s: SessaoSus, fn: (g: GravacaoSus) => Promise<T>): Promise<T> {
    try {
      return await this.porta.gravar(this.ctx(s), fn);
    } catch (erro) {
      return problemaDaGravacao(erro);
    }
  }

  // ── Competências ─────────────────────────────────────────────────────────────────────────────────────

  async listarCompetencias(
    s: SessaoSus,
    instrumento: InstrumentoSus | null,
  ): Promise<CompetenciaSusResumo[]> {
    const linhas = await this.porta.ler(this.ctx(s), (l) => l.competencias(instrumento));
    const liberadas = new Map<InstrumentoSus, boolean>();
    const out: CompetenciaSusResumo[] = [];
    for (const c of linhas) {
      if (!liberadas.has(c.instrumento)) liberadas.set(c.instrumento, await s.liberado(c.instrumento));
      out.push(this.resumo(c, liberadas.get(c.instrumento) ?? false));
    }
    return out;
  }

  async abrir(s: SessaoSus, e: AbrirCompetenciaSusEntrada): Promise<CompetenciaSusResumo> {
    const liberado = await s.liberado(e.instrumento);
    return this.gravar(s, async (g) => {
      const existente = await g.competencia(e.instrumento, e.competencia);
      const r = recusaAbrirCompetencia(e.competencia, s.hoje, existente, liberado);
      if (r) throw recusa(r);
      const c = await g.abrir({ instrumento: e.instrumento, competencia: e.competencia, por: s.login });
      await g.trilha(
        s.trilha(
          EVENTOS_AUDITAVEIS.faturamentoCompetenciaSusAberta.codigo,
          'faturamento.abrirCompetenciaSus',
          {
            tabela: 'SGH_FAT_SUS_COMPETENCIA',
            id: String(c.id),
            diferenca: `instrumento=${c.instrumento};competencia=${c.competencia}`,
          },
        ),
      );
      return this.resumo(c, liberado);
    });
  }

  /** `faturamento.criticarSus`: lê a competência no outro sistema, monta pela SIGTAP dela e grava as críticas. */
  async criticar(s: SessaoSus, e: CriticarSusEntrada): Promise<ResultadoCriticaSus> {
    await this.exigirLiberado(s, e.instrumento);
    const t0 = Date.now();
    // Etapa 2: o BPA tem a própria montagem (a produção SUS com o validador de compatibilidade); a etapa 3, a da APAC;
    // a etapa 4 registra a da AIH (registrarMontagem); os demais, a CIHA.
    const montador = this.montadores.get(e.instrumento);
    const { m, comp } = montador
      ? await montador(s, e.competencia)
      : e.instrumento === 'apac'
        ? await this.montarApac(s, e.competencia).then(({ m: a, comp: c }) => ({
            comp: c,
            m: {
              criticas: a.criticas,
              cnes: a.cnes,
              resultado: {
                criticas: a.resultado.criticas,
                registros: { length: a.resultado.apacs.length },
                foraPorSerSus: a.resultado.foraPorNaoSerSus,
              },
            },
          }))
        : e.instrumento === 'bpa'
          ? await this.montarBpa(s, e.competencia).then(({ m: b, comp: c }) => ({
              comp: c,
              m: {
                criticas: b.criticas,
                cnes: b.cnes,
                resultado: {
                  criticas: b.resultado.criticas,
                  registros: { length: b.resultado.atendimentos },
                  foraPorSerSus: b.resultado.foraPorNaoSerSus,
                },
              },
            }))
          : await this.montar(s, e.instrumento, e.competencia);
    if (comp.situacao !== 'aberta') throw recusa('competencia-ja-fechada');
    const tempoMs = Date.now() - t0;
    const r = resumoCriticas(m.resultado.criticas);
    return this.gravar(s, async (g) => {
      const c = await this.exigirCompetencia(g, e.instrumento, e.competencia, true);
      if (c.situacao !== 'aberta') throw recusa('competencia-ja-fechada');
      const gravado = await g.gravarCriticas(c, m.criticas, {
        registros: m.resultado.registros.length,
        cnes: m.cnes,
      });
      await g.trilha(
        s.trilha(EVENTOS_AUDITAVEIS.faturamentoCriticaSusExecutada.codigo, 'faturamento.criticarSus', {
          tabela: 'SGH_FAT_SUS_COMPETENCIA',
          id: String(c.id),
          diferenca:
            `competencia=${c.competencia};registros=${m.resultado.registros.length};${contagens(r.porRegra)}`.slice(
              0,
              1000,
            ),
        }),
      );
      const depois = await this.exigirCompetencia(g, e.instrumento, e.competencia);
      return {
        competencia: this.resumo(depois, true),
        registros: m.resultado.registros.length,
        foraPorSerSus: m.resultado.foraPorSerSus,
        bloqueantes: gravado.bloqueantes,
        avisos: gravado.avisos,
        corrigidas: gravado.corrigidas,
        porRegra: { ...r.porRegra },
        tempoMs,
      };
    });
  }

  private async montar(s: SessaoSus, instrumento: InstrumentoSus, competencia: CompetenciaSus) {
    return this.porta.ler(this.ctx(s), async (l) => {
      const comp = await this.exigirCompetencia(l, instrumento, competencia);
      const equivalencias = await l.equivalencias();
      const dados = await l.dadosCiha(
        intervaloDaCompetencia(competencia),
        s.parametros.conveniosSus,
        equivalencias.map((x) => x.sigtap),
      );
      return { comp, m: montarCihaDaCompetencia(competencia, dados, s.parametros, equivalencias) };
    });
  }

  private async montarBpa(s: SessaoSus, competencia: CompetenciaSus) {
    const apacLiberada = await s.liberado('apac');
    return this.porta.ler(this.ctx(s), async (l) => {
      const comp = await this.exigirCompetencia(l, 'bpa', competencia);
      const equivalencias = await l.equivalencias();
      const dados = await l.dadosBpa(
        intervaloDaCompetencia(competencia),
        s.parametros.conveniosSus,
        equivalencias.map((x) => x.sigtap),
      );
      return {
        comp,
        m: montarBpaDaCompetencia(competencia, dados, s.parametros, equivalencias, apacLiberada),
      };
    });
  }

  /** Etapa 3: a produção SUS da competência (a do BPA) e as APACs apresentáveis, com os solicitantes do FAMEDSOL. */
  private async montarApac(s: SessaoSus, competencia: CompetenciaSus) {
    return this.porta.ler(this.ctx(s), async (l) => {
      const comp = await this.exigirCompetencia(l, 'apac', competencia);
      const equivalencias = await l.equivalencias();
      const apacs = await l.apacsDaCompetencia(competencia);
      const solicitantes = new Map(
        (await l.solicitantesApacPorChave(apacs.map((a) => a.solicitante))).map((x) => [x.chave, x]),
      );
      const dados = await l.dadosBpa(
        intervaloDaCompetencia(competencia),
        s.parametros.conveniosSus,
        equivalencias.map((x) => x.sigtap),
      );
      return {
        comp,
        m: montarApacDaCompetencia(
          competencia,
          dados,
          apacs.map((a) => apacParaMontar(a, solicitantes)),
          s.parametros,
          equivalencias,
        ),
      };
    });
  }

  async listarCriticas(s: SessaoSus, f: FiltroCriticasSus): Promise<PaginaCriticasSus> {
    return this.porta.ler(this.ctx(s), async (l) => {
      const c = await this.exigirCompetencia(l, f.instrumento, f.competencia);
      const r = await l.criticas(c.id, {
        convenios: s.convenios,
        pagina: f.pagina,
        porPagina: f.porPagina,
        ...(f.regra ? { regra: f.regra } : {}),
        ...(f.gravidade ? { gravidade: f.gravidade } : {}),
        ...(f.situacao ? { situacao: f.situacao } : {}),
      });
      const itens = r.itens.map((x) => this.criticaLida(x));
      // O nome dos procedimentos do hospital citados (o detalhe guarda os IDs unificados; a tela mostra código e nome).
      const ids = itens.flatMap((x) => procedimentosDoDetalhe(x.detalhe));
      if (ids.length > 0) {
        const nomes = new Map((await l.procedimentosHospital(ids)).map((p) => [p.id, p]));
        for (const x of itens) {
          const lista = procedimentosDoDetalhe(x.detalhe)
            .map((id) => nomes.get(id))
            .filter((p) => p !== undefined)
            .map((p) => `${p.codigo} ${p.nome}${p.tabela ? ` (${p.tabela})` : ''}`);
          if (lista.length > 0) x.detalhe['procedimentosNomes'] = lista.join('; ').slice(0, 500);
        }
      }
      return { itens, total: r.total, porRegra: r.porRegra };
    });
  }

  async justificar(s: SessaoSus, e: JustificarCriticaSusEntrada): Promise<CriticaSusLida> {
    return this.gravar(s, async (g) => {
      const x = await g.critica(e.critica);
      if (!x) throw new ErroProblema('nao-encontrado', 404, 'Crítica não encontrada');
      if (s.convenios !== null && x.convenio !== null && !s.convenios.includes(x.convenio))
        throw recusa('escopo-parcial');
      const comp = (await g.competencias(null)).find((c) => c.id === x.competencia);
      if (!comp) throw naoEncontrada();
      await this.exigirLiberado(s, comp.instrumento);
      if (comp.situacao !== 'aberta') throw recusa('competencia-ja-fechada');
      if (versaoSus(x.versao) !== e.versao) throw recusa('versao-alterada');
      await g.justificar({ id: x.id, versao: x.versao }, e.justificativa, s.login);
      await g.trilha(
        s.trilha(
          EVENTOS_AUDITAVEIS.faturamentoCriticaSusJustificada.codigo,
          'faturamento.justificarCriticaSus',
          {
            tabela: 'SGH_FAT_SUS_CRITICA',
            id: String(x.id),
            diferenca: `regra=${x.regra};competencia=${comp.competencia}`,
          },
        ),
      );
      const depois = await g.critica(x.id);
      return this.criticaLida(depois ?? x);
    });
  }

  async fechar(s: SessaoSus, e: FecharCompetenciaSusEntrada): Promise<CompetenciaSusResumo> {
    await this.exigirLiberado(s, e.instrumento);
    this.exigirEscopoTotal(s);
    return this.gravar(s, async (g) => {
      const c = await this.exigirCompetencia(g, e.instrumento, e.competencia, true);
      // As críticas abertas da competência inteira (sem o escopo: o fechamento já exige todos os convênios).
      const abertas = async (gravidade: 'bloqueante' | 'aviso') =>
        (
          await g.criticas(c.id, {
            convenios: null,
            situacao: 'aberta',
            gravidade,
            pagina: 0,
            porPagina: 1,
          })
        ).total;
      const bloqueantes = c.bloqueantes > 0 ? c.bloqueantes : await abertas('bloqueante');
      const avisos = await abertas('aviso');
      const r = recusaFecharCompetencia(c, c.criticadaEm !== null, [
        ...(bloqueantes > 0 ? [{ gravidade: 'bloqueante' as const, situacao: 'aberta' as const }] : []),
        ...(avisos > 0 ? [{ gravidade: 'aviso' as const, situacao: 'aberta' as const }] : []),
      ]);
      if (r) throw recusa(r);
      if (versaoSus(c.versao) !== e.versao) throw recusa('versao-alterada');
      await g.fechar(c, s.login);
      await g.trilha(
        s.trilha(
          EVENTOS_AUDITAVEIS.faturamentoCompetenciaSusFechada.codigo,
          'faturamento.fecharCompetenciaSus',
          {
            tabela: 'SGH_FAT_SUS_COMPETENCIA',
            id: String(c.id),
            diferenca: `instrumento=${c.instrumento};competencia=${c.competencia};registros=${c.registros}`,
          },
        ),
      );
      return this.resumo(await this.exigirCompetencia(g, e.instrumento, e.competencia), true);
    });
  }

  async reabrir(s: SessaoSus, e: ReabrirCompetenciaSusEntrada): Promise<CompetenciaSusResumo> {
    await this.exigirLiberado(s, e.instrumento);
    this.exigirEscopoTotal(s);
    return this.gravar(s, async (g) => {
      const c = await this.exigirCompetencia(g, e.instrumento, e.competencia, true);
      const r = recusaReabrirCompetencia(c);
      if (r) throw recusa(r);
      if (versaoSus(c.versao) !== e.versao) throw recusa('versao-alterada');
      await g.reabrir(c, s.login, e.justificativa);
      await g.trilha(
        s.trilha(
          EVENTOS_AUDITAVEIS.faturamentoCompetenciaSusReaberta.codigo,
          'faturamento.reabrirCompetenciaSus',
          {
            tabela: 'SGH_FAT_SUS_COMPETENCIA',
            id: String(c.id),
            diferenca: `instrumento=${c.instrumento};competencia=${c.competencia}`,
          },
        ),
      );
      return this.resumo(await this.exigirCompetencia(g, e.instrumento, e.competencia), true);
    });
  }

  // ── CIHA ─────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * `faturamento.gerarCiha`: competência aberta, criticada e na versão que a tela leu; a montagem é refeita (o outro
   * sistema pode ter mudado) e, com bloqueante, nada é gravado. Na transação, depois de travar e conferir a competência,
   * o conteúdo vai ao armazenamento (chave com o ID e o hash, retenção curta) e depois as críticas sincronizadas, o
   * arquivo, os registros e a trilha. Se a transação é recusada ou falha, a versão guardada é removida; depois do
   * COMMIT, a guarda definitiva é fixada.
   */
  async gerarCiha(
    s: SessaoSus,
    e: { competencia: CompetenciaSus; versao: string },
  ): Promise<ArquivoSusGerado> {
    await this.exigirLiberado(s, 'ciha');
    this.exigirEscopoTotal(s);
    const t0 = Date.now();
    const { m, comp } = await this.montar(s, 'ciha', e.competencia);
    if (comp.situacao !== 'aberta') throw recusa('competencia-ja-fechada');
    if (comp.criticadaEm === null) throw recusa('critica-nao-executada');
    if (versaoSus(comp.versao) !== e.versao) throw recusa('versao-alterada');
    if (m.resultado.criticas.some((c) => c.gravidade === 'bloqueante') || m.cnes === null)
      throw recusa('criticas-bloqueantes-abertas');
    const arquivo = gerarArquivoCiha(e.competencia, m.cnes, m.resultado.registros);
    const problemas = conferirEstrutura(LEIAUTE_CIHA01, arquivo.conteudo);
    if (problemas.length > 0)
      throw new ErroProblema(
        'erro-interno',
        500,
        'Arquivo fora do leiaute',
        `O arquivo gerado tem ${problemas.length} erro(s) de estrutura: nada foi gravado.`,
      );
    const bytes = new TextEncoder().encode(arquivo.conteudo);
    const hash = sha256(bytes);
    const id = await this.gravar(s, (g) => g.proximoArquivo());
    const chave = `sus/${s.hospital}/ciha/${e.competencia}/${id}-${hash.slice(0, 16)}.txt`;
    const tempoMs = Date.now() - t0;
    let guardado: { versao: string | null } | null = null;
    let gerado: ArquivoSusGerado;
    try {
      gerado = await this.gravar(s, async (g) => {
        const c = await this.exigirCompetencia(g, 'ciha', e.competencia, true);
        if (c.situacao !== 'aberta') throw recusa('competencia-ja-fechada');
        if (versaoSus(c.versao) !== e.versao) throw recusa('versao-alterada');
        guardado = await this.armazem.guardar(chave, bytes);
        await g.gravarCriticas(c, m.criticas, { registros: m.resultado.registros.length, cnes: m.cnes });
        const { substituidos } = await g.gravarArquivo(
          {
            id,
            competencia: { id: c.id, instrumento: 'ciha', competencia: c.competencia },
            leiaute: arquivo.leiaute,
            versaoLeiaute: arquivo.versaoLeiaute,
            conferidoOficial: arquivo.conferidoContraOficial,
            nome: arquivo.nomeArquivo,
            linhas: arquivo.linhas,
            registros: arquivo.registros,
            procedimentos: arquivo.procedimentos,
            semMovimento: arquivo.semMovimento,
            hash,
            bytes: bytes.byteLength,
            chaveObjeto: chave,
            versaoObjeto: guardado.versao,
            por: s.login,
          },
          m.registros,
        );
        await g.trilha(
          s.trilha(EVENTOS_AUDITAVEIS.faturamentoCihaGerada.codigo, 'faturamento.gerarCiha', {
            tabela: 'SGH_FAT_SUS_ARQUIVO',
            id: String(id),
            diferenca: `competencia=${c.competencia};registros=${arquivo.registros};procedimentos=${arquivo.procedimentos};sha256=${hash}`,
          }),
        );
        const lido = await g.arquivo(id);
        if (!lido) throw new ErroProblema('nao-encontrado', 404, 'Arquivo não encontrado');
        return {
          arquivo: this.arquivoLido(lido),
          competencia: this.resumo(await this.exigirCompetencia(g, 'ciha', e.competencia), true),
          substituidos,
          tempoMs,
        };
      });
    } catch (erro) {
      const g = guardado as { versao: string | null } | null;
      if (g)
        await this.armazem
          .remover(chave, g.versao)
          .catch(() =>
            this.avisar(`faturamento.gerarCiha: o objeto do arquivo ${id} não foi removido após a recusa`),
          );
      throw erro;
    }
    const final = guardado as { versao: string | null } | null;
    await this.armazem
      .fixar(chave, final?.versao ?? null)
      .catch(() =>
        this.avisar(
          `faturamento.gerarCiha: a guarda definitiva do arquivo ${id} não foi fixada após o COMMIT`,
        ),
      );
    return gerado;
  }

  // ── BPA (etapa 2; desligado por estabelecimento, DP-35) ─────────────────────────────────────────────

  /**
   * `faturamento.gerarBpa`: como a CIHA (D-GERAR-51), com a chave `faturamento.susBpa` ligada: competência BPA aberta,
   * criticada e na versão que a tela leu; a montagem é refeita e, com bloqueante ou sem produção, nada é gravado. Na
   * transação, o conteúdo vai ao armazenamento (retenção curta) e depois as críticas sincronizadas, o arquivo, as linhas
   * e a trilha; na falha, a versão guardada é removida; depois do COMMIT, a guarda definitiva é fixada.
   */
  async gerarBpa(s: SessaoSus, e: GerarBpaEntrada): Promise<ArquivoSusGerado> {
    await this.exigirLiberado(s, 'bpa');
    this.exigirEscopoTotal(s);
    const t0 = Date.now();
    const { m, comp } = await this.montarBpa(s, e.competencia);
    if (comp.situacao !== 'aberta') throw recusa('competencia-ja-fechada');
    if (comp.criticadaEm === null) throw recusa('critica-nao-executada');
    if (versaoSus(comp.versao) !== e.versao) throw recusa('versao-alterada');
    if (m.resultado.criticas.some((c) => c.gravidade === 'bloqueante') || m.cnes === null)
      throw recusa('criticas-bloqueantes-abertas');
    const r = m.resultado;
    if (r.consolidado.length + r.individualizado.length === 0) throw recusa('bpa-sem-producao');
    const arquivo = gerarArquivoBpa(
      e.competencia,
      m.cnes,
      s.parametros.bpa,
      r.consolidado,
      r.individualizado,
      r.atendimentos,
    );
    const problemas = conferirEstrutura(LEIAUTE_BPA_MAG, arquivo.conteudo);
    if (problemas.length > 0)
      throw new ErroProblema(
        'erro-interno',
        500,
        'Arquivo fora do leiaute',
        `O arquivo gerado tem ${problemas.length} erro(s) de estrutura: nada foi gravado.`,
      );
    const bytes = new TextEncoder().encode(arquivo.conteudo);
    const hash = sha256(bytes);
    const id = await this.gravar(s, (g) => g.proximoArquivo());
    const chave = `sus/${s.hospital}/bpa/${e.competencia}/${id}-${hash.slice(0, 16)}.txt`;
    const tempoMs = Date.now() - t0;
    const linhas = arquivo.numeradas.map((x) => ({
      tipo: x.tipo,
      folha: x.folha,
      sequencia: x.sequencia,
      procedimento: x.procedimento,
      cbo: x.cbo,
      idade: x.idade,
      quantidade: x.quantidade,
      data: x.data,
      conta: x.conta,
      atendimento: x.atendimento,
      registro: x.conta === null ? null : (m.registroDaConta.get(x.conta) ?? null),
    }));
    let guardado: { versao: string | null } | null = null;
    let gerado: ArquivoSusGerado;
    try {
      gerado = await this.gravar(s, async (g) => {
        const c = await this.exigirCompetencia(g, 'bpa', e.competencia, true);
        if (c.situacao !== 'aberta') throw recusa('competencia-ja-fechada');
        if (versaoSus(c.versao) !== e.versao) throw recusa('versao-alterada');
        guardado = await this.armazem.guardar(chave, bytes);
        await g.gravarCriticas(c, m.criticas, { registros: r.atendimentos, cnes: m.cnes });
        const { substituidos } = await g.gravarArquivoBpa(
          {
            id,
            competencia: { id: c.id, instrumento: 'bpa', competencia: c.competencia },
            leiaute: arquivo.leiaute,
            versaoLeiaute: arquivo.versaoLeiaute,
            conferidoOficial: arquivo.conferidoContraOficial,
            nome: arquivo.nomeArquivo,
            linhas: arquivo.linhas,
            registros: arquivo.registros,
            procedimentos: arquivo.procedimentos,
            semMovimento: false,
            hash,
            bytes: bytes.byteLength,
            chaveObjeto: chave,
            versaoObjeto: guardado.versao,
            por: s.login,
          },
          linhas,
        );
        const quantidade = (t: 'c' | 'i') =>
          arquivo.numeradas.filter((x) => x.tipo === t).reduce((n, x) => n + x.quantidade, 0);
        await g.trilha(
          s.trilha(EVENTOS_AUDITAVEIS.faturamentoBpaGerado.codigo, 'faturamento.gerarBpa', {
            tabela: 'SGH_FAT_SUS_ARQUIVO',
            id: String(id),
            diferenca: `competencia=${c.competencia};bpaC=${r.consolidado.length}/${quantidade('c')};bpaI=${r.individualizado.length}/${quantidade('i')};folhas=${arquivo.folhas};controle=${arquivo.controle};sha256=${hash}`,
          }),
        );
        const lido = await g.arquivo(id);
        if (!lido) throw new ErroProblema('nao-encontrado', 404, 'Arquivo não encontrado');
        return {
          arquivo: this.arquivoLido(lido),
          competencia: this.resumo(await this.exigirCompetencia(g, 'bpa', e.competencia), true),
          substituidos,
          tempoMs,
        };
      });
    } catch (erro) {
      const g = guardado as { versao: string | null } | null;
      if (g)
        await this.armazem
          .remover(chave, g.versao)
          .catch(() =>
            this.avisar(`faturamento.gerarBpa: o objeto do arquivo ${id} não foi removido após a recusa`),
          );
      throw erro;
    }
    const final = guardado as { versao: string | null } | null;
    await this.armazem
      .fixar(chave, final?.versao ?? null)
      .catch(() =>
        this.avisar(
          `faturamento.gerarBpa: a guarda definitiva do arquivo ${id} não foi fixada após o COMMIT`,
        ),
      );
    return gerado;
  }

  /** As linhas de um arquivo BPA (sem dado pessoal), com o resumo por tipo. */
  async listarLinhasBpa(s: SessaoSus, f: FiltroLinhasBpa): Promise<PaginaLinhasBpa> {
    await this.exigirLiberado(s, 'bpa');
    // As linhas cobrem todos os convênios SUS do arquivo, como o download: escopo parcial não lista (coerente com
    // gerarBpa e baixar).
    this.exigirEscopoTotal(s);
    return this.porta.ler(this.ctx(s), async (l) => {
      const a = await l.arquivo(f.arquivo);
      if (!a || a.instrumento !== 'bpa')
        throw new ErroProblema('nao-encontrado', 404, 'Arquivo BPA não encontrado');
      return l.linhasBpa({
        arquivo: f.arquivo,
        ...(f.tipo ? { tipo: f.tipo } : {}),
        ...(f.procedimento ? { procedimento: f.procedimento } : {}),
        pagina: f.pagina,
        porPagina: f.porPagina,
      });
    });
  }

  /** Busca no cadastro geral de médicos solicitantes (a tela dos solicitantes SUS o consulta ao incluir). */
  async buscarSolicitantes(s: SessaoSus, termo: string): Promise<MedicoSolicitanteAchado[]> {
    return this.porta.ler(this.ctx(s), (l) => l.buscarSolicitantes(termo));
  }

  /** Os parâmetros do faturamento ambulatorial do outro sistema (consulta: configuram o módulo do fornecedor). */
  async parametrosLegado(s: SessaoSus): Promise<{
    competenciaAmbulatorio: string | null;
    versao: string | null;
    orgao: string | null;
  }> {
    return this.porta.ler(this.ctx(s), (l) => l.parametrosLegado());
  }

  async listarArquivos(
    s: SessaoSus,
    instrumento: InstrumentoSus,
    competencia: CompetenciaSus | null,
  ): Promise<ArquivoSusLido[]> {
    const r = await this.porta.ler(this.ctx(s), (l) => l.arquivos(instrumento, competencia));
    return r.map((a) => this.arquivoLido(a));
  }

  /** O conteúdo guardado, conferido pelo hash (o download é auditado pelo controlador). */
  async baixar(
    s: SessaoSus,
    id: number,
    instrumento: InstrumentoSus = 'ciha',
  ): Promise<{ nome: string; conteudo: Uint8Array; arquivo: ArquivoSusLido }> {
    this.exigirEscopoTotal(s);
    const a = await this.porta.ler(this.ctx(s), (l) => l.arquivo(id));
    // A rota de cada instrumento tem a permissão dele: o arquivo de outro instrumento não é entregue por ela.
    if (!a || a.instrumento !== instrumento)
      throw new ErroProblema('nao-encontrado', 404, 'Arquivo não encontrado');
    await this.exigirLiberado(s, a.instrumento);
    const conteudo = await this.armazem.ler(a.chaveObjeto);
    if (!conteudo || sha256(conteudo) !== a.hash)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Arquivo indisponível',
        'O conteúdo guardado não foi lido ou não confere com a impressão digital registrada.',
      );
    await this.gravar(s, (g) =>
      g.trilha(
        s.trilha(EVENTOS_AUDITAVEIS.faturamentoArquivoSusBaixado.codigo, 'faturamento.baixarArquivoSus', {
          tabela: 'SGH_FAT_SUS_ARQUIVO',
          id: String(a.id),
          diferenca: `competencia=${a.competencia};sha256=${a.hash}`,
        }),
      ),
    );
    return { nome: a.nome, conteudo, arquivo: this.arquivoLido(a) };
  }

  // ── APAC (etapa 3) ───────────────────────────────────────────────────────────────────────────────────

  /** A APAC exige o escopo dos convênios SUS do estabelecimento (todos, ou ao menos todos os convênios SUS). */
  private exigirEscopoSus(s: SessaoSus): void {
    if (s.convenios === null) return;
    const sus = s.parametros.conveniosSus;
    if (sus.length === 0 || !sus.every((c) => s.convenios?.includes(c))) throw recusa('escopo-parcial');
  }

  private apacLida(
    a: ApacSghLinha,
    nomes: {
      sigtap: ReadonlyMap<number, string>;
      solicitantes: ReadonlyMap<string, { nome: string; crm: number | null }>;
    },
  ): ApacLida {
    const sol = nomes.solicitantes.get(a.solicitante);
    return {
      id: a.id,
      situacao: a.situacao,
      prontuario: a.prontuario,
      registro: a.registro,
      atendimento: a.atendimento,
      procedimento: a.procedimento,
      procedimentoNome: nomes.sigtap.get(a.sigtap) ?? null,
      cidPrincipal: a.cidPrincipal,
      cidSecundario: a.cidSecundario,
      cidAssociado: a.cidAssociado,
      solicitante: this.selo.selar(a.solicitante),
      solicitanteNome: sol?.nome ?? null,
      solicitanteCrm: sol?.crm ?? null,
      dataSolicitacao: a.dataSolicitacao,
      justificativa: a.justificativa,
      laudoEspecifico: a.laudoEspecifico,
      nefrologia: a.nefrologia,
      numero: a.numero,
      tipo: a.tipo,
      dataAutorizacao: a.dataAutorizacao,
      competenciaInicial: a.competenciaInicial,
      competenciaFinal: a.competenciaFinal,
      ultimaCompetencia: a.ultimaCompetencia,
      motivoSaida: a.motivoSaida,
      dataEncerramento: a.dataEncerramento,
      justificativaSituacao: a.justificativaSituacao,
      registradaPor: a.registradaPor,
      registradaEm: a.registradaEm,
      alteradaPor: a.alteradaPor,
      alteradaEm: a.alteradaEm,
      versao: versaoSus(a.versao),
    };
  }

  private async nomesDasApacs(l: LeituraSus, apacs: readonly ApacSghLinha[]) {
    const sigtap = await l.nomesSigtap(apacs.map((a) => a.sigtap));
    const sol = await l.solicitantesApacPorChave(apacs.map((a) => a.solicitante));
    return { sigtap, solicitantes: new Map(sol.map((x) => [x.chave, { nome: x.nome, crm: x.crm }])) };
  }

  /** As APACs do estabelecimento (sem documento: o paciente pelo prontuário). */
  async listarApacs(s: SessaoSus, f: FiltroApacs): Promise<PaginaApacs> {
    await this.exigirLiberado(s, 'apac');
    this.exigirEscopoSus(s);
    return this.porta.ler(this.ctx(s), async (l) => {
      const r = await l.paginaApacs({
        ...(f.situacao ? { situacao: f.situacao } : {}),
        ...(f.numero ? { numero: f.numero } : {}),
        ...(f.prontuario ? { prontuario: f.prontuario } : {}),
        ...(f.competencia ? { competencia: f.competencia } : {}),
        pagina: f.pagina,
        porPagina: f.porPagina,
      });
      const nomes = await this.nomesDasApacs(l, r.itens);
      return {
        itens: r.itens.map((a) => this.apacLida(a, nomes)),
        total: r.total,
        porSituacao: r.porSituacao,
      };
    });
  }

  /**
   * O atendimento do laudo conferido (a tela mostra o prontuário, a data e se o CNS é válido; nunca o número). Só o
   * atendimento com conta do SUS: o de outro financiador é recusado sem devolver o CID, o prontuário nem a data
   * (D-ATEND-513; a rota é auditada).
   */
  async atendimentoLaudoApac(s: SessaoSus, registro: number): Promise<AtendimentoLaudoApac> {
    await this.exigirLiberado(s, 'apac');
    this.exigirEscopoSus(s);
    const sus = s.parametros.conveniosSus;
    const a = await this.porta.ler(this.ctx(s), (l) => l.atendimentoLaudoApac(registro, sus));
    if (!a) throw recusa('apac-atendimento-nao-encontrado');
    if (a.convenio === null || !sus.includes(a.convenio)) throw recusa('apac-atendimento-nao-sus');
    return {
      registro: a.registro,
      atendimento: a.atendimento,
      prontuario: a.prontuario,
      data: a.data,
      convenio: a.convenio,
      contaSus: true,
      cnsValido: a.cns !== null && cnsValido(a.cns),
      cidPrincipal: a.cidPrincipal,
    };
  }

  /** Os domínios do laudo de nefrologia (consulta). */
  async dominiosApac(s: SessaoSus): Promise<DominiosApac> {
    await this.exigirLiberado(s, 'apac');
    const d = await this.porta.ler(this.ctx(s), (l) => l.dominiosApac());
    return {
      caracteristicaTratamento: [...d.caracteristicaTratamento],
      contraindicacaoTransplante: [...d.contraindicacaoTransplante],
      situacaoTransplante: [...d.situacaoTransplante],
      acessoVascular: [...d.acessoVascular],
    };
  }

  /**
   * Os médicos solicitantes SUS (FAMEDSOL) para o laudo: a chave opaca (nunca o CPF), o nome, o CRM e se o CNS é
   * válido; com a APAC liberada e o escopo SUS, como o laudo.
   */
  async buscarSolicitantesApac(s: SessaoSus, termo: string): Promise<SolicitanteApac[]> {
    await this.exigirLiberado(s, 'apac');
    this.exigirEscopoSus(s);
    const r = await this.porta.ler(this.ctx(s), (l) => l.buscarSolicitantesApac(termo));
    return r.map((x) => ({
      chave: this.selo.selar(x.chave),
      nome: x.nome,
      crm: x.crm,
      cnsValido: x.cns !== null && cnsValido(x.cns),
    }));
  }

  /** O médico solicitante pela chave opaca da tela (recusado quando a chave não abre ou não está no cadastro). */
  private async solicitanteDaChave(g: LeituraSus, chave: string) {
    const cpf = this.selo.abrir(chave);
    const [sol] = cpf ? await g.solicitantesApacPorChave([cpf]) : [];
    if (!sol) throw recusa('apac-solicitante-desconhecido');
    return sol;
  }

  /** O laudo de nefrologia nos domínios do faturamento SUS, com o início do tratamento até hoje. */
  private async conferirNefrologia(g: LeituraSus, n: LaudoNefrologia | null, hoje: string): Promise<void> {
    if (!n) return;
    const d = await g.dominiosApac();
    const tem = (lista: readonly { id: number }[], id: number) => lista.some((x) => x.id === id);
    if (
      !tem(d.caracteristicaTratamento, n.caracteristicaTratamento) ||
      !tem(d.contraindicacaoTransplante, n.contraindicacaoTransplante) ||
      !tem(d.situacaoTransplante, n.situacaoTransplante) ||
      !tem(d.acessoVascular, n.acessoVascular) ||
      n.inicioTratamento > hoje
    )
      throw recusa('apac-dominio-invalido');
  }

  /**
   * `faturamento.registrarApac`: o laudo (a APAC entra solicitada) e as mudanças do ciclo (autorizar, negar,
   * continuar, encerrar, cancelar) na versão que a tela leu. As regras são do domínio; a auditoria (regra 10) leva a
   * ação, o procedimento e as competências, nunca dado pessoal.
   */
  async registrarApac(s: SessaoSus, e: RegistrarApacEntrada): Promise<ApacLida> {
    await this.exigirLiberado(s, 'apac');
    this.exigirEscopoSus(s);
    const trilha = (g: GravacaoSus, a: ApacSghLinha, diferenca: string) =>
      g.trilha(
        s.trilha(EVENTOS_AUDITAVEIS.faturamentoApacRegistrada.codigo, 'faturamento.registrarApac', {
          tabela: 'SGH_FAT_SUS_APAC',
          id: String(a.id),
          diferenca: `acao=${e.acao};${diferenca}`.slice(0, 1000),
        }),
      );
    if (e.acao === 'laudo') {
      const l = e.laudo;
      const r0 = recusaLaudoApac(l.dataSolicitacao, s.hoje);
      if (r0) throw recusa(r0);
      if (exigeLaudoNefrologia(l.procedimento) && l.laudoEspecifico !== 'nefrologia')
        throw recusa('apac-laudo-nefrologia-ausente');
      return this.gravar(s, async (g) => {
        const at = await g.atendimentoLaudoApac(l.registro, s.parametros.conveniosSus);
        if (!at || at.pacienteId === null) throw recusa('apac-atendimento-nao-encontrado');
        if (at.convenio === null || !s.parametros.conveniosSus.includes(at.convenio))
          throw recusa('apac-atendimento-nao-sus');
        const sigtap = await g.sigtapPorCodigo(l.procedimento);
        if (!sigtap) throw recusa('apac-procedimento-desconhecido');
        const sol = await this.solicitanteDaChave(g, l.solicitante);
        await this.conferirNefrologia(g, l.nefrologia, s.hoje);
        const a = await g.incluirApac({
          paciente: at.pacienteId,
          prontuario: at.prontuario,
          registro: at.registro,
          atendimento: at.atendimento,
          sigtap: sigtap.id,
          procedimento: sigtap.codigo,
          cidPrincipal: normalizarCid(l.cidPrincipal) ?? l.cidPrincipal,
          cidSecundario: normalizarCid(l.cidSecundario),
          cidAssociado: normalizarCid(l.cidAssociado),
          solicitante: sol.chave,
          dataSolicitacao: l.dataSolicitacao,
          justificativa: l.justificativa,
          nefrologia: l.nefrologia,
          por: s.login,
        });
        await trilha(g, a, `procedimento=${a.procedimento};laudo=${a.laudoEspecifico}`);
        return this.apacLida(a, {
          sigtap: new Map([[sigtap.id, sigtap.nome]]),
          solicitantes: new Map([[sol.chave, { nome: sol.nome, crm: sol.crm }]]),
        });
      });
    }
    return this.gravar(s, async (g) => {
      const antes = await g.apac(e.apac);
      if (!antes) throw new ErroProblema('nao-encontrado', 404, 'APAC não encontrada');
      if (versaoSus(antes.versao) !== e.versao) throw recusa('apac-alterada');
      let mudanca: MudancaApacSgh;
      let r: RecusaApac | null;
      let detalhe = '';
      switch (e.acao) {
        case 'corrigir': {
          const c = e.laudo;
          r = recusaCorrigirApac(antes, c.dataSolicitacao, s.hoje);
          if (r) throw recusa(r);
          if (exigeLaudoNefrologia(antes.procedimento) && c.laudoEspecifico !== 'nefrologia')
            throw recusa('apac-laudo-nefrologia-ausente');
          const sol = await this.solicitanteDaChave(g, c.solicitante);
          await this.conferirNefrologia(g, c.nefrologia, s.hoje);
          mudanca = {
            acao: 'corrigir',
            cidPrincipal: normalizarCid(c.cidPrincipal) ?? c.cidPrincipal,
            cidSecundario: normalizarCid(c.cidSecundario),
            cidAssociado: normalizarCid(c.cidAssociado),
            solicitante: sol.chave,
            dataSolicitacao: c.dataSolicitacao,
            justificativa: c.justificativa,
            nefrologia: c.nefrologia,
          };
          // Na trilha, os campos corrigidos pelo nome (nunca o valor: CID e texto clínico não vão à auditoria).
          const mudou = [
            ['cidPrincipal', antes.cidPrincipal, mudanca.cidPrincipal],
            ['cidSecundario', antes.cidSecundario, mudanca.cidSecundario],
            ['cidAssociado', antes.cidAssociado, mudanca.cidAssociado],
            ['solicitante', antes.solicitante, mudanca.solicitante],
            ['dataSolicitacao', antes.dataSolicitacao, mudanca.dataSolicitacao],
            ['justificativa', antes.justificativa, mudanca.justificativa],
            ['nefrologia', JSON.stringify(antes.nefrologia), JSON.stringify(mudanca.nefrologia)],
          ]
            .filter(([, a, b]) => a !== b)
            .map(([k]) => k);
          detalhe = `;corrigidos=${mudou.join(',') || 'nenhum'}`;
          break;
        }
        case 'autorizar':
          r = recusaAutorizarApac(antes, e, s.hoje);
          mudanca = {
            acao: 'autorizar',
            numero: e.numero,
            tipo: e.tipo,
            autorizador: e.autorizador,
            dataAutorizacao: e.dataAutorizacao,
            competenciaInicial: e.competenciaInicial,
            competenciaFinal: e.competenciaFinal,
          };
          break;
        case 'negar':
        case 'cancelar':
          r = recusaNegarOuCancelarApac(antes, e.acao);
          mudanca = { acao: e.acao, justificativa: e.justificativa };
          break;
        case 'continuar':
          r = recusaContinuarApac(antes, s.hoje);
          mudanca = {
            acao: 'continuar',
            ultimaCompetencia: competenciaSeguinte(antes.ultimaCompetencia ?? '200801'),
          };
          break;
        case 'encerrar':
          r = recusaEncerrarApac(antes, e, s.hoje);
          mudanca = {
            acao: 'encerrar',
            motivo: e.motivo,
            dataEncerramento: e.dataEncerramento,
            ultimaCompetencia: competenciaDaData(e.dataEncerramento) ?? antes.ultimaCompetencia ?? '',
          };
          break;
      }
      if (r) throw recusa(r);
      let depois: ApacSghLinha;
      try {
        ({ depois } = await g.mudarApac({ id: antes.id, versao: antes.versao, por: s.login, mudanca }));
      } catch (erro) {
        if (erro instanceof ErroSusSgh && erro.codigo === 'apac-numero-duplicado')
          throw recusa('apac-numero-duplicado');
        throw erro;
      }
      await trilha(
        g,
        depois,
        `situacao=${antes.situacao}>${depois.situacao};validade=${depois.competenciaInicial ?? ''}-${depois.competenciaFinal ?? ''};ultima=${depois.ultimaCompetencia ?? ''};motivo=${depois.motivoSaida ?? ''}${detalhe}`,
      );
      return this.apacLida(depois, await this.nomesDasApacs(g, [depois]));
    });
  }

  /**
   * `faturamento.gerarApac` (o APAC-Mag da competência): como o BPA (D-GERAR-51), com a chave `faturamento.susApac`
   * ligada: competência APAC aberta, criticada e na versão que a tela leu; a montagem é refeita e, com bloqueante ou sem
   * APAC a apresentar, nada é gravado. O conteúdo vai ao armazenamento na transação; na falha, é removido.
   */
  async gerarApac(s: SessaoSus, e: GerarApacEntrada): Promise<ArquivoSusGerado> {
    await this.exigirLiberado(s, 'apac');
    this.exigirEscopoTotal(s);
    const t0 = Date.now();
    const { m, comp } = await this.montarApac(s, e.competencia);
    if (comp.situacao !== 'aberta') throw recusa('competencia-ja-fechada');
    if (comp.criticadaEm === null) throw recusa('critica-nao-executada');
    if (versaoSus(comp.versao) !== e.versao) throw recusa('versao-alterada');
    if (m.resultado.criticas.some((c) => c.gravidade === 'bloqueante') || m.cnes === null)
      throw recusa('criticas-bloqueantes-abertas');
    const r = m.resultado;
    if (r.apacs.length === 0) throw recusa('apac-sem-apresentacao');
    const arquivo = gerarArquivoApac(
      e.competencia,
      m.cnes,
      { ...s.parametros.bpa, uf: s.parametros.apac.uf },
      r.apacs,
      s.hoje,
    );
    const problemas = conferirEstrutura(LEIAUTE_APAC_MAG, arquivo.conteudo);
    if (problemas.length > 0)
      throw new ErroProblema(
        'erro-interno',
        500,
        'Arquivo fora do leiaute',
        `O arquivo gerado tem ${problemas.length} erro(s) de estrutura: nada foi gravado.`,
      );
    const bytes = new TextEncoder().encode(arquivo.conteudo);
    const hash = sha256(bytes);
    const id = await this.gravar(s, (g) => g.proximoArquivo());
    const chave = `sus/${s.hospital}/apac/${e.competencia}/${id}-${hash.slice(0, 16)}.txt`;
    const tempoMs = Date.now() - t0;
    let guardado: { versao: string | null } | null = null;
    let gerado: ArquivoSusGerado;
    try {
      gerado = await this.gravar(s, async (g) => {
        const c = await this.exigirCompetencia(g, 'apac', e.competencia, true);
        if (c.situacao !== 'aberta') throw recusa('competencia-ja-fechada');
        if (versaoSus(c.versao) !== e.versao) throw recusa('versao-alterada');
        guardado = await this.armazem.guardar(chave, bytes);
        await g.gravarCriticas(c, m.criticas, { registros: r.apacs.length, cnes: m.cnes });
        const { substituidos } = await g.gravarArquivoApac(
          {
            id,
            competencia: { id: c.id, instrumento: 'apac', competencia: c.competencia },
            leiaute: arquivo.leiaute,
            versaoLeiaute: arquivo.versaoLeiaute,
            conferidoOficial: arquivo.conferidoContraOficial,
            nome: arquivo.nomeArquivo,
            linhas: arquivo.linhas,
            registros: arquivo.registros,
            procedimentos: arquivo.procedimentos,
            semMovimento: false,
            hash,
            bytes: bytes.byteLength,
            chaveObjeto: chave,
            versaoObjeto: guardado.versao,
            por: s.login,
          },
          arquivo.numeradas.map((x) => ({
            apac: x.apac,
            tipoNoArquivo: x.tipoNoArquivo,
            procedimento: x.procedimento,
            principal: x.principal,
            cbo: x.cbo,
            quantidade: x.quantidade,
            conta: x.conta,
          })),
        );
        const quantidade = arquivo.numeradas.reduce((n, x) => n + x.quantidade, 0);
        const porTipo = (t: string) => r.apacs.filter((x) => x.tipoNoArquivo === t).length;
        await g.trilha(
          s.trilha(EVENTOS_AUDITAVEIS.faturamentoApacGerada.codigo, 'faturamento.gerarApac', {
            tabela: 'SGH_FAT_SUS_ARQUIVO',
            id: String(id),
            diferenca: `competencia=${c.competencia};apacs=${r.apacs.length};inicial=${porTipo('1')};continuidade=${porTipo('2')};unica=${porTipo('3')};procedimentos=${arquivo.procedimentos}/${quantidade};controle=${arquivo.controle};sha256=${hash}`,
          }),
        );
        const lido = await g.arquivo(id);
        if (!lido) throw new ErroProblema('nao-encontrado', 404, 'Arquivo não encontrado');
        return {
          arquivo: this.arquivoLido(lido),
          competencia: this.resumo(await this.exigirCompetencia(g, 'apac', e.competencia), true),
          substituidos,
          tempoMs,
        };
      });
    } catch (erro) {
      const g = guardado as { versao: string | null } | null;
      if (g)
        await this.armazem
          .remover(chave, g.versao)
          .catch(() =>
            this.avisar(`faturamento.gerarApac: o objeto do arquivo ${id} não foi removido após a recusa`),
          );
      throw erro;
    }
    const final = guardado as { versao: string | null } | null;
    await this.armazem
      .fixar(chave, final?.versao ?? null)
      .catch(() =>
        this.avisar(
          `faturamento.gerarApac: a guarda definitiva do arquivo ${id} não foi fixada após o COMMIT`,
        ),
      );
    return gerado;
  }

  /** As linhas de procedimento de um APAC-Mag gerado (sem dado pessoal). */
  async listarLinhasApac(s: SessaoSus, f: FiltroLinhasApac): Promise<PaginaLinhasApac> {
    await this.exigirLiberado(s, 'apac');
    this.exigirEscopoTotal(s);
    return this.porta.ler(this.ctx(s), async (l) => {
      const a = await l.arquivo(f.arquivo);
      if (!a || a.instrumento !== 'apac')
        throw new ErroProblema('nao-encontrado', 404, 'Arquivo APAC não encontrado');
      return l.linhasApac({ arquivo: f.arquivo, pagina: f.pagina, porPagina: f.porPagina });
    });
  }

  // ── Equivalência SIGTAP do Sante ─────────────────────────────────────────────────────────────────────

  private equivalenciaLida(x: EquivalenciaSusNomeada): EquivalenciaSusLida {
    return {
      id: x.id,
      procedimento: x.procedimento,
      procedimentoCodigo: x.codigoProcedimento || null,
      procedimentoNome: x.procedimentoNome,
      tabela: x.tabela,
      sigtap: x.codigo,
      sigtapNome: x.sigtapNome,
      ativa: x.ativa,
      registradaPor: x.registradaPor,
      registradaEm: x.registradaEm,
      versao: versaoSus(x.versao),
    };
  }

  async listarEquivalencias(s: SessaoSus, f: FiltroEquivalenciasSus): Promise<PaginaEquivalenciasSus> {
    const r = await this.porta.ler(this.ctx(s), (l) =>
      l.paginaEquivalencias({
        ...(f.termo ? { termo: f.termo } : {}),
        ...(f.procedimento ? { procedimento: f.procedimento } : {}),
        inativas: f.inativas === 'sim',
        pagina: f.pagina,
        porPagina: f.porPagina,
      }),
    );
    return { itens: r.itens.map((x) => this.equivalenciaLida(x)), total: r.total };
  }

  /** Busca na SIGTAP do estabelecimento (código ou nome), com a vigência na competência pedida. */
  async buscarSigtap(
    s: SessaoSus,
    termo: string,
    competencia: CompetenciaSus | null,
  ): Promise<SigtapAchado[]> {
    return this.porta.ler(this.ctx(s), (l) =>
      l.buscarSigtap(termo, competencia === null ? null : Number(competencia)),
    );
  }

  /** Busca no cadastro de procedimentos do hospital (código na tabela ou nome), ou pelos IDs (o nome na tela). */
  async buscarProcedimentosHospital(
    s: SessaoSus,
    q: { termo: string } | { ids: readonly number[] },
  ): Promise<ProcedimentoHospitalSus[]> {
    return this.porta.ler(this.ctx(s), (l) =>
      'termo' in q ? l.buscarProcedimentosHospital(q.termo) : l.procedimentosHospital(q.ids),
    );
  }

  async registrarEquivalencia(
    s: SessaoSus,
    e: RegistrarEquivalenciaSusEntrada,
  ): Promise<{ equivalencia: EquivalenciaSusLida; mudou: boolean }> {
    await this.exigirLiberado(s, 'ciha');
    // A equivalência vale para o estabelecimento inteiro (muda a CIHA de todos os convênios): escopo total.
    this.exigirEscopoTotal(s);
    return this.gravar(s, async (g) => {
      const [proc] = await g.procedimentosHospital([e.procedimento]);
      if (!proc)
        throw new ErroProblema(
          'recusa-de-negocio',
          422,
          'Procedimento do hospital inexistente',
          'O procedimento não está no cadastro de procedimentos do hospital. Escolha-o pela busca.',
          { codigo: 'procedimento-inexistente' },
        );
      const p = await g.sigtapPorCodigo(e.sigtap);
      if (!p)
        throw new ErroProblema(
          'recusa-de-negocio',
          422,
          'Procedimento SIGTAP inexistente',
          'O código não está na tabela SIGTAP do estabelecimento. Confira o código ou atualize a tabela SIGTAP.',
          { codigo: 'sigtap-inexistente' },
        );
      const r = await g.registrarEquivalencia({
        procedimento: proc.id,
        codigoProcedimento: proc.codigo,
        sigtap: p.id,
        codigo: p.codigo,
        por: s.login,
        versao: e.versao === undefined ? undefined : Number(e.versao),
      });
      if (r.mudou)
        await g.trilha(
          s.trilha(
            EVENTOS_AUDITAVEIS.faturamentoEquivalenciaSusRegistrada.codigo,
            'faturamento.registrarEquivalenciaSus',
            {
              tabela: 'SGH_FAT_SUS_EQUIVALENCIA',
              id: String(r.depois.id),
              diferenca: `procedimento=${proc.id};codigo=${proc.codigo};sigtap=${r.antes?.ativa ? r.antes.codigo : ''}->${p.codigo}`,
            },
          ),
        );
      return {
        equivalencia: this.equivalenciaLida({
          ...r.depois,
          procedimentoNome: proc.nome,
          tabela: proc.tabela,
          sigtapNome: p.nome,
        }),
        mudou: r.mudou,
      };
    });
  }

  /** `faturamento.desativarEquivalenciaSus`: a equivalência deixa de valer (a crítica volta); nada é apagado. */
  async desativarEquivalencia(
    s: SessaoSus,
    e: DesativarEquivalenciaSusEntrada,
  ): Promise<EquivalenciaSusLida> {
    await this.exigirLiberado(s, 'ciha');
    this.exigirEscopoTotal(s);
    return this.gravar(s, async (g) => {
      const r = await g.desativarEquivalencia({
        procedimento: e.procedimento,
        versao: Number(e.versao),
        por: s.login,
      });
      await g.trilha(
        s.trilha(
          EVENTOS_AUDITAVEIS.faturamentoEquivalenciaSusDesativada.codigo,
          'faturamento.desativarEquivalenciaSus',
          {
            tabela: 'SGH_FAT_SUS_EQUIVALENCIA',
            id: String(r.depois.id),
            diferenca: `procedimento=${r.depois.procedimento};sigtap=${r.antes.codigo}->`,
          },
        ),
      );
      return this.equivalenciaLida({ ...r.depois, procedimentoNome: null, tabela: null, sigtapNome: null });
    });
  }
}
